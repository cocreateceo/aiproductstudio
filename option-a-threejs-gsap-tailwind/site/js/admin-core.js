// Admin Portal v2 - Core JavaScript
console.log('Admin Portal v2 loaded - Expandable Cards Edition');

// Use centralized configuration
const isLocal = AppConfig.isLocal;
const API_URL = AppConfig.api.chat;
const WS_URL = AppConfig.websocket.url;

// Fix URLs that have wrong port (legacy data in S3 may have port 3000)
function fixMvpUrl(url) {
    if (!url) return url;
    return url.replace(/localhost:3000/g, `localhost:${AppConfig.ports.http}`);
}

let adminPassword = '';
let applications = [];
let currentFilter = 'all';
let currentUserFilter = 'all';
let allUsers = [];
let currentApp = null;
let progressPollInterval = null;
let currentBuildState = null;

// WebSocket connection
let ws = null;
let wsReconnectInterval = null;
let liveBuildLogs = [];

// Toast Notification System
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const icon = icons[type] || icons.info;

    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);

    const duration = AppConfig.ui.toastDuration || 3000;
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }, duration);

    console.log(`[Toast] ${type.toUpperCase()}: ${message}`);
}

// Sync activity to user's dashboard (real-time updates during build)
async function syncActivityToUser(guid, message, status = 'working') {
    if (!guid) return;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'webhook-activity',
                apiKey: 'cocreate-webhook-key-2026',
                guid: guid,
                activity: {
                    message: message,
                    status: status,
                    time: new Date().toISOString(),
                    type: 'build'
                }
            })
        });
        const result = await response.json();
        if (result.success) {
            console.log('[Activity] Synced:', message);
        }
    } catch (error) {
        // Silently fail - don't disrupt build flow
        console.log('[Activity] Sync failed:', error.message);
    }
}

// Save deployment to user's project history for dashboard
async function saveDeploymentToHistory(app, mvpUrl) {
    if (!app || !app.guid) {
        console.log('[Deployment] No app or guid, skipping save');
        return;
    }

    try {
        const projectName = app.formData?.productIdea?.substring(0, 50) || 'Website Project';
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'webhook-deployment',
                apiKey: 'cocreate-webhook-key-2026',
                guid: app.guid,
                projectName: projectName,
                description: app.formData?.productIdea || '',
                cloudfrontUrl: mvpUrl,
                status: 'deployed',
                activity: [
                    { message: 'Build completed', time: new Date().toISOString() },
                    { message: `Deployed to ${mvpUrl}`, time: new Date().toISOString() }
                ]
            })
        });

        const result = await response.json();
        if (result.success) {
            console.log('[Deployment] Saved to project history:', app.guid);
        } else {
            console.error('[Deployment] Failed to save:', result.error);
        }
    } catch (error) {
        console.error('[Deployment] Error saving to history:', error);
    }
}

function initWebSocket() {
    if (!WS_URL) return;

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        console.log('WebSocket connected');
        document.getElementById('ws-status').textContent = 'connected';
        document.getElementById('ws-status').className = 'ws-status connected';
        if (wsReconnectInterval) {
            clearInterval(wsReconnectInterval);
            wsReconnectInterval = null;
        }
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected');
        document.getElementById('ws-status').textContent = 'disconnected';
        document.getElementById('ws-status').className = 'ws-status disconnected';
        if (!wsReconnectInterval) {
            wsReconnectInterval = setInterval(() => {
                console.log('Attempting to reconnect...');
                initWebSocket();
            }, 5000);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleWebSocketMessage(msg);
        } catch (e) {
            console.error('Failed to parse WS message:', e);
        }
    };
}

function handleWebSocketMessage(msg) {
    switch (msg.type) {
        case 'build_started':
            liveBuildLogs = [];
            currentBuildState = {
                s3Key: msg.data.s3Key,
                status: 'in_progress',
                percent: 5,
                phase: 'starting',
                message: 'Build started...',
                client: msg.data.client
            };
            addLiveLog('Build started...');
            // Sync activity to user dashboard
            const startedApp = applications.find(a => a.s3Key === msg.data.s3Key);
            if (startedApp?.guid) {
                syncActivityToUser(startedApp.guid, 'Build started', 'working');
            }
            renderApplications();
            if (msg.data.s3Key) {
                setTimeout(() => {
                    const card = document.querySelector(`.app-card[data-key="${msg.data.s3Key}"]`);
                    if (card && !card.classList.contains('expanded')) {
                        card.classList.add('expanded');
                    }
                }, 100);
            }
            break;

        case 'progress':
            const prevPhase = currentBuildState?.phase;
            currentBuildState = {
                ...currentBuildState,
                s3Key: msg.data.s3Key || currentBuildState?.s3Key,
                status: 'in_progress',
                percent: msg.data.percent || 0,
                phase: msg.data.phase || 'working',
                message: msg.data.message || 'Processing...'
            };
            // Sync activity when phase changes (avoids spam)
            if (msg.data.phase && msg.data.phase !== prevPhase && msg.data.message) {
                const progressApp = applications.find(a => a.s3Key === currentBuildState.s3Key);
                if (progressApp?.guid) {
                    syncActivityToUser(progressApp.guid, msg.data.message, 'working');
                }
            }
            updateInlineProgress();
            break;

        case 'tool_use':
            addLiveLog(`Tool: ${msg.data.tool}: ${JSON.stringify(msg.data.input).substring(0, 50)}...`);
            updateBuildLogs();
            break;

        case 'thinking':
            addLiveLog(`Thinking: ${msg.data.content.substring(0, 60)}...`);
            updateBuildLogs();
            break;

        case 'log':
            addLiveLog(`[${msg.data.phase}] ${msg.data.content.substring(0, 60)}`);
            updateBuildLogs();
            break;

        case 'build_completed':
            const fixedMvpUrl = fixMvpUrl(msg.data.mvpUrl);
            currentBuildState = {
                ...currentBuildState,
                status: 'completed',
                percent: 100,
                phase: 'completed',
                message: 'Build complete!',
                mvpUrl: fixedMvpUrl
            };
            addLiveLog(`MVP ready: ${fixedMvpUrl}`);
            showToast('Build completed!', 'success');
            const completedApp = applications.find(a => a.s3Key === currentBuildState.s3Key);
            if (completedApp) {
                completedApp.buildUrl = fixedMvpUrl;
                completedApp.buildProgress = currentBuildState;
                // Sync final activity with done status
                if (completedApp.guid) {
                    syncActivityToUser(completedApp.guid, `Build complete! Deployed to ${fixedMvpUrl}`, 'done');
                }
                // Save deployment to user's project history
                saveDeploymentToHistory(completedApp, fixedMvpUrl);
            }
            renderApplications();
            currentBuildState = null;
            break;

        case 'build_failed':
            currentBuildState = {
                ...currentBuildState,
                status: 'failed',
                phase: 'failed',
                message: msg.data.error || 'Build failed'
            };
            addLiveLog(`Error: ${msg.data.error}`);
            showToast('Build failed', 'error');
            const failedApp = applications.find(a => a.s3Key === currentBuildState?.s3Key);
            if (failedApp) {
                failedApp.buildProgress = currentBuildState;
                // Sync failure activity
                if (failedApp.guid) {
                    syncActivityToUser(failedApp.guid, `Build failed: ${msg.data.error || 'Unknown error'}`, 'done');
                }
            }
            renderApplications();
            currentBuildState = null;
            break;

        case 'build_cancelled':
            showToast('Build cancelled', 'info');
            currentBuildState = null;
            loadApplications();
            break;

        case 'error':
            addLiveLog(`Error: ${msg.data.message}`);
            break;

        case 'state':
            if (msg.data) {
                currentBuildState = msg.data;
                renderApplications();
            }
            break;
    }
}

function updateInlineProgress() {
    if (!currentBuildState) return;

    document.querySelectorAll('.progress-bar').forEach(bar => {
        bar.style.width = `${currentBuildState.percent || 0}%`;
    });

    document.querySelectorAll('.app-card').forEach(card => {
        if (card.dataset.key === currentBuildState.s3Key) {
            const phaseText = card.querySelector('.text-indigo-400');
            if (phaseText) phaseText.textContent = `${currentBuildState.phase || 'Building'}...`;
        }
    });

    const buildSectionId = currentBuildState.s3Key?.replace(/[^a-zA-Z0-9]/g, '_');
    const buildSection = document.getElementById(`build-section-${buildSectionId}`);
    if (buildSection) {
        const app = applications.find(a => a.s3Key === currentBuildState.s3Key);
        if (app) {
            app.buildProgress = currentBuildState;
            buildSection.innerHTML = renderBuildSection(app);
        }
    }
}

function updateBuildLogs() {
    if (!currentBuildState) return;
    const buildLogId = currentBuildState.s3Key?.replace(/[^a-zA-Z0-9]/g, '_');
    const logDiv = document.getElementById(`build-log-${buildLogId}`);
    if (logDiv) {
        logDiv.innerHTML = liveBuildLogs.slice(-10).map(log => `<div class="text-xs">${log}</div>`).join('');
        logDiv.scrollTop = logDiv.scrollHeight;
    }
}

function addLiveLog(text) {
    if (typeof text === 'string') {
        liveBuildLogs.push(text);
    } else {
        liveBuildLogs.push(text.text || String(text));
    }
    if (liveBuildLogs.length > 50) liveBuildLogs = liveBuildLogs.slice(-50);
}

function onLoginSuccess() {
    initWebSocket();
}

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const dashboard = document.getElementById('dashboard');
const passwordInput = document.getElementById('password-input');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const refreshBtn = document.getElementById('refresh-btn');
const applicationsList = document.getElementById('applications-list');
const detailModal = document.getElementById('detail-modal');
const closeModal = document.getElementById('close-modal');
const filterBtns = document.querySelectorAll('.filter-btn');

// Login
loginBtn.addEventListener('click', async () => {
    const password = passwordInput.value;
    if (!password) return;

    loginBtn.textContent = 'Logging in...';
    loginBtn.disabled = true;

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'admin-login', password })
        });
        const data = await res.json();

        if (data.success) {
            adminPassword = password;
            sessionStorage.setItem('adminPassword', password);
            loginScreen.classList.add('hidden');
            dashboard.classList.remove('hidden');

            await Promise.all([
                loadApplications(),
                loadChatSessions(),
                loadClientProfiles(),
                loadBuildHistory(),
                loadCostsSummary()  // Pre-load cost data for application cards
            ]);

            // Update cost sections now that both data sets are available
            await updateAllCostSections();

            populateUserDropdown();
            onLoginSuccess();
        } else {
            loginError.textContent = 'Invalid password';
            loginError.classList.remove('hidden');
        }
    } catch (e) {
        loginError.textContent = 'Connection error. Please try again.';
        loginError.classList.remove('hidden');
    }

    loginBtn.textContent = 'Login';
    loginBtn.disabled = false;
});

passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loginBtn.click();
});

// Logout
logoutBtn.addEventListener('click', () => {
    adminPassword = '';
    sessionStorage.removeItem('adminPassword');
    dashboard.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    passwordInput.value = '';
});

// Load Applications
async function loadApplications() {
    console.log('[Admin] loadApplications called');
    applicationsList.innerHTML = `
        <div class="text-center py-12 text-theme-muted">
            <svg class="w-12 h-12 mx-auto mb-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            Loading applications...
        </div>
    `;

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'admin-list', password: adminPassword })
        });
        const data = await res.json();

        if (data.success) {
            applications = data.applications.map(app => ({
                ...app,
                buildUrl: fixMvpUrl(app.buildUrl),
                mvpUrl: fixMvpUrl(app.mvpUrl)
            }));
            console.log('[Admin] Loaded', applications.length, 'applications');
            updateStats();
            renderApplications();
        } else {
            applicationsList.innerHTML = `<div class="text-center py-12 text-red-400">Error: ${data.error}</div>`;
        }
    } catch (e) {
        applicationsList.innerHTML = `<div class="text-center py-12 text-red-400">Connection error: ${e.message}</div>`;
    }
}

function updateStats() {
    document.getElementById('stat-total').textContent = applications.length;
    document.getElementById('stat-pending').textContent = applications.filter(a => !a.status || a.status === 'pending').length;
    document.getElementById('stat-approved').textContent = applications.filter(a => a.status === 'approved').length;
    document.getElementById('stat-hold').textContent = applications.filter(a => a.status === 'hold').length;
    document.getElementById('stat-rejected').textContent = applications.filter(a => a.status === 'rejected').length;
}

function extractAllUsers() {
    const userMap = new Map();

    applications.forEach(app => {
        const email = app.visitorInfo?.email;
        const name = app.visitorInfo?.name;
        if (email && name) userMap.set(email, { name, email });
    });

    chatSessions.forEach(session => {
        const email = session.visitorInfo?.email;
        const name = session.visitorInfo?.name;
        if (email && name) userMap.set(email, { name, email });
    });

    clientProfiles.forEach(client => {
        const email = client.email;
        const name = client.name;
        if (email && name) userMap.set(email, { name, email });
    });

    buildHistory.forEach(build => {
        const name = build.client?.name;
        if (name) {
            const existingUser = Array.from(userMap.values()).find(u => u.name === name);
            if (existingUser) {
                userMap.set(existingUser.email, existingUser);
            } else {
                userMap.set(name, { name, email: name });
            }
        }
    });

    return Array.from(userMap.values()).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
}

function populateUserDropdown() {
    allUsers = extractAllUsers();
    const dropdown = document.getElementById('user-filter-dropdown');
    const badge = document.getElementById('user-count-badge');

    if (!dropdown || !badge) return;

    let hasAnonymous = false;
    hasAnonymous = hasAnonymous || applications.some(app => !app.visitorInfo?.email || !app.visitorInfo?.name);
    hasAnonymous = hasAnonymous || chatSessions.some(session => !session.visitorInfo?.email || !session.visitorInfo?.name);
    hasAnonymous = hasAnonymous || clientProfiles.some(client => !client.email || !client.name);

    let optionsHTML = '<option value="all">All Users</option>';

    if (hasAnonymous) {
        const selected = currentUserFilter === 'anonymous' ? 'selected' : '';
        optionsHTML += `<option value="anonymous" ${selected}>Anonymous Users</option>`;
    }

    allUsers.forEach(user => {
        const selected = currentUserFilter === user.email ? 'selected' : '';
        optionsHTML += `<option value="${user.email}" ${selected}>${user.name} (${user.email})</option>`;
    });

    dropdown.innerHTML = optionsHTML;
    badge.textContent = hasAnonymous ? allUsers.length + 1 : allUsers.length;
}

function renderSessionStatusBox(app) {
    if (app._sessionLoading) {
        return `
            <div class="session-status-box rounded-lg p-4 mb-4" style="background: var(--bg-secondary);">
                <div class="flex items-center gap-3 mb-2">
                    <span style="color: var(--primary);" class="font-semibold">Creating session...</span>
                </div>
                <div class="progress-container">
                    <div class="progress-bar-indeterminate"></div>
                </div>
            </div>
        `;
    }

    if (app.guid && app.sessionLink) {
        const dashboardLink = `https://www.cocreateidea.com/user.html?id=${app.guid}`;
        return `
            <div class="session-status-box bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-4">
                <div class="flex items-center gap-2 text-green-400 font-semibold mb-2">
                    <span>Session Created</span>
                </div>
                <div class="mb-3">
                    <p class="text-xs text-theme-muted mb-1">Build Session:</p>
                    <a href="${app.sessionLink}" target="_blank" class="hover:underline break-all text-sm" style="color: var(--primary);">
                        ${app.sessionLink}
                    </a>
                </div>
                <div>
                    <p class="text-xs text-theme-muted mb-1">User Dashboard:</p>
                    <a href="${dashboardLink}" target="_blank" class="hover:underline break-all text-sm" style="color: var(--primary);">
                        ${dashboardLink}
                    </a>
                </div>
            </div>
        `;
    }

    if (app.sessionError) {
        return `
            <div class="session-status-box bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4">
                <div class="flex items-center gap-2 text-red-400 font-semibold mb-2">
                    <span>Session Failed</span>
                </div>
                <p class="text-sm text-theme-secondary">${app.sessionError}</p>
            </div>
        `;
    }

    return '';
}

// Render AWS Cost Analysis section for an application (renders placeholder, filled by updateAllCostSections)
function renderUserCostSection(app) {
    if (!app.guid) return '';
    const userEmail = app.visitorInfo?.email || '';

    return `
        <div class="cost-analysis-section rounded-lg p-3 mb-4" data-cost-email="${userEmail}" data-cost-guid="${app.guid}" style="background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(139, 92, 246, 0.1)); border: 1px solid rgba(99, 102, 241, 0.3);">
            <div class="flex items-center gap-2 mb-2">
                <span>💰</span>
                <span class="font-semibold text-sm" style="color: var(--primary);">AWS Cost Analysis</span>
            </div>
            <div class="grid grid-cols-3 gap-3">
                <div class="text-center p-2 rounded-lg" style="background: rgba(26, 10, 0, 0.3);">
                    <p class="text-xs text-theme-muted mb-1">Projects</p>
                    <p class="text-lg font-bold text-theme-primary cost-project-count">0</p>
                </div>
                <div class="text-center p-2 rounded-lg" style="background: rgba(26, 10, 0, 0.3);">
                    <p class="text-xs text-theme-muted mb-1">Weekly</p>
                    <p class="text-lg font-bold cost-weekly" style="color: var(--accent);">$0.00</p>
                </div>
                <div class="text-center p-2 rounded-lg" style="background: rgba(26, 10, 0, 0.3);">
                    <p class="text-xs text-theme-muted mb-1">Monthly</p>
                    <p class="text-lg font-bold cost-monthly" style="color: var(--primary);">$0.00</p>
                </div>
            </div>
        </div>
    `;
}

// Update all rendered cost sections in the DOM using loaded costsData
// Falls back to individual user-costs API calls (same API the user dashboard uses)
async function updateAllCostSections() {
    const sections = document.querySelectorAll('.cost-analysis-section[data-cost-email]');
    if (sections.length === 0) return;

    console.log('[Admin] Updating', sections.length, 'cost sections, bulk data:', costsData?.users?.length || 0, 'users');

    // Track aggregated totals for the overall stats
    let aggregatedTotals = { estimated: 0, s3: 0, cloudfront: 0, projectCount: 0 };
    let anyFallbackUsed = false;

    for (const section of sections) {
        const email = section.getAttribute('data-cost-email');
        const guid = section.getAttribute('data-cost-guid');

        // Try matching from bulk costsData first
        let userData = null;
        if (costsData && costsData.users && costsData.users.length > 0) {
            userData = costsData.users.find(u =>
                (email && (u.email === email || u.userId === email)) ||
                (guid && u.userId === guid)
            );
        }

        if (userData) {
            const monthly = userData.costs?.total || 0;
            const weekly = monthly * 7 / 30;
            section.querySelector('.cost-project-count').textContent = userData.projectCount || 0;
            section.querySelector('.cost-weekly').textContent = formatCurrency(weekly);
            section.querySelector('.cost-monthly').textContent = formatCurrency(monthly);
        } else if (guid) {
            // Fallback: fetch costs directly using user-costs API (same as user dashboard)
            anyFallbackUsed = true;
            try {
                const res = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'user-costs',
                        guid: guid,
                        email: email || null,
                        period: 'monthly'
                    })
                });
                const data = await res.json();
                if (data.success && data.costs) {
                    const monthly = data.costs.costs?.total || 0;
                    const weekly = monthly * 7 / 30;
                    const projectCount = data.costs.projects?.length || 0;
                    section.querySelector('.cost-project-count').textContent = projectCount;
                    section.querySelector('.cost-weekly').textContent = formatCurrency(weekly);
                    section.querySelector('.cost-monthly').textContent = formatCurrency(monthly);

                    // Aggregate for overall stats
                    aggregatedTotals.estimated += monthly;
                    aggregatedTotals.s3 += (data.costs.costs?.s3 || 0);
                    aggregatedTotals.cloudfront += (data.costs.costs?.cloudfront || 0);
                    aggregatedTotals.projectCount += projectCount;

                    console.log('[Admin] Fallback cost loaded for guid:', guid, '→ $' + monthly.toFixed(2));
                }
            } catch (e) {
                console.log('[Admin] Fallback cost fetch failed for guid:', guid, e.message);
            }
        }
    }

    // If bulk data was empty and we used fallback, update overall cost stats too
    if (anyFallbackUsed && aggregatedTotals.projectCount > 0) {
        const estEl = document.getElementById('cost-stat-estimated');
        const s3El = document.getElementById('cost-stat-s3');
        const cfEl = document.getElementById('cost-stat-cloudfront');
        const projEl = document.getElementById('cost-stat-projects');
        if (estEl) estEl.textContent = formatCurrency(aggregatedTotals.estimated);
        if (s3El) s3El.textContent = formatCurrency(aggregatedTotals.s3);
        if (cfEl) cfEl.textContent = formatCurrency(aggregatedTotals.cloudfront);
        if (projEl) projEl.textContent = aggregatedTotals.projectCount;
        console.log('[Admin] Updated overall stats from fallback:', aggregatedTotals);
    }
}

