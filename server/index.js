const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { config, db, DEFAULT_BOT_CONFIG } = require('./config');
const logger = require('./logger');
const whatsapp = require('./whatsapp');
const analytics = require('./analytics');
const knowledgeBase = require('./knowledge-base');
const conversationState = require('./conversation-state');
const auth = require('./auth');
const port = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST'],
  },
});

// Apply Socket.IO auth middleware
io.use(auth.authenticateSocket);

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000'] }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Auth middleware — protects all /api/ routes except /api/auth/login
app.use('/api', (req, res, next) => {
  if (req.path === '/auth/login') return next();
  auth.requireAuth(req, res, next);
});

// ---------------------------------------------------------------------------
// Socket.IO — client connections
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  // ── Immediate state on connect ──────────────────────────────────────────
  socket.emit('config:updated', config.current);
  socket.emit('analytics:update', analytics.getStats());
  socket.emit('kb:stats', knowledgeBase.getStats());
  socket.emit('handoff:list', conversationState.getAll());
  socket.emit('conversations:update');

  // Last 100 logs (oldest-first so the UI appends naturally)
  const lastLogs = db
    .prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 100')
    .all()
    .reverse()
    .map((row) => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    }));
  socket.emit('logs:init', lastLogs);

  socket.emit('wa:status', { connected: whatsapp.ready });

  // ── Config event with schema validation ──────────────────────────────
  socket.on('config:save', (newConfig) => {
    if (!newConfig || typeof newConfig !== 'object') {
      logger.warn('Invalid config payload from client', { from: socket.id });
      return;
    }

    // Only allow known top-level keys from DEFAULT_BOT_CONFIG
    const allowedKeys = new Set(Object.keys(DEFAULT_BOT_CONFIG));
    const unknownKeys = Object.keys(newConfig).filter((k) => !allowedKeys.has(k));
    if (unknownKeys.length > 0) {
      logger.warn('Config payload contained unknown keys', { keys: unknownKeys, from: socket.id });
      for (const key of unknownKeys) delete newConfig[key];
    }

    // Sanitise string values: strip null bytes
    const sanitise = (obj) => {
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') obj[k] = v.replace(/\0/g, '');
        else if (v && typeof v === 'object') sanitise(v);
      }
    };
    sanitise(newConfig);

    config.save(newConfig);
    io.emit('config:updated', config.current);
  });

  socket.on('config:get', () => {
    socket.emit('config:updated', config.current);
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// ---------------------------------------------------------------------------
// Knowledge Base API — multi-entry CRUD
// ---------------------------------------------------------------------------

/** GET /api/knowledge — list all entries */
app.get('/api/knowledge', (_req, res) => {
  res.json(knowledgeBase.getAll());
});

/** POST /api/knowledge — create new entry */
app.post('/api/knowledge', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { title, content } = req.body || {};
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content field is required' });
    }
    const result = knowledgeBase.create(title, content);
    const stats = knowledgeBase.getStats();
    io.emit('kb:stats', stats);
    res.json({ ...result, stats });
  } catch (err) {
    logger.error('Knowledge API error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/knowledge/:id — update an entry */
app.put('/api/knowledge/:id', express.json({ limit: '10mb' }), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const { title, content } = req.body || {};
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content field is required' });
  }
  knowledgeBase.update(id, title, content);
  const stats = knowledgeBase.getStats();
  io.emit('kb:stats', stats);
  res.json({ ok: true, stats });
});

/** DELETE /api/knowledge/:id — delete one entry */
app.delete('/api/knowledge/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  knowledgeBase.delete(id);
  const stats = knowledgeBase.getStats();
  io.emit('kb:stats', stats);
  res.json({ ok: true, stats });
});

/** DELETE /api/knowledge — clear all entries */
app.delete('/api/knowledge', (_req, res) => {
  knowledgeBase.clear();
  const stats = knowledgeBase.getStats();
  io.emit('kb:stats', stats);
  res.json({ ok: true, stats });
});

/** GET /api/knowledge/stats — entry count */
app.get('/api/knowledge/stats', (_req, res) => {
  res.json(knowledgeBase.getStats());
});

// ---------------------------------------------------------------------------
// Reply Templates API
// ---------------------------------------------------------------------------

