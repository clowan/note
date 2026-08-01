# 02 · 决策：为什么选 CLI 子进程

> **这是全项目最重要的一个架构决策，也是面试最高频的一题。**
>
> 它值得单独一章，因为：
> ① 它决定了另外三个模块的存在（Provider 适配、MCP 回调桥、会话恢复）；
> ② 项目有完整的决策记录，包括**一次公开的翻案**——初稿选了 SDK，两天后推翻；
> ③ 它是一道"没有正确答案只有取舍"的题，最能看出候选人的判断力。

---

## 0. 30 秒电梯版

> "他们的选择是：**不调模型 API，而是 spawn 官方 CLI 作为子进程**，
> 通过 NDJSON 流式解析拿输出，通过 MCP 回调让 Agent 主动往回写。
>
> 最初的 ADR 初稿选的是官方 Agent SDK，两天后翻案改成子进程。
> 翻案的原因很实际：**SDK 只能用 API key 计费，没法用 Max/Plus/Pro 订阅额度**，
> 长期成本不可接受。
>
> 代价是六种 CLI 五种输出格式，适配层写了五千多行，
> 而且上游改一次格式就得跟一次。他们认为这个代价值得，我也认同。"

---

## 1. 这个决策要解决什么问题

需求很朴素：**程序化地调用 Claude、GPT、Gemini，
并且保留它们完整的 Agent 能力。**

"完整的 Agent 能力"具体指什么？

```
读写文件        Read / Write / Edit
跑命令          Bash / shell
操作 git        commit / branch / worktree
调 MCP 工具     内置 MCP 客户端
多轮工具循环    自己决定调几次工具、什么时候停
会话恢复        --resume
上下文压缩      自动摘要
```

**这一整套是 Agent CLI 已经做好的。** 问题是怎么用上。

---

## 2. 不做这个决策会怎样

这不是"能不能跑"的问题，是"跑起来之后有多贵、能力有多缺"的问题。

如果直接调 Chat API：

```
你要自己实现：
  ├─ Agent Loop（模型说要调工具 → 你执行 → 结果喂回 → 循环）
  ├─ 工具集（文件读写、shell、git…每个都要考虑安全边界）
  ├─ 上下文管理（什么时候压缩、压缩成什么样）
  ├─ 会话持久化
  ├─ 每家 API 的差异（tool_use 格式、流式协议、错误码）
  └─ MCP 客户端

而且：
  └─ 每个 token 都按 API 价格付费，用不了已经买了的订阅
```

**第二点是致命的。**
如果一个团队已经有 Claude Pro + ChatGPT Plus 的订阅，
走 API 意味着这些钱白花了，还要再付一份。

---

## 3. 四个方案的完整评估

【ADR】以下全部来自 [ADR-001](../clowder-ai/docs/decisions/001-agent-invocation-approach.md)，
是项目真实的决策记录，可以当事实讲。

原始对比表：

| 方案 | 描述 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| A: 纯 API | 直接调用 Chat API | 简单 | 失去 agent 能力 | ❌ 不满足需求 |
| **B: 子进程** | spawn CLI 作为子进程 | **完整能力、用订阅额度** | 启动开销、解析复杂 | ✅ 采用（默认主路径） |
| ~~C: SDK~~ | 使用官方 Agent SDK | 低延迟、流式响应 | **只能用 API key 付费** | ❌ 弃用 |
| D: 外部进程 | 独立进程 + MCP 协调 | 松耦合 | 同步复杂 | ⚠️ 特殊场景 |
| **E: Native Provider** | F143 provider 契约下的 API 直连 | 低延迟、无 CLI 开销 | API key 计费、需安全硬 gate | ✅ Opt-in（F159） |

### 逐个讲清楚

**方案 A · 纯 API**

直接调 `/v1/messages`、`/v1/chat/completions`。

否掉的原因【ADR】：

> 纯 API 丢失 CLI 侧 agent 能力（文件操作、命令执行、MCP 工具链），
> 与 Cat Café 协作目标冲突。

这个否很干脆 —— 不是成本问题，是**根本不满足需求**。
一个不能改文件的 Agent 没法参与开发协作。

