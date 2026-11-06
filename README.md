# dsh-team-workbench · 智能体团队 · 技能管理工作台

一个 **DSH Desktop 原生工作台**（不是侧边栏标签页、也不是浮动面板）：
把原来的 `dsh-agent-team-studio`（智能体团队）与 `dsh-skill-manager`（共享技能库）
两块业务合并进**一个**工作台面板，由 Desktop 的左侧模式切换器进出。

```
原生会话  ⇄  [模式切换器]  ⇄  智能体团队 · 技能管理
                                   ├─ 顶部标签：智能体团队 / 共享技能库
                                   └─ 业务区占主内容区右侧 36%
```

## 为什么改工作台（解决了什么）

改造前的两条 UI 载体都留在页面里，是「无法回收」的根源：

| 旧载体 | 回收问题 |
| --- | --- |
| `dsh-better-sidebar` 侧边栏页面 | 本机 `.dsh-market/state.json` 一直把 `dsh-better-sidebar` 列在 `disabled`，客户端永远拿不到 `ctx.betterSidebar`，这条路径实际从未生效 |
| 内联浮动管理台（`window.__DSH_DOCK__`） | 点「×」只把面板 `display:none` 并留一个胶囊：React root、DOM 宿主、4 个捕获阶段 `pointer` 监听 + 1 个 `resize` 监听全部残留；没有任何「关闭并释放」的动作 |

改造后**没有任何浮动载体**：面板挂在宿主分配的业务区里，进出由宿主的模式切换器 /
工作台管理负责。切回「原生会话」时宿主整块卸载业务面板，不存在残留胶囊或监听。

## 包结构

```
package.json          # dsh.bundle.patch + dsh.client(inject: dsh-desktop-workbenches)
cordis.patch.yml      # 把服务端入口插入插件树（id: team-workbench）
dsh/index.js          # 服务端入口：组合 team.js + skills.js
dsh/team.js           # 智能体团队：路由 + 工具（从 dsh-agent-team-studio 移植）
dsh/skills.js         # 共享技能库：路由 + 工具（从 dsh-skill-manager 移植）
lib/client.js         # 客户端单文件 bundle（生成物，勿手改）
scripts/build-client.mjs   # 生成 lib/client.js（从两个旧 bundle 按区间抽取）
scripts/smoke-client.mjs   # 客户端结构冒烟测试（注册描述符 / 无浮动残留）
scripts/smoke-server.mjs   # 服务端运行时冒烟测试（真执行 apply，统计注册与释放）
scripts/run-tools.mjs      # 工具契约回归（在临时 HOME 里真调用 execute / 路由 handler）
scripts/smoke-docs.mjs     # README 的测试项数/未验证项声明与实际跑出来的结果对答案
scripts/render-client.mjs  # SSR 冒烟测试（用真实 React 渲染两个标签）
scripts/ensure-react.mjs   # 为 SSR 测试准备 React 18（缺省时自动从 app.asar 解出）
scripts/extract-asar.py    # asar 抽取器（按 integrity 哈希对齐条目数据）
scripts/migrate-profile.mjs # profile 迁移脚本（见「安装」）+ 端到端回归
scripts/smoke-migrate.mjs  # 用假 harness/假 CLI 真跑迁移，断言安装源与 profile 结果
```

`scripts/` 已列入 `package.json` 的 `files`，因此 **tarball 里也带着这些脚本**：
从 .tgz 安装后，可在包目录（或 profile 的 `node_modules/dsh-team-workbench`）里直接跑迁移与自测。

`lib/client.js` 是**生成物**：两个业务面板的代码从旧插件的客户端 bundle 按行区间抽取，
因此面板逻辑与改造前逐字一致。改完旧插件或改完本包后运行：

```sh
node scripts/build-client.mjs \
  && node scripts/smoke-client.mjs \
  && node scripts/smoke-server.mjs \
  && node scripts/run-tools.mjs \
  && node scripts/smoke-migrate.mjs \
  && node scripts/render-client.mjs \
  && node scripts/smoke-docs.mjs
```

`run-tools.mjs` 说明：它在**临时 HOME** 里真调用工具的 `execute` 与路由 handler，
从而覆盖 `smoke-server.mjs` 覆盖不到的那一层——`smoke-server.mjs` 只验证
「运行时注册了哪些工具/路由、能不能释放」，不执行 `execute`。
所以「声明的 `output.schema` 与实际返回对象不一致」这类缺陷只有 `run-tools.mjs` 能抓
（真的漏过一次：`agent_team_task` 第一关失败分支少了 4 个 required 字段）。
它在 import 之前把 HOME 指到临时目录，因此 `skills.js` 顶层捕获的路径全部落在临时目录，
结束时还会断言没有碰真实 `~/.skills-src`。

