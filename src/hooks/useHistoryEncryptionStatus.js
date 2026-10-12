import { useCallback, useEffect, useRef, useState } from 'react';
import { getHistoryStatus, subscribeHistoryStatus, reportHistoryInteraction } from '../services/historyClient';

const VISUAL_INTERVAL_MS = 250;
const INTERACTION_INTERVAL_MS = 1000;
const initial = { phase: 'disabled', progress: 0, enabled: false, lastError: null };

// Progress events can arrive faster than the indicator needs, so the newest one is applied at most four times a second.
export function useHistoryEncryptionStatus() {
    const [status, setStatus] = useState(initial);
    const [isLoading, setIsLoading] = useState(true);
    const lastReport = useRef(-Infinity);

    useEffect(() => {
        let active = true;
        let received = false;
        let latest = null;
        let timer = null;
        const apply = () => {
            timer = null;
            if (active && latest) setStatus(latest);
        };
        const unsubscribe = subscribeHistoryStatus((next) => {
            received = true;
            latest = next;
            if (!timer) timer = setTimeout(apply, VISUAL_INTERVAL_MS);
        });
        getHistoryStatus()
            .then((next) => { if (active && !received) setStatus(next); })
            .catch((error) => {
                // An unreadable status must never look like a verified one.
                if (active && !received) setStatus({ ...initial, phase: 'error', lastError: error?.message || String(error) });
            })
            .finally(() => { if (active) setIsLoading(false); });
        return () => {
            active = false;
            if (timer) clearTimeout(timer);
            unsubscribe();
        };
    }, []);

    // Typing slows the migration down, but one report per second is enough for that.
    const reportInteraction = useCallback(() => {
        const at = Date.now();
        if (at - lastReport.current < INTERACTION_INTERVAL_MS) return;
        lastReport.current = at;
        reportHistoryInteraction();
    }, []);

    return { ...status, isLoading, reportInteraction };
}
