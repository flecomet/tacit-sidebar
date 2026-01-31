import React, { useEffect, useRef, useState } from 'react';
import { FileText, Download, Image as ImageIcon, Copy, Check, Bookmark } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { usePromptsStore } from '../store/usePromptsStore';

const CopyButton = ({ text, className, iconSize = 14, label = "Copy" }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async (e) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    return (
        <button
            onClick={handleCopy}
            className={`p-1.5 hover:bg-white/10 rounded-md transition-colors text-gray-400 hover:text-white ${className}`}
            title="Copy to clipboard"
            aria-label={label}
        >
            {copied ? <Check size={iconSize} className="text-green-400" /> : <Copy size={iconSize} />}
        </button>
    );
};

const SavePromptButton = ({ text, className, iconSize = 14 }) => {
    const [saved, setSaved] = useState(false);
    const { addPrompt } = usePromptsStore();

    const handleSave = async (e) => {
        e.stopPropagation();
        try {
            addPrompt(text);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (err) {
            console.error('Failed to save prompt:', err);
        }
    };

    return (
        <button
            onClick={handleSave}
            className={`p-1.5 hover:bg-white/10 rounded-md transition-colors text-gray-400 hover:text-white ${className}`}
            title="Save as prompt"
            aria-label={saved ? 'Prompt saved' : 'Save as prompt'}
        >
            {saved ? <Check size={iconSize} className="text-green-400" /> : <Bookmark size={iconSize} />}
        </button>
    );
};

export default function MessageList({ messages, isLoading, onViewFile }) {
    const containerRef = useRef(null);

    // Auto-scroll to bottom
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTo({
                top: containerRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [messages, isLoading]);

    if (messages.length === 0 && !isLoading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 p-4 text-center">
                <p className="mb-2 font-medium text-gray-400">No messages yet.</p>
                <p className="text-sm">Drag & drop a file, start typing, or add page content to context.</p>
                <p className="mt-4 text-[11px] opacity-60 font-mono">Toggle with Alt + J</p>
            </div>
        );
    }

    return (
        <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-5">
            {messages.map((m, i) => (
                <div key={i} className={`group flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>

                    {/* Copy & Save Buttons for User (Left side) */}
                    {m.role === 'user' && (
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity self-center mr-2 shrink-0 flex flex-col gap-1">
                            <CopyButton text={m.content} label="Copy message" />
                            <SavePromptButton text={m.content} />
                        </div>
                    )}

                    <div
                        className={`max-w-[88%] p-3.5 rounded-2xl text-[13px] leading-relaxed shadow-sm transition-all duration-200 ${m.role === 'user'
                            ? 'bg-brand-cyan/10 text-white border border-brand-cyan/20 rounded-tr-none' // User bubble
                            : m.role === 'assistant'
                                ? 'bg-brand-card text-gray-200 border border-brand-border rounded-tl-none' // Assistant bubble
                                : 'bg-red-500/10 text-red-200 border border-red-500/20 mx-auto w-full max-w-[95%] text-center italic' // System/Error bubble
                            }`}
                    >
                        {m.files && m.files.length > 0 && (
                            <div className="mb-3 flex flex-wrap gap-2">
                                {m.files.map((f, idx) => (
                                    <div
                                        key={idx}
                                        onClick={() => onViewFile && onViewFile(f)}
                                        className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-all border ${m.role === 'user'
                                            ? 'bg-white/10 border-white/10 hover:bg-white/20 text-white'
                                            : 'bg-brand-input border-brand-border hover:bg-brand-border text-gray-300'
                                            }`}
                                        title="View content"
                                    >
                                        <FileText size={12} className={m.role === 'user' ? 'text-brand-cyan' : 'text-gray-400'} />
                                        <span className="truncate max-w-[150px]">{f.name}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="prose prose-invert prose-sm max-w-none break-words prose-p:leading-relaxed prose-pre:bg-black/40 prose-pre:border prose-pre:border-brand-border">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[
                                    [rehypeSanitize, {
                                        ...defaultSchema,
                                        attributes: {
                                            ...defaultSchema.attributes,
                                            img: [
                                                ['src', /^(https?:\/\/|data:image\/)/],
                                                'alt',
                                                'title',
                                                'width',
                                                'height'
                                            ]
                                        },
                                        protocols: {
                                            ...defaultSchema.protocols,
                                            src: ['http', 'https', 'data', 'blob']
                                        }
                                    }]
                                ]}
                                urlTransform={(url) => url}
                                components={{
                                    code({ node, inline, className, children, ...props }) {
                                        const match = /language-(\w+)/.exec(className || '')
                                        return !inline && match ? (
                                            <div className="my-3 border border-brand-border rounded-lg bg-black/40 overflow-hidden relative group/code shadow-inner">
                                                <div className="absolute top-2 right-2 z-10 opacity-0 group-hover/code:opacity-100 transition-opacity flex items-center gap-2 bg-brand-card/90 backdrop-blur-md border border-brand-border/50 rounded-md p-0.5 shadow-sm">
                                                    <div className="text-[10px] uppercase text-gray-500 font-bold px-1.5 select-none">
                                                        {match[1]}
                                                    </div>
                                                    <div className="w-[1px] h-3 bg-brand-border/50"></div>
                                                    <CopyButton text={String(children).replace(/\n$/, '')} label="Copy code" className="!p-1" />
                                                </div>
                                                <div className="overflow-x-auto p-3 pt-4">
                                                    <code className={`${className} block min-w-max`} {...props}>
                                                        {children}
                                                    </code>
                                                </div>
                                            </div>
                                        ) : (
                                            <code className="bg-white/10 rounded px-1.5 py-0.5 text-[11px] font-mono text-brand-cyan/90" {...props}>
                                                {children}
                                            </code>
                                        )
                                    },
                                    p: ({ node, ...props }) => <p className="mb-2.5 last:mb-0" {...props} />,
                                    a: ({ node, ...props }) => <a className="text-brand-cyan hover:underline decoration-brand-cyan/30 underline-offset-4" target="_blank" rel="noopener noreferrer" {...props} />,
                                    ul: ({ node, ...props }) => <ul className="list-disc list-outside mb-2.5 ml-4 space-y-1" {...props} />,
                                    ol: ({ node, ...props }) => <ol className="list-decimal list-outside mb-2.5 ml-4 space-y-1" {...props} />,
                                    li: ({ node, ...props }) => <li className="pl-1" {...props} />,
                                    h1: ({ node, ...props }) => <h1 className="text-base font-bold mb-3 text-white" {...props} />,
                                    h2: ({ node, ...props }) => <h2 className="text-sm font-bold mb-2 text-white" {...props} />,
                                    h3: ({ node, ...props }) => <h3 className="text-xs font-bold mb-1 text-white" {...props} />,
                                    blockquote: ({ node, ...props }) => <blockquote className="border-l-2 border-brand-cyan/30 pl-3 italic text-gray-400 my-2" {...props} />,
                                }}
                            >
                                {m.content}
                            </ReactMarkdown>
                        </div>

                        {/* Attachments Section (Generated Images) */}
                        {m.attachments && m.attachments.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                                {m.attachments.map((att, idx) => (
                                    <div key={idx} className="flex items-center gap-2 bg-black/40 border border-brand-border rounded-md pl-2 pr-1 py-1 text-xs">
                                        <div
                                            className="flex items-center gap-1.5 text-gray-300 cursor-pointer hover:text-white"
                                            onClick={() => onViewFile && onViewFile(att)}
                                        >
                                            {att.type === 'image' ? <ImageIcon size={14} className="text-brand-cyan" /> : <FileText size={14} className="text-gray-500" />}
                                            <span className="truncate max-w-[150px]">{att.name || `Image ${idx + 1}`}</span>
                                        </div>
                                        <div className="h-3 w-[1px] bg-white/10 mx-1"></div>
                                        <a
                                            href={att.url || att.content}
                                            download={att.name || `generated_${idx}.png`}
                                            className="p-1 hover:bg-white/10 rounded-md text-gray-400 hover:text-white transition-colors"
                                            title="Download High-Res"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <Download size={14} />
                                        </a>
                                    </div>
                                ))}
                            </div>
                        )}
                        {m.role === 'assistant' && m.metadata && (
                            <div className="mt-3 pt-2.5 border-t border-brand-border/40 flex items-center gap-3 text-[10px] text-gray-500 font-mono opacity-80">
                                {m.metadata.tokens > 0 && (
                                    <span className="flex items-center gap-0.5">
                                        <span className="opacity-50">tokens:</span> {m.metadata.tokens}
                                    </span>
                                )}
                                {m.metadata.latency > 0 && (
                                    <span className="flex items-center gap-0.5">
                                        <span className="opacity-50">time:</span> {(m.metadata.latency / 1000).toFixed(1)}s
                                    </span>
                                )}
                                {m.metadata.cost > 0 && (
                                    <span className="flex items-center gap-0.5 text-brand-cyan/70">
                                        <span className="opacity-50">cost:</span> ${m.metadata.cost.toFixed(6)}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Copy Button for Assistant (Right side) */}
                    {m.role === 'assistant' && (
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity self-center ml-2 shrink-0">
                            <CopyButton text={m.content} label="Copy message" />
                        </div>
                    )}
                </div>
            ))}

            {isLoading && (
                <div className="flex justify-start" aria-label="Thinking...">
                    <div className="px-4 py-3 bg-brand-card border border-brand-border rounded-2xl rounded-tl-none ml-2 shadow-sm">
                        <span className="sr-only">Thinking...</span>
                        <div className="flex gap-1.5 items-center">
                            <div className="w-1.5 h-1.5 bg-brand-cyan/60 rounded-full animate-bounce [animation-duration:0.8s] [animation-delay:-0.3s]"></div>
                            <div className="w-1.5 h-1.5 bg-brand-cyan/60 rounded-full animate-bounce [animation-duration:0.8s] [animation-delay:-0.15s]"></div>
                            <div className="w-1.5 h-1.5 bg-brand-cyan/60 rounded-full animate-bounce [animation-duration:0.8s]"></div>
                        </div>
                    </div>
                </div>
            )}

            <div className="h-4" />
        </div>
    );
}
