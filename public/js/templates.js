/* ===================================================================
   templates.js — Message Templates (Saved Replies)
   CRUD management view + inline picker for conversation reply bar
   =================================================================== */

(function () {
  let _templates = [];
  let _editingId = null;

  const listEl = document.getElementById('tpl-list');
  const emptyEl = document.getElementById('tpl-empty');
  const countEl = document.getElementById('tpl-count');
  const addBtn = document.getElementById('tpl-add-btn');
  const editorCard = document.getElementById('tpl-editor');
  const editorTitle = document.getElementById('tpl-editor-title');
  const editorId = document.getElementById('tpl-editor-id');
  const editorTitleInput = document.getElementById('tpl-editor-title-input');
  const editorBody = document.getElementById('tpl-editor-body');
  const editorShortcut = document.getElementById('tpl-editor-shortcut');
  const saveBtn = document.getElementById('tpl-save-btn');
  const cancelBtn = document.getElementById('tpl-cancel-btn');
  const msgEl = document.getElementById('tpl-message');

  function showMsg(text, type) {
    msgEl.textContent = text;
    msgEl.className = 'form-message ' + (type || 'info');
    msgEl.style.display = '';
    setTimeout(() => { msgEl.style.display = 'none'; }, 3000);
  }

  function openEditor(tpl) {
    editorCard.style.display = '';
    if (tpl) {
      _editingId = tpl.id;
      editorTitle.textContent = 'Edit Template';
      editorTitleInput.value = tpl.title || '';
      editorBody.value = tpl.body || '';
      editorShortcut.value = tpl.shortcut || '';
    } else {
      _editingId = null;
      editorTitle.textContent = 'New Template';
      editorTitleInput.value = '';
      editorBody.value = '';
      editorShortcut.value = '';
    }
    editorCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function closeEditor() {
    editorCard.style.display = 'none';
    msgEl.style.display = 'none';
  }

  async function loadTemplates() {
    try {
      const res = await apiFetch('/api/templates');
      if (!res.ok) throw new Error('Failed to load');
      _templates = await res.json();
      renderTemplates();
    } catch (err) {
      console.error('Failed to load templates:', err);
    }
  }

  function renderTemplates() {
    if (!_templates || !_templates.length) {
      listEl.innerHTML = '';
      emptyEl.style.display = '';
      if (countEl) countEl.textContent = '';
      return;
    }
    emptyEl.style.display = 'none';
    if (countEl) countEl.textContent = _templates.length + ' template' + (_templates.length > 1 ? 's' : '');

    const fragment = document.createDocumentFragment();
    for (const tpl of _templates) {
      const card = document.createElement('div');
      card.className = 'kb-entry-card';

      const info = document.createElement('div');
      info.className = 'kb-entry-info';

      const titleEl = document.createElement('div');
      titleEl.className = 'kb-entry-title';
      titleEl.textContent = tpl.title || 'Untitled';

      const preview = document.createElement('div');
      preview.className = 'kb-entry-preview';
      preview.textContent = (tpl.body || '').slice(0, 200) + (tpl.body && tpl.body.length > 200 ? '…' : '');

      const meta = document.createElement('div');
      meta.className = 'kb-entry-meta';
      meta.textContent =
        (tpl.body?.length || 0) + ' chars' +
        (tpl.shortcut ? ' · shortcut: ' + tpl.shortcut : '') +
        ' · created ' + new Date(tpl.created_at).toLocaleDateString();

      info.appendChild(titleEl);
      info.appendChild(preview);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'kb-entry-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-secondary btn-sm';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => openEditor(tpl));

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger btn-sm';
      delBtn.textContent = '×';
      delBtn.title = 'Delete';
      delBtn.addEventListener('click', async () => {
        const ok = await showConfirm('Delete Template', 'Delete "' + (tpl.title || 'Untitled') + '"?');
        if (!ok) return;
        try {
          const res = await apiFetch('/api/templates/' + tpl.id, { method: 'DELETE' });
          if (!res.ok) throw new Error('Delete failed');
          await loadTemplates();
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

  // ---- Save handler ---------------------------------------------------
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const title = editorTitleInput.value.trim();
      const body = editorBody.value.trim();
      const shortcut = editorShortcut.value.trim();

      if (!title || !body) {
        showMsg('Title and body are required.', 'error');
        return;
      }

      saveBtn.disabled = true;
      try {
        let res;
        if (_editingId) {
          res = await apiFetch('/api/templates/' + _editingId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body, shortcut }),
          });
        } else {
          res = await apiFetch('/api/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body, shortcut }),
          });
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Save failed');
        }
        showMsg(_editingId ? 'Template updated.' : 'Template created.', 'success');
        closeEditor();
        await loadTemplates();
      } catch (err) {
        showMsg('Failed: ' + err.message, 'error');
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  if (cancelBtn) cancelBtn.addEventListener('click', closeEditor);
  if (addBtn) addBtn.addEventListener('click', () => openEditor(null));

  // =====================================================================
  // Template Picker — used inside the conversation reply bar
  // =====================================================================

  /**
   * Build and return a template picker button + popover element.
   * Call `window.__attachTemplatePicker(textarea, sendBtn)` to wire it up.
   */
  window.__attachTemplatePicker = function (textarea, sendBtn) {
    // Already attached?
    if (textarea.parentNode.querySelector('.tpl-picker-wrap')) return;

    const wrap = document.createElement('div');
    wrap.className = 'tpl-picker-wrap';
    wrap.style.cssText = 'position:relative;flex-shrink:0;';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'btn btn-secondary btn-sm';
    trigger.style.cssText = 'padding:2px 8px;font-size:10px;height:34px;';
    trigger.textContent = '📋';
    trigger.title = 'Insert template';

    const popover = document.createElement('div');
    popover.className = 'tpl-popover';
    popover.style.cssText =
      'display:none;position:absolute;bottom:100%;right:0;margin-bottom:4px;' +
      'background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-lg);' +
      'min-width:220px;max-width:320px;max-height:260px;overflow-y:auto;' +
      'z-index:500;box-shadow:0 4px 16px rgba(0,0,0,0.3);';

    const popoverList = document.createElement('div');
    popoverList.style.cssText = 'padding:4px;';
    popover.appendChild(popoverList);

    function renderPicker() {
      const templates = window.__cachedTemplates || [];
      popoverList.innerHTML = '';
      if (!templates.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:12px;font-size:11px;color:var(--text-tertiary);text-align:center;';
        empty.textContent = 'No templates. Create some in the Templates view.';
        popoverList.appendChild(empty);
        return;
      }
      for (const tpl of templates) {
        const item = document.createElement('div');
        item.style.cssText =
          'padding:6px 8px;border-radius:var(--radius-sm);cursor:pointer;' +
          'font-size:11px;color:var(--text-primary);transition:background var(--transition-fast);';
        item.onmouseenter = () => { item.style.background = 'var(--bg-hover)'; };
        item.onmouseleave = () => { item.style.background = 'transparent'; };

        const titleSpan = document.createElement('div');
        titleSpan.style.cssText = 'font-weight:600;font-size:11px;';
        titleSpan.textContent = tpl.title;

        const previewSpan = document.createElement('div');
        previewSpan.style.cssText = 'font-size:10px;color:var(--text-tertiary);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        previewSpan.textContent = (tpl.body || '').slice(0, 80);

        item.appendChild(titleSpan);
        item.appendChild(previewSpan);

        item.addEventListener('click', () => {
          textarea.value = tpl.body;
          textarea.focus();
          popover.style.display = 'none';
          // Trigger input event for send button state
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        });
        popoverList.appendChild(item);
      }
    }

    // Load templates into cache when picker is opened
    trigger.addEventListener('click', async () => {
      const isOpen = popover.style.display !== 'none';
      // Close any other open popovers
      document.querySelectorAll('.tpl-popover').forEach((p) => { if (p !== popover) p.style.display = 'none'; });
      popover.style.display = isOpen ? 'none' : '';
      if (!isOpen) {
        try {
          const res = await apiFetch('/api/templates');
          if (res.ok) {
            window.__cachedTemplates = await res.json();
          }
        } catch { /* ignore */ }
        renderPicker();
      }
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) {
        popover.style.display = 'none';
      }
    });

    wrap.appendChild(trigger);
    wrap.appendChild(popover);
    textarea.parentNode.insertBefore(wrap, sendBtn);
  };

  // Initial load
  loadTemplates();
})();
