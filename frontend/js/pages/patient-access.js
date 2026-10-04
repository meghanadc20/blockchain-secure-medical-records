// Patient: review, approve, reject and revoke doctor access requests.
Layout.ready.then(() => {
  const listEl = document.getElementById('list');
  const tabs = [...document.querySelectorAll('.tab')];
  let current = 'PENDING';

  async function refreshCounts() {
    await Promise.all(tabs.map(async (t) => {
      try {
        const d = await API.get(`/relations/patient?status=${t.dataset.status}&limit=1`);
        document.querySelector(`[data-count="${t.dataset.status}"]`).textContent = d.total;
      } catch { /* counts are cosmetic */ }
    }));
  }

  function actionsFor(r) {
    if (r.status === 'PENDING') {
      return `<div class="actions"><button class="btn btn-secondary btn-sm" data-act="approve" data-id="${r.id}">Approve</button>
        <button class="btn btn-outline btn-sm" data-act="reject" data-id="${r.id}">Reject</button></div>`;
    }
    if (r.status === 'APPROVED') return `<button class="btn btn-danger btn-sm" data-act="revoke" data-id="${r.id}">Revoke access</button>`;
    return '<span class="muted">—</span>';
  }

  function dateFor(r) {
    if (r.status === 'APPROVED') return `Approved ${UI.formatDate(r.approvedAt, true)}`;
    if (r.status === 'REVOKED') return `Revoked ${UI.formatDate(r.revokedAt, true)}`;
    if (r.status === 'REJECTED') return `Rejected ${UI.formatDate(r.updatedAt, true)}`;
    return `Requested ${UI.formatDate(r.requestedAt, true)}`;
  }

  async function load() {
    listEl.innerHTML = UI.state('loading', 'Loading requests…');
    try {
      const data = await API.get(`/relations/patient?status=${current}&limit=100`);
      if (!data.items.length) {
        const empty = { PENDING: ['No pending requests', 'When a doctor asks for access, it will appear here.'],
          APPROVED: ['No authorized doctors', 'Doctors you approve will be listed here.'],
          'REJECTED,REVOKED': ['No history yet', 'Rejected and revoked requests will be listed here.'] }[current];
        listEl.innerHTML = UI.state('empty', ...empty);
        return;
      }
      listEl.innerHTML = UI.table([
        { label: 'Doctor', render: (r) => `<strong>Dr. ${UI.esc(r.doctor.name)}</strong><span class="cell-sub">${UI.esc(r.doctor.email)}</span>` },
        { label: 'Specialization', render: (r) => `${UI.esc(r.doctor.specialization || '—')}<span class="cell-sub">${UI.esc(r.doctor.hospital || '')}</span>` },
        { label: 'Licence', render: (r) => `${UI.esc(r.doctor.licenseNumber || '—')}<span class="cell-sub">${r.doctor.verificationStatus === 'APPROVED' ? 'Verified doctor' : 'Not verified'}</span>` },
        { label: 'Status', render: (r) => `${UI.badge(r.status)}<span class="cell-sub">${dateFor(r)}</span>` },
        { label: 'Actions', render: actionsFor },
      ], data.items, { caption: 'Doctor access requests' });
    } catch (err) {
      listEl.innerHTML = UI.state('error', 'Could not load requests', err.message);
    }
  }

  const COPY = {
    approve: { title: 'Approve this doctor?', message: 'The doctor will be able to receive access to records you choose to share. No records are shared until you grant them individually.', confirmLabel: 'Approve', danger: false, done: 'Access request approved.' },
    reject: { title: 'Reject this request?', message: 'The doctor will not be given access. They may send a new request later.', confirmLabel: 'Reject', danger: true, done: 'Access request rejected.' },
    revoke: { title: 'Revoke this doctor’s access?', message: 'Access ends immediately, including any records you have shared with this doctor.', confirmLabel: 'Revoke access', danger: true, done: 'Access revoked.' },
  };

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const { act, id } = btn.dataset;
    const c = COPY[act];
    const { confirmed } = await UI.confirm(c);
    if (!confirmed) return;
    UI.setLoading(btn, true, '…');
    try {
      const res = await API.patch(`/relations/${id}/${act}`);
      UI.toast(act === 'revoke' && res.permissionsRevoked ? `${c.done} ${res.permissionsRevoked} shared record(s) revoked.` : c.done);
      await Promise.all([load(), refreshCounts()]);
    } catch (err) {
      UI.toast(err.message, 'error');
      UI.setLoading(btn, false);
      await load();
    }
  });

  tabs.forEach((t) => t.addEventListener('click', () => {
    tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    current = t.dataset.status;
    load();
  }));

  load();
  refreshCounts();
});
