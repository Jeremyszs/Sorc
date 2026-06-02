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
  let _searchQuery = '';
  let _searchTimer = null;
  let _searchActive = false;
  let _searchResults = [];

  // ---- Notes refs ---------------------------------------------------------
  const notesSection = document.getElementById('conv-notes-section');
  const notesToggle = document.getElementById('conv-notes-toggle');
  const notesChevron = document.getElementById('conv-notes-chevron');
  const notesCount = document.getElementById('conv-notes-count');
  const notesBody = document.getElementById('conv-notes-body');
  const notesList = document.getElementById('conv-notes-list');
  const notesEmpty = document.getElementById('conv-notes-empty');
  const notesLoading = document.getElementById('conv-notes-loading');
  const notesEditor = document.getElementById('conv-notes-editor');
  const notesEditorInput = document.getElementById('conv-notes-editor-input');
  const notesSaveBtn = document.getElementById('conv-notes-save-btn');
  const notesCancelBtn = document.getElementById('conv-notes-cancel-btn');
  const notesEditorMsg = document.getElementById('conv-notes-editor-msg');
  const notesAddBtn = document.getElementById('conv-notes-add-btn');
  const notesGenBtn = document.getElementById('conv-notes-gen-btn');
  const notesGenEmptyBtn = document.getElementById('conv-notes-gen-empty-btn');

  let _notes = [];
  let _notesOpen = false;
  let _editingNoteId = null;

  // ---- Search bar refs -----------------------------------------------------
  const searchInput = document.getElementById('conv-search-input');
  const searchClear = document.getElementById('conv-search-clear');
  const searchCount = document.getElementById('conv-search-count');

  function removeSearchEmpty() {
    if (_searchEmptyOriginal) {
      _searchEmptyOriginal.remove();
      _searchEmptyOriginal = null;
    }
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(_searchTimer);
      removeSearchEmpty();
      const val = searchInput.value.trim();
      if (!val) {
        _searchActive = false;
        _searchResults = [];
        if (searchClear) searchClear.style.display = 'none';
        if (searchCount) searchCount.style.display = 'none';
        loadConversations();
        return;
      }
      searchInput.style.background = 'var(--bg-hover)';
      _searchTimer = setTimeout(() => doSearch(val), 300);
    });
  }

  if (searchClear) {
    searchClear.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      removeSearchEmpty();
      _searchActive = false;
      _searchResults = [];
      searchClear.style.display = 'none';
      if (searchCount) searchCount.style.display = 'none';
      loadConversations();
    });
  }

  async function doSearch(q) {
    _searchQuery = q;
    removeSearchEmpty();
    try {
      const res = await apiFetch('/api/conversations/search?q=' + encodeURIComponent(q));
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      _searchResults = data.results || [];
      _searchActive = true;
      if (searchClear) searchClear.style.display = '';
      if (searchCount) {
        searchCount.textContent = data.total + ' match' + (data.total !== 1 ? 'es' : '');
        searchCount.style.display = '';
      }
      renderSearchResults();
    } catch (err) {
      console.error('Search error:', err);
    }
  }

  let _searchEmptyOriginal = null;

  function renderSearchResults() {
    listEl.innerHTML = '';
    emptyEl.style.display = 'none';
    if (headerCount) headerCount.textContent = '';

    if (!_searchResults || !_searchResults.length) {
      // Build the search-specific empty state
      const searchEmpty = document.createElement('div');
      searchEmpty.style.cssText = 'text-align:center;padding:var(--space-6) var(--space-4);color:var(--text-tertiary);';
      searchEmpty.innerHTML = '<svg class="empty-icon" viewBox="0 0 24 24" style="width:28px;height:28px;opacity:.3;stroke:currentColor;fill:none;stroke-width:1.5;display:block;margin:0 auto var(--space-2);"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><p style="font-size:11px;">No messages match &#8220;' + esc(_searchQuery) + '&#8221;</p>';
      if (emptyEl.parentNode) {
        emptyEl.style.display = 'none';
        emptyEl.parentNode.insertBefore(searchEmpty, emptyEl.nextSibling);
        _searchEmptyOriginal = searchEmpty;
      }
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const group of _searchResults) {
      const card = document.createElement('div');
      card.className = 'conv-card';
      card.dataset.phone = group.phone;
      card.addEventListener('click', () => openConversation(group.phone));

      const avatar = document.createElement('div');
      avatar.className = 'conv-avatar';
      avatar.textContent = (group.displayName || group.phone || '?').charAt(0).toUpperCase();

      const info = document.createElement('div');
      info.className = 'conv-info';

      const row1 = document.createElement('div');
      row1.className = 'conv-row1';
      const name = document.createElement('div');
      name.className = 'conv-name';
      name.textContent = group.displayName || group.phone || 'Unknown';
      const firstMsg = group.messages?.[0];
      const time = document.createElement('div');
      time.className = 'conv-time';
      time.textContent = firstMsg ? formatTime(firstMsg.timestamp) : '';
      row1.appendChild(name);
      row1.appendChild(time);

      // Show matching message(s) as previews
      for (const m of (group.messages || []).slice(0, 3)) {
        const preview = document.createElement('div');
        preview.className = 'conv-preview';
        preview.style.cssText = 'font-size:10.5px;color:var(--text-secondary);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        const dirLabel = m.direction === 'sent' ? '→ ' : '← ';
        preview.textContent = dirLabel + m.body;
        info.appendChild(preview);
      }

      card.appendChild(avatar);
      card.appendChild(info);
      fragment.appendChild(card);
    }
    listEl.appendChild(fragment);
  }

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
    if (_searchActive) return;
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
    if (_searchActive) return;
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

    // Reset notes state
    _notes = [];
    _notesOpen = false;
    _editingNoteId = null;
    if (notesSection) notesSection.style.display = 'none';
    if (notesBody) notesBody.style.display = 'none';
    if (notesEditor) notesEditor.style.display = 'none';
    closeNoteEditor();

    document.querySelectorAll('.conv-card').forEach((c) => c.classList.remove('selected'));

    try {
      const res = await apiFetch('/api/conversations/' + encodeURIComponent(phone) + '/messages');
      if (!res.ok) throw new Error('Failed to load messages');
      const data = await res.json();
      renderMessages(data.messages || []);
      markRead(phone);
      // Show notes section and load notes
      if (notesSection) notesSection.style.display = '';
      loadNotes(phone);
    } catch (err) {
      console.error('Failed to load messages:', err);
      emptyMsgEl.textContent = 'Failed to load messages.';
      emptyMsgEl.style.display = '';
      if (notesSection) notesSection.style.display = 'none';
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

  // ====================================================================
  // Notes (AI summaries) — functions
  // ====================================================================

  function showNotesLoading(show) {
    if (notesLoading) notesLoading.style.display = show ? '' : 'none';
    if (notesEmpty) notesEmpty.style.display = 'none';
  }

  async function loadNotes(phone) {
    if (!phone) return;
    try {
      const res = await apiFetch('/api/notes/' + encodeURIComponent(phone));
      if (!res.ok) throw new Error('Failed to load notes');
      _notes = await res.json();
      renderNotes();
      // Auto-generate if no notes exist
      if (!_notes || !_notes.length) {
        autoGenerateSummary(phone);
      }
    } catch (err) {
      console.error('Failed to load notes:', err);
      _notes = [];
      renderNotes();
    }
  }

  async function autoGenerateSummary(phone) {
    showNotesLoading(true);
    if (notesGenEmptyBtn) notesGenEmptyBtn.style.display = 'none';
    // Show the notes body with loading indicator
    if (notesBody) notesBody.style.display = '';
    if (notesChevron) notesChevron.style.transform = 'rotate(180deg)';
    _notesOpen = true;
    try {
      const res = await apiFetch('/api/notes/' + encodeURIComponent(phone) + '/generate', { method: 'POST' });
      if (!res.ok) throw new Error('Generation failed');
      const data = await res.json();
      if (data.empty) {
        showNotesLoading(false);
        if (notesList) notesList.innerHTML = '';
        if (notesList) notesList.style.display = '';
        if (notesEmpty) {
          notesEmpty.style.display = '';
          const emptyP = notesEmpty.querySelector('p');
          if (emptyP) emptyP.textContent = 'No messages to summarize.';
          if (notesGenEmptyBtn) notesGenEmptyBtn.style.display = 'none';
        }
        return;
      }
      // Reload notes from server
      await loadNotes(phone);
    } catch (err) {
      console.error('Summary generation failed:', err);
      showNotesLoading(false);
      if (notesList) notesList.style.display = '';
      if (notesEmpty) {
        notesEmpty.style.display = '';
        const emptyP = notesEmpty.querySelector('p');
        if (emptyP) emptyP.textContent = 'Could not generate summary.';
        if (notesGenEmptyBtn) notesGenEmptyBtn.style.display = '';
      }
    }
  }

  function renderNotes() {
    if (notesCount) {
      notesCount.textContent = _notes && _notes.length ? '(' + _notes.length + ')' : '';
    }
    // Always show action buttons when notes section is active
    if (notesGenBtn) {
      notesGenBtn.style.display = _notes && _notes.length ? '' : 'none';
    }
    if (notesAddBtn) {
      notesAddBtn.style.display = ''; // always visible so user can add notes
    }

    // Clear loading state
    if (notesLoading) notesLoading.style.display = 'none';
    if (notesList) notesList.style.display = '';

    if (!_notes || !_notes.length) {
      if (notesList) notesList.innerHTML = '';
      // Don't touch notesEmpty here — autoGenerateSummary manages it
      return;
    }

    if (notesEmpty) notesEmpty.style.display = 'none';

    // Auto-expand the notes section when there's content
    if (!_notesOpen) {
      _notesOpen = true;
      if (notesBody) notesBody.style.display = '';
      if (notesChevron) notesChevron.style.transform = 'rotate(180deg)';
    }

    const fragment = document.createDocumentFragment();
    for (const note of _notes) {
      const card = document.createElement('div');
      card.className = 'conv-note-card';
      card.dataset.noteId = note.id;

      // Note body
      const bodyEl = document.createElement('div');
      bodyEl.className = 'conv-note-body';
      bodyEl.textContent = note.body || '';

      // Meta: badge + author + timestamp
      const metaEl = document.createElement('div');
      metaEl.className = 'conv-note-meta';

      if (note.is_auto_generated) {
        const badge = document.createElement('span');
        badge.className = 'conv-note-badge ai';
        badge.textContent = 'AI';
        metaEl.appendChild(badge);
      } else {
        const badge = document.createElement('span');
        badge.className = 'conv-note-badge edited';
        badge.textContent = 'Edited';
        metaEl.appendChild(badge);
      }

      const author = note.author || 'Sorc AI';
      const timeStr = note.updated_at ? formatTime(note.updated_at) : '';
      metaEl.appendChild(document.createTextNode(author + ' · ' + timeStr));

      // Actions
      const actionsEl = document.createElement('div');
      actionsEl.className = 'conv-note-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-secondary btn-sm';
      editBtn.textContent = 'Edit';
      editBtn.style.cssText = 'font-size:8px;padding:1px 8px;';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openNoteEditor(note);
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger btn-sm';
      delBtn.textContent = 'Delete';
      delBtn.style.cssText = 'font-size:8px;padding:1px 8px;';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await showConfirm('Delete Note', 'Delete this note?');
        if (!ok) return;
        await deleteNote(note.id);
      });

      actionsEl.appendChild(editBtn);
      actionsEl.appendChild(delBtn);

      card.appendChild(bodyEl);
      card.appendChild(metaEl);
      card.appendChild(actionsEl);
      fragment.appendChild(card);
    }

    if (notesList) {
      notesList.innerHTML = '';
      notesList.appendChild(fragment);
    }
  }

  function openNoteEditor(note) {
    _editingNoteId = note ? note.id : null;
    if (notesEditorInput) notesEditorInput.value = note ? (note.body || '') : '';
    if (notesEditor) notesEditor.style.display = '';
    if (notesEditorMsg) notesEditorMsg.style.display = 'none';
    if (notesEditorInput) notesEditorInput.focus();
    if (notesSaveBtn) notesSaveBtn.textContent = note ? 'Update' : 'Save Note';
  }

  function closeNoteEditor() {
    _editingNoteId = null;
    if (notesEditorInput) notesEditorInput.value = '';
    if (notesEditor) notesEditor.style.display = 'none';
    if (notesEditorMsg) notesEditorMsg.style.display = 'none';
  }

  async function saveNote() {
    const body = notesEditorInput ? notesEditorInput.value.trim() : '';
    if (!body) {
      if (notesEditorMsg) {
        notesEditorMsg.textContent = 'Note cannot be empty.';
        notesEditorMsg.style.display = '';
      }
      return;
    }

    if (notesSaveBtn) notesSaveBtn.disabled = true;
    try {
      let res;
      if (_editingNoteId) {
        // Update existing note
        res = await apiFetch('/api/notes/' + _editingNoteId, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        });
      } else {
        // Create new note
        res = await apiFetch('/api/notes/' + encodeURIComponent(_currentPhone), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        });
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Save failed');
      }
      closeNoteEditor();
      await loadNotes(_currentPhone);
    } catch (err) {
      if (notesEditorMsg) {
        notesEditorMsg.textContent = 'Failed: ' + err.message;
        notesEditorMsg.style.display = '';
      }
    } finally {
      if (notesSaveBtn) notesSaveBtn.disabled = false;
    }
  }

  async function deleteNote(noteId) {
    try {
      const res = await apiFetch('/api/notes/' + noteId, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      await loadNotes(_currentPhone);
    } catch (err) {
      console.error('Failed to delete note:', err);
      if (typeof showToast === 'function') showToast('Failed to delete note', 'error');
    }
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

  // Attach template picker to the reply bar
  (function initTemplatePicker() {
    if (typeof window.__attachTemplatePicker === 'function' && replyInput && sendBtn) {
      window.__attachTemplatePicker(replyInput, sendBtn);
    }
  })();

  if (backBtn) backBtn.addEventListener('click', () => {
    _currentPhone = null;
    if (detailPane) detailPane.style.display = 'none';
    if (listPane) listPane.style.display = 'block';
    if (notesSection) notesSection.style.display = 'none';
    _notes = [];
    _notesOpen = false;
    closeNoteEditor();
  });

  // ---- Notes: event listeners ------------------------------------------

  if (notesToggle) {
    notesToggle.addEventListener('click', () => {
      _notesOpen = !_notesOpen;
      if (notesBody) notesBody.style.display = _notesOpen ? '' : 'none';
      if (notesChevron) notesChevron.style.transform = _notesOpen ? 'rotate(180deg)' : '';
    });
  }

  if (notesAddBtn) {
    notesAddBtn.addEventListener('click', () => {
      if (!_notesOpen) {
        _notesOpen = true;
        if (notesBody) notesBody.style.display = '';
        if (notesChevron) notesChevron.style.transform = 'rotate(180deg)';
      }
      openNoteEditor(null);
    });
  }

  if (notesGenBtn) {
    notesGenBtn.addEventListener('click', () => {
      autoGenerateSummary(_currentPhone);
    });
  }

  if (notesGenEmptyBtn) {
    notesGenEmptyBtn.addEventListener('click', () => {
      autoGenerateSummary(_currentPhone);
    });
  }

  if (notesSaveBtn) {
    notesSaveBtn.addEventListener('click', saveNote);
  }

  if (notesCancelBtn) {
    notesCancelBtn.addEventListener('click', closeNoteEditor);
  }

  if (notesEditorInput) {
    notesEditorInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveNote();
      }
    });
  }

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
