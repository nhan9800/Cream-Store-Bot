/* Shop Account Manager - Core Application */

// ===== PASSWORD GATE =====
const SESSION_KEY = 'sam_auth_token';

async function checkPassword() {
    const input = document.getElementById('gate-password').value;
    const err = document.getElementById('gate-error');
    err.style.display = 'none';

    try {
        const res = await fetch(`${API_BASE_URL}/dashboard/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: input })
        });
        const data = await res.json();
        if (data.ok) {
            sessionStorage.setItem(SESSION_KEY, data.token);
            API_TOKEN = data.token;
            document.getElementById('password-gate').style.display = 'none';
            await loadData();
            renderAll();
        } else {
            throw new Error(data.error || 'Sai mật khẩu!');
        }
    } catch(e) {
        err.style.display = 'block';
        err.textContent = '❌ ' + e.message;
        document.getElementById('gate-password').value = '';
        document.getElementById('gate-password').focus();
        document.getElementById('password-gate').classList.add('gate-shake');
        setTimeout(() => document.getElementById('password-gate').classList.remove('gate-shake'), 500);
    }
}

function initPasswordGate() {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) {
        API_TOKEN = saved;
        document.getElementById('password-gate').style.display = 'none';
        return true;
    } else {
        document.getElementById('password-gate').style.display = 'flex';
        setTimeout(() => document.getElementById('gate-password').focus(), 100);
        return false;
    }
}

const DB_KEY = 'netflix_accounts_db';
let accounts = [];
let currentFilter = 'all';
let serviceFilter = 'all';
let searchQuery = '';
let openDropdownId = null;

let customersData = [];
let currentCustomerPage = 1;
let totalCustomerPages = 1;
let customerSearchQuery = '';

// ===== SERVICE CONFIG =====
const SVC_SVG = {
    netflix: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.398 0v24l6.735-2.737V0H5.398zm6.868 0v21.263L18.87 24V0h-6.604zM5.398 0l6.868 24H18.87L12.133 0H5.398z"/></svg>`,
    spotify: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`,
    youtube: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
    discord: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286z"/></svg>`,
    other: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`
};

const SERVICE_META = {
    netflix:  { label: 'Netflix',          emoji: '🎬', color: 'red-n',  svg: SVC_SVG.netflix, iconClass: 'svc-icon-netflix'  },
    spotify:  { label: 'Spotify',          emoji: '🎵', color: 'green',  svg: SVC_SVG.spotify, iconClass: 'svc-icon-spotify'  },
    youtube:  { label: 'YouTube Premium',  emoji: '▶️', color: 'red',    svg: SVC_SVG.youtube, iconClass: 'svc-icon-youtube'  },
    discord:  { label: 'Discord Nitro',    emoji: '💙', color: 'purple', svg: SVC_SVG.discord, iconClass: 'svc-icon-discord'  },
    other:    { label: 'Khác',             emoji: '📦', color: 'blue',   svg: SVC_SVG.other,   iconClass: 'svc-icon-other'    }
};

// ===== DATA =====
const API_BASE_URL = window.location.origin;
let API_TOKEN = '';

function showLoader(text = "Đang đồng bộ dữ liệu...") {
    const el = document.getElementById('global-loader');
    if(el) {
        el.querySelector('.g-text').innerText = text;
        el.style.display = 'flex';
        // force reflow
        void el.offsetWidth;
        el.style.opacity = '1';
    }
}

function hideLoader() {
    const el = document.getElementById('global-loader');
    if(el) {
        el.style.opacity = '0';
        setTimeout(() => el.style.display = 'none', 500);
    }
}

async function loadData() {
    showLoader("Đang đồng bộ dữ liệu Hệ Thống...");
    try {
        const res = await fetch(`${API_BASE_URL}/dashboard/api/accounts`, {
            headers: { 'x-dashboard-token': API_TOKEN }
        });
        if (!res.ok) throw new Error('API Error');
        const data = await res.json();
        if (data.ok) accounts = data.accounts || [];
        else accounts = [];
    } catch(e) { 
        console.error('Failed to load API, fallback to local', e);
        try {
            const raw = localStorage.getItem(DB_KEY);
            accounts = raw ? JSON.parse(raw) : [];
        } catch(err) { accounts = []; }
    }
    hideLoader();
}

async function apiSaveAccount(acc, isNew) {
    const url = isNew ? `${API_BASE_URL}/dashboard/api/accounts` : `${API_BASE_URL}/dashboard/api/accounts/${acc.id}`;
    fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'x-dashboard-token': API_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify(acc)
    }).catch(e => console.error(e));
}

async function apiDeleteAccount(id) {
    fetch(`${API_BASE_URL}/dashboard/api/accounts/${id}`, {
        method: 'DELETE',
        headers: { 'x-dashboard-token': API_TOKEN }
    }).catch(e => console.error(e));
}

async function apiDeliverAccount(id) {
    if(!confirm('Bạn có chắc chắn muốn giao tài khoản này qua tin nhắn riêng (DM) cho khách trên Discord không?')) return;
    showToast('Đang tiến hành gửi DM...', 'info');
    try {
        const res = await fetch(`${API_BASE_URL}/dashboard/api/accounts/${id}/deliver`, {
            method: 'POST',
            headers: { 'x-dashboard-token': API_TOKEN }
        });
        const data = await res.json();
        if(data.ok) {
            showToast('✅ Đã giao tài khoản thành công qua DM!', 'success');
            await loadData();
            renderAll();
        } else {
            showToast('❌ Lỗi giao hàng: ' + (data.error || 'Unknown Error'), 'error');
        }
    } catch(e) {
        showToast('❌ Lỗi mạng khi giao hàng.', 'error');
    }
}

function saveData() {
    localStorage.setItem(DB_KEY, JSON.stringify(accounts));
}
function genId() {
    return 'CR_W_' + Math.floor(Math.random()*1000000);
}

// ===== ACCOUNT STATUS =====
function getAccountStatus(acc) {
    const now = new Date();
    const expiry = new Date(acc.expiryDate);
    const diffMs = expiry - now;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return { status: 'expired', days: 0, label: 'Hết Hạn', color: 'red' };
    if (diffDays <= 7) return { status: 'warning', days: diffDays, label: 'Sắp Hết', color: 'yellow' };
    return { status: 'active', days: diffDays, label: 'Hoạt Động', color: 'green' };
}

function getProgressPercent(acc) {
    const start = new Date(acc.startDate).getTime();
    const end = new Date(acc.expiryDate).getTime();
    const now = Date.now();
    const total = end - start;
    const elapsed = now - start;
    if (total <= 0) return 0;
    const remaining = Math.max(0, 100 - (elapsed / total) * 100);
    return Math.min(100, Math.max(0, remaining));
}

// ===== RENDER =====
function renderAll() {
    updateStats();
    renderCards();
    renderCharts();
}

// ===== THEME =====
function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    html.setAttribute('data-theme', next);
    localStorage.setItem('cream_theme', next);
}

function initTheme() {
    const saved = localStorage.getItem('cream_theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
}
initTheme();

// ===== ANIMATED COUNTER =====
function animateCountUp(el, target, duration = 800) {
    if (!el) return;
    const num = parseInt(target) || 0;
    if (num === 0) { el.textContent = '0'; return; }
    const start = parseInt(el.textContent) || 0;
    if (start === num) return;
    const startTime = performance.now();
    function tick(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
        el.textContent = Math.round(start + (num - start) * eased);
        if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

// ===== DUAL CHARTS =====
let doughnutChart = null;
let revenueChart = null;

function switchChart(type) {
    document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    const dc = document.getElementById('doughnutChart');
    const rc = document.getElementById('revenueChart');
    if (type === 'doughnut') {
        if (dc) dc.style.display = 'block';
        if (rc) rc.style.display = 'none';
    } else {
        if (dc) dc.style.display = 'none';
        if (rc) rc.style.display = 'block';
        loadRevenueChart();
    }
}

function renderCharts() {
    if (typeof Chart === 'undefined') return;
    renderDoughnutChart();
}

function renderDoughnutChart() {
    const ctx = document.getElementById('doughnutChart');
    if (!ctx) return;
    const count = { netflix: 0, spotify: 0, youtube: 0, discord: 0, other: 0 };
    accounts.forEach(a => {
        const t = a.service || 'netflix';
        if (count[t] !== undefined) count[t]++;
        else count.other++;
    });

    const data = {
        labels: ['Netflix', 'Spotify', 'YouTube', 'Discord', 'Khác'],
        datasets: [{
            data: [count.netflix, count.spotify, count.youtube, count.discord, count.other],
            backgroundColor: [
                'rgba(229, 9, 20, 0.8)',
                'rgba(29, 185, 84, 0.8)',
                'rgba(255, 0, 0, 0.7)',
                'rgba(88, 101, 242, 0.8)',
                'rgba(99, 102, 241, 0.5)'
            ],
            borderColor: [
                '#E50914', '#1DB954', '#FF0000', '#5865F2', '#6366f1'
            ],
            borderWidth: 2,
            hoverOffset: 10
        }]
    };

    if (doughnutChart) {
        doughnutChart.data = data;
        doughnutChart.update();
    } else {
        doughnutChart = new Chart(ctx, {
            type: 'doughnut',
            data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#94a3b8',
                            font: { size: 12, weight: 600 },
                            padding: 16,
                            usePointStyle: true,
                            pointStyleWidth: 10
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(24, 24, 27, 0.95)',
                        titleColor: '#fff',
                        bodyColor: '#e2e8f0',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 12,
                        cornerRadius: 8
                    }
                }
            }
        });
    }
}

async function loadRevenueChart() {
    const ctx = document.getElementById('revenueChart');
    if (!ctx || typeof Chart === 'undefined') return;

    try {
        const res = await fetch(`${API_BASE_URL}/dashboard/api/revenue-chart`, {
            headers: { 'x-dashboard-token': API_TOKEN }
        });
        const json = await res.json();
        if (!json.ok) return;

        const { daily, monthly } = json;
        const labels = daily.map(d => d.label);
        const values = daily.map(d => d.total);

        const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 250);
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.35)');
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

        const data = {
            labels,
            datasets: [{
                label: 'Doanh thu (VNĐ)',
                data: values,
                backgroundColor: gradient,
                borderColor: '#6366f1',
                borderWidth: 2.5,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#6366f1',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 7
            }]
        };

        if (revenueChart) {
            revenueChart.data = data;
            revenueChart.update();
        } else {
            revenueChart = new Chart(ctx, {
                type: 'line',
                data,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            mode: 'index',
                            intersect: false,
                            backgroundColor: 'rgba(24, 24, 27, 0.95)',
                            titleColor: '#fff',
                            bodyColor: '#e2e8f0',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderWidth: 1,
                            padding: 12,
                            cornerRadius: 8,
                            callbacks: {
                                label: ctx => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(ctx.parsed.y)
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(255,255,255,0.04)' },
                            ticks: {
                                color: '#64748b',
                                callback: v => new Intl.NumberFormat('vi-VN', { notation: 'compact' }).format(v)
                            }
                        },
                        x: { grid: { display: false }, ticks: { color: '#94a3b8', maxRotation: 0 } }
                    }
                }
            });
        }
    } catch (e) {
        console.error('Revenue chart error:', e);
    }
}

function updateStats() {
    let total = accounts.length, active = 0, warning = 0, expired = 0;
    accounts.forEach(a => {
        const s = getAccountStatus(a);
        if (s.status === 'active') active++;
        else if (s.status === 'warning') warning++;
        else expired++;
    });
    animateCountUp(document.getElementById('stat-total-num'), total);
    animateCountUp(document.getElementById('stat-active-num'), active);
    animateCountUp(document.getElementById('stat-warning-num'), warning);
    animateCountUp(document.getElementById('stat-expired-num'), expired);

    // Update tab counts
    document.getElementById('tab-count-all').textContent = total;
    document.getElementById('tab-count-active').textContent = active;
    document.getElementById('tab-count-warning').textContent = warning;
    document.getElementById('tab-count-expired').textContent = expired;

    // Update notification bell
    updateNotifications(warning, expired);
}

function filterAccounts() {
    let filtered = [...accounts];

    // Status filter
    if (currentFilter !== 'all') {
        filtered = filtered.filter(a => getAccountStatus(a).status === currentFilter);
    }

    // Service filter
    if (serviceFilter !== 'all') {
        filtered = filtered.filter(a => (a.service || 'netflix') === serviceFilter);
    }

    // Search
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(a => {
            const svcLabel = (SERVICE_META[a.service || 'netflix']?.label || '').toLowerCase();
            return (a.email || '').toLowerCase().includes(q) ||
                (a.profileName || '').toLowerCase().includes(q) ||
                (a.customerName || '').toLowerCase().includes(q) ||
                (a.customerDiscord || '').toLowerCase().includes(q) ||
                (a.customerGmail || '').toLowerCase().includes(q) ||
                svcLabel.includes(q);
        });
    }

    // Apply sort
    const sort = (document.getElementById('sort-select') || {}).value || 'newest';
    filtered.sort((a, b) => {
        if (sort === 'newest') return new Date(b.createdAt) - new Date(a.createdAt);
        if (sort === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
        if (sort === 'expiry-asc') return new Date(a.expiryDate) - new Date(b.expiryDate);
        if (sort === 'expiry-desc') return new Date(b.expiryDate) - new Date(a.expiryDate);
        if (sort === 'name-asc') return (a.customerName || '').localeCompare(b.customerName || '');
        if (sort === 'name-desc') return (b.customerName || '').localeCompare(a.customerName || '');
        return 0;
    });

    return filtered;
}

function formatDate(d) {
    if (!d) return '--';
    const dt = new Date(d);
    return dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(d) {
    if (!d) return '--';
    const dt = new Date(d);
    return dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderCards() {
    const tbody = document.getElementById('accounts-tbody');
    const empty = document.getElementById('empty-state');
    const filtered = filterAccounts();

    if (!tbody || !empty) return;

    if (filtered.length === 0) {
        tbody.parentElement.style.display = 'none';
        empty.style.display = 'block';
        return;
    }
    tbody.parentElement.style.display = 'block';
    empty.style.display = 'none';

    tbody.innerHTML = filtered.map((acc, i) => {
        const st = getAccountStatus(acc);
        const svc = SERVICE_META[acc.service || 'netflix'];
        const renCount = (acc.history || []).length;
        
        let pName = acc.productName || '';
        if (pName) pName = pName.replace(/<.*?>/g, '').trim();

        return `
        <div class="acc-card">
            <div class="acc-card-left">
                <div class="acc-service-badge">
                    <div class="svc-icon ${svc.iconClass}">${svc.svg}</div>
                    <div class="acc-service-meta">
                        ${pName ? `<div class="acc-title">${escHtml(pName)}</div>` : ''}
                        ${acc.email || acc.password ? `
                        <div class="acc-creds">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                            ${acc.email ? `<span>${escHtml(acc.email)}</span>` : ''}
                            ${acc.password ? `<strong class="acc-pass">${escHtml(acc.password)}</strong>` : ''}
                        </div>
                        ` : (!pName ? `<span style="font-size: 12px; color: var(--text-tertiary);">Chưa có dữ liệu</span>` : '')}
                        ${acc.pin ? `<div class="acc-pin">Màn: ${escHtml(acc.profileName)} • PIN: <strong style="color:var(--amber)">${escHtml(acc.pin)}</strong></div>` : ''}
                    </div>
                </div>
                <div class="acc-customer-box">
                    <div class="c-name">${escHtml(acc.customerName)}</div>
                    <div class="c-sub">${escHtml(acc.customerDiscord && acc.customerDiscord !== acc.customerName ? acc.customerDiscord : '--')}</div>
                </div>
            </div>
            
            <div class="acc-card-right">
                <div class="acc-expiry-box">
                    <div class="exp-start">Bắt đầu: ${formatDate(acc.startDate)}</div>
                    <div class="text-${st.color}" style="font-weight:700;">Hết hạn: ${formatDate(acc.expiryDate)}</div>
                </div>
                
                <div class="acc-status-box">
                    <span class="status-pill pill-${st.status}">
                        <span style="width:6px;height:6px;border-radius:50%;background:currentColor;"></span>
                        ${st.label} ${st.status !== 'expired' ? `(${st.days}d)` : ''}
                    </span>
                    ${renCount > 0 ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:6px;display:flex;align-items:center;gap:4px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> Gia hạn ${renCount} lần</div>` : ''}
                </div>

                <div class="acc-actions" style="position: relative;">
                    <button class="action-btn" onclick="toggleDropdown('${acc.id}', event)">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                    </button>
                    <div class="dropdown-menu" id="dropdown-${acc.id}">
                        <button class="dropdown-item" onclick="openDetailModal('${acc.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            Xem Chi Tiết
                        </button>
                        <button class="dropdown-item" onclick="openEditModal('${acc.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            Chỉnh Sửa
                        </button>
                        <button class="dropdown-item text-emerald" onclick="openRenewModal('${acc.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                            Gia Hạn Bổ Sung
                        </button>
                        <button class="dropdown-item text-brand" onclick="apiDeliverAccount('${acc.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                            Giao Tài Khoản (DM)
                        </button>
                        <button class="dropdown-item text-amber" onclick="openHistoryModal('${acc.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            Lịch Sử Thuê (${renCount})
                        </button>
                        <button class="dropdown-item text-rose" onclick="openDeleteModal('${acc.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            Xóa Bỏ
                        </button>
                    </div>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

function escHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ===== MODALS =====
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function closeModalOnOverlay(e, id) { if (e.target === e.currentTarget) closeModal(id); }

// ===== DROPDOWN =====
function toggleDropdown(accId, e) {
    e.stopPropagation();
    
    const m = document.getElementById('dropdown-' + accId);
    if (!m) return;
    const isShowing = m.classList.contains('show');
    
    closeAllDropdowns();
    const card = m.closest('.acc-card');
    
    if (!isShowing) {
        m.classList.add('show');
        if (card) {
            card.style.position = 'relative';
            card.style.zIndex = '9999';
        }
        openDropdownId = accId;
    }
}
function closeAllDropdowns() {
    document.querySelectorAll('.dropdown-menu.show').forEach(dd => {
        dd.classList.remove('show');
        const card = dd.closest('.acc-card');
        if (card) {
            card.style.zIndex = '';
            card.style.position = '';
        }
    });
    document.querySelectorAll('.card-dropdown.show').forEach(d => d.classList.remove('show'));
    openDropdownId = null;
}

document.addEventListener('click', () => {
    closeAllDropdowns();
});


function handleServiceChange() {
    const svc = document.getElementById('form-service').value;
    const spotifyFields = document.getElementById('spotify-fields');
    const discordFields = document.getElementById('discord-fields');
    const pinWrap = document.getElementById('field-pin-wrap');
    // Spotify family fields
    if (spotifyFields) spotifyFields.style.display = svc === 'spotify' ? 'block' : 'none';
    // Discord Nitro renewal fields
    if (discordFields) discordFields.style.display = svc === 'discord' ? 'block' : 'none';
    // PIN only relevant for Netflix profiles
    if (pinWrap) pinWrap.style.display = svc === 'netflix' ? 'grid' : 'none';
}

// Calculate next renewal date for Discord Nitro
function getNextRenewalDate(acc) {
    if ((acc.service || 'netflix') !== 'discord') return null;
    const cycle = acc.discordRenewalCycle || 2;
    const start = new Date(acc.startDate);
    const now = new Date();
    let next = new Date(start);
    while (next <= now) {
        next.setMonth(next.getMonth() + cycle);
    }
    return next;
}

function openAddModal() {
    console.log("Mở modal thêm mới...");
    document.getElementById('modal-account-title').textContent = 'Thêm Tài Khoản Mới';
    document.getElementById('btn-submit-account').textContent = 'Thêm Tài Khoản';
    document.getElementById('form-edit-id').value = '';
    document.getElementById('account-form').reset();
    document.getElementById('form-service').value = 'netflix';
    handleServiceChange();
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('form-start-date').value = today;
    openModal('modal-account');
}

function openEditModal(id) {
    closeAllDropdowns();
    const acc = accounts.find(a => String(a.id) === String(id));
    if (!acc) {
        console.error("Không tìm thấy account với id:", id);
        return;
    }
    document.getElementById('modal-account-title').textContent = 'Chỉnh Sửa Tài Khoản';
    document.getElementById('btn-submit-account').textContent = 'Lưu Thay Đổi';
    document.getElementById('form-edit-id').value = id;
    document.getElementById('form-email').value = acc.email || '';
    document.getElementById('form-password').value = acc.password || '';
    document.getElementById('form-profile').value = acc.profileName || '';
    document.getElementById('form-pin').value = acc.pin || '';
    document.getElementById('form-service').value = acc.service || 'netflix';
    handleServiceChange();
    document.getElementById('form-customer').value = acc.customerName || '';
    document.getElementById('form-discord').value = acc.customerDiscord || '';
    document.getElementById('form-customer-gmail').value = acc.customerGmail || '';
    document.getElementById('form-spotify-owner').value = acc.spotifyOwner || '';
    document.getElementById('form-spotify-member').value = acc.spotifyMember || '';
    document.getElementById('form-discord-payment-gmail').value = acc.discordPaymentGmail || '';
    document.getElementById('form-discord-renewal-cycle').value = acc.discordRenewalCycle || 2;
    document.getElementById('form-months').value = acc.monthsPurchased || 1;
    document.getElementById('form-start-date').value = acc.startDate ? acc.startDate.split('T')[0] : '';
    openModal('modal-account');
}

function handleAccountSubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('form-edit-id').value;
    const service = document.getElementById('form-service').value || 'netflix';
    const email = document.getElementById('form-email').value.trim();
    const password = document.getElementById('form-password').value.trim();
    const profileName = document.getElementById('form-profile').value.trim();
    const pin = document.getElementById('form-pin').value.trim();
    const customerName = document.getElementById('form-customer').value.trim();
    const customerDiscord = document.getElementById('form-discord').value.trim();
    const customerGmail = document.getElementById('form-customer-gmail').value.trim();
    const spotifyOwner = document.getElementById('form-spotify-owner').value.trim();
    const spotifyMember = document.getElementById('form-spotify-member').value.trim();
    const discordPaymentGmail = document.getElementById('form-discord-payment-gmail').value.trim();
    const discordRenewalCycle = parseInt(document.getElementById('form-discord-renewal-cycle').value) || 2;
    const months = parseInt(document.getElementById('form-months').value) || 1;
    const startDate = document.getElementById('form-start-date').value;

    if (!email || !password || !customerName || !startDate) {
        showToast('Vui lòng điền đầy đủ thông tin!', 'error');
        return;
    }

    const start = new Date(startDate);
    const expiry = new Date(start);
    expiry.setMonth(expiry.getMonth() + months);

    if (editId) {
        const idx = accounts.findIndex(a => a.id === editId);
        if (idx === -1) return;
        accounts[idx] = {
            ...accounts[idx], service, email, password, profileName, pin,
            customerName, customerDiscord, customerGmail,
            spotifyOwner, spotifyMember,
            discordPaymentGmail, discordRenewalCycle,
            monthsPurchased: months,
            startDate: start.toISOString(), expiryDate: expiry.toISOString()
        };
        apiSaveAccount(accounts[idx], false);
        showToast('Đã cập nhật tài khoản lên hệ thống bot!', 'success');
    } else {
        const newAcc = {
            id: genId(), service, email, password, profileName, pin,
            customerName, customerDiscord, customerGmail,
            spotifyOwner, spotifyMember,
            discordPaymentGmail, discordRenewalCycle,
            monthsPurchased: months,
            startDate: start.toISOString(), expiryDate: expiry.toISOString(),
            createdAt: new Date().toISOString(),
            history: [{
                id: genId(), type: 'initial', date: new Date().toISOString(),
                months, startDate: start.toISOString(), expiryDate: expiry.toISOString(),
                accountEmail: email
            }]
        };
        accounts.unshift(newAcc);
        apiSaveAccount(newAcc, true);
        showToast('Đã thêm tài khoản mới vào hệ thống bot!', 'success');
    }

    saveData();
    renderAll();
    closeModal('modal-account');
}

// ===== RENEW =====
function openRenewModal(id) {
    closeAllDropdowns();
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;
    const st = getAccountStatus(acc);
    document.getElementById('renew-account-id').value = id;
    document.getElementById('renew-info').innerHTML = `
        <div class="renew-info-row"><span>Tài khoản:</span><span>${escHtml(acc.email)}</span></div>
        <div class="renew-info-row"><span>Khách hàng:</span><span>${escHtml(acc.customerName)}</span></div>
        <div class="renew-info-row"><span>Trạng thái:</span><span style="color:var(--${st.color})">${st.label}</span></div>
        <div class="renew-info-row"><span>Hết hạn:</span><span>${formatDate(acc.expiryDate)}</span></div>
        <div class="renew-info-row"><span>Số lần thuê:</span><span>${(acc.history||[]).length} lần</span></div>
    `;
    document.getElementById('renew-months').value = '';
    openModal('modal-renew');
}

async function handleRenewSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('renew-account-id').value;
    const months = parseInt(document.getElementById('renew-months').value) || 0;
    if (months <= 0) { showToast('Vui lòng nhập số tháng hợp lệ!', 'error'); return; }
    
    showLoader("Đang xử lý gia hạn...");
    try {
        const res = await fetch(`${API_BASE_URL}/dashboard/api/accounts/${id}/renew`, {
            method: 'POST',
            headers: { 
                'x-dashboard-token': API_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ months })
        });
        const data = await res.json();
        if (data.ok) {
            showToast('✅ Đã gia hạn dịch vụ thành công!', 'success');
            await loadData();
            renderAll();
            closeModal('modal-renew');
        } else {
            showToast('❌ Lỗi gia hạn: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (e) {
        showToast('❌ Lỗi mạng khi gia hạn.', 'error');
    }
    hideLoader();
}

// ===== HISTORY =====
function openHistoryModal(id) {
    closeAllDropdowns();
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;
    const history = acc.history || [];
    
    document.getElementById('history-title').textContent = `Lịch Sử - ${acc.customerName}`;
    
    const totalMonths = history.reduce((s, h) => s + (h.months || 0), 0);
    document.getElementById('history-stats').innerHTML = `
        <div class="history-stat-item">
            <div class="history-stat-number">${history.length}</div>
            <div class="history-stat-label">Số Lần Thuê</div>
        </div>
        <div class="history-stat-item">
            <div class="history-stat-number">${totalMonths}</div>
            <div class="history-stat-label">Tổng Số Tháng</div>
        </div>
        <div class="history-stat-item">
            <div class="history-stat-number">${acc.customerDiscord}</div>
            <div class="history-stat-label">Discord ID</div>
        </div>
    `;

    const sorted = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
    document.getElementById('history-timeline').innerHTML = sorted.length === 0 ?
        '<p style="color:var(--text3);text-align:center;padding:20px">Chưa có lịch sử</p>' :
        sorted.map(h => `
            <div class="timeline-item">
                <div class="timeline-dot ${h.type === 'initial' ? 'dot-initial' : 'dot-renewal'}"></div>
                <div class="timeline-content">
                    <span class="timeline-tag ${h.type === 'initial' ? 'tag-initial' : 'tag-renewal'}">
                        ${h.type === 'initial' ? 'Đăng ký mới' : 'Gia hạn'}
                    </span>
                    <div class="timeline-date">${formatDateTime(h.date)}</div>
                    <div class="timeline-detail">
                        <strong>${h.months} tháng</strong> — Tài khoản: ${escHtml(h.accountEmail)}<br>
                        Từ ${formatDate(h.startDate)} đến ${formatDate(h.expiryDate)}
                    </div>
                </div>
            </div>
        `).join('');

    openModal('modal-history');
}

// ===== DETAIL =====
function openDetailModal(id) {
    closeAllDropdowns();
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;
    const st = getAccountStatus(acc);
    const svc = SERVICE_META[acc.service || 'netflix'];
    const copyBtn = (val) => `<button class="copy-detail-btn" onclick="copyText('${escHtml(val)}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>`;
    document.getElementById('detail-body').innerHTML = `
        <div class="detail-grid">
            <div class="detail-block detail-block-full">
                <div class="detail-block-label">Dịch Vụ</div>
                <div class="detail-block-value">
                    <span class="service-badge" style="font-size:13px;padding:4px 14px">${svc.emoji} ${svc.label}</span>
                    <span style="color:var(--${st.color});font-size:13px;margin-left:8px">${st.label} (${st.days} ngày)</span>
                </div>
            </div>
            <div class="detail-block">
                <div class="detail-block-label">Tài Khoản</div>
                <div class="detail-block-value">${escHtml(acc.email)} ${copyBtn(acc.email)}</div>
            </div>
            <div class="detail-block">
                <div class="detail-block-label">Mật Khẩu</div>
                <div class="detail-block-value">${escHtml(acc.password)} ${copyBtn(acc.password)}</div>
            </div>
            ${acc.profileName ? `
            <div class="detail-block">
                <div class="detail-block-label">Profile</div>
                <div class="detail-block-value">${escHtml(acc.profileName)}</div>
            </div>` : ''}
            ${acc.pin ? `
            <div class="detail-block">
                <div class="detail-block-label">PIN</div>
                <div class="detail-block-value">${escHtml(acc.pin)}</div>
            </div>` : ''}
            <div class="detail-block">
                <div class="detail-block-label">Khách Hàng</div>
                <div class="detail-block-value">${escHtml(acc.customerName)}</div>
            </div>
            <div class="detail-block">
                <div class="detail-block-label">Discord</div>
                <div class="detail-block-value">${escHtml(acc.customerDiscord || '—')} ${acc.customerDiscord ? copyBtn(acc.customerDiscord) : ''}</div>
            </div>
            ${acc.customerGmail ? `
            <div class="detail-block detail-block-full">
                <div class="detail-block-label">Gmail Khách Hàng</div>
                <div class="detail-block-value">${escHtml(acc.customerGmail)} ${copyBtn(acc.customerGmail)}</div>
            </div>` : ''}
            ${acc.service === 'spotify' && acc.spotifyOwner ? `
            <div class="detail-block">
                <div class="detail-block-label">🎵 Email Chủ Gói</div>
                <div class="detail-block-value">${escHtml(acc.spotifyOwner)} ${copyBtn(acc.spotifyOwner)}</div>
            </div>` : ''}
            ${acc.service === 'discord' && acc.discordPaymentGmail ? `
            <div class="detail-block detail-block-full">
                <div class="detail-block-label">💙 Gmail Google Pay (vào gia hạn)</div>
                <div class="detail-block-value">${escHtml(acc.discordPaymentGmail)} ${copyBtn(acc.discordPaymentGmail)}</div>
            </div>` : ''}
            ${(() => {
                if (acc.service !== 'discord') return '';
                const nextRen = getNextRenewalDate(acc);
                if (!nextRen) return '';
                const daysUntil = Math.ceil((nextRen - new Date()) / (1000 * 60 * 60 * 24));
                const cls = daysUntil <= 5 ? 'discord-renew-urgent' : 'discord-renew-ok';
                return `
                <div class="detail-block detail-block-full">
                    <div class="detail-block-label">💙 Lịch Gia Hạn Tiếp Theo (mỗi ${acc.discordRenewalCycle || 2} tháng)</div>
                    <div class="detail-block-value ${cls}">${formatDate(nextRen.toISOString())} <small>(còn ${daysUntil} ngày)</small></div>
                </div>`;
            })()}
            ${acc.note || acc.claimNotes ? `
            <div class="detail-block detail-block-full">
                <div class="detail-block-label">GHI CHÚ (NOTE / GMAIL TỰ ĐIỀN)</div>
                <div class="detail-block-value" style="font-size: 14px; font-weight: 500; font-family: monospace; white-space: pre-wrap;">${escHtml(acc.note)}${acc.note && acc.claimNotes ? '\n--- Tiêu Điểm ---' : ''}${acc.claimNotes ? escHtml(acc.claimNotes) : ''}</div>
            </div>` : ''}
            <div class="detail-block">
                <div class="detail-block-label">Số Lần Thuê</div>
                <div class="detail-block-value">${(acc.history||[]).length} lần</div>
            </div>
            <div class="detail-block detail-block-full">
                <div class="detail-block-label">Thời Hạn</div>
                <div class="detail-block-value">${formatDate(acc.startDate)} → ${formatDate(acc.expiryDate)} (${acc.monthsPurchased} tháng)</div>
            </div>
        </div>
    `;
    openModal('modal-detail');
}

// ===== DELETE =====
function openDeleteModal(id) {
    closeAllDropdowns();
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;
    document.getElementById('delete-account-id').value = id;
    document.getElementById('delete-account-name').textContent = acc.email;
    openModal('modal-delete');
}

function confirmDelete() {
    const id = document.getElementById('delete-account-id').value;
    accounts = accounts.filter(a => a.id !== id);
    apiDeleteAccount(id);
    saveData();
    renderAll();
    closeModal('modal-delete');
    showToast('Đã xóa tài khoản!', 'info');
}

// ===== UTILITIES =====
function togglePassword(inputId, btn) {
    const inp = document.getElementById(inputId);
    inp.type = inp.type === 'password' ? 'text' : 'password';
}

function copyText(text) {
    navigator.clipboard.writeText(text).then(() => showToast('Đã sao chép!', 'success'))
        .catch(() => showToast('Không thể sao chép', 'error'));
}

function handleGlobalSearch() {
    searchQuery = document.getElementById('global-search').value;
    renderCards();
}

function handleSort() {
    renderCards();
}

function handleServiceFilter() {
    serviceFilter = (document.getElementById('service-filter-select') || {}).value || 'all';
    renderCards();
}

function setFilter(f) {
    currentFilter = f;
    document.querySelectorAll('.tab-btn').forEach(t => {
        t.classList.toggle('active', t.dataset.filter === f);
    });
    renderCards();
}

// ===== NOTIFICATIONS =====
function updateNotifications(warningCount, expiredCount) {
    const badge = document.getElementById('bell-badge');
    const countText = document.getElementById('notification-count-text');
    const list = document.getElementById('notification-list');

    // Count Discord renewals due within 5 days
    const discordSoon = accounts.filter(a => {
        if ((a.service || 'netflix') !== 'discord') return false;
        const next = getNextRenewalDate(a);
        if (!next) return false;
        return Math.ceil((next - new Date()) / (1000 * 60 * 60 * 24)) <= 5;
    });

    const total = warningCount + expiredCount + discordSoon.length;

    if (total === 0) {
        badge.style.display = 'none';
        countText.textContent = '0 cảnh báo';
        list.innerHTML = '<div class="notification-empty">Không có thông báo</div>';
        return;
    }

    badge.style.display = 'flex';
    badge.textContent = total;
    countText.textContent = `${total} cảnh báo`;

    const items = [];

    // Expired accounts
    accounts.filter(a => getAccountStatus(a).status === 'expired').forEach(a => {
        items.push(`
            <div class="notification-item notif-expired" onclick="openDetailModal('${a.id}');toggleNotificationPanel(event)">
                <div class="notif-icon notif-icon-expired">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                </div>
                <div class="notif-body">
                    <div class="notif-title">Đã Hết Hạn</div>
                    <div class="notif-sub">${escHtml(a.customerName)} — ${escHtml(a.email)}</div>
                </div>
            </div>`);
    });

    // Warning accounts (expiring within 7 days)
    accounts.filter(a => getAccountStatus(a).status === 'warning').forEach(a => {
        const st = getAccountStatus(a);
        items.push(`
            <div class="notification-item notif-warning" onclick="openDetailModal('${a.id}');toggleNotificationPanel(event)">
                <div class="notif-icon notif-icon-warning">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                </div>
                <div class="notif-body">
                    <div class="notif-title">Còn ${st.days} ngày</div>
                    <div class="notif-sub">${escHtml(a.customerName)} — ${escHtml(a.email)}</div>
                </div>
            </div>`);
    });

    // Discord Nitro renewal alerts
    discordSoon.forEach(a => {
        const next = getNextRenewalDate(a);
        const days = Math.ceil((next - new Date()) / (1000 * 60 * 60 * 24));
        const gmail = a.discordPaymentGmail ? ` (→ ${a.discordPaymentGmail})` : '';
        items.push(`
            <div class="notification-item notif-discord" onclick="openDetailModal('${a.id}');toggleNotificationPanel(event)">
                <div class="notif-icon notif-icon-discord">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                </div>
                <div class="notif-body">
                    <div class="notif-title">💙 Cần Gia Hạn Discord (còn ${days} ngày)</div>
                    <div class="notif-sub">${escHtml(a.customerName)}${gmail}</div>
                </div>
            </div>`);
    });

    list.innerHTML = items.join('');
}

function toggleNotificationPanel(event) {
    event.stopPropagation();
    const panel = document.getElementById('notification-panel');
    panel.classList.toggle('show');
}

document.addEventListener('click', e => {
    const wrapper = document.getElementById('notification-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
        document.getElementById('notification-panel').classList.remove('show');
    }
});

// ===== EXPORT / IMPORT =====
function exportData() {
    if (accounts.length === 0) {
        showToast('Không có dữ liệu để xuất!', 'warning');
        return;
    }
    const payload = {
        version: '2.0',
        exportedAt: new Date().toISOString(),
        total: accounts.length,
        accounts
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `netflix-accounts-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Đã xuất ${accounts.length} tài khoản!`, 'success');
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);
            let imported = [];
            if (Array.isArray(data)) {
                imported = data;
            } else if (data.accounts && Array.isArray(data.accounts)) {
                imported = data.accounts;
            } else {
                throw new Error('Định dạng không hợp lệ');
            }
            // Merge: skip duplicates by id
            const existingIds = new Set(accounts.map(a => a.id));
            const newOnes = imported.filter(a => a.id && !existingIds.has(a.id));
            accounts = [...newOnes, ...accounts];
            saveData();
            renderAll();
            showToast(`Đã nhập ${newOnes.length} tài khoản mới!`, 'success');
        } catch (err) {
            showToast('Lỗi: File không hợp lệ!', 'error');
        }
        // Reset input so same file can be re-imported
        event.target.value = '';
    };
    reader.readAsText(file);
}

