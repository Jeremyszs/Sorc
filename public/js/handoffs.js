/* ===================================================================
   handoffs.js — Human Handoff view with selection-based delete
   =================================================================== */

(function () {
  const listEl = $('#handoff-list');
  const emptyEl = $('#handoff-empty');

  let _selectedPhones = new Set();
  let _selectionMode = false;

  // ---- Selection bar ----------------------------------------------------
  const selectionBar = document.createElement('div');
  selectionBar.style.cssText = 'display:none;align-items:center;gap:var(--space-3);padding:0 0 var(--space-3) 0;';
  selectionBar.innerHTML =
    '<span id="hoff-sel-count" style="font-size:11px;color:var(--text-secondary);flex:1;"></span>' +
    '<button id="hoff-sel-delete" class="btn btn-danger btn-sm">Delete Selected</button>' +
    '<button id="hoff-sel-cancel" class="btn btn-secondary btn-sm">Cancel</button>';

  const bodyParent = listEl.parentNode;
  bodyParent.insertBefore(selectionBar, listEl);

  const selCountEl = document.getElementById('hoff-sel-count');
  const selDeleteBtn = document.getElementById('hoff-sel-delete');
  const selCancelBtn = document.getElementById('hoff-sel-cancel');

  if (selCancelBtn) {
    selCancelBtn.addEventListener('click', () => {
      _selectedPhones.clear();
      _selectionMode = false;
      selectionBar.style.display = 'none';
      window.renderHandoffs();
    });
  }

  if (selDeleteBtn) {
    selDeleteBtn.addEventListener('click', async () => {
      const count = _selectedPhones.size;
      if (count === 0) return;
      const ok = await showConfirm(
        'Delete Handoffs',
        'Delete ' + count + ' handoff record' + (count > 1 ? 's' : '') + '? This cannot be undone.'
      );
      if (!ok) return;
      const phones = [..._selectedPhones];
      selDeleteBtn.disabled = true;
      try {
        const res = await apiFetch('/api/handoffs', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phones }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Batch delete failed (status ' + res.status + ')');
        }
        showToast('Deleted ' + count + ' handoff' + (count > 1 ? 's' : ''), 'success');
        _selectedPhones.clear();
        _selectionMode = false;
        selectionBar.style.display = 'none';
        // Re-fetch handoff list via API
        const fresh = await apiFetch('/api/handoffs');
        if (fresh.ok) {
          window._handoffList = await fresh.json();
          window.renderHandoffs();
        }
      } catch (err) {
        console.error('Batch delete handoffs error:', err);
        showToast(err.message, 'error');
      } finally {
        selDeleteBtn.disabled = false;
      }
    });
  }

  // ---- Toggle selection mode --------------------------------------------
  function ensureSelectionToggle() {
    const header = document.querySelector('#view-handoffs .swiss-card-header');
    if (!header || header.querySelector('#hoff-sel-toggle-btn')) return;
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'hoff-sel-toggle-btn';
    toggleBtn.className = 'btn btn-secondary btn-sm';
    toggleBtn.textContent = 'Select';
    toggleBtn.style.cssText = 'padding:2px 10px;font-size:9px;';
    toggleBtn.addEventListener('click', () => {
      _selectionMode = !_selectionMode;
      if (!_selectionMode) {
        _selectedPhones.clear();
        selectionBar.style.display = 'none';
      }
      window.renderHandoffs();
    });
    header.appendChild(toggleBtn);
  }

  /**
   * Render the handoff list from window._handoffList (populated from
   * the socket 'handoff:list' event).
   */
  window.renderHandoffs = function () {
    const list = window._handoffList || [];

    ensureSelectionToggle();

    // Update selection bar header button text
    if (_selectionMode) {
      selCountEl.textContent = _selectedPhones.size + ' selected';
      const toggleBtn = document.querySelector('#hoff-sel-toggle-btn');
      if (toggleBtn) toggleBtn.textContent = 'Cancel';
      selectionBar.style.display = 'flex';
    } else {
      selectionBar.style.display = 'none';
      const toggleBtn = document.querySelector('#hoff-sel-toggle-btn');
      if (toggleBtn) toggleBtn.textContent = 'Select';
    }

    if (!list || !list.length) {
      listEl.innerHTML = '';
      emptyEl.style.display = '';
      return;
    }

    emptyEl.style.display = 'none';
    const fragment = document.createDocumentFragment();

    for (const item of list) {
      const isSelected = _selectedPhones.has(item.phone);
      const card = document.createElement('div');
      card.className = 'handoff-card';
      if (isSelected) card.style.borderColor = 'var(--accent)';
      if (item.human_intervention_requested === 1) {
        card.classList.add('needs-human');
      }

      if (_selectionMode) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = isSelected;
        cb.style.cssText = 'width:12px;height:12px;flex-shrink:0;accent-color:var(--accent);cursor:pointer;';
        cb.addEventListener('change', () => {
          if (cb.checked) _selectedPhones.add(item.phone);
          else _selectedPhones.delete(item.phone);
          selCountEl.textContent = _selectedPhones.size + ' selected';
          card.style.borderColor = cb.checked ? 'var(--accent)' : '';
          if (!cb.checked && !item.human_intervention_requested) card.style.borderColor = '';
        });
        card.prepend(cb);
      }

      const info = document.createElement('div');
      info.className = 'info';
      info.style.flex = '1';

      const phoneEl = document.createElement('div');
      phoneEl.className = 'phone';
      phoneEl.textContent = item.phone;

      const statusEl = document.createElement('div');
      statusEl.className = 'status';

      const tag = document.createElement('span');
      tag.className = 'tag';
      if (item.human_intervention_requested === 1) {
        tag.className += ' tag-human';
        tag.textContent = '🧑 Needs Human';
      } else {
        tag.className += ' tag-bot';
        tag.textContent = '🤖 Bot Active';
      }

      const updated = new Date(item.updated_at).toLocaleString();
      const timeEl = document.createElement('span');
      timeEl.className = 'handoff-time';
      timeEl.textContent = 'Last updated: ' + updated;

      statusEl.appendChild(tag);
      statusEl.appendChild(timeEl);
      info.appendChild(phoneEl);
      info.appendChild(statusEl);

      const actions = document.createElement('div');
      actions.className = 'handoff-actions';

      if (item.human_intervention_requested === 1) {
        const resetBtn = document.createElement('button');
        resetBtn.className = 'btn btn-success btn-sm';
        resetBtn.textContent = 'Resume Bot';
        resetBtn.addEventListener('click', async () => {
          try {
            const res = await apiFetch('/api/handoffs/' + encodeURIComponent(item.phone) + '/reset', {
              method: 'POST',
            });
            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              throw new Error(errData.error || 'Reset failed (status ' + res.status + ')');
            }
          } catch (err) {
            console.error('Handoff reset error:', err);
            showToast(err.message, 'error');
          }
        });
        actions.appendChild(resetBtn);
      } else {
        const disableBtn = document.createElement('button');
        disableBtn.className = 'btn btn-danger btn-sm';
        disableBtn.textContent = 'Request Human';
        disableBtn.addEventListener('click', async () => {
          try {
            const res = await apiFetch('/api/handoffs/' + encodeURIComponent(item.phone) + '/disable', {
              method: 'POST',
            });
            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              throw new Error(errData.error || 'Failed (status ' + res.status + ')');
            }
          } catch (err) {
            console.error('Handoff disable error:', err);
            showToast(err.message, 'error');
          }
        });
        actions.appendChild(disableBtn);
      }

      card.appendChild(info);
      card.appendChild(actions);
      fragment.appendChild(card);
    }

    listEl.innerHTML = '';
    listEl.appendChild(fragment);
  };

  // No-op if list hasn't loaded yet — it's re-triggered by socket event
})();
