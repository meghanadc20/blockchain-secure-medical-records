'use strict';
/**
 * Creates a NEW, dedicated Sepolia TEST wallet for the platform backend (contract owner) and
 * saves its private key as SEPOLIA_PRIVATE_KEY in the project-root .env. Only the public
 * address is printed — fund that address with free Sepolia test ETH from a faucet.
 * Running it again keeps the existing wallet. Never send real ETH to this address.
 *   npm run chain:sepolia-wallet
 */
const { Wallet, JsonRpcProvider, formatEther } = require('ethers');
const { readEnvValue, setEnvValue } = require('./envFile');

(async () => {
  let key = readEnvValue('SEPOLIA_PRIVATE_KEY');
  if (!key) {
    key = Wallet.createRandom().privateKey;
    setEnvValue('SEPOLIA_PRIVATE_KEY', key);
    console.log('Created a new Sepolia test wallet and saved its key as SEPOLIA_PRIVATE_KEY in .env (not printed).');
  } else console.log('Using the existing SEPOLIA_PRIVATE_KEY from .env.');
  const address = new Wallet(key).address;
  console.log(`Deployer / platform address: ${address}`);
  const rpcUrl = readEnvValue('SEPOLIA_RPC_URL');
  if (rpcUrl) {
    try {
      const provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1 });
      const { chainId } = await provider.getNetwork();
      if (chainId !== 11155111n) console.log(`Warning: SEPOLIA_RPC_URL points to chainId ${chainId}, not Sepolia (11155111).`);
      else console.log(`Sepolia balance: ${formatEther(await provider.getBalance(address))} test ETH`);
    } catch (e) { console.log('Could not reach SEPOLIA_RPC_URL:', e.shortMessage || e.message); }
  } else console.log('Add SEPOLIA_RPC_URL to .env to check the balance.');
})();
