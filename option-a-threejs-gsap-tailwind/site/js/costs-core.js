/**
 * CoCreate - AWS Cost Analysis Dashboard v2
 * Enhanced: Detailed per-user projects, multiple chart types, in-depth infrastructure analysis
 */

(function () {
    'use strict';

    // ── Config ──────────────────────────────────────────────────
    const API_URL = (window.AppConfig && AppConfig.api && AppConfig.api.chat)
        ? AppConfig.api.chat
        : 'https://mcndu8ynsa.execute-api.us-east-1.amazonaws.com/prod/';

    let adminPassword = '';
    let costsData = null;
    let summaryData = null;
    let currentPeriod = 'monthly';
    let sortColumn = 'total';
    let sortAsc = false;

    // Chart instances
    let charts = {};

    // ── Helpers ─────────────────────────────────────────────────
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);

    function fmt(n) {
        if (n == null || isNaN(n)) return '--';
        if (Math.abs(n) < 0.005) return '$0.00';
        return '$' + Number(n).toFixed(n >= 1 ? 2 : 4);
    }

    function fmtPct(n) {
        if (n == null || isNaN(n)) return '--';
        return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    }

    function deltaBadgeHtml(current, previous) {
        if (previous == null) return '<span class="delta-badge new-item">NEW</span>';
        const diff = current - previous;
        if (Math.abs(diff) < 0.005) return '<span class="delta-badge neutral">-- $0.00</span>';
        const cls = diff > 0 ? 'increase' : 'decrease';
        const arrow = diff > 0 ? '&#9650;' : '&#9660;';
        return `<span class="delta-badge ${cls}">${arrow} ${diff > 0 ? '+' : ''}$${Math.abs(diff).toFixed(2)}</span>`;
    }

    function pctChange(cur, prev) {
        if (!prev || prev === 0) return null;
        return ((cur - prev) / prev) * 100;
    }

    function formatBytes(b) {
        if (!b || b === 0) return '0 B';
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
        if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
        return (b / 1073741824).toFixed(2) + ' GB';
    }

    function getColors() {
        const s = getComputedStyle(document.documentElement);
        return {
            primary: s.getPropertyValue('--primary').trim() || '#FC2A0D',
            secondary: s.getPropertyValue('--secondary').trim() || '#FD6C71',
            accent: s.getPropertyValue('--accent').trim() || '#FFC36A',
            textPrimary: s.getPropertyValue('--text-primary').trim() || '#FFF8F0',
            textMuted: s.getPropertyValue('--text-muted').trim() || '#C4916C',
            bgCard: s.getPropertyValue('--bg-card').trim() || 'rgba(45,20,8,0.85)'
        };
    }

    function hexToRgba(c, a) {
        if (!c || c[0] !== '#') return `rgba(128,128,128,${a})`;
        return `rgba(${parseInt(c.slice(1,3),16)},${parseInt(c.slice(3,5),16)},${parseInt(c.slice(5,7),16)},${a})`;
    }

    function truncate(s, n) { return s && s.length > n ? s.substring(0, n) + '...' : (s || ''); }

    // ── Toast ────────────────────────────────────────────────────
    function showToast(msg, type) {
        const c = $('#toast-container'); if (!c) return;
        const icons = { success: '&#10004;', error: '&#10008;', info: '&#8505;' };
        const t = document.createElement('div');
        t.className = `toast ${type || 'info'}`;
        t.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span class="toast-message">${msg}</span>`;
        c.appendChild(t);
        setTimeout(() => { t.classList.add('removing'); setTimeout(() => t.remove(), 300); }, 3500);
    }

    // ── Password toggle ─────────────────────────────────────────
    window.togglePasswordVisibility = function () {
        const inp = $('#password-input');
        if (inp.type === 'password') { inp.type = 'text'; $('#eye-icon').classList.add('hidden'); $('#eye-off-icon').classList.remove('hidden'); }
        else { inp.type = 'password'; $('#eye-icon').classList.remove('hidden'); $('#eye-off-icon').classList.add('hidden'); }
    };

    // ── Auth ─────────────────────────────────────────────────────
    function tryAutoLogin() {
        const saved = sessionStorage.getItem('adminPassword');
        if (saved) { adminPassword = saved; login(); }
    }

    async function login() {
        if (!adminPassword) adminPassword = ($('#password-input') || {}).value || '';
        if (!adminPassword) { $('#login-error').classList.remove('hidden'); $('#login-error').textContent = 'Please enter the admin password.'; return; }
        try {
            const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'admin-costs-summary', password: adminPassword }) });
            const data = await res.json();
            if (!data.success) throw new Error('Invalid');
            sessionStorage.setItem('adminPassword', adminPassword);
            $('#login-screen').classList.add('hidden'); $('#dashboard').classList.remove('hidden');
            loadAllData();
        } catch (e) { $('#login-error').classList.remove('hidden'); $('#login-error').textContent = 'Invalid password.'; adminPassword = ''; }
    }

    function logout() {
        adminPassword = ''; sessionStorage.removeItem('adminPassword');
        costsData = null; summaryData = null;
        $('#dashboard').classList.add('hidden'); $('#login-screen').classList.remove('hidden'); $('#password-input').value = '';
    }

    // ── Data Loading ────────────────────────────────────────────
    async function loadAllData() {
        const results = await Promise.allSettled([
            fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'admin-costs-summary', password: adminPassword }) }).then(r => r.json()),
            fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get-admin-summary', password: adminPassword }) }).then(r => r.json())
        ]);
        if (results[0].status === 'fulfilled' && results[0].value.success) costsData = results[0].value;
        if (results[1].status === 'fulfilled' && results[1].value.success) summaryData = results[1].value;

        renderDashboard();
        runAnimations();
    }

    // ── Get unified users array with full detail ────────────────
    function getUsers() {
        // Prefer summaryData (enriched with names + deltas), fall back to costsData
        if (summaryData && summaryData.users) return summaryData.users;
        if (costsData && costsData.users) return costsData.users;
        return [];
    }

    function getTotals() {
        if (summaryData && summaryData.userTotals) return summaryData.userTotals;
        if (costsData && costsData.totals) return costsData.totals;
        return { estimated: 0, s3: 0, cloudfront: 0, projectCount: 0 };
    }

    // ── Render Dashboard ────────────────────────────────────────
    function renderDashboard() {
        renderKPIs();
        renderInsights();
        renderAllCharts();
        renderInfrastructure();
        renderUserTable();
        updateTimestamp();
    }

    // ── KPI Cards ───────────────────────────────────────────────
    function renderKPIs() {
        const totals = getTotals();
        const infraTotal = summaryData ? (summaryData.infraTotal || 0) : 0;
        const grandTotal = summaryData ? (summaryData.grandTotal || 0) : (totals.estimated || 0);
        const prevGrand = summaryData ? summaryData.prevGrandTotal : null;
        const users = getUsers();

        $('#kpi-grand-total').textContent = fmt(grandTotal);
        $('#kpi-grand-delta').innerHTML = deltaBadgeHtml(grandTotal, prevGrand);

        $('#kpi-s3-total').textContent = fmt(totals.s3 || 0);
        $('#kpi-s3-delta').innerHTML = '';

        $('#kpi-cf-total').textContent = fmt(totals.cloudfront || 0);
        $('#kpi-cf-delta').innerHTML = '';

        $('#kpi-projects').textContent = totals.projectCount || 0;
        $('#kpi-projects-sub').textContent = `${users.length} user${users.length !== 1 ? 's' : ''}`;

        // WoW
        if (summaryData && summaryData.userTotals) {
            const wk = summaryData.userTotals.weeklyEstimated || 0;
            const pw = summaryData.userTotals.prevWeeklyEstimated;
            const p = pctChange(wk, pw);
            $('#kpi-wow').textContent = p != null ? fmtPct(p) : '--';
            $('#kpi-wow-delta').innerHTML = pw != null ? deltaBadgeHtml(wk, pw) : '<span class="delta-badge new-item">No prev</span>';
        } else { $('#kpi-wow').textContent = '--'; $('#kpi-wow-delta').innerHTML = ''; }

        // MoM
        if (summaryData && summaryData.userTotals) {
            const mo = summaryData.userTotals.estimated || 0;
            const pm = summaryData.userTotals.prevEstimated;
            const p = pctChange(mo, pm);
            $('#kpi-mom').textContent = p != null ? fmtPct(p) : '--';
            $('#kpi-mom-delta').innerHTML = pm != null ? deltaBadgeHtml(mo, pm) : '<span class="delta-badge new-item">No prev</span>';
        } else { $('#kpi-mom').textContent = '--'; $('#kpi-mom-delta').innerHTML = ''; }

        // Infra vs User split
        const userCost = totals.estimated || 0;
        $('#kpi-infra').textContent = fmt(infraTotal);
        $('#kpi-infra-sub').textContent = `User: ${fmt(userCost)}`;
    }

    // ── Insights ────────────────────────────────────────────────
    function renderInsights() {
        const users = getUsers();
        const el = $('#insights-content');
        if (!el || users.length === 0) { if (el) el.innerHTML = '<div class="text-theme-muted text-sm text-center py-4">No data yet</div>'; return; }

        // Top spender
        const topUser = users.reduce((a, b) => ((a.costs?.total || 0) > (b.costs?.total || 0) ? a : b), users[0]);
        const topName = topUser.name || (topUser.email || '').split('@')[0];
        const topCost = topUser.costs?.total || 0;

        // Largest single project
        let largestProj = null, largestCost = 0;
        users.forEach(u => {
            (u.projects || []).forEach(p => {
                const c = p.costs ? p.costs.total : 0;
                if (c > largestCost) { largestCost = c; largestProj = { ...p, userName: u.name || (u.email || '').split('@')[0] }; }
            });
        });

        // Total projects count
        let totalProjects = 0;
        users.forEach(u => { totalProjects += (u.projects || []).length; });

        // Average cost per user
        const avgCost = users.length > 0 ? users.reduce((s, u) => s + (u.costs?.total || 0), 0) / users.length : 0;

        const topAvatar = topUser.avatarUrl
            ? `<img src="${topUser.avatarUrl}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;border:2px solid var(--primary);margin-right:8px;vertical-align:middle;" onerror="this.style.display='none'">`
            : '';
        el.innerHTML = `
            <div class="glass-card rounded-xl p-4 insight-card insight-top">
                <div class="insight-label">Top Spender</div>
                <div class="insight-value text-theme-primary" style="display:flex;align-items:center;">${topAvatar}${topName}</div>
                <div class="insight-detail">${fmt(topCost)} / month across ${topUser.projectCount || (topUser.projects || []).length} project${(topUser.projectCount || (topUser.projects || []).length) !== 1 ? 's' : ''}</div>
            </div>
            <div class="glass-card rounded-xl p-4 insight-card insight-large">
                <div class="insight-label">Largest Project</div>
                <div class="insight-value text-theme-primary">${largestProj ? largestProj.projectName : '--'}</div>
                <div class="insight-detail">${largestProj ? fmt(largestCost) + ' by ' + largestProj.userName : 'N/A'}</div>
            </div>
            <div class="glass-card rounded-xl p-4 insight-card insight-count">
                <div class="insight-label">Total Deployed</div>
                <div class="insight-value text-theme-primary">${totalProjects} Projects</div>
                <div class="insight-detail">Across ${users.length} user${users.length !== 1 ? 's' : ''}</div>
            </div>
            <div class="glass-card rounded-xl p-4 insight-card insight-avg">
                <div class="insight-label">Avg Cost / User</div>
                <div class="insight-value text-theme-primary">${fmt(avgCost)}</div>
                <div class="insight-detail">Monthly average</div>
            </div>
        `;
    }

    // ── Charts ──────────────────────────────────────────────────
    function destroyChart(name) { if (charts[name]) { charts[name].destroy(); charts[name] = null; } }
    function destroyAllCharts() { Object.keys(charts).forEach(destroyChart); }

    function renderAllCharts() {
        const c = getColors();
        renderComparisonChart(c);
        renderDonutChart(c);
        renderStackedBarChart(c);
        renderPolarChart(c);
        renderUserProjectsBarChart(c);
    }

    // 1. Cost Comparison Bar Chart (grouped: current vs previous per user)
    function renderComparisonChart(colors) {
        destroyChart('comparison');
        const canvas = $('#comparison-chart'); if (!canvas) return;
        const users = getUsers();
        if (users.length === 0) { canvas.style.display = 'none'; return; }
        canvas.style.display = '';

        const labels = users.map(u => u.name || (u.email || '').split('@')[0]);
        const isWeekly = currentPeriod === 'weekly';
        const current = users.map(u => isWeekly ? (u.weeklyCost || (u.costs?.total || 0) / 30 * 7) : (u.monthlyCost || u.costs?.total || 0));
        const prev = users.map(u => isWeekly ? (u.prevWeeklyCost || 0) : (u.prevMonthlyCost || 0));

        charts.comparison = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Previous', data: prev, backgroundColor: hexToRgba(colors.secondary, 0.3), borderColor: colors.secondary, borderWidth: 1, borderRadius: 6, barPercentage: 0.7 },
                    { label: 'Current', data: current, backgroundColor: hexToRgba(colors.primary, 0.7), borderColor: colors.primary, borderWidth: 1, borderRadius: 6, barPercentage: 0.7 }
                ]
            },
            options: chartOpts(colors, { callbacks: { label: ctx => `${ctx.dataset.label}: $${ctx.parsed.y.toFixed(4)}` } })
        });
        const lbl = isWeekly ? 'This Week vs Last Week' : 'This Month vs Last Month';
        const el = $('#chart-period-label'); if (el) el.textContent = lbl;
    }

    // 2. Service Donut Chart
    function renderDonutChart(colors) {
        destroyChart('donut');
        const canvas = $('#donut-chart'); if (!canvas) return;
        let s3 = 0, cf = 0, other = 0;
        if (summaryData) {
            (summaryData.aiProductStudioCosts || []).concat(summaryData.tmuxBuilderCosts || []).forEach(c => {
                if (c.service === 'S3') s3 += c.monthlyCost;
                else if (c.service === 'CloudFront') cf += c.monthlyCost;
                else other += c.monthlyCost;
            });
            const t = getTotals(); s3 += t.s3 || 0; cf += t.cloudfront || 0;
        } else { const t = getTotals(); s3 = t.s3 || 0; cf = t.cloudfront || 0; }

        const total = s3 + cf + other || 1;
        $('#donut-total').textContent = fmt(s3 + cf + other);

        const vals = [s3, cf, other];
        const bg = [colors.primary, colors.accent, colors.secondary];
        const names = ['S3', 'CloudFront', 'Other'];

        charts.donut = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: { labels: names, datasets: [{ data: vals, backgroundColor: bg, borderWidth: 0, hoverOffset: 8 }] },
            options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.label}: $${ctx.parsed.toFixed(4)}` } } } }
        });

        $('#donut-legend').innerHTML = names.map((n, i) =>
            `<div class="chart-legend-item"><span class="chart-legend-dot" style="background:${bg[i]}"></span><span>${n}</span><span class="chart-legend-value">${fmt(vals[i])}</span><span class="chart-legend-pct">(${((vals[i]/total)*100).toFixed(1)}%)</span></div>`
        ).join('');
    }

    // 3. Horizontal Stacked Bar: Per-user S3 vs CloudFront breakdown
    function renderStackedBarChart(colors) {
        destroyChart('stacked');
        const canvas = $('#stacked-chart'); if (!canvas) return;
        const users = getUsers();
        if (users.length === 0) { canvas.style.display = 'none'; return; }
        canvas.style.display = '';

        const labels = users.map(u => u.name || (u.email || '').split('@')[0]);
        const s3Data = users.map(u => u.costs?.s3 || 0);
        const cfData = users.map(u => u.costs?.cloudfront || 0);

        charts.stacked = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'S3 Storage', data: s3Data, backgroundColor: hexToRgba(colors.primary, 0.7), borderRadius: 4 },
                    { label: 'CloudFront', data: cfData, backgroundColor: hexToRgba(colors.accent, 0.7), borderRadius: 4 }
                ]
            },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                scales: { x: { stacked: true, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: colors.textMuted, font: { size: 11 }, callback: v => '$' + v.toFixed(2) } }, y: { stacked: true, grid: { display: false }, ticks: { color: colors.textMuted, font: { size: 11 } } } },
                plugins: { legend: { position: 'top', labels: { color: colors.textMuted, font: { size: 11 }, usePointStyle: true, padding: 16 } }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: $${ctx.parsed.x.toFixed(4)}` } } }
            }
        });
    }

    // 4. Polar Area: Infrastructure service costs (visually unique)
    function renderPolarChart(colors) {
        destroyChart('polar');
        const canvas = $('#polar-chart'); if (!canvas) return;
        if (!summaryData) { canvas.style.display = 'none'; return; }
        canvas.style.display = '';

        const allInfra = (summaryData.aiProductStudioCosts || []).concat(summaryData.tmuxBuilderCosts || []);
        const nonZero = allInfra.filter(c => c.monthlyCost > 0);
        if (nonZero.length === 0) { canvas.style.display = 'none'; return; }

        const serviceColors = { S3: '#4ade80', CloudFront: '#818cf8', Lambda: '#fbbf24', 'API Gateway': '#f472b6', DynamoDB: '#38bdf8', EC2: '#fb923c' };
        const labels = nonZero.map(c => `${c.service}: ${truncate(c.resource, 20)}`);
        const data = nonZero.map(c => c.monthlyCost);
        const bg = nonZero.map(c => hexToRgba(serviceColors[c.service] || colors.secondary, 0.7));

        charts.polar = new Chart(canvas.getContext('2d'), {
            type: 'polarArea',
            data: { labels, datasets: [{ data, backgroundColor: bg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { r: { ticks: { display: false }, grid: { color: 'rgba(255,255,255,0.05)' } } },
                plugins: { legend: { position: 'right', labels: { color: colors.textMuted, font: { size: 10 }, padding: 8, usePointStyle: true } }, tooltip: { callbacks: { label: ctx => `${ctx.label}: $${ctx.parsed.r.toFixed(4)}` } } }
            }
        });
    }

    // 5. Per-User Projects Count Bar (how many projects each user has)
    function renderUserProjectsBarChart(colors) {
        destroyChart('userProjects');
        const canvas = $('#user-projects-chart'); if (!canvas) return;
        const users = getUsers();
        if (users.length === 0) { canvas.style.display = 'none'; return; }
        canvas.style.display = '';

        const labels = users.map(u => u.name || (u.email || '').split('@')[0]);
        const projCounts = users.map(u => u.projectCount || (u.projects || []).length);
        const costData = users.map(u => u.costs?.total || 0);

        // Gradient bars
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height || 250);
        grad.addColorStop(0, hexToRgba(colors.primary, 0.8));
        grad.addColorStop(1, hexToRgba(colors.accent, 0.4));

        charts.userProjects = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Projects', data: projCounts, backgroundColor: grad, borderRadius: 8, yAxisID: 'y', barPercentage: 0.6 },
                    { label: 'Total Cost', data: costData, type: 'line', borderColor: colors.secondary, backgroundColor: hexToRgba(colors.secondary, 0.1), fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: colors.secondary, yAxisID: 'y1' }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    y: { position: 'left', grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: colors.textMuted, font: { size: 11 }, stepSize: 1 }, title: { display: true, text: 'Projects', color: colors.textMuted, font: { size: 11 } } },
                    y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: colors.textMuted, font: { size: 11 }, callback: v => '$' + v.toFixed(2) }, title: { display: true, text: 'Cost', color: colors.textMuted, font: { size: 11 } } },
                    x: { grid: { display: false }, ticks: { color: colors.textMuted, font: { size: 11 } } }
                },
                plugins: { legend: { labels: { color: colors.textMuted, font: { size: 11 }, usePointStyle: true, padding: 16 } }, tooltip: { callbacks: { label: ctx => ctx.dataset.label === 'Total Cost' ? `Cost: $${ctx.parsed.y.toFixed(4)}` : `Projects: ${ctx.parsed.y}` } } }
            }
        });
    }

    function chartOpts(colors, tooltipOverrides) {
        return {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { color: colors.textMuted, font: { family: 'DM Sans', size: 12 }, usePointStyle: true, padding: 20 } },
                tooltip: { backgroundColor: 'rgba(0,0,0,0.8)', titleColor: '#fff', bodyColor: '#fff', padding: 12, cornerRadius: 8, ...(tooltipOverrides || {}) }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: colors.textMuted, font: { size: 11 } } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: colors.textMuted, font: { size: 11 }, callback: v => '$' + v.toFixed(2) } }
            }
        };
    }

    // ── Infrastructure ──────────────────────────────────────────
    function renderInfrastructure() {
        if (!summaryData) {
            $('#infra-ai-rows').innerHTML = '<div class="fallback-msg"><div class="fallback-icon">&#9881;</div>Deploy get-admin-summary endpoint to enable</div>';
            $('#infra-tmux-rows').innerHTML = '<div class="fallback-msg"><div class="fallback-icon">&#9881;</div>Deploy get-admin-summary endpoint to enable</div>';
            $('#infra-ai-subtotal').textContent = '--'; $('#infra-tmux-subtotal').textContent = '--'; $('#infra-total').textContent = '--';
            return;
        }

        renderInfraRows('infra-ai-rows', summaryData.aiProductStudioCosts || [], summaryData.aiProductStudioTotal || 0);
        renderInfraRows('infra-tmux-rows', summaryData.tmuxBuilderCosts || [], summaryData.tmuxBuilderTotal || 0);

        $('#infra-ai-subtotal').textContent = fmt(summaryData.aiProductStudioTotal);
        $('#infra-ai-delta').innerHTML = deltaBadgeHtml(summaryData.aiProductStudioTotal, summaryData.prevAiProductStudioTotal);
        $('#infra-tmux-subtotal').textContent = fmt(summaryData.tmuxBuilderTotal);
        $('#infra-tmux-delta').innerHTML = deltaBadgeHtml(summaryData.tmuxBuilderTotal, summaryData.prevTmuxBuilderTotal);
        $('#infra-total').textContent = fmt(summaryData.infraTotal);
        $('#infra-total-delta').innerHTML = deltaBadgeHtml(summaryData.infraTotal, summaryData.prevInfraTotal);

        // Render cost proportion bars
        renderInfraBars('infra-ai-bars', summaryData.aiProductStudioCosts || [], summaryData.aiProductStudioTotal || 0);
        renderInfraBars('infra-tmux-bars', summaryData.tmuxBuilderCosts || [], summaryData.tmuxBuilderTotal || 0);
    }

    function renderInfraRows(id, costs, total) {
        const el = document.getElementById(id); if (!el) return;
        if (!costs.length) { el.innerHTML = '<div class="fallback-msg">No data</div>'; return; }
        el.innerHTML = costs.map(c => {
            const cls = c.service.toLowerCase().replace(/\s+/g, '-');
            return `<div class="infra-row">
                <span class="service-tag ${cls}">${c.service}</span>
                <span class="text-theme-secondary" style="font-size:12px;" title="${c.resource}">${truncate(c.resource, 30)}</span>
                <span class="text-theme-muted" style="font-size:12px;">${c.details || ''}</span>
                <span class="text-theme-primary font-semibold">${fmt(c.monthlyCost)}</span>
                <span>${deltaBadgeHtml(c.monthlyCost, c.prevMonthlyCost)}</span>
            </div>`;
        }).join('');
    }

    function renderInfraBars(id, costs, total) {
        const el = document.getElementById(id); if (!el) return;
        if (!costs.length || total <= 0) { el.innerHTML = ''; return; }
        const serviceColors = { S3: '#4ade80', CloudFront: '#818cf8', Lambda: '#fbbf24', 'API Gateway': '#f472b6', DynamoDB: '#38bdf8', EC2: '#fb923c' };
        el.innerHTML = costs.filter(c => c.monthlyCost > 0).map(c => {
            const pct = Math.min((c.monthlyCost / total) * 100, 100);
            const color = serviceColors[c.service] || '#94a3b8';
            return `<div class="cost-bar-wrap">
                <div class="cost-bar-label"><span class="lbl">${c.service} - ${truncate(c.resource, 25)}</span><span class="val">${fmt(c.monthlyCost)} (${pct.toFixed(1)}%)</span></div>
                <div class="cost-bar-track"><div class="cost-bar-fill" style="width:${pct}%;background:${color};"></div></div>
            </div>`;
        }).join('');
    }

    // ── User Table (detailed) ───────────────────────────────────
    function renderUserTable() {
        const users = getUsers();
        const countEl = $('#user-count-label');
        if (countEl) countEl.textContent = `${users.length} user${users.length !== 1 ? 's' : ''}`;
        if (users.length === 0) { $('#cost-table-body').innerHTML = '<tr><td colspan="7" class="text-center py-8 text-theme-muted">No user data</td></tr>'; return; }

        const sorted = users.slice().sort((a, b) => {
            let va, vb;
            switch (sortColumn) {
                case 'name': va = (a.name || a.email || '').toLowerCase(); vb = (b.name || b.email || '').toLowerCase(); return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
                case 'projects': va = a.projectCount || (a.projects || []).length; vb = b.projectCount || (b.projects || []).length; break;
                case 's3': va = a.costs?.s3 || 0; vb = b.costs?.s3 || 0; break;
                case 'cf': va = a.costs?.cloudfront || 0; vb = b.costs?.cloudfront || 0; break;
                case 'total': va = a.costs?.total || 0; vb = b.costs?.total || 0; break;
                case 'delta': va = (a.costs?.total || 0) - (a.prevMonthlyCost || 0); vb = (b.costs?.total || 0) - (b.prevMonthlyCost || 0); break;
                default: va = 0; vb = 0;
            }
            return sortAsc ? va - vb : vb - va;
        });

        const avatarColors = ['#FC2A0D', '#6366f1', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#fb923c'];
        let html = '';

        sorted.forEach((u, idx) => {
            const name = u.name || (u.email || '').split('@')[0] || 'User';
            const email = u.email || '';
            const costs = u.costs || {};
            const total = costs.total || 0;
            const s3 = costs.s3 || 0;
            const cf = costs.cloudfront || 0;
            const projCount = u.projectCount || (u.projects || []).length;
            const bgColor = avatarColors[idx % avatarColors.length];
            const initial = name.charAt(0).toUpperCase();
            const avatarUrl = u.avatarUrl || '';
            const avatarHtml = avatarUrl
                ? `<div class="user-avatar-placeholder" style="background:${bgColor};overflow:hidden;padding:0;"><img src="${avatarUrl}" alt="${initial}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;">${initial}</span></div>`
                : `<div class="user-avatar-placeholder" style="background:${bgColor};">${initial}</div>`;

            html += `<tr class="user-row" data-idx="${idx}" onclick="window.__toggleUserRow(${idx})">
                <td><div class="flex items-center gap-3">${avatarHtml}<div><div class="font-semibold text-theme-primary" style="font-size:13px;">${name}</div><div class="text-xs text-theme-muted">${email}</div></div></div></td>
                <td class="text-theme-primary font-semibold">${projCount > 0 ? projCount : '<span style="color:#fbbf24;font-size:11px;">0</span>'}</td>
                <td>${fmt(s3)}</td>
                <td>${fmt(cf)}</td>
                <td class="font-semibold text-theme-primary">${fmt(total)}</td>
                <td>${deltaBadgeHtml(total, u.prevMonthlyCost)}</td>
                <td><span class="expand-arrow">&#9654;</span></td>
            </tr>`;

            // Expanded detail row with full project cards
            html += `<tr class="project-detail-row" id="detail-${idx}" style="display:none;">
                <td colspan="7"><div class="project-detail-inner" id="detail-inner-${idx}">${renderExpandedUserDetail(u, idx, bgColor)}</div></td>
            </tr>`;
        });

        $('#cost-table-body').innerHTML = html;
    }

    // ── Expanded User Detail with full project cards ────────────
    function renderExpandedUserDetail(user, idx, bgColor) {
        const name = user.name || (user.email || '').split('@')[0];
        const projects = user.projects || [];
        const costs = user.costs || {};
        const s3 = costs.s3 || 0;
        const cf = costs.cloudfront || 0;
        const total = costs.total || 0;

        const status = user.status || (user.guid ? 'approved' : 'pending');
        const approvedDate = user.approvedAt ? new Date(user.approvedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        const sessionLink = user.sessionLink || '';
        const productIdea = user.productIdea || '';
        const statusColor = status === 'approved' ? '#22c55e' : status === 'rejected' ? '#ef4444' : '#fbbf24';
        const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

        const detailAvatarUrl = user.avatarUrl || '';
        const detailInitial = name.charAt(0).toUpperCase();
        const detailAvatar = detailAvatarUrl
            ? `<div style="width:40px;height:40px;border-radius:50%;overflow:hidden;flex-shrink:0;border:2px solid var(--primary);"><img src="${detailAvatarUrl}" alt="${name}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<span style=\\'display:flex;width:100%;height:100%;align-items:center;justify-content:center;background:${bgColor};color:white;font-weight:700;\\'>${detailInitial}</span>';"></div>`
            : `<div style="width:40px;height:40px;border-radius:50%;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:${bgColor};color:white;font-weight:700;font-size:16px;">${detailInitial}</div>`;

        let html = `<div class="user-panel">
            <div class="user-panel-header">
                <div class="flex items-center gap-3">
                    ${detailAvatar}
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="font-display font-semibold text-theme-primary">${name}</span>
                            <span style="background:${statusColor}22;color:${statusColor};padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;">${statusLabel}</span>
                        </div>
                        <span class="text-xs text-theme-muted">${user.email || ''}</span>
                    </div>
                </div>
                <div class="user-panel-stats">
                    <div class="user-panel-stat"><div class="stat-val">${projects.length}</div><div class="stat-lbl">Projects</div></div>
                    <div class="user-panel-stat"><div class="stat-val">${fmt(s3)}</div><div class="stat-lbl">S3</div></div>
                    <div class="user-panel-stat"><div class="stat-val">${fmt(cf)}</div><div class="stat-lbl">CF</div></div>
                    <div class="user-panel-stat"><div class="stat-val" style="color:var(--primary);">${fmt(total)}</div><div class="stat-lbl">Total</div></div>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-bottom:12px;font-size:12px;">
                ${user.email ? `<div><span class="text-theme-muted">Email:</span> <a href="mailto:${user.email}" style="color:var(--primary);">${user.email}</a></div>` : ''}
                ${approvedDate ? `<div><span class="text-theme-muted">Approved:</span> <span class="text-theme-primary">${approvedDate}</span></div>` : ''}
                ${user.guid ? `<div><span class="text-theme-muted">GUID:</span> <span class="text-theme-primary" style="font-size:10px;">${user.guid.substring(0,16)}...</span></div>` : ''}
                ${sessionLink ? `<div><span class="text-theme-muted">Session:</span> <a href="${sessionLink}" target="_blank" style="color:var(--primary);font-size:11px;">Open Portal</a></div>` : ''}
            </div>
            ${productIdea ? `<div style="font-size:12px;margin-bottom:12px;padding:8px 12px;background:rgba(26,10,0,0.2);border-radius:8px;border-left:3px solid var(--primary);"><span class="text-theme-muted">Product Idea:</span> <span class="text-theme-secondary">${productIdea.length > 200 ? productIdea.substring(0, 200) + '...' : productIdea}</span></div>` : ''}`;

        // Cost proportion bar for this user
        if (total > 0) {
            const s3Pct = (s3 / total * 100).toFixed(1);
            const cfPct = (cf / total * 100).toFixed(1);
            html += `<div style="margin-bottom:12px;">
                <div class="cost-bar-wrap"><div class="cost-bar-label"><span class="lbl">S3 Storage</span><span class="val">${fmt(s3)} (${s3Pct}%)</span></div><div class="cost-bar-track"><div class="cost-bar-fill" style="width:${s3Pct}%;background:#4ade80;"></div></div></div>
                <div class="cost-bar-wrap"><div class="cost-bar-label"><span class="lbl">CloudFront CDN</span><span class="val">${fmt(cf)} (${cfPct}%)</span></div><div class="cost-bar-track"><div class="cost-bar-fill" style="width:${cfPct}%;background:#818cf8;"></div></div></div>
            </div>`;
        }

        html += '</div>';

        // Project cards
        if (projects.length === 0) {
            html += `<div style="text-align:center;padding:16px;background:rgba(251,191,36,0.08);border:1px dashed rgba(251,191,36,0.3);border-radius:12px;">
                <div style="font-size:24px;margin-bottom:4px;">&#128221;</div>
                <div class="text-theme-secondary text-sm font-semibold">No Projects Created Yet</div>
                <div class="text-theme-muted" style="font-size:12px;margin-top:4px;">User is approved but hasn't started building. No AWS costs incurred.</div>
            </div>`;
        } else {
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;">';
            projects.forEach(p => {
                const pName = p.projectName || p.name || 'Unnamed';
                const url = p.deployedUrl || p.awsResources?.cloudFrontUrl || p.awsResources?.deployed_url || '';
                const created = p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
                const pCosts = p.costs || {};
                const pS3 = pCosts.s3?.total ?? pCosts.s3?.storage ?? 0;
                const pCF = pCosts.cloudfront?.total ?? pCosts.cloudfront?.dataTransfer ?? 0;
                const pTotal = pCosts.total ?? (pS3 + pCF);
                const pS3Bytes = pCosts.metrics?.s3SizeBytes || 0;
                const s3Bucket = p.awsResources?.s3Bucket || '';
                const region = p.awsResources?.region || '';

                html += `<div class="project-card">
                    <div class="project-header">
                        <div class="project-name">${pName}</div>
                        ${created ? `<div class="project-date"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>${created}</div>` : ''}
                    </div>
                    ${url ? `<a href="${url}" target="_blank" class="project-url">${url}</a>` : ''}
                    <div class="project-metrics">
                        <div class="metric"><span class="metric-label">S3 Storage</span><span class="metric-value">${formatBytes(pS3Bytes)}</span></div>
                        <div class="metric"><span class="metric-label">S3 Cost</span><span class="metric-value">${fmt(pS3)}</span></div>
                        <div class="metric"><span class="metric-label">CloudFront</span><span class="metric-value">${fmt(pCF)}</span></div>
                        <div class="metric"><span class="metric-label">Bucket</span><span class="metric-value" style="font-size:11px;">${truncate(s3Bucket, 22)}</span></div>
                        ${region ? `<div class="metric"><span class="metric-label">Region</span><span class="metric-value" style="font-size:11px;">${region}</span></div>` : ''}
                        <div class="metric metric-total"><span class="metric-label">Project Total</span><span class="metric-value">${fmt(pTotal)}</span></div>
                    </div>
                </div>`;
            });
            html += '</div>';
        }
        return html;
    }

    window.__toggleUserRow = function (idx) {
        const row = document.getElementById('detail-' + idx);
        const inner = document.getElementById('detail-inner-' + idx);
        const userRow = document.querySelector('.user-row[data-idx="' + idx + '"]');
        if (!row) return;
        const isOpen = row.style.display !== 'none';
        if (isOpen) { inner.classList.remove('open'); setTimeout(() => row.style.display = 'none', 400); userRow?.classList.remove('expanded'); }
        else { row.style.display = ''; requestAnimationFrame(() => inner.classList.add('open')); userRow?.classList.add('expanded'); }
    };

    // ── Sorting ─────────────────────────────────────────────────
    function handleSort(col) {
        if (sortColumn === col) sortAsc = !sortAsc; else { sortColumn = col; sortAsc = false; }
        $$('.cost-table th').forEach(th => { th.classList.remove('sorted'); const a = th.querySelector('.sort-arrow'); if (a) a.innerHTML = '&#9650;'; });
        const active = $(`.cost-table th[data-sort="${col}"]`);
        if (active) { active.classList.add('sorted'); const a = active.querySelector('.sort-arrow'); if (a) a.innerHTML = sortAsc ? '&#9650;' : '&#9660;'; }
        renderUserTable();
    }

    // ── Timestamp ───────────────────────────────────────────────
    function updateTimestamp() {
        const el = $('#updated-time'); if (!el) return;
        const gen = summaryData?.generatedAt;
        const d = gen ? new Date(gen) : new Date();
        el.textContent = 'Updated ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // ── Email Reports ───────────────────────────────────────────
    window.sendReport = async function (type) {
        const btn = $(`.report-btn[data-report="${type}"]`); if (!btn || btn.disabled) return;
        btn.disabled = true; btn.classList.add('sending'); const orig = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span> Sending...';
        try {
            const map = { 'send-all-weekly': 'send-all-reports', 'send-all-monthly': 'send-all-reports', 'send-admin-weekly': 'send-admin-report', 'send-admin-monthly': 'send-admin-report' };
            const body = { action: map[type] || type, password: adminPassword };
            if (type.includes('weekly')) body.period = 'weekly';
            if (type.includes('monthly')) body.period = 'monthly';
            const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const data = await res.json();
            if (data.success || data.message) showToast(data.message || 'Report sent!', 'success');
            else throw new Error(data.error || 'Failed');
        } catch (e) { showToast('Failed: ' + e.message, 'error'); }
        finally { btn.disabled = false; btn.classList.remove('sending'); btn.innerHTML = orig; }
    };

    // ── Period Toggle ───────────────────────────────────────────
    function handlePeriodChange(p) {
        currentPeriod = p;
        $$('.period-toggle button').forEach(b => b.classList.toggle('active', b.dataset.period === p));
        renderKPIs();
        renderComparisonChart(getColors());
    }

    // ── GSAP Animations ─────────────────────────────────────────
    function runAnimations() {
        if (typeof gsap === 'undefined') return;
        gsap.from('#kpi-section .kpi-card', { y: 30, opacity: 0, duration: 0.5, stagger: 0.06, ease: 'power2.out' });
        gsap.from('#insights-section', { y: 30, opacity: 0, duration: 0.5, delay: 0.3, ease: 'power2.out' });
        gsap.from('#charts-row-1 > div', { y: 40, opacity: 0, duration: 0.6, stagger: 0.12, delay: 0.4, ease: 'power2.out' });
        gsap.from('#charts-row-2 > div', { y: 40, opacity: 0, duration: 0.6, stagger: 0.12, delay: 0.6, ease: 'power2.out' });
        gsap.from('#infra-section', { y: 40, opacity: 0, duration: 0.6, delay: 0.8, ease: 'power2.out' });
        gsap.from('#users-section', { y: 40, opacity: 0, duration: 0.6, delay: 1.0, ease: 'power2.out' });
        gsap.from('#reports-section', { y: 30, opacity: 0, duration: 0.5, delay: 1.2, ease: 'power2.out' });
    }

    // ── Theme change ────────────────────────────────────────────
    function onThemeChange() { destroyAllCharts(); renderAllCharts(); }

    // ── Theme Selector ──────────────────────────────────────────
    function setupThemeSelector() {
        const toggle = $('#theme-toggle'), dd = $('#theme-dropdown'); if (!toggle || !dd) return;
        toggle.addEventListener('click', e => { e.stopPropagation(); dd.classList.toggle('open'); });
        document.addEventListener('click', () => dd.classList.remove('open'));
        dd.addEventListener('click', e => e.stopPropagation());
        $$('.theme-option').forEach(opt => opt.addEventListener('click', function () {
            const t = this.dataset.theme; if (window.ThemeManager) ThemeManager.set(t); updateThemeUI(t); dd.classList.remove('open');
        }));
        updateThemeUI(window.ThemeManager ? ThemeManager.get() : 'ember');
    }

    function updateThemeUI(t) {
        $$('.theme-option').forEach(o => o.classList.toggle('active', o.dataset.theme === t));
        const a = $(`.theme-option[data-theme="${t}"]`);
        if (a) { const i = a.querySelector('.theme-option-icon'), n = a.querySelector('span:last-child'); if (i) $('#current-theme-icon').textContent = i.textContent; if (n) $('#current-theme-name').textContent = n.textContent; }
    }

    // ── Events ──────────────────────────────────────────────────
    function bindEvents() {
        $('#login-btn')?.addEventListener('click', login);
        $('#password-input')?.addEventListener('keypress', e => { if (e.key === 'Enter') login(); });
        $('#logout-btn')?.addEventListener('click', logout);
        $('#refresh-btn')?.addEventListener('click', () => { showToast('Refreshing...', 'info'); loadAllData(); });
        $$('.period-toggle button').forEach(b => b.addEventListener('click', function () { handlePeriodChange(this.dataset.period); }));
        $$('.cost-table th[data-sort]').forEach(th => th.addEventListener('click', function () { handleSort(this.dataset.sort); }));
        setupThemeSelector();
        window.addEventListener('themechange', onThemeChange);
    }

    // ── Init ────────────────────────────────────────────────────
    function init() { bindEvents(); tryAutoLogin(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

})();
