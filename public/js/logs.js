/* ===================================================================
   logs.js — Live Logs view with filter, search, expandable metadata
   Exports: appendLog(logObject), initLogs(initialLogs)
   =================================================================== */

const MAX_LOG_LINES = 500;

let _logEntries = [];           // all entries (for re-filtering)
let _pendingEntries = [];       // buffered before logs:init
let _initialized = false;       // true once logs:init received
let _activeFilter = '';         // '' = all, or a level name
let _searchQuery = '';

// ---- DOM refs -------------------------------------------------------
const logListEl = document.getElementById('log-list');
const filterBtns = document.querySelectorAll('.log-filter-btn');
const searchInput = document.getElementById('log-search');
const autoScrollChk = document.getElementById('log-autoscroll');
const clearBtn = document.getElementById('log-clear');

// ---- Initialisation (called from app.js via socket 'logs:init') -----
function initLogs(initialLogs) {
  _logEntries = [];
  logListEl.innerHTML = '';
  if (initialLogs && initialLogs.length) {
    initialLogs.forEach((entry) => _logEntries.push(entry));
  }
  // Drain any entries that arrived before logs:init
  if (_pendingEntries.length > 0) {
    _pendingEntries.forEach((entry) => _logEntries.push(entry));
    _pendingEntries = [];
  }
  _initialized = true;
  renderAll();
  scrollToBottom();
}

// ---- Append a new entry (called from app.js via socket 'log:new') ---
function appendLog(logObject) {
  // Buffer entries that arrive before logs:init to avoid losing them
  if (!_initialized) {
    _pendingEntries.push(logObject);
    return;
  }

  _logEntries.push(logObject);

  // Trim old entries if over limit
  if (_logEntries.length > MAX_LOG_LINES) {
    _logEntries.splice(0, _logEntries.length - MAX_LOG_LINES);
  }

  // Only append DOM node if it passes the current filter
  if (passesFilter(logObject)) {
    const el = buildLogLine(logObject);
    logListEl.insertBefore(el, logListEl.firstChild);

    // Remove excess DOM nodes
    while (logListEl.children.length > MAX_LOG_LINES) {
      logListEl.removeChild(logListEl.lastChild);
    }

    if (autoScrollChk && autoScrollChk.checked) {
      scrollToBottom();
    }
  }
}

// ---- Render all entries (after filter/search change) ----------------
function renderAll() {
  logListEl.innerHTML = '';
  const matching = _logEntries.filter(passesFilter);
  // Display newest first
  for (let i = matching.length - 1; i >= 0; i--) {
    logListEl.appendChild(buildLogLine(matching[i]));
  }
  if (autoScrollChk && autoScrollChk.checked) {
    scrollToBottom();
  }
}

// ---- Filter check ---------------------------------------------------
function passesFilter(entry) {
  if (_activeFilter && entry.level !== _activeFilter) return false;
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    const msg = (entry.message || '').toLowerCase();
    const meta = entry.metadata ? JSON.stringify(entry.metadata).toLowerCase() : '';
    if (!msg.includes(q) && !meta.includes(q)) return false;
  }
  return true;
}

// ---- Build a single log line DOM element ----------------------------
function buildLogLine(entry) {
  const line = document.createElement('div');
  line.className = 'log-line';
  line.dataset.logLevel = entry.level || 'info';

  // Level badge
  const badge = document.createElement('span');
  badge.className = 'log-badge ' + (entry.level || 'info');
  badge.textContent = (entry.level || 'info').toUpperCase();
  line.appendChild(badge);

  // Timestamp
  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = formatTime(entry.timestamp);
  line.appendChild(time);

  // Message
  const msg = document.createElement('span');
  msg.className = 'log-msg';
  msg.textContent = entry.message || '';
  line.appendChild(msg);

  // Expandable metadata
  if (entry.metadata) {
    const dot = document.createElement('span');
    dot.className = 'log-meta-toggle';
    dot.textContent = ' [metadata]';
    dot.addEventListener('click', () => {
      const jsonBlock = line.querySelector('.log-meta-json');
      if (jsonBlock) {
        jsonBlock.classList.toggle('open');
        dot.textContent = jsonBlock.classList.contains('open') ? ' [hide]' : ' [metadata]';
      }
    });
    line.appendChild(dot);

    const jsonBlock = document.createElement('div');
    jsonBlock.className = 'log-meta-json';
    try {
      jsonBlock.textContent = typeof entry.metadata === 'string'
        ? entry.metadata
        : JSON.stringify(entry.metadata, null, 2);
    } catch {
      jsonBlock.textContent = String(entry.metadata);
    }
    line.appendChild(jsonBlock);
  }

  return line;
}

// ---- Scroll to bottom (newest-first = top, but keeps latest visible) -
function scrollToBottom() {
  logListEl.scrollTop = 0;
}

// ---- Format timestamp to HH:MM:SS -----------------------------------
function formatTime(ts) {
  if (!ts) return '--:--:--';
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' +
         String(d.getMinutes()).padStart(2, '0') + ':' +
         String(d.getSeconds()).padStart(2, '0');
}

// ---- Filter button clicks -------------------------------------------
filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    filterBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    _activeFilter = btn.dataset.level || '';
    renderAll();
  });
});

// ---- Search input ---------------------------------------------------
if (searchInput) {
  searchInput.addEventListener('input', () => {
    _searchQuery = searchInput.value.trim();
    renderAll();
  });
}

// ---- Clear button ---------------------------------------------------
if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    _logEntries = [];
    logListEl.innerHTML = '';
  });
}

// Expose for app.js
window.renderAllLogs = renderAll;
