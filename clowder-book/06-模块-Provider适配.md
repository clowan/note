# 06 · 模块：Provider 适配层

> 这是"选了 CLI 子进程"的**账单**：六种 CLI、五种输出格式、五千多行适配代码。
>
> 但它不只是脏活。里面有一个我认为设计得非常好的东西 ——
> **载体降级链**（carrier degradation chain）：
> 同一个 Claude 有四种调用方式，健康度不好就自动往下降。

---

## 0. 30 秒电梯版

> "六种 Agent CLI，五种输出格式（stream-json / json / ndjson / plain text / ACP），
> 全部收敛成一种统一的 `AgentMessage` 流。
>
> 最难的是 Antigravity CLI —— 它只有 `agy --print`，**纯文本输出**，
> 没有结构化事件、没有工具调用边界、没有 token 统计。
> 所以有一套 `agy-trajectory-extractor` / `observer` 专门**从纯文本里反推轨迹**。
> 这也是为什么 `GeminiAgentService.ts` 是最长的那个文件，1569 行。
>
> 里面有个设计我特别喜欢：**载体降级链**。
> 同一个 Claude 有四种调用方式 —— 后台守护、交互式 PTY、`--print`、API key，
> 按健康度自动降级。而且失败分三类：额度问题贴 4 小时、
> 结构性问题贴 30 分钟、瞬时问题不降级但三次累积升级成结构性。"

---

## 1. 它解决什么问题

上游给你的东西长得完全不一样：

```
claude --output-format stream-json
  → {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
  → {"type":"assistant","message":{"content":[{"type":"tool_use",...}]}}
  → 结构化、有工具边界、有 token 统计

codex exec --json
  → 另一套 JSON schema

opencode
  → NDJSON，第三套 schema

agy --print
  → "我看了一下这个文件，发现问题在第 42 行。让我改一下…"
  → 就是纯文本。没有任何结构。

gemini --acp
  → ACP 协议（JSON-RPC 风格）

kimi
  → 又一套
```

**上层（路由、落库、前端）只想认一种格式。**

---

## 2. 不做会怎样

### 场景 A：不做统一抽象

```
route-serial.ts 里会变成：
  if (catId === 'opus') { /* 解析 stream-json */ }
  else if (catId === 'codex') { /* 解析 codex json */ }
  else if (catId === 'gemini') { /* 从纯文本猜 */ }
  ...
```

**每加一个上层功能（比如"检测富文本块"），都要在六个分支里各写一遍。**
这就是 [模块 03](03-模块-路由与编排.md) §3.5 说的"7 轮 review 才收敛"的同类问题。

### 场景 B：上游改格式

```
Claude 2.1.172 之后，交互式 TUI 不再写 transcript 文件
  → 如果解析逻辑散在各处，要改 N 个地方
  → 而且不知道哪些地方依赖了这个行为
```

**有了独立的 provider 类，改动圈在一个文件里。**

### 场景 C：某种调用方式坏了

```
Claude 的后台守护模式（--bg）因为某个版本 bug 起不来
  → 如果只有一种调用方式，这只 Agent 直接不可用
  → 用户什么都干不了
```

**所以需要降级链。**

---

## 3. 怎么设计的

### 3.1 统一接口

所有 provider 实现同一个接口【源码】：

```ts
export interface AgentService {
  /**
   * Invoke the agent with a prompt and stream back messages
   */
  invoke(prompt: string, options?: AgentServiceOptions): AsyncIterable<AgentMessage>;

  /**
   * F203 Phase C — whether this provider injects the L0 static identity into
   * its native system role (e.g. Claude `--system-prompt-file`, Codex
   * `-c developer_instructions`). When true, the routing layer passes a
   * pack-only `systemPrompt` (non-pack identity travels the native channel,
   * compression-immune); when false/undefined the routing layer keeps the
   * full static identity in `params.systemPrompt` so cats with no native
   * channel still receive identity/家规 via user-message prepend.
   */
  // nativeL0Injection?: boolean
}
```

**注意第二个成员的注释，这是个很重要的能力协商机制**：

```
Provider 说"我有原生的 system 通道"
  → 路由层把身份走原生通道（Claude 的 --system-prompt-file / Codex 的 developer_instructions）
  → 好处：compression-immune（压缩摘不掉 system 角色的内容）

Provider 说"我没有"
  → 路由层把身份塞进用户消息前面
  → 坏处：会被压缩摘掉 → 所以更依赖 [模块 08](08-模块-会话与抗压缩.md) 的三道防线
```

