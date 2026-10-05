/**
 * Patient sharing actions (grant / revoke / change expiry). Every change is a MetaMask
 * transaction that the backend verifies on-chain before updating MongoDB.
 * Requires api.js, ui.js, vendor/ethers.umd.min.js and wallet.js.
 */
(function () {
  const Sharing = {
    async grant({ recordId, doctorId, expiresAt }, onStep = () => {}) {
      onStep('Preparing…');
      const prep = await API.post('/permissions/prepare', { recordId, doctorId, expiresAt });
      const txHash = await Wallet.sendPrepared(prep, onStep);
      return API.post('/permissions', { recordId, doctorId, expiresAt: prep.expiresAt, txHash });
    },

    async revoke(permissionId, onStep = () => {}) {
      onStep('Preparing…');
      const prep = await API.get(`/permissions/${permissionId}/revoke/prepare`);
      const body = prep.needsChainTx ? { txHash: await Wallet.sendPrepared(prep, onStep) } : {};
      return API.patch(`/permissions/${permissionId}/revoke`, body);
    },

    /**
     * The contract never silently rewrites an active grant, so changing the expiry is two
     * patient-signed transactions: revoke the current grant, then grant again with the new expiry.
     */
    async changeExpiry(perm, expiresAt, onStep = () => {}) {
      await Sharing.revoke(perm.id, (t) => onStep(`Step 1 of 2 — ${t}`));
      try {
        return await Sharing.grant({ recordId: perm.record.id, doctorId: perm.doctor.id, expiresAt }, (t) => onStep(`Step 2 of 2 — ${t}`));
      } catch (err) {
        err.message = `The old access was revoked, but the new grant was not completed: ${err.message} Share the record again to restore access.`;
        throw err;
      }
    },

    /** Converts a preset (minutes) or custom datetime-local value to an ISO expiry. */
    expiryFrom(preset, custom) {
      if (preset === 'custom') return custom ? new Date(custom).toISOString() : null;
      return new Date(Date.now() + Number(preset) * 60000).toISOString();
    },

    expiryFieldsHtml(prefix = 's', defaultPreset = 1440) {
      const opts = UI.EXPIRY_PRESETS.map(([v, l]) => `<option value="${v}" ${v === defaultPreset ? 'selected' : ''}>${l}</option>`).join('');
      return `<div class="form-group"><label for="${prefix}-preset">Access expires after</label><select class="form-control" id="${prefix}-preset" name="preset">${opts}</select></div>
        <div class="form-group" id="${prefix}-custom-wrap" hidden><label for="${prefix}-custom">Expires at</label><input class="form-control" id="${prefix}-custom" name="custom" type="datetime-local"></div>
        <div class="field-error" data-error-for="expiresAt"></div>`;
    },
  };

  // Show the custom date field when "Custom" is chosen in any expiry selector.
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || !t.id || !t.id.endsWith('-preset')) return;
    const prefix = t.id.slice(0, -'-preset'.length);
    const wrap = document.getElementById(`${prefix}-custom-wrap`);
    if (!wrap) return;
    wrap.hidden = t.value !== 'custom';
    if (!wrap.hidden) {
      const min = new Date(Date.now() + 10 * 60000); min.setSeconds(0, 0);
      const local = new Date(min.getTime() - min.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      const input = document.getElementById(`${prefix}-custom`); input.min = local; if (!input.value) input.value = local;
    }
  });

  window.Sharing = Sharing;
})();
