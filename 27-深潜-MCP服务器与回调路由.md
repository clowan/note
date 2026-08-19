# 27 · 深潜：MCP 工具与 32 个回调路由的实现

> 这一篇覆盖 `packages/mcp-server/src/`（43 文件 / 约 10413 行）与 `packages/api/src/routes/callback*.ts`（32 文件 / 约 10649 行），外加 `agent-key/`（6 文件 / 446 行）、`approval-hub/`（8 文件 / 815 行）、`domains/limb/`（11 文件 / 1297 行）。
> 解决的追问是："你们到底给猫暴露了哪些工具、每个工具怎么鉴权、token 过期那一刻代码走哪条分支、审批流的落盘顺序是什么"。
> 值得读的原因：这是整个系统里唯一一条"猫进程 → HTTP → 服务端状态"的写通道，所有安全边界、幂等、降级都堆在这 2 万行里，面试官只要往深处问一层就必然落到这里。

---

<!-- BEGIN ZERO-BASE EXPANSION 27 -->
## 0A. 零基础导读：MCP 工具、HTTP 回调和可靠性闭环

> MCP 服务器运行在 CLI 子进程可访问的一侧，把“猫想做的动作”变成工具调用；API callback 路由运行在主服务端，负责鉴权、授权、落状态和触发业务。两边通过 HTTP 与 token 连接。

### 0A.1 一次工具调用的完整路径

```text
模型决定调用 cat_cafe_xxx
→ MCP SDK 校验工具名与输入 schema
→ 工具 handler 读取 invocationId/token
→ callbackPost 发 HTTP 请求
→ API preHandler 鉴权并派生 principal/scope
→ route 执行业务或创建 proposal
→ 返回结构化结果
→ MCP 转成模型可读 tool result
```

MCP 不是权限边界本身。真正的身份、scope、审批和资源访问必须在 API 服务端验证。

### 0A.2 ToolDef 与 schema 的作用

工具通常包含：name、description、inputSchema、annotations、handler。schema 不只是给模型看的文档，也用于运行时拒绝缺字段、错类型和越界输入。

但 schema 校验只解决“形状正确”，不解决“是否有权”：合法的 threadId 仍可能不属于当前 principal；合法路径仍可能越出允许根目录。

### 0A.3 HTTP 最小补课

- 路径：`/api/callbacks/...` 表示资源/动作入口。
- header：携带 invocation/token 等元数据。
- body：JSON 业务参数。
- 2xx：请求被接受/成功；4xx：输入、身份或权限问题；5xx：服务端问题。

状态码会影响重试：400/401/403 通常不是盲重试能解决；429、部分 5xx 和网络中断可能适合退避重试。

### 0A.4 authentication 与 authorization

- **认证**：你是谁？token 是否有效，属于哪个 invocation/agent key。
- **授权**：你能做什么？scope 是否允许该 callback，目标资源是否属于你。

`derivePrincipal` 把不同凭证归一为可判别主体；后续路由仍必须按主体类型和 scope 限制。不要因为 token 正确就允许全部工具。

### 0A.5 callback token 为什么要绑定 invocation

短期 token 与 invocation 绑定可以缩小泄露后的影响范围：调用结束或 TTL 到期后失效，也更容易审计“哪次模型执行发起了这个动作”。长期 agent key 则适合需要跨 invocation 的有限能力，但必须使用更严格 scope、轮换和撤销。

### 0A.6 重试、幂等与 at-least-once

网络超时时，客户端不知道服务端“没收到”还是“已处理但响应丢了”。重试会带来重复，因此可靠链必须同时设计：

```text
重试策略 + 幂等键/去重记录 + 可审计结果
```

at-least-once 表示请求可能送达多次，但尽量不丢；业务端必须让重复投递安全。proposal、post message 等有副作用操作尤其需要幂等。

### 0A.7 指数退避与抖动

失败后立即高频重试会造成雪崩。退避让间隔逐步增长，jitter 让多个客户端不要同一时刻再次冲击服务端。每次尝试还要有独立 timeout，并有总次数/总时间上限。

### 0A.8 outbox 为什么要落盘

若 callback 暂时不可达，把请求写入 outbox 后稍后 flush，可提高不丢失概率：

```text
生成 CallbackRequest
→ 原子写入 queued 文件
→ flush 时 rename/claim，避免两个 worker 同时发送
→ 成功删除/归档
→ 失败放回或保留重试
```

文件名和 JSON 不是可靠性的核心，**原子占用、幂等和崩溃恢复**才是。需要测试 claim 后进程崩溃、坏文件、重复 flush 和磁盘满。

### 0A.9 degradation 与静默失败的边界

降级可以把“增强能力不可用”变成提示或替代路径，但认证/授权失败不能伪装成成功。合理原则：

- 读操作、提示类增强可 fail-open 或返回部分结果；
- 写入、权限、审批和安全边界应 fail-close；
- 降级结果必须显式告诉调用者，不能让模型误以为动作已完成。

### 0A.10 proposal/approval 为什么不是直接执行

高影响动作先 propose，再由 Approval Hub 聚合审批，体现命令与审批分离：Agent 只提交意图和证据，最终执行权由具备权限的主体决定。

面试可从安全角度解释：降低 prompt injection 或模型误判直接造成外部副作用的风险，并保留审计链。

### 0A.11 路径工具的双重校验

路径字符串看起来在根目录内并不够，符号链接可能逃逸。安全校验要结合规范化路径、允许根、`realpath` 和“最深已存在父路径”。创建新文件时目标本身可能不存在，因此只 realpath 目标会失败，需要验证最近的真实父目录。

### 0A.12 第一次源码陪读

```text
一个 ToolDef 和 registerTools
→ callbackPost/buildAuthHeaders
→ 对应 API callback route
→ preHandler/derivePrincipal/scope
→ retry
→ outbox
→ degradation
→ propose + Approval Hub
→ path-validator 与 annotation/filter
```

每条工具画“输入 schema—认证—授权—副作用—幂等—返回”的六列表。

### 0A.13 安全测试清单

缺 token、过期 token、token 与 invocation 不匹配、agent key scope 越权、重复 idempotency key、响应丢失后重试、callback 400/401/429/500、outbox 坏文件、符号链接逃逸、readonly filter 拼写错误、proposal 绕过审批。

### 0A.14 面试回答模板

> “MCP 侧负责工具注册、schema 校验和把调用转成 HTTP callback，API 侧才是认证授权和业务真相源。短期 callback token 绑定 invocation，长期 agent key 受 scope 限制。可靠性用 per-attempt timeout、退避重试、幂等键和落盘 outbox 形成 at-least-once 闭环；高风险动作走 proposal/Approval Hub，认证和授权失败必须 fail-close，不能被 degradation 掩盖。”

### 0A.15 自测

1. schema 校验为何不能替代授权？
2. 网络超时后为何不能确定服务端没执行？
3. outbox、重试和幂等为何必须一起设计？
4. proposal 比直接执行安全在哪里？
5. `startsWith(root)` 为什么不足以防符号链接逃逸？

---
<!-- END ZERO-BASE EXPANSION 27 -->


## 1. 文件地图与职责边界

### 1.1 MCP 服务端（猫这一侧，跑在 CLI 子进程里）

「MCP」= Model Context Protocol，Anthropic 定的一套"给 LLM 挂工具"的协议；这里的 mcp-server 是**猫的 CLI 进程通过 stdio 拉起的一个 Node 子进程**，它把「发消息 / 查线程 / 记记忆」这些能力包装成 LLM 可调用的 tool。

| 文件 | 行数 | 职责 |
|---|---|---|
| `index.ts` | 55 | legacy all-in-one 入口，`createServer()` → `registerFullToolset()`（六个 toolset 全注册） |
| `collab.ts` / `memory.ts` / `signals.ts` / `audio.ts` / `finance.ts` / `limb.ts` | 51/51/51/54/50/56 | 六个**分体入口**，每个只注册一个 toolset，各自有独立 MCP server name（`cat-cafe-collab-mcp` 等） |
| `server-toolsets.ts` | 618 | 注册中枢：白名单过滤 + annotations 表 + `registerTool` 适配 + freshness notice 挂载 |
| `json-schema-to-zod.ts` | 76 | 把 plain JSON Schema 转 Zod v3（SDK 1.26.0 硬要求） |
| `refresh-loop.ts` | 183 | 后台心跳续 token，自适应间隔 + 优雅退出 |
| `remote-spike.ts` | 457 | F247 云端猫入口：Streamable HTTP + `?token=` 守卫 + 输出脱敏 + 启动期 env fail-closed |
| `tools/callback-tools.ts` | 2584 | 37 个 collab 工具 + HTTP 三件套（`getCallbackConfig` / `buildAuthHeaders` / `callbackPost` / `callbackGet`） |
| `tools/callback-retry.ts` | 127 | 重试判定、per-attempt 超时、`extractReasonTag` |
| `tools/callback-outbox.ts` | 207 | 落盘 outbox（at-least-once），rename 原子占用 + flush |
| `tools/degradation.ts` | 122 | `withDegradation` 降级框架 |
| `tools/*.ts`（其余 20 个） | — | 各领域工具（evidence/graph/recent/session-chain/library/signals/audio/finance/limb/schedule/…） |
| `utils/path-validator.ts` | 147 | `isPathAllowed()` realpath 防符号链接逃逸；`initCatCafeDir()` |
| `utils/path-utils.ts` | 68 | `resolveAbsolutePath` / `isWithinPath` / `tryRealpathSync` / `findDeepestExistingPath` |

调用方向（单向，没有反向依赖）：

```
入口(index/collab/memory/...)  →  server-toolsets  →  tools/index  →  tools/*.ts
       │                              │                                  │
       └── refresh-loop ──┐           ├── json-schema-to-zod             ├── callback-tools (HTTP 三件套)
                          │           └── callback-tools(callbackPost)   │      ├── callback-outbox
                          └───────────── getCallbackConfig ──────────────┘      │     └── callback-retry
                                                                                └── degradation
```

**边界**：`tools/*.ts` 只做「参数校验 + 组 body + 调 callbackPost/callbackGet + 格式化返回」，**不含业务判断**；业务判断全在 API 侧路由。唯一例外是三处本地前置校验（`handlePostMessage` 的 KD-1 threadId 守卫、`handleHoldBall` 的互斥校验、`handleShellExec` 的白名单），源码注释明确写了原因是"省一次 HTTP 往返"或"JSON Schema 表达不了 cross-field refine"。【源码】

### 1.2 API 回调侧（服务端）

| 文件 | 行数 | 职责 |
|---|---|---|
| `callbacks.ts` | 3849 | 主回调集合：post-message / thread-context / get-message / list-threads / list-labels / thread-metadata / feat-index / PR-issue tracking / create-rich-block / start-vote / **refresh-token** / freshness 两条 |
| `callback-auth-prehandler.ts` | 260 | 唯一鉴权入口：header 抽取 → `registry.verify` → `request.callbackAuth` / `callbackPrincipal` |
| `callback-errors.ts` | 54 | `makeCallbackAuthError(reason)` → `{error,reason,message,hint}` |
| `callback-auth-schema.ts` | 9 | legacy body 里的 `{invocationId,callbackToken}` zod（只剩 lark/wecom 在用） |
| `callback-scope-helpers.ts` | 144 | `derivePrincipal` / `deriveCallbackActor` / `resolveScopedThreadId` / `resolvePrincipalThread` / `canAccessScopedThread` |
| `callback-auth-telemetry.ts` | 306 | 失败计数器 + 24h 环形缓冲 + 未读徽标 |
| `callback-auth-system-message.ts` | 294 | 401 就地富块通知 + 5min/24h 去重 |
| `callback-auth-debug.ts` | 145 | 三个 debug 端点（snapshot / mark-viewed / hide-similar） |
| `callback-hold-ball-routes.ts` | 722 | hold_ball 注册 + wakeWhen 托管命令 + 滚动窗口计数 |
| `callback-multi-mention-routes.ts` | 674 | multi-mention 创建 + 状态轮询 |
| `callback-a2a-trigger.ts` | 675 | 把 callback 里检出的 @mention 推进父 worklist（F27 单路径） |
| `callback-propose-thread-routes.ts` | 334 | F128 提议开 thread |
| `callback-propose-session-handoff-routes.ts` | 326 | F225 提议 session 接力 |
| `callback-propose-profile-update-routes.ts` | 261 | F231 提议改 primer |
| 其余 17 个 `callback-*` | — | task / bootcamp / guide / quest / game / memory / docs / document / thread-cats / workflow-sop / limb / runtime-session / lark / wecom / anchor-helpers / hold-ball-cancel / hold-ball-c1-emit |

`callback-anchor-helpers.ts`、`callback-scope-helpers.ts`、`callback-errors.ts`、`callback-hold-ball-c1-emit.ts` 是**纯 helper，不注册任何路由**，所以"32 个 callback 文件"≠"32 个路由"。实际端点是 **44 个 HTTP 端点**（见 §8 清单）。【源码】

> **面试官追问：为什么要拆成 6 个 MCP 入口，而不是一个？**
> 「一个 all-in-one server 会把 98 个工具一次性塞进 LLM 的 tool 列表，token 成本和选择噪音都爆炸。所以我们做了 split topology：`collab.ts` 只挂 51 个协作工具、`memory.ts` 只挂 21 个记忆工具，客户端配置里按需挂载。`index.ts` 保留下来是纯向后兼容——它的 `registerFullToolset()` 依次调六个 register。注意 `audio.ts` 是 F195 补的：audio 工具原来只在 all-in-one 里注册，导致用 split 拓扑的 Codex 完全看不到它。」

---

## 2. 核心数据结构

### 2.1 `ToolDef` —— 工具的统一形状

`packages/mcp-server/src/server-toolsets.ts`：

```ts
type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;   // ← 故意用宽类型
  handler: (args: never) => Promise<unknown>;
};
```

- `inputSchema` 之所以是 `Record<string, unknown>` 而不是 Zod 类型：仓库里**同时存在两种写法**——大多数工具写的是 Zod raw shape（`{ content: z.string() }`），limb 工具写的是 plain JSON Schema（`{ type:'object', properties:{...}, required:[...] }`）。宽类型让两种都能进同一个数组。【源码】
- `handler: (args: never)` 是刻意的类型擦除：每个工具的入参形状不同，用 `never` 让数组能同构收集，注册时再 cast。

### 2.2 `CallbackConfig` / `AgentKeyOptions` —— 猫这侧的凭证

`packages/mcp-server/src/tools/callback-tools.ts`：

```ts
interface CallbackConfig {
  apiUrl: string;          // CAT_CAFE_API_URL，缺了直接 return null
  invocationId?: string;   // CAT_CAFE_INVOCATION_ID
  callbackToken?: string;  // CAT_CAFE_CALLBACK_TOKEN
  agentKeySecret?: string; // 三个 env 之一解析出来
}
interface AgentKeyOptions {
  agentKeyCatId?: string;  // 共享 Antigravity MCP 时选哪个 sidecar
  forceAgentKey?: boolean; // 强制只走 agent-key（register_external_runtime_session 用）
}
```

字段为什么存在：
- `invocationId + callbackToken` 成对出现才算有效凭证——单有一个会被 `getCallbackConfig` 判为**配置错误**并返回 null（fail-closed）。
- `agentKeySecret` 是 F178 加的「持久 agent 身份」，让没有 invocation 的常驻客户端（Antigravity/Bengal、云端砚砚）也能写。
- `forceAgentKey` 存在的唯一原因：`register_external_runtime_session` 这个动作在语义上就是"以持久 agent 身份注册"，即使环境里恰好有 invocation 凭证也不能用它。

### 2.3 `CallbackAuthFailureReason` —— 全枚举（9 个）

`packages/shared/src/types/callback-auth-reasons.ts` 是**唯一真相源**（注释明确：MCP 客户端和 API 服务端必须共享，否则客户端 regex 抽出的 `[reason=X]` 会和服务端漂移）：

| reason | 语义（`callback-errors.ts` 的 `MESSAGE_BY_REASON` 原文） | 谁产生 | 可降级? | 可就地通知? |
|---|---|---|---|---|
| `expired` | Callback credentials expired (TTL elapsed) | `registry.verify` | ✅ | ✅ |
| `invalid_token` | Callback token does not match invocation | `registry.verify` | ❌ | ✅ |
| `unknown_invocation` | Invocation id not found (registry may have restarted) | `verify` / `requireCallbackAuth` / `requireCallbackPrincipal` | ✅ | ❌ |
| `missing_creds` | Callback credentials not provided in headers or body | preHandler / refresh-token preValidation | ❌ | ❌ |
| `stale_invocation` | Invocation is no longer the latest for its thread/cat slot | `verifyLatest` | ❌ | ❌ |
| `agent_key_expired` | Agent key has expired (45d TTL) | agent-key backend | ❌ | ❌ |
| `agent_key_revoked` | Agent key has been revoked | agent-key backend | ❌ | ❌ |
| `agent_key_unknown` | Agent key secret not recognized | agent-key backend（扫完索引没命中） | ❌ | ❌ |
| `agent_key_scope_mismatch` | Agent key scope does not match request | 保留位（当前代码路径未产生） | ❌ | ❌ |

注意 `InvocationRegistry` 自己的 `AuthFailureReason` 只有 4 个：`'expired' | 'invalid_token' | 'unknown_invocation' | 'stale_invocation'`——**agent_key_* 4 个不属于 invocation 域**，它们来自 `AgentKeyFailureReason`。两个枚举在 `CallbackAuthFailureReason` 这里合流。【源码】

响应体固定形状（`CallbackAuthErrorBody`）：

```ts
{ error: 'callback_auth_failed', reason: <上表>, message: <上表>, hint: <固定 HINT 长句> }
```

`HINT` 是同一段中文，核心内容：「如果只是想 @队友，直接在回复文本里另起一行、行首写 @猫名…免费且永不过期。Callback token 有生命周期限制（默认约2小时，成功校验会刷新）」。这句话是给**猫看的**——401 之后猫读到这段就知道该退回到文本 @mention。【源码】

### 2.4 `CallbackPrincipal` —— 两种主体的判别联合

`packages/shared/src/types/callback-principal.ts`：

```ts
export type CallbackPrincipal =
  | { kind: 'invocation'; invocationId: string; parentInvocationId?: string;
      threadId: string; userId: string; catId: CatId }
  | { kind: 'agent_key'; agentKeyId: string; userId: string;
      catId: CatId; scope: 'user-bound' };
```

关键差异：**`agent_key` 分支没有 `threadId`**。这一个缺失字段推导出了下游一大串行为：
- `resolvePrincipalThread()` 对 agent_key 分支第一件事就是 `if (!requestedThreadId) return 400 'threadId required for agent-key auth'`；
- 所以 `postMessageInputSchema` 里 `threadId` 的描述写着"Required for agent-key auth… Omit for invocation auth"；
- 所以 `create_rich_block` 在 agent-key 模式下没给 threadId 会直接本地报错。

`scope: 'user-bound'` 是字面量类型——目前只有一种 scope，`RedisAgentKeyBackend.recordFromHash()` 里 `if (fields.scope !== 'user-bound') return null`，任何别的值当脏数据丢掉。这是为将来 `thread-bound` 之类留的位。【源码】

### 2.5 `InvocationRecord`

`packages/api/src/domains/cats/services/agents/invocation/InvocationRegistry.ts`：

```ts
export interface InvocationRecord {
  invocationId: string; callbackToken: string; userId: string; catId: CatId;
  threadId: string;                 // WebSocket room 作用域
  parentInvocationId?: string;      // F108: 与 worklist key 对齐
  a2aTriggerMessageId?: string;     // F121: 触发这只猫的那条 @mention 消息 id
  traceContext?: CallerTraceContext;
  clientMessageIds: Set<string>;    // invocation 内幂等键集合
  createdAt: number; expiresAt: number;
}
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;  // 注释：原来 10min，猫经常跑 20-40min，首个 callback 就 401
```

`parentInvocationId` 的存在理由写在 `callback-scope-helpers.ts` 的 `effectiveInvocationId()` 注释里：QueueProcessor 广播 `agent_message` 用的是**外层 id**，callback 路径必须用同一个，否则前端 `(catId, invocationId)` 的去重契约在 stream 和 callback 之间就断了。【源码】

### 2.6 `AgentKeyRecord`

`packages/shared/src/types/agent-key.ts`：

```ts
export interface AgentKeyRecord {
  agentKeyId: string;   // 形如 ak_<uuid去横线>
  catId: CatId; userId: string;
  secretHash: string;   // sha256(secret + salt)
  salt: string;         // randomBytes(16).toString('hex')
  scope: 'user-bound';
  issuedAt: number; expiresAt: number;   // 默认 +45d
  rotatedFrom?: string; // 轮换来源 key id
  graceUntil?: number;  // 轮换后老 key 的宽限截止（默认 +24h）
  lastUsedAt?: number;  // 每次 verify 成功都会 touch
  revokedAt?: number; revokedReason?: string;
}
```

`graceUntil` 一旦存在，就**接管**过期判定：`if (record.graceUntil && now > record.graceUntil) → agent_key_expired; if (!record.graceUntil && now > record.expiresAt) → agent_key_expired`。也就是说轮换后老 key 的有效期是 `graceUntil`，不再看 `expiresAt`。【源码】

### 2.7 `OutboxEntry` / `CallbackRequest`

`packages/mcp-server/src/tools/callback-outbox.ts`：

```ts
interface OutboxEntry {
  id: string;            // randomUUID()
  queuedAt: number;      // Date.now()，同时是文件名前缀 → 决定 flush 顺序
  apiUrl: string; path: string;          // 重放时拼 `${apiUrl}${path}`
  body: Record<string, unknown>;
  headers?: Record<string, string>;      // #476 之后凭证只在 header
  attempts: number;                      // 上限 10
  lastError: string;                     // 便于人工诊断
}
```

`queuedAt` 进文件名（`${queuedAt}-${id}.json`）而不只是进 JSON——因为 `flushOutbox` 用的是 `readdir().sort()`，**靠文件名字典序实现 FIFO**，纯数字时间戳前缀正好保证顺序。【推断：源码只写了 `.sort()`，FIFO 语义是从文件名格式反推的】

### 2.8 `ApprovalItem` 相关（审批中枢）

`packages/api/src/domains/approval-hub/ports/IApprovalAdapter.ts`：

```ts
export interface IApprovalAdapter {
  readonly featureId: ApprovalFeatureId;                       // 'F128'|'F193'|'F225'|'F231'
  listPending(userId: string): ApprovalItem[] | Promise<ApprovalItem[]>;
  listSettled?(userId: string, opts?: ListSettledOpts): SettledApprovalItem[] | Promise<SettledApprovalItem[]>;
}
```

`ApprovalItem` 的关键字段与来源（从四个 adapter 的 `toItem()` 反推）：`proposalId` / `sourceFeatureId` / `sourceThreadId` / `sourceMessageId`(= 卡片 messageId) / `requesterCatId` / `ownerUserId` / `status` / `summary` / `detail`(每 feature 不同) / `inlineApprovable` / `expiresAt`(= `createdAt + STALE_MS`) / `createdAt`。

`listPending` 返回类型写成 `T[] | Promise<T[]>` 是因为底层 store 有内存实现（同步）和 Redis 实现（异步）两套，adapter 用 `Array.isArray(result) ? … : result.then(…)` 兼容两者。【源码】

### 2.9 关键常量总表（这一节最值得背）

| 常量 | 值 | 位置 |
|---|---|---|
| `DEFAULT_TTL_MS`（invocation token） | 2h | `InvocationRegistry.ts` |
| `REFRESH_COOLDOWN_MS` | 5min | `callbacks.ts` refresh-token 路由 |
| `SERVER_COOLDOWN_MS` / `JITTER_FLOOR` / `COOLDOWN_BUFFER` | 5min / 0.85 / 1.05 | `refresh-loop.ts` |
| `MIN_DELAY_MS` | `ceil(5min×1.05/0.85)` ≈ 370589ms ≈ 6.18min | `refresh-loop.ts` |
| `MAX_DELAY_MS` | 30min | `refresh-loop.ts` |
| `DEFAULT_FETCH_TIMEOUT_MS`（refresh tick） | 10s | `refresh-loop.ts` |
| `DEFAULT_RETRY_DELAYS_MS` | `[1000, 2000, 4000]` | `callback-retry.ts` |
| `DEFAULT_FETCH_TIMEOUT_MS`（callback POST） | 10s | `callback-retry.ts` |
| `DEFAULT_OUTBOX_MAX_FLUSH_BATCH` | 20 | `callback-outbox.ts` |
| `DEFAULT_OUTBOX_MAX_ATTEMPTS` | 10 | `callback-outbox.ts` |
| `FRESHNESS_NOTICE_INTERVAL` / `FRESHNESS_MAX_NOTICES` | 每 5 次只读调用 / 每 invocation 最多 3 条 | `server-toolsets.ts` |
| agent-key `DEFAULT_TTL_MS` / `DEFAULT_GRACE_MS` | 45d / 24h | `AgentKeyRegistry.ts` |
| agent-key `CLIENT_MESSAGE_ID_TTL_MS` / `REDIS_REAPER_GRACE_MS` | 1h / 60s | `RedisAgentKeyBackend.ts` |
| 通知去重 `DEDUP_WINDOW_MS` / `HIDE_WINDOW_MS` | 5min / 24h | `callback-auth-system-message.ts` |
| 遥测 `RECENT_SAMPLES_CAP` / `WINDOW_HOURS` | 100 / 24 | `callback-auth-telemetry.ts` |
| `MAX_HOLDS_PER_WINDOW` / `HOLD_WINDOW_MS` | 3 / 3_600_000 | `callback-hold-ball-routes.ts` |
| `SELF_HEAL_SCAN_LIMIT`（三个 propose 路由各一份） | 10000 | 三个 `callback-propose-*` |
| F128/F193/F225/F231 `STALE_MS` | 7d / 3d / 24h / 7d | 四个 adapter |
| shell exec `MAX_OUTPUT_BYTES` / `TIMEOUT_MS` | 256KB / 30s | `shell-tools.ts` |
| limb lease `defaultTtlMs` | 60s | `LimbLeaseManager.ts` |
| `PREVIEW_MAX_CHARS`（anchor 预览） | 280（≈70 token） | `callback-anchor-helpers.ts` |

---

<!-- BEGIN INLINE SOURCE EXPANSION 27-TYPES -->
### 2.10 用判别联合追踪一次 callback 的身份变化

`CallbackPrincipal` 把两类调用者统一到一个变量中，但通过 `kind` 保留差异：

```ts
if (principal.kind === 'invocation') {
  // 短期 callback token：受 invocation、cat、thread、过期时间约束
} else {
  // 长期 agent key：受 key record 和 scope 约束
}
```

这是 TypeScript 判别联合的价值：进入分支后编译器知道当前有哪些字段，新增第三种 principal 时也更容易检查是否所有 switch 都处理了。不要为了“统一”把两种身份压成一堆 optional 字段，否则很容易出现 agentKeyId 和 invocationId 同时为空却继续执行。

`CallbackAuthFailureReason` 的九种 reason 是鉴权协议的一部分。401 只是 HTTP 粗粒度结果；`missing_headers`、`unknown_invocation`、`token_mismatch`、`expired` 等机器 reason 才能支持准确遥测、富块提示和是否刷新 token 的决定。客户端不能见到任意 401 都无限 refresh：token 与 invocation 不匹配时，刷新也不应把错误主体变成合法主体。

`CallbackRequest` 是准备发送的业务请求，`OutboxEntry` 还要增加 queuedAt、attempt/claim 等投递状态。两者分离说明“业务动作是什么”与“可靠投递进行到哪里”不是同一个对象。文件 outbox 中保存 secret 会扩大泄露面，因此应尽量只保存重放所需最小信息，并依赖受限目录权限。

一次有副作用的 propose 可以按七个检查点阅读：schema 形状正确 → principal 认证成功 → scope 允许 → 资源归属正确 → idempotency 去重 → 创建 ApprovalItem → adapter/Hub 暴露给审批者。前四步任何一步失败都不应进入降级“假成功”；proposal 成功也只代表请求已进入审批，不代表动作已执行。

