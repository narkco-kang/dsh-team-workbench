# 发布到工作台市场

目标：DSH Desktop 内置工作台市场（schemaVersion 2），收录仓库为
[dataelement/awesome-dsh-workbench](https://github.com/dataelement/awesome-dsh-workbench)。

## 1. 身份

工作台身份 = GitHub 仓库 `narkco-kang/dsh-team-workbench`。`package.json` 的 `repository`
必须指回它；`register()` 不写 `id`。改 owner/repo 会让 Desktop 的 active 与旧会话绑定失效。

## 2. 安装来源（GitHub Release）

- tag 与 `package.json` 版本一致（v1.2.0 ↔ 1.2.0）。
- Release 资产包含固定文件名 `dsh-team-workbench.tgz`（便于 `releases/latest/download`）。
- 包内 `package.json`：`name` / `version` / `repository` / `dsh.bundle.patch` /
  `exports["./client"]` / `dsh.client.inject` 均齐全；包 ≤ 8 MiB。

## 3. 收录 YAML

向 awesome-dsh-workbench 提 PR，只新增 `data/workbenches/narkco-kang__dsh-team-workbench.yml`：

```yaml
url: https://github.com/narkco-kang/dsh-team-workbench
name: 智能体团队 · 技能管理工作台
nameEn: Agent Team Skill Workbench
category: operations
description:
  zh: …
en:
  en: …
screenshots:
  - https://raw.githubusercontent.com/narkco-kang/dsh-team-workbench/main/market/screenshots/team.png
  - https://raw.githubusercontent.com/narkco-kang/dsh-team-workbench/main/market/screenshots/roles.png
tarball: https://github.com/narkco-kang/dsh-team-workbench/releases/latest/download/dsh-team-workbench.tgz
```

字段约束见该仓库的 `catalog/README.md` 与 `schema/workbench.schema.json`；不要写版本、校验值、
作者 ID 或 `workbenchId`。

## 4. 投稿前自查

```bash
npm ci --ignore-scripts && npm run check   # 在 awesome-dsh-workbench 本地跑
node scripts/smoke-server.mjs              # 本包 9 工具 / 13 路由、释放清空
node scripts/smoke-v12.mjs                 # 预设 / 角色导入 / 分组 / 检索
node scripts/smoke-chat.mjs                # 私聊 / 群聊编排
node scripts/render-client.mjs             # 三个标签真实 SSR
```

截图：1280×720 PNG，来自 1.3.0 面板真实渲染（团队 / 会话 / 角色库），不含本机路径、凭据或个人信息。

## 5. 已知限制（写进 PR 描述）

- 仅在 macOS arm64 / DSH Desktop 0.13.2 实测；Windows、Linux 未验证。
- 「启动即进入」依赖 Desktop 恢复上次的 active 工作台；宿主没有公开的默认工作台接口。
- 角色库为第三方 MIT 内容，见 `NOTICE-agency-agents-zh.md`。
