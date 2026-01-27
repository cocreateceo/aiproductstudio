# Chat Minimize on Page Navigation - Design

**Date:** 2026-01-27
**Status:** Approved

## Overview

Change the chat widget behavior so it always starts minimized (toggle button only) when navigating between pages, with a subtle dot indicator showing when an existing conversation is available.

## Requirements

- Chat starts **minimized** (toggle button only) on every page load
- **Subtle green dot** indicator on toggle button when conversation exists
- **Instant open** when clicked (current behavior preserved)
- Applies to **all pages** (landing, apply, admin)
- Conversation **restored from localStorage** when opened
- First-time visitors also see minimized state

## Approach

**Force Close on Load** - Always set `isOpen: false` in the ChatWidget constructor regardless of saved state. The conversation data remains in localStorage; only the visual state changes.

## Implementation

### File 1: `site/js/chat-widget.js`

#### Change 1: Force `isOpen: false` on load

In constructor (around line 57), change:

```javascript
// Before
isOpen: savedState.isOpen !== undefined ? savedState.isOpen : this.config.startOpen,

// After
isOpen: false,  // Always start minimized
```

#### Change 2: Remove constructor welcome message

Remove lines ~97-104:

```javascript
// REMOVE this block
if (this.state.isOpen && currentPageMessages.length === 0) {
    console.log('[ChatWidget] Chat starts open with no current page messages, adding welcome message');
    setTimeout(() => {
        this.addMessage('assistant', this.config.welcomeMessage, true);
    }, 300);
}
```

The `toggle()` method already handles welcome messages on first open.

#### Change 3: Add conversation check method

Add after line ~90:

```javascript
hasExistingConversation() {
    return this.state.messages.length > 0;
}
```

#### Change 4: Show dot indicator after render

In constructor, after `this.bindEvents()` call, add:

```javascript
// Show dot indicator if conversation exists
if (this.hasExistingConversation()) {
    this.elements.badge.style.display = 'flex';
    this.elements.badge.textContent = '';
    this.elements.badge.classList.add('dot-indicator');
}
```

#### Change 5: Hide dot when chat opens

In `toggle()` method, inside the `if (this.state.isOpen)` block, add:

```javascript
// Hide conversation indicator
this.elements.badge.style.display = 'none';
this.elements.badge.classList.remove('dot-indicator');
```

### File 2: `site/css/chat-widget.css`

Add dot indicator styles:

```css
/* Dot indicator for existing conversation */
.chat-badge.dot-indicator {
    width: 12px;
    height: 12px;
    min-width: 12px;
    padding: 0;
    font-size: 0;
    background: #22c55e;
    border: 2px solid var(--chat-bg, #1a1a2e);
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
}
```

## Files Not Changed

- `chat-loader.js` - no changes needed (`startOpen: false` already set)
- HTML files - no changes needed
- Backend files - no changes needed

## Behavior Summary

| Scenario | Result |
|----------|--------|
| New visitor, first page | Toggle button only, no dot |
| Clicks toggle (first time) | Chat opens, welcome message appears |
| Navigates to another page | Chat minimizes, green dot shows |
| Clicks toggle (has conversation) | Chat opens instantly, conversation restored |
| Returns after closing browser (<24hrs) | Toggle with green dot, conversation restored |
| Clears chat, then navigates | Toggle button only, no dot |

## Scope

- ~20 lines JavaScript changes
- ~10 lines CSS additions
- 2 files modified
