# Monad Risk Sentinel

把硅谷银行事件及 Circle 的公开披露映射到 Monad 上一个可核验的 USDC Vault。用同一条测试网风险信号对照两个 ERC-4626 示例 Vault 的行为。

**From real-world events to on-chain risk signals on Monad.**

## 参赛演示

[打开演示页](https://lashimao.github.io/monad-risk-sentinel/)

同一份风险状态会让采用限制策略的 Vault 拒绝新增存款，采用观察策略的 Vault 仍可存入。限制期间，原 Vault 中的测试资产仍可提取。

[风险发布](https://testnet.monadvision.com/tx/0xe725138dd87681e7f6c74ce4a064a62848c00a0e4d84702a34762884632eadda) · [A 新增回退](https://testnet.monadvision.com/tx/0xe5cb4d0765134cbcd35c8e3a7523e904ee666f0b52f7946b26103819e841248d) · [B 存入](https://testnet.monadvision.com/tx/0xf7ebda132c20e632f08e7034f5fbdf609b775d0a4dd7a8820fdd39c924da90ff) · [A 退出](https://testnet.monadvision.com/tx/0x33176713b93b524beb06fef780fe1a59d6326721de9779f3f9a5cbb99ba3016a)

## 本地演示

运行 `npm ci --ignore-scripts` 和 `npm run build`，打开生成的 `dist/sentinel.html`。单文件页面可以离线演示。测试网交易链接需联网查看。

两种资料来自不同的时间：

- `evidence/svb-usdc.json` 保存 2023 年历史事件、来源和研究结论。Registry 中的 Keccak-256 对应这份原始文件的字节，支持完整性复核。
- `evidence/monad-exposure.json` 保存 Monad 主网 Hyperithm USDC Apex 的当前底层资产映射和 Morpho REST 索引快照。运行 `npm run snapshot` 可更新。总资产是 USDC 计价口径，包含已配置到市场的资产。
- `evidence/testnet-receipts.json` 在测试网回读通过后生成。主网参考 Vault 和两个测试网示例 Vault 分离。

## 验证

- `npm test` 用本地 Anvil 部署合约并验证授权、初始缺失、过期、过时版本、存款、铸造限制、提款和两种策略。
- `npm run deploy:testnet` 使用专用测试账户，调用 Devnads 水龙头，并在 Monad Testnet 记录部署和演示回执。该脚本会优先回读已记录交易。账户和签名事务放在 Git 忽略的 `.testnet/` 目录。
- 再运行 `npm run build` 将可核验的回执嵌入离线页面。发布用的静态副本在 `docs/index.html`。

## MVP 边界

信号由授权 Reporter 发布，合约要求有效期、证据哈希和正确版本。Vault A 对缺失、过期或限制状态暂停新增；Vault B 读取同一 Registry 并采用观察策略。提款遵守 ERC-4626 的正常份额约束。

AI 在本次工作中完成历史证据整理和风险解释，演示用固定材料回放。页面按钮只播放记录。项目尚未接入真实 Morpho/Euler Vault，也没有实时新闻监控或自动判定储备关系。哈希验证对应证据文本的完整性。