`smoke-migrate.mjs` 值得单独说一句：`--dry-run` 不执行安装分支，`node --check` 也不查标识符，
所以「非 dry-run 路径引用未定义变量」这类缺陷前两种手段都抓不到（改造过程中真的踩过一次）。
它用假 harness + 假 CLI 把迁移**真跑**一遍，断言 CLI 收到的安装源与迁移后的 profile 内容。

`render-client.mjs` 需要 React 18：不给参数时它会调用 `ensure-react.mjs`，从 DSH Desktop 的
`app.asar` 里解出**宿主同一份** react / react-dom 到 `.cache/react`（`.cache/` 是本地缓存，
不进包）。已有 React 时用 `--react <含 node_modules/react 的目录>`，或设 `DSH_REACT_DIR`。

> asar 抽取为什么走 Python：Electron 的 asar 补丁会拦截 `.asar` 路径，且本机这份 0.11.1
> 构建的条目数据偏移不是固定对齐的（实测差 2–4 字节）。`extract-asar.py` 直接读文件、
> 用条目自带的 `integrity` 哈希对候选偏移逐个做 SHA-256 校验来对齐，最直接也最可验证
> （实测 react + react-dom 共 50 个文件，50 个通过校验）。

## 服务端路由与工具

路由前缀都在本包自己的命名空间下（`/api/team-workbench*`），不会占用其它插件的路径。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/team-workbench/state` | 名册 + 模型目录 + 默认路由 + 上限 |
| POST | `/api/team-workbench/members` | 成员与路由的增删改查（动作表同旧插件） |
| POST | `/api/team-workbench/probe` | 校验一条模型路由（不发真实请求） |
| POST | `/api/team-workbench/dispatch` | 在成员的路由列表上试跑一次任务 |
| GET | `/api/team-workbench/skills/state` | 技能列表 + 派发状态 + 统计 |
| POST | `/api/team-workbench/skills/read` | 读某个技能的 frontmatter 与正文 |
| POST | `/api/team-workbench/skills/save` | 新建/更新第一方技能并派发 |
| POST | `/api/team-workbench/skills/delete` | 删除第一方技能并清理链接 |
| POST | `/api/team-workbench/skills/deploy` | 重新派发全部第一方技能 |

模型工具共 **8 个**，与旧插件**同名**，调用方式不变：

| 来自 | 工具 |
| --- | --- |
| 智能体团队 | `agent_team_roster`、`agent_team_dispatch`、`agent_team_task`（强制审查流水线：产出 → 审核 → 复核） |
| 共享技能库 | `skill_manager_list`、`skill_manager_read`、`skill_manager_save`、`skill_manager_delete`、`skill_manager_deploy` |

## 数据位置

- 团队名册：`$DSH_HOME/agent-team-studio/team.json`（**与旧插件同一路径**，升级不丢数据）
- 第一方技能源（可写）：`~/.skills-src`
- 第三方技能源（只读）：`~/.workbuddy-ai/skills`

## 安装

```sh
DSH_HOME=<harness> dsh plugin --profile web add \
  ./dsh-team-workbench-1.1.0.tgz
