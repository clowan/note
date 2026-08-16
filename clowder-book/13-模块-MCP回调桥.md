# 13 · 模块：MCP 回调桥

> Claude Code 原生支持 MCP，能调工具往家里写数据。
> Antigravity CLI 只有 `agy --print` —— 纯文本进，纯文本出。
>
> 但两只 Agent 都得能发富文本消息、申请权限、标记球权、写记忆。
> 这个模块就是那条"回程通路"。
>
> 面试里它的价值在于：**这是一个很典型的分布式系统问题
> （鉴权、保活、重试、幂等、降级），而且每一层都有真实的踩坑记录。**

---

## 0. 30 秒电梯版

> "回程通路靠两个环境变量：`CAT_CAFE_INVOCATION_ID` 和 `CAT_CAFE_CALLBACK_TOKEN`。
> spawn CLI 时注入，CLI 传给它拉起的 MCP server，
> MCP server 拿它们作为 HTTP 头往 API 回写。
>
> 四层防护：
> **保活**（后台循环刷 token，因为长会话里 Agent 可能很久不调工具）、
> **重试**（3 次指数退避，只重试 408/429/5xx）、
> **outbox**（发不出去就落盘，at-least-once）、
> **降级策略**（声明式框架，每个写类工具必须显式声明策略）。
>
> 里面有几个坑我印象很深：
> 保活的抖动下界要**预除**抖动系数，否则抖完会低于服务端冷却；
> `fetch` 必须带 AbortSignal，否则半开 TCP 会让工具调用**永久挂起**；
> 还有 `stale_invocation` 这个错误**绝对不能降级**——
> 降级会把已经作废的状态写回去。"

---

## 1. 它解决什么问题

### 两条回程通路，性质完全不同

```
        ┌──────────────────────────┐
        │  claude 子进程            │
        └────┬────────────────┬────┘
             │ stdout          │ MCP stdio
             │ （流）           ▼
             │          ┌──────────────┐
             │          │ mcp-server   │  另一个子进程
             │          │ cat_cafe_*   │
             │          └──────┬───────┘
             │                 │ HTTP + invocationId/token
             ▼                 ▼
      event parser      routes/callback-*.ts
```

| | stdout 通路 | MCP 回调通路 |
|---|---|---|
| 方向 | CLI → API（单向） | MCP → API（请求/响应） |
| 传什么 | 增量文本、工具调用事件 | 结构化写操作 |
| 谁发起 | CLI 自动 | Agent 主动调工具 |
| 可靠性 | 父子进程管道，进程活着就通 | HTTP，会超时/鉴权过期/失败 |
| 失败处理 | 进程死了整轮结束 | 重试 → outbox → 降级 |

**难点全在第二条路上。**

### 具体要解决什么

```
Agent 想发一条富文本卡片      → 需要往 API 写
Agent 想申请一个危险操作的权限  → 需要问用户，等回复
Agent 想标记"我在等 CI"       → 需要写球权状态
Agent 想搜项目记忆            → 需要读 evidence 库
Agent 想交接给另一只 Agent     → 需要把目标 Agent 排进执行队列（见 §7 的三代演进）
```

**这些都不能靠 stdout（那是单向的），必须有一条回程。**

---

## 2. 不做会怎样

### 场景 A：没有回程通路

```
Antigravity CLI（纯文本输出）
  → 没法发富文本消息（只能输出纯文本）
  → 没法申请权限（没有交互通道）
  → 没法标记球权
  → 只能靠父进程解析它的纯文本，反推它想干什么
```

**连锁反应**：非 Claude 的 Agent 退化成"只会说话不会做事"，
多模型的意义就没了。

### 场景 B：token 不保活

```
Agent 开始一个 40 分钟的任务
  → 前 30 分钟一直在读文件、写代码（不调 cat_cafe_* 工具）
    → callbackToken 过期
      → 第 35 分钟它想发一条消息汇报进度
        → 401
          → 这 35 分钟的工作没法汇报
```

### 场景 C：`fetch` 不带超时

**这个坑最阴险**，源码注释写得很清楚【源码】：

```ts
/**
 * Default per-attempt fetch timeout. Mirrors refresh-loop PR #1368 (e521cc7aa):
 * a raw fetch with no AbortSignal leaves `await fetch` pending FOREVER on a hung
 * TCP socket (server accepts but never responds) — it neither resolves nor throws,
 * so the retry loop never advances and the caller's tool call (hold_ball /
 * post_message / ...) hangs indefinitely. This callback path missed that fix.
 * 10s covers slow networks; each retry attempt gets a fresh timeout.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
```

**故障链：**

```
半开 TCP 连接（服务端 accept 了但永不响应）
  → fetch 既不 resolve 也不 reject，永久挂起
    → 重试循环卡在第一次尝试
      → 工具调用永不返回
        → Agent 的这一轮永远不结束
          → 用户看到一个永远停不下来的转圈
```

**而且注意 `This callback path missed that fix`**——
**同一个 bug 在保活循环里修过一次，回调路径漏了。**

**这是 [模块 03](03-模块-路由与编排.md) 说的
"同一套判断散在多处"的又一个实例。**

### 场景 D：降级不区分错误类型

```
Agent 的调用被一个更新的调用取代了（stale_invocation）
  → 旧进程还在跑，它的工具调用返回 401
    → 如果这时降级去走备用通路写数据
      → 就把已经作废的状态写回去了
        → 数据被旧状态污染
```

---

## 3. 怎么设计的

### 3.1 鉴权：两把钥匙

**钥匙一：invocationId + callbackToken（单次调用）**

```
spawn 时注入 env：
  CAT_CAFE_INVOCATION_ID
  CAT_CAFE_CALLBACK_TOKEN
      ↓ 子进程继承
  MCP server
      ↓ 读 process.env，作为 HTTP 头
  X-Invocation-Id / X-Callback-Token
```

服务端统一校验：