function renderApplications() {
    let userFiltered = applications;
    if (currentUserFilter === 'anonymous') {
        userFiltered = applications.filter(app =>
            !app.visitorInfo?.email || !app.visitorInfo?.name
        );
    } else if (currentUserFilter !== 'all') {
        userFiltered = applications.filter(app =>
            app.visitorInfo?.email === currentUserFilter
        );
    }

    let filtered;
    if (currentFilter === 'all') {
        filtered = userFiltered;
    } else if (currentFilter === 'pending') {
        filtered = userFiltered.filter(a => !a.status || a.status === 'pending');
    } else {
        filtered = userFiltered.filter(a => a.status === currentFilter);
    }

    if (filtered.length === 0) {
        applicationsList.innerHTML = `
            <div class="text-center py-12 text-theme-muted">
                <svg class="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
                No applications found
            </div>
        `;
        return;
    }

    applicationsList.innerHTML = filtered.map(app => {
        const status = app.status || 'pending';
        const buildProgress = app.buildProgress || currentBuildState?.s3Key === app.s3Key ? currentBuildState : null;
        const isBuilding = buildProgress && buildProgress.status === 'in_progress';

        return `
        <div class="app-card glass-card rounded-xl overflow-hidden" data-key="${app.s3Key}">
            <div class="card-header p-5" onclick="toggleCard('${app.s3Key}')">
                <div class="flex justify-between items-start">
                    <div class="flex-1">
                        <div class="flex items-center gap-3 flex-wrap">
                            <h3 class="font-semibold text-lg text-theme-primary">${app.visitorInfo?.name || 'Unknown'}</h3>
                            <span class="status-${status} px-3 py-1 rounded-full text-xs font-semibold">
                                ${status === 'hold' ? 'ON HOLD' : status.toUpperCase()}
                            </span>
                            ${app.referral?.referredBy ? `
                            <span class="px-3 py-1 rounded-full text-xs font-semibold" style="background: linear-gradient(135deg, var(--accent), var(--primary)); color: #1A0A00;" title="Code: ${app.referral.code}">
                                REF: ${app.referral.referredBy.toUpperCase()}
                            </span>
                            ` : ''}
                        </div>
                        <p class="text-theme-muted text-sm mt-1">${app.visitorInfo?.email || 'No email'}</p>
                        <p class="text-sm text-theme-secondary mt-2 line-clamp-1">${app.formData?.product_idea || app.formData?.productIdea || 'No product idea'}</p>
                    </div>
                    <div class="flex items-center gap-3">
                        <p class="text-theme-muted text-xs">${(app.submittedAt || app.timestamp) ? new Date(app.submittedAt || app.timestamp).toLocaleString() : ''}</p>
                        <svg class="expand-icon w-5 h-5 text-theme-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                        </svg>
                    </div>
                </div>

                ${isBuilding ? `
                <div class="mt-4">
                    <div class="flex justify-between text-xs mb-1">
                        <span style="color: var(--primary);">${buildProgress.phase || 'Building'}...</span>
                        <span class="text-theme-muted">${buildProgress.percent || 0}%</span>
                    </div>
                    <div class="progress-container">
                        <div class="progress-bar" style="width: ${buildProgress.percent || 5}%"></div>
                    </div>
                </div>
                ` : ''}
            </div>

            <div class="card-details" style="border-top: 1px solid var(--border-color);">
                <div class="p-5 space-y-4">
                    <!-- Mandatory: Product Idea -->
                    <div>
                        <p class="text-theme-muted text-xs uppercase mb-1">Product Idea</p>
                        <p class="text-theme-secondary whitespace-pre-wrap">${app.formData?.product_idea || app.formData?.productIdea || 'Not provided'}</p>
                    </div>

                    <!-- Dates: Submitted and Approved -->
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <p class="text-theme-muted text-xs uppercase mb-1">Submitted</p>
                            <p class="text-theme-secondary">${(app.submittedAt || app.timestamp) ? new Date(app.submittedAt || app.timestamp).toLocaleString() : 'Unknown'}</p>
                        </div>
                        ${app.status === 'approved' && app.reviewedAt ? `
                        <div>
                            <p class="text-theme-muted text-xs uppercase mb-1">Approved</p>
                            <p class="text-theme-secondary">${new Date(app.reviewedAt).toLocaleString()}</p>
                        </div>
                        ` : ''}
                    </div>

                    <!-- Optional fields: Only show if data exists -->
                    ${(app.formData?.industry || app.formData?.business_stage || app.formData?.businessStage || app.formData?.time_commitment || app.formData?.timeCommitment || app.visitorInfo?.phone) ? `
                    <div class="grid grid-cols-2 gap-4">
                        ${app.formData?.industry ? `
                        <div>
                            <p class="text-theme-muted text-xs uppercase mb-1">Industry</p>
                            <p class="text-theme-secondary">${app.formData.industry}</p>
                        </div>
                        ` : ''}
                        ${app.formData?.business_stage || app.formData?.businessStage ? `
                        <div>
                            <p class="text-theme-muted text-xs uppercase mb-1">Business Stage</p>
                            <p class="text-theme-secondary">${app.formData.business_stage || app.formData.businessStage}</p>
                        </div>
                        ` : ''}
                        ${app.formData?.time_commitment || app.formData?.timeCommitment ? `
                        <div>
                            <p class="text-theme-muted text-xs uppercase mb-1">Time Commitment</p>
                            <p class="text-theme-secondary">${app.formData.time_commitment || app.formData.timeCommitment}</p>
                        </div>
                        ` : ''}
                        ${app.visitorInfo?.phone ? `
                        <div>
                            <p class="text-theme-muted text-xs uppercase mb-1">Phone</p>
                            <p class="text-theme-secondary">${app.visitorInfo.phone}</p>
                        </div>
                        ` : ''}
                    </div>
                    ` : ''}

                    ${app.formData?.target_market || app.formData?.targetMarket ? `
                    <div>
                        <p class="text-theme-muted text-xs uppercase mb-1">Target Market</p>
                        <p class="text-theme-secondary">${app.formData.target_market || app.formData.targetMarket}</p>
                    </div>
                    ` : ''}

                    <div id="build-section-${app.s3Key?.replace(/[^a-zA-Z0-9]/g, '_')}" class="build-section">
                        ${renderBuildSection(app)}
                    </div>

                    ${renderSessionStatusBox(app)}

                    ${renderUserCostSection(app)}

                    <div class="flex gap-3 pt-4" style="border-top: 1px solid var(--border-color);">
                        ${(() => {
                            const isLoading = app._sessionLoading;

                            if (isLoading) {
                                return `
                                    <button disabled class="btn-approve px-4 py-2 rounded-lg font-semibold transition flex-1 opacity-50 cursor-not-allowed">Approve</button>
                                    <button disabled class="btn-hold px-4 py-2 rounded-lg font-semibold transition flex-1 opacity-50 cursor-not-allowed">Hold</button>
                                    <button disabled class="btn-reject px-4 py-2 rounded-lg font-semibold transition flex-1 opacity-50 cursor-not-allowed">Reject</button>
                                `;
                            }

                            const approveDisabled = status === 'approved';
                            const holdDisabled = status === 'hold';
                            const rejectDisabled = status === 'rejected';

                            const approveBtn = approveDisabled
                                ? `<button disabled class="btn-approve px-4 py-2 rounded-lg font-semibold transition flex-1 opacity-50 cursor-not-allowed">Approve</button>`
                                : `<button onclick="event.stopPropagation(); quickApprove('${app.s3Key}')" class="btn-approve px-4 py-2 rounded-lg font-semibold transition flex-1">Approve</button>`;

                            const holdBtn = holdDisabled
                                ? `<button disabled class="btn-hold px-4 py-2 rounded-lg font-semibold transition flex-1 opacity-50 cursor-not-allowed">Hold</button>`
                                : `<button onclick="event.stopPropagation(); quickHold('${app.s3Key}')" class="btn-hold px-4 py-2 rounded-lg font-semibold transition flex-1">Hold</button>`;

                            const rejectBtn = rejectDisabled
                                ? `<button disabled class="btn-reject px-4 py-2 rounded-lg font-semibold transition flex-1 opacity-50 cursor-not-allowed">Reject</button>`
                                : `<button onclick="event.stopPropagation(); quickReject('${app.s3Key}')" class="btn-reject px-4 py-2 rounded-lg font-semibold transition flex-1">Reject</button>`;

                            return approveBtn + holdBtn + rejectBtn;
                        })()}
                    </div>
                </div>
            </div>
        </div>
    `}).join('');

    // Re-apply cost data to newly rendered cost sections
    updateAllCostSections();
}

function renderBuildSection(app) {
    const buildProgress = currentBuildState?.s3Key === app.s3Key ? currentBuildState : app.buildProgress;
    if (!buildProgress && app.status !== 'approved') return '';

    const isBuilding = buildProgress?.status === 'in_progress';
    const isFailed = buildProgress?.status === 'failed';
    const isCompleted = buildProgress?.status === 'completed';

    if (isBuilding) {
        return `
            <div class="rounded-lg p-4" style="background: var(--bg-secondary);">
                <div class="flex justify-between items-center mb-2">
                    <span style="color: var(--primary);" class="font-semibold">Building MVP</span>
                    <span class="text-theme-muted text-sm">${buildProgress.percent || 0}%</span>
                </div>
                <div class="progress-container mb-3">
                    <div class="progress-bar" style="width: ${buildProgress.percent || 5}%"></div>
                </div>
                <p class="text-theme-secondary text-sm">${buildProgress.message || 'Processing...'}</p>
                ${buildProgress.phase ? `<p class="text-theme-muted text-xs mt-1">Phase: ${buildProgress.phase}</p>` : ''}
                <div class="mt-3 build-log rounded p-3 text-theme-muted" style="background: var(--bg-primary);" id="build-log-${app.s3Key?.replace(/[^a-zA-Z0-9]/g, '_')}">
                    ${liveBuildLogs.slice(-10).map(log => `<div class="text-xs">${log}</div>`).join('')}
                </div>
            </div>
        `;
    }

    if (isFailed) {
        return `
            <div class="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <div class="flex items-center gap-2 text-red-400 font-semibold mb-2">
                    <span>Build Failed</span>
                </div>
                <p class="text-theme-secondary text-sm">${buildProgress.message || 'Build failed. Click Rebuild to try again.'}</p>
            </div>
        `;
    }

    if (isCompleted || app.buildUrl) {
        return `
            <div class="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                <div class="flex items-center gap-2 text-green-400 font-semibold mb-2">
                    <span>Build Complete</span>
                </div>
                ${app.buildUrl ? `<p class="text-theme-secondary text-sm">MVP is live at: <a href="${app.buildUrl}" target="_blank" class="hover:underline" style="color: var(--primary);">${app.buildUrl}</a></p>` : ''}
            </div>
        `;
    }

    return '';
}

