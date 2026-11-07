# dsh-team-workbench · 智能体团队工作台

一个 **DSH 网页客户端插件**（`dsh.client.platform = web`）：把具名智能体团队做成聊天应用。
**2.6.0 起默认收在右下角胶囊**，DSH 自己的会话与输入框照常可用；点胶囊才铺满窗口，
右上角「收起」再缩回胶囊。当前版本 **2.33.0**，在 **DSH Desktop 0.13.2**（macOS arm64）实测。

> 2.0.0 起不再是工作台（workbench）面板：客户端不调用 `desktopWorkbenches.register`，
> 改为挂载到 `document.body`，因此能盖住宿主导航——与 DS-Bot 的做法一致。
> 安装走**插件**渠道，不再出现在左侧「工作台」入口。
>
> **2.6.1**：聊天页打开即落在上次的会话（其次第一个群、第一个成员），输入框常驻，
> 不会再出现「页面里没有输入框」；照片头像读不出来时自动退回动态表情。

## 现在能做什么

- **团队 App**：默认收在右下角胶囊；点开铺满窗口，顶部六个标签
  **聊天 / 团队 / 记录 / 额度 / 角色库 / 技能库**，右上角「收起」返回胶囊。
- **聊天页**：左栏群聊 + 私聊列表，右栏会话头、气泡与**常驻输入框**；打开即恢复上次会话，
  没有会话时也会显示输入框（禁用态），不会出现空页。
- **成员与模型路由**：每个成员有姓名、职责、分组、头像、表情、配色和一组可回退的模型路由；
  「试跑」按当前路由执行并显示回退轨迹。
- **私聊 / 群聊**：私聊带最近 12 条上下文；群聊可让管理员先答、按内容自动挑人、或只回应 @，
  @ 接力最多 2 层（每条消息 5 个智能体回合、3 次点名）。
- **记录检索**：「记录」页按关键词与私聊/群聊过滤全部消息，点结果直接回到那段对话。
- **角色库**：内置 agency-agents-zh 的 **313 个角色、22 个部门**（MIT，原样收录），
  可搜索、按部门筛选、预览正文、一键加入团队；派发时按角色 id 读取正文当 persona。
- **项目部预设**：决策 / 设计 / 研发 / 测试 / 运营 / 交付六组、15 个角色，一键追加或替换。
- **共享技能库**：5 个 `skill_manager_*` 工具，列出、检索、展开、写入技能。
- **每人专属身份**：动态表情头像（呼吸/眨眼 SVG，可换成上传照片）、专属配色、分组卡片。

## 面板结构

```
智能体团队                                    [收起]
聊天 │ 团队 │ 记录 │ 角色库 │ 技能库
┌ 左栏（聊天页）──────────┬ 右栏 ─────────────────────┐
│ 团队名片：17 名成员 · 6 组 │ 会话头：头像 名称 管理员 @ │
│ 群聊列表                 │ 气泡记录                  │
│ ＋ 建群                  │ 输入框                    │
│ 私聊列表（头像+最近一句） │ ＋ 建群 · 设置            │
└──────────────────────────┴───────────────────────────┘
```

团队页是成员卡片网格（搜索 / 分组 / 平铺 / 新建 / 预设），编辑面板里改名称、职责、分组、头像、
表情、颜色、角色提示词、启用状态与模型路由；角色库、技能库各占一个标签。

## 安装

2.33.0 是普通插件包（`dsh.bundle.patch` + `dsh.client.platform: web`），三种装法任选：

```bash
# 1) 官方 CLI（推荐；会把包名写进 dsh.profile.bundles）
DSH_HOME="$HOME/Library/Application Support/dsh-desktop/harness" \
  node "/Applications/DSH Desktop.app/Contents/Resources/app.asar/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  plugin --profile web add ./dsh-team-workbench-2.33.0.tgz

# 2) 从 Release 直链装
dsh plugin --profile web add \
  https://github.com/narkco-kang/dsh-team-workbench/releases/download/v2.33.0/dsh-team-workbench.tgz

# 3) 卸载
dsh plugin --profile web remove dsh-team-workbench
```

