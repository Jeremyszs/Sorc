const { config } = require('./config');
const logger = require('./logger');
const analytics = require('./analytics');
const conversationState = require('./conversation-state');
const knowledgeBase = require('./knowledge-base');
const { EventEmitter } = require('events');

// Lazy require — avoids circular dependency crash.
// whatsapp.js requires BotEngine at module level, so requiring
// whatsapp at the top of this file would get a partial export.
// We resolve it on first use instead.
function getWhatsapp() {
  return require('./whatsapp');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The exact fallback phrase the LLM must return when it cannot answer from
 * the provided context. We check whether reply.trim() EQUALS this string
 * (or starts with it in case the model appends punctuation).
 */
const FALLBACK_PHRASE =
  "I do not have the information to answer that accurately. Please wait a moment while I transfer you to a human representative.";

/**
 * Strict system prompt — forces the LLM to answer ONLY from <context>.
 */
const RAG_SYSTEM_PROMPT = `You are a strict customer service representative. You must answer the user's inquiry using ONLY the data provided in the <context> tags below. Do not use outside knowledge. Do not make assumptions. If the answer is not explicitly stated in the context, you must reply with the exact phrase: "${FALLBACK_PHRASE}"`;

// ---------------------------------------------------------------------------
// BotEngine — RAG message processing with rate limiting & human handoff
// ---------------------------------------------------------------------------
class BotEngine extends EventEmitter {
  constructor() {
    super();
    // Serial queue — processes one AI reply at a time
    this._queue = [];
    this._processing = false;
    // Rate limiting — per-phone tracking
    this._rateMap = new Map();
  }

  /**
   * Check if a phone has exceeded the rate limit.
   * Returns true if the message is allowed, false if throttled.
   */
  _checkRateLimit(phone) {
    const maxPerMinute = config.current.rateLimit?.maxPerMinute || 20;
    const now = Date.now();
    const entry = this._rateMap.get(phone);
    if (!entry || now - entry.windowStart > 60000) {
      // Start a new window
      this._rateMap.set(phone, { count: 1, windowStart: now });
      return true;
    }
    entry.count++;
    if (entry.count > maxPerMinute) {
      logger.bot('Rate limit exceeded', { phone, count: entry.count });
      return false;
    }
    return true;
  }

  async _enqueue(fn) {
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      if (!this._processing) this._dequeue();
    });
  }

  async _dequeue() {
    if (this._queue.length === 0) {
      this._processing = false;
      return;
    }
    this._processing = true;
    const { fn, resolve, reject } = this._queue.shift();
    try {
      resolve(await fn());
    } catch (err) {
      logger.error('Queue task failed', { error: err?.message || err });
      resolve(null);
    }
    this._dequeue();
  }

  /**
   * Entry point — check conversation state, then delegate to AI.
   */
  async process(msg) {
    // Never reply to our own messages — this is the primary echo guard
    if (msg.fromMe) return;

    // Skip messages with no text body (images, voice notes, stickers, etc.)
    if (!msg.body) return;

    // ── Conversation state check ───────────────────────────────────────────
    // Extract the sender's phone number from msg.from (e.g. "221813636337685@c.us")
    const phone = msg.from?.split('@')[0];
    if (!phone) return;

    // If bot_mode is off for this number (human handoff active), skip entirely
    if (!conversationState.isBotMode(phone)) {
      logger.bot('Message skipped — human intervention active', { phone });
      return;
    }

    const prompt = msg.body.trim();
    if (!prompt) return;

    // ── Rate limit check ──────────────────────────────────────────────────
    if (!this._checkRateLimit(phone)) {
      try {
        await getWhatsapp().sendMessage(
          msg.from,
          "You're sending messages too quickly. Please wait a moment before sending another message.",
          { isAiReply: true }
        );
      } catch { /* ignore */ }
      return;
    }

    // Enqueue the reply so only one AI request runs at a time
    await this._enqueue(async () => {
      const originalBody = msg.body;
      msg.body = prompt;

      try {
        // ── Retrieve context from knowledge base ─────────────────────────
        const context = knowledgeBase.buildContext();

        // Route through AI with the RAG context
        const reply = await this.handleAIReply(
          msg,
          context,     // <-- pass RAG context
        );

        if (!reply) {
          logger.bot('AI returned empty reply — skipping send');
          return;
        }

        // ── Check for human handoff condition ──────────────────────────
        // If the LLM output the exact fallback phrase, request human intervention
        if (reply.trim() === FALLBACK_PHRASE) {
          conversationState.requestHuman(phone);
          logger.bot('Human handoff triggered', { phone, body: reply });

          // Notify dashboard in real-time
          this.emit('handoff:triggered');

          // Send the fallback reply so the user knows they're being transferred
          try {
            await getWhatsapp().sendMessage(msg.from, reply, { isAiReply: true });
            logger.bot('AI reply sent (human handoff)', { to: phone, body: reply });
          } catch (replyErr) {
            logger.error('Failed to send handoff reply', { error: replyErr?.message, phone });
          }
          analytics.track('human_handoff', 1, '1h');
          return;
        }

        // ── Send regular AI reply ─────────────────────────────────────────
        try {
          await getWhatsapp().sendMessage(msg.from, reply, { isAiReply: true });
          logger.bot('AI reply sent', { to: phone, body: reply });
        } catch (replyErr) {
          logger.error('Failed to send AI reply', { error: replyErr?.message, to: phone });
        }
        analytics.track('ai_reply_sent', 1, '1h');
      } finally {
        msg.body = originalBody;
      }
    });
  }

  /**
   * Call the 9router AI endpoint and return the reply text.
   * If `ragContext` is provided, it is injected into the system prompt.
   */
  async handleAIReply(msg, ragContext) {
    const aiSettings = config.current.aiSettings || {};

    const endpoint = (aiSettings.endpoint || 'http://localhost:20128/v1').replace(/\/+$/, '');
    const model = aiSettings.model || 'auto';
    const maxTokens = aiSettings.maxTokens || 716;
    const temperature = aiSettings.temperature ?? 0.2;

    // ── Build system prompt with RAG context ─────────────────────────────
    let systemPrompt;
    if (ragContext) {
      // Use the strict RAG system prompt with injected context
      systemPrompt = `${RAG_SYSTEM_PROMPT}\n\n${ragContext}`;
    } else {
      // No knowledge base context — use the user's global system prompt or a basic one
      systemPrompt =
        aiSettings.systemPrompt ||
        'You are a helpful WhatsApp assistant.';
    }

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
            max_tokens: maxTokens,
            temperature,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: msg.body },
            ],
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        let bodyText = '';
        try { bodyText = await response.text(); } catch { /* ignore */ }
        logger.error('AI endpoint error', {
          status: response.status,
          body: bodyText.slice(0, 500),
        });
        return "Sorry, I couldn't process that right now.";
      }

      const rawText = await response.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch (parseErr) {
        logger.debug('AI response had trailing content — salvaged JSON portion', {
          error: parseErr.message,
          length: rawText.length,
        });
        const firstBrace = rawText.indexOf('{');
        const lastBrace = rawText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          try {
            data = JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
          } catch {
            throw parseErr;
          }
        } else {
          throw parseErr;
        }
      }

      const reply = data.choices?.[0]?.message?.content;
      if (!reply) {
        throw new Error('AI response had no content');
      }

      // Track token usage if reported
      if (data.usage) {
        analytics.track('tokens_used', data.usage.total_tokens || 0, '1h');
      }

      return reply;
    } catch (err) {
      logger.error('AI reply failed', { error: err.message });
      return "Sorry, I couldn't process that right now.";
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
module.exports = new BotEngine();