**方案 C · 官方 Agent SDK**（曾被选中，后翻案）

这是最有故事的一个。**ADR 初稿（2026-02-04）选的就是 C**，
理由是"完整 agent 能力 + 低延迟"。

两天后（2026-02-06）翻案。修订记录里写得很直白【ADR】：

> | 2026-02-06 | 修订为方案 B (CLI 子进程) | SDK 只能用 API key，无法用订阅额度；Gemini API 模式无文件操作能力 |

以及否决理由段：

> **备选方案 A**：继续采用官方 Agent SDK（原 ADR 初稿方向）
> 不选原因：SDK 路径绑定 API key 计费，无法复用 Max/Plus/Pro 订阅额度，
> **长期成本不可接受**。

**这段在面试里非常好用**，因为它展示了一个真实的工程教训：

> "他们踩了个很典型的坑：SDK 看起来是'官方推荐的正确做法'，
> 延迟低、API 干净、有类型定义 —— 技术上确实更优雅。
> 但两天后就翻案了，因为发现它绑定 API key 计费。
>
> 这个教训我觉得很值：**技术选型不能只看技术指标，
> 商业模型（怎么计费）是硬约束**。
> 而且这个约束在文档里通常不显眼 —— 你得真的去看定价页才知道。"

**方案 D · 外部独立进程 + MCP 协调**

让 Agent 作为完全独立的进程跑，通过 MCP 协议协调。

否掉的原因【ADR】：

> 进程同步、会话对齐和回传链路复杂度过高，不符合当期交付节奏。

注意用词是 **"不符合当期交付节奏"**，不是"方案不对"。
所以 D 被标成了 `⚠️ 特殊场景` 而不是 `❌`——
后来的 cloud-only Agent（跑在浏览器 ChatGPT 里、通过 Remote MCP 反向连回来）
本质上就是 D 的一个特例。

**方案 E · Native Provider**（后来补充的 opt-in 路径）

2026-04-11 加的。**在 B 保持默认主路径的前提下**，
允许通过 provider 契约接入 API 直连。

适用场景【ADR】：

> 适用场景：轻量协作任务、中等复杂度分析任务（CLI 启动开销不划算的场景）
> 不适用场景：重度编码任务（应继续使用 CLI 子进程以利用完整 agent 能力 + 订阅额度）

**为什么后来又加回来了？** 因为 CLI 启动要 0.5~2 秒。
如果只是让 Agent 说一句话（比如回复一个简单问题），
花两秒启动一个完整的 Agent 运行时太浪费。

但它有非常严格的边界【ADR】：

```
❌ 不替代 CLI 子进程作为默认调用路径
❌ 不引入新的北向 API 或控制面
❌ 不绕过现有安全基线（account-binding / workspace-security）
❌ 不绕过 governance preflight
❌ 不覆写 home 目录配置文件（ADR-017 铁律）
❌ 不开放 write/edit/delete、shell、outbound network 工具（仅 read-only）
```

以及两条针对 E 的否决理由【ADR】：

> **备选方案 F**：Native provider 作为独立 runtime（独立控制面 + 自建安全基线）
> 不选原因：和 F143 宿主抽象重复，安全基线无法复用，北向接口膨胀。
>
> **备选方案 G**：Native provider 替代 CLI 成为默认主路径
> 不选原因：CLI 可使用订阅额度，成本优势不可替代；
> 重度编码任务 CLI 的完整 agent 能力更强。

**"北向接口膨胀"这个词值得学。**
意思是：如果新 provider 自己开一套对外 API，
那系统就有两套入口，所有上层功能都要适配两次。
所以它必须实现同一个 `AgentService.invoke()` 门面。

---

## 4. 为什么最终是 B

【ADR】五条理由：

> 1. **使用订阅额度**：CLI 模式可使用 Max/Plus/Pro 订阅，无需 API key 付费
> 2. **完整 Agent 能力**：CLI 保留所有 agent 功能
> 3. **NDJSON 流式响应**：各 CLI 均支持 JSON 流式输出，可实时解析
> 4. **MCP 回传**：通过 HTTP callback，猫猫可主动发言和获取上下文
> 5. **统一抽象**：`spawnCli()` + `CliTransformer` 统一三猫差异

