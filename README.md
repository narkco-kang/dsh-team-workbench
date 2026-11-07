# dsh-team-workbench · 智能体团队工作台

一个 **DSH 网页客户端插件**（`dsh.client.platform = web`）：把具名智能体团队做成聊天应用。
**2.6.0 起默认收在右下角胶囊**，DSH 自己的会话与输入框照常可用；点胶囊才铺满窗口，
右上角「收起」再缩回胶囊。当前版本 **2.99.1**，在 **DSH Desktop 0.13.2**（macOS arm64）实测。

> 2.0.0 起不再是工作台（workbench）面板：客户端不调用 `desktopWorkbenches.register`，
> 改为挂载到 `document.body`，因此能盖住宿主导航——与 DS-Bot 的做法一致。
> 安装走**插件**渠道，不再出现在左侧「工作台」入口。
>
> **2.6.1**：聊天页打开即落在上次的会话（其次第一个群、第一个成员），输入框常驻，
> 不会再出现「页面里没有输入框」；照片头像读不出来时自动退回动态表情。

## 核心功能

**新手引导**
- 首次打开自动进入 10 步引导（欢迎 → 侧栏 → 输入框 → 记忆 → 团队 → 部门整理 → 角色库 → 记录 → 语音 → 完成），带聚光灯指向真实控件、自动切标签、支持 ←/→/Esc；
- 卡片里有 **「不再弹出」**：点一下立即关闭并记住，之后只有点右上角 **?** 才会再出现；
- 完成或跳过都不会自动再弹，开关状态存在 `localStorage: team-workbench:tour-v1`。

**总管台与主管**
- 总管台永远有一个 **★ 主管**：团队没有有效总管时，自动把第一位启用成员设为总管并**写回磁盘**；
- 这个主管**不能删除**：单删/批量删都会被服务端拒绝，并在界面弹出提示「请先把别的成员设为总管」；
- 总管台本身也不能删除（🔒），按钮会提示它是系统默认群。

**团队与模型**
- 团队页工具栏新增 **🗑 批量删除**：勾卡片左上角复选框 → 点一次显示「确认删除 N」→ 再点执行；
- 团队页删除改为**两段式内联确认**（点一次变「确认删除？」，5 秒内再点才删），不再依赖会被桌面端拦截的 `window.confirm`；
- 群聊也能拖：把一个群聊拖到另一个群聊 → 成员并入、消息接续、源群删除（`chats/rooms merge`）；
- 侧栏支持**拖拽**：把成员拖到群聊 → 加入该群；拖到部门（🏢）→ 变成该部门的子智能体；拖到另一个成员 → 两人组成新部门；
- 聊天侧栏工具栏新增 **👤 快捷新建智能体**（🧩 合并 · 🗑 批量删除 · 👤 新建 · ＋ 建群），建完直接进它的私聊。
- 每个成员 = 名字 + 职责 + 分组 + 头像 + 配色 + **一组可回退模型路由**（当前路由失败自动换下一条，试跑会显示回退轨迹）；
- 侧栏只显示「职称 + 3D 头像」，点头像进属性页做增删改查；🗑 进入**批量删除**，部门格子可整组勾选；
- 头像支持上传照片，并有**素材库**（按 sha256 去重、批量导入部分成功、一张图多处复用）。

**模型体检**
- 部门 AI 本身就是一个成员（侧栏显示 `🏢6` 角标），点头像进私聊；部门格子面板里也有 🎲 自动分配与 🧩 合并本部门；
- 团队页 🎲 自动分配模型：从宿主目录里挑**真实推理通过**的模型（最多 6 个），轮流分给部门子智能体并设置主管路由；
- 团队页 🩺 一键检测全部模型：**真实推理探测**（每个唯一 provider/model 发一句「只回复 ok」），失败即清理——成员路由删除、部门子智能体模型置空（角色保留），页面报告每个失败模型的原因；
- 部门子智能体没配模型时也能被识别出来（检测报告里会列出“未填 provider/model”）。

**部门 = 一个智能体**
- 角色库可按「整部门 = 1 个智能体」加入：部门内的角色变成它的**子智能体**（各带模型路由）；
- 派发链路：**主管（自己的模型）读任务 → 挑 1–4 个子智能体按职能分工 → 并行执行 → 主管汇总成一段答复**；
- 历史数据也能一键整理：🧩 合并所有 ≥2 人的部门（子智能体保留、私聊历史合并、群引用去重）。

