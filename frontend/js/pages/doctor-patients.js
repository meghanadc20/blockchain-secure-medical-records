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
        { label: 'Actions', render: (r) => `<a class="btn btn-outline btn-sm" href="/doctor/consultations?patient=${encodeURIComponent(r.patient.id)}">Add consultation</a>` },
      ], data.items, { caption: 'Patients who approved access' })
      : UI.state('empty', 'No patients yet', 'Patients appear here after they approve your access request.');
  } catch (err) {
    listEl.innerHTML = UI.state('error', 'Could not load patients', err.message);
  }
});
