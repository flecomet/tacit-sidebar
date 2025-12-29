// Background Service Worker

// Validates side panel opening on action click (Chrome 116+)
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => console.error(error));
}

// Handle messages from Side Panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // No handlers currently active
});

// Export for testing
export const LOCAL_RULE_ID = 1;

export function updateLocalCORS() {
    // Only attempt if the API is available (requires manifest permissions)
    if (chrome.declarativeNetRequest) {
        chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [LOCAL_RULE_ID], // Clear old rules first
            addRules: [
                {
                    id: LOCAL_RULE_ID,
                    priority: 1,
                    action: {
                        type: 'modifyHeaders',
                        requestHeaders: [
                            // Strip Origin so Ollama/LM Studio thinks it's a direct CLI/Script request
                            { header: 'Origin', operation: 'remove' }
                        ],
                        responseHeaders: [
                            // Inject CORS headers so Chrome accepts the response
                            { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
                            { header: 'Access-Control-Allow-Methods', operation: 'set', value: 'GET, POST, PUT, DELETE, OPTIONS' },
                            { header: 'Access-Control-Allow-Headers', operation: 'set', value: 'Content-Type, Authorization' }
                        ]
                    },
                    condition: {
                        // Apply to Ollama (11434) and LM Studio (1234)
                        urlFilter: "||localhost",
                        domains: ["match_all_urls"],
                        urlFilter: "||localhost",
                        resourceTypes: ["xmlhttprequest"]
                    }
                }
            ]
        });
    }
}

// Apply rules on installation and startup
chrome.runtime.onInstalled.addListener(updateLocalCORS);
chrome.runtime.onStartup.addListener(updateLocalCORS);
