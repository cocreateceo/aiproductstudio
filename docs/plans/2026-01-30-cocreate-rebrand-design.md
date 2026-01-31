# CoCreate Full Rebrand - Design Document

## Overview

Transform the AI-Powered Product Studio landing page into the CoCreate brand identity based on Figma design assets. Replace existing themes with warm gradient-based themes while preserving the current design as a "Legacy" option.

## Design Decisions

### Brand Identity
- **Name**: CoCreate
- **Logo**: Interlocking "C" with orbit symbol (from `Frame 9.png`)
- **Tagline**: "AI-Powered Product Studio" as subtitle

### Color Palette (from Figma)
```
Primary Colors:
- Vibrant Red-Orange: #FC2A0D
- Coral Red: #FD6C71
- Soft Coral: #FE9F7D
- Warm Peach: #FFC36A

Supporting:
- Cream/Off-white: #FFF8F0
- Deep Amber: #8B2500
- Text on dark: #FFFFFF
- Text on light: #1A1A1A
```

### Typography
- **Display Font**: Outfit (Google Fonts) - geometric, modern, confident
- **Body Font**: DM Sans (Google Fonts) - clean, readable
- **Weights**: 300, 400, 500, 600, 700

### Theme System

Replace existing 4 themes with:

#### 1. Ember (Default - Dark Warm)
- Deep amber/burnt orange gradient background
- White text on dark
- Dramatic, premium feel
- CSS gradient: `radial-gradient(ellipse at 30% 20%, #FFC36A 0%, transparent 50%), radial-gradient(ellipse at 70% 60%, #FC2A0D 0%, transparent 50%), radial-gradient(ellipse at 50% 90%, #8B2500 0%, transparent 60%), #1A0A00`

#### 2. Coral (Light Warm)
- Soft coral-to-cream gradient
- Dark text on light
- Inviting, approachable
- CSS gradient: `radial-gradient(ellipse at 20% 30%, #FE9F7D 0%, transparent 40%), radial-gradient(ellipse at 80% 70%, #FD6C71 0%, transparent 45%), #FFF8F0`

#### 3. Sunset (Vibrant)
- Pink/magenta-to-orange gradient
- White text
- Energetic, bold
- CSS gradient: `radial-gradient(ellipse at 30% 40%, #FF6B9D 0%, transparent 50%), radial-gradient(ellipse at 70% 30%, #FFC36A 0%, transparent 45%), radial-gradient(ellipse at 50% 80%, #C084FC 0%, transparent 50%), #2D1B3D`

#### 4. Aurora (Soft)
- Pink/lavender mesh gradient
- Dark text on light areas
- Dreamy, creative
- CSS gradient: `radial-gradient(ellipse at 40% 20%, #FFB6C1 0%, transparent 45%), radial-gradient(ellipse at 60% 70%, #E6A4FF 0%, transparent 50%), radial-gradient(ellipse at 20% 80%, #FFC36A 0%, transparent 40%), #FFF5F8`

#### 5. Legacy (Backup)
- Current dark indigo/violet theme
- Preserved for users who prefer original
- All existing CSS variables maintained

### Background Implementation

CSS Mesh Gradients with:
- Multiple `radial-gradient` layers
- Subtle animation on gradient positions (CSS `@keyframes`)
- Optional grain/noise texture overlay via SVG filter
- Removes Three.js canvas dependency for lighter weight

### Navigation

Clean uppercase style matching Figma:
- Logo left-aligned
- Nav links: uppercase, letter-spacing 0.05em
- Font-size: 0.8125rem (13px)
- Hover: subtle underline or color shift
- Mobile: slide-out drawer

### Animation Strategy

- **Page Load**: Staggered fade-in reveals (GSAP ScrollTrigger retained)
- **Gradient**: Subtle position shift animation (20s loop, ease-in-out)
- **Hover States**: Scale + shadow transitions
- **Scroll**: Parallax-lite effect on gradient layers

### Allure Sub-brand

- Dedicated section in footer or separate `/brands` page
- Uses pink/red palette variant from `Colour Palette-1.png`
- Can be expanded later

## File Structure Changes

```
site/
├── css/
│   ├── themes/
│   │   ├── ember.css      (new)
│   │   ├── coral.css      (new)
│   │   ├── sunset.css     (new)
│   │   ├── aurora.css     (new)
│   │   └── legacy.css     (current dark theme)
│   └── cocreate-base.css  (new - shared styles)
├── js/
│   └── theme.js           (updated with new themes)
├── assets/
│   └── cocreate-logo.svg  (new)
└── index.html             (updated)
```

## Implementation Plan

### Task 1: Create Theme CSS Files
- Create `css/themes/` directory
- Create `ember.css` with CSS variables and gradient
- Create `coral.css`
- Create `sunset.css`
- Create `aurora.css`
- Create `legacy.css` (copy current dark theme)

**Verification**: Each CSS file loads without errors

### Task 2: Update Theme System
- Update `js/theme.js` with new theme definitions
- Add gradient animation keyframes
- Update theme switcher UI for new theme names/icons
- Set Ember as default

**Verification**: Theme switching works, gradients render

### Task 3: Typography Update
- Add Outfit and DM Sans from Google Fonts
- Update Tailwind config for new font families
- Replace Inter references throughout
- Update heading/body font-family rules

**Verification**: New fonts render correctly

### Task 4: Logo Integration
- Create `cocreate-logo.svg` from PNG asset
- Update header with new logo
- Update favicon
- Update page title and meta tags

**Verification**: Logo displays, favicon shows

### Task 5: Navigation Restyle
- Update nav to uppercase style
- Adjust letter-spacing and font-size
- Update hover states
- Test mobile menu

**Verification**: Nav matches Figma style

### Task 6: Hero Section Rebrand
- Update hero headline and tagline
- Apply gradient background
- Add gradient animation
- Remove Three.js canvas (optional - can keep as enhancement)

**Verification**: Hero renders with new branding

### Task 7: Content Sections Update
- Update section backgrounds to use theme gradients
- Adjust text colors for contrast
- Update button styles to CoCreate palette
- Review all sections for consistency

**Verification**: All sections readable, consistent styling

### Task 8: Final Polish
- Test all 5 themes
- Test responsive breakpoints
- Performance check (Lighthouse)
- Cross-browser test

**Verification**: All themes work, responsive, performant

## Assets Required

From `/design/cocreate-figma/`:
- `Frame 9.png` - Logo reference (convert to SVG)
- `63e3d8cba331685663c3ac203aa12ca0 1.png` - Color palette reference
- `Vincent m_Poster Gradient_06*.jpg` - Gradient references for CSS recreation

## Risk Mitigation

1. **Legacy Preservation**: Current theme fully preserved as "Legacy"
2. **Incremental Rollout**: Can test themes individually
3. **Git Backup**: Create branch before changes
4. **Revert Path**: Single theme switch returns to original look

## Success Criteria

- [ ] All 5 themes functional and visually distinct
- [ ] CoCreate branding visible (logo, colors, typography)
- [ ] Gradient backgrounds smooth and performant
- [ ] Mobile responsive
- [ ] Theme persistence across pages
- [ ] Legacy theme matches current production exactly
