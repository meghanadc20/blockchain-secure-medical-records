// Patient: overview of all time-limited shares — live countdowns, revoke, change expiry.
Layout.ready.then(() => {
  const listEl = document.getElementById('list');
  const summaryEl = document.getElementById('summary');
  const tabs = [...document.querySelectorAll('.tab')];
  let current = 'ACTIVE'; let items = [];

  async function loadSummary() {
    try {
      const s = await API.get('/permissions/summary');
      UI.syncServerTime(s.serverTime);
      const card = (label, html, warn) => `<div class="card stat"${warn ? ' style="border-color:#FDE68A;background:var(--warning-soft)"' : ''}><span class="stat-label">${label}</span><span class="stat-value">${html}</span></div>`;
      summaryEl.innerHTML = card('Active shares', s.active)
        + card('Expiring within 24 hours', s.expiringSoon, s.expiringSoon > 0)
        + card('Next expiry', s.nextExpiry ? `<span style="font-size:1.1rem">${UI.formatDate(s.nextExpiry, true)}</span><span style="display:block;margin-top:4px">${UI.countdown(s.nextExpiry)}</span>` : '<span class="muted" style="font-size:1rem">—</span>');
    } catch { summaryEl.innerHTML = ''; }
    await Promise.all(tabs.map(async (t) => {
      try { document.querySelector(`[data-count="${t.dataset.status}"]`).textContent = (await API.get(`/permissions?status=${t.dataset.status}&limit=1`)).total; } catch { /* cosmetic */ }
    }));
    UI.tickCountdowns();
  }

  async function load() {
    listEl.innerHTML = UI.state('loading', 'Loading shares…');
    try {
      const want = current; // ignore responses for a tab the user has already left
      const data = await API.get(`/permissions?status=${current}&limit=100`);
      if (want !== current) return;
      UI.syncServerTime(data.serverTime);
      items = data.items;
      if (!items.length) {
        listEl.innerHTML = UI.state('empty', { ACTIVE: 'No active shares', EXPIRING: 'Nothing expires in the next 24 hours', EXPIRED: 'No expired shares', REVOKED: 'No revoked shares' }[current],
          current === 'ACTIVE' ? 'Share a record from the Medical Records page.' : '');
        return;
      }
      listEl.innerHTML = UI.table([
        { label: 'Record', render: (p) => `<strong>${UI.esc(p.record.title || 'Record')}</strong><span class="cell-sub">${UI.esc(UI.RECORD_TYPES[p.record.recordType] || '')}</span>` },
        { label: 'Doctor', render: (p) => `Dr. ${UI.esc(p.doctor.name)}<span class="cell-sub">${UI.esc(p.doctor.email)}</span>` },
        { label: 'Granted', render: (p) => UI.formatDate(p.grantedAt, true) },
        { label: 'Expires', render: (p) => `${UI.formatDate(p.expiresAt, true)}<span class="cell-sub">${p.status === 'ACTIVE' ? UI.countdown(p.expiresAt) : (p.status === 'REVOKED' ? `revoked ${UI.formatDate(p.revokedAt, true)}` : 'ended')}</span>` },
        { label: 'Status', render: (p) => `${UI.permissionBadge(p)}<div style="margin-top:4px">${UI.chainBadge(p.blockchainTransactionHash, 'Grant')}</div>` },
        { label: 'Actions', render: (p) => (p.status === 'ACTIVE'
          ? `<div class="actions"><button class="btn btn-outline btn-sm" data-change="${p.id}">Change expiry</button><button class="btn btn-danger btn-sm" data-revoke="${p.id}">Revoke</button></div>`
          : `<button class="btn btn-outline btn-sm" data-reshare="${p.id}">Share again</button>`) },
      ], items, { caption: `${current} shares` });
      UI.tickCountdowns();
    } catch (err) {
      listEl.innerHTML = UI.state('error', 'Could not load shares', err.message);
    }
  }

  function expiryModal(title, intro, confirmLabel, onSubmit) {
    return UI.formModal({
      title, confirmLabel,
      bodyHtml: `<p class="muted" style="margin-top:0">${intro}</p>${Sharing.expiryFieldsHtml('c', 1440)}`,
      onSubmit: async (v) => {
        const expiresAt = Sharing.expiryFrom(v.preset, v.custom);
        if (!expiresAt) { const e = new Error('Choose the expiry date and time'); e.details = [{ field: 'expiresAt', message: 'Choose the expiry date and time' }]; throw e; }
        const submit = document.querySelector('#fm-form button[type="submit"]');
        const step = (t) => { if (submit) submit.innerHTML = `<span class="spinner spinner-sm" aria-hidden="true"></span> ${UI.esc(t)}`; };
        return onSubmit(expiresAt, step);
      },
    });
  }

  listEl.addEventListener('click', async (e) => {
    const rv = e.target.closest('[data-revoke]'); const ch = e.target.closest('[data-change]'); const rs = e.target.closest('[data-reshare]');
    const p = items.find((x) => x.id === (rv || ch || rs || {}).dataset?.[rv ? 'revoke' : ch ? 'change' : 'reshare']);
    if (!p) return;
    if (rv) {
      const { confirmed } = await UI.confirm({ title: 'Revoke access?', message: `Dr. ${p.doctor.name} will lose access to “${p.record.title}” immediately. MetaMask will ask you to confirm.`, confirmLabel: 'Revoke', danger: true });
      if (!confirmed) return;
      UI.setLoading(rv, true, 'Preparing…');
      try { await Sharing.revoke(p.id, (t) => UI.setLoading(rv, true, t)); UI.toast('Access revoked and recorded on the blockchain.'); } catch (err) { UI.toast(err.message, 'error'); }
    } else if (ch) {
      const res = await expiryModal(`Change expiry — ${p.record.title}`,
        `Current expiry: <strong>${UI.esc(UI.formatDate(p.expiresAt, true))}</strong>. Changing it takes <strong>two MetaMask confirmations</strong>: the current grant is revoked, then a new grant with the new expiry is created.`,
        'Change expiry', (expiresAt, step) => Sharing.changeExpiry(p, expiresAt, step));
      if (res) UI.toast(`Access now expires ${UI.formatDate(res.permission.expiresAt, true)}.`);
    } else {
      const res = await expiryModal(`Share again — ${p.record.title}`, `Give Dr. ${UI.esc(p.doctor.name)} new time-limited access to this record.`, 'Grant access',
        (expiresAt, step) => Sharing.grant({ recordId: p.record.id, doctorId: p.doctor.id, expiresAt }, step));
      if (res) UI.toast(`Shared until ${UI.formatDate(res.permission.expiresAt, true)}.`);
    }
    load(); loadSummary();
  });

  tabs.forEach((t) => t.addEventListener('click', () => {
    tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    current = t.dataset.status; load(); loadSummary();
  }));
  // When a countdown reaches zero, refresh so the share moves to "Expired".
  document.addEventListener('access-expired', () => setTimeout(() => { load(); loadSummary(); }, 1500));
  load(); loadSummary();
});
