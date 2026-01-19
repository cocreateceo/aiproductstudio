/**
 * Chat Widget - Shared Component
 * Used across: index.html, apply.html, admin.html
 *
 * Features:
 * - Voice Input (Web Speech API)
 * - Screenshot Capture (html2canvas)
 * - Token Usage Tracking
 * - Markdown Rendering
 * - Clear Chat
 * - Resizable Sidebar
 * - Form Data Extraction (for apply page)
 *
 * Usage:
 *   const chat = new ChatWidget({
 *     welcomeMessage: 'Hello!',
 *     title: 'AI Assistant',
 *     subtitle: 'Online',
 *     pageType: 'landing', // 'landing' | 'apply' | 'admin'
 *     startOpen: true,
 *     onFormData: (data) => { ... } // callback for form data
 *   });
 */

class ChatWidget {
    constructor(options = {}) {
        // Configuration
        this.config = {
            welcomeMessage: options.welcomeMessage || "Hi there! 👋 How can I help you today?",
            title: options.title || 'AI Assistant',
            subtitle: options.subtitle || 'Online - Ready to help',
            pageType: options.pageType || 'landing',
            startOpen: options.startOpen !== false,
            apiUrl: this.detectApiUrl(),
            onFormData: options.onFormData || null,
            containerId: options.containerId || 'chat-widget-container',
            storageKey: 'aiProductStudio_chat',
            iframeMode: options.iframeMode || false,
            getPageContext: options.getPageContext || null
        };

        // Page context for iframe mode
        this.pageContext = {
            page: 'unknown',
            title: document.title,
            url: window.location.href
        };

        // Load persisted state or use defaults
        const savedState = this.loadState();

        // State
        this.state = {
            messages: savedState.messages || [],
            visitorInfo: savedState.visitorInfo || {},
            isOpen: savedState.isOpen !== undefined ? savedState.isOpen : this.config.startOpen,
            isLoading: false,
            screenshot: null,
            tokenUsage: savedState.tokenUsage || { total: 0, cost: 0, requests: 0 },
            sessionId: savedState.sessionId || null
        };

        // Elements (will be set after render)
        this.elements = {};

        // Voice recognition
        this.recognition = null;
        this.isListening = false;
        this.hasSpeechSupport = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

        // Initialize
        this.render();
        this.bindElements();
        this.bindEvents();
        this.initVoice();
        this.updateLayoutOffset();
        window.addEventListener('resize', () => this.updateLayoutOffset());

        // Restore messages or show welcome
        if (this.state.messages.length > 0) {
            console.log('[ChatWidget] Restoring', this.state.messages.length, 'messages from localStorage');
            this.restoreMessages();
        } else {
            console.log('[ChatWidget] No saved messages, showing welcome');
            setTimeout(() => {
                this.addMessage('assistant', this.config.welcomeMessage);
            }, 300);
        }
    }

    // Persistence methods
    loadState() {
        try {
            const saved = localStorage.getItem(this.config.storageKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                // Check if session is still valid (24 hours)
                if (parsed.timestamp && Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
                    return parsed;
                }
            }
        } catch (e) {
            console.warn('Failed to load chat state:', e);
        }
        return {};
    }

    saveState() {
        try {
            const stateToSave = {
                messages: this.state.messages,
                visitorInfo: this.state.visitorInfo,
                isOpen: this.state.isOpen,
                tokenUsage: this.state.tokenUsage,
                sessionId: this.state.sessionId,
                timestamp: Date.now()
            };
            localStorage.setItem(this.config.storageKey, JSON.stringify(stateToSave));
        } catch (e) {
            console.warn('Failed to save chat state:', e);
        }
    }

    restoreMessages() {
        this.state.messages.forEach(msg => {
            const msgDiv = document.createElement('div');
            msgDiv.className = `chat-message ${msg.role}`;
            if (msg.role === 'assistant') {
                msgDiv.innerHTML = this.parseMarkdown(msg.content);
            } else {
                msgDiv.textContent = msg.content;
            }
            this.elements.messages.appendChild(msgDiv);
        });
        this.elements.messages.scrollTop = this.elements.messages.scrollHeight;

        // Update token display if we have usage data
        if (this.state.tokenUsage.requests > 0) {
            this.elements.tokenCount.textContent = this.formatNumber(this.state.tokenUsage.total);
            this.elements.requestCount.textContent = this.state.tokenUsage.requests;
            this.elements.tokenCost.textContent = this.formatCost(this.state.tokenUsage.cost);
            this.elements.tokenDisplay.style.display = 'flex';
        }
    }