function toggleCard(s3Key) {
    const card = document.querySelector(`.app-card[data-key="${s3Key}"]`);
    const wasExpanded = card.classList.contains('expanded');

    document.querySelectorAll('.app-card.expanded').forEach(c => c.classList.remove('expanded'));

    if (!wasExpanded) {
        card.classList.add('expanded');
        currentApp = applications.find(a => a.s3Key === s3Key);
    } else {
        currentApp = null;
    }
}

async function quickApprove(s3Key) {
    const app = applications.find(a => a.s3Key === s3Key);
    if (!app) return;

    const idx = applications.findIndex(a => a.s3Key === s3Key);
    if (idx !== -1) {
        applications[idx]._sessionLoading = true;
        renderApplications();
        setTimeout(() => {
            const card = document.querySelector(`.app-card[data-key="${s3Key}"]`);
            if (card) card.classList.add('expanded');
        }, 50);
    }

    currentApp = app;
    await updateStatus('approved');

    if (idx !== -1) {
        delete applications[idx]._sessionLoading;
    }
}

async function quickReject(s3Key) {
    const app = applications.find(a => a.s3Key === s3Key);
    if (!app) return;

    // Confirmation dialog before rejecting
    const userName = app.visitorInfo?.name || app.formData?.fullName || 'this user';
    const userEmail = app.visitorInfo?.email || app.formData?.email || '';
    const confirmed = confirm(`⚠️ Are you sure you want to REJECT this application?\n\nUser: ${userName}\nEmail: ${userEmail}\n\nThis action will:\n• Mark the application as rejected\n• Prevent the user from accessing their build session\n\nClick OK to reject, Cancel to keep the application.`);

    if (!confirmed) {
        return; // User cancelled
    }

    currentApp = app;
    await updateStatus('rejected');
}

async function quickHold(s3Key) {
    const app = applications.find(a => a.s3Key === s3Key);
    if (!app) return;
    currentApp = app;
    await updateStatus('hold');
}

async function retrySession(s3Key) {
    const app = applications.find(a => a.s3Key === s3Key);
    if (!app) return;

    const idx = applications.findIndex(a => a.s3Key === s3Key);
    if (idx !== -1) {
        applications[idx]._sessionLoading = true;
        delete applications[idx].sessionError;
        renderApplications();
        setTimeout(() => {
            const card = document.querySelector(`.app-card[data-key="${s3Key}"]`);
            if (card) card.classList.add('expanded');
        }, 50);
    }

    currentApp = app;
    await updateStatus('approved');

    if (idx !== -1) {
        delete applications[idx]._sessionLoading;
    }
}

async function rebuildMVP(s3Key) {
    const app = applications.find(a => a.s3Key === s3Key);
    if (!app) return;

    currentApp = app;

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'trigger-build',
                s3Key: s3Key,
                password: adminPassword,
                rebuild: true
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Build started!', 'success');
            app.jobId = data.jobId;
            app.buildProgress = { status: 'in_progress', percent: 5, phase: 'starting', message: 'Initializing...' };
            renderApplications();
            setTimeout(() => toggleCard(s3Key), 100);
        } else {
            showToast(data.error || 'Failed to start build', 'error');
        }
    } catch (error) {
        showToast('Failed to start build', 'error');
    }
}

async function cancelBuild(s3Key) {
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'cancel-build',
                s3Key: s3Key,
                password: adminPassword
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Build cancelled', 'info');
            if (ws && ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'cancel', s3Key }));
            }
            loadApplications();
        } else {
            showToast(data.error || 'Failed to cancel', 'error');
        }
    } catch (error) {
        showToast('Failed to cancel build', 'error');
    }
}

// Filter buttons
filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        filterBtns.forEach(b => {
            b.classList.remove('active');
            b.style.background = 'var(--bg-secondary)';
            b.style.color = 'var(--text-secondary)';
            b.style.border = 'none';
        });
        btn.classList.add('active');
        btn.style.background = 'rgba(var(--primary-rgb), 0.2)';
        btn.style.color = 'var(--primary)';
        btn.style.border = '1px solid rgba(var(--primary-rgb), 0.3)';
        currentFilter = btn.dataset.filter;
        renderApplications();
    });
});

// Global User Filter
const userFilterDropdown = document.getElementById('user-filter-dropdown');
if (userFilterDropdown) {
    userFilterDropdown.addEventListener('change', (e) => {
        currentUserFilter = e.target.value;
        console.log(`[User Filter] Changed to: ${currentUserFilter}`);

        switch(currentView) {
            case 'applications':
                renderApplications();
                break;
            case 'chats':
                renderChatSessions();
                break;
            case 'clients':
                renderClientProfiles();
                break;
            case 'builds':
                renderBuildHistory();
                break;
            case 'costs':
                loadCostsSummary();
                break;
        }
    });
}

// Refresh
refreshBtn.addEventListener('click', async () => {
    await Promise.all([
        loadApplications(),
        loadChatSessions(),
        loadClientProfiles(),
        loadBuildHistory()
    ]);
    populateUserDropdown();
});

// Poll for session result
async function pollForSessionResult(s3Key, maxAttempts = 8, intervalMs = 5000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        showToast(`Waiting for session... (${attempt}/${maxAttempts})`, 'info');
        await new Promise(r => setTimeout(r, intervalMs));

        try {
            const res = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'admin-list', password: adminPassword })
            });
            const data = await res.json();

            if (data.success && data.applications) {
                const app = data.applications.find(a => a.s3Key === s3Key);
                if (app?.guid && app?.sessionLink) {
                    return { success: true, application: app };
                }
                if (app?.sessionError) {
                    return { success: false, error: app.sessionError, application: app };
                }
            }
        } catch (pollError) {
            console.log('Poll attempt failed:', pollError.message);
        }
    }
    return { success: false, error: 'Timeout waiting for session creation' };
}

// Update Status
async function updateStatus(status) {
    if (!currentApp) return;
    const requestStartTime = Date.now();
    const appS3Key = currentApp.s3Key;

    try {
        showToast(`${status === 'approved' ? 'Approving' : status === 'hold' ? 'Putting on hold' : 'Rejecting'}...`, 'info');

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
            const idx = applications.findIndex(a => a.s3Key === currentApp.s3Key);
            if (idx !== -1) {
                applications[idx] = { ...applications[idx], ...data.application };
                delete applications[idx]._sessionLoading;
            }
            updateStats();

            if (status === 'approved') {
                if (data.application?.guid) {
                    showToast('Approved! Session created successfully.', 'success');
                } else if (data.application?.sessionError) {
                    showToast('Approved but session failed: ' + data.application.sessionError, 'error');
                } else {
                    showToast('Approved!', 'success');
                }
            } else if (status === 'hold') {
                showToast('Application placed on hold', 'info');
            } else {
                showToast('Rejected', 'info');
            }

            renderApplications();

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
        const requestDuration = Date.now() - requestStartTime;
        const looksLikeTimeout = requestDuration > 15000;

        if (status === 'approved' && looksLikeTimeout) {
            showToast('Request timed out, checking if session was created...', 'info');

            const pollResult = await pollForSessionResult(appS3Key);

            const idx = applications.findIndex(a => a.s3Key === appS3Key);
            if (pollResult.success) {
                if (idx !== -1) {
                    applications[idx] = { ...applications[idx], ...pollResult.application };
                    delete applications[idx]._sessionLoading;
                }
                updateStats();
                showToast('Session created successfully!', 'success');
                renderApplications();
                setTimeout(() => {
                    const card = document.querySelector(`.app-card[data-key="${appS3Key}"]`);
                    if (card) card.classList.add('expanded');
                }, 100);
            } else if (pollResult.application?.sessionError) {
                if (idx !== -1) {
                    applications[idx] = { ...applications[idx], ...pollResult.application };
                    delete applications[idx]._sessionLoading;
                }
                showToast('Session creation failed: ' + pollResult.error, 'error');
                renderApplications();
            } else {
                if (idx !== -1) {
                    delete applications[idx]._sessionLoading;
                }
                showToast('Could not confirm session creation. Please refresh.', 'error');
                renderApplications();
            }
        } else {
            const idx = applications.findIndex(a => a.s3Key === appS3Key);
            if (idx !== -1) {
                delete applications[idx]._sessionLoading;
            }
            showToast('Connection error: ' + e.message, 'error');
            renderApplications();
        }
    }
}

// Modal close handlers
closeModal.addEventListener('click', () => {
    detailModal.classList.add('hidden');
});
detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) {
        detailModal.classList.add('hidden');
    }
});

// Check for saved session
const savedPassword = sessionStorage.getItem('adminPassword');
if (savedPassword) {
    adminPassword = savedPassword;
    loginScreen.classList.add('hidden');
    dashboard.classList.remove('hidden');
    Promise.all([
        loadApplications(),
        loadChatSessions(),
        loadClientProfiles(),
        loadBuildHistory(),
        loadCostsSummary()
    ]).then(() => {
        updateAllCostSections();
        populateUserDropdown();
    });
    onLoginSuccess();
}

// Navigation Tabs
const navTabs = document.querySelectorAll('.nav-tab');
const viewContents = document.querySelectorAll('.view-content');
let currentView = 'applications';

navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const view = tab.dataset.view;
        if (view === currentView) return;

        navTabs.forEach(t => {
            t.classList.remove('active');
            t.style.background = 'var(--bg-secondary)';
            t.style.color = 'var(--text-secondary)';
            t.style.border = '1px solid transparent';
            t.style.boxShadow = 'none';
        });

        tab.classList.add('active');
        tab.style.background = 'linear-gradient(135deg, var(--primary), var(--secondary))';
        tab.style.color = 'white';
        tab.style.border = '1px solid var(--primary)';
        tab.style.boxShadow = '0 4px 12px var(--glow-color)';

        viewContents.forEach(v => v.classList.add('hidden'));
        document.getElementById(`view-${view}`).classList.remove('hidden');
        currentView = view;

        if (view === 'applications') renderApplications();
        else if (view === 'chats') renderChatSessions();
        else if (view === 'clients') renderClientProfiles();
        else if (view === 'builds') renderBuildHistory();
        else if (view === 'costs') loadCostsSummary();
        else if (view === 'events') loadEventRegistrations();
    });
});

// Initialize costs view handlers
initCostsView();

// Chat History
let chatSessions = [];
let chatSourceFilter = 'all';
let chatStatusFilter = 'all';

