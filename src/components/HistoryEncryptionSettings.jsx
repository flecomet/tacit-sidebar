import React from 'react';

const percent = (progress) => Math.max(0, Math.min(99, Math.floor((Number.isFinite(progress) ? progress : 0) * 100)));

export default function HistoryEncryptionSettings({ phase = 'disabled', enabled = phase !== 'disabled', progress = 0, lastError, busy = false, error, onEnable, onResume, onPause }) {
    const working = ['preparing', 'migrating', 'finalizing'].includes(phase);
    const button = 'w-full py-1.5 rounded text-xs font-bold border border-brand-cyan/50 text-brand-cyan bg-brand-input hover:bg-brand-cyan/20 transition-colors disabled:opacity-50';

    return (
        <section id="history-encryption" aria-labelledby="history-encryption-title" className="mt-4 border-t border-brand-border pt-4 space-y-2">
            <h3 id="history-encryption-title" className="text-sm font-medium text-gray-300">History encryption</h3>
            {!enabled && <p className="text-xs text-gray-400">Encrypt conversations and attachments on this device.</p>}

            {(!enabled && ['disabled', 'preparing', 'error'].includes(phase)) && (
                <button type="button" className={button} disabled={busy} onClick={onEnable}>
                    {busy ? 'Starting…' : 'Enable history encryption'}
                </button>
            )}
            {working && (
                <>
                    <p role="status" className="text-xs text-gray-200">
                        {phase === 'preparing' ? 'Preparing history encryption' : phase === 'finalizing' ? 'Verifying and removing old copies' : `Encrypting history: ${percent(progress)}%`}
                    </p>
                    {phase === 'migrating' && <button type="button" className={button} onClick={onPause}>Pause</button>}
                </>
            )}
            {phase === 'paused' && (
                <>
                    <p role="status" className="text-xs text-gray-200">Paused at {percent(progress)}%</p>
                    <button type="button" className={button} onClick={onResume}>Resume</button>
                </>
            )}
            {phase === 'error' && (
                <>
                    <p role="alert" className="text-xs text-amber-400">History encryption stopped: {lastError || 'unknown error'}. Unverified history was kept unchanged.</p>
                    {enabled && <button type="button" className={button} onClick={onResume}>Resume</button>}
                </>
            )}
            {phase === 'complete' && <p role="status" className="text-xs text-gray-200">History encrypted.</p>}
            {error && <p role="alert" className="text-xs text-amber-400">{error}</p>}

            <details className="text-xs text-gray-500">
                <summary className="cursor-pointer">Details and limitations</summary>
                <p className="mt-2">Keep Chrome open during conversion. You can close the side panel.</p>
                <p className="mt-2">The key stays in this browser profile. Anyone with access to the profile may read the history. Drafts and saved instructions are excluded. Old data may remain on disk or in backups.</p>
            </details>
        </section>
    );
}
