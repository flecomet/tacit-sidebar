import { describe, it, expect } from 'vitest';
import { getCostColorClass } from './costColors';

describe('getCostColorClass', () => {
    describe('handles missing/invalid cost data', () => {
        it('returns gray for null cost', () => {
            expect(getCostColorClass(null)).toBe('text-gray-500');
        });

        it('returns gray for undefined cost', () => {
            expect(getCostColorClass(undefined)).toBe('text-gray-500');
        });

        it('returns gray for zero cost (free/unknown)', () => {
            expect(getCostColorClass(0)).toBe('text-gray-500');
        });

        it('returns gray for negative cost (invalid)', () => {
            expect(getCostColorClass(-0.01)).toBe('text-gray-500');
        });

        it('returns gray for NaN', () => {
            expect(getCostColorClass(NaN)).toBe('text-gray-500');
        });
    });

    describe('cheap tier (< $0.01)', () => {
        it('returns green for $0.001', () => {
            expect(getCostColorClass(0.001)).toBe('text-cost-cheap');
        });

        it('returns green for $0.009', () => {
            expect(getCostColorClass(0.009)).toBe('text-cost-cheap');
        });

        it('returns green for very small costs', () => {
            expect(getCostColorClass(0.0001)).toBe('text-cost-cheap');
        });
    });

    describe('moderate tier ($0.01 - $0.04)', () => {
        it('returns blue for $0.01 (boundary)', () => {
            expect(getCostColorClass(0.01)).toBe('text-cost-moderate');
        });

        it('returns blue for $0.02', () => {
            expect(getCostColorClass(0.02)).toBe('text-cost-moderate');
        });

        it('returns blue for $0.039', () => {
            expect(getCostColorClass(0.039)).toBe('text-cost-moderate');
        });
    });

    describe('elevated tier ($0.04 - $0.10)', () => {
        it('returns yellow for $0.04 (boundary)', () => {
            expect(getCostColorClass(0.04)).toBe('text-cost-elevated');
        });

        it('returns yellow for $0.07', () => {
            expect(getCostColorClass(0.07)).toBe('text-cost-elevated');
        });

        it('returns yellow for $0.099', () => {
            expect(getCostColorClass(0.099)).toBe('text-cost-elevated');
        });
    });

    describe('expensive tier ($0.10 - $1.00)', () => {
        it('returns orange for $0.10 (boundary)', () => {
            expect(getCostColorClass(0.10)).toBe('text-cost-expensive');
        });

        it('returns orange for $0.50', () => {
            expect(getCostColorClass(0.50)).toBe('text-cost-expensive');
        });

        it('returns orange for $0.99', () => {
            expect(getCostColorClass(0.99)).toBe('text-cost-expensive');
        });
    });

    describe('extreme tier (> $1.00)', () => {
        it('returns red for $1.00 (boundary)', () => {
            expect(getCostColorClass(1.00)).toBe('text-cost-extreme');
        });

        it('returns red for $5.00', () => {
            expect(getCostColorClass(5.00)).toBe('text-cost-extreme');
        });

        it('returns red for very high costs', () => {
            expect(getCostColorClass(100.00)).toBe('text-cost-extreme');
        });
    });
});