```ts
/**
 * Unified callback auth preHandler (#476)
 *
 *  Behavior:
 *  1. Try X-Invocation-Id + X-Callback-Token headers (preferred)
 *  2. Fallback: read from body/query (legacy compat window, logs deprecation)
 *  3. Neither present → no-op (panel / non-callback request)
 *  4. Credentials present but invalid → immediate 401 (fail-closed, #474)
 *  5. F174 D2b-1: if `options.notifier` is provided ...
 *     a 401 with surface-able reason triggers an in-context system message
 */
```

**第 3 条和第 4 条的区别是关键：**

```
"没带凭据" → 正常（前端面板走同一路由但不需要 callback 鉴权）
"带了但不对" → 立刻 401（fail-closed）
```

**钥匙二：agent-key（跨调用的长期身份）**

```ts
export interface AgentKeyAuthRegistry {
  verify(secret: string): Promise<AgentKeyVerifyResult>;
}
```

**为什么需要第二把？**
因为 `invocationId` 只在这次调用期间有效。但有些场景需要跨调用的身份：
云端 Agent 读消息、外部 agent 接入、定时任务。

对应 `agents/agent-key/`：

```
AgentKeyRegistry.ts        RedisAgentKeyBackend.ts    MemoryAgentKeyBackend.ts
antigravity-agent-key-sidecar.ts    antigravity-agent-key-sidecar-policy.ts
```

**"sidecar" 的存在说明**：Antigravity 没法读环境变量注入的 token，
得靠一个 sidecar 文件传递。

```ts
function readAgentKeyFile(path: string | undefined): string | undefined {
  if (!path) return undefined;
  try {
    return readFileSync(path, 'utf-8').trim();
  } catch {
    // sidecar missing = no agent-key (not an error)
    return undefined;
  }
}
```

**"sidecar missing = no agent-key (not an error)"** —— 没有就是没有，
不是错误。这样同一份代码能在有/无 sidecar 的环境里都跑。

### 3.2 保活：本模块最精细的一段

**问题**：一次调用可能跑几十分钟，token 有 TTL。
如果 Agent 这段时间刚好没调任何工具，token 就过期了。

```ts
/**
 * F174 Phase C — MCP client background refresh loop.
 *
 * Periodically pings POST /api/callbacks/refresh-token to keep the callback
 * token alive in long sessions where猫 has no incidental tool calls.
 * Uses adaptive interval per KD-6:
 *   nextDelayMs = clamp(ttlRemainingMs / 4, 5min, 30min) * jitter
 *
 * Why background loop instead of猫-callable tool: refresh is plumbing, not a
 * cognitive action; surfacing it as an MCP tool would invite猫 to call it
 * proactively for the wrong reasons.
 */
```

**"refresh is plumbing, not a cognitive action" (刷新是管道，而不是认知行为)这句话很重要：**

> 如果把刷新暴露成 MCP 工具，Agent 会**主动去调它**，
> 而且是出于错误的理由（"我先刷新一下 token 保证安全"）。
> **工具列表里每多一个工具，都在增加模型分心的机会。**

**这条原则和 [模块 07](07-模块-身份注入.md) 的 ADR-037 呼应** ——
只有真正需要模型决策的能力才该暴露成工具。

**抖动下界要预除 —— 这是我最想讲的一个坑：**

```ts
/**
 * Server-side refresh cooldown is 5min per invocation. The client's adaptive
 * delay must NEVER fall below cooldown — otherwise the loop fires before
 * cooldown clears, gets 429, wastes a round-trip + warn-log noise. Cloud
 * Codex P2 (PR #1368): with previous MIN_DELAY_MS=5min and ±15% jitter,
 * worst-case lower bound was 5min × 0.85 = 4.25min < 5min cooldown.
 *
 * Fix: pre-divide MIN by jitter floor so jittered value stays above cooldown.
 * Plus a small safety buffer for clock skew between client and server.
 */
const SERVER_COOLDOWN_MS = 5 * 60_000;
const JITTER_FLOOR       = 0.85;   // 0.85 + Math.random() * 0.3 → [0.85, 1.15]
const COOLDOWN_BUFFER    = 1.05;   // 5% margin for clock skew
const MIN_DELAY_MS = Math.ceil((SERVER_COOLDOWN_MS * COOLDOWN_BUFFER) / JITTER_FLOOR);  // ≈ 6.18min
const MAX_DELAY_MS = 30 * 60_000;
```

**用大白话讲这个 bug：**

```
原来的写法：
  MIN_DELAY_MS = 5 分钟
  然后乘上 [0.85, 1.15] 的随机抖动

看起来"最小 5 分钟"，实际最坏情况：
  5 × 0.85 = 4.25 分钟  < 服务端 5 分钟冷却

结果：
  15% 概率区间内，刷新请求撞上冷却
    → 拿到 429
      → 浪费一次往返 + 日志刷 warn
```

**修法**：先把 MIN 除以抖动下界（`5 × 1.05 / 0.85 ≈ 6.18 分钟`），
这样抖完之后仍然在冷却之上。再加 5% 的时钟偏移余量。

**面试话术**：

> "保活循环有个 bug 我觉得特别典型。
>
> 服务端的刷新冷却是 5 分钟。客户端算了个自适应间隔，
> 是 `clamp(剩余TTL/4, 5分钟, 30分钟)`，然后乘上 ±15% 的抖动。
>
> 看起来'最小 5 分钟'很安全。但抖动是 [0.85, 1.15]，
> **最坏情况 5 × 0.85 = 4.25 分钟，低于服务端 5 分钟冷却。**
> 所以有 15% 的概率会撞上冷却拿到 429，浪费往返还刷日志。
>
> 修法是**把 MIN 预先除以抖动下界**——`5 × 1.05 / 0.85 ≈ 6.18 分钟`，
> 这样抖完之后仍然在冷却之上。而且那 1.05 是给客户端服务端的时钟偏移留的余量。
>
> **教训是：加了抖动之后，'下界'的语义就变了。**
> 你以为约束的是抖动前的值，实际生效的是抖动后的值。
> 这类 bug 在所有加了 jitter 的重试/轮询逻辑里都可能出现。"