进入 §3 后，把每个 callback route 写成六列表：凭证来源、principal 类型、要求 scope、读取/写入资源、幂等键、成功语义。这样 32 个路由就能按模式归类，而不是逐文件死记。

---
<!-- END INLINE SOURCE EXPANSION 27-TYPES -->

## 3. 主流程逐段拆解

### 3.1 启动：从进程拉起到 stdio 就绪

以 `collab.ts` 为例（六个入口结构完全一致，只差 server name 和 register 函数）：

```ts
async function main(): Promise<void> {
  initCatCafeDir();                       // ① 建 ~/.cat-cafe 及 5 个子目录
  const server = createCollabServer();    // ② new McpServer + registerCollabToolset
  const transport = new StdioServerTransport();
  console.error('[cat-cafe-collab] MCP Server starting...');   // ③ 必须 stderr
  await server.connect(transport);
  console.error('[cat-cafe-collab] MCP Server running on stdio');
  const refreshLoop = startRefreshLoop();        // ④
  installShutdownHandlers(refreshLoop);          // ⑤
}
const isEntryPoint = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isEntryPoint) { main().catch(...) }
```

- **① `initCatCafeDir()`** 建 `~/.cat-cafe/{chat,memory,workspace,assets,.state}`（常量 `CAT_CAFE_SUBDIRS`），目录可被 `CAT_CAFE_DATA_DIR` 覆盖。
- **③ 为什么全用 `console.error`**：`path-validator.ts` 里有一行注释直说了——「输出到 stderr（stdout 用于 JSON-RPC）」。stdout 上任何一个非 JSON-RPC 字节都会毁掉整条 MCP 会话。这是最容易在面试里加分的一个细节。【源码】
- **⑤ `isEntryPoint` 守卫**的注释是「仅作为入口运行时启动（import 时跳过，避免测试阻塞在 stdio）」——测试里 `import` 这个文件不会挂 stdio。

坑：注册顺序在 `registerFullToolset()` 里是 collab → memory → signal → limb → audio → finance。如果两个 toolset 里有同名工具，MCP SDK 会怎么处理没有代码保证；实际上没有重名（`externalRuntimeSessionTools` 被刻意拆成 callback 组和 read 组分别进 collab / memory，就是为了不重复注册）。【推断】

### 3.2 注册：`registerTools()` 的三件事

`server-toolsets.ts` 的 `registerTools(server, tools)`：

```ts
const registerExplicit = server.registerTool.bind(server) as unknown as (
  name: string, config: RegisterToolConfig, cb: RegisteredToolHandler,
) => void;
for (const tool of tools) {
  const annotations = inferAnnotations(tool.name);
  const schema = tool.inputSchema;
  const zodSchema =
    typeof schema.type === 'string' && typeof schema.properties === 'object' && schema.properties !== null
      ? jsonSchemaToZod(schema)              // ← limb 工具走这条
      : z.object(schema as z.ZodRawShape);   // ← 其余走这条
  registerExplicit(tool.name, { description: tool.description, inputSchema: zodSchema, annotations },
    async (args: never) => {
      const result = await tool.handler(args);
      const typed = { ...(result as Record<string, unknown>) } as {...};
      if (!typed.isError && annotations.readOnlyHint) {          // ← F254 B1
        const noticeText = await maybeFreshnessNotice(tool.name, annotations.readOnlyHint);
        if (noticeText) typed.content = [...typed.content, { type: 'text', text: `\n\n${noticeText}` }];
      }
      return typed;
    });
}
```

**(a) 为什么必须用 `registerTool` 而不是 `server.tool()`**——源码注释是全篇最硬的一条实现经验：

> `server.tool()` 的重载解析用 `isZodRawShapeCompat` 判断某个参数是 inputSchema 还是 annotations。我们的 plain JSON Schema 对象过不了 Zod 检查 → 被误判成 annotations → handler 槽位整体后移 → 运行时崩。`registerTool()` 显式吃 `{description, inputSchema, annotations}`，没有歧义。【源码】

**(b) schema 判别式**：`typeof schema.type === 'string' && typeof schema.properties === 'object'` —— 有 `type`+`properties` 两个键的当 JSON Schema（走转换器），否则当 Zod raw shape（直接 `z.object()` 包一层）。这是"同一个数组里两种 schema 写法"的代价。

**(c) freshness notice 搭便车**：只在 `readOnlyHint === true` 且 `!isError` 时才可能追加一段文本。门控三条（`maybeFreshnessNotice`）：

```ts
freshnessNoticeState.toolCallCount++;                    // 无条件计数
if (!isReadOnly) return null;
if (noticeDeliveredCount >= FRESHNESS_MAX_NOTICES /*3*/) return null;
if (toolCallCount - lastNoticeToolCallNum < FRESHNESS_NOTICE_INTERVAL /*5*/) return null;
if (!getCallbackConfig()) return null;                    // 没凭证不发 HTTP
// 门开了才 POST /api/callbacks/freshness-notice-check
lastNoticeToolCallNum = toolCallCount;   // ← 注意：不管有没有 notice 都推进
```

最后那行有 cloud review 编号（R2 P2-R2-2）的注释：**必须在任何一次 API 调用后推进间隔计数器，而不是只在成功投递后推进**，否则安静线程（没有未读）会在每次只读调用上都穿过门控、疯狂发 HTTP。整个函数 `catch {}` 吞异常（fail-open：notice 出错永不阻塞工具）。【源码】

状态存在模块级 `const freshnessNoticeState = { toolCallCount, noticeDeliveredCount, lastNoticeToolCallNum }` —— 注释写「per MCP server process = per invocation」，也就是**进程重启即重置**，这是刻意的（一次 invocation 最多 3 条）。

### 3.3 工具调用：`callbackPost` 一路到底

```
tool handler
  └─ withDegradation({ toolName, primary, policy })            ← 只有 write-class 工具有
       └─ callbackPost(path, body, { enableOutbox?, agentKeyCatId?, forceAgentKey?, retryDelaysMs?, fetchTimeoutMs? })
            ├─ getCallbackConfig({agentKeyCatId, forceAgentKey})  → null 就返回 NO_CONFIG_ERROR
            ├─ buildAuthHeaders(config)                            → 只出 header，不进 body/query
            └─ sendCallbackRequest({apiUrl,path,body,headers}, {enableOutbox,...})
                 ├─ enableOutbox → await flushOutbox()             ← 先冲存量
                 ├─ postJsonWithRetry(url, payload, delays, headers, {fetchTimeoutMs})
                 └─ 失败且 retryable 且 enableOutbox → enqueueOutbox() → 返回 {status:'queued_for_retry'}
```

`buildAuthHeaders` 的**优先级是硬编码的**：

```ts
export function buildAuthHeaders(config: CallbackConfig): Record<string, string> {
  if (config.invocationId && config.callbackToken)
    return { 'x-invocation-id': config.invocationId, 'x-callback-token': config.callbackToken };
  if (config.agentKeySecret) return { 'x-agent-key-secret': config.agentKeySecret };
  return {};
}
```

invocation 凭证**永远压过** agent-key。这一条优先级往下推出三个后果：
1. `handlePostMessage` 的 KD-1 守卫必须看 `process.env` 而不是看 `input.agentKeyCatId`——源码注释写明：「之前的守卫 `!input.agentKeyCatId` 可以被 invocation-token 调用方随便传个 agentKeyCatId 绕过；修复方案是 gate 在**实际会发出去的 header** 上」。【源码】
2. `remote-spike.ts` 的 env 校验里，`CAT_CAFE_INVOCATION_ID` / `CAT_CAFE_CALLBACK_TOKEN` **存在即启动失败**（继承来的 invocation 凭证会压掉 agent-key）。
3. `getCallbackConfig({forceAgentKey:true})` 直接跳过 invocation 分支：`if (!agentKeySecret) return null; return { apiUrl, agentKeySecret };`

`callbackPost` 成功路径返回 `successResult(JSON.stringify(result.data))`；失败路径有一个特判——**KD-6 猫路由错误的双轨输出**：

```ts
const match400 = errText.match(/^Callback failed \(400\): ([\s\S]+)$/);
if (match400) {
  const parsed = JSON.parse(match400[1]);
  if (parsed.kind === 'cat_disabled' || parsed.kind === 'cat_not_found') {
    const prefix = formatCatRoutingErrorPrefix(parsed);
    return errorResult(`${prefix}\n${match400[1]}`);   // 人类可读前缀 + 原始 JSON
  }
}
```

`formatCatRoutingErrorPrefix` 产出：`Cat routing failed [kind=cat_disabled] target=@xxx disabled.\nAlternatives: @a (A), @b (B).`（`alternatives` 只取前 3 个）。给 LLM 读人话，给程序读 JSON。【源码】

`callbackGet` 是**极简版**：单发 `fetch`，**没有重试、没有超时 AbortSignal、没有 outbox**。只在 401 时用 `extractReasonTag(text)` 拼上 `[reason=X]` 保持与 POST 一致的错误格式。这是个真实的不对称——读操作失败让猫重试就行。【源码】

### 3.4 服务端：preHandler 的六条分支

`callback-auth-prehandler.ts` 的 `registerCallbackAuthHook(app, registry, options)`：

```ts
app.addHook('preHandler', async (request, reply) => {
  if (request.callbackAuth) return;                                    // ① 已被 refresh-token preValidation 填过 → 跳过
  let invocationId = firstHeaderValue(request.headers['x-invocation-id']);
  let callbackToken = firstHeaderValue(request.headers['x-callback-token']);
  let legacy = false;
  if (!invocationId && !callbackToken) {                               // ② 两个 header 都缺才看 legacy
    const fromBody = extractLegacyCredentials(request);
    if (fromBody) { invocationId = fromBody.invocationId; callbackToken = fromBody.callbackToken; legacy = true; }
  }
  const agentKeySecret = firstHeaderValue(request.headers['x-agent-key-secret']);
  if (!invocationId && !callbackToken) {
    if (agentKeySecret && options.agentKeyRegistry) {                  // ③ agent-key 分支
      const tool = callbackToolFromUrl(request.url);
      const akResult = await options.agentKeyRegistry.verify(agentKeySecret);
      if (!akResult.ok) { recordCallbackAuthFailure({reason: akResult.reason, tool});
                          reply.status(401).send(makeCallbackAuthError(akResult.reason)); return; }
      request.callbackPrincipal = derivePrincipal(akResult.record);     // ← 只设 principal，不设 callbackAuth
      return;
    }
    return;                                                            // ④ 什么凭证都没有 → no-op（panel 请求）
  }
  const tool = callbackToolFromUrl(request.url);
  if (!invocationId || !callbackToken) {                               // ⑤ 只有一个 → missing_creds 401
    recordCallbackAuthFailure({ reason: 'missing_creds', tool });
    reply.status(401).send(makeCallbackAuthError('missing_creds')); return;
  }
  const recordSnapshot = options.notifier && registry.peekRecord
    ? await registry.peekRecord(invocationId).catch(() => null) : null; // ⑥ verify 之前先偷看
  const result = await registry.verify(invocationId, callbackToken);
  if (!result.ok) { /* 记遥测 + 用 snapshot 发就地通知 */ reply.status(401).send(...); return; }
  if (legacy) { recordLegacyFallbackHit({ tool }); request.log.warn(..., '[#476 DEPRECATED] ...'); }
  request.callbackAuth = result.record;
  request.callbackPrincipal = derivePrincipal(result.record);
});
```

**分支④是最容易被忽略也最容易被追问的**：没有任何凭证时 preHandler **静默放行**（`return` 不报错）。理由是同一个 Fastify 实例上还挂着面板路由（浏览器 session 鉴权）。代价是：如果某条 callback 路由忘了调 `requireCallbackAuth()`，它就变成了无鉴权端点。所以每条路由第一行都是 `const record = requireCallbackAuth(request, reply); if (!record) return;`——这是靠约定而非类型强制的。`requireCallbackAuth` 在缺 decoration 时上报 `unknown_invocation`，注释解释了为什么不上报 `expired`：「我们在这里其实不知道 registry 状态，报 unknown 比报 expired 安全」。【源码】

**分支①（`if (request.callbackAuth) return`）** 是给 refresh-token 路由开的后门：那条路由在 `preValidation` 阶段已经做了原子 `verifyLatest` 并写好 `request.callbackAuth`，这里再 verify 一次会造成**双次滑 TTL**，还会破坏原子性保证。

**`callbackToolFromUrl(url)`**：`url.split('?')[0]` → `match(/^\/api\/callbacks\/([^/]+)/)` → 命中返回第一段，否则 `'unknown'`。所以遥测维度里的 `tool` 是**路由名**（`post-message`、`refresh-token`），不是 MCP 工具名（`cat_cafe_post_message`）。这个错位在读 dashboard 时必须知道。【源码】

**`extractCallbackCredentials`（导出给 refresh-token 用）的三条规则**：两个 header 都有 → 用 header；两个 header 都无且 legacy body/query 齐全 → 用 legacy；**其它一切（半个 header、混源）→ null**。注释解释混源为什么必须 null：「cooldown 决策必须和 auth 决策一致，否则混源坏 auth 能白烧一个 cooldown 槽」（gpt52 P1 #3）。

### 3.5 服务端：`derivePrincipal` 与 scope 推导

`callback-scope-helpers.ts`：

```ts
export function derivePrincipal(record: InvocationRecord | AgentKeyRecord): CallbackPrincipal {
  if ('agentKeyId' in record) {          // ← 判别靠字段存在性，不靠 tag
    return { kind: 'agent_key', agentKeyId: record.agentKeyId, userId: record.userId,
             catId: createCatId(record.catId), scope: record.scope };
  }
  return { kind: 'invocation', invocationId: record.invocationId,
           ...(record.parentInvocationId ? { parentInvocationId: record.parentInvocationId } : {}),
           threadId: record.threadId, userId: record.userId, catId: createCatId(record.catId) };
}
```

线程作用域三层，从松到紧：

| 函数 | 适用 | 行为 |
|---|---|---|
| `resolveBoundThreadScope(actor, requestedThreadId)` | 最严：只允许同线程 | `actor.threadId !== requestedThreadId` → `403 'Cross-thread write rejected'` |
| `resolveScopedThreadId(actor, requestedThreadId, {threadStore})` | invocation 跨线程读 | 未传或同线程 → 直接放行；跨线程 → 无 threadStore 返 **503**，`get()` 拿不到或 `canAccessScopedThread` 拒 → **403** |
| `resolvePrincipalThread(principal, requestedThreadId, opts)` | 两种 principal 通吃 | agent_key：无 threadId → **400**；无 store → 503；不可访问 → 403。invocation：委托给 `resolveScopedThreadId` |

`canAccessScopedThread` 的三步判定（这是**唯一**决定"这只猫能不能读别人线程"的地方）：

```ts
if (targetThread.createdBy === userId) return true;              // 自己建的
if (targetThread.createdBy !== 'system') return false;           // 别人建的，直接拒
if (targetThread.id === DEFAULT_THREAD_ID) return false;         // system 建的默认线程也拒
const userVisibleThreads = await threadStore.list(userId);       // system 建的非默认线程 → 看可见列表
return userVisibleThreads.some((t) => t.id === targetThread.id);
```

第三行（默认线程即使是 system 建的也拒）是个反直觉的硬规则，值得记住。【源码】

### 3.6 服务端：refresh-token 的四段 preValidation

在 `callbacks.ts` 里（不是独立文件），`REFRESH_COOLDOWN_MS = 5 * 60_000`：

```
preValidation:
  ① extractCallbackCredentials(request)  → null? → 本地 recordCallbackAuthFailure('missing_creds')
                                                  + 401 {reason:'missing_creds', message:'refresh-token requires
                                                    X-Invocation-Id + X-Callback-Token headers'}  ← 不复用 makeCallbackAuthError
  ② registry.peek(invId, token)          → 不 ok 就 return（不烧 cooldown，让全局 preHandler 去报 401）
  ③ registry.tryClaimRefreshCooldown(invId, 5min) → false → 429 {error:'refresh_rate_limited', retryAfterMs}
  ④ registry.verifyLatest(invId, token)  → 原子 verify + isLatest + slide
        不 ok 且 reason==='stale_invocation' → 401 专属 message/hint
        不 ok 其它 → 401 {message:'Auth state changed between peek and atomic verify', hint:''}
        ok → request.callbackAuth = result.record
handler:
  requireCallbackAuth → registry.getRecord(invocationId)   // 重读拿滑过之后的 expiresAt，不再滑
  null → 401 unknown_invocation 'Invocation vanished between preHandler verify and refresh re-fetch'
  → return { ok:true, expiresAt, ttlRemainingMs: Math.max(0, fresh.expiresAt - Date.now()) }
```

为什么放 `preValidation` 而不是 `preHandler`：注释写得很清楚——**Fastify 生命周期里 route-level `preValidation` 在 plugin-scoped `preHandler` 之前触发**，而 `preHandler` 里的 `verify()` 会滑 TTL；如果 cooldown 判定在它之后，429 就只是"装饰性"的，滥用者仍然把 token 续上了（gpt52 P1）。同时 `preValidation` 又在 body 解析**之后**，所以还能读到 legacy body 凭证。【源码】

`peek` 和 `verifyLatest` 之间还是有一个窗口（peek 通过、verifyLatest 失败），代码为这个窗口专门写了 `'Auth state changed between peek and atomic verify'` 这句 message。【源码】

### 3.7 服务端：三个 propose 路由的完整审批流

三条路由（F128 propose-thread / F225 propose-session-handoff / F231 propose-profile-update）共享**同一个七步骨架**，这是本篇最值得完整复述的一段：

```
① requireCallbackAuth                      → 401
② zod safeParse(body)                       → 400 {error:'Invalid request body', details: issues}
③ registry.isLatest(invocationId)  == false → 200 { status: 'stale_ignored' }   ← 不是错误！
④ 幂等快路径（clientRequestId 存在时）：
     getDedupProposalId(userId, clientRequestId) → cached?
        cached 且 proposal.cardMessageId 存在        → 200 { proposalId, status, deduped:true }
        cached 且 cardMessageId 缺失 → 扫源线程自愈：
              findCardMessageInThread(store, threadId, proposalId) 找 rich block id === `<前缀>-${proposalId}`
              找到 → setCardMessageId 回填(失败也无所谓) → 200 deduped
              没找到 → 503 + header('retry-after','1') + { status:'retryable' }
⑤ 预留 dedup（SET NX 语义）：
     candidate = generateProposalId(); winningId = reserveDedup(userId, clientRequestId, candidate)
     winningId !== candidate  → 我是败者，绝不创建任何东西，走同样的"可见性检查/自愈/503"
     winningId === candidate  → reservedDedup = true，用 candidate 当 proposalId
⑥ store.create(...)   —— 抛错则 releaseDedup 后 rethrow（否则 dedup key 变幽灵指针直到 TTL）
⑦ messageStore.append(确认卡富块)
     抛错 → store.delete(proposal) + releaseDedup → rethrow（绝不留"没有卡片的幽灵提议"）
   setCardMessageId(stored.id)
     抛错 → 只记 warnings[]，不回滚（卡片已经在用户屏幕上了；后续重试靠 ④ 的扫描自愈）
   socketManager.broadcastToRoom(`thread:${threadId}`, 'connector_message', {...})
   socketManager.emitToUser(userId, 'proposal_created', ...)
   → 200 { proposalId, status, messageId, warnings? }
```

三条路由的差异点：

| | F128 propose-thread | F225 propose-session-handoff | F231 propose-profile-update |
|---|---|---|---|
| 富块 id 前缀（自愈扫描靠它） | `proposal-${proposalId}` | `handoff-${proposalId}` | `profile-update-${proposalId}` |
| 卡片 content 文案 | `提议新建 thread：${title}` | `提议 session 接力（封印当前 → 续接 fresh 自己）` | `提议更新 ${catId} 的关系档案（primer）` |
| 额外前置校验 | `threadStore.get(record.threadId)` 不存在 → 404；显式 `parentThreadId` 必须 `createdBy === record.userId` 否则 403；`validateProjectPath(explicitProjectPath)` 失败 → 400（**绝不静默回退**） | A4 abuse gate 在纯函数 `proposeSessionHandoff` 里，失败返回 **200** `{status:'rejected', reason, message: GATE_REASON_MESSAGE[reason]}` | `targetPath = join('relationship', \`${record.catId}-primer.md\`)` **服务端派生**；`resolvePrimerPath` 抛 `InvalidPrimerPathError` → 400 |
| 乐观锁 | 无 | 无 | 有：`beforeContent = existsSync ? readFileSync : ''`，`baseContentHash = hashContent(beforeContent)`，approve 时重读比对 |
| 额外遥测 | — | — | `profileUpdateProposed.add(1, {'agent.id': catId, 'signal.kind': signalKind})` |
| 输入上限 | title 200 / reason 1000 / preferredCats ≤10 / initialMessage 4000 | done 2000 / nextSteps 2000 / commits ≤50 项各 ≤100 / gotchas 2000 | afterContent 20000 / rationale 1000 |
| 特有清洗 | `normalizeCatIdMentionsInText(initialMessage)` | — | — |

F225 的 `GATE_REASON_MESSAGE` 四个值：`no_active_session` / `already_pending`（每 active session 最多 1 个）/ `cooldown` / `hourly_limit`。这些是**门控结果不是错误**，所以 HTTP 200——注释写「surface 200 + reason 让猫自己反应」。【源码】

F128 的 `normalizeCatIdMentionsInText` 存在理由（注释原文可复述）：猫经常把 `cat_cafe_get_thread_cats` 输出里的裸 catId（`@cat-rcs85pvn`）粘进 `initialMessage`，而裸 catId 不在 router 的 mentionPatterns 里 → 下游 `parseAllMentions` 看不见 → dispatch 只能按 `preferredCats` 顺序走，顺序就错了。【源码】

### 3.8 服务端：Approval Hub 的 adapter 聚合

`approval-hub-routes.ts` 只有两条路由，且**无副作用、无缓存**（注释：Fresh read-through every call，KD-3 v1）：

```ts
app.get('/api/approval-hub/pending', async (request, reply) => {
  const userId = resolveUserId(request); if (!userId) { reply.status(401); return {error:'Identity required'}; }
  const results = await Promise.all(adapters.map((a) => a.listPending(userId)));
  const items = results.flat().sort((a, b) => b.createdAt - a.createdAt);
  return { items, count: items.length };
});
app.get('/api/approval-hub/settled', async (request, reply) => {
  // limit: Math.floor(Number(query.limit ?? 50))，>0 则 min(x, 200)，否则 50
  const capableAdapters = adapters.filter((a) => typeof a.listSettled === 'function');   // ← F231 没实现，被过滤掉
  const results = await Promise.all(capableAdapters.map((a) => a.listSettled!(userId, { limit })));
  return { items: results.flat().sort((a,b) => b.decidedAt - a.decidedAt).slice(0, limit), count };
});
```

`Math.floor` 那行有 cloud review 注释：非整数 limit 传到 Redis `ZREVRANGE` 会 500，所以必须在扇出**之前** floor。【源码】

四个 adapter 的差异（这是 adapter 模式真正的价值所在——四个 feature 的 store 形状完全不同）：

| adapter | 底层 store 方法 | `inlineApprovable` | `STALE_MS` | `decidedAt` 怎么来 | `listSettled` |
|---|---|---|---|---|---|
| F128（开 thread） | `listPending(userId)` / `listByUser(userId, MAX_SAFE_INTEGER)` | `false`（Hub 抽屉没实现 approve-time override 表单，AC-A4 强制跳转） | 7d | `approvedAt ?? rejectedAt ?? createdAt` | ✅ 先全取再 filter 再按 decidedAt 排再 slice |
| F193（跨线程派活） | `listPendingByUser` / `listSettledByUser(userId, limit)` | **`true`**（assign_work 提议自带 content/targetCats/targetThread，够 Hub 内联决策） | 3d | `p.decidedAt ?? 0` | ✅ |
| F225（session 接力） | `listPendingByUser` / `listSettledByUser` | `false`（需要 session 上下文，Hub 只给"跳到 thread"） | **24h** | `p.updatedAt`（无专属字段，approve/reject 时会写 updatedAt） | ✅ |
| F231（改 primer） | `listPending(userId)` | `false`（primer diff 要 thread 上下文） | 7d | — | ❌ **未实现** |

F128 的 `listSettled` 里那句 `Number.MAX_SAFE_INTEGER` 是个 P2 修复：`listByUser` 默认 limit 100 且按 `createdAt desc`，如果先截断再 filter，一个"很久以前创建、刚刚被批准"的提议就会从历史页消失。所以必须**全取 → filter → 按 decidedAt 排 → slice**。【源码】

F193 的 `toSettledItem` 是四个里唯一会 **throw** 的：`if (p.status !== 'approved' && p.status !== 'rejected') throw new Error(...)`。另外三个用 `as 'approved'|'rejected'` 强转。【源码】

### 3.9 猫侧：三个 propose 工具的对应关系

`callback-tools.ts` 里三个 handler 都是薄封装（`handleProposeThread` → `/api/callbacks/propose-thread` 等），真正的信息量在 **description**（工具描述就是给 LLM 的 prompt，这是本项目的一个显式设计）：

- `cat_cafe_propose_thread` 的描述里写了 DISPATCH MODEL：「用户 approve 后服务端**只唤醒 `preferredCats` 的第一只**（接龙起点），后续猫靠各自回复里的 @mention 唤醒。所以 preferredCats 的顺序要严格按你希望的接龙顺序排」；以及 `#ideate` 标签 → 并行唤醒**所有** preferredCats。
- `cat_cafe_propose_session_handoff` 的描述把它和压缩对立起来：「compress 是有损兜底，handoff 是优雅接力」；五件套 = done + nextSteps（必填）+ worktreeBranch / commits / gotchas（选填）。
- `cat_cafe_propose_profile_update` 的描述强调 `afterContent` 是**整文件替换不是 diff**，且 target 永远是服务端从认证身份派生的自己的 primer，「你无法指向另一只猫或共享 capsule」。

---

<!-- BEGIN INLINE SOURCE EXPANSION 27-FLOW -->
### 3.10 源码执行复盘：一条 callback 从猫侧工具到服务端业务

以猫调用 `cat_cafe_post_message` 为例，完整链路可以拆成七跳：

```text
MCP tool handler
  -> callbackPost()
  -> sendCallbackRequest()/postJsonWithRetry()/必要时 outbox
  -> API callback route
  -> auth preHandler
  -> CallbackPrincipal + scope
  -> 持久化、A2A enqueue、broadcast 或 propose/approval
```

#### 第 1 跳：工具 handler 先做输入校验

MCP 工具 schema 负责把模型给出的自由 JSON 收紧为业务参数。不要把 schema 当 TypeScript 类型提示；它是运行时边界，能拒绝缺失字段、错误枚举和超长输入。工具 handler 再选择 callback path 和 body。

#### 第 2 跳：`callbackPost()` 组装身份

一次 invocation callback 通常带 `x-invocation-id` 和 `x-callback-token`；后台 agent-key 模式则带 agent key 相关凭据。它们不能混为“某个 token 字符串”，因为服务端会派生不同的 `CallbackPrincipal`：

- `{ kind: 'invocation', ... }`：只代表某次活跃调用；
- `{ kind: 'agent_key', ... }`：代表长期注册的猫身份，并受 key scope 限制。

`callback-auth-agent-key.test.js` 验证 invocation 凭据优先；invocation 校验失败时即使同时有 agent key 也不能 fall through。否则攻击者可故意提交坏 invocation token，再借较宽松 agent key 绕过。

#### 第 3 跳：retry 只重试“可能暂时恢复”的失败

`postJsonWithRetry()` 对网络错误、部分 5xx 等做有限次数和延迟重试。401 不是统一 refresh：

