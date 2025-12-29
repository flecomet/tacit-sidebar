import { vi, describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';

describe('Background Script - Local CORS', () => {
    let updateLocalCORS;
    let LOCAL_RULE_ID;

    beforeAll(async () => {
        // Mock chrome API globally BEFORE importing the file
        global.chrome = {
            declarativeNetRequest: {
                updateDynamicRules: vi.fn(),
            },
            runtime: {
                onInstalled: { addListener: vi.fn() },
                onStartup: { addListener: vi.fn() },
                onMessage: { addListener: vi.fn() }
            },
            sidePanel: {
                setPanelBehavior: vi.fn().mockResolvedValue()
            }
        };

        // Dynamically import the module after mocking
        const module = await import('./index');
        updateLocalCORS = module.updateLocalCORS;
        LOCAL_RULE_ID = module.LOCAL_RULE_ID;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should register updateLocalCORS listener on install and startup', async () => {
        // Verify listeners were attached during import
        expect(global.chrome.runtime.onInstalled.addListener).toHaveBeenCalledWith(updateLocalCORS);
        expect(global.chrome.runtime.onStartup.addListener).toHaveBeenCalledWith(updateLocalCORS);

        // Test the function logic
        updateLocalCORS();

        expect(global.chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
            removeRuleIds: [LOCAL_RULE_ID],
            addRules: [
                {
                    id: LOCAL_RULE_ID,
                    priority: 1,
                    action: {
                        type: 'modifyHeaders',
                        requestHeaders: [
                            { header: 'Origin', operation: 'remove' }
                        ],
                        responseHeaders: [
                            { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
                            { header: 'Access-Control-Allow-Methods', operation: 'set', value: 'GET, POST, PUT, DELETE, OPTIONS' },
                            { header: 'Access-Control-Allow-Headers', operation: 'set', value: 'Content-Type, Authorization' }
                        ]
                    },
                    condition: {
                        urlFilter: "||localhost",
                        domains: ["match_all_urls"],
                        resourceTypes: ["xmlhttprequest"]
                    }
                }
            ]
        });
    });

    it('should not throw if declarativeNetRequest is undefined', () => {
        // Temporarily remove declarativeNetRequest
        const original = global.chrome.declarativeNetRequest;
        global.chrome.declarativeNetRequest = undefined;

        expect(() => updateLocalCORS()).not.toThrow();

        // Restore
        global.chrome.declarativeNetRequest = original;
    });
});
