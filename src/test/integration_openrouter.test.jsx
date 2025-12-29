import { describe, it, expect, beforeAll } from 'vitest';
import { fetchModels } from '../services/modelService';
import { useChatStore } from '../store/useChatStore';

// Access the API key from environment variables
const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;

// Conditional execution wrapper: Only run if API key is present
const describeIntegration = apiKey ? describe : describe.skip;

describeIntegration('OpenRouter Real API Integration', () => {

    beforeAll(() => {
        // Inject the key into the store just in case components are mounted
        useChatStore.getState().setEncryptedApiKey(apiKey);
        console.log("Running integration tests with provided API Key.");
    });

    it('should can fetch models (public or authenticated)', async () => {
        // modelService.fetchModels currently doesn't require a key, 
        // but this verifies we can reach the OpenRouter API from this environment.
        const models = await fetchModels();
        expect(models).toBeDefined();
        expect(Array.isArray(models)).toBe(true);
        expect(models.length).toBeGreaterThan(0);
        console.log("Available models:", models.slice(0, 5).map(m => m.id));

        // Check structure of first model
        const first = models[0];
        expect(first).toHaveProperty('id');
        expect(first).toHaveProperty('name');
    });

    it('should receive a response from chat completions endpoint', async () => {
        // Using a standard paid/free-tier friendly model.
        // Confirmed available via logs: 'google/gemini-3-flash-preview'
        const modelToUse = "google/gemini-3-flash-preview";

        const payload = {
            model: modelToUse,
            messages: [
                { role: "user", content: "Reply with 'Test Successful' if you can read this." }
            ]
        };

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