// ===== TOAST =====
function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = {
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
        warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>'
    };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${msg}</span>`;
    toast.onclick = () => removeToast(toast);
    container.appendChild(toast);
    setTimeout(() => removeToast(toast), 4000);
}

function removeToast(el) {
    if (!el || !el.parentNode) return;
    el.classList.add('toast-out');
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
}

// ===== CUSTOMER TAB LOGIC =====
function switchView(viewName) {
    document.getElementById('nav-accounts').classList.toggle('active', viewName === 'accounts');
    document.getElementById('nav-customers').classList.toggle('active', viewName === 'customers');
    document.getElementById('nav-subscriptions').classList.toggle('active', viewName === 'subscriptions');
    document.getElementById('nav-system-health').classList.toggle('active', viewName === 'system-health');
    document.getElementById('nav-audit-log').classList.toggle('active', viewName === 'audit-log');
    
    document.getElementById('view-accounts').style.display = viewName === 'accounts' ? 'block' : 'none';
    document.getElementById('view-customers').style.display = viewName === 'customers' ? 'block' : 'none';
    document.getElementById('view-subscriptions').style.display = viewName === 'subscriptions' ? 'block' : 'none';
    document.getElementById('view-system-health').style.display = viewName === 'system-health' ? 'block' : 'none';
    document.getElementById('view-audit-log').style.display = viewName === 'audit-log' ? 'block' : 'none';

    if (viewName === 'customers') {
        loadCustomers();
    } else if (viewName === 'subscriptions') {
        loadSubscriptions();
    } else if (viewName === 'system-health') {
        loadSystemHealth();
    } else if (viewName === 'audit-log') {
        loadAuditLog();
    } else {
        renderAll();
    }
}

async function loadCustomers(page = 1) {
    showLoader("Đang nạp Hồ Sơ Khách Hàng VIP...");
    try {
        const res = await fetch(`${API_BASE_URL}/dashboard/api/customers?page=${page}&limit=24`, {
            headers: { 'x-dashboard-token': API_TOKEN }
        });
        const data = await res.json();
        if (data.ok) {
            customersData = data.data;
            currentCustomerPage = data.pagination.page;
            totalCustomerPages = data.pagination.totalPages;
            renderCustomers();
            renderCustomerPagination();
        } else {
            showToast('Lỗi tải khách hàng: ' + data.error, 'error');
        }
    } catch(e) {
        showToast('Lỗi mạng khi tải khách hàng', 'error');
    }
    hideLoader();
}

function handleCustomerSearch() {
    customerSearchQuery = document.getElementById('customer-search-input').value.toLowerCase();
    renderCustomers();
}

function renderCustomers() {
    const grid = document.getElementById('customers-grid');
    const emptyState = document.getElementById('customer-empty-state');
    grid.innerHTML = '';
    
    let filtered = customersData;
    if (customerSearchQuery) {
        filtered = filtered.filter(c => 
            (c.username && c.username.toLowerCase().includes(customerSearchQuery)) ||
            (c.id && c.id.toLowerCase().includes(customerSearchQuery)) ||
            (c.tag && c.tag.toLowerCase().includes(customerSearchQuery))
        );
    }
    
    if (!filtered || filtered.length === 0) {
        emptyState.style.display = 'flex';
    } else {
        emptyState.style.display = 'none';
        filtered.forEach(c => {
            const moneyFormatter = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });
            
            const orders = c.recentOrders || [];
            let orderHtml = '';
            if (orders.length > 0) {
                const lis = orders.map(o => `
                    <div class="co-item">
                        <div class="co-service-info">
                            <span style="font-size: 16px;">${SERVICE_META[o.service || 'other']?.emoji || '📦'}</span>
                            <div style="display: flex; flex-direction: column;">
                                <span class="co-code" style="color: var(--text-primary); font-weight: 600;">${o.productName || 'Không rõ sản phẩm'}</span>
                                <span style="font-size: 10px; color: var(--text-tertiary); display: flex; gap: 4px;">
                                    <span style="font-family: monospace;">${o.orderCode}</span>
                                    <span>•</span>
                                    <span>${new Date(o.date).toLocaleDateString('vi-VN')}</span>
                                </span>
                            </div>
                        </div>
                        <div class="co-price">${moneyFormatter.format(o.amount)}</div>
                    </div>
                `).join('');

                orderHtml = `
                    <div class="customer-orders-wrapper">
                        <button class="co-btn" onclick="document.getElementById('co-list-${c.id}').classList.toggle('open')">
                            Lịch sử 5 đơn hàng gần nhất <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        </button>
                        <div class="co-list" id="co-list-${c.id}">
                            ${lis}
                        </div>
                    </div>
                `;
            }

            grid.innerHTML += `
                <div class="customer-card">
                    <div class="customer-card-header">
                         <div class="avatar-ring"><img src="${c.avatar || 'https://cdn.discordapp.com/embed/avatars/' + (parseInt(c.id || '0') % 5) + '.png'}" class="customer-avatar" alt="Avatar" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'"></div>
                         <div class="customer-info" style="flex:1; min-width:0;">
                             <div class="title" title="${c.username}">${c.username}</div>
                             <div class="sub" title="${c.tag} • ${c.id}">${c.tag} • ${c.id}</div>
                         </div>
                    </div>
                    <div class="customer-stats-grid">
                        <div class="stat-box">
                            <span class="stat-box-label">Tổng Chi Tiêu</span>
                            <span class="stat-box-val val-money">${moneyFormatter.format(c.totalSpent)}</span>
                        </div>
                        <div class="stat-box">
                            <span class="stat-box-label">Số Đơn Hàng</span>
                            <span class="stat-box-val" style="color: #fff">${c.totalOrders} đơn</span>
                        </div>
                    </div>
                    <div class="customer-footer">
                        <div class="tags-group">
                            ${c.isBlacklisted ? '<span style="color: #ef4444; font-weight: bold; font-size: 11px;">⛔ Cấm</span>' : ''}
                            ${c.warningCount > 0 ? `<span style="color: #f59e0b; font-weight: bold; font-size: 11px;">⚠️ Cảnh báo: ${c.warningCount}</span>` : ''}
                        </div>
                        <span>Cập nhật: ${new Date(c.lastSeenAt || c.firstSeenAt || Date.now()).toLocaleDateString('vi-VN')}</span>
                    </div>
                    ${orderHtml}
                </div>
            `;
        });
    }
}

function renderCustomerPagination() {
    const container = document.getElementById('customer-pagination');
    container.innerHTML = '';
    
    if (totalCustomerPages <= 1) return;
    
    const prevBtn = document.createElement('button');
    prevBtn.className = 'page-btn';
    prevBtn.innerHTML = '❮';
    prevBtn.disabled = currentCustomerPage === 1;
    prevBtn.onclick = () => loadCustomers(currentCustomerPage - 1);
    
    const info = document.createElement('div');
    info.className = 'page-info';
    info.innerHTML = `<span>${currentCustomerPage}</span> / ${totalCustomerPages}`;
    
    const nextBtn = document.createElement('button');
    nextBtn.className = 'page-btn';
    nextBtn.innerHTML = '❯';
    nextBtn.disabled = currentCustomerPage === totalCustomerPages;
    nextBtn.onclick = () => loadCustomers(currentCustomerPage + 1);
    
    container.appendChild(prevBtn);
    container.appendChild(info);
    container.appendChild(nextBtn);
}

// ===== AUTO UPDATE COUNTDOWN =====
setInterval(() => { renderAll(); }, 60000);

// ===== KEYBOARD =====
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        ['modal-account','modal-renew','modal-history','modal-delete','modal-detail'].forEach(id => closeModal(id));
    }
});

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
    const isLoggedIn = initPasswordGate();
    if (isLoggedIn) {
        await loadData();
        renderAll();
    }
});

// ═══════════════ SUBSCRIPTIONS TAB ═══════════════

let subsData = [];
let subFilter = 'all';

const SUB_SERVICE_META = {
    netflix: { emoji: '🎬', label: 'Netflix', color: '#E50914' },
    nitro: { emoji: '🚀', label: 'Discord Nitro', color: '#5865F2' },
    spotify_family: { emoji: '🎵', label: 'Spotify Family', color: '#1DB954' },
    youtube: { emoji: '📺', label: 'YouTube Premium', color: '#FF0000' },
};

const SUB_MODE_LABEL = {
    auto_cycle: '🔄 Định kỳ',
    one_time: '🔂 Mua lẻ',
    full_paid: '✅ Trả hết',
};

async function loadSubscriptions() {
    showLoader('Đang tải Subscriptions...');
    try {
        const [subRes, statsRes] = await Promise.all([
            fetch(`${API_BASE_URL}/dashboard/api/subscriptions`, { headers: { 'x-dashboard-token': API_TOKEN } }),
            fetch(`${API_BASE_URL}/dashboard/api/subscriptions/stats`, { headers: { 'x-dashboard-token': API_TOKEN } }),
        ]);
        const subJson = await subRes.json();
        const statsJson = await statsRes.json();
        if (subJson.ok) subsData = subJson.subscriptions;
        if (statsJson.ok) {
            const s = statsJson.stats;
            document.getElementById('sub-stat-active').textContent = s.totalActive;
            document.getElementById('sub-stat-expired').textContent = s.totalExpired;
            document.getElementById('sub-stat-due').textContent = s.dueIn7Days;
            document.getElementById('sub-stat-total').textContent = s.totalActive + s.totalExpired;
        }
        renderSubscriptions();
    } catch (e) {
        showToast('Lỗi tải subscriptions: ' + e.message, 'error');
    }
    hideLoader();
}

function setSubFilter(f) {
    subFilter = f;
    document.querySelectorAll('[data-sub-filter]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.subFilter === f);
    });
    renderSubscriptions();
}

function renderSubscriptions() {
    const tbody = document.getElementById('sub-tbody');
    const emptyEl = document.getElementById('sub-empty');
    if (!tbody) return;

    let filtered = subsData;
    if (subFilter !== 'all') {
        filtered = subsData.filter(s => s.serviceType === subFilter);
    }

    // Update tab counts
    const tabAll = document.getElementById('sub-tab-all');
    if (tabAll) tabAll.textContent = subsData.length;
    ['netflix', 'nitro', 'spotify_family', 'youtube'].forEach(t => {
        const el = document.getElementById('sub-tab-' + t);
        if (el) el.textContent = subsData.filter(s => s.serviceType === t).length;
    });

    if (!filtered.length) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    tbody.innerHTML = filtered.map(s => {
        const meta = SUB_SERVICE_META[s.serviceType] || { emoji: '📦', label: s.serviceType, color: '#888' };
        const mode = SUB_MODE_LABEL[s.renewalMode] || s.renewalMode;
        const isExpired = s.status === 'EXPIRED';
        const nextDate = s.nextRenewalAt ? new Date(s.nextRenewalAt) : null;
        const expiryDate = s.expiryAt ? new Date(s.expiryAt) : null;
        const now = new Date();

        let statusClass = 'sub-status-active';
        let statusLabel = '✅ Active';
        if (isExpired) {
            statusClass = 'sub-status-expired';
            statusLabel = '❌ Hết hạn';
        } else if (nextDate && nextDate <= new Date(now.getTime() + 7 * 86400000)) {
            statusClass = 'sub-status-warning';
            statusLabel = '⚠️ Sắp gia hạn';
        } else if (expiryDate && expiryDate <= new Date(now.getTime() + 7 * 86400000)) {
            statusClass = 'sub-status-warning';
            statusLabel = '⚠️ Sắp hết hạn';
        }

        const customer = s.customerName || (s.customerId ? `<${s.customerId}>` : '—');
        const fmtDate = (d) => d ? new Date(d).toLocaleDateString('vi-VN') : '—';
        const spotifyExtra = s.spotifyFamilyName ? ` 🏠${s.spotifyFamilyName}` : '';
        const noteText = s.note ? escHtml(s.note) + spotifyExtra : spotifyExtra || '—';

        return `<tr class="${statusClass}">
            <td><strong>${s.id}</strong></td>
            <td><span class="sub-type-badge" style="--svc-color:${meta.color}">${meta.emoji} ${meta.label}</span></td>
            <td class="sub-email-cell">
                <span class="sub-email-text">${escHtml(s.gmail)}</span>
                <button class="sub-copy-btn" onclick="copyText('${escHtml(s.gmail)}')">📋</button>
            </td>
            <td class="sub-pw-cell">
                <span class="sub-pw-hidden" id="pw-${s.id}">••••••</span>
                <button class="sub-copy-btn" onclick="this.previousElementSibling.textContent=this.previousElementSibling.textContent==='••••••'?'${escHtml(s.password)}':'••••••'">
                    👁️
                </button>
                <button class="sub-copy-btn" onclick="copyText('${escHtml(s.password)}')">📋</button>
            </td>
            <td>${escHtml(customer)}</td>
            <td>${mode}</td>
            <td>${fmtDate(s.nextRenewalAt)}</td>
            <td>${fmtDate(s.expiryAt)}</td>
            <td class="sub-note-cell">${noteText}</td>
            <td><span class="sub-status-chip ${statusClass}">${statusLabel}</span></td>
        </tr>`;
    }).join('');
}

// ═══════════════ WEBSOCKET REALTIME ═══════════════

let ws = null;
let wsReconnectTimer = null;

function connectWebSocket() {
    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${location.host}/ws/dashboard`;

    try {
        ws = new WebSocket(wsUrl);
    } catch (e) {
        console.warn('WebSocket not available:', e);
        return;
    }

    ws.onopen = () => {
        console.log('[WS] Connected');
        const indicator = document.getElementById('live-indicator');
        if (indicator) {
            indicator.classList.add('connected');
            indicator.querySelector('.live-text').textContent = 'Live';
        }
        // Clear reconnect timer
        if (wsReconnectTimer) {
            clearTimeout(wsReconnectTimer);
            wsReconnectTimer = null;
        }
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            console.log('[WS] Event:', msg.type);
            if (['order_update', 'account_update', 'subscription_update', 'data_refresh'].includes(msg.type)) {
                // Auto-refresh data
                loadData().then(() => renderAll());
                showToast(`⚡ ${msg.message || 'Dữ liệu đã được cập nhật realtime!'}`, 'info');
            }
        } catch (e) {
            console.warn('[WS] Parse error:', e);
        }
    };

    ws.onclose = () => {
        console.log('[WS] Disconnected, reconnecting in 5s...');
        const indicator = document.getElementById('live-indicator');
        if (indicator) {
            indicator.classList.remove('connected');
            indicator.querySelector('.live-text').textContent = 'Offline';
        }
        // Auto reconnect
        wsReconnectTimer = setTimeout(connectWebSocket, 5000);
    };

    ws.onerror = (err) => {
        console.warn('[WS] Error:', err);
        ws.close();
    };
}