/** GET /api/templates — list all templates (newest first) */
app.get('/api/templates', (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM reply_templates ORDER BY created_at DESC').all();
    res.json(rows);
  } catch (err) {
    logger.error('Templates list error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/templates — create a template */
app.post('/api/templates', express.json(), (req, res) => {
  try {
    const { title, body, shortcut } = req.body || {};
    if (!title || !title.trim() || !body || !body.trim()) {
      return res.status(400).json({ error: 'title and body are required' });
    }
    const now = Date.now();
    const info = db.prepare(
      'INSERT INTO reply_templates (title, body, shortcut, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(title.trim(), body.trim(), (shortcut || '').trim(), now, now);
    res.json({ id: info.lastInsertRowid, ok: true });
  } catch (err) {
    logger.error('Templates create error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/templates/:id — update a template */
app.put('/api/templates/:id', express.json(), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const { title, body, shortcut } = req.body || {};
    if (!title || !title.trim() || !body || !body.trim()) {
      return res.status(400).json({ error: 'title and body are required' });
    }
    db.prepare(
      'UPDATE reply_templates SET title = ?, body = ?, shortcut = ?, updated_at = ? WHERE id = ?'
    ).run(title.trim(), body.trim(), (shortcut || '').trim(), Date.now(), id);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Templates update error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/templates/:id — delete a template */
app.delete('/api/templates/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    db.prepare('DELETE FROM reply_templates WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Templates delete error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Auth API (no auth required — handles login)
// ---------------------------------------------------------------------------
app.post('/api/auth/login', express.json(), (req, res) => {
  const { password } = req.body || {};
  if (!auth.validatePassword(password)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  return res.json({ token: auth.hash(password), enabled: auth.AUTH_ENABLED });
});

// ---------------------------------------------------------------------------
// Handoff API
// ---------------------------------------------------------------------------

/** GET /api/handoffs — list all conversation states */
app.get('/api/handoffs', (_req, res) => {
  res.json(conversationState.getAll());
});

/** POST /api/handoffs/:phone/reset — reset a number back to bot mode */
app.post('/api/handoffs/:phone/reset', (req, res) => {
  conversationState.reset(req.params.phone);
  const all = conversationState.getAll();
  io.emit('handoff:list', all);
  res.json({ ok: true, state: all });
});

/** POST /api/handoffs/:phone/disable — manually set human intervention */
app.post('/api/handoffs/:phone/disable', (req, res) => {
  conversationState.requestHuman(req.params.phone);
  const all = conversationState.getAll();
  io.emit('handoff:list', all);
  res.json({ ok: true, state: all });
});

/** GET /api/handoffs/pending — return pending count */
app.get('/api/handoffs/pending', (_req, res) => {
  const count = conversationState.getPendingCount();
  const items = conversationState.getPendingHumanRequests();
  res.json({ count, items });
});

/** DELETE /api/handoffs/:phone — delete a handoff record */
app.delete('/api/handoffs/:phone', (req, res) => {
  const result = conversationState.deleteHandoff(req.params.phone);
  const all = conversationState.getAll();
  io.emit('handoff:list', all);
  io.emit('conversations:update');
  res.json({ ok: true, ...result });
});

/** DELETE /api/handoffs — batch delete handoff records */
app.delete('/api/handoffs', express.json(), (req, res) => {
  try {
    const { phones } = req.body || {};
    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ error: 'phones array is required' });
    }
    for (const phone of phones) {
      conversationState.deleteHandoff(phone);
    }
    const all = conversationState.getAll();
    io.emit('handoff:list', all);
    io.emit('conversations:update');
    res.json({ ok: true, deleted: phones.length });
  } catch (err) {
    logger.error('Batch delete handoffs API error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Conversations API
// ---------------------------------------------------------------------------

/** GET /api/conversations — list all conversations with metadata */
app.get('/api/conversations', (_req, res) => {
  try {
    // Group received messages by sender, get latest per phone
    const rows = db.prepare(`
      SELECT
        m.phone,
        m.body AS last_preview,
        m.timestamp AS last_time,
        cs.bot_mode,
        cs.human_intervention_requested,
        cs.display_name,
        cs.unread_count
      FROM (
        SELECT
          SUBSTR(from_number, 1, INSTR(from_number || '@', '@') - 1) AS phone,
          body, timestamp,
          ROW_NUMBER() OVER (PARTITION BY from_number ORDER BY timestamp DESC) AS rn
        FROM messages
        WHERE direction = 'received'
      ) m
      LEFT JOIN conversation_state cs ON cs.phone = m.phone
      WHERE m.rn = 1
      ORDER BY m.timestamp DESC
    `).all();

    const conversations = rows.map((r) => ({
      phone: r.phone,
      lastPreview: r.last_preview ? r.last_preview.slice(0, 120) : '',
      lastTime: r.last_time,
      botMode: r.bot_mode !== 0,
      needsHuman: r.human_intervention_requested === 1,
      displayName: r.display_name || null,
      unread: r.unread_count || 0,
    }));

    res.json(conversations);
  } catch (err) {
    logger.error('Conversations API error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/conversations/:phone/messages — full message history for a phone */
app.get('/api/conversations/:phone/messages', (req, res) => {
  try {
    const phone = req.params.phone;
    // Match both bare phone and JID format
    const likeJid = '%' + phone.replace(/[^0-9]/g, '') + '%';
    const messages = db.prepare(`
      SELECT id, body, timestamp, direction, is_ai_reply
      FROM messages
      WHERE (from_number LIKE ? OR to_number LIKE ?)
      ORDER BY timestamp ASC
      LIMIT 200
    `).all(likeJid, likeJid);

    // Mark conversation as read when messages are fetched
    try {
      conversationState.markAsRead(phone.replace(/[^0-9]/g, ''));
      io.emit('conversations:update');
    } catch (_) {
      // Non-critical — unread reset failure should not block the response
    }

    res.json({
      phone,
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        timestamp: m.timestamp,
        direction: m.direction,
        is_ai_reply: m.is_ai_reply === 1,
      })),
    });
  } catch (err) {
    logger.error('Conversation messages API error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Conversation Notes API (AI summaries + CRUD)
// ---------------------------------------------------------------------------

/**
 * Generate an AI summary for a conversation by calling the LLM.
 * Reuses the same OpenAI-compatible endpoint as bot-engine.js.
 */
async function generateConversationSummary(phone) {
  const aiSettings = config.current.aiSettings || {};
  const endpoint = (aiSettings.endpoint || 'http://localhost:20128/v1').replace(/\/+$/, '');
  const model = aiSettings.model || 'auto';

  // Fetch the last 20 messages for context
  const likeJid = '%' + phone.replace(/[^0-9]/g, '') + '%';
  const messages = db.prepare(`
    SELECT body, direction, timestamp FROM messages
    WHERE (from_number LIKE ? OR to_number LIKE ?)
    ORDER BY timestamp ASC
    LIMIT 20
  `).all(likeJid, likeJid);

  if (!messages.length) {
    return { summary: null, empty: true };
  }

  // Build conversation transcript for the prompt
  const transcript = messages.map(m => {
    const who = m.direction === 'sent' ? 'Agent' : 'Customer';
    const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `[${time}] ${who}: ${m.body}`;
  }).join('\n');

  const prompt = `Summarize this WhatsApp conversation in 2-3 concise sentences. Focus on:
1. What the customer needed or asked about
2. What was resolved or communicated
3. Any pending actions or follow-ups needed

Conversation:
${transcript}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: 300,
          temperature: 0.3,
          messages: [
            { role: 'system', content: 'You are a helpful assistant that writes concise conversation summaries for customer service agents.' },
            { role: 'user', content: prompt },
          ],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error('AI endpoint returned ' + response.status);
    }

    // Some LLM endpoints append trailing text after JSON — salvage gracefully
    const rawText = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      const firstBrace = rawText.indexOf('{');
      const lastBrace = rawText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try { parsed = JSON.parse(rawText.slice(firstBrace, lastBrace + 1)); }
        catch { throw parseErr; }
      } else {
        throw parseErr;
      }
    }

    const summary = parsed.choices?.[0]?.message?.content;
    if (!summary) throw new Error('AI response had no content');

    return { summary: summary.trim(), empty: false };
  } catch (err) {
    logger.error('Summary generation failed', { error: err.message, phone });
    return { summary: null, empty: false, error: err.message };
  }
}

/** GET /api/notes/:phone — list notes for a conversation */
app.get('/api/notes/:phone', (req, res) => {
  try {
    const phone = req.params.phone;
    const rows = db.prepare(
      'SELECT * FROM conversation_notes WHERE phone = ? ORDER BY updated_at DESC'
    ).all(phone);
    res.json(rows);
  } catch (err) {
    logger.error('Notes list error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/notes/:phone/generate — AI-generate a conversation summary */
app.post('/api/notes/:phone/generate', async (req, res) => {
  try {
    const phone = req.params.phone;
    const result = await generateConversationSummary(phone);

    if (result.empty) {
      return res.json({ note: null, empty: true });
    }

    if (!result.summary) {
      return res.status(500).json({ error: 'Failed to generate summary', detail: result.error });
    }

    // Upsert: remove old auto-generated note for this phone, then insert new one
    db.prepare('DELETE FROM conversation_notes WHERE phone = ? AND is_auto_generated = 1').run(phone);
    const now = Date.now();
    const info = db.prepare(
      'INSERT INTO conversation_notes (phone, body, author, is_auto_generated, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)'
    ).run(phone, result.summary, 'Sorc AI', now, now);

    // Return the created note
    const note = db.prepare('SELECT * FROM conversation_notes WHERE id = ?').get(info.lastInsertRowid);
    res.json({ note, empty: false });
  } catch (err) {
    logger.error('Notes generate error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/notes/:phone — manually create a note */
app.post('/api/notes/:phone', express.json(), (req, res) => {
  try {
    const phone = req.params.phone;
    const { body } = req.body || {};
    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'body is required' });
    }
    const now = Date.now();
    const info = db.prepare(
      'INSERT INTO conversation_notes (phone, body, author, is_auto_generated, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)'
    ).run(phone, body.trim(), 'Dashboard User', now, now);
    res.json({ id: info.lastInsertRowid, ok: true });
  } catch (err) {
    logger.error('Notes create error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/notes/:id — update a note (human editing AI summary) */
app.put('/api/notes/:id', express.json(), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const { body } = req.body || {};
    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'body is required' });
    }
    // When a human edits, flip is_auto_generated to 0
    db.prepare(
      'UPDATE conversation_notes SET body = ?, is_auto_generated = 0, updated_at = ? WHERE id = ?'
    ).run(body.trim(), Date.now(), id);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Notes update error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/notes/:id — delete a note */
app.delete('/api/notes/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    db.prepare('DELETE FROM conversation_notes WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Notes delete error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/send-message — send a message from the dashboard */
app.post('/api/send-message', express.json(), async (req, res) => {
  try {
    const { phone, message } = req.body || {};
    if (!phone || !message || !message.trim()) {
      return res.status(400).json({ error: 'phone and message are required' });
    }
    // Resolve the exact JID from existing messages — WhatsApp is migrating from
    // @c.us to @lid / @s.whatsapp.net, so guessing the suffix breaks for
    // newer accounts. Match on the numeric portion regardless of suffix.
    const clean = phone.replace(/[^0-9]/g, '');
    const jidRow = db.prepare(`
      SELECT DISTINCT from_number FROM messages
      WHERE SUBSTR(from_number, 1, INSTR(from_number || '@', '@') - 1) = ?
      LIMIT 1
    `).get(clean);
    const jid = jidRow
      ? jidRow.from_number
      : phone.includes('@') ? phone : clean + '@c.us';
    await whatsapp.sendMessage(jid, message.trim(), { isAiReply: false });
    // Broadcast conversation update
    io.emit('conversations:update');
    res.json({ ok: true });
  } catch (err) {
    logger.error('Send message API error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/conversations/:phone — delete conversation + messages */
app.delete('/api/conversations/:phone', (req, res) => {
  try {
    const phone = req.params.phone;
    const result = conversationState.deleteConversation(phone);
    io.emit('conversations:update');
    io.emit('handoff:list', conversationState.getAll());
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('Delete conversation API error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/conversations/search — full-text search across all messages */
app.get('/api/conversations/search', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const phone = (req.query.phone || '').trim();
    if (!q && !phone) {
      return res.json({ results: [] });
    }
    const likeQ = q ? '%' + q.replace(/[%_]/g, '\\$&') + '%' : '';
    const likePhone = phone ? '%' + phone.replace(/[^0-9]/g, '') + '%' : '';

    let sql, params;
    if (q && phone) {
      const cleanPhone = phone.replace(/[^0-9]/g, '');
      sql = `
        SELECT m.id, m.from_number, m.to_number, m.body, m.timestamp, m.direction, m.is_ai_reply,
               cs.display_name
        FROM messages m
        LEFT JOIN conversation_state cs ON cs.phone = SUBSTR(m.from_number, 1, INSTR(m.from_number || '@', '@') - 1)
        WHERE m.body LIKE ? ESCAPE '\\'
          AND (m.from_number LIKE ? OR m.to_number LIKE ?)
        ORDER BY m.timestamp DESC
        LIMIT 30
      `;
      params = [likeQ, likePhone, likePhone];
    } else if (q) {
      sql = `
        SELECT m.id, m.from_number, m.to_number, m.body, m.timestamp, m.direction, m.is_ai_reply,
               cs.display_name
        FROM messages m
        LEFT JOIN conversation_state cs ON cs.phone = SUBSTR(m.from_number, 1, INSTR(m.from_number || '@', '@') - 1)
        WHERE m.body LIKE ? ESCAPE '\\'
        ORDER BY m.timestamp DESC
        LIMIT 30
      `;
      params = [likeQ];
    } else if (phone) {
      sql = `
        SELECT m.id, m.from_number, m.to_number, m.body, m.timestamp, m.direction, m.is_ai_reply,
               cs.display_name
        FROM messages m
        LEFT JOIN conversation_state cs ON cs.phone = SUBSTR(m.from_number, 1, INSTR(m.from_number || '@', '@') - 1)
        WHERE m.from_number LIKE ? OR m.to_number LIKE ?
        ORDER BY m.timestamp DESC
        LIMIT 30
      `;
      params = [likePhone, likePhone];
    }

    const rows = db.prepare(sql).all(...params);

    // Group results by phone
    const grouped = {};
    for (const row of rows) {
      const phoneKey = row.from_number ? row.from_number.split('@')[0] : 'unknown';
      if (!grouped[phoneKey]) {
        grouped[phoneKey] = {
          phone: phoneKey,
          displayName: row.display_name || null,
          messages: [],
        };
      }
      grouped[phoneKey].messages.push({
        id: row.id,
        body: row.body,
        timestamp: row.timestamp,
        direction: row.direction,
        is_ai_reply: row.is_ai_reply === 1,
      });
    }

    const results = Object.values(grouped).sort(
      (a, b) => (b.messages[0]?.timestamp || 0) - (a.messages[0]?.timestamp || 0)
    );

    res.json({ results, total: rows.length });
  } catch (err) {
    logger.error('Conversation search error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/conversations — batch delete conversations */
app.delete('/api/conversations', express.json(), (req, res) => {
  try {
    const { phones } = req.body || {};
    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ error: 'phones array is required' });
    }
    let total = 0;
    for (const phone of phones) {
      const result = conversationState.deleteConversation(phone);
      total += result.messagesRemoved || 0;
    }
    io.emit('conversations:update');
    io.emit('handoff:list', conversationState.getAll());
    res.json({ ok: true, deleted: phones.length, messagesRemoved: total });
  } catch (err) {
    logger.error('Batch delete conversations API error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Knowledge Base preview (P2-10)
// ---------------------------------------------------------------------------
app.get('/api/knowledge/preview', (_req, res) => {
  try {
    const context = knowledgeBase.buildContext();
    const stats = knowledgeBase.getStats();
    res.json({ context, entriesCount: stats.entries, totalChars: stats.chars });
  } catch (err) {
    logger.error('Knowledge preview API error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Hook into message processing — broadcast conversation & handoff updates
// ---------------------------------------------------------------------------
whatsapp.on('message:sent', () => {
  io.emit('conversations:update');
});

// When any message arrives (including during bot-paused/handoff mode),
// broadcast both conversation list and handoff state so the dashboard
// stays updated without needing a manual refresh.
whatsapp.on('message:received', () => {
  io.emit('conversations:update');
  io.emit('handoff:list', conversationState.getAll());
});

// When bot-engine triggers a human handoff, broadcast immediately
// so the handoff nav badge and list appear in real-time.
const botEngine = require('./bot-engine');
botEngine.on('handoff:triggered', () => {
  io.emit('handoff:list', conversationState.getAll());
  io.emit('conversations:update');
});

// ---------------------------------------------------------------------------
// Forward logger events → all clients
// ---------------------------------------------------------------------------
logger.on('log:new', (logEntry) => {
  io.emit('log:new', logEntry);
});

// ---------------------------------------------------------------------------
// Periodic analytics broadcast (every 10 s)
// ---------------------------------------------------------------------------
const analyticsInterval = setInterval(() => {
  io.emit('analytics:update', analytics.getStats());
}, 10000);

// ---------------------------------------------------------------------------
// Database housekeeping — prune old records every hour
// ---------------------------------------------------------------------------
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 86_400_000;

function pruneOldData() {
  const cutoff = Date.now() - RETENTION_MS;
  try {
    const logPruned = db.prepare('DELETE FROM logs WHERE timestamp < ?').run(cutoff).changes;
    const msgPruned = db.prepare('DELETE FROM messages WHERE timestamp < ?').run(cutoff).changes;
    const analyticsPruned = db.prepare('DELETE FROM analytics WHERE timestamp < ?').run(cutoff).changes;
    if (logPruned + msgPruned + analyticsPruned > 0) {
      logger.info('Pruned old records', { logs: logPruned, messages: msgPruned, analytics: analyticsPruned });
    }
  } catch (err) {
    logger.warn('Failed to prune old data', { error: err.message });
  }

  // Auto-reset stale handoff requests (P2-9)
  try {
    if (config.current.conversationTimeout?.enabled !== false) {
      const hours = config.current.conversationTimeout?.hours || 24;
      const cutoff2 = Date.now() - hours * 3_600_000;
      const stale = db.prepare(
        "SELECT phone FROM conversation_state WHERE human_intervention_requested = 1 AND updated_at < ?"
      ).all(cutoff2);
      for (const row of stale) {
        conversationState.reset(row.phone);
        logger.info('Auto-reset stale handoff', { phone: row.phone });
      }
      if (stale.length > 0) {
        io.emit('handoff:list', conversationState.getAll());
      }
    }
  } catch (err) {
    logger.warn('Auto-reset stale conversations failed', { error: err.message });
  }
}

pruneOldData();
const pruneInterval = setInterval(pruneOldData, 6 * 3_600_000);

// ---------------------------------------------------------------------------
// WhatsApp client
// ---------------------------------------------------------------------------
whatsapp.on('wa:status', (status) => io.emit('wa:status', status));
whatsapp.on('wa:qr', (qrDataUrl) => io.emit('wa:qr', qrDataUrl));

// ---------------------------------------------------------------------------
// Router health proxy
// ---------------------------------------------------------------------------
app.get('/api/router-health', async (_req, res) => {
  try {
    const routerUrl = (config.current.aiSettings?.endpoint || 'http://localhost:20128/v1').replace(/\/+$/, '');
    const r = await fetch(routerUrl + '/models', { signal: AbortSignal.timeout(4000) });
    res.json({ connected: r.ok });
  } catch {
    res.json({ connected: false });
  }
});

/** POST /api/whatsapp/logout — force logout and clear session */
app.post('/api/whatsapp/logout', async (_req, res) => {
  try {
    await whatsapp.forceLogout();
    res.json({ ok: true });
  } catch (err) {
    logger.error('Force logout API error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
server.listen(port, () => {
  logger.info('Server started on port ' + port + (auth.AUTH_ENABLED ? ' (auth enabled)' : ' (no auth)'));

  whatsapp.initialize().catch((err) => {
    logger.error('Failed to initialize WhatsApp client', err.message);
  });
});

// ---------------------------------------------------------------------------
// Top-level error handlers
// ---------------------------------------------------------------------------
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled promise rejection', { error: err?.message || err });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err?.message || err });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    wa: { connected: whatsapp.ready },
    uptime: process.uptime(),
  });
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal) {
  logger.info(`Shutting down (${signal})…`);
  clearInterval(analyticsInterval);
  clearInterval(pruneInterval);
  await whatsapp.logout();
  try { db.close(); } catch { /* ignore */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
