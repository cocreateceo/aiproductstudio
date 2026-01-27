# AI Agent Form Validation - Design Document

> **For Claude:** Use superpowers:writing-plans to create implementation plan from this design.

**Goal:** Replace hybrid form validation (regex + MX + AI) with unified AI-powered validation agent.

**Problem Solved:**
- **Consistency** - Same validation logic for chat and direct form (currently different)
- **Smarter detection** - Pattern-based validation misses nuanced gibberish/spam
- **Simpler code** - One validation system instead of two

---

## Architecture Overview

```
User fills form → Submit → Backend receives JSON
                              ↓
                    mode: "validate" detected
                              ↓
                    AI validates core 3 fields
                              ↓
              ┌─────────────────┴─────────────────┐
              ↓                                   ↓
        Validation PASS                    Validation FAIL
              ↓                                   ↓
        Save to S3                         Return errors
        Send email                                ↓
              ↓                            Frontend fills back
        Return success                     valid fields, shows
              ↓                            error messages
        Show Calendly                             ↓
                                           User corrects
                                           and resubmits
```

---

## Request/Response Format

### Request (Frontend → Backend)

```json
{
  "mode": "validate",
  "formData": {
    "name": "John Smith",
    "email": "john@company.com",
    "phone": "+1 555 123 4567",
    "linkedin": "linkedin.com/in/johnsmith",
    "businessStage": "idea",
    "industry": "saas",
    "background": "10 years in sales...",
    "productIdea": "An AI scheduling tool...",
    "targetCustomer": "Enterprise teams",
    "marketValidation": "Talked to 20 prospects",
    "timeCommitment": "fulltime",
    "timeline": "immediately",
    "additionalInfo": ""
  }
}
```

### Response - Validation Failed (Backend → Frontend)

```json
{
  "success": false,
  "fields": {
    "name": { "valid": true, "value": "John Smith" },
    "email": { "valid": false, "value": "", "error": "This email domain doesn't appear to exist." },
    "productIdea": { "valid": true, "value": "An AI scheduling tool..." },
    "phone": { "value": "+1 555 123 4567" },
    "linkedin": { "value": "linkedin.com/in/johnsmith" },
    "businessStage": { "value": "idea" },
    "industry": { "value": "saas" },
    "background": { "value": "10 years in sales..." },
    "targetCustomer": { "value": "Enterprise teams" },
    "marketValidation": { "value": "Talked to 20 prospects" },
    "timeCommitment": { "value": "fulltime" },
    "timeline": { "value": "immediately" },
    "additionalInfo": { "value": "" }
  }
}
```

### Response - Validation Passed (Backend → Frontend)

```json
{
  "success": true,
  "fields": { ... },
  "message": "Application submitted successfully"
}
```

**Notes:**
- Core 3 fields (name, email, productIdea) have `valid` + `error` properties
- Other fields pass through with `value` only
- `success: true` only when all 3 core validations pass

---

## AI System Prompt

```
You are a form validation agent. You receive form data as JSON and validate specific fields.

VALIDATION RULES:

1. NAME - Validate for:
   - Must be at least 2 characters
   - No numbers allowed
   - Detect gibberish (asdf, qwerty, aasdjf)
   - Detect fake names (test, admin, user, none)
   - Detect keyboard mashing patterns
   If invalid: set valid=false, value="", provide helpful error message

2. EMAIL - Validate for:
   - Must be valid email format (name@domain.com)
   - Detect gibberish emails (asdf@asdf.com)
   - Detect obviously fake domains (test.com, fake.com, example.com)
   - Detect disposable email providers (tempmail, guerrillamail, etc.)
   If invalid: set valid=false, value="", provide helpful error message

3. PRODUCT IDEA - Validate for:
   - Must describe a real product or service concept
   - Reject gibberish, off-topic text, placeholder text
   - Accept brief but coherent ideas
   If invalid: set valid=false, value="", provide helpful error message

OTHER FIELDS: Pass through unchanged with just "value" property.

RESPONSE FORMAT: Return ONLY valid JSON. No explanation text.

Set "success": true only if all 3 validations pass.
```

---

## Backend Changes (index.mjs)

### Add mode check at start of Lambda handler:

```javascript
// Check for validation mode
if (body.mode === 'validate' && body.formData) {
    return await handleFormValidation(body.formData, body.visitorInfo);
}

// ... existing chat flow continues
```

