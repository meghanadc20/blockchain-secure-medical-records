// Patient profile: link a MetaMask wallet (signature proof → on-chain registration).
Layout.ready.then(async ({ user }) => {
  const btn = document.getElementById('wallet-link');
  const alertEl = document.getElementById('wallet-alert');
  const info = document.getElementById('wallet-info');
  const badge = document.getElementById('wallet-badge');

  function render(address, extra = []) {
    badge.innerHTML = address ? '<span class="badge badge-verified">Linked</span>' : '<span class="badge badge-pending">Not linked</span>';
    const rows = [['Wallet address', address || 'No wallet linked yet'], ...extra];
    info.innerHTML = rows.map(([k, v]) => `<dt>${UI.esc(k)}</dt><dd style="font-family:ui-monospace,Consolas,monospace;font-size:.9rem">${v}</dd>`).join('');
    btn.textContent = address ? 'Link a different wallet' : 'Connect MetaMask & link wallet';
  }

  render(user.walletAddress ? UI.esc(ethers.getAddress(user.walletAddress)) : null);
  try {
    const cfg = await Wallet.config();
    render(user.walletAddress ? UI.esc(ethers.getAddress(user.walletAddress)) : null, [
      ['Network', `Ganache local test network (chain id ${cfg.chainId})`],
      ['Contract', UI.esc(cfg.contractAddress)],
    ]);
  } catch (err) {
    UI.showAlert(alertEl, 'warning', `${err.message} Start the local chain with “npm run chain”.`);
  }
  if (!Wallet.available()) {
    UI.showAlert(alertEl, 'warning', 'MetaMask was not detected in this browser. Install the MetaMask extension, then reload this page.');
  }

  btn.addEventListener('click', async () => {
    UI.hideAlert(alertEl);
    UI.setLoading(btn, true, 'Waiting for MetaMask…');
    try {
      const res = await Wallet.link();
      user.walletAddress = res.walletAddress.toLowerCase();
      API.Session.setUser(user);
      render(UI.esc(res.walletAddress), [['Registration transaction', UI.chainBadge(res.registrationTxHash, 'Registered')]]);
      UI.showAlert(alertEl, 'success', `Wallet linked and registered on the blockchain.${res.testEtherFunded ? ' It received 1 test ETH for transaction fees (local test network only).' : ''}`);
    } catch (err) {
      UI.showAlert(alertEl, 'error', err.message);
    } finally {
      UI.setLoading(btn, false);
      btn.textContent = user.walletAddress ? 'Link a different wallet' : 'Connect MetaMask & link wallet';
    }
  });
  btn.disabled = false;
});
