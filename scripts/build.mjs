import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/sentinel.html', root), template.replace('__DEMO_DATA__', () => payload));
console.log(receipts ? 'Built offline demo with verified testnet receipts' : 'Built offline local demo');
