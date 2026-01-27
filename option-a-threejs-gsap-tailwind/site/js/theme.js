/**
 * CoCreate AI - Unified Theme System
 * Handles theme persistence across all pages
 */

(function() {
    'use strict';

    // Theme definitions - MUST match index.html CSS exactly
    const THEMES = {
        dark: {
            name: 'Dark',
            icon: '🌙',
            colors: {
                '--bg-primary': '#020617',
                '--bg-secondary': '#0f172a',
                '--bg-card': 'rgba(15, 23, 42, 0.7)',
                '--text-primary': '#f1f5f9',
                '--text-secondary': '#94a3b8',
                '--text-muted': '#64748b',
                '--border-color': 'rgba(99, 102, 241, 0.2)',
                '--primary': '#6366f1',
                '--secondary': '#8b5cf6',
                '--accent': '#06b6d4',
                '--nav-bg': 'rgba(2, 6, 23, 0.8)',
                '--glow-color': 'rgba(99, 102, 241, 0.3)',
                '--particle-opacity': '0.8'
            }
        },
        midnight: {
            name: 'Midnight',
            icon: '🌌',
            colors: {
                '--bg-primary': '#0c0a1d',
                '--bg-secondary': '#1a1533',
                '--bg-card': 'rgba(26, 21, 51, 0.8)',
                '--text-primary': '#e8e4f3',
                '--text-secondary': '#a59fc4',
                '--text-muted': '#7a73a0',
                '--border-color': 'rgba(167, 139, 250, 0.25)',
                '--primary': '#a78bfa',
                '--secondary': '#c084fc',
                '--accent': '#f472b6',
                '--nav-bg': 'rgba(12, 10, 29, 0.9)',
                '--glow-color': 'rgba(167, 139, 250, 0.35)',
                '--particle-opacity': '0.9'
            }
        },
        dusk: {
            name: 'Dusk',
            icon: '🌅',
            colors: {
                '--bg-primary': '#1e1b2e',
                '--bg-secondary': '#2d2844',
                '--bg-card': 'rgba(45, 40, 68, 0.75)',
                '--text-primary': '#f5f3ff',
                '--text-secondary': '#c4b5fd',
                '--text-muted': '#a78bfa',
                '--border-color': 'rgba(251, 146, 60, 0.25)',
                '--primary': '#fb923c',
                '--secondary': '#f97316',
                '--accent': '#fbbf24',
                '--nav-bg': 'rgba(30, 27, 46, 0.9)',
                '--glow-color': 'rgba(251, 146, 60, 0.3)',
                '--particle-opacity': '0.85'
            }
        },
        light: {
            name: 'Light',
            icon: '☀️',
            colors: {
                '--bg-primary': '#f8fafc',
                '--bg-secondary': '#e2e8f0',
                '--bg-card': 'rgba(255, 255, 255, 0.9)',
                '--text-primary': '#0f172a',
                '--text-secondary': '#475569',
                '--text-muted': '#64748b',
                '--border-color': 'rgba(99, 102, 241, 0.15)',
                '--primary': '#4f46e5',
                '--secondary': '#7c3aed',
                '--accent': '#0891b2',
                '--nav-bg': 'rgba(248, 250, 252, 0.95)',
                '--glow-color': 'rgba(79, 70, 229, 0.2)',
                '--particle-opacity': '0.4'
            }
        }
    };

    const STORAGE_KEY = 'theme';  // Must match index.html for cross-page persistence
    const DEFAULT_THEME = 'dark';

    // Get current theme from localStorage
    function getStoredTheme() {
        try {
            return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
        } catch (e) {
            return DEFAULT_THEME;
        }
    }

    // Save theme to localStorage
    function saveTheme(theme) {
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch (e) {
            console.warn('Could not save theme to localStorage');
        }
    }

    // Apply theme to document
    function applyTheme(themeName) {
        const theme = THEMES[themeName] || THEMES[DEFAULT_THEME];
        const root = document.documentElement;

        // Set data-theme attribute
        root.setAttribute('data-theme', themeName);

        // Apply CSS variables
        Object.entries(theme.colors).forEach(([property, value]) => {
            root.style.setProperty(property, value);
        });

        // Update chat widget variables if present
        const chatVars = {
            '--chat-primary': theme.colors['--primary'],
            '--chat-secondary': theme.colors['--secondary'],
            '--chat-bg': theme.colors['--bg-secondary'],
            '--chat-messages-bg': theme.colors['--bg-primary'],
            '--chat-input-bg': theme.colors['--bg-primary'],
            '--chat-border': theme.colors['--border-color'],
            '--chat-text-primary': theme.colors['--text-primary'],
            '--chat-text-secondary': theme.colors['--text-secondary'],
            '--chat-text-muted': theme.colors['--text-muted'],
            '--chat-msg-assistant-bg': theme.colors['--bg-card'],
            '--chat-msg-assistant-text': theme.colors['--text-primary']
        };

        Object.entries(chatVars).forEach(([property, value]) => {
            root.style.setProperty(property, value);
        });

        // Dispatch event for other scripts to react
        window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: themeName, colors: theme.colors } }));

        return theme;
    }

    // Initialize theme on page load (runs immediately)
    function initTheme() {
        const storedTheme = getStoredTheme();
        applyTheme(storedTheme);
        return storedTheme;
    }

    // Set theme and persist
    function setTheme(themeName) {
        if (!THEMES[themeName]) {
            console.warn(`Unknown theme: ${themeName}`);
            return;
        }
        saveTheme(themeName);
        applyTheme(themeName);
    }

    // Get available themes
    function getThemes() {
        return Object.entries(THEMES).map(([key, value]) => ({
            id: key,
            name: value.name,
            icon: value.icon
        }));
    }

    // Expose globally
    window.ThemeManager = {
        init: initTheme,
        set: setTheme,
        get: getStoredTheme,
        apply: applyTheme,
        themes: getThemes,
        THEMES: THEMES
    };

    // Auto-initialize immediately to prevent FOUC
    initTheme();
})();
