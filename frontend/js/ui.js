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

    /** Small status toast (top-right). type: success | error | info | warning */
    toast(message, type = 'success') {
      let host = document.getElementById('toast-host');
      if (!host) {
        host = document.createElement('div');
        host.id = 'toast-host';
        host.setAttribute('aria-live', 'polite');
        document.body.appendChild(host);
      }
      const el = document.createElement('div');
      el.className = `toast alert alert-${type}`;
      el.textContent = message;
      host.appendChild(el);
      setTimeout(() => el.remove(), 4500);
    },

    /**
     * Accessible confirmation modal. Resolves to { confirmed, value } (value = textarea text when `input` is set).
     * opts: { title, message, confirmLabel, danger, input: { label, placeholder, maxLength } }
     */
    confirm({ title, message, confirmLabel = 'Confirm', danger = false, input = null, hideCancel = false }) {
      return new Promise((resolve) => {
        const previous = document.activeElement;
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        backdrop.innerHTML = `
          <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-desc">
            <h2 id="modal-title" style="font-size:1.2rem">${UI.esc(title)}</h2>
            <p id="modal-desc" class="muted">${UI.esc(message)}</p>
            ${input ? `<div class="form-group"><label for="modal-input">${UI.esc(input.label)}</label>
              <textarea id="modal-input" class="form-control" rows="3" maxlength="${input.maxLength || 500}" placeholder="${UI.esc(input.placeholder || '')}"></textarea></div>` : ''}
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">
              ${hideCancel ? '' : '<button type="button" class="btn btn-outline" data-act="cancel">Cancel</button>'}
              <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${UI.esc(confirmLabel)}</button>
            </div>
          </div>`;
        const close = (confirmed) => {
          const value = input ? backdrop.querySelector('#modal-input').value.trim() : undefined;
          backdrop.remove();
          document.removeEventListener('keydown', onKey);
          if (previous && previous.focus) previous.focus();
          resolve({ confirmed, value });
        };
        const onKey = (e) => {
          if (e.key === 'Escape') close(false);
          if (e.key === 'Tab') { // keep focus inside the dialog
            const f = [...backdrop.querySelectorAll('button, textarea')];
            const i = f.indexOf(document.activeElement);
            if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
            else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
          }
        };
        backdrop.addEventListener('click', (e) => {
          if (e.target === backdrop) close(false);
          const act = e.target.closest('[data-act]');
          if (act) close(act.dataset.act === 'ok');
        });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(backdrop);
        (backdrop.querySelector('#modal-input') || backdrop.querySelector('[data-act="ok"]')).focus();
      });
    },

    /**
     * Modal containing a form. `bodyHtml` holds the fields; `onSubmit(values, form)` may throw an
     * API error (field errors are shown inline and the modal stays open). Resolves to the onSubmit result or null.
     */
    formModal({ title, bodyHtml, confirmLabel = 'Save' , onSubmit }) {
      return new Promise((resolve) => {
        const previous = document.activeElement;
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        backdrop.innerHTML = `
          <div class="modal" role="dialog" aria-modal="true" aria-labelledby="fm-title">
            <h2 id="fm-title" style="font-size:1.2rem">${UI.esc(title)}</h2>
            <div class="alert" id="fm-alert" hidden></div>
            <form id="fm-form" method="post" action="#" novalidate>${bodyHtml}
              <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">
                <button type="button" class="btn btn-outline" data-act="cancel">Cancel</button>
                <button type="submit" class="btn btn-primary">${UI.esc(confirmLabel)}</button>
              </div>
            </form>
          </div>`;
        const form = backdrop.querySelector('#fm-form');
        const alertEl = backdrop.querySelector('#fm-alert');
        const close = (result) => {
          backdrop.remove(); document.removeEventListener('keydown', onKey);
          if (previous && previous.focus) previous.focus();
          resolve(result);
        };
        const onKey = (e) => { if (e.key === 'Escape') close(null); };
        backdrop.addEventListener('click', (e) => {
          if (e.target === backdrop || (e.target.closest('[data-act="cancel"]'))) close(null);
        });
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          UI.hideAlert(alertEl); UI.clearFieldErrors(form);
          const btn = form.querySelector('button[type="submit"]');
          UI.setLoading(btn, true, 'Saving…');
          try { close(await onSubmit(UI.formData(form), form)); } catch (err) {
            UI.setLoading(btn, false);
            if (err.details) UI.showFieldErrors(form, err.details);
            UI.showAlert(alertEl, 'error', err.message || 'Something went wrong.');
          }
        });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(backdrop);
        const first = form.querySelector('input, select, textarea'); if (first) first.focus();
      });
    },

    RECORD_TYPES: { LAB_REPORT: 'Lab report', IMAGING: 'Imaging', PRESCRIPTION: 'Prescription', DISCHARGE_SUMMARY: 'Discharge summary', CONSULTATION_NOTE: 'Consultation note', VACCINATION: 'Vaccination', OTHER: 'Other' },

    formatBytes(n) {
      if (n === null || n === undefined) return '—';
      const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n;
      while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
      return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
    },

    /** Multi-line text → safe HTML with line breaks. */
    multiline(text) { return UI.esc(text).replace(/\n/g, '<br>'); },

    /** Downloads or opens (in a new tab) a protected file. */
    async openFile(recordId, { inline = false } = {}) {
      const win = inline ? window.open('', '_blank') : null; // open synchronously to avoid popup blockers
      try {
        const { blob, filename } = await API.blob(`/records/${recordId}/file${inline ? '?disposition=inline' : ''}`);
        const url = URL.createObjectURL(blob);
        if (win) { win.location.href = url; } else {
          const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        }
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (err) {
        if (win) win.close();
        UI.toast(err.message, 'error');
      }
    },

    /** Client-side pre-check (the server re-checks type, real content and size). */
    checkUploadFile(file) {
      if (!file) return 'Choose a file to upload.';
      if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) return 'Only PDF, JPEG and PNG files are allowed.';
      if (file.size > 10 * 1024 * 1024) return 'File is too large. The maximum size is 10 MB.';
      return null;
    },

    /** Generic dialog. Returns { el, close, closed } — `closed` resolves when the dialog closes. */
    dialog({ title, bodyHtml, wide = false }) {
      const previous = document.activeElement;
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-title" style="${wide ? 'max-width:min(1000px, 100%)' : ''}">
        <div class="card-header"><h2 id="dlg-title" style="font-size:1.2rem;margin:0">${UI.esc(title)}</h2>
        <button type="button" class="btn btn-outline btn-sm" data-act="close" aria-label="Close">Close</button></div>
        <div class="dlg-body">${bodyHtml}</div></div>`;
      let resolveClosed;
      const closed = new Promise((r) => { resolveClosed = r; });
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      function close() {
        backdrop.remove(); document.removeEventListener('keydown', onKey);
        if (previous && previous.focus) previous.focus();
        resolveClosed();
      }
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop || e.target.closest('[data-act="close"]')) close(); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(backdrop);
      backdrop.querySelector('[data-act="close"]').focus();
      return { el: backdrop.querySelector('.dlg-body'), close, closed };
    },

    /** "in 3 hours", "2 days ago" */
    relativeTime(date) {
      const diff = new Date(date).getTime() - Date.now();
      const abs = Math.abs(diff);
      const units = [['day', 86400000], ['hour', 3600000], ['minute', 60000]];
      const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
      for (const [u, ms] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), u);
      return rtf.format(Math.round(diff / 1000), 'second');
    },

    /** Expiry presets for sharing (value = minutes). */
    EXPIRY_PRESETS: [[60, '1 hour'], [1440, '24 hours'], [10080, '7 days'], [43200, '30 days'], ['custom', 'Custom date & time…']],

    shortHash(h) { return h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '—'; },

    /** Small on-chain proof badge with the full hash in the tooltip. */
    chainBadge(txHash, label = 'On-chain') {
      return txHash
        ? `<span class="badge badge-verified" style="text-transform:none" title="Transaction ${UI.esc(txHash)}">${UI.esc(label)} · ${UI.esc(UI.shortHash(txHash))}</span>`
        : '<span class="badge badge-pending" style="text-transform:none">Not on-chain</span>';
    },

    /** Renders a simple data table. columns: [{ label, render(row) → HTML string }] */
    table(columns, rows, { caption } = {}) {
      return `<div class="table-wrap"><table class="table">${caption ? `<caption class="sr-only">${UI.esc(caption)}</caption>` : ''}
        <thead><tr>${columns.map((c) => `<th scope="col">${UI.esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td data-label="${UI.esc(c.label)}">${c.render(r)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
    },
  };
  window.UI = UI;
})();
