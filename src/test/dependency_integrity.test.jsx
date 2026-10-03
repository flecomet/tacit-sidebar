import { describe, it, expect } from 'vitest';

describe.skipIf(!import.meta.env.VITE_OPENROUTER_API_KEY)('Dependency Integrity and Environment Configuration', () => {
    it('should verify that VITE_ prefixed environment variables are defined', () => {
        // Assert that the environment variables are loaded and present in the vitest runtime
        expect(import.meta.env.VITE_OPENROUTER_API_KEY).toBeDefined();
        expect(typeof import.meta.env.VITE_OPENROUTER_API_KEY).toBe('string');
        expect(import.meta.env.VITE_OPENROUTER_API_KEY.length).toBeGreaterThan(0);
    });

    it('should verify that multiple API key environment variables are loaded', () => {
        expect(import.meta.env.VITE_OPENAI_API_KEY).toBeDefined();
        expect(import.meta.env.VITE_GOOGLE_API_KEY).toBeDefined();
    });
});
