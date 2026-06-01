# Phase 2 — Config & Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose rate limit and conversation timeout settings in the dashboard UI, and add browser notifications for pending handoffs.

**Architecture:** (A) Add `rateLimit` and `conversationTimeout` controls to the Settings view in `index.html` + wire them in `config-editor.js` — the server-side config already supports these keys. (B) Add a 5-line browser Notification API call when handoff list updates show a new pending request.

**Tech Stack:** Vanilla JS, HTML forms, Notification API

---

### Task A1: Add rateLimit + conversationTimeout UI controls to Settings view

**Files:**
- Modify: `waha-bot/public/index.html` (Settings view, after the keep-session checkbox)
- Modify: `waha-bot/public/js/config-editor.js` (populateForm + save handler)

- [ ] **Step 1: Add 4 new form controls to index.html inside the Bot Configuration glass**

Find the "Keep Login Session" checkbox and force-logout section (lines 1313-1321). After that, before the Save button row (line 1322), add the new fields:

```html
              <div style="margin:16px 0 8px;border-top:1px solid var(--glass-border);padding-top:14px;">
                <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em;">Rate Limiting</div>
                <div class="form-group">
                  <label for="cfg-rate-limit">Max Messages Per Minute (per phone)</label>
                  <input type="number" id="cfg-rate-limit" min="1" max="200" placeholder="20" />
                </div>
              </div>

              <div style="margin:16px 0 8px;border-top:1px solid var(--glass-border);padding-top:14px;">
                <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em;">Conversation Timeout</div>
                <div class="form-check">
                  <input type="checkbox" id="cfg-timeout-enabled" checked />
                  <label for="cfg-timeout-enabled">Auto-reset stale handoffs</label>
                </div>
                <div class="form-group">
                  <label for="cfg-timeout-hours">Hours of inactivity before auto-reset</label>
                  <input type="number" id="cfg-timeout-hours" min="1" max="720" placeholder="24" />
                  <div class="hint">After this many hours with no messages, a handoff conversation returns to bot mode.</div>
                </div>
              </div>
```

- [ ] **Step 2: Wire populateForm() in config-editor.js to read the new fields**

Add these lines to the `populateForm()` function (after `$('#cfg-keep-session').checked`):

```js
// Rate limiting
const rl = cfg.rateLimit || {};
$('#cfg-rate-limit').value     = rl.maxPerMinute ?? 20;

// Conversation timeout
const ct = cfg.conversationTimeout || {};
$('#cfg-timeout-enabled').checked = ct.enabled !== false;
$('#cfg-timeout-hours').value     = ct.hours ?? 24;
```

- [ ] **Step 3: Wire the Save button to include the new fields**

Update the `config:save` emit in the save click handler. Replace the current object:

```js
socket.emit('config:save', {
  botName:      $('#cfg-bot-name').value,
  defaultReply: $('#cfg-default-reply').value,
  active:       $('#cfg-active').checked,
  keepSession:  $('#cfg-keep-session').checked,
});
```

With:

```js
socket.emit('config:save', {
  botName:      $('#cfg-bot-name').value,
  defaultReply: $('#cfg-default-reply').value,
  active:       $('#cfg-active').checked,
  keepSession:  $('#cfg-keep-session').checked,
  rateLimit: {
    maxPerMinute: parseInt($('#cfg-rate-limit').value, 10) || 20,
  },
  conversationTimeout: {
    enabled: $('#cfg-timeout-enabled').checked,
    hours: parseInt($('#cfg-timeout-hours').value, 10) || 24,
  },
});
```

- [ ] **Step 4: Verify the Settings view loads without console errors**

Start the server: `cd waha-bot && node server/index.js`
Open `http://localhost:3000` → navigate to **Settings**.
Expected: the new Rate Limit and Conversation Timeout sections appear with correct default values (20, enabled, 24h).

---

### Task A2: Verify config:save server-side handles new fields

**Files:**
- Read-only review: `waha-bot/server/index.js` (lines 66-91 config:save handler)

The existing `config:save` handler already:
1. Sanitises string values (null byte removal)
2. Filters unknown keys against `DEFAULT_BOT_CONFIG`
3. Deep-merges `aiSettings` nested object

`rateLimit` and `conversationTimeout` are both top-level keys in `DEFAULT_BOT_CONFIG` (lines 68-73 of config.js), so they pass the allowed-key filter. The sanitise function handles the nested object recursively. The `config.save()` method deep-merges (lines 117-128 of config.js).