**性能**
- 会话侧栏用**内存缓存 + 预取**：切标签会卸载/重挂聊天页，现在先用缓存渲染再后台刷新，切回来约 26ms 出列表，不再闪空白；
- 打开工作台时就会预取一次概览，第一次进聊天也不用等。

**对话**
- 每条回复下方有 DSH 式操作条：复制 / 👍 / 👎 / 引用 / 用量 tok / 时间；
- 你发出的消息也有 **⧉ 复制 / ✎ 重新编辑**，⌘⇧U 复制你最后一条消息；
- 会话快捷键：⌘⇧C 复制最后一条回复（无回复时复制最后一条消息）、⌘⇧U 复制你最后一条消息、⌘⌥C 复制整段会话、⌘J/⌘K 切下一/上一个会话、⌘E 记忆、⌘U 聚焦输入框。
- 输入框下方有 **token / 缓存命中率统计行**：轮/步、tok/s、总 token、缓存命中%（读宿主 session projcache，5s 刷新）；
- 输入框左上方有 **DSH 式思考条**：发送后显示「深度求索中，用时 N 秒」、「谁在思考」、已完成步骤（… ✓）与排队人数；
- 输入框对齐 DSH：多行自动撑高（60–280px）、**@ 补全**（输入 @ 列出可点名成员，↑↓ 选择、Enter/Tab 插入、Esc 关闭）、Enter 发送 / Shift+Enter 换行 / ⌘Enter 也发送、Esc 失焦、录音与发送按钮同排。
- 私聊带最近 12 条上下文；群聊支持**管理员先答 / 自动挑人 / 只回应 @**；
- `@` 接力最多 2 层（每条消息最多 5 个智能体回合、3 次点名）；**并行泳道**上限 3–5 自动或手填，超出排队并显示「排队 N 位」；
- 输入框上方实时显示「谁在思考 / 当前在做什么 / 已第几棒」。

**检索、记忆与语音**
- 记录页跨私聊/群聊检索，**命中词标黄**，按 **今天 / 昨天 / 更早** 分组；
- 分层记忆（见下）：L0 原始会话 → L1 原子事实 → L2 场景摘要 → L3 用户画像，混合召回注入提示词；
- 语音输入：本地 faster-whisper、OpenAI 兼容、智谱 GLM-ASR、MiniMax ASR（webm 自动转 mp3）；可选**模型校对**（术语表最小纠错，防改写护栏）。

## 架构

```
┌─ 浏览器（DSH Web 客户端插件）────────────────────────────────┐
│ lib/client.js  ← src/client/panel.js（单文件 bundle）          │
│   ├─ 胶囊 / 全窗口 App / 六个标签（聊天·团队·记录·额度·角色·技能）│
│   ├─ 聊天：左栏部门分组 + 私聊/群聊，右栏气泡、输入框、思考状态条    │
│   ├─ 团队：成员卡、模型路由、部门子智能体、头像素材库               │
│   └─ 3D 头像：20 个 SDF 投影角色（body/paints/shade/light + 挖空眼）│
└───────────────▲──────────────────────────────────────────────┘
                │ 同源 HTTP（/api/team-workbench/*，33 条路由）
┌───────────────┴─ 宿主侧（cordis 插件）────────────────────────┐
│ dsh/index.js  组合 team + chat + skills                        │
│  ├─ team.js    团队 store v3：成员/分组/路由/角色导入/预设/头像     │
│  │             工具：roster · dispatch · task（产出→审核→复核）    │
│  ├─ chat.js    会话存储、管理员与 @ 编排、并行泳道、部门派发        │
│  ├─ memory.js  L0–L3 记忆：原子事实 / 摘要 / 画像 / 混合召回       │
│  ├─ stt.js     语音：本地 stt / OpenAI 兼容 / GLM-ASR / MiniMax   │
│  └─ skills.js  共享技能库（5 个 skill_manager_* 工具）            │
└───────────────▲──────────────────────────────────────────────┘
                │ ctx.get('subagents') / agents / llm
┌───────────────┴─ DSH 宿主 ────────────────────────────────────┐
│ 子智能体运行时 · 模型目录 · 会话（每个成员一次激活、受控回退）      │
└──────────────────────────────────────────────────────────────┘
```

要点：
- **一次派发 = 一条路由链**：按「当前 → 其余启用」顺序尝试，失败带诊断回退，成功/拿到正文即停；
- **部门派发 = 主管 + N 个子智能体 + 汇总**，子智能体各自模型，互不共享上下文（只看分工与任务）；
- **并行**：群聊按 `maxParallel` 开泳道，超出排队；部门内部并行跑被挑中的子智能体；
- **持久化**：团队 `agent-team-studio/team.json`，会话 `team-workbench/chats.json`，记忆 `memory.json`，头像 `avatars/`，每次原子写 + 旧版本备份。