document.querySelectorAll('.chat-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.chat-filter-btn').forEach(b => {
            b.classList.remove('active');
            b.style.background = 'var(--bg-secondary)';
            b.style.color = 'var(--text-secondary)';
            b.style.border = 'none';
        });
        btn.classList.add('active');
        btn.style.background = 'rgba(var(--primary-rgb), 0.2)';
        btn.style.color = 'var(--primary)';
        btn.style.border = '1px solid rgba(var(--primary-rgb), 0.3)';
        chatSourceFilter = btn.dataset.source;
        loadChatSessions();
    });
});

const chatStatusFilterDropdown = document.getElementById('chat-status-filter');
if (chatStatusFilterDropdown) {
    chatStatusFilterDropdown.addEventListener('change', (e) => {
        chatStatusFilter = e.target.value;
        renderChatSessions();
    });
}

const clearChatsBtn = document.getElementById('clear-chats-btn');
if (clearChatsBtn) {
    clearChatsBtn.addEventListener('click', async () => {
        let sessionsToDelete = chatSessions;

        if (currentUserFilter === 'anonymous') {
            sessionsToDelete = sessionsToDelete.filter(session =>
                !session.visitorInfo?.email || !session.visitorInfo?.name
            );
        } else if (currentUserFilter !== 'all') {
            sessionsToDelete = sessionsToDelete.filter(session =>
                session.visitorInfo?.email === currentUserFilter
            );
        }

        if (chatStatusFilter !== 'all') {
            sessionsToDelete = sessionsToDelete.filter(session =>
                session.status === chatStatusFilter
            );
        }

        if (sessionsToDelete.length === 0) {
            alert('No chat sessions match the current filters.');
            return;
        }

        const confirmMsg = `Are you sure you want to permanently delete ${sessionsToDelete.length} chat session(s)?\n\nThis action cannot be undone!`;

        if (!confirm(confirmMsg)) return;

        const sessionIds = sessionsToDelete.map(session => ({
            sessionId: session.sessionId,
            source: session.source
        }));

        clearChatsBtn.disabled = true;
        clearChatsBtn.textContent = 'Deleting...';

        try {
            const res = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'admin-delete-chats',
                    password: adminPassword,
                    sessionIds: sessionIds
                })
            });
            const data = await res.json();

            if (data.success) {
                alert(`Successfully deleted ${data.deleted} chat session(s).`);
                await loadChatSessions();
                await Promise.all([
                    loadApplications(),
                    loadClientProfiles(),
                    loadBuildHistory()
                ]);
                populateUserDropdown();
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (e) {
            alert(`Connection error: ${e.message}`);
        }

        clearChatsBtn.disabled = false;
        clearChatsBtn.textContent = 'Clear Chats';
    });
}

async function loadChatSessions() {
    const chatsList = document.getElementById('chats-list');
    chatsList.innerHTML = '<div class="text-center py-12 text-theme-muted">Loading chat sessions...</div>';

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'admin-chats', password: adminPassword, source: chatSourceFilter })
        });
        const data = await res.json();

        if (data.success) {
            chatSessions = data.sessions;
            renderChatSessions();
        } else {
            chatsList.innerHTML = `<div class="text-center py-12 text-red-400">Error: ${data.error}</div>`;
        }
    } catch (e) {
        chatsList.innerHTML = `<div class="text-center py-12 text-red-400">Connection error</div>`;
    }
}

function renderChatSessions() {
    const chatsList = document.getElementById('chats-list');

    let filtered = chatSessions;
    if (currentUserFilter === 'anonymous') {
        filtered = chatSessions.filter(session =>
            !session.visitorInfo?.email || !session.visitorInfo?.name
        );
    } else if (currentUserFilter !== 'all') {
        filtered = chatSessions.filter(session =>
            session.visitorInfo?.email === currentUserFilter
        );
    }

    if (chatStatusFilter !== 'all') {
        filtered = filtered.filter(session =>
            session.status === chatStatusFilter
        );
    }

    if (filtered.length === 0) {
        chatsList.innerHTML = '<div class="text-center py-12 text-theme-muted">No chat sessions found</div>';
        return;
    }

    chatsList.innerHTML = filtered.map(session => {
        const lastMsg = session.messages?.[session.messages.length - 1]?.content?.substring(0, 100) || 'No messages';
        const statusColor = session.status === 'converted' ? 'text-green-400' : session.status === 'active' ? 'text-yellow-400' : 'text-theme-muted';
        const sourceIcon = session.source === 'apply' ? '📝' : '🏠';
        return `
            <div class="glass-card rounded-xl p-4 cursor-pointer transition" style="border: 1px solid var(--border-color);" onclick="showChatDetail('${session.sessionId}', '${session.source}')" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='var(--border-color)'">
                <div class="flex justify-between items-start mb-2">
                    <div class="flex items-center gap-2">
                        <span class="text-xl">${sourceIcon}</span>
                        <span class="font-semibold text-theme-primary">${session.visitorInfo?.name || 'Anonymous'}</span>
                        <span class="text-xs px-2 py-1 rounded-full ${statusColor}" style="background: var(--bg-secondary);">${session.status}</span>
                    </div>
                    <span class="text-xs text-theme-muted">${new Date(session.startedAt).toLocaleString()}</span>
                </div>
                <p class="text-sm text-theme-secondary truncate">${lastMsg}...</p>
                <div class="flex gap-4 mt-2 text-xs text-theme-muted">
                    <span>${session.metadata?.totalMessages || 0} messages</span>
                    ${session.visitorInfo?.email ? `<span>${session.visitorInfo.email}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

async function showChatDetail(sessionId, source) {
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'admin-chat-detail', password: adminPassword, sessionId, source })
        });
        const data = await res.json();
        if (data.success) {
            const session = data.session;
            const modalContent = document.getElementById('modal-content');
            document.getElementById('modal-name').textContent = session.visitorInfo?.name || 'Anonymous Chat';
            document.getElementById('modal-email').textContent = `Session: ${sessionId} | ${session.source}`;

            modalContent.innerHTML = `
                <div class="space-y-4">
                    <div class="flex gap-4 text-sm">
                        <span class="text-theme-muted">Started: ${new Date(session.startedAt).toLocaleString()}</span>
                        <span class="text-theme-muted">Status: ${session.status}</span>
                    </div>
                    <div style="border-top: 1px solid var(--border-color); padding-top: 1rem;">
                        <h4 class="font-semibold mb-3 text-theme-primary">Conversation:</h4>
                        <div class="space-y-3 max-h-96 overflow-y-auto">
                            ${session.messages?.map(m => `
                                <div class="p-3 rounded-lg ${m.role === 'user' ? 'ml-8' : 'mr-8'}" style="background: ${m.role === 'user' ? 'rgba(var(--primary-rgb), 0.2)' : 'var(--bg-secondary)'};">
                                    <p class="text-xs text-theme-muted mb-1">${m.role === 'user' ? 'User' : 'AI'}</p>
                                    <p class="text-sm text-theme-primary">${m.content}</p>
                                </div>
                            `).join('') || '<p class="text-theme-muted">No messages</p>'}
                        </div>
                    </div>
                </div>
            `;

            document.getElementById('modal-approve').style.display = 'none';
            document.getElementById('modal-reject').style.display = 'none';
            document.getElementById('review-notes').style.display = 'none';
            detailModal.classList.remove('hidden');
        }
    } catch (e) {
        console.error('Error loading chat detail:', e);
    }
}

// Client Profiles
let clientProfiles = [];

async function loadClientProfiles() {
    const clientsList = document.getElementById('clients-list');
    clientsList.innerHTML = '<div class="text-center py-12 text-theme-muted col-span-full">Loading client profiles...</div>';

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'admin-clients', password: adminPassword })
        });
        const data = await res.json();

        if (data.success) {
            clientProfiles = data.clients;
            renderClientProfiles();
        } else {
            clientsList.innerHTML = `<div class="text-center py-12 text-red-400 col-span-full">Error: ${data.error}</div>`;
        }
    } catch (e) {
        clientsList.innerHTML = `<div class="text-center py-12 text-red-400 col-span-full">Connection error</div>`;
    }
}

let clientSortField = 'submittedAt';
let clientSortDir = 'desc';

function sortClients(field) {
    if (clientSortField === field) {
        clientSortDir = clientSortDir === 'asc' ? 'desc' : 'asc';
    } else {
        clientSortField = field;
        clientSortDir = 'asc';
    }
    renderClientProfiles();
}