- `expired`、`unknown_invocation` 可能进入特定降级/刷新策略；
- `invalid_token` 更像客户端 bug 或攻击，不应盲目重试；
- `stale_invocation` 表示身份与当前运行状态不匹配，也不应伪装成临时网络故障。

这也是为什么服务端返回结构化 `reason`，而不是只有 HTTP 401。

#### 第 4 跳：outbox 提供 at-least-once，不提供 exactly-once

当请求暂时发不出去，可把 `CallbackRequest` 写到磁盘 outbox，之后按 FIFO 重放。重放可能在“服务端已成功但客户端没收到响应”的情况下再次发送，所以业务端仍必须依赖 `clientMessageId`/幂等键去重。

可靠性闭环是：客户端持久 outbox + 有界 retry + 服务端幂等，而不是只靠任何一层。`packages/mcp-server/test/callback-retry.test.js` 和 callback outbox 相关测试用于验证重试边界、顺序、legacy entry 迁移与 claim 行为。

#### 第 5 跳：preHandler 默认 fail-closed

服务端先检查 header；缺一半凭据是 `missing_creds`，invocation 不存在是 `unknown_invocation`，token 不匹配是 `invalid_token`。`callback-auth-prehandler.test.js` 验证无凭据的可选 panel 路径可以不装饰 principal，但“要求鉴权的 handler”若最终拿不到 principal 必须 401。

注意“preHandler 无凭据时 no-op”和“业务 handler 接受匿名”是两回事。后者必须显式允许；不能因为中间件没回 401 就默认授权。

#### 第 6 跳：principal 还要转换成业务 scope

认证回答“你是谁”，授权回答“你能操作哪个 thread/cat/user”。服务端要从 principal、invocation record、agent key record 和请求参数推导 scope，并检查请求 body 声称的 threadId/catId 是否一致。

安全测试时重点做参数替换：保持合法 token 不变，只替换 threadId、catId、targetCats、userId，观察是否存在 IDOR/越权。

#### 第 7 跳：业务写入仍有自己的失败策略

例如 post message：先落库，再尝试 A2A enqueue；enqueue 成功的 queued message 不立即 live broadcast，避免同一消息通过队列和广播双投递。若 enqueue 抛错或得到零目标，系统可 fail-open 广播，确保消息不消失。`callback-delivery.test.js` 覆盖这几条分支。

cross-post 则更严格：跨线程没有 `targetCats`、也没有行首 mention 时必须 400 fail-closed。`callback-cross-post-fail-closed.test.js` 还验证失败请求不能提前消费 `clientMessageId`，否则用户修正参数后重试会被错误判为重复。

#### 面试回答骨架

**MCP callback 是跨进程写操作：工具层做 schema 校验，客户端附带 invocation 或 agent-key 身份，通过有界重试和 outbox 实现至少一次送达；API 先认证再按 principal 推导 scope，业务写入用幂等键消除重放，并根据队列/广播语义决定 fail-open 还是 fail-closed。**
<!-- END INLINE SOURCE EXPANSION 27-FLOW -->

## 4. 关键算法与判定逻辑

### 4.1 `withDegradation` 决策树（`degradation.ts` 全文级拆解）

这是 F174 Phase E 的核心，122 行，但信息密度极高。先看它的**五条 AC**（源码文件头注释）：

```
AC-E1  框架化：让 create_rich_block 的 Route B 能声明式表达，行为不变
AC-E2  每个 write-class 工具必须显式声明 policy（none 也行，"显式 > 静默默认"）
AC-E3  只在 401 + 可降级 reason 触发；5xx 等瞬时错误留给 callback-retry 层
AC-E4  降级成功要在 JSON payload 标 DEGRADED:true，让调用方/看板能识别
AC-E6  stale_invocation 不可降级——降级会在被取代的 invocation 上重建状态
```

主函数逐行判定：

```ts
export async function withDegradation(opts: WithDegradationOptions): Promise<ToolResult> {
  const result = await opts.primary();
  if (!result.isError) return result;                              // ① 成功直接返回

  const errorText = result.content[0]?.type === 'text' ? result.content[0].text : '';
  const reason = parseAuthFailureReason(errorText);
  if (reason === undefined) return result;                        // ② 非鉴权失败 → 不归我管（是 retry 层的）
  if (!DEGRADABLE_AUTH_REASONS.has(reason)) return result;        // ③ invalid_token / stale_invocation 原样冒泡

  if (opts.policy.kind === 'none') {
    return appendNoFallbackHint(result, opts.toolName, reason);   // ④ 声明了 none → 加提示但不降级
  }
  const fallback = await opts.policy.degrade(result);             // ⑤ 跑自定义降级
  if (fallback.isError) return fallback;                          //    降级本身也失败 → 返回降级的错
  return markDegraded(fallback);                                  //    降级成功 → 标 DEGRADED:true
}
```

**这里最容易被追问的是"reason 怎么从一段文本里抠出来"**。`parseAuthFailureReason` 的正则是 `/reason\s*[:=]\s*([a-z_]+)/i`——注意它同时吃 `reason:X` 和 `reason=X` 两种写法（`[:=]`），因为 §3.3 的 `extractReasonTag` 产出的是 `[reason=X]`，而别处日志可能写 `reason: X`。抠出来之后还要**双重校验**：

```ts
if (reason && isCallbackAuthFailureReason(reason) && KNOWN_REASONS.has(reason)) return reason;
return undefined;
```

`isCallbackAuthFailureReason` 是 shared 导出的类型守卫，`KNOWN_REASONS = new Set(CALLBACK_AUTH_FAILURE_REASONS)`。**为什么校验两次**：类型守卫保证"是合法枚举字符串"，Set 保证"是这个版本的客户端认识的枚举"——如果服务端将来加了个新 reason，旧客户端 `isCallbackAuthFailureReason` 可能放行（取决于 shared 版本），但 `KNOWN_REASONS` 一定拦住，返回 undefined 走"非鉴权失败"路径原样冒泡。**宁可不降级，也不拿一个不认识的 reason 去做降级决策。**

`DEGRADABLE_AUTH_REASONS` 只有两个成员，且注释把三者的区别钉死：

```ts
// Degradable: token has stopped working through expiry/registry loss.
// Distinct from invalid_token (likely client bug) and stale_invocation
// (succeeded but superseded — fallback would re-create stale state).
const DEGRADABLE_AUTH_REASONS = new Set(['expired', 'unknown_invocation']);
```

**`markDegraded` 的兜底也值得复述**：它先试 `JSON.parse(block.text)`，成功且是对象就 `{...parsed, DEGRADED: true}`；**parse 失败**（payload 不是 JSON）就包一层信封 `{DEGRADED: true, payload: block.text}`。也就是说无论原返回是不是结构化的，降级标记一定加得上。`appendNoFallbackHint`（policy=none 时）则是往文本尾部追加 `\n\n[degrade] tool=X reason=Y no fallback available — auth must be restored before retry`——**给猫看的、告诉它"这条路没有备用通道，得先恢复鉴权"**。

### 4.2 保活的自适应间隔（`refresh-loop.ts` 全文级拆解）

`computeNextRefreshDelay` 是**纯函数**（注释明说 "testable without a running timer or HTTP layer"）：

```ts
export function computeNextRefreshDelay(ttlRemainingMs: number): number {
  const proportional = ttlRemainingMs / 4;
  const clamped = Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, proportional));
  const jitter = JITTER_FLOOR + Math.random() * 0.3;             // [0.85, 1.15]
  return Math.floor(clamped * jitter);
}
```

`MIN_DELAY_MS` 的推导链（这是全篇最经典的一个"下界语义"bug，Cloud Codex P2 #1368）：

```
服务端每 invocation 刷新冷却 = 5min
原写法：MIN = 5min，再乘 [0.85,1.15] 抖动
    → 最坏 5min × 0.85 = 4.25min < 5min 冷却 → 15% 概率区间撞冷却拿 429
修法：MIN = ceil(5min × 1.05 / 0.85) ≈ 6.18min
    → 抖完最坏 6.18 × 0.85 ≈ 5.25min > 5min，稳在冷却之上
    → 1.05 是给客户端/服务端时钟偏移留的 5% 余量
```

**教训一句话：加了抖动之后，"下界"约束的不再是你写的那个值，而是"那个值 × 抖动下界"。** 面试时这句话比背常量更值钱。

`performRefreshTick` 里有个刻意的"不复用重试层"的决定（Cloud Codex P2 #1368）：

```ts
// 单次 refresh 用 raw fetch，不走 callback-retry。因为 callback-retry 会重试
// 408/429/5xx——而 429 恰恰是"撞了 5min 冷却"，几秒内重试必然再失败，白烧 3 次。
// refresh loop 本身就是一个重试机制，再叠一层是结构性重复。
const response = await fetch(`${config.apiUrl}/api/callbacks/refresh-token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(config) },
  body: '{}',
  signal: AbortSignal.timeout(timeoutMs),                        // ← 10s，见下
});
```

`DEFAULT_FETCH_TIMEOUT_MS = 10_000` 的注释（Cloud Codex P1 #1368, commit e521cc7aa）：没有 AbortSignal，半开 TCP socket 会让 `await fetch` **永远 pending**，循环永不 reschedule，token 在长会话里静默过期。10s 覆盖慢网，又远小于 5min 冷却，所以一次卡住的 tick 不会把下次尝试推出冷却安全窗。

**优雅退出**藏着两个连续的 review（P1 → P2，都在 #1368）：

```ts
const SIGNAL_NUMBERS = { SIGTERM: 15, SIGINT: 2 };
export function installShutdownHandlers(loop, proc = process): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    proc.on(signal, () => {
      loop.stop();
      proc.exit(128 + SIGNAL_NUMBERS[signal]);                   // SIGTERM→143, SIGINT→130
    });
  }
}
```

- **P1**：注册了自定义 SIGINT/SIGTERM handler 却不调 `process.exit()`，会**压掉 Node 默认的终止行为**，MCP 进程收到信号后反而停不下来。
- **P2**：`exit(0)` 会把"因何终止"的信息藏起来。Unix 惯例是 `exit(128 + signum)`，让 shell/进程管理器能还原是哪个信号杀的。`proc` 依赖注入是为了测试。

还有 `startRefreshLoop` 里两处 `timer.unref()`——让这个定时器**不阻止进程退出**（否则保活循环会把一个本该结束的进程吊住）。首个 tick 延迟 `FALLBACK_DELAY_MS`（让服务端先就绪）。

### 4.3 重试：`postJsonWithRetry` 的循环边界（`callback-retry.ts` 全文级）

```ts
for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {   // ← 注意是 <=
  try {
    const response = await fetch(url, { ..., signal: AbortSignal.timeout(fetchTimeoutMs) });
    if (response.ok) return { ok: true, data: await response.json() };
    const text = await response.text();
    const reasonTag = response.status === 401 ? extractReasonTag(text) : '';
    lastError = `Callback failed (${response.status})${reasonTag}: ${text}`;
    retryable = shouldRetryStatus(response.status);              // 408 || 429 || >=500
    if (!retryable || attempt >= retryDelaysMs.length) {
      return { ok: false, failure: { error: lastError, retryable } };
    }
  } catch (err) {                                                // 含 AbortSignal 触发的 timeout
    lastError = `Callback request failed: ${err.message}`;
    retryable = true;                                            // 网络异常一律 retryable
    if (attempt >= retryDelaysMs.length) return { ok: false, failure: { error: lastError, retryable } };
  }
  await sleep(retryDelaysMs[attempt]!);
}
```

**几个精确点**：
- 循环是 `attempt <= length`，配 `DEFAULT_RETRY_DELAYS_MS = [1000,2000,4000]` 意味着**总共 4 次尝试**（第 0 次立即 + 3 次退避后重试），不是 3 次。
- `shouldRetryStatus` 只认 **408 / 429 / ≥500**；其余 4xx（含 401）`retryable=false`，立刻返回不重试——鉴权失败重试没意义。
- **`catch` 里 `retryable=true`**：抓到的既有 `AbortSignal.timeout` 的中止，也有 DNS/连接错误，都当瞬时。这正是 outbox 层判断"要不要落盘"的依据（§3.3 只有 `failure.retryable` 才 enqueue）。
- `extractReasonTag` 只在 401 时调，把 `{error:'callback_auth_failed', reason:X}` 的 body 抠成 ` [reason=X]` 拼进错误串——**这样下游（withDegradation）能 regex 出结构化 reason，而不用去匹配散文**。parse 失败返回空串，注释明确"caller should not depend on the marker existing"。

两个常量都可 env 覆盖：`CAT_CAFE_CALLBACK_RETRY_DELAYS_MS`（逗号分隔，过滤掉非有限/负数，全空则回默认）、`CAT_CAFE_CALLBACK_FETCH_TIMEOUT_MS`（须 >0）。

### 4.4 outbox：FIFO、原子占用、legacy 迁移（`callback-outbox.ts` 全文级）

**enqueue** 用文件名编码时间戳：

```ts
const file = join(dir, `${entry.queuedAt}-${entry.id}${OUTBOX_FILE_SUFFIX}`);  // {ms}-{uuid}.json
```

**flush** 的完整判定：

```ts
const files = (await readdir(dir))
  .filter((name) => name.endsWith('.json') && !name.endsWith('.processing'))   // 跳过在处理的
  .sort()                                                                       // 字典序=时间戳前缀=FIFO
  .slice(0, maxFlushBatch);                                                     // 每轮最多 20

for (const name of files) {
  try { await rename(originalPath, processingPath); } catch { continue; }       // ① 抢占，抢不到跳过
  try {
    const entry = parseOutboxEntry(await readFile(processingPath, 'utf8'));
    if (!entry || entry.attempts >= maxAttempts) { await unlink(processingPath); continue; }  // ② 坏/超限 丢弃

    const replayHeaders = entry.headers ?? legacyHeadersFromBody(entry.body);   // ③ #476 legacy 迁移
    const replay = await postJsonWithRetry(`${entry.apiUrl}${entry.path}`, JSON.stringify(entry.body), retryDelaysMs, replayHeaders);
    if (replay.ok) { await unlink(processingPath); continue; }                  // ④ 成功删除
    if (!replay.failure.retryable || entry.attempts + 1 >= maxAttempts) { await unlink(processingPath); continue; }  // ⑤ 不可重试/到顶 丢弃

    const updated = { ...entry, attempts: entry.attempts + 1, lastError: replay.failure.error };
    await writeFile(processingPath, JSON.stringify(updated), 'utf8');
    await rename(processingPath, originalPath);                                 // ⑥ 计数+1 放回队列
  } catch {
    try { await rename(processingPath, originalPath); } catch {}                // ⑦ 任何异常都把文件放回，别吞
  }
}
```

**逐点解释**：
- **① `rename` 是唯一并发原语**：两个 flush 并发时，谁 rename 成功谁独占；文件系统 rename 原子，不用锁。`.processing` 后缀同时被 filter 排除，防止自己处理到别人的在途文件。
- **③ legacy 迁移**是 #476 的兼容窗口：header 迁移之前落盘的 entry 把凭证放在 body 里，`legacyHeadersFromBody` 把 `body.invocationId/callbackToken` 拎出来拼成 `x-invocation-id/x-callback-token` header，好让新版 preHandler 收得下。**这是"落盘数据跨版本"的典型处理——旧数据在重放时就地升格。**
- **⑦ catch 里再 rename 回原名**：注释 "Keep best-effort semantics"。任何读/写/网络异常都不能让文件卡在 `.processing` 状态永远不被重试。

**`sendCallbackRequest` 的伪成功返回**是最容易被追问的一点：

```ts
if (enableOutbox && result.failure.retryable) {
  const queued = await enqueueOutbox({ id: randomUUID(), queuedAt, ..., attempts: 0, lastError });
  if (queued) return { ok: true, data: { status: 'queued_for_retry', queuedAt } };   // ← ok:true！
}
```

**落盘成功后返回 `ok:true` + `status:'queued_for_retry'`**——对猫来说这次工具调用"成功了"，因为消息已被持久化、迟早会送到。这就是 at-least-once 语义在 API 边界的体现：**不阻塞猫，代价是可能重复送达，所以服务端必须幂等（§4.5）**。另外 `sendCallbackRequest` 每次发送前会**先 `flushOutbox()`**——搭着新请求的便车把存量补发出去。

### 4.5 at-least-once 的闭环：三处幂等键

outbox 重放可能重复送达，所以服务端幂等是**配套的、缺一不可**的另一半：

```
invocation 内：InvocationRecord.clientMessageIds: Set<string>       同一 invocation 去重
propose 路由：clientRequestId → reserveDedup(SET NX) → proposalId   见 §3.7 ④⑤
multi-mention：idempotencyKey                                       [03 章] §3.8
球权事件：sourceEventId                                             [10 章] §3.10
```

一句话：**`callback-outbox` 保证"至少送到一次"，这些键保证"多送的那几次不产生副作用"。只做前者会制造重复数据，只做后者会在网络抖动时丢消息。**

### 4.6 annotation 推导与 limb 双轨过滤（安全红线）

`inferAnnotations(toolName)`：登记过的用登记值，**没登记的一律 `A_WRITE_SAFE`（写、非破坏），绝不默认只读**（砚砚 R8）。原因：`readOnlyHint` 会影响过滤，strict-whitelist 模式只放行只读工具；未登记新工具若被默认成只读，等于**绕过白名单漏出去**。默认成"写"最坏被过滤掉（可用性问题），默认成"读"最坏漏一个设备控制面（安全问题）——两害相权取其轻。

`buildLimbTools`：`desktopMode` 未设 → limb 全暴露（Antigravity 要用它控浏览器）；**任何非空 desktopMode（含拼错的）→ 走 `applyReadonlyFilter`**（F178 Phase D cloud-review R3 P2）。`fable-phase0` 白名单不含任何 limb 工具 → 全 deny；未知 mode → 启动即 fail-fast，而不是静默注册全量设备控制面。

---

<!-- BEGIN INLINE SOURCE EXPANSION 27-ALGO -->
### 4A. Callback 安全测试矩阵：认证成功还不等于授权成功

#### 认证矩阵

| 凭据 | 预期 principal/结果 |
|---|---|
| 两个 invocation header 都正确 | `kind=invocation` |
| 只给一个 header | 401 `missing_creds` |
| invocation 不存在 | 401 `unknown_invocation` |
| token 错误 | 401 `invalid_token` |
| 合法 agent key | `kind=agent_key` |
| invocation + agent key 都存在 | invocation 优先 |
| invocation 错 + agent key 对 | 仍 401，不得降级绕过 |
| 完全无凭据的可选 panel 路径 | preHandler 可 no-op，但受保护 handler 仍须拒绝 |

对应 `callback-auth-prehandler.test.js`、`callback-auth-agent-key.test.js`、`callback-auth-reasons-contract.test.js`。

#### 授权/IDOR 矩阵

拿一组完全合法的 invocation 凭据，只替换请求中的：`threadId`、`userId`、`catId`、`targetCats`、proposal 目标、messageId。每个受保护 route 都要从 principal 推导允许 scope，而不是相信 body。

面试时强调：JWT/token 校验通过只证明身份，不能代替对象级授权。

#### 幂等与至少一次测试

模拟服务端已经落库但响应在网络中丢失，outbox 重放同一 `clientMessageId`。断言：

- 业务记录只出现一次；
- 客户端能拿到或接受已有结果；
- 失败校验请求不会提前消费幂等键；
- FIFO claim 防两个 replay worker 同时发送同一 entry。

`callback-cross-post-fail-closed.test.js` 的“400 后 corrected retry 仍能交付”正是在防校验前消费幂等键。

#### fail-open 与 fail-closed 必须按业务风险选择

- A2A enqueue 临时失败：消息已落库时可 fail-open broadcast，优先不丢消息；
- cross-thread 没有目标证据：fail-closed 400，避免发到错误线程；
- auth 不明确：fail-closed；
- telemetry/通知失败：通常降级，不应改变鉴权结论；
- propose：只创建审批，不直接修改高风险业务对象。

不要把项目概括成“全部 fail-closed”或“高可用所以 fail-open”。正确答案是按资产与错误后果选择。

#### 提案路由的七点断言

对 thread/session handoff/profile update 等 propose 路由，检查：schema、principal、scope、目标存在性、重复提案幂等、approval item 内容、未审批前无真实变更。审批中心是命令与执行之间的隔离层。

#### 面试复述

> Callback 是跨进程写边界，采用结构化失败 reason、invocation/agent-key 判别主体和对象级 scope 校验。客户端 retry+outbox 提供至少一次，服务端用幂等键实现效果上的去重。消息投递在 enqueue 故障时可 fail-open 保可用，但认证、跨线程目标和高风险变更 fail-closed；高风险操作先生成 proposal 进入审批，而不是工具直接落地。
<!-- END INLINE SOURCE EXPANSION 27-ALGO -->

## 5. 边界情况与防御性代码清单

每行都标了出处和（可查到的）review 编号——这张表是本篇的护城河，面试官问"这条写通路怎么保证不丢/不重/不越权/不挂"时逐行都是答案。

| 防的是什么失败 | 代码怎么防 | 出处 / 编号 |
|---|---|---|
| 半开 TCP 让 `fetch` 永久 pending → 工具永不返回 | 每次 attempt 独立 `AbortSignal.timeout(10s)` | `callback-retry.ts` / #1368 e521cc7aa |
| 保活 tick 卡死 → 循环永不 reschedule → token 静默过期 | refresh tick 也带 10s AbortSignal | `refresh-loop.ts` / P1 #1368 |
| 保活撞服务端 5min 冷却拿 429 | `MIN_DELAY_MS` 预除抖动下界 ≈6.18min | `refresh-loop.ts` / P2 #1368 |
| 保活重试叠在 retry 层上白烧 3 次 | refresh 用 raw fetch 不走 callback-retry | `refresh-loop.ts` / P2 #1368 |
| 自定义信号 handler 压掉 Node 默认终止 | handler 里显式 `proc.exit()` | `refresh-loop.ts` / P1 #1368 e4da094a59 |
| `exit(0)` 隐藏终止原因 | `exit(128+signum)`（SIGTERM→143） | `refresh-loop.ts` / P2 #1368 7de77a70d |
| 保活定时器吊住本该退出的进程 | 两处 `timer.unref()` | `refresh-loop.ts` |
| stdout 混入非 JSON-RPC 字节毁掉 MCP 会话 | 所有日志走 `console.error`（stderr） | `path-validator.ts` |
| JSON Schema 被 `server.tool()` 误判成 annotations → 崩 | 强制 `registerTool` 显式三参数 | `server-toolsets.ts` |
| 未登记工具被误判只读 → 绕过 strict 白名单 | 默认 `A_WRITE_SAFE`，绝不默认只读 | `server-toolsets.ts` / 砚砚 R8 |
| 设备控制面在受限/未知模式暴露 | `desktopMode` 非空即过滤，fail-fast | `server-toolsets.ts` / R3 P2 F178 |
| 安静线程每次只读调用都打 freshness API | 门开与否都推进 `lastNoticeToolCallNum` | `server-toolsets.ts` / R2 P2-R2-2 |
| freshness 报错阻塞工具 | 整函数 `catch {}` fail-open | `server-toolsets.ts` |
| 未知 reason 被拿去做降级决策 | 类型守卫 + `KNOWN_REASONS` Set 双校验 | `degradation.ts` |
| `stale_invocation` 降级写回作废状态 | 不在 `DEGRADABLE_AUTH_REASONS` | `degradation.ts` / AC-E6 |
| `invalid_token`（客户端 bug）被降级掩盖 | 同上，不可降级 | `degradation.ts` |
| 写类工具忘了考虑降级 | 必须显式声明 `policy`（哪怕 `none`） | `degradation.ts` / AC-E2 |
| 降级了但无人知晓 | 成功标 `DEGRADED:true`（非 JSON 也包信封） | `degradation.ts` / AC-E4 |
| 重放旧 outbox（凭证在 body）被新 preHandler 拒 | `legacyHeadersFromBody` 就地升格 | `callback-outbox.ts` / #476 |
| 两个 flush 抢同一条 | `rename` 原子占用 + `.processing` 后缀排除 | `callback-outbox.ts` |
| 一个坏文件崩掉整轮 flush | `parseOutboxEntry` 八字段校验，坏则丢弃 | `callback-outbox.ts` |
| flush 中途异常把文件卡在 `.processing` | catch 里 rename 回原名（best-effort） | `callback-outbox.ts` |
| 网络抖动丢消息 | retryable 失败落盘，返回 `queued_for_retry` | `callback-outbox.ts` |
| at-least-once 造成重复副作用 | 三处幂等键（§4.5） | 多处 |
| 带凭证但无效 → 静默通过 | verify 失败立刻 401 fail-closed | `callback-auth-prehandler.ts` / #474 |
| 忘调 `requireCallbackAuth` 的路由变裸端点 | 约定每路由首行 require；缺失报 `unknown_invocation` | 各 `callback-*-routes.ts` |
| refresh 双次滑 TTL | preHandler 见 `callbackAuth` 已填即跳过 | `callback-auth-prehandler.ts` |
| 混源凭证白烧 cooldown 槽 | `extractCallbackCredentials` 混源返 null | `callbacks.ts` / gpt52 P1 #3 |
| cooldown 判定在 verify 之后变"装饰性" | refresh 判定放 `preValidation`（早于 preHandler） | `callbacks.ts` / gpt52 P1 |
| peek 与 verifyLatest 之间状态漂移 | 专属 message "Auth state changed between peek and atomic verify" | `callbacks.ts` |
| propose 创建了提议但卡片 append 失败 → 幽灵提议 | `store.delete + releaseDedup` 后 rethrow | 三个 `propose-*` |
| dedup 预留后 create 抛错 → 幽灵指针 | `releaseDedup` 后 rethrow | 三个 `propose-*` |
| 败者协程重复创建提议 | `reserveDedup` SET NX，败者绝不创建 | 三个 `propose-*` |
| 老提议被批准后从历史页消失 | 全取 → filter → 排 → slice（非先截断） | `F128ApprovalAdapter` / P2 |
| 非整数 `limit` 传 Redis ZREVRANGE → 500 | 扇出前 `Math.floor` | `approval-hub-routes.ts` |
| verify 删记录后通知器拿不到 thread | 只读不删的 `peekRecord` 在 verify 前偷看 | `callback-auth-prehandler.ts` / 砚砚 P1 #1397 |
| catId=null 系统消息在重载后被当"用户发的" | 带 `source: CALLBACK_AUTH_SOURCE` | `callback-auth-system-message.ts` / 砚砚 P1 #1397 |
| 两个并发 notify 同 tuple 发重复卡片 | 同步预留 dedup 槽再 await append | `callback-auth-system-message.ts` / P2 #1397 |
| notify append 失败后 5min 内重试被静默抑制 | 失败回滚 dedup 槽（仅当仍持有） | `callback-auth-system-message.ts` |
| 一 thread 的 hide 抑制掉别 thread 同 tuple | dedupKey 含 threadId + userId | `callback-auth-system-message.ts` / P1 #1397 |
| dedup map 在长活进程里无限增长（内存泄漏） | 每次 notify 前 `pruneExpired` | `callback-auth-system-message.ts` / P2 #1397 & #1427 |
| 遥测环形缓冲负数取模越界 | `((slot % N) + N) % N` | `callback-auth-telemetry.ts` |
| agent-key 明文泄露 | 存 SHA-256 加盐哈希，不存明文 | `AgentKeyRegistry.ts` |
| Antigravity sidecar 文件被本机他人读 | `chmod 0o600` | `antigravity-agent-key-sidecar.ts` |
| 轮换后老 key 立刻失效打断在途请求 | `graceUntil` 接管过期判定，宽限 24h | `AgentKeyRecord` |
| 云端 remote-spike 继承 invocation 凭证压掉 agent-key | env 有 invocation 凭证即启动失败 | `remote-spike.ts` |
| 裸 catId 粘进 initialMessage 致 dispatch 顺序错 | `normalizeCatIdMentionsInText` | `F128 propose-thread` |

---

## 6. 可观测性：出问题怎么查

### 6.1 鉴权失败遥测（`callback-auth-telemetry.ts` 全文级）

**唯一入口 `recordCallbackAuthFailure(record)`**——注释明说"所有 401 emission site 都漏斗过它，保证不管哪个 hook 检出失败，observability 都一致"。它一次做四件事：

```ts
export function recordCallbackAuthFailure(record: { reason; tool; catId? }): void {
  reasonCounts[record.reason]++; toolCounts[record.tool]++;      // ① 生命周期累计
  if (record.catId) byCat[record.catId]++;
  totalFailures++;

  recentSamples.push({ at: now(), ...record });                 // ② 最近 100 条样本（超了 splice 掉头部）
  if (recentSamples.length > RECENT_SAMPLES_CAP) recentSamples.splice(0, recentSamples.length - 100);

  const hourId = Math.floor(at / HOUR_MS);                       // ③ 24h 环形缓冲
  const slot = hourId % WINDOW_HOURS;
  const safeIdx = ((slot % WINDOW_HOURS) + WINDOW_HOURS) % WINDOW_HOURS;   // ← 负数取模防御
  if (buckets[safeIdx].hourId !== hourId) buckets[safeIdx] = freshBucket(hourId);  // 槽轮转即清零
  // ...累加 bucket.total / byReason / byTool / byCat

  const attributes = { [CALLBACK_REASON]: record.reason, [CALLBACK_TOOL]: record.tool };
  if (record.catId) attributes[AGENT_ID] = record.catId;
  callbackAuthFailures.add(1, attributes);                       // ④ OTel counter
}
```

**四个精确点**：
- **OTel counter 名 `cat_cafe.callback_auth.failures{tool, cat, reason}`**。`cat` 属性对面板/匿名请求会缺失——注释说 "OTel SDK drops undefined values"，所以直接不塞。
- **`tool` 维度是路由名不是 MCP 工具名**（§3.4 的 `callbackToolFromUrl` 只取 `/api/callbacks/` 后第一段）——读 dashboard 时必须记住 `post-message` ≠ `cat_cafe_post_message`。
- **环形缓冲的槽轮转**：24 个桶，`buckets[idx].hourId !== hourId` 时整桶替换成 `freshBucket`——这样"读到的桶"永远只含当前那个小时的数据，过期的自动失效，不需要定时清理。
- **`((slot % N) + N) % N`** 是防御性负数取模——虽然 `hourId` 恒正，但这是"别让将来某个改动引入负 index 越界"的护栏。`__setNowForTest` 注入假钟，让 24h 窗口能被确定性单测。

**徽标语义**（D2b-2 rev3）：HubButton 红点用的是 `unviewedFailures24h`（24h 内且发生在 `lastViewedAt` 之后的失败数），不是 `totalFailures24h`——用户点开看板就 `mark-viewed` 刷新 `lastViewedAt`，红点清零。注释坦白这是单用户 MVP 的 module-global，F077 多用户落地后要按 userId 分。`recordLegacyFallbackHit` 单独统计"还在用 body/query 传凭证"的命中数，是判断能不能删 legacy 兼容窗口的依据。

### 6.2 401 就地富块通知（`callback-auth-system-message.ts` 全文级）

`CallbackAuthSystemMessageNotifier.notify()` 的完整闸门序列：

```ts
async notify(params): Promise<boolean> {
  const now = this.now();
  this.pruneExpired(now);                                        // ① 先剪枝，再判断（顺序关键）

  if (!SURFACEABLE_REASONS.has(params.reason)) return false;     // ② 只有 expired/invalid_token 才发
  if (BACKGROUND_HEARTBEAT_TOOLS.has(params.tool)) return false; // ③ refresh-token 等心跳不发

  const key = dedupKey(params);                                  // reason:tool:catId:threadId:userId
  const state = this.dedup.get(key);
  if (state?.hiddenAt !== undefined && now - state.hiddenAt < HIDE_WINDOW_MS) return false;   // ④ 用户 hide 了 24h 内静默
  if (state && state.hiddenAt === undefined && now - state.lastSentAt < DEDUP_WINDOW_MS) return false;  // ⑤ 5min 去重

  this.dedup.set(key, { lastSentAt: now });                      // ⑥ 同步预留槽（在 await 之前！）
  let stored;
  try {
    stored = await this.messageStore.append({ userId, catId: null, source: CALLBACK_AUTH_SOURCE, ... });
  } catch (err) {
    const current = this.dedup.get(key);                         // ⑦ append 失败回滚槽（仅当仍持有）
    if (current && current.lastSentAt === now && current.hiddenAt === undefined) this.dedup.delete(key);
    throw err;
  }
  this.socketManager.broadcastToRoom(`thread:${threadId}`, 'connector_message', {...});
  return true;
}
```

**五处 review 埋在这一个方法里，全值得复述**：
- **① prune 必须在任何 early-return 之前**（P2 #1427）：否则一个"主要看到被抑制的心跳失败"的进程永远不会走到 prune，dedup entry 累积，部分重新引入 prune 本要修的内存驻留。
- **⑥ 同步预留槽**（P2 #1397）：两个并发 notify 同 tuple，若都先 await append 再写 dedup，会双双穿过 ④⑤ 闸门、都发卡片（爆发式 401 = 刷屏）。所以在 await 之前就 `dedup.set`。
- **⑦ 失败回滚**：append 抛错时删掉刚预留的槽，否则 5min 内的重试被静默吞掉；但只在"我还持有这个槽"（`lastSentAt === now`）时删，避免删掉后来并发者写的槽。
- **dedupKey 含 threadId + userId**（P1 #1397）：否则一个 thread 里 hide 掉某 tuple 会连带静默掉别的 thread/租户的同 tuple。
- **`source: CALLBACK_AUTH_SOURCE` + `catId: null`**（砚砚 P1 #1397）：不带 source 的话，`messages.ts` 时间线在重载时会把 catId=null 的消息分类成 `user`，让这条警告看起来像人自己发的。

`pruneExpired` 的过期判定：`hiddenAt` 存在则 `hiddenAt + 24h`，否则 `lastSentAt + 5min`。`__getDedupSizeForTest` 是给"内存不增长"回归测试用的接缝。

**一个前端坑**（注释直说）：通知走 rich block，但 `SystemNoticeBar` 目前**不渲染** `extra.rich.blocks`，只有消息过 `ConnectorBubble` 才渲染——所以这条就地通知的可见性取决于它落进哪种气泡。

### 6.3 三个 debug 端点 + 查问题顺序

`callback-auth-debug.ts`：`snapshot`（当前失败样本 + 24h 聚合）/ `mark-viewed`（刷 `lastViewedAt` 清徽标）/ `hide-similar`（按 tuple 静默 24h，即写 `hiddenAt`）。

```
猫说"发不出消息"
  → 看 cat_cafe.callback_auth.failures{reason} 哪个维度在涨：
      expired 多          → 保活没跑（查 [refresh-loop] 日志 / timer 是否被 unref 后进程早退）
      stale_invocation 多 → 同 thread/cat 起了新 invocation（正常，老的该退场）
      missing_creds 多    → spawn 时 env 没注入（查 [05 章] 凭证注入）
      agent_key_* 多      → 云端/Antigravity 路径，查 agent-key TTL / revoke / sidecar
  → outbox 堆积（~/.cat-cafe/callback-outbox/ 里 *.json 变多）→ API 侧持续失败，看 lastError 字段
  → 工具调用挂住不返回 → 查是否命中没带 AbortSignal 的老路径（现应全带）
  → dashboard 里 tool 维度看不懂 → 记住那是路由名不是 MCP 工具名
