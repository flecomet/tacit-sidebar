import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrapePage } from './pageScraper';

describe('pageScraper', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should query the active tab and execute a script', async () => {
        const mockTab = { id: 123, title: 'Test Page', url: 'https://example.com' };
        chrome.tabs.query.mockResolvedValue([mockTab]);
        chrome.scripting.executeScript.mockResolvedValue([{ result: 'Scraped text content' }]);

        const result = await scrapePage();

        expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
        expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
            target: { tabId: 123 },
            func: expect.any(Function),
        });

        expect(result.type).toBe('text');
        expect(result.name).toBe('Page Context: Test Page');
        expect(result.content).toContain('<page_content>');
        expect(result.content).toContain('Source: https://example.com');
        expect(result.content).toContain('Scraped text content');
    });

    it('should throw error if no active tab is found', async () => {
        chrome.tabs.query.mockResolvedValue([]);

        await expect(scrapePage()).rejects.toThrow('No active tab found');
    });

    it('should throw error if scripting fails', async () => {
        chrome.tabs.query.mockResolvedValue([{ id: 123 }]);
        chrome.scripting.executeScript.mockRejectedValue(new Error('Scripting error'));

        await expect(scrapePage()).rejects.toThrow('Scripting error');
    });
});
