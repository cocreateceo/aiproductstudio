# Direct Form Submission Validation - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add hybrid validation (frontend + backend) for direct form submissions that bypass the AI assistant.

**Architecture:** Frontend JavaScript validates format/patterns on submit, blocking obviously invalid data. Backend validates email MX records and uses AI to check product idea coherence before saving.

**Tech Stack:** Vanilla JavaScript (frontend), Node.js with dns module (backend), Claude API (idea validation)

---

## Task 1: Add Frontend Validation Functions to apply.html

**Files:**
- Modify: `site/apply.html:763-832` (form submit handler)

**Step 1: Add validation helper functions before form submit handler**

Add this code at line 758 (before `// Form submission`):

```javascript
// ========== FORM VALIDATION ==========

// Validate name format and detect gibberish
function validateName(name) {
    if (!name || name.trim().length < 2) {
        return { valid: false, message: 'Please enter your full name (at least 2 characters).' };
    }

    const trimmed = name.trim();

    // No numbers allowed
    if (/\d/.test(trimmed)) {
        return { valid: false, message: 'Name should not contain numbers.' };
    }

    // Must contain at least one letter
    if (!/[a-zA-Z\u00C0-\u024F]/.test(trimmed)) {
        return { valid: false, message: 'Please enter a valid name.' };
    }

    // Detect keyboard mashing patterns
    const keyboardPatterns = /^(asdf|qwer|zxcv|jkl|fgh|test|fake|none|null|undefined|admin|user|hello|xxx|aaa|bbb)/i;
    if (keyboardPatterns.test(trimmed)) {
        return { valid: false, message: 'Please enter your real name.' };
    }

    // Detect repeated characters (aaa, abcabc)
    if (/(.)\1{2,}/.test(trimmed) || /(.{2,})\1+/.test(trimmed)) {
        return { valid: false, message: 'Please enter a valid name.' };
    }

    return { valid: true };
}

// Validate email format
function validateEmail(email) {
    if (!email || !email.trim()) {
        return { valid: false, message: 'Please enter your email address.' };
    }

    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!regex.test(email.trim())) {
        return { valid: false, message: 'Please enter a valid email address (e.g., name@company.com).' };
    }

    return { valid: true };
}

// Validate product idea (basic frontend check)
function validateProductIdea(idea) {
    if (!idea || !idea.trim()) {
        return { valid: false, message: 'Please describe your product idea.' };
    }

    const trimmed = idea.trim();

    // Minimum word count (at least 5 words)
    const wordCount = trimmed.split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount < 5) {
        return { valid: false, message: 'Please provide a bit more detail about your idea (at least a sentence or two).' };
    }

    // Detect placeholder/test inputs
    const placeholderPatterns = /^(test|tbd|n\/a|na|asdf|idea|none|later|todo|xxx|\.+|\?+)$/i;
    if (placeholderPatterns.test(trimmed)) {
        return { valid: false, message: 'Please describe your actual product idea.' };
    }

    // Detect gibberish (mostly non-letter characters or keyboard mashing)
    const letterRatio = (trimmed.match(/[a-zA-Z]/g) || []).length / trimmed.length;
    if (letterRatio < 0.5) {
        return { valid: false, message: 'Please describe your product idea in words.' };
    }

    return { valid: true };
}

// Show validation error on field
function showFieldError(fieldId, message) {
    const field = document.getElementById(fieldId);
    if (!field) return;

    // Remove existing error
    clearFieldError(fieldId);

    // Add error styling
    field.style.borderColor = '#ef4444';
    field.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.2)';

    // Add error message
    const errorDiv = document.createElement('div');
    errorDiv.id = `${fieldId}-error`;
    errorDiv.className = 'text-red-500 text-sm mt-1';
    errorDiv.textContent = message;
    field.parentNode.appendChild(errorDiv);
}

// Clear validation error from field
function clearFieldError(fieldId) {
    const field = document.getElementById(fieldId);
    if (!field) return;

    field.style.borderColor = '';
    field.style.boxShadow = '';

    const existingError = document.getElementById(`${fieldId}-error`);
    if (existingError) {
        existingError.remove();
    }
}

// Validate entire form
function validateForm() {
    let isValid = true;

    // Clear previous errors
    ['fullName', 'email', 'productIdea'].forEach(clearFieldError);

    // Validate name
    const nameResult = validateName(document.getElementById('fullName')?.value);
    if (!nameResult.valid) {
        showFieldError('fullName', nameResult.message);
        isValid = false;
    }

    // Validate email
    const emailResult = validateEmail(document.getElementById('email')?.value);
    if (!emailResult.valid) {
        showFieldError('email', emailResult.message);
        isValid = false;
    }

    // Validate product idea
    const ideaResult = validateProductIdea(document.getElementById('productIdea')?.value);
    if (!ideaResult.valid) {
        showFieldError('productIdea', ideaResult.message);
        isValid = false;
    }

    return isValid;
}
```