**为什么要抖动？** 多只 Agent 同时启动，
如果刷新间隔完全一致，它们会在同一时刻集体打服务端 —— **惊群效应**。

**纯函数化时序计算：**

```ts
/**
 * AC-C3: clamp(ttlRemainingMs/4, 5min, 30min) + ±15% jitter.
 *
 * Pure function — testable without a running timer or HTTP layer.
 */
export function computeNextRefreshDelay(ttlRemainingMs: number): number {
  const proportional = ttlRemainingMs / 4;
  const clamped = Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, proportional));
  const jitter = JITTER_FLOOR + Math.random() * 0.3;
  return Math.floor(clamped * jitter);
}
```

**"testable without a running timer or HTTP layer"** ——
和 [模块 03](03-模块-路由与编排.md) 的护栏、
[模块 10](10-模块-球权状态机.md) 的状态机是同一手法：
**把需要精确验证的计算从副作用里剥出来。**

**失败不崩：**

```ts
/**
 * AC-C5: refresh failure does not crash. Returns rescheduling decision so
 * the loop can keep trying. Does not differentiate by error type yet — we
 * back off uniformly to FALLBACK_DELAY_MS. The next real verify() will
 * ...surface auth issues with structured reason from Phase A.
 */
```

**保活失败不报错给 Agent**，因为 Agent 对此无能为力。
真正的鉴权问题会在下一次实际工具调用时以结构化 reason 浮现。

### 3.3 重试层

```ts
const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000];

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
```

**三次重试，指数退避。只重试 408（超时）、429（限流）、5xx。**
4xx 不重试 —— 请求本身有问题，重试一百次也一样。

**每次尝试一个新的 timeout**（不是整个重试循环一个）——
见 §2 场景 C。

**结构化失败原因：**

```ts
/**
 * F174 Phase A: pull `reason` out of a callback_auth_failed JSON body and
 * format it as ` [reason=X]` for inclusion in the error message.
 * Exported so non-retry HTTP helpers (e.g. callback-tools.ts callbackGet)
 * can produce the same reason-tagged error format.
 */
export function extractReasonTag(text: string): string { /* ... */ }
```

失败原因枚举定义在 `shared` 里 ——
**API 和 MCP server 共用同一份定义**（`CALLBACK_AUTH_FAILURE_REASONS`）。

**未知 reason 不强转：**

```ts
function parseAuthFailureReason(errorText: string): AuthFailureReason | undefined {
  const match = /\[reason=([a-z_]+)\]/.exec(errorText);
  if (!match) return undefined;
  const reason = match[1];
  // Use shared type guard so an unknown reason from a future server doesn't
  // get silently coerced into our local enum.
  if (reason && isCallbackAuthFailureReason(reason) && KNOWN_REASONS.has(reason)) {
    return reason;
  }
  return undefined;
}
```

**"an unknown reason from a future server doesn't get silently coerced"** ——
版本不匹配时（服务端新增了 reason，客户端还是旧版），
未知 reason 返回 `undefined` 而不是被当成某个已知值。

**这是版本兼容的正确处理**：
宁可"不知道原因"，也不要"错认原因"—— 因为错认会导致错误的降级决策。

### 3.4 Outbox：at-least-once 投递

重试三次还失败怎么办？

```ts
/**
 * Callback outbox persistence for at-least-once delivery
 */

const DEFAULT_OUTBOX_MAX_FLUSH_BATCH = 20;
const DEFAULT_OUTBOX_MAX_ATTEMPTS = 10;

interface OutboxEntry {
  id: string;
  queuedAt: number;
  apiUrl: string;
  path: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  attempts: number;
  lastError: string;
}

function getOutboxDir(): string {
  const fromEnv = process.env['CAT_CAFE_CALLBACK_OUTBOX_DIR'];
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
  return join(homedir(), '.cat-cafe', 'callback-outbox');
}
```

**落盘的 outbox 模式**：发不出去就写成 JSON 文件，
下次有机会（下一次工具调用、或者刷新循环）再批量重发。

参数都可配：

```
CAT_CAFE_CALLBACK_OUTBOX_ENABLED           默认 true
CAT_CAFE_CALLBACK_OUTBOX_DIR               默认 ~/.cat-cafe/callback-outbox
CAT_CAFE_CALLBACK_OUTBOX_MAX_FLUSH_BATCH   默认 20
CAT_CAFE_CALLBACK_OUTBOX_MAX_ATTEMPTS      默认 10
```

**两个实现细节：**

```ts
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
```

**`rename`** —— 写 outbox 条目时先写临时文件再原子改名，
防止读到写了一半的 JSON。**这是文件队列的标准手法。**

```ts
function parseOutboxEntry(raw: string): OutboxEntry | null {
  try {
    const parsed = JSON.parse(raw) as Partial<OutboxEntry>;
    if (typeof parsed.id !== 'string' || typeof parsed.queuedAt !== 'number' || ...) return null;
  } catch { return null; }
}
```

**一个坏文件不能让整个 flush 崩掉。**

**语义是 at-least-once，不是 exactly-once** ——
所以服务端必须幂等。这就是
[模块 03](03-模块-路由与编排.md) `MultiMentionCreateParams`
里有 `idempotencyKey`、
[模块 10](10-模块-球权状态机.md) 事件有 `sourceEventId` 的原因。

**面试话术**：

> "重试三次还失败就落盘到 outbox，下次有机会批量重发，
> 最多 10 次尝试。写的时候先写临时文件再 `rename` 原子改名 ——
> 防止读到写一半的 JSON。而且解析失败返回 null 而不是抛，
> 一个坏文件不能让整个 flush 崩掉。
>
> **关键是语义是 at-least-once 不是 exactly-once。**
> 所以服务端必须幂等 —— 这就是为什么他们的 multi-mention 有 idempotencyKey、
> 球权事件有 sourceEventId。**这三个设计是配套的**，
> 只做 outbox 不做幂等等于制造重复数据。"

### 3.5 降级策略框架

**重试和 outbox 处理"暂时发不出去"。
还有一类问题：token 确实失效了，重试一万次也没用。**