function renderClientProfiles() {
    const clientsList = document.getElementById('clients-list');
    clientsList.className = '';

    let filtered = clientProfiles;
    if (currentUserFilter === 'anonymous') {
        filtered = clientProfiles.filter(client => !client.email || !client.name);
    } else if (currentUserFilter !== 'all') {
        filtered = clientProfiles.filter(client => client.email === currentUserFilter);
    }

    if (filtered.length === 0) {
        clientsList.innerHTML = '<div class="text-center py-12 text-theme-muted">No client profiles found</div>';
        return;
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
        let valA, valB;
        switch (clientSortField) {
            case 'name': valA = (a.name || '').toLowerCase(); valB = (b.name || '').toLowerCase(); break;
            case 'email': valA = (a.email || '').toLowerCase(); valB = (b.email || '').toLowerCase(); break;
            case 'phone': valA = a.phone || ''; valB = b.phone || ''; break;
            case 'status': valA = a.status || ''; valB = b.status || ''; break;
            case 'chats': valA = a.chatSessions?.length || 0; valB = b.chatSessions?.length || 0; break;
            case 'apps': valA = a.applications?.length || 0; valB = b.applications?.length || 0; break;
            case 'builds': valA = a.builds?.length || 0; valB = b.builds?.length || 0; break;
            case 'submittedAt': valA = new Date(a.submittedAt || a.createdAt || 0); valB = new Date(b.submittedAt || b.createdAt || 0); break;
            default: valA = ''; valB = '';
        }
        if (valA < valB) return clientSortDir === 'asc' ? -1 : 1;
        if (valA > valB) return clientSortDir === 'asc' ? 1 : -1;
        return 0;
    });

    const statusColors = {
        prospect: 'bg-slate-500',
        applied: 'bg-yellow-500',
        approved: 'bg-green-500',
        pending: 'bg-yellow-500',
        building: 'bg-purple-500',
        delivered: 'bg-green-500',
        rejected: 'bg-red-500',
        hold: 'bg-orange-500'
    };

    const avatarColors = ['#FC2A0D', '#6366f1', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#fb923c'];
    const arrow = (field) => clientSortField === field ? (clientSortDir === 'asc' ? ' &#9650;' : ' &#9660;') : '';
    const thClass = 'px-4 py-3 text-theme-muted font-medium cursor-pointer select-none';
    const thHover = `onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color=''"`;

    clientsList.innerHTML = `
        <div class="overflow-x-auto rounded-xl" style="border: 1px solid var(--border-color);">
            <table class="w-full text-sm">
                <thead>
                    <tr style="background: var(--bg-secondary); border-bottom: 1px solid var(--border-color);">
                        <th class="text-left px-4 py-3 text-theme-muted font-medium">#</th>
                        <th class="text-left ${thClass}" onclick="sortClients('name')" ${thHover}>Name${arrow('name')}</th>
                        <th class="text-left ${thClass}" onclick="sortClients('email')" ${thHover}>Email${arrow('email')}</th>
                        <th class="text-left ${thClass}" onclick="sortClients('phone')" ${thHover}>Phone${arrow('phone')}</th>
                        <th class="text-left ${thClass}" onclick="sortClients('status')" ${thHover}>Status${arrow('status')}</th>
                        <th class="text-center ${thClass}" onclick="sortClients('chats')" ${thHover}>Chats${arrow('chats')}</th>
                        <th class="text-center ${thClass}" onclick="sortClients('apps')" ${thHover}>Apps${arrow('apps')}</th>
                        <th class="text-center ${thClass}" onclick="sortClients('builds')" ${thHover}>Builds${arrow('builds')}</th>
                        <th class="text-left ${thClass}" onclick="sortClients('submittedAt')" ${thHover}>Submitted${arrow('submittedAt')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${filtered.map((client, i) => {
                        const bgColor = avatarColors[i % avatarColors.length];
                        const initial = (client.name?.[0] || '?').toUpperCase();
                        const avatarHtml = client.avatarUrl
                            ? `<div class="user-avatar-placeholder" style="background:${bgColor};overflow:hidden;padding:0;"><img src="${client.avatarUrl}" alt="${initial}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;">${initial}</span></div>`
                            : `<div class="user-avatar-placeholder" style="background:${bgColor};">${initial}</div>`;
                        return `
                        <tr class="cursor-pointer transition-colors" onclick="showClientDetail('${client.clientId}')" style="border-bottom: 1px solid var(--border-color);" onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background='transparent'">
                            <td class="px-4 py-3 text-theme-muted">${i + 1}</td>
                            <td class="px-4 py-3">
                                <div class="flex items-center gap-2">
                                    ${avatarHtml}
                                    <span class="font-medium text-theme-primary">${client.name || 'Unknown'}</span>
                                </div>
                            </td>
                            <td class="px-4 py-3 text-theme-muted">${client.email || '-'}</td>
                            <td class="px-4 py-3 text-theme-muted">${client.phone || '-'}</td>
                            <td class="px-4 py-3">
                                <span class="text-xs px-2 py-0.5 rounded-full text-white ${statusColors[client.status] || 'bg-slate-500'}">${client.status}</span>
                            </td>
                            <td class="px-4 py-3 text-center text-theme-muted">${client.chatSessions?.length || 0}</td>
                            <td class="px-4 py-3 text-center text-theme-muted">${client.applications?.length || 0}</td>
                            <td class="px-4 py-3 text-center text-theme-muted">${client.builds?.length || 0}</td>
                            <td class="px-4 py-3 text-theme-muted text-xs">${(client.submittedAt || client.createdAt) ? new Date(client.submittedAt || client.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;
}

async function showClientDetail(clientId) {
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'admin-client-detail', password: adminPassword, clientId })
        });
        const data = await res.json();
        if (data.success) {
            const client = data.client;
            document.getElementById('modal-name').textContent = client.name || 'Unknown Client';
            document.getElementById('modal-email').textContent = client.email || clientId;

            const modalContent = document.getElementById('modal-content');
            modalContent.innerHTML = `
                <div class="grid grid-cols-2 gap-4 mb-4">
                    <div class="glass-card rounded-lg p-3">
                        <p class="text-xs text-theme-muted">Phone</p>
                        <p class="font-semibold text-theme-primary">${client.phone || 'N/A'}</p>
                    </div>
                    <div class="glass-card rounded-lg p-3">
                        <p class="text-xs text-theme-muted">Status</p>
                        <p class="font-semibold capitalize text-theme-primary">${client.status}</p>
                    </div>
                </div>
                <div style="border-top: 1px solid var(--border-color); padding-top: 1rem;">
                    <h4 class="font-semibold mb-3 text-theme-primary">Timeline:</h4>
                    <div class="space-y-2 max-h-64 overflow-y-auto">
                        ${client.timeline?.map(event => `
                            <div class="flex items-center gap-3 text-sm">
                                <span class="w-2 h-2 rounded-full" style="background: var(--primary);"></span>
                                <span class="text-theme-muted">${new Date(event.timestamp).toLocaleString()}</span>
                                <span class="capitalize text-theme-primary">${event.event?.replace(/_/g, ' ')}</span>
                            </div>
                        `).join('') || '<p class="text-theme-muted">No timeline events</p>'}
                    </div>
                </div>
            `;

            document.getElementById('modal-approve').style.display = 'none';
            document.getElementById('modal-reject').style.display = 'none';
            document.getElementById('review-notes').style.display = 'none';
            detailModal.classList.remove('hidden');
        }
    } catch (e) {
        console.error('Error loading client detail:', e);
    }
}

// Build History
let buildHistory = [];

async function loadBuildHistory() {
    const buildsList = document.getElementById('builds-list');
    buildsList.innerHTML = '<div class="text-center py-12 text-theme-muted">Loading build history...</div>';

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'admin-builds', password: adminPassword })
        });
        const data = await res.json();

        if (data.success) {
            buildHistory = data.builds.map(build => ({
                ...build,
                mvpUrl: fixMvpUrl(build.mvpUrl)
            }));
            renderBuildHistory();
        } else {
            buildsList.innerHTML = `<div class="text-center py-12 text-red-400">Error: ${data.error}</div>`;
        }
    } catch (e) {
        buildsList.innerHTML = `<div class="text-center py-12 text-red-400">Connection error</div>`;
    }
}

