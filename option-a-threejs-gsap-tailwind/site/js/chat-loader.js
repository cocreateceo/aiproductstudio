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

    // ============================================
    // FORM FIELD CONFIGURATION
    // ============================================

    // 8 Mandatory fields (ALL REQUIRED - matches HTML form)
    const MANDATORY_FIELDS = [
        'fullName',
        'email',
        'businessStage',
        'industry',
        'background',
        'productIdea',
        'targetCustomer',
        'timeCommitment',
        'timeline'
    ];

    // ============================================
    // VALIDATION & FORMATTING FUNCTIONS
    // ============================================

    // Format email: lowercase, trim
    function formatEmail(email) {
        if (!email) return '';
        return email.toLowerCase().trim();
    }

    // Format phone: remove spaces, dashes, parentheses, keep + and digits
    function formatPhone(phone) {
        if (!phone) return '';
        // Keep + at start if present, remove all non-digit characters except +
        return phone.replace(/[^\d+]/g, '');
    }

    // Check if all mandatory fields are filled
    function checkMandatoryFields() {
        const missing = [];
        for (const fieldId of MANDATORY_FIELDS) {
            const field = document.getElementById(fieldId);
            if (!field || !field.value || field.value.trim() === '') {
                missing.push(fieldId);
            }
        }
        return { allFilled: missing.length === 0, missing };
    }

    // Highlight missing mandatory fields with red border
    function highlightMissingFields() {
        const { missing } = checkMandatoryFields();

        // Reset all fields first
        MANDATORY_FIELDS.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.style.borderColor = '';
                field.style.boxShadow = '';
                // Remove any existing error message
                const existingError = field.parentElement.querySelector('.field-error-msg');
                if (existingError) existingError.remove();
            }
        });

        // Highlight missing fields with red
        missing.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.style.borderColor = '#ef4444';
                field.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.2)';
                field.style.transition = 'all 0.3s ease';

                // Add error message below field
                const errorMsg = document.createElement('span');
                errorMsg.className = 'field-error-msg';
                errorMsg.style.cssText = 'color: #ef4444; font-size: 12px; margin-top: 4px; display: block;';
                errorMsg.textContent = 'This field is required';

                // Only add if not already present
                if (!field.parentElement.querySelector('.field-error-msg')) {
                    field.parentElement.appendChild(errorMsg);
                }
            }
        });

        console.log('[ChatLoader] Missing mandatory fields:', missing);
        return missing;
    }

    // Auto-submit the form
    function autoSubmitForm() {
        const form = document.getElementById('partnership-form');
        if (!form) {
            console.log('[ChatLoader] Form not found, cannot auto-submit');
            return false;
        }

        // Check all mandatory fields are filled
        const { allFilled, missing } = checkMandatoryFields();
        if (!allFilled) {
            console.log('[ChatLoader] Cannot auto-submit: mandatory fields missing:', missing);
            highlightMissingFields();
            return false;
        }

        console.log('[ChatLoader] All 8 mandatory fields filled, auto-submitting form...');

        // Trigger form submit
        const submitBtn = form.querySelector('button[type="submit"]') || form.querySelector('input[type="submit"]');
        if (submitBtn) {
            submitBtn.click();
            console.log('[ChatLoader] Form submitted via button click');
        } else {
            form.submit();
            console.log('[ChatLoader] Form submitted directly');
        }

        return true;
    }

    // Fill form fields with extracted data from AI
    function fillFormFields(formData, shouldAutoSubmit = false) {
        if (!formData) return;

        // Apply formatting to email and phone
        const formattedEmail = formatEmail(formData.email);
        const formattedPhone = formatPhone(formData.phone);

        // Map of form field IDs to formData keys (with formatted values)
        const fieldMappings = {
            'fullName': formData.fullName,
            'email': formattedEmail,
            'phone': formattedPhone,
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

            // Auto-submit if all required fields are filled and shouldAutoSubmit is true
            if (shouldAutoSubmit && checkMandatoryFields().allFilled) {
                // Delay submit slightly to let user see the filled form
                setTimeout(() => {
                    autoSubmitForm();
                }, 1500);
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

                // Check if ALL 8 mandatory fields have values - if so, auto-submit
                // Note: phone is OPTIONAL (not in mandatory list)
                const hasAllMandatory = formData.fullName
                    && formData.email
                    && formData.businessStage
                    && formData.industry
                    && formData.background
                    && formData.productIdea
                    && formData.targetCustomer
                    && formData.timeCommitment
                    && formData.timeline;

                console.log('[ChatLoader] All 8 mandatory fields present:', hasAllMandatory);

                // Fill form fields, auto-submit only if all mandatory present
                fillFormFields(formData, hasAllMandatory);

                // If not all mandatory, highlight what's missing
                if (!hasAllMandatory) {
                    setTimeout(() => {
                        highlightMissingFields();
                    }, 500);
                }
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