// Connect WebSocket after auth
const origInitPasswordGate = initPasswordGate;
// Override: connect WS after successful login
const origDOMContentLoaded = null;
document.addEventListener('DOMContentLoaded', () => {
    // Start WS after a short delay
    setTimeout(connectWebSocket, 2000);
});

// ═══════════════ SYSTEM HEALTH & AUDIT LOGS ═══════════════

async function loadSystemHealth() {
    showLoader('Đang tải trạng thái hệ thống...');
    try {
        const res = await fetch(`${API_BASE_URL}/dashboard/api/system-health`, {
            headers: { 'x-dashboard-token': API_TOKEN }
        });
        const json = await res.json();
        if (json.ok) {
            const data = json.data;
            
            // Format uptime
            const uptimeSecs = Math.floor(data.uptime);
            const hrs = Math.floor(uptimeSecs / 3600);
            const mins = Math.floor((uptimeSecs % 3600) / 60);
            const secs = uptimeSecs % 60;
            const uptimeStr = `${hrs} giờ ${mins} phút ${secs} giây`;

            document.getElementById('health-bot-status-pill').textContent = data.botStatus;
            document.getElementById('health-bot-status-pill').className = `status-pill pill-${data.botStatus === 'READY' ? 'active' : 'warning'}`;
            document.getElementById('health-bot-uptime').textContent = uptimeStr;
            document.getElementById('health-bot-ping').textContent = `${data.botPing} ms`;
            document.getElementById('health-bot-platform').textContent = data.platform;

            document.getElementById('health-node-version').textContent = data.node;
            document.getElementById('health-mem-rss').textContent = `${data.memory.rss} MB`;
            document.getElementById('health-mem-heap').textContent = `${data.memory.heapUsed} MB / ${data.memory.heapTotal} MB`;

            document.getElementById('health-db-size').textContent = `${data.database.sizeMB} MB`;
        } else {
            showToast('Lỗi tải trạng thái: ' + json.error, 'error');
        }
    } catch (e) {
        showToast('Lỗi mạng khi tải trạng thái hệ thống', 'error');
    }
    hideLoader();
}

