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
            isMinimized: false,
            isLoading: false,
            screenshot: null,
            attachments: [],
            tokenUsage: savedState.tokenUsage || { total: 0, cost: 0, requests: 0 },
            sessionId: savedState.sessionId || null,
            sessionRestored: false,
            lastSessionLookup: null,
            duplicateChecked: savedState.duplicateChecked || false,
            duplicateCheckedEmail: savedState.duplicateCheckedEmail || null
        };

        // Elements (will be set after render)
        this.elements = {};

        // Voice recognition
        this.recognition = null;
        this.isListening = false;
        this.hasSpeechSupport = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

        // State sync tracking
        this.lastSyncTime = 0;
        this.syncInterval = null;
        this.formDataCache = null; // Track last form data for abandoned form tracking

        // Initialize
        this.render();
        this.bindElements();
        this.bindEvents();
        this.initVoice();
        this.updateLayoutOffset();
        window.addEventListener('resize', () => this.updateLayoutOffset());

        // Initialize state sync and abandoned form tracking
        this.initStateSync();
        this.initAbandonedFormTracking();

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
                duplicateChecked: this.state.duplicateChecked,
                duplicateCheckedEmail: this.state.duplicateCheckedEmail,
                timestamp: Date.now()
            };
            localStorage.setItem(this.config.storageKey, JSON.stringify(stateToSave));
        } catch (e) {
            console.warn('Failed to save chat state:', e);
        }
    }

    restoreMessages() {
        this.state.messages.forEach(msg => {
            const row = document.createElement('div');
            row.className = `chat-message-row ${msg.role}`;

            const avatar = document.createElement('div');
            avatar.className = `chat-bubble-avatar ${msg.role}`;
            avatar.textContent = msg.role === 'assistant' ? 'AI' : 'You';

            const msgDiv = document.createElement('div');
            msgDiv.className = `chat-message ${msg.role}`;
            if (msg.role === 'assistant') {
                msgDiv.innerHTML = this.parseMarkdown(msg.content);
            } else {
                msgDiv.textContent = msg.content;
            }

            if (msg.role === 'assistant') {
                row.appendChild(avatar);
                row.appendChild(msgDiv);
            } else {
                row.appendChild(msgDiv);
                row.appendChild(avatar);
            }

            this.elements.messages.appendChild(row);
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
            : 'https://yzsmohmtar6d45wb47npb7m4q40kudvw.lambda-url.us-east-1.on.aws/';
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
                        <button id="chat-clear" class="chat-clear" aria-label="Clear chat" title="Clear conversation">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18"/>
                                <path d="M8 6V4h8v2"/>
                                <path d="M6 6l1 14h10l1-14"/>
                                <path d="M10 11v6"/>
                                <path d="M14 11v6"/>
                            </svg>
                        </button>
                        <button id="chat-minimize" class="chat-minimize" aria-label="Minimize chat" title="Minimize">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M5 12h14"/>
                            </svg>
                        </button>
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
                    <input id="chat-file-input" class="chat-file-input" type="file" accept=".pdf,.doc,.docx,.txt,image/*" style="display:none" />
                    <div id="chat-screenshot-preview" class="chat-screenshot-preview">
                        <img id="screenshot-preview-img" src="" alt="Screenshot preview"/>
                        <div class="preview-actions">
                            <span>📷 Screenshot attached</span>
                            <button id="remove-screenshot" class="remove-screenshot">Remove</button>
                        </div>
                    </div>
                    <div class="chat-input-row">
                        <textarea id="chat-input" placeholder="Type your message... (Shift+Enter for new line)" rows="1"></textarea>
                        <button id="chat-attach" class="chat-attach-btn" aria-label="Attach file" title="Attach file">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21.44 11.05l-8.49 8.49a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.19 9.19a1.5 1.5 0 0 1-2.12-2.12l8.49-8.49"/>
                            </svg>
                        </button>
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
            minimize: document.getElementById('chat-minimize'),
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
            avatar: document.querySelector('.chat-avatar'),
            attach: document.getElementById('chat-attach'),
            fileInput: document.getElementById('chat-file-input')
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

        // Minimize chat
        this.elements.minimize.addEventListener('click', () => this.minimizeChat());

        // Voice input
        this.elements.voice.addEventListener('click', () => this.toggleVoice());

        // Screenshot
        this.elements.screenshotToggle.addEventListener('click', () => this.captureScreenshot());
        this.elements.removeScreenshot.addEventListener('click', () => this.removeScreenshot());

        // File attachment
        this.elements.attach.addEventListener('click', () => this.elements.fileInput.click());
        this.elements.fileInput.addEventListener('change', (e) => this.handleFileAttach(e));

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

    handleFileAttach(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;

        const maxSizeMB = 8;
        if (file.size > maxSizeMB * 1024 * 1024) {
            this.addMessage('assistant', `That file is larger than ${maxSizeMB}MB. Please upload a smaller file.`);
            this.elements.fileInput.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const attachment = {
                name: file.name,
                type: file.type || 'application/octet-stream',
                size: file.size,
                dataUrl: reader.result
            };
            this.state.attachments.push(attachment);
            this.elements.fileInput.value = '';

            if (!this.state.isLoading) {
                this.sendMessage(`Please extract details from the attached file: ${file.name}`);
            } else {
                this.addMessage('assistant', `Attached ${file.name}. I'll process it once the current message finishes.`);
            }
        };
        reader.onerror = () => {
            this.addMessage('assistant', 'Sorry, I could not read that file. Please try again.');
            this.elements.fileInput.value = '';
        };
        reader.readAsDataURL(file);
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

    minimizeChat() {
        this.state.isMinimized = !this.state.isMinimized;
        this.elements.sidebar.classList.toggle('minimized', this.state.isMinimized);

        // Update minimize button icon
        const minBtn = this.elements.minimize;
        if (this.state.isMinimized) {
            minBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 9l7-7 7 7"/>
                <path d="M5 15l7 7 7-7"/>
            </svg>`;
            minBtn.title = 'Maximize';
        } else {
            minBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14"/>
            </svg>`;
            minBtn.title = 'Minimize';
        }
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
        this.state.attachments = [];
        this.saveState(); // Persist cleared state

        // Re-add welcome message
        setTimeout(() => {
            this.addMessage('assistant', this.config.welcomeMessage);
        }, 100);
    }

    addMessage(role, content) {
        const row = document.createElement('div');
        row.className = `chat-message-row ${role}`;

        const avatar = document.createElement('div');
        avatar.className = `chat-bubble-avatar ${role}`;
        avatar.textContent = role === 'assistant' ? 'AI' : 'You';

        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${role}`;

        if (role === 'assistant') {
            msgDiv.innerHTML = this.parseMarkdown(content);
        } else {
            msgDiv.textContent = content;
        }

        if (role === 'assistant') {
            row.appendChild(avatar);
            row.appendChild(msgDiv);
        } else {
            row.appendChild(msgDiv);
            row.appendChild(avatar);
        }

        this.elements.messages.appendChild(row);
        this.elements.messages.scrollTop = this.elements.messages.scrollHeight;

        if (role !== 'system') {
            this.state.messages.push({ role, content });
            this.saveState(); // Persist after each message
        }
    }

    showTyping() {
        const row = document.createElement('div');
        row.className = 'chat-message-row assistant';
        row.id = 'typing-indicator';

        const avatar = document.createElement('div');
        avatar.className = 'chat-bubble-avatar assistant';
        avatar.textContent = 'AI';

        const typingDiv = document.createElement('div');
        typingDiv.className = 'chat-typing';
        typingDiv.innerHTML = '<span></span><span></span><span></span>';

        row.appendChild(avatar);
        row.appendChild(typingDiv);
        this.elements.messages.appendChild(row);
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
        let content = customContent || this.elements.input.value.trim();
        const hasAttachments = this.state.attachments.length > 0;
        if ((!content && !hasAttachments) || this.state.isLoading) return;
        if (!content && hasAttachments) {
            content = `Attached file(s): ${this.state.attachments.map(file => file.name).join(', ')}`;
        }

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

            if (hasAttachments) {
                requestBody.attachments = this.state.attachments;
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
                    const previousPhone = this.state.visitorInfo.phone;
                    const previousEmail = this.state.visitorInfo.email;
                    this.state.visitorInfo = { ...this.state.visitorInfo, ...data.visitorInfo };

                    // Check for existing session when we first get phone/email (returning user)
                    const newPhone = data.visitorInfo.phone;
                    const newEmail = data.visitorInfo.email;
                    const hasNewContact = (newPhone && newPhone !== previousPhone) || (newEmail && newEmail !== previousEmail);

                    if (hasNewContact && !this.state.sessionRestored) {
                        // Mark that we're checking to prevent duplicate lookups
                        this.checkAndRestoreSession(newPhone, newEmail).then(restored => {
                            if (restored) {
                                this.state.sessionRestored = true;
                                console.log('[ChatWidget] Previous session restored for returning user');
                            }
                        });
                    }
                }

                // Update token usage
                if (data.usage) {
                    this.updateTokenUsage(data.usage);
                }

                // Save state after successful response
                this.saveState();

                // Check if form was submitted successfully
                if (data.formSubmitted) {
                    this.markFormSubmitted();
                }

                // Callback for form data - with duplicate check
                if (formData) {
                    console.log('[ChatWidget] Form data extracted:', formData);
                    // Use handleFormData which checks for duplicates first
                    this.handleFormData(formData);
                }

                // Sync state to S3 after receiving form data or important updates
                if (formData || data.formSubmitted || data.hasContactInfo) {
                    this.syncStateToS3('form_data_received');
                }
            } else {
                const contactEmail = window.AppConfig?.contact?.supportEmail;
                const contactMsg = contactEmail ? `email us at ${contactEmail}` : 'visit our contact page';
                this.addMessage('assistant', `Sorry, I'm having trouble connecting. Please try again or ${contactMsg}`);
            }
        } catch (error) {
            console.error('Chat error:', error);
            this.hideTyping();
            const contactEmail = window.AppConfig?.contact?.supportEmail;
            const contactMsg = contactEmail ? `email us at ${contactEmail}` : 'visit our contact page';
            this.addMessage('assistant', `Sorry, I'm having trouble connecting. Please try again or ${contactMsg}`);
        } finally {
            this.state.isLoading = false;
            this.elements.send.disabled = false;
            this.elements.input.focus();
            this.state.attachments = [];
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

    // Check for duplicate application by email before proceeding
    async checkDuplicateApplication(email) {
        if (!email) return { isDuplicate: false };

        // Normalize email
        const normalizedEmail = email.toLowerCase().trim();

        // Skip if already checked this email
        if (this.state.duplicateChecked && this.state.duplicateCheckedEmail === normalizedEmail) {
            console.log('[ChatWidget] Already checked duplicate for:', normalizedEmail);
            return { isDuplicate: false, alreadyChecked: true };
        }

        try {
            console.log('[ChatWidget] Checking for duplicate application:', normalizedEmail);

            const response = await fetch(this.config.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'check-duplicate',
                    email: normalizedEmail
                })
            });

            const result = await response.json();
            console.log('[ChatWidget] Duplicate check result:', result);

            // Mark as checked
            this.state.duplicateChecked = true;
            this.state.duplicateCheckedEmail = normalizedEmail;
            this.saveState();

            return result;
        } catch (error) {
            console.error('[ChatWidget] Duplicate check failed:', error);
            // Allow to proceed on error
            return { isDuplicate: false, error: true };
        }
    }

    // Handle form data with duplicate check
    async handleFormData(formData) {
        if (!formData) return;

        const email = formData.email;

        // If email is provided and we haven't checked yet, check for duplicates first
        if (email && !this.state.duplicateChecked) {
            const duplicateResult = await this.checkDuplicateApplication(email);

            if (duplicateResult.isDuplicate) {
                // Show duplicate notification to user
                const duplicateMessage = `⚠️ **Existing Application Found**\n\nIt looks like you already have an application on file (submitted ${duplicateResult.submittedAt || 'previously'}) using this ${duplicateResult.matchedBy || 'email'}.\n\nOur team is reviewing it and will contact you soon. If you have updates or questions, please visit our contact page.\n\nWould you like to continue with a new application anyway?`;

                this.addMessage('assistant', duplicateMessage);
                console.log('[ChatWidget] Duplicate application detected, notified user');

                // Still call onFormData but mark as duplicate
                if (this.config.onFormData) {
                    this.config.onFormData({ ...formData, _isDuplicate: true, _duplicateInfo: duplicateResult });
                }
                return;
            }
        }

        // No duplicate - proceed normally
        // Update form data cache for abandoned form tracking
        this.updateFormDataCache(formData);

        if (this.config.onFormData) {
            this.config.onFormData(formData);
        } else {
            console.log('[ChatWidget] No onFormData callback configured');
        }
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

            // Bold questions or short section headers (lines ending with "?" or ":")
            content = content.replace(/^(?!<li>)([^<\n].*\\?)$/gm, '<strong>$1</strong>');
            content = content.replace(/^(?!<li>)([A-Z][^<\n]{0,60}:)$/gm, '<strong>$1</strong>');

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

    // Session persistence - lookup existing session by phone/email
    async lookupExistingSession(phone, email) {
        if (!phone && !email) return null;

        console.log('[ChatWidget] Looking up existing session for:', { phone, email });

        try {
            const response = await fetch(this.config.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'lookup-session',
                    phone: phone,
                    email: email
                })
            });

            const data = await response.json();
            console.log('[ChatWidget] Session lookup result:', data);

            if (data.success && data.found) {
                return {
                    found: true,
                    sessionId: data.sessionId,
                    messages: data.messages || [],
                    visitorInfo: data.visitorInfo || {},
                    matchedBy: data.matchedBy,
                    lastActivity: data.lastActivity
                };
            }
        } catch (error) {
            console.error('[ChatWidget] Session lookup error:', error);
        }

        return { found: false };
    }

    // Restore session from server data
    restoreSessionFromServer(sessionData) {
        console.log('[ChatWidget] Restoring session from server:', sessionData.sessionId);

        // Clear current messages display
        this.elements.messages.innerHTML = '';

        // Update state with server data
        this.state.sessionId = sessionData.sessionId;
        this.state.messages = sessionData.messages || [];
        this.state.visitorInfo = { ...this.state.visitorInfo, ...sessionData.visitorInfo };

        // Re-render all messages
        this.state.messages.forEach(msg => {
            const row = document.createElement('div');
            row.className = `chat-message-row ${msg.role}`;

            const avatar = document.createElement('div');
            avatar.className = `chat-bubble-avatar ${msg.role}`;
            avatar.textContent = msg.role === 'assistant' ? 'AI' : 'You';

            const msgDiv = document.createElement('div');
            msgDiv.className = `chat-message ${msg.role}`;
            if (msg.role === 'assistant') {
                // Clean out any form data markers before displaying
                const cleanContent = msg.content.replace(/\|\|\|FORM_DATA\|\|\|[\s\S]*?\|\|\|END_FORM\|\|\|/g, '').trim();
                msgDiv.innerHTML = this.parseMarkdown(cleanContent);
            } else {
                msgDiv.textContent = msg.content;
            }

            if (msg.role === 'assistant') {
                row.appendChild(avatar);
                row.appendChild(msgDiv);
            } else {
                row.appendChild(msgDiv);
                row.appendChild(avatar);
            }

            this.elements.messages.appendChild(row);
        });

        // Scroll to bottom
        this.elements.messages.scrollTop = this.elements.messages.scrollHeight;

        // Add a welcome back message
        const lastActivity = sessionData.lastActivity ? new Date(sessionData.lastActivity).toLocaleDateString() : 'recently';
        this.addMessage('assistant', `Welcome back! I found your previous conversation from ${lastActivity}. Your session has been restored. How can I continue helping you today?`);

        // Save state
        this.saveState();

        console.log('[ChatWidget] Session restored with', this.state.messages.length, 'messages');
    }

    // Check for returning user and restore their session
    async checkAndRestoreSession(phone, email) {
        // Only check if we have phone or email and don't already have a session with messages
        if ((!phone && !email) || (this.state.sessionId && this.state.messages.length > 1)) {
            return false;
        }

        // Check if we already checked for this contact (avoid duplicate lookups)
        const lookupKey = `${phone || ''}-${email || ''}`;
        if (this.state.lastSessionLookup === lookupKey) {
            return false;
        }
        this.state.lastSessionLookup = lookupKey;

        const result = await this.lookupExistingSession(phone, email);

        if (result.found && result.messages && result.messages.length > 0) {
            // Found previous session - auto-load it
            this.restoreSessionFromServer(result);
            return true;
        }

        return false;
    }

    // Public API methods

    // Called when user logs in - restore their chat session automatically
    async onUserLogin(userInfo) {
        const { phone, email, name } = userInfo;
        console.log('[ChatWidget] User logged in:', { name, phone, email });

        if (!phone && !email) {
            console.log('[ChatWidget] No phone or email provided for session restore');
            return false;
        }

        // Update visitor info with login details
        this.state.visitorInfo = {
            ...this.state.visitorInfo,
            ...(name && { name }),
            ...(phone && { phone }),
            ...(email && { email })
        };

        // Look up and restore existing session
        const result = await this.lookupExistingSession(phone, email);

        if (result && result.found && result.messages && result.messages.length > 0) {
            // Found previous session - restore it
            this.restoreSessionFromServer(result);

            // Open the chat to show restored conversation
            if (!this.state.isOpen) {
                this.toggle();
            }

            console.log('[ChatWidget] Session restored for logged in user');
            return true;
        } else {
            // No previous session - start fresh with personalized greeting
            this.clearChat();
            const greeting = name ? `Hi ${name}! 👋` : 'Hi there! 👋';
            this.addMessage('assistant', `${greeting} Welcome to CoCreate!\n\nI'm here to answer any questions about our partnership model. We help business founders launch AI-powered products in just 2 weeks.\n\nWhat would you like to know?`);

            // Open the chat
            if (!this.state.isOpen) {
                this.toggle();
            }

            console.log('[ChatWidget] No previous session, started fresh for logged in user');
            return false;
        }
    }

    // Called when user signs up - initialize their chat session
    async onUserSignup(userInfo) {
        const { phone, email, name } = userInfo;
        console.log('[ChatWidget] User signed up:', { name, phone, email });

        // Update visitor info with signup details
        this.state.visitorInfo = {
            ...this.state.visitorInfo,
            ...(name && { name }),
            ...(phone && { phone }),
            ...(email && { email })
        };

        // Clear any existing chat and start fresh with personalized greeting
        this.clearChat();
        const greeting = name ? `Welcome ${name}! 🎉` : 'Welcome! 🎉';
        this.addMessage('assistant', `${greeting} Thanks for signing up with CoCreate!\n\nI'm your AI assistant, here to help you explore partnership opportunities. We partner with business founders to build AI-powered products in just 2 weeks.\n\nDo you have a product idea you'd like to discuss?`);

        // Open the chat
        if (!this.state.isOpen) {
            this.toggle();
        }

        this.saveState();
        console.log('[ChatWidget] Chat initialized for new user');
    }

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

    // ========== STATE SYNC & ABANDONED FORM TRACKING ==========

    // Initialize periodic state sync to S3
    initStateSync() {
        // Sync every 30 seconds if there's activity
        this.syncInterval = setInterval(() => {
            this.syncStateToS3('periodic');
        }, 30000);

        // Also sync on visibility change (tab becoming hidden)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.syncStateToS3('visibility_hidden');
            }
        });

        console.log('[ChatWidget] State sync initialized');
    }

    // Initialize abandoned form tracking
    initAbandonedFormTracking() {
        // Track beforeunload to save abandoned form data
        window.addEventListener('beforeunload', (e) => {
            this.handlePageUnload();
        });

        // Also track pagehide for mobile browsers
        window.addEventListener('pagehide', (e) => {
            if (!e.persisted) {
                this.handlePageUnload();
            }
        });

        console.log('[ChatWidget] Abandoned form tracking initialized');
    }

    // Handle page unload - save state and check for abandoned form
    handlePageUnload() {
        // Always sync state on unload
        this.syncStateToS3('page_unload', true);

        // Check if there's form data that wasn't submitted
        if (this.formDataCache && !this.state.formSubmitted) {
            this.saveAbandonedForm('page_unload');
        }
    }

    // Sync localStorage state to S3
    async syncStateToS3(reason = 'manual', useBeacon = false) {
        // Skip if no session or no messages
        if (!this.state.sessionId || this.state.messages.length === 0) {
            return;
        }

        // Throttle syncs (minimum 10 seconds apart, except for unload)
        const now = Date.now();
        if (reason !== 'page_unload' && now - this.lastSyncTime < 10000) {
            return;
        }
        this.lastSyncTime = now;

        const syncData = {
            action: 'sync-state',
            sessionId: this.state.sessionId,
            chatState: {
                messages: this.state.messages,
                visitorInfo: this.state.visitorInfo,
                tokenUsage: this.state.tokenUsage,
                duplicateChecked: this.state.duplicateChecked,
                duplicateCheckedEmail: this.state.duplicateCheckedEmail,
                isOpen: this.state.isOpen
            },
            visitorInfo: this.state.visitorInfo,
            reason
        };

        try {
            if (useBeacon && navigator.sendBeacon) {
                // Use sendBeacon for page unload (more reliable)
                const blob = new Blob([JSON.stringify(syncData)], { type: 'application/json' });
                navigator.sendBeacon(this.config.apiUrl, blob);
                console.log('[ChatWidget] State synced via beacon:', reason);
            } else {
                // Use fetch for normal syncs
                fetch(this.config.apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(syncData),
                    keepalive: true // Helps with page unload
                }).then(response => {
                    if (response.ok) {
                        console.log('[ChatWidget] State synced to S3:', reason);
                    }
                }).catch(err => {
                    console.warn('[ChatWidget] State sync failed:', err.message);
                });
            }
        } catch (error) {
            console.warn('[ChatWidget] State sync error:', error.message);
        }
    }

    // Save abandoned form data
    async saveAbandonedForm(reason = 'unknown') {
        if (!this.formDataCache) {
            console.log('[ChatWidget] No form data to save as abandoned');
            return;
        }

        // Check if any meaningful data was collected
        const hasData = Object.values(this.formDataCache).some(v => v && v.trim && v.trim().length > 0);
        if (!hasData) {
            console.log('[ChatWidget] Form data is empty, not saving');
            return;
        }

        const abandonedData = {
            action: 'save-abandoned-form',
            sessionId: this.state.sessionId || `anon-${Date.now()}`,
            formData: this.formDataCache,
            chatState: {
                messages: this.state.messages,
                visitorInfo: this.state.visitorInfo,
                tokenUsage: this.state.tokenUsage
            },
            visitorInfo: this.state.visitorInfo,
            reason
        };

        try {
            if (navigator.sendBeacon) {
                const blob = new Blob([JSON.stringify(abandonedData)], { type: 'application/json' });
                navigator.sendBeacon(this.config.apiUrl, blob);
                console.log('[ChatWidget] Abandoned form saved via beacon');
            } else {
                fetch(this.config.apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(abandonedData),
                    keepalive: true
                });
                console.log('[ChatWidget] Abandoned form saved via fetch');
            }
        } catch (error) {
            console.warn('[ChatWidget] Failed to save abandoned form:', error.message);
        }
    }

    // Update form data cache (called when form data is received from AI)
    updateFormDataCache(formData) {
        if (formData) {
            this.formDataCache = { ...this.formDataCache, ...formData };
            console.log('[ChatWidget] Form data cache updated:', Object.keys(formData).filter(k => formData[k]).length, 'fields');
        }
    }

    // Mark form as submitted (to prevent saving as abandoned)
    markFormSubmitted() {
        this.state.formSubmitted = true;
        this.formDataCache = null;
        this.saveState();
        console.log('[ChatWidget] Form marked as submitted');
    }

    // Clean up on destroy
    destroy() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }
        // Final sync
        this.syncStateToS3('destroy', true);
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChatWidget;
}