```ts
/**
 * F174 Phase E — DegradePolicy framework for write-class callback tools.
 *
 * AC-E1: framework so existing create_rich_block Route B can be expressed
 *        declaratively, with same behavior.
 * AC-E2: every write-class callback tool declares an explicit policy
 *        (`none` is allowed; explicitness > silent default).
 * AC-E3: degradation only fires on 401 with degradable reason (expired /
 *        unknown_invocation). 5xx and other transient errors stay with
 *        the callback-retry layer.
 * AC-E4: successful fallback marks its JSON payload with DEGRADED:true so
 *        callers / dashboards can detect fallback mode.
 * AC-E6: stale_invocation is NOT degradable — degrading would re-create
 *        state on a superseded invocation.
 */
```

**哪些原因可降级：**

```ts
/**
 * Degradable reasons: token has stopped working through expiry/registry loss.
 * Distinct from `invalid_token` (likely client bug) and `stale_invocation`
 * (succeeded but superseded — fallback would re-create stale state).
 */
const DEGRADABLE_AUTH_REASONS: ReadonlySet<CallbackAuthFailureReason> =
  new Set(['expired', 'unknown_invocation']);
```

**四类 401，四种处理 —— 这张表是本模块的精华：**

| reason | 含义 | 处理 | 为什么 |
|--------|------|------|--------|
| `expired` | token 过期 | **可降级** | 走备用通路能达到同样效果 |
| `unknown_invocation` | 调用记录没了 | **可降级** | 同上 |
| `invalid_token` | token 根本不对 | 不降级 | 大概率客户端 bug，降级会**掩盖它** |
| `stale_invocation` | 这次调用已被更新的取代 | **绝对不降级** | 会把作废状态写回去 |

**`stale_invocation` 那条理由写得最清楚：**

> degrading would re-create state on a superseded invocation

**场景**：Agent 的调用因为某种原因被重启了，新的 invocation 已经在跑。
旧的那个进程还在，它的工具调用返回 `stale_invocation`。
**如果这时降级去走备用通路写数据 —— 就会把已经作废的状态写回去。**

**宁可失败，也不要写脏数据。**

**决策树分层清晰：**

```
primary success                            → return as-is
primary fail, non-auth (5xx etc.)          → return as-is（重试层的活）
primary fail, auth but non-degradable      → return as-is（invalid_token, stale_invocation）
primary fail, degradable (expired/unknown) → 走 degrade policy
```

**瞬时错误归重试层，永久错误归降级层，两者不重叠。**

**显式声明，不给默认值：**

```ts
export type DegradePolicy =
  | { kind: 'none' }
  | { kind: 'custom'; degrade: (originalError: ToolResult) => Promise<ToolResult> };

export interface WithDegradationOptions {
  toolName: string;
  primary: () => Promise<ToolResult>;
  policy: DegradePolicy;   // ← 必填
}
```

**`AC-E2` 那句 "explicitness > silent default" 是这个设计的核心：**
每个写类工具**必须**声明策略，哪怕是 `{ kind: 'none' }`。

**不给默认值，就不会有人"忘了考虑降级"。**

**降级要留痕：**

```
AC-E4: successful fallback marks its JSON payload with DEGRADED:true so
       callers / dashboards can detect fallback mode.
```

**降级成功也要标记。** 否则：
- Agent 不知道自己刚才走的是备用通路（可能功能不完整）
- 仪表盘看不出降级率，主通路烂掉了都不知道

**这和 [模块 11](11-模块-跨模型互审.md) 的 `isDegraded`、
[模块 06](06-模块-Provider适配.md) 的 `carrier_fallback` 是同一个原则。**

### 3.6 Agent 那边看到什么

MCP 工具清单（`packages/mcp-server/src/tools/`）：

```
callback-tools.ts             核心回调（发消息、球权、任务进度）
callback-memory-tools.ts      记忆读写
evidence-tools.ts             search_evidence
graph-tools.ts                graph_resolve
recent-tools.ts               list_recent
event-memory-tools.ts         mark_event
hub-action-tools.ts           Hub 动作
schedule-tools.ts             定时任务
limb-tools.ts                 远程执行节点
shell-tools.ts / file-tools.ts
audio-tools.ts                语音
rich-block-rules-tool.ts      富文本规则
publish-verdict-tool.ts       发布裁决
distillation-tools.ts / perspective-tools.ts / signals-tools.ts
external-runtime-session-tools.ts / session-chain-tools.ts
evidence-coverage-nudge.ts    ★ 提醒"你可能没查够"
```

**`needsMcpInjection` —— 不是每次都注入工具说明：**

```ts
import { buildMcpCallbackInstructions, needsMcpInjection } from '../invocation/McpPromptInjector.js';
```

```
原生支持 MCP 的 CLI  → 自己就能看到工具列表，不需要 prompt 说明
不支持的            → 才需要在 prompt 里教它怎么调
```

对应 [模块 07](07-模块-身份注入.md) `InvocationContext` 里的：

```ts
/** Whether MCP tools are available for this cat */
mcpAvailable: boolean;
```

### 3.7 服务端：32 个回调路由 + 横切层

```
callback-auth.ts                  权限申请
callback-a2a-trigger.ts           A2A 触发
callback-multi-mention-routes.ts  多方询问
callback-hold-ball-routes.ts      球权持有
callback-memory-routes.ts         记忆
callback-task-routes.ts           任务
callback-thread-cats-routes.ts    帖内成员
callback-propose-profile-update-routes.ts    ★ 提议更新画像
callback-propose-session-handoff-routes.ts   ★ 提议会话交接
callback-propose-thread-routes.ts            ★ 提议建帖
callback-workflow-sop-routes.ts   SOP
callback-lark-action-routes.ts / callback-wecom-action-routes.ts
callback-limb-routes.ts / callback-runtime-session-routes.ts
...
```

横切层：

```
callback-auth-prehandler.ts       统一鉴权
callback-auth-schema.ts / callback-auth-telemetry.ts
callback-auth-system-message.ts   ★ 401 时给 Agent 发系统消息
callback-errors.ts / callback-scope-helpers.ts
```