**这是"能力协商"的雏形** —— provider 声明自己支持什么，
上层据此调整行为。我在 §6 会说这个思路应该推广。

### 3.2 `AgentServiceOptions`：一份字段清单

```ts
export interface AgentServiceOptions {
  sessionId?: string;                    // resume 用
  workingDirectory?: string;
  callbackEnv?: Record<string, string>;  // ★ MCP 回调凭据
  accountEnv?: Record<string, string>;   // 用户自定义 env，最后应用，覆盖一切
  contentBlocks?: readonly MessageContent[];   // 图片等
  uploadDir?: string;
  signal?: AbortSignal;
  auditContext?: AuditContext;
  systemPrompt?: string;                 // Claude 走 --append-system-prompt，others prepend
  resumeFallbackSystemPrompt?: string;   // ★ resume 失败退化成新 session 时用
  spawnCliOverride?: SpawnCliOverride;   // tmux 场景
  agyLogPathOverride?: string;           // Antigravity 的 log 路径（测试缝）
  invocationId?: string;
  cliSessionId?: string;
  livenessProbe?: {                      // ★ 探活配置
    sampleIntervalMs?: number;
    softWarningMs?: number;
    stallWarningMs?: number;
    boundedExtensionFactor?: number;
    minCpuGrowthMs?: number;
    stallAutoKill?: boolean;             // #774: idle-silent 直接杀，不等满超时
  };
}
```

**三个字段值得单独讲：**

**① `accountEnv` 的应用顺序**

```ts
/** F171: User-defined env vars from account config.
 *  Applied LAST to subprocess env — overrides provider-injected values. */
```

**用户配的环境变量最后应用，可以覆盖系统注入的。**
这是个信任选择：用户知道自己在干什么。

**② `resumeFallbackSystemPrompt`**

```ts
/** Static identity prompt used only if a resumed carrier creates a fresh fallback session. */
```

**大白话**：正常 resume 不需要重注入身份（省 token），
但如果 resume 失败退化成新 session 了，就必须注入。
所以准备两份 prompt，用哪份取决于运行时发生了什么。

**这个细节体现了 resume 的不可靠性** —— session 文件可能被删、
CLI 版本可能变、session id 可能过期。

**③ `livenessProbe` 的 CPU 增长判据**

```ts
minCpuGrowthMs?: number;
```

【推断】判"卡死"不能只看有没有输出 ——
Agent 可能在跑一个 5 分钟的编译，没输出但 CPU 在转。
**看 CPU 增长能区分"在干活"和"真卡了"。**

`stallAutoKill` 那条注释更直接：

```ts
/** #774: Auto-kill on idle-silent suspected_stall instead of waiting for full timeout */
```

**"idle-silent"（既不输出也不用 CPU）直接杀，不等满超时。**
这能把卡死的恢复时间从"等满超时"缩短到"探测出来就杀"。

### 3.3 每个 provider 的规模

| 文件 | 行数 | 输出格式 | 难点 |
|------|------|---------|------|
| `GeminiAgentService.ts` | 1569 | stream-json / ACP / **plain** | 三种通路 + 从纯文本反推 |
| `CodexAgentService.ts` | 1335 | json | 配置迁移（env → --config） |
| `ClaudeAgentService.ts` | 957 | stream-json | 四种载体 |
| `ClaudeBgCarrierService.ts` | 709 | — | 后台守护模式 |
| `OpenCodeAgentService.ts` | 605 | ndjson | 要写配置文件 |
| `ClaudeInteractivePtyCarrierService.ts` | 450 | — | PTY + hook sidechannel |
| `KimiAgentService.ts` | 450 | — | — |
| `acp/AcpAgentService.ts` | — | ACP | JSON-RPC 协议 |
| `A2AAgentService.ts` | — | 内部 | Agent 之间 |

周边文件：

```
claude-ndjson-parser.ts       gemini-event-parser.ts
codex-event-transform.ts      opencode-event-transform.ts
antigravity-cli-event-parser.ts   kimi-event-parser.ts
opencode-config-writer.ts     opencode-config-template.ts
agy-profile-manager.ts        agy-trajectory-extractor.ts / observer.ts
claude-carrier-factory.ts     carrier-health.ts
codex-audit-hooks.ts          codex-session-context-snapshot.ts
env-map.ts                    l0-compiler.ts
pty/PtyDriver.ts              pty/pty-utils.ts
```

