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

