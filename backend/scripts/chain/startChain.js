'use strict';
/**
 * Starts the LOCAL Ganache test blockchain (never a real network).
 *   npm run chain
 * - chainId 1337, http://127.0.0.1:8545
 * - accounts come from GANACHE_MNEMONIC in .env (generated on first run, never printed)
 * - state is persisted in blockchain/.ganache-db so the deployed contract survives restarts
 * - Ganache's own account/private-key banner is disabled (quiet logging)
 */
const path = require('path');
const fs = require('fs');
const ganache = require('ganache');
const { Wallet } = require('ethers');
const { readEnvValue, setEnvValue } = require('./envFile');

const HOST = '127.0.0.1';
const PORT = Number(process.env.GANACHE_PORT) || 8545;
const CHAIN_ID = 1337;
const DB_PATH = path.resolve(__dirname, '../../../blockchain/.ganache-db');

function chainOptions({ mnemonic, dbPath } = {}) {
  return {
    chain: { chainId: CHAIN_ID, networkId: CHAIN_ID, hardfork: 'shanghai', vmErrorsOnRPCResponse: true },
    wallet: { mnemonic, totalAccounts: 5, defaultBalance: 1000 },
    miner: { blockGasLimit: 30_000_000 },
    logging: { quiet: true },
    ...(dbPath ? { database: { dbPath } } : {}),
  };
}

async function main() {
  let mnemonic = readEnvValue('GANACHE_MNEMONIC');
  if (!mnemonic) {
    mnemonic = Wallet.createRandom().mnemonic.phrase;
    setEnvValue('GANACHE_MNEMONIC', `"${mnemonic}"`);
    console.log('Generated a new local test mnemonic and saved it to .env (GANACHE_MNEMONIC).');
  }
  if (!readEnvValue('BLOCKCHAIN_RPC_URL')) setEnvValue('BLOCKCHAIN_RPC_URL', `http://${HOST}:${PORT}`);
  if (!readEnvValue('CHAIN_ID')) setEnvValue('CHAIN_ID', String(CHAIN_ID));

  fs.mkdirSync(DB_PATH, { recursive: true });
  const server = ganache.server(chainOptions({ mnemonic, dbPath: DB_PATH }));
  await new Promise((resolve, reject) => server.listen(PORT, HOST, (err) => (err ? reject(err) : resolve())));
  const block = await server.provider.request({ method: 'eth_blockNumber', params: [] });
  console.log(`Local Ganache test chain running at http://${HOST}:${PORT} (chainId ${CHAIN_ID}, block ${parseInt(block, 16)}).`);
  console.log('Test network only — no real funds. Keep this window open. Press Ctrl+C to stop.');

  const stop = () => server.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (require.main === module) {
  main().catch((e) => { console.error('Could not start Ganache:', e.message); process.exit(1); });
}

module.exports = { chainOptions, CHAIN_ID };