### 3.4 最难的一个：从纯文本反推轨迹

`agy --print` 只给纯文本。但上层需要知道：

```
Agent 调了哪些工具？        → 前端要显示工具卡片
读了哪些文件？             → 记忆系统要记录（consumption 遥测）
花了多少 token？           → 成本统计 + 封存阈值判断
现在进行到哪一步了？        → 进度显示
```

**这些信息在纯文本里只能猜。** 所以有：

```
agy-trajectory-extractor.ts   从文本里抽轨迹
agy-trajectory-observer.ts    704 行 —— 轮询观察
```

`observer` 里有个注释很有代表性【源码】：

```ts
 * 每 pollIntervalMs 解析一次 DB 路径（agy 早期把 cascade UUID 写进 log），解析到就用
```

**"agy 早期把 cascade UUID 写进 log"** ——
它是靠**从日志里捞 UUID**来定位 Antigravity 的内部数据库，
然后从数据库里读结构化数据。

**这是典型的"逆向工程上游"**。风险很明显：
上游改了日志格式，这条路就断了。

**面试可以这么讲**：

> "最难的是 Antigravity CLI，它只有 `agy --print`，纯文本输出。
> 但上层需要知道它调了哪些工具、读了哪些文件、花了多少 token。
>
> 他们的做法是从日志里捞 cascade UUID，
> 用它定位 Antigravity 的内部数据库，再从数据库读结构化数据。
> 注释里写了'agy 早期把 cascade UUID 写进 log'——
> **典型的逆向工程上游**。
>
> 这也是为什么 `GeminiAgentService.ts` 是最长的那个文件（1569 行）。
> 而且风险很直白：上游改了日志格式这条路就断了。
> 我认为这块最该补的是契约测试 —— 定期用真实 CLI 抓输出、
> 和 fixture 对比，现在完全靠用户报障发现。"

### 3.5 载体降级链：本模块最好的设计

**这是我在整个项目里最欣赏的几个设计之一。**

同一个 Claude 有四种调用方式，能力和可靠性各不相同：

```ts
/** Fixed degradation chain (D3). bg is primary, api_key is last resort. */
export const DEGRADATION_CHAIN: CarrierTier[] =
  ['bg_daemon', 'interactive_pty', 'print_sdk', 'api_key'];
```

| 载体 | 是什么 | 为什么排这个位置 |
|------|--------|----------------|
| `bg_daemon` | `--bg` 后台守护 | 首选：不占前台、能长跑 |
| `interactive_pty` | 伪终端 + hook sidechannel | 备选：**任何 claude 版本都能用** |
| `print_sdk` | `-p` / `--print` | 再备选：最简单最稳，但功能少 |
| `api_key` | 直接调 API | 最后手段：要付 API 费用 |

**注意最后一档是 `api_key`** —— 也就是 [模块 02](02-决策-为什么选CLI子进程.md)
里被否掉的方案，在这里作为**最后的救命通路**回来了。

**这是个很成熟的处理**：主张"不用 API"不等于"永不用 API"，
而是"API 是保命的最后一档"。

### 3.6 失败分类：三类，三种粘性

```ts
/**
 * D1 — Failure classification:
 *   quota (sticky 4h) / structural (sticky 30min) / transient (no degrade, 3x→structural)
 * D2 — Health state is per-carrier global, not per-cat
 *      (quota = account-level, binary = machine-level)
 * D3 — Degradation chain: bg_daemon → interactive_pty → print_sdk → api_key
 * D4 — Degradation yields visible system_info carrier_fallback event (NOT suppressed)
 */
export type FailureClass = 'quota' | 'structural' | 'transient';

/** Quota TTL: 4 hours (D1). Quota is account-level — once hit, all cats are blocked. */
const QUOTA_TTL_MS = 4 * 60 * 60 * 1000;

/** Structural TTL: 30 minutes (D1). Binary/config issues may self-heal after deploy/restart. */
const STRUCTURAL_TTL_MS = 30 * 60 * 1000;
```

**逐条用大白话讲清楚，这段面试很值：**

**① 三类失败，三种处理**

```
quota（额度用完）
  → 贴 4 小时。因为额度是按小时/天重置的，短时间重试没意义。

structural（二进制找不到、配置错了）
  → 贴 30 分钟。因为部署/重启可能自愈。

transient（网络抖动、偶发超时）
  → 不降级。但累积 3 次升级成 structural。
```

