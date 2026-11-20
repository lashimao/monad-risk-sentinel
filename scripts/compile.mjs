import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import solc from 'solc';

export function compile(sourceName = 'src/Sentinel.sol') {
  const sources = {};
  function addSource(name) {
    if (sources[name]) return;
    const location = name.startsWith('@') ? `node_modules/${name}` : name;
    const content = readFileSync(new URL(`../${location}`, import.meta.url), 'utf8');
    sources[name] = { content };
    for (const match of content.matchAll(/\bimport\s+(?:[^;]*?\bfrom\s+)?["']([^"']+)["']\s*;/g)) {
      const imported = match[1];
      addSource(imported.startsWith('.') ? posix.normalize(posix.join(posix.dirname(name), imported)) : imported);
    }
  }
  addSource(sourceName);

  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter(({severity}) => severity === 'error');
  if (errors.length) throw new Error(errors.map(({formattedMessage}) => formattedMessage).join('\n'));
  const contracts = output.contracts[sourceName];
  const artifacts = {};
  for (const [name, contract] of Object.entries(contracts)) {
    artifacts[name] = { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
  }
  return { input, artifacts };
}
