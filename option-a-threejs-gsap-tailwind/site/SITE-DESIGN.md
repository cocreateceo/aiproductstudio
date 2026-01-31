# CoCreate Site Design System

> **IMPORTANT**: This document defines the locked design system for CoCreate. Do not modify these core design elements without explicit user approval.

## Design Philosophy

CoCreate uses a **warm, premium, cinematic aesthetic** with:
- Deep amber/burnt orange color palette
- Dramatic background imagery (walking figure on horizon)
- Floating particle animations
- Glass-morphism UI elements
- Smooth theme transitions

---

## Core Design Elements (LOCKED)

### 1. Fixed Page Background

The site uses a **fixed full-viewport background** that stays visible while scrolling.

```css
/* Fixed Page Background - visible throughout entire page */
body::before {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: url('assets/cocreate_bg.png') center bottom / cover no-repeat;
    z-index: -2;
    pointer-events: none;
}

/* Fixed gradient overlay for readability */
body::after {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background:
        radial-gradient(ellipse 120% 100% at 50% 100%, transparent 30%, rgba(26, 10, 0, 0.6) 100%),
        linear-gradient(90deg, rgba(26, 10, 0, 0.65) 0%, rgba(26, 10, 0, 0.3) 40%, transparent 60%),
        linear-gradient(180deg, rgba(26, 10, 0, 0.5) 0%, transparent 40%);
    z-index: -1;
    pointer-events: none;
}
```

**Key files:**
- Background image: `assets/cocreate_bg.png`
- This CSS must be included in ALL HTML pages

---

### 2. Theme System

CoCreate has 5 themes managed by `js/theme.js`:

| Theme | Type | Primary Color | Description |
|-------|------|---------------|-------------|
| **Ember** (default) | Dark | `#FC2A0D` | Deep amber warmth |
| **Coral** | Light | `#FC2A0D` | Soft warm light |
| **Sunset** | Dark | `#FF6B9D` | Vibrant pink-orange |
| **Aurora** | Light | `#E6A4FF` | Soft dreamy pastels |
| **Legacy** | Dark | `#6366f1` | Classic indigo dark mode |

**Required CSS files (load in this order):**
```html
<link rel="stylesheet" href="css/themes/ember.css">
<link rel="stylesheet" href="css/themes/coral.css">
<link rel="stylesheet" href="css/themes/sunset.css">
<link rel="stylesheet" href="css/themes/aurora.css">
<link rel="stylesheet" href="css/themes/legacy.css">
<script src="js/theme.js"></script>
```

**Theme switching:**
- ThemeManager is exposed globally as `window.ThemeManager`
- Use `ThemeManager.set('themeName')` to change themes
- Theme persists in localStorage under key `cocreate-theme`

---

### 3. Typography

**Font Stack:**
- **Display/Headings**: `'Outfit', 'DM Sans', system-ui, sans-serif`
- **Body**: `'DM Sans', system-ui, sans-serif`

**Google Fonts include:**
```html
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
```

**Typography CSS:**
```css
body {
    font-family: 'DM Sans', system-ui, sans-serif;
}

h1, h2, h3, h4, h5, h6, .font-display {
    font-family: 'Outfit', 'DM Sans', system-ui, sans-serif;
    font-weight: 600;
    letter-spacing: -0.02em;
}

h1 {
    font-weight: 700;
    letter-spacing: -0.03em;
}
```

---

### 4. CSS Variables

All colors use CSS variables for theme support:

```css
:root {
    --bg-primary: /* Theme background */
    --bg-secondary: /* Secondary background */
    --bg-card: /* Card/glass background */
    --text-primary: /* Main text color */
    --text-secondary: /* Secondary text */
    --text-muted: /* Muted/subtle text */
    --border-color: /* Border colors */
    --primary: /* Primary accent */
    --secondary: /* Secondary accent */
    --accent: /* Tertiary accent */
    --nav-bg: /* Navigation background */
    --glow-color: /* Glow/shadow effects */
    --particle-opacity: /* Particle system opacity */
}
```

---

### 5. Glass-morphism Cards

```css
.glass-card {
    background: var(--bg-card);
    backdrop-filter: blur(20px);
    border: 1px solid var(--border-color);
    transition: background 0.4s ease, border-color 0.4s ease;
}
```

---

### 6. Gradient Text

```css
.gradient-text {
    background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 50%, var(--accent) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}
```

---

### 7. CTA Buttons

```css
.cta-button {
    background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
}

.cta-button::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
    transition: left 0.5s ease;
}

.cta-button:hover::before {
    left: 100%;
}

.cta-button:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 40px var(--glow-color);
}
```

---

