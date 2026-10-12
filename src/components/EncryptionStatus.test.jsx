import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EncryptionStatus from './EncryptionStatus';

afterEach(cleanup);

describe('EncryptionStatus', () => {
    it('shows a gray preparation ring without claiming measurable progress', () => {
        const { container } = render(<EncryptionStatus phase="preparing" progress={0.3} />);
        const bar = screen.getByRole('progressbar', { name: /preparing history encryption/i });
        expect(bar.hasAttribute('aria-valuenow')).toBe(false);
        expect(container.querySelector('[data-encryption-arc]').getAttribute('stroke-dashoffset')).toBe('100');
        expect(container.querySelector('.lucide-shield-check')).toBeNull();
    });

    it('draws real clockwise progress from noon in the existing brand color', () => {
        const { container } = render(<EncryptionStatus phase="migrating" progress={0.25} />);
        expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
        expect(screen.getByRole('button').title).toMatch(/25%/);
        const arc = container.querySelector('[data-encryption-arc]');
        expect(arc.getAttribute('stroke-dasharray')).toBe('100');
        expect(arc.getAttribute('stroke-dashoffset')).toBe('75');
        expect(arc.getAttribute('transform')).toBe('rotate(-90 10 10)');
        expect(arc.classList.contains('text-brand-cyan')).toBe(true);
        expect(container.querySelector('svg').getAttribute('width')).toBe('20');
        expect(container.querySelector('button').style.width).toBe('24px');
    });

    it.each(['migrating', 'finalizing', 'paused', 'error'])('does not show a verified shield in phase %s, even at 100 percent', (phase) => {
        const { container } = render(<EncryptionStatus phase={phase} progress={1} lastError="Storage full" />);
        expect(container.querySelector('.lucide-shield-check')).toBeNull();
        expect(Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeLessThan(100);
        if (phase === 'error') expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/error.*Storage full/i);
    });

    it('preserves paused progress and opens the encryption section by keyboard-accessible button', () => {
        const onClick = vi.fn();
        render(<EncryptionStatus phase="paused" progress={0.4} onClick={onClick} />);
        expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
        expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/paused.*40%/i);
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('shows the durable shield only when completion has been verified', () => {
        const { container } = render(<EncryptionStatus phase="complete" progress={1} />);
        expect(container.querySelector('.lucide-shield-check')).not.toBeNull();
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/current history encrypted/i);
        expect(container.querySelector('.lucide-shield-check').classList.contains('motion-reduce:transition-none')).toBe(true);
    });
});