**用大白话重排一下这五条的分量：**

| 理由 | 分量 | 为什么 |
|------|------|--------|
| 订阅额度 | ★★★★★ | 这是唯一一条"别的方案完全给不了"的 |
| 完整 Agent 能力 | ★★★★★ | 自己实现要几个月，而且做不到 CLI 的成熟度 |
| NDJSON 流式 | ★★★ | 是"可行性前提"，不是"优势" |
| MCP 回传 | ★★★ | 同上 |
| 统一抽象 | ★★ | 这是缓解措施，不是理由 |

**面试时只讲前两条，第三四条当"可行性验证"提一句就够。**

### 用一个具体的数字说清成本差异

【推断】这段是我算的，面试里要说成"我粗算过"：

> "假设一只 Agent 每天处理 50 次任务，每次平均 50k 输入 + 5k 输出 token。
> 一天就是 2.5M 输入 + 250k 输出。
>
> 走 API 的话，按 Claude Opus 级别的定价，一天几十美元，一个月上千美元。
> 走订阅是固定的月费。
>
> 而这个项目是**四只 Agent 同时在线**的场景。
> 成本差异不是百分之几十，是一个数量级。
>
> 所以'SDK 只能用 API key'这一条，直接把 SDK 方案判死了 ——
> 哪怕它技术上更优雅。"

---

## 5. 已知风险和它们后来怎么演化的

【ADR】ADR-001 明确列了四条风险。**面试里逐条讲它们后来怎么样了，
非常能体现你读得深：**

### 风险一：CLI 启动开销

> **CLI 启动开销**：每次 spawn ~500ms-2s，可考虑进程池优化

**后来怎么处理的？**

```
① ADR 里明确写了"不做边界"：
   "本轮不引入进程池和统一守护进程优化，启动性能优化留到后续独立议题。"

② 2026-04 加了方案 E（Native Provider），
   针对"CLI 启动开销不划算"的轻量任务

③ 但进程池至今没做
```

**面试怎么用**：

> "启动开销这条他们知道但故意没做进程池，ADR 里写了'不做边界'。
> 我理解这是对的取舍 —— 进程池要处理会话隔离、
> 上一个任务的状态污染下一个任务、进程健康检查，
> 复杂度不比现在的适配层小。
> 而且他们后来用另一个办法绕了：轻量任务走 API 直连（方案 E），
> 重活才付启动开销。**这比做进程池聪明**。"

### 风险二：NDJSON 格式变化

> **NDJSON 格式变化**：CLI 升级可能改变输出格式，需版本锁定 + 容错解析

**这条后来真的发生了，而且不止一次。** 源码里的证据：

```ts
// ClaudeInteractivePtyCarrierService.ts
// Required for claude 2.1.172+ where interactive TUI no longer writes transcripts.

// PtyDriver.ts
// Claude 2.1.172+ interactive TUI no longer writes transcript files, so …

// CodexAgentService.ts
// Codex CLI deprecated OPENAI_BASE_URL env var.
// Strip deprecated OPENAI_BASE_URL — now handled via --config model_providers
```

以及 README 里更狠的一条：

> Google consumer Gemini CLI / Gemini Code Assist individual 请求在 2026-06-18 停止服务，
> 所以非 ACP Gemini 路线默认走 Antigravity CLI。

**上游把整条通路砍了。** 这就是"建在别人 CLI 上"最真实的代价。

**面试怎么用**（这段很有说服力）：

> "格式变化这条风险后来兑现了好几次，代码里有痕迹：
> Claude 2.1.172 之后交互式 TUI 不再写 transcript 文件了，
> 他们得改成 hook sidecar 来拿；
> Codex 废弃了 `OPENAI_BASE_URL` 环境变量，得改走 `--config model_providers`；
> 最狠的是 Google 在 2026-06-18 直接停了 consumer Gemini CLI 的服务，
> 他们只能把默认通路切到 Antigravity CLI。
>
> 这是这个架构最大的系统性风险 ——
> **你的能力上限和稳定性都取决于上游 CLI**。
> 缓解手段是每个 provider 一个独立类 + 独立 parser，
> 把变化的影响面圈在一个文件里。"

