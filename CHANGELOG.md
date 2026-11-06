# CHANGELOG

## 1.1.0 — 2026-11-06

### 面向「智能体团队」的可见升级
- **17 名成员每人一个专属表情**：原先 17 人只有 7 种表情（7 人共用 🤖），现为 17/17 唯一
  （🔍研究员 📊分析师 🛠️工程师 ⚖️审核员 🕵️调查员 🧪采集员 🚀项目执行员 ✍️复核员 📐审核员2
  🔎调查员2 📈分析师2 🧲采集员2 🔖复核员2 🔬研究员2 ⚙️工程师2 🎯决策辅助员 🧭决策员2）。
- **每人一个专属配色**：借鉴 DS-Bot 的 Bot 配色思路，17 个成员颜色两两不同，写为十六进制，
  工作台成员卡片按该色渲染头像底与姓名色。
- **成员身份字段就位**：`emoji` + `color` 已是 team.json 的一等字段，可与 `agent_team_roster`
  一起透出给模型与 UI。

### 兼容性
- 服务端在 DSH **0.2.2-alpha.2** 实测：8 个工具 / 9 条路由注册正常，释放后清空（无累积），
  重复挂载不重名 —— `node scripts/smoke-server.mjs` 全绿。

### 发布形态
- 版本升到 1.1.0，补齐 `repository` / `homepage` / `keywords` / `LICENSE`（MIT）。
- 新增市场打包资产：`market/workbench-entry.json`（按市场 catalog schemaVersion 2 校验规则填写）、
  `market/screenshots/team.png`（1227×523 真机渲染图）、`market/PUBLISH.md`（发布清单与步骤）。
- 通过 Desktop 插件管理器安装：`application: applied`，写入 profile `bundles` —— **每次启动自动加载**。

### 借鉴自 DS-Bot（Fei2411/DS-Bot）的做法
- 每人独立配色 + 表情的「身份」体系（对应其 `COLORS` 调色板与头像机制）。
- 常量集中、host/client 分层（对应其 `constants.js` 与 `src/host` / `src/client` 两半体）。
- 自检优先：用冒烟脚本证明挂载/释放/重挂载无泄漏（对应其 `diagnostics.js` 的自诊断思路）。