```

---

## 7. 面试追问应对

**Q1：你们给猫暴露了多少工具，怎么组织？**
> 「98 个工具，六个 toolset（collab/memory/signals/audio/finance/limb），做了 split 拓扑——六个分体入口各挂一个 toolset，客户端按需挂载，而不是一个 all-in-one 把 98 个工具一次性塞进 LLM 的 tool 列表（token 成本 + 选择噪音都爆炸）。`index.ts` 的 all-in-one 只作向后兼容保留。audio 是 F195 补的——原来只在 all-in-one 注册，导致 split 拓扑的 Codex 看不到它。」

**Q2：注册工具踩过什么坑？**
> 「必须用 `server.registerTool(name, config, cb)` 而不是 `server.tool()`。因为 `tool()` 的重载解析器用启发式判断某参数是 inputSchema 还是 annotations，我们的 plain JSON Schema 过不了它的 Zod 检查，被误判成 annotations，handler 槽位整体后移，运行时崩。而且数组里同时有两种 schema——大多数是 Zod raw shape，limb 是 plain JSON Schema——靠有没有 `type`+`properties` 键判别。」

**Q3：token 会过期，长任务怎么办？**
> 「invocation token TTL 2 小时——原来 10 分钟，但猫常跑 20-40 分钟，首个 callback 就 401。长会话靠后台保活循环续：间隔是 `clamp(剩余TTL/4, 6.18min, 30min)` 乘 ±15% 抖动。那个 6.18 分钟不是拍的——服务端冷却 5 分钟，如果下界直接写 5 分钟，抖动 0.85 倍会掉到 4.25 分钟撞冷却拿 429，所以预先 `5×1.05/0.85` 把下界抬上去。**教训是加了抖动之后，'下界'约束的不再是你写的值，而是值乘抖动下界。** 而且保活刻意不做成工具——refresh is plumbing not a cognitive action，做成工具猫会出于错误理由主动调它。」

**Q4：回调失败的三层兜底？**
> 「瞬时（408/429/5xx）走重试，实际是 4 次尝试（第 0 次 + 3 次退避 [1s,2s,4s]），每次带独立 10s AbortSignal——没有 signal 的 fetch 在半开 TCP 上永久 pending，工具永不返回。重试还失败就落 outbox，文件名时间戳前缀做 FIFO、rename 做原子占用、上限 10 次、返回 `queued_for_retry` 让猫觉得成功了（因为迟早会送到）。永久失败走降级框架，但只有 expired / unknown_invocation 可降；invalid_token 不降（客户端 bug，降了掩盖）；**stale_invocation 绝不降，因为它意味着这次 invocation 已被同 thread/cat 的新 invocation 取代，降级会把作废状态写回去。**」

**Q5：outbox 是 at-least-once，会重复写吧？**
> 「会，所以服务端幂等，这是配套的另一半。propose 用 clientRequestId 做 SET NX 预留；invocation 内有 clientMessageIds 集合；multi-mention 有 idempotencyKey；球权有 sourceEventId。outbox 保证至少送到，这些键保证多送的不产生副作用——只做 outbox 制造重复，只做幂等网络抖动就丢消息。」

**Q6：猫想改自己的关系档案，直接改吗？**
> 「不能，走 propose。三个 propose 路由都是提议不是执行，汇到 approval-hub 等人批。共享一个七步骨架：requireAuth → zod → isLatest（不是最新 invocation 就返回 stale_ignored，注意是 200 不是错误）→ clientRequestId 幂等快路径 → SET NX 预留 dedup（败者绝不创建）→ store.create（抛错要 releaseDedup）→ append 确认卡（抛错要 delete proposal + releaseDedup，绝不留没有卡片的幽灵提议）→ setCardMessageId 失败只记 warning 不回滚（卡片已经在用户屏幕上了，靠后续扫描自愈）。改 primer 那条还有乐观锁：propose 时记 baseContentHash，approve 时重读比对。」

**Q7：approval-hub 为什么用 adapter 模式？**
> 「四个 feature（F128/F193/F225/F231）底层 store 形状完全不同——方法名、有没有 settled、STALE 时长（7d/3d/24h/7d）、inlineApprovable、decidedAt 从哪个字段来全不一样。adapter 把各自的 pending/settled 映射成统一的 ApprovalItem DTO，Hub 路由只 `Promise.all(adapters.map(...))` 再按时间排。F231 没实现 listSettled，settled 路由用 `filter(a => typeof a.listSettled === 'function')` 把它跳过。新增 feature 只加一个 adapter，Hub 不动。」

**Q8：没带凭证的请求会怎样？这不是无鉴权吗？**
> 「preHandler 在没有任何凭证时静默放行——因为同一个 Fastify 实例还挂着浏览器面板路由，走 session 鉴权。代价是 callback 路由如果忘了首行调 `requireCallbackAuth` 就变裸端点，所以这是靠约定强制的。`requireCallbackAuth` 缺 decoration 时上报 unknown_invocation 而不是 expired——注释说这里其实不知道 registry 状态，报 unknown 更安全。而 refresh-token 的 cooldown 判定放 `preValidation` 而不是 preHandler，因为 Fastify 生命周期里 route-level preValidation 早于 plugin-scoped preHandler，而 preHandler 的 verify 会滑 TTL——判定放它之后的话 429 就只是装饰性的，滥用者仍然把 token 续上了。」

**Q9（安全向）：agent-key 的凭证安全怎么做的？**
> 「secret 256 位随机（randomBytes 32），存 sha256(secret+salt) 不是明文，泄露库也拿不到 secret。TTL 45 天，轮换有 24h 宽限——`graceUntil` 一旦存在就接管过期判定，让在途请求不被立刻打断。Antigravity 读不了 env 注入的 token，靠 sidecar 文件传 key，文件 chmod 0o600。云端 remote-spike 入口 fail-closed：env 里意外继承 invocation 凭证（会因优先级压掉 agent-key）时启动直接失败。」

**Q10：401 之后猫知道发生了什么吗？**
> 「知道。鉴权失败时往帖子里发一条 rich block 系统消息，猫下一轮一定看到。但只有 surfaceable 的 reason（expired / invalid_token）才发，心跳工具（refresh-token）不发——用户对心跳失败没有可操作的响应。发之前必须靠 peekRecord 拿到 threadId/catId，因为 verify 在 expired 时已经把记录删了（getRecord 也删，所以专门加了只读不删的 peekRecord）。而且并发 notify 会同步预留 dedup 槽再 await，防止爆发式 401 刷屏；消息带 connector source，否则重载后会被当成用户自己发的。」

---

## 8. 本篇速查表

### 端点与文件规模
```
mcp-server: 43 文件 / ~10413 行 · 98 工具 · 6 toolset · 6 分体入口 + 1 all-in-one
callback:   32 文件 / ~10649 行 · 4 个是纯 helper → 实际 44 个 HTTP 端点
agent-key:  6 文件 / 446 行   approval-hub: 8 文件 / 815 行   limb: 11 文件 / 1297 行
```

### 鉴权
| 项 | 值 |
|---|---|
| 钥匙一 | `CAT_CAFE_INVOCATION_ID` + `CAT_CAFE_CALLBACK_TOKEN`（成对才有效） |
| HTTP 头 | `x-invocation-id` / `x-callback-token` / `x-agent-key-secret` |
| 优先级 | invocation **永远压过** agent-key |
| invocation TTL | 2h（原 10min，因猫常跑 20-40min 改） |
| agent-key | TTL 45d / 宽限 24h / SHA-256 加盐 / sidecar chmod 600 |
| fail 行为 | 无凭证 no-op；半个或无效 → 立刻 401 fail-closed |

### 九个失败 reason
```
可降级：  expired, unknown_invocation
不可降级：invalid_token（客户端 bug）, stale_invocation（会写脏数据）, missing_creds
agent-key：agent_key_expired / _revoked / _unknown / _scope_mismatch(保留位)
可就地通知：仅 expired, invalid_token（心跳工具即使 surfaceable 也不发）
```

### 四层可靠性常量
| 层 | 常量 | 值 |
|---|---|---|
| 保活 | 服务端冷却 / 客户端下界 / 上限 | 5min / ≈6.18min / 30min |
| 保活 | 抖动 / tick 超时 / 退出码 | [0.85,1.15] / 10s / 128+signum |
| 重试 | 尝试次数 / 退避 / 单次超时 / 重试码 | 4 次(0+3) / [1s,2s,4s] / 10s / 408,429,≥500 |
| outbox | 批量 / 最多尝试 / 并发原语 | 20 / 10 / rename |
| freshness | 间隔 / 上限 | 每 5 次只读 / 每 invocation 3 条 |
| 通知 | 去重窗 / hide 窗 | 5min / 24h |
| 遥测 | 样本上限 / 窗口 | 100 / 24 桶(每桶 1h) |

### 降级三原则 + 决策树
```
explicitness > silent default   写类工具必须声明 policy（哪怕 none）
瞬时归重试，永久归降级          两层不重叠
成功标 DEGRADED:true            非 JSON 也包信封 {DEGRADED:true, payload}
决策树：成功→原样 / 非鉴权→原样 / 不可降→原样 / none→加提示 / custom→降级+标记
```

### 三个 propose 的七步骨架
```
requireAuth → zod → isLatest(否则 stale_ignored 200) → clientRequestId 幂等快路径
→ SET NX 预留 dedup（败者不创建）→ store.create（抛错 releaseDedup）
→ append 确认卡（抛错 delete+releaseDedup）→ setCardMessageId(失败只 warn) → 广播
```

### 四个 approval adapter
```
F128 开thread   STALE 7d  inlineApprovable=false  有 settled(全取→filter→排→slice)
F193 派活       STALE 3d  inlineApprovable=true   有 settled  唯一会 throw 的 toSettledItem
F225 session接力 STALE 24h inlineApprovable=false  有 settled  A4 gate 返 200 不是错误
F231 改primer   STALE 7d  inlineApprovable=false  无 settled(被 filter 跳过)  有乐观锁
```

### annotation 红线
```
未登记工具 → 默认 A_WRITE_SAFE（写、非破坏），绝不默认只读
（误标只读 = strict-whitelist 模式下漏出设备控制面 = 安全漏洞）
limb：默认全暴露；任何 desktopMode（含拼错）→ 走过滤 fail-fast
```

---

→ [返回目录](README.md)

---

# 27 · 深潜：MCP 工具与回调路由的实现：源码详解版

> 阅读口径：这一节是对本章既有内容的增量扩写，不替换上面的速查表。路径、函数名、返回值和分支都以当前工作区源码为准；每个结论尽量标为 [源码确认] 或 [测试确认]。文档注释说明“为什么”，但不能替代运行代码，因此仅在需要时标为 [文档确认]。没有在源码或测试中直接找到的推论，会明确标为 [合理推断] 或 [仍需验证]。

## 0. 本章到底要解决什么问题

MCP 工具不是把一个 JavaScript 函数暴露给模型这么简单。真实问题是：一个被子进程拉起的猫，如何在不直接持有服务端内部对象的前提下，可靠而且受限地读取或改变主服务的状态？如果只回答“工具调用一个 HTTP API”，面试官通常会继续问：

- 子进程怎样知道自己是谁，为什么不能伪造另一个猫或另一个 thread？
- 网络在服务端已经落库、但响应丢失时，重试为什么不会重复发消息？
- token 过期、进程挂住、用户取消、另一轮 invocation 抢占时，写操作会到哪里停住？
- 为什么有的动作直接写消息，有的只能创建 proposal，proposal 卡片写失败又如何恢复？
- MCP SDK 要 Zod，而项目里又有 plain JSON Schema，注册为什么不崩？

本章的答案不是“一个万能中间件”。它是一条分层链路：

    MCP stdio 入口
      -> 工具注册和入参 schema
      -> callbackPost / callbackGet
      -> 重试、超时、outbox
      -> Fastify preHandler 身份校验
      -> CallbackPrincipal 与 thread scope
      -> 路由的业务校验、去重、持久化
      -> A2A 队列、WebSocket、外部 connector

[源码确认] legacy 入口 packages/mcp-server/src/index.ts:23-26 创建 McpServer 并调用 registerFullToolset；真正的 stdio 连接发生在同文件 32-45。回调发起由 packages/mcp-server/src/tools/callback-tools.ts:175-222 的 callbackPost 统一转给 sendCallbackRequest。服务端 callback 路由在 packages/api/src/routes/callbacks.ts:841 起注册，统一身份 hook 在 packages/api/src/routes/callback-auth-prehandler.ts:69-168 注册。

这一章选择一个贯穿案例，而不把几十个工具散讲。

### 0.1 贯穿案例：当前 invocation 的猫发送一条协作消息

用户在 thread T-42 中让猫 A 总结结论并叫猫 B 补充。调度器已经为猫 A 创建 invocation I-A；它的初始登记信息至少有 userId=U-1、catId=A、threadId=T-42、callbackToken=K-A。猫 A 的模型决定调用：

    cat_cafe_post_message({
      content: "我已经完成定位。\\n@cat-b 请复核 Redis 侧的 TTL。",
      clientMessageId: "msg-20260819-01"
    })

预期结果不是泛泛的“成功”。正常情况下：

1. MCP 的 handler 把这个参数交给 _executePostMessage；
2. callbackPost 只把 invocationId/callbackToken 放进 HTTP header；
3. API 验证 K-A 属于 I-A，把身份写进 request.callbackPrincipal；
4. 路由确认 I-A 仍是 (T-42, A) 槽位中最新的 invocation；
5. 路由解析行首 @cat-b，写一条 origin=callback 的消息；
6. 若有 A2A 依赖，消息会先以 queued 状态交给 A2A 队列；否则立即广播；
7. MCP 返回结构化 JSON 文本，模型据此知道消息是否投递、是否被 held、是否排队重试、是否有路由警告。

注意案例故意使用 invocation 凭证且不传 threadId。对这一类身份，工具层明确拒绝由调用者改写 threadId，避免在模型或错误参数影响下把消息投到任意帖子。packages/mcp-server/src/tools/callback-tools.ts:710-727 是这个本地提前拒绝；API 仍在 packages/api/src/routes/callbacks.ts:1218-1240 复查跨 thread 情况，因此它不是单点安全边界。[源码确认]

### 0.2 先区分五个容易混淆的“成功”

面试时常见误答是把所有 HTTP 200 说成“消息已经成功发送”。当前实现至少要区分下面五种结果：

| 返回或状态 | 它真正意味着什么 | 猫接下来应该怎样理解 |
| --- | --- | --- |
| status: ok | 路由已经正常完成写入路径，返回 messageId；是否立刻广播取决于 A2A delivery decision | 可以报告已提交，仍应读取 routed/routing_warnings |
| status: duplicate | 同一 clientMessageId 或同内容原子指纹已被占用 | 不要再生成一条新消息；这是幂等成功 |
| status: stale_ignored | 调用来自被更新 invocation 取代的旧实例，服务端故意没有写消息 | 不能说“已发送”；MCP handler 会把它改成错误提示 |
| status: held | 新鲜度门禁发现有未读消息，服务端没有写本次消息 | 先读预览，或显式 acknowledgeHeld 后再发 |
| status: queued_for_retry | MCP 本地 HTTP 尝试已失败，但请求 JSON 已写入本机 outbox | 仅表示“将来会重放”，不是 API 已持久化 |

[源码确认] stale_ignored 的服务端返回在 packages/api/src/routes/callbacks.ts:1211-1216；MCP 侧把它转成 isError 见 packages/mcp-server/src/tools/callback-tools.ts:620-660。outbox 成功入队后返回 queued_for_retry 见 packages/mcp-server/src/tools/callback-outbox.ts:186-203。API 新鲜度 gate 的 held 信封见 packages/api/src/routes/callbacks.ts:1441-1475。

这也是“可靠性闭环”必须拆层讲的原因：at-least-once 是 transport 的目标，不是业务对用户承诺的 exactly-once；业务去重把重复到达转成 duplicate；stale guard 则选择不做写入，即使 HTTP 是 200。

## 1. 先建立整体心智模型

### 1.1 时序图：案例从模型到最终消费者

    用户 / 调度器                    MCP 子进程                 API / 存储 / 前端
          |                               |                               |
          | 创建 InvocationRegistry.create |                               |
          |------------------------------>| I-A + K-A 以环境变量注入     |
          |                               |                               |
          | 模型选择 cat_cafe_post_message |                               |
          |------------------------------>| handlePostMessage             |
          |                               | _executePostMessage           |
          |                               | callbackPost                  |
          |                               | POST /callbacks/post-message  |
          |                               |------------------------------>|
          |                               |                  preHandler verify
          |                               |                  derivePrincipal
          |                               |                  isLatest / scope
          |                               |                  claim dedup
          |                               |                  MessageStore.append
          |                               |                  enqueue A2A 或 broadcast
          |                               |<------------------------------|
          |<------------------------------| ToolResult(JSON 文本)          |
          |                               |                               |
          |                               |              WebSocket room / connector

这里有三个进程或边界，不能混为一谈。

第一，模型不是 API 的受信任调用方。MCP SDK 给它 schema、description 和工具结果，但模型生成的参数仍然是外部输入。Zod/JSON Schema 只校验形状；身份与资源边界只能由 API 的凭证和 scope 确认。

第二，MCP 进程和 API 进程不共享内存。MCP 的 getCallbackConfig 只能从环境变量或 sidecar 文件读取凭证；API 的 InvocationRegistry 通过可替换 backend 保存 record。packages/api/src/domains/cats/services/agents/invocation/InvocationRegistry.ts:87-207 明确把 registry 设计成 facade，默认内存 backend，但可注入 Redis backend。[源码确认]

第三，API 的“写入完成”和“用户已看到”不一定是同一时刻。消息可能先被标为 deliveryStatus: queued，等待 A2A 队列处理，代码有意避免此时先 Socket 广播。packages/api/src/routes/callbacks.ts:1772-1827 先 append，再由 MessageDeliveryService 决定是否排队、何时广播。[源码确认]

### 1.2 模块边界、数据变换与错误归属

| 模块 | 输入来自哪里 | 负责转换成什么 | 主要输出/消费者 | 不该负责什么 |
| --- | --- | --- | --- | --- |
| mcp-server entry | OS 进程、stdio JSON-RPC | McpServer 和 tool registry | MCP client/模型 | 业务授权与数据库写入 |
| server-toolsets | ToolDef 数组、环境变量 | 过滤后的 SDK registerTool 配置 | SDK tool listing / tool call | 判断某个 thread 是否属于用户 |
| callback-tools | 模型参数、环境凭证 | HTTP path/body/header、ToolResult | API callback | 直接持久化服务端状态 |
| callback-retry/outbox | HTTP 失败、JSON 请求 | 有界重试或本地 JSON 队列 | 下次 callback 调用 | exactly-once 语义 |
| callback auth hook | Header/legacy body/query | InvocationRecord 或 CallbackPrincipal decoration | 所有 callback route | 各 route 的资源级授权 |
| callbacks.ts / 拆分 route | 已认证 principal、Zod body | store 写入、事件、HTTP response | MessageStore、Queue、Socket | 信任 payload 中的 catId/userId |
| proposal route / approval hub | 已认证 cat 的提议 | pending proposal 加可见确认卡 | 人类审批端、WebSocket | 绕过人类批准执行高影响动作 |

贯穿案例的数据形状有四次关键变化：

1. 模型参数是未可信对象 input；
2. callbackPost 组装的是 Record<string, unknown> body 与认证 header；
3. preHandler 把凭证变成判别联合 CallbackPrincipal；
4. post-message route 再把 body 变成存储消息：content、mentions、extra.rich、origin、threadId、可选 deliveryStatus。

错误也不是“一路 throw 到顶”。例如 callback retry 把 fetch 异常转换为 { ok: false, failure: { error, retryable } }；outbox 把可重试失败转换为 { ok: true, data: { status: 'queued_for_retry' } }；而无效 token 会作为 401 body，再由客户端加 [reason=...] 标签。相反，MessageStore.append 的意外异常通常没有被 post-message route 吞掉，会交给 Fastify 错误处理。[源码确认] packages/mcp-server/src/tools/callback-retry.ts:78-126；packages/mcp-server/src/tools/callback-outbox.ts:172-207；packages/mcp-server/src/tools/callback-tools.ts:205-221。

### 1.3 本案例的状态变化表

| 阶段 | 当前函数 | 输入 | 输出/事件 | 状态变化 | 外部副作用 | 失败处理 |
| -- | ---- | -- | ----- | ---- | ----- | ---- |
| 0 | InvocationRegistry.create | userId, catId, threadId | invocationId, callbackToken | 后端新增带 TTL 的 InvocationRecord | 内存或 Redis | backend 异常向上抛给调用者 |
| 1 | createServer / registerTools | ToolDef[] | SDK 已注册工具 | 无业务状态 | stdio server 取得 handler | schema 转换失败时启动/注册失败 |
| 2 | handlePostMessage | 模型 JSON | ToolResult 或本地 isError | 无 | 无 | invocation 凭证带 threadId 时本地拒绝 |
| 3 | callbackPost | path, body, env | ToolResult | 无 | HTTP POST | 无配置返回错误；失败交 retry/outbox |
| 4 | postJsonWithRetry | JSON 字符串 | ok/data 或 failure | attempt 变量递增 | 网络 fetch | 408/429/5xx/异常可重试；每次 10 秒终止 |
| 5 | sendCallbackRequest | CallbackRequest | data 或 queued_for_retry | 本地 outbox 文件可新增 | 文件 mkdir/writeFile | 不可重试或落盘失败回传错误 |
| 6 | registerCallbackAuthHook | headers | request.callbackPrincipal | request decoration 写入 | registry verify，可能遥测/系统卡片 | 半套凭证、无效 key/token 返回 401 |
| 7 | post-message route | principal + body | ok/duplicate/held/stale_ignored | 去重键、消息记录、cursor/queue 状态 | MessageStore、Socket、可选 Redis/connector | 400/403/503、held 或不写 stale |
| 8 | enqueueA2ATargets / delivery decision | StoredMessage + mentions | queue 或广播事件 | queued -> delivered 的后续转换 | InvocationQueue、Socket | 队列失败路径由 delivery service 决策回退 |

表中“外部副作用”要读成发生位置，而不是都保证发生。例如 outboundHook 的 deliver 是 fire-and-forget 风格：调用后加 .catch 仅记录错误，已经写入的消息不回滚。packages/api/src/routes/callbacks.ts:1130-1151 证明了这一点。它的取舍是 connector 下游短暂不可用不应撤销主消息；但是否能做到最终送达，不能仅凭这里确认，故为 [仍需验证]。

## 2. 源码地图：入口、调用方、被调用方与配置

### 2.1 MCP 入口不是只有 index.ts

原章提到 all-in-one 和六个分体入口，源码上要再说准确一点。index.ts 的 createServer 只负责 legacy all-in-one：new McpServer 后调用 registerFullToolset。packages/mcp-server/src/index.ts:16-26。它作为直接执行文件时，main 还会创建 StdioServerTransport、await server.connect、启动 refresh loop 并安装信号处理器，见 32-54。

分体入口以 collab.ts 为代表：createCollabServer 使用名字 cat-cafe-collab-mcp 并只 registerCollabToolset，main 的 transport 与 refresh 生命周期和 legacy 入口相同。packages/mcp-server/src/collab.ts:16-50。[源码确认] 因而“模型看见哪些工具”首先由启动哪个 entry 决定，然后才受 readonly/desktop 环境过滤影响。

这里的 async/await 是实质行为：

    async function main(): Promise<void> {
      const transport = new StdioServerTransport();
      await server.connect(transport);
    }

async 表示该函数一定返回 Promise，即使最终没有返回值也对应 Promise<void>。await 暂停 main 的后续步骤，直到 connect 完成或 reject；这样 refresh loop 不会抢在 stdio 未建立前启动。若去掉 await，connect 的失败可能成为未处理 rejection，而日志却错误显示“running”。[源码确认] 代码在 packages/mcp-server/src/index.ts:32-45。

### 2.2 ToolDef：为何宽类型和 never 同时出现

server-toolsets.ts 中的 ToolDef 是注册层的内部统一接口：

    type ToolDef = {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      handler: (args: never) => Promise<unknown>;
    };

这里的 Record<string, unknown> 是 TypeScript 的“字符串键对象，值未知”类型。unknown 比 any 更安全：读取者不能未经收窄就把值当字符串或函数用。它故意容纳两种运行时对象：普通 callback 工具提供 Zod raw shape，limb 工具提供 JSON Schema 对象。packages/mcp-server/src/server-toolsets.ts:32-36 与 516-560。[源码确认]

handler 的 args: never 不是说运行时永远不传参，而是数组聚合时的类型擦除。每个具体 handler 的输入不同，若硬写成一种具体对象，异构工具数组不能统一；注册边界再以受控 cast 把 SDK 参数交回 handler。风险也必须讲清：这种擦除会降低编译器在 ToolDef 集合处发现“schema 与 handler 入参不匹配”的能力，所以项目在运行时让 SDK/Zod 再校验。若把 never 当成“可以安全调用任何方法”，是错误理解；never 在 TypeScript 是不可能出现的值类型，只是该回调类型被注册适配层转换了。[源码确认]

### 2.3 Zod raw shape 与 plain JSON Schema 的分流

registerTools 中有一个很具体的兼容问题：SDK 需要能调用 safeParseAsync 的 Zod schema；plain JSON Schema 没有这个方法。代码以 type 是字符串且 properties 是对象作为 plain JSON Schema 的判据，调用 jsonSchemaToZod，否则用 z.object(schema as z.ZodRawShape)。packages/mcp-server/src/server-toolsets.ts:516-560。

转换器只实现本项目所用的有限子集：string/number/integer/boolean/array/object、enum、description、required。packages/mcp-server/src/json-schema-to-zod.ts:15-75。它用：

    const requiredSet = new Set(
      Array.isArray(jsonSchema.required) ? jsonSchema.required : []
    );
    for (const [key, prop] of Object.entries(properties)) {
      const zodProp = jsonPropertyToZod(prop);
      shape[key] = requiredSet.has(key) ? zodProp : zodProp.optional();
    }

Set 是不重复元素集合，has 的意图是快速判断 key 是否在 required 列表。Object.entries 返回 [key, value] 数组组成的可迭代对象；for...of 里的 [key, prop] 是 destructuring，把每个二元数组分别绑定到两个变量。之所以不用普通对象查表，是 required 的语义就是成员关系，而且 Set 不会因重复 required 条目而改变结果。若不做 optional，所有 JSON Schema 属性都会被错误当必填；若不用 Array.isArray 这个类型守卫，unknown 值直接当数组遍历会在运行时崩。 [源码确认] packages/mcp-server/src/json-schema-to-zod.ts:61-75。

schema 校验的局限也必须背下来：它证明 content 是 1 到 50000 字符、threadId 是可选非空字符串、targetCats 是字符串数组；它不能证明该 thread 属于 U-1，也不能证明 cat-b 是合法参与者。这就是为什么后面仍要 resolvePrincipalThread、resolveScopedThreadId 与 resolveCatTarget。

### 2.4 工具过滤和 annotation 的安全意义

parseToolsetEnv 将 process.env 转成 ToolsetEnv：

    {
      readonly: env.CAT_CAFE_READONLY === 'true',
      hasAgentKey: !!(
        env.CAT_CAFE_AGENT_KEY_SECRET ||
        env.CAT_CAFE_AGENT_KEY_FILE ||
        env.CAT_CAFE_AGENT_KEY_FILES
      ),
      desktopMode: desktopMode || undefined
    }

双感叹号 !! 是把可能为 string 或 undefined 的值转成 boolean；desktopMode || undefined 利用 JavaScript 的 truthy/falsy，空字符串不会流入模式判断。它服务于一个明确优先级：desktopMode 最高，未知模式抛错；否则非 readonly 放行全部；readonly 下只允许 READONLY_ALLOWED_TOOLS，加上有 agent key 时的 AGENT_KEY_TOOLS。packages/mcp-server/src/server-toolsets.ts:140-188。[源码确认]

这不是 API 授权替代品，而是减少“模型可见、可选”的能力面。若误把未知 desktop mode 当作“不过滤”，设备控制的 limb 工具可能被意外暴露；源码选择 throw 而不是默认放行。对于未显式填 annotation 的未来工具，inferAnnotations 默认 A_WRITE_SAFE，绝不默认 read-only。packages/mcp-server/src/server-toolsets.ts:439-445。原因是 metadata 误标为只读会诱导上游平台允许实际写操作；保守写标记至少倾向于多拦而非少拦。

### 2.5 凭证配置的精确优先级

getCallbackConfig 是 MCP 到网络边界的第一道配置检查：

    const invocationId = process.env.CAT_CAFE_INVOCATION_ID;
    const callbackToken = process.env.CAT_CAFE_CALLBACK_TOKEN;
    const agentKeySecret = resolveAgentKeySecret(options);

    const hasFullInvocation = invocationId && callbackToken;
    if ((invocationId || callbackToken) && !hasFullInvocation && !agentKeySecret) {
      return null;
    }

    return {
      apiUrl,
      ...(hasFullInvocation ? { invocationId, callbackToken } : {}),
      ...(agentKeySecret ? { agentKeySecret } : {})
    };

这是对象 spread 与条件对象模式。...(condition ? { a } : {}) 的意思是条件真时复制属性，否则复制空对象；它避免出现 invocationId: undefined 这样的字段。这里采用它是为了让 config 的“有凭证”含义清晰。若只传一个 invocation 字段又没有 agent key，函数返回 null，fail closed；如果容许半套 header 发出，服务端只能给 missing_creds，而调用方更难诊断环境注入错误。packages/mcp-server/src/tools/callback-tools.ts:108-130。[源码确认]

一个需要纠正原文中容易含混的说法：getCallbackConfig 可以构造出同时含完整 invocation 和 agentKeySecret 的对象，但 buildAuthHeaders 在 invocation 成对存在时立即返回 invocation headers，根本不会附带 x-agent-key-secret；agent key 只在没有完整 invocation 时才实际出现在网络请求中。packages/mcp-server/src/tools/callback-tools.ts:136-147。[源码确认] 所以可靠表述是“invocation header 优先，agent key 是回退身份”，不是“服务端同时验证两种身份”。

### 2.6 共享 sidecar 与文件系统边界

resolveAgentKeySecret 先处理 options.agentKeyCatId：若存在 CAT_CAFE_AGENT_KEY_FILES JSON 映射，选择该 catId 对应文件；若映射存在却没有传 selector，则返回 undefined，避免在共享 MCP 中随便选择一个 key。没有映射时才读 CAT_CAFE_AGENT_KEY_SECRET 或 CAT_CAFE_AGENT_KEY_FILE。packages/mcp-server/src/tools/callback-tools.ts:65-106。[源码确认]

readAgentKeyFile 使用 readFileSync(path, 'utf-8').trim()，catch 后返回 undefined。这里的 try/catch 不是把一切当成功：它把“sidecar 缺失/读失败”降成“没有 agent-key 配置”，而 getCallbackConfig 仍会因无可用凭证返回 null。若 catch 后伪造空 key 并照常请求，会把本地文件问题混淆成远端 401。同步读文件在启动配置的窄路径中换取简单性；是否会在高频工具调用中造成可观测阻塞，需要结合具体调用频率评估，当前代码没有缓存，故为 [合理推断]。

## 3. 案例的完整调用链：从工具注册到 API route

### 3.1 入口阶段：stdio、Promise 和资源清理

运行 entry 时，main 先 initCatCafeDir，再 connect transport，最后才 startRefreshLoop。initCatCafeDir 会确保 ~/.cat-cafe 及 chat、memory、workspace、assets、.state 子目录存在；它把日志写 stderr，因为 stdout 留给 JSON-RPC。packages/mcp-server/src/utils/path-validator.ts:116-130。[源码确认]

这里已有一个值得回答的“子进程与协议”问题。stdio MCP 的 stdout 不是人类日志通道。如果工具进程把调试文本写 stdout，会破坏 JSON-RPC 帧，表现为上游客户端随机解析失败。因此源码只在 stderr 记录启动信息。这个判断来自 index.ts:35-38 的 StdioServerTransport 和 path-validator.ts:128-129 的注释/实现，标为 [源码确认]。

进程退出不是只 clearTimeout。installShutdownHandlers 为 SIGTERM 和 SIGINT 调 loop.stop，然后以 128+signal number 退出；SIGTERM 得 143，SIGINT 得 130。packages/mcp-server/src/refresh-loop.ts:120-145。这样外部 supervisor 能区分正常 return、失败 exit(1) 与被信号终止。若添加 signal listener 却不 exit，Node 的默认信号终止行为会被覆盖，子进程可能留住；若只 exit 而不 stop，测试中的 timer 或复杂资源可能继续运行到进程结束，清理语义也不完整。[源码确认]

### 3.2 注册阶段：模型看见什么，SDK怎样调用 handler

registerFullToolset 依序注册 collab、memory、signals、limb、audio、finance。packages/mcp-server/src/server-toolsets.ts:611-618。每个 registerXToolset 最终都走私有 registerTools；其循环中的关键代码是：

    for (const tool of tools) {
      const annotations = inferAnnotations(tool.name);
      const schema = tool.inputSchema;
      const zodSchema =
        typeof schema.type === 'string' &&
        typeof schema.properties === 'object' &&
        schema.properties !== null
          ? jsonSchemaToZod(schema)
          : z.object(schema as z.ZodRawShape);

      registerExplicit(tool.name, {
        description: tool.description,
        inputSchema: zodSchema,
        annotations
      }, async (args: never) => {
        const result = await tool.handler(args);
        return typed;
      });
    }

这是三类 TypeScript/JavaScript 语法的组合。

一，三元运算符 condition ? A : B 在这里做 schema 分支。typeof schema.properties === 'object' 后还检查 !== null，是因为 JavaScript 中 typeof null 也是 object；省掉 null 检查会让空 JSON Schema 走错分支。

二，as z.ZodRawShape 是 type assertion，只影响编译，不做运行时校验。采用它是因为 ToolDef 为异构输入统一成宽类型；真正的运行时保障仍是 z.object 和 SDK 的 safeParseAsync。若误以为 as 能转换数据，运行时就会在 SDK 处因 plain object 缺方法而失败。

三，async handler 返回 Promise。SDK 调用回调时会 await；工具自己的 handler 无论内部是同步组结果还是网络调用，都以 Promise 统一。若回调不 await tool.handler，可能在返回 ToolResult 前网络请求尚未完成，模型会拿到未定义或旧状态。

源码注释解释为什么不用 server.tool 的重载 API：plain JSON Schema 会被重载解析器误判成 annotations，导致 handler 参数槽移位；registerTool 的 config object 形式没有这个歧义。packages/mcp-server/src/server-toolsets.ts:516-539。[源码确认]

### 3.3 调用阶段：handlePostMessage 的第一道本地边界

在案例里，SDK 已经根据 postMessageInputSchema 做完模型工具参数校验，随后 handler 调 handlePostMessage。它没有立刻信任 input.threadId：

    const hasInvocationCreds =
      !!process.env.CAT_CAFE_INVOCATION_ID &&
      !!process.env.CAT_CAFE_CALLBACK_TOKEN;
    if (input.threadId && hasInvocationCreds) {
      return errorResult(
        'post_message rejects threadId from invocation-token callers ...'
      );
    }
    return _executePostMessage(input);

packages/mcp-server/src/tools/callback-tools.ts:710-727。[源码确认]

案例不带 threadId，因而进入 _executePostMessage。若模型误传 threadId，仍在本地返回 MCP 错误，不浪费一次 HTTP 往返。为什么不只靠 agentKeyCatId 是否存在来判断 agent key？源码注释明确说它只是 shared Antigravity MCP 的 sidecar selector，不是 principal；环境中若有完整 invocation，buildAuthHeaders 仍会发送 invocation header。以用户输入字段做认证判断会让调用者通过随便填 selector 绕过 KD-1。这里读取实际 env 是为了跟最终 header 选择保持一致。

### 3.4 _executePostMessage：body 构造、默认幂等键和降级

_executePostMessage 建 body 时做了多处条件字段：

    {
      content: input.content,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      clientMessageId: input.clientMessageId ?? randomUUID(),
      ...(input.targetCats?.length ? { targetCats: input.targetCats } : {}),
      ...(input.acknowledgeHeld ? { acknowledgeHeld: true } : {})
    }

packages/mcp-server/src/tools/callback-tools.ts:587-618。[源码确认]

?? 是 nullish coalescing：只有左侧为 null 或 undefined 才取右侧。它与 || 不同，空字符串、0、false 不会被替换。这里选 ?? 的原因是“调用者没有给 key”才生成 UUID；若写成 ||，空字符串也会被替换，虽然 schema 最终会拒绝空 clientMessageId，但错误来源会变得不透明。更重要的是，随机默认 key 只保证单次 MCP 调用具备 key；上层如果自己因未知响应重试，应复用原 clientMessageId 才能让 API 判为 duplicate，不能每次重新调用 handler 让 randomUUID 生成新 key。

input.targetCats?.length 是 optional chaining。它的含义是 input.targetCats 为 null/undefined 时表达式直接给 undefined，不会试图读 length；有数组且 length 为真时才复制字段。采用它避免分散写 input.targetCats && input.targetCats.length。若漏掉 ?.，可选字段缺失时会 TypeError；若把 length 条件删掉，把空数组传去不会安全问题，但会改变“明确目标”与“没有目标”的语义。

withDegradation 包在 callbackPost 外，但 policy 是 kind: none。它不是“失败也成功”，而是在 expired/unknown_invocation 这两个可降级认证原因上，附加无 fallback 的明确提示。packages/mcp-server/src/tools/degradation.ts:40-80 与 callback-tools.ts:597-618。[源码确认] 对 post-message 而言，重建旧 invocation 的状态比丢弃更危险，因此当前案例没有自定义本地补偿写入。

### 3.5 callbackPost：HTTP 调用方、被调用方与返回契约

callbackPost 的调用方是各 callback-backed MCP handler；被调用方是 sendCallbackRequest。它先 getCallbackConfig，未拿到 config 直接返回 errorResult(NO_CONFIG_ERROR)，之后用 buildAuthHeaders 组 CallbackRequest：

    const result = await sendCallbackRequest(
      {
        apiUrl: config.apiUrl,
        path,
        body,
        headers: buildAuthHeaders(config)
      },
      { enableOutbox: options?.enableOutbox === true }
    );
    if (result.ok) return successResult(JSON.stringify(result.data));

packages/mcp-server/src/tools/callback-tools.ts:175-205。[源码确认]

这里 result 是 union type，也就是两种可能对象形状的并集。sendCallbackRequest 成功分支有 ok: true 和 data，失败分支有 ok: false 和 error。if (result.ok) 是 discriminant narrowing：TypeScript 看到 boolean literal ok 后，将 result 缩窄到成功成员；否则可安全读取 error。这个模式胜过返回 null 或 throw string，因为调用方不必猜测数据是否存在。若把 ok 写成普通 boolean 而不是 true/false 字面量，编译器无法可靠缩窄，容易读取不存在的 data/error。

callbackPost 对 400 CatRoutingError 有一层格式化：正则匹配 HTTP 400 的错误文本，尝试 JSON.parse，若 kind 是 cat_disabled 或 cat_not_found 则加人可读前缀；parse 出错则回落原始错误。packages/mcp-server/src/tools/callback-tools.ts:207-221。这个 catch 只保护“增强错误呈现”，不改变成功或失败判定；它不应吞掉 sendCallbackRequest 的真实失败。

## 4. 身份、授权和类型收窄

### 4.1 InvocationRecord 是一次调用的服务端身份快照

InvocationRegistry.create 不接受 callbackToken 由外部传入，而是自己 randomUUID 两次生成 invocationId 和 callbackToken；随后将 record 写 backend。packages/api/src/domains/cats/services/agents/invocation/InvocationRegistry.ts:100-127。record 的关键字段包括：

    invocationId, callbackToken, userId, catId, threadId,
    parentInvocationId?, a2aTriggerMessageId?, traceContext?,
    clientMessageIds: Set<string>, createdAt, expiresAt

[源码确认] 定义在 InvocationRegistry.ts:20-39。Set<string> 是 invocation 内的 idempotency key 集合。与普通数组相比，Set 的成员判定语义更合适且重复 add 不会制造多条；真正的并发原子性取决于 backend 的 claimClientMessageId，而不能只因接口写 Set 就假设跨 Redis/多进程原子。[源码确认] facade 调 backend 的位置在同文件 153-159；backend 具体实现需要单独检查。

DEFAULT_TTL_MS 当前是两小时。需要谨慎表述：这是 registry 默认值，不是所有 deployment 永远两小时，因为 constructor 可传 ttlMs，而且 backend 也影响实际过期表现。packages/api/src/domains/cats/services/agents/invocation/InvocationRegistry.ts:38-39、91-94。[源码确认]

### 4.2 CallbackPrincipal：同一 API 路由为何要分两条身份路径

共享类型是判别联合：

    export type CallbackPrincipal =
      | {
          kind: 'invocation';
          invocationId: string;
          threadId: string;
          userId: string;
          catId: CatId;
        }
      | {
          kind: 'agent_key';
          agentKeyId: string;
          userId: string;
          catId: CatId;
          scope: 'user-bound';
        };

packages/shared/src/types/callback-principal.ts:3-18。[源码确认]

union type 的含义是变量可能是这两种对象之一，不是同时拥有全部字段。kind 是 discriminant；写 if (principal.kind === 'agent_key') 之后，TypeScript 就知道没有 threadId、但有 agentKeyId/scope。若跳过这一层收窄直接访问 principal.threadId，类型检查应阻止，运行时对 agent key 则会得到 undefined，可能形成默认 thread 越权。

derivePrincipal 使用 'agentKeyId' in record 这个类型守卫来判断 Record 属于 AgentKeyRecord 还是 InvocationRecord。packages/api/src/routes/callback-scope-helpers.ts:79-97。in 运算符在 JavaScript 中检查属性是否存在，在 TypeScript 中也可缩窄联合。采用它的原因是这两个 record 没有显式共同 kind 字段，而 agentKeyId 是稳定的区分属性。若未来 InvocationRecord 也增加同名字段，该守卫会失效；那时应改成显式 discriminator。

### 4.3 preHandler 的运行时顺序

registerCallbackAuthHook 给 Fastify request 动态 decoration callbackAuth/callbackPrincipal，然后添加 app-level preHandler。packages/api/src/routes/callback-auth-prehandler.ts:69-80。[源码确认] 对案例的 invocation header 请求，顺序是：

1. 如果 refresh route 已经填 request.callbackAuth，早返回，避免 double slide；
2. 从 x-invocation-id 与 x-callback-token 拿第一项 header；
3. 当两个 header 都没有时，才尝试 legacy body/query；
4. 若没有 invocation pair，才考虑 x-agent-key-secret；
5. 若只拿到 invocation pair 的一半，立即记 missing_creds 并 401；
6. 在 verify 前可选 peekRecord，供 401 系统通知保留 thread metadata；
7. await registry.verify；失败则 telemetry、可选 notifier、401；
8. 成功后写 request.callbackAuth 和 request.callbackPrincipal。

源码在 packages/api/src/routes/callback-auth-prehandler.ts:80-168。这里“没有任何凭证就 return”并不代表 callback endpoint 自动公开：它是给同一个 Fastify instance 中浏览器面板等非 callback 路径留下空间。具体 callback 路由仍必须 requireCallbackAuth 或 requireCallbackPrincipal。若某新 route 忘了 require，preHandler 的 no-op 分支确实会成为风险；这是代码结构的审计点，而不是可宣称“全局 hook 已经保证所有路由安全”。[源码确认]

### 4.4 认证成功之后仍要授权：线程 scope

resolvePrincipalThread 的 agent_key 分支要求明确 threadId、要求 threadStore、读取目标 thread，再以 canAccessScopedThread 校验 userId。失败分别是 400、503、403；invocation 分支则转给 resolveScopedThreadId。packages/api/src/routes/callback-scope-helpers.ts:99-131。[源码确认]

在本案例中 principal.kind 是 invocation，且没传 threadId，所以 resolveScopedThreadId 直接返回 actor.threadId。它没有因此授权任意 thread。若传了不同 threadId，才会读 threadStore 并确认 thread 属于同 user 或符合系统 thread 的可见条件。packages/api/src/routes/callback-scope-helpers.ts:46-77，133-146。[源码确认]

这说明认证(authentication)与授权(authorization)的面试答案必须分开：

- 认证回答 “I-A 与 K-A 是否匹配，是否未过期”；失败是 401；
- 授权回答 “I-A/U-1 是否允许作用于请求的 thread”；失败通常是 403；
- schema 回答 “body 是否形状正确”；失败是 400；
- 依赖缺失回答 “无法检查所需 store”；失败可为 503。

把这四类都说成“token 无效”会掩盖实际的安全层次，也会导致错误重试策略。

### 4.5 agent key 的生命周期与限制

AgentKeyRegistry.issue 使用 randomBytes(32) 生成 secret，randomBytes(16) 生成 salt，持久化的是 sha256(secret + salt)，并返回一次性可交付的明文 secret。packages/api/src/domains/cats/services/agents/agent-key/AgentKeyRegistry.ts:20-46。[源码确认] 这意味着存储记录含 secretHash/salt，而不是可直接恢复的 secret；但仍需保护 hash 与 salt，因为离线猜测风险取决于 secret 熵。

默认 TTL 是 45 天、rotation grace 是 24 小时。rotate 会验证旧 key 未 revoked、未到 expiresAt、未处于已有 grace，然后先写 old graceUntil 再 issue 新 key。packages/api/src/domains/cats/services/agents/agent-key/AgentKeyRegistry.ts:6-18、56-71。[源码确认] 不能从这个 facade 单独断言 Redis backend 如何处理 grace 到期；那需要继续查 IAgentKeyBackend 实现，故该细节为 [仍需验证]。

## 5. 正常路径：案例如何从 HTTP 到消息、事件和消费者

### 5.1 API post-message 的第一分支：agent_key 或 invocation

route 从 requireCallbackPrincipal 开始。若是 agent_key，它走 packages/api/src/routes/callbacks.ts:845-1185；案例是 invocation，所以经过这一分支后进入 request.callbackAuth! 和 deriveCallbackActor，位置在 1187-1189。感叹号是 non-null assertion，只影响 TypeScript 编译；作者依赖前面的 requireCallbackPrincipal 和 preHandler 逻辑保证 invocation 分支时 callbackAuth 存在。若路由未来允许一种“只有 principal、没有 callbackAuth”的新身份而没有同步改这里，! 会掩盖编译期问题，运行时访问可能崩。

deriveCallbackActor 从 record 提取 invocationId、threadId、userId、catId，同时条件保留 parentInvocationId。effectiveInvocationId 返回 parentInvocationId ?? invocationId。packages/api/src/routes/callback-scope-helpers.ts:15-33。[源码确认] 案例没有 parent 时用 I-A；若由 A2A 父调度派生子 invocation，则存储/广播可沿用外层 id，以保持前端 (catId, invocationId) 去重契约。

### 5.2 路由 body 校验、stale guard 和跨 thread 防御

postMessageSchema 使用 Zod：

    const postMessageSchema = z.object({
      content: z.string().min(1).max(50000),
      threadId: z.string().min(1).optional(),
      replyTo: z.string().optional(),
      clientMessageId: z.string().min(1).max(200).optional(),
      targetCats: z.array(z.string().min(1)).optional(),
      effectClass: z.enum(['fyi', 'coordinate', 'investigate', 'assign_work']).optional(),
      acknowledgeHeld: z.boolean().optional()
    });

packages/api/src/routes/callbacks.ts:575-585。[源码确认] safeParse 返回成功/失败联合，而不是 throw；所以 route 可在失败时 reply.status(400) 并返回 issues。对网络接口，safeParse 将预期的输入错误转成稳定 400，比 catch 所有异常再猜类型更清晰。

随后案例会执行：

    if (!(await registry.isLatest(invocationId))) {
      return { status: 'stale_ignored', replyTo, clientMessageId };
    }

packages/api/src/routes/callbacks.ts:1211-1216。[源码确认] await 很关键：isLatest 可能调用异步 backend，必须等到结果出来再决定写不写。返回 200 风格 body 而非 409/401 的取舍，是阻止正在退出的旧 CLI 因认为“可重试 HTTP 失败”而形成 retry storm；MCP handler 又会识别 body 并明确告诉模型未投递。这是业务级取消/抢占语义，而非网络失败。

若真传不同 threadId，路由会先 resolveScopedThreadId。再往下，跨 thread 还必须包含可路由的 line-start @mention 或 targetCats；否则返回 400 cross_post_no_routing，且这个检查在 claimClientMessageId 之前。packages/api/src/routes/callbacks.ts:1218-1269。[源码确认] 顺序是安全与可恢复性共同决定的：若先占幂等键，第一次错误请求消耗 key，修正参数后重试同 key 会被错误当 duplicate。

### 5.3 新鲜度 gate：不是取消，也不是鉴权失败

案例在所有明确 validation 后，可能进入 checkFreshnessForPostMessage。它依据独立 seen cursor 判断猫是否有尚未读取的新消息；若 held，直接返回：

    {
      status: 'held',
      reason: 'newer_messages_available',
      unseenCount,
      previews,
      omittedCount,
      actions: ['read_latest', 'revise', 'send_with_acknowledge']
    }

packages/api/src/routes/callbacks.ts:1381-1475。[源码确认] 这条分支的真实问题是防止猫在读到旧上下文时继续写出已经不合时宜的行动，而不是限制权限。它放在 scope、cross-post 以及 assign_work 检查之后，确保错误输入仍得到相应 400/403，而不是被一个 held 伪装。

try/catch 覆盖的新鲜度检查失败会 log.warn 后继续发送，是显式 fail-open。这里选择 fail-open 只适合“注意力提示”增强层：cursor store 出故障不应让基础协作消息完全不可用。若把同样策略用于 requireCallbackAuth 或 thread scope，会产生未认证写入，安全上不可接受。try/catch 的含义是捕获 await 中 reject 或同步 throw；finally 在此处没有使用，因为没有只在本函数范围内需释放的资源。

### 5.4 第一层幂等：clientMessageId

gate 放行后，route 调 registry.claimClientMessageId：

    if (clientMessageId) {
      const isFirstSeen = await registry.claimClientMessageId(
        invocationId,
        clientMessageId
      );
      if (!isFirstSeen) {
        return { status: 'duplicate', replyTo, clientMessageId };
      }
    }

packages/api/src/routes/callbacks.ts:1478-1484。[源码确认] 这处理“同一次 invocation、同一客户端请求键”重复到达。根因是 postJsonWithRetry 遇到网络错误无法辨别请求是否已经到达：客户端重发是正确策略，但服务端必须识别同 key。

不要把它夸大为全局 exactly-once。key 范围依附 invocation；不同 invocation 或不同随机 key 的相同内容仍可能到达，因此路由还设计了第二层内容指纹去重。也不要声称 Map/Set 本身足以应对并发：只有 backend 的 claim 操作若是原子的，两个请求才不会都看到“未出现”。API 的测试专门覆盖并发 byte-identical post 的原子去重，见 packages/api/test/callback-routes.test.js:313-357。[测试确认]

### 5.5 富块、mentions 和 Set 去重

route 用 extractRichFromText 拆出 cleanText 和 blocks，再取 buffer 里的 rich blocks，必要时异步合成 voice block。packages/api/src/routes/callbacks.ts:1486-1503。voice 合成的 catch 只日志不阻断主消息，因此文本仍可落库；这是一条局部降级，不能被解释为音频一定成功。

随后 analyzeA2AMentions 从存储文本解析行首 @mention，显式 targetCats 逐个 resolveCatTarget，并用：

    const mergedTargets = new Set<CatId>([
      ...contentTargets,
      ...validExplicitTargets
    ]);

packages/api/src/routes/callbacks.ts:1507-1529。[源码确认] spread ... 把数组元素展开到新数组；Set 立即去重。采用 Set 是因为同一只猫既被文本 @ 到又在 targetCats 中出现，业务上只应触发一次。若改成 concat 而不去重，下面 A2A enqueue 可能收到重复目标，导致重复调用或至少无效工作。

可选的 response 还会附 routing_warnings。target 不存在/disabled 不一定阻断已经能投递的主消息；若所有显式目标失败且文本未解析出目标，代码返回带 isError 的路由失败信封，但在 agent-key 分支可见主消息可能已写入。packages/api/src/routes/callbacks.ts:1153-1184。面试时需说明“消息写入”和“目标猫被成功唤醒”是两个结果字段，不能只看 isError。

### 5.6 第二层幂等：内容指纹原子 claim

findRecentExactCallbackDuplicate 是从近期消息倒序扫描、逐项比较 thread/user/cat/content/richBlocks/replyTo/mentionsUser/mentions。它是有用的快路径，却有 check-then-act race：两个并发请求都在 append 前扫描，不会看到对方。于是 claimCallbackContentOrDuplicate 生成 SHA-256 fingerprint 并调用 messageStore.claimContentDedupKey：

    const claimed = await messageStore.claimContentDedupKey(
      fingerprint,
      CALLBACK_EXACT_DUPLICATE_WINDOW_MS
    );
    if (claimed) return null;
    return { status: 'duplicate', threadId, ... };

packages/api/src/routes/callbacks.ts:332-425、1756-1771。[源码确认]

createHash('sha256').update(parts).digest('hex') 不是为了加密保密 content，而是把可能很长的多个比较维度变成固定长度 key。parts 用 NUL 分隔，减少简单字符串拼接歧义。这里的核心依赖是 store 的 claim 原子性；若实现只是 get 后 set，并发 race 仍在。当前测试名称直接声明 “does not double-store byte-identical concurrent posts (atomic dedup)”，见 packages/api/test/callback-routes.test.js:313-357，[测试确认]；但具体 Redis/memory 原子实现仍应在存储适配器复查。

### 5.7 持久化、队列和流式事件

case 正常通过两层去重后，messageStore.append 接收：

    {
      userId: actor.userId,
      catId: actor.catId,
      content: storedContent,
      mentions,
      origin: 'callback',
      timestamp: now,
      threadId: effectiveThreadId,
      extra: persistedExtra,
      replyTo?,
      deliveryStatus: willEnqueueToQueue ? 'queued' : undefined
    }

packages/api/src/routes/callbacks.ts:1772-1784。[源码确认] persistedExtra 在前面组合了 isExplicitPost、rich、crossPost、targetCats 等；它是跨后端/前端的结构化补充，而不是只有展示用途。

之后调用 MessageDeliveryService.resolveCallbackDeliveryDecision。若需要 A2A，enqueueA2ATargets 的输入含 targetCats、content、userId、threadId、triggerMessage、callerCatId、parentInvocationId、traceContext。packages/api/src/routes/callbacks.ts:1789-1823。[源码确认] 因而 MessageStore 是消息事实来源；A2A 队列是后续工作调度；SocketManager 是实时呈现通道。这三者不是互相替代的“消息系统”。

只有 deliveryDecision.shouldBroadcastNow 为真，才 broadcastAgentMessage。对于 queued 消息，注释说明会在 QueueProcessor 交付后经 messages_delivered 广播。packages/api/src/routes/callbacks.ts:1825-1827。[源码确认] 流式输出的本质是事件监听者从 socket room 收到增量，而 route 本身仍以一个 HTTP response 结束；不能把 WebSocket 广播误说为 HTTP handler 的返回值。

## 6. 正常成功路径复盘

以下按案例逐跳复述，是面试中最稳的 90 秒版本。

1. 调度侧调用 InvocationRegistry.create(U-1, A, T-42)，registry 自己生成 I-A/K-A，并让调用方把这两项作为子进程环境变量。默认 TTL 为 2h，但 constructor 可覆盖。packages/api/src/domains/cats/services/agents/invocation/InvocationRegistry.ts:100-127。

2. MCP entry 的 main 连接 stdio 后启动 refresh loop；registerTools 在启动时已把 cat_cafe_post_message 的 Zod shape 注册给 SDK。packages/mcp-server/src/index.ts:32-45；packages/mcp-server/src/server-toolsets.ts:516-560。

3. 模型调用工具。SDK 做 schema 形状验证；handler 的 handlePostMessage 发现是 invocation env，要求省略 threadId。案例符合，进入 _executePostMessage。packages/mcp-server/src/tools/callback-tools.ts:710-727。

4. _executePostMessage 保留传入 clientMessageId；若没有才生成 UUID。它调用 withDegradation，但 post_message policy 为 none，主调用为 callbackPost(... enableOutbox: true)。packages/mcp-server/src/tools/callback-tools.ts:587-618。

5. callbackPost 从环境构造 config；buildAuthHeaders 选择 x-invocation-id/x-callback-token。sendCallbackRequest 先尝试 flush 旧 outbox，再调用 postJsonWithRetry。packages/mcp-server/src/tools/callback-tools.ts:175-205；packages/mcp-server/src/tools/callback-outbox.ts:172-184。

6. Fastify preHandler 从两个 header 取凭证，await registry.verify，成功将 InvocationRecord 和 invocation-kind CallbackPrincipal 放入 request。packages/api/src/routes/callback-auth-prehandler.ts:87-168。

7. post-message route safeParse body，registry.isLatest(I-A) 为 true，默认 effectiveThreadId=T-42。通过 freshness gate，claim clientMessageId 得到 first seen。packages/api/src/routes/callbacks.ts:1190-1216、1478-1484。

8. route 解析 @cat-b，合并显式目标并使用 Set 去重。近期扫描未命中，原子内容指纹 claim 成功；MessageStore.append 写 origin=callback 的记录。packages/api/src/routes/callbacks.ts:1507-1529、1756-1784。

9. 如 A2A queue 可用且存在 mentions，delivery service 将消息交给 enqueueA2ATargets，并在合适时再广播；否则 SocketManager 立刻向 thread:T-42 广播 text，富块另发 system_info 事件。packages/api/src/routes/callbacks.ts:1789-1827。

10. API JSON 成功响应穿回 postJsonWithRetry -> sendCallbackRequest -> callbackPost；callbackPost 将 data JSON.stringify 放入 MCP ToolResult text。模型得到的是工具结果，不是直接操作数据库对象。packages/mcp-server/src/tools/callback-retry.ts:100-102；packages/mcp-server/src/tools/callback-tools.ts:205。

这个复盘中，所有异步边界都必须 await：registry/store/HTTP/queue 都可能是 Promise。遗漏一个 await 的后果不只是“顺序不对”，还可能让 handler 提前把成功回应给模型，实际写入后来失败，构成错误成功。

## 7. 异常路径：超时、取消、重试、过期与崩溃

### 7.1 网络超时：AbortSignal 解决的是“永远等不到”，不是撤销服务端写入

postJsonWithRetry 的每一轮 fetch 都带：

    signal: AbortSignal.timeout(fetchTimeoutMs)

默认 timeout 是 10_000ms。packages/mcp-server/src/tools/callback-retry.ts:5-15、78-123。[源码确认] AbortSignal.timeout 会创建一个到期自动 abort 的 signal；fetch 接到 signal 后会 reject，使 catch 分支有机会继续 retry，而不是永远挂在半开的 TCP 连接上。

这并不等价于“请求绝对没有到达服务端”。时间线可能是：

    客户端发送 body
    -> API 已经 append 成功
    -> 响应包丢失或连接卡住
    -> 10s 后客户端 abort
    -> 客户端重试同一个 clientMessageId
    -> API 返回 duplicate

因此 AbortController/AbortSignal 是客户端等待上限和资源释放机制，不是分布式事务的回滚按钮。案例依靠 clientMessageId 与内容 fingerprint，把“客户端不知道是否完成”的重试变成业务幂等。若每个重试都生成随机 key，就会把这个保护破坏掉。

若要让外部用户取消一条正在执行的 MCP 工具，还需要上层把用户取消信号传播到 fetch、子进程和队列。当前 callback-retry.ts 只使用每次 attempt 的时间上限，没有接收调用者传入的 AbortSignal，也没有出现 Promise.race。故“用户点击取消会立即取消正在进行的 callback HTTP 请求”不能从本段源码确认，标为 [仍需验证]。项目中存在 invocation cancel 相关测试文件 packages/api/test/infrastructure/socket-cancel-invocation.test.js，但是否覆盖这条 MCP HTTP 链需要分别检查。

### 7.2 重试循环：次数、状态码和异常的含义

核心循环是：

    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      try {
        const response = await fetch(...);
        if (response.ok) return { ok: true, data: await response.json() };

        retryable = shouldRetryStatus(response.status);
        if (!retryable || attempt >= retryDelaysMs.length) {
          return { ok: false, failure: { error: lastError, retryable } };
        }
      } catch (err) {
        retryable = true;
        if (attempt >= retryDelaysMs.length) {
          return { ok: false, failure: { error: lastError, retryable } };
        }
      }
      await sleep(retryDelaysMs[attempt]!);
    }

packages/mcp-server/src/tools/callback-retry.ts:78-126。[源码确认]

默认 retryDelaysMs 是 [1000, 2000, 4000]，所以会尝试 0、1、2、3 共四次，不是“三次”。shouldRetryStatus 只认可 408、429、所有大于等于 500 的状态；400、401、403、404 立即停止。packages/mcp-server/src/tools/callback-retry.ts:5、44-46。[源码确认]

这里的 Promise 是 sleep 的契约。sleep 返回 new Promise(resolve => setTimeout(resolve, ms))；await 它会让 async 函数暂停而不阻塞整个 Node 事件循环。若用忙等 while(Date.now() < deadline)，子进程的 stdio、timer 和其他 Promise 都会被阻塞。非空断言 retryDelaysMs[attempt]! 告诉 TypeScript “循环边界保证数组元素存在”；如果以后修改循环为 < 或数组可被并发改写，该断言不会提供运行时保护。

网络异常 catch 的 retryable=true 包括 AbortError、DNS 失败、连接重置以及 fetch 自身 throw。它是策略选择：这些错误通常无法证明服务端没有收到请求，故应重试，但必须同 key。HTTP 401 则解析出 [reason=X] 并失败返回，交给鉴权/降级逻辑，不做无意义的三次重发。extractReasonTag 会 JSON.parse 401 body，验证 error 字段和 reason 类型后加标签；parse 失败仅返回空字符串。packages/mcp-server/src/tools/callback-retry.ts:48-71、104-120。[源码确认]

### 7.3 取消、过期和 stale 不是一类错误

| 场景 | 观察点 | 服务端结果 | MCP/调用方应做什么 |
| --- | --- | --- | --- |
| 单次网络挂住 | AbortSignal.timeout | fetch reject，可能重试 | 保持 clientMessageId，等待 retry/outbox |
| token TTL 已过 | registry.verify | 401 reason=expired | 恢复身份或使用明确的降级路径，不能盲重试 |
| token 不匹配 | registry.verify | 401 invalid_token | 视为配置/安全错误，停止重试 |
| registry 重启/记录无 | registry.verify | 401 unknown_invocation | 可提示恢复；某些工具可做自定义降级 |
| 新 invocation 抢占旧 slot | registry.isLatest | 200 stale_ignored | 不写入，老调用停止声称成功 |
| 新鲜度 gate 拦截 | checkFreshness | 200 held | 先读取再决定是否 acknowledgeHeld |
| 用户取消上层 invocation | 不在 callback-retry 参数中 | 不能由此文件确认 | 需要确认上层 cancel propagation |

stale_ignored 很容易被误说成“token 过期”。实际它的 token 可能仍有效，preHandler 已经认证成功；只是当前 (threadId, catId) 绑定的最新 invocation 不是自己。将它返回 200 是防旧进程 retry；客户端 handler 进一步把它包装成错误，是为了防模型把“HTTP 成功”误解成“消息已投递”。packages/api/src/routes/callbacks.ts:1211-1216；packages/mcp-server/src/tools/callback-tools.ts:620-631。[源码确认]

### 7.4 outbox：落盘位置、队列排序和 claim

sendCallbackRequest 只有当调用方 enableOutbox=true 且环境开关允许时，才先 flushOutbox，再主请求。post_message 的 _executePostMessage 显式传 enableOutbox: true；因此本文案例进入 outbox，不能推广到所有工具。packages/mcp-server/src/tools/callback-tools.ts:601-617；packages/mcp-server/src/tools/callback-outbox.ts:172-207。[源码确认]

默认文件目录是 homedir()/.cat-cafe/callback-outbox，可由 CAT_CAFE_CALLBACK_OUTBOX_DIR 覆盖；默认开关值 true，只有 0/false/off 关闭。packages/mcp-server/src/tools/callback-outbox.ts:40-60。[源码确认] Entry 是 JSON：

    {
      id, queuedAt, apiUrl, path, body,
      headers?, attempts, lastError
    }

文件名为 queuedAt-id.json。按字符串 sort 后的时间戳前缀近似 FIFO；同一毫秒多个 UUID 的次序不是严格业务顺序，且跨文件系统/时钟变化也不应宣称全局 FIFO，因此只能说“本目录内按文件名排序处理”。[源码确认] 定义和排序在 callback-outbox.ts:16-32、94-117。

flush 的并发互斥不是进程内 Mutex，而是 rename：

    const processingPath = originalPath + '.processing';
    try {
      await rename(originalPath, processingPath);
    } catch {
      continue;
    }

两个 flush 同时看到同一个 .json，只有一个能成功把原文件改名为 .processing；另一个失败后跳过。随后代码只枚举 endsWith('.json') 且排除 .processing 的名字，因此不会再次 claim。packages/mcp-server/src/tools/callback-outbox.ts:114-127。[源码确认]

注意 atomic rename 的可靠性假设受同一文件系统约束。这里源/目标都在同一个目录，只是添加后缀，符合通常原子 rename 的使用方式；但项目没有在代码中显式处理跨进程崩溃遗留 .processing 文件的启动恢复。catch 只会在本轮异常中 best-effort rename 回原名。若进程在 rename 后被 kill，遗留条目如何扫描回收，当前这段没有实现，故为 [仍需验证]。

### 7.5 outbox replay 的失败分支

processing 文件读出后先 parseOutboxEntry。类型缺失、body=null、JSON 损坏、attempts 已达上限都会 unlink processing 文件。packages/mcp-server/src/tools/callback-outbox.ts:63-81、129-135。[源码确认] 这意味着坏文件不会卡住整个 batch，但也意味着坏条目被删除而非保留死信队列。是否有单独监控/备份这类删除，当前文件不能证明，故为 [仍需验证]。

replay 成功 unlink；不可重试或达到上限也 unlink；可重试则 attempts+1、lastError 更新到 processing 文件，再 rename 回原文件。packages/mcp-server/src/tools/callback-outbox.ts:137-168。[源码确认] lastError 是运维诊断字段，而不是给 API 的状态。

旧版 body 内 invocationId/callbackToken 的兼容值得注意。legacyHeadersFromBody 只在 entry.headers 不存在时读取两个 body 字段并迁移为 header；新请求不会写 body credentials。packages/mcp-server/src/tools/callback-outbox.ts:84-92、137-145。它说明 outbox 文件可能含 bearer-like 凭证 header，目录权限和本机用户隔离是实际安全边界；代码本段没有设置 outbox 文件 chmod，不能说它具有专门的秘密文件权限保护。[源码确认/仍需验证]

### 7.6 认证失败、系统通知和可观测性

preHandler 认证失败会 recordCallbackAuthFailure；若注册了 notifier 且 pre-verify peekRecord 得到快照，则尝试 notify。notify 自己异常只 log.warn，原本 401 仍照常返回。packages/api/src/routes/callback-auth-prehandler.ts:124-155。[源码确认] 这是一种“观测/提示失败不得改变鉴权决定”的设计。

notifier 只 surface expired 与 invalid_token，跳过 stale/unknown/missing；refresh-token 等 background heartbeat 也跳过线程卡片。它先 prune，再做 early return，然后以 reason:tool:catId:threadId:userId 作为 Map key，5 分钟去重、24 小时 hide。packages/api/src/routes/callback-auth-system-message.ts:55-76、120-202。[源码确认]

并发控制的关键是 await 前的 Map reservation：

    this.dedup.set(key, { lastSentAt: now });
    try {
      stored = await this.messageStore.append(...);
    } catch (err) {
      const current = this.dedup.get(key);
      if (current && current.lastSentAt === now &&
          current.hiddenAt === undefined) {
        this.dedup.delete(key);
      }
      throw err;
    }

packages/api/src/routes/callback-auth-system-message.ts:198-229。[源码确认] Map 是进程内 key-value 容器，不是跨实例分布式锁；它解决同一 API 进程内两个并发 notify 都通过检查的问题。写入失败时有条件回滚，避免五分钟内所有重试被吞；条件判断避免误删后来并发者更新的 key。若把 set 放到 await append 之后，两条 401 同时到达时都能通过检查，形成重复 rich card。

recordCallbackAuthFailure 维护累计计数、最多 100 条 recent sample、24 个小时 bucket，并写 OTel counter。packages/api/src/routes/callback-auth-telemetry.ts:22-24、103-111。[源码确认] 模块级变量和 Map/数组的内存状态在多进程、多实例下不是共享的；是否有外部指标聚合由 OTel exporter 决定，当前本地模块无法证明，标为 [仍需验证]。

### 7.7 refresh-token：为什么不用 callbackPost 重试

refresh loop 的 performRefreshTick 使用裸 fetch，一次请求，10 秒 AbortSignal.timeout；HTTP 非 2xx、畸形 JSON、throw 都返回 ok:false 和 FALLBACK_DELAY_MS。packages/mcp-server/src/refresh-loop.ts:80-118。[源码确认] 它没有复用 callbackPost，是有意避免 429 后再在秒级进行 1/2/4 秒重试，因为服务端 cooldown 是 5 分钟。

服务端 refresh route 在 preValidation 中执行：

    creds = extractCallbackCredentials(request)
    -> registry.peek(id, token)
    -> registry.tryClaimRefreshCooldown(id, 5min)
    -> registry.verifyLatest(id, token)
    -> request.callbackAuth = result.record

随后全局 preHandler 看到 callbackAuth 已存在便 early-return，route handler re-fetch record 得 expiresAt/ttlRemainingMs。packages/api/src/routes/callbacks.ts:3274-3374；packages/api/src/routes/callback-auth-prehandler.ts:80-85。[源码确认]

这里没有 Promise.race，而采用 request lifecycle hook + backend 原子 verifyLatest。Promise.race 常用于“两个 Promise 谁先完成就采用谁”，例如 fetch 与手工 timeout promise 竞争；它若没有清理 loser timer/请求，会产生泄漏或幽灵操作。AbortSignal.timeout 直接将取消信号交给 fetch，语义更适合单请求 timeout。verifyLatest 则解决两个服务端步骤间竞态，不能由 Promise.race 替代。

computeNextRefreshDelay 先 ttlRemainingMs/4，再 clamp 到约 6.18 分钟到 30 分钟，再乘 [0.85, 1.15] jitter。packages/mcp-server/src/refresh-loop.ts:28-45。6.18 分钟不是业务 TTL，它是为“最小 jitter 后仍大于 5 分钟 server cooldown”计算的下界。测试反复采样验证 2h、10min、4h 输入的范围，见 packages/mcp-server/test/refresh-loop.test.js:16-52。[测试确认]

## 8. 并发、资源清理与一致性

### 8.1 这条链里有哪些“队列”和“工作列表”

不能把所有数组叫队列。实际至少有：

| 数据结构/机制 | 所在层 | 顺序/原子性 | 解决的问题 |
| --- | --- | --- | --- |
| retryDelaysMs 数组 | MCP client | for 循环按 index | 有界的重试等待计划 |
| outbox .json 文件列表 | MCP client 文件系统 | sort 后逐个 rename claim | 跨工具调用的可重放工作列表 |
| clientMessageIds / claim key | registry/store | backend 决定原子性 | 重试去重 |
| content dedup fingerprint | MessageStore | claim 操作应原子 | 并发同内容去重 |
| A2A InvocationQueue | API | 由队列实现决定 | @mention 触发后续猫工作 |
| notifier Map | API process | 单进程同步检查/写入 | 401 rich notice 防刷屏 |
| freshnessNoticeState | MCP process | module 级计数 | 每 5 次只读工具最多附加 3 个 notice |

freshnessNoticeState 是 { toolCallCount, noticeDeliveredCount, lastNoticeToolCallNum } 普通对象，不是持久化状态。maybeFreshnessNotice 每次工具回调增加计数；只对 annotation.readOnlyHint 的成功工具在阈值到达时 callbackPost API。packages/mcp-server/src/server-toolsets.ts:472-514。[源码确认] 这意味着它是每个 MCP 进程状态而非用户/线程的全局计数；如果一个进程服务多个 invocation，隔离风险需要结合启动模型确认，当前入口注释倾向每个进程对应一个 invocation，但不能据此证明所有部署如此，故为 [合理推断]。

### 8.2 并发写入时的四个关键时序

时序一：两个相同 post 同时抵达。

    R1 scan -> 未见重复
    R2 scan -> 未见重复
    R1 claimContentDedupKey -> true
    R2 claimContentDedupKey -> false
    R1 append
    R2 return duplicate

这正是内容 hash claim 不可省略的原因。recent scan 单独无法跨越 R1/R2 的 await 间隙。packages/api/src/routes/callbacks.ts:370-425。

时序二：第一次 post 成功写入但响应丢失。

    client attempt 0 -> API append -> response lost
    client timeout -> attempt 1
    API claimClientMessageId -> false
    API returns duplicate

若 call site 提供稳定 clientMessageId，业务安全；若缺少且整个工具重新执行，MCP 才会在每次 handler 调用生成随机 UUID，因此不保证跨“新的工具调用”去重。

时序三：旧 invocation 与新 invocation 交错。

    old preHandler verify -> ok
    new invocation create -> latest pointer 改为 new
    old route isLatest -> false
    old returns stale_ignored，不 append

这不是原子 verify+isLatest 的统一事务，post-message 的 verify 和 isLatest 之间仍存在时间段；代码通过写前 isLatest 保护主要竞态。是否存在“old 在 isLatest 后、新创建前、old append”窗口，需要查 backend 和更上层调度串行化才能下结论，故为 [仍需验证]。refresh-token 专门使用 verifyLatest 明确关闭这种 race，说明作者已意识到这个问题；不能自动把该保证扩展到所有 route。

时序四：proposal 已创建但卡片 marker 失败。

    reserveDedup -> create proposal -> append card 成功
    -> setCardMessageId 失败
    -> route 返回 warning
    -> 同 clientRequestId 重试
    -> 扫 source thread 的 rich block id
    -> 找到卡片，回填 marker，再作 deduped success

这体现一致性并非只靠事务。message card 已经是用户可见事实，marker 失败时不应回滚 proposal 和卡片，否则可能出现“用户看见卡却无法审批”的更坏状态；代码改为 warning 加自愈扫描。profile update、thread、handoff 三类 proposal 都有类似恢复策略。packages/api/src/routes/callback-propose-profile-update-routes.ts:36-49、141-175；packages/api/src/routes/callback-propose-session-handoff-routes.ts:57-119、152-209。[源码确认]

### 8.3 proposal 与直接执行：贯穿案例的高风险对照分支

案例中的 post_message 是协作通信，可以经过业务校验后写消息。若猫希望更新自身 relationship primer，则不能把 afterContent 直接写文件。POST /api/callbacks/propose-profile-update 的 route 只创建 pending ProfileUpdateProposal 和一条带 rich confirmation card 的消息；文件真正写入在用户认证的 approve/reject companion route，源码注释明确说明这一边界。packages/api/src/routes/callback-propose-profile-update-routes.ts:2-15。[源码确认]

route 的运行顺序是：

1. requireCallbackAuth，确保它必须是 invocation 身份；
2. proposeSchema.safeParse，afterContent/rationale/signalKind 等满足限制；
3. registry.isLatest，旧 invocation 返回 stale_ignored；
4. 用 clientRequestId 查 visible dedup 快路径；
5. 从 authenticated record.catId 推导 relationship/{catId}-primer.md；
6. resolvePrimerPath 校验路径，读 beforeContent，hashContent 得 baseContentHash；
7. reserveDedup 在 create 前抢占 proposalId；
8. proposalStore.create 写 pending 提议；
9. messageStore.append 确认卡；
10. setCardMessageId 尽力写 marker，失败变 warnings；
11. broadcast connector_message、emitToUser proposal_created。

packages/api/src/routes/callback-propose-profile-update-routes.ts:62-192。[源码确认]

这里的 targetPath 没有来自模型 body，是 join('relationship', catId + '-primer.md') 从认证身份导出。即使模型在 afterContent 里写 ../，它只是文件内容，不是路径。若接受用户 body 的 targetPath，再仅作字符串 startsWith 检查，会出现路径穿越或符号链接逃逸风险。

### 8.4 path validator 的真实防御范围

isPathAllowed 先 resolveAbsolutePath，再对允许根进行 realpath；若 target 已存在，对 target realpath；若目标不存在，则 findDeepestExistingPath，realpath 最深已存在祖先，再用 isWithinPath 进行边界比较。packages/mcp-server/src/utils/path-validator.ts:58-89；packages/mcp-server/src/utils/path-utils.ts:20-67。[源码确认]

这一设计解决两个不同问题：

- path.resolve 解决 .、..、相对路径和 ~ 展开后的字面规范化；
- realpath 跟随符号链接，解决允许目录中的 link 指向允许根外；
- “最深已存在祖先”解决新文件本身不存在、不能直接 realpath 的情况。

isWithinPath 不只是 target.startsWith(base)。它去掉尾部分隔符，若 base 不是根则比较 target===base 或 target.startsWith(base + path.sep)。packages/mcp-server/src/utils/path-utils.ts:32-51。[源码确认] 这样 /safe/work2 不会被 /safe/work 误判为内部。若不 realpath，/safe/work/link -> /etc 的 /safe/work/link/passwd 仍会以字符串前缀通过；若不存在目标时直接 return false，合法新建文件也永远不能创建。

这段是本地文件工具的授权机制，不会自动保护 API 的 profileDir 写入。profile route 使用 resolvePrimerPath（另一个模块）而不是调用 isPathAllowed；应分别审计，不能笼统说“path-validator 保护所有写文件”。[源码确认]

### 8.5 资源清理清单

| 资源 | 何时获取 | 当前清理策略 | 若漏掉的后果 |
| --- | --- | --- | --- |
| fetch attempt | postJsonWithRetry | AbortSignal.timeout 终止本次等待 | socket 挂起，工具永不返回 |
| refresh timer | startRefreshLoop | stop 清 timer；SIGTERM/SIGINT 调 stop | 闲置 timer、退出语义不清 |
| outbox claim | rename 到 .processing | 成功/不可重试 unlink；catch 尝试 rename 回 | 文件可能遗留 processing |
| notifier dedup slot | await append 前 Map.set | append throw 时条件 delete；每 notify prune | 重复卡片或 Map 无限增长 |
| proposal dedup reservation | reserveDedup | create/append 失败 releaseDedup | 未来 retry 永远命中幽灵 reservation |
| proposal record | create 成功 | append card 失败 delete proposal | 无可见入口的幽灵 pending proposal |

finally 在这些文件中没有被广泛使用，不代表没有清理。outbox 用嵌套 try/catch，把 cleanup 放在各具体结果分支；proposal 用 try/catch 内 best-effort delete/release；refresh 用 stop closure。finally 适合无论 return/throw 都必须执行的同一清理动作，例如关闭 file handle；这里每种失败的处理不同，强套 finally 反而容易错误 unlink 成功的重试条目。

## 9. 外部系统交互：Redis、文件、网络、子进程与 NDJSON

### 9.1 Redis：InvocationRegistry 的可替换后端，不是每条 callback 都必然依赖

InvocationRegistry.selectInvocationBackendKind 的规则是：环境值只能是 redis 或 memory；明确 redis 但没有 Redis client 时回退 memory；未设置时 Redis 可用则 redis，否则 memory。packages/api/src/domains/cats/services/agents/invocation/InvocationRegistry.ts:49-62。[源码确认] 因而不能绝对说“callback token 一定存 Redis”；当前源码允许 memory backend，测试也依赖默认 memory。

RedisAuthInvocationBackend 的 verify 调 Lua eval，并根据返回 reason 构造 VerifyResult；成功时还 pexpireat message-id SET 的 TTL，且仅在 latest pointer 仍指向当前 invocationId 时延长该 pointer。packages/api/src/domains/cats/services/agents/invocation/RedisAuthInvocationBackend.ts:287-338。[源码确认] 这类做法解决两个一致性问题：

- record 滑动续期但 dedup Set 不续期，会让长任务旧 clientMessageId 重新被视作 first seen；
- 旧 invocation verify 时若无条件续 latest pointer，可能替新 invocation 延长错误指针。

verifyLatest 在 refresh 路径使用 Lua 同时核对 token、latest 和 TTL slide。packages/api/src/domains/cats/services/agents/invocation/InvocationRegistry.ts:200-207；RedisAuthInvocationBackend.ts:237-284。[源码确认] Lua 为什么有价值：Redis 单命令脚本在服务器端连续执行，避免客户端先 GET、再 SETEX 间被另一个请求修改。注意前置 hmget 只是为了构造 key，注释也说 Lua 会再次原子检查，不能把 hmget 当最终授权判断。

### 9.2 文件系统：三种不同语义，不能混讲

本章涉及的文件操作至少有：

1. initCatCafeDir 用 mkdirSync 建本地工作目录；
2. callback outbox 用 mkdir/writeFile/readFile/rename/unlink 保存重放请求；
3. agent key sidecar 用 readFileSync 读取密钥；
4. profile proposal 用 readFileSync 读取 primer 的 beforeContent。

它们的故障策略不同。outbox 写失败会返回 false，让 callback 最终返回原网络失败；profile 卡片 append 失败会删 proposal 并 rethrow；sidecar 读失败返回 undefined，最终 getCallbackConfig fail closed。把所有 filesystem error 都 catch 并返回空字符串是最危险的写法，会把安全配置丢失伪装为正常业务状态。

文件系统 API 多是 Promise 版本，outbox 用 await 保证 rename 成功后才读取 processing 文件。若没有 await rename，两个 flusher 后续都可能读取原文件；若未 catch read/parse 失败，一条坏 JSON 会中断整个 batch。packages/mcp-server/src/tools/callback-outbox.ts:94-168。[源码确认]

### 9.3 网络：HTTP body、headers、状态码与 NDJSON

callbackPost 的认证凭证放 headers，而不是 body/query。packages/mcp-server/src/tools/callback-tools.ts:136-153、175-205。[源码确认] Header 不是“更安全的加密通道”，TLS 是否启用由 apiUrl 部署决定；它的直接好处是认证元数据与业务 body 分离，也让 API 的 extractCallbackCredentials 有规范优先级。body/query 仅为兼容旧客户端 fallback，并记录 legacy telemetry。

本章的 MCP stdio JSON-RPC 与 remote Streamable HTTP 是两种 transport。remote-spike 使用 StreamableHTTPServerTransport，并说明输出可能按 SSE 风格分块写入。packages/mcp-server/src/remote-spike.ts:38-40、68-95。[源码确认] 它在 response.write/end 外层逐 chunk redact string、Buffer、Uint8Array、ArrayBuffer view；代码注释承认 secret pattern 跨 chunk 分割可能逃逸，因此不能写成“已完全保证流式脱敏”。[源码确认]

NDJSON 是“每行一个完整 JSON value”的流式文件/网络格式。当前本章核心 callbackPost 发送的是一个 JSON body，outbox 写的是一个 JSON object 文件；从 callback-tools.ts 和 callback-outbox.ts 未看到 NDJSON 写入或读取。因而应明确：本章不能把 remote 的 chunked HTTP/SSE 或 stdio JSON-RPC 说成 NDJSON。[源码确认] 如果别的模块使用 NDJSON，需要在对应章节单独追踪。

### 9.4 子进程：当前文件证实了什么，未证实什么

MCP entry 是 Node 可执行入口，使用 StdioServerTransport，且其注释/设计说明它由客户端进程拉起。packages/mcp-server/src/index.ts:1-54。[源码确认] 从这些文件能确认子进程需要正确继承 CAT_CAFE_API_URL、invocation pair 或 agent key；没有 config 时 refresh loop disabled 且 callback 工具返回 NO_CONFIG_ERROR。

不过“哪个 API 函数以什么 spawn 参数注入 env、父进程如何等待退出”不在 index.ts/refresh-loop.ts 内。InvocationRegistry.create 的注释说调用者应把 credentials 作为 env vars 传给 CLI subprocess，packages/api/src/domains/cats/services/agents/invocation/InvocationRegistry.ts:96-99；具体调用者应继续追 invoke-single-cat.ts。故本章在这里不能凭注释断言完整 spawn/kill 策略，标为 [仍需验证]。

### 9.5 remote-spike 的 fail-closed 边界

remote-spike 的 validateB1aEnv 在 listen 前检查 remote token、desktop mode、readonly、cat/user id、api url，也拒绝任何继承的 invocation env。packages/mcp-server/src/remote-spike.ts:120-173。[源码确认] 后一条直接对应前文 header 优先级：若 remote cloud 服务意外继承 CAT_CAFE_INVOCATION_ID/CAT_CAFE_CALLBACK_TOKEN，buildAuthHeaders 会选择 invocation，且 post_message 携带 threadId 时本地 KD-1 又会拒绝。这不是“多一层冗余配置”，是防止远端实例以错误短期身份写入。

## 10. Proposal 与 Approval Hub：同样是回调，为什么不能直接执行

### 10.1 三类 proposal 共有的可靠骨架

thread proposal、session handoff、profile update 的具体 store/interface 不同，但都可用以下真实步骤理解：

    authenticated invocation
    -> Zod validate
    -> stale guard
    -> clientRequestId fast path
    -> reserveDedup before create
    -> create pending proposal
    -> append user-visible rich card
    -> record card marker (warning/self-heal if marker fails)
    -> socket event for thread and user hub

profile update 的真实顺序见 packages/api/src/routes/callback-propose-profile-update-routes.ts:62-192；handoff 的 fastPathOrReserve、persistAndBroadcastCard 和 route 编排见 packages/api/src/routes/callback-propose-session-handoff-routes.ts:128-209、259-325；thread proposal 注册点和 card broadcast 在 packages/api/src/routes/callback-propose-thread-routes.ts:52-301。[源码确认]

这条骨架的关键并不是“先写 Redis 再写消息”这种死顺序，而是两个可见性不变量：

- 不能让 dedup key 指向根本不存在的 proposal；
- 不能让 pending proposal 没有用户可见、可审批的入口卡片。

因此 create 抛错时 release reservation；append 失败时 delete proposal 再 release；marker 失败时却不删除，因为卡已经在用户视野，之后可扫描卡片自愈。这种局部补偿是没有跨 store 事务时的工程化一致性策略。

### 10.2 Profile update 的乐观锁含义

profile propose 在创建时读取 beforeContent，并记录 baseContentHash；注释说明 approve 时会重新读取比较再写。packages/api/src/routes/callback-propose-profile-update-routes.ts:5-7、95-129。[源码确认] 这是乐观并发控制：提议不是加锁占住 primer，而是记录“我基于哪个版本提议”。若另一人先改了文件，批准时 hash 不匹配，应由批准流程阻止覆盖或要求重新提议。当前这条 route 不包含 approve 实现，所以 hash mismatch 的具体 HTTP status、UI 提示不能从这里断言，[仍需验证]。

此处的文件路径安全有两层：targetPath 从认证 catId 推导；resolvePrimerPath 仍接收 profileDir、targetPath、catId 并可能 throw InvalidPrimerPathError。route catch 后返回 400。packages/api/src/routes/callback-propose-profile-update-routes.ts:86-97。不要只说“Zod 限制 afterContent”就认为防路径攻击，真正不让模型控制路径的是根本不在 schema 接收 path。

### 10.3 Session handoff 的“pending”不是失败

session handoff 先执行 A4 gate：没有 active session、已有 pending、cooldown、hourly limit 等结果被返回为 status: rejected 与 reason/message，HTTP 仍是 200 风格。packages/api/src/routes/callback-propose-session-handoff-routes.ts:47-52、300-303。[源码确认] 这代表有效请求在业务规则下没有创建提议，不是客户端重试就能解决的 5xx。

dedup fast path 若另一请求已经 reserve proposalId 但还没有可见 card，会返回 503 和 retry-after: 1。packages/api/src/routes/callback-propose-session-handoff-routes.ts:88-120、128-150。[源码确认] 这是少数真正“稍后重试可能恢复”的业务并发状态。它比返回 duplicate 更诚实：duplicate 代表可复用完成结果，in-flight card pending 则还无法告诉调用者提议是否真的可操作。

### 10.4 Approval Hub adapter 的并行扇出

approvalHubRoutes 的 pending route 对 adapters.map(a => a.listPending(userId)) 做 Promise.all，随后合并、按 createdAt 排序、截取 limit；settled 先 filter 有 listSettled 方法的 adapter，再 Promise.all。packages/api/src/routes/approval-hub-routes.ts:21-59。[源码确认]

Promise.all 的 JavaScript 语义是并发等待所有 Promise，任一 reject 则整体 reject。这里采用它是不同 feature store 之间独立，串行等待会把总延迟累加。风险也要指出：一个 adapter throw 可能让整个 Hub 请求失败，除非 route 外还有错误处理；当前这一小段未见 Promise.allSettled 局部隔离，不能宣称“单个 adapter 错误会被吞掉”。[源码确认/仍需验证]

optional method 的类型收窄写法是：

    const capableAdapters = adapters.filter(
      (a) => typeof a.listSettled === 'function'
    );
    const results = await Promise.all(
      capableAdapters.map((a) => a.listSettled!(userId, { limit }))
    );

typeof 是运行时类型守卫，filter 后逻辑上只保留可调用 adapter；! 仍是 TypeScript 断言，编译器不再报“可能 undefined”。若把 filter 去掉直接调用，F231 等未实现 settled 的 adapter 会 TypeError。若用 Promise.all 的结果直接 slice 而不先 flatten/filter/sort，可能让一个 adapter 的大量旧数据挤掉另一个较新的结果；具体排序代码应以 route 全文复核。

## 11. 测试如何证明这些行为：证据强度与盲区

读测试不能只看测试名。一个好面试回答应该同时说清楚“它把什么输入送进哪一层、断言了什么可观察结果、没有覆盖什么”。本章的案例是：某次 invocation 中运行的 MCP 客户端调用 `cat_cafe_post_message`，携带稳定的 `clientMessageId: "msg-20260819-01"`，向当前 thread 写入一条带 `@cat-b` 的定位结论。下面的测试是这条链上各段的证据，不是一个端到端浏览器验收。[测试确认]

### 11.1 测试地图：每组测试对应哪一个不变量

| 测试文件 | 直接验证的行为 | 对本案例意味着什么 | 它没有证明什么 |
| --- | --- | --- | --- |
| `packages/mcp-server/test/tool-registration.test.js` | tool surface、split server、`post_message.threadId` 的 schema | MCP 客户端能发现正确参数形状 | 不证明 Fastify route 真能写入数据 |
| `packages/mcp-server/test/callback-tools.test.js`、`callback-tools-agent-key.test.js` | callback payload/header 与 agent-key 路径 | 客户端构造请求前的身份分支有回归保护 | 不等于真实 API 或 Redis 已连通 |
| `packages/mcp-server/test/degradation-framework.test.js` | normal、expired、unknown、stale、5xx 等 degradation 分类 | MCP 层会把部分 API 结果翻译为可见结果/错误 | 不证明远端网络必然可靠 |
| `packages/mcp-server/test/callback-retry.test.js` | 悬挂 fetch 会被 timeout abort，正常慢请求不会误 abort | 本案例不会因单次永不返回的 socket 永久卡死 | 不证明用户点击取消能传到这个 fetch |
| `packages/api/test/callback-auth-prehandler.test.js`、`callback-auth-agent-key.test.js` | credential 解析、principal 和 auth gate | API 不应把 body/header 混搭成有效凭证 | 不证明部署反向代理不会改写 header |
| `packages/api/test/callback-principal-helpers.test.js` | invocation/agent-key 的 scope helper | `threadId` 的权限来源与 principal 分支一致 | 不覆盖所有业务 route |
| `packages/api/test/callback-routes.test.js` | post-message、stale、client id、内容指纹和并发 dedup | 同一案例重发不会双存储、双广播 | 以 in-process test double 为主，不是 Redis 故障演练 |
| `packages/api/test/callback-refresh-token-auth.test.js`、`callback-refresh-token-cooldown.test.js`、`callback-refresh-token-stale.test.js` | refresh 的认证、冷却和最新 token 校验 | refresh 是独立的、受节流保护的生命周期请求 | 不证明客户端 timer 在真实进程崩溃后仍会继续 |
| proposal/approval 相关测试 | reserve、卡片持久化、并发、adapter 聚合 | 高风险写操作采用 pending proposal 而非直接执行 | 需各自结合 approve route 才能证明最终批准语义 |

这张表也说明为什么“测试都绿了，所以线上完全不会重复消息”是错误说法。`callback-routes.test.js` 证明的是该 route 在它提供的 registry/store/socket fake 或测试配置下的可观察语义；Redis 的 TTL、多个 API 实例同时争抢、磁盘满、真实 TCP 半开连接需要由对应 Redis 集成测试或线上演练另行证明。[测试确认/合理推断]

### 11.2 幂等性：同一 clientMessageId 的最小可执行证据

下面是测试中的真实片段，省略了与案例无关的创建/关闭样板：

```ts
const first = await app.inject({
  method: 'POST',
  url: '/api/callbacks/post-message',
  headers: { 'x-invocation-id': invocationId, 'x-callback-token': callbackToken },
  payload: { content: 'idempotent message', clientMessageId: 'msg-001' },
});
assert.equal(JSON.parse(first.body).status, 'ok');

