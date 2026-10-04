// Patient: medical-history timeline (records + consultations).
Layout.ready.then(() => {
  const form = document.getElementById('filters');
  const timeline = document.getElementById('timeline');
  const summary = document.getElementById('summary');

  function item(i) {
    if (i.kind === 'CONSULTATION') {
      const c = i.consultation;
      const sec = (label, text) => (text ? `<div><h4>${label}</h4><p>${UI.multiline(text)}</p></div>` : '');
      return `<li class="timeline-item kind-CONSULTATION"><div class="timeline-date">${UI.formatDate(i.date)}</div>
        <article class="card"><div class="card-header" style="margin-bottom:4px"><h3 class="card-title">Consultation with Dr. ${UI.esc(c.doctor.name)}</h3><span class="badge badge-info">Consultation</span></div>
        <div class="muted" style="font-size:.9rem">${UI.esc([c.doctor.specialization, c.doctor.hospital].filter(Boolean).join(' · '))}</div>
        <div class="clinical">${sec('Diagnosis', c.diagnosis)}${sec('Prescription', c.prescription)}${sec('Treatment notes', c.treatmentNotes)}</div></article></li>`;
    }
    const r = i.record;
    return `<li class="timeline-item kind-RECORD"><div class="timeline-date">${UI.formatDate(i.date)}</div>
      <article class="card"><div class="card-header" style="margin-bottom:4px"><h3 class="card-title">${UI.esc(r.title)}</h3><span class="badge badge-approved" style="text-transform:none">${UI.esc(UI.RECORD_TYPES[r.recordType] || r.recordType)}</span></div>
      <div class="muted" style="font-size:.9rem">Uploaded by ${UI.esc(r.uploadedBy.name || '—')}${r.fileName ? ` · ${UI.esc(r.fileName)}` : ''}</div>
      ${r.description ? `<p style="margin:10px 0 0">${UI.multiline(r.description)}</p>` : ''}</article></li>`;
  }

  async function load() {
    const v = UI.formData(form);
    const qs = new URLSearchParams({ type: v.type });
    if (v.from) qs.set('from', v.from);
    if (v.to) qs.set('to', v.to);
    timeline.innerHTML = `<li style="list-style:none;margin-left:-22px">${UI.state('loading', 'Loading your history…')}</li>`;
    summary.textContent = '';
    try {
      const data = await API.get(`/history?${qs}`);
      if (!data.items.length) {
        timeline.innerHTML = `<li style="list-style:none;margin-left:-22px">${UI.state('empty', 'Nothing to show', v.from || v.to || v.type !== 'ALL' ? 'No entries match these filters.' : 'Consultations added by your doctors and records you upload will appear here.')}</li>`;
        return;
      }
      summary.textContent = `${data.counts.consultations} consultation(s), ${data.counts.records} record(s)${data.truncated ? ' — showing the most recent 500' : ''}`;
      timeline.innerHTML = data.items.map(item).join('');
    } catch (err) {
      timeline.innerHTML = `<li style="list-style:none;margin-left:-22px">${UI.state('error', 'Could not load your history', err.message)}</li>`;
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); load(); });
  form.addEventListener('reset', () => setTimeout(load, 0));
  load();
});
