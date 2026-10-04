'use strict';
/**
 * Compiles blockchain/contracts/MedicalAccessControl.sol with solc-js and writes
 * backend/src/blockchain/MedicalAccessControl.json ({ contractName, abi, bytecode, compiler }).
 *   npm run chain:compile
 * evmVersion "paris" keeps the bytecode compatible with Ganache 7.
 */
const fs = require('fs');
const path = require('path');
const solc = require('solc');

const SOURCE = path.resolve(__dirname, '../../../blockchain/contracts/MedicalAccessControl.sol');
const OUT = path.resolve(__dirname, '../../src/blockchain/MedicalAccessControl.json');

function compile() {
  const input = {
    language: 'Solidity',
    sources: { 'MedicalAccessControl.sol': { content: fs.readFileSync(SOURCE, 'utf8') } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'paris',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((e) => e.severity === 'error');
  (output.errors || []).filter((e) => e.severity !== 'error').forEach((w) => console.warn(w.formattedMessage));
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join('\n'));

  const c = output.contracts['MedicalAccessControl.sol'].MedicalAccessControl;
  const artifact = {
    contractName: 'MedicalAccessControl',
    compiler: `solc ${solc.version()}`,
    evmVersion: 'paris',
    abi: c.abi,
    bytecode: `0x${c.evm.bytecode.object}`,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

if (require.main === module) {
  const a = compile();
  console.log(`Compiled MedicalAccessControl with ${a.compiler} → src/blockchain/MedicalAccessControl.json (${a.abi.length} ABI entries)`);
}

module.exports = { compile };
