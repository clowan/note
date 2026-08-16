# 26 · 深潜：六种 CLI 的适配实现与载体降级

> 这一篇覆盖 `packages/api/src/domains/cats/services/agents/providers/` 全目录（约 28,000 行）加上契约文件 `services/types.ts`。
> 解决的追问是："你说你把六种 CLI 统一成一个接口 —— 那接口长什么样？每种 CLI 的命令行到底怎么拼的？输出格式不一样怎么解析？Claude 那四种载体差在哪？"
> 值得读，因为设计层笔记（06-模块-Provider适配）只讲了"为什么要抽象"，这一篇讲的是**每个字段、每个正则、每个降级分支的真实代码**。

---

<!-- BEGIN ZERO-BASE EXPANSION 26 -->
## 0A. 零基础导读：Provider 层就是“统一插座 + 多种转接头”

> 上层只想说“调用这只猫并给我统一消息流”，但 Claude、Codex、Gemini、OpenCode 等 CLI 的参数、认证、输出和 session 方式不同。Provider 的工作是把差异封装在适配器后面。

### 0A.1 接口与实现

概念上可以理解为：

```ts
interface AgentService {
  invoke(prompt: string, options: InvokeOptions): AsyncIterable<AgentMessage>;
}
```

上层依赖接口，不依赖 `ClaudeAgentService` 的具体命令行。不同实现遵守同一契约：输入统一 options，输出统一 `AgentMessage`。

这叫依赖倒置/适配器模式：高层编排不应充满 `if provider === 'claude'`。

### 0A.2 统一接口不代表抹平所有能力

Provider 能力并不相同：有的支持 resume、system prompt、JSON stream、MCP、图片、thinking 或特定认证。合理设计是：

- 共同能力进入基础接口；
- 差异通过 capability/option 显式表达；
- 不支持时明确降级或报错；
- 不伪造“成功支持”。

最危险的是静默忽略关键 option，让上层以为安全规则或工作目录已生效。

### 0A.3 启动子进程的最小模型

```ts
const child = spawn(command, args, {
  cwd,
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
});
```

- `command/args`：执行文件和参数数组；不要拼一整条 shell 字符串。
- `cwd`：子进程工作目录。
- `env`：环境变量快照。
- `stdin/stdout/stderr`：输入、正常输出、错误输出管道。

参数数组比 shell 拼接更能避免转义和命令注入。对路径、模型名、MCP server name 等仍要校验。

### 0A.4 stdio、JSONL 与 PTY

- **stdio pipe**：适合机器协议，stdout/stderr 可分别解析。
- **JSONL**：一行一个 JSON 事件，易流式读取；但要处理半行、空行、超长行和坏 JSON。
- **PTY**：伪终端，适合 CLI 只有在交互终端才正确工作或输出控制序列的情况；代价是 stdout/stderr 边界更模糊、终端转义更复杂。

“载体”就是如何与 CLI 交互。选择载体不是 UI 细节，会影响稳定性、可解析性和取消方式。

### 0A.5 流解析为什么需要状态

一次 `data` 事件不保证正好是一行：

```text
chunk1: {"type":"te
chunk2: xt","value":"hi"}\n{"type"
chunk3: :"done"}\n
```

解析器要保留 buffer，只对完整分隔符前的内容 parse，结束时再处理尾巴。不能对每个 chunk 直接 `JSON.parse`。

然后把 Provider 原始事件转换为统一类型：text、thinking、tool、metadata、error、done。转换层还要保证终态只出现一次。

### 0A.6 stdout 与 stderr 不能简单等同成功/失败

很多 CLI 会把进度或 warning 写 stderr，但最终 exit code 为 0；也可能 stdout 有部分结果后进程非零退出。因此终态通常综合：exit code、signal、协议事件、解析错误、超时和取消原因。

同时要限制日志长度并脱敏，避免 stderr 把 token 或 prompt 全部带入日志。

### 0A.7 环境变量是高风险边界

Provider 会合并父进程 env、账号 env、代理、HOME 隔离和 MCP token。阅读时追：

1. 哪些变量从父进程继承；
2. 哪些被删除，防止串账号/串 base URL；
3. 哪些由 account 覆盖；
4. token 是否只对子进程可见；
5. debug 日志是否会打印完整 env。

环境变量优先级必须确定，否则同一配置在不同机器表现不同。

### 0A.8 HOME/配置隔离为什么必要

CLI 常从 `~/.claude`、`~/.codex` 等读取账号、session、hooks 和配置。多猫/多账号共用 HOME 可能串凭据、串历史和串 MCP。临时 HOME 或专属目录是在文件系统层隔离运行时身份。

清理隔离目录时必须验证路径，不能根据未经校验的 ID 递归删除；这与你的路径穿越与危险文件操作测试经验直接相关。

### 0A.9 session resume 的 Provider 差异

统一层说“恢复 session”，具体 CLI 可能是 `--resume id`、配置文件、transcript 查找或完全不支持。Provider 应负责把统一意图翻译成具体参数，并将“找不到 session”“session 已压缩”“工作区不匹配”归一为上层可判断的错误。

### 0A.10 超时与取消如何落到进程

```text
AbortSignal/timeout
→ Provider 停止读写
→ 请求子进程优雅退出
→ 必要时升级终止策略
→ 等待 close/exit
→ 关闭 parser/tailer/timer
→ 产出唯一终态
```

只调用 kill 而不等待 close，可能留下竞态；只停止消费 stdout 而不杀进程，会产生孤儿进程和费用。

### 0A.11 降级状态机

某种载体失败后切换另一载体，需要回答：哪些错误触发、冷却多久、成功后何时恢复首选、状态按 Provider/账号/机器还是全局保存。错误分类比“catch 后换方案”更重要：认证失败换载体通常无效，协议解析失败才可能适合切换。

### 0A.12 第一次源码陪读

```text
AgentService/AgentMessage 契约
→ 一个你最熟悉的 Provider 主类
→ command/args/env/cwd 构建
→ 流 parser/transform
→ session 提取与 resume
→ abort/timeout/finally
→ 再横向比较第二个 Provider
→ 最后读 PTY、降级和 transcript tailer
```

横向做表：认证、载体、session、system prompt、MCP、事件格式、取消方式、降级。

### 0A.13 安全测试清单

参数注入、恶意工作目录、环境变量串账号、代理变量污染、坏 JSONL、超长单行、ANSI 转义、stderr 泄密、子进程不退出、重复 done、resume 到其他仓库、临时目录路径穿越。

### 0A.14 面试回答模板

> “Provider 层用 `AgentService` 统一上层契约，把不同 CLI 的命令参数、认证、session、stdio/PTY 和事件格式封装为适配器。每个 Provider 把原始 JSONL/终端输出归一成 `AgentMessage` 流，并把 abort、超时真正落到子进程生命周期。统一接口不强行抹平能力差异，不支持项通过 capability 或明确降级表达。安全重点是参数数组、cwd/HOME 隔离、env 优先级和日志脱敏。”

### 0A.15 自测

1. 接口统一与能力完全一致有什么区别？
2. 为什么 data chunk 不能直接 `JSON.parse`？
3. stderr 为什么不等于失败？
4. HOME 隔离解决哪些串号风险？
5. 哪类错误适合载体降级，认证错误为何通常不适合？

---
<!-- END ZERO-BASE EXPANSION 26 -->


## 1. 文件地图与职责边界

### 1.1 全景：谁在哪一层

```
                        ┌──────────────────────────────────┐
                        │  services/types.ts               │  ← 契约层
                        │  AgentService / AgentMessage      │    (370 行)
                        │  AgentServiceOptions / TokenUsage  │
                        └───────────────┬──────────────────┘
                                        │ implements
   ┌────────────┬────────────┬──────────┼──────────┬────────────┬───────────┐
   │            │            │          │          │            │           │
Claude 家族    Codex       Gemini/AGY  OpenCode   Kimi        ACP 家族     其它
   │            │            │          │          │            │           │
claude-carrier CodexAgent   GeminiAgent OpenCode   KimiAgent   AcpAgent    A2AAgent
 -factory.ts   Service.ts   Service.ts  AgentSvc   Service.ts  Service.ts  Service.ts
   │ (291)      (1335)       (1569)     (605)       (450)       (632)       (117)
   ├─ ClaudeAgentService.ts        (957)  ← `-p` print 模式
   ├─ ClaudeBgCarrierService.ts    (709)  ← `--bg` 守护进程
   ├─ ClaudeInteractivePty...ts    (450)  ← tmux 交互 PTY
   └─ carrier-health.ts            (253)  ← 四层健康状态机
                                                            CatAgentService.ts (384)
                                                            ← 不走 CLI，直连 Anthropic API
```

### 1.2 按 provider 分组的文件清单

| Provider | 主服务文件 | 解析器 | 配置/辅助 |
|---|---|---|---|
| Claude `-p` | `ClaudeAgentService.ts` (957) | `claude-ndjson-parser.ts` (336)、`claude-mcp-status.ts` (83) | `claude-agent-win.ts` (5，纯 re-export) |
| Claude `--bg` | `ClaudeBgCarrierService.ts` (709) | `BgTranscriptEventConsumer.ts` (241)、`JobEventConsumer.ts` (179)、`TranscriptTailer.ts` (101) | — |
| Claude PTY | `ClaudeInteractivePtyCarrierService.ts` (450) | `HookSidechannelConsumer.ts` (117) | `pty/PtyDriver.ts` (355)、`pty/pty-utils.ts` (336)、`pty/hook-setup.ts` (126)、`AnchorEvalBridgeConsumer.ts` (215) |
| Claude 载体选择 | `claude-carrier-factory.ts` (291) | — | `carrier-health.ts` (253) |
| Codex | `CodexAgentService.ts` (1335) | `codex-event-transform.ts` (270) | `codex-audit-hooks.ts` (90)、`codex-session-context-snapshot.ts` (223)、`codex-image-scanner.ts` (65) |
| Gemini（三 adapter） | `GeminiAgentService.ts` (1569) | `gemini-event-parser.ts` (112)、`antigravity-cli-event-parser.ts` (159) | `agy-profile-manager.ts` (325)、`agy-trajectory-observer.ts` (704)、`agy-trajectory-extractor.ts` (297) |
| Antigravity IDE | `antigravity/AntigravityAgentService.ts` (2514) | `antigravity/antigravity-event-transformer.ts` (502) | `antigravity/AntigravityBridge.ts` (1772) + 20 个子模块 |
| OpenCode | `OpenCodeAgentService.ts` (605) | `opencode-event-transform.ts` (246) | `opencode-config-template.ts` (319)、`opencode-config-writer.ts` (176)、`opencode-mcp-injection.ts` (156)、`opencode-acp-spawn-config.ts` (119) |
| Kimi | `KimiAgentService.ts` (450) | `kimi-event-parser.ts` (114) | `kimi-config.ts` (401) |
| ACP（gemini/opencode/kimi 通用） | `acp/AcpAgentService.ts` (632) | `acp/acp-event-transformer.ts` (345) | `acp/AcpClient.ts` (877)、`acp/AcpHttpStreamClient.ts` (743)、`acp/AcpProcessPool.ts` (431)、`acp/acp-mcp-resolver.ts` (501)、`acp/types.ts` (252)、`acp/acp-session-env.ts` (75) |
| A2A（远程 HTTP agent） | `A2AAgentService.ts` (117) | `a2a-event-transform.ts` (79) | — |
| CatAgent（原生 API） | `catagent/CatAgentService.ts` (384) | `catagent/catagent-stream-parser.ts` (240) | `catagent-read-tools.ts` (223)、`catagent-event-bridge.ts` (174)、`catagent-tool-guard.ts` (94) |
| 跨 provider 共用 | — | — | `l0-compiler.ts` (278)、`env-map.ts` (167)、`image-cli-bridge.ts` (72)、`image-paths.ts` (53)、`generated-image-publication.ts` (96)、`transcript-path-hints.ts` (50) |

### 1.3 边界规则（读代码时最容易踩错的三条）

**边界一：`invoke()` 是异步生成器，永不 throw（除了两个例外）。**
所有 provider 的 catch 分支都是 `yield error` + `yield done`，不是 `throw`。
【源码】`ClaudeBgCarrierService.ts` 顶部注释写明原因：

```
砚砚 review guards integrated:
  1. state==='error' → yields type='error' then type='done' AgentMessage
     (does NOT throw — invoke-single-cat would convert iterator throw into
     duplicate error+done events)
```

两个例外：`ClaudeBgCarrierService.invoke()` 在 abort 和 timeout 时**确实 throw**（因为 `FallbackCarrierWrapper` 需要抓这个 throw 来做载体降级）。

**边界二：`session_init` 和 `done` 的生命周期归"载体"，不归"解析器"。**
【源码】`BgTranscriptEventConsumer.ts` 头注释：

```
Lifecycle separation (per砚砚 P1.1 review):
- `session_init` and `done` are NOT emitted by this module — caller
  (carrier) manages them across the streaming lifecycle. Otherwise
  file-tail increments would re-emit init/done per chunk (broken).
```

同样的约定写在 `HookSidechannelConsumer.ts` 头注释。

**边界三：解析器是纯函数，状态由调用方持有。**
`transformClaudeEvent(event, catId, streamState)` —— `streamState` 是调用方创建的对象。
`transformAcpEvent(update, catId, metadata, state)` —— `state` 由 `createAcpSessionState()` 创建。
【源码】`acp-event-transformer.ts` 头注释直接点名了这个约束：`砚砚 三审 watchpoint: no module-level Map`。

---

## 2. 核心数据结构

### 2.1 `AgentMessage` —— 统一契约（必须背下来）

位置：`packages/api/src/domains/cats/services/types.ts`。

#### 2.1.1 `type` 的 12 个取值

【源码】`AgentMessageType` 联合类型，注释是源码原文：

| `type` 值 | 语义 | 谁产生 | 下游怎么用 |
|---|---|---|---|
| `session_init` | 拿到了 CLI 的 session id | 每个 provider | 建/续 `SessionRecord` |
| `text` | 猫的正文回复 | 每个 provider | 变成聊天气泡 |
| `tool_use` | 工具调用开始 | 每个 provider | 工具时间线 |
| `tool_result` | 工具返回 | Codex / ACP / CatAgent / AGY | 与 `tool_use` 配对成 span |
| `error` | 出错 | 每个 provider | 红色气泡 + 恢复决策 |
| `done` | 本轮结束 | 每个 provider | 收尾、写 usage |
| `a2a_handoff` | 交棒给另一只猫（机器可读目标在 `targetCatId`） | A2A 路径 | 触发下一跳 |
| `system_info` | budget 警告 / 取消反馈 / 抽取进度 / thinking（注释原文：`budget warnings, cancel feedback, extraction progress, thinking`） | 每个 provider | 折叠面板、thinking 块 |
| `provider_signal` | F149：上游容量/重试信号。**被 invocation timeout 与 content flag 跳过** | `AcpAgentService` | 前端提示"服务端繁忙" |
| `liveness_signal` | F149：流空闲看门狗。同样被 timeout / content flag 跳过 | `AcpAgentService` | "已开始回复但停滞" |
| `status` | F198 Phase C：守护进程的瞬时进度。注释原文：`updates cat avatar tooltip, not a bubble` | `ClaudeBgCarrierService` | 头像 tooltip，不建气泡 |
| `agent_loop` | F153 Phase I：**只做遥测**的 LLM 调用边界标记。注释原文：`never user-visible` | `claude-ndjson-parser`（`message_stop`）、`opencode-event-transform`（`step_finish`） | `recordAgentLoop` 计数 + OpenCode 的 usage 载体 |

> **面试官追问："`provider_signal` 和 `error` 有什么区别？"**
> 「`error` 会被 invocation 当成失败、进入恢复链；`provider_signal` 和 `liveness_signal` 是 F149 加的两个"只报信不算失败"的类型 —— types.ts 的注释写得很直接：`skipped by invocation timeout & content flags`。意思是这两个消息不重置超时判定，也不算"这轮有内容产出"。典型场景是 ACP 从子进程 stderr 里嗅到 429，先给用户一个"服务端繁忙正在重试"的提示，但这轮还没失败。」

#### 2.1.2 `AgentMessage` 全字段表

【源码】逐字段（注释均为源码原文的中文化）：

| 字段 | 类型 | 为什么存在 |
|---|---|---|
| `type` | `AgentMessageType` | 见上表 |
| `catId` | `CatId` | 哪只猫产生的（多猫并发时必须） |
| `content?` | `string` | `text`/`tool_result` 的正文；`system_info` 里塞的是 **JSON 字符串**（约定，见 2.1.3） |
| `targetCatId?` | `CatId` | `a2a_handoff` 的机器可读目标 |
| `textMode?` | `'append' \| 'replace'` | 默认 append 保持流式语义；provider 给的是"完整修正快照"而不是纯后缀增量时用 replace。**唯一使用者是 AGY resume 路径** |
| `sessionId?` | `string` | `session_init` 携带 |
| `ephemeralSession?` | `boolean` | ACP 专用：sessionId 是 per-invocation 的，不是持久 CLI session。为 true 时"sessionId 变了"**不等于**"会话被换了" → 跳过封存 |
| `sessionLifecycle?` | `AntigravitySessionLifecycle` | F211 A2：provider 运行时生命周期事实，invocation 用它决定封存/新建 SessionRecord |
| `toolName?` | `string` | F153 Phase J AC-J1 要求必填（对 tool_use / tool_result） |
| `toolInput?` | `Record<string, unknown>` | 工具入参 |
| `toolUseId?` | `string` | **原生 provider 工具调用 id**，用来配对 tool_use↔tool_result 算真实耗时。注释点名了三种来源：Claude `tool_use.id`、CatAgent `tool_use_id`、Codex `item.id`。缺失时 `ToolSpanTracker` 按 KD-41 处理：不开 span、不造假耗时 |
| `toolResultStatus?` | `'ok' \| 'error' \| 'unknown'` | 结构化结果状态。注释要求 provider **必须**从原始载荷里映射（`is_error` / `success` / `exitCode` / `status`），而不是让下游从 content 字符串里猜。真的没有信号时才写 `unknown` |
| `toolTracing?` | `{traceId, spanId, parentSpanId?}` | 指向**工具 span 本身**（区别于下面的 `tracing` 指向 invocation span），供 hydrate 侧重建真实耗时 span |
| `error?` | `string` | 错误文案 |
| `isFinal?` | `boolean` | 多猫 invocation 里这是不是最后一个 `done` |
| `metadata?` | `MessageMetadata` | 见 2.2 |
| `origin?` | `'stream' \| 'callback'` | `stream` = CLI stdout（心声）；`callback` = MCP `post_message`（说话）。**这是"心声 vs 说话"两条通道的判别位** |
| `messageId?` | `string` | 后端存储的消息 id，rich_block 关联用 |
| `extra?` | `{crossPost?, targetCats?, isExplicitPost?}` | F52 跨 thread 来源元数据；`crossPost.effectClass` 取值 `'fyi' \| 'coordinate' \| 'investigate' \| 'assign_work'`（F246 Phase B，约束接收侧行为）；`isExplicitPost` 为 true 表示来自显式 `post_message` 回调而非 stream 重复 |
| `replyTo?` / `replyPreview?` | `string` / `ReplyPreview` | F121 引用回复 |
| `mentionsUser?` | `boolean` | F061：这条消息是否 @ 了共创者 |
| `invocationId?` | `string` | F108/F194 Z3：**链/父** invocation id（liveness / 队列 / 取消的传统真源） |
| `turnInvocationId?` | `string` | F194 Z3：**每猫每轮**的 invocation id，前端用它做气泡身份的 stable key（防同父多轮同猫气泡合并） |
| `tracing?` | `{traceId, spanId, parentSpanId?}` | F153-F：OTel span 上下文，落到 message 的 `extra.tracing` |
| `errorCode?` | `string` | F070 结构化错误码（例：`GOVERNANCE_BOOTSTRAP_REQUIRED`；ACP 侧还有 `init_failure` / `prompt_failure` / `model_capacity` / `mcp_pollution` / `stream_idle_stall` / `turn_budget_exceeded`） |
| `seq?` | `number` | F183 Phase C：thread 内单调序号，由 `SocketManager.broadcastAgentMessage` 从 `ThreadSequencer.next()` 打上。生产调用方留空 |
| `seqEpoch?` | `string` | F183 Phase C：sequencer 实例 UUID，API 启动时生成。客户端比对不一致 → 判定服务端重启 → 重置 lastSeq + 触发补齐 |
| `timestamp` | `number` | **唯一必填的非 type/catId 字段** |

> **面试官追问："为什么 `seqEpoch` 不能省？"**
> 「没有 epoch 的话，服务端重启后 sequencer 从 1 重新发号，而客户端的 `lastSeq` 还停在重启前的高水位。客户端会把新消息全判成"旧的/重复的"，直到服务端号发到追上高水位为止 —— 这段时间里 gap detection 是静默失效的。源码注释原文就是这个意思。」

#### 2.1.3 一个隐式约定：`system_info.content` 是 JSON 字符串

代码里没有类型约束，但所有 provider 都遵守 `JSON.stringify({ type: '...', ... })`。已知的 `type` 值（全部来自源码 grep）：

| `system_info.content.type` | 产生位置 |
|---|---|
| `thinking` | `claude-ndjson-parser`（thinkingBuffer / thinking block）、`codex-event-transform`（`item.type==='reasoning'`）、`opencode-event-transform`（`reasoning`）、`kimi`、`gemini`（本地 session 文件读出）、`acp-event-transformer`（`agent_thought_chunk` 聚合） |
| `timeout_diagnostics` | Claude / Codex / Gemini / OpenCode / Kimi（`isCliTimeout` 分支） |
| `liveness_warning` | 同上（`isLivenessWarning` 分支） |
| `silent_completion` | Claude / OpenCode / AGY |
| `malformed_toolcall_detected` | `ClaudeAgentService`（F215 form A） |
| `compact_boundary`（带 `preTokens`） | `claude-ndjson-parser` |
| `rate_limit`（带 `utilization` / `resetsAt`） | `claude-ndjson-parser` |
| `mcp_server_status`（带 `pendingMeaning: 'deferred_tool_loading'`） | `claude-ndjson-parser` + `claude-mcp-status.ts` |
| `carrier_fallback`（带 `from` / `to` / `reason` / `error`） | `FallbackCarrierWrapper` |
| `agy_trajectory_progress`（带 `idx` / `stepType` / `status` / `label`） | `GeminiAgentService` AGY 路径 |
| `task_progress`（带 `action:'snapshot'` + `tasks[]`） | `codex-event-transform`（`todo_list`） |
| `web_search`（只有 `count`，**不带 query，隐私**） | `codex-event-transform` |
| `warning` | `codex-event-transform`（item 级 error） |
| `rich_block`（带 `block` / `provenance`） | Codex 图片扫描、Codex MCP 图片 |
| `provider_capability`（带 `capability` / `status` / `reason`） | `KimiAgentService`（thinking / image_input 能力降级告知） |
| `plan` | `acp-event-transformer` |

> **面试官追问："为什么不给 `system_info` 定强类型？"**
> 「这是我会重做的地方之一 —— 现在是 `content: string` 里塞 JSON，靠约定。好处是加新类型不用改契约、不用改所有 provider 的编译；坏处是没有编译期保证，前端得 `JSON.parse` 再 switch。如果重来我会做成 discriminated union，把 `system_info` 拆成 `telemetry` / `diagnostic` / `thinking` 三个 type。」

### 2.2 `MessageMetadata` 与 `TokenUsage`

【源码】`MessageMetadata`：

| 字段 | 说明 |
|---|---|
| `provider` | 字符串，**不是枚举**。实际取值：`anthropic`（Claude -p）、`claude-bg`、`claude_interactive_pty`、`openai`（Codex）、`google`（Gemini/AGY）、`opencode`、`kimi`、`catagent`、`acp`（或 ACP variant 传进来的 providerName） |
| `model` | 实际跑的模型。AGY 路径会拼成 `"Gemini 3.1 Pro (High) (antigravity-cli profile)"` 这种带来源后缀的字符串 |
| `sessionId?` | CLI session id |
| `resumeSessionId?` | **bg 专用**。F198 Bug #3：bg 守护进程每轮 `--bg --resume` 都 fork 一个新的会话 UUID，这里把它透出去，consumer 存成 `SessionRecord.latestResumeSessionId`，下一轮当 `--resume` 目标。注释明确写 `bg-only; absent for other providers` |
| `usage?` | `TokenUsage` |
| `modelVerified?` | F061：provider 无法确认实际跑的是哪个模型时为 false（例：CDP bridge、AGY 未观测到 selected model label） |
| `diagnostics?` | `Record<string, unknown>`，`empty_response` 时挂的诊断上下文；bg 的 `terminalState` / `durationMs` / `transcriptEntries` 也走这里 |
| `upstreamError?` | F061 Phase 3：`{ kind: 'capacity'\|'network'\|'stream_interrupted'\|'invalid_tool_call'\|'unknown', transient: boolean, rawReason: string }` |
| `cliDiagnostics?` | F212 Phase A：结构化 CLI 错误诊断（`reasonCode` + 脱敏摘录 + `debugRef`），由 `cli-spawn` 的 `__cliError.cliDiagnostics` / `__cliTimeout.cliDiagnostics` 带过来 |

【源码】`TokenUsage` —— 关键在于**语义归一化**，注释原文：

```
/** F8: Unified token usage type across all three cats.
 *  inputTokens = TOTAL input tokens (new + cached). Normalised at extraction
 *  so that the field has the same semantics regardless of provider.
 *  cacheReadTokens = subset of inputTokens served from cache. */
```

| 字段 | 语义 | 哪个 provider 填 |
|---|---|---|
| `inputTokens` | **总输入**（新 + 缓存），跨轮累加 | 全部 |
| `outputTokens` | 输出 token | 全部 |
| `totalTokens` | Gemini 兜底（不分进/出） | Gemini / Kimi |
| `cacheReadTokens` | `inputTokens` 中来自缓存的子集 | Claude + Codex（+OpenCode `tokens.cache.read`） |
| `cacheCreationTokens` | 写入缓存的子集 | Claude only（+OpenCode `cache.write`） |
| `costUsd` | Claude 从 CLI 精确拿；Codex 用定价表估 | Claude / Codex / OpenCode |
| `costEstimated` | true = 来自定价表而非 CLI 上报 | Codex |
| `durationMs` / `durationApiMs` / `numTurns` | Claude 的总耗时 / 纯 API 耗时 / 轮数 | Claude 系 |
| `contextWindowSize` | F24：上下文窗口容量（Claude 精确，其它兜底） | 全部 |
| `lastTurnInputTokens` | **F24-fix：最后一次 API 调用的输入总量 = 真实上下文占用**。区别于跨轮累加的 `inputTokens` | 全部（各有各的取法） |
| `isCumulativeUsage` | #679：为 true 表示 `inputTokens`/`totalTokens` 是跨轮累计，**不能用于单轮 context fill 比率** | Gemini CLI stats |
| `contextUsedTokens` | Codex session `token_count` 给的精确当前占用 | Codex / Kimi |
| `contextResetsAtMs` | Codex 限额重置时间（epoch ms，仅展示） | Codex |

`mergeTokenUsage(existing, incoming)` 的算法【源码】：
- **累加**字段：`inputTokens` `outputTokens` `totalTokens` `cacheReadTokens` `cacheCreationTokens` `costUsd` `durationMs` `durationApiMs` `numTurns`
- **取最新快照**字段：`contextWindowSize` `lastTurnInputTokens` `contextUsedTokens` `contextResetsAtMs`
- **布尔覆盖**：`isCumulativeUsage` `costEstimated`

> **面试官追问："为什么要区分 `inputTokens` 和 `lastTurnInputTokens`？"**
> 「因为封存（seal）判定要的是"当前上下文填了多少"，而 `inputTokens` 是把这个会话所有轮的输入加起来的。一个 10 轮对话每轮输入 20k，`inputTokens` 是 200k，看起来爆了，但实际最后一轮的上下文可能只有 40k。`lastTurnInputTokens` 才是分子。Claude 的取法是从流式的 `message_start.usage` 里算 `input_tokens + cache_read + cache_creation`；Codex 是去读 `~/.codex/sessions/**/rollout-*.jsonl` 里最后一条 `token_count.info.last_token_usage.input_tokens`。」

### 2.3 `AgentServiceOptions` —— 逐字段 + 谁在用

【源码】`types.ts` 的 `AgentServiceOptions`：

| 字段 | 用途 | 哪些 provider 真的读了它 |
|---|---|---|
| `sessionId?` | 要 resume 的 session | 全部（各有各的 flag，见 §3） |
| `workingDirectory?` | 子进程 cwd | 全部。**AGY 是唯一例外**：cwd 走 sandbox，workingDirectory 只用来 `--add-dir` |
| `callbackEnv?` | 传给 CLI 的 MCP 回调认证 env | 全部。也是各种 `CAT_CAFE_*` 开关的载体（模型覆盖、profile mode、api key） |
| `accountEnv?` | F171：用户在账号配置里写的 env。注释原文：`Applied LAST to subprocess env — overrides provider-injected values` | Claude 三载体、Codex、Gemini、OpenCode、Kimi |
| `contentBlocks?` | 富内容块（图片） | Claude -p / PTY、Codex、Gemini、Kimi、Antigravity |
| `uploadDir?` | 解析图片路径的上传目录 | 同上 |
| `signal?` | 取消 | 全部 |
| `auditContext?` | `{invocationId, threadId, userId, catId}`，审计与 raw trace 关联 | Codex（`EventAuditLog` + rawArchive）、ACP（诊断日志） |
| `systemPrompt?` | 静态身份提示。注释原文：`Claude: --append-system-prompt, others: prepend to prompt` | 全部（Claude 走 `--append-system-prompt-file`，其余拼到 prompt 前） |
| `resumeFallbackSystemPrompt?` | 只有当"resume 的载体退化成新建会话"时才用的身份提示 | **只有 `AcpAgentService`**（`resumeSessionLoadFailed` 分支） |
| `spawnCliOverride?` | F089：用 tmux spawner 替换 `spawnCli` | Claude -p、Codex、Gemini（两条路径）、OpenCode、Kimi |
| `agyLogPathOverride?` | F210-H1b：覆盖 AGY `--log-file` 路径（trajectory 观测器的测试缝） | **只有 Gemini AGY 路径** |
| `invocationId?` | F118：给 `__cliTimeout` 做诊断增强 + rawArchive 路径键 | 全部走 `spawnCli` 的 |
| `cliSessionId?` | F118：同上 | 同上 |
| `livenessProbe?` | F118 Phase B。子字段：`sampleIntervalMs` / `softWarningMs` / `stallWarningMs` / `boundedExtensionFactor` / `minCpuGrowthMs` / `stallAutoKill`（#774：idle-silent 疑似卡死时直接杀，不等满超时）。**undefined = 关闭** | 全部走 `spawnCli` 的 |
| `cliConfigArgs?` | F127：成员编辑器里用户自定义的 CLI 参数 | Claude -p、Codex、Gemini（两条）、OpenCode、Kimi |
| `parentSpan?` | F153 Phase B：父 OTel span，用来建 CLI session 子 span | 全部走 `spawnCli` 的 |

### 2.4 `AgentService` 的四个能力探针

【源码】除了 `invoke()`，接口上有三个**可选**方法，全是给上层路由做决策的：

| 方法 | 默认 | 返回 true 的实现 | 含义 |
|---|---|---|---|
| `invoke(prompt, options)` | 必须 | — | 唯一必需方法 |
| `injectsL0Natively?()` | false | `ClaudeAgentService`、`ClaudeBgCarrierService`、`CodexAgentService`、`OpenCodeAgentService` | provider 把 L0 静态身份注入到**原生 system 角色**（Claude `--system-prompt-file`、Codex `-c developer_instructions`、OpenCode 的 `instructions` 数组）。为 true 时路由层只传 pack-only 的 `systemPrompt`（非 pack 身份走原生通道 = 抗压缩）；为 false/undefined 时路由层把完整静态身份留在 `params.systemPrompt` 里，靠拼到用户消息前面 |
| `usesChainKeyResume?()` | false | **只有 `ClaudeBgCarrierService`** | 这个载体 resume 的会话**没有稳定的 per-conversation sessionId**（bg daemon 每轮 fork 新 UUID）。为 true 时 `invoke-single-cat` 派生一个稳定的 `chainKey = bg:${threadId}:${catId}`，把 sessionId 解析、resume 互斥锁 key、session_init 记录复用、done 账目全部走这个 key —— 绕开会把一段对话膨胀成 N 条封存记录的 cliSessionId 路径 |
| `needsServerRoutingGuard?()` | false | **只有 `CodexAgentService`** | 这个载体跑在**不认 Claude Code F177-G Stop hook** 的宿主里（`codex exec --json` 不会派发 `~/.codex/hooks.json`，H0 spike 2026-06-11 实证）。为 true 时串行路由层加服务端兜底：当一轮结束却没有合法的路由出口时，内联补一次 remedial invoke |

`FallbackCarrierWrapper` 三个探针全是**代理**给当前活跃载体（`this.carrier.injectsL0Natively?.() ?? false`）。

另有一个 `L0InjectableAgentService extends AgentService`，多一个 `readonly l0CompilerFn?`，配套类型守卫 `hasL0CompilerSeam(service)`。**只有 `OpenCodeAgentService` 实现它** —— 注释解释：Claude/Codex 是自己内部编译 L0，生命周期不同。

> **面试官追问："为什么这三个探针是可选方法而不是必填？"**
> 「为了向后兼容：新增一个能力探针时，不用去改十几个 provider 的实现。代价是每个调用点都得写 `?.() ?? false`。`needsServerRoutingGuard` 的注释里还特别提了一条设计纪律：**不要**从 `injectsL0Natively()` 推导它 —— Codex 两者都是 true，但这俩能力是正交的，耦合了以后加新 provider 会错。」

### 2.5 载体健康状态机的数据结构

【源码】`carrier-health.ts`：

```ts
export type CarrierTier = 'bg_daemon' | 'interactive_pty' | 'print_sdk' | 'api_key';
export type FailureClass = 'quota' | 'structural' | 'transient';

export interface DegradedState {
  state: 'degraded';
  reason: FailureClass;
  since: number;      // 降级发生时刻
  retryAfter: number; // = since + TTL，过了就进"探测窗口"
}
export type HealthState = { state: 'healthy' } | DegradedState;
```

常量（全部是源码里的字面值）：

| 常量 | 值 | 注释里的理由 |
|---|---|---|
| `DEGRADATION_CHAIN` | `['bg_daemon','interactive_pty','print_sdk','api_key']` | D3：bg 是首选，api_key 是最后手段 |
| `QUOTA_TTL_MS` | `4 * 60 * 60 * 1000`（4 小时） | D1：配额是账号级的，一撞所有猫都被挡 |
| `STRUCTURAL_TTL_MS` | `30 * 60 * 1000`（30 分钟） | D1：二进制/配置问题可能在部署/重启后自愈 |
| `TRANSIENT_UPGRADE_THRESHOLD` | `3` | D1：连续 3 次 transient 升级成 structural |

