# Approve External Session Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the internal MVP build workflow with an external session API call when admin approves an application.

**Architecture:** When "Approve & Build" is clicked, the Lambda backend calls `POST https://d3r4k77gnvpmzn.cloudfront.net/api/admin/sessions` with applicant data, saves the returned GUID/link to S3, and the frontend displays the result in the application card.

**Tech Stack:** AWS Lambda (Node.js), vanilla JavaScript frontend, AWS S3

---

## Task 1: Add CSS for Indeterminate Progress Bar

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/admin.html:124-128` (CSS section)

**Step 1: Add indeterminate progress bar CSS**

Find the existing progress bar styles around line 124-128 and add the indeterminate animation after them:

```css
/* Progress bar styles */
.progress-container { background: rgba(30, 41, 59, 0.8); border-radius: 8px; overflow: hidden; }
.progress-bar { height: 8px; background: linear-gradient(90deg, #6366f1, #8b5cf6, #06b6d4); transition: width 0.5s ease; }
.progress-bar.failed { background: linear-gradient(90deg, #ef4444, #dc2626); }
.progress-bar.completed { background: linear-gradient(90deg, #22c55e, #16a34a); }

/* Indeterminate progress bar for session creation */
.progress-bar-indeterminate {
    height: 8px;
    width: 30%;
    background: linear-gradient(90deg, #6366f1, #8b5cf6, #06b6d4);
    border-radius: 8px;
    animation: indeterminate 1.5s ease-in-out infinite;
}

@keyframes indeterminate {
    0% { transform: translateX(-100%); }
    50% { transform: translateX(250%); }
    100% { transform: translateX(-100%); }
}
```

**Step 2: Verify CSS is valid**

Open admin.html in browser, inspect the styles section to confirm no syntax errors.

**Step 3: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/admin.html
git commit -m "style: add indeterminate progress bar CSS for session creation"
```

---

## Task 2: Add Backend Function to Call External Session API

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/chat-backend/index.mjs:1555` (before updateApplicationStatus)

**Step 1: Add the createExternalSession function**

Insert this function before the `updateApplicationStatus` function (around line 1555):

```javascript
// Create external session via CloudFront API
async function createExternalSession(applicationData) {
    const formData = applicationData.formData || {};
    const visitorInfo = applicationData.visitorInfo || {};

    const requestBody = {
        name: visitorInfo.name || formData.name || formData.full_name,
        email: visitorInfo.email || formData.email,
        initial_request: formData.product_idea || formData.productIdea || formData['product/service_idea'] || ''
    };

    // Only include phone if it exists
    const phone = visitorInfo.phone || formData.phone;
    if (phone) {
        requestBody.phone = phone;
    }

    console.log('Creating external session:', { name: requestBody.name, email: requestBody.email });

    try {
        const response = await fetch(
            'https://d3r4k77gnvpmzn.cloudfront.net/api/admin/sessions',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            }
        );

        const data = await response.json();
        console.log('External session response:', data);
        return data; // { success, guid, link } or { success: false, error }

    } catch (error) {
        console.error('External session error:', error.message);
        return { success: false, error: error.message, guid: null, link: null };
    }
}
```

**Step 2: Verify syntax**

```bash
cd /mnt/c/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/chat-backend
node --check index.mjs
```

Expected: No output (no syntax errors)

**Step 3: Commit**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend/index.mjs
git commit -m "feat: add createExternalSession function to call CloudFront API"
```

---

## Task 3: Modify updateApplicationStatus to Use External API

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/chat-backend/index.mjs:1588-1602` (inside updateApplicationStatus)

**Step 1: Replace the createBuildJob block with external session call**

Find the block starting at line 1588 that says `// If approved, trigger MVP build workflow` and replace it with:

```javascript
    // If approved, create external session
    if (newStatus === 'approved') {
        const sessionResult = await createExternalSession(applicationData);

        if (sessionResult.success) {
            applicationData.guid = sessionResult.guid;
            applicationData.sessionLink = sessionResult.link;
            applicationData.sessionCreatedAt = new Date().toISOString();
            // Clear any previous error
            delete applicationData.sessionError;
            delete applicationData.sessionFailedAt;
            console.log('Session created successfully:', sessionResult.guid);
        } else {
            applicationData.sessionError = sessionResult.error || 'Unknown error';
            applicationData.sessionFailedAt = new Date().toISOString();
            // Clear any previous success data
            delete applicationData.guid;
            delete applicationData.sessionLink;
            delete applicationData.sessionCreatedAt;
            console.log('Session creation failed:', sessionResult.error);
        }

        // Save updated application with session data
        await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key,
            Body: JSON.stringify(applicationData, null, 2),
            ContentType: 'application/json'
        }));
    }

    // If rejected, clear session data
    if (newStatus === 'rejected') {
        delete applicationData.guid;
        delete applicationData.sessionLink;
        delete applicationData.sessionCreatedAt;
        delete applicationData.sessionError;
        delete applicationData.sessionFailedAt;

        // Save updated application
        await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key,
            Body: JSON.stringify(applicationData, null, 2),
            ContentType: 'application/json'
        }));
    }
```

**Step 2: Verify syntax**

```bash
cd /mnt/c/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/chat-backend
node --check index.mjs
```

Expected: No output (no syntax errors)

**Step 3: Commit**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend/index.mjs
git commit -m "feat: replace build job with external session API in updateApplicationStatus"
```

---

## Task 4: Add Frontend Session Status Box Rendering

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/admin.html:1178` (inside renderApplications function)

**Step 1: Add helper function to render session status box**

Add this function before `renderApplications()` (around line 1175):

```javascript
        // Render session status box (success, error, or loading)
        function renderSessionStatusBox(app) {
            // Check for loading state (set temporarily during API call)
            if (app._sessionLoading) {
                return `
                    <div class="session-status-box bg-slate-800/50 rounded-lg p-4 mb-4">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="text-indigo-400 font-semibold">Creating session...</span>
                        </div>
                        <div class="progress-container">
                            <div class="progress-bar-indeterminate"></div>
                        </div>
                    </div>
                `;
            }

            // Check for successful session
            if (app.guid && app.sessionLink) {
                return `
                    <div class="session-status-box bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-4">
                        <div class="flex items-center gap-2 text-green-400 font-semibold mb-2">
                            <span>✓ Session Created</span>
                        </div>
                        <a href="${app.sessionLink}" target="_blank"
                           class="text-indigo-400 hover:text-indigo-300 underline break-all text-sm">
                            ${app.sessionLink}
                        </a>
                    </div>
                `;
            }

            // Check for failed session
            if (app.sessionError) {
                return `
                    <div class="session-status-box bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4">
                        <div class="flex items-center gap-2 text-red-400 font-semibold mb-2">
                            <span>✗ Session Failed</span>
                        </div>
                        <p class="text-slate-300 text-sm">${app.sessionError}</p>
                    </div>
                `;
            }

            return '';
        }
```

**Step 2: Verify no syntax errors**

Open admin.html in browser, check console for JavaScript errors.

**Step 3: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/admin.html
git commit -m "feat: add renderSessionStatusBox helper function"
```

---

## Task 5: Update Application Card Template to Show Session Box

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/admin.html:1298-1330` (action buttons section in renderApplications)

**Step 1: Add session status box and update button logic**

Find the action buttons section in the `renderApplications()` template (around line 1298-1330). Replace the entire `<!-- Action Buttons -->` div with:

```javascript
                            <!-- Session Status Box (above buttons) -->
                            ${renderSessionStatusBox(app)}

                            <!-- Action Buttons -->
                            <div class="flex gap-3 pt-4 border-t border-slate-700">
                                ${(() => {
                                    const isLoading = app._sessionLoading;
                                    const hasSession = app.guid && app.sessionLink;
                                    const hasError = app.sessionError;

                                    if (isLoading) {
                                        // Loading: disable both buttons
                                        return `
                                            <button disabled class="btn-approve px-4 py-2 rounded-lg font-semibold transition flex-1 opacity-50 cursor-not-allowed">
                                                ✓ Approve & Build
                                            </button>
                                            <button disabled class="btn-reject px-4 py-2 rounded-lg font-semibold transition flex-1 opacity-50 cursor-not-allowed">
                                                ✗ Reject
                                            </button>
                                        `;
                                    }

                                    if (status === 'approved' && hasSession) {
                                        // Success: show only Reject
                                        return `
                                            <button onclick="event.stopPropagation(); quickReject('${app.s3Key}')"
                                                class="btn-reject px-4 py-2 rounded-lg font-semibold transition flex-1">
                                                ✗ Reject
                                            </button>
                                        `;
                                    }

                                    if (status === 'approved' && hasError) {
                                        // Failed: show Retry and Reject
                                        return `
                                            <button onclick="event.stopPropagation(); retrySession('${app.s3Key}')"
                                                class="px-4 py-2 rounded-lg font-semibold transition flex-1 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30">
                                                🔄 Retry
                                            </button>
                                            <button onclick="event.stopPropagation(); quickReject('${app.s3Key}')"
                                                class="btn-reject px-4 py-2 rounded-lg font-semibold transition flex-1">
                                                ✗ Reject
                                            </button>
                                        `;
                                    }

                                    if (status === 'pending' || !status) {
                                        // Pending: show Approve and Reject
                                        return `
                                            <button onclick="event.stopPropagation(); quickApprove('${app.s3Key}')"
                                                class="btn-approve px-4 py-2 rounded-lg font-semibold transition flex-1">
                                                ✓ Approve & Build
                                            </button>
                                            <button onclick="event.stopPropagation(); quickReject('${app.s3Key}')"
                                                class="btn-reject px-4 py-2 rounded-lg font-semibold transition flex-1">
                                                ✗ Reject
                                            </button>
                                        `;
                                    }

                                    return '';
                                })()}
                            </div>
```

**Step 2: Verify no syntax errors**

Open admin.html in browser, check console for JavaScript errors.

**Step 3: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/admin.html
git commit -m "feat: update application card to show session status and conditional buttons"
```

---

## Task 6: Update quickApprove to Show Loading State

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/admin.html:1409-1415` (quickApprove function)

**Step 1: Update quickApprove to set loading state before API call**

Replace the `quickApprove` function (around line 1409) with:

```javascript
        // Quick approve with loading state
        async function quickApprove(s3Key) {
            const app = applications.find(a => a.s3Key === s3Key);
            if (!app) return;

            // Set loading state and re-render
            const idx = applications.findIndex(a => a.s3Key === s3Key);
            if (idx !== -1) {
                applications[idx]._sessionLoading = true;
                renderApplications();
                // Re-expand the card
                setTimeout(() => {
                    const card = document.querySelector(`.app-card[data-key="${s3Key}"]`);
                    if (card) card.classList.add('expanded');
                }, 50);
            }

            currentApp = app;
            await updateStatus('approved');

            // Clear loading state after API returns
            if (idx !== -1) {
                delete applications[idx]._sessionLoading;
            }
        }
```

**Step 2: Verify no syntax errors**

Open admin.html in browser, check console for JavaScript errors.

**Step 3: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/admin.html
git commit -m "feat: add loading state to quickApprove function"
```

---

## Task 7: Add Retry Function

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/admin.html:1417` (after quickReject function)

**Step 1: Add retrySession function after quickReject**

Find the `quickReject` function (around line 1417) and add this function after it:

```javascript
        // Retry session creation for failed applications
        async function retrySession(s3Key) {
            const app = applications.find(a => a.s3Key === s3Key);
            if (!app) return;

            // Set loading state
            const idx = applications.findIndex(a => a.s3Key === s3Key);
            if (idx !== -1) {
                applications[idx]._sessionLoading = true;
                // Clear previous error for UI
                delete applications[idx].sessionError;
                renderApplications();
                // Re-expand the card
                setTimeout(() => {
                    const card = document.querySelector(`.app-card[data-key="${s3Key}"]`);
                    if (card) card.classList.add('expanded');
                }, 50);
            }

            currentApp = app;

            // Call updateStatus with 'approved' to retry the session creation
            await updateStatus('approved');

            // Clear loading state
            if (idx !== -1) {
                delete applications[idx]._sessionLoading;
            }
        }
```

**Step 2: Verify no syntax errors**

Open admin.html in browser, check console for JavaScript errors.

**Step 3: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/admin.html
git commit -m "feat: add retrySession function for failed session attempts"
```

---

## Task 8: Update updateStatus to Handle New Response Fields

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/admin.html:1702-1749` (updateStatus function)

**Step 1: Update updateStatus to properly handle session data in response**

Find the `updateStatus` function (around line 1702) and update the success handler to include session fields:

```javascript
        // Update Status (for expandable cards - no modal)
        async function updateStatus(status) {
            if (!currentApp) return;

            try {
                showToast(`${status === 'approved' ? 'Approving' : 'Rejecting'}...`, 'info');

                const res = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'admin-update',
                        password: adminPassword,
                        s3Key: currentApp.s3Key,
                        status: status,
                        reviewNotes: ''
                    })
                });
                const data = await res.json();

                if (data.success) {
                    // Update local data with all returned fields (including session data)
                    const idx = applications.findIndex(a => a.s3Key === currentApp.s3Key);
                    if (idx !== -1) {
                        applications[idx] = { ...applications[idx], ...data.application };
                        // Clear loading state
                        delete applications[idx]._sessionLoading;
                    }
                    updateStats();

                    // Check session result for toast message
                    if (status === 'approved') {
                        if (data.application?.guid) {
                            showToast('Approved! Session created successfully.', 'success');
                        } else if (data.application?.sessionError) {
                            showToast('Approved but session failed: ' + data.application.sessionError, 'error');
                        } else {
                            showToast('Approved!', 'success');
                        }
                    } else {
                        showToast('Rejected', 'info');
                    }

                    renderApplications();

                    // Re-expand the card to show result
                    if (status === 'approved') {
                        setTimeout(() => {
                            const card = document.querySelector(`.app-card[data-key="${currentApp.s3Key}"]`);
                            if (card) card.classList.add('expanded');
                        }, 100);
                    }
                } else {
                    showToast('Error: ' + data.error, 'error');
                }
            } catch (e) {
                showToast('Connection error', 'error');
            }
        }
```

**Step 2: Verify no syntax errors**

Open admin.html in browser, check console for JavaScript errors.

**Step 3: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/admin.html
git commit -m "feat: update updateStatus to handle session response fields"
```

---

## Task 9: Deploy and Test End-to-End

**Files:**
- Deploy: `option-a-threejs-gsap-tailwind/chat-backend/` (Lambda)
- Deploy: `option-a-threejs-gsap-tailwind/site/admin.html` (S3)

**Step 1: Deploy Lambda backend**

```bash
cd /mnt/c/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/chat-backend
zip -r function.zip . -x '*.git*' -x '*.md' -x 'node_modules/.cache/*'
aws lambda update-function-code --function-name ai-product-studio-chat --zip-file fileb://function.zip --region ap-south-1
```

**Step 2: Deploy frontend to S3**

```bash
cd /mnt/c/Projects/ai-product-studio/option-a-threejs-gsap-tailwind
aws s3 cp site/admin.html s3://ai-product-studio-sunware/admin.html --region us-east-1
```

**Step 3: Test the flow**

1. Open admin portal: `http://ai-product-studio-sunware.s3-website-us-east-1.amazonaws.com/admin.html`
2. Login with admin password
3. Find a pending application
4. Click "Approve & Build"
5. Verify:
   - Indeterminate progress bar appears
   - Buttons are disabled
   - After response: green success box with link OR red error box
   - Clicking link opens new tab
   - "Reject" button clears session data

**Step 4: Commit final state**

```bash
git add -A
git commit -m "feat: complete external session integration for application approval"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add indeterminate progress bar CSS | admin.html |
| 2 | Add createExternalSession backend function | index.mjs |
| 3 | Modify updateApplicationStatus to use external API | index.mjs |
| 4 | Add renderSessionStatusBox frontend function | admin.html |
| 5 | Update card template with session box and buttons | admin.html |
| 6 | Update quickApprove with loading state | admin.html |
| 7 | Add retrySession function | admin.html |
| 8 | Update updateStatus to handle session fields | admin.html |
| 9 | Deploy and test end-to-end | Lambda + S3 |