## 记忆系统

四层，越往下越“压缩、越可复用”，每层都可单独查看/删除（团队页「记忆」面板）：

| 层 | 存在哪 | 内容 | 何时写 | 怎么用 |
| --- | --- | --- | --- | --- |
| **L0** | `chats.json` | 原始消息（私聊/群聊） | 每条消息 | 取最近 12 条作为对话上下文 |
| **L1** | `memory.json → atoms` | 原子事实（谁、什么、何时、来源会话），带 key / importance / hits / confidence | 每 12 条新消息压缩一次，或手动「记住」 | 按当前问题召回最相关的 6 条注入提示词 |
| **L2** | `memory.json → summary` | 场景摘要（一段有界叙述，随新消息滚动更新） | 压缩时 | 作为系统提示的“前情提要” |
| **L3** | `memory.json → persona` | 用户画像（跨会话共享的偏好/约束/习惯） | 画像抽取时 | 全局注入，影响所有成员 |

召回是**混合检索**，不是只靠关键词：

1. **BM25**：中文按 bigram 切分，带停用词、同义词与 key 加权；
2. **向量**：余弦相似度（默认阈值 0.4，关键词命中才参与），用 Ollama `qwen3-embedding:0.6b`（1024 维），也可换任意 OpenAI 兼容 embedding；
3. **融合**：RRF（Reciprocal Rank Fusion，向量权重 1.3），向量缓存到 `memory-vectors.json`，避免重复计算；
4. **写入侧**：同一 key 的新事实会 **supersede** 旧事实而不是堆叠；压缩失败/超时不影响聊天。

设计取向：**L0 永不删**（除非你清空会话），L1/L2/L3 只是索引与摘要，删掉它们不丢原始对话；记忆面板里能逐条删除单条事实/画像。

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

2.99.1 是普通插件包（`dsh.bundle.patch` + `dsh.client.platform: web`），三种装法任选：

```bash
# 1) 官方 CLI（推荐；会把包名写进 dsh.profile.bundles）
DSH_HOME="$HOME/Library/Application Support/dsh-desktop/harness" \
  node "/Applications/DSH Desktop.app/Contents/Resources/app.asar/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  plugin --profile web add ./dsh-team-workbench-2.99.1.tgz

# 2) 从 Release 直链装
dsh plugin --profile web add \
  https://github.com/narkco-kang/dsh-team-workbench/releases/download/v2.99.1/dsh-team-workbench.tgz

# 3) 卸载
dsh plugin --profile web remove dsh-team-workbench
```

也可以打开 **设置 → 插件 → 安装**，填 npm 包名、GitHub 地址或 `.tgz` 直链。

装完**重启 Harness**（菜单 Harness → 重启 Harness），右下角会出现「🧑‍🤝‍🧑 智能体团队」胶囊；
点开就是团队 App，点右上角「收起」回到 DSH。1.x 是工作台包，同一个包名，
**先卸掉旧工作台再装 2.99.1**，否则两套入口会同时存在。

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
| 客户端注册与渲染 | `smoke-client.mjs`（结构 43 项）+ `render-client.mjs`（真实 React SSR 19 项） |
| 服务端注册与释放 | `smoke-server.mjs`（真执行 `apply()`，24 项：12 工具 / 33 路由、释放后登记表清空） |
| 工具 `execute` 与路由 handler | `run-tools.mjs`（临时 HOME 内真调用，45 项） |
| 会话功能 | `smoke-chat.mjs`（20 项：私聊连续追问、群聊 @、Auto 挑人、接力层数、工具调用、聊天记录检索） |
| 数据层功能 | `smoke-v12.mjs`（预设 15 人 6 组、角色导入、分组增删、角色检索与正文） |
| 工单域 | `tickets.test.mjs`（15 项：幂等 / 续单 / 叫停 / 策略送达 / 重启恢复 / Eval / 审计四表） |
| 本机平台接入 | `platforms.test.mjs`（6 项：扫描 / 首次接入 / 去重 / 能力清单 / 落库） |
| 工具契约 | `schema-guard.test.mjs`（2 项：成员字段必须全部在 MEMBER_SCHEMA 声明） |
| 子智能体入群 | `room-subs.test.mjs`（3 项：sub: 成员可建群 / 前缀保留 / 概览解析名字） |
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