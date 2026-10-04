// Patient: list own records, edit title/type/description.
Layout.ready.then(() => {
  const listEl = document.getElementById('list');
  const q = document.getElementById('q');
  const typeSel = document.getElementById('type');
  let timer; let items = [];

  typeSel.innerHTML += Object.entries(UI.RECORD_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

  function card(r) {
    return `<article class="card record-card">
      <div class="card-header" style="margin:0"><h3>${UI.esc(r.title)}</h3><span class="badge badge-info" style="text-transform:none">${UI.esc(UI.RECORD_TYPES[r.recordType] || r.recordType)}</span></div>
      ${r.description ? `<p class="muted" style="margin:0">${UI.multiline(r.description)}</p>` : ''}
      <dl class="record-meta">
        <dt>Date</dt><dd>${UI.formatDate(r.createdAt, true)}</dd>
        <dt>Uploaded by</dt><dd>${UI.esc(r.uploadedBy.name || '—')}</dd>
        <dt>File</dt><dd>${r.hasFile ? `${UI.esc(r.fileName || 'Stored file')} · ${UI.formatBytes(r.fileSize)}` : '<span class="muted">No file attached</span>'}</dd>
        <dt>Access</dt><dd><span class="muted">Shared access is managed with Module 4</span></dd>
        <dt>Integrity</dt><dd><span class="muted">Not yet verified (Module 6)</span></dd>
      </dl>
      <div class="actions"><button class="btn btn-outline btn-sm" data-edit="${r.id}">Edit details</button></div>
    </article>`;
  }

  async function load() {
    listEl.innerHTML = UI.state('loading', 'Loading records…');
    const qs = new URLSearchParams({ limit: '100' });
    if (q.value.trim()) qs.set('q', q.value.trim());
    if (typeSel.value) qs.set('type', typeSel.value);
    try {
      const data = await API.get(`/records?${qs}`);
      items = data.items;
      listEl.innerHTML = items.length ? items.map(card).join('')
        : `<div class="card" style="grid-column:1/-1">${UI.state('empty', q.value || typeSel.value ? 'No matching records' : 'No records yet', q.value || typeSel.value ? 'Try a different search or type.' : 'Your uploaded reports will appear here.')}</div>`;
    } catch (err) {
      listEl.innerHTML = `<div class="card" style="grid-column:1/-1">${UI.state('error', 'Could not load records', err.message)}</div>`;
    }
  }

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-edit]');
    if (!btn) return;
    const r = items.find((x) => x.id === btn.dataset.edit);
    const opts = Object.entries(UI.RECORD_TYPES).map(([k, v]) => `<option value="${k}" ${k === r.recordType ? 'selected' : ''}>${v}</option>`).join('');
    const saved = await UI.formModal({
      title: 'Edit record details',
      bodyHtml: `<div class="form-group"><label for="m-title">Title</label><input class="form-control" id="m-title" name="title" maxlength="150" value="${UI.esc(r.title)}"><div class="field-error" data-error-for="title"></div></div>
        <div class="form-group"><label for="m-type">Record type</label><select class="form-control" id="m-type" name="recordType">${opts}</select><div class="field-error" data-error-for="recordType"></div></div>
        <div class="form-group"><label for="m-desc">Description</label><textarea class="form-control" id="m-desc" name="description" maxlength="2000" rows="3">${UI.esc(r.description)}</textarea><div class="field-error" data-error-for="description"></div></div>
        <p class="form-hint">The file itself and its integrity hash cannot be changed.</p>`,
      onSubmit: (v) => API.patch(`/records/${r.id}`, v),
    });
    if (saved) { UI.toast('Record details updated.'); load(); }
  });

  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  typeSel.addEventListener('change', load);
  load();
});
