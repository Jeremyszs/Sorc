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
  let _refreshTimer = null;
  let _selectionMode = false;
  let _selectedPhones = new Set();

  // ---- Selection bar (inserted above the list) --------------------------
  const selectionBar = document.createElement('div');
  selectionBar.style.cssText = 'display:none;align-items:center;gap:var(--space-3);padding:0 0 var(--space-3) 0;';
  selectionBar.innerHTML =
    '<span id="conv-sel-count" style="font-size:11px;color:var(--text-secondary);flex:1;"></span>' +
    '<button id="conv-sel-delete" class="btn btn-danger btn-sm">Delete Selected</button>' +
    '<button id="conv-sel-cancel" class="btn btn-secondary btn-sm">Cancel</button>';
  const listBody = listEl.parentNode;
  listBody.insertBefore(selectionBar, listEl);

  const selCountEl = document.getElementById('conv-sel-count');
  const selDeleteBtn = document.getElementById('conv-sel-delete');
  const selCancelBtn = document.getElementById('conv-sel-cancel');

  if (selCancelBtn) {
    selCancelBtn.addEventListener('click', () => {
      _selectedPhones.clear();
      _selectionMode = false;
      selectionBar.style.display = 'none';
      renderConversations();
    });
  }

  if (selDeleteBtn) {
    selDeleteBtn.addEventListener('click', async () => {
      const count = _selectedPhones.size;
      if (count === 0) return;
      const ok = await showConfirm(
        'Delete Conversations',
        'Delete ' + count + ' conversation' + (count > 1 ? 's' : '') + ' and all their messages? This cannot be undone.'
      );
      if (!ok) return;
      const phones = [..._selectedPhones];
      selDeleteBtn.disabled = true;
      try {
        const res = await apiFetch('/api/conversations', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phones }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Batch delete failed (status ' + res.status + ')');
        }
        showToast('Deleted ' + count + ' conversation' + (count > 1 ? 's' : ''), 'success');
        _selectedPhones.clear();
        _selectionMode = false;
        selectionBar.style.display = 'none';
        // Re-fetch data immediately
        await loadConversations();
        if (_currentPhone) {
          const refresh = await apiFetch('/api/conversations/' + encodeURIComponent(_currentPhone) + '/messages');
          if (refresh.ok) {
            const data = await refresh.json();
            renderMessages(data.messages || []);
          } else if (refresh.status === 404) {
            // Conversation was deleted — go back to list
            _currentPhone = null;
            if (detailPane) detailPane.style.display = 'none';
            if (listPane) listPane.style.display = 'block';
          }
        }
      } catch (err) {
        console.error('Batch delete error:', err);
        showToast(err.message, 'error');
      } finally {
        selDeleteBtn.disabled = false;
      }
    });
  }

  // ---- Toggle selection mode from header ---------------------------------
  function ensureSelectionToggle() {
    const header = listPane?.querySelector('.swiss-card-header');
    if (!header || header.querySelector('#conv-sel-toggle-btn')) return;
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'conv-sel-toggle-btn';
    toggleBtn.className = 'btn btn-secondary btn-sm';
    toggleBtn.textContent = 'Select';
    toggleBtn.style.cssText = 'padding:2px 10px;font-size:9px;';
    toggleBtn.addEventListener('click', () => {
      _selectionMode = !_selectionMode;
      if (!_selectionMode) {
        _selectedPhones.clear();
        selectionBar.style.display = 'none';
      }
      renderConversations();
    });
    header.appendChild(toggleBtn);
  }
  ensureSelectionToggle();

  // ---- Load conversation list -----------------------------------------

  async function loadConversations() {
    try {
      const res = await apiFetch('/api/conversations');
      if (!res.ok) {
        if (res.status === 401) return;
        throw new Error('Failed to load');
      }
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
      selectionBar.style.display = 'none';
      return;
    }
    emptyEl.style.display = 'none';
    if (headerCount) headerCount.textContent = _conversations.length + ' conversations';

    // Update selection bar
    if (_selectionMode) {
      selCountEl.textContent = _selectedPhones.size + ' selected';
      const selToggle = document.querySelector('#conv-sel-toggle-btn');
      if (selToggle) selToggle.textContent = 'Cancel';
      selectionBar.style.display = 'flex';
    } else {
      selectionBar.style.display = 'none';
      const selToggle = document.querySelector('#conv-sel-toggle-btn');
      if (selToggle) selToggle.textContent = 'Select';
    }

    const fragment = document.createDocumentFragment();

    for (const conv of _conversations) {
      const card = document.createElement('div');
      const isSelected = _selectedPhones.has(conv.phone);
      card.className = 'conv-card' + (conv.phone === _currentPhone ? ' selected' : '');
      if (isSelected) card.style.borderColor = 'var(--accent)';
      card.dataset.phone = conv.phone;

      if (_selectionMode) {
        // Selection mode — checkbox replaces click-to-open
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = isSelected;
        cb.style.cssText = 'width:12px;height:12px;margin-top:7px;flex-shrink:0;accent-color:var(--accent);cursor:pointer;';
        cb.addEventListener('change', () => {
          if (cb.checked) _selectedPhones.add(conv.phone);
          else _selectedPhones.delete(conv.phone);
          selCountEl.textContent = _selectedPhones.size + ' selected';
          card.style.borderColor = cb.checked ? 'var(--accent)' : 'transparent';
        });
        card.appendChild(cb);
      } else {
        card.addEventListener('click', () => openConversation(conv.phone));
      }

      const avatar = document.createElement('div');
      avatar.className = 'conv-avatar';
      avatar.textContent = (conv.displayName || conv.phone || '?').charAt(0).toUpperCase();

      const info = document.createElement('div');
      info.className = 'conv-info';

      const row1 = document.createElement('div');
      row1.className = 'conv-row1';

      const name = document.createElement('div');
      name.className = 'conv-name';
      name.textContent = conv.displayName || conv.phone || 'Unknown';

      const time = document.createElement('div');
      time.className = 'conv-time';
      time.textContent = conv.lastTime ? formatTime(conv.lastTime) : '';

      row1.appendChild(name);
      row1.appendChild(time);

      const preview = document.createElement('div');
      preview.className = 'conv-preview';
      preview.textContent = conv.lastPreview || '';

      const row2 = document.createElement('div');
      row2.className = 'conv-row2';

      if (conv.needsHuman) {
        const tag = document.createElement('span');
        tag.className = 'conv-tag human';
        tag.textContent = 'Needs Human';
        row2.appendChild(tag);
      } else if (conv.botMode === false || conv.botMode === 0) {
        const tag = document.createElement('span');
        tag.className = 'conv-tag paused';
        tag.textContent = 'Paused';
        row2.appendChild(tag);
      }

      if (conv.unread > 0) {
        const badge = document.createElement('span');
        badge.className = 'conv-badge';
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
    const loadingEl = document.createElement('div');
    loadingEl.className = 'empty-state';
    loadingEl.style.cssText = 'padding:40px;color:var(--text-tertiary);font-size:11px;';
    loadingEl.textContent = 'Loading messages…';
    messagesEl.innerHTML = '';
    messagesEl.appendChild(loadingEl);
    emptyMsgEl.style.display = 'none';
    sendError.style.display = 'none';
    replyInput.value = '';

    document.querySelectorAll('.conv-card').forEach((c) => c.classList.remove('selected'));

    try {
      const res = await apiFetch('/api/conversations/' + encodeURIComponent(phone) + '/messages');
      if (!res.ok) throw new Error('Failed to load messages');
      const data = await res.json();
      renderMessages(data.messages || []);
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
      bubble.classList.add('conv-bubble', isReceived ? 'received' : 'sent');

      const body = document.createElement('div');
      body.textContent = m.body || '';

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = m.timestamp ? formatTime(m.timestamp) + (m.is_ai_reply ? ' · AI' : '') : '';

      bubble.appendChild(body);
      bubble.appendChild(meta);
      messagesEl.appendChild(bubble);
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---- Send reply ------------------------------------------------------

  async function sendReply() {
    const message = replyInput.value.trim();
    if (!message || !_currentPhone) return;

    sendBtn.disabled = true;
    sendError.style.display = 'none';

    try {
      const res = await apiFetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: _currentPhone, message }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Send failed');
      }
      replyInput.value = '';
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

  // ---- Mark as read ----------------------------------------------------

  function markRead(phone) {
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

  // ---- Gentle in-place refresh -----------------------------------------

  async function refreshCurrentConversation() {
    if (!_currentPhone) return;
    try {
      const res = await apiFetch('/api/conversations/' + encodeURIComponent(_currentPhone) + '/messages');
      if (!res.ok) throw new Error('Failed to load messages');
      const data = await res.json();
      renderMessages(data.messages || []);
    } catch (err) {
      console.error('Failed to refresh conversation:', err);
    }
  }

  // ---- Socket events ---------------------------------------------------

  if (typeof socket !== 'undefined') {
    socket.on('conversations:update', () => {
      const viewActive = document.getElementById('view-conversations')?.classList.contains('active');
      if (viewActive) loadConversations();
      if (_currentPhone) {
        clearTimeout(_refreshTimer);
        _refreshTimer = setTimeout(refreshCurrentConversation, 400);
      }
    });
  }

  // ---- Public API ------------------------------------------------------

  window.renderConversations = loadConversations;
  window.__refreshCurrentConversation = refreshCurrentConversation;

  setTimeout(loadConversations, 1000);
})();
