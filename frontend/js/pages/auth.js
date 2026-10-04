// Login and registration pages.
document.addEventListener('DOMContentLoaded', () => {
  const alertEl = document.getElementById('form-alert');

  // Show/hide password
  document.querySelectorAll('.password-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.getAttribute('aria-controls'));
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(show));
    });
  });

  // Messages passed via query string (e.g. after session expiry)
  const reason = new URLSearchParams(location.search).get('reason');
  if (reason === 'expired') UI.showAlert(alertEl, 'warning', 'Your session has expired. Please log in again.');
  if (reason === 'login') UI.showAlert(alertEl, 'info', 'Please log in to continue.');
  if (reason === 'logout') UI.showAlert(alertEl, 'success', 'You have been logged out.');

  // Already signed in? Go to the dashboard the server says we belong to.
  if (API.Session.token) {
    API.get('/auth/me', { redirectOn401: false })
      .then((d) => window.location.replace(d.redirectTo))
      .catch(() => API.Session.clear());
  }

  const form = document.getElementById('login-form') || document.getElementById('register-form');
  if (!form) return;
  const submit = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    UI.hideAlert(alertEl);
    UI.clearFieldErrors(form);

    // Light client-side checks for fast feedback only — the server re-validates everything.
    const missing = [...form.querySelectorAll('[required]')].filter((i) => !i.value.trim());
    if (missing.length) {
      UI.showFieldErrors(form, missing.map((i) => ({ field: i.name, message: `${form.querySelector(`label[for="${i.id}"]`).textContent} is required` })));
      return;
    }

    const isLogin = form.id === 'login-form';
    UI.setLoading(submit, true, isLogin ? 'Logging in…' : 'Creating account…');
    try {
      const data = isLogin
        ? await API.post('/auth/login', UI.formData(form), { redirectOn401: false })
        : await API.post(form.dataset.endpoint, UI.formData(form));
      API.Session.save(data.token, data.user);
      window.location.replace(data.redirectTo);
    } catch (err) {
      UI.setLoading(submit, false);
      if (err.code === 'VALIDATION_ERROR') {
        UI.showFieldErrors(form, err.details);
        UI.showAlert(alertEl, 'error', err.message);
      } else if (err.code === 'DUPLICATE_EMAIL') {
        UI.showFieldErrors(form, [{ field: 'email', message: err.message }]);
        UI.showAlert(alertEl, 'error', err.message);
      } else if (err.code === 'DUPLICATE_LICENSE') {
        UI.showFieldErrors(form, [{ field: 'licenseNumber', message: err.message }]);
        UI.showAlert(alertEl, 'error', err.message);
      } else {
        UI.showAlert(alertEl, 'error', err.message);
      }
    }
  });
});
