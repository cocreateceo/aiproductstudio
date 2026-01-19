/**
 * Chat Loader - Initializes chat widget as a sidebar
 *
 * Chat appears as a sidebar on the right side of the page.
 * Conversation persists across page navigation via localStorage.
 *
 * Usage: Include after chat-widget.js
 * <script src="js/chat-widget.js"></script>
 * <script src="js/chat-loader.js"></script>
 */

(function() {
    'use strict';

    // Page name mappings for better context
    const PAGE_NAMES = {
        'index': 'Home Page',
        'who-we-are': 'Who We Are - About Us',
        'partners': 'Partners & Alliances',
        'leadership': 'Leadership Team',
        'culture': 'Our Culture & Values',
        'careers': 'Careers',
        'what-we-do': 'What We Do - Services Overview',
        'ai': 'AI Solutions & Services',
        'product': 'Product Development',
        'platforms': 'Technology Platforms',
        'insights': 'Insights & Thought Leadership',
        'blogs': 'Blog Articles',
        'success-stories': 'Success Stories & Case Studies',
        'contact': 'Contact Us',
        'apply': 'Apply for Partnership',
        'healthcare': 'Healthcare Industry Solutions',
        'financial-services': 'Financial Services Solutions',
        'retail': 'Retail Industry Solutions',
        'manufacturing': 'Manufacturing Industry Solutions'
    };

    // Fill form fields with extracted data from AI
    function fillFormFields(formData) {
        if (!formData) return;

        // Map of form field IDs to formData keys
        const fieldMappings = {
            'fullName': formData.fullName,
            'email': formData.email,
            'phone': formData.phone,
            'linkedin': formData.linkedin,
            'businessStage': formData.businessStage,
            'industry': formData.industry,
            'background': formData.background,
            'productIdea': formData.productIdea,
            'targetCustomer': formData.targetCustomer,
            'marketValidation': formData.marketValidation,
            'timeCommitment': formData.timeCommitment,
            'timeline': formData.timeline,
            'additionalInfo': formData.additionalInfo
        };

        let filledCount = 0;

        for (const [fieldId, value] of Object.entries(fieldMappings)) {
            // Convert value to string and check if not empty
            const strValue = value != null ? String(value).trim() : '';
            if (strValue !== '') {
                const field = document.getElementById(fieldId);
                if (field) {
                    field.value = strValue;
                    filledCount++;
                    // Trigger change event for select elements
                    if (field.tagName === 'SELECT') {
                        field.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    // Add visual feedback - highlight filled fields briefly
                    field.style.transition = 'background-color 0.3s';
                    field.style.backgroundColor = '#e8f5e9';
                    setTimeout(() => {
                        field.style.backgroundColor = '';
                    }, 2000);
                    console.log(`[ChatLoader] Filled ${fieldId}:`, strValue);
                }
            }
        }

        if (filledCount > 0) {
            console.log(`[ChatLoader] Auto-filled ${filledCount} form fields`);
            // Scroll to form if on apply page
            const form = document.getElementById('partnership-form');
            if (form) {
                form.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    }

    // Get current page info with human-readable name
    function getPageContext() {
        const path = window.location.pathname;
        const filename = path.split('/').pop().replace('.html', '') || 'index';
        const pageName = PAGE_NAMES[filename] || document.title.split('|')[0].trim();

        const context = {
            page: filename,
            pageName: pageName,
            title: document.title,
            url: window.location.href,
            // Include a clear description for the AI
            description: `User is currently viewing: ${pageName}`
        };

        console.log('[ChatLoader] getPageContext called:', context);
        return context;
    }

    // Initialize chat widget
    function initChat() {
        // Check if ChatWidget is available
        if (typeof ChatWidget === 'undefined') {
            console.error('[ChatLoader] ChatWidget not found. Make sure chat-widget.js is loaded first.');
            return;
        }

        // Create container if not exists
        let container = document.getElementById('chat-widget-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'chat-widget-container';
            document.body.appendChild(container);
        }

        // Get page context
        const pageContext = getPageContext();

        // Initialize chat widget
        window.chatWidget = new ChatWidget({
            title: 'AI Product Studio',
            subtitle: 'Online - Ready to help',
            welcomeMessage: `Hi there! 👋 Welcome to AI Product Studio!

I'm here to answer any questions about our partnership model. We help business founders launch AI-powered products in just 2 weeks.

What would you like to know?`,
            startOpen: false,
            containerId: 'chat-widget-container',
            getPageContext: () => getPageContext(),
            // Auto-fill form when AI extracts data from uploaded files
            onFormData: (formData) => {
                console.log('[ChatLoader] Received form data to auto-fill:', formData);
                fillFormFields(formData);
            }
        });

        // Set initial page context
        window.chatWidget.setPageContext(pageContext);

        console.log('[ChatLoader] Initialized on:', pageContext.pageName);
    }

    // Initialize when DOM is ready
    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                initChat();
            });
        } else {
            initChat();
        }
    }

    // Public API
    window.ChatLoader = {
        open: () => window.chatWidget?.open(),
        close: () => window.chatWidget?.close(),
        toggle: () => window.chatWidget?.toggle(),
        getPageContext: getPageContext,

        // Session persistence - call these on login/signup
        // Example: ChatLoader.onUserLogin({ phone: '9876543210', email: 'user@example.com', name: 'John' })
        onUserLogin: async (userInfo) => {
            if (window.chatWidget) {
                return await window.chatWidget.onUserLogin(userInfo);
            }
            console.warn('[ChatLoader] Chat widget not initialized');
            return false;
        },

        // Example: ChatLoader.onUserSignup({ phone: '9876543210', email: 'user@example.com', name: 'John' })
        onUserSignup: async (userInfo) => {
            if (window.chatWidget) {
                return await window.chatWidget.onUserSignup(userInfo);
            }
            console.warn('[ChatLoader] Chat widget not initialized');
        },

        // Get current visitor info
        getVisitorInfo: () => window.chatWidget?.getVisitorInfo(),

        // Set visitor info manually
        setVisitorInfo: (info) => window.chatWidget?.setVisitorInfo(info)
    };

    init();

})();
