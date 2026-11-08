## Summary

长会话在 `deepseek-official` 上稳定返回 400，但界面只显示 `DeepSeek Messages request failed (400)`，**看不到供应商的真实报错**；同一会话同一请求换到 MiniMax 即可成功。交叉证据指向「上下文/Token 预算超限」，且 DSH 声明 `contextWindow = 1048576`，压缩阈值没有提前触发；400 又被归类为 `INVALID_REQUEST` 而不是 `CONTEXT_WINDOW_EXCEEDED`，因此不会触发溢出压缩重试。

## Reproduction

1. 用 `deepseek-official` 的模型（`deepseek-flash` 或 `deepseek-v4-pro`）持续对话，直到 prompt 约 290K tokens（或直接打开一个这样的长会话）。
2. 发送任意一条消息。
3. 观察 turn 失败：`DeepSeek Messages request failed (400)`，code `INVALID_REQUEST`，status 400。
4. 不切模型无法恢复；把同一会话切到 MiniMax（512K 上下文）后同一请求成功；上下文被压缩到约 175K 后 deepseek 也能成功。

## Current behavior

会话事件（`session.v4.jsonl.zstd`）中共 25 次 400，时间线与 token 用量如下（usage 取自 `assistant/message`）：

| 轮次 | 模型 | 结果 | prompt tokens（cacheRead + input） |
|---|---|---|---|
| 242 | deepseek-flash | ✅ | 288,512 + 299 = 289,495 |
| 243–245 | deepseek-flash | ❌ 400 | ~290K |
| 246 | deepseek-v4-pro | ✅ | ~175K（上下文缩小后） |
| 249–254 | MiniMax-M3 / M3.1 | ✅ | 300K–314K |
| 255–257 | deepseek-v4-pro | ❌ 400 | ~314K |

请求参数（来自 `request/header` 与 `request/context` 事件）：

```json
{
  "provider": "deepseek-official",
  "model": "deepseek-v4-pro",
  "maxTokens": 256000,
  "reasoningEffort": "high",
  "contextWindow": 1048576
}
```

失败事件只保留归一化后的错误：

```json
{"type":"turn/end","data":{"turn":257,"reason":{"kind":"error","error":{
  "message":"DeepSeek Messages request failed (400)",
  "code":"INVALID_REQUEST","status":400}}}}
```

适配器在缺少 `error.message` 时会走固定文案，导致供应商原始响应体不可见：

```js
const message = typeof error.message === "string"
  ? error.message
  : `DeepSeek Messages request failed (${status ?? "stream error"})`;
```

并且 400 被归为 `INVALID_REQUEST`：

```js
else if (status === 400 || status === 413 || type === "invalid_request_error") code = "INVALID_REQUEST";
else if (isContextWindowExceededError(detail)) code = "CONTEXT_WINDOW_EXCEEDED";
```

## Expected behavior

1. 400 时把供应商返回的 `error.message / type / code`（或原始 body）写进 failure / 日志，不要用固定文案吞掉。
2. 上下文超限应归类为 `CONTEXT_WINDOW_EXCEEDED`，并触发 overflow compaction / 重试，而不是当作普通 `INVALID_REQUEST`。
3. `contextWindow` 与实际服务端限制一致（或按实际剩余上下文裁剪 `max_tokens`），让压缩在超限前发生。

## Environment

- DSH Desktop 0.13.2（macOS 26.6.2 arm64）
- Harness `@deepseek-ai/dsh` 0.2.2-alpha.2
- Provider: `deepseek-official`（api.deepseek.com），模型 `deepseek-flash` / `deepseek-v4-pro`
- 会话：长会话，257 轮，约 314K tokens；同一请求在 MiniMax-M3（512K）上成功
- 复现不依赖具体插件：同一套工具/消息换 MiniMax 即成功

## Additional context

- 该会话内 `[llm-deepseek-api-key] model listing from https://api.deepseek.com/models loaded 2 model(s)`，模型元数据来源于官方列表；若列表声明的窗口大于服务端实际限制，就会出现「声明 1M、实际更小」的错配。
- 400 只发生在 DeepSeek；同会话 MiniMax 在 314K 上下文下正常，说明不是消息内容损坏或请求体过大（payload 约 0.6MB，图片 2 张共 335KB，且带图轮的 DeepSeek 请求在 238–242 轮是成功的）。
