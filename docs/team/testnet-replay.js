'use strict';

(() => {
  const byId = id => document.getElementById(id);
  const explorer = 'https://testnet.monadvision.com';
  const hashPattern = /^0x[0-9a-f]{64}$/i;
  const addressPattern = /^0x[0-9a-f]{40}$/i;
  const actions = [
    ['collateralDeposit', '存入 100 tUSD 抵押品', 0, 'success'],
    ['borrow', '借出 50 tCREDIT', 0, 'success'],
    ['alert', 'Registry 发布限制状态', 1, 'success'],
    ['blockedBorrow', '新增借款回退', 2, 'reverted'],
    ['blockedExit', '超限提取回退', 2, 'reverted'],
    ['repay', '还款 20 tCREDIT', 3, 'success'],
    ['exit', '提取 20 tUSD 抵押品', 3, 'success'],
  ];
  const stages = [
    ['回放风险限制', '基线交易已借出 50 tCREDIT。借贷池允许在额度内新增借款。', 'before'],
    ['核对借款与提取拦截', '测试网 Registry 写入 Restrict（编码 2），借贷池将 LTV 上限从 75% 降至 45%。', 'during'],
    ['查看还款与提取', '新增借款被拒。持仓仍超出调整后的 LTV，提取抵押品也被拒。', 'during'],
    ['重新回放', '借款人还款后提取了满足抵押要求的部分。以下链接可逐笔核对。', 'after'],
  ];

  function validate(manifest) {
    if (!manifest || manifest.chainId !== 10143 || !hashPattern.test(manifest.evidenceHash)) {
      throw Error('缺少经核验的 Monad 测试网回执');
    }
    for (const kind of ['registry', 'pool']) {
      if (!addressPattern.test(manifest.contracts?.[kind]?.address)) throw Error('缺少有效的示例合约地址');
    }
    for (const [key, , , expected] of actions) {
      const record = manifest.transactions?.[key];
      if (record?.status !== expected || !hashPattern.test(record?.hash) || !/^\d+$/.test(record?.block)) {
        throw Error('测试网回执不完整');
      }
    }
    for (const [key, ltv, allowed] of [['before', 7500, true], ['during', 4500, false], ['after', 4500, false]]) {
      const snapshot = manifest[key];
      if (
        snapshot?.ltvBps !== ltv || snapshot.borrowingAllowed !== allowed
        || !/^\d+$/.test(snapshot.collateralRaw) || !/^\d+$/.test(snapshot.debtRaw)
      ) throw Error('借贷状态快照不符');
    }
  }

  const formatAmount = raw => {
    const units = BigInt(raw);
    const fraction = String(units % 1_000_000n).padStart(6, '0').replace(/0+$/, '');
    return String(units / 1_000_000n) + (fraction ? '.' + fraction : '');
  };

  async function readFixture(path) {
    const result = await fetch(path);
    if (!result.ok) throw Error('测试网回放数据加载失败');
    return result.json();
  }

  async function init() {
    const [manifest, evidence, exposure] = await Promise.all([
      readFixture('testnet/lending-receipts.json'),
      readFixture('testnet/svb-usdc.json'),
      readFixture('testnet/monad-exposure.json'),
    ]);
    validate(manifest);
    const officialSource = evidence.sources.find(source => source.id === 'circle');
    const morphoSource = exposure.sources.find(url => {
      const source = new URL(url);
      return source.protocol === 'https:' && source.origin === 'https://app.morpho.org';
    });
    if (new URL(officialSource.url).origin !== 'https://www.circle.com' || !morphoSource) throw Error('缺少公开证据入口');
    byId('chain-case-source').href = officialSource.url;
    byId('chain-exposure-source').href = morphoSource;
    byId('chain-exposure').textContent = exposure.vaultName + ' · 底层资产 ' + exposure.assetSymbol
      + ' · Morpho 索引区块 ' + exposure.lastIndexedBlock + '。该快照与历史事件时间不同。';
    for (const kind of ['registry', 'pool']) {
      const link = byId('chain-' + kind);
      const address = manifest.contracts[kind].address;
      link.href = explorer + '/address/' + address;
      link.textContent = address;
    }
    byId('chain-evidence-hash').textContent = manifest.evidenceHash;

    let step = 0;
    const list = byId('chain-transactions');
    function render() {
      const [action, description, snapshot] = stages[step];
      const state = manifest[snapshot];
      byId('chain-ltv').textContent = state.ltvBps / 100 + '%';
      byId('chain-policy').textContent = state.borrowingAllowed ? '开放 · 可借款' : '限制 · 停止新增借款';
      byId('chain-collateral').textContent = formatAmount(state.collateralRaw) + ' tUSD';
      byId('chain-debt').textContent = formatAmount(state.debtRaw) + ' tCREDIT';
      byId('chain-stage').textContent = description;
      byId('chain-advance').textContent = action;
      byId('chain-reset').hidden = step === 0 || step === stages.length - 1;
      list.replaceChildren();

      for (const [key, title, at, expected] of actions) {
        if (at > step) continue;
        const record = manifest.transactions[key];
        const row = document.createElement('li');
        const status = document.createElement('span');
        status.className = expected === 'reverted' ? 'chain-reverted' : 'chain-success';
        status.textContent = expected === 'reverted' ? '回退' : '成功';
        const link = document.createElement('a');
        link.href = explorer + '/tx/' + record.hash;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = title;
        row.append(status, link);
        list.append(row);
      }
    }
    byId('chain-advance').addEventListener('click', () => {
      step = (step + 1) % stages.length;
      render();
    });
    byId('chain-reset').addEventListener('click', () => {
      step = 0;
      render();
      byId('chain-advance').focus();
    });
    render();
    byId('chain-badge').textContent = '已记录测试网回执';
    byId('chain-loading').hidden = true;
    byId('chain-ready').hidden = false;
  }

  init().catch(error => {
    byId('chain-badge').textContent = '回执未加载';
    byId('chain-loading').textContent = error.message + '。请通过本仓库的 HTTP 服务打开页面。';
  });
})();
