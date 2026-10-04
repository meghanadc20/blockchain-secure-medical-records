// Patient: list own records, edit title/type/description.
Layout.ready.then(() => {
  const listEl = document.getElementById('list');
  const q = document.getElementById('q');
  const typeSel = document.getElementById('type');
  let timer; let items = [];

  const typeOptions = Object.entries(UI.RECORD_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  typeSel.innerHTML += typeOptions;

  // ---------- upload ----------
  const upForm = document.getElementById('upload-form');
  const upAlert = document.getElementById('form-alert');
  const upBtn = upForm.querySelector('button[type="submit"]');
  upForm.recordType.innerHTML = `<option value="">Select a type…</option>${typeOptions}`;
  upForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    UI.hideAlert(upAlert); UI.clearFieldErrors(upForm);
    const file = upForm.file.files[0];
    const local = [];
    if (!upForm.title.value.trim()) local.push({ field: 'title', message: 'Title is required' });
    if (!upForm.recordType.value) local.push({ field: 'recordType', message: 'Record type is required' });
    const fileErr = UI.checkUploadFile(file);
    if (fileErr) local.push({ field: 'file', message: fileErr });
    if (local.length) { UI.showFieldErrors(upForm, local); return; }

    const fd = new FormData();
    fd.append('title', upForm.title.value.trim());
    fd.append('recordType', upForm.recordType.value);
    if (upForm.description.value.trim()) fd.append('description', upForm.description.value.trim());
    fd.append('file', file, file.name);
    UI.setLoading(upBtn, true, 'Encrypting & uploading…');
    try {
      const data = await API.upload('/records', fd);
      upForm.reset();
      UI.showAlert(upAlert, 'success', `“${data.record.title}” was encrypted and stored securely.`);
      await load();
    } catch (err) {
      if (err.details) UI.showFieldErrors(upForm, err.details);
      if (['UNSUPPORTED_FILE_TYPE', 'FILE_CONTENT_MISMATCH', 'FILE_TOO_LARGE', 'FILE_REQUIRED'].includes(err.code)) UI.showFieldErrors(upForm, [{ field: 'file', message: err.message }]);
      UI.showAlert(upAlert, 'error', err.message);
    } finally { UI.setLoading(upBtn, false); }
  });
  upBtn.disabled = false;

  function card(r) {
    return `<article class="card record-card">
      <div class="card-header" style="margin:0"><h3>${UI.esc(r.title)}</h3><span class="badge badge-info" style="text-transform:none">${UI.esc(UI.RECORD_TYPES[r.recordType] || r.recordType)}</span></div>
      ${r.description ? `<p class="muted" style="margin:0">${UI.multiline(r.description)}</p>` : ''}
      <dl class="record-meta">
        <dt>Date</dt><dd>${UI.formatDate(r.createdAt, true)}</dd>
        <dt>Uploaded by</dt><dd>${UI.esc(r.uploadedBy.name || '—')}</dd>
        <dt>File</dt><dd>${r.hasFile ? `${UI.esc(r.fileName || 'Stored file')} · ${UI.formatBytes(r.fileSize)} · <span class="badge badge-verified" style="text-transform:none">Encrypted at rest</span>` : '<span class="muted">No file attached</span>'}</dd>
        <dt>Access</dt><dd>${r.activeShares ? `<span class="badge badge-active" style="text-transform:none">${r.activeShares} doctor${r.activeShares > 1 ? 's' : ''} with active access</span>` : '<span class="muted">Not shared</span>'}</dd>
        <dt>Integrity</dt><dd><span class="muted">Not yet verified (Module 6)</span></dd>
      </dl>
      <div class="actions">
        ${r.hasFile ? `<button class="btn btn-primary btn-sm" data-view="${r.id}">View</button><button class="btn btn-outline btn-sm" data-download="${r.id}">Download</button>` : ''}
        <button class="btn btn-secondary btn-sm" data-share="${r.id}">Share</button>
        <button class="btn btn-outline btn-sm" data-access="${r.id}">Manage access</button>
        <button class="btn btn-outline btn-sm" data-edit="${r.id}">Edit details</button>
      </div>
    </article>`;
  }

  async function load() {
    listEl.innerHTML = UI.state('loading', 'Loading records…');
    const qs = new URLSearchParams({ limit: '100' });
    if (q.value.trim()) qs.set('q', q.value.trim());
    if (typeSel.value) qs.set('type', typeSel.value);
    try {
      const data = await API.get(`/records?${qs}`);
      items = data.items;
      listEl.innerHTML = items.length ? items.map(card).join('')
        : `<div class="card" style="grid-column:1/-1">${UI.state('empty', q.value || typeSel.value ? 'No matching records' : 'No records yet', q.value || typeSel.value ? 'Try a different search or type.' : 'Your uploaded reports will appear here.')}</div>`;
    } catch (err) {
      listEl.innerHTML = `<div class="card" style="grid-column:1/-1">${UI.state('error', 'Could not load records', err.message)}</div>`;
    }
  }

  listEl.addEventListener('click', async (e) => {
    const view = e.target.closest('[data-view]');
    if (view) { UI.openFile(view.dataset.view, { inline: true }); return; }
    const dl = e.target.closest('[data-download]');
    if (dl) { UI.setLoading(dl, true, 'Decrypting…'); await UI.openFile(dl.dataset.download); UI.setLoading(dl, false); return; }
    const share = e.target.closest('[data-share]');
    if (share) { shareRecord(items.find((x) => x.id === share.dataset.share)); return; }
    const acc = e.target.closest('[data-access]');
    if (acc) { manageAccess(items.find((x) => x.id === acc.dataset.access)); return; }
    const btn = e.target.closest('[data-edit]');
    if (!btn) return;
    const r = items.find((x) => x.id === btn.dataset.edit);
    const opts = Object.entries(UI.RECORD_TYPES).map(([k, v]) => `<option value="${k}" ${k === r.recordType ? 'selected' : ''}>${v}</option>`).join('');
    const saved = await UI.formModal({
      title: 'Edit record details',
      bodyHtml: `<div class="form-group"><label for="m-title">Title</label><input class="form-control" id="m-title" name="title" maxlength="150" value="${UI.esc(r.title)}"><div class="field-error" data-error-for="title"></div></div>
        <div class="form-group"><label for="m-type">Record type</label><select class="form-control" id="m-type" name="recordType">${opts}</select><div class="field-error" data-error-for="recordType"></div></div>
        <div class="form-group"><label for="m-desc">Description</label><textarea class="form-control" id="m-desc" name="description" maxlength="2000" rows="3">${UI.esc(r.description)}</textarea><div class="field-error" data-error-for="description"></div></div>
        <p class="form-hint">The file itself and its integrity hash cannot be changed.</p>`,
      onSubmit: (v) => API.patch(`/records/${r.id}`, v),
    });
    if (saved) { UI.toast('Record details updated.'); load(); }
  });

  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  typeSel.addEventListener('change', load);
  load();

  // ---------- sharing (Module 4) ----------
  async function shareRecord(r) {
    let doctors;
    try { doctors = (await API.get('/relations/patient?status=APPROVED&limit=100')).items; } catch (err) { UI.toast(err.message, 'error'); return; }
    if (!doctors.length) {
      await UI.confirm({ title: 'No authorized doctors', message: 'Approve a doctor’s access request first (Access Requests page). Then you can share individual records with them.', confirmLabel: 'OK', hideCancel: true });
      return;
    }
    const docOpts = doctors.map((d) => `<option value="${d.doctor.id}">Dr. ${UI.esc(d.doctor.name)} — ${UI.esc(d.doctor.specialization || '')}</option>`).join('');
    const presetOpts = UI.EXPIRY_PRESETS.map(([v, l]) => `<option value="${v}" ${v === 1440 ? 'selected' : ''}>${l}</option>`).join('');
    const saved = await UI.formModal({
      title: `Share “${r.title}”`,
      confirmLabel: 'Grant access',
      bodyHtml: `<div class="form-group"><label for="s-doc">Doctor</label><select class="form-control" id="s-doc" name="doctorId"><option value="">Select a doctor…</option>${docOpts}</select><div class="field-error" data-error-for="doctorId"></div></div>
        <div class="form-group"><label for="s-preset">Access expires after</label><select class="form-control" id="s-preset" name="preset">${presetOpts}</select></div>
        <div class="form-group" id="s-custom-wrap" hidden><label for="s-custom">Expires at</label><input class="form-control" id="s-custom" name="custom" type="datetime-local"></div>
        <div class="field-error" data-error-for="expiresAt"></div>
        <p class="form-hint">Only this record is shared, only with this doctor, and access ends automatically at the expiry time. You can revoke it earlier at any time.</p>`,
      onSubmit: async (v) => {
        const errs = [];
        if (!v.doctorId) errs.push({ field: 'doctorId', message: 'Select a doctor' });
        let expiresAt;
        if (v.preset === 'custom') {
          if (!v.custom) errs.push({ field: 'expiresAt', message: 'Choose the expiry date and time' });
          else expiresAt = new Date(v.custom).toISOString();
        } else expiresAt = new Date(Date.now() + Number(v.preset) * 60000).toISOString();
        if (errs.length) { const e = new Error('Please correct the highlighted fields.'); e.details = errs; throw e; }
        return API.post('/permissions', { recordId: r.id, doctorId: v.doctorId, expiresAt });
      },
    });
    if (saved) { UI.toast(`Shared with Dr. ${saved.permission.doctor.name} until ${UI.formatDate(saved.permission.expiresAt, true)}.`); load(); }
  }
  // Show the custom date field when "Custom" is chosen (modal is created dynamically).
  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 's-preset') {
      const wrap = document.getElementById('s-custom-wrap');
      wrap.hidden = e.target.value !== 'custom';
      if (!wrap.hidden) {
        const min = new Date(Date.now() + 10 * 60000); min.setSeconds(0, 0);
        const local = new Date(min.getTime() - min.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        const input = document.getElementById('s-custom'); input.min = local; if (!input.value) input.value = local;
      }
    }
  });

  async function manageAccess(r) {
    const dlg = UI.dialog({ title: `Access to “${r.title}”`, bodyHtml: UI.state('loading', 'Loading…'), wide: true });
    async function render() {
      try {
        const data = await API.get(`/permissions?recordId=${r.id}&limit=100`);
        dlg.el.innerHTML = data.items.length ? UI.table([
          { label: 'Doctor', render: (p) => `<strong>Dr. ${UI.esc(p.doctor.name)}</strong><span class="cell-sub">${UI.esc(p.doctor.email)}</span>` },
          { label: 'Granted', render: (p) => UI.formatDate(p.grantedAt, true) },
          { label: 'Expires', render: (p) => `${UI.formatDate(p.expiresAt, true)}<span class="cell-sub">${p.status === 'ACTIVE' ? UI.relativeTime(p.expiresAt) : ''}</span>` },
          { label: 'Status', render: (p) => `${UI.badge(p.status)}${p.revokedAt ? `<span class="cell-sub">Revoked ${UI.formatDate(p.revokedAt, true)}</span>` : ''}` },
          { label: 'Action', render: (p) => (p.status === 'ACTIVE' ? `<button class="btn btn-danger btn-sm" data-revoke="${p.id}">Revoke</button>` : '<span class="muted">—</span>') },
        ], data.items, { caption: 'Access history for this record' })
          : UI.state('empty', 'Not shared yet', 'Use “Share” to give an authorized doctor time-limited access.');
      } catch (err) { dlg.el.innerHTML = UI.state('error', 'Could not load access', err.message); }
    }
    dlg.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-revoke]');
      if (!b) return;
      const { confirmed } = await UI.confirm({ title: 'Revoke access?', message: 'The doctor will be unable to open this record from their next request.', confirmLabel: 'Revoke', danger: true });
      if (!confirmed) return;
      try { await API.patch(`/permissions/${b.dataset.revoke}/revoke`); UI.toast('Access revoked.'); } catch (err) { UI.toast(err.message, 'error'); }
      render();
    });
    render();
    await dlg.closed;
    load();
  }
});

