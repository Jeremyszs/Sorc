const path = require('path');
const Database = require('better-sqlite3');
const { EventEmitter } = require('events');

// ---------------------------------------------------------------------------
// 1. SQLite database at data/waha.db (with corruption fallback)
// ---------------------------------------------------------------------------
const dbPath = path.join(__dirname, '..', 'data', 'waha.db');
let db;

try {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
} catch (err) {
  console.error('[config] Failed to open SQLite database:', err.message);
  console.error('[config] Running with in-memory fallback — data will not persist.');
  db = new Database(':memory:');
}

// ---------------------------------------------------------------------------
// 2. Tables (created if they don't exist)
// ---------------------------------------------------------------------------
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      from_number TEXT,
      to_number TEXT,
      body TEXT,
      timestamp INTEGER,
      direction TEXT,
      rule_id TEXT,
      is_ai_reply INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      level TEXT,
      message TEXT,
      timestamp INTEGER,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS analytics (
      id TEXT PRIMARY KEY,
      metric TEXT,
      value REAL,
      timestamp INTEGER,
      window TEXT
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
} catch (err) {
  console.error('[config] Failed to create tables:', err.message);
}

// ---------------------------------------------------------------------------
// Default bot configuration
// ---------------------------------------------------------------------------
const DEFAULT_BOT_CONFIG = {
  botName: 'Sorc',
  active: true,
  keepSession: true,
  rateLimit: {
    maxPerMinute: 20,
  },
  conversationTimeout: {
    enabled: true,
    hours: 24,
  },
  defaultReply: "Thanks for your message! I'll get back to you soon.",
  aiSettings: {
    endpoint: 'http://localhost:20128/v1',
    model: 'auto',
    systemPrompt: 'You are a helpful WhatsApp assistant.',
    maxTokens: 500,
    temperature: 0.7,
  },
};

// ---------------------------------------------------------------------------
// 3. Config class — loads from / saves to the `config` table
// ---------------------------------------------------------------------------
class Config extends EventEmitter {
  constructor() {
    super();
    this._data = null;
    this.load();
  }

  /**
   * Load bot config from the config table (key = 'bot_config').
   * Falls back to DEFAULT_BOT_CONFIG if none exists.
   */
  load() {
    const row = db.prepare("SELECT value FROM config WHERE key = 'bot_config'").get();
    if (row) {
      try {
        this._data = JSON.parse(row.value);
      } catch {
        this._data = deepClone(DEFAULT_BOT_CONFIG);
      }
    } else {
      this._data = deepClone(DEFAULT_BOT_CONFIG);
      this._persist();
    }
    return this._data;
  }

  /**
   * Replace the entire bot config and persist to the database.
   */
  save(newConfig) {
    // Merge into the CURRENT live config, not the default — this preserves
    // any settings not included in the partial update payload.
    const current = deepClone(this._data || DEFAULT_BOT_CONFIG);
    const merged = { ...current, ...newConfig };
    if (newConfig.aiSettings) {
      merged.aiSettings = { ...current.aiSettings, ...newConfig.aiSettings };
    }
    if (newConfig.rateLimit) {
      merged.rateLimit = { ...current.rateLimit, ...newConfig.rateLimit };
    }
    if (newConfig.conversationTimeout) {
      merged.conversationTimeout = { ...current.conversationTimeout, ...newConfig.conversationTimeout };
    }
    this._data = merged;
    this._persist();
    this.emit('config:updated', this._data);
  }

  /**
   * Re-read config from the database.
   */
  reload() {
    this.load();
    this.emit('config:updated', this._data);
  }

  /** Return the current in-memory config (read-only copy). */
  get current() {
    return deepClone(this._data);
  }

  /** Access a nested key via dot-path, e.g. config.get('aiSettings.model'). */
  get(keyPath) {
    const keys = keyPath.split('.');
    let val = this._data;
    for (const k of keys) {
      if (val == null || typeof val !== 'object') return undefined;
      val = val[k];
    }
    return val;
  }

  /** Set a single nested key via dot-path, e.g. config.set('aiSettings.model', 'gpt-4'). */
  set(keyPath, value) {
    const keys = keyPath.split('.');
    let obj = this._data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (obj[keys[i]] == null || typeof obj[keys[i]] !== 'object') {
        obj[keys[i]] = {};
      }
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    this._persist();
    this.emit('config:updated', this._data);
  }

  _persist() {
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('bot_config', ?)").run(
      JSON.stringify(this._data),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
const config = new Config();

// ---------------------------------------------------------------------------
// 4. Exports
// ---------------------------------------------------------------------------
module.exports = {
  db,
  config,
  DEFAULT_BOT_CONFIG,
};