**Step 2: Update form submit handler to use validation**

Replace the form submit handler (starting at line ~763 after adding above code) to include validation:

Find this code:
```javascript
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Prevent multiple submissions
    if (isSubmitting) return;
    isSubmitting = true;

    // Show loading state
```

Replace with:
```javascript
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Prevent multiple submissions
    if (isSubmitting) return;

    // Frontend validation
    if (!validateForm()) {
        // Scroll to first error
        const firstError = document.querySelector('[id$="-error"]');
        if (firstError) {
            firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }

    isSubmitting = true;

    // Show loading state
```

**Step 3: Verify changes**

Open `http://localhost:3000/apply.html` and test:
- Submit with empty fields → should show errors
- Submit with "asdf" as name → should show "Please enter your real name"
- Submit with "test@" as email → should show invalid email error
- Submit with "test" as idea → should show "provide more detail" error

---

## Task 2: Add Backend Validation Function for Product Idea

**Files:**
- Modify: `chat-backend/index.mjs` (add after validateEmail function ~line 600)

**Step 1: Add AI-based product idea validation function**

Add this code after the `getEmailValidationMessage` function:

```javascript
// ========== PRODUCT IDEA VALIDATION ==========

// Validate product idea coherence using AI
async function validateProductIdea(idea) {
  if (!idea || idea.trim().length < 10) {
    return { valid: false, reason: 'too_short', message: 'Please provide more detail about your product idea.' };
  }

  const validationPrompt = `Evaluate if this is a coherent business/product idea. Respond with ONLY a JSON object.

PRODUCT IDEA: "${idea}"

REJECT if the idea is:
- Gibberish or random text (asdfasdf, xyz123)
- Completely off-topic (I like pizza, weather questions)
- Placeholder text (TBD, test, n/a, will fill later)
- Single unrelated words (money, success, app)
- Not describable as a product/service

ACCEPT if the idea is:
- A describable product or service concept
- Related to solving a problem or business need
- Brief but coherent (even "AI scheduling tool" is valid)

Respond with this exact JSON format:
{"valid": true} or {"valid": false, "reason": "brief explanation"}`;

  try {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [{ role: 'user', content: validationPrompt }]
    });

    const responseText = response.content[0].text.trim();
    console.log('Product idea validation response:', responseText);

    // Parse JSON response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      if (result.valid) {
        return { valid: true };
      } else {
        return {
          valid: false,
          reason: 'incoherent',
          message: result.reason || "Please describe a real product or service idea."
        };
      }
    }

    // Default to valid if parsing fails (don't block on errors)
    return { valid: true };
  } catch (error) {
    console.error('Product idea validation error:', error.message);
    // Don't block submission on validation errors
    return { valid: true };
  }
}
```

**Step 2: Verify function added**

Search for `validateProductIdea` in the file to confirm it exists.

---

## Task 3: Add Backend Name Validation Function

**Files:**
- Modify: `chat-backend/index.mjs` (add after validateProductIdea function)

**Step 1: Add pattern-based name validation function**

Add this code after the `validateProductIdea` function:

```javascript
// ========== NAME VALIDATION ==========

// Validate name using pattern detection (no AI needed)
function validateNamePatterns(name) {
  if (!name || name.trim().length < 2) {
    return { valid: false, reason: 'too_short', message: 'Name must be at least 2 characters.' };
  }

  const trimmed = name.trim();

  // No numbers allowed
  if (/\d/.test(trimmed)) {
    return { valid: false, reason: 'has_numbers', message: 'Name should not contain numbers.' };
  }

  // Must contain at least one letter
  if (!/[a-zA-Z\u00C0-\u024F]/.test(trimmed)) {
    return { valid: false, reason: 'no_letters', message: 'Please enter a valid name.' };
  }

  // Detect keyboard mashing patterns
  const keyboardPatterns = /^(asdf|qwer|zxcv|uiop|hjkl|fghj|test|fake|none|null|undefined|admin|user|hello|xxx|aaa|bbb|abc|qaz|wsx)/i;
  if (keyboardPatterns.test(trimmed.replace(/\s/g, ''))) {
    return { valid: false, reason: 'keyboard_pattern', message: 'Please enter your real name.' };
  }

  // Detect repeated characters (aaaa, abcabc)
  if (/(.)\1{3,}/.test(trimmed)) {
    return { valid: false, reason: 'repeated_chars', message: 'Please enter a valid name.' };
  }

  // Detect repeated patterns (abcabc, xyxy)
  if (/^(.{2,4})\1+$/.test(trimmed.replace(/\s/g, ''))) {
    return { valid: false, reason: 'repeated_pattern', message: 'Please enter a valid name.' };
  }

  return { valid: true };
}
```

