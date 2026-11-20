import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { keccak256, toHex } from 'viem';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [template, evidence, rawExposure] = await Promise.all([
  read('public/index.html'), read('evidence/svb-usdc.json'), read('evidence/monad-exposure.json'),
]);
let receipts = null;
try {
  receipts = JSON.parse(await read('evidence/testnet-receipts.json'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const evidenceHash = keccak256(toHex(evidence));
if (receipts) {
  assert.equal(receipts.chainId, 10143);
  assert.equal(receipts.evidenceHash, evidenceHash);
  assert.equal(receipts.transactions.blocked.status, 'reverted');
  assert.equal(receipts.transactions.exit.status, 'success');
  assert.equal(receipts.transactions.observe.status, 'success');
}
const payload = JSON.stringify({
  evidence, evidenceHash, exposure: JSON.parse(rawExposure), receipts,
}).replaceAll('<', '\\u003c');
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/sentinel.html', root), template.replace('__DEMO_DATA__', () => payload));
console.log(receipts ? 'Built offline demo with verified testnet receipts' : 'Built offline local demo');
