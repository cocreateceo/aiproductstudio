# Form Submission Validation - Design

**Date:** 2026-01-27
**Status:** Approved

## Overview

Add validation to prevent invalid form submissions. Validates email (format + domain), name (realistic, not gibberish), and product idea (coherent business concept).

## Requirements

- Validate on **both frontend AND backend** (defense in depth)
- **Email:** Format check + domain MX record verification
- **Name:** Basic character rules + AI gibberish detection
- **Product Idea:** AI coherence check (no word minimum)
- **On failure:** Block submission + AI guides user to fix
- **Timing:** Real-time as user provides info in chat

## Validation Flow

```
User provides info in chat
    ↓
Frontend quick check (format/chars)
    ↓ (if passes)
Backend API validates
    ↓ (if passes)
AI checks (gibberish/coherence)
    ↓ (if passes)
Accept and continue
    ↓ (if fails at any step)
Block + AI explains issue and asks for correction
```

## Implementation

### 1. Email Validation

**Frontend (chat-loader.js):**
```javascript
function isValidEmailFormat(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}
```

**Backend (index.mjs):**
```javascript
import dns from 'dns';
import { promisify } from 'util';

const resolveMx = promisify(dns.resolveMx);

async function validateEmail(email) {
  // 1. Format check
  const formatRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!formatRegex.test(email)) {
    return { valid: false, reason: 'invalid_format' };
  }

  // 2. Extract domain
  const domain = email.split('@')[1];

  // 3. MX record lookup
  try {
    const mxRecords = await resolveMx(domain);
    if (!mxRecords || mxRecords.length === 0) {
      return { valid: false, reason: 'invalid_domain' };
    }
  } catch (error) {
    return { valid: false, reason: 'invalid_domain' };
  }

  return { valid: true };
}
```

**Error messages:**
- `invalid_format` → "That email doesn't look quite right. Could you check the format? (e.g., name@company.com)"
- `invalid_domain` → "I couldn't verify that email domain. Could you double-check the spelling or try a different email?"

### 2. Name Validation

**Frontend (chat-loader.js):**
```javascript
function isValidNameFormat(name) {
  // Min 2 chars, allows letters, spaces, hyphens, apostrophes
  // Supports international characters
  const regex = /^[\p{L}\s'-]{2,}$/u;

  // No numbers
  if (/\d/.test(name)) return false;

  return regex.test(name.trim());
}
```

**Backend - AI Prompt Addition (index.mjs):**
```
When user provides their name, evaluate if it's a realistic human name.

REJECT names that are:
- Keyboard mashing: "asdfgh", "qwerty", "zxcvbn"
- Repeated characters: "aaaa", "abcabc"
- Obvious test inputs: "test", "fake", "none", "na", "xxx"
- Single words that aren't names: "hello", "yes", "null"

ACCEPT names that are:
- Common names in any culture/language
- Names with hyphens, apostrophes, spaces
- Uncommon but plausible names

If name seems invalid, respond:
"That doesn't look like a real name. Could you please provide your actual name so we can personalize your experience?"
```

### 3. Product Idea Validation

**Backend - AI Prompt Addition (index.mjs):**
```
When user provides their product idea, evaluate if it's a coherent business/product concept.

REJECT ideas that are:
- Gibberish or random text: "asdfasdf", "test idea", "blah blah"
- Completely off-topic: "I like pizza", "What's the weather"
- Empty or placeholder: "TBD", "will fill later", "idea here"
- Single unrelated words: "money", "success", "app"

ACCEPT ideas that are:
- A describable product or service concept
- Related to business/technology/solving a problem
- Brief but coherent: "AI tool for restaurant menu pricing" is fine
- Ambitious but logical: "Platform connecting farmers to restaurants"

If idea seems invalid, respond:
"I'd love to hear more about your product idea! Could you describe what problem it solves or what it does? Even a brief description like 'an app that helps X do Y' works great."
```

### 4. Integration

**Key behavior:**
- Invalid data is **never** sent to form via FORM_DATA marker
- User cannot submit until all validations pass
- AI guides user conversationally to fix issues
- No separate API calls - validation piggybacks on existing chat

**Validation failure flow:**
```
User: "I'm asdfgh and email is fake@notreal.xyz"
    ↓
Backend validates email → MX lookup FAILS
Claude evaluates name → gibberish DETECTED
    ↓
Response: "I noticed a couple of issues:
- The email domain 'notreal.xyz' doesn't appear to be valid
- 'asdfgh' doesn't look like a real name
Could you provide your actual name and a working email?"
    ↓
NO FORM_DATA sent (form not filled with invalid data)
```

## Files to Modify

| File | Changes |
|------|---------|
| `chat-backend/index.mjs` | Add `validateEmail()` with MX lookup, update system prompt |
| `site/js/chat-loader.js` | Add frontend format/character checks |
| `local-dev/server.js` | Mirror validation logic for local dev |

## Dependencies

- None new - uses Node.js built-in `dns` module for MX lookup

## Scope

- ~50 lines: Email validation function with MX lookup
- ~30 lines: Frontend format checks
- ~40 lines: System prompt additions
- ~20 lines: Error response handling
- **Total: ~140 lines across 3 files**
