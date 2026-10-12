// Measures the history migration primitives outside a browser with synthetic data.
// Usage: node scripts/benchmark-history-migration.mjs [--sizes=small,10,100,single,images] [--cpu-seconds=5]
// The sandbox is Node with fake-indexeddb, so absolute times are not Chrome times. Chrome measurements remain the evidence for user-facing behavior.
import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MIB = 1024 * 1024; // 1 Mio = 1 048 576 bytes
const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const sizes = (args.sizes || 'small,10').split(',');
const cpuSeconds = Number(args['cpu-seconds'] || 5);
const root = resolve(new URL('..', import.meta.url).pathname);

const work = await mkdtemp(join(tmpdir(), 'tacit-bench-'));
const outfile = join(work, 'bundle.mjs');
await build({
    stdin: {
        contents: `export * from './src/services/historyMigration.js'; export { openHistoryDatabase } from './src/services/historyRepository.js';`,
        resolveDir: root,
    },
    bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error',
});
const { createHistoryOwner, migrationBudget, openHistoryDatabase } = await import(pathToFileURL(outfile).href);
const { IDBFactory } = await import('fake-indexeddb');
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const text = bytes => 'x'.repeat(bytes);
const image = bytes => `data:image/png;base64,${'A'.repeat(bytes)}`;
const workloads = {
    small: () => sessions(200, 10, 200),
    10: () => sessions(Math.round(10 * MIB / (40 * 2500)), 40, 2500),
    100: () => sessions(Math.round(100 * MIB / (40 * 2500)), 40, 2500),
    single: () => sessions(1, 4000, 2500),
    images: () => sessions(20, 4, 200, 700000),
};
function sessions(count, perSession, bytes, imageBytes = 0) {
    return Array.from({ length: count }, (_, s) => ({
        id: `s${s}`, title: `Session ${s}`, model: 'm', updatedAt: s,
        messages: Array.from({ length: perSession }, (_, i) => ({
            role: i % 2 ? 'assistant' : 'user', content: text(bytes),
            ...(imageBytes && i === 0 ? { files: [{ name: 'a.png', content: image(imageBytes) }] } : {}),
        })),
    }));
}

const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0;
const ms = value => `${value.toFixed(1)} ms`;
const heapMiB = () => (process.memoryUsage().heapUsed / MIB).toFixed(0);

async function run(name) {
    const legacy = JSON.stringify({ state: { sessions: workloads[name](), currentSessionId: 's0', model: 'm' }, version: 3 });
    const repository = await openHistoryDatabase({ name: `bench-${name}`, indexedDB: new IDBFactory() });
    const values = { 'tacit-storage': legacy };
    const storage = { get: async key => values[key], set: async (key, value) => { values[key] = value; } };
    const lag = monitorEventLoopDelay({ resolution: 5 });
    const row = { workload: name, legacyMiB: +(legacy.length / MIB).toFixed(1) };
    let peak = 0;
    const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 50);

    const noPause = createHistoryOwner({ repository, storage, pause: async () => {}, budget: { ...migrationBudget, minPauseMs: 0, maxWakeDurationMs: 60 * 60 * 1000 } });
    lag.enable();
    let t = performance.now();
    await noPause.prepare();
    row.prepareMs = +(performance.now() - t).toFixed(0);
    t = performance.now();
    await noPause.activate();
    row.activateMs = +(performance.now() - t).toFixed(0);

    // Interactive writes while conversion proceeds: append latency at the owner.
    const latencies = [];
    const appender = (async () => {
        for (let i = 0; i < 20; i++) {
            const started = performance.now();
            await noPause.command({ type: 'history.append', commandId: `bench-${name}-${i}`, sessionId: 's0', message: { role: 'user', content: 'hello' } });
            latencies.push(performance.now() - started);
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    })();
    t = performance.now();
    let steps = 0;
    const stepTimes = [];
    // Each wake is bounded; repeat until no work remains, as alarms would.
    while (await noPause.needsWork()) {
        const started = performance.now();
        await noPause.runWake();
        stepTimes.push(performance.now() - started);
        steps++;
    }
    await appender;
    row.convertMs = +(performance.now() - t).toFixed(0);
    row.wakes = steps;
    row.appendP50 = ms(percentile(latencies, 0.5));
    row.appendP95 = ms(percentile(latencies, 0.95));
    lag.disable();
    row.maxLoopStall = ms(lag.max / 1e6);
    row.phase = (await noPause.status()).phase;

    t = performance.now();
    const restored = await noPause.restore();
    row.restoreMs = +(performance.now() - t).toFixed(0);
    row.restoredSessions = restored.sessions.length;
    row.peakHeapMiB = Math.round(peak / MIB);
    clearInterval(sampler);
    repository.close();
    return row;
}

// Average CPU share with the production pacing, sampled for a few seconds.
async function cpuShare() {
    const legacy = JSON.stringify({ state: { sessions: sessions(400, 40, 2500), currentSessionId: 's0' }, version: 3 });
    const repository = await openHistoryDatabase({ name: 'bench-cpu', indexedDB: new IDBFactory() });
    const values = { 'tacit-storage': legacy };
    const owner = createHistoryOwner({ repository, storage: { get: async key => values[key], set: async (key, value) => { values[key] = value; } }, budget: { ...migrationBudget, maxWakeDurationMs: cpuSeconds * 1000 } });
    await owner.enable();
    const cpuStart = process.cpuUsage();
    const wallStart = performance.now();
    await owner.runWake();
    const cpu = process.cpuUsage(cpuStart);
    const wall = (performance.now() - wallStart) * 1000;
    const finished = await owner.status();
    repository.close();
    return { phase: finished.phase, lastError: finished.lastError, progress: +finished.progress.toFixed(2), wallSeconds: +(wall / 1e6).toFixed(1), cpuPercentOfOneCore: +(((cpu.user + cpu.system) / wall) * 100).toFixed(1) };
}

try {
    console.log(`Node ${process.version}, heap at start ${heapMiB()} MiB`);
    const rows = [];
    for (const name of sizes) {
        if (!workloads[name]) { console.error(`Unknown workload ${name}`); continue; }
        console.log(`Starting workload ${name}`);
        const row = await run(name);
        rows.push(row);
        console.log(JSON.stringify(row));
        globalThis.gc?.();
    }
    console.table(rows);
    console.log('CPU share with production pacing (includes fake-indexeddb overhead):', await cpuShare());
} finally {
    await rm(work, { recursive: true, force: true });
}
