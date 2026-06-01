const { EventEmitter } = require('events');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { db, config } = require('./config');
const logger = require('./logger');
const conversationState = require('./conversation-state');
const BotEngine = require('./bot-engine');

const SESSION_PATH = path.join(__dirname, '..', 'data', 'session');

// ---------------------------------------------------------------------------
// WhatsApp client — singleton EventEmitter
// ---------------------------------------------------------------------------
class WhatsAppClient extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.ready = false;
    this._recentSentIds = new Set();
    this._lastReplyBody = null;
    this._reconnectTimer = null;
  }

  /**
   * Build the underlying whatsapp-web.js Client and attach event handlers.
   */
  async initialize() {
    // If re-initializing, close the old browser first
    if (this.client) {
      try {
        this.client.removeAllListeners();
        if (this.client.pupBrowser) {
          await this.client.pupBrowser.close().catch(() => {});
        }
      } catch { /* ignore */ }
      this.client = null;
      await new Promise((r) => setTimeout(r, 1500));
    }

    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
      puppeteer: {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    });

    // ── QR ────────────────────────────────────────────────────────────────
    this.client.on('qr', async (qr) => {
      try {
        const qrDataUrl = await qrcode.toDataURL(qr);
        this.emit('wa:qr', qrDataUrl);
      } catch (err) {
        logger.error('Failed to generate QR code image', err.message);
      }
      logger.info('QR code generated — scan to connect');
    });

    // ── Ready ─────────────────────────────────────────────────────────────
    this.client.on('ready', () => {
      this.ready = true;
      const phone = this.client.info?.wid?.user || 'unknown';
      this.emit('wa:status', { connected: true, phone });
      logger.info('WhatsApp connected', { phone });
    });

    // ── Authenticated ─────────────────────────────────────────────────────
    this.client.on('authenticated', () => {
      logger.info('WhatsApp authenticated — session saved');
    });

    // ── Auth failure ──────────────────────────────────────────────────────
    this.client.on('auth_failure', (msg) => {
      logger.warn('WhatsApp auth failure', { error: msg });
    });

    // ── Disconnected ──────────────────────────────────────────────────────
    this.client.on('disconnected', (reason) => {
      this.ready = false;
      this.emit('wa:status', { connected: false });
      logger.warn('WhatsApp disconnected', reason || 'unknown');

      if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
      this._reconnectTimer = setTimeout(async () => {
        this._reconnectTimer = null;
        if (!this.ready) {
          logger.info('Attempting WhatsApp reconnection…');
          try {
            await this.initialize();
          } catch (err) {
            logger.error('Reconnection failed', err.message);
          }
        }
      }, 5000);
    });

    // ── Incoming message ──────────────────────────────────────────────────
    this.client.on('message', async (msg) => {
      const msgId = msg?.id?.id;
      if (!msgId) return;

      if (this._recentSentIds.has(msgId)) {
        this._recentSentIds.delete(msgId);
        return;
      }
      if (msg.fromMe && msg.body === this._lastReplyBody) return;

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
        }).catch((err) => {
          logger.warn('Failed to resolve contact name', { phone, error: err?.message || String(err) });
        });
      }

      await BotEngine.process(msg);
    });

    try {
      return await this.client.initialize();
    } catch (err) {
      this.client = null;
      const msg = err.message || '';
      if (msg.includes('Failed to launch') || msg.includes('ENOENT') || msg.includes('chrome') || msg.includes('chromium')) {
        logger.error(
          'Puppeteer failed to launch a browser. ' +
          'Make sure Chromium/Chrome is installed or set PUPPETEER_EXECUTABLE_PATH. ' +
          'On Linux: apt install chromium-browser. On Windows: ensure Chrome is installed.',
          { error: err.message },
        );
      }
      throw err;
    }
  }

  /**
   * Send a text message via WhatsApp.
   * @param {string}  to          Recipient number (with or without @c.us)
   * @param {string}  body        Message text
   * @param {object}  [options]   Options object
   * @param {boolean} [options.isAiReply]  Mark as AI-generated (sets is_ai_reply=1)
   */
  async sendMessage(to, body, options = {}) {
    if (!this.client) {
      logger.error('WhatsApp client not initialized — cannot send message');
      throw new Error('WhatsApp client not initialized');
    }
    try {
      const response = await this.client.sendMessage(to, body);

      this._recentSentIds.add(response.id.id);
      this._lastReplyBody = body;
      setTimeout(() => this._recentSentIds.delete(response.id.id), 30000);

      const myNumber = this.client.info?.wid?.user || 'unknown';
      const id = uuidv4();
      const isAiReply = options.isAiReply ? 1 : 0;
      db.prepare(
        `INSERT INTO messages (id, from_number, to_number, body, timestamp, direction, is_ai_reply)
         VALUES (?, ?, ?, ?, ?, 'sent', ?)`,
      ).run(id, myNumber, to, body, Date.now(), isAiReply);

      // Notify dashboard of new message in conversation
      this.emit('message:sent', { to, body, isAiReply });

      return response;
    } catch (err) {
      logger.error('Failed to send message', { to, error: err.message });
      throw err;
    }
  }

  cancelReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  /**
   * Graceful shutdown — preserves session by NOT calling client.logout().
   * Only closes the browser to release OS resources.
   * Respects the user's keepSession config toggle.
   */
  async logout() {
    this.cancelReconnect();
    if (!this.client) return;

    const keepSession = config.current.keepSession !== false;

    if (keepSession) {
      // ── Preserve session ─────────────────────────────────────────────
      // Do NOT call client.logout() — that sends a logout to WhatsApp's
      // servers and invalidates the LocalAuth data, forcing a new QR scan.
      // Instead, just close the browser to release file handles.
      logger.info('Shutting down — keeping WhatsApp session for next start');
      try {
        this.client.removeAllListeners();
        if (this.client.pupBrowser) {
          await this.client.pupBrowser.close().catch(() => {});
        }
      } catch { /* ignore */ }
    } else {
      // ── Full logout (user requested to clear session) ────────────────
      logger.info('Shutting down — clearing WhatsApp session per user config');
      try {
        await this.client.logout();
      } catch (err) {
        logger.warn('Logout failed, destroying browser directly');
        try {
          if (this.client.pupBrowser) {
            await this.client.pupBrowser.close();
          }
        } catch { /* ignore */ }
      }
    }

    this.client = null;
    this.ready = false;
  }

  /**
   * Force a full logout — explicitly invalidates the session.
   * Called when the user toggles keepSession off in the dashboard.
   */
  async forceLogout() {
    if (!this.client) return;
    logger.info('Force logout — clearing session data');
    try {
      await this.client.logout();
    } catch (err) {
      logger.warn('Force logout error', { error: err.message });
    }
    this.client = null;
    this.ready = false;
    this.emit('wa:status', { connected: false });
  }
}

// ---------------------------------------------------------------------------
// Singleton + export
// ---------------------------------------------------------------------------
const instance = new WhatsAppClient();

module.exports = instance;
