/**
 * CoCreate User Dashboard - Core JavaScript
 * Handles authentication, session management, and dashboard rendering
 */

(function(window) {
    'use strict';

    // Configuration
    const API_URL = window.AppConfig?.api?.chat || 'https://mcndu8ynsa.execute-api.us-east-1.amazonaws.com/prod/';
    const SESSION_COOKIE = 'cocreate_session';
    const SESSION_DAYS = 7;

    // State
    let currentGuid = null;
    let currentSession = null;
    let currentResetToken = null;
    let dashboardData = null;
    let usernameCheckTimeout = null;
    let userProfile = null; // Stores name and email from profile

    // DOM Elements
    const screens = {
        loading: document.getElementById('loading-screen'),
        error: document.getElementById('error-screen'),
        signup: document.getElementById('signup-screen'),
        login: document.getElementById('login-screen'),
        forgot: document.getElementById('forgot-screen'),
        reset: document.getElementById('reset-screen'),
        dashboard: document.getElementById('dashboard-screen')
    };

    // ========================
    // Cookie Management
    // ========================

    function setCookie(name, value, days) {
        const expires = new Date();
        expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax;Secure`;
    }

    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) {
            return parts.pop().split(';').shift();
        }
        return null;
    }

    function deleteCookie(name) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    }

    // ========================
    // API Calls
    // ========================

    async function apiCall(action, data = {}) {
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action,
                    ...data
                })
            });

            const result = await response.json();
            return result;
        } catch (error) {
            console.error('API Error:', error);
            return { success: false, error: error.message };
        }
    }

    async function checkUser(guid) {
        return apiCall('user-check', { guid });
    }

    async function signup(guid, email, password) {
        return apiCall('user-signup', { guid, email, password });
    }

    async function login(guid, email, password) {
        return apiCall('user-login', { guid, email, password });
    }

    async function getDashboard(guid, sessionToken) {
        return apiCall('user-dashboard', { guid, sessionToken });
    }

    async function changePassword(guid, sessionToken, oldPassword, newPassword) {
        return apiCall('user-change-password', { guid, sessionToken, oldPassword, newPassword });
    }

    async function checkUsername(username, excludeGuid = null) {
        return apiCall('check-username', { username, excludeGuid });
    }

    async function forgotPasswordApi(email) {
        return apiCall('forgot-password', { email });
    }

    async function resetPasswordApi(guid, resetToken, newPassword) {
        return apiCall('reset-password', { guid, resetToken, newPassword });
    }

    async function googleLoginApi(guid, idToken) {
        return apiCall('google-login', { guid, idToken });
    }

    // ========================
    // Google Sign-In
    // ========================

    let googleLoaded = false;

    function loadGoogleScript() {
        return new Promise((resolve, reject) => {
            if (googleLoaded) {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.defer = true;
            script.onload = () => {
                googleLoaded = true;
                resolve();
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    window.signInWithGoogle = async function() {
        try {
            // Show loading state
            showToast('Connecting to Google...', 'info');

            // Load Google script if not loaded
            await loadGoogleScript();

            // Initialize Google Identity Services
            const client = google.accounts.oauth2.initTokenClient({
                client_id: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com', // Will be replaced with actual ID
                scope: 'email profile',
                callback: async (response) => {
                    if (response.error) {
                        showToast('Google sign-in cancelled', 'error');
                        return;
                    }

                    // Get user info with the access token
                    try {
                        const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                            headers: { 'Authorization': `Bearer ${response.access_token}` }
                        });
                        const userInfo = await userInfoResponse.json();

                        // Now use ID token flow - we need to use a different approach
                        // Use the One Tap / Sign In with Google button approach instead
                        handleGoogleSignIn(response.access_token, userInfo);
                    } catch (error) {
                        console.error('Failed to get user info:', error);
                        showToast('Failed to get Google account info', 'error');
                    }
                }
            });

            // Request the token
            client.requestAccessToken();

        } catch (error) {
            console.error('Google Sign-In error:', error);
            showToast('Failed to connect to Google', 'error');
        }
    };

    async function handleGoogleSignIn(accessToken, userInfo) {
        showScreen('loading');

        try {
            // Call our backend with the Google user info
            const result = await apiCall('google-login', {
                guid: currentGuid,
                googleAccessToken: accessToken,
                googleUserInfo: {
                    email: userInfo.email,
                    name: userInfo.name,
                    picture: userInfo.picture,
                    sub: userInfo.sub // Google user ID
                }
            });

            if (result.success) {
                // Save session
                currentSession = result.sessionToken;
                setCookie(SESSION_COOKIE, result.sessionToken, SESSION_DAYS);

                showToast(result.isNewUser ? 'Account created with Google!' : 'Logged in with Google!', 'success');

                // Load dashboard
                await loadDashboard();
            } else {
                showToast(result.error || 'Google sign-in failed', 'error');
                // Go back to appropriate screen
                const checkResult = await checkUser(currentGuid);
                showScreen(checkResult.hasAccount ? 'login' : 'signup');
            }
        } catch (error) {
            console.error('Google login error:', error);
            showToast('An error occurred. Please try again.', 'error');
            showScreen('login');
        }
    }

    // ========================
    // Screen Management
    // ========================

    function showScreen(screenName) {
        Object.keys(screens).forEach(key => {
            if (screens[key]) {
                screens[key].classList.toggle('hidden', key !== screenName);
            }
        });
    }

    function showError(message) {
        const errorEl = document.getElementById('error-message');
        if (errorEl) {
            errorEl.textContent = message;
        }
        showScreen('error');
    }

    function populateUserDisplayFields() {
        // Populate signup form displays
        const signupName = document.getElementById('signup-name-display');
        const signupEmail = document.getElementById('signup-email-display');

        if (signupName) {
            signupName.textContent = userProfile.name || 'Not provided';
        }
        if (signupEmail) {
            signupEmail.textContent = userProfile.email || 'Not provided';
        }

        // Populate login form display
        const loginEmail = document.getElementById('login-email-display');
        if (loginEmail) {
            loginEmail.textContent = userProfile.email || 'Not provided';
        }
    }

    // ========================
    // Toast Notifications
    // ========================

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ========================
    // Password Toggle
    // ========================

    window.togglePassword = function(inputId, eyeId) {
        const input = document.getElementById(inputId);
        const eye = document.getElementById(eyeId);

        if (input && eye) {
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';

            // Toggle eye icon
            if (isPassword) {
                eye.innerHTML = `
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>
                `;
            } else {
                eye.innerHTML = `
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                `;
            }
        }
    };

    // ========================
    // Username Availability Check
    // ========================

    function setupUsernameCheck() {
        const usernameInput = document.getElementById('signup-username');
        const statusEl = document.getElementById('username-status');

        if (!usernameInput || !statusEl) return;

        usernameInput.addEventListener('input', () => {
            const username = usernameInput.value.trim();

            // Clear previous timeout
            if (usernameCheckTimeout) {
                clearTimeout(usernameCheckTimeout);
            }

            // Hide status if too short
            if (username.length < 3) {
                statusEl.classList.add('hidden');
                return;
            }

            // Debounce the check
            usernameCheckTimeout = setTimeout(async () => {
                statusEl.textContent = 'Checking availability...';
                statusEl.className = 'text-sm mt-1 text-theme-muted';
                statusEl.classList.remove('hidden');

                const result = await checkUsername(username);

                if (result.available) {
                    statusEl.textContent = 'Username is available';
                    statusEl.className = 'text-sm mt-1 text-green-400';
                } else {
                    statusEl.textContent = 'Username already taken';
                    statusEl.className = 'text-sm mt-1 text-red-400';
                }
            }, 500);
        });
    }

    // ========================
    // Form Handlers
    // ========================

    function setupSignupForm() {
        const form = document.getElementById('signup-form');
        const errorEl = document.getElementById('signup-error');
        const btn = document.getElementById('signup-btn');

        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = userProfile?.email;
            const password = document.getElementById('signup-password').value;
            const confirm = document.getElementById('signup-confirm').value;

            // Validation
            if (!email) {
                errorEl.textContent = 'Email not found. Please use the link from your email.';
                errorEl.classList.remove('hidden');
                return;
            }

            if (password !== confirm) {
                errorEl.textContent = 'Passwords do not match';
                errorEl.classList.remove('hidden');
                return;
            }

            if (password.length < 6) {
                errorEl.textContent = 'Password must be at least 6 characters';
                errorEl.classList.remove('hidden');
                return;
            }

            // Show loading
            btn.disabled = true;
            btn.innerHTML = '<div class="spinner"></div><span>Creating...</span>';
            errorEl.classList.add('hidden');

            try {
                const result = await signup(currentGuid, email, password);

                if (result.success) {
                    // Save session
                    currentSession = result.sessionToken;
                    setCookie(SESSION_COOKIE, result.sessionToken, SESSION_DAYS);

                    showToast('Account created successfully!', 'success');

                    // Load dashboard
                    await loadDashboard();
                } else {
                    errorEl.textContent = result.error || 'Failed to create account';
                    errorEl.classList.remove('hidden');
                }
            } catch (error) {
                errorEl.textContent = 'An error occurred. Please try again.';
                errorEl.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span>Create Account</span>';
            }
        });
    }

    function setupLoginForm() {
        const form = document.getElementById('login-form');
        const errorEl = document.getElementById('login-error');
        const btn = document.getElementById('login-btn');

        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = userProfile?.email;
            const password = document.getElementById('login-password').value;

            // Validation
            if (!email) {
                errorEl.textContent = 'Email not found. Please use the link from your email.';
                errorEl.classList.remove('hidden');
                return;
            }

            // Show loading
            btn.disabled = true;
            btn.innerHTML = '<div class="spinner"></div><span>Logging in...</span>';
            errorEl.classList.add('hidden');

            try {
                const result = await login(currentGuid, email, password);

                if (result.success) {
                    // Save session
                    currentSession = result.sessionToken;
                    setCookie(SESSION_COOKIE, result.sessionToken, SESSION_DAYS);

                    showToast('Login successful!', 'success');

                    // Load dashboard
                    await loadDashboard();
                } else {
                    errorEl.textContent = result.error || 'Invalid credentials';
                    errorEl.classList.remove('hidden');
                }
            } catch (error) {
                errorEl.textContent = 'An error occurred. Please try again.';
                errorEl.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span>Login</span>';
            }
        });
    }

    function setupPasswordForm() {
        const form = document.getElementById('password-form');
        const errorEl = document.getElementById('password-error');

        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const oldPassword = document.getElementById('current-password').value;
            const newPassword = document.getElementById('new-password').value;
            const confirmNew = document.getElementById('confirm-new-password').value;

            // Validation
            if (newPassword !== confirmNew) {
                errorEl.textContent = 'New passwords do not match';
                errorEl.classList.remove('hidden');
                return;
            }

            if (newPassword.length < 6) {
                errorEl.textContent = 'New password must be at least 6 characters';
                errorEl.classList.remove('hidden');
                return;
            }

            errorEl.classList.add('hidden');

            try {
                const result = await changePassword(currentGuid, currentSession, oldPassword, newPassword);

                if (result.success) {
                    showToast('Password changed successfully!', 'success');
                    hideChangePassword();
                    form.reset();
                } else {
                    errorEl.textContent = result.error || 'Failed to change password';
                    errorEl.classList.remove('hidden');
                }
            } catch (error) {
                errorEl.textContent = 'An error occurred. Please try again.';
                errorEl.classList.remove('hidden');
            }
        });
    }

    function setupForgotForm() {
        const form = document.getElementById('forgot-form');
        const errorEl = document.getElementById('forgot-error');
        const successEl = document.getElementById('forgot-success');
        const btn = document.getElementById('forgot-btn');

        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = document.getElementById('forgot-email').value.trim();

            // Show loading
            btn.disabled = true;
            btn.innerHTML = '<div class="spinner"></div><span>Sending...</span>';
            errorEl.classList.add('hidden');
            successEl.classList.add('hidden');

            try {
                const result = await forgotPasswordApi(email);

                if (result.success) {
                    successEl.textContent = result.message || 'If an account exists with this email, a reset link has been sent.';
                    successEl.classList.remove('hidden');
                    form.reset();
                } else {
                    errorEl.textContent = result.error || 'Failed to send reset link';
                    errorEl.classList.remove('hidden');
                }
            } catch (error) {
                errorEl.textContent = 'An error occurred. Please try again.';
                errorEl.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span>Send Reset Link</span>';
            }
        });
    }

    function setupResetForm() {
        const form = document.getElementById('reset-form');
        const errorEl = document.getElementById('reset-error');
        const successEl = document.getElementById('reset-success');
        const btn = document.getElementById('reset-btn');

        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const newPassword = document.getElementById('reset-password').value;
            const confirmPassword = document.getElementById('reset-confirm').value;

            // Validation
            if (newPassword !== confirmPassword) {
                errorEl.textContent = 'Passwords do not match';
                errorEl.classList.remove('hidden');
                return;
            }

            if (newPassword.length < 6) {
                errorEl.textContent = 'Password must be at least 6 characters';
                errorEl.classList.remove('hidden');
                return;
            }

            // Show loading
            btn.disabled = true;
            btn.innerHTML = '<div class="spinner"></div><span>Resetting...</span>';
            errorEl.classList.add('hidden');
            successEl.classList.add('hidden');

            try {
                const result = await resetPasswordApi(currentGuid, currentResetToken, newPassword);

                if (result.success) {
                    successEl.textContent = result.message || 'Password reset successfully. You can now login.';
                    successEl.classList.remove('hidden');
                    form.reset();

                    // Redirect to login after 2 seconds
                    setTimeout(() => {
                        showScreen('login');
                    }, 2000);
                } else {
                    errorEl.textContent = result.error || 'Failed to reset password';
                    errorEl.classList.remove('hidden');
                }
            } catch (error) {
                errorEl.textContent = 'An error occurred. Please try again.';
                errorEl.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span>Reset Password</span>';
            }
        });
    }

    // ========================
    // Navigation Helpers
    // ========================

    window.showLogin = function() {
        showScreen('login');
    };

    window.showSignup = function() {
        showScreen('signup');
    };

    window.showForgotPassword = function() {
        showScreen('forgot');
    };

    window.toggleProfileMenu = function() {
        const dropdown = document.getElementById('profile-dropdown');
        if (dropdown) {
            dropdown.classList.toggle('hidden');
        }
    };

    // Close profile menu when clicking outside
    document.addEventListener('click', function(e) {
        const profileBtn = document.getElementById('profile-btn');
        const dropdown = document.getElementById('profile-dropdown');
        if (dropdown && profileBtn && !profileBtn.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });

    window.showChangePassword = function() {
        const modal = document.getElementById('password-modal');
        if (modal) {
            modal.classList.remove('hidden');
        }
    };

    window.hideChangePassword = function() {
        const modal = document.getElementById('password-modal');
        const form = document.getElementById('password-form');
        const errorEl = document.getElementById('password-error');

        if (modal) {
            modal.classList.add('hidden');
        }
        if (form) {
            form.reset();
        }
        if (errorEl) {
            errorEl.classList.add('hidden');
        }
    };

    window.logout = function() {
        deleteCookie(SESSION_COOKIE);
        currentSession = null;
        dashboardData = null;
        showScreen('login');
        showToast('Logged out successfully', 'info');
    };

    // ========================
    // Dashboard Rendering
    // ========================

    async function loadDashboard() {
        showScreen('loading');

        try {
            const result = await getDashboard(currentGuid, currentSession);

            if (result.success) {
                dashboardData = result.data;
                renderDashboard(dashboardData);
                showScreen('dashboard');
            } else {
                // Session invalid, show login
                deleteCookie(SESSION_COOKIE);
                currentSession = null;
                showScreen('login');
            }
        } catch (error) {
            console.error('Dashboard load error:', error);
            showError('Failed to load dashboard');
        }
    }

    function renderDashboard(data) {
        // User name in header
        const userNameEl = document.getElementById('user-name');
        if (userNameEl && data.user?.username) {
            userNameEl.textContent = data.user.username;
        }

        // Welcome username
        const welcomeUsernameEl = document.getElementById('welcome-username');
        if (welcomeUsernameEl) {
            welcomeUsernameEl.textContent = data.user?.name || data.user?.username || 'User';
        }

        // Profile avatar and dropdown
        const displayName = data.user?.name || data.user?.username || 'User';
        const avatarLetter = displayName.charAt(0).toUpperCase();

        // Nav username
        const navUsername = document.getElementById('nav-username');
        if (navUsername) {
            navUsername.textContent = displayName;
        }

        const profileAvatar = document.getElementById('profile-avatar');
        if (profileAvatar) {
            profileAvatar.textContent = avatarLetter;
        }

        const dropdownAvatarLetter = document.getElementById('dropdown-avatar-letter');
        if (dropdownAvatarLetter) {
            dropdownAvatarLetter.textContent = avatarLetter;
        }

        const dropdownName = document.getElementById('dropdown-name');
        if (dropdownName) {
            dropdownName.textContent = displayName;
        }

        const dropdownEmail = document.getElementById('dropdown-email');
        if (dropdownEmail) {
            dropdownEmail.textContent = data.user?.email || data.application?.email || '';
        }

        // Account info
        const accountNameEl = document.getElementById('account-name');
        const accountEmailEl = document.getElementById('account-email');
        if (accountNameEl && (data.user?.name || data.application?.visitorInfo?.name)) {
            accountNameEl.textContent = data.user?.name || data.application?.visitorInfo?.name || '-';
        }
        if (accountEmailEl && data.application?.email) {
            accountEmailEl.textContent = data.application.email;
        }

        // Project info
        if (data.application) {
            const app = data.application;

            // Date
            const dateEl = document.getElementById('project-date');
            if (dateEl && app.submittedAt) {
                dateEl.textContent = formatDate(app.submittedAt);
            }

            // Timeline
            const timelineEl = document.getElementById('project-timeline');
            if (timelineEl && app.timeline) {
                timelineEl.textContent = app.timeline;
            }

            // Status
            const statusEl = document.getElementById('project-status');
            if (statusEl && app.status) {
                statusEl.className = `status-badge status-${app.status}`;
                statusEl.textContent = capitalizeFirst(app.status);
            }

            // Product idea
            const ideaEl = document.getElementById('project-idea');
            if (ideaEl && app.productIdea) {
                ideaEl.textContent = app.productIdea;
            }

            // Target customer
            const customerEl = document.getElementById('project-customer');
            if (customerEl && app.targetCustomer) {
                customerEl.textContent = app.targetCustomer;
            }

            // Industry
            const industryEl = document.getElementById('project-industry');
            if (industryEl && app.industry) {
                industryEl.textContent = app.industry;
            }
        }

        // Build session link
        const sessionLink = document.getElementById('session-link');
        if (sessionLink && data.buildSession?.link) {
            sessionLink.href = data.buildSession.link;
        } else if (sessionLink) {
            sessionLink.style.opacity = '0.5';
            sessionLink.style.pointerEvents = 'none';
            sessionLink.innerHTML = '<span>Build session pending...</span>';
        }

        // Build progress
        renderBuildProgress(data.buildProgress);

        // Chat history
        renderChatHistory(data.chatHistory);

        // Project history
        renderProjectHistory(data.projectHistory);

        // Activity log
        renderActivities(data.activities);
    }

    function renderActivities(activities) {
        const container = document.getElementById('activity-log');
        if (!container) return;

        if (!activities || activities.length === 0) {
            container.innerHTML = '<p class="text-theme-muted text-center py-4">No activities yet</p>';
            return;
        }

        container.innerHTML = activities.map(act => {
            const status = act.status || 'done';
            const statusIcon = status === 'done' || status === 'completed' ? '✅' :
                               status === 'working' || status === 'in_progress' ? '✨' :
                               status === 'ack' ? '✅' :
                               status === 'summary' ? '✅' : '✅';
            const time = act.time ? formatTime(act.time) : '';
            const message = act.message || act;

            return `
                <div class="flex items-start gap-2 text-sm py-1">
                    <span class="text-xs mt-0.5">${statusIcon}</span>
                    <span class="text-theme-secondary flex-1">${escapeHtml(message)}</span>
                    <span class="text-theme-muted text-xs whitespace-nowrap">${time}</span>
                </div>
            `;
        }).join('');
    }

    function renderBuildProgress(progress) {
        const container = document.getElementById('build-progress');
        if (!container) return;

        const steps = [
            { key: 'architect', label: 'Architect', desc: 'Planning & Design' },
            { key: 'developer', label: 'Developer', desc: 'Building Features' },
            { key: 'deployer', label: 'Deployer', desc: 'Launch & Deploy' }
        ];

        container.innerHTML = steps.map((step, index) => {
            const status = progress?.[step.key] || 'pending';
            const icon = status === 'completed' ? '&#10003;' : (status === 'in_progress' ? '&#9679;' : (index + 1));

            return `
                <div class="progress-step ${status}">
                    <div class="step-icon ${status}">${icon}</div>
                    <div>
                        <p class="font-medium text-theme-primary">${step.label}</p>
                        <p class="text-sm text-theme-muted">${step.desc}</p>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderChatHistory(messages) {
        const container = document.getElementById('chat-history');
        if (!container) return;

        if (!messages || messages.length === 0) {
            container.innerHTML = '<p class="text-theme-muted text-center py-8">No conversation history</p>';
            return;
        }

        container.innerHTML = messages.map(msg => {
            const role = msg.role || 'user';
            const content = msg.content || msg.text || '';

            return `
                <div class="chat-message ${role}">
                    <p class="text-sm font-medium text-theme-muted mb-1">${role === 'user' ? 'You' : 'CoCreate AI'}</p>
                    <p class="text-theme-primary">${escapeHtml(content)}</p>
                </div>
            `;
        }).join('');
    }

    function renderProjectHistory(projects) {
        const container = document.getElementById('project-history');
        if (!container) return;

        if (!projects || projects.length === 0) {
            container.innerHTML = '<p class="text-theme-muted text-center py-8">No deployed projects yet</p>';
            return;
        }

        container.innerHTML = projects.map(project => {
            const urls = project.urls || {};
            const hasUrls = urls.cloudfront || urls.s3 || urls.custom;
            const createdAt = project.createdAt ? formatDate(project.createdAt) : 'Unknown';
            const statusClass = project.status === 'deployed' ? 'text-green-400' : 'text-yellow-400';
            const statusIcon = project.status === 'deployed' ? '✅' : '⏳';

            let urlsHtml = '';
            if (hasUrls) {
                urlsHtml = '<div class="mt-3 space-y-2">';
                if (urls.cloudfront) {
                    urlsHtml += `
                        <div class="flex items-center gap-2">
                            <span class="text-theme-muted text-sm">CloudFront:</span>
                            <a href="${escapeHtml(urls.cloudfront)}" target="_blank" class="text-primary hover:underline text-sm truncate">${escapeHtml(urls.cloudfront)}</a>
                        </div>`;
                }
                if (urls.custom) {
                    urlsHtml += `
                        <div class="flex items-center gap-2">
                            <span class="text-theme-muted text-sm">Domain:</span>
                            <a href="${escapeHtml(urls.custom)}" target="_blank" class="text-primary hover:underline text-sm truncate">${escapeHtml(urls.custom)}</a>
                        </div>`;
                }
                if (urls.s3) {
                    urlsHtml += `
                        <div class="flex items-center gap-2">
                            <span class="text-theme-muted text-sm">S3:</span>
                            <a href="${escapeHtml(urls.s3)}" target="_blank" class="text-primary hover:underline text-sm truncate">${escapeHtml(urls.s3)}</a>
                        </div>`;
                }
                urlsHtml += '</div>';
            }

            let activityHtml = '';
            if (project.activity && project.activity.length > 0) {
                activityHtml = `
                    <div class="mt-3 pt-3 border-t border-white/10">
                        <p class="text-theme-muted text-sm mb-2">Recent Activity:</p>
                        <div class="space-y-2">
                            ${project.activity.slice(0, 5).map(act => {
                                const actStatus = act.status || 'done';
                                const actTime = act.time ? formatTime(act.time) : '';
                                const statusIcon = actStatus === 'done' || actStatus === 'completed' ? '✅' :
                                                   actStatus === 'working' || actStatus === 'in_progress' ? '✨' : '✅';
                                const message = act.message || act;
                                return `
                                    <div class="flex items-start gap-2 text-sm">
                                        <span>${statusIcon}</span>
                                        <span class="text-theme-secondary flex-1">${escapeHtml(message)}</span>
                                        ${actTime ? `<span class="text-theme-muted text-xs">${actTime}</span>` : ''}
                                    </div>`;
                            }).join('')}
                        </div>
                    </div>`;
            }

            return `
                <div class="p-4 rounded-xl" style="background: rgba(26, 10, 0, 0.3); border: 1px solid var(--border-color);">
                    <div class="flex items-start justify-between">
                        <div>
                            <h3 class="font-semibold text-theme-primary">${escapeHtml(project.projectName || 'Untitled Project')}</h3>
                            ${project.description ? `<p class="text-sm text-theme-muted mt-1">${escapeHtml(project.description)}</p>` : ''}
                        </div>
                        <span class="${statusClass} text-sm">${statusIcon} ${capitalizeFirst(project.status || 'pending')}</span>
                    </div>
                    <p class="text-xs text-theme-muted mt-2">Created: ${createdAt}</p>
                    ${urlsHtml}
                    ${activityHtml}
                </div>
            `;
        }).join('');
    }

    // ========================
    // Utility Functions
    // ========================

    function formatDate(dateStr) {
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch {
            return dateStr;
        }
    }

    function formatTime(dateStr) {
        try {
            const date = new Date(dateStr);
            return date.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return '';
        }
    }

    function capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ========================
    // Initialization
    // ========================

    function getGuidFromUrl() {
        // Support both URL formats:
        // 1. /user.id={guid} (clean URL)
        // 2. /user.html?id={guid} (fallback)

        const pathname = window.location.pathname;

        // Check for clean URL format: /user.id=abc123 or /user.id=abc123/
        const pathMatch = pathname.match(/\/user\.id=([^\/]+)/);
        if (pathMatch) {
            return pathMatch[1];
        }

        // Fallback to query parameter
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('id');
    }

    function getResetTokenFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('reset');
    }

    async function init() {
        // Get GUID from URL
        currentGuid = getGuidFromUrl();

        if (!currentGuid) {
            showError('No session ID provided. Please use the link from your email.');
            return;
        }

        // Check for reset token (password reset flow)
        currentResetToken = getResetTokenFromUrl();

        // Check for existing session cookie
        currentSession = getCookie(SESSION_COOKIE);

        // Setup forms
        setupSignupForm();
        setupLoginForm();
        setupPasswordForm();
        setupForgotForm();
        setupResetForm();
        setupUsernameCheck();

        // If reset token present, show reset password screen
        if (currentResetToken) {
            showScreen('reset');
            return;
        }

        try {
            // First check if user exists
            const checkResult = await checkUser(currentGuid);

            if (!checkResult.success) {
                showError(checkResult.error || 'Invalid session link');
                return;
            }

            if (!checkResult.exists) {
                showError('This session does not exist or has been removed.');
                return;
            }

            // Store profile data for display
            userProfile = checkResult.profile || {};
            populateUserDisplayFields();

            // If has session, try to load dashboard
            if (currentSession) {
                const dashResult = await getDashboard(currentGuid, currentSession);

                if (dashResult.success) {
                    dashboardData = dashResult.data;
                    renderDashboard(dashboardData);
                    showScreen('dashboard');
                    return;
                }

                // Session invalid, clear it
                deleteCookie(SESSION_COOKIE);
                currentSession = null;
            }

            // If user has account, show login; otherwise show signup
            if (checkResult.hasAccount) {
                showScreen('login');
            } else {
                showScreen('signup');
            }

        } catch (error) {
            console.error('Init error:', error);
            showError('Failed to load. Please try again later.');
        }
    }

    // Start app
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})(window);