**注意那三个 `propose-*` 路由 —— 这是"人在环"的落点：**

```
Agent 提议，不直接执行
  改用户画像 / 交接会话 / 新建帖子
    → 都要经过审批（domains/approval-hub/）
```

**Agent 的自主权有明确边界：**

```
读              → 随便读
写普通数据       → 直接写
改用户相关的东西  → 必须提议，等人批
```

**面试话术**：

> "服务端有 32 个 callback 路由，其中三个的命名很有意思：
> `callback-propose-profile-update`、`callback-propose-session-handoff`、
> `callback-propose-thread`——**都是 propose 不是 do**。
>
> 改用户画像、交接会话、新建帖子这三件事，
> Agent 只能提议，要经过审批（有个 `approval-hub` domain）。
>
> **这是'人在环'的具体落点。**
> Agent 的自主权有清晰的边界：读随便读、写普通数据直接写、
> 改用户相关的东西必须提议。
> 这和他们 L0 里的决策漏斗一致 ——'可逆的自决，不可逆的升级'。"

### 3.8 401 时的体验设计

```ts
/** F174 D2b-1: in-context system message notifier for surface-able 401s. */
notifier?: Pick<CallbackAuthSystemMessageNotifier, 'notify'>;
```

**鉴权失败时，往帖子里发一条系统消息，让 Agent 在上下文里看到。**

**为什么不只是返回错误？**
因为工具返回的错误可能被 Agent 忽略或误解。
在对话流里插一条系统消息，Agent 下一轮一定会看到。

**实现上有个坑：**

```ts
/**
 * F174 D2b-1: pure record read, ignoring TTL. Used by the in-context
 * surface to recover threadId/catId/userId for the notifier even when
 * verify() has just deleted the record on `expired` (砚砚 P1 #1397
 * review — getRecord() also deletes on expired so it can't be used for
 * this purpose).
 */
peekRecord?(invocationId: string): Promise<InvocationRecord | null>;
```

**`verify()` 在发现过期时会顺手删掉记录** ——
但通知器需要这条记录才知道该往哪个帖子发消息。
`getRecord()` 也删，所以专门加了一个只读不删的 `peekRecord()`。

**"清理"和"诊断"是冲突的需求，得分开两个方法。**

**这个洞察很通用**，面试里可以当经验讲。

### 3.9 遥测

```ts
/**
 * F174 Phase D1: derive a concise tool name from the request URL for
 * `cat_cafe.callback_auth.failures{callback.tool}` attribute. Strips
 * `/api/callbacks/` prefix and any query string; returns `unknown` if
 * the URL doesn't follow the callback route shape (defensive default).
 */
function callbackToolFromUrl(url: string): string {
  const path = url.split('?')[0];
  const match = path.match(/^\/api\/callbacks\/([^/]+)/);
  return match ? match[1] : 'unknown';
}
```

**按工具维度统计鉴权失败率** ——
哪个工具最容易撞上过期，一目了然。

---

## 4. 为什么这么设计

### 决策 A：为什么保活不做成工具

见 §3.2。**"refresh is plumbing, not a cognitive action"。**

**取舍**：Agent 失去了"主动刷新"的能力，
换来"不会出于错误理由调用它"和"工具列表不膨胀"。

### 决策 B：为什么降级策略必须显式声明

**取舍**：多写一行 `policy: { kind: 'none' }` vs 避免"忘了考虑"。

【推断】这个选择的价值在于**把遗漏变成编译错误**。
如果有默认值，新加一个写类工具时"没想过降级"和"想过了决定不降级"
在代码上长得一模一样。

### 决策 C：为什么 `stale_invocation` 绝对不降级

见 §3.5。**这是"宁可失败也不要写脏数据"的判断。**

**这条判断的普适性很高**：
任何"重试/降级"机制都要问一句
**"如果这次操作其实已经过时了，重试会不会造成损害？"**

---

## 5. 否掉了哪些方案

### 方案一：把刷新暴露成 MCP 工具

【源码】明确否掉：

```
Why background loop instead of猫-callable tool: refresh is plumbing, not a
cognitive action; surfacing it as an MCP tool would invite猫 to call it
proactively for the wrong reasons.
```

### 方案二：所有 401 都降级

【源码】明确区分了四类，两类不降。见 §3.5。

### 方案三：降级策略给一个默认值

【源码】`AC-E2` 明确否掉：`explicitness > silent default`。

### 方案四：从 body/query 读凭据（legacy）

【源码】还兼容但标了废弃：

```
 *  2. Fallback: read from body/query (legacy compat window, logs deprecation)
```

【推断】为什么改成 header？
① body/query 会出现在日志和 URL 里（泄露风险）
② header 是标准做法，中间件能统一处理
③ query 里的 token 会被浏览器/代理缓存

### 方案五：Native provider 自建一套回调面

**【ADR】ADR-001 F159 的否决理由：**

> **备选方案 F**：Native provider 作为独立 runtime（独立控制面 + 自建安全基线）
> 不选原因：和 F143 宿主抽象重复，**安全基线无法复用**，北向接口膨胀。

**"安全基线无法复用"这条和本模块直接相关** ——
如果 native provider 自建回调通路，
那这一整套鉴权/保活/重试/降级都要再写一遍。

---

## 6. 如果重新设计

【推断】以下全是我的方案。

### 6.1 把"两条回程通路"收敛成一条事件流

**现在的问题**：stdout 和 MCP 回调是两条独立的写入路径，
它们之间**没有事务**。所以理论上存在：

```
Agent 通过 MCP 发了一条富文本消息（已落库）
  → 然后 stdout 那边进程崩了
    → 这一轮的终态是 error，但消息已经在库里了
```

代码里能看到应对痕迹（`ensureTerminalStatus.ts`、
`cleanupStreamingOnFailure`），但那是打补丁，不是设计上的统一。

**我的方案**：两条通路都写同一个 append-only 事件日志，
消息和状态都是它的投影。