**"transient 累积 3 次升级成 structural"这个设计很关键**：
它区分了"偶发"和"持续偶发"。
一次网络抖动不该降级，但如果每次都抖动，那就不是偶发了。

**② 健康状态是 per-carrier 全局，不是 per-cat**

```
/**
 * D2 — Health state is per-carrier global, not per-cat
 *      (quota = account-level, binary = machine-level)
 */
```

**为什么？** 因为：
- 额度是**账号级**的 —— opus 用完了额度，opus-47 也用完了（同一个账号）
- 二进制是**机器级**的 —— claude 命令找不到，对所有 Agent 都找不到

**如果做成 per-cat，每只 Agent 都要自己撞一次墙才知道降级。**

**③ 降级要可见**

```
/**
 * D4 — Degradation yields visible system_info carrier_fallback event (NOT suppressed)
 */
```

**"NOT suppressed" 全大写强调。**
这又是"降级必须可见"这条原则（见 [模块 11](11-模块-跨模型互审.md)、
[模块 13](13-模块-MCP回调桥.md)，同一原则在项目里出现了至少四次）。

**为什么必须可见？** 因为降级会改变行为：
`print_sdk` 的功能比 `bg_daemon` 少，`api_key` 要花钱。
用户有权知道现在走的是哪档。

**④ 内存缓存 + Redis 异步同步**

```
 * Architecture: in-memory state with fire-and-forget Redis sync for restart persistence.
 * Factory reads from in-memory cache (sync). On failure, writes to both memory and Redis.
```

**为什么工厂读内存不读 Redis？**
因为选载体在关键路径上，不能为了读健康状态多一次网络往返。
Redis 只用来跨重启持久化。

**这是个很实用的模式**：热路径读内存，冷路径（重启恢复）读 Redis。

### 3.7 一个回归钉

```
 * AC-B8 regression pin: no env var + no health state = ClaudeAgentService (-p default).
 * All existing behavior unchanged when no failures are reported.
```

**"regression pin"** —— 加了这么复杂的降级机制，
必须保证"什么都没配 + 什么都没坏"的情况下行为完全不变。

**这是引入复杂机制时的标准做法**，面试里提一句能体现工程素养。

---

## 4. 为什么这么设计

### 决策 A：为什么每个 provider 一个独立的大类

【ADR】ADR-001 的缓解措施第 1 条：

> 为每个 CLI 编写独立的 `AgentService` 类 + `CliTransformer`，隔离差异

**取舍**：接受代码重复，换变化隔离。

**这个取舍在什么条件下是对的？**【推断】

```
✅ 对：差异是本质的、不可预测的、会独立演化的
   → 五种输出格式确实是本质差异
   → 上游各自演化，不可能同步

❌ 错：差异是配置性的、可枚举的
   → 那应该做成配置表
```

**现状是"两者都有"** —— 输出解析是本质差异，
但"怎么拼命令行参数""怎么写 MCP 配置"其实是配置差异。
这就是我在 §6 要改的地方。

### 决策 B：为什么降级链是固定顺序而不是动态评分

```ts
/** Fixed degradation chain (D3). */
```

【推断】固定顺序的好处：**可预测、可解释**。
用户看到"降级到 print_sdk"能立刻知道发生了什么。

动态评分（比如按成功率排序）会导致"为什么这次选了这个"很难解释，
而且评分数据本身需要足够样本。

**对一个本地工具来说，可解释性比最优性重要。**

### 决策 C：为什么 quota 是 4 小时，structural 是 30 分钟

【推断】这两个数字对应两种自愈机制：

```
quota    → 靠时间自愈（额度按小时/天重置）→ 贴长一点
structural → 靠人为动作自愈（重装、改配置、重启）→ 贴短一点，好让人验证修好了
```

**如果 structural 也贴 4 小时**，用户修好了配置还要等 4 小时才生效 ——
体验很差。

---

## 5. 否掉了哪些方案

### 方案一：只做一个通用的 CLI 适配器

【推断】项目没有明确记录，但从形态看显然考虑过又放弃了。

**为什么不行？** 因为"通用"要求差异可枚举，
但 Antigravity 的纯文本输出**根本没有可枚举的结构**。
一个通用适配器无法同时处理"解析 JSON 事件"和"从文本反推轨迹"。

### 方案二：让所有 CLI 都走 ACP 协议

【ADR】ADR-001 的 F210 更新注释里有线索：

