import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from '../sidepanel/App';
import { useChatStore } from '../store/useChatStore';
import * as encryption from '../utils/encryption';
import * as modelService from '../services/modelService';

/**
 * Performance Test Suite
 * 
 * Measures execution time of UI interactions to identify bottlenecks.
 * Uses mocked network calls to isolate UI/store performance from API latency.
 */

// Performance thresholds in milliseconds
// These thresholds identify regressions - if exceeded, investigate!
// Note: Test environment may have overhead from React Testing Library
const THRESHOLDS = {
    PROVIDER_SWITCH: 100,     // Switching between Cloud/Local (includes re-render)
    CLOUD_PROVIDER: 100,      // Switching between OpenRouter/OpenAI/etc
    MODEL_SELECTION: 50,      // Selecting a different model
    QUICK_SETUP: 100,         // Clicking Ollama/LM Studio buttons
    STATE_UPDATE: 30,         // Simple Zustand state updates
};

// Timing helper
const measureTime = async (fn) => {
    const start = performance.now();
    await fn();
    return performance.now() - start;
};

// Mock models for testing
const mockModels = [
    { id: 'model-1', name: 'Model 1' },
    { id: 'model-2', name: 'Model 2' },
    { id: 'local-model', name: 'Local Model' },
];

describe('Performance Tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Reset store to clean state
        useChatStore.setState({
            encryptedApiKeys: {
                openrouter: 'encrypted-test-key',
                openai: '',
                anthropic: '',
                google: ''
            },
            messages: [],
            providerMode: 'cloud',
            activeCloudProvider: 'openrouter',
            localBaseUrl: 'http://localhost:11434/v1',
            model: 'model-1',
            availableModels: mockModels,
            sessions: [],
            currentSessionId: null,
        });

        // Mock encryption - make it fast
        vi.spyOn(encryption, 'decryptData').mockResolvedValue('test-api-key');
        vi.spyOn(encryption, 'encryptData').mockResolvedValue('encrypted-value');

        // Mock model fetching - eliminate network latency
        vi.spyOn(modelService, 'fetchModels').mockResolvedValue(mockModels);

        // Mock fetch globally
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ data: mockModels }),
            text: () => Promise.resolve(''),
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Provider Mode Switching', () => {
        it('should switch from Cloud to Local mode within threshold', async () => {
            render(<App />);

            // Open settings
            const settingsBtn = screen.getByRole('button', { name: /settings/i });
            fireEvent.click(settingsBtn);

            await waitFor(() => {
                expect(screen.getByText('Cloud')).toBeDefined();
            });

            // Measure switching to Local
            const duration = await measureTime(async () => {
                const localBtn = screen.getByText('Local');
                fireEvent.click(localBtn);

                await waitFor(() => {
                    expect(useChatStore.getState().providerMode).toBe('local');
                });
            });

            console.log(`Provider mode switch (Cloud → Local): ${duration.toFixed(2)}ms`);
            expect(duration).toBeLessThan(THRESHOLDS.PROVIDER_SWITCH);
        });

        it('should switch from Local to Cloud mode within threshold', async () => {
            useChatStore.setState({ providerMode: 'local' });
            render(<App />);

            // Open settings
            const settingsBtn = screen.getByRole('button', { name: /settings/i });
            fireEvent.click(settingsBtn);

            await waitFor(() => {
                expect(screen.getByText('Local')).toBeDefined();
            });

            // Measure switching to Cloud
            const duration = await measureTime(async () => {
                const cloudBtn = screen.getByText('Cloud');
                fireEvent.click(cloudBtn);

                await waitFor(() => {
                    expect(useChatStore.getState().providerMode).toBe('cloud');
                });
            });

            console.log(`Provider mode switch (Local → Cloud): ${duration.toFixed(2)}ms`);
            expect(duration).toBeLessThan(THRESHOLDS.PROVIDER_SWITCH);
        });
    });

    describe('Cloud Provider Switching', () => {
        it('should switch between cloud providers within threshold', async () => {
            render(<App />);

            // Open settings
            const settingsBtn = screen.getByRole('button', { name: /settings/i });
            fireEvent.click(settingsBtn);

            await waitFor(() => {
                expect(screen.getByText('Provider')).toBeDefined();
            });

            const providers = ['openai', 'anthropic', 'google', 'openrouter'];
            const timings = [];

            for (const provider of providers) {
                const duration = await measureTime(async () => {
                    const providerBtn = screen.getByRole('button', { name: new RegExp(provider, 'i') });
                    fireEvent.click(providerBtn);

                    await waitFor(() => {
                        expect(useChatStore.getState().activeCloudProvider).toBe(provider);
                    });
                });

                timings.push({ provider, duration });
            }

            timings.forEach(({ provider, duration }) => {
                console.log(`Cloud provider switch to ${provider}: ${duration.toFixed(2)}ms`);
                expect(duration).toBeLessThan(THRESHOLDS.CLOUD_PROVIDER);
            });
        });
    });

    describe('Local URL Quick Setup', () => {
        it('should update URL when clicking LM Studio button within threshold', async () => {
            useChatStore.setState({ providerMode: 'local' });
            render(<App />);

            // Open settings
            const settingsBtn = screen.getByRole('button', { name: /settings/i });
            fireEvent.click(settingsBtn);

            await waitFor(() => {
                expect(screen.getByText('Local Base URL')).toBeDefined();
            });

            // Measure LM Studio button click
            const duration = await measureTime(async () => {
                const lmStudioBtn = screen.getByText('LM Studio', { selector: 'button' });
                fireEvent.click(lmStudioBtn);

                // The URL input should update immediately (before debounce)
                await waitFor(() => {
                    const input = screen.getByPlaceholderText('http://localhost:11434/v1');
                    expect(input.value).toBe('http://localhost:1234/v1');
                });
            });

            console.log(`LM Studio quick setup: ${duration.toFixed(2)}ms`);
            expect(duration).toBeLessThan(THRESHOLDS.QUICK_SETUP);
        });

        it('should update URL when clicking Ollama button within threshold', async () => {
            useChatStore.setState({
                providerMode: 'local',
                localBaseUrl: 'http://localhost:1234/v1' // Start with LM Studio URL
            });
            render(<App />);

            // Open settings
            const settingsBtn = screen.getByRole('button', { name: /settings/i });
            fireEvent.click(settingsBtn);

            await waitFor(() => {
                expect(screen.getByText('Local Base URL')).toBeDefined();
            });

            // Measure Ollama button click
            const duration = await measureTime(async () => {
                const ollamaBtn = screen.getByText('Ollama', { selector: 'button' });
                fireEvent.click(ollamaBtn);

                await waitFor(() => {
                    const input = screen.getByPlaceholderText('http://localhost:11434/v1');
                    expect(input.value).toBe('http://localhost:11434/v1');
                });
            });

            console.log(`Ollama quick setup: ${duration.toFixed(2)}ms`);
            expect(duration).toBeLessThan(THRESHOLDS.QUICK_SETUP);
        });
    });

    describe('Model Selection', () => {
        it('should update model selection within threshold', async () => {
            const duration = await measureTime(async () => {
                await act(async () => {
                    useChatStore.getState().setModel('model-2');
                });

                expect(useChatStore.getState().model).toBe('model-2');
            });

            console.log(`Model selection update: ${duration.toFixed(2)}ms`);
            expect(duration).toBeLessThan(THRESHOLDS.MODEL_SELECTION);
        });
    });

    describe('Store State Updates', () => {
        it('should update provider mode state directly within threshold', async () => {
            const duration = await measureTime(async () => {
                await act(async () => {
                    useChatStore.getState().setProviderMode('local');
                });

                expect(useChatStore.getState().providerMode).toBe('local');
            });

            console.log(`Direct providerMode state update: ${duration.toFixed(2)}ms`);
            expect(duration).toBeLessThan(THRESHOLDS.STATE_UPDATE);
        });

        it('should update local base URL state directly within threshold', async () => {
            const duration = await measureTime(async () => {
                await act(async () => {
                    useChatStore.getState().setLocalBaseUrl('http://localhost:1234/v1');
                });

                expect(useChatStore.getState().localBaseUrl).toBe('http://localhost:1234/v1');
            });

            console.log(`Direct localBaseUrl state update: ${duration.toFixed(2)}ms`);
            expect(duration).toBeLessThan(THRESHOLDS.STATE_UPDATE);
        });

        it('should update cloud provider state directly within threshold', async () => {
            const duration = await measureTime(async () => {
                await act(async () => {
                    useChatStore.getState().setActiveCloudProvider('openai');
                });

                expect(useChatStore.getState().activeCloudProvider).toBe('openai');
            });

            console.log(`Direct activeCloudProvider state update: ${duration.toFixed(2)}ms`);
            expect(duration).toBeLessThan(THRESHOLDS.STATE_UPDATE);
        });
    });

    describe('Encryption Performance', () => {
        beforeEach(() => {
            // Restore real encryption for this test
            vi.restoreAllMocks();
        });

        it('should decrypt API key within acceptable time', async () => {
            // First reset the cache to test cold start
            encryption._resetCache();

            const duration = await measureTime(async () => {
                // Mock an encrypted key structure
                const encryptedKey = JSON.stringify({ iv: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], data: [1, 2, 3] });
                await encryption.decryptData(encryptedKey);
            });

            console.log(`Decryption (cold cache): ${duration.toFixed(2)}ms`);
            // Decryption can be slower due to crypto operations
            expect(duration).toBeLessThan(100);
        });

        it('should decrypt API key faster with warm cache', async () => {
            // First call to warm the cache
            const encryptedKey = JSON.stringify({ iv: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], data: [1, 2, 3] });
            await encryption.decryptData(encryptedKey);

            // Measure with warm cache
            const duration = await measureTime(async () => {
                await encryption.decryptData(encryptedKey);
            });

            console.log(`Decryption (warm cache): ${duration.toFixed(2)}ms`);
            expect(duration).toBeLessThan(50);
        });
    });

    describe('Combined Workflow Performance', () => {
        it('should complete full provider switch workflow within acceptable time', async () => {
            render(<App />);

            const totalDuration = await measureTime(async () => {
                // 1. Open settings
                const settingsBtn = screen.getByRole('button', { name: /settings/i });
                fireEvent.click(settingsBtn);

                await waitFor(() => {
                    expect(screen.getByText('Local')).toBeDefined();
                });

                // 2. Switch to Local
                const localBtn = screen.getByText('Local');
                fireEvent.click(localBtn);

                await waitFor(() => {
                    expect(useChatStore.getState().providerMode).toBe('local');
                });

                // 3. Switch back to Cloud
                const cloudBtn = screen.getByText('Cloud');
                fireEvent.click(cloudBtn);

                await waitFor(() => {
                    expect(useChatStore.getState().providerMode).toBe('cloud');
                });
            });

            console.log(`Full provider switch workflow: ${totalDuration.toFixed(2)}ms`);
            // Full workflow should still be under 300ms with mocked network
            expect(totalDuration).toBeLessThan(300);
        });
    });
});
