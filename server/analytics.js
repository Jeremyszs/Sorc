const { v4: uuidv4 } = require('uuid');
const { db } = require('./config');

// ---------------------------------------------------------------------------
// Analytics — singleton that reads from the shared messages & analytics tables
// ---------------------------------------------------------------------------
class Analytics {
  /**
   * Record a metric value in the analytics table.
   * @param {string}  metric  Metric name (e.g. 'messages_sent', 'commands_run')
   * @param {number}  value   Numeric value
   * @param {string}  [window]  Time window label (e.g. '1h', '24h', 'all')
   */
  track(metric, value, window) {
    const id = uuidv4();
    const timestamp = Date.now();
    db.prepare(
      'INSERT INTO analytics (id, metric, value, timestamp, window) VALUES (?, ?, ?, ?, ?)',
    ).run(id, metric, value, timestamp, window || null);
  }

  /**
   * Aggregate statistics from the messages table.
   */
  getStats() {
    const now = Date.now();
    const oneHourAgo = now - 3_600_000;
    const oneDayAgo  = now - 86_400_000;

    // -- Count queries -------------------------------------------------------
    const messagesToday   = db.prepare(
      'SELECT COUNT(*) AS count FROM messages WHERE timestamp > ?',
    ).get(oneDayAgo).count;

    const messagesThisHour = db.prepare(
      'SELECT COUNT(*) AS count FROM messages WHERE timestamp > ?',
    ).get(oneHourAgo).count;

    const totalMessages = db.prepare(
      'SELECT COUNT(*) AS count FROM messages',
    ).get().count;

    const aiReplies = db.prepare(
      'SELECT COUNT(*) AS count FROM messages WHERE is_ai_reply = 1',
    ).get().count;

    // -- Hourly volume (last 24 full hours, oldest first) --------------------
    const raw = db.prepare(
      'SELECT timestamp FROM messages WHERE timestamp > ? ORDER BY timestamp ASC',
    ).all(oneDayAgo);

    // Bucket by "hours ago"
    const buckets = {};
    for (const row of raw) {
      const slot = Math.floor((now - row.timestamp) / 3_600_000); // 0 = current hour
      buckets[slot] = (buckets[slot] || 0) + 1;
    }

    const hourlyVolume = [];
    for (let i = 23; i >= 0; i--) {
      // i = 23 → 23 hours ago (oldest), i = 0 → current hour (newest)
      const label = i === 0 ? 'this hour' : `${i}h ago`;
      hourlyVolume.push({ hour: label, count: buckets[i] || 0 });
    }

    // -- Human handoff count (from conversation state) ------------------------
    let humanHandoffs = 0;
    try {
      const handoffRow = db.prepare(
        "SELECT COUNT(*) AS count FROM conversation_state WHERE human_intervention_requested = 1",
      ).get();
      humanHandoffs = handoffRow ? handoffRow.count : 0;
    } catch {
      // Table may not exist yet
    }

    return {
      messagesToday,
      messagesThisHour,
      totalMessages,
      aiReplies,
      humanHandoffs,
      hourlyVolume,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------
module.exports = new Analytics();
