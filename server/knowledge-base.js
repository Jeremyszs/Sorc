const { db } = require('./config');
const logger = require('./logger');

// ---------------------------------------------------------------------------
// KnowledgeBase — multi-entry knowledge store in SQLite
//
// Each save creates a new entry (row). buildContext() concatenates ALL entries
// into a single <context> block for the AI prompt. No overwrites, no
// embeddings — just structured text storage with CRUD.
// ---------------------------------------------------------------------------

class KnowledgeBase {
  constructor() {
    this._ensureTable();
  }

  _ensureTable() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  /**
   * Create a new knowledge entry. Returns the new row id.
   */
  create(title, content) {
    const now = Date.now();
    const info = db.prepare(
      'INSERT INTO knowledge_entries (title, content, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run(title || '', content.trim(), now, now);
    logger.info('Knowledge entry created', { id: info.lastInsertRowid, title: title || '(untitled)' });
    return { id: info.lastInsertRowid };
  }

  /**
   * Update an existing entry by id.
   */
  update(id, title, content) {
    const now = Date.now();
    db.prepare(
      'UPDATE knowledge_entries SET title = ?, content = ?, updated_at = ? WHERE id = ?',
    ).run(title || '', content.trim(), now, id);
    logger.info('Knowledge entry updated', { id });
  }

  /**
   * Delete a single entry by id.
   */
  delete(id) {
    db.prepare('DELETE FROM knowledge_entries WHERE id = ?').run(id);
    logger.info('Knowledge entry deleted', { id });
  }

  /**
   * Get all entries, newest first.
   */
  getAll() {
    return db
      .prepare('SELECT id, title, content, created_at, updated_at FROM knowledge_entries ORDER BY created_at DESC')
      .all();
  }

  /**
   * Get a single entry by id.
   */
  get(id) {
    return db.prepare('SELECT id, title, content, created_at, updated_at FROM knowledge_entries WHERE id = ?').get(id);
  }

  /**
   * Build a <context> block from ALL entries, concatenated.
   * Returns empty string if no entries exist.
   */
  buildContext() {
    const entries = db
      .prepare('SELECT id, title, content FROM knowledge_entries ORDER BY created_at ASC')
      .all();

    if (!entries.length) return '';

    const parts = entries.map((e, i) => {
      const header = e.title ? `[Section ${i + 1}: ${e.title}]` : `[Section ${i + 1}]`;
      return `${header}\n${e.content}`;
    });

    return `<context>\n${parts.join('\n\n')}\n</context>`;
  }

  /**
   * Delete all entries.
   */
  clear() {
    db.exec('DELETE FROM knowledge_entries');
    logger.info('KnowledgeBase cleared');
  }

  /**
   * Stats for the dashboard.
   */
  getStats() {
    const row = db.prepare('SELECT COUNT(*) AS count FROM knowledge_entries').get();
    const charRow = db.prepare("SELECT COALESCE(SUM(LENGTH(content)), 0) AS total FROM knowledge_entries").get();
    return {
      entries: row ? row.count : 0,
      chars: charRow ? charRow.total : 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
module.exports = new KnowledgeBase();
