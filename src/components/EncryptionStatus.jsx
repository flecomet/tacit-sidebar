import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

const phaseLabels = {
    disabled: 'History encryption is off',
    preparing: 'Preparing history encryption',
    migrating: 'Encrypting history',
    finalizing: 'Verifying encrypted history and removing old copies',
    complete: 'Current history encrypted',
    paused: 'History encryption paused',
    error: 'History encryption error',
};

export default function EncryptionStatus({ phase = 'disabled', progress = 0, lastError, onClick }) {
    const complete = phase === 'complete';
    const [shieldVisible, setShieldVisible] = useState(complete);
    const value = phase === 'preparing' || phase === 'disabled' ? 0
        : Math.max(0, Math.min(99, Math.floor((Number.isFinite(progress) ? progress : 0) * 100)));
    const measurable = !['disabled', 'preparing', 'complete'].includes(phase);
    const label = `${phaseLabels[phase] || phaseLabels.error}${measurable ? `: ${value}%` : ''}${phase === 'error' && lastError ? `. ${lastError}` : ''}`;

    useEffect(() => {
        if (!complete) {
            setShieldVisible(false);
            return;
        }
        const frame = requestAnimationFrame(() => setShieldVisible(true));
        return () => cancelAnimationFrame(frame);
    }, [complete]);

    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={`${label}. Open settings.`}
            className="group relative shrink-0 rounded-full flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan hover:bg-white/10"
            style={{ width: 24, height: 24 }}
        >
            <span
                role={phase === 'disabled' || complete ? undefined : 'progressbar'}
                aria-label={phase === 'disabled' || complete ? undefined : phaseLabels[phase]}
                aria-valuemin={measurable ? 0 : undefined}
                aria-valuemax={measurable ? 100 : undefined}
                aria-valuenow={measurable ? value : undefined}
                aria-valuetext={measurable ? label : undefined}
                className={`absolute flex transition-opacity duration-[250ms] motion-reduce:transition-none ${complete ? 'opacity-0' : 'opacity-100'}`}
                aria-hidden={complete || phase === 'disabled' ? true : undefined}
            >
                <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                    <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-600" />
                    <circle data-encryption-arc cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - value} transform="rotate(-90 10 10)" className="text-brand-cyan transition-[stroke-dashoffset] duration-[250ms] motion-reduce:transition-none" />
                </svg>
            </span>
            {complete && <ShieldCheck size={20} aria-hidden="true" className={`text-brand-cyan transition-opacity duration-[250ms] motion-reduce:transition-none motion-reduce:opacity-100 ${shieldVisible ? 'opacity-100' : 'opacity-0'}`} />}
            {phase === 'error' && <span aria-hidden="true" className="absolute -right-0.5 -top-1 text-xs font-bold text-amber-400">!</span>}
            <span role="tooltip" className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-56 rounded border border-brand-border bg-brand-card p-2 text-left text-xs text-gray-200 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none">{label}</span>
        </button>
    );
}