const second = await app.inject({
  method: 'POST',
  url: '/api/callbacks/post-message',
  headers: { 'x-invocation-id': invocationId, 'x-callback-token': callbackToken },
  payload: { content: 'idempotent message', clientMessageId: 'msg-001' },
});
assert.equal(JSON.parse(second.body).status, 'duplicate');
assert.equal(messageStore.getRecent(10).length, 1);
assert.equal(socketManager.getMessages().length, 1);
```

代码来自 `packages/api/test/callback-routes.test.js:240-272`。[测试确认]

这里的两个 `await` 不是“让 JS 变同步”。`app.inject` 返回 `Promise`，`await` 的意思是暂停这个 async test 函数的后续语句，待 Promise settle 后取出响应；Node 仍可执行其他任务。采用两次顺序 `await`，是为了刻意制造“成功完成后再重复投递”的场景。若省掉 `await`，`JSON.parse(first.body)` 会在 response 尚未产生时读取 undefined，测试不再描述预期业务顺序。若把第二次请求改为另一个 `clientMessageId`，它不再验证调用方幂等键，而是在验证后面的内容指纹去重。[测试确认]

回到案例：`msg-20260819-01` 必须由调用方在一次逻辑消息的重试、outbox replay 中保持不变；这样 API 在 `callbacks.ts:1478-1484` 的键去重才能识别为同一个投递。MCP 工具在没有提供该字段时才以 `randomUUID()` 补值，`callback-tools.ts:587-618`。因此“每次重试新建 UUID 仍然依赖 clientMessageId 去重”是明显错误的面试答案；它会退化为内容指纹去重，语义和碰撞窗口都不同。[源码确认]

### 11.3 并发重复：为什么顺序测试还不够

`callback-routes.test.js:306-355` 专门把第一个 append 卡住，令第二个请求在第一个真正落库之前通过普通的“最近消息扫描”位置。测试断言第二次仍拿到 `duplicate`，最终只有一条 store message 和一次 socket broadcast。它验证的是原子 content claim 必须发生在 append 前，而不是“先读再写”的 check-then-act。[测试确认]

这个测试对应一个典型竞争序列：

    P1: 读取 recent，未见重复 -> 获得 content claim -> 停在 append
    P2: 读取 recent，仍未见重复 -> 尝试同一个 content claim -> duplicate
    P1: append 成功 -> broadcast 一次

如果没有 `callbacks.ts:1756-1827` 的原子 claim，P1/P2 都可能在读阶段看到“没有”，随后各自 append，前端收到两次。JavaScript 单线程不消除这个问题，因为每个 `await` 都是调度切换点，两个 Fastify 请求可以在不同 I/O completion 间交错；多进程/Redis 情况下更不能依赖进程内单线程。[源码确认/合理推断]

### 11.4 超时测试、AbortSignal 与 Promise.race：生产机制和测试 watchdog 不要混淆

生产 retry 在每次 `fetch` 时传入 `AbortSignal.timeout(...)`，默认 per-attempt 上限和 retry 分类见 `packages/mcp-server/src/tools/callback-retry.ts:5-15,78-126`。`AbortSignal.timeout(ms)` 会在时钟到期后变为 aborted，fetch 应以 signal 的 reason reject；`try/catch` 再把该异常按 retryable failure 处理。这里采用 signal 的好处是取消语义随 fetch API 传递，不必额外起一个未被消费的 Promise。若只写 `setTimeout` 记录日志而没有 abort signal，底层 socket Promise 仍可能永不 settle，retry loop 也到不了下一次尝试。[源码确认]

测试里另有 `Promise.race`，它不是生产请求的 timeout 实现，而是防止测试套件自己永久悬挂：

```ts
const result = await Promise.race([
  postJsonWithRetry('http://127.0.0.1:1/x', '{}', [0, 0]),
  new Promise((_resolve, reject) =>
    setTimeout(() => reject(new Error('HUNG: postJsonWithRetry never returned within 3s')), 3000),
  ),
]);

