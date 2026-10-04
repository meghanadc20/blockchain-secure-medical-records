/** Shared UI helpers: alerts, field errors, button loading, safe text, badges, formatting. */
(function () {
  const UI = {
    /** Escape untrusted text before inserting as HTML. */
    esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    showAlert(el, type, message) {
      if (!el) return;
      el.className = `alert alert-${type}`;
      el.textContent = message;
      el.hidden = false;
      el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    },
    hideAlert(el) { if (el) { el.hidden = true; el.textContent = ''; } },

    clearFieldErrors(form) {
      form.querySelectorAll('[aria-invalid="true"]').forEach((i) => i.removeAttribute('aria-invalid'));
      form.querySelectorAll('.field-error').forEach((e) => { e.textContent = ''; });
    },
    /** details: [{ field, message }] from the API. Returns true if any were shown. */
    showFieldErrors(form, details) {
      let shown = false;
      (details || []).forEach(({ field, message }) => {
        const input = form.querySelector(`[name="${field}"]`);
        const slot = form.querySelector(`[data-error-for="${field}"]`);
        if (input) input.setAttribute('aria-invalid', 'true');
        if (slot) { slot.textContent = message; shown = true; }
      });
      const first = form.querySelector('[aria-invalid="true"]');
      if (first) first.focus();
      return shown;
    },

    setLoading(button, loading, label) {
      if (!button) return;
      if (loading) {
        button.dataset.label = button.textContent;
        button.disabled = true;
        button.innerHTML = `<span class="spinner spinner-sm" aria-hidden="true"></span> ${UI.esc(label || 'Please wait…')}`;
      } else {
        button.disabled = false;
        button.textContent = button.dataset.label || button.textContent;
      }
    },

    badge(status) {
      const s = String(status || '').toUpperCase();
      const cls = {
        PENDING: 'pending', APPROVED: 'approved', ACTIVE: 'active', GRANTED: 'active', REJECTED: 'rejected',
        REVOKED: 'revoked', EXPIRED: 'expired', VERIFIED: 'verified', INTEGRITY_VERIFIED: 'verified',
        TAMPER_DETECTED: 'tamper', UNAUTHORIZED: 'unauthorized',
      }[s] || 'info';
      return `<span class="badge badge-${cls}">${UI.esc(s.replace(/_/g, ' '))}</span>`;
    },

    formatDate(d, withTime = false) {
      if (!d) return '—';
      const date = new Date(d);
      return withTime
        ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
    },

    state(type, title, message = '') {
      const icon = type === 'loading' ? '<div class="spinner" aria-hidden="true"></div>' : '';
      return `<div class="state" role="${type === 'error' ? 'alert' : 'status'}">${icon}<div class="state-title">${UI.esc(title)}</div>${message ? `<div>${UI.esc(message)}</div>` : ''}</div>`;
    },

    formData(form) {
      return Object.fromEntries(new FormData(form).entries());
    },
  };
  window.UI = UI;
})();
