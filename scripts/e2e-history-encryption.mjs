// Drives the built extension (dist/) in real Chromium: migration, interaction during migration,
// service worker restart, restore after reload, and a scan of IndexedDB for leftover plaintext.
// Usage: npm run build && node scripts/e2e-history-encryption.mjs [--sessions=30] [--keep-open]
import { chromium } from '@playwright/test';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const [key, ...value] = arg.replace(/^--/, '').split('=');
    return [key, value.length ? value.join('=') : true];
}));
const SESSIONS = Number(args.sessions || 30);
const DEADLINE_MS = Number(args['deadline-ms'] || 600000);
const MARKER = 'PLAINTEXT_MARKER_7f3a';
const dist = resolve(new URL('../dist', import.meta.url).pathname);
const results = [];
// Retain CPU totals for exited renderer processes so worker restarts do not erase consumed time.
const processCpu = new Map();
let peakExtensionRssKiB = 0;
function extensionCpuSeconds(profileDir) {
    const lines = execSync('ps -axo pid=,cputime=,rss=,args=', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n');
    let rssKiB = 0;
    for (const line of lines) {
        if (!line.includes(profileDir) || !line.includes('--extension-process')) continue;
        const [pid, cpuTime, rss] = line.trim().split(/\s+/);
        const parts = cpuTime.split(':').map(Number);
        const seconds = parts.reduce((sum, value) => sum * 60 + value, 0);
        processCpu.set(pid, Math.max(processCpu.get(pid) || 0, seconds));
        rssKiB += Number(rss);
    }
    peakExtensionRssKiB = Math.max(peakExtensionRssKiB, rssKiB);
    return [...processCpu.values()].reduce((sum, value) => sum + value, 0);
}
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

// OpenAI-compatible stub for the local provider.
let replies = 0;
const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    if (request.method === 'OPTIONS') { response.writeHead(204, { 'Access-Control-Allow-Headers': '*' }); response.end(); return; }
    if (request.url.endsWith('/models')) { response.end(JSON.stringify({ data: [{ id: 'mock-model' }] })); return; }
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => { replies++; response.end(JSON.stringify({ choices: [{ message: { content: `${MARKER} reply ${replies}` } }] })); });
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const port = server.address().port;

