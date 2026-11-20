import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { keccak256, toHex } from 'viem';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [template, evidence, rawExposure] = await Promise.all([
  read('public/index.html'), read('evidence/svb-usdc.json'), read('evidence/monad-exposure.json'),
]);
async function readReceipts(file) {
  try {
    return JSON.parse(await read(file));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}
const [receipts, lendingReceipts] = await Promise.all([
  readReceipts('evidence/testnet-receipts.json'),
  readReceipts('evidence/lending-testnet-receipts.json'),
]);
const evidenceHash = keccak256(toHex(evidence));
if (receipts) {
  assert.equal(receipts.chainId, 10143);
  assert.equal(receipts.evidenceHash, evidenceHash);
  assert.equal(receipts.transactions.blocked.status, 'reverted');
  assert.equal(receipts.transactions.exit.status, 'success');
  assert.equal(receipts.transactions.observe.status, 'success');
}
if (lendingReceipts) {
  assert.equal(lendingReceipts.chainId, 10143);
  assert.equal(lendingReceipts.evidenceHash, evidenceHash);
  assert.equal(lendingReceipts.before.ltvBps, 7500);
  assert.equal(lendingReceipts.during.ltvBps, 4500);
  assert.equal(lendingReceipts.during.borrowingAllowed, false);
  assert.equal(lendingReceipts.transactions.blockedBorrow.status, 'reverted');
  assert.equal(lendingReceipts.transactions.blockedExit.status, 'reverted');
  assert.equal(lendingReceipts.transactions.repay.status, 'success');
  assert.equal(lendingReceipts.transactions.exit.status, 'success');
}
const payload = JSON.stringify({
  evidence, evidenceHash, exposure: JSON.parse(rawExposure), receipts, lendingReceipts,
}).replaceAll('<', '\\u003c');
const dist = new URL('dist/', root);
const team = new URL('team/', dist);
await mkdir(dist, { recursive: true });
await writeFile(new URL('sentinel.html', dist), template.replace('__DEMO_DATA__', () => payload));
await cp(new URL('team-frontend/frontend/', root), team, { recursive: true });
const teamData = new URL('testnet/', team);
await mkdir(teamData, { recursive: true });
await Promise.all([
  copyFile(new URL('evidence/svb-usdc.json', root), new URL('svb-usdc.json', teamData)),
  copyFile(new URL('evidence/monad-exposure.json', root), new URL('monad-exposure.json', teamData)),
]);
if (lendingReceipts) {
  await copyFile(new URL('evidence/lending-testnet-receipts.json', root), new URL('lending-receipts.json', teamData));
} else {
  // Overwrite any previous build's fixture while keeping the simulator usable.
  await writeFile(new URL('lending-receipts.json', teamData), 'null\n');
}

if (process.argv.includes('--pages')) {
  assert.ok(receipts && lendingReceipts, 'Public demo requires verified Vault and lending receipts');
  const docs = new URL('docs/', root);
  await mkdir(docs, { recursive: true });
  await copyFile(new URL('sentinel.html', dist), new URL('index.html', docs));
  await cp(team, new URL('team/', docs), { recursive: true });
}
console.log('Built original replay and integrated team frontend');