function renderBuildHistory() {
    const buildsList = document.getElementById('builds-list');

    let filtered = buildHistory;
    if (currentUserFilter === 'anonymous') {
        filtered = buildHistory.filter(build => !build.client?.name);
    } else if (currentUserFilter !== 'all') {
        filtered = buildHistory.filter(build => {
            const clientName = build.client?.name;
            if (!clientName) return false;
            if (currentUserFilter.includes('@')) {
                const user = allUsers.find(u => u.email === currentUserFilter);
                return user && user.name === clientName;
            } else {
                return clientName === currentUserFilter;
            }
        });
    }

    if (filtered.length === 0) {
        buildsList.innerHTML = '<div class="text-center py-12 text-theme-muted">No builds found</div>';
        return;
    }

    const statusColors = {
        pending: 'text-theme-muted',
        building: 'text-yellow-400',
        completed: 'text-green-400',
        failed: 'text-red-400'
    };

    const statusBg = {
        pending: 'bg-slate-500/20',
        building: 'bg-yellow-500/20',
        completed: 'bg-green-500/20',
        failed: 'bg-red-500/20'
    };

    const sortedBuilds = [...filtered].sort((a, b) => {
        const dateA = new Date(a.timestamps?.created || a.createdAt || 0);
        const dateB = new Date(b.timestamps?.created || b.createdAt || 0);
        return dateB - dateA;
    });

    buildsList.innerHTML = sortedBuilds.map(build => `
        <div class="build-card glass-card rounded-xl overflow-hidden" data-build-id="${build.buildId}">
            <div class="card-header p-4" onclick="toggleBuildCard('${build.buildId}')">
                <div class="flex justify-between items-start">
                    <div class="flex-1">
                        <div class="flex items-center gap-3">
                            <h3 class="font-semibold text-theme-primary">${build.client?.name || 'Unknown Client'}</h3>
                            <span class="px-2 py-1 rounded-full text-xs font-semibold ${statusBg[build.status] || 'bg-slate-500/20'} ${statusColors[build.status] || 'text-theme-muted'} ${build.status === 'building' ? 'animate-pulse' : ''}">
                                ${build.status === 'building' ? '⏳ ' : ''}${build.status.toUpperCase()}
                            </span>
                        </div>
                        <p class="text-theme-muted text-xs mt-1">${build.buildId}</p>
                        <p class="text-sm text-theme-secondary mt-2 line-clamp-1">${build.business?.idea?.substring(0, 80) || 'No description'}...</p>
                    </div>
                    <div class="flex items-center gap-3">
                        <button onclick="event.stopPropagation(); viewBuildLogs('${build.buildId}')"
                                class="px-2 py-1 text-xs rounded-lg transition flex items-center gap-1" style="background: var(--bg-secondary); color: var(--accent);">
                            Logs
                        </button>
                        <p class="text-theme-muted text-xs">${new Date(build.timestamps?.created || build.createdAt).toLocaleDateString()}</p>
                        <svg class="expand-icon w-5 h-5 text-theme-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                        </svg>
                    </div>
                </div>
            </div>

            <div class="card-details" style="border-top: 1px solid var(--border-color);">
                <div class="p-4 space-y-4">
                    <div class="grid grid-cols-3 gap-4">
                        <div>
                            <p class="text-theme-muted text-xs uppercase mb-1">Status</p>
                            <p class="${statusColors[build.status] || 'text-theme-secondary'} font-semibold capitalize">${build.status}</p>
                        </div>
                        <div>
                            <p class="text-theme-muted text-xs uppercase mb-1">Files Created</p>
                            <p class="text-theme-secondary">${build.filesCreated?.length || 0}</p>
                        </div>
                        <div>
                            <p class="text-theme-muted text-xs uppercase mb-1">Created</p>
                            <p class="text-theme-secondary text-sm">${new Date(build.timestamps?.created || build.createdAt).toLocaleString()}</p>
                        </div>
                    </div>

                    ${build.mvpUrl ? `
                    <div class="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                        <p class="text-green-400 font-semibold mb-2">MVP Ready!</p>
                        <p class="text-theme-muted text-sm mb-2 break-all">${build.mvpUrl}</p>
                        <a href="${build.mvpUrl}" target="_blank" onclick="event.stopPropagation()"
                           class="inline-block px-4 py-2 bg-green-500 text-white rounded-lg font-semibold hover:bg-green-600 transition">
                            View MVP
                        </a>
                    </div>
                    ` : ''}

                    ${build.status === 'failed' ? `
                    <div class="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                        <p class="text-red-400 font-semibold mb-2">Build Failed</p>
                        <p class="text-sm text-theme-muted mb-4">The MVP build did not complete successfully.</p>
                        <button onclick="event.stopPropagation(); restartBuild('${build.buildId}')"
                                class="px-4 py-2 text-white rounded-lg font-semibold hover:opacity-90 transition" style="background: linear-gradient(135deg, #f59e0b, #dc2626);">
                            Restart Build
                        </button>
                    </div>
                    ` : ''}

                    <div id="build-log-${build.buildId.replace(/[^a-zA-Z0-9]/g, '_')}" class="build-log-container">
                        <p class="text-theme-muted text-sm">Click to load agent log...</p>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

async function toggleBuildCard(buildId) {
    const card = document.querySelector(`.build-card[data-build-id="${buildId}"]`);
    const wasExpanded = card.classList.contains('expanded');

    document.querySelectorAll('.build-card.expanded').forEach(c => c.classList.remove('expanded'));

    if (!wasExpanded) {
        card.classList.add('expanded');
        const logContainer = document.getElementById(`build-log-${buildId.replace(/[^a-zA-Z0-9]/g, '_')}`);
        if (logContainer && logContainer.innerHTML.includes('Click to load')) {
            loadBuildAgentLog(buildId, logContainer);
        }
    }
}

async function loadBuildAgentLog(buildId, container) {
    container.innerHTML = '<p class="text-theme-muted text-sm">Loading agent log...</p>';
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'admin-build-detail', password: adminPassword, buildId })
        });
        const data = await res.json();
        if (data.success && data.build.agentLog?.entries?.length) {
            const log = data.build.agentLog;
            container.innerHTML = `
                <div style="border-top: 1px solid var(--border-color); padding-top: 1rem;">
                    <h4 class="font-semibold mb-3 text-theme-secondary">Agent Log (${log.totalEntries} entries):</h4>
                    <div class="space-y-1 max-h-48 overflow-y-auto rounded-lg p-3 text-xs font-mono" style="background: var(--bg-primary);">
                        ${log.entries.slice(-20).map(entry => `
                            <div class="flex gap-2 ${entry.type === 'error' ? 'text-red-400' : 'text-theme-muted'}">
                                <span class="opacity-50">${new Date(entry.timestamp).toLocaleTimeString()}</span>
                                <span style="color: var(--primary);">[${entry.phase}]</span>
                                <span class="truncate">${entry.content?.substring(0, 100) || ''}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else {
            container.innerHTML = '<p class="text-theme-muted text-sm">No agent log available</p>';
        }
    } catch (e) {
        container.innerHTML = '<p class="text-red-400 text-sm">Error loading log</p>';
    }
}

async function restartBuild(buildId) {
    const buttons = document.querySelectorAll(`button[onclick*="restartBuild('${buildId}')"]`);
    const originalContents = [];

    buttons.forEach((btn, i) => {
        originalContents[i] = btn.innerHTML;
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        btn.innerHTML = 'Starting...';
    });

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'admin-restart-build', password: adminPassword, buildId })
        });
        const data = await res.json();

        if (data.success) {
            buttons.forEach(btn => {
                btn.innerHTML = 'Build Started!';
                btn.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
            });

            setTimeout(() => {
                detailModal.classList.add('hidden');
                loadBuildHistory();
            }, 1500);
        } else {
            buttons.forEach((btn, i) => {
                btn.disabled = false;
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
                btn.innerHTML = originalContents[i];
            });
            alert('Error: ' + (data.error || 'Failed to restart build'));
        }
    } catch (e) {
        buttons.forEach((btn, i) => {
            btn.disabled = false;
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
            btn.innerHTML = originalContents[i];
        });
        alert('Connection error. Please try again.');
    }
}

async function viewBuildLogs(buildId) {
    document.getElementById('modal-name').textContent = 'Build Logs';
    document.getElementById('modal-email').textContent = buildId;
    document.getElementById('modal-approve').style.display = 'none';
    document.getElementById('modal-reject').style.display = 'none';
    document.getElementById('review-notes').style.display = 'none';

    const modalContent = document.getElementById('modal-content');
    modalContent.innerHTML = `
        <div class="flex items-center justify-center py-8">
            <svg class="w-6 h-6 animate-spin" style="color: var(--primary);" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            <span class="ml-3 text-theme-primary">Loading logs...</span>
        </div>
    `;
    detailModal.classList.remove('hidden');

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'admin-build-detail', password: adminPassword, buildId })
        });
        const data = await res.json();

        if (data.success && data.build) {
            const build = data.build;
            const entries = build.agentLog?.entries || [];

            modalContent.innerHTML = `
                <div class="space-y-4">
                    <div class="grid grid-cols-3 gap-3">
                        <div class="glass-card rounded-lg p-3">
                            <p class="text-xs text-theme-muted">Status</p>
                            <p class="font-semibold capitalize ${build.status === 'failed' ? 'text-red-400' : build.status === 'completed' ? 'text-green-400' : 'text-yellow-400'}">${build.status}</p>
                        </div>
                        <div class="glass-card rounded-lg p-3">
                            <p class="text-xs text-theme-muted">Total Log Entries</p>
                            <p class="font-semibold text-theme-primary">${entries.length}</p>
                        </div>
                        <div class="glass-card rounded-lg p-3">
                            <p class="text-xs text-theme-muted">Errors</p>
                            <p class="font-semibold text-red-400">${entries.filter(e => e.type === 'error').length}</p>
                        </div>
                    </div>

                    <div id="log-entries" class="max-h-96 overflow-y-auto rounded-lg p-4 text-xs font-mono space-y-1" style="background: var(--bg-primary);">
                        ${entries.map(entry => `
                            <div class="log-entry flex gap-2 py-1 ${entry.type === 'error' ? 'text-red-400 bg-red-500/10' : entry.type === 'tool_use' ? 'text-cyan-400' : entry.type === 'progress' ? 'text-green-400' : 'text-theme-muted'}" style="border-bottom: 1px solid var(--bg-secondary);" data-type="${entry.type}">
                                <span class="opacity-50 whitespace-nowrap">${new Date(entry.timestamp).toLocaleTimeString()}</span>
                                <span style="color: var(--primary);" class="whitespace-nowrap">[${entry.phase}]</span>
                                <span class="text-yellow-400 whitespace-nowrap">${entry.type}</span>
                                <span class="flex-1 break-all">${(entry.content || '').substring(0, 200)}${(entry.content || '').length > 200 ? '...' : ''}</span>
                            </div>
                        `).join('')}
                    </div>

                    <div class="flex justify-between items-center pt-2" style="border-top: 1px solid var(--border-color);">
                        <p class="text-xs text-theme-muted">Build ID: ${buildId}</p>
                    </div>
                </div>
            `;
        } else {
            modalContent.innerHTML = `
                <div class="text-center py-8 text-red-400">
                    <p>No logs available for this build</p>
                    <p class="text-sm text-theme-muted mt-2">${data.error || 'Log file may not exist'}</p>
                </div>
            `;
        }
    } catch (e) {
        modalContent.innerHTML = `
            <div class="text-center py-8 text-red-400">
                <p>Error loading logs</p>
                <p class="text-sm text-theme-muted mt-2">${e.message}</p>
            </div>
        `;
    }
}

// ==================== AWS COSTS ====================

let costsData = null;
let costsLastUpdated = null;

// Load costs summary from API
async function loadCostsSummary() {
    // Show loading spinner in costs tab table (if visible)
    const tableBody = document.getElementById('costs-table-body');
    if (tableBody) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="px-4 py-12 text-center text-theme-muted">
                    <svg class="w-8 h-8 mx-auto mb-2 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                    </svg>
                    Loading cost data from AWS...
                </td>
            </tr>
        `;
    }

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'admin-costs-summary', password: adminPassword })
        });
        const data = await res.json();

        if (data.success) {
            costsData = data;
            costsLastUpdated = data.lastUpdated;
            console.log('[Admin] Costs loaded:', data.users?.length, 'users,', data.totals?.projectCount, 'projects');
            // Update application card cost sections (with fallback to individual user-costs API)
            await updateAllCostSections();
            // Then update the Costs tab table (may fail if tab elements missing)
            try { renderCostsSummary(data); } catch (e) { console.warn('[Admin] renderCostsSummary error:', e); }
        } else {
            console.warn('[Admin] Bulk costs API returned error, using per-user fallback:', data.error);
            // Bulk API failed — still try per-user fallback via updateAllCostSections
            await updateAllCostSections();
            if (tableBody) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="6" class="px-4 py-12 text-center text-theme-muted">
                            Loading cost data per user...
                        </td>
                    </tr>
                `;
            }
        }
    } catch (e) {
        console.warn('[Admin] Bulk costs API connection error, using per-user fallback:', e.message);
        // Network error on bulk API — still try per-user fallback
        await updateAllCostSections();
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="px-4 py-12 text-center text-theme-muted">
                        Loaded cost data per user (bulk API unavailable)
                    </td>
                </tr>
            `;
        }
    }
}

// Format currency
function formatCurrency(amount) {
    return '$' + (amount || 0).toFixed(2);
}