### 8. CoCreate Logo SVG

```html
<svg class="w-10 h-10" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
        <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:var(--accent, #FFC36A)"/>
            <stop offset="50%" style="stop-color:var(--secondary, #FD6C71)"/>
            <stop offset="100%" style="stop-color:var(--primary, #FC2A0D)"/>
        </linearGradient>
    </defs>
    <g transform="translate(4, 4)">
        <path d="M20 0C8.954 0 0 8.954 0 20s8.954 20 20 20c5.523 0 10.523-2.239 14.142-5.858"
              stroke="url(#logoGradient)" stroke-width="3.5" fill="none" stroke-linecap="round"/>
        <ellipse cx="20" cy="20" rx="26" ry="10"
                 stroke="url(#logoGradient)" stroke-width="2" fill="none"
                 transform="rotate(-30, 20, 20)"/>
        <circle cx="42" cy="12" r="3.5" fill="url(#logoGradient)"/>
    </g>
</svg>
```

---

## File Structure

```
site/
├── assets/
│   ├── cocreate_bg.png      # Main background image (LOCKED)
│   ├── cocreate-logo.svg
│   └── cocreate-icon.svg
├── css/
│   ├── themes/
│   │   ├── ember.css        # Default theme
│   │   ├── coral.css        # Light theme
│   │   ├── sunset.css       # Pink/purple dark
│   │   ├── aurora.css       # Pastel light
│   │   └── legacy.css       # Classic indigo
│   ├── chat-widget.css
│   ├── responsive.css
│   └── scheduler.css
├── js/
│   ├── theme.js             # Theme management (LOCKED)
│   ├── config.js            # Environment config
│   ├── chat-widget.js
│   └── chat-loader.js
└── *.html                   # All pages use same design system
```

---

## Required HTML Head Template

Every HTML page must include:

```html
<!DOCTYPE html>
<html lang="en" data-theme="ember">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" type="image/svg+xml" href="favicon.svg">
    <title>Page Title | CoCreate AI</title>

    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        primary: 'var(--primary)',
                        secondary: 'var(--secondary)',
                        accent: 'var(--accent)',
                    },
                    fontFamily: {
                        sans: ['DM Sans', 'system-ui', 'sans-serif'],
                        display: ['Outfit', 'DM Sans', 'system-ui', 'sans-serif'],
                    }
                }
            }
        }
    </script>

    <!-- Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">

    <!-- CoCreate Theme CSS -->
    <link rel="stylesheet" href="css/themes/ember.css">
    <link rel="stylesheet" href="css/themes/coral.css">
    <link rel="stylesheet" href="css/themes/sunset.css">
    <link rel="stylesheet" href="css/themes/aurora.css">
    <link rel="stylesheet" href="css/themes/legacy.css">

    <!-- Theme System (MUST be before any rendering) -->
    <script src="js/theme.js"></script>

    <style>
        /* Fixed Page Background */
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: url('assets/cocreate_bg.png') center bottom / cover no-repeat;
            z-index: -2;
            pointer-events: none;
        }

        body::after {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background:
                radial-gradient(ellipse 120% 100% at 50% 100%, transparent 30%, rgba(26, 10, 0, 0.6) 100%),
                linear-gradient(90deg, rgba(26, 10, 0, 0.65) 0%, rgba(26, 10, 0, 0.3) 40%, transparent 60%),
                linear-gradient(180deg, rgba(26, 10, 0, 0.5) 0%, transparent 40%);
            z-index: -1;
            pointer-events: none;
        }

        /* Base styles */
        body {
            font-family: 'DM Sans', system-ui, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
        }

        h1, h2, h3, h4, h5, h6, .font-display {
            font-family: 'Outfit', 'DM Sans', system-ui, sans-serif;
            font-weight: 600;
            letter-spacing: -0.02em;
        }

        .gradient-text {
            background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 50%, var(--accent) 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .glass-card {
            background: var(--bg-card);
            backdrop-filter: blur(20px);
            border: 1px solid var(--border-color);
        }
    </style>
</head>
```

---

## Changelog

- **2026-01-31**: Initial design system locked
  - Fixed background with walking figure
  - 5-theme system (Ember, Coral, Sunset, Aurora, Legacy)
  - Glass-morphism cards
  - Gradient text effects
  - Theme persistence via ThemeManager

---

## DO NOT MODIFY

The following elements are **locked** and should not be changed:

1. `assets/cocreate_bg.png` - Background image
2. `js/theme.js` - Theme management system
3. Fixed background CSS (body::before, body::after)
4. Theme color definitions in `css/themes/*.css`
5. Typography font stack (Outfit + DM Sans)
6. CoCreate logo SVG structure