```

安装后必须**完整退出并重新打开 DSH Desktop**（新插件层在 Harness 启动时组装）。
重启后：侧栏顶部模式切换器里应出现「智能体团队 · 技能管理」，也可以从
「工作台管理」里看到这一条。

### 脚本对环境的依赖（哪些能在发布包里独立跑，哪些不能）

`scripts/` 随包发布，但它们的依赖并不一样——这里写清楚，避免误判：

| 脚本 | 需要的输入 | 发布包（仅 tarball 解出）里能跑吗 |
| --- | --- | --- |
| `smoke-client.mjs` | 包内 `lib/client.js` + `package.json` | **能** |
| `smoke-server.mjs` | 包内 `dsh/*` | **能** |
| `run-tools.mjs` | 包内 `dsh/*` + 可写的临时 HOME | **能** |
| `smoke-docs.mjs` | 包内 `README.md` + 其它测试脚本 | **能** |
| `render-client.mjs` | 包内 `lib/client.js` + 一份 React（缺省自动从 app.asar 解） | **能** |
| `smoke-migrate.mjs` | 包内 `scripts/migrate-profile.mjs` + node | **能** |
| `migrate-profile.mjs` | 包本身（安装源）+ 能写的 `<harness>/profiles/<profile>` | **能**（在其包目录或其解包目录里跑） |
| `build-client.mjs` | **包外**两个兄弟目录：`../dsh-agent-team-studio/lib/client.js`、`../dsh-skill-manager/lib/client.js` | **不能**（它读的是那两支插件的源码做抽取） |

也就是说：只有 `build-client.mjs` 是**源码工作区工具**，必须在与那两支插件并列的目录里跑。
发布包里已经带着生成好的 `lib/client.js`，普通使用者不需要跑它。
拿不到兄弟目录时，它会直接报一句人话而不是抛 ENOENT：

```
缺少源文件：…/dsh-agent-team-studio/lib/client.js
本脚本需要与 dsh-agent-team-studio 并列放在同一个工作区里（读它的客户端源码做抽取）。
只安装了发布包时不需要运行本脚本：lib/client.js 已经随包提供。
```

### 从已安装的包里跑迁移

`migrate-profile.mjs` 的安装源按 `--from 指定值 → 包根/当前目录里最新的 .tgz → 包目录本身`
的顺序解析：源码目录里有 `.tgz` 时优先用它（规范 3.6 的发布形态）；从 tarball 装进
profile 之后包里没有 `.tgz`，此时它会自动以包目录为安装源，因此迁移在两种位置都能跑。
需要显式指定时用 `--from <路径>`。

可覆盖的环境变量：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `DSH_HOME` | harness 主目录 | `~/Library/Application Support/dsh-desktop/harness` |
| `DSH_PROFILE` | 目标 profile | `web` |
| `DSH_BIN` | dsh CLI 入口 | `…/app.asar/node_modules/@deepseek-ai/dsh/lib/bin.js` |
| `DSH_REACT_DIR` | SSR 测试用的 React 目录 | 包内 `.cache/react`（缺省自动解出） |

### 关于 `repository` 字段（重要）

注册时必须给一个规范的 GitHub `repository` URL，Desktop 用它解析工作台身份
（`owner/repo`）。本包的规范身份是 `narkco-kang/dsh-team-workbench`，对应仓库
`https://github.com/narkco-kang/dsh-team-workbench`；该 URL 在
`lib/client.js`、`scripts/build-client.mjs` 与 `market/workbench-entry.json` 三处必须一致，
市场条目也会按它校验 `id`。

- 冒烟测试只校验 URL 形式合规（`^https://github.com/<owner>/<repo># dsh-team-workbench · 智能体团队 · 技能管理工作台

一个 **DSH Desktop 原生工作台**（不是侧边栏标签页、也不是浮动面板）：
把原来的 `dsh-agent-team-studio`（智能体团队）与 `dsh-skill-manager`（共享技能库）
两块业务合并进**一个**工作台面板，由 Desktop 的左侧模式切换器进出。

```
原生会话  ⇄  [模式切换器]  ⇄  智能体团队 · 技能管理
                                   ├─ 顶部标签：智能体团队 / 共享技能库
                                   └─ 业务区占主内容区右侧 36%
```

## 为什么改工作台（解决了什么）

改造前的两条 UI 载体都留在页面里，是「无法回收」的根源：

| 旧载体 | 回收问题 |
| --- | --- |
| `dsh-better-sidebar` 侧边栏页面 | 本机 `.dsh-market/state.json` 一直把 `dsh-better-sidebar` 列在 `disabled`，客户端永远拿不到 `ctx.betterSidebar`，这条路径实际从未生效 |
| 内联浮动管理台（`window.__DSH_DOCK__`） | 点「×」只把面板 `display:none` 并留一个胶囊：React root、DOM 宿主、4 个捕获阶段 `pointer` 监听 + 1 个 `resize` 监听全部残留；没有任何「关闭并释放」的动作 |

改造后**没有任何浮动载体**：面板挂在宿主分配的业务区里，进出由宿主的模式切换器 /
工作台管理负责。切回「原生会话」时宿主整块卸载业务面板，不存在残留胶囊或监听。

## 包结构

```
package.json          # dsh.bundle.patch + dsh.client(inject: dsh-desktop-workbenches)
cordis.patch.yml      # 把服务端入口插入插件树（id: team-workbench）
dsh/index.js          # 服务端入口：组合 team.js + skills.js
dsh/team.js           # 智能体团队：路由 + 工具（从 dsh-agent-team-studio 移植）
dsh/skills.js         # 共享技能库：路由 + 工具（从 dsh-skill-manager 移植）
lib/client.js         # 客户端单文件 bundle（生成物，勿手改）
scripts/build-client.mjs   # 生成 lib/client.js（从两个旧 bundle 按区间抽取）
scripts/smoke-client.mjs   # 客户端结构冒烟测试（注册描述符 / 无浮动残留）
scripts/smoke-server.mjs   # 服务端运行时冒烟测试（真执行 apply，统计注册与释放）
scripts/run-tools.mjs      # 工具契约回归（在临时 HOME 里真调用 execute / 路由 handler）
scripts/smoke-docs.mjs     # README 的测试项数/未验证项声明与实际跑出来的结果对答案
scripts/render-client.mjs  # SSR 冒烟测试（用真实 React 渲染两个标签）
scripts/ensure-react.mjs   # 为 SSR 测试准备 React 18（缺省时自动从 app.asar 解出）
scripts/extract-asar.py    # asar 抽取器（按 integrity 哈希对齐条目数据）
scripts/migrate-profile.mjs # profile 迁移脚本（见「安装」）+ 端到端回归
scripts/smoke-migrate.mjs  # 用假 harness/假 CLI 真跑迁移，断言安装源与 profile 结果
```

`scripts/` 已列入 `package.json` 的 `files`，因此 **tarball 里也带着这些脚本**：
从 .tgz 安装后，可在包目录（或 profile 的 `node_modules/dsh-team-workbench`）里直接跑迁移与自测。

`lib/client.js` 是**生成物**：两个业务面板的代码从旧插件的客户端 bundle 按行区间抽取，
因此面板逻辑与改造前逐字一致。改完旧插件或改完本包后运行：

```sh
node scripts/build-client.mjs \
  && node scripts/smoke-client.mjs \
  && node scripts/smoke-server.mjs \
  && node scripts/run-tools.mjs \
  && node scripts/smoke-migrate.mjs \
  && node scripts/render-client.mjs \
  && node scripts/smoke-docs.mjs
```

`run-tools.mjs` 说明：它在**临时 HOME** 里真调用工具的 `execute` 与路由 handler，
从而覆盖 `smoke-server.mjs` 覆盖不到的那一层——`smoke-server.mjs` 只验证
「运行时注册了哪些工具/路由、能不能释放」，不执行 `execute`。
所以「声明的 `output.schema` 与实际返回对象不一致」这类缺陷只有 `run-tools.mjs` 能抓
（真的漏过一次：`agent_team_task` 第一关失败分支少了 4 个 required 字段）。
它在 import 之前把 HOME 指到临时目录，因此 `skills.js` 顶层捕获的路径全部落在临时目录，
结束时还会断言没有碰真实 `~/.skills-src`。

`smoke-migrate.mjs` 值得单独说一句：`--dry-run` 不执行安装分支，`node --check` 也不查标识符，
所以「非 dry-run 路径引用未定义变量」这类缺陷前两种手段都抓不到（改造过程中真的踩过一次）。
它用假 harness + 假 CLI 把迁移**真跑**一遍，断言 CLI 收到的安装源与迁移后的 profile 内容。

`render-client.mjs` 需要 React 18：不给参数时它会调用 `ensure-react.mjs`，从 DSH Desktop 的
`app.asar` 里解出**宿主同一份** react / react-dom 到 `.cache/react`（`.cache/` 是本地缓存，
不进包）。已有 React 时用 `--react <含 node_modules/react 的目录>`，或设 `DSH_REACT_DIR`。

> asar 抽取为什么走 Python：Electron 的 asar 补丁会拦截 `.asar` 路径，且本机这份 0.11.1
> 构建的条目数据偏移不是固定对齐的（实测差 2–4 字节）。`extract-asar.py` 直接读文件、
> 用条目自带的 `integrity` 哈希对候选偏移逐个做 SHA-256 校验来对齐，最直接也最可验证
> （实测 react + react-dom 共 50 个文件，50 个通过校验）。

## 服务端路由与工具

路由前缀都在本包自己的命名空间下（`/api/team-workbench*`），不会占用其它插件的路径。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/team-workbench/state` | 名册 + 模型目录 + 默认路由 + 上限 |
| POST | `/api/team-workbench/members` | 成员与路由的增删改查（动作表同旧插件） |
| POST | `/api/team-workbench/probe` | 校验一条模型路由（不发真实请求） |
| POST | `/api/team-workbench/dispatch` | 在成员的路由列表上试跑一次任务 |
| GET | `/api/team-workbench/skills/state` | 技能列表 + 派发状态 + 统计 |
| POST | `/api/team-workbench/skills/read` | 读某个技能的 frontmatter 与正文 |
| POST | `/api/team-workbench/skills/save` | 新建/更新第一方技能并派发 |
| POST | `/api/team-workbench/skills/delete` | 删除第一方技能并清理链接 |
| POST | `/api/team-workbench/skills/deploy` | 重新派发全部第一方技能 |

模型工具共 **8 个**，与旧插件**同名**，调用方式不变：

| 来自 | 工具 |
| --- | --- |
| 智能体团队 | `agent_team_roster`、`agent_team_dispatch`、`agent_team_task`（强制审查流水线：产出 → 审核 → 复核） |
| 共享技能库 | `skill_manager_list`、`skill_manager_read`、`skill_manager_save`、`skill_manager_delete`、`skill_manager_deploy` |

## 数据位置

- 团队名册：`$DSH_HOME/agent-team-studio/team.json`（**与旧插件同一路径**，升级不丢数据）
- 第一方技能源（可写）：`~/.skills-src`
- 第三方技能源（只读）：`~/.workbuddy-ai/skills`

## 安装

```sh
DSH_HOME=<harness> dsh plugin --profile web add \
  ./dsh-team-workbench-1.1.0.tgz
```

安装后必须**完整退出并重新打开 DSH Desktop**（新插件层在 Harness 启动时组装）。
重启后：侧栏顶部模式切换器里应出现「智能体团队 · 技能管理」，也可以从
「工作台管理」里看到这一条。

### 脚本对环境的依赖（哪些能在发布包里独立跑，哪些不能）

`scripts/` 随包发布，但它们的依赖并不一样——这里写清楚，避免误判：

| 脚本 | 需要的输入 | 发布包（仅 tarball 解出）里能跑吗 |
| --- | --- | --- |
| `smoke-client.mjs` | 包内 `lib/client.js` + `package.json` | **能** |
| `smoke-server.mjs` | 包内 `dsh/*` | **能** |
| `run-tools.mjs` | 包内 `dsh/*` + 可写的临时 HOME | **能** |
| `smoke-docs.mjs` | 包内 `README.md` + 其它测试脚本 | **能** |
| `render-client.mjs` | 包内 `lib/client.js` + 一份 React（缺省自动从 app.asar 解） | **能** |
| `smoke-migrate.mjs` | 包内 `scripts/migrate-profile.mjs` + node | **能** |
| `migrate-profile.mjs` | 包本身（安装源）+ 能写的 `<harness>/profiles/<profile>` | **能**（在其包目录或其解包目录里跑） |
| `build-client.mjs` | **包外**两个兄弟目录：`../dsh-agent-team-studio/lib/client.js`、`../dsh-skill-manager/lib/client.js` | **不能**（它读的是那两支插件的源码做抽取） |

也就是说：只有 `build-client.mjs` 是**源码工作区工具**，必须在与那两支插件并列的目录里跑。
发布包里已经带着生成好的 `lib/client.js`，普通使用者不需要跑它。
拿不到兄弟目录时，它会直接报一句人话而不是抛 ENOENT：

```
缺少源文件：…/dsh-agent-team-studio/lib/client.js
本脚本需要与 dsh-agent-team-studio 并列放在同一个工作区里（读它的客户端源码做抽取）。
只安装了发布包时不需要运行本脚本：lib/client.js 已经随包提供。
```

### 从已安装的包里跑迁移

`migrate-profile.mjs` 的安装源按 `--from 指定值 → 包根/当前目录里最新的 .tgz → 包目录本身`
的顺序解析：源码目录里有 `.tgz` 时优先用它（规范 3.6 的发布形态）；从 tarball 装进
profile 之后包里没有 `.tgz`，此时它会自动以包目录为安装源，因此迁移在两种位置都能跑。
需要显式指定时用 `--from <路径>`。

可覆盖的环境变量：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `DSH_HOME` | harness 主目录 | `~/Library/Application Support/dsh-desktop/harness` |
| `DSH_PROFILE` | 目标 profile | `web` |
| `DSH_BIN` | dsh CLI 入口 | `…/app.asar/node_modules/@deepseek-ai/dsh/lib/bin.js` |
| `DSH_REACT_DIR` | SSR 测试用的 React 目录 | 包内 `.cache/react`（缺省自动解出） |

），**不代表仓库已存在**；
  首次发布前需先建仓库并 `git push`，否则市场提交会被拒。

### 与旧插件的关系

| | 旧 `dsh-agent-team-studio` / `dsh-skill-manager` | 本包 |
| --- | --- | --- |
| 服务端路由 | `/api/agent-team-studio/*`、`/api/skill-manager/*` | `/api/team-workbench*` |
| 模型工具 | 8 个（同名） | 8 个（**同名**，不能与旧包同时挂载，否则工具重名冲突） |
| 客户端 UI | 侧边栏标签 + 浮动管理台 | 原生工作台面板 |

**因此：本包与旧的两支 UI 插件不能同时出现在 `dsh.profile.bundles` 里**——工具名会撞。
升级脚本 `scripts/migrate-profile.mjs` 会把这两支从 bundles 与 dependencies 里摘掉。

## 已知限制（实现层面）

- **释放链**：`dsh/team.js` 的 `apply()` 现在显式返回释放函数，`dsh/skills.js` 把 5 个工具
  disposer 逐个纳入释放链——这两处与旧插件不同（旧插件的工具 disposer 没有进释放链，
  只靠 `ctx.effect` 兜底）。`scripts/smoke-server.mjs` 用「活登记表」验证释放后
  8 个工具 / 9 条路由的登记表都清空。
- **工具计数口径**：同名工具是 **8 个**（团队 3 + 技能库 5）。结构测试
  （`smoke-client.mjs`）查源码字符串与文档口径，运行时结论由 `smoke-server.mjs`
  真执行 `apply()` 后统计得出——两者都在跑，不要只看其中一项。
- **版本号只有一个来源**：`dsh/team.js` 的 `PLUGIN_VERSION` 必须等于 `package.json` 的 `version`
  （`/state` 的 `pluginVersion`、面板页脚、启动日志都读它）。改包版本时两处一起改；
  `smoke-client.mjs` 有断言钉住这一对。
- **生成物里不得残留旧插件身份**：面板代码是从旧插件 bundle 抽取的，页脚曾硬编码
  `"dsh-agent-team-studio"`（界面会显示成另一个包）。`build-client.mjs` 有定点重写，
  `smoke-client.mjs` 同时禁止 `"dsh-agent-team-studio"`、`"dsh-skill-manager"`、`TAB_ID`、
  `agent-team-studio:roster` 这些字面量出现在生成物里。

## 已验证到哪一层（避免把结论说过头）

| 层次 | 覆盖情况 |
| --- | --- |
| 客户端注册与渲染 | `smoke-client.mjs`（结构 45 项）+ `render-client.mjs`（真实 React SSR 10 项） |
| 服务端注册与释放 | `smoke-server.mjs`（真执行 `apply()`，24 项：8 工具 / 9 路由、释放后登记表清空） |
| 工具 `execute` 与路由 handler | `run-tools.mjs`（临时 HOME 内真调用，37 项：输出契约、错误分支、`/state` 与 `/skills/state`） |
| 迁移与安装 | `smoke-migrate.mjs`（假 harness + 假 CLI 真跑，21 项）+ `--dry-run`（源码目录 / 无 .tgz 包目录） |
| 文档口径 | `smoke-docs.mjs`（12 项）：README 里每个测试项数与实跑逐一对答案，防止「文档说 39、实跑 45」这类漂移 |
| **未覆盖** | 真实子智能体派发（要真调模型）、真实 Desktop 界面与重启后加载、真实 CLI 安装到本机 profile |

最后一行是**未验证**的部分，见下面的自查清单。`run-tools.mjs` 里对派发路径用的是
「provider 可用、start 必失败」的桩，只用来覆盖错误返回分支，不代表真实派发已测。

## 已知未验证项（按《工作台开发规范》第 8 节）

本机自测只做到了包校验 + 客户端结构/渲染冒烟；以下必须在安装并重启后**在真实界面里**核对：

- [ ] 工作台出现在侧栏模式切换器 / 工作台管理列表，且能从左侧入口打开
- [ ] 业务区在侧栏展开/收起、窄窗口下的重排：长中文标题、按钮不被裁切、不横向溢出
- [ ] 两个标签各自完成一次真实业务操作（团队：改一个成员；技能库：展开一个技能）
- [ ] 切回「原生会话」后确认业务面板整块卸载，页面无残留浮层/胶囊
- [ ] 重启与卸载后确认 `team.json`、`~/.skills-src` 数据仍在

## 许可

MIT