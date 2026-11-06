# dsh-team-workbench · 智能体团队工作台

一个 **DSH Desktop 原生工作台**：把具名智能体团队、角色库与本机共享技能库放进同一个面板，
由 Desktop 左侧的工作台入口进出。当前版本 **1.7.0**，在 **DSH Desktop 0.13.2**（macOS arm64）实测。

## 1.2.0 做了什么

- **每个智能体一个专属表情 + 头像**：默认用 emoji 叠配色渐变底（每个成员颜色不同），
  也可以在编辑面板里上传照片（居中裁剪 160×160、webp ≤150 KB，存本机头像目录）。
- **并入角色库**：内置 agency-agents-zh 的 **313 个角色、22 个部门**（MIT，原样收录）。
  角色库标签页可搜索、按部门筛选、预览正文、一键加入团队（可指定加入哪个分组）。
  派发时按角色 id 读取正文当 persona，不会把 4 MB 正文塞进 team.json。
- **分组模式**：「分组 / 平铺」两种视图；分组可新建、改名、删除、折叠，成员可在编辑面板里换组；
  未分组成员落「未分组」。
- **「项目部」预设**：决策 / 设计 / 研发 / 测试 / 运营 / 交付六组、15 个角色，一键追加或替换；
  agent_team_task 的审核/复核关卡支持按职责关键词兜底，预设里的「质量审核员 / 交付复核员」可直接用。
- **面板重构**：顶部三标签（团队 / 角色库 / 技能库）、搜索、预设、分组卡片网格、响应式窄窗布局；
  业务区宽度 0.52。
- **可自包含构建**：客户端源码在 src/client，build-client.mjs 只做外壳与 id 注入，
  不再依赖兄弟仓库的绝对行号。

## 1.7.0：会话记录检索

- 顶部标签改为「聊天 / 团队 / 记录 / 角色库 / 技能库」，聊天仍是默认页；
- 「记录」页检索全部私聊与群聊消息（关键词 + 私聊/群聊过滤），点结果直接回到那段对话；
- 服务端新增 `GET /chats/search`，按时间倒序返回命中消息与所属会话。

## 1.6.0：整页工作台

工作台改用 `customFrame: true`，占满内容区而不是右侧分栏，会话页左列就是成员/群列表。
## 1.5.0：会话页改成 IM 布局（借鉴 DS-Bot）

会话标签不再用「私聊/群聊」开关，而是一个聊天应用式的两栏页面：

- 左栏：团队名片（名称、成员与群数量）、群聊列表、建群入口、私聊列表（动态表情头像 + 最近一句）
- 右栏：会话头部（头像、名称、管理员 / 应答模式 / 接力层数）、气泡记录、输入框与「＋」建群
- 右栏头部有「设置」，一键回到团队页继续改成员、路由和角色；设置页原样保留

## 1.4.0 做了什么：像联系人一样管 Bot

借鉴 OpenMausBot 的三处设计：

- **动态表情头像**：每个成员按 id 稳定生成一个会呼吸、会眨眼的小角色（SVG，配色取自成员颜色，
  右下角带成员 emoji 徽章）；成员停用时闭眼休眠，触发回复时加速。上传照片仍然优先显示照片。
- **Auto 应答（本地决策）**：群聊新增三种应答模式——「管理员先答」「自动挑人」「只回应 @」。
  自动模式按消息与成员名字/职责的字符重合度挑最合适的人，分数不够就回退给管理员；
  不依赖外部模型，离线可用。
- **接力层数**：每个群可设 0/1/2 层——管理者 @ 到的人执行后，还能再按他回复里的 @ 传一层，
  每条消息最多 5 个智能体回合、3 次点名。

## 1.3.0 做了什么：私聊 + 群聊

- **私聊**：每个成员一个会话，聊天记录存本机；消息带最近 12 条上下文，可连续追问。
- **群聊**：建群时选成员与管理员；用户发言默认由管理员回复，管理员在回复里 @成员名 会转给对应成员执行；
  用户也可以直接 @成员 跳过管理员。成员回复里的 @ 再转发一层，每条消息最多 5 个智能体回合、3 次点名。
- **会话页**：左侧成员 / 群列表，右侧气泡记录与输入框；成员卡上的「聊天」可直接跳进私聊。
- **模型工具**：`agent_team_chat`（私聊）与 `agent_team_group_chat`（群聊），模型也能主动找成员沟通。

会话记忆是「最近 N 条 + 新消息」的有界窗口，不是复用同一个常驻子会话——宿主 0.13.2 的
`subagents` 只提供一次性激活，没有稳定的「向同一子会话追加消息」接口；这样做的代价是长对话会
丢早前上下文，好处是不依赖未公开 API、每次都能用当前路由。

## 面板结构

```
智能体团队
团队 │ 角色库 │ 技能库
智能体团队   17 名成员 · 6 个分组 · 64 条路由
[刷新] [项目部预设] [＋ 新建]
[搜索…] [分组|平铺] [＋分组] [角色库(313)]
● 决策 3        [改名] [删除] [▾]
  成员卡  成员卡
● 研发 5 …
```

成员卡显示头像、姓名、职责、分组、当前模型与路由数；「编辑」展开完整表单（名称 / 职责 / 分组 /
头像上传 / 表情 / 颜色 / 角色提示词 / 启用 / 模型路由），「试跑」在该成员当前路由上执行并显示回退轨迹。

## 包结构

