// Dashboard landing for all three roles (Phase 3: account summary; later phases add records, requests, stats).
Layout.ready.then(({ user }) => {
  document.getElementById('welcome').textContent = `Welcome, ${user.name.split(' ')[0]}`;
  const rows = [['Name', user.name], ['Email', user.email], ['Phone', user.phone || '—'], ['Member since', UI.formatDate(user.createdAt)]];

  if (user.role === 'DOCTOR' && user.doctorProfile) {
    const p = user.doctorProfile;
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
  }

  document.getElementById('account').innerHTML = rows
    .map(([k, v]) => `<dt>${UI.esc(k)}</dt><dd>${UI.esc(v)}</dd>`).join('');
});
