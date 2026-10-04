// Admin: pending / approved / rejected doctor lists with details, approve and reject.
Layout.ready.then(() => {
  const status = document.body.dataset.status; // PENDING | APPROVED | REJECTED
  const listEl = document.getElementById('list');
  const pagerEl = document.getElementById('pager');
  const search = document.getElementById('search');
  let page = 1; let q = ''; let timer; let lastItems = [];

  function actions(d) {
    const view = `<button class="btn btn-outline btn-sm" data-act="view" data-id="${d.doctorId}">View details</button>`;
    if (status === 'PENDING') return `<div class="actions">${view}<button class="btn btn-secondary btn-sm" data-act="approve" data-id="${d.doctorId}">Approve</button><button class="btn btn-danger btn-sm" data-act="reject" data-id="${d.doctorId}">Reject</button></div>`;
    if (status === 'APPROVED') return `<div class="actions">${view}<button class="btn btn-danger btn-sm" data-act="reject" data-id="${d.doctorId}">Reject</button></div>`;
    return `<div class="actions">${view}<button class="btn btn-secondary btn-sm" data-act="approve" data-id="${d.doctorId}">Approve</button></div>`;
  }

  async function load() {
    listEl.innerHTML = UI.state('loading', 'Loading doctors…');
    pagerEl.innerHTML = '';
    try {
      const data = await API.get(`/admin/doctors?status=${status}&page=${page}&limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      lastItems = data.items;
      if (!data.items.length) {
        listEl.innerHTML = UI.state('empty', q ? 'No matching doctors' : `No ${status.toLowerCase()} doctors`, q ? 'Try a different search.' : '');
        return;
      }
      listEl.innerHTML = UI.table([
        { label: 'Doctor', render: (d) => `<strong>${UI.esc(d.name)}</strong><span class="cell-sub">${UI.esc(d.email)}</span>` },
        { label: 'Specialization', render: (d) => UI.esc(d.specialization) },
        { label: 'Licence number', render: (d) => UI.esc(d.licenseNumber) },
        { label: 'Hospital', render: (d) => UI.esc(d.hospital) },
        { label: 'Registered', render: (d) => UI.formatDate(d.registeredAt) },
        { label: 'Status', render: (d) => UI.badge(d.verificationStatus) },
        { label: 'Actions', render: actions },
      ], data.items, { caption: `${status} doctors` });
      if (data.pages > 1) {
        pagerEl.innerHTML = `<button class="btn btn-outline btn-sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button>
          <span>Page ${data.page} of ${data.pages}</span>
          <button class="btn btn-outline btn-sm" data-page="${page + 1}" ${page >= data.pages ? 'disabled' : ''}>Next</button>`;
      }
    } catch (err) {
      listEl.innerHTML = UI.state('error', 'Could not load doctors', err.message);
    }
  }

  async function showDetails(id) {
    try {
      const { doctor: d } = await API.get(`/admin/doctors/${id}`);
      const rows = [['Name', d.name], ['Email', d.email], ['Phone', d.phone || '—'], ['Specialization', d.specialization],
        ['Licence number', d.licenseNumber], ['Hospital', d.hospital], ['Registered', UI.formatDate(d.registeredAt, true)],
        ['Status', d.verificationStatus], ['Verified at', d.verifiedAt ? UI.formatDate(d.verifiedAt, true) : '—']];
      await UI.confirm({ title: `Dr. ${d.name}`, message: rows.map(([k, v]) => `${k}: ${v}`).join('\n'), confirmLabel: 'Close', hideCancel: true });
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const { act, id } = btn.dataset;
    if (act === 'view') return showDetails(id);
    const d = lastItems.find((x) => x.doctorId === id) || {};
    const approve = act === 'approve';
    const { confirmed, value } = await UI.confirm({
      title: approve ? `Approve Dr. ${d.name}?` : `Reject Dr. ${d.name}?`,
      message: approve
        ? `Licence ${d.licenseNumber} at ${d.hospital}. The doctor will be able to request access to patient records (patients still decide).`
        : 'The doctor will be blocked from requesting or viewing any patient records.',
      confirmLabel: approve ? 'Approve doctor' : 'Reject doctor',
      danger: !approve,
      input: approve ? null : { label: 'Reason (optional, kept in the audit log)', maxLength: 500 },
    });
    if (!confirmed) return;
    UI.setLoading(btn, true, '…');
    try {
      await API.patch(`/admin/doctors/${id}/${act}`, value ? { reason: value } : {});
      UI.toast(approve ? 'Doctor approved.' : 'Doctor rejected.');
    } catch (err) { UI.toast(err.message, 'error'); }
    await load();
  });

  pagerEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b && !b.disabled) { page = Number(b.dataset.page); load(); }
  });
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { q = search.value.trim(); page = 1; load(); }, 300);
  });

  load();
});
