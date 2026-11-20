import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createPublicClient, createWalletClient, defineChain, http, keccak256, toHex } from 'viem';
import { compile } from './compile.mjs';

const binary = new URL('../node_modules/@foundry-rs/anvil/bin.mjs', import.meta.url);
const port = 18643;
const node = spawn(process.execPath, [binary.pathname, '--port', String(port), '--silent'], { stdio: 'inherit' });
const chain = defineChain({
  id: 31337, name: 'Anvil', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [`http://127.0.0.1:${port}`] } },
});
const transport = http(undefined, { retryCount: 0, timeout: 1500 });
const client = createPublicClient({ chain, transport, pollingInterval: 150 });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  let accounts;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (node.exitCode !== null) throw new Error('Anvil exited before startup');
    try {
      accounts = await client.request({ method: 'eth_accounts', params: [] });
      break;
    } catch {
      await pause(100);
    }
  }
  assert.ok(accounts?.length >= 2, 'Anvil must provide two separate test accounts');
  const [admin, stranger] = accounts;
  const owner = createWalletClient({ account: admin, transport, chain });
  const { artifacts } = compile();
  async function receipt(hash) {
    const result = await client.waitForTransactionReceipt({ hash, timeout: 8000 });
    assert.equal(result.status, 'success');
    return result;
  }
  async function deploy(name, args) {
    const artifact = artifacts[name];
    const hash = await owner.deployContract({ ...artifact, args });
    return { address: (await receipt(hash)).contractAddress, abi: artifact.abi };
  }
  const registry = await deploy('RiskRegistry', [admin]);
  const token = await deploy('ReplayUSD', [admin]);
  const vault = await deploy('ProtectedDemoVault', [token.address, registry.address, true]);
  const observer = await deploy('ProtectedDemoVault', [token.address, registry.address, false]);
  const amount = 10_000_000n;
  const read = (contract, functionName, args = []) => client.readContract({ ...contract, functionName, args });
  const send = async (contract, functionName, args) => receipt(await owner.writeContract({ ...contract, functionName, args }));
  const simulate = (contract, functionName, args, account = admin) =>
    client.simulateContract({ ...contract, functionName, args, account });

  assert.equal(await read(vault, 'depositsAllowed'), false);
  assert.equal(await read(vault, 'maxDeposit', [admin]), 0n);
  await assert.rejects(simulate(vault, 'deposit', [amount, admin]), /reverted/);
  console.log('PASS missing signal blocks deposits');

  const hash = keccak256(toHex('checked evidence fixture'));
  const now = (await client.getBlock()).timestamp;
  const publish = (status, revision, expiry = now + 3600n) => [token.address, status, hash, expiry, revision];
  await assert.rejects(simulate(registry, 'publish', publish(1, 0n), stranger), /UnauthorizedReporter/);
  await assert.rejects(simulate(registry, 'publish', publish(1, 0n, now)), /InvalidSignal/);
  console.log('PASS unknown reporter and expired payload rejected');

  await send(registry, 'publish', publish(1, 0n));
  assert.equal(await read(vault, 'depositsAllowed'), true);
  await send(token, 'approve', [vault.address, amount * 2n]);
  await send(vault, 'deposit', [amount, admin]);
  assert.equal(await read(vault, 'totalAssets'), amount);
  console.log('PASS open signal enables real ERC-20 transfer into vault');

  await assert.rejects(simulate(registry, 'publish', publish(2, 0n)), /StaleRevision/);
  await send(registry, 'publish', publish(2, 1n));
  const [, , , revision] = await read(registry, 'signals', [token.address]);
  assert.equal(revision, 2n);
  assert.equal(await read(vault, 'maxMint', [admin]), 0n);
  assert.equal(await read(observer, 'depositsAllowed'), true);
  await send(token, 'approve', [observer.address, amount]);
  await send(observer, 'deposit', [amount, admin]);
  assert.equal(await read(observer, 'totalAssets'), amount);
  await assert.rejects(simulate(vault, 'deposit', [amount, admin]), /reverted/);
  await assert.rejects(simulate(vault, 'mint', [amount, admin]), /reverted/);
  await send(vault, 'withdraw', [1_000_000n, admin, admin]);
  assert.equal(await read(vault, 'totalAssets'), 9_000_000n);
  console.log('PASS restrict blocks deposit and mint, but withdrawal and an independent observer vault deposit succeed; stale revision rejected');

  await send(registry, 'publish', publish(1, 2n));
  await client.request({ method: 'evm_setNextBlockTimestamp', params: [toHex(now + 3600n)] });
  await client.request({ method: 'evm_mine', params: [] });
  assert.equal(await read(registry, 'currentStatus', [token.address]), 0);
  assert.equal(await read(vault, 'maxDeposit', [admin]), 0n);
  await send(vault, 'withdraw', [1_000_000n, admin, admin]);
  assert.equal(await read(vault, 'totalAssets'), 8_000_000n);
  console.log('PASS expiry changes active signal to unknown, preserving withdrawals');
} finally {
  node.kill();
}
