'use strict';
/**
 * Test helpers for the blockchain layer: a throw-away in-process Ganache chain with a freshly
 * deployed contract, plus helpers that perform the real patient flows (sign in a wallet, send the
 * transaction, confirm it with the API).
 */
const ganache = require('ganache');
const { JsonRpcProvider, Wallet, HDNodeWallet, Contract, Mnemonic } = require('ethers');
const { chainOptions } = require('../scripts/chain/startChain');
const { deploy } = require('../scripts/chain/deploy');
const artifact = require('../src/blockchain/MedicalAccessControl.json');
const { call } = require('./helpers');

const TEST_MNEMONIC = 'test test test test test test test test test test test junk'; // public test-only phrase

async function startTestChain() {
  const server = ganache.server(chainOptions({ mnemonic: TEST_MNEMONIC }));
  const port = 20000 + Math.floor(Math.random() * 20000);
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', (e) => (e ? reject(e) : resolve())));
  const url = `http://127.0.0.1:${port}`;
  const provider = new JsonRpcProvider(url, 1337, { staticNetwork: true, polling: true, pollingInterval: 100, cacheTimeout: -1 });
  const wallets = [0, 1, 2, 3, 4].map((i) => HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(TEST_MNEMONIC), `m/44'/60'/0'/0/${i}`).connect(provider));
  const owner = wallets[0];
  const { address } = await deploy({ rpcUrl: url, privateKey: owner.privateKey, log: () => {} });
  Object.assign(process.env, { BLOCKCHAIN_RPC_URL: url, CONTRACT_ADDRESS: address, PRIVATE_KEY: owner.privateKey, CHAIN_ID: '1337' });
  return {
    url, provider, server, owner, wallets, address,
    contract: (signer = provider) => new Contract(address, artifact.abi, signer),
    increaseTime: async (seconds) => { await provider.send('evm_increaseTime', [seconds]); await provider.send('evm_mine', []); },
    stop: async () => { provider.destroy(); await server.close(); },
  };
}

/** Fresh wallet with no funds (the API's local test funding gives it gas when linked). */
function freshWallet(provider) { return Wallet.createRandom().connect(provider); }

/** Patient links a wallet: challenge → personal_sign → link. */
async function linkWallet(url, token, wallet) {
  const ch = await call(url, 'POST', '/api/blockchain/wallet/challenge', { token, body: { address: wallet.address } });
  if (ch.status !== 200) return ch;
  const signature = await wallet.signMessage(ch.body.data.message);
  return call(url, 'POST', '/api/blockchain/wallet/link', { token, body: { address: wallet.address, signature, challengeToken: ch.body.data.challengeToken } });
}

/** Sends the transaction a /prepare endpoint asked for. Returns the tx hash. */
async function signPrepared(prep, wallet) {
  const c = new Contract(prep.contractAddress, artifact.abi, wallet);
  const tx = await c[prep.method](...prep.args);
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Full patient share flow. Returns the final API response (or the failing prepare response). */
async function share(url, token, wallet, body) {
  const prep = await call(url, 'POST', '/api/permissions/prepare', { token, body });
  if (prep.status !== 200) return prep;
  const txHash = await signPrepared(prep.body.data, wallet);
  return call(url, 'POST', '/api/permissions', { token, body: { ...body, expiresAt: prep.body.data.expiresAt, txHash } });
}

/** Full patient revoke flow for one permission. */
async function revokeShare(url, token, wallet, permissionId) {
  const prep = await call(url, 'GET', `/api/permissions/${permissionId}/revoke/prepare`, { token });
  if (prep.status !== 200) return prep;
  const body = prep.body.data.needsChainTx ? { txHash: await signPrepared(prep.body.data, wallet) } : {};
  return call(url, 'PATCH', `/api/permissions/${permissionId}/revoke`, { token, body });
}

/** Full patient flow for revoking a doctor relationship. */
async function revokeRelation(url, token, wallet, relationId) {
  const prep = await call(url, 'GET', `/api/relations/${relationId}/revoke/prepare`, { token });
  if (prep.status !== 200) return prep;
  const body = prep.body.data.needsChainTx ? { txHash: await signPrepared(prep.body.data, wallet) } : {};
  return call(url, 'PATCH', `/api/relations/${relationId}/revoke`, { token, body });
}

module.exports = { startTestChain, freshWallet, linkWallet, signPrepared, share, revokeShare, revokeRelation, TEST_MNEMONIC };
