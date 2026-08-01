# 27 · 深潜：MCP 工具与 32 个回调路由的实现

> 这一篇覆盖 `packages/mcp-server/src/`（43 文件 / 约 10413 行）与 `packages/api/src/routes/callback*.ts`（32 文件 / 约 10649 行），外加 `agent-key/`（6 文件 / 446 行）、`approval-hub/`（8 文件 / 815 行）、`domains/limb/`（11 文件 / 1297 行）。
> 解决的追问是："你们到底给猫暴露了哪些工具、每个工具怎么鉴权、token 过期那一刻代码走哪条分支、审批流的落盘顺序是什么"。
> 值得读的原因：这是整个系统里唯一一条"猫进程 → HTTP → 服务端状态"的写通道，所有安全边界、幂等、降级都堆在这 2 万行里，面试官只要往深处问一层就必然落到这里。

---

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