### 风险三：Antigravity 回传可能无响应

> **Antigravity 回传**：MCP callback 可能无响应，需 gemini-cli fallback

**后来演化成了整套降级框架** —— 就是 [模块 13](13-模块-MCP回调桥.md) 里的
`degradation.ts`：三次重试 → outbox 落盘 → 降级策略 → 降级留痕。

从"需要 fallback"演化成了一套声明式的策略框架，
每个写类工具必须显式声明自己的降级策略（`explicitness > silent default`）。

### 风险四：Session 内存存储，重启丢失

> **Session 内存存储**：重启丢失，Phase 3 迁移 Redis

**后来做了**，而且做成了双实现：

```
domains/cats/services/stores/ports/    接口
  ├─ Redis 实现
  └─ 内存实现（--memory 模式）

RedisAuthInvocationBackend.ts 的注释：
  "Restart-resilient: API process exit / deploy / crash no longer drops active…"
```

**"no longer"这个词说明这是个已经填掉的坑。**

---

## 6. 缓解措施：怎么把六种 CLI 的差异圈住

【ADR】四条：

> 1. 为每个 CLI 编写独立的 `AgentService` 类 + `CliTransformer`，隔离差异
> 2. 使用统一的 `AgentMessage` 接口，屏蔽 CLI 输出差异
> 3. `spawnCli()` 工具封装超时、abort、僵尸进程防护
> 4. Gemini 双 adapter：`gemini-cli` (headless) 和 `antigravity` (IDE) 互为 fallback

**这四条的本质是同一个模式：**

```
        六种不同的现实
   ┌────┬────┬────┬────┬────┬────┐
   │claude│codex│gemini│agy│opencode│kimi│
   └──┬─┴──┬─┴──┬──┴─┬─┴───┬──┴─┬──┘
      ▼    ▼    ▼    ▼     ▼    ▼
   ┌────────────────────────────────┐
   │  各自的 AgentService + parser    │  ← 差异住在这里
   └────────────┬───────────────────┘
                ▼
   ┌────────────────────────────────┐
   │  统一的 AgentMessage 流          │  ← 上游只认这个
   └────────────────────────────────┘
```

**这是标准的适配器模式**，没什么新鲜的。
新鲜的是它的**代价规模** —— 详见 [模块 06](06-模块-Provider适配.md)：

| 文件 | 行数 |
|------|------|
| `GeminiAgentService.ts` | 1569 |
| `CodexAgentService.ts` | 1335 |
| `ClaudeAgentService.ts` | 957 |
| `OpenCodeAgentService.ts` | 605 |
| `KimiAgentService.ts` | 450 |
| + 各自的 event parser / transform / config writer | — |

**五千多行只为了把六种输出格式变成一种。**

---

## 7. 如果重新设计，我会怎么做

【推断】以下全是我的方案，面试里要说成"我会考虑"。

### 7.1 保留核心判断，B 依然是对的

订阅额度 + 完整 Agent 能力这两条太硬。
只要用户已经买了订阅，走 API 就是重复付费。

**但我会更早引入分层。**

### 7.2 明确分成"重活通路"和"轻活通路"

项目在 2026-04 才补上方案 E，我会一开始就分：

```
┌─────────────────────────────────────────────┐
│  重活通路（CLI 子进程）                        │
│  写代码、跑测试、操作 git、多轮工具循环         │
│  → 付 0.5~2s 启动开销，换完整能力 + 订阅额度    │
├─────────────────────────────────────────────┤
│  轻活通路（API 直连）                          │
│  回答问题、做判断、生成摘要、路由决策           │
│  → 无启动开销，付 API 费用（但量小）            │
└─────────────────────────────────────────────┘
```

**判断依据不是"任务类型"，而是"要不要碰文件系统"** ——
这个判据是机械的，好实现。

**为什么这个改动有价值？**
现在很多轻活也在付启动开销。比如"帮我判断这条消息该串行还是并行"
（就是 §5 里我说的那个缺陷的解法），
这种一句话的判断花两秒启动 CLI 完全不值。

### 7.3 Provider 层从"每家一个大类"改成"能力矩阵 + 组合"