### 2.6 bg 载体读的 `state.json`

【源码】`JobEventConsumer.ts` 的 `JobState` 和 `JobStateSnapshot`：

```ts
export type JobState = 'queued' | 'working' | 'done' | 'error' | 'idle' | 'failed' | 'blocked' | 'stopped';
```

注释里写了这个联合类型的血泪史：

```
F198 Phase D Bug #2 fix: `failed` / `blocked` / `stopped` were observed
in real `~/.claude/jobs/<id>/state.json` files (evidence: b67f7411=failed,
25d080fe=blocked) but were missing from this union — the carrier's
terminal check silently ignored them and hung to the 30-min timeout.
```

`JobStateSnapshot` 字段：`state` / `detail` / `needs`（blocked 时守护进程在等什么）/ `tempo` / `inFlight{tasks,queued,kinds}` / `output.result` / `sessionId` / `resumeSessionId` / `daemonShort` / `cwd` / `createdAt` / `updatedAt` / `linkScanPath`（关联的完整对话 transcript jsonl 路径）/ `worktree` / `worktreePath`。

---

<!-- BEGIN INLINE SOURCE EXPANSION 26-TYPES -->
### 2.8 从 `AgentServiceOptions` 到 CLI 参数：统一契约如何逐层翻译

调用层大致只做：

```ts
for await (const message of service.invoke(prompt, options)) {
  yield message;
}
```

真正复杂的是 options 到 Provider 参数的翻译。可以把字段分成五类：执行位置（workingDirectory、env）、会话（sessionId/resume）、输入载体（system prompt、附件、MCP）、控制（AbortSignal、timeout）、观测（invocationId、trace、raw archive）。每个 Provider 都必须明确支持、降级或拒绝，不能静默吃掉。

例如统一层传入 `sessionId`，Claude 可能转成特定 resume 参数，Codex 可能查自己的 session 目录，ACP/临时载体的 sessionId 甚至只在单次 invocation 有效。`AgentMessage.ephemeralSession` 就是在提醒上层：看到新的 sessionId 不一定意味着旧长期会话被替换，不能机械触发 seal。

输出归一化也不是把所有内容变成 text：

```text
Provider 原始事件
├─ 初始化/会话句柄 → session_init
├─ 增量正文/完整快照 → text + textMode
├─ 工具开始/结果 → tool_use/tool_result
├─ 上游限流与容量 → provider_signal
├─ 仅用于 idle watchdog → liveness_signal
├─ 临时进度 → status
└─ 结束事实 → done/error
```

若把 provider_signal 当正文活动，会错误延长“有内容”判定；若把 liveness_signal 丢掉，长时间思考可能被 idle timeout 误杀；若 status 保存成聊天气泡，UI 会被瞬时进度污染。统一消息类型实际上是在定义上层状态机。

命令构建要区分“值”和“参数结构”。模型名、目录、sessionId 应作为 args 数组元素；用户可配置的 extra args 必须经过 allow/deny 校验，防止覆盖系统注入的 `--cwd`、MCP 或输出格式。env 合并同样有顺序：父环境只是基线，隔离 HOME、删除污染变量、应用 auth/account、最后注入本次 callback token；顺序错了就可能串账号。

进入 §3 时选一个 Provider 画四条并行线：command/args 如何生成，env/cwd 如何生成，stdout 如何变 AgentMessage，abort 如何走到 child close。能完整画出一只，再横向比较其他 Provider，远比按文件名逐个背诵有效。

---
<!-- END INLINE SOURCE EXPANSION 26-TYPES -->

## 3. 主流程逐段拆解

### 3.1 Claude `-p` 载体（`ClaudeAgentService.invoke()`）

#### 3.1.1 命令行怎么拼

【源码】固定骨架（`args` 数组的字面顺序）：

```ts
const args: string[] = [
  '-p',
  '--output-format', 'stream-json',
  '--include-partial-messages',
  '--verbose',
  ...modelArgs,                       // ['--model', effectiveModel] 或 []
  '--effort', getCatEffort(catId, undefined, 'anthropic'),
  '--permission-mode', PERMISSION_MODE,           // = 'bypassPermissions'
  '--setting-sources', isApiKeyMode ? 'project,local' : 'project,local,user',
  '--chrome',
];
if (options?.sessionId) args.push('--resume', options.sessionId);
for (const dir of imageAccessDirs) args.push('--add-dir', dir);
// ...MCP 注入（见 3.1.3）...
args.push('--system-prompt-file', l0Path);
if (options?.systemPrompt) args.push('--append-system-prompt-file', appendPromptPath);
```

关键点：

- **prompt 不进 argv**。`cliOpts.stdinInput = effectivePrompt`。【源码】注释原文：

```
#840 R2 (砚砚 review 2026-06-02): the main prompt must NOT ride argv.
A2A briefings + memory + image hints push `effectivePrompt` past the
Windows CreateProcess 32K cap → spawn ENAMETOOLONG. ...
Side benefit: also prevents prompt content from leaking via
`ps -o command=` / /proc/<pid>/cmdline like the Codex carrier.
```

- **`--setting-sources` 依 profile mode 二选一**：api_key 模式排除 `user`（避免污染 `~/.claude/settings.json`）；subscription 模式包含 `user`（CLI 从那里读订阅认证）。
- **`--model` 可能被故意省略**：见 3.1.2。
- **`--chrome`**：源码注释 `Enable Chrome MCP integration (built-in, requires Chrome + extension running)`。

#### 3.1.2 模型选择：`resolveClaudeModelSelection()`

这是三个 Claude 载体共用的单一真源【源码】：

```ts
export function resolveClaudeModelSelection(callbackEnv, fallbackModel) {
  const effectiveModel = callbackEnv?.[ANTHROPIC_MODEL_OVERRIDE_KEY]?.trim() || fallbackModel;
  const isApiKeyMode = callbackEnv?.[ANTHROPIC_PROFILE_MODE_KEY] === 'api_key';
  const useEnvModelOverride = isApiKeyMode && !isKnownAnthropicModel(effectiveModel);
  return { effectiveModel, useEnvModelOverride };
}
```

- `ANTHROPIC_MODEL_OVERRIDE_KEY` = `'CAT_CAFE_ANTHROPIC_MODEL_OVERRIDE'`
- `ANTHROPIC_PROFILE_MODE_KEY` = `'CAT_CAFE_ANTHROPIC_PROFILE_MODE'`
- `isKnownAnthropicModel(m)` = `m.startsWith('claude-')`（就这一行）

**规则**：api_key 模式 + 非 Anthropic 模型（例：走 BigModel 代理的 `glm-5`）→ `useEnvModelOverride = true` → **必须省略 `--model`**，让 `ANTHROPIC_MODEL` 环境变量说了算。原因【源码注释】：`the CLI's --model flag wins over ANTHROPIC_MODEL env`，不省略就会静默覆盖代理路由的模型。

#### 3.1.3 env 构造：`buildClaudeEnvOverrides()`

三个 Claude 载体共用【源码】。步骤：

1. 从 `callbackEnv` 拷贝一份
2. `env.CLAUDECODE = null; env.CLAUDE_CODE_ENTRYPOINT = null`（`null` 在 `spawnCli` 里的语义是"从继承的 process.env 中删除这个 key"）
3. Windows：`env.CLAUDE_CODE_GIT_BASH_PATH = findGitBashPath()`
4. `mode === 'api_key'` 分支：
   - `ANTHROPIC_API_KEY` ← `CAT_CAFE_ANTHROPIC_API_KEY`
   - `ANTHROPIC_BASE_URL` ← `CAT_CAFE_ANTHROPIC_BASE_URL`，但**先剥掉尾部 `/v1`**：`baseUrl.replace(/\/v1\/?$/, '')`。理由【源码注释】：Claude CLI 内部会自己拼 `/v1`，用户配了带 `/v1` 的就会变成 `/v1/v1`，而且会触发 CLI 去打 `/v1/models` 做模型校验（很多代理不支持这个端点）
   - 非 Anthropic 模型时设 `ANTHROPIC_MODEL`
5. `mode === 'subscription'` 分支：把 `SUBSCRIPTION_MODE_DENY_KEYS` 全部置 `null`

`SUBSCRIPTION_MODE_DENY_KEYS`（#883，源码字面值）：

```ts
['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL',
 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL']
```

**应用顺序（考点）**【源码 `invoke()` 里的三段）：

```
① envOverrides = buildClaudeEnvOverrides(callbackEnv)
② for (k,v of accountEnv) envOverrides[k] = v          ← F171：用户 env 覆盖 provider 注入
③ if (mode === 'subscription') for (key of DENY_KEYS) envOverrides[key] = null   ← #883：deny-list 必须活过 accountEnv
```

第 ③ 步的注释原文：`Account-level env (e.g. ANTHROPIC_AUTH_TOKEN from a proxy profile) could re-introduce the proxy token that buildClaudeEnvOverrides cleared.`

> **面试官追问："为什么 accountEnv 要放在最后，又要在它后面再补一次 deny-list？这不是自相矛盾吗？"**
> 「不矛盾，是两条正交的规则叠加。F171 的意思是"用户配的 env 优先级最高"；#883 的意思是"订阅模式下绝不能有 API key 类凭证泄漏到 api.anthropic.com"。后者是安全不变量，优先级高于前者。所以顺序是：provider 注入 → 用户覆盖 → 安全 deny-list 兜底。deny-list 只有 7 个 key，用户想改别的照样能改。」

#### 3.1.4 MCP 注入（`#712` 的 invoke-time 注入）

触发条件：`options?.callbackEnv && this.mcpServerPath` 同时存在。步骤【源码】：

1. `distDir = dirname(mcpServerPath)`，`binaryProjectRoot = resolve(distDir, '../../..')`
2. 建 `catCafeEnvEntries`：先塞 `ALLOWED_WORKSPACE_DIRS`（由 `resolveMcpWorkspaceRoot()` 决定，优先级：`process.env.ALLOWED_WORKSPACE_DIRS` > `workingDirectory` > `process.env.CAT_CAFE_WORKSPACE_ROOT` > `process.cwd()`），再把 `MCP_CALLBACK_ENV_KEYS` 里有值的抄过来
3. 读 capabilities.json：**F249 项目优先** —— 先读 `<workingDirectory>/.cat-cafe/capabilities.json`（`accessScope='project'`），读不到再读 `<capabilitiesProjectRoot>/.cat-cafe/capabilities.json`（`accessScope='global'`）。只接受 `version === 1 || version === 2`
4. `resolveServersForCat(capConfig, catId, {accessScope})` 逐条转换：
   - `source === 'cat-cafe'` 且名字在 `CAT_CAFE_SPLIT_ENTRYPOINTS` 里 → `{command: resolveCatCafeNodeCommand(), args: [distDir/<entrypoint>], env: catCafeEnvEntries}`
   - `resolver === 'pencil'` → `await resolvePencilCommand({projectRoot})`
   - `transport === 'streamableHttp' && url` → `{type:'http', url, headers?}`
   - 其它有 `command` → `{command, args, env?, cwd?}`
5. 合并用户的 `<workingDirectory>/.mcp.json`：只收**不被 capabilities 管理**的条目（用 `expandManagedMcpNamesForUserMerge()` 展开排除集），我们的条目永远优先
6. **Windows 特判**：Claude CLI 在 Windows 上把内联 JSON 当成文件路径 → 写到 `mkdtemp('cat-cafe-mcp-')` 的临时文件，`args.push('--mcp-config', filePath)`；POSIX 直接 `args.push('--mcp-config', JSON.stringify({mcpServers}))`
7. 无论哪种，最后 `args.push('--strict-mcp-config')`

`CAT_CAFE_SPLIT_ENTRYPOINTS`（源码字面 Map）：

```
cat-cafe-collab   → collab.js
cat-cafe-memory   → memory.js
cat-cafe-signals  → signals.js
cat-cafe-limb     → limb.js
cat-cafe-audio    → audio.js
cat-cafe-finance  → finance.js
```

`MCP_CALLBACK_ENV_KEYS`（源码字面数组）：

```
CAT_CAFE_API_URL, CAT_CAFE_INVOCATION_ID, CAT_CAFE_CALLBACK_TOKEN,
CAT_CAFE_USER_ID, CAT_CAFE_CAT_ID, CAT_CAFE_THREAD_ID,
CAT_CAFE_SIGNAL_USER, CAT_CAFE_RUN_TYPE, CAT_CAFE_AUDIT_TOPIC
```

#### 3.1.5 用户自定义参数的去重算法

【源码】`ClaudeAgentService.invoke()` 里这段（Gemini / Kimi 也是同一份逻辑的拷贝）：

```ts
const accumulativeFlags = new Set(['--add-dir']);
const userFlags = new Set(userParts.filter((p) => p.startsWith('-')));
const deduped: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('-') && userFlags.has(args[i]) && !accumulativeFlags.has(args[i])) {
    if (i + 1 < args.length && !args[i + 1].startsWith('-')) i++;   // 连值一起吃掉
    continue;
  }
  deduped.push(args[i]);
}
args.length = 0;
args.push(...deduped, ...userParts);
```

规则：用户 flag 与系统 flag 冲突 → **删掉系统的那一对（flag + 值）**，用户的追加在最后。`--add-dir` 在 `accumulativeFlags` 里，属于"可累加"，不删。

但**保留字段不许被覆盖**：`stripReservedSystemPromptArgs()` 会先把用户 args 里的 `--system-prompt-file` / `--system-prompt` / `--append-system-prompt` / `--append-system-prompt-file`（`RESERVED_SYSTEM_PROMPT_FLAGS`）剔掉并 `log.warn`。理由【源码注释】：`user overrides would silently remove the compression-immune identity/governance layer`。

#### 3.1.6 NDJSON 解析：`transformClaudeEvent()`

分支顺序（源码里的 if 顺序，就是判定优先级）：

```
1. e.type === 'stream_event'  → 拆 e.event.type：
     message_start      → 记 currentMessageId；重置 lastTurnInputTokens；
                          算 total = input_tokens + cache_read + cache_creation，>0 才记
     message_delta      → 只在 lastTurnInputTokens 还没值时补算（有些网关 message_start 里是 0）
     message_stop       → 清 currentMessageId，返回 { type:'agent_loop' }   ← 唯一产地
     content_block_start(thinking) → thinkingBuffer = ''
     content_block_delta:
         thinking_delta   → thinkingBuffer += d.thinking，返回 null
         signature_delta  → 忽略
         text_delta       → 把 currentMessageId 记进 partialTextMessageIds，返回 { type:'text' }
     content_block_stop → thinkingBuffer 非空则吐 system_info{type:'thinking'}
2. type==='system' && subtype==='init'  → session_init（+ 可能追加 mcp_server_status）
3. type==='system' && subtype==='compact_boundary' → system_info{type:'compact_boundary', preTokens}
4. type==='assistant' → 遍历 message.content 块：
     text 块（且该 messageId 不在 partialTextMessageIds 里）→ text
     tool_use 块 → tool_use（带 toolUseId = b.id）
     一个都没有但有 thinking 块 → system_info{type:'thinking'}   ← #778 安全网
5. type==='rate_limit_event' → system_info{type:'rate_limit', utilization, resetsAt}
6. isResultErrorEvent(e) → error
7. 其余（result/success、system/hook）→ null
```

**去重机制（考点）**：开了 `--include-partial-messages` 后，同一段文字会以 `text_delta` 流式来一遍，再在 `assistant` 事件里以完整 text 块来一遍。解决办法是 `partialTextMessageIds: Set<string>` —— 流式时把 messageId 加进去，`assistant` 事件里 `skipFinalText = partialTextMessageIds.has(messageId)` 就跳过最终文本，处理完再 `delete`。

`isResultErrorEvent(e)` 的判定就一行【源码】：

```ts
return e.type === 'result' && (e.is_error === true || e.subtype !== 'success');
```

错误文案兜底表 `subtypeLabels`【源码】：`error_max_turns` → `Max turns exceeded`；`error_max_budget_usd` → `Budget limit reached`；`error_during_execution` → `Execution error`；`error_max_structured_output_retries` → `Structured output retries exceeded`；`success` → `Claude result error`。都没匹配上就是 `Agent error (${subtype})` 或 `Unknown error`。

#### 3.1.7 Claude stream-json 真实样本【推断，从 parser 反推】

```jsonl
{"type":"system","subtype":"init","session_id":"3f9a...-...","mcp_servers":[{"name":"cat-cafe-collab","status":"connected"}]}
{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_01ABC","usage":{"input_tokens":120,"cache_read_input_tokens":34000,"cache_creation_input_tokens":0}}}}
{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"用户想让我…"}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"Eq0B…"}}}
{"type":"stream_event","event":{"type":"content_block_stop","index":0}}
{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"好的，"}}}
{"type":"assistant","message":{"id":"msg_01ABC","content":[{"type":"text","text":"好的，我先看一下。"},{"type":"tool_use","id":"toolu_01X","name":"Read","input":{"file_path":"/a/b.ts"}}]}}
{"type":"stream_event","event":{"type":"message_stop"}}
{"type":"rate_limit_event","utilization":0.82,"resets_at":"2026-07-26T14:00:00Z"}
{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0.0431,"duration_ms":18230,"duration_api_ms":15120,"num_turns":3,"usage":{"input_tokens":120,"output_tokens":880,"cache_read_input_tokens":34000,"cache_creation_input_tokens":0},"modelUsage":{"claude-opus-4-6":{"contextWindow":200000}}}
```

注意 `modelUsage` 的兼容写法【源码】：`(e.modelUsage ?? e.model_usage)` —— 注释说明 Claude stream-json 在不同版本里两种拼法都出现过。

#### 3.1.8 结束后的两个"体检"

**F215 malformed tool-call（form A：thinking-only）**【源码】：

```ts
const isMalformedToolCall =
  hasAssistantEvent && !lastAssistantHasToolUseBlock && !lastAssistantHasTextBlock && !sawResultError;
```

三个标志的维护方式很讲究：`hasAssistantEvent` 全局累积；`lastAssistantHasToolUseBlock` / `lastAssistantHasTextBlock` **每遇到一个 `assistant` 事件就重置再重算**（per-turn）。为什么不用 `textEventCount`？源码注释给了完整推理：

```
textEventCount (global) is polluted by earlier turns; per-turn counters break under streaming
(--include-partial-messages) because text_delta arrives BEFORE the assistant event, then
transformClaudeEvent suppresses the final assistant text — resetting a per-turn counter at
assistant-event time would erase those already-counted streaming text events (AC-B5 fix).
Content blocks are present in both streaming and non-streaming modes regardless of event order,
so they are the only reliable source.
```

命中后先 yield `system_info{type:'malformed_toolcall_detected', form:'A'}`（给 invoke-single-cat 做封存 + 降级链），再 yield 一条**显式炸毛 error**：

```
malformed_toolcall: Opus 炸毛了——thinking-only 输出，无 tool_use / text block，系统已触发恢复流程
```

**F212 Phase G silent_completion**【源码】条件：

```ts
eventCount > 0 && textEventCount === 0 && !errorAlreadyYielded
  && !(hasAssistantEvent && lastAssistantHasToolUseBlock)
```

最后一个条件是 R1 P1 补的：纯 tool_use 轮是合法完成（F215 AC-B3），不该报 silent。诊断通过 `buildSilentCompletionDiagnostic({command, invocationId, eventCount, eventTypes, model, sessionId, stderrPresent, stderrExcerpt})` 构造，挂在 `metadata.cliDiagnostics`。

#### 3.1.9 thinking signature 损坏的救援

【源码】两个函数：

