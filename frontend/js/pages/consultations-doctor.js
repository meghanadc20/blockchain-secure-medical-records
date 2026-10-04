// Doctor: add consultations for approved patients and review the ones they authored.
Layout.ready.then(async ({ user }) => {
  const form = document.getElementById('consult-form');
  const alertEl = document.getElementById('form-alert');
  const listEl = document.getElementById('list');
  const filter = document.getElementById('filter-patient');
  const submit = form.querySelector('button[type="submit"]');
  const verified = user.doctorProfile && user.doctorProfile.verificationStatus === 'APPROVED';

  form.consultationDate.value = new Date().toISOString().slice(0, 10);
  form.consultationDate.max = form.consultationDate.value;

  function card(c) {
    const section = (label, text) => (text ? `<div><h4>${label}</h4><p>${UI.multiline(text)}</p></div>` : '');
    return `<article class="card" style="margin-bottom:12px">
      <div class="card-header" style="margin-bottom:4px"><h3 class="card-title">${UI.esc(c.patient.name)}</h3><span class="muted">${UI.formatDate(c.consultationDate)}</span></div>
      <div class="clinical">${section('Diagnosis', c.diagnosis)}${section('Prescription', c.prescription)}${section('Treatment notes', c.treatmentNotes)}</div>
    </article>`;
  }

  async function loadList() {
    listEl.innerHTML = UI.state('loading', 'Loading consultations…');
    try {
      const data = await API.get(`/consultations?limit=100${filter.value ? `&patientId=${filter.value}` : ''}`);
      listEl.innerHTML = data.items.length ? data.items.map(card).join('')
        : UI.state('empty', 'No consultations yet', 'Consultations you add for approved patients appear here.');
    } catch (err) {
      listEl.innerHTML = UI.state('error', 'Could not load consultations', err.message);
    }
  }

  if (!verified) {
    const s = user.doctorProfile && user.doctorProfile.verificationStatus;
    UI.showAlert(document.getElementById('verify-alert'), s === 'REJECTED' ? 'error' : 'warning',
      s === 'REJECTED' ? 'Your verification was rejected. You cannot add or view consultations.' : 'Verification pending. You can add consultations once an administrator approves you.');
    form.querySelectorAll('input, select, textarea').forEach((el) => { el.disabled = true; });
    form.patientId.innerHTML = '<option value="">Not available</option>';
    listEl.innerHTML = UI.state('empty', 'Not available', 'Consultations are available to verified doctors.');
    return;
  }

  // Patients who currently approve this doctor
  try {
    const rel = await API.get('/relations/doctor?status=APPROVED&limit=100');
    const opts = rel.items.map((r) => `<option value="${r.patient.id}">${UI.esc(r.patient.name)} (${UI.esc(r.patient.email)})</option>`).join('');
    form.patientId.innerHTML = rel.items.length ? `<option value="">Select a patient…</option>${opts}` : '<option value="">No approved patients yet</option>';
    filter.innerHTML = `<option value="">All patients</option>${opts}`;
    const pre = new URLSearchParams(location.search).get('patient');
    if (pre && rel.items.some((r) => r.patient.id === pre)) { form.patientId.value = pre; filter.value = pre; }
    submit.disabled = !rel.items.length;
  } catch (err) {
    UI.showAlert(alertEl, 'error', err.message);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    UI.hideAlert(alertEl); UI.clearFieldErrors(form);
    const v = UI.formData(form);
    const local = [];
    if (!v.patientId) local.push({ field: 'patientId', message: 'Select a patient' });
    if (!v.consultationDate) local.push({ field: 'consultationDate', message: 'Consultation date is required' });
    if (!v.diagnosis.trim() && !v.prescription.trim() && !v.treatmentNotes.trim()) local.push({ field: 'diagnosis', message: 'Enter a diagnosis, prescription or treatment notes' });
    if (local.length) { UI.showFieldErrors(form, local); return; }

    UI.setLoading(submit, true, 'Saving…');
    try {
      // Send the selected calendar date at midday local time so it never shifts to another day.
      await API.post('/consultations', { ...v, consultationDate: new Date(`${v.consultationDate}T12:00:00`).toISOString() });
      ['diagnosis', 'prescription', 'treatmentNotes'].forEach((k) => { form[k].value = ''; });
      UI.showAlert(alertEl, 'success', 'Consultation saved to the patient’s medical history.');
      filter.value = v.patientId;
      await loadList();
    } catch (err) {
      if (err.details) UI.showFieldErrors(form, err.details);
      UI.showAlert(alertEl, 'error', err.message);
    } finally { UI.setLoading(submit, false); }
  });

  filter.addEventListener('change', loadList);
  loadList();
});
