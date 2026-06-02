/* ===================================================================
   config-editor.js — Bot Config view with rule CRUD & inline form
   =================================================================== */

// ---- State ----------------------------------------------------------
let _cfg = null;

// ---- Update internal config reference (called from app.js) ----------
function setBotConfig(cfg) {
  _cfg = cfg;
  populateForm(cfg);
}

// Called by app.js when config arrives but form shouldn't be touched
window.__updateCfg = function (cfg) {
  _cfg = cfg;
};

// ---- Load from window.currentConfig on DOM ready --------------------
function loadConfigFromWindow() {
  if (window.currentConfig) setBotConfig(window.currentConfig);
}
document.addEventListener('DOMContentLoaded', loadConfigFromWindow);
if (document.readyState !== 'loading') loadConfigFromWindow();

// ---- Populate top form fields + AI settings -------------------------
function populateForm(cfg) {
  if (!cfg) return;
  // Bot basics
  $('#cfg-bot-name').value        = cfg.botName || '';
  $('#cfg-default-reply').value   = cfg.defaultReply || '';
  $('#cfg-active').checked        = cfg.active !== false;
  $('#cfg-keep-session').checked  = cfg.keepSession !== false;

  // Rate limiting
  const rl = cfg.rateLimit || {};
  $('#cfg-rate-limit').value     = rl.maxPerMinute ?? 20;

  // Conversation timeout
  const ct = cfg.conversationTimeout || {};
  $('#cfg-timeout-enabled').checked = ct.enabled !== false;
  $('#cfg-timeout-hours').value     = ct.hours ?? 24;

  // AI Settings
  const ai = cfg.aiSettings || {};
  $('#ai-endpoint').value       = ai.endpoint || 'http://localhost:20128/v1';
  $('#ai-model').value          = ai.model || 'auto';
  $('#ai-system-prompt').value  = ai.systemPrompt || '';
  $('#ai-max-tokens').value     = ai.maxTokens ?? 500;
  $('#ai-temperature').value    = ai.temperature ?? 0.7;
  $('#ai-temp-display').textContent = ai.temperature ?? 0.7;
  updatePromptCounter();
}

// ---- Save Config button ---------------------------------------------
$('#cfg-save').addEventListener('click', () => {
  const msg = $('#cfg-message');
  socket.emit('config:save', {
    botName:      $('#cfg-bot-name').value,
    defaultReply: $('#cfg-default-reply').value,
    active:       $('#cfg-active').checked,
    keepSession:  $('#cfg-keep-session').checked,
    rateLimit: {
      maxPerMinute: parseInt($('#cfg-rate-limit').value, 10) || 20,
    },
    conversationTimeout: {
      enabled: $('#cfg-timeout-enabled').checked,
      hours: parseInt($('#cfg-timeout-hours').value, 10) || 24,
    },
  });
  msg.textContent = 'Configuration saved.';
  msg.className = 'form-message success';
  msg.style.display = '';
  setTimeout(() => { msg.style.display = 'none'; }, 2500);
});

// ---- Force logout (clear session) ----------------------------------------
$('#cfg-force-logout')?.addEventListener('click', async () => {
  const ok = await showConfirm('Force Logout', 'This will clear your WhatsApp session. You will need to scan the QR code again on the next message. Continue?');
  if (!ok) return;
  try {
    const res = await apiFetch('/api/whatsapp/logout', { method: 'POST' });
    if (!res.ok) throw new Error('Logout failed');
    showToast('Session cleared. The bot will generate a new QR code on the next message.', 'success');
  } catch (err) {
    showToast('Failed to logout: ' + err.message, 'error');
  }
});

// =====================================================================
// AI Settings panel — #view-ai
// =====================================================================

$('#ai-test-btn').addEventListener('click', async () => {
  const el = $('#ai-test-result');
  el.textContent = 'Testing…';
  el.style.color = 'var(--text-tertiary)';
  try {
    const res = await apiFetch('/api/router-health', { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data.connected) {
      el.textContent = '✓ Connected (' + new Date().toLocaleTimeString() + ')';
      el.style.color = 'var(--green)';
    } else {
      el.textContent = '✗ 9router not reachable at configured endpoint';
      el.style.color = 'var(--red)';
    }
  } catch (err) {
    el.textContent = '✗ Failed — ' + err.message;
    el.style.color = 'var(--red)';
  }
});

function updatePromptCounter() {
  const el = $('#ai-prompt-counter');
  if (el) el.textContent = ($('#ai-system-prompt')?.value?.length || 0) + ' chars';
}

$('#ai-save').addEventListener('click', () => {
  const msg = $('#ai-message');
  const aiSettings = {
    endpoint:         $('#ai-endpoint').value,
    model:            $('#ai-model').value,
    systemPrompt:     $('#ai-system-prompt').value,
    maxTokens:        parseInt($('#ai-max-tokens').value, 10) || 500,
    temperature:      parseFloat($('#ai-temperature').value) || 0.7,
  };
  socket.emit('config:save', { aiSettings });
  msg.textContent = 'AI settings saved.';
  msg.className = 'form-message success';
  msg.style.display = '';
  setTimeout(() => { msg.style.display = 'none'; }, 2500);
});


