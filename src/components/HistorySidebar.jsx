import React from 'react';
import { MessageSquare, Trash2, X, Plus } from 'lucide-react';
import { useChatStore } from '../store/useChatStore';

export default function HistorySidebar({ isOpen, onClose }) {
    const {
        sessions,
        currentSessionId,
        restoreSession,
        deleteSession,
        createNewChat
    } = useChatStore();

    if (!isOpen) return null;

    // Sort by Date DESC
    const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

    const handleSelect = (id) => {
        restoreSession(id);
        onClose();
    };

    const handleDelete = (e, id) => {
        e.stopPropagation();
        if (confirm('Delete this chat?')) {
            deleteSession(id);
        }
    };

    const handleNew = () => {
        createNewChat();
        onClose();
    };

    return (
        <div className="fixed inset-y-0 left-0 w-64 bg-[#191A1B] border-r border-gray-700 shadow-2xl z-40 flex flex-col animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between p-4 border-b border-gray-800">
                <h2 className="font-bold text-gray-200">History</h2>
                <button onClick={onClose} className="hover:text-gray-400">
                    <X size={20} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                <button
                    onClick={handleNew}
                    className="w-full flex items-center gap-2 p-3 bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/20 rounded-lg transition-colors border border-brand-cyan/20 mb-4"
                >
                    <Plus size={18} />
                    <span className="text-sm font-medium">New Chat</span>
                </button>

                {sortedSessions.length === 0 && (
                    <div className="text-center text-gray-500 text-xs mt-10">
                        No previous chats.
                    </div>
                )}

                {sortedSessions.map(session => (
                    <div
                        key={session.id}
                        onClick={() => handleSelect(session.id)}
                        className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors border border-transparent ${session.id === currentSessionId
                            ? 'bg-white/10 border-white/10'
                            : 'hover:bg-white/5 border-transparent'
                            }`}
                    >
                        <div className="flex items-center gap-3 overflow-hidden">
                            <MessageSquare size={16} className={session.id === currentSessionId ? 'text-brand-cyan' : 'text-gray-500'} />
                            <div className="flex flex-col overflow-hidden">
                                <span className="text-sm text-gray-200 truncate font-medium">
                                    {session.title || 'Untitled Chat'}
                                </span>
                                <span className="text-xs text-gray-500 truncate">
                                    {new Date(session.updatedAt).toLocaleDateString()}
                                </span>
                            </div>
                        </div>
                        <button
                            onClick={(e) => handleDelete(e, session.id)}
                            className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