现在的形态是六个大类各写一遍完整流程。我观察到的重复：

```
每个 AgentService 都要做：
  ├─ 解析账号凭据      （逻辑几乎一样）
  ├─ 决定新开还是 resume（差异只在命令行参数）
  ├─ 写 MCP 配置        （差异在文件路径和格式）
  ├─ spawn 进程         （差异在参数拼法）
  ├─ 解析输出           （★ 真正的差异在这）
  └─ 映射成 AgentMessage（★ 真正的差异在这）
```

**只有最后两步是真差异，前四步是配置差异。**

我会改成：

```ts
// 声明式的能力描述
interface CliCapability {
  command: string;                      // 'claude' | 'codex' | 'agy'
  outputFormat: 'stream-json' | 'json' | 'ndjson' | 'plain';
  resumeStyle: 'flag' | 'config' | 'none';
  mcpSupport: 'native' | 'config-file' | 'none';
  hooks: readonly HookKind[];           // ['PreCompact', 'SessionStart'] | []
  contextWindow: number;
  sealThresholds: { warn: number; action: number };
}

// 解析器是唯一需要各写一份的东西
interface OutputParser {
  parse(chunk: string): AgentMessage[];
}
```

公共流程写一遍，读 `CliCapability` 决定行为；
只有 `OutputParser` 六份。

**预期收益**：加一个新 CLI 从"写 1500 行"变成"填一个配置 + 写一个 parser"。

**代价**（必须一起说）：抽象一旦不够用，会出现绕过抽象的特例分支，
反而更难读。所以能力矩阵的字段必须从真实差异里长出来，不能提前设计。
—— 这也解释了**为什么项目现在是那个形态**：
它是在不知道会接六种 CLI 的时候一个个加起来的。

### 7.4 输出格式适配加一层"契约测试"

【推断】这是我认为项目最缺的东西。

现在的问题：上游改格式 → 线上才发现 → 紧急修。

我会加：

```
tests/contracts/
├── claude-stream-json.fixtures/     真实抓取的输出样本
├── codex-json.fixtures/
├── agy-plain.fixtures/
└── contract.test.ts                 每个 fixture 必须能解析成预期的 AgentMessage
```

再加一个定时任务：**每周用真实 CLI 跑一遍最小任务，
抓输出，和 fixture 对比，不一致就告警。**

这样上游改格式能在几天内发现，而不是等用户报障。

**这个改动是我认为投入产出比最高的一个** ——
因为风险二（格式变化）是这个架构唯一的系统性风险，
而现在它完全靠"用户报障 + 紧急修"来应对。

### 7.5 我不会改的部分

诚实地说，有些我原本想改，想清楚之后觉得现在的做法更对：

| 我原本的想法 | 为什么放弃 |
|------------|-----------|
| 上进程池减少启动开销 | 会话隔离 + 状态污染 + 健康检查，复杂度不比适配层小；用轻活通路绕开更聪明 |
| 统一成一条回程通路 | stdout 是 CLI 既有行为改不了，MCP 是标准协议不该改 |
| 用 gRPC 替代 HTTP 回调 | MCP server 是短生命周期子进程，HTTP 的无状态更合适 |
| 把六个 provider 合并成一个通用的 | 差异是真差异（五种输出格式），合并只是把 if/else 换个地方 |

**面试里主动说"我原本想改 X，想清楚后觉得现状更对"，
比只说改进方案更能体现判断力。**

---

## 8. 这个决策影响了哪些模块

这是本章最重要的一张图 —— **它说明为什么这个决策是"地基"**：

```
        ┌──────────────────────────────┐
        │  决策：spawn CLI 子进程        │
        └──┬────────┬────────┬────────┬┘
           │        │        │        │
           ▼        ▼        ▼        ▼
    ┌──────────┐┌────────┐┌────────┐┌──────────┐
    │06 Provider││13 MCP  ││08 会话 ││05 调用    │
    │  适配层   ││ 回调桥 ││ 恢复   ││ 生命周期  │
    └──────────┘└────────┘└────────┘└──────────┘
      因为有五     因为不是    因为可以    因为要管
      种输出格式   都支持MCP   用--resume  子进程
```

