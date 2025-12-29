/**
 * title: Client-Side File Processor (No Server Required)
 * filepath: src/utils/fileProcessor.js
 */

import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker for PDF.js to use the local asset
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.js');
}

export const processFile = async (file) => {
    const fileType = file.type;
    const fileName = file.name;

    try {
        let content = "";

        // 1. Handle Images (Vision model support)
        if (fileType.startsWith('image/')) {
            content = await readFileAsBase64(file);
            return {
                type: 'image',
                name: fileName,
                content: content
            };
        }

        // 2. Handle PDF
        if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
            content = await readPdfToText(file);
        }
        // 3. Handle Text/Code (JSON, JS, TXT, MD, TS, PY, etc.)
        else if (
            fileType.startsWith('text/') ||
            fileName.endsWith('.json') ||
            fileName.endsWith('.js') ||
            fileName.endsWith('.ts') ||
            fileName.endsWith('.md') ||
            fileName.endsWith('.py') ||
            fileName.endsWith('.txt')
        ) {
            content = await readFileAsText(file);
        }
        else {
            throw new Error(`Unsupported file type: ${fileType || 'unknown'}`);
        }

        return {
            type: 'text',
            name: fileName,
            content: `--- BEGIN FILE: ${fileName} ---\n${content}\n--- END FILE ---`
        };

    } catch (error) {
        console.error("File processing failed:", error);
        throw error;
    }
};

const readFileAsText = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Failed to read text file"));
        reader.readAsText(file);
    });
};

const readFileAsBase64 = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Failed to read image file"));
        reader.readAsDataURL(file);
    });
};

const readPdfToText = async (file) => {
    const arrayBuffer = await readFileAsArrayBuffer(file);
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += `[Page ${i}]\n${pageText}\n\n`;
    }

    return fullText;
};

const readFileAsArrayBuffer = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Failed to read file as ArrayBuffer"));
        reader.readAsArrayBuffer(file);
    });
};