    detectApiUrl() {
        // Use centralized configuration if available
        if (window.AppConfig && window.AppConfig.api) {
            return window.AppConfig.api.chat;
        }
        // Fallback for pages without config.js
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        return isLocal
            ? `http://localhost:5000/api/chat`
            : 'https://bx0ywfkona.execute-api.ap-south-1.amazonaws.com/prod/chat';
    }

    render() {
        const container = document.getElementById(this.config.containerId) || document.body;

        const html = `
            <!-- Chat Sidebar -->
            <div id="chat-sidebar" class="chat-sidebar ${this.state.isOpen ? 'open' : ''}">
                <div id="chat-resize-handle" class="chat-resize-handle"></div>
                <div class="chat-header">
                    <div class="chat-header-info">
                        <div class="chat-avatar"></div>
                        <div>
                            <h3>${this.config.title}</h3>
                            <p class="chat-status">${this.config.subtitle}</p>
                        </div>
                    </div>
                    <div class="chat-header-actions">
                        <button id="chat-screenshot-toggle" class="chat-screenshot" aria-label="Attach screenshot" title="Include screenshot">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                <circle cx="8.5" cy="8.5" r="1.5"/>
                                <polyline points="21 15 16 10 5 21"/>
                            </svg>
                        </button>
                        <button id="chat-clear" class="chat-clear" aria-label="Clear chat" title="Clear conversation">Clear</button>
                        <button id="chat-close" class="chat-close" aria-label="Close chat">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 6L6 18M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div id="chat-messages" class="chat-messages"></div>
                <div id="chat-token-display" class="chat-token-display" style="display: none;">
                    <div class="token-stats">
                        <span>Tokens: <span id="token-count">0</span></span>
                        <span>Requests: <span id="request-count">0</span></span>
                    </div>
                    <span class="token-cost">$<span id="token-cost">0.00</span></span>
                </div>
                <div class="chat-input-area">
                    <div id="chat-screenshot-preview" class="chat-screenshot-preview">
                        <img id="screenshot-preview-img" src="" alt="Screenshot preview"/>
                        <div class="preview-actions">
                            <span>📷 Screenshot attached</span>
                            <button id="remove-screenshot" class="remove-screenshot">Remove</button>
                        </div>
                    </div>
                    <div class="chat-input-row">
                        <textarea id="chat-input" placeholder="Type your message... (Shift+Enter for new line)" rows="1"></textarea>
                        <button id="chat-voice" class="chat-voice ${!this.hasSpeechSupport ? 'hidden' : ''}" aria-label="Voice input" title="Click to speak">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                                <line x1="12" y1="19" x2="12" y2="23"/>
                                <line x1="8" y1="23" x2="16" y2="23"/>
                            </svg>
                        </button>
                        <button id="chat-send" class="chat-send" aria-label="Send message">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Chat Toggle Button -->
            <button id="chat-toggle" class="chat-toggle ${this.state.isOpen ? 'hidden' : ''}" aria-label="Open chat">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span id="chat-badge" class="chat-badge" style="display: none">1</span>
            </button>
        `;

        // Insert HTML
        const wrapper = document.createElement('div');
        wrapper.id = 'chat-widget';
        wrapper.innerHTML = html;
        container.appendChild(wrapper);
    }

    bindElements() {
        this.elements = {
            sidebar: document.getElementById('chat-sidebar'),
            messages: document.getElementById('chat-messages'),
            input: document.getElementById('chat-input'),
            send: document.getElementById('chat-send'),
            close: document.getElementById('chat-close'),
            toggle: document.getElementById('chat-toggle'),
            clear: document.getElementById('chat-clear'),
            voice: document.getElementById('chat-voice'),
            resizeHandle: document.getElementById('chat-resize-handle'),
            screenshotToggle: document.getElementById('chat-screenshot-toggle'),
            screenshotPreview: document.getElementById('chat-screenshot-preview'),
            screenshotImg: document.getElementById('screenshot-preview-img'),
            removeScreenshot: document.getElementById('remove-screenshot'),
            tokenDisplay: document.getElementById('chat-token-display'),
            tokenCount: document.getElementById('token-count'),
            requestCount: document.getElementById('request-count'),
            tokenCost: document.getElementById('token-cost'),
            avatar: document.querySelector('.chat-avatar')
        };
    }

