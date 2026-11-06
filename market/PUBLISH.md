# 发布到 DSH 插件市场（工作台）

目标市场：`https://market.dshdesktop.com/index.json`（DSH Desktop 内置市场，schemaVersion 2）。
校验规则来源：DSH Desktop 内置 `dsh-desktop-workbenches/catalog.mjs` 的 `validatePublishedCatalog`。

## 市场条目的硬性要求（缺一不可）

| 字段 | 要求 | 本包现状 |
|---|---|---|
| `id` | `owner/repository` 小写，必须与公开仓库一致 | `wenkangzhong/dsh-team-workbench` |
| `owner` / `repository` | 非空字符串 | 已填 |
| `url` | `https://github.com/<owner>/<repo>` | 待仓库公开后生效 |
| `name` | 非空 | 智能体团队 · 技能管理工作台 |
| `category` | 必须属于 catalog 的 categories（development / productivity / content / data / research / operations / other） | `operations` |
| `description.zh` / `.en` | 两种语言都必填 | 已填 |
| `version` | 与 `distribution.version` 完全一致 | `1.1.0` |
| `license` | 非空 | MIT |
| `distribution.type` | `npm` / `github-release` / `github-source` | `github-release` |
| `screenshots` | 至少 1 张 | `market/screenshots/team.png`（1227×523） |

条目模板见 `market/workbench-entry.json`。

## 发布步骤

1. **建公开仓库**（只有仓库所有者能建，这一步需要你操作）
   ```
   gh repo create <你的账号>/dsh-team-workbench --public --source . --push
   ```
   或手动：GitHub 新建空仓库 → 本地 `git remote add origin …` → `git push -u origin main`。

2. **打 release 并上传产物**（`github-release` 分发要求 tag 与 version 对应）
   ```
   git tag v1.1.0 && git push --tags
   gh release create v1.1.0 ./dsh-team-workbench-1.1.0.tgz \\
     --title "v1.1.0 · 17 人团队 · 每人专属表情与配色" \\
     --notes-file CHANGELOG.md
   ```

3. **提交市场**：DSH Desktop → 工作台 → 市场 → 提交（走 `/api/desktop-workbenches/submission-status` 与 `market-install` 校验）。
   提交时填 `market/workbench-entry.json` 的内容；我的账号不是仓库所有者，无法代你提交。

4. **验收**（提交后自查）
   ```
   curl -s https://market.dshdesktop.com/index.json | jq '.workbenches[] | select(.id=="<owner>/dsh-team-workbench")'
   ```
   再在 Desktop 市场里安装一次，确认面板、17 个成员、表情配色、模型路由都在。

## 本地安装（已验证可用）

```
# 通过 Desktop 插件管理器安装本地产物（自动写入 profile bundles，重启后每次启动都加载）
bash -lc 'open -a "DSH Desktop"'   # 保持 App 运行
# 在对话里让 Agent 执行 install_local_workbench，或：
DSH_HOME=~/Library/Application\ Support/dsh-desktop/harness \\
  dsh plugin --profile web add ./dsh-team-workbench-1.1.0.tgz
```
