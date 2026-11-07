# 与 dsh-superagent 架构的对照

参考：https://github.com/deepseek-ai/dsh-superagent-prototype

## 结论

智能体之间的交互（成员 ↔ 成员、主管 ↔ 子智能体）采用同一套骨架，不再是一问一答的临时调用：

| superagent 概念 | 本插件的落点 | 状态 |
| --- | --- | --- |
| Executor / 持久 worker session | 每个成员固定 `childId = team-<memberId>` 复用同一个子会话，支持后续消息与冷恢复 | ✅ 2.78.0 |
| Assignment | 每次派发记一条 usage（成员、路由、结果、耗时），等价于 assignment 记录 | ✅ |
| Inbox | 忙时收到的消息写 `team-workbench/inbox.json`，本轮结束后自动续跑；运行中插话走 steer | ✅ 2.78.0 |
| Report | 子智能体结果作为报告回写会话，再由主管汇总（部门） | ✅ |
| Ticket / Mandate / Eval | 尚未引入：本插件面向对话，不按 Ticket 授权；选人等价于 Eval 的简化版（管理员决策 + 关键词兜底） | ⬜ |
| Thread / Subscription | 会话本身就是 Thread；成员只订阅自己参与的群聊 | ⬜（简化） |

## 明确不采用的部分

- **Ticket 授权模型**：需要人工审批链路，聊天场景过重；
- **Policy 版本化**：本插件用 settings/team.json 代替；
- **多 Source 接入**（GitHub / 飞书）：不在范围内。

## 关键实现位置

- 持久会话与 steer：`dsh/team.js` 的 `runOnRoute` / `steerActive`；
- 收件箱：`dsh/chat.js` 的 `enqueueInbox` / `takeInbox` / `settle`；
- 派发记录：`team-workbench/usage.json`。