**No code changes needed** — verify by checking that `DEFAULT_BOT_CONFIG` includes these keys. It does (config.js lines 68-73).

- [ ] **Step 1: Read-only verification — confirm server already accepts rateLimit and conversationTimeout**

The config.js `DEFAULT_BOT_CONFIG` (lines 68-73):
```js
rateLimit: { maxPerMinute: 20 },
conversationTimeout: { enabled: true, hours: 24 },
```

The server's `config:save` handler allows these keys. The deep-merge preserves nested fields. **No changes needed.**

---

### Task B1: Add browser notifications for handoff events

**Files:**
- Modify: `waha-bot/public/js/app.js` (socket 'handoff:list' handler)

- [ ] **Step 1: Request notification permission on page load**

At the end of the `socket.on('handoff:list', ...)` handler, add code that requests Notification permission and fires a notification when a new handoff appears.

Find the current `handoff:list` handler (lines 208-232 in app.js). Add this at the end of the handler, right after the re-render block:

```js
  // ── Browser notification for new handoffs ──────────────────────────
  // Only notify if there are pending requests AND we weren't already showing
  // this count (prevents spam on reconnect / initial load)
  if (pending.length > 0 && 'Notification' in window && Notification.permission === 'granted') {
    const prevCount = window._prevHandoffCount || 0;
    if (pending.length > prevCount) {
      const newest = pending[pending.length - 1];
      new Notification('WahaBot — Handoff Needed', {
        body: (newest.display_name || newest.phone || 'Someone') + ' needs human assistance',
        icon: '/favicon.ico',
        tag: 'waha-handoff',
      });
    }
  }
  window._prevHandoffCount = pending.length;
```

- [ ] **Step 2: Add a "enable notifications" button + permission request**

In `app.js`, add a function that requests notification permission. Add it near the bottom of the file (before the final `socket.connected` check):

```js
// ---- Browser notification permission request ---------------------------
(function initNotifications() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') return;
  if (Notification.permission === 'denied') return;

  // Add a small bell icon button to the status bar
  const actions = document.querySelector('.statusbar-actions');
  if (!actions) return;

  const btn = document.createElement('button');
  btn.className = 'header-btn';
  btn.title = 'Enable desktop notifications for handoffs';
  btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.8;"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
  btn.addEventListener('click', () => {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') {
        btn.style.display = 'none';
        // Test notification
        new Notification('WahaBot', { body: 'Notifications enabled!' });
      }
    });
  });
  actions.insertBefore(btn, actions.firstChild);
})();
```

- [ ] **Step 3: Verify the feature works**

Start the server, open the dashboard. Expected:
1. A bell icon appears in the top-right status bar
2. Clicking it triggers the browser's notification permission prompt
3. After granting, pending handoffs (or any new handoff) trigger a desktop notification
4. The notification shows the contact name/phone and "needs human assistance"

- [ ] **Step 4: Handle the case where favicon.ico doesn't exist**

The `new Notification()` call references `/favicon.ico`. If this file doesn't exist, the notification still works — it just shows a generic icon. Optionally create a simple SVG favicon at `waha-bot/public/favicon.ico` or remove the icon property:

Remove `icon: '/favicon.ico'` from the notification options if no favicon exists. Keep it simple — no favicon needed for this feature to work.

---

### Task B2: Sanity check — end-to-end verification

**Files:** All modified files

- [ ] **Step 1: Load dashboard and check Settings**

Open `http://localhost:3000` → Settings. Verify:
- Rate Limit field shows "20"
- Conversation Timeout shows enabled (checked) with 24 hours
- Changing values and clicking Save persists (verify by refreshing — values stick)

- [ ] **Step 2: Check notification bell**

- Bell icon visible in status bar
- Click prompts browser permission dialog
- After granting, test notification fires

- [ ] **Step 3: Verify handoff notification logic**

Simulate a pending handoff by directly inserting into `conversation_state`:

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/waha.db');
db.prepare(\`
  INSERT INTO conversation_state (phone, bot_mode, human_intervention_requested, updated_at, display_name, unread_count)
  VALUES ('test-handoff-phone', 0, 1, ?, 'Test User', 0)
  ON CONFLICT(phone) DO UPDATE SET human_intervention_requested = 1, bot_mode = 0, display_name = 'Test User'
\`).run(Date.now());
console.log('Handoff test row inserted');
"
```

Then restart the server and check the dashboard. Expected:
- Handoffs tab shows a badge
- Desktop notification fires (if permission was granted)
