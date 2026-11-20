import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createPublicClient, custom, encodeDeployData, encodeFunctionData, keccak256, parseGwei, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from 'viem/chains';
import { compile } from './compile.mjs';
import { runLendingReplay } from './lending-replay.mjs';

const lending = process.argv.includes('--lending');

const rpcUrl = process.env.MONAD_TESTNET_RPC || 'https://testnet-rpc.monad.xyz';
const run = promisify(execFile);
const local = new URL('../.testnet/', import.meta.url);
const keyFile = new URL('replay-key', local);
const stateFile = new URL(lending ? 'transactions-lending.json' : 'transactions.json', local);
const finalFile = new URL('../evidence/testnet-receipts.json', import.meta.url);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(url, payload) {
  const { stdout } = await run('curl', [
    '-sS', '--connect-timeout', '6', '--max-time', '15', '-H', 'Content-Type: application/json',
    '--data-binary', JSON.stringify(payload), url,
  ]);
  return JSON.parse(stdout);
}

const readOnly = new Set([
  'eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBalance', 'eth_getCode', 'eth_getTransactionCount',
  'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_gasPrice', 'eth_call', 'eth_estimateGas',
  'eth_maxPriorityFeePerGas', 'eth_feeHistory',
]);
const transport = custom({
  async request({ method, params = [] }) {
    let failure;
    const attempts = readOnly.has(method) ? 3 : 1;
    for (let i = 0; i < attempts; i++) {
      let reply;
      try {
        reply = await post(rpcUrl, { jsonrpc: '2.0', id: 1, method, params });
      } catch (error) {
        failure = error;
        await pause(350);
        continue;
      }
      if (reply.error) throw new Error(reply.error.message);
      return reply.result;
    }
    throw new Error(`${method} transport failed`, { cause: failure });
  },
}, { retryCount: 0 });
const client = createPublicClient({ chain: monadTestnet, transport, pollingInterval: 600 });
assert.equal(await client.getChainId(), 10143, 'This script only supports Monad testnet');

await mkdir(local, { recursive: true, mode: 0o700 });
let privateKey;
try {
  privateKey = (await readFile(keyFile, 'utf8')).trim();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  privateKey = generatePrivateKey();
  await writeFile(keyFile, privateKey + '\n', { flag: 'wx', mode: 0o600 });
}
const account = privateKeyToAccount(privateKey);
let operations;
try {
  operations = JSON.parse(await readFile(stateFile, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  operations = {};
}
async function saveState() {
  const tmp = new URL(stateFile.href + '.tmp');
  await writeFile(tmp, JSON.stringify(operations, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, stateFile);
}

const { artifacts } = compile();
const evidenceFile = new URL('../evidence/svb-usdc.json', import.meta.url);
const baselineFile = new URL('../evidence/baseline.json', import.meta.url);
const evidenceHash = keccak256(toHex(await readFile(evidenceFile)));
const baselineHash = keccak256(toHex(await readFile(baselineFile)));
let balance = await client.getBalance({ address: account.address });
if (balance === 0n && !operations.faucetRequested) {
  operations.faucetRequested = true;
  await saveState();
  const faucet = await post('https://agents.devnads.com/v1/faucet', { chainId: 10143, address: account.address });
  if (faucet.success === false || faucet.error) {
    throw new Error('Devnads testnet faucet: ' + JSON.stringify(faucet).slice(0, 220));
  }
}
for (let i = 0; balance === 0n && i < 15; i++) {
  await pause(900);
  balance = await client.getBalance({ address: account.address });
}
if (!balance) throw new Error('No confirmed test MON for the dedicated account');
console.log('Testnet balance confirmed');

const budget = (estimate) => estimate + (estimate / 12n);
async function transact(name, prepare, expected = 'success') {
  if (!operations[name]) {
    const request = await prepare();
    const [nonce, gasPrice] = await Promise.all([
      client.getTransactionCount({ address: account.address, blockTag: 'pending' }),
      client.getGasPrice(),
    ]);
    const raw = await account.signTransaction({
      ...request, chainId: 10143, type: 'legacy', nonce, gasPrice: gasPrice + parseGwei('2'),
    });
    operations[name] = { hash: keccak256(raw), raw };
    await saveState();
  }
  const { hash, raw } = operations[name];
  assert.ok(hash && raw, `Submission result unknown for ${name}`);
  let existing;
  try {
    existing = await client.getTransaction({ hash });
  } catch (error) {
    if (error.name !== 'TransactionNotFoundError') throw error;
  }
  if (!existing) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const accepted = await client.sendRawTransaction({ serializedTransaction: raw });
        assert.equal(accepted, hash, name);
        break;
      } catch (error) {
        const reason = String(error.details || error.shortMessage || error.name).slice(0, 200);
        console.error(name, 'broadcast:', reason);
        // The saved signed transaction always has the same hash and nonce.
        if (!reason.includes('transport failed') || attempt === 2) break;
        await pause(700 * (attempt + 1));
      }
    }
  }
  console.log(name, hash);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 30000 });
  assert.equal(receipt.status, expected, name);
  return {
    hash, status: receipt.status, block: receipt.blockNumber.toString(),
    ...(receipt.contractAddress ? { address: receipt.contractAddress } : {}),
  };
}
async function deploy(step, name, args) {
  const artifact = artifacts[name];
  return transact(step, async () => {
    const data = encodeDeployData({ ...artifact, args });
    const gas = budget(await client.estimateGas({ account, data }));
    return { data, gas };
  });
}
async function write(step, address, abi, functionName, args, { revert = false } = {}) {
  return transact(step, async () => {
    const request = { address, abi, functionName, args, account };
    const gas = revert ? 100000n : budget(await client.estimateContractGas(request));
    return { to: address, data: encodeFunctionData(request), gas };
  }, revert ? 'reverted' : 'success');
}

