'use strict';
/**
 * Deploys MedicalAccessControl to the LOCAL Ganache chain and stores CONTRACT_ADDRESS in .env.
 *   npm run chain:deploy        (refuses to run against any chain other than 1337 / 31337)
 * The deployer (contract owner = platform backend) is PRIVATE_KEY from .env; if it is not set,
 * the first Ganache test account derived from GANACHE_MNEMONIC is used and saved. Keys are never printed.
 */
const { JsonRpcProvider, Wallet, ContractFactory, HDNodeWallet } = require('ethers');
const artifact = require('../../src/blockchain/MedicalAccessControl.json');
const { readEnvValue, setEnvValue } = require('./envFile');

const LOCAL_CHAIN_IDS = [1337n, 31337n];

async function deploy({ rpcUrl, privateKey, log = console.log } = {}) {
  const provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1 });
  const { chainId } = await provider.getNetwork();
  if (!LOCAL_CHAIN_IDS.includes(chainId)) throw new Error(`Refusing to deploy to chainId ${chainId}: only the local test chain is allowed.`);
  const signer = new Wallet(privateKey, provider);
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy();
  const receipt = await contract.deploymentTransaction().wait();
  const address = await contract.getAddress();
  log(`MedicalAccessControl deployed at ${address} (chainId ${chainId}, block ${receipt.blockNumber}, tx ${receipt.hash}).`);
  return { address, txHash: receipt.hash, owner: signer.address };
}

async function main() {
  const rpcUrl = readEnvValue('BLOCKCHAIN_RPC_URL') || 'http://127.0.0.1:8545';
  let privateKey = readEnvValue('PRIVATE_KEY');
  if (!privateKey) {
    const mnemonic = readEnvValue('GANACHE_MNEMONIC');
    if (!mnemonic) throw new Error('Start the chain first (npm run chain) so GANACHE_MNEMONIC exists, or set PRIVATE_KEY.');
    privateKey = HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/0").privateKey;
    setEnvValue('PRIVATE_KEY', privateKey);
    console.log('Saved the first local Ganache test account as the platform signer (PRIVATE_KEY in .env).');
  }
  const { address } = await deploy({ rpcUrl, privateKey });
  setEnvValue('CONTRACT_ADDRESS', address);
  console.log('CONTRACT_ADDRESS saved to .env. Restart the backend to use it.');
}

if (require.main === module) {
  main().catch((e) => { console.error('Deployment failed:', e.shortMessage || e.message); process.exit(1); });
}

module.exports = { deploy };