```
stdout 解析出的事件  ─┐
                     ├──→ invocation_events（append only）
MCP 回调写入的事件   ─┘         │
                                ├──→ 投影：消息列表
                                ├──→ 投影：调用状态
                                └──→ 投影：球权
```

**收益**：一致性问题从"两条路互相补偿"变成"投影是否幂等"，好推理得多。

**为什么我有信心？** 因为
[模块 10](10-模块-球权状态机.md) 已经是这个模式了，
而且它证明了在这个项目的场景下可行。

**代价**：迁移面很大（两条通路的所有写入点）。
所以我会**增量做**：先让 MCP 回调走事件日志，
stdout 保持现状，逐步迁移。

### 6.2 降级策略从"自定义函数"改成"能力等价声明"

**现在的形态**：

```ts
export type DegradePolicy =
  | { kind: 'none' }
  | { kind: 'custom'; degrade: (originalError: ToolResult) => Promise<ToolResult> };
```

**`custom` 是个任意函数** —— 这意味着：
① 没法静态分析"降级后能力差在哪"
② 每个工具的降级逻辑各写一遍
③ Agent 不知道降级后哪些功能没了

**我的方案**：声明式的能力等价。

```ts
type DegradePolicy =
  | { kind: 'none' }
  | {
      kind: 'alternate-route';
      route: string;                      // 备用端点
      // ★ 关键：显式声明能力差异
      capabilityDelta: {
        lost: string[];                   // ['rich-formatting', 'reply-threading']
        degraded: string[];               // ['delivery-latency']
      };
    };
```

**收益**：
- 降级时能在返回值里告诉 Agent"这次没有富文本了，我发的是纯文本"
- 仪表盘能显示"本周因降级损失了哪些能力"
- 静态检查能发现"这个工具的降级路由不支持它的核心能力"

**为什么值得？**
因为现在降级只标了 `DEGRADED: true`，
**Agent 知道"降级了"但不知道"降级成什么了"**——
它可能以为消息发出去了带格式，实际上是纯文本。

### 6.3 给 outbox 加"过期与放弃"的显式语义

**现在的问题**：`MAX_ATTEMPTS = 10` 之后条目怎么办？
从代码看是不再重试，但**没有明确的"放弃"通知**。

而且 outbox 条目**没有过期时间** ——
一条三天前发不出去的消息，现在发出去可能已经没意义了
（比如"我开始处理 X 了"，但 X 早就被别人做完了）。

**我的方案**：

```ts
interface OutboxEntry {
  // ...
  attempts: number;
  maxAttempts: number;
  // 新增
  expiresAt: number;              // 过期后不再投递
  onGiveUp: 'drop' | 'notify-user' | 'write-to-audit';
  semantics: 'idempotent' | 'time-sensitive';   // ★
}
```

**`semantics` 字段是关键**：

```
idempotent（如"记录一条证据"）
  → 晚发也有意义，可以长过期时间

time-sensitive（如"我开始处理了"、"请审批"）
  → 晚发有害或无意义，短过期，过期后 notify-user
```

**为什么需要？**
因为 at-least-once 的语义是"最终会送到"，
但**有些消息晚到比不到更糟**。
比如一条三天后才送达的"请审批"，用户会困惑。

### 6.4 鉴权失败的系统消息要能自愈

**现在的做法**：401 时往帖子里发一条系统消息让 Agent 看到。

**但 Agent 看到之后能做什么？** 它的 token 已经失效了，
它没法自己修。

**我的方案**：系统消息里带**可执行的恢复路径**。

```
现在：  "回调鉴权失败（token 过期）"
改成：  "回调鉴权失败（token 过期）。
        已为你签发新 token，环境变量已更新。
        请重试你的上一个操作：post_message(...)"
```

具体做法：**401 时如果 invocation 本身还有效（只是 token 过期），
服务端直接签发新 token，通过系统消息 + sidecar 文件下发。**

**收益**：从"报错让 Agent 自己想办法"变成"报错 + 修好了 + 告诉它重试"。

**代价**：需要一条"下发新 token"的通路。
sidecar 文件（Antigravity 已经在用）可以复用 ——
**这也让 sidecar 从"Antigravity 专用的 workaround"
升级成"通用的凭据下发通道"。**

### 6.5 我不会改的

| 我原本的想法 | 为什么放弃 |
|------------|-----------|
| 用 gRPC 或 WebSocket 替代 HTTP 回调 | MCP server 是短生命周期子进程，HTTP 无状态更合适；长连接的生命周期管理反而更麻烦 |
| 把保活暴露成工具（让 Agent 决定） | 【源码】理由很对：管道的事不该给模型看，会分心 |
| 降级策略给默认值（少写一行） | `explicitness > silent default` 是对的，遗漏该变成编译错误 |
| 所有 401 统一降级 | `stale_invocation` 降级会写脏数据 |
| outbox 改成内存队列（省 IO） | 进程崩了就全丢；落盘是必须的 |

---

## 7. 和其他模块怎么咬合

### 上游：环境变量这条线的起点

```
模块 05 invokeSingleCat 阶段⑤
  CAT_CAFE_INVOCATION_ID = <id>       ← 来自 InvocationRecord（ADR-008 的产物）
  CAT_CAFE_CALLBACK_TOKEN = <token>
        ↓ 子进程 env
   CLI 进程
        ↓ 继承
   mcp-server 进程
        ↓ HTTP 头
   callback-auth-prehandler
        ↓ decorate
   request.callbackAuth = InvocationRecord
        ↓
   各个 callback 路由知道"哪只 Agent、哪个帖子、代表哪个用户"
```

**这条链的起点是 `InvocationRecord` 这个抽象**——
[模块 05](05-模块-调用生命周期.md) 里 ADR-008 引入它的初衷只是
"失败能单独重试"，但它的 id 长成了整个回程通路的鉴权凭据。

### 下游：回调触发了什么