const sessions = Array.from({ length: SESSIONS }, (_, s) => ({
    id: `s${s}`, title: `${MARKER} chat ${s}`, model: 'mock-model', updatedAt: 1000 + s,
    messages: Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${MARKER} message ${s}-${i} ${'lorem ipsum '.repeat(200)}` })),
}));
const legacy = JSON.stringify({
    state: { providerMode: 'local', localBaseUrl: `http://127.0.0.1:${port}/v1`, model: 'mock-model', currentSessionId: 's0', sessions, messages: sessions[0].messages },
    version: 3,
});

console.log(`Synthetic legacy input: ${(Buffer.byteLength(legacy) / 1048576).toFixed(1)} MiB, ${SESSIONS} conversations`);

const profile = await mkdtemp(join(tmpdir(), 'tacit-e2e-'));
const launch = () => chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
let context = await launch();
const memorySampler = setInterval(() => extensionCpuSeconds(profile), 1000);
if (args.artifacts) await mkdir(args.artifacts, { recursive: true });

try {
    let [worker] = context.serviceWorkers();
    worker ||= await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const panelUrl = `chrome-extension://${extensionId}/src/sidepanel/index.html`;
    check('extension service worker started as an ES module', worker.url().endsWith('assets/background.js'));

    const seedPage = await context.newPage();
    await seedPage.goto(`chrome-extension://${extensionId}/manifest.json`);
    await seedPage.evaluate(() => { globalThis.__historySeed = []; });
    for (let offset = 0; offset < legacy.length; offset += 1024 * 1024) {
        await seedPage.evaluate(chunk => globalThis.__historySeed.push(chunk), legacy.slice(offset, offset + 1024 * 1024));
    }
    await seedPage.evaluate(async () => {
        await chrome.storage.local.set({ 'tacit-storage': globalThis.__historySeed.join('') });
        delete globalThis.__historySeed;
    });
    await seedPage.close();

    worker.on('close', () => console.log('  [service worker closed]'));
    context.on('serviceworker', (next) => { console.log('  [service worker started]'); next.on('close', () => console.log('  [service worker closed]')); });
    let page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 800 });
    page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) console.log(`  [panel ${message.type()}] ${message.text().slice(0, 300)}`); });
    const consoleErrors = [];
    page.on('pageerror', error => consoleErrors.push(error.message));
    await context.addInitScript(() => {
        window.__longTasks = [];
        window.__preparationTasks = [];
        window.__historyActivated = false;
        globalThis.chrome?.runtime?.onMessage?.addListener(message => {
            if (message.type === 'history.status.changed' && message.status?.enabled) window.__historyActivated = true;
        });
        new PerformanceObserver(list => list.getEntries().forEach(entry => (window.__historyActivated ? window.__longTasks : window.__preparationTasks).push(entry.duration))).observe({ entryTypes: ['longtask'] });
    });
    await page.goto(panelUrl);
    await page.getByLabel('Settings').waitFor();
    check('no encryption indicator before opt-in', await page.getByRole('progressbar').count() === 0);

    let trace;
    if (args.trace) {
        trace = await context.newCDPSession(page);
        await trace.send('Tracing.start', { categories: 'devtools.timeline,v8,disabled-by-default-v8.gc', transferMode: 'ReturnAsStream' });
    }

    // Opt in.
    const cpuBefore = extensionCpuSeconds(profile);
    const wallBefore = Date.now();
    await page.getByLabel('Settings').click();
    await page.getByRole('button', { name: 'Enable history encryption' }).click();
    await page.getByLabel('Close Settings').click();
    let indicator = page.locator('button[aria-label*="history" i]').first();
    await indicator.waitFor({ timeout: 10000 });

    // Interact while the migration runs: send a message and time the reply.
    const input = page.getByRole('textbox').first();
    const started = Date.now();
    await input.fill('hello during migration');
    await input.press('Enter');
    await page.getByText(`${MARKER} reply 1`).waitFor({ timeout: 15000 });
    check('message sent during migration is answered', true, `${Date.now() - started} ms`);

    if (args.artifacts) await page.screenshot({ path: join(args.artifacts, 'history-progress.png') });

    // Stop the service worker mid-migration; work must resume from the checkpoint.
    const cdp = await context.newCDPSession(page);
    const phaseNow = async () => (await indicator.getAttribute('aria-label')) || '';
    if (args['stop-at'] === 'conversion') await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => /Encrypting history/.test(button.getAttribute('aria-label') || '')), { timeout: 30000 });
    const during = await phaseNow();
    if (!/encrypted/i.test(during) || /encrypting/i.test(during)) {
        await cdp.send('ServiceWorker.enable').catch(() => {});
        await cdp.send('ServiceWorker.stopAllWorkers').catch(() => {});
    }

    if (args['close-panel']) {
        await page.close();
        await new Promise(resolve => setTimeout(resolve, 5000));
        page = await context.newPage();
        await page.setViewportSize({ width: 360, height: 800 });
        await page.goto(panelUrl);
        await page.getByLabel('Settings').waitFor();
        indicator = page.locator('button[aria-label*="history" i]').first();
    }

    // Wait for the verified shield.
    const deadline = Date.now() + DEADLINE_MS;
    let label = '';
    while (Date.now() < deadline) {
        label = await phaseNow();
        if (/current history encrypted/i.test(label)) break;
        if (Math.floor(Date.now() / 1000) % 15 === 0) console.log(`  ... ${label} (service workers: ${context.serviceWorkers().length})`);
        await page.waitForTimeout(1000);
    }
    if (trace) {
        const done = new Promise(resolve => trace.once('Tracing.tracingComplete', resolve));
        await trace.send('Tracing.end');
        const { stream } = await done;
        let text = '';
        while (true) {
            const chunk = await trace.send('IO.read', { handle: stream });
            text += chunk.data;
            if (chunk.eof) break;
        }
        await trace.send('IO.close', { handle: stream });
        await writeFile(args.trace, text);
    }
    const wallSeconds = (Date.now() - wallBefore) / 1000;
    const cpuSeconds = extensionCpuSeconds(profile) - cpuBefore;
    check('extension CPU stays low during migration', cpuSeconds / wallSeconds < 0.25, `${(cpuSeconds / wallSeconds * 100).toFixed(1)}% of one core over ${wallSeconds.toFixed(0)} s (includes polling by this script)`);
    check('migration reaches the verified shield', /current history encrypted/i.test(label), label);
    console.log(`  peak extension renderer resident memory: ${(peakExtensionRssKiB / 1024).toFixed(0)} MiB`);
    if (args.artifacts) {
        await page.screenshot({ path: join(args.artifacts, 'history-complete.png') });
        await page.setViewportSize({ width: 320, height: 700 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const headerFits = await page.evaluate(() => {
            const controls = document.querySelectorAll('button[aria-label="Settings"], button[aria-label="Current history encrypted"]');
            return controls.length === 2 && [...controls].every(control => { const box = control.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= 48; });
        });
        check('encryption and Settings controls fit a 320 pixel panel with reduced motion', headerFits);
        await page.screenshot({ path: join(args.artifacts, 'history-narrow-reduced-motion.png') });
    }
    check('shield icon is drawn', await page.locator('.lucide-shield-check').count() === 1);

    const longTasks = await page.evaluate(() => window.__longTasks || []);
    const preparationTasks = await page.evaluate(() => window.__preparationTasks || []);
    console.log(`  initial legacy preparation: max panel task ${Math.max(0, ...preparationTasks).toFixed(0)} ms, count ${preparationTasks.length}`);
    check('panel long tasks stay under 50 ms after activation', longTasks.every(duration => duration <= 50), `max ${Math.max(0, ...longTasks).toFixed(0)} ms, count ${longTasks.length}`);

    // Settings blob and IndexedDB must hold no plaintext.
    const blob = await page.evaluate(() => chrome.storage.local.get('tacit-storage').then(result => result['tacit-storage']));
    check('settings blob keeps no sessions or messages', !/"sessions"|"messages"/.test(blob) && !blob.includes(MARKER));
    const scan = await page.evaluate(async (marker) => {
        const db = await new Promise((res, rej) => { const r = indexedDB.open('tacit-history'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        const report = {};
        for (const name of [...db.objectStoreNames]) {
            const rows = await new Promise((res, rej) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
            const text = JSON.stringify(rows, (key, value) => (value instanceof ArrayBuffer ? `buf${value.byteLength}` : ArrayBuffer.isView(value) ? `view${value.byteLength}` : value));
            report[name] = { rows: rows.length, plaintext: text.includes(marker) };
        }
        db.close();
        return report;
    }, MARKER);
    check('IndexedDB holds no plaintext after finalization', Object.values(scan).every(store => !store.plaintext), JSON.stringify(scan));
    check('staged store is empty', scan.staged.rows === 0);

    if (args['two-panels']) {
        const second = await context.newPage();
        await second.setViewportSize({ width: 360, height: 800 });
        await second.goto(panelUrl);
        await second.getByText('hello during migration', { exact: true }).waitFor({ timeout: 30000 });
        const secondInput = second.getByRole('textbox').first();
        await secondInput.fill('hello from another panel');
        await second.waitForFunction(() => document.querySelector('button[aria-label="Send"]')?.disabled === false);
        await secondInput.press('Enter');
        await second.getByText(`${MARKER} reply 2`).waitFor({ timeout: 15000 });
        await page.getByText('hello from another panel').waitFor({ timeout: 15000 });
        check('another panel appends and this panel refreshes without losing history', true);
        await second.close();
    }

    // Reload: everything restores, including the message sent during migration.
    if (args['restart-browser']) {
        await context.close();
        context = await launch();
        page = await context.newPage();
        await page.setViewportSize({ width: 360, height: 800 });
        await page.goto(panelUrl);
    } else await page.reload();
    await page.getByLabel('Settings').waitFor();
    await page.getByText('hello during migration').waitFor({ timeout: 15000 });
    check('reload restores the message sent during migration', true);
    await page.locator('button:has(svg.lucide-menu)').click();
    const titles = await page.getByText(`${MARKER} chat`).count();
    check('history sidebar lists every conversation after reload', titles >= SESSIONS, `${titles}/${SESSIONS}`);
    check('no uncaught page errors', consoleErrors.length === 0, consoleErrors.join(' | '));
} catch (error) {
    check('script completed', false, error.stack || String(error));
} finally {
    clearInterval(memorySampler);
    if (!args['keep-open']) await context.close().catch(() => {});
    server.close();
    await rm(profile, { recursive: true, force: true });
}
const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