**Step 2: Verify function added**

Search for `validateNamePatterns` in the file to confirm it exists.

---

## Task 4: Integrate Backend Validation into Form Submission Handler

**Files:**
- Modify: `chat-backend/index.mjs` (form submission section ~line 2445)

**Step 1: Find the form submission handler**

Search for `if (isFormSubmission) {` to find the section (around line 2445).

**Step 2: Add validation before saving**

Find this code block:
```javascript
    if (isFormSubmission) {
      console.log('Form submission detected - checking for duplicates...');

      // Check for duplicate application
      const duplicateCheck = await checkDuplicateApplication(
```

Replace with:
```javascript
    if (isFormSubmission) {
      console.log('Form submission detected - validating inputs...');

      // Extract form data from the submission message
      const formDataMatch = latestMessage.match(/Name:\s*(.+?)\n.*?Email:\s*(.+?)\n.*?Idea\/Background:\s*([\s\S]+?)$/i);
      const submittedName = formDataMatch?.[1]?.trim() || updatedVisitorInfo.name;
      const submittedEmail = formDataMatch?.[2]?.trim() || updatedVisitorInfo.email;
      const submittedIdea = formDataMatch?.[3]?.trim() || '';

      // Validate name
      const nameValidation = validateNamePatterns(submittedName);
      if (!nameValidation.valid) {
        console.log('Name validation failed:', nameValidation);
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'validation_failed',
            field: 'name',
            message: nameValidation.message || 'Please enter a valid name.',
            validationErrors: [{ field: 'fullName', message: nameValidation.message }]
          })
        };
      }

      // Validate email (MX check)
      const emailValidation = await validateEmail(submittedEmail);
      if (!emailValidation.valid) {
        console.log('Email validation failed:', emailValidation);
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'validation_failed',
            field: 'email',
            message: getEmailValidationMessage(emailValidation.reason),
            validationErrors: [{ field: 'email', message: getEmailValidationMessage(emailValidation.reason) }]
          })
        };
      }

      // Validate product idea (AI check)
      const ideaValidation = await validateProductIdea(submittedIdea);
      if (!ideaValidation.valid) {
        console.log('Product idea validation failed:', ideaValidation);
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'validation_failed',
            field: 'productIdea',
            message: ideaValidation.message || 'Please describe a valid product idea.',
            validationErrors: [{ field: 'productIdea', message: ideaValidation.message }]
          })
        };
      }

      console.log('All validations passed - checking for duplicates...');

      // Check for duplicate application
      const duplicateCheck = await checkDuplicateApplication(
```

**Step 3: Verify changes**

Search for `validating inputs` to confirm the new code is in place.

---

## Task 5: Update Frontend to Handle Validation Errors from Backend

**Files:**
- Modify: `site/apply.html` (form submit error handling ~line 821)

**Step 1: Update error handling to show backend validation errors**

Find this code:
```javascript
            } catch (error) {
                console.error('Form submission error:', error);
                alert('There was an error submitting your application. Please try again or contact us directly.');
```

Replace with:
```javascript
            const result = await response.json();

            // Check for validation errors from backend
            if (!response.ok || result.error === 'validation_failed') {
                console.log('Backend validation failed:', result);

                // Show field-specific errors
                if (result.validationErrors) {
                    result.validationErrors.forEach(err => {
                        showFieldError(err.field, err.message);
                    });

                    // Scroll to first error
                    const firstError = document.querySelector('[id$="-error"]');
                    if (firstError) {
                        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                } else {
                    alert(result.message || 'Please check your form inputs and try again.');
                }

                // Reset button
                isSubmitting = false;
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnText;
                submitBtn.style.opacity = '1';
                submitBtn.style.cursor = 'pointer';
                return;
            }

            // Success - show fullscreen Calendly
            formContainer.classList.add('hidden');
            } catch (error) {
                console.error('Form submission error:', error);
                alert('There was an error submitting your application. Please try again or contact us directly.');
```

