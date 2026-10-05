// Patient: audit trail of everything that happened to their data.
Layout.ready.then(() => {
  const form = document.getElementById('filters');
  const listEl = document.getElementById('list');
  const pagerEl = document.getElementById('pager');
  const summaryEl = document.getElementById('summary');
  let page = 1;

  const SEVERITY = { TAMPER_DETECTED: 'tamper', ACCESS_DENIED: 'rejected', LOGIN_FAILED: 'rejected', ACCESS_REVOKED: 'revoked', ACCESS_EXPIRED: 'expired', ACCESS_GRANTED: 'active', HASH_VERIFICATION: 'info', RECORD_VIEW: 'info' };
  function eventBadge(a) {
    return `<span class="badge badge-${SEVERITY[a] || 'info'}" style="text-transform:none">${UI.esc(UI.AUDIT_LABELS[a] || a)}</span>`;
  }
  function who(i) {
    if (i.actor.role === 'SYSTEM') return 'System (automatic)';
    if (i.actor.role === 'ANONYMOUS') return 'Unknown';
    const name = i.actor.name ? UI.esc(i.actor.name) : '—';
    return i.actor.role === 'DOCTOR' ? `Dr. ${name}` : i.actor.role === 'PATIENT' ? `${name} (you)` : `${name} (${UI.esc(i.actor.role.toLowerCase())})`;
  }
  function details(i) {
    const d = i.details || {}; const parts = [];
    if (i.doctor && i.actor.role !== 'DOCTOR') parts.push(`Doctor: Dr. ${UI.esc(i.doctor.name)}`);
    if (d.result) parts.push(d.result === 'INTEGRITY_VERIFIED' ? '<strong style="color:var(--success)">INTEGRITY VERIFIED</strong>' : '<strong style="color:var(--error)">TAMPER DETECTED</strong>');
    if (d.trustedSource) parts.push(`checked against ${d.trustedSource === 'BLOCKCHAIN' ? 'on-chain fingerprint' : 'stored fingerprint'}`);
    if (d.stage) parts.push(`stage: ${UI.esc(d.stage)}`);
    if (d.reason) parts.push(`reason: ${UI.esc(String(d.reason).replace(/_/g, ' ').toLowerCase())}`);
    if (d.scope) parts.push(d.scope === 'RECORD' ? 'single record' : 'doctor relationship');
    if (d.expiresAt) parts.push(`expires ${UI.formatDate(d.expiresAt, true)}`);
    if (d.permissionsRevoked) parts.push(`${d.permissionsRevoked} shared record(s) revoked`);
    if (d.type === 'FILE') parts.push('file opened');
    if (d.detectedBy === 'SWEEP') parts.push('expired automatically');
    return parts.join(' · ') || '<span class="muted">—</span>';
  }

  async function loadSummary() {
    try {
      const s = await API.get('/audit/summary');
      const card = (label, value, alert) => `<div class="card stat"${alert ? ' style="border-color:#FECACA;background:var(--error-soft)"' : ''}><span class="stat-label">${label}</span><span class="stat-value"${alert ? ' style="color:var(--error)"' : ''}>${value}</span></div>`;
      summaryEl.innerHTML = card('Doctor views (30 days)', s.last30Days.doctorViews)
        + card('Denied attempts (30 days)', s.last30Days.deniedAttempts, s.last30Days.deniedAttempts > 0)
        + card('Integrity checks (30 days)', s.last30Days.integrityChecks)
        + card('Tamper alerts (all time)', s.tamperAlerts, s.tamperAlerts > 0);
    } catch (err) { summaryEl.innerHTML = ''; }
  }

  async function load() {
    const v = UI.formData(form);
    const qs = new URLSearchParams({ page: String(page), limit: '25' });
    for (const k of ['category', 'from', 'to']) if (v[k]) qs.set(k, v[k]);
    listEl.innerHTML = UI.state('loading', 'Loading audit trail…'); pagerEl.innerHTML = '';
    try {
      const data = await API.get(`/audit?${qs}`);
      if (!data.items.length) { listEl.innerHTML = UI.state('empty', 'No events', 'Nothing matches these filters.'); return; }
      listEl.innerHTML = UI.table([
        { label: 'When', render: (i) => `<span style="white-space:nowrap">${UI.formatDate(i.timestamp)}</span><span class="cell-sub" style="white-space:nowrap">${new Date(i.timestamp).toLocaleTimeString(undefined, { timeStyle: 'short' })} · ${UI.relativeTime(i.timestamp)}</span>` },
        { label: 'Event', render: (i) => eventBadge(i.action) },
        { label: 'By', render: who },
        { label: 'Record', render: (i) => (i.record ? UI.esc(i.record.title || 'Record') : '<span class="muted">—</span>') },
        { label: 'Details', render: details },
        { label: 'Blockchain', render: (i) => (i.blockchainTransactionHash ? UI.chainBadge(i.blockchainTransactionHash, 'Tx') : '<span class="muted">—</span>') },
      ], data.items, { caption: 'Audit trail' });
      if (data.pages > 1) {
        pagerEl.innerHTML = `<button class="btn btn-outline btn-sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Newer</button>
          <span>Page ${data.page} of ${data.pages} · ${data.total} events</span>
          <button class="btn btn-outline btn-sm" data-page="${page + 1}" ${page >= data.pages ? 'disabled' : ''}>Older</button>`;
      }
    } catch (err) { listEl.innerHTML = UI.state('error', 'Could not load the audit trail', err.message); }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); page = 1; load(); });
  form.addEventListener('reset', () => setTimeout(() => { page = 1; load(); }, 0));
  pagerEl.addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) { page = Number(b.dataset.page); load(); } });
  loadSummary(); load();
});
