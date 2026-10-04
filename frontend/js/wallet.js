/**
 * MetaMask integration (patients only). The browser never holds private keys: MetaMask signs.
 * The backend prepares exactly what to sign and afterwards verifies the mined transaction itself,
 * so nothing here is trusted for security decisions.
 * Requires /js/vendor/ethers.umd.min.js (global `ethers`).
 */
(function () {
  let cachedConfig = null;

  class WalletError extends Error {
    constructor(message, code) { super(message); this.code = code; }
  }

  function friendly(err) {
    if (err instanceof WalletError || (err && err.status !== undefined && err.code)) return err;
    const code = err && (err.code || (err.info && err.info.error && err.info.error.code));
    if (code === 4001 || code === 'ACTION_REJECTED') return new WalletError('You cancelled the request in MetaMask.', 'USER_REJECTED');
    if (code === -32002) return new WalletError('MetaMask is already waiting for you — open the MetaMask window to continue.', 'PENDING_REQUEST');
    const msg = (err && (err.shortMessage || err.message)) || 'MetaMask request failed.';
    if (/insufficient funds/i.test(msg)) return new WalletError('Your wallet has no test ether for gas. Re-link your wallet on the Profile page to receive local test ether.', 'INSUFFICIENT_FUNDS');
    return new WalletError(msg, 'WALLET_ERROR');
  }

  const Wallet = {
    available() { return Boolean(window.ethereum && window.ethers); },

    async config() {
      if (!cachedConfig) cachedConfig = await API.get('/blockchain/config');
      return cachedConfig;
    },

    /** Asks MetaMask for an account and makes sure it is on the local Ganache network. */
    async connect() {
      if (!Wallet.available()) throw new WalletError('MetaMask was not detected. Install the MetaMask extension and reload this page.', 'NO_WALLET');
      const cfg = await Wallet.config();
      try {
        const [account] = await window.ethereum.request({ method: 'eth_requestAccounts' });
        await Wallet.ensureNetwork(cfg);
        return ethers.getAddress(account);
      } catch (err) { throw friendly(err); }
    },

    async ensureNetwork(cfg) {
      const hexId = `0x${Number(cfg.chainId).toString(16)}`;
      const current = await window.ethereum.request({ method: 'eth_chainId' });
      if (parseInt(current, 16) === Number(cfg.chainId)) return;
      try {
        await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
      } catch (err) {
        if (err && (err.code === 4902 || /Unrecognized chain/i.test(err.message || ''))) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{ chainId: hexId, chainName: 'Ganache (local test network)', rpcUrls: [cfg.rpcUrl], nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 } }],
          });
        } else throw err;
      }
    },

    /** Proves wallet ownership by signing a message (no transaction), then links it to the account. */
    async link() {
      const address = await Wallet.connect();
      const { message, challengeToken } = await API.post('/blockchain/wallet/challenge', { address });
      let signature;
      try {
        signature = await window.ethereum.request({ method: 'personal_sign', params: [ethers.hexlify(ethers.toUtf8Bytes(message)), address] });
      } catch (err) { throw friendly(err); }
      return API.post('/blockchain/wallet/link', { address, signature, challengeToken });
    },

    /**
     * Sends the contract call described by a backend /prepare response and waits for it to be mined.
     * onStep(text) receives progress messages. Returns the transaction hash.
     */
    async sendPrepared(prep, onStep = () => {}) {
      onStep('Connecting to MetaMask…');
      const account = await Wallet.connect();
      if (prep.wallet && account.toLowerCase() !== prep.wallet.toLowerCase()) {
        throw new WalletError(`MetaMask is using ${account.slice(0, 6)}…${account.slice(-4)}, but your linked wallet is ${prep.wallet.slice(0, 6)}…${prep.wallet.slice(-4)}. Switch accounts in MetaMask and try again.`, 'WRONG_ACCOUNT');
      }
      const cfg = await Wallet.config();
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const contract = new ethers.Contract(prep.contractAddress, cfg.abi, signer);
        onStep('Confirm the transaction in MetaMask…');
        const tx = await contract[prep.method](...prep.args);
        onStep('Waiting for the transaction to be mined…');
        const receipt = await tx.wait();
        if (!receipt || receipt.status !== 1) throw new WalletError('The blockchain transaction failed.', 'TX_FAILED');
        onStep('Verifying on the blockchain…');
        return receipt.hash;
      } catch (err) { throw friendly(err); }
    },
  };

  window.Wallet = Wallet;
})();