let auditLogData = [];
let currentAuditPage = 1;
let totalAuditPages = 1;

async function loadAuditLog(page = 1) {
    showLoader('Đang tải nhật ký hoạt động...');
    try {
        const res = await fetch(`${API_BASE_URL}/dashboard/api/audit-log?page=${page}&limit=20`, {
            headers: { 'x-dashboard-token': API_TOKEN }
        });
        const json = await res.json();
        if (json.ok) {
            auditLogData = json.data;
            currentAuditPage = json.pagination.page;
            totalAuditPages = json.pagination.totalPages;
            renderAuditLog();
            renderAuditPagination();
        } else {
            showToast('Lỗi tải nhật ký: ' + json.error, 'error');
        }
    } catch (e) {
        showToast('Lỗi mạng khi tải nhật ký hoạt động', 'error');
    }
    hideLoader();
}

function renderAuditLog() {
    const tbody = document.getElementById('audit-tbody');
    const emptyEl = document.getElementById('audit-empty');
    if (!tbody) return;

    if (!auditLogData || auditLogData.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'block';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    tbody.innerHTML = auditLogData.map(log => {
        return `<tr>
            <td><strong>${formatDateTime(log.created_at)}</strong></td>
            <td><span class="sub-type-badge" style="--svc-color: #a855f7; font-family: monospace;">${escHtml(log.actor_id || 'System')}</span></td>
            <td><span class="status-pill pill-active" style="font-size: 11px; font-weight: bold; background: rgba(99, 102, 241, 0.1); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.2);">${escHtml(log.action)}</span></td>
            <td style="max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escHtml(log.detail || '')}">${escHtml(log.detail || '—')}</td>
            <td><span style="font-family: monospace; color: var(--text-secondary);">${escHtml(log.related_order_code || '—')}</span></td>
        </tr>`;
    }).join('');
}

function renderAuditPagination() {
    const container = document.getElementById('audit-pagination');
    if (!container) return;
    container.innerHTML = '';
    
    if (totalAuditPages <= 1) return;
    
    const prevBtn = document.createElement('button');
    prevBtn.className = 'page-btn';
    prevBtn.innerHTML = '❮';
    prevBtn.disabled = currentAuditPage === 1;
    prevBtn.onclick = () => loadAuditLog(currentAuditPage - 1);
    
    const info = document.createElement('div');
    info.className = 'page-info';
    info.innerHTML = `<span>${currentAuditPage}</span> / ${totalAuditPages}`;
    
    const nextBtn = document.createElement('button');
    nextBtn.className = 'page-btn';
    nextBtn.innerHTML = '❯';
    nextBtn.disabled = currentAuditPage === totalAuditPages;
    nextBtn.onclick = () => loadAuditLog(currentAuditPage + 1);
    
    container.appendChild(prevBtn);
    container.appendChild(info);
    container.appendChild(nextBtn);
}