const admin = account.address;
if (lending) {
  Object.assign(artifacts, compile('src/LendingDemo.sol').artifacts);
  await runLendingReplay({ admin, client, artifacts, deploy, write, baselineHash, evidenceHash });
} else {
  await runVaultReplay();
}

async function runVaultReplay() {
  const registry = await deploy('registry', 'RiskRegistry', [admin]);
  const token = await deploy('testToken', 'ReplayUSD', [admin]);
  const protectedVault = await deploy('protectedVault', 'ProtectedDemoVault', [token.address, registry.address, true]);
  const observerVault = await deploy('observerVault', 'ProtectedDemoVault', [token.address, registry.address, false]);
  const registryAbi = artifacts.RiskRegistry.abi;
  const tokenAbi = artifacts.ReplayUSD.abi;
  const vaultAbi = artifacts.ProtectedDemoVault.abi;
  const now = (await client.getBlock()).timestamp;
  const expiry = now + 6n * 24n * 60n * 60n;
  const baseline = await write('baseline', registry.address, registryAbi, 'publish',
    [token.address, 1, baselineHash, expiry, 0n]);
  await write('approveProtected', token.address, tokenAbi, 'approve', [protectedVault.address, 15_000_000n]);
  const before = await write('beforeDeposit', protectedVault.address, vaultAbi, 'deposit', [10_000_000n, admin]);
  const alert = await write('alert', registry.address, registryAbi, 'publish',
    [token.address, 2, evidenceHash, expiry, 1n]);
  const blocked = await write('blockedDeposit', protectedVault.address, vaultAbi, 'deposit',
    [1_000_000n, admin], { revert: true });
  await write('approveObserver', token.address, tokenAbi, 'approve', [observerVault.address, 2_000_000n]);
  const observe = await write('observerDeposit', observerVault.address, vaultAbi, 'deposit', [2_000_000n, admin]);
  const exit = await write('exitWithdraw', protectedVault.address, vaultAbi, 'withdraw', [3_000_000n, admin, admin]);
  const fetch = (address, abi, functionName, args = []) =>
    client.readContract({ address, abi, functionName, args });
  const [signal, protectedAssets, observerAssets, gate, observerGate, registryCode, vaultCode] = await Promise.all([
    fetch(registry.address, registryAbi, 'signals', [token.address]),
    fetch(protectedVault.address, vaultAbi, 'totalAssets'),
    fetch(observerVault.address, vaultAbi, 'totalAssets'),
    fetch(protectedVault.address, vaultAbi, 'depositsAllowed'),
    fetch(observerVault.address, vaultAbi, 'depositsAllowed'),
    client.getCode({address: registry.address}),
    client.getCode({address: protectedVault.address}),
  ]);
  assert.ok(registryCode && vaultCode);
  assert.equal(signal[0], evidenceHash);
  assert.equal(signal[3], 2n);
  assert.equal(signal[4], 2);
  assert.equal(protectedAssets, 7_000_000n);
  assert.equal(observerAssets, 2_000_000n);
  assert.equal(gate, false);
  assert.equal(observerGate, true);
  const output = {
    network: 'Monad Testnet', chainId: 10143, reporter: admin,
    contracts: { registry, token, protectedVault, observerVault },
    transactions: { baseline, before, alert, blocked, observe, exit },
    evidenceHash, verified: {
      revision: Number(signal[3]), status: Number(signal[4]),
      blockTime: Number(signal[1]), validUntil: Number(signal[2]),
      protectedAssets: protectedAssets.toString(), observerAssets: observerAssets.toString(),
      protectedDepositsAllowed: gate, observerDepositsAllowed: observerGate,
    },
  };
  await writeFile(finalFile, JSON.stringify(output, null, 2) + '\n');
  console.log('Confirmed: valid evidence hash; A deposit reverted; B deposit and A withdrawal succeeded.');
}
