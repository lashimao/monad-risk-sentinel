import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const unit = 1_000_000n;
const units = (amount) => BigInt(amount) * unit;

export async function runLendingReplay({ admin, client, artifacts, deploy, write, baselineHash, evidenceHash }) {
  let prior;
  try {
    prior = JSON.parse(await readFile(new URL('../evidence/testnet-receipts.json', import.meta.url), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const registry = await deploy('lendingRegistry', 'RiskRegistry', [admin]);
  // Reuse the previously funded fixture only when it belongs to the local test signer.
  const canReuse = prior?.chainId === 10143 && prior.reporter.toLowerCase() === admin.toLowerCase();
  const collateral = canReuse ? prior.contracts.token : await deploy('collateralToken', 'ReplayUSD', [admin]);
  const credit = await deploy('creditToken', 'ReplayCredit', [admin]);
  const pool = await deploy('lendingPool', 'ReferenceLendingPool', [collateral.address, credit.address, registry.address]);
  const send = (key, tx, name, method, args, options) =>
    write(key, tx.address, artifacts[name].abi, method, args, options);
  const sendRegistry = (key, args) => send(key, registry, 'RiskRegistry', 'publish', args);
  const sendPool = (key, method, args, options) => send(key, pool, 'ReferenceLendingPool', method, args, options);
  const read = (contract, name, functionName, args, block) =>
    client.readContract({ address: contract.address, abi: artifacts[name].abi, functionName, args, blockNumber: BigInt(block) });
  async function positionAt(block) {
    const [policy, position] = await Promise.all([
      read(pool, 'ReferenceLendingPool', 'policy', [], block),
      read(pool, 'ReferenceLendingPool', 'positions', [admin], block),
    ]);
    return { ltvBps: policy[0], borrowingAllowed: policy[1], collateralRaw: position[0].toString(), debtRaw: position[1].toString() };
  }

  const expiry = (await client.getBlock()).timestamp + 6n * 24n * 60n * 60n;
  const baseline = await sendRegistry('lendingBaseline', [collateral.address, 1, baselineHash, expiry, 0n]);
  await send('fundPool', credit, 'ReplayCredit', 'transfer', [pool.address, units(200)]);
  await send('approveCollateral', collateral, 'ReplayUSD', 'approve', [pool.address, units(100)]);
  const collateralDeposit = await sendPool('depositCollateral', 'depositCollateral', [units(100)]);
  const borrow = await sendPool('baselineBorrow', 'borrow', [units(50)]);
  const alert = await sendRegistry('lendingAlert', [collateral.address, 2, evidenceHash, expiry, 1n]);
  const blockedBorrow = await sendPool('blockedBorrow', 'borrow', [units(1)], { revert: true });
  const blockedExit = await sendPool('blockedExit', 'withdrawCollateral', [units(1)], { revert: true });
  await send('approveRepayment', credit, 'ReplayCredit', 'approve', [pool.address, units(20)]);
  const repay = await sendPool('repay', 'repay', [units(20)]);
  const exit = await sendPool('safeExit', 'withdrawCollateral', [units(20)]);

  const [before, during, after, signal] = await Promise.all([
    positionAt(borrow.block), positionAt(alert.block), positionAt(exit.block),
    read(registry, 'RiskRegistry', 'signals', [collateral.address], alert.block),
  ]);
  assert.deepEqual(before, { ltvBps: 7500, borrowingAllowed: true, collateralRaw: '100000000', debtRaw: '50000000' });
  assert.deepEqual(during, { ...before, ltvBps: 4500, borrowingAllowed: false });
  assert.deepEqual(after, { ...during, collateralRaw: '80000000', debtRaw: '30000000' });
  assert.equal(signal[0], evidenceHash);
  assert.equal(signal[3], 2n);
  assert.equal(signal[4], 2);

  const output = {
    network: 'Monad Testnet', chainId: 10143, reporter: admin,
    contracts: { registry, collateral, credit, pool },
    transactions: { baseline, collateralDeposit, borrow, alert, blockedBorrow, blockedExit, repay, exit },
    evidenceHash, before, during, after,
  };
  const destination = new URL('../evidence/lending-testnet-receipts.json', import.meta.url);
  await writeFile(destination, JSON.stringify(output, null, 2) + '\n');
  console.log('Confirmed on Monad Testnet: LTV 75% → 45%; borrowing and unsafe exit reverted; repayment and safe exit succeeded.');
}
