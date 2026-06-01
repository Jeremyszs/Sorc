const { db } = require('./config');
const logger = require('./logger');

// ---------------------------------------------------------------------------
// ConversationState — tracks bot_mode per phone number + human handoff
// ---------------------------------------------------------------------------
class ConversationState {
  constructor() {
    this._ensureTable();
    this._ensureColumns();
  }

  _ensureTable() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_state (
        phone TEXT PRIMARY KEY,
        bot_mode INTEGER NOT NULL DEFAULT 1,
        human_intervention_requested INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
    `);
  }

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

  /**
   * Whether the bot should process messages from this number.
   * Defaults to true (bot mode) if no record exists.
   */
  isBotMode(phone) {
    const row = db
      .prepare('SELECT bot_mode FROM conversation_state WHERE phone = ?')
      .get(phone);
    return row ? row.bot_mode === 1 : true;
  }

  /**
   * Enable or disable bot processing for this number.
   */
  setBotMode(phone, enabled) {
    db.prepare(`
      INSERT INTO conversation_state (phone, bot_mode, human_intervention_requested, updated_at)
      VALUES (?, ?, 0, ?)
      ON CONFLICT(phone) DO UPDATE SET bot_mode = ?, updated_at = ?
    `).run(phone, enabled ? 1 : 0, Date.now(), enabled ? 1 : 0, Date.now());
    logger.bot('Conversation state updated', { phone, bot_mode: enabled });
  }

  /**
   * Mark this conversation as needing a human — disables bot mode and sets
   * the human_intervention_requested flag so it appears in the dashboard.
   */
  requestHuman(phone) {
    db.prepare(`
      INSERT INTO conversation_state (phone, bot_mode, human_intervention_requested, updated_at)
      VALUES (?, 0, 1, ?)
      ON CONFLICT(phone) DO UPDATE SET
        bot_mode = 0, human_intervention_requested = 1, updated_at = ?
    `).run(phone, Date.now(), Date.now());
    logger.bot('Human intervention requested', { phone });
  }

  /**
   * Reset a phone number back to bot mode (clears the human flag).
   */
  reset(phone) {
    db.prepare(`
      INSERT INTO conversation_state (phone, bot_mode, human_intervention_requested, updated_at)
      VALUES (?, 1, 0, ?)
      ON CONFLICT(phone) DO UPDATE SET
        bot_mode = 1, human_intervention_requested = 0, updated_at = ?
    `).run(phone, Date.now(), Date.now());
    logger.bot('Conversation reset to bot mode', { phone });
  }

  /** Return every conversation_state row (newest first). */
  getAll() {
    return db
      .prepare('SELECT * FROM conversation_state ORDER BY updated_at DESC')
      .all();
  }

  /** Return only rows where human intervention has been requested. */
  getPendingHumanRequests() {
    return db
      .prepare(
        'SELECT * FROM conversation_state WHERE human_intervention_requested = 1 ORDER BY updated_at DESC',
      )
      .all();
  }

  /** Return count of pending human requests. */
  getPendingCount() {
    const row = db
      .prepare(
        'SELECT COUNT(*) AS count FROM conversation_state WHERE human_intervention_requested = 1',
      )
      .get();
    return row ? row.count : 0;
  }

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
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
module.exports = new ConversationState();
