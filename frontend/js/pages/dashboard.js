// Patient and doctor dashboards (admin has its own script).
function statCard(label, value, href) {
  return `<a class="card stat" href="${href}" style="text-decoration:none;color:inherit"><span class="stat-label">${UI.esc(label)}</span><span class="stat-value">${UI.esc(value)}</span></a>`;
}

Layout.ready.then(async ({ user }) => {
  document.getElementById('welcome').textContent = `Welcome, ${user.name.split(' ')[0]}`;
  const rows = [['Name', user.name], ['Email', user.email], ['Phone', user.phone || '—'], ['Member since', UI.formatDate(user.createdAt)]];
  const statsEl = document.getElementById('stats');

  if (user.role === 'DOCTOR') {
    const p = user.doctorProfile || {};
    rows.push(['Specialization', p.specialization], ['License number', p.licenseNumber], ['Hospital', p.hospital]);
    document.getElementById('verification-badge').innerHTML = UI.badge(p.verificationStatus);
    const alertEl = document.getElementById('verification-alert');
    if (p.verificationStatus === 'PENDING') {
      UI.showAlert(alertEl, 'warning', 'Verification pending. An administrator is reviewing your licence details. You cannot request or view patient records until you are approved.');
    } else if (p.verificationStatus === 'REJECTED') {
      UI.showAlert(alertEl, 'error', 'Your verification was rejected. You cannot access patient records. Contact the platform administrator if you believe this is a mistake.');
    } else {
      UI.showAlert(alertEl, 'success', `Verified doctor${p.verifiedAt ? ` since ${UI.formatDate(p.verifiedAt)}` : ''}.`);
    }
    statsEl.innerHTML = UI.state('loading', 'Loading…');
    try {
      const [approved, pending, shared] = await Promise.all([
        API.get('/relations/doctor?status=APPROVED&limit=1'),
        API.get('/relations/doctor?status=PENDING&limit=1'),
        p.verificationStatus === 'APPROVED' ? API.get('/permissions/doctor?status=ACTIVE&limit=1') : Promise.resolve({ total: 0 }),
      ]);
      statsEl.innerHTML = statCard('Patients who approved you', approved.total, '/doctor/patients')
        + statCard('Requests awaiting patients', pending.total, '/doctor/access-requests')
        + statCard('Records shared with you (active)', shared.total, '/doctor/records');
    } catch (err) { statsEl.innerHTML = UI.state('error', 'Could not load summary', err.message); }
  } else {
    statsEl.innerHTML = UI.state('loading', 'Loading…');
    const pendingEl = document.getElementById('pending');
    try {
      const [pending, approved, records, consults] = await Promise.all([
        API.get('/relations/patient?status=PENDING&limit=5'),
        API.get('/relations/patient?status=APPROVED&limit=1'),
        API.get('/records?limit=1'),
        API.get('/consultations?limit=1'),
      ]);
      statsEl.innerHTML = statCard('Pending requests', pending.total, '/patient/access-requests')
        + statCard('Authorized doctors', approved.total, '/patient/access-requests')
        + statCard('Medical records', records.total, '/patient/records')
        + statCard('Consultations', consults.total, '/patient/history');
      pendingEl.innerHTML = pending.items.length
        ? `<ul style="list-style:none;padding:0;margin:0">${pending.items.map((r) => `<li style="padding:10px 0;border-bottom:1px solid var(--border)"><strong>Dr. ${UI.esc(r.doctor.name)}</strong><span class="cell-sub">${UI.esc(r.doctor.specialization || '')} · ${UI.esc(r.doctor.hospital || '')} · requested ${UI.formatDate(r.requestedAt)}</span></li>`).join('')}</ul>`
        : UI.state('empty', 'No pending requests', 'When a doctor asks for access, it will appear here.');
    } catch (err) {
      statsEl.innerHTML = UI.state('error', 'Could not load summary', err.message);
      pendingEl.innerHTML = '';
    }
  }

  document.getElementById('account').innerHTML = rows.map(([k, v]) => `<dt>${UI.esc(k)}</dt><dd>${UI.esc(v)}</dd>`).join('');
});