> `GeminiAgentService` 的非 ACP 默认 headless carrier
> 已从 `gemini-cli` 切到 `antigravity-cli` / `agy --print`。
> 但 catalog 配了 `acp` section 的Siamese仍优先走 `GeminiAcpAdapter` / `gemini --acp`，
> **直到 `agy` 暴露受支持的 ACP server mode**。

**大白话**：ACP 是更好的协议（结构化、双向），
他们**想**都走 ACP，但 `agy` 不支持。所以只能双通路并存。

**这是"想统一但上游不配合"的典型案例**，面试里讲很有说服力：

> "他们其实想统一走 ACP 协议 —— 那个是结构化的、双向的，
> 比解析纯文本好太多。ADR 里写了'直到 agy 暴露受支持的 ACP server mode'，
> 说明这是个等待上游的状态。
>
> 所以现在是：配了 ACP 的走 ACP，没配的走纯文本 + 反推。
> **这不是他们的设计选择，是上游能力的映射。**
> 这也印证了这个架构最大的风险 —— 能力上限取决于上游暴露了什么。"

### 方案三：账号级 protocol 配置

【源码】有明确的"废弃"痕迹：

```ts
// clowder-ai#340: Protocol is fully derived from client/provider identity — account.protocol retired.
```

```ts
// opencode-config-template.ts
 * Account-level protocol is no longer used — it was removed from the UI and
```

**大白话**：原来允许在账号上配"用哪个协议"，后来废了 ——
协议完全由 client/provider 身份推导。

【推断】**为什么废掉？**
因为"账号"和"协议"是两个正交的东西，让用户配会产生非法组合
（比如给 Claude 账号配 ACP 协议）。
**能推导的东西不要让用户配** —— 这是个通用原则。

### 方案四：native provider 作为独立 runtime

【ADR】ADR-001 F159 的否决理由：

> **备选方案 F**：Native provider 作为独立 runtime（独立控制面 + 自建安全基线）
> 不选原因：和 F143 宿主抽象重复，安全基线无法复用，**北向接口膨胀**。

**"北向接口膨胀"**：如果新 provider 自己开一套对外 API，
那系统就有两个入口，所有上层功能都要适配两次。
所以它必须实现同一个 `AgentService.invoke()` 门面。

---

## 6. 如果重新设计

【推断】以下全是我的方案。

### 6.1 能力矩阵 + 解析器：把配置差异和本质差异分开

**观察**：六个 provider 里，只有两步是真差异。

```
每个 AgentService 都要做：
  ├─ 解析账号凭据       逻辑几乎一样        ← 配置差异
  ├─ 决定新开还是 resume 差异只在参数写法    ← 配置差异
  ├─ 写 MCP 配置        差异在路径和格式    ← 配置差异
  ├─ 拼命令行 + spawn   差异在参数拼法      ← 配置差异
  ├─ 解析输出           ★ 真差异
  └─ 映射成 AgentMessage ★ 真差异
```

**我的方案**：

```ts
// 声明式的能力描述（配置差异都进这里）
interface CliCapability {
  command: string;                        // 'claude' | 'codex' | 'agy'
  outputFormat: 'stream-json' | 'json' | 'ndjson' | 'plain' | 'acp';

  // resume 怎么表达
  resume: { style: 'flag'; flag: string }        // claude --resume <id>
        | { style: 'config'; key: string }        // codex -c session=<id>
        | { style: 'none' };                      // 不支持

  // MCP 怎么接
  mcp: { kind: 'native-flag'; flag: string }
     | { kind: 'config-file'; path: string; format: 'json' | 'toml' }
     | { kind: 'none' };                          // → 走回调桥（模块 13）

  // 原生 system 通道（对应现在的 nativeL0Injection）
  systemChannel?: { flag: string; compressionImmune: boolean };

  hooks: readonly ('PreCompact' | 'SessionStart' | 'Stop' | 'PostToolUse')[];
  contextWindow: number;
  sealThresholds: { warn: number; action: number };
  carriers?: readonly CarrierTier[];              // 有几种载体
}

// 只有这个需要各写一份
interface OutputParser {
  parse(chunk: string, state: ParserState): { messages: AgentMessage[]; state: ParserState };
}
```

**收益**：加一个新 CLI 从"写 1500 行"变成"填一个配置 + 写一个 parser"。

**代价**（必须一起说）：
抽象一旦不够用，会出现绕过抽象的特例分支，反而更难读。
所以**能力矩阵的字段必须从真实差异里长出来，不能提前设计**。