assert.equal(result.ok, false);
assert.ok(abortCount >= 1);
```

代码来自 `packages/mcp-server/test/callback-retry.test.js:62-73`。[测试确认]

`Promise.race` 的 JavaScript 语义是“谁先 settle，就采用谁的结果或错误”；它不会自动取消 race 中较慢的 Promise。测试这样写是为了让回归以明确的 `HUNG` 失败，而不是默默消耗整个 Node test timeout。若把它错误搬到生产而不同时 abort fetch，race 虽然先返回 timeout 错误，慢 fetch 仍在后台运行，可能晚到写入、占住连接或产生未处理结果。所以本案例的生产边界是 `AbortSignal.timeout`，不是 `Promise.race`。[源码确认/合理推断]

`callback-retry.test.js:37-87` 同时断言了两件相反但都必要的事：50ms 模拟 hang 会 abort 并在耗尽后返回 `{ ok: false }`；500ms 上限下 20ms 的慢成功不会被误杀。它没有验证 1/2/4 秒退避的真实等待时长，也没有测试 outbox 文件写入，后两者要看 `callback-retry.ts` 与 `callback-outbox.ts` 的专项测试/实现。[测试确认]

### 11.5 认证、stale 与 refresh 的测试边界

API auth test 覆盖 callback preHandler 的 principal 派生、缺凭证和 agent key 分支，对应 `packages/api/src/routes/callback-auth-prehandler.ts:69-205`；principal union 是 `packages/shared/src/types/callback-principal.ts:3-18`。它的核心价值是防止日后有人把 `threadId` 当成“客户端自己声明的权限”，或把 header 中的一个字段与 body 中另一个字段拼成凭证。[测试确认/源码确认]

`callback-routes.test.js:2713-2735` 断言 superseded invocation 的 post-message 返回 HTTP 200 且 body `status: 'stale_ignored'`，并且消息不写入。200 在这里不是“写成功”，而是 API 明确告诉客户端：这次身份曾有效但已过期，重试同一请求不会改变结果。MCP 的 `_executePostMessage` 再把 `stale_ignored` 变成 MCP 可见错误，见 `callback-tools.ts:620-660`。面试时要把 HTTP transport 成功、业务状态、MCP tool 成功三层分开说。[测试确认/源码确认]

refresh 系列测试验证的是 `peek -> cooldown claim -> verifyLatest` 这条 auth 生命周期路径，生产注册在 `callbacks.ts:3274-3374`，MCP timer 的 jitter/cleanup 在 `refresh-loop.ts:28-45,80-183`。不要据此说“每个 tool call 都 refresh”；源码是启动循环按 interval 请求 refresh，而且明确没有套 callback retry 层。理由可解释为：refresh 的重复请求本身受服务端 cooldown 约束，重试层可能制造无意义压力；但这只是当前实现的选择，并不等于 refresh 永远不需要可靠投递。[源码确认/合理推断]

### 11.6 流式语法：它存在于调用侧，不存在于本案例的 callback JSON body

完整系统中，API 触发 agent 时的函数契约是流式的：

```ts
export async function* invokeSingleCat(
  deps: InvocationDeps,
  params: InvocationParams,
): AsyncIterable<AgentMessage> {
  const { registry, sessionManager, threadStore, apiUrl } = deps;
  const { catId, service, prompt, userId, threadId, isLastCat, signal: callerSignal } = params;
  // 后续按运行过程 yield AgentMessage
}
```

代码来自 `packages/api/src/domains/cats/services/agents/invocation/invoke-single-cat.ts:670-680`。[源码确认]

`async function*` 是异步生成器：调用它立即得到 AsyncGenerator/`AsyncIterable`，不是最终消息的 Promise；函数内部每次 `yield` 产出一条 `AgentMessage`，下一条可在 await 完成后再产出。`for await (const message of invokeSingleCat(...))` 会按异步顺序消费流。它适合模型 token、工具事件、终态消息交错到来的 agent 执行；如果改为 `Promise<AgentMessage[]>`，调用方通常要等全部输出结束才看到第一条，也难以把 `AbortSignal`、中间工具事件和最终文本按时间顺序转发。`AgentService.invoke` 的类型也要求同步返回 `AsyncIterable<AgentMessage>`，见 `packages/api/src/domains/cats/services/types.ts:310`。[源码确认]

本案例的 MCP tool 发生在这种 agent 生命周期中，但 `callbackPost` 本身是“一次 JSON request -> 一次 JSON response”，不是 AsyncIterable；不要把 generator 当成 post-message 的协议。`invokeSingleCat` 只在参数中接收到 `callerSignal`，当前已追到的 `callbackPost` fetch 是每次创建自己的 timeout signal；用户取消是否被进一步桥接为 callback fetch 的 abort，尚未由本章检查的代码证明。[源码确认/仍需验证]

`for await` 也有独立的文件流用法：

```ts
const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
const reader = createInterface({ input: stream, crlfDelay: Infinity });

