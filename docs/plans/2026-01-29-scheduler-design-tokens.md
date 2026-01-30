# Scheduler Design Tokens

> Design system tokens for the CoCreate custom scheduler, based on the new brand identity.

---

## Color Palette

### Core Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-primary` | `#0a0a0a` | Page background |
| `--bg-secondary` | `#141414` | Cards, sections |
| `--bg-tertiary` | `#1a1a1a` | Input fields, hover states |
| `--bg-hover` | `#242424` | Hover backgrounds |

### Accent Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--primary` | `#e07830` | Primary buttons, selected states, links |
| `--primary-hover` | `#f08840` | Button hover |
| `--primary-light` | `#f8a060` | Subtle highlights |
| `--secondary` | `#c04820` | Darker accent, gradients |

### Gradient

```css
--gradient-primary: linear-gradient(135deg, #e07830, #c04820);
--gradient-warm: linear-gradient(135deg, #f08840, #e07830, #c04820);
```

### Text Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--text-primary` | `#ffffff` | Headings, primary text |
| `--text-secondary` | `#9a9a9a` | Labels, secondary text |
| `--text-disabled` | `#505050` | Disabled states |
| `--text-on-primary` | `#ffffff` | Text on accent buttons |

### Border Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--border-color` | `#2a2a2a` | Default borders |
| `--border-hover` | `#3a3a3a` | Hover state borders |
| `--border-active` | `#e07830` | Active/selected borders |

### Status Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--success` | `#10b981` | Success states, confirmations |
| `--error` | `#ef4444` | Error states |
| `--warning` | `#f59e0b` | Warning states |

---

## Typography

### Font Family

```css
--font-display: 'Inter', system-ui, sans-serif;
--font-body: 'Inter', system-ui, sans-serif;
```

> Note: The brand mockup uses a custom futuristic font for headlines. If available, replace `--font-display` with the custom font. Inter serves as a clean fallback.

### Font Sizes

| Token | Size | Usage |
|-------|------|-------|
| `--text-xs` | `0.75rem` | Small labels |
| `--text-sm` | `0.875rem` | Secondary text, inputs |
| `--text-base` | `1rem` | Body text |
| `--text-lg` | `1.125rem` | Large body |
| `--text-xl` | `1.25rem` | Section headers |
| `--text-2xl` | `1.5rem` | Page headers |
| `--text-3xl` | `1.875rem` | Hero text |

### Font Weights

| Token | Weight | Usage |
|-------|--------|-------|
| `--font-normal` | `400` | Body text |
| `--font-medium` | `500` | Labels, buttons |
| `--font-semibold` | `600` | Section headers |
| `--font-bold` | `700` | Page headers |

---

## Spacing

| Token | Size | Usage |
|-------|------|-------|
| `--space-1` | `0.25rem` | Minimal spacing |
| `--space-2` | `0.5rem` | Tight spacing |
| `--space-3` | `0.75rem` | Compact spacing |
| `--space-4` | `1rem` | Default spacing |
| `--space-5` | `1.25rem` | Comfortable spacing |
| `--space-6` | `1.5rem` | Section spacing |
| `--space-8` | `2rem` | Large spacing |

---

## Border Radius

| Token | Size | Usage |
|-------|------|-------|
| `--radius-sm` | `6px` | Small elements, inputs |
| `--radius-md` | `8px` | Buttons, cards |
| `--radius-lg` | `12px` | Large cards, sections |
| `--radius-xl` | `16px` | Hero elements |
| `--radius-full` | `9999px` | Pills, circular |

---

## Shadows

```css
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.5);
--shadow-md: 0 4px 6px rgba(0, 0, 0, 0.5);
--shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.5);
--shadow-glow: 0 0 20px rgba(224, 120, 48, 0.3);
```

---

## Component Tokens

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: var(--gradient-primary);
  color: var(--text-on-primary);
  border: none;
  border-radius: var(--radius-md);
  padding: 0.75rem 1.5rem;
  font-weight: var(--font-semibold);
}

.btn-primary:hover {
  filter: brightness(1.1);
  box-shadow: var(--shadow-glow);
}

/* Secondary Button */
.btn-secondary {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
}

.btn-secondary:hover {
  background: var(--bg-hover);
  border-color: var(--border-hover);
}
```

### Form Inputs

```css
input, textarea, select {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  padding: 0.625rem 0.75rem;
}

input:focus, textarea:focus, select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(224, 120, 48, 0.2);
}
```

### Cards

```css
.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 1.25rem;
}
```

---

## Calendar Specific

### Available Date

```css
.calendar-day.available {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  cursor: pointer;
}

.calendar-day.available:hover {
  background: var(--primary);
  color: var(--text-on-primary);
}
```

### Selected Date

```css
.calendar-day.selected {
  background: var(--primary);
  color: var(--text-on-primary);
  border: 2px solid var(--primary);
}
```

### Disabled Date

```css
.calendar-day.disabled {
  color: var(--text-disabled);
  cursor: not-allowed;
}
```

### Time Slot

```css
.timeslot {
  background: var(--bg-tertiary);
  border: 2px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 0.75rem 1rem;
  cursor: pointer;
}

.timeslot:hover {
  border-color: var(--primary);
}

.timeslot.selected {
  background: var(--primary);
  color: var(--text-on-primary);
  border-color: var(--primary);
}
```

---

## Logo

The CoCreate logo should be used in white on dark backgrounds.

**Logo file:** `/design/logo1.png`

**Header usage:**
```html
<a href="index.html" class="flex items-center gap-2">
  <img src="assets/logo-white.svg" alt="CoCreate" class="h-8">
</a>
```

---

## Reference

Based on design mockup: `/design/Desktop - 6.png`

Brand identity files:
- `/design/logo1.png` - Logo with background
- `/design/Frame 21.png` - Logo frame
- `/design/Desktop - 6.png` - Website mockup