也可以打开 **设置 → 插件 → 安装**，填 npm 包名、GitHub 地址或 `.tgz` 直链。

装完**重启 Harness**（菜单 Harness → 重启 Harness），右下角会出现「🧑‍🤝‍🧑 智能体团队」胶囊；
点开就是团队 App，点右上角「收起」回到 DSH。1.x 是工作台包，同一个包名，
**先卸掉旧工作台再装 2.33.0**，否则两套入口会同时存在。

## 包结构

```
package.json                 # dsh.bundle.patch + dsh.client.platform: web
cordis.patch.yml             # 服务端入口插入插件树（id: team-workbench）
dsh/index.js                 # 组合 team.js + skills.js
dsh/team.js                  # 团队：store v3 / 分组 / 角色导入 / 预设 / 头像 / 路由 / 工具
dsh/library.js               # 角色库、预设、头像文件的只读数据层
dsh/chat.js                  # 私聊 / 群聊：会话存储、管理员与 @ 编排
dsh/skills.js                # 共享技能库
lib/client.js                # 客户端 bundle（由 src/client 生成，勿手改）
src/client/panel.js          # 面板源码（自包含，挂 document.body 固定层）
data/roles.index.json        # 角色索引（313 条，约 135 KB）
data/roles.body.json.gz      # 角色正文（gzip，约 1.6 MB）
presets/project-department.json
NOTICE-agency-agents-zh.md   # 上游 MIT 归属与版本
```

## 服务端路由与工具

