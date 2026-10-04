// Patient and doctor profile editing.
Layout.ready.then(({ user }) => {
  const form = document.getElementById('profile-form');
  const alertEl = document.getElementById('form-alert');
  const submit = form.querySelector('button[type="submit"]');
  const isDoctor = user.role === 'DOCTOR';

  function fill(u) {
    form.name.value = u.name || '';
    form.phone.value = u.phone || '';
    if (isDoctor && u.doctorProfile) {
      form.specialization.value = u.doctorProfile.specialization || '';
      form.hospital.value = u.doctorProfile.hospital || '';
    }
    const rows = [['Email', u.email], ['Role', u.role === 'DOCTOR' ? 'Doctor' : 'Patient'], ['Member since', UI.formatDate(u.createdAt)]];
    if (isDoctor && u.doctorProfile) {
      rows.push(['License number', u.doctorProfile.licenseNumber]);
      document.getElementById('status-badge').innerHTML = UI.badge(u.doctorProfile.verificationStatus);
    }
    document.getElementById('account').innerHTML = rows.map(([k, v]) => `<dt>${UI.esc(k)}</dt><dd>${UI.esc(v)}</dd>`).join('');
  }
  fill(user);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    UI.hideAlert(alertEl); UI.clearFieldErrors(form);
    const body = { name: form.name.value, phone: form.phone.value };
    if (isDoctor) { body.specialization = form.specialization.value; body.hospital = form.hospital.value; }
    UI.setLoading(submit, true, 'Saving…');
    try {
      const data = await API.patch('/profile', body);
      API.Session.setUser(data.user);
      fill(data.user);
      UI.showAlert(alertEl, 'success', 'Profile updated.');
      document.querySelector('.user-meta .name').textContent = data.user.name;
    } catch (err) {
      if (err.details) UI.showFieldErrors(form, err.details);
      UI.showAlert(alertEl, 'error', err.message);
    } finally { UI.setLoading(submit, false); }
  });
  submit.disabled = false;
});
