'use strict';
/**
 * Deploys MedicalAccessControl and stores its address in the project-root .env.
 *
 *   npm run chain:deploy           LOCAL Ganache (chain 1337 / 31337) → CONTRACT_ADDRESS
 *   npm run chain:deploy:sepolia   Ethereum Sepolia TEST network (11155111) → SEPOLIA_CONTRACT_ADDRESS
 *
 * Local: the deployer (contract owner = platform backend) is PRIVATE_KEY; if it is not set, the
 * first Ganache test account derived from GANACHE_MNEMONIC is used and saved.
 * Sepolia: uses SEPOLIA_RPC_URL and SEPOLIA_PRIVATE_KEY (create it with
 * `npm run chain:sepolia-wallet`) and never touches the local CONTRACT_ADDRESS / PRIVATE_KEY.
 * Any other chain (including Ethereum mainnet) is refused. Keys and RPC URLs are never printed.
 */
const { JsonRpcProvider, Wallet, ContractFactory, HDNodeWallet, formatEther } = require('ethers');
const artifact = require('../../src/blockchain/MedicalAccessControl.json');
const { readEnvValue, setEnvValue } = require('./envFile');

const LOCAL_CHAIN_IDS = [1337n, 31337n];
const SEPOLIA_CHAIN_ID = 11155111n;

async function deploy({ rpcUrl, privateKey, allowedChainIds = LOCAL_CHAIN_IDS, log = console.log } = {}) {
  const provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1 });
  const { chainId } = await provider.getNetwork();
  if (!allowedChainIds.includes(chainId)) {
    throw new Error(`Refusing to deploy to chainId ${chainId}: only ${allowedChainIds.join(' / ')} is allowed here.`);
  }
  const signer = new Wallet(privateKey, provider);
  if (!LOCAL_CHAIN_IDS.includes(chainId)) {
    const balance = await provider.getBalance(signer.address);
    log(`Deployer ${signer.address} has ${formatEther(balance)} test ETH.`);
    if (balance === 0n) throw new Error('The deployer wallet has no Sepolia test ETH. Fund it from a free Sepolia faucet first.');
  }
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy();
  log('Deployment transaction sent, waiting for it to be mined…');
  const receipt = await contract.deploymentTransaction().wait();
  const address = await contract.getAddress();
  log(`MedicalAccessControl deployed at ${address} (chainId ${chainId}, block ${receipt.blockNumber}, tx ${receipt.hash}).`);
  return { address, txHash: receipt.hash, owner: signer.address };
}

async function deployLocal() {
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

async function deploySepolia() {
  const rpcUrl = readEnvValue('SEPOLIA_RPC_URL');
  const privateKey = readEnvValue('SEPOLIA_PRIVATE_KEY');
  if (!rpcUrl) throw new Error('Add SEPOLIA_RPC_URL (your free Alchemy Sepolia URL) to .env first.');
  if (!privateKey) throw new Error('Create the deployer wallet first: npm run chain:sepolia-wallet');
  const { address } = await deploy({ rpcUrl, privateKey, allowedChainIds: [SEPOLIA_CHAIN_ID] });
  setEnvValue('SEPOLIA_CONTRACT_ADDRESS', address);
  console.log(`SEPOLIA_CONTRACT_ADDRESS saved to .env. View it at https://sepolia.etherscan.io/address/${address}`);
}

if (require.main === module) {
  const run = process.argv.includes('--sepolia') ? deploySepolia : deployLocal;
  run().catch((e) => { console.error('Deployment failed:', e.shortMessage || e.message); process.exit(1); });
}

module.exports = { deploy, SEPOLIA_CHAIN_ID };
