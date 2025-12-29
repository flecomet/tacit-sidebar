import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processFile } from './fileProcessor';
import * as pdfjsLib from 'pdfjs-dist';

// Mock pdfjs-dist
vi.mock('pdfjs-dist', () => ({
    GlobalWorkerOptions: {
        workerSrc: '',
    },
    version: 'mock-version',
    getDocument: vi.fn(),
}));

describe('fileProcessor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should process text files correctly', async () => {
        const file = new File(['Hello World'], 'test.txt', { type: 'text/plain' });
        const result = await processFile(file);

        expect(result.type).toBe('text');
        expect(result.name).toBe('test.txt');
        expect(result.content).toContain('--- BEGIN FILE: test.txt ---');
        expect(result.content).toContain('Hello World');
        expect(result.content).toContain('--- END FILE ---');
    });

    it('should process markdown files correctly', async () => {
        const file = new File(['# Title'], 'test.md', { type: '' }); // Type might be empty for some extensions
        const result = await processFile(file);

        expect(result.name).toBe('test.md');
        expect(result.content).toContain('# Title');
    });

    it('should process PDF files correctly using mocked pdfjs', async () => {
        const mockPdf = {
            numPages: 1,
            getPage: vi.fn().mockResolvedValue({
                getTextContent: vi.fn().mockResolvedValue({
                    items: [{ str: 'PDF Content' }],
                }),
            }),
        };
        pdfjsLib.getDocument.mockReturnValue({
            promise: Promise.resolve(mockPdf),
        });

        const file = new File(['mock binary'], 'test.pdf', { type: 'application/pdf' });
        const result = await processFile(file);

        expect(result.type).toBe('text');
        expect(result.name).toBe('test.pdf');
        expect(result.content).toContain('[Page 1]');
        expect(result.content).toContain('PDF Content');
    });

    it('should throw an error for unsupported file types', async () => {
        const file = new File(['raw binary'], 'test.bin', { type: 'application/octet-stream' });

        await expect(processFile(file)).rejects.toThrow('Unsupported file type');
    });
});