路由都在 /api/team-workbench 下：state、members（含分组动作）、probe、dispatch、
roles（GET 检索 / POST 导入）、roles/body、preset、avatar、chats（私聊 / 群聊 / 群管理 /
records/search），以及技能库的 skills/* 与语音识别的 stt。

模型可见工具 11 个：agent_team_roster、agent_team_dispatch、agent_team_task、
agent_team_roles、agent_team_chat、agent_team_group_chat，以及技能库的 5 个 skill_manager_*。

## 记忆与会话模型

- **配置**：team.json（成员 / 路由 / 分组 / 头像 / chiefId），只有一份。
- **并行接力**：同一层被 @ 的成员并发跑（默认上限 3），受 `room.parallel` / `room.maxParallel` 控制；
  实测两个成员 500ms 固定延迟时，串行 2748ms → 并行 1115ms（2.46×）。参考了
  [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) 的 worker slot 与并发启动。
- **会话**：chats.json 里按会话分开存——每个成员一个 `private[memberId]`，每个群一个 `rooms[].messages`，
  再加一个固定的总管台 `chief-desk`；各自独立的记录，互不串。
- **短期上下文**：每次请求带「最近 12 条 + 新消息」（`HISTORY_WINDOW`），有界、不常驻子会话。
- **长期记忆（L0–L3）**：参考 [TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)
  的分层与渐进披露（不是接它的服务）：
  - L0 原始对话 = `chats.json`；L1 原子事实 = `atoms[]`（带 `key` / 重要度 / 来源消息）；
  - L2 场景摘要 = `l2.summary`；L3 用户画像 = 跨会话共享的 `persona.items[]`；
  - 同一 `key` 的新事实覆盖旧的；同文本与 Jaccard ≥ 0.8 的近重复不入库；L1 上限 40 条按 BM25 分数淘汰，L3 上限 12 条；
  - 召回是 **BM25 + 向量混合**：BM25（中文二元组 + IDF + 长度归一 + 去停用词 + 同义词扩展 + key 权重）
    与 embedding 余弦各出一份排名，用 RRF 融合；关键词一个都没命中时直接用向量排序；
  - embedding 默认走本机 Ollama（`http://127.0.0.1:11434/v1`，模型 `qwen3-embedding:0.6b`，1024 维），
    也可在记忆面板里换成任意 OpenAI 兼容端点；向量缓存在 `memory-vectors.json`，不可用时自动退回 BM25；
  - 每 12 条新消息由负责人压缩一次（后台执行）；提示词只注入**画像 + 场景 + 按当前消息打分的前 6 条事实**，
    其余留在文件里，从「记忆」面板检索（`GET /memory?q=`）或记录检索下钻。
- **记忆面板**：聊天头部「记忆」按 L3 / L2 / L1 分层展示，可删画像、删事实、手动记一条、清空。
- **检索**：`GET /chats/search` 支持 `q` / `kind` / `id`，可只搜某个群（`kind=group&id=<roomId>`）
  或某位成员（`kind=private&id=<memberId>`）；界面上的「范围」下拉与这个参数一一对应。

## 语音识别（本地 STT）

插件不内置识别模型，默认转发到本机 [jianchang512/stt](https://github.com/jianchang512/stt)（faster-whisper）：

```bash
# 一次性安装
git clone https://github.com/jianchang512/stt && cd stt
python3.11 -m venv venv && ./venv/bin/pip install -r requirements.txt

# 开机自启（macOS）：~/Library/LaunchAgents/com.wenkang.stt.plist，RunAtLoad + KeepAlive
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.wenkang.stt.plist
```

服务在 `http://127.0.0.1:9977`；插件「语音」面板可改地址/模型/语言、检测权限、测试连通性。

准确率相关（实测）：

| 模型 | 单句耗时 | 中文效果 |
| --- | --- | --- |
| tiny | ~1s | 差（「接口联调」→「接口轮调」） |
| small | 1-3s | 一般 |
| **medium（默认）** | 5-7s | 好（专名与标点基本正确） |
| large-v3-turbo / large-v3 | 更慢 | 最好，CPU 上不推荐默认 |

两个本地 stt 侧的必要调整（都已生效，重装时记得重做）：

1. `set.ini` 的 `initial_prompt_zh` 写成中文术语表，改善标点与专名；
2. `start.py` 的 `_api_process` 加进程内模型缓存（原实现每个请求都重建 WhisperModel，
   单次 20-40s）；加了缓存后 medium 才降到 5-7s。

### 转写服务商（不必只用 OpenAI）

「语音」面板里可选，切换时自动带出默认地址与模型：

| 服务商 | 协议 | 默认地址 / 模型 |
| --- | --- | --- |
| 本地 stt | `POST {base}/api`，multipart | `http://127.0.0.1:9977` / `medium` |
| OpenAI Whisper | `POST {base}/audio/transcriptions` | `https://api.openai.com/v1` / `whisper-1` |
| 智谱 GLM-ASR | 同上（OpenAI 兼容） | `https://open.bigmodel.cn/api/paas/v4` / `glm-asr-2512` |
| MiniMax ASR | `POST {base}/speech_to_text` + `language` 头 | `https://api.minimax.chat/v1` / `asr-1.0` |
| 自定义 OpenAI 兼容 | 同上 | 自填 |

API Key 只存本机 `stt-settings.json`，接口只回「是否已配置」，不回明文。

### 模型校对（可选）

识别完可以再交给团队里的某个成员做一次**最小纠错**（同音字/错字/漏标点），提示词明确禁止改写、总结、回答。
护栏：输出为空、长度 >2 倍、或 <40% 都拒收并回退原文；模型超时/报错同样回退原文。
面板直接选「校对服务商 + 校对模型」（不用再挑成员、也不用猜成员用的什么模型）+ 术语表；
选「**跟随识别服务商**」时会自动挑同系聊天模型（ASR 用 MiniMax → 校对走 minimax-cn，以此类推）；术语表默认已填 `智能体、语音识别、接口联调、验收清单`。

面板里的 **「测试转写」** 会用 0.8 秒合成音频走一遍当前服务商（不需要麦克风），
回报「连通 · 延迟 · 返回字数」；鉴权、地址、模型任何一处配错都会当场暴露。

## 数据位置

| 数据 | 位置 |
| --- | --- |
| 团队配置（成员 / 分组 / 头像引用） | $DSH_HOME/agent-team-studio/team.json（v3） |
| 私聊 / 群聊记录 | $DSH_HOME/team-workbench/chats.json |
| 会话长期记忆（L1 事实 / L2 场景 / L3 画像） | $DSH_HOME/team-workbench/memory.json（v2） |
| 记忆向量缓存 | $DSH_HOME/team-workbench/memory-vectors.json |
| embedding 设置 | $DSH_HOME/team-workbench/memory-settings.json |
| 语音识别设置 | $DSH_HOME/team-workbench/stt-settings.json |
| 技能库 | $DSH_HOME/.skills-src 与各 agent 的 skills |

team.json 从 v2 升级到 v3 时会先写一份 team.json.bak-v2。**1.1.0 及更早版本打开 v3 会丢掉
groups/avatar/roleRef，请不要在旧版本里继续编辑后再保存。**

## 自测

```bash
node scripts/smoke-client.mjs   # 结构
node scripts/smoke-server.mjs   # 服务端挂载/释放
node scripts/run-tools.mjs      # 工具 execute 与路由 handler
node scripts/smoke-migrate.mjs  # profile 迁移
node scripts/render-client.mjs  # 真实 React SSR（团队 / 角色库 / 技能库）
node scripts/smoke-v12.mjs      # 1.2.0 功能：预设 / 角色导入 / 分组 / 角色检索
node scripts/smoke-chat.mjs     # 私聊 / 群聊 / Auto 挑人 / 接力 / 记录检索
node scripts/smoke-docs.mjs     # 本文档的测试项数与实跑对答案
```

## 已验证到哪一层

| 层次 | 覆盖情况 |
| --- | --- |
| 客户端注册与渲染 | `smoke-client.mjs`（结构 42 项）+ `render-client.mjs`（真实 React SSR 19 项） |
| 服务端注册与释放 | `smoke-server.mjs`（真执行 `apply()`，24 项：11 工具 / 23 路由、释放后登记表清空） |
| 工具 `execute` 与路由 handler | `run-tools.mjs`（临时 HOME 内真调用，43 项） |
| 会话功能 | `smoke-chat.mjs`（20 项：私聊连续追问、群聊 @、Auto 挑人、接力层数、工具调用、聊天记录检索） |
| 数据层功能 | `smoke-v12.mjs`（预设 15 人 6 组、角色导入、分组增删、角色检索与正文） |
| 迁移与安装 | `smoke-migrate.mjs`（假 harness + 假 CLI 真跑，21 项） |
| 文档口径 | `smoke-docs.mjs`（12 项） |
| **未覆盖** | 真实子智能体派发（要真调模型）、真实 Desktop 界面与重启后加载、真实 CLI 安装到本机 profile |

## 已知未验证项（按《工作台开发规范》第 8 节）

- [ ] 重启后右下角出现胶囊；点开铺满窗口、左侧导航被盖住，点「收起」缩回胶囊
- [ ] 右上角「收起」缩成右下角胶囊，点击恢复，切回正常 DSH 无残留浮层
- [ ] 五个标签各完成一次真实业务操作（聊天发消息 / 团队改成员 / 记录检索 / 角色库加入角色 / 技能库展开技能）
- [ ] 群聊里管理员 @ 成员后，成员回复真实落到群里（本轮只做了假 subagents 的编排测试）
- [ ] 动态表情在真实窗口里的动画流畅度（SSR 只能验证 SVG 结构）
- [ ] 窄窗口下左栏/右栏重排，长中文标题与按钮不被裁切、不横向溢出
- [ ] 重启与卸载后 team.json、chats.json、~/.skills-src 数据仍在

## 已知限制

- 插件身份是 GitHub 仓库 narkco-kang/dsh-team-workbench；改 owner/repo 会让市场条目与旧会话绑定失效。
- 默认收在胶囊（2.6.0 起），开合状态记在 localStorage；清除站点数据后回到默认收起。
- `install_local_workbench` 只收工作台格式的包（要求 `dsh.client.inject` 含
  `dsh-desktop-workbenches`），2.0.0 是网页插件，请走上面的 CLI 或插件管理器。
- 角色正文是第三方内容（MIT），只做 frontmatter 解析与去空白；不保证每个角色都适合你的业务。

## 许可

本包 MIT。角色库内容来自 [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh)（MIT），
归属与版本见 NOTICE-agency-agents-zh.md。