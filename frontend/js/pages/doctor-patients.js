// Doctor: patients who have approved this doctor.
Layout.ready.then(async ({ user }) => {
  const listEl = document.getElementById('list');
  const s = user.doctorProfile && user.doctorProfile.verificationStatus;
  if (s !== 'APPROVED') {
    UI.showAlert(document.getElementById('verify-alert'), s === 'REJECTED' ? 'error' : 'warning',
      s === 'REJECTED' ? 'Your verification was rejected. You cannot access patient records.' : 'Verification pending. Patient records are unavailable until an administrator approves you.');
  }
  listEl.innerHTML = UI.state('loading', 'Loading patients…');
  try {
    const data = await API.get('/relations/doctor?status=APPROVED&limit=100');
    listEl.innerHTML = data.items.length
      ? UI.table([
        { label: 'Patient', render: (r) => `<strong>${UI.esc(r.patient.name)}</strong>` },
        { label: 'Email', render: (r) => UI.esc(r.patient.email) },
        { label: 'Approved', render: (r) => UI.formatDate(r.approvedAt, true) },
        { label: 'Status', render: (r) => UI.badge(r.status) },
        { label: 'Actions', render: (r) => `<div class="actions"><a class="btn btn-outline btn-sm" href="/doctor/consultations?patient=${encodeURIComponent(r.patient.id)}">Add consultation</a><button class="btn btn-outline btn-sm" data-upload="${r.patient.id}" data-name="${UI.esc(r.patient.name)}">Upload record</button></div>` },
      ], data.items, { caption: 'Patients who approved access' })
      : UI.state('empty', 'No patients yet', 'Patients appear here after they approve your access request.');
  } catch (err) {
    listEl.innerHTML = UI.state('error', 'Could not load patients', err.message);
  }

  // Doctor uploads a record on the patient's behalf (patient owns it; doctor access still needs a record permission).
  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-upload]');
    if (!btn) return;
    const types = Object.entries(UI.RECORD_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    const saved = await UI.formModal({
      title: `Upload a record for ${btn.dataset.name}`,
      confirmLabel: 'Upload securely',
      bodyHtml: `<div class="form-group"><label for="d-title">Title</label><input class="form-control" id="d-title" name="title" maxlength="150"><div class="field-error" data-error-for="title"></div></div>
        <div class="form-group"><label for="d-type">Record type</label><select class="form-control" id="d-type" name="recordType"><option value="">Select a type…</option>${types}</select><div class="field-error" data-error-for="recordType"></div></div>
        <div class="form-group"><label for="d-desc">Description <span class="muted">(optional)</span></label><textarea class="form-control" id="d-desc" name="description" rows="2" maxlength="2000"></textarea></div>
        <div class="form-group"><label for="d-file">File (PDF, JPEG or PNG, max 10 MB)</label><input class="form-control" id="d-file" name="file" type="file" accept="application/pdf,image/png,image/jpeg"><div class="field-error" data-error-for="file"></div></div>
        <p class="form-hint">The record belongs to the patient. You can only open it after the patient shares it with you.</p>`,
      onSubmit: async (v, form) => {
        const file = form.file.files[0];
        const errs = [];
        if (!form.title.value.trim()) errs.push({ field: 'title', message: 'Title is required' });
        if (!form.recordType.value) errs.push({ field: 'recordType', message: 'Record type is required' });
        const fe = UI.checkUploadFile(file); if (fe) errs.push({ field: 'file', message: fe });
        if (errs.length) { const e2 = new Error('Please correct the highlighted fields.'); e2.details = errs; throw e2; }
        const fd = new FormData();
        fd.append('patientId', btn.dataset.upload);
        fd.append('title', form.title.value.trim());
        fd.append('recordType', form.recordType.value);
        if (form.description.value.trim()) fd.append('description', form.description.value.trim());
        fd.append('file', file, file.name);
        return API.upload('/records', fd);
      },
    });
    if (saved) UI.toast(`Uploaded “${saved.record.title}” to the patient’s records.`);
  });
});
