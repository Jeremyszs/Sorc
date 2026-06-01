# Phase 1 — Core UX (Unread Tracking + Contact Names) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unread message badges per conversation and show real contact names instead of raw phone numbers.

**Architecture:** Extend `conversation_state` SQLite table with `display_name` and `unread_count` columns. On incoming messages, resolve the sender's WhatsApp contact name and increment unread count. On conversation detail open, reset unread count to 0. The `/api/conversations` endpoint serves the enriched data; the frontend renders it (the DOM code already exists — it was never wired up).

**Tech Stack:** better-sqlite3, whatsapp-web.js (msg.getContact() for pushname), vanilla JS frontend

**Key insight:** The conversations.js frontend already has full DOM code for `displayName` and `unread` badges — it was written speculatively and never populated by the backend. This plan wires it up.

---

### Task 1: Extend conversation_state schema with display_name + unread_count

**Files:**
- Modify: `waha-bot/server/conversation-state.js:13-21`

- [ ] **Step 1: Add `_ensureColumns()` migration to conversation-state.js**

The existing `_ensureTable()` uses `CREATE TABLE IF NOT EXISTS` — that won't add columns. We need `_ensureColumns()` that checks via `PRAGMA table_info` and runs ALTER TABLE.

Add this method after `_ensureTable()`:

```js
_ensureColumns() {
  const existing = db.prepare("PRAGMA table_info('conversation_state')").all();
  const names = new Set(existing.map((c) => c.name));

  if (!names.has('display_name')) {
    db.exec("ALTER TABLE conversation_state ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('unread_count')) {
    db.exec('ALTER TABLE conversation_state ADD COLUMN unread_count INTEGER NOT NULL DEFAULT 0');
  }
}
```

Call it from the constructor after `_ensureTable()`:

```js
constructor() {
  this._ensureTable();
  this._ensureColumns();
}
```

- [ ] **Step 2: Add unread / display name methods**

Add these methods to the `ConversationState` class:

