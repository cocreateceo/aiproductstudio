# AI Agent Form Validation - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hybrid form validation with unified AI-powered validation agent that validates name, email, and product idea in a single API call.

**Architecture:** Frontend sends all form fields as JSON with `mode: "validate"`. Backend calls Claude to validate core 3 fields, returns structured JSON. On success, saves to S3 and sends email. On failure, returns field-specific errors for frontend to display.

**Tech Stack:** Node.js Lambda, Claude API (claude-sonnet-4-20250514), Vanilla JavaScript frontend

---

## Task 1: Add handleFormValidation Function to Backend

**Files:**
- Modify: `chat-backend/index.mjs` (add after line 372, before corsHeaders)

**Step 1: Add the validation system prompt constant**

Add this code at line 370 (before `const corsHeaders`):

```javascript
// ========== FORM VALIDATION AGENT ==========

const FORM_VALIDATION_PROMPT = `You are a form validation agent. You receive form data as JSON and validate specific fields.

VALIDATION RULES:

1. NAME - Validate for:
   - Must be at least 2 characters
   - No numbers allowed
   - Detect gibberish (asdf, qwerty, aasdjf, random letters)
   - Detect fake names (test, admin, user, none, fake, null, undefined)
   - Detect keyboard mashing patterns
   If invalid: set valid=false, value="", provide helpful error message

2. EMAIL - Validate for:
   - Must be valid email format (name@domain.com)
   - Detect gibberish emails (asdf@asdf.com, test@test.com)
   - Detect obviously fake domains (fake.com, example.com, test.com)
   - Detect disposable email providers (tempmail, guerrillamail, mailinator, 10minutemail)
   If invalid: set valid=false, value="", provide helpful error message

3. PRODUCT IDEA - Validate for:
   - Must describe a real product or service concept
   - Reject gibberish, random text, keyboard mashing
   - Reject off-topic text (weather, food, unrelated topics)
   - Reject placeholder text (TBD, test, n/a, lorem ipsum)
   - Accept brief but coherent ideas (even short ones if they describe a real concept)
   If invalid: set valid=false, value="", provide helpful error message

OTHER FIELDS: Pass through unchanged with just "value" property.

RESPONSE FORMAT: Return ONLY valid JSON matching this exact structure. No explanation text before or after.

{
  "success": true/false,
  "fields": {
    "name": { "valid": true, "value": "the name" },
    "email": { "valid": true, "value": "the email" },
    "productIdea": { "valid": true, "value": "the idea" },
    "phone": { "value": "the value" },
    ... other fields with just "value"
  }
}

Set "success": true only if ALL 3 core validations (name, email, productIdea) pass.`;
```

**Step 2: Verify constant added**

Run: `grep -n "FORM_VALIDATION_PROMPT" chat-backend/index.mjs`
Expected: Line number where constant is defined

---

## Task 2: Add handleFormValidation Function

**Files:**
- Modify: `chat-backend/index.mjs` (add after FORM_VALIDATION_PROMPT, before corsHeaders)

**Step 1: Add the handler function**

Add this code after FORM_VALIDATION_PROMPT:

```javascript
// Handle form validation requests
async function handleFormValidation(formData, visitorInfo, clientIP) {
  console.log('Form validation request received:', { formData: Object.keys(formData) });

  const userMessage = `Validate this form data and return JSON response:
${JSON.stringify(formData, null, 2)}`;

  try {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: FORM_VALIDATION_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });

    const responseText = response.content[0].text.trim();
    console.log('AI validation response:', responseText);

    // Parse AI response - extract JSON
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No valid JSON in AI response');
    }

    const validationResult = JSON.parse(jsonMatch[0]);

    if (!validationResult.success) {
      // Validation failed - return errors
      console.log('Validation failed:', validationResult);
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(validationResult)
      };
    }

    // Validation passed - save to S3 and send email
    console.log('Validation passed - saving application...');

    // Build visitorInfo from validated data
    const updatedVisitorInfo = {
      ...visitorInfo,
      name: formData.name,
      email: formData.email,
      phone: formData.phone || ''
    };

    // Build the application message in the expected format
    const applicationMessage = `PARTNERSHIP APPLICATION SUBMISSION:

Name: ${formData.name}
Email: ${formData.email}
Phone: ${formData.phone || 'Not provided'}
LinkedIn: ${formData.linkedin || 'Not provided'}

Business Stage: ${formData.businessStage}
Industry: ${formData.industry}
Background: ${formData.background}

Product Idea: ${formData.productIdea}
Target Customer: ${formData.targetCustomer}
Market Validation: ${formData.marketValidation || 'Not provided'}

