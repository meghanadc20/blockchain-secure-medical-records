// Doctor: request patient access by email and track requests.
function verificationBanner(user, el) {
  const s = user.doctorProfile && user.doctorProfile.verificationStatus;
  if (s === 'APPROVED') return true;
  UI.showAlert(el, s === 'REJECTED' ? 'error' : 'warning', s === 'REJECTED'
    ? 'Your verification was rejected, so you cannot request access to patient records.'
    : 'Your account is pending verification. You can send access requests once an administrator approves you.');
  return false;
}

Layout.ready.then(({ user }) => {
  const form = document.getElementById('request-form');
  const alertEl = document.getElementById('form-alert');
  const listEl = document.getElementById('list');
  const submit = form.querySelector('button[type="submit"]');
  const verified = verificationBanner(user, document.getElementById('verify-alert'));

  async function load() {
    listEl.innerHTML = UI.state('loading', 'Loading requests…');
    try {
      const data = await API.get('/relations/doctor?limit=100');
      listEl.innerHTML = data.items.length
        ? UI.table([
          { label: 'Patient', render: (r) => `<strong>${UI.esc(r.patient.name)}</strong><span class="cell-sub">${UI.esc(r.patient.email)}</span>` },
          { label: 'Status', render: (r) => UI.badge(r.status) },
          { label: 'Requested', render: (r) => UI.formatDate(r.requestedAt, true) },
          { label: 'Updated', render: (r) => UI.formatDate(r.updatedAt, true) },
        ], data.items, { caption: 'My access requests' })
        : UI.state('empty', 'No requests yet', 'Requests you send will appear here with their status.');
    } catch (err) {
      listEl.innerHTML = UI.state('error', 'Could not load requests', err.message);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    UI.hideAlert(alertEl); UI.clearFieldErrors(form);
    const patientEmail = form.patientEmail.value.trim();
    if (!patientEmail) { UI.showFieldErrors(form, [{ field: 'patientEmail', message: 'Patient email is required' }]); return; }
    UI.setLoading(submit, true, 'Sending…');
    try {
      await API.post('/relations/requests', { patientEmail });
      form.reset();
      UI.showAlert(alertEl, 'success', 'Request sent. The patient will see it on their Access Requests page.');
      await load();
    } catch (err) {
      if (err.details) UI.showFieldErrors(form, err.details);
      UI.showAlert(alertEl, 'error', err.message);
    } finally {
      UI.setLoading(submit, false);
      submit.disabled = !verified;
    }
  });

  submit.disabled = !verified;
  if (!verified) form.patientEmail.disabled = true;
  load();
});
