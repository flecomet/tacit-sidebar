import { describe, it, expect, beforeAll } from 'vitest';
import { fetchModels } from '../services/modelService';
import { useChatStore } from '../store/useChatStore';

// Access the API key from environment variables
const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
const baseUrl = import.meta.env.VITE_OPENROUTER_BASE_URL || 'https://eu.openrouter.ai/api/v1';

// Live tests run only with an explicit opt-in and a key.
const describeIntegration = apiKey && import.meta.env.VITE_OPENROUTER_LIVE_TEST === 'true' ? describe : describe.skip;
// Paid completion calls need a second opt-in.
const itPaidChat = import.meta.env.VITE_OPENROUTER_CHAT_TEST === 'true' ? it : it.skip;

describeIntegration('OpenRouter Real API Integration', () => {

    beforeAll(() => {
        // Inject the key into the store just in case components are mounted
        useChatStore.getState().addApiKey('openrouter', { encryptedKey: apiKey });
    });

    it('can fetch the authorized models', async () => {
        const models = await fetchModels(baseUrl, 'openrouter', apiKey);
        expect(Array.isArray(models)).toBe(true);
        // An authorized list can legitimately be empty.
        for (const first of models.slice(0, 1)) {
            expect(first).toHaveProperty('id');
            expect(first).toHaveProperty('name');
        }
    });

    itPaidChat('should receive a response from chat completions endpoint', async (ctx) => {
        // Pick from the live list so the test never pins a retired model id.
        const models = await fetchModels(baseUrl, 'openrouter', apiKey);
        const paidText = models
            // Skip variant ids (':batch', ':free', ...): batch variants reject chat/completions.
            .filter(m => !m.id.includes(':') && m.architecture?.output_modalities?.includes('text') && Number(m.pricing?.prompt) > 0)
            .sort((a, b) => Number(a.pricing.prompt) - Number(b.pricing.prompt));
        if (!paidText.length) ctx.skip('no paid text model in the live list');
        const modelToUse = (paidText.find(m => /gemini.*flash/.test(m.id)) || paidText[0]).id;

        const payload = {
            model: modelToUse,
            messages: [
                { role: "user", content: "Reply with 'Test Successful' if you can read this." }
            ]
        };

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://tacit.test",
                "X-Title": "Tacit Test"
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        // Debugging help if it fails
        if (!response.ok) {
            console.error("OpenRouter API Error:", data);
        }

        expect(response.ok).toBe(true);
        expect(data).toHaveProperty('choices');
        expect(Array.isArray(data.choices)).toBe(true);
        expect(data.choices.length).toBeGreaterThan(0);

        const content = data.choices[0].message.content;
        expect(content).toBeDefined();
        console.log("AI Response:", content);
        expect(content.length).toBeGreaterThan(0);
    });
});