try {
  for await (const line of reader) {
    currentLine++;
    if (currentLine < input.startLine) continue;
    if (currentLine > endLine) {
      reader.close();
      stream.destroy();
      break;
    }
    lines.push(`${currentLine}: ${line}`);
  }
} catch (err) {
  // 返回工具错误
}
```

代码来自 `packages/mcp-server/src/tools/file-tools.ts:196-214`。[源码确认]

这里 `reader` 是可异步迭代的 readline interface，`for await` 每获得一行再继续，避免同步 `readFile` 一次装载整个文件。`break` 前同时 `reader.close()` 和 `stream.destroy()` 是资源清理：只 break 循环却不销毁底层 stream，文件描述符仍可能继续读到 EOF。`try/catch` 则把 stream error 收敛成 MCP tool 错误；不用 catch，异常会 reject 整个 handler，使调用者失去可读的工具级错误。[源码确认]

NDJSON 在仓库中确实有真实实现，但不是 callbackPost：`packages/api/src/utils/ndjson-parser.ts:17-54` 的 `parseNDJSON` 对 `Readable` 的每一行 `JSON.parse`，失败时 `yield` 带 `__parseError` 的 sentinel；`isParseError(value): value is ParseError` 再通过 `typeof value === 'object' && value !== null && '__parseError' in value` 做类型守卫。`unknown` 不允许直接访问属性，guard 后 TypeScript 才知道它是 `ParseError`。若不用这个 guard 而断言 `as ParseError`，坏输入可能让后续代码访问不存在的字段；若遇到一行坏 JSON 就 throw，调用者会失去此前/后续可处理的流项目。这里的 `yield` 是按行递交结果，和本案例 HTTP JSON body 不同。[源码确认]

## 12. 常见误解和容易答错的地方

### 12.1 与原章节的差异：以当前源码为准

原章节对“invocation 凭证与 agent key 可同时存在”的叙述，若被理解为同一 HTTP 请求会同时发送两套 header，就与当前实现不符。`getCallbackConfig` 的确会看到环境中的多种来源，但 `buildAuthHeaders` 在完整 invocation pair 存在时只构造 invocation headers；即使 agent key 也存在，也不会并带，见 `packages/mcp-server/src/tools/callback-tools.ts:108-147`。[源码确认]

正确的口述是：“配置解析有优先级；发送时完整 invocation identity 排他优先，agent key 是另一条 principal 分支，而不是额外叠加的管理员通行证。”这么做避免服务端面对互相矛盾的两个身份来源。若将两套 headers 都发出，服务端要猜谁优先，甚至可能在 proxy/header merge 后产生意外认证结果。[源码确认/合理推断]

### 12.2 十四个高频错误与修正

1. **“MCP tool schema 就是 API schema。”** 不对。server-toolsets 把 raw Zod shape 或有限 JSON Schema 转为注册时的 Zod，`json-schema-to-zod.ts:15-75` 只覆盖有限子集；API route 还会再做 body schema、auth 与业务校验。只看 MCP schema 会漏掉授权和 freshness gate。[源码确认]

2. **“默认 annotation 是 read-only，所以未知 tool 安全。”** 相反，未知 annotation 的默认结果是 write-safe，而不是 read-only，`server-toolsets.ts:439-445`。这是防止把潜在写工具误暴露给 readonly surface 的保守设计；新增 tool 必须显式标注。[源码确认]

3. **“agent-key selector 能任意替换调用身份。”** 不对。invocation principal 有绑定 `threadId`，agent-key principal 没有；selector 只能在服务端 scope helper 和 route 校验允许的范围内工作，见 `callback-principal.ts:3-18`、`callbacks.ts:1187-1269`。selector 不是授权绕过。[源码确认]

4. **“`threadId` 是用户 payload，带上即可跨 thread 写。”** 不对。invocation-token 调用者不能传 `threadId`，MCP 端明确拒绝，`callback-tools.ts:710-727`；API 还做 cross-thread fail-closed。案例中 thread 来自 invocation registry，而不是模型文字。[源码确认]

5. **“HTTP 200 必然意味着消息已存储。”** 不对。`stale_ignored` 是 200 但不存；某些业务拒绝也可用 200 body 表达；`queued_for_retry` 是 MCP outbox 状态，更不是 API 已经写入。要同时说 HTTP code、body status、MCP tool result 三层。[源码确认]

6. **“clientMessageId 去重就足以解决重复。”** 不足。没有/改变 key 的并发副本会穿透 client id 去重，才需要 `callbacks.ts:1756-1827` 的原子内容 claim；但内容 fingerprint 又不等于所有语义重复都应合并，例如用户刻意重复发送相同文本的业务场景需要看窗口和 scope。[源码确认/合理推断]

7. **“retry = 最终一定成功。”** 不对。retry 只有有限四次，范围仅 408/429/5xx 或 thrown error；耗尽后才可能入 outbox，见 `callback-retry.ts:78-126`、`callback-outbox.ts:172-207`。非 retryable 4xx 不应被无休止放大。[源码确认]

8. **“outbox 返回 queued_for_retry 等同最终一致。”** 不对。它至少说明 JSON 请求写入本地待重放文件成功；进程/磁盘/权限、`.processing` 遗留和何时再次 flush 都仍影响最终送达。当前代码的 stale `.processing` 崩溃恢复策略尚未在本章完整验证。[源码确认/仍需验证]

9. **“`AbortSignal.timeout` 就是用户取消。”** 不对。它是每次网络尝试的 deadline；真实用户请求的 `AbortController` 需要由上层显式传递并在用户离开时 abort。已查看调用链未能确认 callback fetch 接收 callerSignal。[源码确认/仍需验证]

10. **“Redis 永远参与调用验证。”** 不对。registry 只在 Redis 已配置且可用时选用 Redis backend，否则可使用其他实现，`InvocationRegistry.ts:49-62`。应该说“支持 Redis backend”，不能说“每次必写 Redis”。[源码确认]

11. **“所有失败都会被 catch 后吞掉。”** 不对。retry 把可重试网络错误转为受限结果，profile card append 失败会删除 proposal 并 rethrow；remote env 校验是启动 fail-closed。错误是否吞掉要逐个函数说明，不存在系统级统一规则。[源码确认]

12. **“SSE/stdio chunk 就是 NDJSON。”** 不对。NDJSON 的边界是换行的完整 JSON value；remote 处理的是 Streamable HTTP/SSE 风格 chunk，callback 发送普通 JSON。`ndjson-parser.ts` 是另一条明确按行 parse 的路径。[源码确认]

13. **“`Promise.all` 让一个坏 Approval adapter 自动被忽略。”** 不对。`Promise.all` 任一 reject 就 reject；`approval-hub-routes.ts:21-59` 只对 optional `listSettled` 做函数存在性过滤，不等于错误隔离。需要 `Promise.allSettled` 或 adapter 内部 catch 才是不同语义。[源码确认]

14. **“close/destroy 是装饰性代码。”** 不对。timer 的 `unref`、SIGTERM/SIGINT listener 清理见 `refresh-loop.ts:138-183`；文件 reader 的 close/destroy 见 `file-tools.ts:196-214`。它们决定进程能否退出、资源能否回收，不能只描述主业务 happy path。[源码确认]

### 12.3 面试中的五句话自检法

当被问到任意一段回调代码，先用下面五句话组织答案，能避免大多数“只背函数名”的问题：

1. “它的输入来自哪个受信边界，返回给谁？”例如 `callbackPost` 吃的是已选择的 config/payload，返回的是 HTTP/工具层结果给 tool handler。
2. “它改变的是哪一种状态？”例如 client id claim、content claim、MessageStore、A2A queue、socket broadcast 各自不同。
3. “第一个 `await` 之后有没有竞争？”有，就不能把检查和写入分开当原子动作。
4. “错误被保留、转换还是吞掉？”例如 stale 由 API body 转为 MCP error；outbox write failure 不伪装成 queued。
5. “这个结论来自源码、测试还是推断？”没有行号就说“仍需验证”，不要把意图写成事实。

## 13. 面试官可能继续追问什么：可直接口述的回答

下面所有回答都围绕本章案例。行号是帮助复盘的证据锚点；面试时应先讲因果，不必机械报路径。

### 13.1 基础问题（10 题）

**Q1：MCP 在这个项目里解决的真实问题是什么？**

可直接回答：MCP 把运行在 agent/桌面客户端一侧的操作封装成有 schema 的 tool，再通过 callback API 把结果受控地写回 Cafe 的 thread、proposal 或审批系统。它不是直接让模型访问数据库，而是把认证、scope、幂等和用户可见性放在 API route。注册入口在 `packages/mcp-server/src/server-toolsets.ts:516-618`，写回入口在 `packages/api/src/routes/callbacks.ts:841+`。[源码确认]

可能继续追问：为什么不用 agent 直接 HTTP 调 API？回答是 MCP 仍可在内部通过 HTTP callback，但它给客户端提供统一的 tool contract、capability filter 和多 transport 入口，不能替代服务端 auth。

**Q2：用一句话说完案例的正常调用链。**

可直接回答：MCP 启动注册 `cat_cafe_post_message`，tool handler 从完整 invocation credential 构造 header 和 payload，`callbackPost` 在有限 timeout/retry 后 POST 到 Fastify；preHandler 派生 `CallbackPrincipal`，route 用 invocation 的 thread scope 做 stale/跨 thread/idempotency 检查，append 消息、决定 A2A 和 socket 事件，最终回 JSON status 给工具。关键段见 `index.ts:23-45`、`callback-tools.ts:175-222,587-660`、`callback-auth-prehandler.ts:69-205`、`callbacks.ts:1187-1827`。[源码确认]

可能继续追问：哪里决定 thread？回答是 invocation principal/registry，而不是模型任意提供的 threadId。

**Q3：为什么 callback credential 要放 header？**

可直接回答：源码把身份元数据和业务 body 分开，并在 API 端按规范解析 credential，阻止一个字段来自 header、另一个来自 body 的混搭。它不是天然加密，机密性仍依赖 TLS 和部署；其代码价值是明确认证边界，见 `callback-tools.ts:136-153`、`callback-auth-prehandler.ts:187-205`。[源码确认]

可能继续追问：两个身份同时存在怎么办？完整 invocation pair 存在时发送端只带 invocation headers，不并带 agent key。

**Q4：`CallbackPrincipal` 为什么用 union type？**

可直接回答：它把 invocation 和 agent-key 两种可信身份显式建模为带 discriminator 的联合类型。invocation 分支有 `threadId`，agent-key 分支没有，后续代码必须先根据 kind/type 收窄再访问分支字段，避免把“可选 threadId”误当成已授权的 scope。定义在 `packages/shared/src/types/callback-principal.ts:3-18`，推导/解析在 `callback-scope-helpers.ts:79-131`。[源码确认]

可能继续追问：不用 union 用一堆可选字段会怎样？回答是非法组合更容易通过编译，例如错误地同时当作两种身份处理。

**Q5：本案例为什么需要两个去重机制？**

可直接回答：稳定的 `clientMessageId` 解决同一逻辑调用的 at-least-once 重放；原子内容 fingerprint claim 解决没有稳定 key 或两个独立 delivery 并发时的 check-then-act 竞争。前者位于 `callbacks.ts:1478-1484`，后者在 `callbacks.ts:1756-1827`，并发回归测试在 `callback-routes.test.js:306-355`。[源码确认/测试确认]

可能继续追问：二者会不会误去重？会，内容 fingerprint 的窗口/范围是业务取舍，不能把它宣传成数学上绝对准确的“语义幂等”。

**Q6：网络超时与重试如何工作？**

可直接回答：callback retry 对每次 fetch 放 `AbortSignal.timeout`，每次上限约 10 秒，使用 1/2/4 秒退避，最多四次；仅 408、429、5xx 和抛出的网络异常会继续尝试。这样把单次无响应限制成有界失败，而不是承诺必达，见 `callback-retry.ts:5-15,78-126`。[源码确认]

可能继续追问：为什么不重试 400？因为通常是 schema/权限等确定性请求错误，重试只会放大无效写入。

**Q7：outbox 的成功语义是什么？**

可直接回答：`queued_for_retry` 表示 callback 请求在所有 retry 后仍遇到可重试失败，但已成功保存到本地 JSON outbox，等待将来的 flush；它不表示 API 已追加消息。outbox 用 rename 到 `.processing` 作为原子 claim，见 `callback-outbox.ts:94-207`。[源码确认]

可能继续追问：进程崩溃在 `.processing` 后怎么办？当前已查代码不足以确认完整恢复策略，应明确标为仍需验证而不是猜测。

**Q8：为什么 stale callback 返回 200？**

可直接回答：它在 HTTP 层成功接收并判定请求，但业务上拒绝过期 invocation 写入。返回 200 加 `stale_ignored` 可以避免客户端把确定性过期误判为 transport failure 后制造重试风暴；消息不会存储，测试在 `callback-routes.test.js:2713-2735`，MCP 再将它转成 tool error。[测试确认/源码确认]

可能继续追问：那 200 能否统一当成功？不能，必须检查 response body status 和 MCP 映射。

**Q9：A2A 和 socket 各解决什么？**

可直接回答：消息 append 是持久化事实；A2A 判断 `@cat-b` 等提及后决定是否投递/排队下一位 agent；socket 是对 UI 或订阅方的实时传播。它们发生在 post route 后段，`callbacks.ts:1507-1529,1756-1827`，因此不能用“socket 已发”代替“消息已存”。[源码确认]

可能继续追问：为什么 queued message 延迟 broadcast？因为队列状态可能要求先安排后传播，具体条件要按 route 后段代码解释，不能泛称所有消息都即时发。

**Q10：proposal 为什么不直接改 profile 或 handoff？**

可直接回答：profile/handoff 是高影响操作，callback route 先创建 pending proposal 与用户可见卡片，随后在 Approval Hub 统一查看和批准。它用 reservation、补偿删除、marker 自愈减少跨 store 非事务的不一致，见 `callback-propose-profile-update-routes.ts:62-192` 和 `callback-propose-session-handoff-routes.ts:128-325`。[源码确认]

可能继续追问：批准时怎么防 primer 被别人改掉？创建时有 `baseContentHash` 乐观锁意图，但 approve route 的具体冲突返回还需继续核对，不能从 propose route 假定。

### 13.2 源码细节问题（10 题）

**Q11：tool 注册为什么同时接受 Zod raw shape 与 JSON Schema？**

可直接回答：toolset 需要兼容不同定义来源：已有工具可直接给 Zod raw shape，外部/描述性工具可给 plain JSON Schema，再转换为 Zod 后走显式 `registerTool`。转换器是受限实现，不应假设覆盖任意 JSON Schema，见 `server-toolsets.ts:516-560`、`json-schema-to-zod.ts:15-75`。[源码确认]

可能继续追问：转换失败该怎么办？应在注册/启动期 fail fast 或补全转换器，而不是放到工具调用后才暴露。

**Q12：为什么说 destructuring 在这里不只是简写？**

可直接回答：如 `const { catId, service, prompt, userId, threadId, isLastCat, signal: callerSignal } = params`，它把外部参数对象在函数边界解包，并将 `signal` 明确重命名为 `callerSignal`，防止和局部 timeout signal 混淆，见 `invoke-single-cat.ts:677-680`。不用 destructuring 功能仍可实现，但重复 `params.xxx` 容易把来源混在一起；写错重命名则可能把用户取消和内部超时接到错误位置。[源码确认]

可能继续追问：这会深拷贝 params 吗？不会，普通对象 destructuring 只读取属性引用，不会深拷贝内部对象。

**Q13：optional chaining 与 nullish coalescing 的正确语义是什么？**

可直接回答：`opts?.signal` 在测试 mock 中表示 opts 为 null/undefined 时返回 undefined 而非抛错，见 `callback-retry.test.js:45-58`；`signal.reason ?? fallback` 只在 reason 为 null/undefined 时取 fallback，保留合法的空字符串、0、false。这里要的是“缺失才回退”，不能写 `||`，否则合法 falsy 值也会被当成缺失。若不使用 `?.`，mock/调用者省略 opts 时测试会因为访问属性报错，而不是验证 timeout。[测试确认]

可能继续追问：生产代码是否把 `?.` 当安全认证？不能，optional chaining 只是避免空引用，认证是否 fail closed 必须由显式 branch 决定。

**Q14：`try/catch/finally` 在 callback 路径的职责如何区分？**

可直接回答：`try` 包住可能 reject 的 fetch、JSON/file 操作；`catch` 根据错误性质转 retry、工具错误或补偿；`finally` 适合释放 timer/listener/claim 等必须执行的资源清理。callback retry 的异常分类见 `callback-retry.ts:78-126`，refresh loop 的退出清理见 `refresh-loop.ts:138-183`。不能在 catch 中无差别返回成功，否则会把断网伪装为写入完成。[源码确认]

可能继续追问：finally 里的 await 失败怎么办？需要明确捕获/记录，否则 cleanup failure 也会覆盖原错误，这一细节要按具体函数审查。

**Q15：Map 在 auth system message 中为何要在 await 前 reserve？**

可直接回答：`callback-auth-system-message.ts:166-244` 用 module-local `Map` 在 append 前先登记 dedup reservation，防止两个并发错误通知都通过“还没有通知”的检查；append 失败再 rollback。因为 await 会让请求交错，先 append 再 set 会重现 check-then-act。它是进程内降噪，不等价于跨 API 实例去重。[源码确认]

可能继续追问：为什么不是 Set？需要同时记录时间/状态以支持 5 分钟 dedup、24 小时 hide 或回滚，Map 更能表达键到元数据的映射。

**Q16：Set 合并提及有什么价值？**

可直接回答：route 从 content 解析 A2A mention，又可能收到结构化 mentions，把两者并进 `Set` 后再转出，避免同一 cat 因同一条消息中的重复标记收到两次派发，见 `callbacks.ts:1507-1529`。Set 按值唯一但不是权限判断；最终可投递对象仍要经过后续 A2A/route 规则。[源码确认]

可能继续追问：Set 是否保持 insertion order？JavaScript Set 会按插入顺序迭代，但这里更重要的是去重，不应把顺序当授权语义。

**Q17：为什么 outbox 先 rename 成 `.processing`？**

可直接回答：多次 flush 或并发 worker 都扫描到同一 JSON 文件时，rename 是本地文件系统上的“抢占声明”；只有 rename 成功的一方继续读取/重放。成功则删除，仍 retryable 则重写，见 `callback-outbox.ts:94-168`。如果先 read 再 delete，两个 flusher 都可能 POST 同一条消息。[源码确认]

可能继续追问：rename 在网络文件系统也一定原子吗？这取决于部署文件系统语义，源码本身不能保证，需作为部署前提验证。

**Q18：`Promise.all` 的并发收益与错误传播是什么？**

可直接回答：Approval Hub 用 `Promise.all(adapters.map(...))` 同时向独立 adapter 拉取 pending，降低串行累计延迟；但任一个 reject 会让整个 Promise reject，见 `approval-hub-routes.ts:21-59`。它没有使用 `allSettled`，所以不能称“坏 adapter 会自动跳过”。[源码确认]

可能继续追问：什么时候选 allSettled？当页面宁愿部分可用且能标注某个来源失败时；代价是要设计部分结果、排序和错误展示语义。

**Q19：`async function*` 为什么不能改成 `async function` 返回 `Promise<AsyncIterable>`？**

可直接回答：调用者的契约是同步拿到一个可 `for await` 的 `AsyncIterable<AgentMessage>`；若外层变成 Promise，调用处要先 await，现有 `for await (... of svc.invoke())` 会类型/运行时不匹配。API 代码明确说明此约束，见 `types.ts:310`、`index.ts:3442-3451`、`invoke-single-cat.ts:677`。[源码确认]

可能继续追问：generator 什么时候真正运行？创建 generator 后惰性执行，通常在消费者第一次 `next()`/`for await` 拉取时推进。

**Q20：NDJSON parser 为什么 yield ParseError 而不是直接 throw？**

可直接回答：它服务于流，单行坏 JSON 未必应丢掉整条连接；parser yield sentinel，消费者用 `isParseError` 类型守卫决定记录、跳过还是中止，见 `ndjson-parser.ts:23-54`。这给消费者选择权；代价是每个消费者必须正确处理 sentinel，漏处理会把错误对象当业务 event。[源码确认]

可能继续追问：这与 callbackPost 的 parse 相同吗？不相同，callbackPost 是一个 JSON body/response；NDJSON 是另一个按行流协议。

### 13.3 设计取舍问题（5 题）

**Q21：为何对 stale 选择 fail-closed，却对 freshness cursor check 有 fail-open？**

可直接回答：身份/跨 thread scope 失败会导致越权写入风险，所以必须 fail-closed；freshness hold 的 cursor 查询出错时，源码选择继续处理，以避免可用性依赖的瞬时故障把正常消息全部阻塞，见 `callbacks.ts:1187-1269,1381-1475`。这是把不同风险分级，而不是“所有检查同一策略”。[源码确认]

可能继续追问：fail-open 会不会写入陈旧内容？会增加这一风险，故需要日志/指标和产品级权衡；源码不能证明业务上绝对无害。

**Q22：为什么只有 retryable failure 才入 outbox？**

可直接回答：outbox 用于“这条原本可能成功但暂时不可达”的投递，4xx schema/认证错误通常不会因为稍后重放而变正确。把所有失败落盘会让坏请求无限堆积、掩盖配置错误；当前判断在 `callback-retry.ts:78-126`，入队结果在 `callback-outbox.ts:172-207`。[源码确认]

可能继续追问：429 应该一直重放吗？当前有有限 retry/outbox，真正的长期限速策略、容量上限与丢弃告警需要看运维配置，不能从这里臆断。

**Q23：为什么不是一个数据库事务同时写 message、A2A、socket？**

可直接回答：它们跨越 message store、派发/队列和实时连接，未见统一事务边界；源码用先后顺序、幂等与延迟 broadcast 降低不一致。强行说“原子三写”不符合源码。若业务要求精确一次跨系统副作用，通常需要 outbox/event log/consumer idempotency，而这条 callback route 需另行审查是否完整实现。[源码确认/仍需验证]

可能继续追问：当前最重要的不变量是什么？持久化消息不能因重复 delivery 产生双条，用户实时可见性应尽量与已存储状态一致。

**Q24：为什么 remote mode 启动时拒绝继承 invocation env？**

可直接回答：远端 MCP 服务若继承短期、本地 invocation credential，会在 header 优先级和 thread scope 上带入错误身份；`remote-spike.ts:120-173` 启动前 fail-closed。它牺牲少量部署便利，换取远端服务不会用某个本地会话令牌替用户写数据。[源码确认]

可能继续追问：只靠 API 检查不够吗？服务端仍会检查；启动期拒绝是更早的配置防线，减少错误请求和凭证暴露面。

**Q25：为什么 proposal 的 card append 失败要补偿 delete，而 marker 失败却允许 self-heal？**

可直接回答：proposal 已创建但没有用户可见 card 是不可审批的悬挂状态，所以 append failure 必须删 proposal/release reservation；card 已存在时 marker 失败，删除 proposal 反而让用户看见无法批准的卡，保留并以后扫描自愈更符合可见性不变量。见 `callback-propose-profile-update-routes.ts:62-192`。[源码确认]

可能继续追问：这是事务吗？不是，是跨 store 没有全局事务时的补偿策略。

### 13.4 故障排查问题（5 题）

**Q26：用户说“工具返回成功但页面没有消息”，你如何排查？**

可直接回答：先拿到 MCP tool 的完整 result 与 API body，区分 `ok`、`duplicate`、`stale_ignored`、`held`、`queued_for_retry`；再以 invocationId/clientMessageId 查 auth route、dedup claim、MessageStore append 和 socket/A2A 日志。不能只看 HTTP 200，因为 stale 是 200 不落库。关键映射在 `callback-tools.ts:620-660`、`callbacks.ts:1478-1827`。[源码确认]

可能继续追问：如果是 duplicate？返回既有 messageId 时查该 message 是否存在/被队列延迟广播，而不是再次发同样内容。

**Q27：出现重复消息，先检查哪里？**

可直接回答：先比较两条的 invocation、clientMessageId、content 和时间；同 client id 重复说明 idempotency claim/storage 需要审查，client id 不同但 content 相同则看 atomic content claim 与并发窗口，只有内容不同才更可能是业务真实两次发送。用并发回归测试 `callback-routes.test.js:306-355` 复现，不要只靠单次顺序请求。[测试确认]

可能继续追问：能否马上删除其中一条？先确认是否 A2A 已消费或用户已看到，删除属于数据修复/业务操作，不应由本章调试动作擅自执行。

**Q28：callback 一直卡住怎么办？**

可直接回答：确认 fetch 是否收到 timeout signal、环境变量 timeout 是否异常、错误是否落到 retry 分类，再看四次尝试后 outbox 是否写入。`callback-retry.test.js:37-87` 已回归了悬挂 socket 会有界返回；如果线上仍卡住，可能在 retry 之前、outbox I/O 或事件循环阻塞，不能武断归因网络。[测试确认/合理推断]

可能继续追问：如何安全复现？使用测试中的 mock hung fetch 或隔离环境，不要对生产 API 人工制造长连接。

**Q29：为什么突然所有 callback 401？**

可直接回答：按 credential branch 排查：是否完整 invocation pair、是否只剩半套而 fail closed、是否 apiUrl/transport 环境没传入、是否 remote mode 错继承了 invocation env；再检查 API preHandler 的 canonical extraction 是否收到 proxy 传递的 header。源码边界在 `callback-tools.ts:108-153`、`callback-auth-prehandler.ts:69-205`、`remote-spike.ts:120-173`。[源码确认]

可能继续追问：能否临时同时发 agent key 和 invocation header？不能，这改变认证语义且当前发送端本就不会并带；应修复配置来源。

**Q30：outbox 文件越来越多如何判断是 bug 还是暂时故障？**

可直接回答：检查每个 JSON 的失败分类、创建时间、是否已 rename 为 `.processing`、flush 是否在运行、磁盘权限/空间以及 API 返回码。大量 4xx 不应是正常 retry outbox；大量 5xx/429 说明下游可用性或节流问题。代码能证明 rename/rewrite/delete 的流程，`callback-outbox.ts:94-207`，但未证明完整容量、保留和 crash-recovery 运维策略。[源码确认/仍需验证]

可能继续追问：能直接批量删除吗？不能。它们可能是唯一待投递的业务消息；删除属于有损操作，应先导出、分类并按运行手册执行。

## 14. 本章小结和背诵版回答

### 14.1 最短正确心智模型

MCP 服务器负责把工具能力和调用身份带到 callback 边界；API callback route 负责真正的认证、thread scope、stale 判断、幂等写入和事件分发；outbox/refresh/proposal 是各自不同失败模型下的补偿机制。不要把注册成功、HTTP 200、消息持久化、socket 发出、A2A 消费、用户审批混成一个“成功”。[源码确认]

对贯穿案例，最小状态机是：

    tool discovered
      -> invocation headers selected
      -> POST attempt (timeout/retry)
      -> CallbackPrincipal authenticated
      -> scope + stale gates
      -> client-id/content claim
      -> message append
      -> A2A decision + socket propagation
      -> API status mapped to MCP result

其中任一点失败都要具体说明去向：认证失败在 preHandler/route 前后被拒绝；过期调用得到 `stale_ignored` 且 MCP 报错；暂时网络失败先有限 retry、成功入 outbox 后才称 `queued_for_retry`；并发重复返回 `duplicate` 而不是二次 append。这个“状态机”是基于多文件实现的归纳，具体分支仍以各 route 的条件为准。[源码确认/合理推断]

### 14.2 90 秒背诵答案

“Clowder AI 的 MCP 回调不是模型直接写数据。MCP 入口在启动时注册 toolset，调用 `cat_cafe_post_message` 时先从环境解析 callback config；完整 invocation identity 存在时，它排他地放入 invocation headers。工具端用有界的 fetch timeout 和有限重试发送 JSON。API 的 callback preHandler 把凭证转换成 discriminated union principal，invocation principal 自带允许的 thread scope，所以模型不能借参数跨 thread 写。

路由在真正 append 前依次做 stale、scope、clientMessageId 和原子内容去重。client id 保证同一次逻辑投递重放不重复，内容 claim 补上并发或缺 key 的竞争。append 以后才处理 A2A mention 和 socket 传播，所以要区分持久化、派发和实时通知。网络可重试失败耗尽后可写本地 outbox，这只代表待重放落盘，不代表 API 已写成功。对 profile/handoff 这类高影响动作则创建 pending proposal 和用户可见卡片，避免 agent 直接执行。

我会用测试证明每一层的可观察行为，但不会把测试 fake 当作线上 Redis、多实例和文件系统的证明。源码未覆盖的取消信号传递、`.processing` 崩溃恢复和跨实例 telemetry，我会明确标注仍需验证。”

### 14.3 交付前复核清单

- `[源码确认]` callback header、principal、stale、dedup、retry/outbox、refresh、proposal 结论都有上文源码路径与行号。
- `[测试确认]` 幂等、并发重复、hung fetch、stale 等结论引用了相应 Node test；它们的测试环境边界已单列。
- `[文档确认]` 本章未把未核验的设计文档当作源码事实。
- `[合理推断]` 仅用于说明 async 交错、跨系统一致性取舍等由源码结构引出的工程含义，并已标记。
- `[仍需验证]` 真实用户取消到 callback fetch 的传播、`.processing` 崩溃恢复、部署文件权限/容量策略、profile approve 的精确 hash 冲突语义、跨实例 telemetry 聚合，以及具体 CLI subprocess spawn/env 注入仍不在本轮已核对代码的确定范围内。