    bindEvents() {
        // Send message
        this.elements.send.addEventListener('click', () => this.sendMessage());
        this.elements.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Toggle chat
        this.elements.close.addEventListener('click', () => this.toggle());
        this.elements.toggle.addEventListener('click', () => this.toggle());

        // Clear chat
        this.elements.clear.addEventListener('click', () => this.clearChat());

        // Voice input
        this.elements.voice.addEventListener('click', () => this.toggleVoice());

        // Screenshot
        this.elements.screenshotToggle.addEventListener('click', () => this.captureScreenshot());
        this.elements.removeScreenshot.addEventListener('click', () => this.removeScreenshot());

        // Auto-resize textarea
        this.elements.input.addEventListener('input', () => this.autoResizeTextarea());

        // Resize sidebar
        this.initResize();
    }

    initResize() {
        let isResizing = false;
        let startX, startWidth;

        this.elements.resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = this.elements.sidebar.offsetWidth;
            this.elements.resizeHandle.classList.add('dragging');
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const diff = startX - e.clientX;
            const newWidth = Math.min(600, Math.max(300, startWidth + diff));
            this.elements.sidebar.style.width = newWidth + 'px';
            this.updateLayoutOffset();
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                this.elements.resizeHandle.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                this.updateLayoutOffset();
            }
        });
    }

    initVoice() {
        if (!this.hasSpeechSupport) return;

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event) => {
            const transcript = Array.from(event.results)
                .map(result => result[0].transcript)
                .join('');
            this.elements.input.value = transcript;
            this.autoResizeTextarea();
        };

        this.recognition.onend = () => {
            this.isListening = false;
            this.elements.voice.classList.remove('listening');
            this.elements.input.classList.remove('listening');
        };

        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            this.isListening = false;
            this.elements.voice.classList.remove('listening');
            this.elements.input.classList.remove('listening');
            this.showVoiceError(
                event.error === 'not-allowed' ? 'Microphone access denied' :
                event.error === 'no-speech' ? 'No speech detected' :
                `Error: ${event.error}`
            );
        };
    }

    toggleVoice() {
        if (!this.recognition) return;

        if (this.isListening) {
            this.recognition.stop();
            this.isListening = false;
            this.elements.voice.classList.remove('listening');
            this.elements.input.classList.remove('listening');
        } else {
            this.recognition.start();
            this.isListening = true;
            this.elements.voice.classList.add('listening');
            this.elements.input.classList.add('listening');
        }
    }

    showVoiceError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'voice-error';
        errorDiv.textContent = message;
        this.elements.voice.style.position = 'relative';
        this.elements.voice.appendChild(errorDiv);
        setTimeout(() => errorDiv.remove(), 3000);
    }

    async captureScreenshot() {
        if (typeof html2canvas === 'undefined') {
            console.error('html2canvas not loaded');
            return;
        }

        try {
            // Hide chat temporarily
            const originalRight = this.elements.sidebar.style.right;
            this.elements.sidebar.style.right = '-9999px';
            this.elements.toggle.style.display = 'none';

            const canvas = await html2canvas(document.body, {
                scale: 0.5,
                useCORS: true,
                logging: false,
                backgroundColor: '#000000',
                ignoreElements: (el) => el.id === 'chat-widget' || el.id === 'chat-sidebar' || el.id === 'chat-toggle'
            });

            // Restore chat
            this.elements.sidebar.style.right = originalRight;
            this.elements.toggle.style.display = '';

            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            this.state.screenshot = dataUrl;

            // Show preview
            this.elements.screenshotImg.src = dataUrl;
            this.elements.screenshotPreview.classList.add('visible');
            this.elements.screenshotToggle.classList.add('active');

            const sizeKB = Math.round((dataUrl.length * 3/4) / 1024);
            console.log(`Screenshot captured: ${canvas.width}x${canvas.height}, ~${sizeKB}KB`);
        } catch (error) {
            console.error('Screenshot capture error:', error);
        }
    }

    removeScreenshot() {
        this.state.screenshot = null;
        this.elements.screenshotPreview.classList.remove('visible');
        this.elements.screenshotToggle.classList.remove('active');
    }

    autoResizeTextarea() {
        this.elements.input.style.height = 'auto';
        this.elements.input.style.height = Math.min(this.elements.input.scrollHeight, 120) + 'px';
    }

    toggle() {
        this.state.isOpen = !this.state.isOpen;
        this.elements.sidebar.classList.toggle('open', this.state.isOpen);
        this.elements.toggle.classList.toggle('hidden', this.state.isOpen);
        this.updateLayoutOffset();
        this.saveState(); // Persist open/close state
        if (this.state.isOpen) {
            this.elements.input.focus();
        }
    }

    open() {
        if (!this.state.isOpen) this.toggle();
    }

    close() {
        if (this.state.isOpen) this.toggle();
    }

    updateLayoutOffset() {
        const sidebar = this.elements.sidebar;
        if (!sidebar) return;
        const offset = this.state.isOpen ? sidebar.offsetWidth : 0;
        document.documentElement.style.setProperty('--chat-offset', `${offset}px`);
    }

    clearChat() {
        this.elements.messages.innerHTML = '';
        this.state.messages = [];
        this.state.tokenUsage = { total: 0, cost: 0, requests: 0 };
        this.state.sessionId = null; // Reset session
        this.elements.tokenDisplay.style.display = 'none';
        this.removeScreenshot();
        this.saveState(); // Persist cleared state

        // Re-add welcome message
        setTimeout(() => {
            this.addMessage('assistant', this.config.welcomeMessage);
        }, 100);
    }

    addMessage(role, content) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${role}`;

        if (role === 'assistant') {
            msgDiv.innerHTML = this.parseMarkdown(content);
        } else {
            msgDiv.textContent = content;
        }

        this.elements.messages.appendChild(msgDiv);
        this.elements.messages.scrollTop = this.elements.messages.scrollHeight;

        if (role !== 'system') {
            this.state.messages.push({ role, content });
            this.saveState(); // Persist after each message
        }
    }

    showTyping() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'chat-typing';
        typingDiv.id = 'typing-indicator';
        typingDiv.innerHTML = '<span></span><span></span><span></span>';
        this.elements.messages.appendChild(typingDiv);
        this.elements.messages.scrollTop = this.elements.messages.scrollHeight;

        // Add thinking animation to avatar
        if (this.elements.avatar) {
            this.elements.avatar.classList.add('thinking');
        }
    }

    hideTyping() {
        const typing = document.getElementById('typing-indicator');
        if (typing) typing.remove();

        // Remove thinking animation from avatar
        if (this.elements.avatar) {
            this.elements.avatar.classList.remove('thinking');
        }
    }

    async sendMessage(customContent = null) {
        const content = customContent || this.elements.input.value.trim();
        if (!content || this.state.isLoading) return;

        // Add user message
        this.addMessage('user', content);
        this.elements.input.value = '';
        this.elements.input.style.height = 'auto';
        this.state.isLoading = true;
        this.elements.send.disabled = true;

        this.showTyping();

        try {
            // Get current page context
            const currentPageContext = this.getPageContext();

            const requestBody = {
                messages: this.state.messages,
                visitorInfo: this.state.visitorInfo,
                page: currentPageContext.url || window.location.href,
                pageContext: {
                    ...currentPageContext,
                    currentPage: currentPageContext.pageName || currentPageContext.page,
                    userLocation: `The user is currently on the "${currentPageContext.pageName || currentPageContext.title}" page of the website.`
                },
                sessionId: this.state.sessionId
            };

            // Include screenshot if attached
            if (this.state.screenshot) {
                requestBody.screenshot = this.state.screenshot;
                this.removeScreenshot();
            }

            // Log the request for debugging
            console.log('=== CHAT REQUEST DEBUG ===');
            console.log('API URL:', this.config.apiUrl);
            console.log('Page Context:', JSON.stringify(requestBody.pageContext, null, 2));
            console.log('Full Request Body:', JSON.stringify(requestBody, null, 2));
            console.log('=== END DEBUG ===');

            const response = await fetch(this.config.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();
            this.hideTyping();

            if (data.success && data.response) {
                // Check for form data in response
                const { cleanResponse, formData } = this.extractFormData(data.response);

                this.addMessage('assistant', cleanResponse);

                // Update session ID
                if (data.sessionId) {
                    this.state.sessionId = data.sessionId;
                }

                // Update visitor info
                if (data.visitorInfo) {
                    this.state.visitorInfo = { ...this.state.visitorInfo, ...data.visitorInfo };
                }

                // Update token usage
                if (data.usage) {
                    this.updateTokenUsage(data.usage);
                }

                // Save state after successful response
                this.saveState();

                // Callback for form data
                if (formData && this.config.onFormData) {
                    this.config.onFormData(formData);
                }
            } else {
                const email = window.AppConfig?.contact?.supportEmail || 'support@sunwaretechnologies.com';
                this.addMessage('assistant', `Sorry, I'm having trouble connecting. Please try again or email us at ${email}`);
            }
        } catch (error) {
            console.error('Chat error:', error);
            this.hideTyping();
            const email = window.AppConfig?.contact?.supportEmail || 'support@sunwaretechnologies.com';
            this.addMessage('assistant', `Sorry, I'm having trouble connecting. Please try again or email us at ${email}`);
        } finally {
            this.state.isLoading = false;
            this.elements.send.disabled = false;
            this.elements.input.focus();
        }
    }

    extractFormData(response) {
        const formDataMatch = response.match(/\|\|\|FORM_DATA\|\|\|([\s\S]*?)\|\|\|END_FORM\|\|\|/);
        if (formDataMatch) {
            try {
                const formData = JSON.parse(formDataMatch[1]);
                const cleanResponse = response.replace(/\|\|\|FORM_DATA\|\|\|[\s\S]*?\|\|\|END_FORM\|\|\|/, '').trim();
                return { cleanResponse, formData };
            } catch (e) {
                console.error('Failed to parse form data:', e);
            }
        }
        return { cleanResponse: response, formData: null };
    }

    updateTokenUsage(usage) {
        if (!usage) return;

        this.state.tokenUsage.total += usage.totalTokens || 0;
        this.state.tokenUsage.cost += usage.estimatedCost || 0;
        this.state.tokenUsage.requests += 1;

        this.elements.tokenCount.textContent = this.formatNumber(this.state.tokenUsage.total);
        this.elements.requestCount.textContent = this.state.tokenUsage.requests;
        this.elements.tokenCost.textContent = this.formatCost(this.state.tokenUsage.cost);

        this.elements.tokenDisplay.style.display = 'flex';
    }

    formatNumber(n) {
        if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
        return n.toString();
    }

    formatCost(cost) {
        if (cost < 0.01) return '<0.01';
        return cost.toFixed(2);
    }

    parseMarkdown(text) {
        if (!text) return text;

        const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);

        return parts.map((part) => {
            // Code block
            if (part.startsWith('```')) {
                const code = part.slice(3, -3).replace(/^\w+\n/, '');
                return `<pre><code>${this.escapeHtml(code)}</code></pre>`;
            }
            // Inline code
            if (part.startsWith('`') && part.endsWith('`')) {
                return `<code>${this.escapeHtml(part.slice(1, -1))}</code>`;
            }

            let content = this.escapeHtml(part);

            // Bold
            content = content.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

            // Italic
            content = content.replace(/\*(.+?)\*/g, '<em>$1</em>');

            // Links
            content = content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

            // Bullet points
            content = content.replace(/^[•\-\*]\s+(.+)$/gm, '<li>$1</li>');
            content = content.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

            // Numbered lists
            content = content.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');

            // Line breaks
            content = content.replace(/\n/g, '<br>');

            return content;
        }).join('');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Public API methods
    setVisitorInfo(info) {
        this.state.visitorInfo = { ...this.state.visitorInfo, ...info };
    }

    getVisitorInfo() {
        return this.state.visitorInfo;
    }

    getMessages() {
        return this.state.messages;
    }

    getTokenUsage() {
        return this.state.tokenUsage;
    }

    // Set page context (called from chat-loader or postMessage)
    setPageContext(context) {
        this.pageContext = {
            page: context.page || 'unknown',
            pageName: context.pageName || context.title || document.title,
            title: context.title || document.title,
            url: context.url || window.location.href,
            description: context.description || ''
        };
        console.log('[ChatWidget] Page context set:', this.pageContext.pageName);
    }

    getPageContext() {
        // If has getPageContext function from config, use it for fresh context
        if (this.config.getPageContext) {
            const ctx = this.config.getPageContext();
            console.log('[ChatWidget] getPageContext from config:', ctx);
            return ctx;
        }
        console.log('[ChatWidget] getPageContext from stored:', this.pageContext);
        return this.pageContext;
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChatWidget;
}