**这也解释了为什么项目现在是那个形态**：
它是在不知道会接六种 CLI 的时候一个个加起来的。
**先写六遍再抽象，比先抽象再往里塞，是对的顺序。**

### 6.2 契约测试 + 定期真机抓样本

**这是我认为投入产出比最高的一个改进。**

**现在的问题**：上游改格式 → 线上才发现 → 紧急修。
证据链（都是【源码】）：

```
"Required for claude 2.1.172+ where interactive TUI no longer writes transcripts."
"Codex CLI deprecated OPENAI_BASE_URL env var."
"Google consumer Gemini CLI 在 2026-06-18 停止服务"
```

**我的方案**：

```
tests/contracts/
├── fixtures/
│   ├── claude-2.1.172-stream-json.jsonl      真实抓取的输出
│   ├── codex-0.x-json.jsonl
│   ├── agy-print-plain.txt
│   └── ...
├── contract.test.ts
│   每个 fixture 必须解析成预期的 AgentMessage 序列
└── freshness.cron.ts
    每周用真实 CLI 跑一个最小任务 → 抓输出 → 和 fixture diff
    → 不一致就告警（不是失败，因为可能是合法的新增字段）
```

**关键设计**：定期任务**告警而不是失败**。
因为上游新增字段是合法的（向后兼容），
只有"我们依赖的字段消失了"才是问题。

**收益**：把"发现延迟"从几周压到几天。

**为什么这个改进值？**
因为格式漂移是这个架构**唯一的系统性风险**
（见 [模块 02](02-决策-为什么选CLI子进程.md) §5 风险二），
而现在它完全靠用户报障应对。

### 6.3 把载体降级链推广到所有 provider

**现在只有 Claude 有四种载体和降级链。** 其他 provider 是单一通路。

**我会把它做成通用机制**：

```ts
interface CarrierChain {
  provider: string;
  tiers: readonly {
    id: string;
    capability: CliCapability;    // 每档载体的能力可能不同
    cost: 'subscription' | 'api-key';
  }[];
}
```

**为什么值得？** 因为其他 provider 也会挂：
Codex CLI 版本冲突、opencode 配置写坏、Gemini 额度用完。
现在这些情况只能报错给用户，不能自动降级。

**而且能力可能不同这一点很重要**：
比如从 `bg_daemon` 降到 `print_sdk`，某些功能没了 ——
上层应该知道这一点（通过 `capability` 字段），
而不是调了发现不支持才报错。

### 6.4 给纯文本 provider 一个"结构化补丁通道"

**现在的问题**：Antigravity 只有纯文本，所以要逆向工程它的内部数据库。

**我的方案**：既然它支持 MCP（通过 CLI 管理），
就让它**主动通过 MCP 汇报结构化信息**：

```
Agent 在 prompt 里被要求：
  "每次调用工具后，用 report_tool_use({ tool, target, result }) 汇报"
  → 结构化数据通过 MCP 回调回来
  → 不需要从文本反推
```

**这符合项目自己的方向** ——
[模块 13](13-模块-MCP回调桥.md) 的回调桥就是为"CLI 能力不够"设计的。

**代价**：依赖模型配合（它可能忘了汇报），所以文本反推要保留为兜底。
**但主路径干净了。**

（这和我在 [模块 04](04-模块-mention解析.md) §6.1 提的
"结构化交接优先，文本扫描兜底"是同一个思路 ——
**能让模型主动给结构化数据，就不要从文本里猜。**）

### 6.5 我不会改的

| 我原本的想法 | 为什么放弃 |
|------------|-----------|
| 全部走 ACP 统一协议 | 上游不支持（`agy` 没有 ACP server mode），不是设计问题 |
| 降级链改成动态评分 | 可解释性对本地工具更重要；固定链用户能立刻理解 |
| 健康状态改成 per-cat | 额度是账号级、二进制是机器级，per-cat 会让每只 Agent 各撞一次墙 |
| 把 API key 从降级链去掉 | 它是保命的最后一档；"不用 API"不等于"永不用 API" |

---

## 7. 和其他模块怎么咬合

### 上游

```
invokeSingleCat（模块 05）
  ├─ resolveBuiltinClientForProvider()   决定用哪个 provider
  ├─ claude-carrier-factory              Claude 还要选载体
  └─ service.invoke(prompt, options)
```

### 下游

```
provider.invoke() 产出 AgentMessage 流
  ├─ route-serial / route-parallel 消费     累积文本、转发前端
  ├─ parseA2AMentions 扫最终文本            模块 04
  ├─ RichBlockBuffer 提取富文本块
  ├─ ToolSpanTracker 记工具调用             遥测
  ├─ contextHealth 上报                     模块 08 判断要不要封存
  └─ tokenUsage 上报                        成本统计
```

