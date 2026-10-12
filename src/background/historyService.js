import { openHistoryDatabase } from '../services/historyRepository';
import { createHistoryOwner, HISTORY_ENABLED_KEY, LEGACY_STORAGE_KEY } from '../services/historyMigration';

export const MIGRATION_ALARM = 'tacit-history-migration';
// Alarm periods below one minute are only honored from Chrome 120, so the portable minimum is used.
const ALARM_PERIOD_MINUTES = 1;
const FOLLOW_UP_WAKE_MS = 3000;

const chromeStorage = api => ({
    withLock: task => globalThis.navigator?.locks?.request
        ? globalThis.navigator.locks.request('tacit-settings-write', task)
        : task(),
    get: key => new Promise((resolve, reject) => api.storage.local.get([key], result => {
        if (api.runtime.lastError) reject(new Error(api.runtime.lastError.message));
        else resolve(result?.[key]);
    })),
    set: (key, value) => new Promise((resolve, reject) => api.storage.local.set({ [key]: value }, () => {
        if (api.runtime.lastError) reject(new Error(api.runtime.lastError.message));
        else resolve();
    })),
});

function hasLegacyHistory(value) {
    try {
        const state = (typeof value === 'string' ? JSON.parse(value) : value)?.state || {};
        return 'sessions' in state || 'messages' in state;
    } catch {
        return false;
    }
}

export function createHistoryService({ api = chrome, openRepository = openHistoryDatabase, openReadRepository = () => openHistoryDatabase({ readOnly: true }), schedule = setTimeout } = {}) {
    let ownerPromise;
    let followUp = false;
    const owner = () => ownerPromise ||= openRepository().then(repository => {
        repository.onClose?.(() => { ownerPromise = undefined; });
        return createHistoryOwner({
            repository,
            storage: chromeStorage(api),
            // Nobody may be listening, which rejects the send. Status is also readable on demand.
            broadcast: message => { Promise.resolve(api.runtime.sendMessage(message)).catch(() => {}); },
        });
    }).catch((error) => {
        // A failed open (for example a blocked upgrade) must be retried by the next request.
        ownerPromise = undefined;
        throw error;
    });

    async function syncAlarm(instance) {
        if (!api.alarms) return;
        if (await instance.needsWork()) {
            if (!(await api.alarms.get(MIGRATION_ALARM))) api.alarms.create(MIGRATION_ALARM, { periodInMinutes: ALARM_PERIOD_MINUTES });
        } else {
            await api.alarms.clear(MIGRATION_ALARM);
        }
    }

    // One bounded wake per trigger. Remaining work is picked up by a short follow-up or by the next alarm.
    async function wake() {
        const instance = await owner();
        if (!(await instance.needsWork())) return syncAlarm(instance);
        await instance.runWake();
        await syncAlarm(instance);
        // Claimed before the await, so overlapping wakes cannot each schedule their own follow-up.
        if (followUp) return;
        followUp = true;
        if (await instance.needsWork()) schedule(() => { followUp = false; wake().catch(() => {}); }, FOLLOW_UP_WAKE_MS);
        else followUp = false;
    }

    const handlers = {
        'history.status': async instance => {
            // Opening the panel is a good moment to continue interrupted work.
            schedule(() => wake().catch(() => {}), 0);
            return instance.status();
        },
        'history.prepare': async instance => instance.prepare(),
        'history.activate': async instance => { const status = await instance.activate(); await syncAlarm(instance); schedule(() => wake().catch(() => {}), 0); return status; },
        'history.resume': async instance => { const status = await instance.resume(); await syncAlarm(instance); schedule(() => wake().catch(() => {}), 0); return status; },
        'history.pause': async instance => { const status = await instance.pause(); await syncAlarm(instance); return status; },
        'history.interaction': async instance => { instance.interaction(); return { ok: true }; },
    };
    const commandTypes = ['history.create', 'history.append', 'history.truncate', 'history.delete'];

    function onMessage(request, sender, sendResponse) {
        // Only extension pages may drive history; web pages and other extensions are ignored.
        if (typeof request?.type !== 'string' || !request.type.startsWith('history.') || sender?.id !== api.runtime.id) return false;
        const handler = handlers[request.type];
        if (!handler && !commandTypes.includes(request.type)) return false;
        owner()
            .then(instance => (handler ? handler(instance) : instance.command(request)))
            .then(result => {
                sendResponse(result ?? { ok: true });
                // The answer is already sent, so a failing wake must not produce a second one.
                if (!handler) wake().catch(() => {});
            }, error => sendResponse({ ok: false, error: error?.code || 'HISTORY_ERROR', message: error?.message || String(error) }));
        // The response is asynchronous, so the channel stays open.
        return true;
    }

    // Settings written by an older panel context must not bring history content back after activation.
    function onStorageChanged(changes, area) {
        if (area !== 'local' || !changes[LEGACY_STORAGE_KEY]) return;
        const value = changes[LEGACY_STORAGE_KEY].newValue;
        if (!value) return;
        owner().then(async instance => {
            const status = await instance.status();
            if (status.enabled && hasLegacyHistory(value)) await instance.cleanLegacySettings();
        }).catch(() => {});
    }

    function register() {
        api.runtime.onMessage?.addListener(onMessage);
        api.storage?.onChanged?.addListener(onStorageChanged);
        api.alarms?.onAlarm?.addListener(alarm => { if (alarm.name === MIGRATION_ALARM) wake().catch(() => {}); });
        // A cold start resumes interrupted work and removes the alarm when none remains.
        const resume = () => {
            if (!api.storage?.local) return;
            chromeStorage(api).get(HISTORY_ENABLED_KEY).then(async enabled => {
                if (enabled) return wake();
                // IndexedDB commits before the marker, so a stopped activation can leave only the durable status.
                const repository = await openReadRepository();
                let current;
                try { current = await repository.getMigrationStatus(); }
                finally { repository.close(); }
                if (current?.enabled) {
                    await chromeStorage(api).set(HISTORY_ENABLED_KEY, true);
                    await wake();
                }
            }).catch(() => {});
        };
        resume();
        api.runtime.onStartup?.addListener(resume);
    }

    return { register, wake, onMessage, onStorageChanged, owner };
}