```
package.json                 # dsh.bundle.patch + dsh.client(inject: dsh-desktop-workbenches)
cordis.patch.yml             # 服务端入口插入插件树（id: team-workbench）
dsh/index.js                 # 组合 team.js + skills.js
dsh/team.js                  # 团队：store v3 / 分组 / 角色导入 / 预设 / 头像 / 路由 / 工具
dsh/library.js               # 角色库、预设、头像文件的只读数据层
dsh/chat.js                  # 私聊 / 群聊：会话存储、管理员与 @ 编排
dsh/skills.js                # 共享技能库
lib/client.js                # 客户端 bundle（由 src/client 生成，勿手改）
src/client/panel.js          # 面板源码（自包含）
data/roles.index.json        # 角色索引（313 条，约 135 KB）
data/roles.body.json.gz      # 角色正文（gzip，约 1.6 MB）
presets/project-department.json
NOTICE-agency-agents-zh.md   # 上游 MIT 归属与版本
```

## 服务端路由与工具

路由都在 /api/team-workbench 下：state、members（含分组动作）、probe、dispatch、
roles（GET 检索 / POST 导入）、roles/body、preset、avatar、chats（私聊 / 群聊 / 群管理），
以及技能库的 skills/*。

模型可见工具 11 个：agent_team_roster、agent_team_dispatch、agent_team_task、
agent_team_roles、agent_team_chat、agent_team_group_chat，以及技能库的 5 个 skill_manager_*。

## 数据位置

| 数据 | 位置 |
| --- | --- |
| 团队配置（成员 / 分组 / 头像引用） | $DSH_HOME/agent-team-studio/team.json（v3） |
| 上传的头像文件 | $DSH_HOME/team-workbench/avatars/<sha256>.webp |
| 技能库 | $DSH_HOME/.skills-src 与各 agent 的 skills |

team.json 从 v2 升级到 v3 时会先写一份 team.json.bak-v2。**1.1.0 及更早版本打开 v3 会丢掉
groups/avatar/roleRef，请不要在旧版本里继续编辑后再保存。**

## 安装

```bash
# Desktop 插件管理器：选择 dsh-team-workbench-1.2.0.tgz
# 或命令行（需要 dsh CLI）：
DSH_HOME="$HOME/Library/Application Support/dsh-desktop/harness" \
  node "/Applications/DSH Desktop.app/Contents/Resources/app.asar/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  plugin --profile web add ./dsh-team-workbench-1.2.0.tgz
```

安装后重启 Harness，左侧工作台入口会出现「智能体团队 · 技能管理工作台」。

## 自测

```bash
node scripts/smoke-client.mjs   # 结构
node scripts/smoke-server.mjs   # 服务端挂载/释放
node scripts/run-tools.mjs      # 工具 execute 与路由 handler
node scripts/smoke-migrate.mjs  # profile 迁移
node scripts/render-client.mjs  # 真实 React SSR（团队 / 角色库 / 技能库）
node scripts/smoke-v12.mjs      # 1.2.0 功能：预设 / 角色导入 / 分组 / 角色检索
node scripts/smoke-docs.mjs     # 本文档的测试项数与实跑对答案
```

## 已验证到哪一层

| 层次 | 覆盖情况 |
| --- | --- |
| 客户端注册与渲染 | `smoke-client.mjs`（结构 45 项）+ `render-client.mjs`（真实 React SSR 16 项） |
| 服务端注册与释放 | `smoke-server.mjs`（真执行 `apply()`，24 项：11 工具 / 17 路由、释放后登记表清空） |
| 工具 `execute` 与路由 handler | `run-tools.mjs`（临时 HOME 内真调用，43 项） |
| 会话功能 | `smoke-chat.mjs`（20 项：私聊连续追问、群聊 @、Auto 挑人、接力层数、工具调用、聊天记录检索） |
| 数据层功能 | `smoke-v12.mjs`（预设 15 人 6 组、角色导入、分组增删、角色检索与正文） |
| 迁移与安装 | `smoke-migrate.mjs`（假 harness + 假 CLI 真跑，21 项） |
| 文档口径 | `smoke-docs.mjs`（12 项） |
| **未覆盖** | 真实子智能体派发（要真调模型）、真实 Desktop 界面与重启后加载、真实 CLI 安装到本机 profile |

## 已知未验证项（按《工作台开发规范》第 8 节）

- [ ] 工作台出现在侧栏入口，且能打开
- [ ] 侧栏展开/收起、窄窗口下的重排：长中文标题、按钮不被裁切、不横向溢出
- [ ] 四个标签各完成一次真实业务操作（团队改成员 / 会话发消息 / 角色库加入角色 / 技能库展开技能）
- [ ] 群聊里管理员 @ 成员后，成员回复真实落到群里（本轮只做了假 subagents 的编排测试）
- [ ] 动态表情在真实 Desktop 面板里的动画流畅度（SSR 只能验证 SVG 结构）
- [ ] 切回「原生会话」后业务面板整块卸载，无残留浮层或胶囊
- [ ] 重启与卸载后 team.json、~/.skills-src 数据仍在

## 已知限制

- 工作台身份是 GitHub 仓库 narkco-kang/dsh-team-workbench；改 owner/repo 会让 Desktop
  的 active 与旧会话绑定失效。
- 「启动即进入工作台」依赖 Desktop 恢复上次的 active 工作台与会话绑定；宿主 0.13.2
  没有公开「默认工作台」接口，插件也不改写宿主状态。首次安装后点一次左侧入口即可。
- 角色正文是第三方内容（MIT），只做 frontmatter 解析与去空白；不保证每个角色都适合你的业务。

## 许可

本包 MIT。角色库内容来自 [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh)（MIT），
归属与版本见 NOTICE-agency-agents-zh.md。
