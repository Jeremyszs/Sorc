/* ===================================================================
   knowledge-base.js — Multi-entry Knowledge Base
   Each save creates a new entry. List shows all entries with edit/delete.
   buildContext() concatenates all entries for the AI prompt.
   =================================================================== */

(function () {
  const listEl = $('#kb-entry-list');
  const emptyEl = $('#kb-empty');
  const addBtn = $('#kb-add');
  const editorCard = $('#kb-editor-card');
  const editorTitle = $('#kb-editor-title');
  const editorId = $('#kbe-id');
  const editorTitleInput = $('#kbe-title');
  const editorContent = $('#kbe-content');
  const editorSaveBtn = $('#kbe-save');
  const editorCancelBtn = $('#kbe-cancel');
  const editorMsg = $('#kbe-message');
  const clearAllBtn = $('#kb-clear');

  let _entries = [];

  function showEditorMsg(text, type) {
    editorMsg.textContent = text;
    editorMsg.className = 'form-message ' + (type || 'info');
    editorMsg.style.display = '';
    setTimeout(() => { editorMsg.style.display = 'none'; }, 3000);
  }

  function openEditor(entry) {
    editorCard.style.display = '';
    if (entry) {
      editorTitle.textContent = 'Edit Entry';
      editorId.value = entry.id;
      editorTitleInput.value = entry.title || '';
      editorContent.value = entry.content || '';
    } else {
      editorTitle.textContent = 'New Knowledge Entry';
      editorId.value = '';
      editorTitleInput.value = '';
      editorContent.value = '';
    }
    editorCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function closeEditor() {
    editorCard.style.display = 'none';
    editorMsg.style.display = 'none';
  }

  async function loadEntries() {
    try {
      const res = await fetch('/api/knowledge');
      if (!res.ok) throw new Error('Failed to load');
      _entries = await res.json();
      renderEntries();
      updateStats();
    } catch (err) {
      console.error('Failed to load knowledge entries:', err);
    }
  }

  function renderEntries() {
    if (!_entries || !_entries.length) {
      listEl.innerHTML = '';
      emptyEl.style.display = '';
      return;
    }
    emptyEl.style.display = 'none';

    const fragment = document.createDocumentFragment();

    for (const entry of _entries) {
      const card = document.createElement('div');
      card.className = 'kb-entry-card';
      card.style.cssText =
        'background:var(--surface);border:1px solid var(--glass-border);border-radius:var(--radius-sm);padding:14px 16px;margin-bottom:8px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;';

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';

      const titleEl = document.createElement('div');
      titleEl.style.cssText = 'font-weight:600;font-size:14px;color:var(--text-primary);';
      titleEl.textContent = entry.title || 'Untitled';

      const preview = document.createElement('div');
      preview.style.cssText = 'font-size:12px;color:var(--text-secondary);margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;';
      preview.textContent = entry.content?.slice(0, 200) + (entry.content?.length > 200 ? '…' : '');

      const meta = document.createElement('div');
      meta.style.cssText = 'font-size:10px;color:var(--text-tertiary);margin-top:4px;';
      meta.textContent =
        (entry.content?.length || 0) + ' chars' +
        ' · created ' + new Date(entry.created_at).toLocaleDateString();

      info.appendChild(titleEl);
      info.appendChild(preview);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:6px;flex-shrink:0;align-items:center;';

      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-secondary btn-sm';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => openEditor(entry));

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger btn-sm';
      delBtn.style.cssText = 'padding:4px 10px;font-size:11px;background:var(--red);color:#fff;border:none;border-radius:6px;cursor:pointer;';
      delBtn.textContent = '×';
      delBtn.title = 'Delete';
      delBtn.addEventListener('click', async () => {
        if (!window.confirm('Delete "' + (entry.title || 'Untitled') + '"?')) return;
        try {
          const res = await fetch('/api/knowledge/' + entry.id, { method: 'DELETE' });
          if (!res.ok) throw new Error('Delete failed');
          await loadEntries();
        } catch (err) {
          console.error('Delete error:', err);
        }
      });

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      card.appendChild(info);
      card.appendChild(actions);
      fragment.appendChild(card);
    }

    listEl.innerHTML = '';
    listEl.appendChild(fragment);
  }

  function updateStats() {
    const total = _entries.length;
    const chars = _entries.reduce((s, e) => s + (e.content?.length || 0), 0);

    const dashEl = $('#dash-kb-chunks');
    if (dashEl) dashEl.textContent = total ? total + ' entries' : '—';

    const headerEl = $('#kb-stats-header');
    if (headerEl) headerEl.textContent = total + ' entries' + (chars ? ' · ' + chars.toLocaleString() + ' chars' : '');

    // Also update via socket for other views
    const socketStats = { entries: total, chars };
    window._kbStats = socketStats;

    const kbEntries = $('#kb-entries-count');
    if (kbEntries) kbEntries.textContent = total;
    const kbChars = $('#kb-chars');
    if (kbChars) kbChars.textContent = chars.toLocaleString();
  }

  // ---- Save (create or update) ----
  editorSaveBtn.addEventListener('click', async () => {
    const id = editorId.value;
    const title = editorTitleInput.value.trim();
    const content = editorContent.value;

    if (!content || !content.trim()) {
      showEditorMsg('Content is required.', 'error');
      return;
    }

    editorSaveBtn.disabled = true;
    try {
      let res;
      if (id) {
        // Update existing
        res = await fetch('/api/knowledge/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content }),
        });
      } else {
        // Create new
        res = await fetch('/api/knowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content }),
        });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Save failed');
      }

      showEditorMsg(id ? 'Entry updated.' : 'Entry created.', 'success');
      closeEditor();
      await loadEntries();
    } catch (err) {
      showEditorMsg('Failed: ' + err.message, 'error');
    } finally {
      editorSaveBtn.disabled = false;
    }
  });

  editorCancelBtn.addEventListener('click', closeEditor);
  addBtn.addEventListener('click', () => openEditor(null));

  // Clear all
  clearAllBtn.addEventListener('click', async () => {
    if (!window.confirm('Delete ALL knowledge entries?')) return;
    try {
      const res = await fetch('/api/knowledge', { method: 'DELETE' });
      if (!res.ok) throw new Error('Clear failed');
      await loadEntries();
    } catch (err) {
      console.error('Clear error:', err);
    }
  });

  // ---- Preview Context (P2-10) ------------------------------------------

  const previewBtn = document.getElementById('kb-preview');
  if (previewBtn) {
    previewBtn.addEventListener('click', async () => {
      const overlay = document.getElementById('kb-preview-overlay');
      const contentEl = document.getElementById('kb-preview-content');
      const infoEl = document.getElementById('kb-preview-info');
      const emptyEl = document.getElementById('kb-preview-empty');

      overlay.style.display = 'flex';

      try {
        const res = await fetch('/api/knowledge/preview');
        if (!res.ok) throw new Error('Failed to load preview');
        const data = await res.json();

        if (data.context) {
          contentEl.textContent = data.context;
          contentEl.style.display = '';
          infoEl.textContent = data.entriesCount + ' entries · ' + data.totalChars.toLocaleString() + ' chars';
          infoEl.style.display = '';
          emptyEl.style.display = 'none';
        } else {
          contentEl.style.display = 'none';
          infoEl.style.display = 'none';
          emptyEl.style.display = '';
        }
      } catch (err) {
        contentEl.textContent = 'Error: ' + err.message;
        contentEl.style.display = '';
        infoEl.style.display = 'none';
        emptyEl.style.display = 'none';
      }
    });
  }

  const closeBtn = document.getElementById('kb-preview-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      document.getElementById('kb-preview-overlay').style.display = 'none';
    });
  }

  // Close on overlay click (outside the glass)
  const overlayEl = document.getElementById('kb-preview-overlay');
  if (overlayEl) {
    overlayEl.addEventListener('click', (e) => {
      if (e.target === overlayEl) overlayEl.style.display = 'none';
    });
  }

  // Listen for socket kb:stats updates — socket is from app.js
  if (typeof socket !== 'undefined') {
    socket.on('kb:stats', (stats) => {
      if (stats && typeof stats.entries !== 'undefined') {
        loadEntries();
      }
    });
  }

  // Initial load
  loadEntries();
})();