**逐条说清因果：**

**→ [模块 06 Provider 适配层] 因它而存在**
如果走 SDK/API，只有一种响应格式，这 5000 行不存在。

**→ [模块 13 MCP 回调桥] 因它而存在**
CLI 里 Claude/Codex 原生支持 MCP，Antigravity 只有纯文本。
所以需要 invocationId + token 的 HTTP 回调作为通用回程。
如果自己实现 Agent Loop，工具调用本来就在自己进程里，不需要桥。

**→ [模块 08 会话恢复] 因它而受益**
`claude --resume` 是现成的。抗压缩的三道防线里，
第三道（封存 + 新 session + bootstrap）直接建在 CLI 的会话机制上。
如果自己实现，得自己管上下文序列化。

**→ [模块 08 的能力上限也因它而受限**
只有 Claude Code 提供 `PreCompact` hook：

```ts
/** Providers that support compression event signaling (PreCompact hook) */
const HOOK_CAPABLE_PROVIDERS = new Set(['anthropic']);
```

所以 `hybrid` 策略（允许 N 次压缩再封存）只对 Claude 生效，
其他 provider 只能用 `handoff`（到阈值直接换 session）。

**这是"建在别人 CLI 上"最精确的一句总结：
能力上限取决于上游暴露了什么。**

**→ [模块 05 调用生命周期] 的形态因它而定**
子进程会卡死、会变僵尸、会被父进程重启带走。
所以需要 `ProcessLivenessProbe`、`cli-supervisor`、
`orphan-chrome-cleaner`、`reconcileZombies`、`StartupReconciler`。
如果是进程内的 Agent Loop，这些全不需要。

---

## 9. 面试怎么讲

### 30 秒版

见 §0。

### 3 分钟版

> "他们评估了四个方案：纯 API、CLI 子进程、官方 SDK、外部独立进程。
>
> **最有意思的是这个决策翻过案**。ADR 初稿选的是官方 Agent SDK ——
> 延迟低、接口干净，技术上确实更优雅。两天后推翻了，
> 因为发现 SDK 只能用 API key 计费，用不了 Max/Plus/Pro 订阅额度。
> 他们的原话是'长期成本不可接受'。
>
> 我觉得这个教训挺值的：**技术选型不能只看技术指标，
> 商业模型是硬约束**，而且这个约束在文档里通常不显眼。
>
> 最终选 CLI 子进程，核心就两条：能用订阅额度，
> 以及白拿 CLI 的完整 Agent 能力 —— 文件读写、shell、git、
> 内置 MCP、会话恢复，自己实现要几个月还做不到那个成熟度。
>
> 代价是六种 CLI 五种输出格式，适配层五千多行。
> 而且 ADR 里列的四条风险后来兑现了两条：
> Claude 2.1.172 改了 transcript 行为、
> Google 在 2026-06-18 直接停了 consumer Gemini CLI 的服务。
> **这是这个架构唯一的系统性风险** ——
> 我觉得他们最该补的是契约测试：定期用真实 CLI 抓输出和 fixture 对比，
> 现在完全靠用户报障发现。
>
> 另外 2026-04 他们又补了一条 opt-in 的 API 直连通路，
> 专门给'CLI 启动开销不划算'的轻量任务。
> 但边界卡得很死 —— 只给 read-only 工具、不能替代默认路径、
> 必须实现同一个 `AgentService.invoke()` 门面，
> ADR 里的原话是防止'北向接口膨胀'。"

### 常见追问五连

**Q1：现在有了 Claude Agent SDK，会不会重新考虑？**

> "会重新评估，但结论可能不变，判据还是那一条：**能不能用订阅额度**。
> 如果 SDK 支持 OAuth 订阅授权，那 SDK 方案的所有优势就都能拿到了 ——
> 少五千行适配代码、少启动开销、少格式漂移风险。
>
> 但即便那样我会保留 CLI 通路，因为 CLI 还有一个 SDK 给不了的东西：
> **它是用户已经在用的那个环境**。
> 用户在 `~/.claude/` 里配的 MCP、skills、hooks，CLI 直接就用上了；
> SDK 得自己再实现一遍配置发现。"

**Q2：spawn 子进程的安全边界怎么处理？**

> "几层。工作目录必须过校验（`validateProjectPathDetailed`、
> `isSameProject`），防 Agent 跑到别的项目里改文件。
> 账号凭据必须走绑定解析（`resolveBoundAccountRefForCat`），
> ADR-001 里写了 fail-closed，禁止回退扫描任意 key。
> 还有 ADR-017 一条铁律：**禁止运行时覆写 Agent 的 home 目录配置**。
>
> 那条 ADR 的理由我觉得挺好：改用户 home 目录会影响所有使用场景不只是这个系统、
> 多实例并发写会互踩、用户可能有自定义内容会丢、
> 而且运行时覆写没有 commit 记录不可审计。
> 所以同步系统提示词只能通过显式脚本 + `--check` 漂移检测。"

**Q3：一个子进程卡死了怎么办？**

> "有一套东西专门管：`cli-timeout` 算超时、`cli-supervisor` 监督、
> `ProcessLivenessProbe` 探活、`reconcileZombies` 回收、
> `orphan-chrome-cleaner` 清理 Antigravity 留下的 Chrome 进程。
>
> 更上层还有球权状态机，专门有个 `zombie` 状态表示
> '进程还活着但没心跳'。而且它有个细节我挺喜欢：
> 判死之后 10 分钟内收到的心跳算迟到、不算复活 ——
> 因为网络抖动不该让状态机翻烧饼。"

**Q4：为什么不用 Docker 隔离每个 Agent？**

> 【推断】"我的理解是定位问题。这是个**本地优先的桌面应用**，
> 有 Windows/macOS 安装包，普通用户装完双击就用。
> 要求用户装 Docker 会让安装门槛爆炸。
>
> 而且 Agent 的活儿本身就是'改这个项目的代码'——
> 隔离在容器里反而要处理卷挂载、权限映射、git 凭据穿透这些麻烦。
>
> 但如果做云端多租户版本，我认为必须容器化 ——
> 那时候安全边界的性质完全变了，不同用户的代码不能在同一个文件系统上。"

**Q5：你觉得这个决策最大的问题是什么？**

> "**它把命脉交给了上游。**
>
> 六个 CLI 的任何一个改了输出格式、改了参数、下线了服务，
> 都是线上故障。Google 停 consumer Gemini CLI 那次，
> 他们只能把整条默认通路切到 Antigravity。
>
> 而且更麻烦的是**能力上限也被锁住了**。
> 比如只有 Claude Code 有 PreCompact hook，
> 所以'允许 N 次压缩再封存'这个策略只有 Claude 能用，
> 别的 Agent 只能用更粗的'到阈值就换 session'。
> 这不是他们不想做，是上游没暴露。
>
> 缓解措施是每家一个独立类把变化圈住，但那只是限制爆炸半径，
> 不能消除风险。我会补契约测试 + 定期真机抓样本，
> 至少把'发现延迟'从几周压到几天。"

---

## 10. 本章要点

| 要点 | 内容 |
|------|------|
| **翻案故事** | ADR 初稿选 SDK，两天后因"只能用 API key 计费"推翻 |
| **核心两条理由** | 订阅额度 + 白拿完整 Agent 能力 |
| **纯 API 被否** | 不是成本问题，是根本不能改文件 |
| **外部进程被否** | 复杂度不匹配交付节奏（后来 cloud Agent 是它的特例） |
| **API 直连后来补回** | opt-in、read-only、不能替代主路径、防"北向接口膨胀" |
| **四条已知风险** | 启动开销（故意不做进程池）/ 格式变化（兑现了）/ 回传无响应（演化成降级框架）/ session 内存（已迁 Redis） |
| **最大系统性风险** | 命脉在上游；能力上限取决于上游暴露了什么 |
| **我的改进** | 更早分重活/轻活通路 + 能力矩阵化 provider + **契约测试** |
| **影响四个模块** | Provider 适配、MCP 桥（因它存在）；会话恢复（因它受益也受限）；调用生命周期（形态因它而定） |

---

→ [03 路由与编排](03-模块-路由与编排.md)
