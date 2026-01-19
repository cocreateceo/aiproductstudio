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
            getPageContext: () => getPageContext()
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
        getPageContext: getPageContext
    };

    init();

})();
