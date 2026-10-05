'use strict';
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { verifyMessage, getAddress, isAddress } = require('ethers');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { env } = require('../config/env');
const { logAudit } = require('../services/audit.service');
const chain = require('../services/blockchain.service');

const CHALLENGE_TTL = '10m';
const AUDIENCE = 'wallet-link';

function linkMessage(user, address, nonce) {
  return [
    'MedChain — link wallet',
    '',
    `Account: ${user.email}`,
    `Wallet: ${getAddress(address)}`,
    `Nonce: ${nonce}`,
    '',
    'Signing proves you control this wallet. It does not send a transaction or cost anything.',
  ].join('\n');
}

/** GET /api/blockchain/config — public contract info for the browser (no secrets). */
async function getConfig(req, res) {
  const s = await chain.status();
  if (!s.reachable || !s.contractDeployed) throw new ApiError(503, 'The blockchain network is unavailable.', 'BLOCKCHAIN_UNAVAILABLE');
  res.json({ success: true, data: { ...chain.publicConfig(), localTestNetwork: s.localTestNetwork } });
}

/** POST /api/blockchain/wallet/challenge { address } — patient asks for a message to sign. */
async function walletChallenge(req, res) {
  const address = String((req.body || {}).address || '');
  if (!isAddress(address)) throw ApiError.badRequest('A valid wallet address is required.', 'VALIDATION_ERROR', [{ field: 'address', message: 'Invalid wallet address' }]);
  const nonce = crypto.randomBytes(16).toString('hex');
  const challengeToken = jwt.sign({ sub: String(req.user._id), addr: getAddress(address), nonce }, env.jwtSecret, { expiresIn: CHALLENGE_TTL, audience: AUDIENCE, algorithm: 'HS256' });
  res.json({ success: true, data: { message: linkMessage(req.user, address, nonce), challengeToken } });
}

/**
 * POST /api/blockchain/wallet/link { address, signature, challengeToken }
 * Verifies the signature, saves the wallet, registers it on-chain (owner tx) and,
 * on the LOCAL test chain only, sends it a little test ether for gas.
 */
async function walletLink(req, res) {
  const { address, signature, challengeToken } = req.body || {};
  let claim;
  try {
    claim = jwt.verify(String(challengeToken || ''), env.jwtSecret, { audience: AUDIENCE, algorithms: ['HS256'] });
  } catch {
    throw ApiError.badRequest('The wallet challenge expired. Please try again.', 'CHALLENGE_INVALID');
  }
  if (claim.sub !== String(req.user._id) || !isAddress(String(address || '')) || claim.addr !== getAddress(address)) {
    throw ApiError.badRequest('The wallet challenge does not match.', 'CHALLENGE_INVALID');
  }
  let recovered;
  try { recovered = verifyMessage(linkMessage(req.user, address, claim.nonce), String(signature || '')); } catch { recovered = null; }
  if (!recovered || getAddress(recovered) !== getAddress(address)) {
    throw ApiError.badRequest('The signature does not match this wallet.', 'SIGNATURE_INVALID');
  }

  const wallet = getAddress(address);
  const lower = wallet.toLowerCase();
  const owner = await User.findOne({ walletAddress: lower, _id: { $ne: req.user._id } }).select('_id').lean();
  if (owner) throw ApiError.conflict('This wallet is already linked to another account.', 'WALLET_IN_USE');

  // On-chain first: if the chain is down nothing is saved.
  const { txHash } = await chain.registerPatientWallet(req.user._id, wallet);
  let funding = { funded: false };
  try { funding = await chain.fundTestWallet(wallet); } catch (e) { console.warn('[blockchain] test funding skipped:', e.message); }

  await User.updateOne({ _id: req.user._id }, { walletAddress: lower });
  await logAudit({ req, action: 'WALLET_LINKED', patientId: req.user._id, blockchainTransactionHash: txHash, metadata: { wallet, testEtherFunded: Boolean(funding.funded) } });
  res.json({ success: true, data: { walletAddress: wallet, registrationTxHash: txHash, testEtherFunded: Boolean(funding.funded) } });
}

module.exports = { getConfig, walletChallenge, walletLink, linkMessage };
