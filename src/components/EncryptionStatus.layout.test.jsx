import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EncryptionStatus from './EncryptionStatus';

afterEach(cleanup);

describe('EncryptionStatus layout and accessibility', () => {
    it('has a 24px hit area and a 20px drawing', () => {
        const { container } = render(<EncryptionStatus phase="migrating" progress={0.5} />);
        const button = screen.getByRole('button');
        expect(button.style.width).toBe('24px');
        expect(button.style.height).toBe('24px');
        const svg = container.querySelector('svg');
        expect(svg.getAttribute('width')).toBe('20');
        expect(svg.getAttribute('height')).toBe('20');
        expect(svg.getAttribute('viewBox')).toBe('0 0 20 20');
    });

    it('draws the 20px shield when complete', () => {
        const { container } = render(<EncryptionStatus phase="complete" />);
        const shield = container.querySelector('.lucide-shield-check');
        expect(shield.getAttribute('width')).toBe('20');
        expect(shield.getAttribute('height')).toBe('20');
        expect(screen.getByRole('button').style.width).toBe('24px');
    });

    it.each(['migrating', 'complete'])('declares motion-reduce variants for every transition in phase %s', (phase) => {
        const { container } = render(<EncryptionStatus phase={phase} progress={0.5} />);
        const animated = [...container.querySelectorAll('[class]')].filter(el => /(^|\s)transition(-|\s|$)/.test(el.getAttribute('class')));
        expect(animated.length).toBeGreaterThan(0);
        for (const el of animated) expect(el.getAttribute('class')).toMatch(/motion-reduce:transition-none/);
    });

    it('keeps the arc transition and the progress wrapper reduced-motion aware', () => {
        const { container } = render(<EncryptionStatus phase="migrating" progress={0.5} />);
        expect(container.querySelector('[data-encryption-arc]').getAttribute('class')).toMatch(/motion-reduce:transition-none/);
        expect(screen.getByRole('progressbar').className).toMatch(/motion-reduce:transition-none/);
    });

    it('includes the percent in the aria-label when progress is measurable', () => {
        for (const phase of ['migrating', 'finalizing', 'paused', 'error']) {
            const { unmount } = render(<EncryptionStatus phase={phase} progress={0.63} />);
            expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/: 63%/);
            unmount();
        }
    });

    it.each(['preparing', 'disabled', 'complete'])('omits the percent from the aria-label in phase %s', (phase) => {
        render(<EncryptionStatus phase={phase} progress={0.63} />);
        expect(screen.getByRole('button').getAttribute('aria-label')).not.toMatch(/%/);
    });

    it('has no aria-valuenow, min or max while preparing, but stays a progressbar', () => {
        render(<EncryptionStatus phase="preparing" progress={0.8} />);
        const bar = screen.getByRole('progressbar');
        for (const attr of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax', 'aria-valuetext']) {
            expect(bar.hasAttribute(attr)).toBe(false);
        }
    });

    it('exposes aria-valuemin/max/now when measurable and clamps to 99', () => {
        render(<EncryptionStatus phase="migrating" progress={3} />);
        const bar = screen.getByRole('progressbar');
        expect(bar.getAttribute('aria-valuemin')).toBe('0');
        expect(bar.getAttribute('aria-valuemax')).toBe('100');
        expect(bar.getAttribute('aria-valuenow')).toBe('99');
    });

    it('renders a tooltip with the same text as the label', () => {
        render(<EncryptionStatus phase="paused" progress={0.4} />);
        const tooltip = screen.getByRole('tooltip');
        expect(tooltip.textContent).toBe(screen.getByRole('button').getAttribute('aria-label'));
        expect(tooltip.className).toMatch(/group-focus-visible:opacity-100/);
        expect(tooltip.className).toMatch(/group-hover:opacity-100/);
        expect(tooltip.className).toMatch(/pointer-events-none/);
    });

    it('includes the error text in label and tooltip for the error phase', () => {
        render(<EncryptionStatus phase="error" progress={0.2} lastError="Storage full" />);
        expect(screen.getByRole('tooltip').textContent).toMatch(/Storage full/);
        expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/Storage full/);
    });

    it('is a native focusable button with a visible focus style', () => {
        render(<EncryptionStatus phase="migrating" progress={0.1} />);
        const button = screen.getByRole('button');
        expect(button.tagName).toBe('BUTTON');
        expect(button.getAttribute('type')).toBe('button');
        expect(button.className).toMatch(/focus-visible:outline/);
        button.focus();
        expect(document.activeElement).toBe(button);
    });

    // jsdom does not turn Enter/Space into click on a native button, so the test checks the
    // preconditions the browser relies on: a native enabled button, in tab order, with no handler cancelling the keys.
    it.each(['Enter', ' '])('leaves key %j to the browser default activation of the native button', (key) => {
        const onClick = vi.fn();
        render(<EncryptionStatus phase="migrating" progress={0.1} onClick={onClick} />);
        const button = screen.getByRole('button');
        expect(button.disabled).toBe(false);
        expect(button.tabIndex).toBe(0);
        expect(fireEvent.keyDown(button, { key })).toBe(true);
        expect(fireEvent.keyUp(button, { key })).toBe(true);
        // The browser then dispatches click, which is what opens the controls.
        fireEvent.click(button);
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