// Format bytes to human readable
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Render costs summary stats and table
function renderCostsSummary(data) {
    // Update stats
    document.getElementById('cost-stat-estimated').textContent = formatCurrency(data.totals?.estimated);
    document.getElementById('cost-stat-s3').textContent = formatCurrency(data.totals?.s3);
    document.getElementById('cost-stat-cloudfront').textContent = formatCurrency(data.totals?.cloudfront);
    document.getElementById('cost-stat-projects').textContent = data.totals?.projectCount || 0;

    // Update last updated
    const lastUpdatedEl = document.getElementById('costs-last-updated');
    if (lastUpdatedEl && data.lastUpdated) {
        lastUpdatedEl.textContent = new Date(data.lastUpdated).toLocaleString();
    }

    // Render table
    const tableBody = document.getElementById('costs-table-body');
    if (!tableBody) return;

    if (!data.users || data.users.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="px-4 py-12 text-center text-theme-muted">
                    <svg class="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    No deployments found with cost data
                </td>
            </tr>
        `;
        return;
    }

    // Sort users by total cost (highest first)
    const sortedUsers = [...data.users].sort((a, b) => (b.costs?.total || 0) - (a.costs?.total || 0));

    tableBody.innerHTML = sortedUsers.map(user => `
        <tr class="cost-row cursor-pointer hover:bg-white/5 transition" data-user-id="${user.userId}" onclick="toggleCostRow('${user.userId}')" style="border-bottom: 1px solid var(--border-color);">
            <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white" style="background: linear-gradient(135deg, var(--primary), var(--secondary));">
                        ${(user.name?.[0] || user.email?.[0] || '?').toUpperCase()}
                    </div>
                    <div>
                        <p class="font-medium text-theme-primary">${user.name || user.email?.split('@')[0] || 'Unknown'}</p>
                        <p class="text-xs text-theme-muted">${user.email || ''}</p>
                    </div>
                </div>
            </td>
            <td class="px-4 py-3 text-center text-theme-secondary">${user.projectCount || 0}</td>
            <td class="px-4 py-3 text-right text-theme-secondary">${formatCurrency(user.costs?.s3)}</td>
            <td class="px-4 py-3 text-right text-theme-secondary">${formatCurrency(user.costs?.cloudfront)}</td>
            <td class="px-4 py-3 text-right font-semibold" style="color: var(--primary);">${formatCurrency(user.costs?.total)}</td>
            <td class="px-4 py-3 text-center">
                <svg class="expand-cost-icon w-4 h-4 text-theme-muted transition-transform inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                </svg>
            </td>
        </tr>
        <tr class="cost-detail-row hidden" data-user-detail="${user.userId}">
            <td colspan="6" class="px-4 py-4" style="background: rgba(26, 10, 0, 0.3);">
                ${renderUserProjectCosts(user.projects)}
            </td>
        </tr>
    `).join('');
}

// Render per-project costs for a user
function renderUserProjectCosts(projects) {
    if (!projects || projects.length === 0) {
        return '<p class="text-theme-muted text-center">No projects found</p>';
    }

    return `
        <div class="space-y-3">
            <h4 class="font-semibold text-theme-secondary text-sm mb-3">Project Breakdown:</h4>
            ${projects.map(project => `
                <div class="glass-card rounded-lg p-4" style="border: 1px solid var(--border-color);">
                    <div class="flex justify-between items-start mb-3">
                        <div>
                            <h5 class="font-medium text-theme-primary">${project.projectName || 'Unnamed Project'}</h5>
                            ${project.awsResources?.cloudFrontUrl ? `
                                <a href="${project.awsResources.cloudFrontUrl}" target="_blank" class="text-xs hover:underline" style="color: var(--primary);">
                                    ${project.awsResources.cloudFrontUrl}
                                </a>
                            ` : ''}
                        </div>
                        <span class="font-bold" style="color: var(--primary);">${formatCurrency(project.costs?.total)}</span>
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                            <p class="text-theme-muted text-xs">S3 Storage</p>
                            <p class="text-theme-secondary">${formatCurrency(project.costs?.s3?.storage)}</p>
                            <p class="text-xs text-theme-muted">${formatBytes(project.costs?.metrics?.s3SizeBytes)}</p>
                        </div>
                        <div>
                            <p class="text-theme-muted text-xs">CloudFront Transfer</p>
                            <p class="text-theme-secondary">${formatCurrency(project.costs?.cloudfront?.dataTransfer)}</p>
                            <p class="text-xs text-theme-muted">${formatBytes(project.costs?.metrics?.cloudfrontBytesTransferred)}</p>
                        </div>
                        <div>
                            <p class="text-theme-muted text-xs">CloudFront Requests</p>
                            <p class="text-theme-secondary">${formatCurrency(project.costs?.cloudfront?.requests)}</p>
                            <p class="text-xs text-theme-muted">${(project.costs?.metrics?.cloudfrontRequests || 0).toLocaleString()} requests</p>
                        </div>
                        <div>
                            <p class="text-theme-muted text-xs">Resources</p>
                            <p class="text-xs text-theme-muted">S3: ${project.awsResources?.s3Bucket || '-'}</p>
                            <p class="text-xs text-theme-muted">CF: ${project.awsResources?.cloudFrontId || '-'}</p>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// Toggle cost row expansion
function toggleCostRow(userId) {
    const detailRow = document.querySelector(`tr[data-user-detail="${userId}"]`);
    const mainRow = document.querySelector(`tr[data-user-id="${userId}"]`);
    const icon = mainRow?.querySelector('.expand-cost-icon');

    if (detailRow) {
        const isHidden = detailRow.classList.contains('hidden');
        detailRow.classList.toggle('hidden', !isHidden);

        if (icon) {
            icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
        }
    }
}

// Initialize costs view
function initCostsView() {
    const refreshBtn = document.getElementById('refresh-costs-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadCostsSummary();
            showToast('Refreshing cost data...', 'info');
        });
    }
}

// ==================== EMAIL REPORTS ====================

// Send reports to all users (weekly or monthly)
async function sendAllReports(period) {
    const btnSelector = period === 'weekly' ? 'button[onclick*="sendAllReports(\'weekly\')"]' : 'button[onclick*="sendAllReports(\'monthly\')"]';
    const btn = document.querySelector(btnSelector);
    const originalText = btn?.textContent;

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending...';
        btn.classList.add('opacity-50', 'cursor-not-allowed');
    }

    showToast(`Sending ${period} reports to all users...`, 'info');

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'send-all-reports',
                password: adminPassword,
                period: period
            })
        });
        const data = await res.json();

        if (data.success) {
            showToast(`${period.charAt(0).toUpperCase() + period.slice(1)} reports sent! ${data.userReportsSent || 0} user reports, ${data.adminReportSent ? '1 admin report' : 'no admin report'}`, 'success');
        } else {
            showToast(`Error: ${data.error || 'Failed to send reports'}`, 'error');
        }
    } catch (e) {
        console.error('Error sending reports:', e);
        showToast(`Connection error: ${e.message}`, 'error');
    }

    if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
}

// Send admin report only (weekly or monthly)
async function sendAdminReport(period) {
    const btnSelector = period === 'weekly' ? 'button[onclick*="sendAdminReport(\'weekly\')"]' : 'button[onclick*="sendAdminReport(\'monthly\')"]';
    const btn = document.querySelector(btnSelector);
    const originalText = btn?.textContent;

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending...';
        btn.classList.add('opacity-50', 'cursor-not-allowed');
    }

    showToast(`Sending ${period} admin report...`, 'info');

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'send-admin-report',
                password: adminPassword,
                period: period
            })
        });
        const data = await res.json();

        if (data.success) {
            showToast(`${period.charAt(0).toUpperCase() + period.slice(1)} admin report sent successfully!`, 'success');
        } else {
            showToast(`Error: ${data.error || 'Failed to send admin report'}`, 'error');
        }
    } catch (e) {
        console.error('Error sending admin report:', e);
        showToast(`Connection error: ${e.message}`, 'error');
    }

    if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
}

// Send report to a specific user
async function sendUserReport(userId, period) {
    showToast(`Sending ${period} report to ${userId}...`, 'info');

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'send-user-report',
                password: adminPassword,
                userId: userId,
                period: period
            })
        });
        const data = await res.json();

        if (data.success) {
            showToast(`${period.charAt(0).toUpperCase() + period.slice(1)} report sent to ${userId}!`, 'success');
        } else {
            showToast(`Error: ${data.error || 'Failed to send report'}`, 'error');
        }
    } catch (e) {
        console.error('Error sending user report:', e);
        showToast(`Connection error: ${e.message}`, 'error');
    }
}

// ========== EVENT REGISTRATIONS ==========

let eventRegistrations = [];

// Weekly event timing (mirrors /event.html logic)
// Active Saturday = today if Sat before 11 AM CT, else next non-skipped Saturday
const ADMIN_SKIPPED_SATURDAYS = ['2026-04-25'];

function getCurrentEventTiming() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', hour12: false, weekday: 'short'
    }).formatToParts(new Date());
    const get = (t) => parts.find(p => p.type === t).value;
    const year = +get('year'), month = +get('month'), day = +get('day');
    const hour = +get('hour') % 24;
    const weekday = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday'));

    let satOffset;
    if (weekday === 6 && hour < 11) satOffset = 0;
    else if (weekday === 6) satOffset = 7;
    else satOffset = (6 - weekday + 7) % 7;

    let dateStr = new Date(Date.UTC(year, month - 1, day + satOffset)).toISOString().slice(0, 10);
    while (ADMIN_SKIPPED_SATURDAYS.includes(dateStr)) {
        const dt = new Date(dateStr + 'T12:00:00Z');
        dt.setUTCDate(dt.getUTCDate() + 7);
        dateStr = dt.toISOString().slice(0, 10);
    }
    const label = new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
    });
    return { dateStr, eventId: 'build-product-2hrs-' + dateStr, label };
}

async function loadEventRegistrations() {
    const tbody = document.getElementById('event-registrations-list');
    if (!tbody) return;

    const timing = getCurrentEventTiming();
    const dateEl = document.getElementById('event-stat-date');
    if (dateEl) dateEl.textContent = `${timing.label} | 9 AM - 11 AM CST`;

    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-theme-muted">
        <svg class="w-8 h-8 mx-auto mb-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
        </svg>
        Loading registrations...
    </td></tr>`;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'event-list-registrations',
                password: adminPassword,
                eventId: timing.eventId
            })
        });

        const data = await response.json();

        if (!data.success) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-theme-muted">Error: ${data.error}</td></tr>`;
            return;
        }

        eventRegistrations = data.registrations || [];
        const totalEl = document.getElementById('event-stat-total');
        if (totalEl) totalEl.textContent = data.total || 0;

        if (eventRegistrations.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-theme-muted">No registrations yet</td></tr>`;
            return;
        }

        tbody.innerHTML = eventRegistrations.map((reg, i) => {
            const date = reg.registeredAt ? new Date(reg.registeredAt).toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            }) : 'N/A';

            return `<tr style="border-bottom: 1px solid var(--border-color);">
                <td class="px-4 py-3 text-theme-muted">${i + 1}</td>
                <td class="px-4 py-3 font-medium text-theme-primary">${escapeHtml(reg.name || '')}</td>
                <td class="px-4 py-3"><a href="mailto:${escapeHtml(reg.email || '')}" style="color: var(--primary);">${escapeHtml(reg.email || '')}</a></td>
                <td class="px-4 py-3 text-theme-secondary">${escapeHtml(reg.phone || '-')}</td>
                <td class="px-4 py-3 text-theme-secondary" style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(reg.productIdea || '-')}</td>
                <td class="px-4 py-3 text-theme-muted text-xs">${date}</td>
            </tr>`;
        }).join('');

    } catch (e) {
        console.error('Error loading event registrations:', e);
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-theme-muted">Failed to load: ${e.message}</td></tr>`;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function exportRegistrationsCSV() {
    if (!eventRegistrations || eventRegistrations.length === 0) {
        showToast('No registrations to export', 'warning');
        return;
    }

    const headers = ['Name', 'Email', 'Phone', 'Product Idea', 'Registered At'];
    const rows = eventRegistrations.map(r => [
        r.name || '',
        r.email || '',
        r.phone || '',
        (r.productIdea || '').replace(/,/g, ';'),
        r.registeredAt || ''
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `event-registrations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exported!', 'success');
}