```
callback-a2a-trigger        → InvocationQueue.enqueue（agent 条目，默认路径）（模块 03/22）
callback-hold-ball          → ball.held 事件（模块 10）
callback-memory-routes      → evidence 写入（模块 09）
callback-multi-mention      → 多方询问编排（模块 03）
callback-propose-*          → approval-hub（人在环）
callback-workflow-sop       → SOP 阶段推进（模块 14）
create_rich_block           → RichBlockBuffer → 前端渲染
```

**`callback-a2a-trigger` 怎么派发下一只 Agent，经过了三代演进 —— 这是个高频追问点，要讲准：**

| 代 | 标记 | 做法 | 现状 |
|---|---|---|---|
| 一 | F27 之前 | callback 检测到 @ → spawn **独立 routeExecution** | 已废（导致 double-fire + 无限递归） |
| 二 | **F27** | callback → **`pushToWorklist`** 推入父调用的 worklist | 降级为 **legacy 兜底** |
| 三 | **F122B** | callback → **`invocationQueue.enqueue`**（`source:'agent'` / `autoExecute:true`） | **当前默认** |

`enqueueA2ATargets()`（`packages/api/src/routes/callback-a2a-trigger.ts`）的分支顺序是【源码】：

```ts
if (deps.invocationQueue) {          // ← 生产环境接线，命中这条
  // ...invocationQueue.enqueue({ source:'agent', sourceCategory:'a2a', autoExecute:true })
  return { ..., fallback: false }
}
if (hasWorklist(threadId)) {         // ← F27 legacy：只在队列依赖没注入时
  pushToWorklist(...)
  // ...
}
// 连 worklist 都没有 → triggerA2AInvocation() 起独立调用（fallback）
```

文件头注释原话【源码】：

> F122B: If InvocationQueue is available, enqueue as agent entry (unified dispatch).
> **This replaces both the worklist path and the fallback standalone invocation.**

**所以：默认是入 queue，不是直接 push worklist。** 改成入 queue 的动机是
【ADR】ADR-018 的"统一执行通道"——
push worklist 有两个问题：① 用户在队列面板看不见、没法 steer；
② 用户消息走 queue、A2A 走 worklist 是两套分发平面，排序/取消/暂停要写两遍。
标 `source:'agent'` + `autoExecute:true` 之后，用户看得见、能插队，但系统仍自动执行不用批准。

**一个容易被追到的耦合细节**【源码】：
即使派发走了 queue，**乒乓 streak 的计数状态仍挂在 `WorklistRegistry` 上** ——
queue 路径里通过 `getWorklist()` 拿 streak entry、调 `updateStreakOnPush()`
（`callback-a2a-trigger.ts` 里的 `canTrackStreak` / `streakEntry`）。
所以"派发平面"迁走了，"乒乓状态"没跟着迁。

**深度限制在 queue 路径里是 `MAX_A2A_DEPTH = 10`**（`countAgentEntriesForThread()` 每个 target 重查，防多 target 溢出）——
注意这和 [模块 04](04-模块-mention解析.md) mention 解析里的 15 是**不同口径**：
一个数队列里的 agent 条目数，一个是链深度上限。

**所以 A2A 有两条触发路径**：文本扫描（模块 04）和 MCP 回调（本模块）。
而**结构化的那条更可靠** —— 这也是我在
[模块 04](04-模块-mention解析.md) §6.1 提议
"结构化交接为主路径"的基础。

### 三根跨模块线

**线一：provider 的 MCP 能力 → 走原生还是走桥**

```
模块 06 的 provider 能力
  ├─ 原生支持 MCP（claude/codex/opencode）→ 写 MCP 配置，直接调工具
  └─ 不支持（antigravity）→ CLI 管理的 MCP 或纯回调 + sidecar
                            → 而且 prompt 要额外教它（needsMcpInjection）
```

**线二：ADR-037 的认知入口 → 工具怎么被发现**

```
新增 MCP 工具
  → 不该加到 prompt 清单（ADR-037 否决）
    → 而是改工具自己的 description + skill 文档（模块 12）
```

**线三：`evidence-coverage-nudge` → 反向影响 Agent 行为**

```
MCP 工具里有个 evidence-coverage-nudge
  → 主动提醒 Agent"你可能没查够"
    → 对抗"搜一刀就下结论"
      → 服务模块 09 的检索质量
```

**这是"工具反过来管 Agent"的例子。**

---

## 8. 面试怎么讲

### 30 秒版

见 §0。

### 3 分钟版

> "回程通路靠两个环境变量：invocationId 和 callbackToken。
> spawn CLI 时注入，CLI 传给它拉起的 MCP server，
> MCP server 拿它们作为 HTTP 头往 API 回写。
>
> 四层防护，每层都有真实的踩坑记录。
>
> **保活**：长会话里 Agent 可能几十分钟不调工具，token 会过期。
> 所以有个后台循环刷 token。这里有个 bug 我印象很深 ——
> 服务端冷却是 5 分钟，客户端算了个自适应间隔然后乘 ±15% 抖动。
> 看起来'最小 5 分钟'，但抖动下界 0.85，
> **最坏情况 4.25 分钟，低于服务端冷却**，15% 概率撞 429。
> 修法是把 MIN 预先除以抖动下界。
> 教训是：**加了抖动之后，'下界'的语义就变了**。
>
> 而且注释里明确写了为什么不把刷新做成工具：
> 'refresh is plumbing, not a cognitive action'——
> 如果暴露成工具，Agent 会出于错误理由主动调它。
> **管道的事不要给模型看。**
>
> **重试**：3 次指数退避，只重 408/429/5xx。
> 关键是每次尝试带 10 秒 AbortSignal ——
> 因为没有 AbortSignal 的 fetch 在半开 TCP 上会**永久挂起**，
> 既不 resolve 也不 reject，导致工具调用永不返回、Agent 这轮永远不结束。
> 而且注释里写了 `This callback path missed that fix`——
> 同一个 bug 在保活循环里修过一次，回调路径漏了。
>
> **outbox**：重试还失败就落盘，at-least-once。
> 写的时候先写临时文件再 rename 原子改名。
> 因为是 at-least-once，服务端必须幂等 ——
> 所以他们的 multi-mention 有 idempotencyKey、球权事件有 sourceEventId。
>
> **降级**：这层设计我觉得最好。
> 四类 401 四种处理：`expired` 和 `unknown_invocation` 可降级；
> `invalid_token` 不降（大概率客户端 bug，降级会掩盖它）；
> **`stale_invocation` 绝对不降** ——
> 因为那意味着这次调用已被更新的取代，降级会把作废状态写回去。
> **宁可失败也不要写脏数据。**
>
> 而且框架要求每个写类工具**显式声明**降级策略，
> 哪怕是 'none'。注释里写 `explicitness > silent default`——
> 不给默认值，就不会有人忘了考虑。
> 降级成功也要标 `DEGRADED: true`，否则主通路烂了都不知道。"

