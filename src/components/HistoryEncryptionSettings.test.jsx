import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HistoryEncryptionSettings from './HistoryEncryptionSettings';

afterEach(cleanup);

const PHASES = ['disabled', 'preparing', 'migrating', 'finalizing', 'paused', 'error', 'complete'];
const buttonNames = () => screen.queryAllByRole('button').map(b => b.textContent);

describe('HistoryEncryptionSettings phases', () => {
    it('disabled: offers only the enable button', () => {
        render(<HistoryEncryptionSettings phase="disabled" />);
        expect(buttonNames()).toEqual(['Enable history encryption']);
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('preparing: shows a status without any button', () => {
        render(<HistoryEncryptionSettings phase="preparing" progress={0.5} />);
        expect(screen.getByRole('status').textContent).toBe('Preparing history encryption');
        expect(buttonNames()).toEqual([]);
    });

    it('migrating: shows the percentage and a Pause button', () => {
        render(<HistoryEncryptionSettings phase="migrating" progress={0.42} />);
        expect(screen.getByRole('status').textContent).toBe('Encrypting history: 42%');
        expect(buttonNames()).toEqual(['Pause']);
    });

    it('finalizing: announces verification and offers no action', () => {
        render(<HistoryEncryptionSettings phase="finalizing" progress={0.99} />);
        expect(screen.getByRole('status').textContent).toMatch(/verifying and removing old copies/i);
        expect(buttonNames()).toEqual([]);
    });

    it('paused: shows where it stopped and a Resume button', () => {
        render(<HistoryEncryptionSettings phase="paused" progress={0.37} />);
        expect(screen.getByRole('status').textContent).toBe('Paused at 37%');
        expect(buttonNames()).toEqual(['Resume']);
    });

    it('error: alerts with the last error, keeps old data message and offers Resume', () => {
        render(<HistoryEncryptionSettings phase="error" lastError="Storage full" />);
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toMatch(/History encryption stopped: Storage full/);
        expect(alert.textContent).toMatch(/Unverified history was kept unchanged/);
        expect(buttonNames()).toEqual(['Resume']);
    });

    it('error without a message falls back to a generic text', () => {
        render(<HistoryEncryptionSettings phase="error" />);
        expect(screen.getByRole('alert').textContent).toMatch(/unknown error/);
    });

    it('complete: states that history is encrypted and shows no action', () => {
        render(<HistoryEncryptionSettings phase="complete" progress={1} />);
        expect(screen.getByRole('status').textContent).toMatch(/History encrypted\./);
        expect(buttonNames()).toEqual([]);
    });

    it('defaults to the disabled phase', () => {
        render(<HistoryEncryptionSettings />);
        expect(buttonNames()).toEqual(['Enable history encryption']);
    });
});

describe('HistoryEncryptionSettings actions', () => {
    it('disables the enable button and relabels it while busy', () => {
        const onEnable = vi.fn();
        render(<HistoryEncryptionSettings phase="disabled" busy onEnable={onEnable} />);
        const button = screen.getByRole('button');
        expect(button.disabled).toBe(true);
        expect(button.textContent).toBe('Starting…');
        fireEvent.click(button);
        expect(onEnable).not.toHaveBeenCalled();
    });

    it('fires Enable, Pause and Resume callbacks', () => {
        const onEnable = vi.fn(); const onPause = vi.fn(); const onResume = vi.fn();
        const props = { onEnable, onPause, onResume };
        const { rerender } = render(<HistoryEncryptionSettings phase="disabled" {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Enable history encryption' }));
        rerender(<HistoryEncryptionSettings phase="migrating" progress={0.1} {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        rerender(<HistoryEncryptionSettings phase="paused" progress={0.1} {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
        rerender(<HistoryEncryptionSettings phase="error" lastError="x" {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
        expect(onEnable).toHaveBeenCalledTimes(1);
        expect(onPause).toHaveBeenCalledTimes(1);
        expect(onResume).toHaveBeenCalledTimes(2);
    });
});

describe('HistoryEncryptionSettings error reporting', () => {
    it('announces the action error with role alert next to the phase content', () => {
        render(<HistoryEncryptionSettings phase="disabled" error="Could not reach the history service" />);
        expect(screen.getByRole('alert').textContent).toBe('Could not reach the history service');
        // The enable button stays available so the user can retry.
        expect(screen.getByRole('button', { name: 'Enable history encryption' }).disabled).toBe(false);
    });

    it('announces both lastError and an action error', () => {
        render(<HistoryEncryptionSettings phase="error" lastError="Quota" error="Resume failed" />);
        const alerts = screen.getAllByRole('alert').map(a => a.textContent);
        expect(alerts).toHaveLength(2);
        expect(alerts.join(' ')).toMatch(/Quota/);
        expect(alerts.join(' ')).toMatch(/Resume failed/);
    });

    it.each(PHASES.filter(p => p !== 'complete'))('never claims the history is encrypted in phase %s', (phase) => {
        const { container } = render(<HistoryEncryptionSettings phase={phase} progress={1} lastError="boom" error="failed" />);
        const text = container.textContent;
        expect(text).not.toMatch(/history is encrypted/i);
        expect(text).not.toMatch(/old copies were removed/i);
    });

    it('alerts in the error phase never say encrypted', () => {
        render(<HistoryEncryptionSettings phase="error" lastError="boom" error="failed" />);
        for (const alert of screen.getAllByRole('alert')) {
            expect(alert.textContent).not.toMatch(/is encrypted|were removed/i);
        }
    });
});

describe('HistoryEncryptionSettings scope disclaimer', () => {
    it.each(PHASES)('is present in phase %s', (phase) => {
        const { container } = render(<HistoryEncryptionSettings phase={phase} lastError="x" error="y" />);
        const text = container.textContent.replace(/\s+/g, ' ');
        expect(text).toMatch(/key stays in this browser profile/i);
        expect(text).toMatch(/Drafts and saved instructions are excluded/i);
        expect(text).toMatch(/Old data may remain on disk or in backups/i);
    });

    it('is labelled by its heading', () => {
        render(<HistoryEncryptionSettings />);
        const region = screen.getByRole('region', { name: 'History encryption' });
        expect(within(region).getByRole('heading', { level: 3 })).toBeTruthy();
    });
});

describe('HistoryEncryptionSettings percent clamping', () => {
    it.each([
        [1, '99'], [2.5, '99'], [0.999, '99'], [-0.5, '0'], [0.5, '50'], [0.014, '1'],
        [NaN, '0'], [undefined, '0'], [Infinity, '0'],
    ])('migrating with progress %s shows %s%%', (progress, expected) => {
        render(<HistoryEncryptionSettings phase="migrating" progress={progress} />);
        expect(screen.getByRole('status').textContent).toBe(`Encrypting history: ${expected}%`);
    });

    it.each([[1, '99'], [-3, '0'], [0.256, '25']])('paused with progress %s shows %s%%', (progress, expected) => {
        render(<HistoryEncryptionSettings phase="paused" progress={progress} />);
        expect(screen.getByRole('status').textContent).toBe(`Paused at ${expected}%`);
    });
});

describe('interrupted preparation recovery', () => {
    it('offers one activation retry after preparation failed before enabling', () => {
        render(<HistoryEncryptionSettings phase="error" enabled={false} />);
        expect(buttonNames()).toEqual(['Enable history encryption']);
    });

    it('offers activation again when preparation stopped before enabling', () => {
        const enable = vi.fn();
        render(<HistoryEncryptionSettings phase="preparing" enabled={false} onEnable={enable} />);
        fireEvent.click(screen.getByRole('button', { name: 'Enable history encryption' }));
        expect(enable).toHaveBeenCalledOnce();
    });
});
