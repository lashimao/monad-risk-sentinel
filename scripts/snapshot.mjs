import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { formatUnits } from 'viem';

const curl = promisify(execFile);
const vaultAddress = '0x78999cc96d2Ba0341588C60CcB0E91c6C33CF371';
const assetAddress = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
const base = 'https://api.morpho.org';
const identityUrl = `${base}/v0/vaults-v2/143:${vaultAddress}`;
const stateUrl = `${base}/v1/vaults-v2/143:${vaultAddress}/state`;
async function read(url) {
  const { stdout } = await curl('curl', ['-fsS', '--max-time', '12', url]);
  return JSON.parse(stdout).data;
}

const [vault, state] = await Promise.all([read(identityUrl), read(stateUrl)]);
assert.equal(vault.chain_id, 143);
assert.equal(state.chain_id, 143);
assert.equal(vault.address.toLowerCase(), vaultAddress.toLowerCase());
assert.equal(state.address.toLowerCase(), vaultAddress.toLowerCase());
assert.equal(vault.asset.address.toLowerCase(), assetAddress.toLowerCase());
assert.equal(vault.asset.decimals, 6);

const totalAssets = BigInt(state.total_assets);
const assetsInUSDC = formatUnits(totalAssets, vault.asset.decimals);
const amountInTenThousands = Math.round(Number(assetsInUSDC) / 10_000);
const evidence = {
  chainId: 143, network: 'Monad Mainnet',
  vaultName: vault.name, vaultVersion: 'Morpho Vault V2',
  vaultAddress, curator: vault.curator, assetSymbol: vault.asset.symbol, assetAddress,
  decimals: vault.asset.decimals, totalAssetsRaw: state.total_assets,
  lastIndexedBlock: state.last_indexed_block, allocatedAssetsRaw: state.allocated_assets,
  idleAssetsRaw: state.idle_assets, amountLabel: `约 ${amountInTenThousands.toLocaleString('zh-CN')} 万 USDC`,
  sourceLabel: 'Morpho API 总资产快照',
  measurement: 'Vault 总资产按底层 USDC 计价，包含市场配置。它不是闲置余额、SVB 敞口金额或预计损失。',
  snapshotStatus: '区块号由 Morpho 索引返回，未通过独立主网 RPC 回读。',
  sources: [
    'https://developers.circle.com/stablecoins/usdc-contract-addresses',
    identityUrl, stateUrl,
    `https://app.morpho.org/monad/vault/${vaultAddress}/hyperithm-usdc-apex`,
  ],
};
await writeFile(new URL('../evidence/monad-exposure.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
console.log(vault.name, assetsInUSDC, 'USDC · indexed block', state.last_indexed_block);