Time Commitment: ${formData.timeCommitment}
Timeline: ${formData.timeline}
Additional Info: ${formData.additionalInfo || 'None'}`;

    // Check for duplicate
    const duplicateCheck = await checkDuplicateApplication(
      updatedVisitorInfo.email,
      updatedVisitorInfo.phone
    );

    if (duplicateCheck.isDuplicate) {
      console.log('Duplicate application detected:', duplicateCheck);
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          fields: validationResult.fields,
          message: `You've already submitted an application. Our team will contact you soon.`,
          isDuplicate: true
        })
      };
    }

    // Save to S3 and send email
    const [s3Result, emailResult] = await Promise.all([
      saveFormToS3(updatedVisitorInfo, applicationMessage, clientIP),
      sendFormSubmissionEmail(updatedVisitorInfo, applicationMessage, clientIP)
    ]);

    console.log('S3 save result:', s3Result);
    console.log('Email send result:', emailResult);

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        fields: validationResult.fields,
        message: 'Application submitted successfully'
      })
    };

  } catch (error) {
    console.error('Form validation error:', error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Validation service error. Please try again.'
      })
    };
  }
}
```

**Step 2: Verify function added**

Run: `grep -n "async function handleFormValidation" chat-backend/index.mjs`
Expected: Line number where function is defined

---

## Task 3: Add Mode Check to Lambda Handler

**Files:**
- Modify: `chat-backend/index.mjs:1964-1966`

**Step 1: Find current code**

Current code at line 1964-1966:
```javascript
  try {
    const body = JSON.parse(event.body || '{}');
    const { action, messages, visitorInfo = {} } = body;
```

**Step 2: Add mode check after body parsing**

Replace with:
```javascript
  try {
    const body = JSON.parse(event.body || '{}');
    const { action, messages, visitorInfo = {} } = body;

    // Get client IP from request context
    const clientIP = event.requestContext?.http?.sourceIp ||
                     event.headers?.['x-forwarded-for']?.split(',')[0] ||
                     'Unknown';

    // Handle form validation mode
    if (body.mode === 'validate' && body.formData) {
      return await handleFormValidation(body.formData, visitorInfo, clientIP);
    }
```

**Note:** The clientIP extraction already exists at lines 1968-1971, so we need to move it up before the mode check. Find and remove the duplicate after adding this.

**Step 3: Remove duplicate clientIP extraction**

After adding the mode check, remove the duplicate clientIP lines (around 1975-1978).

**Step 4: Verify mode check added**

Run: `grep -n "mode === 'validate'" chat-backend/index.mjs`
Expected: Line number in handler function

---

## Task 4: Update Frontend Form Submit Handler

**Files:**
- Modify: `site/apply.html:898-953`

**Step 1: Replace the entire form submit handler**

Find the current form submit handler (lines 898-953) and replace with:

```javascript
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            // Prevent multiple submissions
            if (isSubmitting) return;
            isSubmitting = true;

            // Show loading state
            submitBtn.disabled = true;
            submitBtn.innerHTML = `
                <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Validating...
            `;
            submitBtn.style.opacity = '0.7';
            submitBtn.style.cursor = 'not-allowed';

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
                    // All valid → show success
                    formContainer.classList.add('hidden');
                    successMessage.classList.remove('hidden');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                } else {
                    // Validation failed → show errors
                    handleValidationResult(result.fields);

                    // Reset button
                    isSubmitting = false;
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalBtnText;
                    submitBtn.style.opacity = '1';
                    submitBtn.style.cursor = 'pointer';
                }
            } catch (error) {
                console.error('Form submission error:', error);
                alert('There was an error submitting your application. Please try again or contact us directly.');

                // Reset button on error
                isSubmitting = false;
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnText;
                submitBtn.style.opacity = '1';
                submitBtn.style.cursor = 'pointer';
            }
        });