### 三根跨模块的关键线

**线一：`nativeL0Injection` → 身份注入策略**

```
Provider 声明有原生 system 通道
  → 模块 07 把身份走原生通道（compression-immune）
  → 模块 08 的抗压缩压力变小

Provider 声明没有
  → 模块 07 把身份塞进用户消息前面
  → 会被压缩摘掉 → 模块 08 的三道防线更关键
```

**这是"provider 能力"直接决定"上层策略"的例子。**

**线二：`HOOK_CAPABLE_PROVIDERS` → 会话策略上限**

```ts
/** Providers that support compression event signaling (PreCompact hook) */
const HOOK_CAPABLE_PROVIDERS = new Set(['anthropic']);
```

```
只有 Claude 有 PreCompact hook
  → 只有 Claude 能用 hybrid 策略（允许 N 次压缩再封存）
  → 其他 provider 只能用 handoff（到阈值直接换 session）
```

**这是全项目最精确的一句"能力上限取决于上游"的证明。**

**线三：`mcp` 能力 → 走 MCP 还是走回调桥**

```
Provider 原生支持 MCP（claude/codex/opencode）
  → 写 MCP 配置，Agent 直接调 cat_cafe_* 工具

Provider 不支持（antigravity）
  → 走 CLI 管理的 MCP，或者纯回调桥（模块 13）
  → 而且 prompt 里要额外教它怎么调（needsMcpInjection）
```

### 每个 provider 的差异如何影响封存阈值

```ts
const DEFAULT_STRATEGY_BY_PROVIDER: Record<string, SessionStrategyConfig> = {
  anthropic: { thresholds: { warn: 0.80, action: 0.90 }, ... },
  openai:    { thresholds: { warn: 0.75, action: 0.85 }, ... },
  google:    { thresholds: { warn: 0.55, action: 0.65 }, ... },   // ← 明显保守
  opencode:  { thresholds: { warn: 0.75, action: 0.85 }, ... },
};
```

**Gemini 的阈值比别人保守 20 个百分点。**

【推断】为什么？因为 Antigravity 是纯文本输出，
**token 计数只能估算**（不像 stream-json 有精确的 usage 字段）。
估算不准就要留更大的安全边际。

**这条线很能说明问题**：
"输出格式"这个看起来很底层的差异，
一路影响到了"什么时候封存会话"这个很上层的策略。

而且还有个遥测指标叫 `geminiContextFallback`——
专门记录 Gemini 路径上上下文估算的 fallback 次数，印证了这个推断。

---

## 8. 面试怎么讲

### 30 秒版

见 §0。

### 3 分钟版

> "六种 CLI、五种输出格式，全部收敛成一种 `AgentMessage` 流。
> 每个 provider 一个独立类 —— 接受代码重复，换变化隔离。
>
> **最难的是 Antigravity**，它只有 `agy --print`，纯文本。
> 但上层需要知道它调了哪些工具、读了哪些文件、花了多少 token。
> 他们的做法是从日志里捞 cascade UUID，
> 用它定位 Antigravity 的内部数据库，再读结构化数据 ——
> 典型的逆向工程上游。这也是 `GeminiAgentService.ts` 有 1569 行的原因。
>
> **我最欣赏的设计是载体降级链。**
> 同一个 Claude 有四种调用方式：后台守护、交互式 PTY、`--print`、API key，
> 按健康度自动往下降。
> 而且失败分三类：额度问题贴 4 小时（因为额度按时间重置）、
> 结构性问题贴 30 分钟（因为重启可能自愈）、
> 瞬时问题不降级但累积 3 次升级成结构性。
> 健康状态是 per-carrier 全局的不是 per-cat 的 ——
> 因为额度是账号级、二进制是机器级，per-cat 会让每只 Agent 各撞一次墙。
>
> 有个细节我觉得很成熟：**降级链的最后一档是 api_key**——
> 也就是他们 ADR 里否掉的那个方案。
> 主张'不用 API'不等于'永不用 API'，而是'API 是保命的最后一档'。
>
> 还有个通用原则在这也出现了：降级必须可见。
> 注释里写着 `Degradation yields visible system_info carrier_fallback event (NOT suppressed)`，
> NOT suppressed 是全大写强调的。"

### 常见追问