**Step 2: Move success handling inside try block**

The success code (showing Calendly) should come after the validation check, before the catch block.

---

## Task 6: Mirror Changes to Local Dev Server

**Files:**
- Modify: `local-dev/server.js`

**Step 1: Add validateProductIdea function**

Add after the `validateEmail` function (around line 175):

```javascript
// Validate product idea coherence using AI
async function validateProductIdea(idea) {
  if (!idea || idea.trim().length < 10) {
    return { valid: false, reason: 'too_short', message: 'Please provide more detail about your product idea.' };
  }

  const validationPrompt = `Evaluate if this is a coherent business/product idea. Respond with ONLY a JSON object.

PRODUCT IDEA: "${idea}"

REJECT if the idea is:
- Gibberish or random text (asdfasdf, xyz123)
- Completely off-topic (I like pizza, weather questions)
- Placeholder text (TBD, test, n/a, will fill later)
- Single unrelated words (money, success, app)

ACCEPT if the idea is:
- A describable product or service concept
- Related to solving a problem or business need
- Brief but coherent

Respond with: {"valid": true} or {"valid": false, "reason": "explanation"}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [{ role: 'user', content: validationPrompt }]
    });

    const responseText = response.content[0].text.trim();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return result.valid ? { valid: true } : { valid: false, reason: 'incoherent', message: result.reason || "Please describe a real product idea." };
    }
    return { valid: true };
  } catch (error) {
    console.error('Product idea validation error:', error.message);
    return { valid: true }; // Don't block on errors
  }
}
```

**Step 2: Add validateNamePatterns function**

Add after validateProductIdea:

```javascript
// Validate name using pattern detection
function validateNamePatterns(name) {
  if (!name || name.trim().length < 2) {
    return { valid: false, reason: 'too_short', message: 'Name must be at least 2 characters.' };
  }

  const trimmed = name.trim();

  if (/\d/.test(trimmed)) {
    return { valid: false, reason: 'has_numbers', message: 'Name should not contain numbers.' };
  }

  if (!/[a-zA-Z\u00C0-\u024F]/.test(trimmed)) {
    return { valid: false, reason: 'no_letters', message: 'Please enter a valid name.' };
  }

  const keyboardPatterns = /^(asdf|qwer|zxcv|uiop|hjkl|fghj|test|fake|none|null|undefined|admin|user|hello|xxx|aaa|bbb|abc)/i;
  if (keyboardPatterns.test(trimmed.replace(/\s/g, ''))) {
    return { valid: false, reason: 'keyboard_pattern', message: 'Please enter your real name.' };
  }

  if (/(.)\1{3,}/.test(trimmed)) {
    return { valid: false, reason: 'repeated_chars', message: 'Please enter a valid name.' };
  }

  return { valid: true };
}
```

**Step 3: Update form submission handler in local server**

Find the form submission section and add the same validation logic as Task 4.

---

## Task 7: Test End-to-End

**Step 1: Test frontend validation locally**

```bash
cd option-a-threejs-gsap-tailwind/local-dev && npm start
```

Open http://localhost:3000/apply.html and test:
- [ ] Empty form submit → shows required errors
- [ ] Name "asdf" → shows "enter your real name"
- [ ] Email "invalid" → shows email format error
- [ ] Idea "test" → shows "provide more detail"

**Step 2: Test backend validation**

Submit form with valid frontend data but:
- [ ] Name that passes frontend but fails backend patterns
- [ ] Email with non-existent domain (e.g., fake@nonexistent-domain-xyz.com)
- [ ] Idea "I like pizza and the weather is nice" → should fail AI coherence

**Step 3: Test valid submission**

- [ ] Real name, valid email (e.g., @gmail.com), coherent product idea
- [ ] Should show Calendly on success

---

## Summary

| Layer | Name | Email | Product Idea |
|-------|------|-------|--------------|
| Frontend | Patterns + gibberish | Format regex | Min words + placeholders |
| Backend | Extended patterns | Format + MX lookup | AI coherence check |

**Files Changed:**
- `site/apply.html` - Frontend validation + error handling
- `chat-backend/index.mjs` - Backend validation functions + integration
- `local-dev/server.js` - Mirror for local development
