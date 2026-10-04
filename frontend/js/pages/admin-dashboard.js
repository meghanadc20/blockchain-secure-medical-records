// Admin dashboard: verification counts and the oldest pending doctors.
Layout.ready.then(async ({ user }) => {
  document.getElementById('welcome').textContent = `Welcome, ${user.name.split(' ')[0]}`;
  const statsEl = document.getElementById('stats');
  const queueEl = document.getElementById('queue');
  statsEl.innerHTML = UI.state('loading', 'Loading…');
  queueEl.innerHTML = UI.state('loading', 'Loading…');
  try {
    const [s, pending] = await Promise.all([API.get('/admin/stats'), API.get('/admin/doctors?status=PENDING&limit=5')]);
    const card = (label, value, href) => `<a class="card stat" href="${href}" style="text-decoration:none;color:inherit"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></a>`;
    statsEl.innerHTML = card('Pending doctors', s.doctors.pending, '/admin/doctors/pending')
      + card('Approved doctors', s.doctors.approved, '/admin/doctors/approved')
      + card('Rejected doctors', s.doctors.rejected, '/admin/doctors/rejected')
      + `<div class="card stat"><span class="stat-label">Registered patients</span><span class="stat-value">${s.patients}</span></div>`;
    queueEl.innerHTML = pending.items.length
      ? UI.table([
        { label: 'Doctor', render: (d) => `<strong>${UI.esc(d.name)}</strong><span class="cell-sub">${UI.esc(d.email)}</span>` },
        { label: 'Specialization', render: (d) => UI.esc(d.specialization) },
        { label: 'Licence', render: (d) => UI.esc(d.licenseNumber) },
        { label: 'Registered', render: (d) => UI.formatDate(d.registeredAt) },
      ], pending.items, { caption: 'Doctors waiting for verification' })
      : UI.state('empty', 'Nothing to review', 'New doctor registrations will appear here.');
  } catch (err) {
    statsEl.innerHTML = UI.state('error', 'Could not load statistics', err.message);
    queueEl.innerHTML = '';
  }
});
