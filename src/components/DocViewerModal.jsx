import React from 'react';
import { X, FileText, Download } from 'lucide-react';

export default function DocViewerModal({ file, onClose }) {
    if (!file) return null;

    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={handleBackdropClick}
        >
            <div className="bg-[#1E1F20] w-[90%] max-w-4xl h-[80%] rounded-xl border border-gray-700 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-[#191A1B]">
                    <div className="flex items-center gap-2 overflow-hidden">
                        <FileText className="text-brand-cyan shrink-0" size={20} />
                        <h2 className="font-medium text-gray-200 truncate" title={file.name}>
                            {file.name}
                        </h2>
                        <span className="text-xs text-gray-500 shrink-0 ml-2">
                            {(file.content.length / 1024).toFixed(1)} KB
                        </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {/* Download/Copy could go here */}
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-0 bg-[#131314]">
                    {file.type === 'image' ? (
                        <div className="w-full h-full flex items-center justify-center p-4">
                            <img src={file.content} alt={file.name} className="max-w-full max-h-full object-contain" />
                        </div>
                    ) : (
                        <pre className="p-4 font-mono text-xs md:text-sm text-gray-300 whitespace-pre-wrap break-words">
                            {file.content}
                        </pre>
                    )}
                </div>
            </div>
        </div>
    );
}
