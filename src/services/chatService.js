
/**
 * Unified Chat Service
 * Handles payload formatting and API calls for different providers.
 */

export const chatService = {
    /**
     * Send a chat completion request to the specified provider.
     * 
     * @param {Object} params
     * @param {string} params.provider - 'openrouter', 'openai', 'anthropic', 'google', 'local'
     * @param {string} params.baseUrl - Base API URL
     * @param {string} params.apiKey - API Key
     * @param {string} params.model - Model ID
     * @param {Array} params.messages - Array of message objects {role, content, files?}
     * @param {Object} [params.options] - Extra options (temperature, etc.)
     * @returns {Promise<Object>} - { content: string, usage: object }
     */
    async sendMessage({ provider, baseUrl, apiKey, model, messages, options = {} }) {
        console.log(`[ChatService] Sending message via ${provider} to ${model}`);

        switch (provider) {
            case 'anthropic':
                return this.sendAnthropic({ baseUrl, apiKey, model, messages, options });
            case 'google':
                return this.sendGoogle({ baseUrl, apiKey, model, messages, options });
            case 'openai':
            case 'openrouter':
            case 'local':
            default:
                return this.sendOpenAICompatible({ provider, baseUrl, apiKey, model, messages, options });
        }
    },

    // --- OpenAI / OpenRouter / Local Adapter ---
    async sendOpenAICompatible({ provider, baseUrl, apiKey, model, messages, options }) {
        const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

        // Format messages: Handle Multi-modal
        const formattedMessages = messages.map(m => {
            if (!m.files || m.files.length === 0) {
                return { role: m.role, content: m.content };
            }

            const contentParts = [{ type: 'text', text: m.content }];

            m.files.forEach(f => {
                if (f.type === 'image') {
                    contentParts.push({
                        type: 'image_url',
                        image_url: { url: f.content }
                    });
                } else {
                    // Determine format for text files
                    contentParts[0].text += `\n\n--- ${f.name} ---\n${f.content}`;
                }
            });

            // Filter out empty text blocks (unless it is the only block)
            const finalContent = contentParts.filter(part => {
                if (part.type === 'text') {
                    // Keep if text is not empty OR if it's the only part (to allow empty message if really needed, though rare)
                    return part.text.trim().length > 0 || contentParts.length === 1;
                }
                return true;
            });

            return { role: m.role, content: finalContent };
        });

        const headers = {
            "Content-Type": "application/json"
        };

        // Only add OpenRouter-specific headers for non-local requests or if explicitly OpenRouter
        if (provider !== 'local') {
            headers["HTTP-Referer"] = "https://github.com/flecomet/tacit-sidebar";
            headers["X-Title"] = "Tacit";
        }

        if (apiKey) {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }

        const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
                model: model,
                messages: formattedMessages,
                ...options
            })
        });

        if (!response.ok) {
            const errText = await response.text();

            // Special handling for Ollama 403
            if (response.status === 403 && provider === 'local') {
                throw new Error(`Ollama connection forbidden (403). Possible fix:
MacOS: Run 'launchctl setenv OLLAMA_ORIGINS "*"' in terminal, then restart Ollama app.
Windows/Linux: Run 'OLLAMA_ORIGINS="*" ollama serve'`);
            }

            throw new Error(`API Error ${response.status}: ${errText || response.statusText}`);
        }

        const text = await response.text();
        if (!text) {
            throw new Error('Empty response from API');
        }

        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new Error(`Failed to parse API response: ${text.slice(0, 100)}...`);
        }

        if (data.error) {
            throw new Error(data.error.message || 'API Error');
        }

        if (!data.choices || !data.choices[0]) {
            throw new Error('No response from AI');
        }

        let content = data.choices[0].message.content || '';
        const attachments = [];

        // Handle "Nano Banana" style images (OpenRouter specific)
        if (data.choices[0].message.images) {
            data.choices[0].message.images.forEach(img => {
                const imgUrl = img.image_url?.url || img.url;
                if (imgUrl) {
                    // Fix Duplicate Image Bug:
                    // Only append to markdown if it's NOT already there
                    if (!content.includes(imgUrl)) {
                        content += `\n\n![Generated Image](${imgUrl})`;
                    }

                    // Add to attachments for High-Res download UI
                    attachments.push({
                        type: 'image',
                        url: imgUrl,
                        name: 'generated_image.png'
                    });
                }
            });
        }

        // Fallback: Scan content for markdown images to ensure all images are in attachments
        // This handles cases where models (like Nano Banana 3 Pro with reasoning) 
        // put images directly in content but don't populate the 'images' array.
        const markdownImageRegex = /!\[.*?\]\((.*?)\)/g;
        let match;
        while ((match = markdownImageRegex.exec(content)) !== null) {
            const url = match[1];
            if (!attachments.some(a => a.url === url)) {
                attachments.push({
                    type: 'image',
                    url: url,
                    name: 'generated_image.png'
                });
            }
        }

        return {
            content: content,
            attachments: attachments,
            usage: data.usage || { total_tokens: 0 }
        };
    },

    // --- Anthropic Adapter ---
    async sendAnthropic({ baseUrl, apiKey, model, messages, options }) {
        const url = `${(baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;

        // Filter out system messages, they go to top-level parameter
        const systemMessage = messages.find(m => m.role === 'system');
        const conversationMessages = messages.filter(m => m.role !== 'system');

        // Format for Claude: 
        // content: string | [{ type: 'text', text: '...' }, { type: 'image', source: { type: 'base64', media_type, data } }]
        const formattedMessages = conversationMessages.map(m => {
            if (!m.files || m.files.length === 0) {
                return { role: m.role, content: m.content };
            }

            const contentParts = [
                { type: 'text', text: m.content }
            ];

            m.files.forEach(f => {
                if (f.type === 'image') {
                    // data:image/png;base64,.....
                    // Use 'content' which is now the Compressed/Low-Res version
                    const [meta, base64] = f.content.split(',');
                    const mediaType = meta.split(':')[1].split(';')[0];

                    contentParts.push({
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: mediaType,
                            data: base64
                        }
                    });
                } else {
                    contentParts[0].text += `\n\n--- ${f.name} ---\n${f.content}`;
                }
            });

            return { role: m.role, content: contentParts };
        });

        const headers = {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            "anthropic-dangerous-direct-browser-access": "true" // Required for browser usage
        };

        const payload = {
            model: model,
            max_tokens: 4096,
            messages: formattedMessages,
            ...options
        };

        if (systemMessage) {
            payload.system = systemMessage.content;
        }

        const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message || 'Anthropic API Error');
        }

        // Anthropic returns { content: [{ type: 'text', text: '...' }] }
        const content = data.content ? data.content.map(c => c.text).join('') : '';

        return {
            content,
            usage: {
                input_tokens: data.usage?.input_tokens || 0,
                output_tokens: data.usage?.output_tokens || 0,
                total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
            }
        };
    },

    // --- Google Gemini Adapter ---
    async sendGoogle({ baseUrl, apiKey, model, messages, options }) {
        // https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=YOUR_API_KEY

        // Default URL if not provided or custom
        const base = baseUrl || 'https://generativelanguage.googleapis.com';
        const url = `${base.replace(/\/$/, '')}/v1beta/models/${model}:generateContent?key=${apiKey}`;

        // Google Content Format: { parts: [{ text: "..." }, { inline_data: { mime_type, data } }] }
        // Roles: 'user', 'model' (instead of assistant)

        const contents = messages.map(m => {
            const role = m.role === 'assistant' ? 'model' : 'user';
            // System instructions are separate in newer API, but we might just prepend to first user message or use system_instruction if available.
            // For simplicity/compatibility, we'll assume system messages are merged or handled if we want to be fancy.
            // Actually, Google API supports `system_instruction` at top level.

            if (m.role === 'system') return null; // We'll handle system separately

            const parts = [
                { text: m.content }
            ];

            if (m.files) {
                m.files.forEach(f => {
                    if (f.type === 'image') {
                        const [meta, base64] = f.content.split(',');
                        const mimeType = meta.split(':')[1].split(';')[0];
                        parts.push({
                            inline_data: {
                                mime_type: mimeType,
                                data: base64
                            }
                        });
                    } else {
                        parts[0].text += `\n\n--- ${f.name} ---\n${f.content}`;
                    }
                });
            }

            return { role, parts };
        }).filter(Boolean);

        const systemMessage = messages.find(m => m.role === 'system');

        const payload = {
            contents: contents,
            generationConfig: {
                ...options
            }
        };

        if (systemMessage) {
            payload.system_instruction = {
                parts: [{ text: systemMessage.content }]
            };
        }

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Google API Error: ${response.status} - ${errText}`);
        }

        const data = await response.json();

        // Extract content
        // candidates[0].content.parts[0].text
        if (!data.candidates || !data.candidates[0]) {
            throw new Error('No response from Google AI');
        }

        const content = data.candidates[0].content.parts.map(p => p.text).join('') || '';

        return {
            content,
            usage: {
                total_tokens: data.usageMetadata?.totalTokenCount || 0
            }
        };
    }
};