```

**Step 2: Verify updated**

Run: `grep -n "mode: 'validate'" site/apply.html`
Expected: Line in form submit handler

---

## Task 5: Add handleValidationResult Function to Frontend

**Files:**
- Modify: `site/apply.html` (add before the closing `</script>` tag, after form submit handler)

**Step 1: Add the validation result handler function**

Add before the closing `</script>` tag (around line 953):

```javascript
        // Handle validation results from backend
        function handleValidationResult(fields) {
            if (!fields) return;

            // Clear all previous errors
            document.querySelectorAll('.validation-error').forEach(el => el.remove());
            document.querySelectorAll('.form-input, .form-textarea, .form-select').forEach(el => {
                el.style.borderColor = '';
                el.style.boxShadow = '';
            });

            // Field ID mapping (backend uses 'name', frontend uses 'fullName')
            const fieldMapping = {
                'name': 'fullName',
                'email': 'email',
                'productIdea': 'productIdea',
                'phone': 'phone',
                'linkedin': 'linkedin',
                'businessStage': 'businessStage',
                'industry': 'industry',
                'background': 'background',
                'targetCustomer': 'targetCustomer',
                'marketValidation': 'marketValidation',
                'timeCommitment': 'timeCommitment',
                'timeline': 'timeline',
                'additionalInfo': 'additionalInfo'
            };

            // Process each field
            for (const [fieldKey, data] of Object.entries(fields)) {
                const fieldId = fieldMapping[fieldKey] || fieldKey;
                const field = document.getElementById(fieldId);
                if (!field) continue;

                if (data.valid === false) {
                    // Invalid: clear field, show error
                    field.value = '';
                    field.style.borderColor = '#ef4444';
                    field.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.2)';

                    // Add error message
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'validation-error text-red-500 text-sm mt-1';
                    errorDiv.textContent = data.error || 'This field is invalid';
                    field.parentNode.appendChild(errorDiv);
                } else if (data.value !== undefined) {
                    // Valid or pass-through: fill value back
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

**Step 2: Verify function added**

Run: `grep -n "function handleValidationResult" site/apply.html`
Expected: Line number where function is defined

---

## Task 6: Mirror Changes to Local Dev Server

**Files:**
- Modify: `local-dev/server.js`

**Step 1: Add FORM_VALIDATION_PROMPT constant**

Find the existing constants section (around line 20-30) and add the same FORM_VALIDATION_PROMPT constant from Task 1.

**Step 2: Add handleFormValidation function**

Add the same handleFormValidation function from Task 2, adapted for Express:

```javascript
// Handle form validation requests
async function handleFormValidation(formData, visitorInfo, res) {
  console.log('Form validation request received:', { formData: Object.keys(formData) });

  const userMessage = `Validate this form data and return JSON response:
${JSON.stringify(formData, null, 2)}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: FORM_VALIDATION_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });

    const responseText = response.content[0].text.trim();
    console.log('AI validation response:', responseText);

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No valid JSON in AI response');
    }

    const validationResult = JSON.parse(jsonMatch[0]);

    if (!validationResult.success) {
      console.log('Validation failed:', validationResult);
      return res.status(400).json(validationResult);
    }

    // For local dev, just return success (skip S3/email)
    console.log('Validation passed');
    return res.json({
      success: true,
      fields: validationResult.fields,
      message: 'Application validated successfully (local dev - not saved)'
    });

  } catch (error) {
    console.error('Form validation error:', error);
    return res.status(500).json({
      success: false,
      error: 'Validation service error. Please try again.'
    });
  }
}
```

**Step 3: Add mode check to chat endpoint**

In the `/api/chat` POST handler, add at the start:

```javascript
  // Handle form validation mode
  if (req.body.mode === 'validate' && req.body.formData) {
    return handleFormValidation(req.body.formData, req.body.visitorInfo || {}, res);
  }
```

**Step 4: Verify changes**

Run: `grep -n "mode === 'validate'" local-dev/server.js`
Expected: Line number in API handler

---

## Task 7: Test Locally

**Step 1: Start local server**

```bash
cd option-a-threejs-gsap-tailwind/local-dev && npm start
```

**Step 2: Test validation failure**

Open http://localhost:3000/apply.html and submit with:
- Name: `asdf`
- Email: `test@test.com`
- Product Idea: `test`

Expected: Red error borders on all 3 fields with helpful error messages

**Step 3: Test validation success**

Submit with:
- Name: `John Smith`
- Email: `john@company.com`
- All required fields filled with real content
- Product Idea: `An AI tool that helps teams schedule meetings across time zones`

Expected: Success message shown

---

## Task 8: Deploy to AWS

**Step 1: Create Lambda deployment package**

```bash
cd option-a-threejs-gsap-tailwind/chat-backend
python3 << 'EOF'
import zipfile
import os
exclude = ['.git', 'deploy.sh', '.md', 'package-lock.json', 'function.zip']
with zipfile.ZipFile('function.zip', 'w', zipfile.ZIP_DEFLATED) as zipf:
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if d != '.git']
        for file in files:
            filepath = os.path.join(root, file)
            if any(ex in filepath for ex in exclude):
                continue
            arcname = filepath[2:] if filepath.startswith('./') else filepath
            zipf.write(filepath, arcname)
print('Zip created')
EOF
```

**Step 2: Deploy Lambda**

```bash
aws lambda update-function-code \
    --function-name ai-product-studio-chat \
    --zip-file fileb://function.zip \
    --profile sunwaretech \
    --region ap-south-1
```

**Step 3: Deploy frontend**

```bash
aws s3 cp ../site/apply.html s3://ai-product-studio-sunware/apply.html \
    --profile sunwaretech \
    --region ap-south-1
```

**Step 4: Invalidate CloudFront**

```bash
aws cloudfront create-invalidation \
    --distribution-id E85ZBHF63VW9W \
    --paths "/apply.html" \
    --profile sunwaretech
```

**Step 5: Clean up**

```bash
rm function.zip
```

---

## Task 9: Test in Production

**Step 1: Test validation failure**

Go to production apply page and submit with:
- Name: `qwerty`
- Email: `fake@fakefake.com`
- Product Idea: `just testing`

Expected: Red error borders with AI-generated helpful error messages

**Step 2: Test validation success**

Submit with valid data and verify:
- Success message appears
- Application saved to S3 (check admin panel)
- Email notification sent

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add validation prompt constant | `index.mjs` |
| 2 | Add handleFormValidation function | `index.mjs` |
| 3 | Add mode check to Lambda handler | `index.mjs` |
| 4 | Update frontend form submit | `apply.html` |
| 5 | Add handleValidationResult function | `apply.html` |
| 6 | Mirror to local dev server | `server.js` |
| 7 | Test locally | - |
| 8 | Deploy to AWS | - |
| 9 | Test in production | - |
