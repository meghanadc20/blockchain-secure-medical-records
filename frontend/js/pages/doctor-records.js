// Doctor: records shared with me (ACTIVE / EXPIRED / REVOKED), open active ones.
Layout.ready.then(({ user }) => {
  const listEl = document.getElementById('list');
  const tabs = [...document.querySelectorAll('.tab')];
  let current = 'ACTIVE';
  const s = user.doctorProfile && user.doctorProfile.verificationStatus;
  if (s !== 'APPROVED') {
    UI.showAlert(document.getElementById('verify-alert'), s === 'REJECTED' ? 'error' : 'warning',
      s === 'REJECTED' ? 'Your verification was rejected. You cannot access patient records.' : 'Verification pending. Shared records are available once an administrator approves you.');
    listEl.innerHTML = UI.state('empty', 'Not available', 'Records can be shared with verified doctors only.');
    return;
  }

  async function counts() {
    await Promise.all(tabs.map(async (t) => {
      try { document.querySelector(`[data-count="${t.dataset.status}"]`).textContent = (await API.get(`/permissions/doctor?status=${t.dataset.status}&limit=1`)).total; } catch { /* cosmetic */ }
    }));
  }

  async function load() {
    listEl.innerHTML = UI.state('loading', 'Loading records…');
    try {
      const data = await API.get(`/permissions/doctor?status=${current}&limit=100`);
      UI.syncServerTime(data.serverTime);
      if (!data.items.length) {
        listEl.innerHTML = UI.state('empty', { ACTIVE: 'No active access', EXPIRED: 'No expired access', REVOKED: 'No revoked access' }[current],
          current === 'ACTIVE' ? 'When a patient shares a record with you, it appears here until it expires.' : '');
        return;
      }
      listEl.innerHTML = UI.table([
        { label: 'Record', render: (p) => `<strong>${UI.esc(p.record.title || 'Record')}</strong><span class="cell-sub">${UI.esc(UI.RECORD_TYPES[p.record.recordType] || '')}${p.record.fileName ? ` · ${UI.esc(p.record.fileName)}` : ''}</span>` },
        { label: 'Patient', render: (p) => UI.esc(p.patient.name) },
        { label: 'Granted', render: (p) => UI.formatDate(p.grantedAt, true) },
        { label: 'Expires', render: (p) => `${UI.formatDate(p.expiresAt, true)}<span class="cell-sub">${p.status === 'ACTIVE' ? UI.countdown(p.expiresAt) : ''}</span>` },
        { label: 'Status', render: (p) => `${UI.permissionBadge(p)}<div style="margin-top:4px">${UI.chainBadge(p.blockchainTransactionHash, 'Grant')}</div>` },
        { label: 'Integrity', render: (p) => UI.integrityBadge(p.record.lastIntegrityCheck) },
        { label: 'Actions', render: (p) => (p.status === 'ACTIVE' && p.record.hasFile
          ? `<div class="actions"><button class="btn btn-primary btn-sm" data-view="${p.record.id}">View</button><button class="btn btn-outline btn-sm" data-download="${p.record.id}">Download</button><button class="btn btn-outline btn-sm" data-verify="${p.record.id}" data-title="${UI.esc(p.record.title)}">Verify</button></div>`
          : '<span class="muted">—</span>') },
      ], data.items, { caption: `${current} shared records` });
      UI.tickCountdowns();
    } catch (err) {
      listEl.innerHTML = UI.state('error', 'Could not load records', err.message);
    }
  }

  listEl.addEventListener('click', async (e) => {
    const ver = e.target.closest('[data-verify]');
    if (ver) { await UI.verifyIntegrity(ver.dataset.verify, ver.dataset.title); load(); return; }
    const v = e.target.closest('[data-view]'); const d = e.target.closest('[data-download]');
    if (!v && !d) return;
    try { await UI.openFile((v || d).dataset[v ? 'view' : 'download'], { inline: Boolean(v) }); } catch { /* toast shown */ }
    // If access expired/revoked meanwhile, the server refused it — refresh the lists.
    load(); counts();
  });
  tabs.forEach((t) => t.addEventListener('click', () => {
    tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    current = t.dataset.status; load(); counts();
  }));
  // A share that reaches its expiry while the page is open moves to "Expired" without a reload.
  document.addEventListener('access-expired', () => setTimeout(() => { load(); counts(); }, 1500));
  load(); counts();
});
