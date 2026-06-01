/* ===================================================================
   auth.js — Dashboard password authentication
   =================================================================== */

(function () {
  const STORAGE_KEY = 'waha-auth-token';
  const LOGIN_OVERLAY = document.getElementById('login-overlay');
  const LOGIN_FORM = document.getElementById('login-form');
  const LOGIN_PASSWORD = document.getElementById('login-password');
  const LOGIN_ERROR = document.getElementById('login-error');
  const LOGIN_SUBMIT = document.getElementById('login-submit');
  const LOGIN_LOADING = document.getElementById('login-loading');
  const DASHBOARD = document.getElementById('dashboard-content');

  const token = localStorage.getItem(STORAGE_KEY);

  let authed = false;

  function showLogin() {
    if (LOGIN_OVERLAY) LOGIN_OVERLAY.style.display = '';
    if (DASHBOARD) DASHBOARD.style.display = 'none';
    authed = false;
  }

  function showDashboard() {
    if (LOGIN_OVERLAY) LOGIN_OVERLAY.style.display = 'none';
    if (DASHBOARD) DASHBOARD.style.display = '';
    authed = true;
  }

  // If a token exists, show dashboard immediately (it will be validated by 401 responses)
  if (token) {
    showDashboard();
  } else {
    showLogin();
  }

  // Expose the token for socket init
  window.__authToken = token;

  // Login submission
  if (LOGIN_FORM) {
    LOGIN_FORM.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = LOGIN_PASSWORD.value.trim();
      if (!password) return;

      LOGIN_SUBMIT.disabled = true;
      LOGIN_SUBMIT.style.display = 'none';
      if (LOGIN_LOADING) LOGIN_LOADING.style.display = '';
      LOGIN_ERROR.textContent = '';
      LOGIN_ERROR.style.display = 'none';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Login failed');
        }

        localStorage.setItem(STORAGE_KEY, data.token);
        window.__authToken = data.token;
        showDashboard();
        // Reload the page so app.js re-initializes socket with the token
        window.location.reload();
      } catch (err) {
        LOGIN_ERROR.textContent = err.message || 'Invalid password';
        LOGIN_ERROR.style.display = '';
        LOGIN_SUBMIT.disabled = false;
        LOGIN_SUBMIT.style.display = '';
        if (LOGIN_LOADING) LOGIN_LOADING.style.display = 'none';
      }
    });
  }

  // Logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEY);
      window.__authToken = null;
      window.location.reload();
    });
  }

  // If the page was loaded with a stored token and we get a 401, clear and show login
  window.__handleAuthError = function () {
    localStorage.removeItem(STORAGE_KEY);
    window.__authToken = null;
    showLogin();
  };
})();
