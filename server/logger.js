const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');
const { db } = require('./config');

const VALID_LEVELS = new Set(['info', 'warn', 'error', 'debug', 'bot']);

// ---------------------------------------------------------------------------
// Logger — singleton that writes to the shared logs table
// ---------------------------------------------------------------------------
class Logger extends EventEmitter {
  /**
   * Insert a log entry into the database and emit 'log:new'.
   * @param {'info'|'warn'|'error'|'debug'|'bot'} level
   * @param {string}  message
   * @param {object}  [metadata]  Optional JSON-serialisable metadata
   */
  log(level, message, metadata) {
    if (!VALID_LEVELS.has(level)) {
      level = 'info';
    }

    const id = uuidv4();
    const timestamp = Date.now();
    const metaStr = metadata !== undefined ? JSON.stringify(metadata) : null;

    db.prepare(
      'INSERT INTO logs (id, level, message, timestamp, metadata) VALUES (?, ?, ?, ?, ?)',
    ).run(id, level, message, timestamp, metaStr);

    const entry = { id, level, message, timestamp, metadata };

    // Emit for live streaming (Socket.IO can listen on this)
    this.emit('log:new', entry);

    // Console output for operational visibility
    const prefix = `[${new Date(timestamp).toISOString()}] [${level.toUpperCase()}]`;
    if (level === 'error') {
      console.error(prefix, message, metadata ?? '');
    } else {
      console.log(prefix, message, metadata ?? '');
    }

    return entry;
  }

  // Convenience helpers
  info(message, metadata)    { return this.log('info', message, metadata); }
  warn(message, metadata)    { return this.log('warn', message, metadata); }
  error(message, metadata)   { return this.log('error', message, metadata); }
  debug(message, metadata)   { return this.log('debug', message, metadata); }
  bot(message, metadata)     { return this.log('bot', message, metadata); }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------
module.exports = new Logger();