```js
/**
 * Store or update the display name for a phone number.
 * Creates a record if none exists (eg. before any bot-mode state was needed).
 */
setDisplayName(phone, name) {
  if (!name) return;
  db.prepare(`
    INSERT INTO conversation_state (phone, bot_mode, human_intervention_requested, updated_at, display_name)
    VALUES (?, 1, 0, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET display_name = ?, updated_at = ?
  `).run(phone, Date.now(), name, name, Date.now());
}

/**
 * Increment the unread count for a phone.
 */
incrementUnread(phone) {
  db.prepare(`
    INSERT INTO conversation_state (phone, bot_mode, human_intervention_requested, updated_at, unread_count)
    VALUES (?, 1, 0, ?, 1)
    ON CONFLICT(phone) DO UPDATE SET unread_count = unread_count + 1, updated_at = ?
  `).run(phone, Date.now(), Date.now());
}

/**
 * Reset unread count to 0 (called when the agent opens the conversation).
 */
markAsRead(phone) {
  db.prepare(`
    INSERT INTO conversation_state (phone, bot_mode, human_intervention_requested, updated_at, unread_count)
    VALUES (?, 1, 0, ?, 0)
    ON CONFLICT(phone) DO UPDATE SET unread_count = 0, updated_at = ?
  `).run(phone, Date.now(), Date.now());
}
```

- [ ] **Step 3: Update `getAll()` to expose the new fields**

The existing `getAll()` returns `SELECT *` — it automatically includes the new columns. No change needed.

- [ ] **Step 4: Verify no breakage**

There are no tests, so just verify the file parses:

Run: `cd waha-bot && node -e "require('./server/conversation-state')"`

Expected: no errors (the singleton initialises without a WhatsApp client dependency).

---

### Task 2: Populate contact names + unread count from incoming messages

**Files:**
- Modify: `waha-bot/server/whatsapp.js:99-119` (message handler)
- Requires: conversation-state methods from Task 1

- [ ] **Step 1: Import conversationState and add name resolution + unread increment**

At the top of `whatsapp.js`, conversationState is NOT yet imported. Add it:

```js
// Line 9, after existing requires:
const conversationState = require('./conversation-state');
```

Inside the `client.on('message', async (msg) => {` handler, after the null-guard for `msgId` and before `this._recentSentIds` check, add name resolution. We also need to increment unread AFTER the AI reply (so the unread counter doesn't get set before processing).

Actually, the best spot is after the `if (msg.fromMe && msg.body === this._lastReplyBody) return;` guard and after storing the message in the database. Let me place it right before `await BotEngine.process(msg);`.

Replace this code block (around line 109-118):

```js
logger.bot('Message received', { from: msg.from, body: msg.body, fromMe: msg.fromMe });

const id = uuidv4();
db.prepare(
  `INSERT INTO messages (id, from_number, to_number, body, timestamp, direction, is_ai_reply)
   VALUES (?, ?, ?, ?, ?, 'received', 0)`,
).run(id, msg.from, msg.to, msg.body, Date.now());
msg._dbId = id;

await BotEngine.process(msg);
```

With this:

```js
logger.bot('Message received', { from: msg.from, body: msg.body, fromMe: msg.fromMe });

const id = uuidv4();
db.prepare(
  `INSERT INTO messages (id, from_number, to_number, body, timestamp, direction, is_ai_reply)
   VALUES (?, ?, ?, ?, ?, 'received', 0)`,
).run(id, msg.from, msg.to, msg.body, Date.now());
msg._dbId = id;

// ── Resolve contact display name ─────────────────────────────────────────
const phone = msg.from?.split('@')[0];
if (phone) {
  conversationState.incrementUnread(phone);
  // Async fire-and-forget: resolve contact name from WhatsApp
  msg.getContact().then((contact) => {
    const name = contact.pushname || contact.name || contact.shortName || '';
    if (name) conversationState.setDisplayName(phone, name);
  }).catch(() => {
    // Name resolution is best-effort — silently ignore failures
  });
}

await BotEngine.process(msg);
```

- [ ] **Step 2: Verify the file parses**

Run: `cd waha-bot && node -e "require('./whatsapp')"`

Expected: no errors (the lazy require to BotEngine resolves correctly).

---

### Task 3: Update conversation API to serve display_name + unread_count

**Files:**
- Modify: `waha-bot/server/index.js:216-247` (GET /api/conversations)
- Modify: `waha-bot/server/index.js:250-277` (GET /api/conversations/:phone/messages)

- [ ] **Step 1: Update GET /api/conversations to include display_name and unread_count**

Replace the SQL query (lines 218-233) with one that joins conversation_state for display_name and unread_count:

```js
const rows = db.prepare(`
  SELECT
    m.from_number AS phone,
    m.body AS last_preview,
    m.timestamp AS last_time,
    cs.bot_mode,
    cs.human_intervention_requested,
    cs.display_name,
    cs.unread_count
  FROM (
    SELECT from_number, body, timestamp,
      ROW_NUMBER() OVER (PARTITION BY from_number ORDER BY timestamp DESC) AS rn
    FROM messages
    WHERE direction = 'received'
  ) m
  LEFT JOIN conversation_state cs ON cs.phone = m.from_number
  WHERE m.rn = 1
  ORDER BY m.timestamp DESC
`).all();
```

Update the `.map()` callback to include the new fields:

```js
const conversations = rows.map((r) => ({
  phone: r.phone,
  lastPreview: r.last_preview ? r.last_preview.slice(0, 120) : '',
  lastTime: r.last_time,
  botMode: r.bot_mode !== 0,
  needsHuman: r.human_intervention_requested === 1,
  displayName: r.display_name || null,
  unread: r.unread_count || 0,
}));
```

- [ ] **Step 2: Add unread reset to GET /api/conversations/:phone/messages**

Right before the return in the message history endpoint (before line 263), add a call to mark the conversation as read:

```js
// Mark conversation as read when messages are fetched
conversationState.markAsRead(phone.replace(/[^0-9]/g, ''));
```

Make sure `conversationState` is required at the top of `index.js` — it already is (line 11).

- [ ] **Step 3: Verify the file parses**

Run: `cd waha-bot && node -e "require('./index')"`

Expected: the server starts (will attempt to initialise WhatsApp and fail — that's fine). You can kill with Ctrl+C.

---

### Task 4: Wire up frontend display names and unread badges

**Files:**
- Modify: `waha-bot/public/js/conversations.js` — no structural changes needed; the code already reads `conv.displayName` and `conv.unread`. Now they're populated by the server.

- [ ] **Step 1: Verify the frontend code renders correctly**

The relevant existing code in `conversations.js`:

- **Line 63:** `avatar.textContent = (conv.displayName || conv.phone || '?').charAt(0).toUpperCase();`
- **Line 73:** `name.textContent = conv.displayName || conv.phone || 'Unknown';`
- **Lines 103-107:** Badge for `conv.unread > 0`

All three already work once the server populates these fields. **No frontend code changes needed for this task.**

But there's one gap: the `openConversation` function should refresh the conversation list after marking read so the badge disappears. Add a `loadConversations()` call after successfully loading messages.

In the `openConversation` function, right after `renderMessages(data.messages || []);` (line 143), the `markRead(phone)` call on line 145 currently only calls `loadConversations()`. That's correct — it re-fetches the list which will now show 0 unread. We just need to make sure it actually triggers.

The existing code already does this correctly:

```js
function markRead(phone) {
  loadConversations();  // Already refreshes the list
}
```

So the only real change is making the `openConversation` call also emits a `conversations:update` socket event or simply re-triggers the list reload directly. But `markRead` already calls `loadConversations()`.

Wait — there's a subtlety. The conversation list was loaded BEFORE unread was reset, so the badge might still show. After the API call in `openConversation` resets unread on the server, we call `markRead` which calls `loadConversations()`. The load is async, so there might be a brief flash. That's acceptable.

No frontend changes needed. ✅

- [ ] **Step 2: Fix the double `esc()` function conflict**

Both `analytics.js` (line 91) and `config-editor.js` (line 118) define a global `esc()` function. In `config-editor.js`, remove the duplicate since `analytics.js` loads first:

In `waha-bot/public/js/config-editor.js`, delete lines 118-123:

```js
function esc(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}
```

---

### Task 5: Sanity check the full stack

**Files:** All modified files

- [ ] **Step 1: Start the server**

```bash
cd waha-bot
node server/index.js
```

Expected: server starts on port 3000, logs show database initialisation.

- [ ] **Step 2: Open the dashboard**

Open `http://localhost:3000` in a browser.
Expected: the dashboard loads, Conversations view shows empty state.

- [ ] **Step 3: Send a test incoming message**

You can simulate by inserting a row directly into SQLite:

```bash
cd waha-bot/data
node -e "
const Database = require('better-sqlite3');
const db = new Database('waha.db');
const { v4: uuidv4 } = require('uuid');
db.prepare(\`INSERT INTO messages (id, from_number, to_number, body, timestamp, direction, is_ai_reply)
  VALUES (?, '62123456789@c.us', 'bot@c.us', 'Hello, I need help', ?, 'received', 0)\`)
  .run(uuidv4(), Date.now() - 60000);
console.log('Inserted test message');
"
```

Then restart the server and check the Conversations tab. Expected: the test number appears with phone number as name and unread count shown.

- [ ] **Step 4: Verify unread count resets**

Click the conversation to open its detail view. Expected: after loading, the badge in the conversation list disappears.

- [ ] **Step 5: Apply the esc() cleanup**

Confirm the page still works with the duplicate `esc()` removed from config-editor.js. The dashboard should load without JS console errors.
