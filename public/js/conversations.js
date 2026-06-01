/* ===================================================================
   conversations.js — Conversations list, message history, and reply
   =================================================================== */

(function () {
  const listEl = document.getElementById('conv-list');
  const emptyEl = document.getElementById('conv-empty');
  const headerCount = document.getElementById('conv-header-count');
  const listPane = document.getElementById('conv-list-pane');
  const detailPane = document.getElementById('conv-detail-pane');
  const detailTitle = document.getElementById('conv-detail-title');
  const detailStatus = document.getElementById('conv-detail-status');
  const messagesEl = document.getElementById('conv-messages');
  const emptyMsgEl = document.getElementById('conv-empty-msg');
  const replyInput = document.getElementById('conv-reply-input');
  const sendBtn = document.getElementById('conv-send-btn');
  const sendError = document.getElementById('conv-send-error');
  const backBtn = document.getElementById('conv-back');

  let _conversations = [];
  let _currentPhone = null;

  // ---- Load conversation list -----------------------------------------

  async function loadConversations() {
    try {
      const res = await fetch('/api/conversations');
      if (res.status === 401) {
        if (typeof window.__handleAuthError === 'function') window.__handleAuthError();
        return;
      }
      if (!res.ok) throw new Error('Failed to load');
      _conversations = await res.json();
      renderConversations();
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }

  function renderConversations() {
    if (!_conversations || !_conversations.length) {
      listEl.innerHTML = '';
      emptyEl.style.display = '';
      if (headerCount) headerCount.textContent = '';
      return;
    }
    emptyEl.style.display = 'none';
    if (headerCount) headerCount.textContent = _conversations.length + ' conversations';

    const fragment = document.createDocumentFragment();

    for (const conv of _conversations) {
      const card = document.createElement('div');
      card.className = 'conv-card' + (conv.phone === _currentPhone ? ' selected' : '');
      card.dataset.phone = conv.phone;
      card.style.cssText =
        'background:var(--surface);border:1px solid var(--glass-border);border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:6px;cursor:pointer;display:flex;gap:12px;align-items:flex-start;transition:background .15s;';
      card.addEventListener('click', () => openConversation(conv.phone));

      const avatar = document.createElement('div');
      avatar.style.cssText =
        'width:40px;height:40px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex-shrink:0;';
      avatar.textContent = (conv.displayName || conv.phone || '?').charAt(0).toUpperCase();

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';

      const row1 = document.createElement('div');
      row1.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;';

      const name = document.createElement('div');
      name.style.cssText = 'font-weight:600;font-size:14px;color:var(--text-primary);';
      name.textContent = conv.displayName || conv.phone || 'Unknown';

      const time = document.createElement('div');
      time.style.cssText = 'font-size:10px;color:var(--text-tertiary);white-space:nowrap;margin-left:8px;';
      time.textContent = conv.lastTime ? formatTime(conv.lastTime) : '';

      row1.appendChild(name);
      row1.appendChild(time);

      const preview = document.createElement('div');
      preview.style.cssText = 'font-size:12px;color:var(--text-secondary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      preview.textContent = conv.lastPreview || '';

      const row2 = document.createElement('div');
      row2.style.cssText = 'display:flex;gap:6px;margin-top:4px;';

      // Status tag
      if (conv.needsHuman) {
        const tag = document.createElement('span');
        tag.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:10px;background:var(--red-soft);color:var(--red);font-weight:500;';
        tag.textContent = 'Needs Human';
        row2.appendChild(tag);
      } else if (conv.botMode === false || conv.botMode === 0) {
        const tag = document.createElement('span');
        tag.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:10px;background:var(--orange-soft);color:var(--orange);font-weight:500;';
        tag.textContent = 'Paused';
        row2.appendChild(tag);
      }

      // Unread count
      if (conv.unread > 0) {
        const badge = document.createElement('span');
        badge.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:10px;background:var(--accent);color:#fff;font-weight:600;margin-left:auto;';
        badge.textContent = conv.unread;
        row2.appendChild(badge);
      }

      info.appendChild(row1);
      info.appendChild(preview);
      info.appendChild(row2);

      card.appendChild(avatar);
      card.appendChild(info);
      fragment.appendChild(card);
    }

    listEl.innerHTML = '';
    listEl.appendChild(fragment);
  }

  // ---- Open conversation detail ----------------------------------------

  async function openConversation(phone) {
    _currentPhone = phone;
    if (listPane) listPane.style.display = 'none';
    if (detailPane) detailPane.style.display = 'block';
    detailTitle.textContent = phone;
    detailStatus.textContent = '';
    messagesEl.innerHTML = '';
    emptyMsgEl.style.display = 'none';
    sendError.style.display = 'none';
    replyInput.value = '';

    // Highlight in list
    document.querySelectorAll('.conv-card').forEach((c) => c.classList.remove('selected'));

    try {
      const res = await fetch('/api/conversations/' + encodeURIComponent(phone) + '/messages');
      if (!res.ok) throw new Error('Failed to load messages');
      const data = await res.json();
      renderMessages(data.messages || []);
      // Clear unread
      markRead(phone);
    } catch (err) {
      console.error('Failed to load messages:', err);
      emptyMsgEl.textContent = 'Failed to load messages.';
      emptyMsgEl.style.display = '';
    }
  }

  function renderMessages(messages) {
    messagesEl.innerHTML = '';

    if (!messages || !messages.length) {
      emptyMsgEl.style.display = '';
      return;
    }
    emptyMsgEl.style.display = 'none';

    for (const m of messages) {
      const bubble = document.createElement('div');
      const isReceived = m.direction === 'received';
      bubble.style.cssText =
        'max-width:80%;padding:10px 14px;border-radius:14px;font-size:13px;line-height:1.45;word-wrap:break-word;align-self:' +
        (isReceived ? 'flex-start;background:var(--surface-secondary);color:var(--text-primary);' : 'flex-end;background:var(--accent);color:#fff;');

      const body = document.createElement('div');
      body.textContent = m.body || '';

      const meta = document.createElement('div');
      meta.style.cssText = 'font-size:10px;margin-top:4px;opacity:0.6;text-align:' + (isReceived ? 'left' : 'right') + ';';
      meta.textContent = m.timestamp ? formatTime(m.timestamp) + (m.is_ai_reply ? ' · AI' : '') : '';

      bubble.appendChild(body);
      bubble.appendChild(meta);
      messagesEl.appendChild(bubble);
    }

    // Scroll to bottom
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---- Send reply ------------------------------------------------------

  async function sendReply() {
    const message = replyInput.value.trim();
    if (!message || !_currentPhone) return;

    sendBtn.disabled = true;
    sendError.style.display = 'none';

    try {
      const res = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: _currentPhone, message }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Send failed');
      }
      replyInput.value = '';
      // Reload messages
      await openConversation(_currentPhone);
    } catch (err) {
      sendError.textContent = 'Failed: ' + err.message;
      sendError.style.display = '';
    } finally {
      sendBtn.disabled = false;
    }
  }

  if (sendBtn) sendBtn.addEventListener('click', sendReply);
  if (replyInput) replyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendReply();
    }
  });

  if (backBtn) backBtn.addEventListener('click', () => {
    _currentPhone = null;
    if (detailPane) detailPane.style.display = 'none';
    if (listPane) listPane.style.display = 'block';
  });

  // ---- Mark as read (placeholder) --------------------------------------

  function markRead(phone) {
    // For now, just refresh the list
    loadConversations();
  }

  // ---- Helpers ---------------------------------------------------------

  function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // ---- Socket events ---------------------------------------------------

  if (typeof socket !== 'undefined') {
    socket.on('conversations:update', () => {
      const viewActive = document.getElementById('view-conversations')?.classList.contains('active');
      if (viewActive) loadConversations();
      // If we have a conversation open, refresh it
      if (_currentPhone) {
        openConversation(_currentPhone);
      }
    });
  }

  // ---- Public API ------------------------------------------------------

  window.renderConversations = loadConversations;

  // ---- Initial load on nav ---------------------------------------------
  // Also init on page load so data is ready
  setTimeout(loadConversations, 1000);
})();