**Q：上游改了输出格式怎么办？**

> "现在是靠用户报障 + 紧急修。代码里能看到三次真实案例：
> Claude 2.1.172 之后交互式 TUI 不再写 transcript 文件、
> Codex 废弃了 `OPENAI_BASE_URL` 环境变量、
> 最狠的是 Google 在 2026-06-18 直接停了 consumer Gemini CLI 的服务，
> 他们只能把整条默认通路切到 Antigravity。
>
> 缓解措施是每个 provider 一个独立类 —— 变化的爆炸半径圈在一个文件里。
>
> 但我认为最该补的是**契约测试**：
> 把真实抓取的输出存成 fixture，每个 fixture 必须能解析成预期的消息序列；
> 再加一个定期任务，每周用真实 CLI 跑一个最小任务、抓输出、和 fixture diff。
>
> 关键是这个定期任务应该**告警而不是失败** ——
> 因为上游新增字段是合法的，只有'我们依赖的字段消失了'才是问题。
> 这样能把发现延迟从几周压到几天。"

**Q：为什么不做一个通用适配器？**

> "因为差异不是配置性的。Antigravity 的纯文本输出根本没有可枚举的结构 ——
> 一个通用适配器没法同时处理'解析 JSON 事件'和'从文本反推轨迹'。
>
> 不过我认为可以**部分抽象**。我数了下，每个 provider 的六个步骤里
> 只有两步是真差异：解析输出、映射成消息。
> 另外四步（凭据解析、resume 参数、MCP 配置、命令行拼装）是配置差异。
>
> 所以我会做成'能力矩阵 + 解析器'：配置差异进一张声明式的表，
> 公共流程写一遍读这张表；只有 parser 各写一份。
> 加一个新 CLI 从写 1500 行变成填配置 + 写 parser。
>
> 但我要说清楚代价：抽象不够用的时候会出现绕过抽象的特例分支，反而更难读。
> 所以**先写六遍再抽象是对的顺序** —— 他们现在的形态是历史演进的结果，
> 不是设计失误。"

**Q：这个模块的差异会影响到多上层的东西？**

> "比我想的深。我举个具体的链条：
>
> Antigravity 是纯文本输出 → token 计数只能估算 →
> 估算不准要留安全边际 → 所以 Gemini 的会话封存阈值是 0.55/0.65，
> 比 Claude 的 0.80/0.90 保守了整整 20 个百分点。
> 而且有个专门的遥测指标叫 `geminiContextFallback` 记录估算 fallback 次数。
>
> 还有一条更狠的：只有 Claude Code 有 `PreCompact` hook，
> 所以'允许 N 次压缩再封存'这个 hybrid 策略只有 Claude 能用，
> 其他 provider 只能用更粗的'到阈值直接换 session'。
> 代码里有一行 `const HOOK_CAPABLE_PROVIDERS = new Set(['anthropic'])`。
>
> **这是'能力上限取决于上游暴露了什么'最精确的证明。**
> 一个看起来很底层的'输出格式'差异，
> 一路影响到了'什么时候封存会话'这个很上层的策略。"

---

## 9. 本模块要点

| 要点 | 内容 |
|------|------|
| **六 CLI 五格式** | stream-json / json / ndjson / plain / ACP → 统一成 AgentMessage |
| **每 provider 一个类** | 接受代码重复，换变化隔离 |
| **最难是纯文本** | 从日志捞 UUID → 定位内部 DB → 读结构化数据（逆向工程上游） |
| **载体降级链** | bg_daemon → interactive_pty → print_sdk → api_key |
| **失败三分类** | quota 贴 4h / structural 贴 30min / transient 累积 3 次升级 |
| **健康状态 per-carrier 全局** | 额度是账号级、二进制是机器级 |
| **降级必须可见** | `NOT suppressed`，全大写强调 |
| **热路径读内存** | Redis 只做重启持久化 |
| **回归钉** | 什么都没坏时行为完全不变 |
| **【ADR】想统一 ACP 但上游不支持** | "直到 agy 暴露受支持的 ACP server mode" |
| **【源码】account.protocol 已废弃** | 能推导的不要让用户配 |
| **三根跨模块线** | nativeL0 → 身份策略；hook 能力 → 会话策略；mcp 能力 → 回调桥 |
| **我的改进** | 能力矩阵化 / **契约测试**（最高优先） / 降级链推广 / 结构化补丁通道 |

---

→ [07 身份注入与 L0](07-模块-身份注入.md)
