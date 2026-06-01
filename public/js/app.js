/* ===================================================================
   app.js — Main client controller
   =================================================================== */

// ---- 1. Socket.IO connection ----------------------------------------
const socket = io('/', {
  transports: ['websocket', 'polling'],
  auth: { token: window.__authToken || null },
});

// ---- Helpers --------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---- State -----------------------------------------------------------
let _connected = true;
let _handoffCount = 0;
let _prevHandoffCount = -1;

// ---- 2. Navigation ---------------------------------------------------
const views = $$('.view');
const navItems = $$('.nav-item');
const tabItems = $$('.tab-item');
const viewTitle = $('#view-title');

const NAV_TITLES = {
  dashboard: 'Dashboard',
  conversations: 'Conversations',
  config: 'Bot Configuration',
  ai: 'AI Settings',
  knowledge: 'Knowledge Base',
  handoffs: 'Human Handoffs',
  logs: 'Live Logs',
};

function navigateTo(target) {
  // Update sidebar nav
  navItems.forEach((b) => b.classList.remove('active'));
  const navBtn = document.querySelector(`.nav-item[data-view="${target}"]`);
  if (navBtn) navBtn.classList.add('active');

  // Update tab bar
  tabItems.forEach((b) => b.classList.remove('active'));
  const tabBtn = document.querySelector(`.tab-item[data-view="${target}"]`);
  if (tabBtn) tabBtn.classList.add('active');

  // Update views
  views.forEach((v) => v.classList.remove('active'));
  const el = document.getElementById('view-' + target);
  if (el) el.classList.add('active');

  viewTitle.textContent = NAV_TITLES[target] || target;

  // Lazy-render: populate form fields when navigating to config views
  if (target === 'config' || target === 'ai') {
    if (window.currentConfig && typeof setBotConfig === 'function') {
      setBotConfig(window.currentConfig);
    }
  }

  // Lazy: re-render logs when navigating to logs
  if (target === 'logs' && typeof renderAllLogs === 'function') {
    renderAllLogs();
  }

  // Lazy: re-render handoffs
  if (target === 'handoffs' && typeof renderHandoffs === 'function') {
    renderHandoffs();
  }
}

// Sidebar click
navItems.forEach((btn) => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.view));
});

// Tab bar click
tabItems.forEach((btn) => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.view));
});

// ---- 2b. Theme toggle -------------------------------------------------
(function initTheme() {
  const toggle = $('#theme-toggle');
  if (!toggle) return;

  // Load saved theme or default to dark
  const saved = localStorage.getItem('waha-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  // Theme toggle SVG — sun (light) ↔ moon (dark)
  const sunSvg = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  const moonSvg = '<svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  toggle.innerHTML = saved === 'dark' ? sunSvg : moonSvg;

  toggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('waha-theme', next);
    toggle.innerHTML = next === 'dark' ? sunSvg : moonSvg;
  });
})();

// ---- 3. Socket event handlers ----------------------------------------

// 3a. QR code
socket.on('wa:qr', (dataUrl) => {
  const existing = document.getElementById('qr-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'qr-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:17px;font-weight:700;margin-bottom:4px;color:var(--text-primary);';
  title.textContent = 'Scan to connect WhatsApp';

  const sub = document.createElement('div');
  sub.style.cssText = 'font-size:13px;color:var(--text-secondary);margin-bottom:20px;';
  sub.textContent = 'Open WhatsApp > Linked Devices > Link a Device';

  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = 'QR Code';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText =
    'position:absolute;top:12px;right:16px;background:none;border:none;font-size:28px;color:#fff;cursor:pointer;opacity:.6;';
  closeBtn.addEventListener('click', () => overlay.remove());

  modal.appendChild(title);
  modal.appendChild(sub);
  modal.appendChild(img);
  overlay.appendChild(modal);
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);
});

// 3b. WA status
socket.on('wa:status', (s) => {
  const dot = $('#wa-dot');
  const label = $('#wa-label');
  if (dot) dot.className = 'status-dot ' + (s.connected ? 'on' : 'off');
  if (label) label.textContent = 'WhatsApp — ' + (s.connected ? 'Connected' : 'Disconnected');

  if (s.connected) {
    const overlay = document.getElementById('qr-modal-overlay');
    if (overlay) overlay.remove();
  }
});

// 3c. AI status
socket.on('ai:status', (s) => {
  if (typeof setRouterStatus === 'function') setRouterStatus(s.connected);
});

// 3d. Config updated
socket.on('config:updated', (cfg) => {
  window.currentConfig = cfg;

  const toggle = $('#bot-toggle');
  const toggleLabel = $('#bot-toggle-label');
  if (toggle && toggleLabel) {
    const active = cfg.active !== false;
    toggle.classList.toggle('on', active);
    toggleLabel.textContent = active ? 'Active' : 'Paused';
  }

  const configViewActive = document.getElementById('view-config')?.classList.contains('active');
  if (typeof setBotConfig === 'function') {
    if (configViewActive) {
      setBotConfig(cfg);
    } else {
      if (typeof window.__updateCfg === 'function') window.__updateCfg(cfg);
    }
  }
});

