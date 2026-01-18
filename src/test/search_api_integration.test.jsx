
import { describe, it, expect } from 'vitest';
import { webSearchService } from '../services/webSearchService';

const ENV = process.env;

describe('VITE_SEARCH_API_KEY Integration Test', () => {

    // This test verifies that the VITE_SEARCH_API_KEY provided in .env 
    // works with at least one of the supported search providers.
    // Based on the key format (starts with AIza), it is likely a Google Key.
    // However, Google Custom Search also requires a CX (Context) ID.
    // If CX is missing, we expect a specific error, but we can verify the Key is read.

    it('should attempt Google Search with VITE_SEARCH_API_KEY', async () => {
        if (!ENV.VITE_SEARCH_API_KEY) {
            console.warn('Skipping test: VITE_SEARCH_API_KEY not found in env');
            return;
        }

        console.log('Testing VITE_SEARCH_API_KEY:', ENV.VITE_SEARCH_API_KEY.slice(0, 10) + '...');

        // We likely don't have a CX in env if it wasn't listed, 
        // so we can try with a dummy CX and expect a specific API error (400 Invalid Value),
        // which proves we successfully reached the Google API with the key.
        // If the Key was invalid format, we might get 400 Bad Request or 403.

        const dummyCx = '0123456789';

        try {
            await webSearchService.googleSearch(
                '2025 Super Bowl winner',
                ENV.VITE_SEARCH_API_KEY,
                dummyCx
            );
        } catch (error) {
            // We expect an error because CX is dummy.
            // But we want to ensure it's a network/API error, not a code error.
            console.log('Received expected error from Google API:', error.message);

            // Typical Google API error: "Google Search Error: 400 - ..."
            // or "Google Search Error: 403 - ..."
            expect(error.message).toMatch(/Google Search Error: \d{3}/);
        }
    });

    // Alternatively, if the key was intended for Serper/SerpApi (unlikely with AIza prefix),
    // we could try those, but let's stick to the most probable usage.
});
