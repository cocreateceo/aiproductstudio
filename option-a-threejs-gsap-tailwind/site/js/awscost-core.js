/**
 * AWS Cost Dashboard - Core Logic
 * Standalone AWS cost analysis with daily trends, service breakdown, forecasting
 */

(function () {
    'use strict';

    // ── Config ──────────────────────────────────────────────────
    const API_URL = (window.AppConfig && AppConfig.api && AppConfig.api.chat)
        ? AppConfig.api.chat
        : 'https://mcndu8ynsa.execute-api.us-east-1.amazonaws.com/prod/';

    // Lambda Function URL for heavy batch calls (no 30s API Gateway timeout limit)
    const BATCH_API_URL = 'https://2jeprn5g4yodsr3sa43fwbasgu0pfoah.lambda-url.us-east-1.on.aws/';

    // ── State ───────────────────────────────────────────────────
    let adminPassword = '';
    let summaryData = null;
    let dailyData = null;
    let dailyByServiceData = null;
    let forecastData = null;
    let serviceDetailData = null;
    let projectCostData = null;
    let unusedResourceData = null;
    let s3BucketsData = null;
    let s3CurrentBucket = '';
    let s3CurrentPrefix = '';
    let s3BrowseData = null;
    let currentTab = 'overview';
    let sortColumn = 'cost';
    let sortAsc = false;
    let currentRange = 'this-month';
    let charts = {};
    let pendingDeleteResolve = null;
    let s3AnalysisData = null;
    let activityData = null;
    let dailyByProjectData = null;

    // ── Helpers ─────────────────────────────────────────────────
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);

    function fmt(n) {
        if (n == null || isNaN(n)) return '--';
        if (Math.abs(n) < 0.005) return '$0.00';
        return '$' + Number(n).toFixed(2);
    }

    function fmtPct(n) {
        if (n == null || isNaN(n)) return '--';
        return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    }

    function deltaBadgeHtml(delta) {
        if (delta == null) return '<span class="delta-badge neutral">N/A</span>';
        if (Math.abs(delta) < 0.005) return '<span class="delta-badge neutral">$0.00</span>';
        var cls = delta > 0 ? 'increase' : 'decrease';
        var arrow = delta > 0 ? '&#9650;' : '&#9660;';
        return '<span class="delta-badge ' + cls + '">' + arrow + ' ' + (delta > 0 ? '+' : '') + '$' + Math.abs(delta).toFixed(2) + '</span>';
    }

    function shortenServiceName(name) {
        if (!name) return '';
        return name.replace(/^Amazon\s+/i, '').replace(/^AWS\s+/i, '');
    }

    function hexToRgba(c, a) {
        if (!c || c[0] !== '#') return 'rgba(128,128,128,' + a + ')';
        return 'rgba(' + parseInt(c.slice(1, 3), 16) + ',' + parseInt(c.slice(3, 5), 16) + ',' + parseInt(c.slice(5, 7), 16) + ',' + a + ')';
    }

    // ── Tab Switching ────────────────────────────────────────────
    window.__switchTab = function (tab) {
        currentTab = tab;
        // Update tab bar
        var tabs = document.querySelectorAll('.mgmt-tab');
        tabs.forEach(function (t) {
            t.classList.toggle('active', t.dataset.tab === tab);
        });
        // Update panels
        var panels = document.querySelectorAll('.mgmt-panel');
        panels.forEach(function (p) {
            p.classList.toggle('active', p.id === 'panel-' + tab);
        });
        // Re-render overview charts when switching to overview tab
        if (tab === 'overview') {
            setTimeout(function () { renderOverviewCumulativeChart(); renderOverviewProjectDailyChart(); renderOverviewDailyChart(); }, 50);
        }
        // Re-render project chart when switching to projects tab (canvas resize)
        if (tab === 'projects' && projectCostData) {
            setTimeout(function () { renderProjectCostChart(); }, 50);
        }
        // Re-render all charts when switching to charts tab (canvas needs visible container)
        if (tab === 'charts') {
            setTimeout(function () {
                renderDailyTrendChart();
                renderServiceDonutChart();
                renderMonthlyBarChart();
                renderTop5TrendChart();
            }, 50);
        }
        // Load activity data when switching to activity tab
        if (tab === 'activity' && !activityData) {
            window.__loadActivity();
        }
    };

    // ── Toast ───────────────────────────────────────────────────
    function toast(msg, type) {
        type = type || 'info';
        var container = $('#toast-container');
        if (!container) return;
        var el = document.createElement('div');
        el.className = 'toast ' + type;
        el.innerHTML = '<span>' + msg + '</span>';
        container.appendChild(el);
        setTimeout(function () {
            el.style.opacity = '0';
            setTimeout(function () { el.remove(); }, 300);
        }, 3500);
    }

    // ── Chart Colors ────────────────────────────────────────────
    var CHART_COLORS = [
        '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#10b981',
        '#f97316', '#6366f1', '#14b8a6', '#e11d48', '#84cc16'
    ];

    // ── Date Range ──────────────────────────────────────────────
    function getDateRange(range) {
        var now = new Date();
        var y = now.getFullYear(), m = now.getMonth();
        var todayStr = now.toISOString().slice(0, 10);

        switch (range) {
            case 'this-month':
                return { start: new Date(y, m, 1).toISOString().slice(0, 10), end: todayStr };
            case 'last-month':
                return { start: new Date(y, m - 1, 1).toISOString().slice(0, 10), end: new Date(y, m, 0).toISOString().slice(0, 10) };
            case 'last-3':
                return { start: new Date(y, m - 2, 1).toISOString().slice(0, 10), end: todayStr };
            case 'last-6':
                return { start: new Date(y, m - 5, 1).toISOString().slice(0, 10), end: todayStr };
            default:
                return { start: new Date(y, m, 1).toISOString().slice(0, 10), end: todayStr };
        }
    }

    // ── Password Toggle ─────────────────────────────────────────
    window.__togglePwd = function () {
        var inp = $('#password-input');
        if (!inp) return;
        var eyeOff = $('#pwd-eye-off');
        var eyeOn = $('#pwd-eye-on');
        if (inp.type === 'password') {
            inp.type = 'text';
            if (eyeOff) eyeOff.style.display = 'none';
            if (eyeOn) eyeOn.style.display = 'block';
        } else {
            inp.type = 'password';
            if (eyeOff) eyeOff.style.display = 'block';
            if (eyeOn) eyeOn.style.display = 'none';
        }
    };

    // ── Auth ────────────────────────────────────────────────────
    async function login() {
        if (!adminPassword) {
            var inp = $('#password-input');
            adminPassword = inp ? inp.value : '';
        }
        if (!adminPassword) {
            var errEl = $('#login-error');
            if (errEl) {
                errEl.classList.remove('hidden');
                errEl.textContent = 'Please enter the admin password.';
            }
            return;
        }

        try {
            console.log('[AWS Cost] Login attempt, API_URL:', API_URL);
            var res = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'aws-cost-summary', password: adminPassword })
            });
            console.log('[AWS Cost] Response status:', res.status);
            var text = await res.text();
            console.log('[AWS Cost] Response body:', text.substring(0, 200));
            var data;
            try { data = JSON.parse(text); } catch (parseErr) {
                throw new Error('Response not JSON: ' + text.substring(0, 100));
            }
            if (!data.success) throw new Error(data.error || 'Authentication failed');

            sessionStorage.setItem('adminPassword', adminPassword);
            var loginScreen = $('#login-screen');
            var dashboard = $('#dashboard');
            if (loginScreen) loginScreen.classList.add('hidden');
            if (dashboard) dashboard.classList.remove('hidden');
            loadDashboard();
        } catch (e) {
            console.error('[AWS Cost] Login error:', e);
            var errEl2 = $('#login-error');
            if (errEl2) {
                errEl2.classList.remove('hidden');
                errEl2.textContent = e.message === 'Authentication failed' ? 'Invalid password.' : 'Login failed: ' + e.message;
            }
            adminPassword = '';
        }
    }

    function logout() {
        adminPassword = '';
        sessionStorage.removeItem('adminPassword');
        summaryData = null;
        dailyData = null;
        dailyByServiceData = null;
        forecastData = null;
        serviceDetailData = null;

        var dashboard = $('#dashboard');
        var loginScreen = $('#login-screen');
        if (dashboard) dashboard.classList.add('hidden');
        if (loginScreen) loginScreen.classList.remove('hidden');
        var inp = $('#password-input');
        if (inp) inp.value = '';
    }

    // ── Data Loading ────────────────────────────────────────────
    async function loadDashboard() {
        var range = getDateRange(currentRange);
        var startDate = currentRange === 'custom' ? ($('#date-start') ? $('#date-start').value : range.start) : range.start;
        var endDate = currentRange === 'custom' ? ($('#date-end') ? $('#date-end').value : range.end) : range.end;

        toast('Loading AWS cost data...', 'info');

        try {
            // Batch: 2 calls instead of 10 (shared AWS data fetched once server-side)
            // Uses Lambda Function URL directly to avoid API Gateway 30s timeout
            var results = await Promise.all([
                fetch(BATCH_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'aws-cost-dashboard-batch', password: adminPassword, startDate: startDate, endDate: endDate })
                }).then(function (r) { return r.json(); }),
                fetch(BATCH_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'aws-cost-storage-batch', password: adminPassword })
                }).then(function (r) { return r.json(); })
            ]);

            var batch1 = results[0]; // dashboard batch
            var batch2 = results[1]; // storage batch

            summaryData = batch1.summary || null;
            dailyData = batch1.daily || null;
            dailyByServiceData = batch1.dailyByService || null;
            forecastData = batch1.forecast || null;
            serviceDetailData = batch1.serviceDetail || null;
            if (batch1.projectCosts) {
                projectCostData = {
                    projects: batch1.projectCosts.projects || [],
                    grandTotal: batch1.projectCosts.grandTotal || 0,
                    grandTotalMtd: batch1.projectCosts.grandTotalMtd || 0,
                    prevGrandTotal: null,
                    projectedNextMonth: batch1.projectCosts.projectedNextMonth || 0,
                    totalMonthlySavings: batch1.projectCosts.totalMonthlySavings || 0,
                    deletedResources: batch1.projectCosts.deletedResources || [],
                    period: batch1.projectCosts.period || {}
                };
            } else {
                projectCostData = { projects: [], grandTotal: 0 };
            }
            dailyByProjectData = batch1.dailyByProject || null;
            unusedResourceData = batch2.unusedResources || null;
            s3BucketsData = batch2.s3Buckets || null;
            s3AnalysisData = batch2.s3Analysis || null;

            renderKPIs();
            renderOverview();
            renderDailyTrendChart();
            renderDailyTrendProjectsChart();
            renderServiceDonutChart();
            renderMonthlyBarChart();
            renderTop5TrendChart();
            renderProjectCosts();
            renderProjectCostChart();
            renderDeletedResources();
            renderServiceTable();
            renderSuggestions();
            renderEC2Instances();
            renderUnusedResources();
            renderS3Browser();
            renderStorageAnalysis();
            updateCleanupBadge();

            var lastUpdated = $('#last-updated');
            if (lastUpdated) lastUpdated.textContent = 'Last updated: ' + new Date().toLocaleString();

            toast('Dashboard updated', 'success');
            animateIn();
        } catch (err) {
            console.error('Dashboard load error:', err);
            toast('Failed to load cost data: ' + err.message, 'error');
        }
    }

    // ── KPI Rendering ───────────────────────────────────────────
    function renderKPIs() {
        if (!summaryData) return;

        var totalEl = $('#kpi-total-value');
        if (totalEl) {
            totalEl.textContent = fmt(summaryData.totalCost);
            if (projectCostData && projectCostData.grandTotal > 0) {
                totalEl.innerHTML = fmt(summaryData.totalCost) +
                    '<div style="font-size:0.65rem;color:var(--text-muted);font-weight:500;margin-top:1px">Est. monthly: ' + fmt(projectCostData.grandTotal) + '</div>';
            }
        }

        var prevEl = $('#kpi-previous-value');
        if (prevEl) {
            if (summaryData.previousPeriodCost === 0) {
                prevEl.innerHTML = '<span style="font-size:0.85em;color:var(--text-muted)">No data</span>';
            } else {
                prevEl.textContent = fmt(summaryData.previousPeriodCost);
            }
        }

        // MoM with color
        var momEl = $('#kpi-mom-value');
        if (momEl) {
            if (summaryData.previousPeriodCost === 0 && summaryData.totalCost > 0) {
                momEl.innerHTML = '<span style="font-size:0.85em;color:#818cf8">New</span>';
            } else {
                momEl.innerHTML = fmtPct(summaryData.momChange);
                if (summaryData.momChange > 0) {
                    momEl.style.color = '#f87171';
                } else if (summaryData.momChange < 0) {
                    momEl.style.color = '#4ade80';
                } else {
                    momEl.style.color = 'var(--text-primary)';
                }
            }
        }

        // Top service: show name + cost
        var topEl = $('#kpi-top-service-value');
        if (topEl) {
            if (summaryData.topService) {
                topEl.innerHTML = '<div style="font-size:0.75rem;color:var(--text-muted)">' + summaryData.topService.name + '</div><div>' + fmt(summaryData.topService.cost) + '</div>';
            } else {
                topEl.textContent = '--';
            }
        }

        var activeEl = $('#kpi-active-value');
        if (activeEl) activeEl.textContent = summaryData.activeServices;

        // Forecast
        var fcEl = $('#kpi-forecast-value');
        if (fcEl) {
            if (forecastData && forecastData.forecastedTotal != null) {
                fcEl.textContent = fmt(forecastData.forecastedTotal);
            } else {
                fcEl.innerHTML = '<span style="font-size:0.85rem">N/A</span>';
            }
        }

        // Savings from deleted resources
        var savEl = $('#kpi-savings-value');
        if (savEl) {
            if (projectCostData && projectCostData.totalMonthlySavings > 0) {
                savEl.innerHTML = '<span style="color:#4ade80">' + fmt(projectCostData.totalMonthlySavings) + '</span>' +
                    '<div style="font-size:0.65rem;color:var(--text-muted);font-weight:500;margin-top:1px">Current: ' + fmt(projectCostData.grandTotal) + '/mo</div>';
            } else {
                savEl.innerHTML = '<span style="font-size:0.85rem;color:var(--text-muted)">$0.00</span>';
            }
        }

        // Projected next month
        var projEl = $('#kpi-projected-value');
        if (projEl) {
            if (projectCostData && projectCostData.projectedNextMonth > 0) {
                var diff = (projectCostData.grandTotal || 0) - projectCostData.projectedNextMonth;
                projEl.innerHTML = fmt(projectCostData.projectedNextMonth) +
                    (diff > 0.01 ? ' <span style="font-size:0.75rem;color:#4ade80">(-' + fmt(diff).replace('$','') + ')</span>' : '');
            } else {
                projEl.innerHTML = '<span style="font-size:0.85rem">N/A</span>';
            }
        }
    }

    // ── Overview Tab ──────────────────────────────────────────────
    function renderOverview() {
        var container = $('#overview-container');
        if (!container) return;
        if (!projectCostData) {
            container.innerHTML = '<div class="fallback-msg"><div class="fallback-icon">📊</div>Loading overview data...</div>';
            return;
        }

        var html = '';
        var estMonthly = projectCostData.grandTotal || 0;
        var savings = projectCostData.totalMonthlySavings || 0;
        var projected = projectCostData.projectedNextMonth || 0;

        // ── Hero: Current Monthly Cost ──
        html += '<div class="glass-card" style="padding:24px 28px;background:rgba(0,0,0,0.35);margin-bottom:20px;text-align:center">';
        html += '<div style="font-size:0.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Current Monthly Cost</div>';
        html += '<div style="font-size:2.5rem;font-weight:800;font-family:Outfit,system-ui;color:var(--primary);letter-spacing:-0.02em">' + fmt(estMonthly) + '<span style="font-size:1rem;color:var(--text-muted);font-weight:500">/mo</span></div>';
        if (savings > 0) {
            html += '<div style="font-size:0.82rem;color:#4ade80;margin-top:6px;font-weight:600">Saved ' + fmt(savings) + '/mo by cleanup</div>';
        }
        if (projected > 0 && projected < estMonthly) {
            html += '<div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px">After more cleanup: <span style="color:#4ade80;font-weight:600">' + fmt(projected) + '/mo</span></div>';
        }
        html += '</div>';

        // ── Per-Project Cost Breakdown ──
        if (projectCostData.projects && projectCostData.projects.length > 0) {
            var projColors = ['#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#10b981', '#f97316', '#6366f1', '#14b8a6'];
            var sorted = projectCostData.projects.slice().sort(function(a,b) { return (b.total || 0) - (a.total || 0); });

            html += '<div class="glass-card" style="padding:20px;background:rgba(0,0,0,0.3);margin-bottom:20px">';
            html += '<h3 style="font-family:Outfit,system-ui;font-size:1rem;font-weight:700;color:var(--text-primary);margin-bottom:16px">Cost by Project</h3>';

            for (var i = 0; i < sorted.length; i++) {
                var p = sorted[i];
                var cost = p.total || 0;
                var pct = estMonthly > 0 ? (cost / estMonthly * 100) : 0;
                var barColor = projColors[i % projColors.length];
                // Build service list from resources
                var svcSet = {};
                var resCnt = 0;
                if (p.resources) {
                    p.resources.forEach(function(r) { svcSet[r.service || ''] = 1; resCnt++; });
                }
                var svcList = Object.keys(svcSet).filter(function(s) { return s; }).join(', ');

                html += '<div style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05)">';
                html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
                html += '<div style="display:flex;align-items:center;gap:10px">';
                html += '<div style="width:12px;height:12px;border-radius:4px;background:' + barColor + ';flex-shrink:0"></div>';
                html += '<span style="font-size:0.92rem;font-weight:700;color:var(--text-primary)">' + (p.name || 'Unknown') + '</span>';
                html += '</div>';
                html += '<span style="font-family:Outfit,system-ui;font-size:1.05rem;font-weight:800;color:var(--text-primary)">' + fmt(cost) + '<span style="font-size:0.7rem;color:var(--text-muted);font-weight:500;margin-left:6px">' + pct.toFixed(1) + '%</span></span>';
                html += '</div>';
                html += '<div style="height:6px;border-radius:3px;background:rgba(255,255,255,0.06);overflow:hidden;margin-bottom:4px">';
                html += '<div style="height:100%;width:' + pct.toFixed(1) + '%;border-radius:3px;background:' + barColor + ';transition:width 0.6s ease"></div>';
                html += '</div>';
                html += '<div style="font-size:0.72rem;color:var(--text-muted)">' + (svcList || 'No services') + ' &middot; ' + resCnt + ' resources</div>';
                html += '</div>';
            }

            // Total row
            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:14px;margin-top:4px">';
            html += '<span style="font-size:0.85rem;font-weight:700;color:var(--text-primary)">Total</span>';
            html += '<span style="font-family:Outfit,system-ui;font-size:1.1rem;font-weight:800;color:var(--primary)">' + fmt(estMonthly) + '/mo</span>';
            html += '</div>';
            html += '</div>';
        }

        // ── Quick Stats ──
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px">';

        var totalSpend = summaryData ? summaryData.totalCost : 0;
        html += '<div class="glass-card" style="padding:16px;background:rgba(0,0,0,0.3);text-align:center">';
        html += '<div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Month-to-Date</div>';
        html += '<div style="font-size:1.3rem;font-weight:800;font-family:Outfit,system-ui;color:var(--text-primary)">' + fmt(totalSpend) + '</div>';
        html += '</div>';

        var activeCount = summaryData ? summaryData.activeServices : 0;
        html += '<div class="glass-card" style="padding:16px;background:rgba(0,0,0,0.3);text-align:center">';
        html += '<div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Active Services</div>';
        html += '<div style="font-size:1.3rem;font-weight:800;font-family:Outfit,system-ui;color:var(--text-primary)">' + activeCount + '</div>';
        html += '</div>';

        var forecast = (forecastData && forecastData.forecastedTotal != null) ? forecastData.forecastedTotal : null;
        html += '<div class="glass-card" style="padding:16px;background:rgba(0,0,0,0.3);text-align:center">';
        html += '<div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">EOM Forecast</div>';
        html += '<div style="font-size:1.3rem;font-weight:800;font-family:Outfit,system-ui;color:var(--text-primary)">' + (forecast != null ? fmt(forecast) : 'N/A') + '</div>';
        html += '</div>';

        html += '<div class="glass-card" style="padding:16px;background:rgba(0,0,0,0.3);text-align:center">';
        html += '<div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Savings</div>';
        html += '<div style="font-size:1.3rem;font-weight:800;font-family:Outfit,system-ui;color:#4ade80">' + fmt(savings) + '</div>';
        html += '</div>';

        html += '</div>';

        // ── Cumulative Cost by Project (line chart) ──
        html += '<div class="chart-wrapper" style="background:rgba(255,255,255,0.02);border-radius:12px;padding:16px;margin-bottom:20px">';
        html += '<h3 class="chart-title" style="margin-bottom:8px">Cumulative Cost by Project</h3>';
        html += '<div class="chart-container" style="max-height:280px"><canvas id="chart-overview-cumulative"></canvas></div>';
        html += '</div>';

        // ── Daily Cost by Project (stacked area) ──
        html += '<div class="chart-wrapper" style="background:rgba(255,255,255,0.02);border-radius:12px;padding:16px;margin-bottom:20px">';
        html += '<h3 class="chart-title" style="margin-bottom:8px">Daily Cost by Project</h3>';
        html += '<div class="chart-container" style="max-height:260px"><canvas id="chart-overview-project-daily"></canvas></div>';
        html += '</div>';

        // ── Daily Trend Chart (total) ──
        html += '<div class="chart-wrapper" style="background:rgba(255,255,255,0.02);border-radius:12px;padding:16px;margin-bottom:24px">';
        html += '<h3 class="chart-title" style="margin-bottom:8px">Daily Cost Trend (Total)</h3>';
        html += '<div class="chart-container" style="max-height:220px"><canvas id="chart-overview-daily"></canvas></div>';
        html += '</div>';

        container.innerHTML = html;

        // Render charts
        renderOverviewCumulativeChart();
        renderOverviewProjectDailyChart();
        renderOverviewDailyChart();
    }

    function renderOverviewCumulativeChart() {
        if (typeof Chart === 'undefined') return;
        setupChartDefaults();
        destroyChart('overviewCumulative');

        var canvas = $('#chart-overview-cumulative');
        if (!canvas) return;
        if (!dailyByProjectData || !dailyByProjectData.dates || dailyByProjectData.dates.length === 0) {
            canvas.style.display = 'none';
            return;
        }
        canvas.style.display = '';

        var projColors = ['#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#10b981', '#f97316', '#6366f1', '#14b8a6'];
        var ctx = canvas.getContext('2d');

        var labels = dailyByProjectData.dates.map(function (d) {
            return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });

        var byProject = dailyByProjectData.dailyByProject || {};
        // Sort projects by total cost (sum of daily values)
        var projNames = Object.keys(byProject).sort(function(a, b) {
            var sumA = byProject[a].reduce(function(s, v) { return s + v; }, 0);
            var sumB = byProject[b].reduce(function(s, v) { return s + v; }, 0);
            return sumB - sumA;
        });

        // Build cumulative datasets from real daily-by-project data
        var datasets = [];
        for (var i = 0; i < projNames.length; i++) {
            var name = projNames[i];
            var dailyVals = byProject[name];
            var color = projColors[i % projColors.length];
            var cumulative = [];
            var runningTotal = 0;
            for (var d = 0; d < dailyVals.length; d++) {
                runningTotal += dailyVals[d] || 0;
                cumulative.push(Math.round(runningTotal * 100) / 100);
            }
            datasets.push({
                label: name,
                data: cumulative,
                borderColor: color,
                backgroundColor: 'transparent',
                borderWidth: 2.5,
                tension: 0.3,
                pointRadius: 1,
                pointHoverRadius: 5,
                pointBackgroundColor: color
            });
        }

        // Total line
        var totalCumulative = [];
        var totalRunning = 0;
        for (var t = 0; t < labels.length; t++) {
            var dayTotal = 0;
            for (var pi = 0; pi < projNames.length; pi++) {
                dayTotal += (byProject[projNames[pi]][t] || 0);
            }
            totalRunning += dayTotal;
            totalCumulative.push(Math.round(totalRunning * 100) / 100);
        }
        var grandLabel = totalCumulative.length > 0 ? fmt(totalCumulative[totalCumulative.length - 1]) : '';
        datasets.push({
            label: 'Total (' + grandLabel + ')',
            data: totalCumulative,
            borderColor: '#fff',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [6, 3],
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointBackgroundColor: '#fff'
        });

        charts.overviewCumulative = new Chart(ctx, {
            type: 'line',
            data: { labels: labels, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: 'rgba(255,255,255,0.7)', font: { size: 11 }, boxWidth: 12, padding: 12 }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.92)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        padding: 12,
                        cornerRadius: 8,
                        callbacks: {
                            label: function (ctx2) {
                                return ctx2.dataset.label + ': ' + fmt(ctx2.parsed.y);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 }, maxRotation: 45 }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            color: 'rgba(255,255,255,0.5)',
                            font: { size: 10 },
                            callback: function (v) { return '$' + v.toFixed(0); }
                        }
                    }
                }
            }
        });
    }

    function renderOverviewProjectDailyChart() {
        if (typeof Chart === 'undefined') return;
        setupChartDefaults();
        destroyChart('overviewProjectDaily');

        var canvas = $('#chart-overview-project-daily');
        if (!canvas) return;
        if (!dailyByProjectData || !dailyByProjectData.dates || dailyByProjectData.dates.length === 0) {
            canvas.style.display = 'none';
            return;
        }
        canvas.style.display = '';

        var projColors = ['#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#10b981', '#f97316', '#6366f1', '#14b8a6'];
        var ctx = canvas.getContext('2d');

        var labels = dailyByProjectData.dates.map(function (d) {
            return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });

        var byProject = dailyByProjectData.dailyByProject || {};
        // Sort projects by total cost (sum of daily values)
        var projNames = Object.keys(byProject).sort(function(a, b) {
            var sumA = byProject[a].reduce(function(s, v) { return s + v; }, 0);
            var sumB = byProject[b].reduce(function(s, v) { return s + v; }, 0);
            return sumB - sumA;
        });

        // Build datasets from real daily-by-project data
        var datasets = [];
        for (var i = 0; i < projNames.length; i++) {
            var name = projNames[i];
            var dailyVals = byProject[name];
            var color = projColors[i % projColors.length];
            var data = dailyVals.map(function(v) { return Math.round((v || 0) * 100) / 100; });

            datasets.push({
                label: name,
                data: data,
                backgroundColor: hexToRgba(color, 0.4),
                borderColor: color,
                borderWidth: 1.5,
                fill: true,
                tension: 0.35,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointBackgroundColor: color
            });
        }

        charts.overviewProjectDaily = new Chart(ctx, {
            type: 'line',
            data: { labels: labels, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: 'rgba(255,255,255,0.7)', font: { size: 11 }, boxWidth: 12, padding: 12 }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.9)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        padding: 12,
                        cornerRadius: 8,
                        callbacks: {
                            label: function (ctx2) {
                                return ctx2.dataset.label + ': ' + fmt(ctx2.parsed.y);
                            },
                            footer: function (items) {
                                var total = 0;
                                items.forEach(function(i) { total += i.parsed.y; });
                                return 'Total: ' + fmt(total);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 }, maxRotation: 45 }
                    },
                    y: {
                        stacked: true,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            color: 'rgba(255,255,255,0.5)',
                            font: { size: 10 },
                            callback: function (v) { return '$' + v.toFixed(0); }
                        }
                    }
                }
            }
        });
    }

    function renderOverviewDailyChart() {
        if (typeof Chart === 'undefined') return;
        setupChartDefaults();
        destroyChart('overviewDaily');

        var canvas = $('#chart-overview-daily');
        if (!canvas) return;
        if (!dailyData || !dailyData.dailyCosts || dailyData.dailyCosts.length === 0) {
            canvas.style.display = 'none';
            return;
        }
        canvas.style.display = '';

        var ctx = canvas.getContext('2d');
        var labels = dailyData.dailyCosts.map(function (d) {
            return new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });
        var values = dailyData.dailyCosts.map(function (d) { return d.cost; });

        var style = getComputedStyle(document.documentElement);
        var primary = style.getPropertyValue('--primary').trim() || '#f59e0b';

        var gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 200);
        gradient.addColorStop(0, hexToRgba(primary, 0.3));
        gradient.addColorStop(1, hexToRgba(primary, 0.02));

        charts.overviewDaily = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Daily Cost',
                    data: values,
                    borderColor: primary,
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.35,
                    borderWidth: 2,
                    pointRadius: 2,
                    pointHoverRadius: 5,
                    pointBackgroundColor: primary
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (ctx) { return 'Cost: ' + fmt(ctx.parsed.y); }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { callback: function (v) { return '$' + v.toFixed(2); } },
                        grid: { color: 'rgba(255,255,255,0.04)' }
                    },
                    x: { grid: { display: false } }
                }
            }
        });
    }

    // ── Chart Helpers ───────────────────────────────────────────
    function destroyChart(key) {
        if (charts[key]) {
            charts[key].destroy();
            charts[key] = null;
        }
    }

    function setupChartDefaults() {
        if (typeof Chart === 'undefined') return;
        Chart.defaults.color = 'rgba(255,255,255,0.6)';
        Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
        Chart.defaults.font.family = "'DM Sans', system-ui, sans-serif";
    }

    // ── 1. Daily Trend Line Chart ───────────────────────────────
    function renderDailyTrendChart() {
        if (typeof Chart === 'undefined') return;
        setupChartDefaults();
        destroyChart('dailyTrend');

        var canvas = $('#chart-daily-trend');
        if (!canvas) return;
        if (!dailyData || !dailyData.dailyCosts || dailyData.dailyCosts.length === 0) {
            canvas.style.display = 'none';
            return;
        }
        canvas.style.display = '';

        var ctx = canvas.getContext('2d');
        var labels = dailyData.dailyCosts.map(function (d) {
            var dt = new Date(d.date);
            return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });
        var values = dailyData.dailyCosts.map(function (d) { return d.cost || d.amount || 0; });

        // Gradient fill
        var gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 300);
        gradient.addColorStop(0, hexToRgba('#f59e0b', 0.4));
        gradient.addColorStop(1, 'rgba(245, 158, 11, 0)');

        charts.dailyTrend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Daily Cost',
                    data: values,
                    borderColor: '#f59e0b',
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#f59e0b',
                    pointBorderColor: '#f59e0b',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.85)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        padding: 12,
                        cornerRadius: 8,
                        callbacks: {
                            title: function (items) { return items[0].label; },
                            label: function (ctx2) { return 'Cost: ' + fmt(ctx2.parsed.y); }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 }, maxRotation: 45 }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            color: 'rgba(255,255,255,0.5)',
                            font: { size: 11 },
                            callback: function (v) { return '$' + v.toFixed(2); }
                        }
                    }
                }
            }
        });
    }

    // ── 1b. Daily Trend (Projects Tab) ────────────────────────────
    function renderDailyTrendProjectsChart() {
        if (typeof Chart === 'undefined') return;
        setupChartDefaults();
        destroyChart('dailyTrendProjects');

        var canvas = $('#chart-daily-trend-projects');
        if (!canvas) return;
        if (!dailyData || !dailyData.dailyCosts || dailyData.dailyCosts.length === 0) {
            canvas.parentElement.parentElement.style.display = 'none';
            return;
        }
        canvas.parentElement.parentElement.style.display = '';

        var ctx = canvas.getContext('2d');
        var labels = dailyData.dailyCosts.map(function (d) {
            var dt = new Date(d.date);
            return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });
        var values = dailyData.dailyCosts.map(function (d) { return d.cost || d.amount || 0; });

        var gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 220);
        gradient.addColorStop(0, hexToRgba('#f59e0b', 0.35));
        gradient.addColorStop(1, 'rgba(245, 158, 11, 0)');

        charts.dailyTrendProjects = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Daily Cost',
                    data: values,
                    borderColor: '#f59e0b',
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 5,
                    pointBackgroundColor: '#f59e0b',
                    pointBorderColor: '#f59e0b',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.85)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        padding: 10,
                        cornerRadius: 8,
                        callbacks: {
                            title: function (items) { return items[0].label; },
                            label: function (ctx2) { return 'Cost: ' + fmt(ctx2.parsed.y); }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 }, maxRotation: 45 }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            color: 'rgba(255,255,255,0.5)',
                            font: { size: 10 },
                            callback: function (v) { return '$' + v.toFixed(0); }
                        }
                    }
                }
            }
        });
    }

    // ── 2. Service Donut Chart ──────────────────────────────────
    function renderServiceDonutChart() {
        if (typeof Chart === 'undefined') return;
        setupChartDefaults();
        destroyChart('serviceDonut');

        var canvas = $('#chart-service-donut');
        if (!canvas) return;
        if (!summaryData || !summaryData.services || summaryData.services.length === 0) {
            canvas.style.display = 'none';
            return;
        }
        canvas.style.display = '';

        var ctx = canvas.getContext('2d');

        // Take top 10 services by cost
        var topServices = summaryData.services
            .slice()
            .sort(function (a, b) { return (b.cost || 0) - (a.cost || 0); })
            .slice(0, 10);

        var labels = topServices.map(function (s) { return shortenServiceName(s.service); });
        var values = topServices.map(function (s) { return s.cost || 0; });
        var totalCost = values.reduce(function (sum, v) { return sum + v; }, 0);
        var colors = topServices.map(function (s, i) { return CHART_COLORS[i % CHART_COLORS.length]; });

        // Center text plugin
        var centerTextPlugin = {
            id: 'centerText',
            afterDraw: function (chart) {
                var width = chart.width;
                var height = chart.height;
                var drawCtx = chart.ctx;
                drawCtx.save();

                // Total cost label
                drawCtx.font = "bold 20px 'DM Sans', system-ui, sans-serif";
                drawCtx.fillStyle = 'rgba(255,255,255,0.9)';
                drawCtx.textAlign = 'center';
                drawCtx.textBaseline = 'middle';
                drawCtx.fillText(fmt(totalCost), width / 2, height / 2 - 8);

                // Sub label
                drawCtx.font = "12px 'DM Sans', system-ui, sans-serif";
                drawCtx.fillStyle = 'rgba(255,255,255,0.5)';
                drawCtx.fillText('Total', width / 2, height / 2 + 14);

                drawCtx.restore();
            }
        };

        // Determine legend position based on viewport
        var legendPosition = window.innerWidth > 768 ? 'right' : 'bottom';

        charts.serviceDonut = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderWidth: 0,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: {
                        position: legendPosition,
                        labels: {
                            color: 'rgba(255,255,255,0.6)',
                            font: { size: 11, family: "'DM Sans', system-ui, sans-serif" },
                            usePointStyle: true,
                            padding: 12
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.85)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        padding: 12,
                        cornerRadius: 8,
                        callbacks: {
                            label: function (ctx2) {
                                var val = ctx2.parsed || 0;
                                var pct = totalCost > 0 ? ((val / totalCost) * 100).toFixed(1) : '0.0';
                                return ctx2.label + ': ' + fmt(val) + ' (' + pct + '%)';
                            }
                        }
                    }
                }
            },
            plugins: [centerTextPlugin]
        });
    }

    // ── 3. Monthly Bar Chart ────────────────────────────────────
    function renderMonthlyBarChart() {
        if (typeof Chart === 'undefined') return;
        setupChartDefaults();
        destroyChart('monthlyBar');

        var canvas = $('#chart-monthly-bar');
        if (!canvas) return;
        if (!dailyByServiceData || !dailyByServiceData.months || dailyByServiceData.months.length === 0) {
            canvas.style.display = 'none';
            return;
        }
        canvas.style.display = '';

        var ctx = canvas.getContext('2d');

        var months = dailyByServiceData.months;
        var services = dailyByServiceData.services || [];

        // Calculate monthly totals by summing all services per month
        var monthLabels = months.map(function (m) {
            var dt = new Date(m + '-01');
            return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        });

        var monthTotals = months.map(function (month) {
            var total = 0;
            services.forEach(function (svc) {
                (svc.monthly || []).forEach(function (entry) {
                    if (entry.month === month) total += entry.cost;
                });
            });
            return total;
        });

        // Gradient for bars
        var gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 300);
        gradient.addColorStop(0, hexToRgba('#f59e0b', 0.9));
        gradient.addColorStop(1, hexToRgba('#8b5cf6', 0.6));

        charts.monthlyBar = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: monthLabels,
                datasets: [{
                    label: 'Monthly Total',
                    data: monthTotals,
                    backgroundColor: gradient,
                    borderWidth: 0,
                    borderRadius: 6,
                    barPercentage: 0.7
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.85)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        padding: 12,
                        cornerRadius: 8,
                        callbacks: {
                            title: function (items) { return items[0].label; },
                            label: function (ctx2) { return 'Total: ' + fmt(ctx2.parsed.y); }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            color: 'rgba(255,255,255,0.5)',
                            font: { size: 11 },
                            callback: function (v) { return '$' + v.toFixed(2); }
                        }
                    }
                }
            }
        });
    }

    // ── 4. Top 5 Service Trend Chart ────────────────────────────
    function renderTop5TrendChart() {
        if (typeof Chart === 'undefined') return;
        setupChartDefaults();
        destroyChart('top5Trend');

        var canvas = $('#chart-top5-trend');
        if (!canvas) return;
        if (!dailyByServiceData || !dailyByServiceData.services || dailyByServiceData.services.length === 0 || !dailyByServiceData.months || dailyByServiceData.months.length === 0) {
            canvas.style.display = 'none';
            return;
        }
        canvas.style.display = '';

        var ctx = canvas.getContext('2d');

        var months = dailyByServiceData.months;
        var allServices = dailyByServiceData.services;

        // Build per-service month lookup maps and compute totals
        var serviceWithTotals = allServices.map(function (svc) {
            var monthMap = {};
            (svc.monthly || []).forEach(function (entry) {
                monthMap[entry.month] = entry.cost;
            });
            var total = Object.values(monthMap).reduce(function (a, b) { return a + b; }, 0);
            return { name: svc.name || svc.service, monthMap: monthMap, total: total };
        });

        serviceWithTotals.sort(function (a, b) { return b.total - a.total; });
        var top5 = serviceWithTotals.slice(0, 5);

        var monthLabels = months.map(function (m) {
            var dt = new Date(m + '-01');
            return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        });

        var datasets = top5.map(function (svc, i) {
            var data = months.map(function (m) { return svc.monthMap[m] || 0; });
            return {
                label: shortenServiceName(svc.name),
                data: data,
                borderColor: CHART_COLORS[i],
                backgroundColor: hexToRgba(CHART_COLORS[i], 0.1),
                fill: false,
                tension: 0.4,
                pointRadius: 4,
                pointHoverRadius: 7,
                pointBackgroundColor: CHART_COLORS[i],
                borderWidth: 2
            };
        });

        charts.top5Trend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: monthLabels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: 'rgba(255,255,255,0.6)',
                            font: { size: 11, family: "'DM Sans', system-ui, sans-serif" },
                            usePointStyle: true,
                            padding: 16
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.85)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        padding: 12,
                        cornerRadius: 8,
                        callbacks: {
                            label: function (ctx2) {
                                return ctx2.dataset.label + ': ' + fmt(ctx2.parsed.y);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            color: 'rgba(255,255,255,0.5)',
                            font: { size: 11 },
                            callback: function (v) { return '$' + v.toFixed(2); }
                        }
                    }
                }
            }
        });
    }

    // ── Service Table (Expandable Rows) ─────────────────────────
    function renderServiceTable(filterText) {
        filterText = filterText || '';
        if (!summaryData || !summaryData.services) return;

        var services = summaryData.services;

        // Apply search filter
        if (filterText) {
            var lowerFilter = filterText.toLowerCase();
            services = services.filter(function (s) {
                return s.service.toLowerCase().includes(lowerFilter);
            });
        }

        // Apply sort
        services = services.slice().sort(function (a, b) {
            var va, vb;
            switch (sortColumn) {
                case 'service':
                    va = (a.service || '').toLowerCase();
                    vb = (b.service || '').toLowerCase();
                    return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
                case 'cost':
                    va = a.cost || 0; vb = b.cost || 0; break;
                case 'previousCost':
                    va = a.previousCost || 0; vb = b.previousCost || 0; break;
                case 'delta':
                    va = a.delta || 0; vb = b.delta || 0; break;
                case 'percentOfTotal':
                    va = a.percentOfTotal || 0; vb = b.percentOfTotal || 0; break;
                default:
                    va = a.cost || 0; vb = b.cost || 0;
            }
            if (sortColumn !== 'service') {
                return sortAsc ? va - vb : vb - va;
            }
            return 0;
        });

        var tbody = $('#service-table-body');
        if (!tbody) return;

        if (services.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted)">No services found</td></tr>';
            return;
        }

        var totalCost = summaryData.totalCost || services.reduce(function (sum, s) { return sum + (s.cost || 0); }, 0);

        var rows = services.map(function (s, idx) {
            var pct = s.percentOfTotal != null ? s.percentOfTotal : 0;
            var color = CHART_COLORS[idx % CHART_COLORS.length];
            var shortName = shortenServiceName(s.service);
            var changePct = (s.previousCost && s.previousCost > 0) ? (((s.cost - s.previousCost) / s.previousCost) * 100) : null;

            // Build the detail data lookup
            var detail = null;
            if (serviceDetailData && serviceDetailData.serviceDetails && s.service) {
                detail = serviceDetailData.serviceDetails[s.service] || null;
            }

            // Usage types from detail
            var usageTypes = (detail && detail.usageTypes) ? detail.usageTypes : [];
            var sortedUsageTypes = usageTypes.slice().sort(function (a, b) { return (b.cost || 0) - (a.cost || 0); });
            var displayUsageTypes = sortedUsageTypes.slice(0, 10);
            var remainingCount = sortedUsageTypes.length - 10;

            // Quick stats for the expanded panel
            var numUsageTypes = usageTypes.length;

            // Usage type rows HTML
            var usageTypeRowsHtml = '';
            if (displayUsageTypes.length > 0) {
                usageTypeRowsHtml = displayUsageTypes.map(function (ut) {
                    return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">' +
                        '<td style="padding:6px 10px;font-size:0.8rem;color:var(--text-secondary)">' + (ut.usageType || ut.name || '--') + '</td>' +
                        '<td style="padding:6px 10px;font-size:0.8rem;color:var(--text-primary);text-align:right">' + fmt(ut.cost) + '</td>' +
                        '<td style="padding:6px 10px;font-size:0.8rem;color:var(--text-muted);text-align:right">' + (ut.usageQuantity != null ? Number(ut.usageQuantity).toLocaleString() : '--') + '</td>' +
                    '</tr>';
                }).join('');
                if (remainingCount > 0) {
                    usageTypeRowsHtml += '<tr><td colspan="3" style="padding:6px 10px;font-size:0.75rem;color:var(--text-muted);font-style:italic">...and ' + remainingCount + ' more</td></tr>';
                }
            } else {
                usageTypeRowsHtml = '<tr><td colspan="3" style="padding:10px;font-size:0.8rem;color:var(--text-muted);text-align:center">No usage type data available</td></tr>';
            }

            // Cost proportion bar percentage
            var proportionPct = totalCost > 0 ? ((s.cost || 0) / totalCost * 100) : 0;

            // Main row
            var mainRow = '<tr onclick="__toggleServiceRow(' + idx + ')" style="cursor:pointer;transition:background 0.2s" onmouseover="this.style.background=\'rgba(255,255,255,0.03)\'" onmouseout="this.style.background=\'\'">' +
                '<td style="padding:10px 12px">' +
                    '<div style="display:flex;align-items:center;gap:10px">' +
                        '<div style="width:28px;height:28px;border-radius:50%;background:' + color + ';display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;color:#fff;flex-shrink:0">' + (idx + 1) + '</div>' +
                        '<span class="font-semibold" style="color:var(--text-primary)">' + shortName + '</span>' +
                    '</div>' +
                '</td>' +
                '<td style="padding:10px 12px;font-weight:600;color:var(--text-primary)">' + fmt(s.cost) + '</td>' +
                '<td style="padding:10px 12px;color:var(--text-muted)">' + fmt(s.previousCost) + '</td>' +
                '<td style="padding:10px 12px">' + deltaBadgeHtml(s.delta) + '</td>' +
                '<td style="padding:10px 12px">' +
                    '<div style="display:flex;align-items:center;gap:8px">' +
                        '<div style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,0.06)">' +
                            '<div style="width:' + Math.min(pct, 100) + '%;height:100%;border-radius:3px;background:' + color + ';transition:width 0.4s ease"></div>' +
                        '</div>' +
                        '<span style="min-width:40px;text-align:right;font-size:0.85rem;color:var(--text-secondary)">' + pct.toFixed(1) + '%</span>' +
                    '</div>' +
                '</td>' +
                '<td style="padding:10px 12px;text-align:center">' +
                    '<span id="svc-arrow-' + idx + '" style="display:inline-block;transition:transform 0.3s ease;color:var(--text-muted);font-size:0.75rem">&#9654;</span>' +
                '</td>' +
            '</tr>';

            // Expanded detail panel row
            var detailRow = '<tr><td colspan="6" style="padding:0;border:none">' +
                '<div id="svc-detail-' + idx + '" style="max-height:0;overflow:hidden;transition:max-height 0.4s ease">' +
                    '<div style="margin:0 12px 12px 12px;padding:20px;border-radius:12px;background:rgba(255,255,255,0.03);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.06);border-left:3px solid var(--primary)">' +

                        // Quick stats row
                        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:18px">' +
                            '<div style="padding:12px;border-radius:8px;background:rgba(255,255,255,0.04);text-align:center">' +
                                '<div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:4px">Current Cost</div>' +
                                '<div style="font-size:1.1rem;font-weight:700;color:var(--text-primary)">' + fmt(s.cost) + '</div>' +
                            '</div>' +
                            '<div style="padding:12px;border-radius:8px;background:rgba(255,255,255,0.04);text-align:center">' +
                                '<div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:4px">Previous Cost</div>' +
                                '<div style="font-size:1.1rem;font-weight:700;color:var(--text-primary)">' + fmt(s.previousCost) + '</div>' +
                            '</div>' +
                            '<div style="padding:12px;border-radius:8px;background:rgba(255,255,255,0.04);text-align:center">' +
                                '<div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:4px">Change %</div>' +
                                '<div style="font-size:1.1rem;font-weight:700;color:' + (changePct != null ? (changePct > 0 ? '#f87171' : '#4ade80') : 'var(--text-primary)') + '">' + (changePct != null ? fmtPct(changePct) : 'N/A') + '</div>' +
                            '</div>' +
                            '<div style="padding:12px;border-radius:8px;background:rgba(255,255,255,0.04);text-align:center">' +
                                '<div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:4px"># Usage Types</div>' +
                                '<div style="font-size:1.1rem;font-weight:700;color:var(--text-primary)">' + numUsageTypes + '</div>' +
                            '</div>' +
                        '</div>' +

                        // Cost proportion bar
                        '<div style="margin-bottom:18px">' +
                            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
                                '<span style="font-size:0.75rem;color:var(--text-muted)">Proportion of Total Spend</span>' +
                                '<span style="font-size:0.8rem;font-weight:600;color:var(--text-primary)">' + proportionPct.toFixed(1) + '%</span>' +
                            '</div>' +
                            '<div style="height:8px;border-radius:4px;background:rgba(255,255,255,0.06)">' +
                                '<div style="width:' + Math.min(proportionPct, 100) + '%;height:100%;border-radius:4px;background:linear-gradient(90deg,' + color + ',' + hexToRgba(color, 0.6) + ');transition:width 0.4s ease"></div>' +
                            '</div>' +
                        '</div>' +

                        // Usage type breakdown table
                        '<div style="margin-bottom:4px;font-size:0.8rem;font-weight:600;color:var(--text-primary)">Usage Type Breakdown</div>' +
                        '<div style="overflow-x:auto">' +
                            '<table style="width:100%;border-collapse:collapse">' +
                                '<thead>' +
                                    '<tr style="border-bottom:1px solid rgba(255,255,255,0.08)">' +
                                        '<th style="padding:8px 10px;text-align:left;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);font-weight:600">Usage Type</th>' +
                                        '<th style="padding:8px 10px;text-align:right;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);font-weight:600">Cost</th>' +
                                        '<th style="padding:8px 10px;text-align:right;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);font-weight:600">Usage Quantity</th>' +
                                    '</tr>' +
                                '</thead>' +
                                '<tbody>' + usageTypeRowsHtml + '</tbody>' +
                            '</table>' +
                        '</div>' +

                    '</div>' +
                '</div>' +
            '</td></tr>';

            return mainRow + detailRow;
        }).join('');

        tbody.innerHTML = rows;
    }

    // ── Expand/Collapse Toggle ──────────────────────────────────
    window.__toggleServiceRow = function(idx) {
        var detail = document.getElementById('svc-detail-' + idx);
        var arrow = document.getElementById('svc-arrow-' + idx);
        if (!detail) return;
        if (detail.classList.contains('open')) {
            detail.classList.remove('open');
            detail.style.maxHeight = '0';
            if (arrow) arrow.style.transform = 'rotate(0deg)';
        } else {
            detail.classList.add('open');
            detail.style.maxHeight = detail.scrollHeight + 'px';
            if (arrow) arrow.style.transform = 'rotate(90deg)';
        }
    };

    // ── Optimization Suggestions ────────────────────────────────
    function renderSuggestionCard(sug) {
        var typeIcons = { warning: '\u26A0\uFE0F', info: '\uD83D\uDCA1', tip: '\uD83C\uDFAF', danger: '\uD83D\uDEA8' };
        var typeBorderColors = { warning: '#f59e0b', info: '#6366f1', tip: '#10b981', danger: '#ef4444' };
        var sugType = sug.type || 'info';
        var icon = typeIcons[sugType] || typeIcons.info;
        var borderColor = typeBorderColors[sugType] || typeBorderColors.info;

        return '<div style="padding:16px;border-radius:12px;background:rgba(255,255,255,0.03);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.06);border-left:4px solid ' + borderColor + ';margin-bottom:12px">' +
            '<div style="display:flex;align-items:flex-start;gap:12px">' +
                '<div style="font-size:1.4rem;flex-shrink:0;line-height:1">' + icon + '</div>' +
                '<div style="flex:1;min-width:0">' +
                    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
                        '<span style="font-weight:700;color:var(--text-primary);font-size:0.95rem">' + (sug.title || 'Suggestion') + '</span>' +
                        (sug.service ? '<span style="display:inline-block;padding:2px 8px;border-radius:9999px;background:rgba(255,255,255,0.08);font-size:0.7rem;color:var(--text-muted)">' + shortenServiceName(sug.service) + '</span>' : '') +
                        (sug.verdict ? '<span style="display:inline-block;padding:2px 10px;border-radius:9999px;font-size:0.7rem;font-weight:700;background:' + (sug.verdict === 'DELETE' ? 'rgba(239,68,68,0.15);color:#f87171' : sug.verdict === 'KEEP' ? 'rgba(34,197,94,0.15);color:#4ade80' : 'rgba(251,191,36,0.15);color:#fbbf24') + '">' + sug.verdict + '</span>' : '') +
                    '</div>' +
                    (sug.detail ? '<div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:6px;line-height:1.5">' + sug.detail + '</div>' : '') +
                    (sug.action ? '<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:6px"><strong style="color:var(--text-secondary)">Action:</strong> ' + sug.action + '</div>' : '') +
                    (sug.savings ? '<div style="display:inline-block;padding:3px 10px;border-radius:6px;background:rgba(16,185,129,0.12);color:#4ade80;font-size:0.8rem;font-weight:600">Potential savings: ' + sug.savings + '</div>' : '') +
                '</div>' +
            '</div>' +
        '</div>';
    }

    function buildCleanupSuggestions() {
        var suggestions = [];
        if (!unusedResourceData) return suggestions;

        var vols = unusedResourceData.volumes || [];
        var snaps = unusedResourceData.snapshots || [];
        var eips = unusedResourceData.elasticIps || [];

        // Volume recommendations
        vols.forEach(function (v) {
            var ageMonths = v.createTime ? Math.round((Date.now() - new Date(v.createTime).getTime()) / (1000 * 60 * 60 * 24 * 30)) : 0;
            var shouldDelete = ageMonths > 1;
            suggestions.push({
                type: shouldDelete ? 'danger' : 'warning',
                service: 'EBS Volume',
                title: v.name + ' (' + v.size + ' GB ' + v.volumeType + ')',
                detail: 'Unattached EBS volume in ' + (v.az || 'unknown AZ') + '. Created ' + (ageMonths > 0 ? ageMonths + ' months ago' : 'recently') + '. Costing ~' + fmt(v.estimatedMonthlyCost) + '/mo while unused.',
                action: shouldDelete ? 'Safe to delete \u2014 no instances attached, idle for ' + ageMonths + '+ months' : 'Review if still needed \u2014 recently created, may be in use soon',
                savings: fmt(v.estimatedMonthlyCost) + '/month',
                verdict: shouldDelete ? 'DELETE' : 'REVIEW'
            });
        });

        // Snapshot recommendations
        snaps.forEach(function (s) {
            var ageDays = s.startTime ? Math.round((Date.now() - new Date(s.startTime).getTime()) / (1000 * 60 * 60 * 24)) : 0;
            var shouldDelete = ageDays > 90;
            suggestions.push({
                type: shouldDelete ? 'danger' : 'info',
                service: 'EBS Snapshot',
                title: s.name + ' (' + s.size + ' GB)',
                detail: 'Snapshot created ' + ageDays + ' days ago. ' + (s.description ? 'Description: "' + s.description.substring(0, 80) + '"' : 'No description.') + ' Costing ~' + fmt(s.estimatedMonthlyCost) + '/mo.',
                action: shouldDelete ? 'Safe to delete \u2014 over 90 days old, likely outdated' : 'Review if backup is still needed',
                savings: fmt(s.estimatedMonthlyCost) + '/month',
                verdict: shouldDelete ? 'DELETE' : 'REVIEW'
            });
        });

        // Elastic IP recommendations
        eips.forEach(function (e) {
            suggestions.push({
                type: 'danger',
                service: 'Elastic IP',
                title: e.publicIp + ' (' + e.name + ')',
                detail: 'Unused Elastic IP not associated with any instance. AWS charges ~' + fmt(e.estimatedMonthlyCost) + '/mo for idle EIPs.',
                action: 'Delete unless you plan to attach it to an instance soon',
                savings: fmt(e.estimatedMonthlyCost) + '/month',
                verdict: 'DELETE'
            });
        });

        return suggestions;
    }

    function renderSuggestions() {
        var container = $('#suggestions-container');
        if (!container) return;

        var suggestions = (serviceDetailData && serviceDetailData.suggestions) ? serviceDetailData.suggestions.slice() : [];
        var cleanupSuggestions = buildCleanupSuggestions();

        if (suggestions.length === 0 && cleanupSuggestions.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">No optimization suggestions available</div>';
            return;
        }

        var html = '';

        // Cleanup/delete recommendations first
        if (cleanupSuggestions.length > 0) {
            var totalWaste = 0;
            cleanupSuggestions.forEach(function (s) {
                var m = (s.savings || '').match(/\$([\d.]+)/);
                if (m) totalWaste += parseFloat(m[1]);
            });
            html += '<div style="padding:12px 16px;margin-bottom:16px;border-radius:10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
                '<span style="font-size:1.1rem">\uD83D\uDCB8</span>' +
                '<span style="font-size:0.85rem;font-weight:600;color:#f87171">' + cleanupSuggestions.length + ' unused resource' + (cleanupSuggestions.length !== 1 ? 's' : '') + ' found \u2014 ~' + fmt(totalWaste) + '/mo wasted</span>' +
                '<span style="margin-left:auto;font-size:0.75rem;color:var(--text-muted)">Switch to Unused Resources tab to delete</span>' +
            '</div>';
            html += cleanupSuggestions.map(renderSuggestionCard).join('');
        }

        // Service optimization suggestions
        if (suggestions.length > 0) {
            if (cleanupSuggestions.length > 0) {
                html += '<div style="height:1px;background:linear-gradient(90deg,transparent,var(--border-color),transparent);margin:20px 0"></div>';
                html += '<div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);margin-bottom:12px">Service Optimization</div>';
            }
            html += suggestions.map(renderSuggestionCard).join('');
        }

        container.innerHTML = html;
    }

    // ── EC2 Instances ───────────────────────────────────────────
    function renderEC2Instances() {
        var container = $('#ec2-instances-container');
        if (!container) return;

        if (!serviceDetailData || !serviceDetailData.ec2Instances || serviceDetailData.ec2Instances.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">No EC2 instance data available</div>';
            return;
        }

        var instances = serviceDetailData.ec2Instances;

        var stateColors = { running: '#4ade80', stopped: '#f87171', terminated: '#6b7280' };

        var thStyle = 'padding:10px 12px;text-align:left;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);font-weight:600';
        var headerHtml = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">' +
            '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.08)">' +
                '<th style="' + thStyle + '">State</th>' +
                '<th style="' + thStyle + '">Name</th>' +
                '<th style="' + thStyle + '">Instance ID</th>' +
                '<th style="' + thStyle + '">Type</th>' +
                '<th style="' + thStyle + '">Status</th>' +
                '<th style="' + thStyle + '">Est. Cost/mo</th>' +
                '<th style="' + thStyle + '">Public IP</th>' +
                '<th style="' + thStyle + '">Project</th>' +
                '<th style="' + thStyle + '">Launch Time</th>' +
            '</tr></thead><tbody>';

        var bodyHtml = instances.map(function (inst) {
            var state = (inst.state || 'unknown').toLowerCase();
            var dotColor = stateColors[state] || '#6b7280';
            var rowBg = state === 'stopped' ? 'rgba(245,158,11,0.06)' : '';

            // Extract name from tags
            var name = '--';
            var project = '--';
            if (inst.tags && Array.isArray(inst.tags)) {
                inst.tags.forEach(function (tag) {
                    if (tag.Key === 'Name' || tag.key === 'Name') name = tag.Value || tag.value || '--';
                    if (tag.Key === 'Project' || tag.key === 'Project') project = tag.Value || tag.value || '--';
                });
            } else if (inst.name) {
                name = inst.name;
            }
            if (inst.project) project = inst.project;

            // Format launch time
            var launchTime = '--';
            if (inst.launchTime) {
                try {
                    var dt = new Date(inst.launchTime);
                    launchTime = dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                } catch (e) {
                    launchTime = inst.launchTime;
                }
            }

            var costDisplay = inst.estimatedMonthlyCost ? fmt(inst.estimatedMonthlyCost) : (state === 'running' ? '~' + fmt(0.05 * 730) : '$0.00');

            return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);' + (rowBg ? 'background:' + rowBg : '') + '">' +
                '<td style="padding:10px 12px">' +
                    '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + dotColor + ';box-shadow:0 0 6px ' + hexToRgba(dotColor, 0.4) + '"></span>' +
                '</td>' +
                '<td style="padding:10px 12px;font-weight:600;color:var(--text-primary);font-size:0.85rem">' + name + '</td>' +
                '<td style="padding:10px 12px;font-size:0.8rem;color:var(--text-secondary);font-family:monospace">' + (inst.instanceId || inst.InstanceId || '--') + '</td>' +
                '<td style="padding:10px 12px;font-size:0.8rem;color:var(--text-secondary)">' + (inst.type || inst.instanceType || inst.InstanceType || '--') + '</td>' +
                '<td style="padding:10px 12px">' +
                    '<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:0.7rem;font-weight:600;background:' + hexToRgba(dotColor, 0.15) + ';color:' + dotColor + '">' + state + '</span>' +
                '</td>' +
                '<td style="padding:10px 12px;font-size:0.8rem;font-weight:600;color:var(--text-primary)">' + costDisplay + '</td>' +
                '<td style="padding:10px 12px;font-size:0.8rem;color:var(--text-secondary);font-family:monospace">' + (inst.publicIp || inst.PublicIpAddress || '--') + '</td>' +
                '<td style="padding:10px 12px">' +
                    '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;background:rgba(99,102,241,0.12);color:#818cf8">' + project + '</span>' +
                '</td>' +
                '<td style="padding:10px 12px;font-size:0.8rem;color:var(--text-muted)">' + launchTime + '</td>' +
            '</tr>';
        }).join('');

        container.innerHTML = headerHtml + bodyHtml + '</tbody></table></div>';
    }

    // ── Project Costs ────────────────────────────────────────────
    var PROJECT_COLORS = [
        '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#10b981',
        '#f97316', '#6366f1', '#14b8a6', '#e11d48', '#84cc16'
    ];

    var SERVICE_BADGE = {
        'S3':          { bg: 'rgba(34,197,94,0.15)',  color: '#4ade80', label: 'S3' },
        'CloudFront':  { bg: 'rgba(99,102,241,0.15)', color: '#818cf8', label: 'CLOUDFRONT' },
        'Lambda':      { bg: 'rgba(251,191,36,0.15)', color: '#fbbf24', label: 'LAMBDA' },
        'API Gateway': { bg: 'rgba(236,72,153,0.15)', color: '#f472b6', label: 'API GATEWAY' },
        'DynamoDB':    { bg: 'rgba(14,165,233,0.15)', color: '#38bdf8', label: 'DYNAMODB' },
        'EC2':         { bg: 'rgba(249,115,22,0.15)', color: '#fb923c', label: 'EC2' },
        'RDS':         { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa', label: 'RDS' },
        'ElastiCache': { bg: 'rgba(220,38,38,0.15)',  color: '#f87171', label: 'CACHE' },
        'ECS':         { bg: 'rgba(168,85,247,0.15)', color: '#c084fc', label: 'ECS' },
        'ELB':         { bg: 'rgba(20,184,166,0.15)', color: '#2dd4bf', label: 'ELB' },
        'ECR':         { bg: 'rgba(217,119,6,0.15)',  color: '#f59e0b', label: 'ECR' },
        'CodeBuild':   { bg: 'rgba(139,92,246,0.15)', color: '#a78bfa', label: 'BUILD' },
        'Secrets':     { bg: 'rgba(244,63,94,0.15)',   color: '#fb7185', label: 'SECRETS' },
        'VPC':         { bg: 'rgba(107,114,128,0.15)', color: '#9ca3af', label: 'VPC' },
        'CloudWatch':  { bg: 'rgba(234,179,8,0.15)',   color: '#facc15', label: 'WATCH' },
        'SES':         { bg: 'rgba(16,185,129,0.15)',  color: '#34d399', label: 'SES' }
    };

    function svcBadge(service) {
        var s = SERVICE_BADGE[service] || { bg: 'rgba(148,163,184,0.1)', color: 'var(--text-muted)', label: service };
        return '<span style="display:inline-block;padding:3px 10px;border-radius:6px;font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;background:' + s.bg + ';color:' + s.color + ';min-width:70px;text-align:center">' + s.label + '</span>';
    }

    // buildProjectCostData removed — all project mapping is now handled dynamically
    // by the backend (aws-costs/index.mjs). The frontend receives pre-resolved
    // projectCosts from the batch API response.

    function renderProjectCosts() {
        var container = $('#project-costs-container');
        if (!container) return;

        if (!projectCostData || !projectCostData.projects || projectCostData.projects.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">No project data available</div>';
            return;
        }

        var projects = projectCostData.projects;
        var grandTotal = projectCostData.grandTotal || projects.reduce(function (s, p) { return s + (p.total || 0); }, 0);

        var html = '';

        // Render all project cards (AI Product Studio, Tmux Builder — each includes all their resources)
        projects.forEach(function (project, idx) {
            html += buildProjectCardHtml(project, idx);
        });

        // Grand total
        if (projects.length > 1) {
            var prevGrandDelta = projectCostData.prevGrandTotal != null
                ? deltaBadgeHtml(grandTotal - projectCostData.prevGrandTotal)
                : '';
            var savingsNote = '';
            if (projectCostData.totalMonthlySavings > 0) {
                savingsNote = '<div style="display:flex;align-items:center;gap:8px;margin-top:4px">' +
                    '<span style="font-size:0.75rem;color:var(--text-muted)">Projected next month:</span>' +
                    '<span style="font-size:0.85rem;font-weight:700;color:#4ade80">' + fmt(projectCostData.projectedNextMonth) + '</span>' +
                    '<span style="font-size:0.7rem;color:#4ade80">(-' + fmt(projectCostData.totalMonthlySavings).replace('$','') + ' savings)</span>' +
                '</div>';
            }
            var mtdNote = projectCostData.grandTotalMtd
                ? '<div style="display:flex;align-items:center;gap:8px;margin-top:4px">' +
                    '<span style="font-size:0.75rem;color:var(--text-muted)">Actual MTD (' + (projectCostData.period.days || '?') + ' of ' + (projectCostData.period.daysInMonth || '?') + ' days):</span>' +
                    '<span style="font-size:0.85rem;font-weight:600;color:#38bdf8">' + fmt(projectCostData.grandTotalMtd) + '</span>' +
                  '</div>'
                : '';
            html += '<div style="margin-top:16px;padding:16px 20px;border-radius:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08)">' +
                '<div style="display:flex;justify-content:space-between;align-items:center">' +
                    '<span style="font-weight:700;font-size:0.9rem;color:var(--text-muted)">Estimated Monthly Cost</span>' +
                    '<div style="display:flex;align-items:center;gap:12px">' +
                        '<span style="font-family:Outfit,system-ui,sans-serif;font-weight:800;font-size:1.25rem;color:var(--text-primary)">' + fmt(grandTotal) + '</span>' +
                        prevGrandDelta +
                    '</div>' +
                '</div>' +
                mtdNote +
                savingsNote +
            '</div>';
        }

        container.innerHTML = html;
    }

    function renderDeletedResources() {
        var section = $('#deleted-resources-section');
        if (!section) return;

        var deleted = projectCostData && projectCostData.deletedResources;
        if (!deleted || deleted.length === 0) {
            section.style.display = 'none';
            return;
        }

        var totalSavings = projectCostData.totalMonthlySavings || 0;

        var rows = deleted.map(function (d) {
            var typeIcon = d.type === 'EC2 Instance' ? '🖥️' : d.type === 'CloudFront Distribution' ? '🌐' : '📦';
            return '<tr>' +
                '<td style="padding:10px 12px;white-space:nowrap">' + typeIcon + ' ' + d.type + '</td>' +
                '<td style="padding:10px 12px;font-weight:600;color:var(--text-primary)">' + d.name + (d.instanceType ? ' (' + d.instanceType + ')' : '') + '</td>' +
                '<td style="padding:10px 12px;color:var(--text-secondary)">' + d.project + '</td>' +
                '<td style="padding:10px 12px;color:var(--text-muted)">' + d.deletedDate + '</td>' +
                '<td style="padding:10px 12px;color:#4ade80;font-weight:600">-' + fmt(d.monthlySavings) + '/mo</td>' +
                '<td style="padding:10px 12px;color:var(--text-muted);font-size:0.8rem">' + d.reason + '</td>' +
            '</tr>';
        }).join('');

        section.style.display = 'block';
        section.innerHTML =
            '<div style="border-radius:12px;background:rgba(74,222,128,0.04);border:1px solid rgba(74,222,128,0.15);padding:16px 20px">' +
                '<div class="flex flex-wrap items-center justify-between gap-4 mb-3">' +
                    '<h4 class="text-base font-display font-semibold" style="color:var(--text-primary)">' +
                        '<span style="margin-right:6px">🗑️</span>Recently Deleted Resources' +
                    '</h4>' +
                    '<span style="font-size:0.85rem;font-weight:700;color:#4ade80">Saving ' + fmt(totalSavings) + '/mo</span>' +
                '</div>' +
                '<div style="overflow-x:auto">' +
                    '<table class="service-table" style="width:100%">' +
                        '<thead><tr>' +
                            '<th style="padding:8px 12px">Type</th>' +
                            '<th style="padding:8px 12px">Resource</th>' +
                            '<th style="padding:8px 12px">Project</th>' +
                            '<th style="padding:8px 12px">Deleted</th>' +
                            '<th style="padding:8px 12px">Savings</th>' +
                            '<th style="padding:8px 12px">Reason</th>' +
                        '</tr></thead>' +
                        '<tbody>' + rows + '</tbody>' +
                    '</table>' +
                '</div>' +
                '<div style="margin-top:12px;padding:10px 14px;border-radius:8px;background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.12);display:flex;justify-content:space-between;align-items:center">' +
                    '<span style="font-size:0.85rem;color:var(--text-secondary)">Current month includes historical spend before deletion. Full savings reflected next month.</span>' +
                    '<span style="font-size:0.85rem;font-weight:700;color:#38bdf8">Next month est: ' + fmt(projectCostData.projectedNextMonth) + '</span>' +
                '</div>' +
            '</div>';
    }

    function buildProjectCardHtml(project, idx) {
        var color = PROJECT_COLORS[idx % PROJECT_COLORS.length];

        // Resource rows
        var resourceRows = (project.resources || []).map(function (r) {
            var delta = '';
            if (r.prevMonthlyCost != null) {
                var d = (r.monthlyCost || 0) - r.prevMonthlyCost;
                delta = deltaBadgeHtml(d);
            } else {
                delta = '<span style="font-size:0.75rem;color:var(--text-muted)">-- $0.00</span>';
            }
            return '<div class="proj-resource-row">' +
                '<div class="proj-resource-badge">' + svcBadge(r.service) + '</div>' +
                '<div class="proj-resource-name">' + (r.resource || '--') + '</div>' +
                '<div class="proj-resource-details">' + (r.details || '') + '</div>' +
                '<div class="proj-resource-cost">' + fmt(r.monthlyCost) + '</div>' +
                '<div class="proj-resource-delta">' + delta + '</div>' +
            '</div>';
        }).join('');

        // Cost proportion bars
        var barRows = (project.resources || []).map(function (r, ri) {
            var pct = project.total > 0 ? ((r.monthlyCost || 0) / project.total * 100) : 0;
            var barColor = Object.values(SERVICE_BADGE)[ri % Object.keys(SERVICE_BADGE).length]?.color || color;
            if (SERVICE_BADGE[r.service]) barColor = SERVICE_BADGE[r.service].color;
            var label = r.service + ' \u2013 ' + (r.resource || '').substring(0, 30) + (r.resource && r.resource.length > 30 ? '...' : '');
            return '<div style="margin-bottom:6px">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">' +
                    '<span style="font-size:0.75rem;color:var(--text-secondary)">' + label + '</span>' +
                    '<span style="font-size:0.75rem;font-weight:600;color:var(--text-primary)">' + fmt(r.monthlyCost) + ' (' + pct.toFixed(1) + '%)</span>' +
                '</div>' +
                '<div style="height:6px;border-radius:3px;background:rgba(255,255,255,0.06)">' +
                    '<div style="width:' + Math.min(pct, 100) + '%;height:100%;border-radius:3px;background:' + barColor + ';transition:width 0.4s"></div>' +
                '</div>' +
            '</div>';
        }).join('');

        // Subtotal
        var prevDelta = '';
        if (project.prevTotal != null) {
            prevDelta = deltaBadgeHtml((project.total || 0) - project.prevTotal);
        } else {
            prevDelta = '<span style="font-size:0.75rem;color:var(--text-muted)">-- $0.00</span>';
        }

        var resourceCount = (project.resources || []).length;
        var userProjNote = project.userProjectCount
            ? '<span style="font-size:0.75rem;color:var(--text-muted);margin-left:8px">(' + project.userProjectCount + ' user projects)</span>'
            : '';

        var canvasId = 'proj-chart-' + idx;

        return '<div class="proj-card" data-proj-idx="' + idx + '" style="border-left:3px solid ' + color + '">' +
            '<div class="proj-card-header">' +
                '<div style="display:flex;align-items:center;gap:10px;flex:1">' +
                    '<div>' +
                        '<div class="proj-card-title">' + project.name + userProjNote + '</div>' +
                        '<div class="proj-card-services">' + project.serviceList + ' &middot; ' + resourceCount + ' resources</div>' +
                    '</div>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:12px">' +
                    '<div style="text-align:right">' +
                        '<div class="proj-card-cost">' + fmt(project.total) + '</div>' +
                        prevDelta +
                    '</div>' +
                    '<button class="proj-details-btn" onclick="__toggleProjectCard(this.closest(\'.proj-card\'))">' +
                        '<span class="proj-details-btn-text">Details</span>' +
                        '<span class="proj-chevron">&#9654;</span>' +
                    '</button>' +
                '</div>' +
            '</div>' +
            '<div class="proj-card-body">' +
                '<div class="proj-chart-row">' +
                    '<div class="proj-chart-col">' +
                        '<canvas id="' + canvasId + '" width="220" height="220"></canvas>' +
                    '</div>' +
                    '<div class="proj-chart-col proj-chart-legend" id="' + canvasId + '-legend"></div>' +
                '</div>' +
                '<div class="proj-resources">' + resourceRows + '</div>' +
                '<div style="margin-top:16px">' + barRows + '</div>' +
                '<div class="proj-subtotal">' +
                    '<span style="font-weight:700;color:var(--text-primary)">Subtotal</span>' +
                    '<div style="display:flex;align-items:center;gap:12px">' +
                        '<span style="font-weight:700;font-size:1rem;color:var(--text-primary)">' + fmt(project.total) + '</span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    // Store project chart instances to avoid duplicates
    var projectChartInstances = {};

    window.__toggleProjectCard = function (card) {
        var isExpanded = card.classList.toggle('expanded');
        var btnText = card.querySelector('.proj-details-btn-text');
        if (btnText) btnText.textContent = isExpanded ? 'Hide' : 'Details';
        // Render donut chart when first expanded
        if (isExpanded) {
            var idx = parseInt(card.dataset.projIdx);
            setTimeout(function () { renderProjectDonut(idx); }, 50);
        }
    };

    function renderProjectDonut(idx) {
        if (!projectCostData || !projectCostData.projects[idx]) return;
        var project = projectCostData.projects[idx];
        var canvasId = 'proj-chart-' + idx;
        var canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // Destroy previous instance
        if (projectChartInstances[canvasId]) {
            projectChartInstances[canvasId].destroy();
        }

        // Aggregate by service type
        var svcMap = {};
        (project.resources || []).forEach(function (r) {
            var svc = r.service || 'Other';
            if (!svcMap[svc]) svcMap[svc] = 0;
            svcMap[svc] += r.monthlyCost || 0;
        });

        var labels = Object.keys(svcMap);
        var values = labels.map(function (k) { return Math.round(svcMap[k] * 100) / 100; });
        var colors = labels.map(function (svc) {
            var badge = SERVICE_BADGE[svc];
            return badge ? badge.color : '#6b7280';
        });

        projectChartInstances[canvasId] = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors.map(function (c) { return c + '33'; }),
                    borderColor: colors,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                cutout: '60%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (ctx) {
                                return ctx.label + ': $' + ctx.parsed.toFixed(2);
                            }
                        }
                    }
                }
            }
        });

        // Build custom legend
        var legendEl = document.getElementById(canvasId + '-legend');
        if (legendEl) {
            var total = values.reduce(function (s, v) { return s + v; }, 0);
            legendEl.innerHTML = labels.map(function (label, i) {
                var pct = total > 0 ? (values[i] / total * 100).toFixed(1) : '0.0';
                return '<div class="proj-legend-item">' +
                    '<span class="proj-legend-dot" style="background:' + colors[i] + '"></span>' +
                    '<span class="proj-legend-label">' + label + '</span>' +
                    '<span class="proj-legend-value">$' + values[i].toFixed(2) + ' (' + pct + '%)</span>' +
                '</div>';
            }).join('');
        }
    }

    // ── Project Cost Doughnut Chart ─────────────────────────────
    function renderProjectCostChart() {
        if (typeof Chart === 'undefined') return;
        setupChartDefaults();
        destroyChart('projectCost');

        var canvas = $('#chart-project-costs');
        if (!canvas) return;
        if (!projectCostData || !projectCostData.projects || projectCostData.projects.length === 0) {
            canvas.style.display = 'none';
            return;
        }
        canvas.style.display = '';

        var ctx = canvas.getContext('2d');
        var projects = projectCostData.projects.slice().sort(function (a, b) { return (b.total || 0) - (a.total || 0); });

        var labels = projects.map(function (p) { return p.name; });
        var values = projects.map(function (p) { return p.total || 0; });
        var totalCost = values.reduce(function (s, v) { return s + v; }, 0);
        var colors = projects.map(function (p, i) { return PROJECT_COLORS[i % PROJECT_COLORS.length]; });

        charts.projectCost = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors.map(function (c) { return c + '55'; }),
                    borderColor: colors,
                    borderWidth: 2,
                    borderRadius: 6,
                    barPercentage: 0.7
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.85)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        padding: 12,
                        cornerRadius: 8,
                        callbacks: {
                            label: function (ctx2) {
                                var val = ctx2.parsed.x || 0;
                                var pct = totalCost > 0 ? ((val / totalCost) * 100).toFixed(1) : '0.0';
                                return fmt(val) + '/mo (' + pct + '% of total)';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            color: 'rgba(255,255,255,0.5)',
                            font: { size: 11 },
                            callback: function (v) { return '$' + v; }
                        }
                    },
                    y: {
                        grid: { display: false },
                        ticks: {
                            color: 'rgba(255,255,255,0.7)',
                            font: { size: 12, weight: '600', family: "'DM Sans', system-ui, sans-serif" }
                        }
                    }
                }
            }
        });
    }

    // ── Unused Resources ─────────────────────────────────────────

    function renderUnusedResources() {
        var container = $('#unused-resources-container');
        if (!container) return;

        if (!unusedResourceData) {
            container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">No data available</div>';
            return;
        }

        var volumes = unusedResourceData.volumes || [];
        var snapshots = unusedResourceData.snapshots || [];
        var elasticIps = unusedResourceData.elasticIps || [];

        var totalWaste = 0;
        volumes.forEach(function (v) { totalWaste += v.estimatedMonthlyCost || 0; });
        snapshots.forEach(function (s) { totalWaste += s.estimatedMonthlyCost || 0; });
        elasticIps.forEach(function (e) { totalWaste += e.estimatedMonthlyCost || 0; });

        var html = '';

        // ── Volumes
        html += '<div class="resource-section">';
        html += '<div class="resource-section-header">';
        html += '<span class="resource-section-title">Unattached EBS Volumes</span>';
        html += '<span class="resource-count-badge' + (volumes.length === 0 ? ' clean' : '') + '">' + volumes.length + '</span>';
        if (volumes.length > 0) {
            var volWaste = volumes.reduce(function (s, v) { return s + (v.estimatedMonthlyCost || 0); }, 0);
            html += '<span class="resource-waste-badge">~' + fmt(volWaste) + '/mo wasted</span>';
        }
        html += '</div>';

        if (volumes.length === 0) {
            html += '<div style="padding:12px;color:var(--text-muted);font-size:0.85rem;text-align:center">No unattached volumes found</div>';
        } else {
            html += '<div style="overflow-x:auto"><table class="resource-table"><thead><tr>' +
                '<th>Volume ID</th><th>Name</th><th>Size</th><th>Type</th><th>AZ</th><th>Cost/mo</th><th></th>' +
                '</tr></thead><tbody>';
            volumes.forEach(function (v) {
                html += '<tr id="res-volume-' + v.volumeId + '">' +
                    '<td style="font-family:monospace;font-size:0.75rem">' + v.volumeId + '</td>' +
                    '<td>' + v.name + '</td>' +
                    '<td>' + v.size + ' GB</td>' +
                    '<td>' + v.volumeType + '</td>' +
                    '<td>' + (v.az || '--') + '</td>' +
                    '<td style="font-weight:600;color:var(--text-primary)">' + fmt(v.estimatedMonthlyCost) + '</td>' +
                    '<td><button class="btn-delete" onclick="__deleteResource(\'volume\',\'' + v.volumeId + '\')">Delete</button></td>' +
                '</tr>';
            });
            html += '</tbody></table></div>';
        }
        html += '</div>';

        // ── Snapshots
        html += '<div class="resource-section">';
        html += '<div class="resource-section-header">';
        html += '<span class="resource-section-title">Old Snapshots (&gt;30 days)</span>';
        html += '<span class="resource-count-badge' + (snapshots.length === 0 ? ' clean' : '') + '">' + snapshots.length + '</span>';
        if (snapshots.length > 0) {
            var snapWaste = snapshots.reduce(function (s, v) { return s + (v.estimatedMonthlyCost || 0); }, 0);
            html += '<span class="resource-waste-badge">~' + fmt(snapWaste) + '/mo wasted</span>';
        }
        html += '</div>';

        if (snapshots.length === 0) {
            html += '<div style="padding:12px;color:var(--text-muted);font-size:0.85rem;text-align:center">No old snapshots found</div>';
        } else {
            html += '<div style="overflow-x:auto"><table class="resource-table"><thead><tr>' +
                '<th>Snapshot ID</th><th>Name</th><th>Size</th><th>Created</th><th>Cost/mo</th><th></th>' +
                '</tr></thead><tbody>';
            snapshots.forEach(function (s) {
                var created = '--';
                if (s.startTime) {
                    try { created = new Date(s.startTime).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { created = s.startTime; }
                }
                html += '<tr id="res-snapshot-' + s.snapshotId + '">' +
                    '<td style="font-family:monospace;font-size:0.75rem">' + s.snapshotId + '</td>' +
                    '<td>' + s.name + '</td>' +
                    '<td>' + s.size + ' GB</td>' +
                    '<td>' + created + '</td>' +
                    '<td style="font-weight:600;color:var(--text-primary)">' + fmt(s.estimatedMonthlyCost) + '</td>' +
                    '<td><button class="btn-delete" onclick="__deleteResource(\'snapshot\',\'' + s.snapshotId + '\')">Delete</button></td>' +
                '</tr>';
            });
            html += '</tbody></table></div>';
        }
        html += '</div>';

        // ── Elastic IPs
        html += '<div class="resource-section">';
        html += '<div class="resource-section-header">';
        html += '<span class="resource-section-title">Unused Elastic IPs</span>';
        html += '<span class="resource-count-badge' + (elasticIps.length === 0 ? ' clean' : '') + '">' + elasticIps.length + '</span>';
        if (elasticIps.length > 0) {
            var eipWaste = elasticIps.reduce(function (s, v) { return s + (v.estimatedMonthlyCost || 0); }, 0);
            html += '<span class="resource-waste-badge">~' + fmt(eipWaste) + '/mo wasted</span>';
        }
        html += '</div>';

        if (elasticIps.length === 0) {
            html += '<div style="padding:12px;color:var(--text-muted);font-size:0.85rem;text-align:center">No unused Elastic IPs found</div>';
        } else {
            html += '<div style="overflow-x:auto"><table class="resource-table"><thead><tr>' +
                '<th>Allocation ID</th><th>Public IP</th><th>Name</th><th>Cost/mo</th><th></th>' +
                '</tr></thead><tbody>';
            elasticIps.forEach(function (eip) {
                html += '<tr id="res-elastic-ip-' + eip.allocationId + '">' +
                    '<td style="font-family:monospace;font-size:0.75rem">' + eip.allocationId + '</td>' +
                    '<td style="font-family:monospace">' + eip.publicIp + '</td>' +
                    '<td>' + eip.name + '</td>' +
                    '<td style="font-weight:600;color:var(--text-primary)">' + fmt(eip.estimatedMonthlyCost) + '</td>' +
                    '<td><button class="btn-delete" onclick="__deleteResource(\'elastic-ip\',\'' + eip.allocationId + '\')">Delete</button></td>' +
                '</tr>';
            });
            html += '</tbody></table></div>';
        }
        html += '</div>';

        if (totalWaste > 0) {
            html = '<div style="padding:10px 16px;margin-bottom:16px;border-radius:10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);display:flex;align-items:center;gap:10px">' +
                '<span style="font-size:1.2rem">💸</span>' +
                '<span style="font-size:0.85rem;color:#f87171;font-weight:600">Estimated waste: ' + fmt(totalWaste) + '/month</span>' +
            '</div>' + html;
        }

        container.innerHTML = html;
    }

    // Delete resource with confirmation
    window.__deleteResource = function (type, id) {
        var modal = $('#delete-modal');
        var msg = $('#delete-modal-msg');
        if (!modal || !msg) return;

        msg.textContent = 'Are you sure you want to delete ' + type + ' ' + id + '? This action cannot be undone.';
        modal.classList.remove('hidden');

        var confirmBtn = $('#delete-modal-confirm');
        var cancelBtn = $('#delete-modal-cancel');

        function cleanup() {
            modal.classList.add('hidden');
            confirmBtn.replaceWith(confirmBtn.cloneNode(true));
            cancelBtn.replaceWith(cancelBtn.cloneNode(true));
        }

        cancelBtn.addEventListener('click', cleanup, { once: true });

        confirmBtn.addEventListener('click', function () {
            cleanup();

            // Mark row as deleting
            var row = document.getElementById('res-' + type + '-' + id);
            if (row) row.classList.add('deleting');

            fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'aws-delete-resource', password: adminPassword, resourceType: type, resourceId: id })
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    toast('Deleted ' + type + ': ' + id, 'success');
                    // Animate row removal
                    if (row && typeof gsap !== 'undefined') {
                        gsap.to(row, { opacity: 0, height: 0, duration: 0.4, onComplete: function () { row.remove(); } });
                    } else if (row) {
                        row.remove();
                    }
                } else {
                    toast('Failed to delete: ' + (data.error || 'Unknown error'), 'error');
                    if (row) row.classList.remove('deleting');
                }
            })
            .catch(function (err) {
                toast('Delete failed: ' + err.message, 'error');
                if (row) row.classList.remove('deleting');
            });
        }, { once: true });
    };

    // ── S3 File Browser ──────────────────────────────────────────

    function renderS3Browser() {
        var container = $('#s3-browser-container');
        if (!container) return;

        if (!s3BucketsData || !s3BucketsData.buckets) {
            container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">No S3 data available</div>';
            return;
        }

        var buckets = s3BucketsData.buckets;

        var html = '<div class="s3-toolbar">';
        html += '<select class="s3-bucket-select" id="s3-bucket-select" onchange="__s3SelectBucket(this.value)">';
        html += '<option value="">Select a bucket...</option>';
        buckets.forEach(function (b) {
            var selected = b.name === s3CurrentBucket ? ' selected' : '';
            html += '<option value="' + b.name + '"' + selected + '>' + b.name + ' (' + b.region + ')</option>';
        });
        html += '</select>';
        html += '</div>';

        // Breadcrumb
        if (s3CurrentBucket) {
            html += '<div class="s3-breadcrumb">';
            html += '<a onclick="__s3Navigate(\'\')">🪣 ' + s3CurrentBucket + '</a>';

            if (s3CurrentPrefix) {
                var parts = s3CurrentPrefix.split('/').filter(Boolean);
                var accumulated = '';
                parts.forEach(function (part, i) {
                    accumulated += part + '/';
                    html += '<span class="separator"> / </span>';
                    if (i === parts.length - 1) {
                        html += '<span class="current">' + part + '</span>';
                    } else {
                        var navPrefix = accumulated;
                        html += '<a onclick="__s3Navigate(\'' + navPrefix + '\')">' + part + '</a>';
                    }
                });
            }
            html += '</div>';
        }

        // File listing
        if (s3BrowseData) {
            var prefixes = s3BrowseData.prefixes || [];
            var objects = s3BrowseData.objects || [];

            if (prefixes.length === 0 && objects.length === 0) {
                html += '<div style="text-align:center;padding:2rem;color:var(--text-muted)">This location is empty</div>';
            } else {
                html += '<div style="overflow-x:auto"><table class="s3-file-table"><thead><tr>' +
                    '<th style="width:40px"><input type="checkbox" id="s3-select-all" onchange="__s3ToggleAll(this.checked)"></th>' +
                    '<th>Name</th><th>Size</th><th>Last Modified</th>' +
                    '</tr></thead><tbody>';

                // Folders
                prefixes.forEach(function (p) {
                    html += '<tr class="folder-row" ondblclick="__s3Navigate(\'' + p.prefix + '\')">' +
                        '<td></td>' +
                        '<td><span class="file-icon">📁</span><strong style="color:var(--text-primary);cursor:pointer" onclick="__s3Navigate(\'' + p.prefix + '\')">' + p.name + '/</strong></td>' +
                        '<td style="color:var(--text-muted)">--</td>' +
                        '<td style="color:var(--text-muted)">--</td>' +
                    '</tr>';
                });

                // Files
                objects.forEach(function (obj) {
                    var size = formatFileSize(obj.size);
                    var modified = '--';
                    if (obj.lastModified) {
                        try { modified = new Date(obj.lastModified).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { modified = obj.lastModified; }
                    }
                    var icon = getFileIcon(obj.name);
                    html += '<tr>' +
                        '<td><input type="checkbox" class="s3-file-checkbox" value="' + escapeHtml(obj.key) + '" onchange="__s3UpdateSelection()"></td>' +
                        '<td><span class="file-icon">' + icon + '</span>' + escapeHtml(obj.name) + '</td>' +
                        '<td>' + size + '</td>' +
                        '<td>' + modified + '</td>' +
                    '</tr>';
                });

                html += '</tbody></table></div>';

                // Actions bar
                html += '<div class="s3-actions">';
                html += '<button class="s3-delete-btn" id="s3-delete-btn" disabled onclick="__s3DeleteSelected()">Delete Selected</button>';
                html += '<span class="s3-select-count" id="s3-select-count">0 files selected</span>';
                html += '</div>';
            }
        } else if (s3CurrentBucket) {
            html += '<div style="text-align:center;padding:2rem;color:var(--text-muted)">Loading...</div>';
        }

        container.innerHTML = html;
    }

    function formatFileSize(bytes) {
        if (bytes == null || bytes === 0) return '0 B';
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var i = 0;
        while (bytes >= 1024 && i < units.length - 1) {
            bytes /= 1024;
            i++;
        }
        return (i === 0 ? bytes : bytes.toFixed(1)) + ' ' + units[i];
    }

    function getFileIcon(name) {
        if (!name) return '📄';
        var ext = name.split('.').pop().toLowerCase();
        var icons = {
            'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'svg': '🖼️', 'webp': '🖼️',
            'pdf': '📕', 'doc': '📘', 'docx': '📘', 'xls': '📗', 'xlsx': '📗',
            'zip': '📦', 'tar': '📦', 'gz': '📦', 'rar': '📦',
            'js': '📜', 'mjs': '📜', 'ts': '📜', 'py': '📜', 'json': '📜', 'html': '📜', 'css': '📜',
            'mp4': '🎬', 'mp3': '🎵', 'wav': '🎵',
            'log': '📋', 'txt': '📄', 'csv': '📊'
        };
        return icons[ext] || '📄';
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    window.__s3SelectBucket = function (bucket) {
        if (!bucket) {
            s3CurrentBucket = '';
            s3CurrentPrefix = '';
            s3BrowseData = null;
            renderS3Browser();
            return;
        }
        s3CurrentBucket = bucket;
        s3CurrentPrefix = '';
        __s3Navigate('');
    };

    window.__s3Navigate = function (prefix) {
        s3CurrentPrefix = prefix;
        s3BrowseData = null;
        renderS3Browser(); // show loading

        fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'aws-s3-browse', password: adminPassword, bucket: s3CurrentBucket, prefix: prefix })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                s3BrowseData = data.data;
                renderS3Browser();
            } else {
                toast('S3 browse error: ' + (data.error || 'Unknown'), 'error');
            }
        })
        .catch(function (err) {
            toast('S3 browse failed: ' + err.message, 'error');
        });
    };

    window.__s3ToggleAll = function (checked) {
        var checkboxes = document.querySelectorAll('.s3-file-checkbox');
        checkboxes.forEach(function (cb) { cb.checked = checked; });
        __s3UpdateSelection();
    };

    window.__s3UpdateSelection = function () {
        var checkboxes = document.querySelectorAll('.s3-file-checkbox:checked');
        var count = checkboxes.length;
        var countEl = $('#s3-select-count');
        var deleteBtn = $('#s3-delete-btn');
        if (countEl) countEl.textContent = count + ' file' + (count !== 1 ? 's' : '') + ' selected';
        if (deleteBtn) deleteBtn.disabled = count === 0;
    };

    window.__s3DeleteSelected = function () {
        var checkboxes = document.querySelectorAll('.s3-file-checkbox:checked');
        var keys = [];
        checkboxes.forEach(function (cb) { keys.push(cb.value); });
        if (keys.length === 0) return;

        var modal = $('#delete-modal');
        var msg = $('#delete-modal-msg');
        if (!modal || !msg) return;

        msg.textContent = 'Delete ' + keys.length + ' file' + (keys.length !== 1 ? 's' : '') + ' from ' + s3CurrentBucket + '? This cannot be undone.';
        modal.classList.remove('hidden');

        var confirmBtn = $('#delete-modal-confirm');
        var cancelBtn = $('#delete-modal-cancel');

        function cleanup() {
            modal.classList.add('hidden');
            confirmBtn.replaceWith(confirmBtn.cloneNode(true));
            cancelBtn.replaceWith(cancelBtn.cloneNode(true));
        }

        cancelBtn.addEventListener('click', cleanup, { once: true });

        confirmBtn.addEventListener('click', function () {
            cleanup();
            toast('Deleting ' + keys.length + ' files...', 'info');

            fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'aws-s3-delete', password: adminPassword, bucket: s3CurrentBucket, keys: keys })
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success && data.data) {
                    var deleted = data.data.deleted || [];
                    var errors = data.data.errors || [];
                    if (deleted.length > 0) toast('Deleted ' + deleted.length + ' file' + (deleted.length !== 1 ? 's' : ''), 'success');
                    if (errors.length > 0) toast(errors.length + ' file' + (errors.length !== 1 ? 's' : '') + ' failed to delete', 'error');
                    // Refresh current view
                    __s3Navigate(s3CurrentPrefix);
                } else {
                    toast('S3 delete error: ' + (data.error || 'Unknown'), 'error');
                }
            })
            .catch(function (err) {
                toast('S3 delete failed: ' + err.message, 'error');
            });
        }, { once: true });
    };

    // ── Cleanup Badge ────────────────────────────────────────────
    function updateCleanupBadge() {
        var badge = $('#cleanup-badge');
        if (!badge) return;
        if (!unusedResourceData) { badge.style.display = 'none'; return; }
        var count = (unusedResourceData.volumes || []).length +
                    (unusedResourceData.snapshots || []).length +
                    (unusedResourceData.elasticIps || []).length;
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    }

    // ── Storage Analysis ──────────────────────────────────────────
    function renderStorageAnalysis() {
        var container = $('#storage-analysis-container');
        if (!container) return;

        if (!s3AnalysisData || !s3AnalysisData.analyses || s3AnalysisData.analyses.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">No storage analysis data</div>';
            return;
        }

        var analyses = s3AnalysisData.analyses.filter(function (a) { return !a.error; });
        var totalSize = analyses.reduce(function (s, a) { return s + (a.totalSize || 0); }, 0);
        var totalObjects = analyses.reduce(function (s, a) { return s + (a.totalObjects || 0); }, 0);
        var totalTempFiles = analyses.reduce(function (s, a) { return s + (a.tempFiles || []).length; }, 0);
        var totalTempSize = 0;
        analyses.forEach(function (a) {
            (a.tempFiles || []).forEach(function (f) { totalTempSize += f.size || 0; });
        });

        var html = '';

        // Summary bar
        html += '<div class="storage-summary-bar">' +
            '<div class="storage-stat">' +
                '<div class="storage-stat-value">' + formatFileSize(totalSize) + '</div>' +
                '<div class="storage-stat-label">Total Storage</div>' +
            '</div>' +
            '<div class="storage-stat">' +
                '<div class="storage-stat-value">' + totalObjects.toLocaleString() + '</div>' +
                '<div class="storage-stat-label">Total Files</div>' +
            '</div>' +
            '<div class="storage-stat">' +
                '<div class="storage-stat-value">' + analyses.length + '</div>' +
                '<div class="storage-stat-label">Buckets</div>' +
            '</div>' +
            '<div class="storage-stat' + (totalTempFiles > 0 ? ' warn' : '') + '">' +
                '<div class="storage-stat-value">' + totalTempFiles + '</div>' +
                '<div class="storage-stat-label">Cache/Temp Files</div>' +
            '</div>' +
            '<div class="storage-stat' + (totalTempSize > 0 ? ' warn' : '') + '">' +
                '<div class="storage-stat-value">' + formatFileSize(totalTempSize) + '</div>' +
                '<div class="storage-stat-label">Deletable Size</div>' +
            '</div>' +
        '</div>';

        // Per-bucket breakdown
        analyses.forEach(function (a) {
            var cats = a.categories || {};
            var catKeys = Object.keys(cats).sort(function (x, y) { return (cats[y].size || 0) - (cats[x].size || 0); });
            var tempCount = (a.tempFiles || []).length;
            var largeCount = (a.largeFiles || []).length;

            var catIcons = { code: '📜', images: '🖼️', fonts: '🔤', media: '🎬', docs: '📄', archive: '📦', cache: '🗑️', maps: '🗺️', other: '📎' };

            html += '<div class="storage-bucket-card">' +
                '<div class="storage-bucket-header" onclick="this.parentElement.classList.toggle(\'expanded\')">' +
                    '<div style="display:flex;align-items:center;gap:10px">' +
                        '<span class="proj-chevron">&#9654;</span>' +
                        '<span style="font-size:1rem">🪣</span>' +
                        '<div>' +
                            '<div style="font-weight:700;color:var(--text-primary);font-size:0.9rem">' + a.bucket + '</div>' +
                            '<div style="font-size:0.75rem;color:var(--text-muted)">' + a.totalObjects + ' files &middot; ' + formatFileSize(a.totalSize) + '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div style="display:flex;align-items:center;gap:8px">';

            if (tempCount > 0) {
                html += '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:700;background:rgba(239,68,68,0.15);color:#f87171">' + tempCount + ' deletable</span>';
            }
            if (largeCount > 0) {
                html += '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:700;background:rgba(251,191,36,0.15);color:#fbbf24">' + largeCount + ' large</span>';
            }

            html += '</div></div>';

            // Expanded body
            html += '<div class="storage-bucket-body">';

            // Category breakdown
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:16px">';
            catKeys.forEach(function (cat) {
                var c = cats[cat];
                var pct = a.totalSize > 0 ? ((c.size / a.totalSize) * 100).toFixed(1) : '0.0';
                html += '<div style="padding:10px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.04)">' +
                    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
                        '<span>' + (catIcons[cat] || '📎') + '</span>' +
                        '<span style="font-size:0.75rem;font-weight:600;color:var(--text-primary);text-transform:capitalize">' + cat + '</span>' +
                    '</div>' +
                    '<div style="font-size:0.8rem;font-weight:700;color:var(--text-primary)">' + formatFileSize(c.size) + '</div>' +
                    '<div style="font-size:0.7rem;color:var(--text-muted)">' + c.count + ' files (' + pct + '%)</div>' +
                '</div>';
            });
            html += '</div>';

            // Temp/cache files
            if (tempCount > 0) {
                html += '<div style="margin-bottom:12px">' +
                    '<div style="font-size:0.8rem;font-weight:700;color:#f87171;margin-bottom:8px">🗑️ Cache & Temp Files (' + tempCount + ')</div>' +
                    '<div style="overflow-x:auto"><table class="resource-table"><thead><tr>' +
                        '<th>File</th><th>Size</th><th>Last Modified</th>' +
                    '</tr></thead><tbody>';
                (a.tempFiles || []).slice(0, 20).forEach(function (f) {
                    var modified = f.lastModified ? new Date(f.lastModified).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '--';
                    html += '<tr><td style="font-family:monospace;font-size:0.72rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(f.key) + '">' + escapeHtml(f.key) + '</td>' +
                        '<td>' + formatFileSize(f.size) + '</td>' +
                        '<td>' + modified + '</td></tr>';
                });
                if (tempCount > 20) {
                    html += '<tr><td colspan="3" style="font-size:0.75rem;color:var(--text-muted);font-style:italic">...and ' + (tempCount - 20) + ' more</td></tr>';
                }
                html += '</tbody></table></div></div>';
            }

            // Large files
            if (largeCount > 0) {
                html += '<div>' +
                    '<div style="font-size:0.8rem;font-weight:700;color:#fbbf24;margin-bottom:8px">📦 Large Files (' + largeCount + ')</div>' +
                    '<div style="overflow-x:auto"><table class="resource-table"><thead><tr>' +
                        '<th>File</th><th>Size</th><th>Last Modified</th>' +
                    '</tr></thead><tbody>';
                (a.largeFiles || []).slice(0, 10).forEach(function (f) {
                    var modified = f.lastModified ? new Date(f.lastModified).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '--';
                    html += '<tr><td style="font-family:monospace;font-size:0.72rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(f.key) + '">' + escapeHtml(f.key) + '</td>' +
                        '<td style="font-weight:600;color:var(--text-primary)">' + formatFileSize(f.size) + '</td>' +
                        '<td>' + modified + '</td></tr>';
                });
                html += '</tbody></table></div></div>';
            }

            html += '</div></div>'; // close bucket body + card
        });

        container.innerHTML = html;
    }

    // ── GSAP Animations ─────────────────────────────────────────
    function animateIn() {
        if (typeof gsap === 'undefined') return;
        // Kill any running tweens on these elements first to prevent race conditions
        gsap.killTweensOf('.animate-item');
        gsap.from('.animate-item', {
            y: 30,
            opacity: 0,
            duration: 0.6,
            stagger: 0.08,
            ease: 'power2.out',
            clearProps: 'opacity,transform'
        });
    }

    // ── Theme ───────────────────────────────────────────────────
    function onThemeChange() {
        // Redraw all charts with updated theme colors
        renderDailyTrendChart();
        renderDailyTrendProjectsChart();
        renderServiceDonutChart();
        renderMonthlyBarChart();
        renderTop5TrendChart();
    }

    // ── Events ──────────────────────────────────────────────────
    function bindEvents() {
        // Login
        var loginBtn = $('#login-btn');
        if (loginBtn) loginBtn.addEventListener('click', login);

        var passwordInput = $('#password-input');
        if (passwordInput) {
            passwordInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') login();
            });
        }

        // Logout
        var logoutBtn = $('#logout-btn');
        if (logoutBtn) logoutBtn.addEventListener('click', logout);

        // Refresh
        var refreshBtn = $('#refresh-btn');
        if (refreshBtn) refreshBtn.addEventListener('click', loadDashboard);

        // Date range buttons
        $$('.date-btn[data-range]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                $$('.date-btn[data-range]').forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                currentRange = btn.dataset.range;
                loadDashboard();
            });
        });

        // Custom date range
        var customBtn = $('#custom-range-btn');
        if (customBtn) {
            customBtn.addEventListener('click', function () {
                var startEl = $('#date-start');
                var endEl = $('#date-end');
                if (startEl && endEl && startEl.value && endEl.value) {
                    $$('.date-btn[data-range]').forEach(function (b) { b.classList.remove('active'); });
                    currentRange = 'custom';
                    loadDashboard();
                }
            });
        }

        // Table sort
        $$('.service-table th[data-sort]').forEach(function (th) {
            th.addEventListener('click', function () {
                var col = th.dataset.sort;
                if (sortColumn === col) {
                    sortAsc = !sortAsc;
                } else {
                    sortColumn = col;
                    sortAsc = false;
                }
                // Update sort indicators
                $$('.service-table th').forEach(function (h) {
                    h.classList.remove('sorted', 'asc');
                });
                th.classList.add('sorted');
                if (sortAsc) th.classList.add('asc');
                var searchEl = $('#service-search');
                renderServiceTable(searchEl ? searchEl.value : '');
            });
        });

        // Search filter
        var searchInput = $('#service-search');
        if (searchInput) {
            searchInput.addEventListener('input', function (e) {
                renderServiceTable(e.target.value);
            });
        }

        // Theme selector
        var themeSelect = $('#theme-select');
        if (themeSelect && window.ThemeManager) {
            themeSelect.value = ThemeManager.get();
            themeSelect.addEventListener('change', function () {
                ThemeManager.set(themeSelect.value);
            });
            window.addEventListener('themechange', function () {
                themeSelect.value = ThemeManager.get();
            });
        }

        // Re-render charts on theme change
        window.addEventListener('themechange', onThemeChange);
    }

    // ── Init ────────────────────────────────────────────────────
    function init() {
        bindEvents();

        // Auto-login from session storage
        var saved = sessionStorage.getItem('adminPassword');
        if (saved) {
            adminPassword = saved;
            login();
        }
    }

    // ── Activity Log ──────────────────────────────────────────
    window.__loadActivity = async function () {
        var container = $('#activity-container');
        if (!container) return;
        container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">Loading activity data...</div>';

        var daysSelect = $('#activity-days');
        var days = daysSelect ? parseInt(daysSelect.value) : 1;

        try {
            var res = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'aws-activity-log', password: adminPassword, days: days })
            });
            var data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to load activity');
            activityData = data.data;
            renderActivity();
        } catch (err) {
            container.innerHTML = '<div style="text-align:center;padding:2rem;color:#f87171">Error: ' + err.message + '</div>';
        }
    };

    function renderActivity() {
        var container = $('#activity-container');
        if (!container || !activityData) return;

        var html = '';

        // Summary cards
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px">';
        html += '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:14px;text-align:center">' +
            '<div style="font-size:1.5rem;font-weight:700;color:#818cf8">' + activityData.totalEvents + '</div>' +
            '<div style="font-size:0.75rem;color:var(--text-muted)">Total Events</div></div>';

        var totalWrites = activityData.users.reduce(function (s, u) { return s + u.writeEvents; }, 0);
        html += '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:14px;text-align:center">' +
            '<div style="font-size:1.5rem;font-weight:700;color:#f87171">' + totalWrites + '</div>' +
            '<div style="font-size:0.75rem;color:var(--text-muted)">Write Actions</div></div>';

        html += '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:14px;text-align:center">' +
            '<div style="font-size:1.5rem;font-weight:700;color:#4ade80">' + activityData.users.length + '</div>' +
            '<div style="font-size:0.75rem;color:var(--text-muted)">Active Users/Roles</div></div>';

        html += '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:14px;text-align:center">' +
            '<div style="font-size:1.5rem;font-weight:700;color:#f59e0b">' + activityData.topServices.length + '</div>' +
            '<div style="font-size:0.75rem;color:var(--text-muted)">Services Accessed</div></div>';
        html += '</div>';

        // User activity cards
        html += '<h4 style="font-size:0.9rem;font-weight:600;color:var(--text-primary);margin-bottom:12px">User Activity</h4>';
        activityData.users.forEach(function (user) {
            var svcBadges = user.topServices.map(function (s) {
                return '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:0.7rem;background:rgba(99,102,241,0.12);color:#818cf8;margin:2px">' + s.service + ' (' + s.count + ')</span>';
            }).join('');

            var isRole = user.username.startsWith('i-') || user.username.includes('role');
            var userIcon = isRole ? '🤖' : '👤';
            var writeColor = user.writeEvents > 0 ? '#f87171' : '#4ade80';

            html += '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:14px;margin-bottom:10px">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
                    '<div style="display:flex;align-items:center;gap:8px">' +
                        '<span>' + userIcon + '</span>' +
                        '<span style="font-weight:600;color:var(--text-primary)">' + user.username + '</span>' +
                    '</div>' +
                    '<div style="display:flex;gap:12px;font-size:0.8rem">' +
                        '<span style="color:var(--text-muted)">' + user.totalEvents + ' events</span>' +
                        '<span style="color:' + writeColor + '">' + user.writeEvents + ' writes</span>' +
                        '<span style="color:var(--text-secondary)">' + user.readEvents + ' reads</span>' +
                    '</div>' +
                '</div>' +
                '<div style="margin-bottom:8px">' + svcBadges + '</div>' +
                '<details style="cursor:pointer">' +
                    '<summary style="font-size:0.8rem;color:var(--text-muted)">Recent actions (' + user.recentActions.length + ')</summary>' +
                    '<div style="margin-top:8px;max-height:200px;overflow-y:auto">' +
                    '<table style="width:100%;font-size:0.75rem;border-collapse:collapse">' +
                    '<thead><tr><th style="padding:4px 8px;text-align:left;color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.06)">Time</th><th style="padding:4px 8px;text-align:left;color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.06)">Action</th><th style="padding:4px 8px;text-align:left;color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.06)">Service</th></tr></thead><tbody>' +
                    user.recentActions.map(function (a) {
                        var actionColor = a.isWrite ? '#f87171' : 'var(--text-secondary)';
                        var timeStr = a.time ? new Date(a.time).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, month: 'short', day: 'numeric' }) : '--';
                        return '<tr><td style="padding:3px 8px;border-bottom:1px solid rgba(255,255,255,0.03);color:var(--text-muted)">' + timeStr + '</td>' +
                            '<td style="padding:3px 8px;border-bottom:1px solid rgba(255,255,255,0.03);color:' + actionColor + '">' + a.action + '</td>' +
                            '<td style="padding:3px 8px;border-bottom:1px solid rgba(255,255,255,0.03);color:var(--text-secondary)">' + a.service + '</td></tr>';
                    }).join('') +
                    '</tbody></table></div>' +
                '</details>' +
            '</div>';
        });

        // Timeline
        if (activityData.timeline.length > 0) {
            html += '<h4 style="font-size:0.9rem;font-weight:600;color:var(--text-primary);margin:20px 0 12px">Recent Timeline</h4>';
            html += '<div style="max-height:300px;overflow-y:auto">';
            html += '<table class="service-table" style="width:100%;font-size:0.8rem">';
            html += '<thead><tr><th style="padding:6px 10px">Time</th><th style="padding:6px 10px">User</th><th style="padding:6px 10px">Action</th><th style="padding:6px 10px">Service</th></tr></thead><tbody>';
            activityData.timeline.forEach(function (ev) {
                var actionColor = ev.isWrite ? '#f87171' : 'var(--text-secondary)';
                var timeStr = ev.time ? new Date(ev.time).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, month: 'short', day: 'numeric' }) : '--';
                html += '<tr><td style="padding:5px 10px">' + timeStr + '</td>' +
                    '<td style="padding:5px 10px;font-weight:600">' + ev.username + '</td>' +
                    '<td style="padding:5px 10px;color:' + actionColor + '">' + ev.action + '</td>' +
                    '<td style="padding:5px 10px">' + ev.service + '</td></tr>';
            });
            html += '</tbody></table></div>';
        }

        container.innerHTML = html;
    }

    window.__sendActivityReport = async function (reportType) {
        toast('Sending ' + reportType + ' activity report...', 'info');
        try {
            var res = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'aws-activity-email-report', password: adminPassword, reportType: reportType })
            });
            var data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to send report');
            toast(data.message || 'Report sent!', 'success');
        } catch (err) {
            toast('Failed: ' + err.message, 'error');
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
