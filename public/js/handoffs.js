/* ===================================================================
   handoffs.js — Human Handoff view
   =================================================================== */

(function () {
  const listEl = $('#handoff-list');
  const emptyEl = $('#handoff-empty');

  /**
   * Render the handoff list from window._handoffList (populated from
   * the socket 'handoff:list' event).
   */
  window.renderHandoffs = function () {
    const list = window._handoffList || [];
    if (!list || !list.length) {
      listEl.innerHTML = '';
      emptyEl.style.display = '';
      return;
    }

    emptyEl.style.display = 'none';
    const fragment = document.createDocumentFragment();

    for (const item of list) {
      const card = document.createElement('div');
      card.className = 'handoff-card';
      if (item.human_intervention_requested === 1) {
        card.classList.add('needs-human');
      }

      const info = document.createElement('div');
      info.className = 'info';

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
      timeEl.style.cssText = 'font-size:11px;color:var(--text-tertiary);margin-left:8px;';
      timeEl.textContent = 'Last updated: ' + updated;

      statusEl.appendChild(tag);
      statusEl.appendChild(timeEl);
      info.appendChild(phoneEl);
      info.appendChild(statusEl);

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';

      if (item.human_intervention_requested === 1) {
        // Reset button — send back to bot mode
        const resetBtn = document.createElement('button');
        resetBtn.className = 'btn btn-success btn-sm';
        resetBtn.textContent = 'Resume Bot';
        resetBtn.addEventListener('click', async () => {
          try {
            const res = await fetch('/api/handoffs/' + encodeURIComponent(item.phone) + '/reset', {
              method: 'POST',
            });
            if (!res.ok) throw new Error('Reset failed');
          } catch (err) {
            console.error('Handoff reset error:', err);
          }
        });
        actions.appendChild(resetBtn);
      } else {
        // Disable button — manually flag for human intervention
        const disableBtn = document.createElement('button');
        disableBtn.className = 'btn btn-danger btn-sm';
        disableBtn.textContent = 'Request Human';
        disableBtn.addEventListener('click', async () => {
          try {
            const res = await fetch('/api/handoffs/' + encodeURIComponent(item.phone) + '/disable', {
              method: 'POST',
            });
            if (!res.ok) throw new Error('Failed');
          } catch (err) {
            console.error('Handoff disable error:', err);
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