// 3e. Analytics update
socket.on('analytics:update', (data) => {
  window.analyticsData = data;
  const dashActive = document.getElementById('view-dashboard')?.classList.contains('active');
  if (dashActive && typeof renderDashboard === 'function') {
    renderDashboard(data);
  }
});

// 3f. Log events
socket.on('logs:init', (logs) => {
  if (typeof initLogs === 'function') initLogs(logs);
});

socket.on('log:new', (entry) => {
  if (typeof appendLog === 'function') appendLog(entry);
});

// 3g. Knowledge base stats — dashboard tile only (KB view self-renders)
socket.on('kb:stats', (stats) => {
  const entries = stats?.entries ?? 0;
  const dashEl = $('#dash-kb-chunks');
  if (dashEl) dashEl.textContent = entries ? entries + ' entries' : '—';
});

// 3h. Handoff list updates
socket.on('handoff:list', (list) => {
  window._handoffList = list;
  // Update badge counts
  const pending = (list || []).filter((h) => h.human_intervention_requested === 1);
  _handoffCount = pending.length;

  const navBadge = $('#handoff-nav-badge');
  const tabBadge = $('#handoff-tab-badge');
  const visible = _handoffCount > 0;
  if (navBadge) { navBadge.textContent = _handoffCount; navBadge.style.display = visible ? '' : 'none'; }
  if (tabBadge) { tabBadge.textContent = _handoffCount; tabBadge.style.display = visible ? '' : 'none'; }

  // Update header count
  const headerCount = $('#handoff-header-count');
  if (headerCount) {
    const total = (list || []).length;
    headerCount.textContent = pending.length + ' pending / ' + total + ' total';
  }

  // Re-render if view is active
  const handoffsActive = document.getElementById('view-handoffs')?.classList.contains('active');
  if (handoffsActive && typeof renderHandoffs === 'function') {
    renderHandoffs();
  }

  // ── Browser notification for new handoffs ──────────────────────────
  // Only fire when count increases relative to last known value.
  // _prevHandoffCount starts at -1 so the first emission (initial load or
  // reconnect) never triggers a notification.
  if (pending.length > 0 && 'Notification' in window && Notification.permission === 'granted') {
    if (_prevHandoffCount >= 0 && pending.length > _prevHandoffCount) {
      const newest = pending[0];
      new Notification('Sorc — Handoff Needed', {
        body: (newest.display_name || newest.phone || 'Someone') + ' needs human assistance',
        tag: 'waha-handoff',
      });
    }
  }
  _prevHandoffCount = pending.length;
});

// ---- 4. On connect: request initial state ---------------------------
socket.on('connect', () => {
  _connected = true;
  hideReconnectingBanner();
  socket.emit('config:get');
});

// ---- 5. Bot active toggle -------------------------------------------
(function initBotToggle() {
  const toggle = $('#bot-toggle');
  const toggleLabel = $('#bot-toggle-label');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const isOn = toggle.classList.toggle('on');
    toggleLabel.textContent = isOn ? 'Active' : 'Paused';
    socket.emit('config:save', { active: isOn });
  });
})();

// ---- 6. Auth error & Reconnection ------------------------------------
socket.on('connect_error', (err) => {
  if (err.message === 'Unauthorized' && typeof window.__handleAuthError === 'function') {
    window.__handleAuthError();
  }
});

socket.on('disconnect', () => {
  _connected = false;
  showReconnectingBanner();
});

socket.io.on('reconnect_attempt', () => {
  const banner = $('#reconnect-banner');
  if (banner) banner.textContent = 'Reconnecting…';
});

function showReconnectingBanner() {
  let banner = $('#reconnect-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'reconnect-banner';
    document.body.prepend(banner);
  }
  banner.textContent = '⚠ Disconnected from server — retrying…';
  banner.style.display = '';
}

function hideReconnectingBanner() {
  const banner = $('#reconnect-banner');
  if (banner) banner.style.display = 'none';
}

// ---- Browser notification permission request ---------------------------
(function initNotifications() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') return;
  if (Notification.permission === 'denied') return;

  const actions = document.querySelector('.statusbar-actions');
  if (!actions) return;

  const btn = document.createElement('button');
  btn.className = 'header-btn';
  btn.title = 'Enable desktop notifications for handoffs';
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
  btn.addEventListener('click', () => {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') {
        btn.style.display = 'none';
        new Notification('Sorc', { body: 'Notifications enabled!' });
      }
    });
  });
  actions.insertBefore(btn, actions.firstChild);
})();

// ---- Request initial state on page load ------------------------------
if (socket.connected) {
  socket.emit('config:get');
}
