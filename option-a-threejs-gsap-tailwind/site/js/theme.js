/**
 * CoCreate - Unified Theme System
 * Handles theme persistence across all pages
 * Themes: Ember (default), Coral, Sunset, Aurora, Legacy
 */

(function() {
    'use strict';

    // Theme definitions for CoCreate brand
    const THEMES = {
        ember: {
            name: 'Ember',
            icon: '🔥',
            description: 'Deep amber warmth',
            type: 'dark',
            colors: {
                '--bg-primary': '#1A0A00',
                '--bg-secondary': '#2D1408',
                '--bg-card': 'rgba(45, 20, 8, 0.85)',
                '--text-primary': '#FFF8F0',
                '--text-secondary': '#FFCBA4',
                '--text-muted': '#C4916C',
                '--border-color': 'rgba(252, 42, 13, 0.25)',
                '--primary': '#FC2A0D',
                '--secondary': '#FD6C71',
                '--accent': '#FFC36A',
                '--nav-bg': 'rgba(26, 10, 0, 0.9)',
                '--glow-color': 'rgba(252, 42, 13, 0.35)',
                '--particle-opacity': '0.6'
            }
        },
        coral: {
            name: 'Coral',
            icon: '🪸',
            description: 'Soft warm light',
            type: 'light',
            colors: {
                '--bg-primary': '#FFF8F0',
                '--bg-secondary': '#FFEEE0',
                '--bg-card': 'rgba(255, 255, 255, 0.85)',
                '--text-primary': '#1A0A00',
                '--text-secondary': '#5C3D2E',
                '--text-muted': '#8B6B5A',
                '--border-color': 'rgba(232, 90, 79, 0.2)',
                '--primary': '#FC2A0D',
                '--secondary': '#FD6C71',
                '--accent': '#E85A4F',
                '--nav-bg': 'rgba(255, 248, 240, 0.95)',
                '--glow-color': 'rgba(253, 108, 113, 0.25)',
                '--particle-opacity': '0.3'
            }
        },
        sunset: {
            name: 'Sunset',
            icon: '🌅',
            description: 'Vibrant pink-orange',
            type: 'dark',
            colors: {
                '--bg-primary': '#2D1B3D',
                '--bg-secondary': '#3D2650',
                '--bg-card': 'rgba(61, 38, 80, 0.85)',
                '--text-primary': '#FFF5F8',
                '--text-secondary': '#E6C4D4',
                '--text-muted': '#B8919F',
                '--border-color': 'rgba(255, 107, 157, 0.25)',
                '--primary': '#FF6B9D',
                '--secondary': '#FFC36A',
                '--accent': '#C084FC',
                '--nav-bg': 'rgba(45, 27, 61, 0.92)',
                '--glow-color': 'rgba(255, 107, 157, 0.35)',
                '--particle-opacity': '0.7'
            }
        },
        aurora: {
            name: 'Aurora',
            icon: '✨',
            description: 'Soft dreamy pastels',
            type: 'light',
            colors: {
                '--bg-primary': '#FFF5F8',
                '--bg-secondary': '#FFEEF4',
                '--bg-card': 'rgba(255, 255, 255, 0.8)',
                '--text-primary': '#2D1B3D',
                '--text-secondary': '#5C4268',
                '--text-muted': '#8B7196',
                '--border-color': 'rgba(230, 164, 255, 0.25)',
                '--primary': '#E6A4FF',
                '--secondary': '#FFB6C1',
                '--accent': '#FFC36A',
                '--nav-bg': 'rgba(255, 245, 248, 0.95)',
                '--glow-color': 'rgba(230, 164, 255, 0.3)',
                '--particle-opacity': '0.25'
            }
        },
        legacy: {
            name: 'Legacy',
            icon: '💎',
            description: 'Classic dark mode',
            type: 'dark',
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
        sandstone: {
            name: 'Sandstone',
            icon: '🏜️',
            description: 'Warm desert beige',
            type: 'light',
            colors: {
                '--bg-primary': '#FAF6F1',
                '--bg-secondary': '#F0E8DC',
                '--bg-card': 'rgba(255, 255, 255, 0.85)',
                '--text-primary': '#3D2B1F',
                '--text-secondary': '#6B5344',
                '--text-muted': '#9C8575',
                '--border-color': 'rgba(156, 133, 117, 0.25)',
                '--primary': '#FC2A0D',
                '--secondary': '#FD6C71',
                '--accent': '#E07B39',
                '--nav-bg': 'rgba(250, 246, 241, 0.95)',
                '--glow-color': 'rgba(224, 123, 57, 0.25)',
                '--particle-opacity': '0.25'
            }
        },
        champagne: {
            name: 'Champagne',
            icon: '🥂',
            description: 'Soft golden cream',
            type: 'light',
            colors: {
                '--bg-primary': '#FFFDF8',
                '--bg-secondary': '#FFF8E7',
                '--bg-card': 'rgba(255, 255, 255, 0.88)',
                '--text-primary': '#2D1F0E',
                '--text-secondary': '#5C4A2E',
                '--text-muted': '#8B7355',
                '--border-color': 'rgba(212, 165, 53, 0.2)',
                '--primary': '#FC2A0D',
                '--secondary': '#FD6C71',
                '--accent': '#D4A535',
                '--nav-bg': 'rgba(255, 253, 248, 0.95)',
                '--glow-color': 'rgba(212, 165, 53, 0.25)',
                '--particle-opacity': '0.2'
            }
        },
        zoom: {
            name: 'Zoom',
            icon: '💼',
            description: 'Clean professional blue',
            type: 'light',
            colors: {
                '--bg-primary': '#FFFFFF',
                '--bg-secondary': '#F3F8FF',
                '--bg-card': 'rgba(255, 255, 255, 0.92)',
                '--text-primary': '#00053D',
                '--text-secondary': '#696B6E',
                '--text-muted': '#8B8D91',
                '--border-color': 'rgba(11, 92, 255, 0.15)',
                '--primary': '#0B5CFF',
                '--secondary': '#6CB0FF',
                '--accent': '#8D5DF7',
                '--nav-bg': 'rgba(255, 255, 255, 0.95)',
                '--glow-color': 'rgba(11, 92, 255, 0.25)',
                '--particle-opacity': '0.15'
            }
        }
    };

    const STORAGE_KEY = 'cocreate-theme';
    const DEFAULT_THEME = 'ember';

    // Get current theme from localStorage
    function getStoredTheme() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            // Migration: if old theme key exists, migrate to new default
            if (!stored) {
                const oldTheme = localStorage.getItem('theme');
                if (oldTheme === 'dark' || oldTheme === 'midnight') {
                    return 'ember';
                } else if (oldTheme === 'light') {
                    return 'coral';
                } else if (oldTheme === 'dusk') {
                    return 'sunset';
                }
            }
            return stored || DEFAULT_THEME;
        } catch (e) {
            return DEFAULT_THEME;
        }
    }

    // Save theme to localStorage
    function saveTheme(theme) {
        try {
            localStorage.setItem(STORAGE_KEY, theme);
            // Also set old key for backwards compatibility during transition
            localStorage.setItem('theme', theme);
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

        // Update chat widget variables
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

        // Update body class for light/dark mode detection
        function updateBodyClass() {
            if (document.body) {
                document.body.classList.remove('theme-light', 'theme-dark');
                document.body.classList.add(`theme-${theme.type}`);
            }
        }

        if (document.body) {
            updateBodyClass();
        } else {
            // Body doesn't exist yet (script in <head>), defer until DOM ready
            document.addEventListener('DOMContentLoaded', updateBodyClass, { once: true });
        }

        // Dispatch event for other scripts to react
        window.dispatchEvent(new CustomEvent('themechange', {
            detail: {
                theme: themeName,
                colors: theme.colors,
                type: theme.type,
                name: theme.name
            }
        }));

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

        // Also save to backend if user is logged in
        saveThemeToBackend(themeName);
    }

    // Save theme to backend for cross-site sync
    async function saveThemeToBackend(themeName) {
        try {
            const guid = sessionStorage.getItem('userGuid') || localStorage.getItem('userGuid');
            const sessionToken = sessionStorage.getItem('sessionToken') || localStorage.getItem('sessionToken');

            if (!guid || !sessionToken) return; // Not logged in

            const API_URL = window.API_URL || 'https://qqbulxkmkl.execute-api.us-east-1.amazonaws.com/prod/chat';

            await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save-theme',
                    guid: guid,
                    sessionToken: sessionToken,
                    theme: themeName
                })
            });
        } catch (e) {
            console.warn('Could not save theme to backend:', e);
        }
    }

    // Apply theme from backend data
    function applyThemeFromBackend(themeName) {
        if (themeName && THEMES[themeName]) {
            saveTheme(themeName); // Save to localStorage
            applyTheme(themeName);
        }
    }

    // Get available themes
    function getThemes() {
        return Object.entries(THEMES).map(([key, value]) => ({
            id: key,
            name: value.name,
            icon: value.icon,
            description: value.description,
            type: value.type
        }));
    }

    // Get current theme info
    function getCurrentTheme() {
        const themeName = getStoredTheme();
        const theme = THEMES[themeName];
        return {
            id: themeName,
            ...theme
        };
    }

    // Check if current theme is light
    function isLightTheme() {
        const theme = THEMES[getStoredTheme()];
        return theme?.type === 'light';
    }

    // Expose globally
    window.ThemeManager = {
        init: initTheme,
        set: setTheme,
        get: getStoredTheme,
        apply: applyTheme,
        applyFromBackend: applyThemeFromBackend,
        saveToBackend: saveThemeToBackend,
        themes: getThemes,
        current: getCurrentTheme,
        isLight: isLightTheme,
        THEMES: THEMES
    };

    // Auto-initialize immediately to prevent FOUC
    initTheme();
})();