```ts
function isInvalidThinkingSignatureMessage(message) {
  return /Invalid [`'"]?signature[`'"]? in [`'"]?thinking[`'"]? block/i.test(message);
}
function formatThinkingSignatureRescueError(sessionId) {
  const command = sessionId
    ? `pnpm rescue:claude:thinking -- --session ${sessionId}`
    : 'pnpm rescue:claude:thinking -- --all-broken';
  return ['Claude CLI: 检测到损坏的 thinking signature，当前会话无法 --resume。',
          `请先在仓库根目录运行 ${command}，再重试。`].join(' ');
}
```

两个触发点：`isCliError(event)` 且 `event.reasonCode === 'invalid_thinking_signature'`；以及 `result/error` 事件的文案命中正则。

---

### 3.2 Claude `--bg` 载体（`ClaudeBgCarrierService`）

#### 3.2.1 它存在的理由（一句话）

【源码】文件头注释：

```
Goals vs the legacy `claude -p` ClaudeAgentService:
  - Avoid the `-p` flag → claude binary no longer self-sets
    CLAUDE_CODE_ENTRYPOINT=sdk-cli (KD-9 + spike empirically confirmed)
  - Consume jsonl event stream from ~/.claude/jobs/<short>/ instead of stdout NDJSON
  - 客户端层证据指向走订阅 quota；服务端 billing 仍 pending
```

#### 3.2.2 `startJob()`：拿 shortId

```
① compileL0ToTempFile()  → mkdtemp('cat-cafe-l0-')/system-prompt-l0.md（失败抛 CarrierError）
② callbackEnvWithMode = { CAT_CAFE_ANTHROPIC_PROFILE_MODE: 'subscription', ...callbackEnv }
   envOverrides = buildClaudeEnvOverrides(callbackEnvWithMode)
   + accountEnv 覆盖
   + subscription deny-list
   + 强制 CLAUDE_CODE_ENTRYPOINT = null; CLAUDECODE = null   ← AC-B6 不变量，最后一道
③ args = useEnvModelOverride ? ['--bg'] : ['--bg','--model',effectiveModel]
   args.push('--system-prompt-file', l0Path)
   if (sessionId 是合法 UUID) args.push('--resume', sessionId)
   if (systemPrompt) args.push('--append-system-prompt-file', <临时文件>)
   args.push('--permission-mode','bypassPermissions')
   if (callbackEnv && mcpServerPath) args.push('--mcp-config', ..., '--strict-mcp-config')
④ spawn(claude, args, {cwd, env, stdio:['pipe','pipe','pipe'], signal})
   childStdin.write(prompt); childStdin.end()      ← prompt 走 stdin（#840 R2）
⑤ child.on('close', code):
     code !== 0             → CarrierError(`claude --bg exited code=${code}: ${stderr.slice(0,300)}`)
     SHORT_ID_PATTERN 不匹配 → CarrierError(`Could not parse short id from claude --bg stdout: ...`)
     否则 resolve({shortId, consumer: new JobEventConsumer(shortId), effectiveModel})
```

两个正则【源码字面】：

```ts
const SHORT_ID_PATTERN = /backgrounded\s*·\s*([a-f0-9]{8})/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

`UUID_PATTERN` 的存在理由【源码注释】：`claude --bg --resume <id>` 要的是完整对话 UUID，把 8 位 hex 的 shortId 传进去会让 daemon 报错。

**bg 的 MCP 注入是"简版"**：只注入一个 `cat-cafe` 服务（`{command: resolveCatCafeNodeCommand(), args: [mcpServerPath]}`），不读 capabilities.json —— 与 `-p` 载体的全量注入不对等。Windows 的临时文件是**每实例复用**（`this.mcpConfigFilePath`），不每次重写。

还有一条运维坑写在注释里：`--strict-mcp-config` **不能**绕过 daemon 模式的 `.mcp.json` 审批 UX 门 —— 新项目第一次调用需要人工 `claude attach <shortId>` → 批准一次，之后才免提示。注释明确定性：`Document as canary deploy step, not code bug`。

#### 3.2.3 `invoke()` 的轮询循环

常量：`pollMs` 默认 500，`timeoutMs` 默认 `30 * 60_000`（30 分钟）。

```
yield session_init(sessionId = shortId, provider='claude-bg')
while (Date.now() < deadline):
  ① signal.aborted → bestEffortStop(shortId) + throw
  ② state = await consumer.readState()          （读 ~/.claude/jobs/<short>/state.json）
  ③ state.detail 变了且状态非终态 → yield { type:'status', content: detail }   （按字符串相等去重）
  ④ state.linkScanPath 首次出现 → tailer = new TranscriptTailer(linkScanPath)
  ⑤ tailer.readNew() → accumulateUsageFromEntries + yieldFromTranscript
       读失败：终态 → tailer = undefined（优雅降级）；非终态 → bestEffortStop + throw
       扫到 system/turn_duration → transcriptTerminal = true
  ⑥ stateTerminal = state ∈ {done, error, failed, blocked, stopped}
     stateTerminal || transcriptTerminal → 进终结分支
  ⑦ await sleep(pollMs)
终结分支：
  最后一次 readNew({includeTrailingPartial:true}) 收尾
  fallback：state==='done' 且 output.result 非空 且 trim(lastAssistantText) !== trim(result) → yield text
  state ∈ {error, failed} → yield error(detail)
  state === 'blocked'     → yield error(needs ?? detail ?? 'claude --bg job blocked')
  yield done（带 resumeSessionId / usage / diagnostics）
超时：bestEffortStop(shortId) + throw
```

**`bestEffortStop()`** 就是 `spawn(claude, ['stop', shortId], {stdio:'ignore'})` + `child.unref()` + 吞掉所有错误。目的【源码注释】：`so the detached --bg session stops consuming quota instead of leaking until natural completion`。

#### 3.2.4 那个"最终答案会不会重复"的判定（很值得讲）

【源码】关键变量 `lastAssistantText`：遍历新 entries 时，每遇到一个 `type==='assistant'` 就**重置**为该条 entry 所有 text 块的拼接（哪怕是空串）。终态时：

```ts
const transcriptCoversResult = lastAssistantText.trim() === resultText.trim();
if (!transcriptCoversResult) yield { type:'text', content: resultText };
```

为什么是**严格相等**而不是 `includes`？【源码注释】：

```
Why not includes/endsWith: round-3 used `transcriptText.includes(result)`
but `"I will verify SPIKE_OK".includes("SPIKE_OK")` falsely matches when
result is a substring of EARLIER text — final answer would be silently lost.
```

代价是有极端情况会重复一次文本，注释里明说这是可接受的权衡：`get a duplicate text rather than silent loss`。

#### 3.2.5 transcript → AgentMessage：`BgTranscriptEventConsumer`

核心思路是**复用** `-p` 的解析器：transcript 里的 `assistant` 条目形状与 `-p` NDJSON 的 `assistant` 事件**完全一致**，所以直接喂给 `transformClaudeEvent`。

一个专门的过滤【源码】：

```ts
if (msg?.model === '<synthetic>') {
  const text = content?.find(c => c.type === 'text')?.text ?? '';
  if (text.startsWith('API Error:') || text.startsWith('Error:')) out.push({type:'error', error:text});
  continue;   // "No response requested." 之类静默丢弃
}
```

理由【源码注释】：Claude CLI 会在本地合成 assistant 条目，两种情况 ——「No response requested.」（零 API 调用零 token）和「API Error: …」（ECONNRESET 网络抖动，CLI 把它伪装成一条回复）。这两种**绝不能**变成猫的聊天气泡。

`system/turn_duration` 和 `system/stop_hook_summary` **都跳过不产生消息**。`turn_duration` 曾经被当成 `system_info` 吐出去，导致 PTY 路径出现"蓝色原始 JSON 气泡"回归（F230）。注释解释得很完整：`-p` 基线里 `transformClaudeEvent` 对 `turn_duration` 也什么都不吐，所以跳过它恰好恢复了 bg/PTY ⇄ `-p` 的对等性。

**usage 累加器**（`UsageAccumulator`）设计要点【源码注释】：字段是 `number | undefined` 而不是从 0 开始 —— `undefined` 表示"从未观测到"，`0` 表示"观测到就是 0"。从 0 开始会给遥测灌一堆假的 `outputTokens: 0`。终结时 `finalizeTranscriptUsage()` **造一个合成的 `result/success` 事件**再喂给 `extractClaudeUsage()`，为的是不重复实现归一化算术（"真复用，不是复制规则"）。

`done` 里挂 usage 的门槛是 `usageAcc.assistantTurnCount > 0` —— **不**要求 `tailer` 当前还存在。注释解释：如果流式期间已经观测到 usage，终结时 drain 失败让 tailer 降级成 undefined，丢掉 usage 会污染成功调用的成本遥测。

---

### 3.3 Claude 交互 PTY 载体（`ClaudeInteractivePtyCarrierService`）

#### 3.3.1 整体架构（F230 B-hook）

```
Node 进程                          tmux                        claude TUI
   │                                │                              │
   │ tmux new-session -d -s <name>  │                              │
   │   -c <cwd> -e KEY=VAL...       │──── env -u X -u Y 'claude' ──▶│ 启动
   │                                │                              │
   │ 轮询 list-panes 直到 pane alive │                              │
   │ sleep(readyGraceMs=15s)        │                              │
   │ capture-pane -p → 检测          │                              │
   │   "bypassPermissions" 确认屏     │─── send-keys Down, Enter ───▶│ 选 "2. Yes, I accept"
   │                                │                              │
   │ load-buffer -b f230-<name> <f> │                              │
   │ paste-buffer -b .. -p -t <s>   │─────── 括号粘贴 ────────────▶│ prompt 进输入框
   │ sleep(max(2, len/15000) 秒)     │                              │
   │ send-keys -t <s> '' Enter      │──────────────────────────────▶│ 提交
   │                                │                              │
   │                          claude 执行 Stop / PostToolUse hook  │
   │                                │                              ▼
   │◀──── TranscriptTailer 轮询 ──── <tmp>/f230-hook-*/hook-events.jsonl
   │        (hook-capture.sh 追加)
```

**输出面（output face）不是 stdout，也不是 transcript，而是 hook 旁路。** 原因【源码注释】：`Required for claude 2.1.172+ where interactive TUI no longer writes transcripts.`

#### 3.3.2 hook 旁路怎么装起来：`setupHookInfrastructure(cwd, sidecarPath)`

三步【源码】：

1. 在 `<cwd>/.claude/hook-capture.sh` 写一个 POSIX sh 脚本（`chmod 0o755`）：

```sh
#!/bin/sh
input=$(cat)
if [ -n "$input" ] && [ -n "$CAT_CAFE_HOOK_SIDECAR" ]; then
  if [ -n "$CLAUDE_CODE_ENTRYPOINT" ]; then
    input=$(printf '%s' "$input" | sed 's/}$/,"_cc_entrypoint":"'"$CLAUDE_CODE_ENTRYPOINT"'"}/')
  fi
  printf '%s\n' "$input" >> "$CAT_CAFE_HOOK_SIDECAR"
fi
```

用 sh 而不是 node 的理由【源码注释】：`POSIX sh for zero-dependency instant start`。那句 `sed` 是把 `CLAUDE_CODE_ENTRYPOINT` 注进 JSON 尾部 —— 这是**计费身份的文件级证据**（`cli` = 交互订阅计费，`sdk-cli` = API 计费）。

2. 写 `<cwd>/.claude/settings.json`：

```json
{ "hooks": {
    "Stop":        [{"hooks":[{"type":"command","command":"<scriptPath>","timeout":5}]}],
    "PostToolUse": [{"hooks":[{"type":"command","command":"<scriptPath>","timeout":5}]},
                    {"matcher":"Read|Grep|Glob","hooks":[{"type":"command","command":"<anchorHookPath>","timeout":10}]}]
}}
```

注释里两个关键事实：**timeout 单位是秒（不是毫秒），schema 上限 600s**；`matcher` 是对工具名的正则，省略 = 所有工具都触发。第二个 PostToolUse 组只在 `<cwd>/.claude/hooks/f236-anchor-posttool.mjs` 存在时才加。

3. 用 `writeFileSync(sidecarPath, '')` 建一个空文件，好让 tailer 立刻能开始读。

`cleanup()`：有原始 settings 就写回，没有就 `rmSync`；再删 capture 脚本。sidecar 的临时目录由 carrier 的 `finally` 用 `rmSync(dirname(sidecarPath), {recursive:true, force:true})` 收掉。

#### 3.3.3 hook 事件 → AgentMessage：`hookEntriesToAgentMessages()`

只认两种【源码】：

| `hook_event_name` | 产出 | 取值 |
|---|---|---|
| `Stop` | `{type:'text'}` | `entry.last_assistant_message`（整段最终回复） |
| `PostToolUse` | `{type:'tool_use'}` | `toolName = entry.tool_name`；`toolInput = entry.tool_input`；`toolUseId = entry.tool_use_id` |

其它 hook 名**静默跳过**。另外三个纯函数：

- `isHookTerminalEvent(entry)` = `entry.hook_event_name === 'Stop'` —— **终结信号**，取代了 transcript 路径的 `turn_duration`
- `extractSessionIdFromHookEntries(entries)` —— 取第一个 `entry.session_id`
- `extractEntrypointFromHookEntries(entries)` —— 取第一个 `entry._cc_entrypoint`（计费身份，最终落在 `done.metadata.entrypoint`）

hook sidecar 的一行真实样本【推断，从消费端反推】：

```json
{"hook_event_name":"PostToolUse","session_id":"8c2f...-...","tool_name":"Read","tool_use_id":"toolu_01X","tool_input":{"file_path":"/a/b.ts"},"_cc_entrypoint":"cli"}
{"hook_event_name":"Stop","session_id":"8c2f...-...","last_assistant_message":"我看完了，问题在第 42 行。","_cc_entrypoint":"cli"}
```

#### 3.3.4 PTY 的输出循环

```
while (!terminal):
  abortRequested → 补 session_init（如果还没发）+ error + done，return
  entries = await tailer.readNew()
  entries.length === 0 → 再试一次 readNew({includeTrailingPartial:true})
  有内容：
     lastActivityMs = now
     首次取到 session_id → sessionId = it，补发 session_init
     首次取到 _cc_entrypoint → 记住
     hookEntriesToAgentMessages → 逐条 yield
     任一条 isHookTerminalEvent → terminal = true
  F236 eval bridge：ingestEvalEntries(evalTailer)
  没内容且 (now - lastActivityMs) > terminalTimeoutMs(默认 5 分钟) → 当作 done（静默超时兜底）
  否则 sleep(pollIntervalMs 默认 500)
```

`session_init` 是**延迟发**的：`skipTranscriptAck: true` 时 driver 返回空 sessionId，必须等第一条 hook 事件才知道真 session_id。源码保证了"session_init 一定在任何内容消息之前"，因为 Stop 和 PostToolUse 都带 session_id。

**usage 是降级的**：`const usage: TokenUsage = {}` —— hook 里没有 token 数据。文件头注释直白写着 `Usage: degraded (hooks carry no token data)`。

#### 3.3.5 PtyDriver 的几个硬细节

- **env 的两种施加方式**【源码 `PtyDriverOptions.env` 注释】：字符串值 → `tmux new-session -e KEY=VALUE`（写进 pane 环境，不用 shell 转义，因为 `execFileAsync` 直接传参）；`null` 值 → `buildClaudeCommand()` 拼成 `env -u KEY`（在 claude 跑之前 unset）。
- **shell 注入防护**：`buildClaudeCommand()` 里每个 token 都过 `shellQuoteArg()`（单引号包裹 + `'` 转义成 `'\''`），因为 tmux 会把 shell-command 参数交给 `$SHELL -c`。
- **代理变量要显式转发**【源码】：carrier 里有一段把 `HTTP_PROXY/http_proxy/HTTPS_PROXY/https_proxy/ALL_PROXY/all_proxy/NO_PROXY/no_proxy` 从 `process.env` 抄进 `envDelta`，注释理由是 `defeats tmux server env snapshot`（tmux server 是常驻的，它的环境快照可能是旧的）。
- **bypassPermissions 确认屏**：`isBypassConfirmationScreen(pane)` 就是 `pane.includes('bypassPermissions')`。处理顺序必须是 **Down → sleep(100ms) → Enter**。实证记录写在 `pty-utils.ts` 注释里：默认光标在 `❯ 1. No, exit`，直接 Enter 会退出会话；输 `2` + Enter **也**会退出（TUI 不接受数字输入）；只有 Down + Enter 才对。
- **粘贴用具名 buffer**：`bufferName = 'f230-' + sessionName`。理由【源码 P1-C fix 注释】：tmux 默认 `paste-buffer` 用的是**整个 server 里最近添加的自动 buffer**，两个并发 injectPrompt 会互相覆盖 → A 粘贴出 B 的 prompt。
- **prompt 临时文件用完立刻删**（P2-temp-files fix）：`load-buffer` 一返回，明文 prompt 就不需要留在磁盘上了。
- **同目录串行化**：`acquireTranscriptDirWatch(dir)` 是一个 Promise 链队列（`Map<string, Promise<void>>`），第二个同目录调用**等待**第一个释放。权衡写在注释里：同 cwd 并行 PTY 变成串行（墙钟 ≈ A + B 而不是 max(A,B)），要真并行就给不同的 `workingDirectory`。
- **cancel = 发 Escape**，session 存活；**dispose = `tmux kill-session`**，幂等（D1 防僵尸，LL-056）。
- **transcript 目录推导**：`ptyTranscriptDir(cwd, effectiveHome)` = `join(effectiveHome ?? homedir(), '.claude', 'projects', cwd.replace(/\//g,'-'))`。注释里有个被推翻的假设记录：早先猜是 git-common-dir 的父目录（`resolveGitProjectDir`），实测是**进程 cwd 的 slug**。
- **平台支持**：文件头明写 macOS ✅ / Linux ✅ / Windows 原生 ❌（tmux 没有原生 Windows 版，Windows 用户走 WSL；ConPTY 方案是 Phase C+）。

> **面试官追问："PTY 载体为什么不直接读 transcript 而要绕一圈 hook？"**
> 「因为 claude 2.1.172+ 的交互 TUI **不再写 transcript 文件了**。之前 `PtyDriver.injectPrompt()` 靠 `watchForTranscriptFile()` 等新 `.jsonl` 出现来确认 prompt 提交成功，现在会 100% 超时。所以 B-hook 版本加了 `skipTranscriptAck: true`，改用 Claude 自己的 Stop / PostToolUse hook 把结构化 JSON 写进一个 sidecar jsonl，我们 tail 那个文件。副产品是拿到了 `CLAUDE_CODE_ENTRYPOINT` 这个计费身份证据 —— 这恰好是整个 PTY 载体存在的目的。」

---

### 3.4 四种 Claude 载体的完整差异

| 维度 | `-p` (print_sdk / api_key) | `--bg` (bg_daemon) | interactive PTY | api_key |
|---|---|---|---|---|
| 实现类 | `ClaudeAgentService` | `ClaudeBgCarrierService` | `ClaudeInteractivePtyCarrierService` | **同 `ClaudeAgentService`** |
| `metadata.provider` | `anthropic` | `claude-bg` | `claude_interactive_pty` | `anthropic` |
| 输出来源 | stdout NDJSON（`--output-format stream-json`） | `~/.claude/jobs/<short>/state.json` + `linkScanPath` transcript jsonl | `.claude/settings.json` hook → sidecar jsonl | 同 `-p` |
| 进程模型 | 前台子进程，`spawnCli` 托管 | 分离守护进程，轮询文件 | tmux 会话 + 文件轮询 | 同 `-p` |
| prompt 传递 | stdin | stdin（supervisor 分离前同步读） | tmux 括号粘贴 + Enter | stdin |
| session resume | `--resume <sessionId>` | `--resume <UUID>`（必须校验 UUID） | `--resume <UUID>` + `existsSync(<dir>/<id>.jsonl)` 双重校验 | 同 `-p` |
| session id 稳定性 | 稳定 | **每轮 fork 新 UUID** → `usesChainKeyResume()=true` | Claude 自己生成，从 hook 事件读 | 稳定 |
| L0 注入 | `--system-prompt-file`（临时文件用完即删） | `--system-prompt-file`（**故意不删**，daemon 可能懒读） | ❌ 无（B-min 明确不做） | 同 `-p` |
| MCP 注入 | 全量：capabilities.json + 用户 `.mcp.json` 合并 | 简版：只 `cat-cafe` 一个 | 简版：只 `cat-cafe` 一个，写临时文件 | 同 `-p` |
| 流式粒度 | token 级（`--include-partial-messages`） | 消息级（transcript 在 `message_stop` 落盘） | **回合级**（只有 Stop hook 的整段回复） | token 级 |
| thinking | ✅（`thinking_delta` 聚合） | ✅（复用同一 parser） | ❌ | ✅ |
| tool_use | ✅ 带 `toolUseId` | ✅ | ✅ 带 `toolUseId`（PostToolUse） | ✅ |
| token usage | ✅ 精确（`result/success` + `modelUsage.contextWindow`） | ✅ 累加合成（`assistantTurnCount>0` 才挂） | ❌ 空对象 | ✅ |
| costUsd | ✅ CLI 给的精确值 | ⚠️ 只有 `totalCostUsd` 传进来才有 | ❌ | ✅ |
| 计费身份证据 | `sdk-cli`（`-p` 会让 CLI 自设） | 靠剥 `CLAUDE_CODE_ENTRYPOINT` env 争取 `cli` | **有文件级证据**：hook 注入的 `_cc_entrypoint` | `sdk-cli` |
| 取消 | `AbortSignal` → `spawnCli` 杀进程 | `signal` → `claude stop <shortId>` | `signal` → `driver.cancel()`（ESC）→ drain → `dispose()` | 同 `-p` |
| 超时 | `spawnCli` 的静默超时 + liveness probe | 30 分钟硬顶（`timeoutMs`） | 5 分钟静默兜底（`terminalTimeoutMs`） | 同 `-p` |
| 平台 | 全平台（Windows 特判 MCP config 文件 + git bash） | 全平台 | ❌ 原生 Windows（需 tmux） | 全平台 |
| F215 malformed 检测 | ✅ | ❌ | ❌ | ✅ |
| 图片 | ✅ 路径提示 + `--add-dir` | ❌ | ✅ 路径提示 + `--add-dir` | ✅ |

> **面试官追问："`print_sdk` 和 `api_key` 用的是同一个类，那分两个 tier 有什么意义？"**
> 「意义在健康状态机上，不在载体代码上。`createCarrierByTier()` 里两个 case 落到同一个 `new ClaudeAgentService({catId})` —— 源码注释写明 `the billing difference is in the auth/account layer, not the carrier code`。分两 tier 是因为降级链需要"订阅打完了还能掉到按量付费"这一层语义，而且 `api_key` 在 `CarrierHealthStore` 里是**硬编码永远健康**的（`getHealth`/`isHealthy`/`reportFailure` 三个方法都对 `api_key` 特判），它是链尾兜底。另外 `FallbackCarrierWrapper` 里有一句诚实的注释：目前降级到 `api_key` 是 no-op，所以它**直接 rethrow 而不发 carrier_fallback 事件**，免得给用户一个假的"已切换"提示。」

---

### 3.5 Codex（`CodexAgentService`）

#### 3.5.1 命令行：两条完全不同的 args 数组

【源码】`invoke()` 里是一个三元表达式，`sessionId` 有无决定两个分支：

```ts
const args = options?.sessionId
  ? ['exec','resume', options.sessionId, '--json',
     ...dedup(modelArgs), ...dedup(reasoningArgs), ...dedup(contextWindowArgs),
     ...dedup(sandboxConfigArgs),        // ← resume 分支特有：--config sandbox_mode=
     ...dedup(approvalArgs), ...dedup(developerInstructionsArgs), ...dedup(customProviderArgs),
     ...userConfigArgs, ...gitRepoArgs, ...catCafeMcpArgs, ...imageArgs, ...promptArgs]
  : ['exec','--json',
     ...dedup(modelArgs), ...dedup(reasoningArgs), ...dedup(contextWindowArgs),
     '--sandbox', sandboxMode,           // ← 新建分支：--sandbox 旗标
     '--add-dir', '.git',                // ← 只有新建才有
     ...dedup(approvalArgs), ...dedup(developerInstructionsArgs), ...dedup(customProviderArgs),
     ...userConfigArgs, ...gitRepoArgs, ...catCafeMcpArgs, ...imageArgs, ...promptArgs];
```

差异的原因【源码注释】：

```
resume 子命令不接受 --sandbox / --add-dir, but it does accept
sandbox_mode through --config. Replay the configured sandbox there so
resumed Codex turns cannot drift back to a CLI default sandbox on Windows.
--add-dir .git: 允许写入 .git/ 目录（index.lock、objects、refs），解锁 git commit
注意：旧 session resume 时仍不会带 --add-dir。这是预期行为——新建会话才能获得额外目录授权。
```

`promptArgs` 是 `['--', '-']`【源码注释】：`'--' 结束选项解析，'-' 让 codex 从 stdin 读取 PROMPT`。prompt 走 `cliOpts.stdinInput`，注释挂着事故编号：

```
Incident 2026-05-29 (cross-thread-context-contamination): prompt 正文经 stdin 传入，
绝不进 argv —— 否则 `ps -o command=` / /proc/<pid>/cmdline 会把完整对话历史
（含跨 thread/猫/用户内容）暴露给任何并发进程。
```

各个 `--config` 组的值：

| 组 | 内容 | 来源 |
|---|---|---|
| `reasoningArgs` | `--config model_reasoning_effort="<effort>"` | `getCatEffort(catId, undefined, 'openai')` |
| `sandboxConfigArgs` | `--config sandbox_mode=<toml>` | `getCodexSandboxMode()`，默认 `danger-full-access`，env `CAT_CODEX_SANDBOX_MODE`，合法值 `read-only` / `workspace-write` / `danger-full-access` |
| `approvalArgs` | `--config approval_policy="<p>"` | `getCodexApprovalPolicy()`，默认 `on-request`，env `CAT_CODEX_APPROVAL_POLICY`，合法值 `untrusted` / `on-failure` / `on-request` / `never` |
| `contextWindowArgs` | `--config model_context_window=N` + `--config model_auto_compact_token_limit=M` | `getCatContextWindowConfig(catId)`；M 缺省 = `Math.floor(N * 0.88)` |
| `developerInstructionsArgs` | `--config developer_instructions=<toml 字符串>` | L0 编译产物 |
| `customProviderArgs` | 见 3.5.2 | `customBaseUrl` 存在时 |
| `gitRepoArgs` | `['--skip-git-repo-check']` 或 `[]` | `isGitRepositoryPath(cwd)` 向上找 `.git` |
| `imageArgs` | `imagePaths.flatMap(p => ['--image', p])` | **Codex 是唯一有原生图片旗标的 CLI** |

#### 3.5.2 自定义 base URL：走 `model_providers` 而不是 env

【源码注释】：`Codex CLI deprecated OPENAI_BASE_URL env var.`，来源标注了 `codex-rs/core/src/model_provider_info.rs`。

```ts
const customProviderArgs = customBaseUrl ? [
  '--config','model_provider="custom"',
  '--config',`model_providers.custom.base_url=${toTomlString(customBaseUrl)}`,
  '--config','model_providers.custom.name="Custom API Key"',
  '--config','model_providers.custom.wire_api="responses"',
  '--config','model_providers.custom.env_key="OPENAI_API_KEY"',
] : [];
```

`customBaseUrl` 的查找顺序（**四处都看**）：`callbackEnv.OPENAI_BASE_URL` → `callbackEnv.OPENAI_API_BASE` → `accountEnv.OPENAI_BASE_URL` → `accountEnv.OPENAI_API_BASE`。注释解释为什么要看 accountEnv：`after F171 env separation, user-configured OPENAI_BASE_URL lives in accountEnv, not callbackEnv`。

配了 customBaseUrl 时，模型旗标也换写法【源码】：

```ts
const modelArgs = !cliModel ? []
  : customBaseUrl ? ['--config', `model=${toTomlString(cliModel)}`]
                  : ['--model', cliModel];
```

理由【源码注释】：`Use --config model=... instead of --model to bypass the CLI's built-in metadata lookup for custom providers (non-builtin models trigger a cosmetic warning via --model)`。

#### 3.5.3 认证模式与 HOME 隔离

```ts
type CodexAuthMode = 'oauth' | 'api_key' | 'auto';   // 默认 'oauth'
function getCodexAuthMode(callbackEnv) {
  const raw = callbackEnv?.CODEX_AUTH_MODE?.trim().toLowerCase();
  return (raw === 'api_key' || raw === 'auto' || raw === 'oauth') ? raw : 'oauth';
}
function applyAuthMode(env, authMode) {
  if (authMode !== 'oauth') return env;
  return { ...env, OPENAI_API_KEY: null, OPENAI_BASE_URL: null, OPENAI_API_BASE: null,
           OPENAI_ORG_ID: null, OPENAI_ORGANIZATION: null };
}
```

**HOME 隔离**只在 `authMode === 'api_key' && customBaseUrl` 时启用【源码】：

```ts
const isolatedHome = mkdtempSync(`${tmpdir()}/codex-apikey-`);
rawEnv.HOME = isolatedHome;
if (process.platform === 'win32') rawEnv.USERPROFILE = isolatedHome;
```

注释解释：OAuth 模式需要真 HOME（`~/.codex/auth.json` 刷 token）；API Key 模式必须**避开**真 HOME，否则过期的 OAuth token 刷新失败会在 CLI 走到自定义 provider 配置之前就把它 abort 掉。Windows 上 Rust/codex 用 `USERPROFILE` 而不是 `HOME`。

env 应用顺序【源码】：`rawEnv(callbackEnv 拷贝) → 删 OPENAI_BASE_URL/API_BASE（如果已被 --config 消化）→ HOME 隔离 → applyAuthMode → accountEnv 覆盖（跳过已消化的两个 base url key）→ mcpBearerEnv 注入`。

#### 3.5.4 MCP 注入：`buildCatCafeMcpArgs()`（Codex 最脏的一段）

Codex 没有 `--mcp-config` JSON，全靠一条条 `--config mcp_servers.X.Y=Z`。四个特色：

**① 先禁掉遗留的 `cat-cafe` 单体服务**（F213 L4）：

```
--config mcp_servers.cat-cafe.command="echo"
--config mcp_servers.cat-cafe.args=["legacy-shim"]
--config mcp_servers.cat-cafe.enabled=false
```

**② 禁用条目必须给"完整假形状"**【源码注释】：

```
Bare `enabled=false` fails Codex ≥0.142 schema validation (requires transport fields);
including command+args satisfies the schema
```

而且 URL 型禁用要发 `url` + `enabled=false`，**不能**叠 `command`/`args` —— 否则 Codex 报 `url is not supported for stdio`。

**③ streamableHttp 的鉴权走 `bearer_token_env_var`**（#1074）。Codex 不支持任意 header，所以从 `Authorization: Bearer <token>` 里把 token 抠出来，塞进一个环境变量，再让 config 指向它。env 变量名的构造是防碰撞的【源码】：

```ts
const sanitized = s.name.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
const hash = createHash('sha256').update(s.name).digest('hex').slice(0, 8);
const envVarName = `CLOWDER_MCP_BEARER_${sanitized}_${hash}`;
```

注释理由：`foo-bar` 和 `foo_bar` sanitize 之后会撞成同一个名字，会把一个服务的 token 路由给另一个服务。header 查找是**大小写不敏感**的（RFC 7230），值里的 `${ENV_VAR}` 占位符会先解析。

**④ 需要注入 env 的外部 MCP 走 wrapper 脚本**：`writeCodexMcpEnvWrapper()` 会写一个 `.mjs` 到临时目录（`mode: 0o600`），它读同目录的 spec json、立刻删掉 spec、再 `spawn(spec.command, spec.args, {env: {...process.env, ...spec.env}, stdio:'inherit'})`，子进程退出时自删 wrapper 和目录。因为 Codex 的 `mcp_servers.X.env.*` 只对我们自己管理的 cat-cafe 服务用了（`isCatCafe` 分支），外部服务只能靠 wrapper。

TOML 名字转义规则：`/^[A-Za-z0-9_-]+$/.test(s.name) ? s.name : '"' + s.name + '"'`。值统一走 `toTomlString()`（手写转义 `\` `"` `\b` `\t` `\n` `\f` `\r`，其余控制字符转 `\uXXXX`）。

**保留 config key 保护**【源码】：

```ts
const RESERVED_SYSTEM_CONFIG_KEYS: ReadonlySet<string> = new Set(['developer_instructions']);
```

`stripReservedSystemConfigs()` 会把用户 `cliConfigArgs` 里 `--config developer_instructions=...` **和** `-c developer_instructions=...` 都剔掉（`-c` 是 `codex exec --help` 文档化的短别名）。注释里把危险性写成 P1：不剔掉的话，下游 `dedup()` 看到这个 key 已在 `userConfigKeys` 里就会跳过系统注入 → **L0 静默丢失**。

#### 3.5.5 事件解析：`transformCodexEvent()`

【源码】分支顺序：

```
thread.started → session_init(sessionId = e.thread_id)
todo_list（item.started/updated/completed 三种外壳都认）→ system_info{type:'task_progress', action:'snapshot', tasks[]}
     tasks[i] = { id: t.id ?? `task-${i}`, subject: (t.content ?? t.text).slice(0,120),
                  status: normalizeTaskStatus(t.status ?? (t.completed ? 'completed':'pending')) }
item.started:
     item.type==='mcp_tool_call'      → tool_use，toolName = `mcp:${server}/${tool}`，toolUseId = item.id
     item.type==='command_execution'  → tool_use，toolName='command_execution'，toolInput={command}
     其余 → null
type==='error':
     message 以 'Reconnecting...' 开头 → system_info（纯文本，不是 JSON！）
     其它 → null（由 collectCodexStreamError 收集，最后拼进退出错误）
item.completed:
     agent_message   → text（多轮之间插 '\n\n'，见下）
     command_execution → tool_result，content = "command: X\nstatus: Y\nexit_code: Z\n<aggregated_output>"
     file_change     → tool_use，toolName='file_change'，toolInput={status, changes}
     mcp_tool_call   → tool_result（+ 可能追加一条 rich_block）
     web_search      → system_info{type:'web_search', count:1}     ← 不带 query，隐私
     reasoning       → system_info{type:'thinking', text}
     error           → system_info{type:'warning', message}
```

**多轮文本分隔**：`CodexStreamState = { hadPriorTextTurn: boolean }`。第二个及之后的 `agent_message` 前面加 `'\n\n'`。注释解释了为什么 Claude 不需要：`unlike Claude's incremental deltas which naturally include the model's own whitespace`。

**MCP 图片提取**（F060）：从 `item.result.content` 里挑 `type==='image'` 的块，白名单 + 大小限制：

```ts
const IMAGE_MIME_WHITELIST = new Set(['image/png','image/jpeg','image/gif','image/webp','image/svg+xml']);
const MAX_BASE64_LENGTH = 5 * 1024 * 1024;   // 5MB base64 ≈ 3.75MB 解码后
```

产出 `[toolResult, richBlock]` 两条消息，rich block 的 id 是 `mcp-img-${Date.now()}-${随机4位}`。

`toolResultStatus` 的映射【源码】：`status === 'completed' → 'ok'`；`status === 'failed' || 'error' → 'error'`；其余 `'unknown'`。

#### 3.5.6 Codex 事件真实样本【推断，从 parser 反推】

```jsonl
{"type":"thread.started","thread_id":"01J8X…"}
{"type":"item.started","item":{"id":"itm_1","type":"command_execution","command":"pnpm test","status":"in_progress"}}
{"type":"item.completed","item":{"id":"itm_1","type":"command_execution","command":"pnpm test","status":"completed","exit_code":0,"aggregated_output":"42 passing\n"}}
{"type":"item.completed","item":{"id":"itm_2","type":"reasoning","text":"需要先确认测试是否覆盖…"}}
{"type":"item.started","item":{"id":"itm_3","type":"mcp_tool_call","server":"cat-cafe-collab","tool":"post_message","arguments":{"content":"…"}}}
{"type":"item.completed","item":{"id":"itm_3","type":"mcp_tool_call","server":"cat-cafe-collab","tool":"post_message","status":"completed","result":{"content":[{"type":"text","text":"ok"}]}}}
{"type":"item.completed","item":{"id":"itm_4","type":"agent_message","text":"测试全过了。"}}
{"type":"turn.completed","usage":{"input_tokens":18320,"output_tokens":640,"cached_input_tokens":16000}}
{"type":"error","message":"Reconnecting... (attempt 1)"}
```

#### 3.5.7 三个 Codex 专有的收尾动作

**① exit code 1 的假错误抑制**【源码】：

```ts
if (event.exitCode === 1 && event.signal === null && sawSubstantiveOutput
    && !hasNonSuppressibleCodexExitOneDiagnostics(event, recentStreamErrors)) {
  log.warn({}, '[codex] Codex CLI exited with code 1 after substantive output (suppressing as Codex 0.98+ quirk)');
  continue;
}
```

`sawSubstantiveOutput` 只在见到 `item.completed` 时置 true —— 注释强调 `thread.started alone is NOT enough — that just means session init`。
不可抑制的例外：`hasNonSuppressibleCodexExitOneDiagnostics()` 把 `event.message` + `cliDiagnostics.publicSummary` + `cliDiagnostics.safeExcerpt` + `recentErrors` 拼起来，命中 `/remote compaction failed|compact_error/i` 就不抑制。

**② 流错误收集**：`collectCodexStreamError()` 维护一个最多 `MAX_RECENT_STREAM_ERRORS = 5` 的环形数组，每条 `sanitizeCliStderr()` 后截断到 `MAX_STREAM_ERROR_LENGTH = 240`，**连续重复的丢掉**。最后 `withRecentDiagnostics(base, recentErrors)` 拼成：

```
<原错误>
最近流错误:
- <err1>
- <err2>
```

**③ 成本估算 + 上下文快照，顺序有讲究**【源码注释】：

```
Estimate cost from pricing table when CLI doesn't provide costUsd.
MUST run BEFORE contextSnapshotResolver — the resolver overwrites
metadata.usage.inputTokens/outputTokens with context-fill values for
display, but cost estimation needs the original turn.completed totals
```

`estimateCostFromTokens(metadata.model, inputTokens, outputTokens, cacheReadTokens)` 成功后设 `costUsd` + `costEstimated = true`。用的是 `metadata.model` 而不是 `getCatModel()`（review P1-2：后者拿不到 per-invocation 覆盖）。

**`createCodexSessionContextSnapshotResolver()`** 的算法：
1. 在 `${CODEX_HOME ?? ~/.codex}/sessions` 下**深度优先**找文件名包含 sessionId 且以 `.jsonl` 结尾的文件；命中后进 LRU 缓存（`DEFAULT_FILE_CACHE_MAX = 100`）
2. 只读文件**尾部 `DEFAULT_TAIL_BYTES = 256 * 1024`** 字节
3. 从后往前逐行 `JSON.parse`，找 `row.payload.type === 'token_count'` 的
4. 抽 `info.last_token_usage.input_tokens` 作 `contextUsedTokens`，`info.model_context_window` 作 `contextWindowTokens`（两个缺一就跳过这条）
5. **优先返回 `hasNonZeroRateUsage` 的那条**（`rate_limits.primary/secondary.used_percent > 0`），否则记住第一条当 fallback
6. `contextResetsAtMs = Math.trunc((secondary?.resets_at ?? primary?.resets_at) * 1000)`

拿到 snapshot 后的覆盖动作【源码】：`contextUsedTokens` / `contextWindowSize` / `lastTurnInputTokens` / **`inputTokens` 全部设成 `snapshot.contextUsedTokens`**；`cacheReadTokens` 和 `outputTokens` 有 snapshot 值就用、没有就 **`delete`**。注释解释 `inputTokens` 为什么也覆盖：`Codex turn.completed usage can be CLI-session cumulative... For Codex, each Clowder AI invocation is one CLI turn, so last_token_usage is the invocation input, not a session total.`

**④ 生成图片扫描**（F172 Phase B）：`scanAndPublishCodexImages({codexSessionId, uploadDir, codexHome})` 扫 `<codexHome>/generated_images/<sessionId>/`，扩展名映射表 `.png/.jpg/.jpeg/.gif/.webp`，每张调 `publishGeneratedImage()`（`publicationKey = codex-${sessionId}-${filename}`），只有 `isNew` 的才 yield `system_info{type:'rich_block'}`。

#### 3.5.8 审计钩子

`extractCommandExecutionLifecycle(event)` 从 `item.started` / `item.completed` 里抽 `{phase, command, status?, exitCode?}`，映射到 `AuditEventTypes.CLI_TOOL_STARTED` / `CLI_TOOL_COMPLETED`，写进 `EventAuditLog`（fire-and-forget，失败只 warn）。

`sanitizeRawEvent(event)` 做 raw 归档前的脱敏：递归深度上限 `MAX_REDACT_DEPTH = 2`，命中 `isSensitiveTokenKey(key)`（小写后等于 `callbacktoken`、或以 `_token` 结尾、或包含 `callback_token`）且值是字符串的，替换成 `'[redacted]'`。

---

### 3.6 Gemini（`GeminiAgentService`）—— 一个类，三个 adapter

【源码】：

```ts
type GeminiAdapter = 'gemini-cli' | 'antigravity-cli' | 'antigravity';
const DEFAULT_GEMINI_ADAPTER: GeminiAdapter = 'antigravity-cli';
// 选择：options.adapter ?? process.env.GEMINI_ADAPTER ?? DEFAULT
```

#### 3.6.1 `gemini-cli` adapter（legacy/enterprise fallback）

命令行：

```ts
const args = options?.sessionId
  ? ['--resume', sessionId, ...modelArgs, '-p', effectivePrompt, '-o','stream-json','-y']
  : [...modelArgs, '-p', effectivePrompt, '-o','stream-json','-y'];
for (const dir of imageAccessDirs) args.push('--include-directories', dir);
```

注意：**prompt 在 argv 里**（Gemini 是唯一没有把 prompt 挪到 stdin 的 CLI）。systemPrompt 拼在 prompt 前面（`${systemPrompt}\n\n${prompt}`）。`-y` = 自动同意。

事件格式【源码 `gemini-event-parser.ts`】：

```
type==='init'                        → session_init(e.session_id)
type==='message' && role==='assistant' → text(e.content)
type==='tool_use'                     → tool_use(e.tool_name, e.parameters)
type==='result' && status!=='success' → error（文案从 e.error 抽，抽不到返回 null 让 exit error 说话）
其余（message/user、tool_result、result/success）→ null
```

样本【推断】：

```jsonl
{"type":"init","session_id":"c0ffee-…"}
{"type":"message","role":"assistant","content":"好的，","delta":true}
{"type":"tool_use","tool_name":"read_file","parameters":{"path":"a.ts"}}
{"type":"result","status":"success","stats":{"total_tokens":21000,"input_tokens":19800,"output_tokens":1200,"cached_input_tokens":16000,"context_window":1000000}}
```

usage 提取处**强制打上 `isCumulativeUsage = true`**【源码注释】：`#679: Gemini CLI stats are cumulative across all turns in a session, not per-turn context fill. Flag so auto-seal doesn't misuse them.`

**一个已知崩溃的白名单抑制**【源码】：

```ts
const KNOWN_POST_RESPONSE_CANDIDATES_CRASH = "Cannot read properties of undefined (reading 'candidates')";
```

`isKnownPostResponseCandidatesCrash(event)` 命中且**已经吐过 assistant 文本**时，设 `suppressCliExitError = true`，后面的 `isCliError` 就不报了 —— 回复已经完整给出来了，只是 CLI 在收尾时自己崩了。

**thinking 和 lastTurnInputTokens 是从本地会话文件挖的**（gemini CLI 的 NDJSON 不给）：
`findGeminiSessionFile(sessionId, workingDirectory)` 扫 `~/.gemini/tmp/<project>/chats/session-*.{json,jsonl}`：
- 项目目录排序时把 `basename(workingDirectory)` 排到最前
- 文件按 mtime 倒序
- `.jsonl`：只读**头 1024 字节**（`JSONL_HEADER_MAX_BYTES`）解析第一行，看 `sessionId` 匹配；头里没有 sessionId 时退化成"文件名包含 sessionId 前 8 位"
- `.json`：整个 parse 后比 `parsed.sessionId`

匹配"当前这轮"的谓词是 `matchesCurrentAssistantText()`：把两边空白全去掉（`replace(/\s+/g,'')`）后，要么完全相等，要么"整轮文本以这条消息内容结尾"。thinking 的渲染是 `**subject**\n description`，多条之间用 `\n\n---\n\n` 连。

#### 3.6.2 `antigravity-cli` adapter（默认路径，AGY）

这是 Gemini 的**生产路径**，也是整个 provider 层最复杂的一段。

**命令行**：

```ts
const args = ['--add-dir', workingDirectory];
if (agyProfile?.autoApprove) args.push('--dangerously-skip-permissions');
for (const dir of imageAccessDirs) args.push('--add-dir', dir);
if (printTimeout) args.push('--print-timeout', printTimeout);   // 例 "600s"
if (agyModel) args.push('--model', agyModel);
args.push('--print', effectivePrompt);
// 用户参数过滤 + 去重
// 剥掉用户可能塞的 --conversation / --log-file
insertArgsBeforeFlag(args, '--print', ['--log-file', agyLogPath, ...(sessionId ? ['--conversation', sessionId] : [])]);
```

三条硬规则：

1. `ANTIGRAVITY_USER_BLOCKED_FLAGS = new Set(['--dangerously-skip-permissions','--model'])` —— 用户不许覆盖这两个。剔除用 `removeValuedCliFlags(args, flags, {consumeValueTokens:'untilNextFlag'})`，即**吃掉直到下一个 `-` 开头的 token 为止**的所有值。
2. `--conversation` / `--log-file` 是系统内部参数，用户传的一律用 `removeValuedCliFlags(..., 'single')` 剥掉，再由系统在 `--print` **之前**插入（`insertArgsBeforeFlag`），因为 `--print <prompt>` 后面的东西会被当成 prompt 的一部分。
3. `--print-timeout` 的值格式：`formatAgyPrintTimeout(ms)` = `` `${Math.max(1, Math.ceil(ms/1000))}s` ``。

**模型名归一化**【源码 `AGY_GEMINI_MODEL_BY_LEGACY_MODEL_ID`】—— 从旧模型 id 映射到 AGY 的人类可读标签：

```
gemini-2.5-pro / -preview / -exp  → "Gemini 3.1 Pro (High)"
gemini-2.5-flash / -preview       → "Gemini 3.5 Flash (High)"
gemini-3.1-pro / -preview         → "Gemini 3.1 Pro (High)"
gemini-3.5-flash                  → "Gemini 3.5 Flash (High)"
```

**输出模式是 `plainText` 不是 NDJSON**：`cliOpts.outputMode = 'plainText'`，所以整个 stdout 是一坨文本，由 `classifyAntigravityCliPlainText()` 分类（见 §4.5）。

**AGY profile 隔离**（`agy-profile-manager.ts`）：

```
homeRoot  = config.homeRoot ?? env.CAT_CAFE_AGY_PROFILE_ROOT ?? ~/.cat-cafe/agy-profiles
homePath  = <homeRoot>/<sanitizeProfileId(profileId ?? catId)>
settings  = <homePath>/.gemini/antigravity-cli/settings.json   ← 写入 {model, trustedWorkspaces}
cwdPath   = <homePath>/cwd                                     ← spawn cwd 的 per-profile 基座
```

`sanitizeProfileId()`：非 `[A-Za-z0-9._-]` 全换成 `-`，掐掉首尾 `-`，拒绝空 / `.` / `..` / 含 `..`。
`resolveUnder(root, seg)` 做路径逃逸检查（`relative()` 的结果不能是空 / `..` / `../*` / 绝对路径）。

**四道 symlink fail-closed 检查**【源码 `getUnsafeAgyProfileTargetReason`】：`HOME` / `.gemini 目录` / `settings 目录` / `settings 文件` / `cwd sandbox` 任一是已存在的 symlink → 抛错。理由：`mkdirSync(recursive)` 会跟随 symlink，把 cwd-relative 缓存写回 repo 或真 HOME。
还有两条身份检查：canonical homePath 等于真 HOME → 拒；canonical settings 路径落在真用户的 `~/.gemini/antigravity-cli/` 下 → 拒。

**`resolveAgySpawnCwd(profile, catId, workingDirectory)`**（F210 cache-leak 修复，这段注释是全仓最长的之一）：

```ts
const workspaceKey = createHash('sha256').update(resolve(workingDirectory)).digest('hex').slice(0, 16);
const base = agyProfile ? agyProfile.cwdPath
  : resolveUnder(resolve(expandHomePath(env.CAT_CAFE_AGY_CWD_ROOT ?? ~/.cat-cafe/agy-cwd)), sanitizeProfileId(catId));
const sandbox = join(base, workspaceKey);
```

要点：AGY 会把 `cache/projects.json` 写到 **spawn cwd**，cwd 设成 repo root 就会泄漏进 worktree（2026-06-03 实证）。而且 sandbox 必须**每个 workingDirectory 唯一**（用 sha256 前 16 位做 key），因为 AGY 按 cwd 划 conversation 命名空间，多 worktree 共用一个 sandbox 会串台。
注释里还专门反驳了一个静态审查意见：把 process cwd 挪到 sandbox **不会**破坏 AGY 的工作区 —— 实测 `cd <sandbox> && agy --add-dir <work>` 后，AGY 的 `pwd` 工具返回 `<work>`、能读 `<work>` 的文件、`<work>/GEMINI.md` 照常加载，只有内部 cwd-relative 缓存落在 sandbox。所以 `--add-dir <绝对 workingDirectory>` **不能删**。

**preflight 五连检**【源码 `preflightAgyProfile()`】，任一失败就 yield error + done：

| `reason` | 判定 |
|---|---|
| `missing_binary` | `resolveCliCommand('agy')` 返回 null |
| `unsafe_home` | 上面那套 symlink / 真 HOME 检查（错误文案里把 `write shared state` 换成 `run with shared state`） |
| `settings_missing` | settings.json 不存在 |
| `settings_unreadable` | JSON parse 失败 |
| `model_mismatch` | `settings.model.trim() !== profile.expectedModel` |
| `untrusted_workspace` | `settings.trustedWorkspaces`（逐个 `resolve()`）不含 `resolve(workingDirectory)` |

**模型验证是事后从日志里对的**【源码】：

```ts
const re = /\bPropagating selected model override to backend:\s*label="([^"\r\n]+)"/gi;
```

取**最后一次**匹配。`profileModelMismatch` = 观测到的 label ≠ 期望；`profileModelMissing` = 有 profile 但一条都没观测到。两种都会 yield error（文案分别是 `AGY profile selected model mismatch: expected "X", observed "Y".` 和 `AGY profile selected model was not verified: ...`）。这也是 `metadata.modelVerified` 的来源。

**会话 id 也是从日志里捞的**【源码 `extractAntigravityCliConversationId`】：

```ts
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const re = new RegExp(`(?:Created conversation|Print mode: conversation=|Streaming conversation|Sending user message to conversation|Forwarding user message to conversation)\\s*(${uuid})`, 'gi');
```

同样取最后一次匹配。而且**只有在一切都对时才记新会话**【源码 `canRecordFreshConversation`】：

```ts
!emittedSessionInit && parsedPlainText.kind === 'text' && !timeoutEvent && !cancelled
  && !cliErrorEvent && !profileModelMismatch && !profileModelMissing
  && exitCode === 0 && exitSignal === null
```

**并发结构**：`agy --print` 是阻塞到进程结束的，所以 `invoke()` 起了一个后台任务消费 spawn 流（把 `__cliPlainText` / `__cliTimeout` / `__cliError` / liveness 分别接住），主循环则跑 trajectory 观测器。两者用一个 `Promise.race` 合流：

```ts
const SIDE_CHANNEL_DRAIN_MS = 200;
const settled = await Promise.race([
  progressNext.then(res => ({kind:'progress', res})),
  new Promise(r => setTimeout(() => r({kind:'timer'}), SIDE_CHANNEL_DRAIN_MS)),
]);
```

注释解释为什么要 race 一个 200ms 定时器：进度通道可能长时间不产出（fail-open / 没有新 step），如果只等它，liveness 警告就会被缓冲到 AGY 跑完才发出去 —— 比 H1b 之前的实时行为还差（砚砚 P1-2）。定时器赢了就回去 drain buffer，`progressNext` 这个 promise **保持 pending 并复用**（不重新 `.next()`）。

**图片**：AGY 只吃路径提示（`appendLocalImagePathHints`）+ `--add-dir <图片目录>`，没有原生图片旗标。

**日志文件善后**：`finally { removeAntigravityLogFile(agyLogPath) }` —— `rmSync(path, {force:true})` 吞异常。

#### 3.6.3 `antigravity` adapter（legacy 半自动）

最简单的一个【源码】：要求必须有 `callbackEnv`（否则直接 error），生成 `sessionId = 'antigravity-' + randomUUID()`，然后：

```ts
spawn('antigravity', ['chat','--mode','agent', prompt], { detached: true, stdio: 'ignore', env: childEnv });
child.unref();
```

`AbortSignal` 绑到 `process.kill(-pid, 'SIGTERM')`（杀整个进程组）。等一个 `process.nextTick` 捞 ENOENT/EACCES 之类的异步 spawn 错误，然后 yield 一句固定文案：

```
暹罗猫已在 Antigravity 中开始工作，结果将通过 MCP 回传到对话中。
```

真正的结果靠 MCP 回调（`origin: 'callback'`）回来 —— 所以叫"半自动"。

#### 3.6.4 Antigravity IDE 桥（`antigravity/` 子目录，另一条路）

这是与上面三个 adapter 并列的第四条路（由 registry 单独装配 `AntigravityAgentService`），走 ConnectRPC 直连 Antigravity Language Server，不是 CLI。几个可以说出口的硬事实【源码】：

- `AntigravityBridge.ts` 常量：`DEFAULT_RPC_TIMEOUT_MS = 30_000`；`RunCommand` 例外，超时 = `max(30s, payload.timeoutMs + 5_000)`，上限受 `MAX_RUN_COMMAND_TIMEOUT_MS` 约束；`IN_FLIGHT_WAIT_TIMEOUT_MS = MAX_RUN_COMMAND_TIMEOUT_MS + 60_000`（+60s 是泄漏计数器的兜底，不是预期出口）。
- `CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT = 1` —— 注释：`Antigravity 2.x rejects the proto default 0 (UNSPECIFIED) for StartCascade`。
- 模型是**硬编码占位符映射**：`gemini-3.1-pro → MODEL_PLACEHOLDER_M37`、`gemini-3-flash → M47`、`claude-opus-4-6 → M26`、`claude-sonnet-4-6 → M35`。
- 错误分类 `classifyUpstreamError(rawReason, stopReason)` 的优先级：`stopReason === 'STOP_REASON_CLIENT_STREAM_ERROR'` → `stream_interrupted`（transient）→ invalid tool call（**non-transient**）→ capacity（transient）→ network（transient）→ unknown（non-transient）。
  - `CAPACITY_PATTERNS`：`/high traffic/i` `/rate limit/i` `/too many requests/i` `/overloaded/i` `/exhausted your capacity/i` `/quota will reset/i`
  - `NETWORK_PATTERNS`：`/network.*issue/i` `/connection.*(?:error|refused|reset|closed)/i` `/ECONNREFUSED/` `/ECONNRESET/` `/ETIMEDOUT/` `/(?:network|connect|server).*\btry again\b/i`，且**必须不是 capacity**
  - 人话文案表：capacity→`上游模型服务繁忙`、network→`网络连接异常`、stream_interrupted→`连接中断`、invalid_tool_call→`工具调用失败`、unknown→`上游服务异常`
- `AntigravityAgentService.ts` 顶部常量：`STREAM_ERROR_GRACE_WINDOW_MS = 4_500`、`STALL_PROBE_MAX_ATTEMPTS = 2`、`DEFERRED_TERMINAL_NUDGE_MAX_ATTEMPTS = 1`、`DEFAULT_AUTO_RESUME_MAX_ATTEMPTS = 1`、`DEFAULT_MODEL_CAPACITY_RETRY_DELAYS_MS = [1000, 3000, 5000, 10000, 15000, 20000, 30000, 36000]`。那句只发一次的追问 prompt 是字面量：`请直接输出最终答案，不要只描述下一步要做什么。如果还需要更多步骤，请现在就执行并给出结果。`
- **副作用分级恢复**（`antigravity-resume-tier.ts`）：四档 `tier1_auto_readonly` / `tier2_auto_probe_owned` / `tier3_manual_shared_or_external` / `tier4_manual_irreversible`；前两档 `canAutoResume = true` 走 `auto_resume`，后两档走 `manual_card`（给用户一张恢复卡片让他决定）。判定靠一堆正则识别命令的破坏性，例如 `SAFE_BUILD_TEST_LINT_PATTERN`（pnpm/npm/yarn build|test|lint|check|typecheck、node --test、tsc、biome check）、`RELEASE_OR_DESTRUCTIVE_GH_PATTERN`、`CREDENTIAL_MUTATION_PATTERN`、`GIT_SUBCOMMANDS_WITH_SHARED_WRITE`（am apply checkout cherry-pick clean commit merge pull push rebase release reset restore revert stash switch tag）。

---

### 3.7 OpenCode（`OpenCodeAgentService`）

#### 3.7.1 命令行

```ts
const args = ['run'];
if (sessionId) args.push('--session', sessionId);
if (effectiveModel) args.push('-m', effectiveModel);
args.push('--format', 'json');
args.push('--auto');                       // OPENCODE_AUTO_APPROVE_FLAG
// 用户参数去重（按 flag 名，支持 --key=value 形式）
deduped.push(...userParts, prompt);        // prompt 是最后一个位置参数（在 argv 里）
```

模型**原样传递**【源码注释】：`Do not silently prepend provider prefixes (e.g. anthropic/, openrouter/). The user-configured model string is the source of truth.`

#### 3.7.2 `--auto` 能力探测（一个很有意思的前置门）

【源码】常量：

```ts
const OPENCODE_AUTO_APPROVE_FLAG = '--auto';
const OPENCODE_AUTO_APPROVE_FLAG_ALIASES = new Set(['--auto','--yolo','--dangerously-skip-permissions',
                                                    '--no-auto','--no-yolo','--no-dangerously-skip-permissions']);
const OPENCODE_AUTO_APPROVE_MIN_VERSION = '1.17.12';
const OPENCODE_AUTO_APPROVE_PROBE_TIMEOUT_MS = 10_000;
```

`probeOpenCodeAutoApproveSupport()` 跑 `opencode run --help`（`outputMode: 'plainText'`，10s 超时），判定就一行：`helpText.includes('--auto')`。结果缓存在**进程级** `sharedOpenCodeAutoApproveProbe`（Promise，不是值），注释提醒：升级 opencode 后要重启 API 进程才会重新探测。

不支持时 `ensureAutoApproveSupported()` **throw**（在真正 spawn 之前），文案：

```
OpenCode 版本过低，不支持 --auto 自动审批；请升级 opencode-ai 到 >= 1.17.12 后重试。
无法确认 OpenCode 是否支持 --auto 自动审批；请升级 opencode-ai 到 >= 1.17.12 后重试。   ← 探测本身失败/超时
```

测试缝设计【源码注释】：注入了 `spawnFn` 的单测**不消费**这个 mock 去做探测（`if (this.spawnFn) return Promise.resolve({supported:true})`），除非测试显式给了 `autoApproveProbeFn`。

#### 3.7.3 三种 env 模式：`buildEnv(callbackEnv)`

【源码】三条互斥分支，按顺序：

| 条件 | 动作 |
|---|---|
| `OPENCODE_CONFIG` 有值 **且** `CAT_CAFE_OC_INSTRUCTIONS_ONLY` 无值 | 把 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` / `OPENCODE_API_KEY` / `OPENCODE_BASE_URL` **全部置 null**，直接 return。因为凭证是通过配置文件里的 `{env:CAT_CAFE_OC_*}` 占位符注入的，留着 anthropic env 会让 opencode 走内建 anthropic provider |
| `CAT_CAFE_ANTHROPIC_PROFILE_MODE === 'subscription'` | 同样清那四个，return |
| 其余（直连 env） | `ANTHROPIC_API_KEY` ← `CAT_CAFE_ANTHROPIC_API_KEY` ?? `OPENCODE_API_KEY` ?? 构造参数；`ANTHROPIC_BASE_URL` ← `CAT_CAFE_ANTHROPIC_BASE_URL` ?? 构造参数；最后把中间变量 `OPENCODE_API_KEY` / `OPENCODE_BASE_URL` 置 null 不外泄 |

`OC_INSTRUCTIONS_ONLY_ENV = 'CAT_CAFE_OC_INSTRUCTIONS_ONLY'` 这个例外是 F203 Phase I 加的：只注 L0 instructions、不注自定义 provider 的配置**不能**清掉原生认证。

`invoke()` 里还有一句硬清【源码】：

```ts
childEnv.ALLOWED_WORKSPACE_DIRS = null;
```

注释：Clowder AI MCP 的工作区以 `OPENCODE_CONFIG` 里的 `mcp.cat-cafe.environment` 为准，别让账号级的陈旧工作区 env 漏进父进程去和 invocation 级配置抢。

`summarizeOpenCodeEnvForDebug()` 会把状态归成四类 mode：`runtime-config` / `subscription` / `direct-env` / `empty`，密钥类只留前 6 个字符 + `***`。

#### 3.7.4 运行时配置文件

两个写入函数（在 `opencode-config-writer.ts`）：

- `writeOpenCodeRuntimeConfig(projectRoot, catId, invocationId, options, workingDirectory?)` —— 完整版
- `writeOpenCodeInstructionsOnlyConfig(projectRoot, catId, invocationId, instructions, externalDirectories?)` —— 只有 `$schema` + `instructions`（+ 可选 `permission`）

路径都是 `<projectRoot>/.cat-cafe/oc-config-<safeCatId>-<safeInvocationId>/opencode.json`，`sanitizePathSegment()` 把非 `[a-zA-Z0-9._-]` 换成 `-`。写入是**原子**的：先写 `.tmp-<pid>` 再 `renameSync`。

配置结构【源码 `generateOpenCodeRuntimeConfig()`】：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "<provider>/<model>",
  "small_model": "<同上>",
  "provider": { "<configName>": {
      "npm": "@ai-sdk/openai-compatible",
      "models": { "<modelName>": {"name":"<modelName>"} },
      "options": { "baseURL": "{env:CAT_CAFE_OC_BASE_URL}", "apiKey": "{env:CAT_CAFE_OC_API_KEY}" }
  }},
  "mcp": { "...": {...} },
  "instructions": ["<L0 文件路径>", "OPENCODE.md"],
  "permission": { "external_directory": { "/some/dir/**": "allow" } }
}
```

`apiType` → npm adapter 映射表【源码】：

```
openai            → @ai-sdk/openai-compatible   (chat/completions，自定义 provider 默认)
openai-responses  → @ai-sdk/openai              (responses API，官方端点)
anthropic         → @ai-sdk/anthropic
google            → @ai-sdk/google
```

`deriveOpenCodeApiType(providerName)` 只看 provider 名字（注释说明：账号级 protocol 字段已从 UI 移除，不再驱动运行时路由）。

**`safeProviderName()` 的坑**：

```ts
const OPENCODE_BUILTIN_NAMES = new Set(['openai']);
export function safeProviderName(name) { return OPENCODE_BUILTIN_NAMES.has(name) ? `${name}-compat` : name; }
```

理由【源码注释】：OpenCode 把某些 provider 名当内建，强制走自己的 SDK 处理（`openai` → `sdk.responses()`），**忽略你写的 npm adapter**。所以要把名字改成 `openai-compat` 绕开。只有 `openai` 需要改名，`anthropic` / `google` 的内建行为本来就对。

`buildExternalDirectoryPermissions(dirs)`：每个目录归一化（去反斜杠、去尾斜杠）后生成 `{"<dir>/**": "allow"}`。理由（#935）：Windows 上 OpenCode 会拒绝碰工作目录之外的路径。

**用户 `opencode.json` 合并**：读 `<workingDirectory>/opencode.json` 的 `mcp` 字段，先删掉所有被我们管理的名字（`expandManagedMcpNamesForUserMerge([...resolveCapabilityMcpNamesSync(...), ...Object.keys(config.mcp)])`），再 `{...userMcp, ...config.mcp}`（我们的覆盖用户的）。

#### 3.7.5 事件解析：`transformOpenCodeEvent()`

事件外壳：`{ type, timestamp, sessionID, part?, error? }`。

| `type` | 产出 |
|---|---|
| `step_start` | `session_init(event.sessionID)`。**服务里只放行第一条**（`sessionInitEmitted` 门），后续 step_start 静默丢弃，避免重复 session 指标 |
| `text` | `part.type === 'reasoning'` → `system_info{type:'thinking'}`；否则 → `text(part.text)` |
| `reasoning` | `system_info{type:'thinking'}`（F161：以前掉进 default 被静默丢） |
| `tool_use` | `tool_use(part.tool ?? 'unknown', part.state.input)` |
| `error` | `error(error.data.message ?? error.name ?? 'opencode error')` |
| `step_finish` | `agent_loop` + `metadata.usage`（见下） |
| 其它 | null |

**`step_finish` 的 token 换算是重点**【源码】：

```ts
const totalInputTokens =
  freshInput != null || cacheRead != null || cacheWrite != null
    ? (freshInput ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0)
    : undefined;
```

注释解释后果：opencode 把缓存 token（`tokens.cache.read` / `.write`）**与 `tokens.input` 分开报**，而共享的 `TokenUsage` 契约要求 `inputTokens`/`lastTurnInputTokens` 是含缓存的总量。只抄 `tokens.input` 的话，一个长缓存会话（671 fresh + 21k cached）会看起来只有 671 → fillRatio 下溢 → handoff 在撞上下文墙之前永远不触发（clowder#915 R4 cloud P1 #1）。

三个"故意不做"的注释也值得记：
- `step_finish` 没有 token 数据时 **return null**，不发空的 `agent_loop` 标记
- **不**在 transformer 里塞默认 `contextWindowSize`（R5 cloud P2）：transformer 不知道模型在不在 `getContextWindowFallback` 表里，无条件塞默认值会把 `claude-opus-4-6` 的 200k 错误地压到 128k。兜底改在 `invoke-single-cat` 里当最后手段
- **不**把 `step_finish.reason`（`stop` / `tool-calls` / `length` / `content-filter`）泄漏进 `TokenUsage` 形状：invoke-single-cat 一律把 opencode 的 `agent_loop` 封存推迟到 `done`

服务层的 metadata 合并有个坑，源码里专门修过（clowder#915 R1 P1）：

```ts
const mergedMetadata = result.metadata?.usage != null
  ? { ...yieldMetadata, usage: result.metadata.usage } : yieldMetadata;
```

因为 transformer 只填了 `usage`（provider/model 是占位的空串），naive 的 `metadata: yieldMetadata` 展开看不到嵌套 key，会把 usage 抹掉。

样本【推断】：

```jsonl
{"type":"step_start","timestamp":1753000000000,"sessionID":"ses_01ABC"}
{"type":"reasoning","timestamp":...,"sessionID":"ses_01ABC","part":{"type":"reasoning","text":"先看测试…"}}
{"type":"text","timestamp":...,"sessionID":"ses_01ABC","part":{"type":"text","text":"我来改一下。"}}
{"type":"tool_use","timestamp":...,"sessionID":"ses_01ABC","part":{"type":"tool","tool":"edit","callID":"call_1","state":{"status":"completed","input":{"filePath":"a.ts"}}}}
{"type":"step_finish","timestamp":...,"sessionID":"ses_01ABC","part":{"reason":"stop","cost":0.0123,"tokens":{"input":671,"output":420,"total":22091,"cache":{"read":21000,"write":0}}}}
{"type":"error","timestamp":...,"sessionID":"ses_01ABC","error":{"name":"ProviderError","data":{"message":"model not found","statusCode":404}}}
```

#### 3.7.6 OpenCode 的 ACP 变体

`prepareOpenCodeAcpSpawnConfig()`（`opencode-acp-spawn-config.ts`）给 `opencode acp` 池化进程用：

- 只有 `clientId === 'opencode'` 才生效（`isOpenCodeAcpTarget`）。注释明确：泛型 ACP（`clientId === 'acp'`）**不会**通过嗅探命令 basename 被自动升级，与 env-map 路径的策略一致
- 写的 config **故意不含** per-invocation 的 instructions / MCP —— 因为 ACP 池是长生命周期进程，只在 spawn 时钉死 provider / model / 凭证（`invocationId` 硬编码成 `'acp-pool'`）
- `authType === 'api_key'` 但没 apiKey → 直接 throw
- 返回的 env 只有 `OPENCODE_CONFIG`（+ api_key 模式下的 `CAT_CAFE_OC_API_KEY` / `CAT_CAFE_OC_BASE_URL`）

---

### 3.8 Kimi（`KimiAgentService`）

#### 3.8.1 双 CLI 分叉

```ts
const kimiCommand = resolveCliCommand('kimi-cli') ?? resolveCliCommand('kimi');
const isLegacy = resolveCliCommand('kimi-cli') !== null;
```

**`isLegacy` 决定了几乎所有参数形状**：

| | legacy (`kimi-cli`) | 新版 (`kimi`) |
|---|---|---|
| 基础 args | `['--print','--output-format','stream-json']` | `['--output-format','stream-json']` |
| prompt | `--prompt <text>` | `-p <text>` |
| 工作目录 | `--work-dir <dir>` | ❌ |
| thinking | `--thinking`（模型支持时） | ❌ |
| MCP | `--mcp-config-file <path>` | ❌ |
| 图片目录 | `--add-dir <dir>` | ❌ |
| 接受的消息 role | 只 `assistant` | `assistant` 或 `meta` |
| thinking 抽取 | ✅ | ❌ |

`--session <id>` 和 `--model <m>` 两条路都有（后者只在**没有** apiKeyEnv 时才加）。

#### 3.8.2 session id 的四条获取途径（按代码顺序）

1. `options.sessionId` 存在 → 直接用，立刻 yield `session_init`
2. 从**纯文本行**里正则捞【源码】：

```ts
const match = line.match(/To resume this session:\s*kimi\s+-r\s+([a-z0-9-]+)/i);
```

（事件里带 `line` 字段且还没发过 session_init 时才试）
3. 新版 CLI 的 `role === 'meta'` 且 `type === 'session.resume_hint'` → `metaMsg.session_id`
4. 消息体里的 `session_id` / `sessionId`（`readSessionIdFromMessage`）
5. 全都没有 → 循环结束后 `readKimiSessionId(workingDirectory, callbackEnv)`：读 `<shareDir>/kimi.json` 的 `work_dirs[]`，按 `normalizeKimiWorkDirPath()`（`resolve` + `realpathSync` + `normalize`）匹配路径，取 `last_session_id`

`resolveKimiShareDir()` 优先级：`callbackEnv.KIMI_SHARE_DIR` > `process.env.KIMI_SHARE_DIR` > `~/.kimi`。

#### 3.8.3 模型别名与配置读取

`resolveKimiModelAlias(model, callbackEnv)`：
1. 有 `CAT_CAFE_KIMI_API_KEY` → 原样返回（API key 模式不查表）
2. model 含 `/` → 原样返回（已经是 `provider/model` 形式）
3. 否则读 `<shareDir>/config.toml` 的 `default_model = "..."`
4. 兜底 `DEFAULT_KIMI_MODEL_ALIAS = 'kimi-code/kimi-for-coding'`

`readKimiModelConfigInfo(alias, callbackEnv)` —— **手写 TOML 片段解析**（没引 TOML 库）：

```ts
const defaultThinkingMatch = raw.match(/^\s*default_thinking\s*=\s*(true|false)\s*$/m);
const sectionHeader = `[models."${modelAlias}"]`;
// 从 sectionStart 切到下一个 '\n[' 为止
const capsMatch = section.match(/^\s*capabilities\s*=\s*\[([^\]]*)\]/m);
const maxContextMatch = section.match(/^\s*max_context_size\s*=\s*(\d+)\s*$/m);
```

默认别名的兜底能力集是 `['thinking','image_in','video_in']`，兜底窗口 `262_144`。

`buildApiKeyEnv(model, callbackEnv)` 在有 `CAT_CAFE_KIMI_API_KEY` 时返回：

```ts
{ KIMI_API_KEY, KIMI_BASE_URL, KIMI_MODEL_NAME,
  KIMI_MODEL_MAX_CONTEXT_SIZE: callbackEnv?.KIMI_MODEL_MAX_CONTEXT_SIZE || '262144',
  ...(KIMI_MODEL_CAPABILITIES 有值时带上) }
```

`DEFAULT_KIMI_BASE_URL = 'https://api.moonshot.ai/v1'`。`normalizeKimiApiBaseUrl()` 有个专门的补丁：host 是 `api.kimi.com` 且 path 是 `/coding` 或 `/coding/` 时，改写成 `/coding/v1`。

#### 3.8.4 MCP 配置文件

`writeMcpConfigFile(workingDirectory, mcpServerPath, callbackEnv)` 和 Claude 的注入逻辑几乎一模一样（capabilities.json 项目优先 → 逐条转换 → 合并用户 `<workingDirectory>/.kimi/mcp.json`），差别在落盘：

```ts
const dir = mkdtempSync(join(shareDir, 'tmp-mcp-'));
writeFileSync(join(dir, 'mcp.json'), JSON.stringify({mcpServers}), { encoding:'utf8', mode: 0o600 });
```

注意是写在 **shareDir 下**而不是系统 tmp，权限 `0600`。`finally` 里 `rmSync(dirname(tempMcpConfig), {recursive:true, force:true})` 删掉。

**创建时机的坑**（源码里有专门注释，标了 clowder-ai#944 同类回归）：临时配置必须在**确认 kimi 二进制存在之后**才创建 —— 否则"两个 kimi 命令都找不到 + mcpServerPath 有值"时的提前 return 会跳过 `finally`，临时目录泄漏。

#### 3.8.5 prompt 拼装：`buildKimiPrompt()`

Kimi 是唯一用 XML 标签包 system prompt 的【源码】：

```
<system_instructions>
{systemPrompt}
</system_instructions>

<user_request>
{prompt + 图片路径提示}
</user_request>
```

#### 3.8.6 两条"能力降级告知"

Kimi 是唯一会主动告诉用户"我这个能力没有"的 provider【源码】，都用 `system_info{type:'provider_capability'}`：

| capability | status | 触发 | reason 文案 |
|---|---|---|---|
| `image_input` | `available` / `limited` | 有图片时发一次 | 支持：`已通过工作区附加目录 + 本地路径提示向 kimi-cli 暴露图片输入`；不支持：`当前 Kimi 模型未声明 image_in，已回退为本地路径提示` |
| `thinking` | `unavailable` | legacy CLI + 全程没抽到 thinking + 没有 CLI 错误 | 模型声明了 thinking：`kimi-cli 本次流式输出未提供可解析的 think/reasoning 内容`；没声明：`当前 Kimi 模型能力未声明 thinking，已按普通回答处理` |

`extractThinkingContent(msg)` 的查找顺序：`msg.thinking` → `msg.reasoning` → `msg.reasoning_content` → `msg.thought` → 再从 `msg.content` 数组里找 `block.think` / `block.reasoning` / `block.type==='thinking' && block.text`。

#### 3.8.7 上下文快照

`readKimiContextUsedTokens(sessionId, callbackEnv)`：在 `<shareDir>/sessions` 下 DFS 找名字等于 sessionId 的目录，取里面的 `context.jsonl`，读尾部 `KIMI_CONTEXT_TAIL_BYTES = 64 * 1024` 字节，从后往前找 `role === '_usage'` 且 `token_count` 是有限数的行。只有 `modelConfig.maxContextSize != null` 时才做，拿到后同时写 `contextUsedTokens` / `contextWindowSize` / `lastTurnInputTokens`。

---

### 3.9 ACP 家族（`acp/`）

ACP = Agent Client Protocol，NDJSON 承载的 JSON-RPC 2.0，跑在子进程 stdin/stdout 上。我们是 **client**，CLI 是 **agent**。

#### 3.9.1 方法表

【源码】`ACP_METHODS`：

```
Client → Agent 请求:  initialize / authenticate / session/new / session/load /
                      session/prompt / session/set_mode / session/set_config_option
Client → Agent 通知:  session/cancel（无响应）
Agent → Client 通知:  session/update
Agent → Client 请求（我们必须回）: session/request_permission / fs/read_text_file / fs/write_text_file
```

#### 3.9.2 真实报文（从 `AcpClient` 的收发代码逐字还原）

**初始化**：

```json
→ {"jsonrpc":"2.0","method":"initialize","id":"<randomUUID>","params":{"protocolVersion":1}}
← {"jsonrpc":"2.0","id":"<同上>","result":{
     "protocolVersion":1,
     "authMethods":[{"id":"oauth","name":"…","description":"…"}],
     "agentInfo":{"name":"gemini","title":"Gemini CLI","version":"0.36.0"},
     "agentCapabilities":{"loadSession":true,
        "promptCapabilities":{"image":true,"audio":false,"embeddedContext":true},
        "mcpCapabilities":{"http":false,"sse":false}}}}
```

**建会话**：

```json
→ {"jsonrpc":"2.0","method":"session/new","id":"…","params":{
     "cwd":"/abs/work/dir",
     "mcpServers":[{"name":"cat-cafe-collab","command":"/path/node","args":["/…/collab.js"],
                    "env":[{"name":"CAT_CAFE_API_URL","value":"http://…"}]}]}}
← {"jsonrpc":"2.0","id":"…","result":{"sessionId":"sess_abc",
     "configOptions":[{"id":"model","category":"model","currentValue":"gemini-3-pro",
                       "options":[{"value":"gemini-3-pro"},{"value":"gemini-3-flash"}]}],
     "modes":{"availableModes":[…],"currentModeId":"default"}}}
```

注意 MCP 的 env 是**数组**（`Array<{name, value}>`），不是对象 —— 这是 ACP 规范的形状。

**发 prompt + 流式回**：

```json
→ {"jsonrpc":"2.0","method":"session/prompt","id":"…","params":{
     "sessionId":"sess_abc","prompt":[{"type":"text","text":"…"}]}}
← {"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_abc",
     "update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"我先…"}}}}
← {"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_abc",
     "update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"好的"}}}}
← {"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_abc",
     "update":{"sessionUpdate":"tool_call","toolCallId":"tc_1","title":"ReadFile",
               "status":"completed","content":{"type":"text","text":"…file…"}}}}
← {"jsonrpc":"2.0","id":"…","result":{"stopReason":"end_turn"}}
```

`stopReason` 取值【源码 `AcpStopReason`】：`end_turn` / `max_tokens` / `max_turn_requests` / `refusal` / `cancelled`。

**权限请求（agent → 我们）**：

```json
← {"jsonrpc":"2.0","id":"req_9","method":"session/request_permission","params":{
     "sessionId":"sess_abc",
     "options":[{"optionId":"allow_once","kind":"allow_once","name":"允许一次"},
                {"optionId":"approve_for_session","kind":"allow_always","name":"本会话都允许"}]}}
→ {"jsonrpc":"2.0","id":"req_9","result":{"outcome":{"outcome":"selected","optionId":"approve_for_session"}}}
```

默认处理器的选择优先级【源码】：`kind === 'allow_always'` > `kind === 'allow_once'` > `options[0]` > 字面量 `'allow_once'`。注释理由：优先 session 级授权，免得每个 MCP 工具调用都弹一次。响应必须**双层包裹** `{outcome: {outcome: 'selected', optionId}}` —— 这是 ACP 规范。

不认识的 agent 请求一律回 `{"error":{"code":-32601,"message":"Client does not handle <method>"}}`。

#### 3.9.3 消息路由：`startReading()` 的四分支

【源码】按行读 stdout，`JSON.parse` 失败只 warn 不 throw。然后：

```
有 id、在 pending 里、没有 method  → 这是我们请求的响应，resolve
有 method、有 id                   → agent 发来的请求，handleAgentRequest（放在通知判断之前！）
有 method、没有 id：
    method === session/request_permission → Gemini 在非 yolo 模式下把权限请求发成了通知（没有 id）。
        补一个合成 id `synth-perm-${Date.now()}` 走 handleAgentRequest（best-effort，Gemini 可能忽略），
        同时给流监听器注入一条合成的 `permission_pending` 事件，让空闲看门狗知道现在是等待而不是卡死
    其它 → 普通通知，广播给 notificationListeners
```

**`id: 0` 的坑**【源码注释】：

```
#712: id can be 0 (Kimi CLI uses numeric ids starting at 0).
`0` is falsy in JS, so use explicit null check instead of truthiness.
```

所以代码是 `const hasId = id !== undefined && id !== null`，而且 "有 method + 有 id" 的判断必须排在"有 method + 没 id"之前，否则 Kimi 的 id:0 会被误路由。

#### 3.9.4 MCP 能力过滤

`filterMcpByCapabilities(servers)`【源码】依据 ACP 规范：

- **stdio 是强制的**，所有 ACP agent 必须支持，**不会**出现在 `mcpCapabilities` 里 → 有 `command` 没 `type` 的一律放行
- `type === 'http'` → 需要 `mcpCapabilities.http === true`
- `type === 'sse'` → 需要 `mcpCapabilities.sse === true`
- 未知 type → 丢弃
- 拿不到 `initResult` → 全放行（向后兼容的宽松兜底）

#### 3.9.5 三层超时/看门狗（`promptStream()`）

这是 ACP 最值得讲的一段【源码】：

| 机制 | 默认值 | 触发后 |
|---|---|---|
| **活动型回合预算** `timeoutMs` | 900_000（15 分钟） | 每收到一个事件就 `resetBudget()` 重置。持续产事件就永不触发；只有**沉默** 15 分钟才炸 → `cancelSession` + `AcpTimeoutError` |
| **空闲警告** `idleWarningMs` | 20_000 | 注入合成事件 `stream_idle_warning`（或 `stream_tool_wait_warning`，见下） |
| **空闲卡死** `idleStallMs` | 90_000 | `cancelSession` + `AcpStreamIdleError` |
| **工具执行天花板** | 180_000（3 分钟，函数内局部常量 `TOOL_EXECUTION_CEILING_MS`） | 即使 `pendingTool` 为 true 也强制终止 |
| **硬顶** `HARD_CEILING_MS` | 3_600_000（1 小时） | 传给 `sendRequest` 的绝对最后防线 |

`scheduleIdleCheck()` 的一个 P1 修复值得单独说：

```ts
const nextMs = idleWarningFired ? Math.max(0, idleStallMs - idleWarningMs) : idleWarningMs;
```

注释：卡死延时是相对 `lastEventAt` 算的，不是相对警告 —— 警告在 20s、卡死在 45s 时，卡死定时器应该在警告后 **25s** 触发。上报的 `idleSinceMs` 还会 clamp 到触发它的那个阈值（`Math.max(rawIdle, idleWarningFired ? idleStallMs : idleWarningMs)`），保证"阈值事件绝不报告小于自身触发点的时长"。

**`pendingTool` 状态机**【源码】：

```
updateType === 'tool_call' || 'permission_pending'                     → pendingTool = true
pendingTool 且 updateType 既不是 'tool_call_update' 也不是 'agent_thought_chunk' → pendingTool = false
```

注释解释为什么 `agent_thought_chunk` 要豁免：`Thought chunks during tool execution are normal — don't reset`。
以及为什么需要 `TOOL_EXECUTION_CEILING_MS`：修复前 `pendingTool` 会**无限期压制** stall 检测且不重新排期，导致会话（尤其 kimi-acp）在工具挂死时一直阻塞到 15 分钟回合预算。

#### 3.9.6 容量信号（stderr 嗅探）

```ts
const CAPACITY_RE = /MODEL_CAPACITY_EXHAUSTED|No capacity available|status 429.*Retrying/i;
```

命中就构造 `{message: text.slice(0,300), timestamp}`，同时写进 `_recentCapacitySignal`（client 级）和广播给 `capacityListeners`。`promptStream` 注册的 `capacityInjector` 会把它**注入事件队列**成 `provider_capacity_signal` 合成事件。注释解释为什么要注入队列而不只是回调：

```
This breaks through zero-event stalls where the for-await loop blocks
on an empty queue — the signal resolves waitResolve immediately.
```

`AcpAgentService` 的错误分类里，容量信号有**两级证据**【源码 `classifyError`】：
1. `capacitySignal`（本次 invoke 实时抓到）→ `evidence: invoke_signal`
2. `clientRecentSignal` 且 `Date.now() - timestamp < RECENT_SIGNAL_MAX_AGE_MS`（10 分钟）→ `evidence: recent_process_signal, <N>s ago`（应对 CLI 缓冲导致的延迟 stderr）
3. 都没有 → `turn_budget_exceeded`

catch 分支里还有一个 2 秒宽限：`if (!capacitySignal && err instanceof AcpTimeoutError) await sleep(2_000)` —— 给迟到的 stderr 一个窗口。

#### 3.9.7 `AcpAgentService.invoke()` 的四个 abort 窗口

【源码文件头注释】`4-window abort coverage (pre-invoke, post-newSession, post-yield, during-prompt)`：

```
Window 1: 进函数就 signal.aborted → yield error(prompt_failure: aborted before start) + done
Window 2: newSession/loadSession 之后 → cancelSession + error(aborted during session setup) + done
Window 3: yield session_init 之后（消费者可能在 yield 期间 abort）→ cancelSession + done
Window 4: promptStream 期间由 onAbort 监听器覆盖 → client.cancelSession(sessionId)
```

#### 3.9.8 session 复用与降级

```
options.sessionId 存在 → client.loadSession(id, cwd, mcpServers)
    成功 → sessionId = result.sessionId || 请求的 id；pool.rememberSession(...)；isResumedSession = true
    失败 → resumeSessionLoadFailed = true，log.warn，落到 newSession
newSession → session/new → 若配了 sessionModel 且 configOptions 里有 model 选项 → session/set_config_option
```

`resolveSessionModelConfigOption()` 的四道校验【源码】：configOptions 是数组 → 找 `id === 'model' || category === 'model'` 的项 → `configId` 非空 → **`currentValue` 已经等于目标就返回 null**（不白发一次请求）→ 若该项有 `options[]` 且目标不在里面也返回 null。设置失败只 warn，继续用 agent 默认模型。

`resumeFallbackSystemPrompt` 就是给这个降级路径用的【源码】：

```ts
const fallbackSystemPrompt = resumeSessionLoadFailed && options?.resumeFallbackSystemPrompt
  ? options.resumeFallbackSystemPrompt : undefined;
const effectivePrompt = options?.systemPrompt ? `${options.systemPrompt}\n\n${prompt}`
  : fallbackSystemPrompt ? `${fallbackSystemPrompt}\n\n${prompt}` : prompt;
```

注释：外层 invocation 因为预期"会话有记忆"而跳过了身份注入，降级成新会话后必须补一次。

#### 3.9.9 事件转换：`transformAcpEvent()`

**两种事件外壳都要认**【源码】：

```ts
const inner = (update.update ?? update) as Record<string, unknown>;
```

注释：Gemini CLI 有嵌套（`params.update.sessionUpdate`，符合 ACP 规范）和扁平（`params.sessionUpdate`，v0.35.3 实测）两种形态。

**字段名容错**（`resolveToolName` / `resolveToolInput`）：
`toolName` → `name` → `tool_name` → `title`（v0.36 生产载荷里观察到用 title）；`toolInput` → `input` → `tool_input`。

**tool_use ↔ tool_result 配对状态机**（F197）：状态是 `AcpSessionState` 的两个 Set：

```ts
emittedToolUseByCallId: Set<string>   // 已发过 tool_use 的 toolCallId
finalEmittedByCallId:   Set<string>   // 已发过终态 tool_result 的 toolCallId
```

规则（`isFinalStatus(s)` 只认 `'completed' | 'failed'`，KD-6）：

| 事件 | 状态 | 之前发过 tool_use？ | 产出 |
|---|---|---|---|
| `tool_call` | 终态 | 是 | 只发 `tool_result` |
| `tool_call` | 终态 | 否 | `[tool_use, tool_result]` |
| `tool_call` | 非终态 | — | 只发 `tool_use`，登记 |
| `tool_call` / `tool_call_update` | 终态 | **已在 `finalEmittedByCallId` 里** | **null**（防 ACP 重放同一终态事件） |
| `tool_call_update` | 非终态 | 是 | null（进度更新不重发，避免 Recall 侧双 pending） |
| `tool_call_update` | 非终态 | 否 | 发 `tool_use` + 登记 |
| `tool_call_update` | 终态 | 否 | `[tool_use, tool_result]`（AC-A3：首次出现就是终态更新，不能留孤儿） |

终态时 `content` 缺失也**必须**发 tool_result（cloud-1 P1×2），`content: content?.text ?? ''` —— 空串是"无载荷"的规范标记。修复前那条分支会掉下去只发 tool_use，工具永远挂在 pending。

**thinking 聚合**：`agent_thought_chunk` 只往 `state.thinkingBuffer` 累加、返回 null；遇到任何非 thinking 事件时先 `flushAcpThinking()` 吐一条 `system_info{type:'thinking'}`，用 `withFlush()` 包装返回值（有 flush 就变数组）。流结束和 catch 分支都会再 flush 一次。

**OpenCode 压缩草稿纸抑制**（很偏但很典型的实战补丁）【源码】：

```ts
const SCRATCHPAD_MARKER = '## Goal';
const SCRATCHPAD_COMPANION_MARKER_RE = /(?:^|\n)(?![ \t]*#{1,6}\s)[ \t]*Constraints & Preferences\b/;
const SCRATCHPAD_TAIL_CHARS = 800;
```

模型会模仿 compaction 模板往正文里写草稿纸。判定要求 `## Goal` **和**一个不是标题形式的 `Constraints & Preferences` 同时出现（单独一个 `## Goal` 是正常 Markdown）。检测跨 chunk：`combined = state.textTail + text`，`textTail` 保留最后 800 字符。命中后：只吐 marker 之前的干净部分（`text.slice(0, markerIdx - textTail.length)` 再去尾部空白），并置 `scratchpadDetected = true`，之后所有文本块全丢。

配套的**熔断器**在 `AcpAgentService` 里：

```ts
const MAX_SCRATCHPAD_SUPPRESSED_EVENTS = 50;
```

检测到草稿纸后事件还在流 → 说明 OpenCode 陷入了 compaction → auto-continue 循环 → 超过 50 条就 `cancelSession` + throw，止血烧 token。

#### 3.9.10 进程池

`AcpProcessPool`：`PoolKey = {projectPath, providerProfile}`，序列化成 `` `${projectPath}::${providerProfile}` ``。`DEFAULT_ACP_IDLE_TTL_MS = 30 * 60 * 1000`（30 分钟）。`evictionPolicy: 'lru'`。
指标：`liveProcessCount` / `activeLeaseCount` / `idleProcessCount` / `warmHitCount` / `coldStartCount` / `evictionCount` / `zombieCleanupCount`。
`PoolEntry` 有个 `leaseGeneration`，在强制释放陈旧 lease 时自增，让旧 lease 的 release 闭包变成 no-op（#992）。
`sessionOwners: Map<string, PoolEntry>` 记住"哪个进程持有哪个 session"，key 是 `` `${poolKey}::${sessionId}` `` —— `acquire({sessionId})` 时优先返回同一个进程。
`createAcpPoolSpawnSignature()` 把 `{cmd, args, cwd, env, openCodeRuntimeConfig, maxLiveProcesses, idleTtlMs, transport, supportsMultiplexing}` JSON 化成签名，配置变了就换池。

`AcpClient.close()` 的杀进程节奏：`SIGTERM` → 等 `KILL_GRACE_MS = 3_000` → 还没退就 `SIGKILL`。注意 exit 监听器是**在 kill 之前**注册的（防同步 emitter 竞态）。

---

### 3.10 A2A（`A2AAgentService`）—— 最薄的一个

不是 CLI，是 HTTPS JSON-RPC 2.0。整个 invoke 就一次 `fetch`：

```json
POST <config.url>
Headers: Content-Type: application/json [, Authorization: Bearer <apiKey>]
Body: {"jsonrpc":"2.0","id":"<taskId=randomUUID>","method":"tasks/send",
       "params":{"id":"<taskId>","message":{"role":"user","parts":[{"type":"text","text":"<prompt>"}]}}}
```

超时默认 `120_000`，用 `AbortSignal.any([AbortSignal.timeout(ms), options.signal])` 合并。

`transformA2ATaskToMessages(task, catId)`：

- 先归一化状态（`normalizeStatus`）：`TASK_STATE_SUBMITTED/WORKING/COMPLETED/FAILED/CANCELED/INPUT_REQUIRED` → `submitted/working/completed/failed/canceled/input-required`；表里没有的走 `status.toLowerCase().replace(/_/g,'-')`
- `completed`：遍历 `artifacts[].parts`，text 部分拼成一条 `text`；`type==='file'` 的额外发一条 `[File: <name> (<mimeType>)]`。artifacts 一条都没产出时**回退到 history**：反向找最后一条 `role === 'agent'` 的消息。最后追加 `done`
- `failed` → `error('A2A task failed')`
- `input-required` → `system_info('A2A agent requires additional input')`

取消语义【源码】：catch 里区分"调用方主动取消"和"超时"——`options?.signal?.aborted === true` 时 yield **`done`**（优雅取消），否则 yield `error`。

Phase 3 范围只有 `tasks/send`，流式（`tasks/sendSubscribe`）是 Phase 4。

---

### 3.11 CatAgent（`catagent/CatAgentService`）—— 不走 CLI 的对照组

直连 Anthropic Messages API（SSE 流式），是"如果不用 CLI 会怎样"的活样本。常量【源码】：

```ts
const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MAX_TOKENS = 4096;
const MAX_TOOL_TURNS = 15;
const TOOL_RESULT_DIGEST_LIMIT = 500;
```

请求：`POST ${baseURL}/v1/messages`，header 是 `x-api-key` + `anthropic-version`，body `{model, max_tokens, messages, stream: true}`（有工具就加 `tools`，有 systemPrompt 就加 `system`）。**严格流式 fail-closed，没有非流式回退**（文件头注释原文）。

agentic loop：最多 15 轮，每轮 `fetchApi` → `consumeTurn`（消费 SSE）→ 终止判定 → 执行工具 → 把 `assistant` 内容块 + `tool_result` 数组塞回 messages。

`executeCatAgentTools()` 的三条分支决定 `status`【源码注释 KD-38 honesty】：

```
未知工具        → status:'error'，content 前缀 "Error: unknown tool"
执行成功        → status:'ok'，不管返回文本长什么样
抛异常（schema 校验失败 / execute reject）→ status:'error'
```

注释特别强调：状态来自**执行边**（有没有抛异常），不是从 content 字符串里猜 —— 一个工具合法地返回以 `"Error:"` 开头的文本（比如日志内容）不该被标成 error。

`sessionId` 是自造的：`` `catagent-${Date.now()}-${Math.random().toString(36).slice(2,8)}` ``。
流中断（`hadStreamError`）时，会给所有"已经发出 tool_use 但还没执行"的孤儿工具补发 `tool_result`，`content: 'Error: stream interrupted before tool execution'`，`toolResultStatus: 'error'` —— 保证配对不留孤儿。
`consumeTurn` 收尾时按 `blockIndex` 排序重建内容块（P1：保留完整 assistant 内容）。

---

### 3.12 跨 provider 的两条公共机制

#### 3.12.1 图片怎么进各个 CLI

三个工具函数（`image-paths.ts` + `image-cli-bridge.ts`）：

```ts
extractImagePaths(contentBlocks, uploadDir)
  // block.type === 'image' 且 url 以 '/uploads/' 开头 → resolve(uploadDir, 剩余部分)
  // url 以 '/' 开头 → resolve(url)
  // 其它（http/https）→ 不产出路径
extractImageUrls(contentBlocks)          // F211-REG3 Layer B：给外部 runtime 用的 HTTP url
collectImageAccessDirectories(paths)     // 去重后的 dirname 列表
appendLocalImagePathHints(prompt, paths) // 追加 "\n\n[Local image path: <p>]"（多行用 \n 连）
buildImageMediaItems(paths)              // F211 REG3 Layer C：读文件 → {mimeType, inlineData: base64}
```

各 provider 的实际做法：

| Provider | 手段 |
|---|---|
| Claude `-p` / PTY | 路径提示 + `--add-dir <每个图片目录>`（注释：print 模式没有直接的图片附加旗标） |
| Claude `--bg` | ❌ 完全没有 |
| Codex | **`--image <path>` 原生旗标**（唯一一个） |
| Gemini CLI | 路径提示 + `--include-directories <dir>`（注释：`-i` 是交互式的，和 `-p` 冲突） |
| AGY | 路径提示 + `--add-dir <dir>` |
| Kimi | 路径提示（包在 `<user_request>` 里）+ legacy CLI 的 `--add-dir` + 一条 `provider_capability` 告知 |
| Antigravity IDE | **base64 内联**（`buildImageMediaItems` → `SendUserCascadeMessage.media`）。注释说明：只给文字路径提示不行，Antigravity 的 `view_file` 渲染不了 |
| OpenCode / ACP / A2A / CatAgent | ❌ |

`IMAGE_EXT_TO_MIME` 映射（`image-cli-bridge.ts`）：`.png→image/png`、`.jpg/.jpeg→image/jpeg`、`.gif→image/gif`、`.webp→image/webp`。`buildImageMediaItems` 对不认识的扩展名和读不出来的文件**静默跳过**（best-effort，缺一张图不能搞挂整次调用）。

**反向：CLI 生成的图片怎么回来** —— `publishGeneratedImage()`（`generated-image-publication.ts`）：

```ts
publicationStem = sanitizeFilenameStem(`${sanitize(publicationKey)}-${sha256(publicationKey).slice(0,8)}`)
```

先 `access()` 探一下目标文件在不在（决定 `isNew`），再 `copyImageFileToUploadDir({onExists:'reuse'})`。返回的 `richBlock` 是 `{id: 'generated-image-<stem>', kind:'media_gallery', v:1, items:[{url,alt}], provenance}`，`provenance` 记 `{provider, toolName, prompt?, originalPath, publishedPath, publicationKey}`。只有 `isNew` 的才向上吐消息（幂等）。

#### 3.12.2 `env-map.ts`：模板化的凭证映射

【源码】解析优先级（文件头注释原文）：

```
1. User-defined env map (from account/member envVars with ${...} templates)
2. Built-in map by provider name (for opencode multi-provider routing)
3. Built-in map by clientId (for direct-provider clients like anthropic/google)
4. Empty (OAuth / self-managed credential — no injection needed)
```

支持的四个模板变量：`api_key` / `base_url` / `base_model` / `model`（`model` 和 `base_model` 都取 `account.baseModel`）。模板正则 `/\$\{(\w+)\}/g`。

`BUILTIN_ENV_MAPS`（源码字面）：

| key | 映射 |
|---|---|
| `anthropic` | `ANTHROPIC_API_KEY=${api_key}`、`ANTHROPIC_BASE_URL=${base_url}` |
| `openai` | `OPENAI_API_KEY`、**`OPENROUTER_API_KEY`**、`OPENAI_BASE_URL`、`OPENAI_API_BASE`（注释：legacy alias for older SDKs） |
| `google` | `GEMINI_API_KEY`、`GOOGLE_API_KEY`、**`OPENROUTER_API_KEY`**、`GEMINI_BASE_URL` |
| `opencode` | `OPENCODE_API_KEY`、`OPENCODE_BASE_URL` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `kimi` | `MOONSHOT_API_KEY` |

`openai` 和 `google` 里那个 `OPENROUTER_API_KEY` 有专门注释解释（`OPENROUTER_COMPAT_ENV_ALIAS_CLIENTS`）：这是为了 OpenCode 路由兼容的**别名**，不是 provider 身份转换。

**合并规则是 merge 不是 replace**（P2 fix）：`pickTemplate()` 返回 `{...builtinMap, ...userTemplates}` —— 用户同名 key 覆盖内建条目，但不会把整张内建表冲掉。

**两道 sanitize**【源码】：

```ts
const VALID_ENV_KEY = /^[A-Z_][A-Za-z0-9_]*$/;
if (envKey.startsWith('CAT_CAFE_') || !VALID_ENV_KEY.test(envKey)) continue;   // 拒绝保留前缀 + 畸形 key
if (resolved) result[envKey] = resolved;                                       // 空值不注入
```

`extractUserEnvTemplates()` 只挑出**含受支持模板变量**的条目 —— 不含模板的普通 env 由 `accountEnv` 那条路走。

---

<!-- BEGIN INLINE SOURCE EXPANSION 26-FLOW -->
### 3.13 源码执行复盘：以 Codex Provider 为例追完 command、env、parser、abort

Provider 层的目标不是“执行一条命令”，而是把统一的 `AgentServiceOptions` 翻译成某个 CLI 的进程协议，再把 CLI 事件翻回统一 `AgentMessage`。

#### 1. 先计算模型、L0 和命令参数

`CodexAgentService.invoke(prompt, options)` 先决定 effective model、reasoning 配置、MCP 配置和 L0 注入方式。若 L0 编译失败，源码 fail-closed：不 spawn CLI，而是 yield `error + done`。这是安全规则缺失时宁可不执行，而不是悄悄以无治理 prompt 继续。

主 prompt 不放 argv，而通过 stdin 传入。源码注释给出了真实原因：argv 可能被系统进程列表观察，也可能在并发/转义时产生污染；`--` 结束选项解析，`-` 表示从 stdin 读正文。`claude-agent-service.test.js` 也有“长主 prompt 经 stdin、不进入 argv”的对应测试。

#### 2. env 不是一次对象展开就结束

可以把环境变量按来源分成：

- 父进程基础环境；
- `callbackEnv`：本次调用身份、API 地址、callback token 等；
- `accountEnv`：账号凭据、base URL 等；
- Provider 自己生成的临时路径/配置；
- deny-list：某些认证模式必须删除继承的敏感变量。

合并顺序很重要，**删除动作也必须在最终合并后仍然生效**。例如 Claude 测试覆盖 subscription profile 清除继承的 `ANTHROPIC_*`，并防止 accountEnv 又把代理 bearer token 加回来。安全测试视角下，这属于凭据隔离和优先级绕过测试。

#### 3. spawn 前后要区分四类失败

1. 配置/编译失败：尚未 spawn；
2. CLI 不存在：spawn `ENOENT`；
3. 进程启动后非零退出；
4. 进程有输出但协议内容表示 error。

统一契约要求这些路径尽量都产生 `error + done`，避免消费者永远等待。`catagent-provider.test.js`、`gemini-agent-service.test.js` 都验证 credential/network/非零退出/abort 后不会悬挂。

#### 4. Codex JSONL 事件怎样映射

典型映射可记为：

- `thread.started` → `session_init`，保存 thread/session ID；
- item 中的文本增量/完成 → `text`；
- 工具相关 item → `tool_use` / `tool_result`；
- `turn.completed` → 汇总 usage，但不一定原样向前端展示；
- CLI timeout/spawn error → `error`；
- Provider 自己在流尾补 `done`。

`thread.started` 只说明会话建立，不算实质输出。源码因此不会仅凭它就抑制后续非零退出错误；只有真正 item output 后，某些已知“完成后假失败”才可能被抑制。

#### 5. session 是 Provider 翻译差异最大的字段

统一 options 中是 `sessionId?: string`，不同 CLI 的翻译不同：

- Claude 可能生成 `--resume <id>`；
- Gemini 有自己的 resume 参数；
- Codex 使用 thread/session 事件和对应续接机制；
- 某些载体是 ephemeral，根本不保证跨调用恢复。

因此路由层只表达“希望恢复这个 session”，Provider 决定具体参数。测试 `claude-agent-service.test.js` 和 `gemini-agent-service.test.js` 都分别断言有/无 sessionId 时 CLI 参数是否出现。

#### 6. abort 必须从 HTTP 一直传到子进程

取消链应是：前端取消 → Router/QueueProcessor controller → `invokeSingleCat` 合并 signal → `AgentServiceOptions.signal` → CLI runner 杀进程/停止读流 → Provider yield 终态 → 外层 finally 清理。

如果 Provider 只停止解析 stdout、不终止子进程，会形成后台僵尸；如果只杀进程、不补 done，前端会卡住。Provider 契约因此同时约束“资源终止”和“协议终止”。

#### 7. 面试时画四条线

```text
command: options -> args/config -> spawn
    env: parent + callback + account - denyList -> child env
 parser: stdout/stderr/JSONL -> AgentMessage
  abort: UI -> AbortSignal -> child process -> error/done/cleanup
```

只要这四条线都能从入口追到终点，你就真正看懂了一个 Provider，而不是只会说“它封装了 CLI”。
<!-- END INLINE SOURCE EXPANSION 26-FLOW -->

## 4. 关键算法与判定逻辑

### 4.1 `classifyCarrierFailure(error)` —— 三类失败判定

【源码】表驱动，两张正则表，顺序敏感（quota 先于 structural）：

```
QUOTA_PATTERNS（命中任一 → 'quota'）:
  /usage[\s_-]*limit/i
  /rate[\s_-]*limit/i
  /\b429\b/
  /weekly[\s_-]*limit/i
  /credit/i
  /capacity[\s_-]*exhausted/i
  /no[\s_-]*capacity[\s_-]*available/i

STRUCTURAL_PATTERNS（命中任一 → 'structural'）:
  /spawn[\s_-]*failed/i
  /\bENOENT\b/
  /\bEACCES\b/
  /could not parse short id/i
  /L0 compile failed/i
  /command not found/i
  /exited code=(?!0\b)\d+/i        ← 负向先行断言：非零退出码才算
  /transcript read failed/i

都没命中 → 'transient'（默认，未知错误不触发降级）
```

注释里标了每条正则的来源：quota 来自 `claude CLI rate limit banner, SDK 429, AcpClient MODEL_CAPACITY_EXHAUSTED`；structural 来自 `ClaudeBgCarrierService CarrierError (spawn/exit/parse/L0), ClaudeInteractivePtyCarrierService spawn failures`。还有一条坦诚的 OQ：`real error strings may vary — recalibrate from production logs post-deploy`。

注意 `/exited code=(?!0\b)\d+/i` 里的 `(?!0\b)` —— `exited code=0` 不算结构性失败（正常退出），`code=1`/`code=127` 才算。

> **面试官追问："为什么未知错误默认是 transient 而不是 structural？"**
> 「因为降级是有代价的：quota 粘 4 小时、structural 粘 30 分钟，期间整个账号的这只猫都用不了首选载体。宁可对未知错误保守 —— 但也不是完全不管：连续 3 次 transient 会升级成 structural。这是 D1 决策里"3 次"这个魔法数字的来源。」

### 4.2 `CarrierHealthStore` 状态机

```
                  ┌──────────┐
     recovery /   │ healthy  │ ◀── reportRecovery(tier)（清 cache + transient 计数）
     TTL 到期     └────┬─────┘
        ▲              │ reportFailure(tier, 'quota')     → retryAfter = now + 4h
        │              │ reportFailure(tier, 'structural') → retryAfter = now + 30min
        │              │ reportFailure(tier, 'transient')  → transientCounts[tier]++
        │              │      count < 3 → return（不降级）
        │              │      count == 3 → 按 structural 降级 + 清计数
        │              ▼
        │        ┌────────────────────────────────────────┐
        └────────┤ degraded { reason, since, retryAfter } │
                 └────────────────────────────────────────┘
                        │
                        │ isHealthy(tier) 在 Date.now() >= retryAfter 时返回 true
                        │ → 进入「探测窗口」：下一次调用会试这个 tier
                        │   成功 → FallbackCarrierWrapper 调 reportRecovery
                        │   失败 → 重新 reportFailure，retryAfter 重新计时
```

关键代码【源码】：

```ts
isHealthy(tier) {
  if (tier === 'api_key') return true;                    // 永远健康
  const health = this.getHealth(tier);
  if (health.state === 'healthy') return true;
  return Date.now() >= health.retryAfter;                 // TTL 过了 → 探测窗口
}
```

注意 `isHealthy()` 在 TTL 过期后返回 true，但 `getHealth().state` **仍然是 `'degraded'`** —— 这是 `FallbackCarrierWrapper` 判断"这次是不是探测窗口成功"的依据【源码 P2 fix】：

```ts
const healthAfterStream = this.store.getHealth(this.activeTier);
if (healthAfterStream.state === 'degraded') {
  this.store.reportRecovery(this.activeTier);     // 探测窗口跑通了 → 正式恢复
} else {
  this.store.resetTransientCount(this.activeTier); // 健康 tier 成功 → 打断 transient 连击
}
```

注释解释 `resetTransientCount` 的必要性（Cloud P2 fix）：D1 说的是"**连续** 3 次"，一次成功必须打断这个连击。

**内存 + Redis 双写**【源码】：

- 内存是主（`cache: Map<CarrierTier, DegradedState>`、`transientCounts: Map<CarrierTier, number>`），工厂函数是**同步**读的
- Redis 是 fire-and-forget 副本：`syncToRedis()` 里 `this.redis.set(key, JSON.stringify(state)).catch(() => {})` —— 失败静默
- key 格式：`` `carrier:health:${tier}` ``
- 启动时 `loadFromRedis()` 遍历 `DEGRADATION_CHAIN`（跳过 `api_key`），**只恢复 `parsed.retryAfter > Date.now()` 的**（过期的不恢复）。任何异常静默吞掉 → 该 tier 当健康处理

> **面试官追问："为什么内存是主、Redis 是副本，而不是反过来？"**
> 「因为工厂函数 `createClaudeAgentServiceForCanary()` 必须**同步**返回一个 `AgentService`（接口签名如此）。如果健康状态要从 Redis 读，工厂就得变成 async，整条装配链都要改。所以设计成：读走内存（同步、零延迟），写双写（内存 + Redis 异步），Redis 只解决"进程重启后不要忘记 4 小时的配额降级"这一个问题。代价是多实例部署时降级状态不共享 —— 每个进程各降各的。」

### 4.3 `selectFirstHealthyTier(target, store)`

```
① idx = DEGRADATION_CHAIN.indexOf(target)
② idx === -1（未知 tier）→ 原样返回（no-op 安全默认）
③ for i = idx .. 链尾:  store.isHealthy(CHAIN[i]) → 返回 CHAIN[i]
④ 兜底 return 'api_key'（注释标了 unreachable，因为 api_key 恒健康，但防御性保留）
```

注意 **只往后走，不往前回头** —— 目标是 `print_sdk` 时，就算 `bg_daemon` 是健康的也不会用它。

### 4.4 `FallbackCarrierWrapper._invoke()` 的降级决策树

```
try:
  for await msg of carrier.invoke():
      msg.type === 'error' && cls = classify(msg.error) !== 'transient'
          → reportFailure(activeTier, cls); degradedDuringStream = true
          → 【不做流内重试】注释理由：partial output may already have been yielded to the user
      yield msg
  正常结束且 !degradedDuringStream:
      getHealth(activeTier).state === 'degraded' → reportRecovery
      否则 → resetTransientCount

catch err:
  cls = classify(err.message)
  cls === 'transient' → reportFailure + rethrow（让 invoke-single-cat 处理瞬时重试）
  否则:
      reportFailure(activeTier, cls)
      fallbackTier = selectFirstHealthyTier(targetTier, store)
      fallbackTier === activeTier → rethrow（没有更好的选择了）
      fallbackTier === 'api_key'  → rethrow（当前是 no-op，不发假的 carrier_fallback 事件）
      否则:
        yield system_info{type:'carrier_fallback', from, to, reason: cls, error: msg.slice(0,200)}
        用 fallbackCarrier 重试一次（不再级联降级）
          其间 yield 的 error 也要 classify + reportFailure（Cloud P1 fix：载体可能用 error 消息而不是 throw 来暴露 quota/structural）
          fallbackCarrier 自己 throw → classify + reportFailure(fallbackTier) + rethrow（P1-2 fix）
```

三条值得背的设计取舍：
1. **流中出错不重试**，只影响下次调用的 tier 选择 —— 因为用户可能已经看到半截输出了
2. **只降级一次**，不级联 —— 免得一次调用把整条链走完
3. **transient 不降级**，交给上层的重试机制

### 4.5 AGY plain-text 分类：`classifyAntigravityCliPlainText()`

【源码】判定顺序（先到先得）：

```
① resumed 且能从 stdout 或 agyLogText 里抽出 "conversation not found"
     → error / missing_session：`No conversation found with session ID: <id>`
     两个正则:
       /^Warning:\s*conversation\s+"([^"\r\n]+)"\s+not found\./im
       /\bConversation\s+([^\s,]+)\s+not found,\s+ignoring\s+--conversation\s+flag\b/i
② trimmedStdout = stripFreshConversationWarning(stdout).trim()
     剥的是 /^Warning:\s*conversation\s+"agy-[^"\r\n]+"\s+not found\.\r?\n/i
③ isAgyPrintTimeoutOutput(trimmedStdout) —— /^Error:\s*timed out waiting for response\.?$/i
     → error / timeout。文案专门解释了这个陷阱：
       "agy --print-timeout 返回了 timeout 文本但进程可能仍是 exit 0"
④ isAgyAuthRequiredDiagnostic(diagnosticText) → error / auth_required
     必须 hasAuthPrompt（^Authentication required\. Please visit the URL to log in:）
     且 (hasGoogleOAuthUrl 或 (hasAuthWait 且 hasAuthInterrupted))
⑤ isAgyMissingModelDiagnostic → error / missing_model
     /^(?:Error:|E\.\.\.)\s*(?:failed to construct executor:\s*)?neither PlanModel nor RequestedModel specified\b/im
     或 /^(?:Error:|E\.\.\.).*\bPlease use the \/model command\b/im
⑥ trimmedStdout 为空:
     resumed 且有 resumedFinalText → { kind:'text', content: final, textMode:'replace' }
     否则 → { kind:'empty' }
⑦ resumed → { kind:'text', content: resumedFinalText ?? trimmedStdout, textMode:'replace' }
⑧ 否则 → { kind:'text', content: trimmedStdout }   （不带 textMode，即默认 append）
```

**`textMode: 'replace'` 的唯一使用场景就在这里**。原因【源码注释】：

```
F210 H2b: resumed turn 从 trajectory SQLite 提取的本轮 final answer text。
非空时**替换** stdout 重放（根治 `agy --print --conversation` 累加重放 `[1]→[1,2]→[1,2,3]`）
```

`agy --print --conversation <id>` 每次都会把**整段历史**重新打印一遍，所以第三轮的 stdout 是 `[1,2,3]`。直接 append 的话对话框里会看到三份。解决办法是从 trajectory SQLite 里只挖出**本轮**的 final answer，用 `replace` 语义覆盖整个气泡。

**fail-open 原则**贯穿全程：提取失败 / 无 db / 无 final → `resumedFinalText = null` → 保留现有 stdout。注释写了三遍：`绝不输出截断/错误回复`。

错误文案（用户可见，写死在源码里）：

```
auth_required:
  Antigravity CLI profile is not authenticated. Run `agy` with the same HOME/profile and
  complete login before unattended Clowder AI use. For isolated AGY profiles, each profile
  HOME must be onboarded separately.
missing_model:
  Antigravity CLI 没有可用的账号侧默认模型。AGY CLI 没有已验证的 --model/env per-call 模型覆盖；
  请先运行 `agy` 进入交互模式，用 `/model` 选择默认模型后再重试。
```

### 4.6 AGY 完整逆向链路（这一节是本篇最"能装"的部分）

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 目标：`agy --print` 是黑盒（只吐一坨最终文本），我们要拿到                     │
│       ① 会话 id  ② 实际模型  ③ 中间进度  ④ 工具调用  ⑤ 本轮的真 final answer │
└───────────────────────────────────────────────────────────────────────────┘

  spawn agy --log-file <tmp/cat-cafe-agy-<uuid>.log> --conversation <id?> --print <prompt>
        │                                                    │
        │ (a) 日志文本                                        │ (b) 内部 SQLite
        ▼                                                    ▼
  ┌──────────────────────────────┐          <appDataDir>/conversations/<cascade-uuid>.db
  │ extractAntigravityCliConversationId    │                 │  表 steps(idx, step_type, status, step_payload BLOB)
  │   5 个前缀 + UUID 正则，取最后一次      │                 │
  │ extractAntigravityCliSelectedModelLabel│◀────────────────┤
  │   "Propagating selected model override │                 │
  │    to backend: label=\"...\""，取最后一次│                │
  │ APP_DATA_DIR_RE = /appDataDir=(\S+)/   │                 │
  └───────────────┬──────────────────────┘                  │
                  │ resolveAgyTrajectoryDbPath(log)          │
                  │  = join(appDataDir,'conversations',uuid+'.db')
                  ▼                                          │
        ┌───────────────────────────┐                        │
        │ locateAgyTrajectoryDb()   │                        │
        │  fresh turn: 走上面        │                        │
        │  resume turn: log 是空的！ │─── 扫 conversations/*.db ──┘
        │    只认 birthtime 或 mtime  │      唯一候选才认，0 或 多个 → null
        │    >= invocationStartMs     │
        └───────────┬───────────────┘
                    │
       ┌────────────┴─────────────┐
       ▼                          ▼
 observeAgyProgress()      readAgyTrajectorySteps() + extractAgyFinalTextFromSteps()
 （跑期间，500ms 轮询）      （跑完，一次性）
       │                          │
       │ 每个新 step / 状态变化      │ 手写 protobuf 解析 step_payload
       ▼                          ▼
 system_info{agy_trajectory_progress}   本轮 final answer → textMode:'replace'
 + parseAgyStepTools → tool_use / tool_result
```

#### 4.6.1 `locateAgyTrajectoryDb()` 的三段判定

【源码】：

```ts
export function locateAgyTrajectoryDb(deps): string | null {
  const fresh = resolveAgyTrajectoryDbPath(deps.logText);   // log 里同时有 appDataDir 和 conversation uuid
  if (fresh) return fresh;
  if (!deps.appDataDir) return null;
  const candidates = deps.listConversationDbs(deps.appDataDir)
    .filter(c => c.birthtimeMs >= deps.invocationStartMs || c.mtimeMs >= deps.invocationStartMs);
  if (candidates.length !== 1) return null;     // 0 个或多个 → fail-open，绝不猜
  return candidates[0].path;
}
```

注释里的实证结论（B spike §8）：**agy resume 不写 `--log-file`，而且会另起一个新的 cascade db**（≠ 原 conversation db）。所以 resume 必须走扫描路径。`!== 1` 就放弃，理由是 `避免历史或并发 invocation 的 db 污染`。

`resolveAgyAppDataDir(childEnv)` 有一条容易踩的坑【源码注释，云端 codex P2】：

```ts
return join(childEnv?.HOME ?? homedir(), '.gemini', 'antigravity-cli');
```

必须用**传给 agy 的 effective child HOME**（合并了 agyProfile / accountEnv / callbackEnv），不能用进程 `homedir()`。否则没有 agyProfile 但 accountEnv 提供了 HOME 时，child 把 trajectory 写进 accountEnv.HOME，而扫描根用的是 homedir() → resume 永久扫错目录、零进度。

#### 4.6.2 `observeAgyProgress()` 轮询算法

```
pollIntervalMs 默认 500
cursor = -1
while (!isAgyDone() && !signal.aborted):
    obs = ensureObserver()                  // 每轮都重新尝试定位 db（agy 可能还没写 log）
    if (obs):
        r = obs.poll(cursor)
        if (r.enabled) { cursor = r.cursor; yield* r.events }
    await sleep(pollIntervalMs)
// agy 结束后再 poll 一次，捞最后写入但上一轮没覆盖的 step
finally: closeObserver()
```

`AgyTrajectoryObserver.poll(cursor)` 的 SQL 是动态拼的【源码】：

```sql
SELECT idx, step_type, status, step_payload FROM steps
WHERE idx > ? [OR idx IN (?,?,...)] ORDER BY idx
```

`OR idx IN (...)` 里是 `activeIdxs` —— **未完成的 step**。因为一个 step 会先以 `status != 3` 出现，之后原地变成 `status = 3`，光靠 `idx > cursor` 是抓不到状态更新的。状态机：

```
prevStatus = lastSeenStatus.get(idx)
prevStatus === undefined || status !== prevStatus  → 产出事件 + lastSeenStatus.set(idx, status)
status === 3  → activeIdxs.delete(idx); lastSeenStatus.delete(idx)   （完成，不再跟踪）
否则          → activeIdxs.add(idx)
nextCursor = events 非空 ? max(cursor, ...events.map(e => e.idx)) : cursor
```

**三态 `ensureOpen()`**（这是个很讲究的 fail-open 分级）：

| 返回 | 触发 | 后果 |
|---|---|---|
| `'ready'` | 打开成功 + `PRAGMA table_info(steps)` 有 `idx`/`step_type`/`status` 三列 | 正常 poll |
| `'retry'` | 文件打不开 / steps 表还没建（`cols.length === 0`）/ 锁或瞬时读错误 | **下一轮重试**（agy 可能先写 log 再建 SQLite，启动竞态，砚砚 P1-1） |
| `'incompatible'` | 表存在但缺列 | `this.incompatible = true`，**永久放弃** |

`BUSY_TIMEOUT_MS = 50`（毫秒）—— 刻意设得极小【源码注释 cloud P2】：

```
better-sqlite3 is synchronous, so a long busy_timeout blocks the API event loop
while AGY's writer holds the lock. Progress is optional side-channel telemetry —
fail open fast and rely on the next poll's retry instead of stalling the event loop for seconds.
```

`poll()` 里运行时读失败 → `this.close()` 重置连接，下轮重开（不永久放弃）。

`stepTypeLabel()` 的标签表（H3，注释强调"证据支撑的粗标签，不全枚举逆向"）：

```
15      → 'assistant activity'   （H2b 证明同一 step 含 final + thinking，所以不标成纯 thinking）
14 / 98 → 'lifecycle'            （证据不足，只给生命周期级）
23      → 'metadata'             （footer/session 元数据，B spike §7.3 实测）
9       → 'operation activity'   （不硬标成 tool call，缺 proto 证据）
其余    → null（未知一律 neutral，不猜）
```

`statusWord(status)` 就一行：`status === 3 ? 'completed' : 'running'`。
最终文案 `neutralLabel(idx, type, status)` = `` `AGY trajectory step #${idx}${suffix} ${statusWord}` ``。

#### 4.6.3 resume 同库增量的 baseline 校验（最烧脑的一段）

问题：resume 时如果 AGY 复用了**同一个** db，直接从 `cursor = -1` 读会把上一轮的所有 step 重放一遍。所以要拿一个 baseline cursor（invocation 开始前的 `MAX(idx)`）。但又不能盲信这个 baseline —— 万一 db 被重建了、或者是另一个文件呢？

`createAgyResumeBaselineCursorResolver()` 的校验链【源码】，返回 `number | null | 'retry'`：

```
① dbPath !== resumeDbPath                       → null（不是同一个库，从头读）
② readDbFileIdentity(dbPath) === null            → 'retry'
③ 与 baselineIdentity（dev + ino）不一致          → null
④ markerBefore = readDbChangeMarker（dev+ino+size+mtimeMs）
   markerBefore === null                          → 'retry'
   已验证过且 marker 没变                          → 直接返回 baselineCursor（快路径）
⑤ currentMax = readMaxStepIdx；null → 'retry'；currentMax < baselineCursor → null
⑥ currentPrefix = readAgyStepsPrefixFingerprint(dbPath, baselineCursor)
   'unreadable' → 'retry'
   'missing' 或指纹不一致 → null
⑦ markerAfter = readDbChangeMarker；null → 'retry'
   markerBefore ≠ markerAfter → 'retry'（读期间文件变了，这次判定不可信）
⑧ validatedMarker = markerAfter；返回 baselineCursor
```

`'retry'` 的语义【源码注释】：本轮**不创建 observer**，下轮重新定位再判，`避免用陈旧高 cursor 跳掉本轮低 idx`。

`readAgyStepsPrefixFingerprint(dbPath, maxIdx)` —— **有界抽样指纹**：

```ts
const PREFIX_FINGERPRINT_MAX_SAMPLED_ROWS = 64;
const PREFIX_FINGERPRINT_EDGE_SAMPLE_ROWS = 16;
```

`buildAgyPrefixSampleIdxs(maxIdx)`：
- 总行数 ≤ 64 → 全取
- 否则：头 16 个（0..15）+ 尾 16 个（maxIdx-15..maxIdx），再在中间**均匀插值** `Math.trunc(maxIdx * i / (targetInterior+1))` 补到 64 个，去重排序

指纹计算：`sha256` 依次 update `samples:<idx列表>\0`，然后每行 `idx:<i>\0step:<t>\0status:<s>\0` + payload（null 写 `payload:null\0`，否则 `payload:<len>\0` + 原始字节 + `\0`）。必须命中 `maxIdx` 那一行（`sawBaselineRow`），否则返回 `'missing'`。

`observeAgyProgress` 里还有一层运行时复验 `revalidateActiveBaseline()`：只要 `cursor` 还没越过 `activeBaselineCursor`，每轮都重新调 `initialCursorForDb` 校验一次；返回 `'retry'` 就本轮不动，返回非数字就 `closeObserver() + cursor = -1` 重来。

**carryover 保护**【源码注释】：没有 `invocationStartMs` watermark 时，`ensureObserver()` 会把 `appDataDir` 置成 null（locator 只走 fresh log 路径），避免未来的调用方传了 appDataDir 却漏了 watermark 时误读历史库。

#### 4.6.4 手写 protobuf 解析器（`agy-trajectory-extractor.ts`）

owner 的决策记在文件头【源码】：`手写 minimal proto wire-format parser（owner 砚砚拍 2026-06-02：不引 protobufjs，只解需要的路径）`。

**逆向出来的字段路径**（注释里标了证据来源：`B spike §7.4 + protoc --decode_raw 实测 fresh turn 33d040c7 apple→pomme`）：

```
step_payload 顶层 field 20 = assistant message 子结构
  20.1 = final answer text（首选）
  20.8 = final answer text（fallback）
  20.3 = thinking/reasoning（**排除**，不能当 final）
```

对应常量：

```ts
const MAX_VARINT_BYTES = 10;
const FIELD_ASSISTANT_MESSAGE = 20;
const FIELD_FINAL_TEXT = 1;
const FIELD_FINAL_TEXT_FALLBACK = 8;
```

`readVarint(buf, offset)` 有个细节：用 `result += (byte & 0x7f) * 2 ** shift` 而不是 `<<`。注释理由：`避免 >32-bit 移位溢出（tag/length 实际很小，number 精度够）`。

`scanLengthDelimitedFields(buf)` → `Map<fieldNum, Buffer>`（只收 wire type 2，同 field 多次取**最后一个**）。其余 wire type 正确跳过：0 = 再读一个 varint；1 = +8 字节；5 = +4 字节；其它**抛错**。越界也抛错。

`extractAgyFinalTextFromSteps(steps)`：遍历所有 `stepType === 15` 的 step，能解出非空 final 的**取最后一个**。

`readAgyTrajectorySteps(dbPath)`：`new Database(path, {readonly:true, fileMustExist:true})` + `busy_timeout = 50` + `SELECT step_type, step_payload FROM steps ORDER BY idx`，过滤掉 payload 为 null 的。任何异常 → `[]`（fail-open）。

**`parseAgyStepTools(payload, idx)` —— 三条路径**（这段是 tool_use / tool_result 的来源）：

```
路径 0（runCommand，顶层 field 28）:
    28.2  = cwd
    28.23 或 28.25 = 命令行
    28.13 或 28.14 = stdout
    → { toolName:'run_command', toolInput:{CommandLine, Cwd}, toolCallId:`run-command-${idx}`, toolResultOutput }

路径 A（Step 75 形态，顶层 field 5 直接平铺）:
    5.2 或 5.9 = toolName（必须在 KNOWN_TOOLS 白名单里）
    5.12       = toolCallId（必须匹配 UUID 正则）
    5.3        = argumentsJson（以 '{' 开头才 JSON.parse）
    顶层 14.4  = toolResultOutput

路径 B（Step 77 形态，field 5 内嵌 field 4）:
    5.4.1 = toolCallId（per-tool 级唯一）
    5.4.2 = toolName（同样过白名单）
    5.4.3 = argumentsJson；不是 JSON 时降级成 { rawArguments: [可打印字符串...] }
             过滤正则 /^[\x20-\x7E\s一-龥\d\-_{}:",]+$/
    顶层 10.26 = toolResultOutput
```

`KNOWN_TOOLS` 白名单（20 个，源码字面）：

```
list_dir, view_file, write_to_file, replace_file_content, multi_replace_file_content,
run_command, grep_search, ask_permission, ask_question, define_subagent, invoke_subagent,
manage_subagents, manage_task, schedule, search_web, send_message, read_url_content,
read_resource, list_resources, generate_image
```

白名单 + UUID 正则双校验的作用：手写 proto 解析必然会误命中一些随机字节，两道过滤把误报压下去。任何异常 → `return null`。

服务层的去重【源码 `GeminiAgentService`】：

```ts
const yieldedToolCallIds = new Set<string>();   // 每个 toolCallId 只发一次 tool_use
const yieldedToolResults = new Set<string>();   // 只在 progress.status === 3 时发 tool_result，且只发一次
```

`tool_result` 的 `toolResultStatus` 恒为 `'ok'` —— 因为 proto 里没解出失败标志（诚实降级）。

> **面试官追问："手写 protobuf 解析器不会随版本挂掉吗？"**
> 「会，而且我们知道。所以整条链路是**全 fail-open** 的：`parseAgyStepFinalText` 里包了 try/catch 返回 null，`readAgyTrajectorySteps` 异常返回 `[]`，`locateAgyTrajectoryDb` 定位不到返回 null，`classifyAntigravityCliPlainText` 在 `resumedFinalText` 为空时保留原 stdout。所以最坏情况是"回到没有这个功能之前的行为"——resume 轮会看到累加重放、看不到中间进度——而不是报错或输出截断的回复。注释里反复写的那句 `绝不输出截断/错误回复` 就是这个约束。另外我们没有全量逆向 proto，只解了三条已被 `protoc --decode_raw` 实测过的字段路径，加上 20 个工具名白名单和 UUID 格式校验来压误报。」

### 4.7 `TranscriptTailer.readNew()` —— 增量读文件的四条保证

【源码】文件头列的保证：

```
- 文件还不存在 → 返回空（job 还没起来，调用方继续轮询）
- 第一次调用 → 所有完整（以 \n 结尾）的行
- 后续调用 → 只有新行（不重放）
- 最后一行不完整（守护进程正在写）→ 扣住，绝不 JSON.parse 半行
- 单行 JSON 畸形 → 跳过（per-line try/catch）
```

算法：

```ts
const parts = content.split('\n');
let completeLines = parts.slice(0, -1);          // 丢掉最后一段（'' 或半行）
if (options.includeTrailingPartial) {
  const trailing = parts[parts.length - 1];
  if (trailing) { try { JSON.parse(trailing); completeLines = [...completeLines, trailing]; } catch {} }
}
const newLines = completeLines.slice(this.emittedLines);
this.emittedLines = Math.max(this.emittedLines, completeLines.length);   // ← 单调，不回退
```

**`includeTrailingPartial` 存在的原因**【源码注释】：`without final-drain mode, success jobs with newline-less final lines went silent (only session_init + done emitted, no text)`。它用 `JSON.parse` 成功与否来区分"只是缺了换行"和"真的写了一半"。

**`Math.max` 的原因**（F230 R7 P2）：一次 `includeTrailingPartial` 读把 `emittedLines` 推到 N+1 后，下一次普通读算出的 `completeLines.length` 是 N，直接赋值就会回退，导致**同一行每轮都重发**。

策略选择的理由【源码注释】：`transcripts are KB-scale append-only, so re-read cost is negligible vs the alternative of stream-based tail (fs.watch is platform-flaky for tail use)`。

### 4.8 `watchForTranscriptFile()` —— 区分元数据文件与真 transcript

【源码】背景：`claude --session-id <uuid>` 只把会话元数据（ai-title）写进 `<uuid>.jsonl`，真正的对话事件走**另一个** Claude 自己生成的 UUID 文件。所以 `--session-id` 根本没用（R10 拔掉了），改成"监视新出现的 .jsonl"。

```
① existingFiles = 发 Enter 之前的快照（snapshotTranscriptFiles）
② fs.watch(dir) + setInterval(checkDir, 200) 双保险 + 立刻先 checkDir 一次
③ checkDir():
     先复查 aiTitleOnlyFiles 里的文件：!isAiTitleOnly → 说明对话事件追加进来了 → resolve
     再看新文件：在 existingFiles 或 aiTitleOnlyFiles 里 → skip
        isAiTitleOnly(path) → 记进 aiTitleOnlyFiles（延迟判定，继续观察）
        否则 → resolve(fullPath)
④ timeoutMs 到 → cleanup + reject(`no new transcript file appeared within ${timeoutMs}ms in ${dir}`)
```

`isAiTitleOnly(path)` 返回 **true = 先别用这个文件**：

```
读文件 → 非空行数组
  0 行     → true（空文件，Claude 可能只开了 fd 还没 flush）
  ≠1 行    → false（多行 = 真 transcript）
  恰好 1 行 → JSON.parse 后看 event.type === 'ai-title'
catch      → true（半行/不可读 → 延迟判定）
```

P2 fix 的注释解释了为什么空文件和半行也返回 true：`In both cases the file is NOT a real transcript yet — treat as "defer" so we keep watching rather than resolving immediately with a wrong path.`

实证数据（F230 R10/R11 根因分析 2026-06-11）：ai-title 文件在 Enter 后 **p50 = 0.11s** 出现，对话文件随后跟上。

### 4.9 `dedup()` / `removeValuedCliFlags()` 两套参数去重

| | Claude / Gemini / Kimi 版 | Codex 版 `dedup()` | OpenCode 版 | Gemini AGY 版 `removeValuedCliFlags()` |
|---|---|---|---|---|
| 冲突识别 | 精确 flag 字符串相等 | `--config <key>=`：比 **key**；其它 flag：比字符串 | `getCliFlagName()`：支持 `--key=value` 形式（取 `=` 前） | 支持 `--key=value` 和分离形式 |
| 值的吃掉方式 | 下一个 token 不以 `-` 开头就一起跳 | 同左 | 同左 | `'single'`（吃一个）或 `'untilNextFlag'`（吃到下一个 `-` 为止） |
| 累加白名单 | `--add-dir`（Gemini 是 `--include-directories`） | 无 | 无（但 `--auto` 的所有别名都算"用户接管"） | `--add-dir` |
| 保留字段保护 | `RESERVED_SYSTEM_PROMPT_FLAGS`（4 个） | `RESERVED_SYSTEM_CONFIG_KEYS`（`developer_instructions`），`--config` 和 `-c` 两种写法都拦 | 无 | `ANTIGRAVITY_USER_BLOCKED_FLAGS`（`--dangerously-skip-permissions`、`--model`）+ 内部参数 `--conversation`/`--log-file` |
| 最终顺序 | `[...去重后的系统参数, ...用户参数]` | 同左（`userConfigArgs` 插在 MCP 参数之前） | 同左，prompt 在最后 | 同左，再 `insertArgsBeforeFlag(args,'--print',内部参数)` |

OpenCode 的 `--auto` 有个特殊处理【源码】：

```ts
const userControlsAutoApprove = Array.from(OPENCODE_AUTO_APPROVE_FLAG_ALIASES).some(f => userFlags.has(f));
// 用户写了 --yolo / --no-auto / --dangerously-skip-permissions 中任意一个
// → 系统的 --auto 让位（连否定形式也算"用户接管"）
```

### 4.10 五种输出格式一览（决策表）

| Provider | 传输 | 格式 | 边界 | 谁解析 |
|---|---|---|---|---|
| Claude `-p` | stdout | NDJSON（`--output-format stream-json --include-partial-messages`） | 换行 | `transformClaudeEvent` |
| Claude `--bg` | 文件（`state.json` + transcript jsonl） | JSON + NDJSON | 轮询 + `\n` | `JobEventConsumer` + `BgTranscriptEventConsumer` |
| Claude PTY | 文件（hook sidecar jsonl） | NDJSON | 轮询 + `\n` | `hookEntriesToAgentMessages` |
| Codex | stdout | NDJSON（`--json`） | 换行 | `transformCodexEvent` |
| Gemini CLI | stdout | NDJSON（`-o stream-json`） | 换行 | `transformGeminiEvent` |
| AGY | stdout | **纯文本一坨** + 旁路日志 + 旁路 SQLite | 进程结束 | `classifyAntigravityCliPlainText` + trajectory 观测器 |
| OpenCode | stdout | NDJSON（`--format json`） | 换行 | `transformOpenCodeEvent` |
| Kimi | stdout | NDJSON（`--output-format stream-json`）+ 混杂纯文本行 | 换行 | `kimi-event-parser` 一族 |
| ACP | stdin/stdout | **JSON-RPC 2.0 over NDJSON**（双向） | 换行 | `transformAcpEvent` |
| A2A | HTTPS | JSON-RPC 2.0（单次请求/响应） | HTTP body | `transformA2ATaskToMessages` |
| CatAgent | HTTPS | **SSE**（`text/event-stream`） | `\n\n` | `parseAnthropicSSE` |
| Antigravity IDE | HTTP(S) ConnectRPC | protobuf/JSON | RPC | `transformTrajectorySteps` |

---

<!-- BEGIN INLINE SOURCE EXPANSION 26-ALGO -->
### 4A. Provider 契约测试：同一套用例跑不同 CLI

Provider 最适合做“契约测试”。不管底层是 Claude、Codex、Gemini 还是 HTTP Agent，消费者至少期望：

1. 所有消息有 `catId` 和 timestamp；
2. 成功流最终有 done；
3. 失败/abort 不悬挂，通常有 error + done；
4. session_init 能给出后续恢复所需 ID；
5. 工具事件映射到统一类型；
6. usage/metadata 尽量保留；
7. signal 能终止真实资源。

`catagent-provider.test.js` 已将这套思想用于 HTTP 型 Provider：成功顺序、provider metadata、credential/API/network/abort 均不悬挂。

#### 参数测试：断言“有”和“绝不能有”

以 CLI Provider 为例：

- 有 sessionId 时出现正确 resume 参数；无时绝不能出现；
- cwd 等于 workingDirectory；
- main prompt 在 stdin，不在 argv；
- system prompt 文件参数不可被 `cliConfigArgs` 覆盖；
- MCP 外部 env 不泄漏到 argv；
- 相对 command/workingDir 从正确根目录解析。

`codex-agent-service.test.js`、`claude-agent-service.test.js`、`gemini-agent-service.test.js` 都有真实断言。安全测试尤其要检查 argv 和日志，因为密钥即使未返回给用户，也可能通过进程列表泄露。

#### 环境变量优先级矩阵

构造同名变量分别出现在 parent、callbackEnv、accountEnv，并切换 profile：

| 变量类型 | 预期 |
|---|---|
| callback 身份 | 只由本次 invocation 注入，不应被账号配置覆盖 |
| API key profile | 注入指定 key/base URL |
| subscription profile | 清除继承的 API key/bearer token |
| deny-list 命中 | 即使 accountEnv 再提供也必须清除 |
| 普通非敏感变量 | 按明确优先级合并 |

这里应断言最终传给 spawn 的 env，而不是只测中间 helper 返回值。

#### Parser 测试：乱序、缺字段和尾部错误

模拟 JSONL：正常 session_init/text/tool/done；未知事件；无名 tool result；半行 JSON；stderr 有敏感 OAuth URL；已有实质输出后 CLI 以已知假失败退出。断言未知控制消息不能默认当正文，敏感诊断被清洗，真正错误不能因只有 session_init 而被抑制。

#### Abort 测试的两个断言

- 进程层：kill/abort handler 被调用，监听器和临时文件清理；
- 协议层：消费者能收到或推导终态，不会永远等下一条。

只测其中一个都不完整。

#### 面试复述

> Provider 是 Anti-Corruption Layer，把统一 options 翻译成各 CLI 的 argv、stdin、env 和 session 机制，再把厂商 JSONL 映射为统一 AgentMessage。契约测试跨 Provider 复用，厂商测试补充具体参数和事件。凭据采用显式合并与 deny-list，prompt 尽量走 stdin/文件，abort 同时结束子进程和消息协议。
<!-- END INLINE SOURCE EXPANSION 26-ALGO -->

## 5. 边界情况与防御性代码清单

这一节按"防的是什么失败"分组，每条都能在源码里找到出处。

### 5.1 进程与命令行

| 防什么 | 代码怎么防 | 出处 |
|---|---|---|
| Windows `CreateProcess` 32,767 字符命令行上限（`spawn ENAMETOOLONG`） | prompt 走 `stdinInput`；`--append-system-prompt` 改成 `--append-system-prompt-file <临时文件>`；L0 走 `--system-prompt-file` | `ClaudeAgentService.ts` `writeAppendPromptToTempFile()` / `#840 R2` 注释；`CodexAgentService` 的 `promptArgs = ['--','-']` |
| prompt 通过 `ps -o command=` / `/proc/<pid>/cmdline` 跨进程泄漏对话历史 | 同上（prompt 绝不进 argv） | `CodexAgentService.ts` 注释标了事故名 `cross-thread-context-contamination 2026-05-29` |
| CLI 不在 PATH（systemd/pm2/launchd 启动的运行时） | `resolveCliCommand(name)` / `resolveCliCommandOrBare(name)` | `utils/cli-resolve.ts`，Claude/Codex/Gemini/OpenCode/Kimi/AcpClient 都用 |
| macOS GUI app（Electron）里 `#!/usr/bin/env node` shim 找不到 node | 解析成绝对路径后，把 `dirname(command)` 前插进子进程 `PATH` | `AcpClient.initialize()` |
| Windows 上 npm-global `.cmd` shim | `resolveWindowsSpawnPlan(command, args)` 返回 `{command, args, shell?}` | `AcpClient.initialize()`，注释说明是镜像 `cli-spawn.ts` 的做法 |
| Windows 上 Claude CLI 把内联 JSON 当文件路径 | `IS_WINDOWS` 时写临时文件再 `--mcp-config <path>` | Claude `-p` / bg / PTY 三处都有 |
| Windows 上 Rust/codex 用 `USERPROFILE` 而不是 `HOME` | HOME 隔离时两个都设 | `CodexAgentService.invoke()` |
| tmux 把 shell-command 交给 `$SHELL -c` 导致元字符注入 | `shellQuoteArg()` 单引号包裹 + `'\''` 转义，每个 token 都过 | `pty/pty-utils.ts` `buildClaudeCommand()` |
| ACP bootstrap cwd 被 OS 临时目录轮转清掉 → `spawn` 报 ENOENT（错误信息误指向命令路径） | `mkdirSync(cwd, {recursive:true, mode:0o700})`（注入了测试 spawnFn 时跳过） | `AcpClient.initialize()`，注释标 `#712` |
| 子进程 stdin 提前关闭导致 EPIPE 崩溃 | `childStdin.on('error', err => { if (err.code !== 'EPIPE') log.warn(...) })` | `ClaudeBgCarrierService.startJob()` |
| 分离的守护进程/PTY 变僵尸继续烧配额 | bg：`bestEffortStop()` 发 `claude stop <shortId>`；PTY：`dispose()` 发 `tmux kill-session`（幂等） | 两个载体的 abort/timeout/finally 路径 |
| `claude --bg` spawn 失败（ENOENT/EACCES）挂死不返回 | `child.on('error', err => finish(new CarrierError(...)))` | `ClaudeBgCarrierService.startJob()`，砚砚 guard #2 |
| Kimi 临时 MCP 配置目录泄漏 | 只在**确认 kimi 二进制存在之后**才 `writeMcpConfigFile()`（提前 return 会跳过 finally） | `KimiAgentService.invoke()`，注释标 `clowder-ai#944 同类回归` |

### 5.2 环境变量与凭证

| 防什么 | 代码怎么防 | 出处 |
|---|---|---|
| 订阅模式下代理凭证泄漏到 `api.anthropic.com` | `SUBSCRIPTION_MODE_DENY_KEYS` 7 个 key 置 null，且在 `accountEnv` 合并**之后**再补一次 | `ClaudeAgentService.invoke()` / `ClaudeBgCarrierService.startJob()`，`#883` |
| `CLAUDE_CODE_ENTRYPOINT=sdk-cli` 污染计费身份 | `buildClaudeEnvOverrides` 里置 null；bg 和 PTY **再硬置一次**（AC-B6 不变量）；PTY 还额外走 `env -u`（tmux server 可能带着旧快照） | 三个 Claude 载体 + `pty-utils.buildClaudeCommand()` 的"双保险"注释 |
| base URL 配了 `/v1` 导致 `/v1/v1` + 触发 CLI 打 `/v1/models` 校验 | `baseUrl.replace(/\/v1\/?$/, '')` | `buildClaudeEnvOverrides()` |
| `--model` 覆盖掉代理路由的模型 | api_key 模式 + 非 `claude-` 前缀模型 → 省略 `--model`，让 `ANTHROPIC_MODEL` 说话 | `resolveClaudeModelSelection()` |
| Codex OAuth 模式意外走了 API key 计费 | `applyAuthMode()` 在 oauth 模式下把 `OPENAI_API_KEY/BASE_URL/API_BASE/ORG_ID/ORGANIZATION` 全置 null | `CodexAgentService` |
| Codex API key 模式被过期 OAuth token 刷新拖死 | `mkdtempSync(codex-apikey-)` 做 HOME 隔离 | `CodexAgentService`，注释解释 abort 时机 |
| OpenCode 自定义 provider 被内建 anthropic provider 抢走 | `OPENCODE_CONFIG` 存在时清 4 个 anthropic/opencode env；但 `CAT_CAFE_OC_INSTRUCTIONS_ONLY` 是例外（F203 Phase I） | `OpenCodeAgentService.buildEnv()` |
| 账号级 `ALLOWED_WORKSPACE_DIRS` 和 invocation 级配置抢 | `childEnv.ALLOWED_WORKSPACE_DIRS = null` 硬清 | `OpenCodeAgentService.invoke()` |
| tmux server 的环境快照吃掉代理设置 | 显式转发 8 个代理变量（`HTTP_PROXY`/`http_proxy`/…/`no_proxy`） | `ClaudeInteractivePtyCarrierService`，P2 F230 2026-06-11 |
| 用户 env 模板注入保留前缀或畸形 key | `envKey.startsWith('CAT_CAFE_')` 或 `!/^[A-Z_][A-Za-z0-9_]*$/` → 跳过 | `env-map.ts` `resolveEnvMap()` |
| 用户模板把整张内建映射表冲掉 | `pickTemplate()` 用 `{...builtinMap, ...userTemplates}` merge 而非 replace（P2 fix） | `env-map.ts` |
| 空值凭证注入成空字符串（比没有更糟） | `if (resolved) result[envKey] = resolved` | `env-map.ts` |

### 5.3 会话与 resume

| 防什么 | 代码怎么防 | 出处 |
|---|---|---|
| 把 8 位 hex 的 daemon shortId 当 UUID 传给 `--resume` | `UUID_PATTERN.test(sessionId)` 才 push `--resume` | `ClaudeBgCarrierService` |
| PTY 用了跨载体的陈旧 sessionId | UUID 正则 **且** `existsSync(join(transcriptDir, id + '.jsonl'))` 双重校验，不过就 `log.info` 后开新会话 | `ClaudeInteractivePtyCarrierService`，E4 P1-D |
| bg 每轮 fork 新 UUID 把一段对话膨胀成 N 条封存记录 | `usesChainKeyResume()` 返回 true → 上层用 `bg:${threadId}:${catId}` 做锚 | `types.ts` 的方法注释 + `ClaudeBgCarrierService` |
| ACP 的 per-invocation sessionId 被误判成"会话被换了" | `AgentMessage.ephemeralSession` 字段 | `types.ts` |
| ACP `session/load` 失败后身份丢失（外层因为"有记忆"而跳过了身份注入） | `resumeFallbackSystemPrompt` 在 `resumeSessionLoadFailed` 时补一次 | `AcpAgentService.invoke()` |
| resume 会话的 transcript 被从头重读（PTY） | `injectPrompt()` 在**paste + Enter 之前**、且**在 dir 锁内**数好 `preEnterResumeLines`，传给 `TranscriptTailer` 当起始偏移 | `PtyDriver.injectPrompt()` P1-D + P2 lock-ordering fix |
| `agy --print --conversation` 累加重放 `[1]→[1,2]→[1,2,3]` | 从 trajectory SQLite 提本轮 final answer，用 `textMode:'replace'` 覆盖 | `antigravity-cli-event-parser.ts` F210 H2b |
| resume 时误读历史或并发 invocation 的 cascade db | `birthtimeMs/mtimeMs >= invocationStartMs` 过滤 + **候选必须恰好 1 个** | `locateAgyTrajectoryDb()` |
| resume 同库时用陈旧 baseline cursor 跳掉本轮低 idx | 三重校验（file identity dev+ino / change marker dev+ino+size+mtime / steps 前缀 sha256 抽样指纹）+ `'retry'` 三态 | `createAgyResumeBaselineCursorResolver()` |
| 损坏的 thinking signature 让会话永久无法 resume | 正则识别 + 给出可执行的救援命令 `pnpm rescue:claude:thinking -- --session <id>` | `ClaudeAgentService` |

### 5.4 输出解析与流

| 防什么 | 代码怎么防 | 出处 |
|---|---|---|
| 单行畸形 JSON 干掉整个消费流 | 每处 jsonl 解析都是 per-line try/catch 后 `continue` | `TranscriptTailer` / `JobEventConsumer.readTimeline` / `readTranscriptEntrypoints` / `AcpClient.startReading` |
| `JSON.parse` 半行（守护进程正在写） | 默认丢掉最后一段；`includeTrailingPartial` 模式用 `JSON.parse` 成功与否来判断"只是缺换行" | `TranscriptTailer.readNew()` |
| 同一行被每轮重发 | `emittedLines = Math.max(emittedLines, completeLines.length)` 单调不回退 | `TranscriptTailer`，F230 R7 P2 |
| `state.json` 被读到半个写入（daemon 异步写） | `readState()` 的 `JSON.parse` 失败返回 **null**（当"还没准备好"，继续轮询） | `JobEventConsumer.readState()`，codex round 3 P2 |
| 流式 + 最终 assistant 文本重复 | `partialTextMessageIds: Set<string>` 去重 | `claude-ndjson-parser.ts` |
| Claude CLI 本地合成的 assistant 条目冒充猫的回复 | `msg.model === '<synthetic>'` 过滤：`API Error:`/`Error:` 开头转成 error，其余（`No response requested.`）静默丢 | `BgTranscriptEventConsumer` F230 P2-synthetic |
| `turn_duration` 原始 JSON 泄漏成"蓝色气泡" | 直接不产出消息（与 `-p` 基线对齐） | `BgTranscriptEventConsumer` |
| bg 最终答案被重复输出 或 被静默吞掉 | `trim(lastAssistantText) === trim(output.result)` **严格相等**判定（不用 includes，SPIKE_OK 陷阱） | `ClaudeBgCarrierService.invoke()` |
| ACP 重放同一个终态 tool 事件 → 重复 tool_result | `finalEmittedByCallId: Set<string>` 去重 | `acp-event-transformer.ts` F197 KD-5 |
| ACP 终态但 content 缺失 → 工具永久 pending | 终态**无条件**发 tool_result，`content: content?.text ?? ''` | 同上，cloud-1 P1×2 |
| ACP 首次出现就是终态更新 → 孤儿 tool_result | 拆成 `[tool_use, tool_result]` | 同上，AC-A3 |
| Gemini CLI 两种事件外壳（嵌套/扁平） | `const inner = (update.update ?? update)` | `acp-event-transformer.ts` + `AcpClient` 的 listener |
| Gemini CLI 字段名跨版本漂移 | `resolveToolName`：`toolName`→`name`→`tool_name`→`title`；`resolveToolInput`：`toolInput`→`input`→`tool_input` | `acp-event-transformer.ts` |
| Kimi CLI 用 `id: 0` 的数字 id（JS falsy 陷阱） | `const hasId = id !== undefined && id !== null`，且"有 method + 有 id"分支排在"有 method + 无 id"之前 | `AcpClient.startReading()`，`#712` |
| Claude 的 `modelUsage` / `model_usage` 两种拼法 | `(e.modelUsage ?? e.model_usage)` | `extractClaudeUsage()` |
| OpenCode 只抄 `tokens.input` 导致 fillRatio 下溢、handoff 永不触发 | `input + cache.read + cache.write` 求和 | `opencode-event-transform.ts` clowder#915 R4 |
| OpenCode 多 step 重复发 session_init | `sessionInitEmitted` 门 | `OpenCodeAgentService` P2-1 |
| transformer 的 `usage` 被服务层 metadata 展开抹掉 | 显式 `{...yieldMetadata, usage: result.metadata.usage}` 合并 | `OpenCodeAgentService`，clowder#915 R1 P1 |
| Codex 相邻 agent_message 粘连成一段 | `hadPriorTextTurn` → 第二条起前缀 `'\n\n'` | `codex-event-transform.ts` |
| MCP 工具输出的超大/非法 base64 图片撑爆消息 | MIME 白名单 5 种 + `MAX_BASE64_LENGTH = 5MB` | `codex-event-transform.ts` F060 P2 fix |
| ai-title 元数据文件被误当成 transcript | `isAiTitleOnly()`：空文件 / 半行 / 单行且 `type==='ai-title'` 都返回 true（延迟判定） | `pty-utils.watchForTranscriptFile()` |
| OpenCode 把 compaction 草稿纸当正文吐出来 | `## Goal` + 非标题形式的 `Constraints & Preferences` 双标记，跨 chunk 检测（800 字符尾窗），命中后全抑制 | `acp-event-transformer.ts` |
| OpenCode compaction → auto-continue 死循环烧 token | 检测后仍有事件流入，超过 `MAX_SCRATCHPAD_SUPPRESSED_EVENTS = 50` → `cancelSession` + throw | `AcpAgentService.invoke()` |
| CatAgent 流中断留下孤儿 tool_use | 给所有未执行的 tool_use 补发 `tool_result`（`toolResultStatus:'error'`） | `CatAgentService.agenticLoop()` |
| CatAgent 从 content 字符串猜工具成败（"Error: 200 OK" 误判） | `status` 只从执行边（有没有抛异常）取 | `executeCatAgentTools()`，KD-38 honesty |
| Gemini CLI 回复完之后自己崩（`reading 'candidates'`） | 已吐过 assistant 文本时 `suppressCliExitError = true` | `GeminiAgentService.invokeGeminiCLI()` |

### 5.5 终止判定与超时

| 防什么 | 代码怎么防 | 出处 |
|---|---|---|
| bg 的 `failed`/`blocked`/`stopped` 不在终态联合里 → 挂到 30 分钟超时 | `JobState` 补齐 8 个值，`stateTerminal` 检查全部 | `JobEventConsumer.ts` F198 Phase D Bug #2（附实证 job id） |
| bg 的 transcript 已完但 state 还没翻 | `transcriptTerminal`（扫到 `system/turn_duration`）与 `stateTerminal` **或**关系 | `ClaudeBgCarrierService.invoke()` |
| PTY 的 Stop hook 没来（脚本挂了 / claude 崩了） | `terminalTimeoutMs`（默认 5 分钟）静默兜底，当作 done | `ClaudeInteractivePtyCarrierService` |
| ACP agent 一直产事件但永不结束 | **活动型**回合预算：每个事件 `resetBudget()`，只有沉默 15 分钟才炸 | `AcpClient.promptStream()` KD-12 |
| ACP agent 开了口就不说了 | 空闲看门狗：20s 警告 → 90s 卡死（相对 `lastEventAt` 计算） | 同上 F149 |
| ACP 工具执行期间被误判成卡死 | `pendingTool` 标志（`tool_call`/`permission_pending` 置位，`agent_thought_chunk` 豁免） | 同上 |
| `pendingTool` 无限压制 stall 导致挂死 | `TOOL_EXECUTION_CEILING_MS = 180_000` 强制上限；未达上限也要**重新排期**（不 dead-end） | 同上，注释点名 kimi-acp |
| ACP 零事件卡死时 stderr 的 429 信号送不进消费循环 | `capacityInjector` 把信号**注入事件队列**，立刻 resolve `waitResolve` | 同上 |
| 迟到的 stderr（CLI 缓冲）导致 429 被误判成回合超时 | catch 里 2 秒宽限 + `_recentCapacitySignal` 10 分钟窗口的二级证据 | `AcpAgentService.classifyError()` |
| Codex 0.98+ 成功后仍返回 exit code 1 | `exitCode===1 && signal===null && sawSubstantiveOutput` 且诊断文本不含 `remote compaction failed\|compact_error` → 抑制 | `CodexAgentService` |
| `agy --print-timeout` 返回 timeout 文本但进程 exit 0 | `isAgyPrintTimeoutOutput()` 单独识别成 `error/timeout` | `antigravity-cli-event-parser.ts` |
| SQLite 写锁阻塞 API 事件循环（better-sqlite3 是同步的） | `busy_timeout = 50`（毫秒），快速 fail-open 靠下轮重试 | `agy-trajectory-observer.ts` cloud P2 |
| AGY 进度通道长时间不产出饿死 liveness 侧通道 | `Promise.race(progressNext, setTimeout(200))`，定时器赢了回去 drain buffer，progress promise 复用不重建 | `GeminiAgentService`，砚砚 P1-2 |
| `spawnCli` 事件流的 rejection 没人接（后台任务） | `consumerError` 先存起来，buffer drain 完再 rethrow | `GeminiAgentService`，F210-H1b cloud P1 |

### 5.6 取消（abort）

| 防什么 | 代码怎么防 | 出处 |
|---|---|---|
| 信号在监听器挂上之前就 aborted（`addEventListener` 不会补触发） | PTY：进 try 之前先查 `signal.aborted`，直接清理 hookInfra + sidecar 后 error+done 返回 | `ClaudeInteractivePtyCarrierService`，P2-abort fix |
| abort 在 `start()` 的 30s 宽限窗口里触发（事件不会再来一次） | `start()` 之后再查一次 `abortRequested` | 同上，P2-abort-mid fix |
| bg 在 5-15s 启动窗口里被取消，泄漏 daemon job | `spawn(..., {signal})` 让 SIGTERM 直达子进程 | `ClaudeBgCarrierService`，codex round 6 P1.3 |
| bg 轮询期间的取消停不下来 | 每个 poll tick 都查 `signal.aborted` | 同上 + `JobEventConsumer.waitForTerminal()` |
| 取消后 ACP 的共享 client 被误关（还有别的会话在用） | `cancelSession(sessionId)` 只发 notification，**不关 client** | `AcpClient.cancelSession()` |
| AGY 用户主动取消时还弹一个 provider 失败 | `cancelled` 分支什么都不吐（注释：`should clear frontend loading without presenting a provider failure`） | `GeminiAgentService` |
| A2A 取消被当成错误 | `options?.signal?.aborted === true` → yield `done` 而不是 `error` | `A2AAgentService` |
| PTY 取消后 tmux 会话残留 | `cancel()` 发 ESC（会话存活）→ drain → `finally` 里 `dispose()` kill-session | `ClaudeInteractivePtyCarrierService` |

### 5.7 并发

| 防什么 | 代码怎么防 | 出处 |
|---|---|---|
| 两个并发 `injectPrompt` 抢同一个 tmux 默认粘贴 buffer（A 粘出 B 的 prompt） | 具名 buffer `f230-<sessionName>`，用完立刻 `delete-buffer` | `PtyDriver.injectPrompt()` P1-C fix |
| 两个并发调用抢同一个新 `.jsonl` transcript | `acquireTranscriptDirWatch(dir)` Promise 链队列串行化 | `pty-utils.ts` |
| 并发 resume 读到不一致的行偏移 | 行数统计放在 dir 锁**内部** | `PtyDriver.injectPrompt()` P2 lock-ordering fix |
| 冷缓存时两个并发调用各 spawn 一个 L0 编译子进程 | `l0InflightPromises: Map<string, Promise<string>>` 在途去重 | `l0-compiler.ts` Phase G AC-G10 |
| 热重载清缓存后，旧的在途编译又把结果写回缓存 | `l0CacheGenerations` + `l0GlobalGeneration` 代次校验（`isL0GenerationCurrent`） | 同上 |
| 陈旧的 ACP lease 释放时误伤新进程 | `PoolEntry.leaseGeneration` 自增，旧 lease 的 release 闭包变 no-op | `AcpProcessPool`，`#992` |
| 同名不同标点的 MCP 服务共用一个 bearer env 变量 | 变量名带 `sha256(name).slice(0,8)` 后缀 | `CodexAgentService.buildCatCafeMcpArgs()`，`#1074` |
| 多 worktree 共用 AGY sandbox 导致 conversation 串台 | sandbox 路径带 `sha256(resolve(workingDirectory)).slice(0,16)` | `resolveAgySpawnCwd()`，cloud P1 |

### 5.8 文件系统与路径安全

| 防什么 | 代码怎么防 | 出处 |
|---|---|---|
| AGY profile 路径逃逸 | `sanitizeProfileId()`（拒空 / `.` / `..` / 含 `..`）+ `resolveUnder()`（`relative()` 结果检查） | `agy-profile-manager.ts` |
| symlink 让 `mkdirSync(recursive)` 把缓存写回 repo / 真 HOME | 五处 symlink fail-closed 检查（HOME / .gemini / settings 目录 / settings 文件 / cwd sandbox），`resolveAgySpawnCwd` 里再查 base + sandbox 两处 | 同上，cloud P2 |
| AGY profile 指向真用户 HOME 或真 AGY settings | canonical 路径比对（`realpathSync` + 手工推导兜底） | `getUnsafeAgyProfileTargetReason()` |
| AGY 把 `cache/projects.json` 泄漏到 worktree | spawn cwd 与 `workingDirectory` 解耦，走 sandbox；工作区靠 `--add-dir` 显式授权 | `resolveAgySpawnCwd()`，2026-06-03 实证 |
| MCP 相对路径解析到错误的 base | 三段查找：`workingDir` → `configSourceRoot`/`projectRoot` → 原样返回；Windows 绝对路径正则 `/^(?:[A-Za-z]:[\\/]|\\\\)/` 单独识别 | `CodexAgentService` / `acp-mcp-resolver.ts` |
| MCP 二进制从 fork 的 checkout 里解析（node_modules 不全 → 工具全丢） | 候选根按 `resolveBinaryRoot()` → `process.cwd()` → `findMonorepoRoot(fileDir)` → 相对模块路径 上溯 8 层，**故意不含 workingDirectory** | `CodexAgentService.buildCatCafeMcpArgs()` |
| Windows 首次启动时 NTFS junction 还不可穿越（`#802`） | `deriveInstallRoot()` 从模块自身路径上溯 8 层作为最后候选 | `l0-compiler.ts` `resolveL0CompilerScriptPath()` |
| 明文 prompt 留在磁盘 | `load-buffer` 一返回就 `rm(tmpDir, {recursive:true, force:true})` | `PtyDriver.injectPrompt()` P2-temp-files fix |
| 临时 MCP / wrapper 文件权限过宽 | Kimi `mode: 0o600`；Codex wrapper 和 spec 都 `mode: 0o600`；ACP cwd `mode: 0o700` | `kimi-config.ts` / `writeCodexMcpEnvWrapper()` / `AcpClient` |
| 配置文件写到一半被读到 | 先写 `.tmp-<pid>` 再 `renameSync`（原子） | `opencode-config-writer.ts` |
| PTY 改写了用户的 `.claude/settings.json` 不还原 | `cleanup()` 有原始内容写回、没有就 `rmSync`；sidecar 临时目录在 `finally` 里 `rmSync(dirname(...))` | `pty/hook-setup.ts` + carrier 的 finally |
| L0 临时目录泄漏 | `-p` 载体 `finally { removeL0TempDir(l0Path); removeAppendPromptTempDir(appendPromptPath) }` | `ClaudeAgentService` |
| bg / PTY 的 L0 文件被提前删掉（daemon 可能懒读） | **故意不删**，交给 OS tmp 回收 | `ClaudeBgCarrierService.compileL0ToTempFile()` 的注释明确写了这个决定 |

### 5.9 fail-closed vs fail-open 的分界（重要）

代码里两种策略都用，分界线很清楚：

| 场景 | 策略 | 理由（源码注释原文的意思） |
|---|---|---|
| L0 编译失败 | **fail-closed**（Claude 抛错、Codex 返回 error 描述符 → error + done + return） | `a missing L0 = a cat with no identity/家规, strictly worse than a failed invocation` |
| AGY profile preflight | **fail-closed**（六种 reason 任一 → error + done） | 模型/工作区没对上就跑，等于放任猫用错模型改错仓库 |
| OpenCode `--auto` 不支持 | **fail-closed**（spawn 之前 throw） | headless 没有人工审批桥，不能带着待审批跑 |
| AGY trajectory 观测 / final 提取 | **fail-open**（返回 null / `[]`，保留原 stdout） | 这是增强，挂了应该退回到"没这个功能"的行为 |
| MCP capabilities.json 读取 | **fail-open**（catch 后走 `CAT_CAFE_SPLIT_ENTRYPOINTS` 全量兜底） | 配置读不出来不该让猫完全没工具 |
| 用户 `.mcp.json` / `opencode.json` 合并 | **fail-open**（`best-effort: unreadable user config → capabilities-only`） | 用户配置坏了不该拖垮系统配置 |
| F236 eval bridge | **fail-open**（`ingestEvalEntries` 整个包 try/catch，注释：`never break the carrier output loop`） | 遥测不能影响主输出 |
| Redis 健康状态同步 | **fail-open**（`.catch(() => {})`，加载失败当全健康） | 降级信息丢了最多多试一次首选载体 |
| 图片读取（`buildImageMediaItems`） | **fail-open**（跳过读不出来的） | 缺一张图不该搞挂整次调用 |

> **面试官追问："怎么决定一个失败该 fail-closed 还是 fail-open？"**
> 「我的判据是：**这个东西缺了之后，产出是"更差"还是"更错"**。L0 缺了，猫会以为自己是通用助手、不知道家规 —— 这是"更错"，用户看不出来但结果是有害的，必须 fail-closed 让它响亮地失败。AGY 的进度侧通道缺了，用户只是少看到中间步骤，最终答案还是对的 —— 这是"更差"，fail-open。判据不是"重不重要"，是"静默错误 vs 可见退化"。」

---

## 6. 可观测性：出问题怎么查

### 6.1 日志模块名（`createModuleLogger` 的字面参数）

按这些名字 grep 日志最快：

```
claude-agent            ClaudeAgentService
claude-bg-carrier       ClaudeBgCarrierService
interactive-pty-carrier ClaudeInteractivePtyCarrierService
pty-driver              PtyDriver
codex-agent             CodexAgentService（诊断行都带 [codex-diag] 前缀）
gemini-agent            GeminiAgentService（三个 adapter 共用）
opencode-agent          OpenCodeAgentService
opencode-config         opencode-config-template
opencode-mcp-injection  buildOpenCodeMcpSync
kimi-agent / kimi-config
acp-client / acp-agent / acp-pool / acp-event-xform / acp-mcp-resolver
antigravity-service / antigravity-bridge / antigravity-event-transformer
codex-image-scanner
catagent
```

### 6.2 关键日志点与它们回答的问题

| 想知道 | 查什么 |
|---|---|
| 这次到底用了哪个 Claude 载体 | `FallbackCarrierWrapper._carrierTier` / `_carrierFallbackFrom`（运行时字段）；降级时还有可见的 `system_info{type:'carrier_fallback', from, to, reason}` |
| 命令行拼成什么样了 | Claude：`log.debug({catId, command, model, sessionId, invocationId, cwd, envOverrides: safeEnvSummary, argCount}, 'Invoking Claude CLI')`；Codex：`[codex-diag] Invoking Codex CLI`，带 `cliFlags`（只有 flag 名）和 `cliConfigKeys`（只有 `--config` 的 key，**不带值**） |
| env 到底注了什么 | Claude 的 `safeEnvSummary`：null → `(cleared)`；key 命中 `/key\|secret\|token\|password\|cookie\|auth\|session\|bearer\|credential/i` → 前 6 字符 + `***`；其余原样。OpenCode 有 `summarizeOpenCodeEnvForDebug()`（四类 mode + 脱敏） |
| MCP 注入了哪些服务 | 四个 provider 都打同一句 `'#712: MCP invoke-time injection'`，payload 里有 `resolvedFrom: 'capabilities.json' \| 'fallback'`、`enabledServers` / `disabledServers`（Codex）、`serverCount` + `servers[]`（OpenCode）、`summarizeMcpInjection()` 的结果（Claude/Kimi） |
| MCP 在 CLI 里连上没有 | Claude 的 `system_info{type:'mcp_server_status'}`：`servers[]` + `counts{connected,pending,failed,disabled,needs-auth}` + `pendingServers/failedServers/needsAuthServers`，带 `pendingMeaning: 'deferred_tool_loading'`（提示 pending 不一定是坏事） |
| ACP 的 session/new 为什么超时 | `'ACP session/new: sending request'` 打了 `cwd`、`mcpServerCount`、每个 server 的 `{name, transport, command, argCount, hasUrl, envKeyCount, envKeys}`（**只有 key 名没有值**）、`agentInfo`、`pid` |
| ACP 的某个事件为什么没被处理 | `'ACP listener: unclassified event — no sessionUpdate type'`，带 `rawKeys` / `innerKeys` / `method` / `raw`（截 500 字符） |
| ACP 请求发出去了没、多久回的 | `'ACP sendRequest: writing to stdin'`（`method, id, timeoutMs, pid, payloadBytes`）→ `'ACP sendRequest: response received'`（`durationMs, hasError`）或 `'... TIMEOUT — no response from agent process'`（`elapsedMs, exited`） |
| AGY 用的是哪个 profile / cwd | `metadata.diagnostics.antigravityCli`：`{modelSelection, configuredCatModel, requestedModelOverride?, profile:{profileId, homePath, settingsPath, trustedWorkspaces, autoApprove}, spawnCwd, observedModel?, preflight?}` |
| CLI 出错的结构化原因 | `metadata.cliDiagnostics`：`reasonCode` + `publicSummary` + `safeExcerpt` + `debugRef{command, exitCode, signal, invocationId}`。AGY 还多四个 `debugRef` 字段：`homeMode`（`agy_profile_home`/`child_env_home`/`process_home`）、`spawnCwdMode`（`agy_profile_cwd`/`cat_cafe_agy_cwd`）、`spawnCwdKey`（16 位 hex，`/^[a-f0-9]{16}$/` 校验过）、`profileId` |
| 一次调用为什么"什么都没说" | `system_info{type:'silent_completion'}` + `cliDiagnostics`，里面有 `eventCount` / `eventTypes[]` / `model` / `sessionId` / `stderrPresent` / `stderrExcerpt` |
| CLI 卡住了吗 | `system_info{type:'liveness_warning'}`（带 `level` / `silenceDurationMs`）+ `system_info{type:'timeout_diagnostics'}`（`silenceDurationMs` / `processAlive` / `lastEventType` / `firstEventAt` / `lastEventAt` / `cliSessionId` / `invocationId` / `rawArchivePath`） |
| bg 守护进程现在在干嘛 | `AgentMessage{type:'status', content: state.detail}`（去重后逐条推），前端显示在头像 tooltip |
| AGY 现在跑到第几步 | `system_info{type:'agy_trajectory_progress', idx, stepType, status, label}` |

### 6.3 原始事件归档（post-mortem 的主力）

`CliRawArchive`（`RawArchiveSink` 接口）：

```ts
interface RawArchiveSink {
  append(invocationId: string, payload: unknown): Promise<void>;
  getPath?(invocationId: string): string;    // F118：路径写进 __cliTimeout 诊断
}
```

四个 provider 接了它（`#780`）：Claude `-p`、Codex、OpenCode、Kimi。写入是 fire-and-forget，失败只 `log.warn({catId, invocationId, err}, 'Raw archive write failed')`。所有 payload 都先过 `sanitizeRawEvent()` 脱敏（深度 2，token 类 key 替换成 `[redacted]`）。

`rawArchivePath` 会通过 `cliOpts.rawArchivePath` 传给 `spawnCli`，超时事件里带出来 —— 所以超时诊断里直接告诉你去哪个文件复盘。

### 6.4 审计事件

Codex 是唯一接了 `EventAuditLog` 的 provider【源码】：`extractCommandExecutionLifecycle()` → `AuditEventTypes.CLI_TOOL_STARTED` / `CLI_TOOL_COMPLETED`，data 里有 `{invocationId, userId, catId, tool:'command_execution', command, status?, exitCode?}`。

`AuditContext = {invocationId, threadId, userId, catId}` 是关联键。

F236 的 anchor eval 走另一条路：hook 子进程写 `/tmp/cat-cafe-anchor-eval-<invocationId>.jsonl`，PTY carrier 用 `TranscriptTailer` tail 它，`ingestEvalEntries()` 转成 `recordAnchorPreviewEvent()` / `recordAnchorDrillEvent()` + `recordAnchorFullDrill()`。三个临时文件路径约定（必须与 `f236-anchor-posttool.mjs` 保持一致）：

```
/tmp/cat-cafe-anchor-eval-<invocationId>.jsonl        resolveEvalJsonlPath()
/tmp/cat-cafe-anchor-mode-<invocationId>              resolveModeFilePath()
/tmp/cat-cafe-anchor-filestate-<invocationId>.json    resolveStateFilePath()
```

### 6.5 遥测（OTel）

- `parentSpan` 从 `AgentServiceOptions` 传给 `spawnCli`，建 CLI session 子 span（F153 Phase B）
- `agent_loop` 消息在 LLM 调用边界产生 → `recordAgentLoop` 计数（F153 Phase I，KD-31/KD-33）
- `toolTracing` 让 hydrate 侧能重建真实耗时的 `cat_cafe.tool_use ...` span（F153 Phase J Slice J-B AC-J7）
- Antigravity 有专门的三个 instrument：`antigravityStreamErrorBuffered` / `antigravityStreamErrorExpired` / `antigravityStreamErrorRecovered`，加上 `GENAI_MODEL` / `GENAI_SYSTEM` / `STREAM_ERROR_PATH` 语义约定和 `normalizeModel()`

### 6.6 怎么复现问题（可操作的入口）

| 症状 | 复现/诊断手法 |
|---|---|
| 想固定用某个 Claude 载体 | 设 `CAT_CAFE_CLAUDE_CARRIER=bg_daemon\|interactive_pty\|print_sdk\|api_key`。**未知值一律落到 `print_sdk`**（AC-B8 回归钉子） |
| 想清掉降级状态重来 | 重启 API 进程（内存 cache 清空）+ 删 Redis 的 `carrier:health:*`；测试里用 `_resetHealthStoreForTest()` |
| 想换 Gemini adapter | 设 `GEMINI_ADAPTER=gemini-cli\|antigravity-cli\|antigravity`（默认 `antigravity-cli`） |
| 想改 Codex 沙箱/审批 | `CAT_CODEX_SANDBOX_MODE` / `CAT_CODEX_APPROVAL_POLICY`，非法值静默落回默认 |
| 想看 AGY 的原始日志 | 传 `options.agyLogPathOverride`（否则跑完就 `rmSync` 删了） |
| 想看 bg 的原始产物 | `~/.claude/jobs/<shortId>/state.json` + `timeline.jsonl` + `state.linkScanPath` 指向的 transcript |
| 想验证 bg/PTY 的计费身份 | bg：`JobEventConsumer.readTranscriptEntrypoints(path)` 返回 `{entrypoint: count}` 直方图（AC-B6 验证专用）；PTY：`done.metadata.entrypoint`（来自 hook 注入的 `_cc_entrypoint`） |
| 想看 PTY 的 tmux 会话 | `tmux ls` 找 `f230pty-<8位随机>`；`tmux attach -t <name>` 直接看 TUI |
| 想改 AGY profile 根目录 | `CAT_CAFE_AGY_PROFILE_ROOT`（默认 `~/.cat-cafe/agy-profiles`）；cwd sandbox 根用 `CAT_CAFE_AGY_CWD_ROOT`（默认 `~/.cat-cafe/agy-cwd`） |
| 想改 MCP server 路径 | `CAT_CAFE_MCP_SERVER_PATH`（相对路径会按 `process.cwd()` resolve） |
| 想改工作区授权 | `ALLOWED_WORKSPACE_DIRS` > thread 的 `workingDirectory` > `CAT_CAFE_WORKSPACE_ROOT` > `process.cwd()` |
| 想改 Kimi 配置位置 | `KIMI_SHARE_DIR`（默认 `~/.kimi`）、`KIMI_CONFIG_FILE` |
| 想改 Codex session 目录 | `CODEX_HOME`（默认 `~/.codex`） |

---

## 7. 面试追问应对

### Q1：「六种 CLI 的输出格式完全不一样，你的统一接口是怎么做到不漏信息的？」

> 「接口是 `AsyncIterable<AgentMessage>`，`AgentMessage` 有 12 个 type。我的做法不是"求最大公约数"，而是**分三层**：
> 第一层是所有 provider 都必须产的：`session_init` / `text` / `error` / `done`。
> 第二层是能力性的，有就发、没有就不发：`tool_use` / `tool_result` / `agent_loop`。比如 Claude PTY 载体因为只能拿到 hook 事件，就没有 thinking、没有 token usage —— 我们没有假装有，`done.metadata.usage` 就是个空对象。
> 第三层是逃生舱：`system_info`，`content` 里塞 JSON 字符串。所有 provider 特有的东西都从这里出去 —— Codex 的 `task_progress`、AGY 的 `agy_trajectory_progress`、Kimi 的 `provider_capability`、Claude 的 `compact_boundary` 和 `rate_limit`。
> 关键是**不硬编 provider 语义到核心契约里**。唯一破了这条规矩的是 `AgentMessage.sessionLifecycle`，它的类型直接是 `AntigravitySessionLifecycle` —— 那是我会重构的地方。」

**加分点**：主动说出 Kimi 那两条 `provider_capability` 消息 —— 「我们让 provider **显式声明降级**，而不是静默地不发 thinking。用户会看到"当前 Kimi 模型能力未声明 thinking，已按普通回答处理"。这是诚实性设计。」

### Q2：「Claude 那四种载体的区别到底在哪？为什么要四种？」

> 「本质是**计费身份**。`claude -p` 会让 CLI 自己把 `CLAUDE_CODE_ENTRYPOINT` 设成 `sdk-cli`，走 API 计费；我们想走订阅额度，就得让 entrypoint 保持 `cli`。
> `--bg` 是第一次尝试：不用 `-p`，改成守护进程模式，输出从 `~/.claude/jobs/<short>/state.json` 和它指向的 transcript jsonl 里读。代价是每轮 resume 都 fork 一个新的会话 UUID，所以我们加了 `usesChainKeyResume()` 这个能力探针，让上层用 `bg:${threadId}:${catId}` 做稳定锚点。
> 交互 PTY 是第二次尝试：用 tmux 起一个真的交互式 claude，用括号粘贴喂 prompt，输出走 Stop / PostToolUse hook 写的 sidecar jsonl。它的独特价值是**拿到了计费身份的文件级证据** —— hook 捕获脚本里有一句 sed，把 `$CLAUDE_CODE_ENTRYPOINT` 注进每条 JSON，我们能在 `done.metadata.entrypoint` 里看到它就是 `cli`。
> `api_key` tier 代码上就是 `-p`，分出来只是为了降级链有个"订阅打完了掉到按量付费"的语义位，而且它在健康状态机里是**硬编码永远健康**的链尾兜底。
> 能力上是递减的：`-p` 有 token 级流式、精确 usage、thinking、F215 畸形检测；`--bg` 降到消息级流式、合成 usage；PTY 降到回合级、零 usage。」

**加分点**：「PTY 从读 transcript 改成读 hook 是被逼的 —— claude 2.1.172+ 的交互 TUI **不再写 transcript 文件**了，原来的 `watchForTranscriptFile()` 会 100% 超时。所以有了 `skipTranscriptAck: true` 这个开关。」

### Q3：「载体降级的状态机怎么设计的？为什么是 4 小时和 30 分钟？」

> 「三类失败对应三种 TTL 语义：
> **quota**（4 小时）—— 配额是**账号级**的，撞了以后所有猫都用不了，而且短时间内不会恢复。
> **structural**（30 分钟）—— 二进制找不到、L0 编译失败、spawn 失败这类问题可能在一次部署或重启后自愈，所以给短 TTL。
> **transient**（不降级）—— 网络抖动、超时、abort。默认分类就是它 —— 未知错误不降级，因为降级代价大。但连续 3 次会升级成 structural。
> TTL 到期不是直接恢复，是进**探测窗口**：`isHealthy()` 返回 true 让下一次调用去试，但 `getHealth().state` 还是 `degraded`。这次调用成功了 `FallbackCarrierWrapper` 才调 `reportRecovery()` 正式清掉。这样避免了"TTL 一到就乐观地认为好了"。
> 还有一条：**成功要打断 transient 连击**。健康 tier 上跑成功了会 `resetTransientCount()`，因为 D1 说的是"连续"3 次。」

**加分点**：「降级只在 catch 分支做，流中途 yield 出来的 error 只记账不重试。注释写得很清楚：`partial output may already have been yielded to the user` —— 用户已经看到半截了，你再切载体重跑一遍会输出两份。而且只降一级，不级联。」

### Q4：「AGY 那条逆向链路能讲一下吗？」

> 「`agy --print` 是个黑盒 —— 阻塞到结束，只吐一坨纯文本，还有个致命问题：`--print --conversation <id>` 每轮会把**整段历史**重新打印一遍，第三轮的 stdout 是 `[1,2,3]`。
> 我们从三个面把信息挖出来：
> **① 日志文件**：`--log-file <tmp>`。用五个前缀正则（`Created conversation` / `Print mode: conversation=` / `Streaming conversation` / `Sending user message to conversation` / `Forwarding user message to conversation`）加 UUID 抓会话 id，取最后一次匹配；用 `Propagating selected model override to backend: label="..."` 抓实际模型；用 `appDataDir=(\S+)` 抓数据目录。
> **② 内部 SQLite**：`<appDataDir>/conversations/<cascade-uuid>.db` 的 `steps(idx, step_type, status, step_payload BLOB)` 表。fresh turn 的 db 路径能从日志拼出来；**resume turn 的日志是空的**，而且 AGY 会另起一个新的 cascade db —— 所以改成扫 `conversations/*.db`，只认 birthtime 或 mtime 晚于 invocation 启动时刻的，而且必须**恰好一个候选**，0 个或多个就放弃。
> **③ 解 step_payload**：手写了一个 minimal protobuf wire-format 解析器。逆向结论是顶层 field 20 是 assistant message，20.1 是 final answer（20.8 兜底），20.3 是 thinking 要排除。工具调用在 field 28（runCommand）和 field 5（两种嵌套形态）。
> 拿到本轮 final answer 后，用 `textMode: 'replace'` 覆盖整个气泡，根治累加重放。」

**加分点**（这个最能加分）：「整条链**全 fail-open**。protobuf 解析异常返回 null，SQLite 读不出来返回空数组，db 定位不到返回 null，最后 `classifyAntigravityCliPlainText` 在没拿到 final text 时保留原 stdout。最坏情况是退回到"没这个功能"的行为 —— 会看到累加重放、看不到进度 —— 而不是输出一段截断的错误回复。而且我们只解了三条被 `protoc --decode_raw` 实测过的字段路径，再加 20 个工具名白名单和 UUID 格式校验来压手写解析器的误报。」

### Q5：「进度观测那个 SQLite 轮询，会不会拖垮 API 进程？」

> 「会，所以 `busy_timeout` 设成了 **50 毫秒**。因为 better-sqlite3 是**同步**的 —— AGY 的写进程拿着锁的时候，一个几秒的 busy_timeout 会直接阻塞 Node 的事件循环。进度是可选的侧通道遥测，宁可快速 fail-open 靠下一轮 500ms 的重试。
> 另外 `ensureOpen()` 是**三态**的：`ready` / `retry` / `incompatible`。文件还没建、steps 表还没建、拿不到锁 —— 全是 `retry`（AGY 会先写 log 再建 SQLite，有启动竞态）；只有"表存在但缺列"才是 `incompatible`，永久放弃。这个区分是砚砚 P1-1 提的。
> 增量读也不是简单的 `idx > cursor`：一个 step 会先以 `status != 3` 出现、之后原地变成 3，所以 SQL 是 `WHERE idx > ? OR idx IN (activeIdxs)`，`activeIdxs` 是还没完成的 step 集合。」

### Q6：「ACP 是什么？为什么它的超时机制这么复杂？」

> 「ACP = Agent Client Protocol，JSON-RPC 2.0 跑在 NDJSON over stdio 上。我们是 client，`gemini --acp` / `opencode acp` / kimi 是 agent。
> 超时复杂是因为**四种不同的"卡住"要分开对付**：
> ① agent 一直在产事件但永远不结束 → **活动型回合预算**，每个事件重置 15 分钟计时器。持续有输出就永不触发。
> ② agent 开了口就不说了 → **空闲看门狗**，20 秒警告、90 秒判定卡死。注意卡死延时是相对 `lastEventAt` 算的，警告在 20s、卡死在 90s 时，第二个定时器要在警告后 70 秒才触发。
> ③ agent 在等 MCP 工具返回 → 这时候空闲是**正常的**，所以有 `pendingTool` 标志压制告警。但压制不能无限 —— 加了 3 分钟的 `TOOL_EXECUTION_CEILING_MS` 硬上限，而且未达上限也要重新排期，不能 dead-end。修复前 kimi-acp 遇到挂死的工具会一直阻塞到 15 分钟回合预算。
> ④ 上游 429 但一个事件都没来 → **注入合成事件**。stderr 里正则匹配 `MODEL_CAPACITY_EXHAUSTED|No capacity available|status 429.*Retrying`，命中就往事件队列里塞一条 `provider_capacity_signal`。因为消费循环是 `await` 在空队列上的，光回调是叫不醒它的。
> 最外面还有 1 小时的 `HARD_CEILING_MS` 给 `sendRequest` 的 promise 兜底。」

**加分点**：「错误分类有两级证据。ACP 超时时，如果本次 invoke 实时抓到了容量信号 → `evidence: invoke_signal`；如果只有 client 级的 `_recentCapacitySignal` 且在 10 分钟窗口内 → `evidence: recent_process_signal, Ns ago`（应对 CLI 缓冲导致的延迟 stderr）；都没有才判 `turn_budget_exceeded`。catch 里还有 2 秒宽限专门等迟到的 stderr。」

### Q7：「你怎么保证不同 provider 的 token 统计能横向比较？」

> 「靠**在抽取处归一化**，而不是在消费处。`TokenUsage.inputTokens` 的契约是"**总输入**（新 + 缓存）"，所以：
> Claude 的 `extractClaudeUsage` 算 `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`；
> OpenCode 算 `tokens.input + tokens.cache.read + tokens.cache.write` —— 这条是个真 bug 修出来的：只抄 `tokens.input` 的话，一个长缓存会话（671 fresh + 21k cached）会看起来只有 671，fillRatio 下溢，handoff 在撞上下文墙之前永远不触发；
> Codex 的 `turn.completed.usage.input_tokens` 本来就是总量，但它可能是 CLI session 累计的，所以我们额外去读 `~/.codex/sessions/**/rollout-*.jsonl` 尾部 256KB 找最后一条 `token_count`，用 `last_token_usage.input_tokens` 覆盖；
> Gemini CLI 的 stats 是**跨轮累计**的，没法归一化，所以我们打了个 `isCumulativeUsage: true` 标志，让下游知道不能拿它算单轮填充率。
> 另外还分了 `inputTokens`（跨轮累加，`mergeTokenUsage` 里是加法）和 `lastTurnInputTokens`（最新快照，取最新值）—— 封存判定用的是后者。」

### Q8：「Windows 上踩过哪些坑？」

> 「至少五类，都留在注释里：
> ① **命令行 32,767 字符上限**：A2A 简报 + 记忆 + 图片提示会把 prompt 顶爆，`spawn ENAMETOOLONG`。解法是 prompt 走 stdin、append-system-prompt 走临时文件。
> ② **Claude CLI 把内联 JSON 当文件路径**：`--mcp-config '{"mcpServers":...}'` 在 Windows 上不行，要写临时文件传路径。
> ③ **Rust 写的 codex 用 `USERPROFILE` 不用 `HOME`**：HOME 隔离时要两个都设。
> ④ **NTFS junction 首次启动不可穿越**（#802）：L0 编译脚本按 cwd 找不到时，退回从模块自身路径上溯 8 层的 install root。
> ⑤ **git bash 路径**：`CLAUDE_CODE_GIT_BASH_PATH` 要显式注入，靠 `findGitBashPath()` 解析。
> 还有一条不是坑是限制：**PTY 载体在原生 Windows 上不支持**，因为 tmux 没有原生 Windows 版。文件头写了要走 WSL，ConPTY 方案是 Phase C+。」

### Q9：「用户能自己传 CLI 参数，怎么防止他把系统注入的东西覆盖掉？」

> 「分两层。
> 第一层是**普通去重**：用户 flag 和系统 flag 冲突时，删掉系统那一对（flag + 值），用户的追加在最后。`--add-dir` 这类在 `accumulativeFlags` 白名单里，属于可累加，不删。
> 第二层是**保留字段保护** —— 这些不许被覆盖，会被剔掉并打 warn：
> Claude 的 `RESERVED_SYSTEM_PROMPT_FLAGS`（`--system-prompt-file` / `--system-prompt` / `--append-system-prompt` / `--append-system-prompt-file`）；
> Codex 的 `RESERVED_SYSTEM_CONFIG_KEYS`（`developer_instructions`），而且 `--config` 和 `-c` 两种写法都要拦 —— 因为 `-c` 是 `codex exec --help` 文档化的短别名，漏了它就等于 L0 静默丢失，这是被标成 P1 的；
> AGY 的 `ANTIGRAVITY_USER_BLOCKED_FLAGS`（`--dangerously-skip-permissions` / `--model`）加上内部参数 `--conversation` / `--log-file`。
> 理由是一样的：这些参数承载的是抗压缩的身份/家规层，用户覆盖它等于让猫忘了自己是谁 —— 而且是**静默**的。」

### Q10：「MCP 配置在四种 CLI 上格式都不一样，怎么处理的？」

> 「统一从 `capabilities.json` 读（F249：**项目优先**，先看 `<workingDirectory>/.cat-cafe/capabilities.json`，读不到再看运行时根），然后各自适配：
> Claude / Kimi → `{mcpServers: {...}}` JSON（Claude 内联或临时文件、Kimi 写 `<shareDir>/tmp-mcp-*/mcp.json` 权限 0600）；
> Codex → 一条条 `--config mcp_servers.X.Y=Z` TOML 赋值；
> OpenCode → 运行时 config 文件的 `mcp` 字段；
> ACP → `session/new` 参数里的 `mcpServers[]`，env 是 `Array<{name,value}>` 而不是对象。
> 四条路都做同一件事：用户项目的 MCP 配置合并进来，但**我们管理的名字优先** —— 用 `expandManagedMcpNamesForUserMerge()` 展开排除集（它会把老的 `cat-cafe` 单体别名和 6 个 split 名字一起展开，防止陈旧配置从别名溜回来）。
> Codex 那条最脏：禁用一个服务不能只写 `enabled=false`，Codex ≥0.142 的 schema 校验会挂，必须给一个完整的假形状（`command="echo"` + `args=["disabled-shim"]`）；而且 URL 型的禁用只能发 `url` + `enabled=false`，叠 command 会报 `url is not supported for stdio`。」

**加分点**：「还有个 `#1074`：Codex 不支持 MCP 的任意 header，只支持 `bearer_token_env_var`。所以我们从 `Authorization: Bearer <token>` 里把 token 抠出来放进环境变量。变量名是 `CLOWDER_MCP_BEARER_<SANITIZED>_<sha256前8位>` —— 那个 hash 后缀是防碰撞的，因为 `foo-bar` 和 `foo_bar` sanitize 之后会撞成同一个名字，会把一个服务的 token 路由给另一个服务。」

### Q11：「一次调用什么都没输出，你怎么知道是哪种'没输出'？」

> 「有三种不同的'空'，我们分开报：
> ① **silent_completion**：`eventCount > 0` 但 `textEventCount === 0`，而且没有别的错误已经报过、也不是纯工具轮。诊断里带 `eventTypes[]`（这次都收到了哪些类型的事件）、`stderrPresent` / `stderrExcerpt`、`model` / `sessionId`。
> ② **F215 malformed_toolcall（form A）**：最后一个 assistant 事件的 content 里**既没有 tool_use 块也没有 text 块**（只有 thinking）。这是 Opus 的一种已知失败模式，我们先发一条 `system_info` 让上层触发封存 + 降级链，再发一条显式 error 让用户看见。
> ③ **AGY 的 empty**：`agy --print` 的 stdout 是空的。这时候如果 stderr 里能分类出一个真的 `reasonCode`，就报那个 error；否则才降级成 `silent_completion` 的 system_info。
> 关键判据是 `errorAlreadyYielded` 这个门 —— 已经报过真错误（`model_not_found` / 超时 / auth 失败）就不再报 silent，避免噪音重复。还有一条 R1 P1 修的：纯 tool_use 轮是**合法完成**（F215 AC-B3），工作是通过工具做的，不该被标成 silent。」

### Q12：「`FallbackCarrierWrapper.invoke()` 为什么要写成返回一个手工的 asyncIterator 对象？」

> 「因为 `AgentService.invoke()` 的契约是**同步返回** `AsyncIterable`，不是返回 Promise。如果直接把 `_invoke` 写成 `async *invoke()`，签名是对的；但这里想在外面套一层，又要保持同步返回，所以：
> ```ts
> invoke(prompt, options): AsyncIterable<AgentMessage> {
>   const self = this;
>   return { [Symbol.asyncIterator]() { return self._invoke(prompt, options); } };
> }
> ```
> 源码注释就一句话：`Must return AsyncIterable synchronously (not Promise) — AgentService contract`。这是个很小但很容易写错的点 —— 写成 `async invoke()` 的话调用方拿到的是 Promise，`for await` 会静默地遍历一个 Promise 而不是流。」

---

## 8. 本篇速查表

### 8.1 常量总表（全部是源码字面值）

| 常量 | 值 | 文件 |
|---|---|---|
| `PERMISSION_MODE` | `'bypassPermissions'` | `ClaudeAgentService.ts` |
| `ANTHROPIC_PROFILE_MODE_KEY` | `'CAT_CAFE_ANTHROPIC_PROFILE_MODE'` | 同上 |
| `ANTHROPIC_MODEL_OVERRIDE_KEY` | `'CAT_CAFE_ANTHROPIC_MODEL_OVERRIDE'` | 同上 |
| `ANTHROPIC_PROFILE_API_KEY` / `_BASE_URL` | `'CAT_CAFE_ANTHROPIC_API_KEY'` / `'CAT_CAFE_ANTHROPIC_BASE_URL'` | 同上 |
| `SUBSCRIPTION_MODE_DENY_KEYS` | 7 个（见 §3.1.3） | 同上 |
| `RESERVED_SYSTEM_PROMPT_FLAGS` | 4 个 | 同上 |
| `SHORT_ID_PATTERN` | `/backgrounded\s*·\s*([a-f0-9]{8})/` | `ClaudeBgCarrierService.ts` |
| `UUID_PATTERN` | `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` | 同上 |
| bg `pollMs` / `timeoutMs` | `500` / `30 * 60_000` | 同上 |
| PTY `pollIntervalMs` / `terminalTimeoutMs` | `500` / `5 * 60 * 1_000` | `ClaudeInteractivePtyCarrierService.ts` |
| PTY `readyTimeoutMs` / `readyGraceMs` / `bypassConfirmationGraceMs` | `30_000` / `15_000` / `5_000` | 同上 + `PtyDriver.ts` |
| PTY 粘贴宽限 | `Math.max(2, text.length / 15_000)` 秒 | `PtyDriver.injectPrompt()` |
| PTY 会话名前缀 | `'f230pty'` + 8 位随机（`Math.random().toString(36).slice(2,10)`） | `pty-utils.generateSessionName()` |
| `watchForTranscriptFile` 超时 / 轮询 | `5_000` / `200` ms | `PtyDriver` / `pty-utils` |
| hook timeout | capture 脚本 `5` 秒，anchor hook `10` 秒（**单位是秒**，schema 上限 600） | `pty/hook-setup.ts` |
| `DEGRADATION_CHAIN` | `['bg_daemon','interactive_pty','print_sdk','api_key']` | `carrier-health.ts` |
| `QUOTA_TTL_MS` / `STRUCTURAL_TTL_MS` / `TRANSIENT_UPGRADE_THRESHOLD` | `4h` / `30min` / `3` | 同上 |
| Redis key | `` `carrier:health:${tier}` `` | 同上 |
| `CARRIER_ENV_KEY` | `'CAT_CAFE_CLAUDE_CARRIER'` | `claude-carrier-factory.ts` |
| `MAX_RECENT_STREAM_ERRORS` / `MAX_STREAM_ERROR_LENGTH` | `5` / `240` | `CodexAgentService.ts` |
| `RESERVED_SYSTEM_CONFIG_KEYS` | `Set(['developer_instructions'])` | 同上 |
| Codex 默认沙箱 / 审批 | `'danger-full-access'` / `'on-request'` | `config/codex-cli.ts` |
| Codex `autoCompactTokenLimit` 缺省 | `Math.floor(contextWindow * 0.88)` | `cat-config-loader.getCatContextWindowConfig()` |
| `DEFAULT_TAIL_BYTES` / `DEFAULT_FILE_CACHE_MAX` | `256 * 1024` / `100` | `codex-session-context-snapshot.ts` |
| `IMAGE_MIME_WHITELIST` / `MAX_BASE64_LENGTH` | 5 种 MIME / `5 * 1024 * 1024` | `codex-event-transform.ts` |
| `MAX_REDACT_DEPTH` / `REDACTED` | `2` / `'[redacted]'` | `codex-audit-hooks.ts` |
| `DEFAULT_GEMINI_ADAPTER` | `'antigravity-cli'` | `GeminiAgentService.ts` |
| `ANTIGRAVITY_USER_BLOCKED_FLAGS` | `Set(['--dangerously-skip-permissions','--model'])` | 同上 |
| `SIDE_CHANNEL_DRAIN_MS` | `200` | 同上 |
| `JSONL_HEADER_MAX_BYTES` | `1024` | 同上 |
| `BUSY_TIMEOUT_MS` | `50` | `agy-trajectory-observer.ts` |
| `PREFIX_FINGERPRINT_MAX_SAMPLED_ROWS` / `_EDGE_SAMPLE_ROWS` | `64` / `16` | 同上 |
| AGY 进度轮询 | `500` ms | 同上 |
| `MAX_VARINT_BYTES` / `FIELD_ASSISTANT_MESSAGE` / `FIELD_FINAL_TEXT` / `_FALLBACK` | `10` / `20` / `1` / `8` | `agy-trajectory-extractor.ts` |
| `KNOWN_TOOLS` | 20 个工具名 | 同上 |
| AGY final answer 的 step_type | `15` | 同上 |
| AGY profile 根 / cwd 根 | `~/.cat-cafe/agy-profiles` / `~/.cat-cafe/agy-cwd`（env 可覆盖） | `agy-profile-manager.ts` |
| AGY workspaceKey | `sha256(resolve(workingDirectory)).slice(0,16)` | 同上 |
| `OPENCODE_AUTO_APPROVE_FLAG` / `_MIN_VERSION` / `_PROBE_TIMEOUT_MS` | `'--auto'` / `'1.17.12'` / `10_000` | `OpenCodeAgentService.ts` |
| `OC_INSTRUCTIONS_ONLY_ENV` | `'CAT_CAFE_OC_INSTRUCTIONS_ONLY'` | 同上 |
| `OC_API_KEY_ENV` / `OC_BASE_URL_ENV` | `'CAT_CAFE_OC_API_KEY'` / `'CAT_CAFE_OC_BASE_URL'` | `opencode-config-template.ts` |
| `OPENCODE_BUILTIN_NAMES` | `Set(['openai'])`（→ `openai-compat`） | 同上 |
| `DEFAULT_KIMI_BASE_URL` / `DEFAULT_KIMI_MODEL_ALIAS` | `'https://api.moonshot.ai/v1'` / `'kimi-code/kimi-for-coding'` | `kimi-config.ts` |
| Kimi 兜底窗口 / `KIMI_CONTEXT_TAIL_BYTES` | `262_144` / `64 * 1024` | 同上 |
| `KILL_GRACE_MS` | `3_000`（SIGTERM → SIGKILL） | `acp/AcpClient.ts` |
| ACP `promptStream` 默认值 | `timeoutMs 900_000` / `idleWarningMs 20_000` / `idleStallMs 90_000` / `HARD_CEILING_MS 3_600_000` / `TOOL_EXECUTION_CEILING_MS 180_000` | 同上 |
| ACP `promptCollect` 默认超时 / `sendRequest` 默认超时 | `120_000` / `60_000` | 同上 |
| `CAPACITY_RE` | `/MODEL_CAPACITY_EXHAUSTED\|No capacity available\|status 429.*Retrying/i` | 同上 |
| `RECENT_SIGNAL_MAX_AGE_MS` | `10 * 60 * 1000` | `acp/AcpAgentService.ts` |
| `MAX_SCRATCHPAD_SUPPRESSED_EVENTS` | `50` | 同上 |
| `SCRATCHPAD_MARKER` / `SCRATCHPAD_TAIL_CHARS` | `'## Goal'` / `800` | `acp/acp-event-transformer.ts` |
| `DEFAULT_ACP_IDLE_TTL_MS` | `30 * 60 * 1000` | `acp/AcpProcessPool.ts` |
| A2A 默认超时 | `120_000` | `A2AAgentService.ts` |
| CatAgent 常量 | `ANTHROPIC_API_VERSION '2023-06-01'` / `DEFAULT_MAX_TOKENS 4096` / `MAX_TOOL_TURNS 15` / `TOOL_RESULT_DIGEST_LIMIT 500` | `catagent/CatAgentService.ts` |
| Antigravity RPC 超时 | `DEFAULT_RPC_TIMEOUT_MS 30_000`；RunCommand = `max(30s, timeoutMs + 5_000)` | `antigravity/AntigravityBridge.ts` |
| Antigravity 重试延迟 | `[1000,3000,5000,10000,15000,20000,30000,36000]` ms | `antigravity/AntigravityAgentService.ts` |
| `CAT_CAFE_SPLIT_ENTRYPOINTS` | 6 个（collab/memory/signals/limb/audio/finance） | `config/capabilities/mcp-constants.ts` |
| `MCP_CALLBACK_ENV_KEYS` | 9 个 | 同上 |

### 8.2 各 provider 的 context window 与封存阈值

`CONTEXT_WINDOW_SIZES` 兜底表【源码 `config/context-window-sizes.ts`】：

| 模型 key | 窗口 |
|---|---|
| `claude-opus-4-6` / `claude-sonnet-4-5` / `claude-haiku-4-5` | 200_000 |
| `gpt-5.3` / `gpt-5.2` | 128_000 |
| `gpt-5.1-codex` | 400_000 |
| `o3` / `o4-mini` | 200_000 |
| `MiniMax-M3` / `minimax-m3` | 1_000_000 |
| `gemini-2.5-pro` / `gemini-2.5-flash` / `gemini-3-pro` / `gemini-3.1-pro-preview` | 1_000_000 |
| `OPENCODE_DEFAULT_CONTEXT_WINDOW`（最后手段） | 128_000 |

`getContextWindowFallback(model)` 的查找：先按 `lastIndexOf('/')` 剥掉 provider 前缀（`anthropic/claude-opus-4-6` → `claude-opus-4-6`），精确命中 → 返回；否则遍历表做**前缀匹配**（`claude-opus-4-6-20260101` 能匹配上 `claude-opus-4-6`）；都不中返回 `undefined`。

各 provider 的窗口来源：

| Provider | `contextWindowSize` 来源 | `lastTurnInputTokens` 来源 | 备注 |
|---|---|---|---|
| Claude `-p` | **精确**：`result/success` 的 `modelUsage[model].contextWindow`（兼容 `model_usage`） | `message_start.usage` 的 `input + cache_read + cache_creation`；`message_start` 里是 0 时从 `message_delta.usage` 补 | 最完整的一路 |
| Claude `--bg` | ❌（合成 result 事件里没有 modelUsage）→ 走兜底表 | ❌ | usage 靠累加器 |
| Claude PTY | ❌ | ❌ | `usage = {}` |
| Codex | `--config model_context_window=N` 设进去；读回来靠 session `token_count.info.model_context_window` | `token_count.info.last_token_usage.input_tokens`（覆盖 `turn.completed` 的值） | 还有 `contextUsedTokens` / `contextResetsAtMs` |
| Gemini CLI | `result.stats.context_window` 或 `contextWindow` | 从 `~/.gemini/tmp/**/chats/session-*.jsonl` 里读 `tokens.input` | stats 打 `isCumulativeUsage: true` |
| AGY | ❌ | ❌ | 纯文本输出，没有 usage |
| OpenCode | ❌ CLI 从不发 → 兜底表 → 再兜底 `OPENCODE_DEFAULT_CONTEXT_WINDOW` | `input + cache.read + cache.write` | transformer **故意不**塞默认窗口 |
| Kimi | `modelConfig.maxContextSize`（config.toml 的 `max_context_size`，兜底 262_144） | `readKimiContextUsedTokens()` 从 `<shareDir>/sessions/<id>/context.jsonl` 尾部找 `role === '_usage'` 的 `token_count` | 也写 `contextUsedTokens` |
| ACP / A2A | ❌ | ❌ | 协议里没有 |
| CatAgent | ❌ | Anthropic SSE 的 usage 事件 | `mergeTokenUsage` 跨轮累加 |

**封存阈值 `0.85`**：`config/context-window-sizes.ts` 的注释里明确提到 `the 0.85 seal threshold trips around 108k`【源码，注释】。阈值本身的判定代码在 `invoke-single-cat` 的 F24 contextHealth 路径里（本篇没有覆盖那个文件）【推断】。Codex 另有一个 CLI 侧的自动压缩线 `model_auto_compact_token_limit = floor(contextWindow * 0.88)`【源码】—— 注意这是 **CLI 自己压缩**的线，和我们**封存换会话**的 0.85 是两套机制。

### 8.3 各 provider 支持的 hook 汇总

这里的 "hook" 指 CLI 自己的钩子机制（我们能不能挂上去）：

| Provider | 支持的 hook | 我们用了吗 | 出处 |
|---|---|---|---|
| Claude `-p` | Claude Code hooks（含 F177-G 的 Stop hook） | ✅ 路由退出靠 Stop hook 兜底（所以 `needsServerRoutingGuard()` 是 false） | `types.ts` `needsServerRoutingGuard` 注释 |
| Claude `--bg` | 同上（daemon 里的 claude 仍是 Claude Code） | 未在 provider 层显式配置 | — |
| Claude PTY | **Stop + PostToolUse**，写 `<cwd>/.claude/settings.json` | ✅ **这是它唯一的输出面**。另可选挂 `f236-anchor-posttool.mjs`（matcher `Read\|Grep\|Glob`，10s） | `pty/hook-setup.ts` |
| Codex | ❌ `codex exec --json` **不派发** `~/.codex/hooks.json`（H0 spike 2026-06-11 实证） | 所以 `needsServerRoutingGuard()` 返回 **true**，串行路由层做服务端兜底 | `types.ts` + `CodexAgentService` 注释 |
| Gemini CLI / AGY | ❌ | — | — |
| OpenCode | 有 plugin 机制（`config.plugin = ['oh-my-opencode']`），不是 hook | 只在 `generateOpenCodeConfig()`（旧版模板）里用 | `opencode-config-template.ts` |
| Kimi | ❌ | — | — |
| ACP | 协议级的 agent→client 请求（`session/request_permission` / `fs/read_text_file` / `fs/write_text_file`），语义上等价于 hook | ✅ 权限请求自动批准（优先 `allow_always`）；文件读写请求当前回 `-32601` 未实现 | `acp/AcpClient.handleAgentRequest()` |
| A2A / CatAgent / Antigravity IDE | ❌ | — | — |

**PTY hook 配置的确切 schema**（面试可能追问）：

```
hooks.<EventName> = Array<{ matcher?: string; hooks: Array<{type:'command'; command:string; timeout?:number}> }>
```

- `matcher` 是**对工具名的正则**，省略 = 所有工具都触发
- `timeout` 单位是**秒**，schema 上限 600
- 同一事件的多个组会**串行链式执行**（capture 脚本先跑，anchor hook 后跑）

### 8.4 各 provider 一句话卡片

| Provider | 命令行骨架 | resume | prompt 位置 | 输出 |
|---|---|---|---|---|
| Claude `-p` | `claude -p --output-format stream-json --include-partial-messages --verbose [--model M] --effort E --permission-mode bypassPermissions --setting-sources ... --chrome --system-prompt-file L0 [--append-system-prompt-file P] [--mcp-config C --strict-mcp-config]` | `--resume <id>` | stdin | stdout NDJSON |
| Claude `--bg` | `claude --bg [--model M] --system-prompt-file L0 [--resume UUID] [--append-system-prompt-file P] --permission-mode bypassPermissions [--mcp-config C --strict-mcp-config]` | `--resume <UUID>`（校验） | stdin | `~/.claude/jobs/<short>/` 文件 |
| Claude PTY | tmux 里 `env -u CLAUDE_CODE_ENTRYPOINT -u CLAUDECODE claude [--resume id] --permission-mode bypassPermissions [--model M] [--mcp-config C --strict-mcp-config] [--add-dir D]` | `--resume <UUID>` + 文件存在校验 | tmux 括号粘贴 | hook sidecar jsonl |
| Codex（新建） | `codex exec --json [--model M] --config ... --sandbox S --add-dir .git --config ... -- -` | — | stdin（`--` `-`） | stdout NDJSON |
| Codex（resume） | `codex exec resume <id> --json --config sandbox_mode=... ... -- -` | `exec resume <id>` | stdin | stdout NDJSON |
| Gemini CLI | `gemini [--resume id] [--model M] -p <prompt> -o stream-json -y [--include-directories D]` | `--resume <id>` | **argv** | stdout NDJSON |
| AGY | `agy --add-dir W [--dangerously-skip-permissions] [--print-timeout Ns] [--model M] --log-file L [--conversation id] --print <prompt>` | `--conversation <id>` | **argv** | stdout 纯文本 + log + SQLite |
| OpenCode | `opencode run [--session id] [-m M] --format json --auto <prompt>` | `--session <id>` | **argv**（最后一个位置参数） | stdout NDJSON |
| Kimi（legacy） | `kimi-cli --print --output-format stream-json [--session id] --work-dir W [--thinking] [--mcp-config-file C] [--add-dir D] [--model M] --prompt <prompt>` | `--session <id>` | **argv** | stdout NDJSON + 文本行 |
| Kimi（新版） | `kimi --output-format stream-json [--session id] [--model M] -p <prompt>` | `--session <id>` | **argv** | stdout NDJSON |
| ACP | `<command> <startupArgs>`（如 `gemini --acp` / `opencode acp`） | `session/load` | JSON-RPC params | stdin/stdout JSON-RPC |
| A2A | HTTPS POST | 无 | JSON body | JSON 响应 |
| CatAgent | HTTPS POST `/v1/messages` | 无（每次新 sessionId） | JSON body | SSE |

### 8.5 关键函数索引（按"我要找什么"查）

| 我要找 | 函数 | 文件 |
|---|---|---|
| 载体选择入口 | `createClaudeAgentServiceForCanary(catId, env)` | `claude-carrier-factory.ts` |
| 按 tier 造载体 | `createCarrierByTier(tier, catId)` | 同上 |
| 失败分类 | `classifyCarrierFailure(error)` | `carrier-health.ts` |
| 选健康 tier | `selectFirstHealthyTier(target, store)` | 同上 |
| Claude env 构造 | `buildClaudeEnvOverrides(callbackEnv)` | `ClaudeAgentService.ts` |
| Claude 模型选择 | `resolveClaudeModelSelection(callbackEnv, fallback)` | 同上 |
| Claude MCP server 路径 | `resolveDefaultClaudeMcpServerPath(cwd)` | 同上 |
| Claude NDJSON 解析 | `transformClaudeEvent(event, catId, streamState)` | `claude-ndjson-parser.ts` |
| Claude usage 提取 | `extractClaudeUsage(e)` | 同上 |
| Claude result 错误判定 | `isResultErrorEvent(event)` | 同上 |
| MCP 状态快照 | `extractClaudeMcpStatusSnapshot(value)` | `claude-mcp-status.ts` |
| bg 起 job | `ClaudeBgCarrierService.startJob(prompt, options)` | `ClaudeBgCarrierService.ts` |
| bg 读状态 | `JobEventConsumer.readState()` / `.readTimeline()` / `.waitForTerminal()` / `.readTranscriptEntrypoints()` | `JobEventConsumer.ts` |
| transcript → 消息 | `transcriptEntriesToAgentMessages(entries, {catId})` | `BgTranscriptEventConsumer.ts` |
| transcript usage | `createUsageAccumulator()` / `accumulateUsageFromEntries()` / `finalizeTranscriptUsage()` / `extractTranscriptUsage()` | 同上 |
| 增量读 jsonl | `TranscriptTailer.readNew({includeTrailingPartial?})` | `TranscriptTailer.ts` |
| hook 事件 → 消息 | `hookEntriesToAgentMessages()` / `isHookTerminalEvent()` / `extractSessionIdFromHookEntries()` / `extractEntrypointFromHookEntries()` | `HookSidechannelConsumer.ts` |
| 装 hook | `setupHookInfrastructure(cwd, sidecarPath)` | `pty/hook-setup.ts` |
| tmux 生命周期 | `PtyDriver.start()` / `.injectPrompt()` / `.cancel()` / `.dispose()` | `pty/PtyDriver.ts` |
| tmux 工具 | `generateSessionName` / `shellQuoteArg` / `buildClaudeCommand` / `tmux` / `tmuxSync` / `snapshotTranscriptFiles` / `watchForTranscriptFile` / `isBypassConfirmationScreen` / `ptyTranscriptDir` / `sleep` / `acquireTranscriptDirWatch` | `pty/pty-utils.ts` |
| Codex MCP 参数 | `buildCatCafeMcpArgs(callbackEnv, workingDirectory)` | `CodexAgentService.ts` |
| Codex TOML 转义 | `toTomlString(value)` | 同上 |
| Codex 保留 config 剥离 | `stripReservedSystemConfigs(args, catId)` | 同上 |
| Codex 事件解析 | `transformCodexEvent(event, catId, state)` | `codex-event-transform.ts` |
| Codex 上下文快照 | `createCodexSessionContextSnapshotResolver(options)` | `codex-session-context-snapshot.ts` |
| Codex 图片扫描 | `scanAndPublishCodexImages(options)` | `codex-image-scanner.ts` |
| 审计/脱敏 | `extractCommandExecutionLifecycle(event)` / `sanitizeRawEvent(event)` | `codex-audit-hooks.ts` |
| Gemini 事件解析 | `transformGeminiEvent(event, catId)` / `isKnownPostResponseCandidatesCrash()` | `gemini-event-parser.ts` |
| AGY 纯文本分类 | `classifyAntigravityCliPlainText(input)` | `antigravity-cli-event-parser.ts` |
| AGY 会话 id / 模型 | `extractAntigravityCliConversationId(log)` / `extractAntigravityCliSelectedModelLabel(log)` | 同上 |
| AGY profile | `resolveAgyProfile(input)` / `preflightAgyProfile(profile, input)` / `resolveAgySpawnCwd(profile, catId, workDir)` | `agy-profile-manager.ts` |
| AGY db 定位 | `locateAgyTrajectoryDb(deps)` / `resolveAgyTrajectoryDbPath(log)` / `resolveAgyAppDataDir(childEnv)` / `listAgyConversationDbs(dir)` | `agy-trajectory-observer.ts` |
| AGY 进度观测 | `observeAgyProgress(deps)` / `AgyTrajectoryObserver.poll(cursor)` | 同上 |
| AGY baseline 校验 | `createAgyResumeBaselineCursorResolver(options)` / `readAgyMaxStepIdx` / `readAgyDbFileIdentity` / `readAgyDbChangeMarker` / `readAgyStepsPrefixFingerprint` | 同上 |
| AGY proto 解析 | `parseAgyStepFinalText(payload)` / `parseAgyStepTools(payload, idx)` / `readAgyTrajectorySteps(dbPath)` / `extractAgyFinalTextFromSteps(steps)` | `agy-trajectory-extractor.ts` |
| OpenCode 事件解析 | `transformOpenCodeEvent(event, catId)` | `opencode-event-transform.ts` |
| OpenCode 配置生成 | `generateOpenCodeRuntimeConfig(options)` / `deriveOpenCodeApiType(name)` / `safeProviderName(name)` / `parseOpenCodeModel(m)` / `buildExternalDirectoryPermissions(dirs)` | `opencode-config-template.ts` |
| OpenCode 配置写入 | `writeOpenCodeRuntimeConfig()` / `writeOpenCodeInstructionsOnlyConfig()` | `opencode-config-writer.ts` |
| OpenCode MCP | `buildOpenCodeMcpSync()` / `resolveCapabilityMcpNamesSync()` | `opencode-mcp-injection.ts` |
| OpenCode ACP 配置 | `prepareOpenCodeAcpSpawnConfig(options)` | `opencode-acp-spawn-config.ts` |
| Kimi 配置 | `resolveKimiModelAlias()` / `readKimiModelConfigInfo()` / `buildApiKeyEnv()` / `writeMcpConfigFile()` / `readKimiSessionId()` / `readKimiContextUsedTokens()` | `kimi-config.ts` |
| Kimi 解析 | `buildKimiPrompt()` / `extractTextContent()` / `extractThinkingContent()` / `parseUsage()` / `parseToolArguments()` / `readSessionIdFromMessage()` | `kimi-event-parser.ts` |
| ACP 协议 | `AcpClient.initialize()` / `.newSession()` / `.loadSession()` / `.setSessionConfigOption()` / `.promptStream()` / `.promptCollect()` / `.cancelSession()` / `.close()` | `acp/AcpClient.ts` |
| ACP 事件转换 | `transformAcpEvent(update, catId, metadata, state)` / `createAcpSessionState()` / `flushAcpThinking()` | `acp/acp-event-transformer.ts` |
| ACP MCP | `resolveAcpMcpServers()` / `resolveBuiltinCatCafeServer()` / `resolveUserProjectMcpServers()` / `resolveDisabledServerIds()` / `materializeSessionMcpServers()` | `acp/acp-mcp-resolver.ts` + `acp-session-env.ts` |
| ACP 池 | `AcpProcessPool.acquire(key, {sessionId})` / `.rememberSession()` / `createAcpPoolSpawnSignature()` | `acp/AcpProcessPool.ts` + `acp-pool-signature.ts` |
| A2A 转换 | `transformA2ATaskToMessages(task, catId)` / `extractTextFromParts(parts)` | `a2a-event-transform.ts` |
| CatAgent 工具执行 | `executeCatAgentTools(blocks, tools)` | `catagent/CatAgentService.ts` |
| L0 编译 | `compileL0ViaSubprocess({catId, outPath?})` / `warmL0Cache()` / `clearL0Cache()` / `resolveL0CompilerScriptPath()` | `l0-compiler.ts` |
| env 模板 | `resolveEnvMap(clientId, provider, account, userEnvMap)` / `extractUserEnvTemplates()` / `hasSupportedEnvTemplate()` | `env-map.ts` |
| 图片 | `extractImagePaths()` / `extractImageUrls()` / `collectImageAccessDirectories()` / `appendLocalImagePathHints()` / `buildImageMediaItems()` / `publishGeneratedImage()` | `image-paths.ts` / `image-cli-bridge.ts` / `generated-image-publication.ts` |
| 会议纪要提示 | `readActiveTranscriptMeta()` / `buildTranscriptPathHints()` / `appendTranscriptPathHints()` | `transcript-path-hints.ts` |
| F236 eval 桥 | `evalEntriesToPreviewEvents()` / `evalEntriesToDrillEvents()` / `ingestEvalEntries()` / `cleanupSessionFiles()` / `resolveEvalJsonlPath()` / `resolveModeFilePath()` / `resolveStateFilePath()` | `AnchorEvalBridgeConsumer.ts` |

### 8.6 判定规则速记（考前十分钟看这个）

```
isKnownAnthropicModel(m)     = m.startsWith('claude-')
useEnvModelOverride          = api_key 模式 && !isKnownAnthropicModel  → 省略 --model
isResultErrorEvent(e)        = e.type==='result' && (e.is_error===true || e.subtype!=='success')
isHookTerminalEvent(e)       = e.hook_event_name === 'Stop'
bg 终态                       = state ∈ {done,error,failed,blocked,stopped} 或 扫到 system/turn_duration
isMalformedToolCall          = hasAssistantEvent && !lastAssistantHasToolUse && !lastAssistantHasText && !sawResultError
silent_completion            = eventCount>0 && textEventCount===0 && !errorAlreadyYielded && !(hasAssistant && hasToolUse)
Codex exit-1 抑制             = exitCode===1 && signal===null && sawSubstantiveOutput && !/remote compaction failed|compact_error/i
sawSubstantiveOutput         = 见过 item.completed（thread.started 不算）
classifyCarrierFailure       = quota 表 → structural 表 → 默认 transient
isHealthy(tier)              = api_key 恒 true；healthy true；degraded 看 Date.now() >= retryAfter
探测窗口成功判定               = 流跑完 && getHealth().state === 'degraded' → reportRecovery
ACP isFinalStatus(s)         = s === 'completed' || s === 'failed'
ACP pendingTool 置位          = updateType ∈ {tool_call, permission_pending}
ACP pendingTool 清除          = pendingTool && updateType ∉ {tool_call_update, agent_thought_chunk}
AGY resume db 定位            = log 能解出 → 用；否则扫 conversations/*.db，时间戳 >= invocationStart 且**恰好 1 个**
AGY final answer              = 最后一个 step_type===15 且 field 20.1（或 20.8）能解出非空文本的 step
AGY textMode                  = resumed 时恒为 'replace'；非 resumed 不设（默认 append）
Kimi isLegacy                 = resolveCliCommand('kimi-cli') !== null
OpenCode 用户接管 --auto        = 用户 flag 里出现 6 个别名中任意一个（含 --no-* 否定形式）
```

---

> **收尾提醒**：这一篇里所有带具体数字、正则、字段名的内容都能在源码里 grep 到；标【推断】的只有三处 —— 五种输出格式的 JSON 样本（从 parser 反推）、`AgentMessage.system_info.content` 是 JSON 字符串这条隐式约定（代码里没有类型约束）、以及 0.85 封存阈值的判定代码位置（在 `invoke-single-cat`，本篇未覆盖）。面试引用时按这个分界说话。

