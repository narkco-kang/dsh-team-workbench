# 与 dsh-superagent 架构的对照

参考：https://github.com/deepseek-ai/dsh-superagent-prototype

## 结论

现在**核心概念全部落地**，只是把「工作流域」翻译成「聊天域」：

| superagent 概念 | 本插件的落点 | 状态 |
| --- | --- | --- |
| Executor / 持久 worker session | 每个成员固定 `childId = team-<memberId>`，复用同一子会话，支持后续消息与冷恢复 | ✅ |
| Ticket | 用户每一条消息 = 一张工单（`tickets.json`），有开/结状态与报告 | ✅ 2.79.0 |
| Mandate | 用户消息本身即授权：记录发起人、范围（会话/成员）、所用策略版本、时间 | ✅ 2.79.0 |
| Eval | 开工前评估：停止词→关单、会话不在白名单→拒绝、策略停用→不可用、其余受理 | ✅ 2.79.0 |
| Assignment | 每张工单下每个成员的一次执行（成员、开始/结束、成败、耗时） | ✅ |
| Thread | 一个会话（群 id 或私聊成员 id）；工单挂在 Thread 上 | ✅ |
| Subscription | 群成员即订阅者：群消息 fan-out 给成员；私聊只给该成员 | ✅（简化） |
| Policy | `policy.json`，带版本号；工单记录受理时的版本，策略变更只影响之后开的新单 | ✅ 2.79.0 |
| Report | 成员结果回写工单，会话里显示最终答复 | ✅ |
| 幂等（Trigger 只受理一次） | 客户端带 `clientMessageId`，同一 id 重复到达只产生一张工单 | ✅ |
| 续单（人消息恢复已结束工单） | 同一 Thread 的新消息优先并入 open 单；已结束且未被叫停的单直接恢复，用原 Mandate | ✅ |
| 叫停（撤回 Mandate） | `停止/取消` 关闭该 Thread 未结束工单并标记 `stoppedByPerson`，之后不再恢复 | ✅ |
| 策略变更送达活单 | `savePolicy` 给 open 工单打 `policyNotice`，不撤销 Mandate | ✅ |
| 中断恢复 | 启动时把 running 的 assignment 标为 interrupted，下一次消息续上 | ✅ |
| Decision | 每次 Eval 判定（accept/stop/ignore/unavailable）落 `decisions.json`，含原因与策略版本 | ✅ 2.80.0 |
| Channel / Outbox | 每次回复送 `outbox.json`（channel、ticket、状态、失败原因） | ✅ 2.80.0 |
| Thread 读位点 | `threads.json` 记录每个会话处理到的工单与时间，重启不重放 | ✅ 2.80.0 |
| Source | `sources.json` 区分来源：chat.web / schedule.cron / agent.tool | ✅ 2.80.0 |

## 与它的差异（刻意保留）

1. **不阻塞等待审批**：它的 Ticket 需要人授权才开工；聊天里用户消息就是授权，所以 Mandate 直接由消息生成。
2. **Eval 是规则而不是模型评估**：聊天高频，逐条再跑一次模型评估不划算；规则（停止词/白名单/策略开关）足够覆盖。
3. **无常驻主会话通知**：它的 Notices 给主 Session 推送后台事件；我们直接把工单状态回写到会话气泡与 `/tickets` 接口。

## 接口

- `GET /api/team-workbench/tickets?threadKind=group&threadId=...` — 工单 + 当前策略
- `POST /api/team-workbench/tickets` — `{action:'close', id, report}` 或 `{action:'policy', patch:{...}}`

## 关键实现位置

- 工单/授权/评估/策略：`dsh/tickets.js`
- 持久会话与 steer：`dsh/team.js` 的 `runOnRoute` / `steerActive`
- 收件箱：`dsh/chat.js` 的 `enqueueInbox` / `takeInbox` / `settle`
- 派发记录：`team-workbench/usage.json`（assignment 遥测）