### 常见追问

**Q：为什么不用长连接（WebSocket/gRPC）？**

> "因为 MCP server 是**短生命周期的子进程**——
> 一次调用起一个，调用结束就没了。
>
> 长连接的价值是省握手开销，但代价是要管连接生命周期：
> 断线重连、心跳、连接池。对一个活几分钟的进程来说不值。
>
> 而且 HTTP 无状态刚好匹配这个场景 ——
> 每次调用带 invocationId + token，服务端不需要维护会话状态。
>
> 不过我会考虑给**云端 Agent** 用长连接 ——
> 那些是常驻的（跑在浏览器 ChatGPT 里通过 Remote MCP 反向连），
> 生命周期完全不同。"

**Q：at-least-once 会导致重复数据吗？**

> "会，所以服务端必须幂等。他们在三个地方做了：
> multi-mention 有 `idempotencyKey`、
> 球权事件有 `sourceEventId`、
> 消息入队有 `idempotencyKey`（ADR-008 D2）。
>
> **这三个设计是配套的** —— 只做 outbox 不做幂等等于制造重复数据。
>
> 不过我觉得 outbox 缺一样东西：**过期语义**。
> 现在最多重试 10 次，但条目没有过期时间。
> 一条三天前发不出去的'我开始处理 X 了'，现在送达可能已经有害了
> —— 因为 X 早就被别人做完了。
>
> 我会给 outbox 条目加 `semantics: 'idempotent' | 'time-sensitive'`：
> 幂等的（记录证据）可以长过期；
> 时效性的（请审批、进度汇报）短过期，过期后通知用户而不是静默丢。"

**Q：如果 MCP server 起不来怎么办？**

> "对不支持 MCP 的 provider，本来就没有 MCP server ——
> 那条路是纯 HTTP 回调 + sidecar 文件传凭据。
>
> 对支持的 provider，如果 MCP server 起不来，
> Agent 就调不到 `cat_cafe_*` 工具。它会退化成
> '只能通过 stdout 说话'的状态 —— 能回复但不能写数据。
>
> 这个失败**目前是可见的**（Agent 会在工具列表里找不到工具，
> 而且有 `claude-mcp-status.ts` 在检查），但我觉得可以更好：
> 我会在 prompt 里显式告诉 Agent'本次 MCP 不可用，
> 你只能用文本表达意图，比如行首 @ 交接'——
> 让它主动降级表达方式，而不是调工具失败几次才发现。"

**Q：401 时 Agent 能做什么？**

> "现在的做法是往帖子里发一条系统消息让它看到 ——
> 因为工具返回的错误可能被忽略，但对话流里的系统消息下一轮一定会看到。
>
> 这里有个实现坑挺有意思：`verify()` 在发现 token 过期时会顺手删记录，
> 但通知器需要那条记录才知道往哪个帖子发消息。
> 所以专门加了个只读不删的 `peekRecord()`。
> **'清理'和'诊断'是冲突的需求，得分开两个方法。**
>
> 但我觉得现在的体验还不够 —— **Agent 看到'token 过期'之后能做什么？
> 它没法自己修。**
>
> 我会让系统消息带可执行的恢复路径：
> 401 时如果 invocation 本身还有效（只是 token 过期），
> 服务端直接签发新 token，通过 sidecar 文件下发，
> 消息改成'已为你签发新 token，请重试上一个操作'。
> 从'报错让它自己想办法'变成'报错 + 修好了 + 告诉它重试'。
>
> 顺带这也让 sidecar 从'Antigravity 专用的 workaround'
> 升级成'通用的凭据下发通道'。"

---

## 9. 本模块要点

| 要点 | 内容 |
|------|------|
| **两把钥匙** | invocationId（单次） + agent-key（长期，含 sidecar） |
| **保活是管道不是认知** | 不暴露成工具，防 Agent 出于错误理由调用 |
| **抖动下界要预除** | `MIN × buffer / JITTER_FLOOR`；加抖动后"下界"语义就变了 |
| **为什么要抖动** | 防多 Agent 同时启动的惊群 |
| **纯函数化时序计算** | `computeNextRefreshDelay` 不需要 timer 就能测 |
| **fetch 必须带 AbortSignal** | 半开 TCP 会让工具调用永久挂起 |
| **同一 bug 漏修一处** | 保活修过，回调路径漏了 |
| **未知 reason 不强转** | 宁可"不知道原因"也不要"错认原因" |
| **outbox = 落盘 + rename 原子写** | at-least-once → 服务端必须幂等 |
| **重试 vs 降级分层** | 瞬时归重试，永久归降级，不重叠 |
| **四类 401 四种处理** | expired/unknown 可降；invalid_token 不降（会掩盖 bug）；**stale 绝不降** |
| **explicitness > silent default** | 每个写类工具必须声明策略 |
| **降级要留痕** | `DEGRADED:true`，否则主通路烂了都不知道 |
| **propose-\* 路由** | 人在环：改用户相关的东西必须提议 |
| **peek vs get** | 清理和诊断冲突，分两个方法 |
| **我的改进** | 两通路收敛成事件流 / 降级声明能力差异 / outbox 加过期语义 / 401 自愈 |

---

→ [14 SOP 门禁](14-模块-SOP门禁.md)