### New function - handleFormValidation():

```javascript
async function handleFormValidation(formData, visitorInfo) {
    const systemPrompt = `You are a form validation agent...`; // Full prompt above

    const userMessage = `Validate this form data and return JSON response:
${JSON.stringify(formData, null, 2)}`;

    try {
        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }]
        });

        // Parse AI response
        const validationResult = JSON.parse(response.content[0].text);

        if (!validationResult.success) {
            // Return validation errors - don't save
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify(validationResult)
            };
        }

        // Validation passed → Save to S3, send email
        await saveApplicationToS3(formData, visitorInfo);
        await sendEmailNotification(formData);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                fields: validationResult.fields,
                message: 'Application submitted successfully'
            })
        };
    } catch (error) {
        console.error('Validation error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, error: 'Validation service error' })
        };
    }
}
```

---

## Frontend Changes (apply.html)

### Update form submit handler:

```javascript
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (isSubmitting) return;
    isSubmitting = true;

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Validating...';

    // Collect all form data as JSON
    const formData = {
        name: document.getElementById('fullName').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value || '',
        linkedin: document.getElementById('linkedin').value || '',
        businessStage: document.getElementById('businessStage').value,
        industry: document.getElementById('industry').value,
        background: document.getElementById('background').value,
        productIdea: document.getElementById('productIdea').value,
        targetCustomer: document.getElementById('targetCustomer').value,
        marketValidation: document.getElementById('marketValidation').value || '',
        timeCommitment: document.getElementById('timeCommitment').value,
        timeline: document.getElementById('timeline').value,
        additionalInfo: document.getElementById('additionalInfo').value || ''
    };

    try {
        const response = await fetch(CHAT_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'validate', formData })
        });

        const result = await response.json();

        if (result.success) {
            // All valid → show success/Calendly
            formContainer.classList.add('hidden');
            successMessage.classList.remove('hidden');
        } else {
            // Fill back valid fields, show errors for invalid
            handleValidationResult(result.fields);
        }
    } catch (error) {
        console.error('Submission error:', error);
        alert('Error submitting form. Please try again.');
    } finally {
        isSubmitting = false;
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
    }
});

function handleValidationResult(fields) {
    // Clear all previous errors
    document.querySelectorAll('.validation-error').forEach(el => el.remove());
    document.querySelectorAll('.form-input, .form-textarea, .form-select').forEach(el => {
        el.style.borderColor = '';
    });

    // Process each field
    for (const [fieldId, data] of Object.entries(fields)) {
        const field = document.getElementById(fieldId === 'name' ? 'fullName' : fieldId);
        if (!field) continue;

        if (data.valid === false) {
            // Invalid: clear field, show error
            field.value = '';
            field.style.borderColor = '#ef4444';

            const errorDiv = document.createElement('div');
            errorDiv.className = 'validation-error text-red-500 text-sm mt-1';
            errorDiv.textContent = data.error;
            field.parentNode.appendChild(errorDiv);
        } else if (data.value !== undefined) {
            // Valid or pass-through: fill value
            field.value = data.value;
        }
    }

    // Scroll to first error
    const firstError = document.querySelector('.validation-error');
    if (firstError) {
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}
```

---

## What Gets Removed

After implementing this design, remove:
- Frontend validation functions: `validateName()`, `validateEmail()`, `validateProductIdea()`, `showFieldError()`, `clearFieldError()`, `validateForm()`
- Backend functions: `validateNamePatterns()`, `validateProductIdea()` (for form flow)
- Complex regex extraction of form fields from message text

---

## Design Decisions Summary

| Aspect | Decision |
|--------|----------|
| Endpoint | Reuse chat endpoint with `mode: "validate"` |
| Fields validated | Core 3: name, email, productIdea |
| Validation method | AI validates all 3 (no MX lookup) |
| Data sent to AI | All form fields (for context) |
| Response format | JSON with all fields |
| On success | Save to S3 + send email in same call |
| On failure | Return errors, frontend fills back valid fields |
| Latency tolerance | 1-2 seconds acceptable |

---

## Files to Modify

- `chat-backend/index.mjs` - Add `handleFormValidation()` function
- `site/apply.html` - Update form submit handler
- `local-dev/server.js` - Mirror backend changes for local development
