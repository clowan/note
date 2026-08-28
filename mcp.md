# 梳理 Clowder-AI MCP 工具调用

> 结合clowder-ai的源码详细解释下上述，尽可能通俗易懂的解释清楚，补充具体实现细节使得整个MCP工具调用模块连贯且清晰明了。
>
> User context
>
> Attachments:
> - ## 1. 文件地图与职责边界 ### 1.1 MCP 服务端（猫这一侧，跑在 CLI 子进程里） 「MCP」= Model Context Protocol…: `C:/Users/Administrator/.codex/attachments/334b6237-7413-4d1f-a8a5-c9acf41fb0e2/pasted-text.txt`

<details><summary>6 previous messages</summary>

> 我先把你贴出的说明和仓库里 MCP、CLI、Agent 调度相关源码对齐起来，再按“谁启动谁、消息怎么流、工具如何落地执行、结果如何返回”的顺序串成一条完整链路。过程中我会把源码中的关键函数、数据结构和边界条件一起标出来，避免只做概念性转述。
>
> 刚才的路径假设和当前工作区结构不一致，我先定位实际源码根目录；贴文中的 `packages/...` 很可能位于更深一层。确认后我会以当前版本源码为准，特别核对贴文里可能已经过时或表述不精确的地方。
>
> 源码根目录已经确认是 `D:\AI\clower-1\clowder-ai`。我正在把说明中的“概念层”落到真实实现：入口如何注册工具、工具如何转成 MCP SDK 接受的 schema、HTTP callback 如何带凭证并重试，以及 API 侧如何鉴权、做线程权限和幂等。接下来会特别标出几处容易误解的点，例如“没有凭证时中间件为何不立即 401”和“agent-key 为什么必须显式提供 threadId”。
>
> Context compaction
>
> Source: automatic
> Status: completed
>
> 我会把附件中的架构说明逐项对照 `clowder-ai` 现有实现，并用一次 `post_message` 调用贯穿解释。重点会区分 MCP 的 stdio 协议、子进程到 API 的 callback HTTP，以及 API 内部认证和业务状态三个边界。
>
> 源码和附件的主线是一致的，但有几处实现细节需要校正：半套 invocation 凭证可由完整 agent key 兜底、freshness 计数只增一次、刷新路由的 TTL 滑动发生在 `preValidation`。下面会按真实调用顺序组织，而不是逐段复述附件。
</details>

这套模块最容易混淆的地方，是把 “MCP 工具调用” 当成一条网络请求。源码里它其实是两段完全不同的通信：

```text
LLM / CLI 宿主
  <==== MCP JSON-RPC，stdin/stdout ====>
Node MCP 子进程（工具定义和本地前置校验）
  <==== HTTP callback，JSON + 身份头 ====>
Clowder API（认证、授权、存储、队列、WebSocket、审批）
```

因此，MCP 负责让模型“看见并调用工具”；callback API 负责让工具真正读取或修改 Clowder 的共享业务状态。MCP 本身不直接操作数据库。

**1. MCP 子进程怎样启动并暴露工具**

以协作入口 [collab.ts](./clowder-ai/packages/mcp-server/src/collab.ts:27) 为例，进程先创建 `McpServer('cat-cafe-collab-mcp')`，注册协作工具，再连接 `StdioServerTransport`。连接之后，CLI 和该 Node 子进程就在标准输入/输出上交换 MCP 的 JSON-RPC 消息，例如列出工具、调用工具、返回工具结果。

旧的全量入口 `index.ts` 会调用 `registerFullToolset()`；它按 `collab -> memory -> signal -> limb -> audio -> finance` 顺序装配工具集，见 [server-toolsets.ts](./clowder-ai/packages/mcp-server/src/server-toolsets.ts:611)。分体入口则只注册对应领域，例如 `collab.ts` 只装协作工具。拆分的第一层目的，是减少单次模型会话中可见工具的数量，降低误选工具和工具描述挤占上下文的风险。

启动时还会初始化 `~/.cat-cafe` 下的 `chat`、`memory`、`workspace`、`assets`、`.state` 等目录；可由 `CAT_CAFE_DATA_DIR` 改写。普通日志必须走 `stderr`，不能写入 `stdout`，因为 stdout 已经是 MCP 协议数据流，混入一行日志就可能破坏 JSON-RPC 帧。

工具可见范围还有第二层控制，和“分体入口”是不同问题：

- `CAT_CAFE_READONLY=true` 时，默认仅注册只读白名单；具备 agent key 时才额外开放特定工具。
- `CAT_CAFE_DESKTOP_MODE` 的优先级更高，当前支持的 phase0 模式使用严格白名单；未知 mode 会在启动时报错，而不是悄悄暴露全部或零个工具。
- `limb` 工具在普通 readonly 模式下有特殊处理，但 desktop mode 会把它重新纳入白名单过滤。

也就是说：入口拆分解决“模型应该看见什么”，环境白名单解决“这个运行环境被允许做什么”。

**2. 工具是怎样注册成 MCP Tool 的**

统一工具定义 `ToolDef` 在 [server-toolsets.ts](./clowder-ai/packages/mcp-server/src/server-toolsets.ts:32) 中包含名称、描述、输入 schema 和 handler。麻烦在于项目同时有两种输入 schema：

- 大多数工具使用 Zod raw shape，例如 `{ content: z.string() }`；
- 一部分 limb 工具使用普通 JSON Schema，例如 `{ type: 'object', properties: ... }`。

注册层先判断 schema 类型：JSON Schema 会经 `jsonSchemaToZod()` 转换；Zod raw shape 则直接 `z.object(...)`。这样最终交给 MCP SDK 的始终是可执行的 Zod object，模型给出的参数会在 handler 执行前被校验。

源码刻意使用 `server.registerTool(name, config, handler)`，而不使用更方便的 `server.tool()` 重载，见 [server-toolsets.ts](./clowder-ai/packages/mcp-server/src/server-toolsets.ts:516)。原因是 SDK 的重载解析可能把 plain JSON Schema 错看成 annotations，最终造成 handler 参数位置错位。这里显式传 `{ description, inputSchema, annotations }`，消除了歧义。

每个工具还带 MCP annotations：

```ts
{
  readOnlyHint,
  destructiveHint,
  openWorldHint
}
```

这些是给 MCP 客户端、模型或审批 UX 的风险提示，不是最终安全边界。真正的访问控制仍在 API 路由的认证和授权逻辑中。项目还会给成功的只读调用附加 freshness notice：每个 MCP 进程维护调用次数，至少间隔 5 次调用、最多发送 3 条，并且 callback 可用时才请求 API 检查通知，[server-toolsets.ts](./clowder-ai/packages/mcp-server/src/server-toolsets.ts:472)。真实代码中每次工具调用只增加一次计数。

**3. 用 `post_message` 走完整链路**

这是理解全模块最合适的例子。

```text
模型选择 cat_cafe_post_message
  -> MCP SDK 校验入参
  -> handlePostMessage()
  -> callbackPost('/api/callbacks/post-message')
  -> 重试 / 可选 outbox
  -> Fastify callback preHandler
  -> requireCallbackPrincipal()
  -> thread scope 校验 + 最新 invocation 校验 + 幂等
  -> MessageStore
  -> A2A queue 或即时 WebSocket broadcast
  -> JSON 工具结果原路返回模型
```

客户端 handler 在 [callback-tools.ts](./clowder-ai/packages/mcp-server/src/tools/callback-tools.ts:710) 有一个很关键的前置规则：若本次实际使用的是 invocation 身份，调用方不能手动覆盖 `threadId`。正常消息应省略 `threadId`，服务端从 invocation record 中得出线程；若要跨线程投递，应使用专门的 cross-post 工具。

这不是单纯为了简化参数，而是在阻止一个旧 invocation 把消息投到任意线程。另一方面，agent key 不是某一条线程的一次性身份，它没有内置 `threadId`，所以 agent-key 调用反而必须显式提供 `threadId`，随后由 API 检查该 user 是否有权访问它。

`post_message` 会自动补上 `clientMessageId: randomUUID()`。这是写操作的幂等键：网络层不知道“服务端已经写成功，只是响应在路上丢了”时，可以重发同一请求，而 API 能识别重复投递。

**4. callback 身份：短期 invocation 与长期 agent key**

客户端从环境组装 callback 配置，见 [callback-tools.ts](./clowder-ai/packages/mcp-server/src/tools/callback-tools.ts:108)。

| 身份 | 典型头 | 绑定范围 | 适合场景 |
|---|---|---|---|
| Invocation | `x-invocation-id` + `x-callback-token` | 某个 user、cat、thread、一次调用生命周期 | 正常会话内回调 |
| Agent key | `x-agent-key-secret` | 某个 user、cat，不绑定 thread | 长期或共享 MCP 场景 |

优先级是完整 invocation 凭证优先，否则使用 agent key，[callback-tools.ts](./clowder-ai/packages/mcp-server/src/tools/callback-tools.ts:136)。这里有一个值得修正的细节：半套 invocation 凭证本身不能构成身份，但并不必然让 `getCallbackConfig()` 返回 `null`；如果同时存在完整 agent key，客户端可以退回到 agent-key 身份。

服务端最终得到的是一个判别联合 `CallbackPrincipal`：

```text
invocation principal: 有 threadId，天然带本次调用上下文
agent_key principal: 无 threadId，只知道 userId 和 catId
```

因此认证和授权是两步：

1. 认证：token / key 是不是有效，对应哪一个 principal。
2. 授权：这个 principal 是否可以操作目标线程、用户资源或审批资源。

`resolvePrincipalThread()` 在 [callback-scope-helpers.ts](./clowder-ai/packages/api/src/routes/callback-scope-helpers.ts:99) 统一执行这层分流。agent key 缺 `threadId` 会得到 400；目标线程不存在、线程存储不可用或当前 user 无权访问，也会在这里被拒绝。

**5. 服务端 preHandler 不是业务路由本身**

callback 全局认证 hook 注册在 callback 路由组中。其主要顺序在 [callback-auth-prehandler.ts](./clowder-ai/packages/api/src/routes/callback-auth-prehandler.ts:80)：

1. 若 refresh 路由已经填入 `request.callbackAuth`，直接跳过，避免重复验证和重复续期。
2. 优先读取 invocation headers。
3. 仅在 header 完全缺失时，才兼容从 body/query 读取旧格式凭证。
4. 没有 invocation 凭证时，尝试 agent key。
5. 两种身份都没有时，hook 本身直接返回。
6. invocation 只有半套凭证时，返回 `401 missing_creds`。
7. 完整 invocation 凭证交给 `InvocationRegistry` 验证，并写入 `request.callbackAuth` 与 `request.callbackPrincipal`。

第 5 点很重要：preHandler 的“无凭证 no-op”不代表 callback API 默认匿名开放。因为同一个 Fastify 实例还有 browser/panel 等非 callback 路由。真正要求身份的 callback 路由必须显式调用：

- `requireCallbackAuth()`：只允许 invocation。
- `requireCallbackPrincipal()`：允许 invocation 或 agent key。

例如 `post-message` 路由先要求 principal，再解析和校验 thread，[callbacks.ts](./clowder-ai/packages/api/src/routes/callbacks.ts:841)。提案类路由则要求 invocation，agent key 不可创建用户审批项，[callback-propose-thread-routes.ts](./clowder-ai/packages/api/src/routes/callback-propose-thread-routes.ts:52)。

**6. 为什么 POST 有 retry/outbox，GET 却比较轻**

`callbackPost()` 走 retry helper。每次 HTTP attempt 有 10 秒 timeout；网络错误、`408`、`429` 和任意 `5xx` 才会重试，默认延迟为 1 秒、2 秒、4 秒，即首次请求之外最多再试三次，[callback-retry.ts](./clowder-ai/packages/mcp-server/src/tools/callback-retry.ts:78)。普通 `4xx`、特别是权限问题，不会盲目重试。

部分关键写工具还启用 outbox：

```text
发送新请求前 flush 旧 outbox
  -> 当前请求可恢复失败
  -> 写入本地 outbox JSON
  -> 返回 queued_for_retry
  -> 后续工具调用再按 FIFO replay
```

outbox 通过原子 `rename(..., .processing)` 领取条目，避免多个 flush 并发重放同一文件，具体实现见 [callback-outbox.ts](./clowder-ai/packages/mcp-server/src/tools/callback-outbox.ts:172)。但它提供的是 **at-least-once delivery**，不是 exactly-once：服务端可能已成功处理，而客户端未收到响应，之后仍会重发。因此 `clientMessageId`、proposal 的 `clientRequestId` 等 API 级幂等语义仍不可省略。

相对地，`callbackGet()` 只做一次原生 fetch，不做 retry、不进入 outbox，也没有同样的 timeout 包装。这是一种可靠性分层：写失败要尽力确保最终投递；读失败通常让模型稍后重新查询即可。

**7. 旧 invocation、过期与 refresh**

`InvocationRegistry` 保存 invocationId、callback token、user、cat、thread、TTL，以及同一调用内的幂等状态。默认 invocation TTL 为 2 小时；成功验证会滑动续期。它还维护同一 `(threadId, catId)` 最新 invocation 的概念。

所以旧 CLI 进程在新 invocation 已接管后继续发消息时，API 不一定返回硬错误，而可能返回 HTTP 200：

```json
{ "status": "stale_ignored" }
```

目的是防止已经失效的进程触发 retry 风暴。`post_message` 客户端会把这个业务状态重新转换为模型可理解的失败，明确说明消息没有送达，而不是误报成功。

refresh loop 在 MCP 进程后台运行，[refresh-loop.ts](./clowder-ai/packages/mcp-server/src/refresh-loop.ts:148)。它调用 `POST /api/callbacks/refresh-token`，不经通常 POST retry，以免无意义地持续续期。服务端设置 5 分钟 cooldown；客户端的最小间隔约为 6.18 分钟，是把 `±15%` jitter 的最小值反推后得出的，确保最短随机间隔也不会掉进 5 分钟限流窗口。

刷新路由的真实顺序在 [callbacks.ts](./clowder-ai/packages/api/src/routes/callbacks.ts:3265)：

```text
preValidation:
  提取完整 invocation 凭证
  -> peek（不续期）
  -> claim 5 分钟 cooldown
  -> verifyLatest（验证 + latest 检查 + 滑动 TTL）
  -> 写 request.callbackAuth

全局 preHandler:
  发现 callbackAuth 已存在，跳过

handler:
  读取新 expiry，返回剩余 TTL
```

换言之，TTL 的滑动来自 refresh route 的 `preValidation` 中 `verifyLatest()`，不是随后全局 preHandler 再验证一次。

**8. Proposal 与 Approval Hub：请求“批准”，不直接改最终状态**

`propose-thread`、`propose-session-handoff`、`propose-profile-update` 的共同语义是：创建一个待用户决策的 proposal，并写入用户可见的 rich confirmation card；这不等于 thread、session 或 profile 已经变更。

它们都使用 `clientRequestId` 幂等：客户端没提供时自动生成 UUID；服务端先走已存在 proposal 的快速路径，再用 reserve/dedup 防并发重复创建。更细致的是，服务端不只检查 proposal record 是否存在，也检查确认卡是否真正可见；缺少 `cardMessageId` 时会扫描 rich block 做 self-heal，仍不可见则返回 retryable 503，而不是伪造“已去重成功”。

Approval Hub 的 pending/settled 路由只是把各 proposal adapter 的结果聚合、排序、返回，[approval-hub-routes.ts](./clowder-ai/packages/api/src/routes/approval-hub-routes.ts:25)。它不负责执行审批动作，也不应在查询时产生副作用。

**对附件中几个表述的源码校正**

- 半套 invocation 凭证不能单独使用，但完整 agent key 可作为替代身份；不能简单概括成“半套就一定没有 callback config”。
- freshness notice 的真实 `toolCallCount` 每次调用只加一次。
- refresh 的 TTL 滑动发生在 refresh route 的 `preValidation -> verifyLatest()`；全局 preHandler 因 `callbackAuth` 已填充而早退。
- “preHandler 默认 fail-closed”不够准确。它对无凭证请求会 no-op；callback 路由是否 fail-closed，取决于是否正确调用 `requireCallbackAuth()` 或 `requireCallbackPrincipal()`。这是一个依赖路由纪律的架构约束。
- MCP 工具文件并不只是机械 HTTP 转发层。多数工具很薄，但 `post_message` 的线程保护、stale/held 的模型友好反馈、proposal 幂等键、富文本输入检查等，都是必要的本地安全和体验前置；最终业务裁决仍由 API 完成。

把它压缩成一句话：**MCP 把模型的结构化意图送进受控的 Node 工具进程；callback 把意图带着可验证身份交给 API；API 再用 principal、thread scope、最新调用检查、幂等和队列机制，决定这次意图是否真的能变成共享状态。**

> 解释的还是不够通俗易懂，尽可能清晰明了的解释清楚，以支撑我应对面试官的追问

<details><summary>2 previous messages</summary>

> 这次我会把内容改成“先建立整体心智模型，再逐层拆解，最后给出面试官追问与标准回答”的形式。每个关键结论都对应源码位置，并会用具体请求、失败场景和设计取舍来解释，让你不仅知道“怎么跑”，也能回答“为什么这样设计”。
>
> 调用链的源码证据已经核对完了：入口、工具注册、凭证优先级、API 鉴权、线程 scope、重试/outbox、refresh，以及 proposal/Approval Hub 都能串成一条完整故事。接下来我会把它写成一份“面试讲解稿”，并明确哪些地方是认证、哪些是授权、哪些是可靠性保证，避免面试时概念混在一起。
</details>

下面给你一份更适合“理解源码 + 应对面试追问”的讲解。你可以先记住开头的总结，面试官继续追问时，再按后面的层次展开。

**先背这一段：**

> Clowder 的 MCP 模块不是直接操作数据库的业务模块，而是一个“模型工具适配层”。模型通过 MCP 协议调用 Node 子进程里注册的工具；这些工具大多数再通过 HTTP callback 调用 Clowder API；真正的认证、权限校验、消息落库、队列投递、审批和 WebSocket 广播，都在 API 侧完成。
>
> 所以这里有三个边界：MCP 负责“模型怎么调用工具”，callback 负责“工具进程怎么请求 API”，API 负责“这次请求有没有权限、最终是否改变业务状态”。

---

## 一、先把三个容易混淆的概念分开

可以把系统想象成一家餐厅：

| 系统角色 | 类比 | 实际职责 |
|---|---|---|
| LLM / CLI 宿主 | 顾客 | 决定“我要发消息、查上下文、创建任务” |
| Node MCP 子进程 | 服务员 | 向模型展示工具，校验参数，转发请求 |
| Clowder API | 后厨 + 总账系统 | 鉴权、授权、存储、排队、广播、审批 |

“猫”指的是 Clowder 中运行的 agent/CLI 进程。猫并不是直接连数据库，而是通过 MCP 工具和 callback API 与 Clowder 交互。

整体链路是：

```text
模型
  |
  | MCP JSON-RPC
  | stdin/stdout
  v
Node MCP 子进程
  |
  | HTTP callback
  | JSON body + 身份 header
  v
Clowder API
  |
  +-- 鉴权
  +-- 线程权限
  +-- 幂等检查
  +-- 消息存储
  +-- A2A 队列
  +-- WebSocket 广播
  +-- Proposal / Approval Hub
```

这里最重要的一句话是：

> MCP 不等于 HTTP callback。MCP 是模型与工具进程之间的协议；callback 是工具进程与 API 之间的通信方式。

---

## 二、MCP 子进程是怎样启动的

以 [index.ts](./clowder-ai/packages/mcp-server/src/index.ts:23) 为例，启动流程大致是：

```text
Node 进程启动
  -> 初始化 ~/.cat-cafe 目录
  -> 创建 McpServer
  -> 注册工具
  -> 连接 StdioServerTransport
  -> 开始处理 MCP JSON-RPC
  -> 后台启动 refresh loop
```

源码中的关键代码逻辑是：

```ts
const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
startRefreshLoop();
```

`createServer()` 会创建 `McpServer('cat-cafe-mcp')`，然后调用 `registerFullToolset()` 注册工具。

分体入口 [collab.ts](./clowder-ai/packages/mcp-server/src/collab.ts:27) 则只注册协作类工具，例如消息、上下文、任务和权限工具。

### 为什么使用 stdio？

因为 MCP 客户端通常会直接拉起一个子进程，然后通过它的标准输入和标准输出通信：

```text
宿主进程写 stdin  -> MCP 子进程读取
MCP 子进程写 stdout -> 宿主进程读取
```

优点是：

- 不需要额外开放一个 HTTP 端口；
- MCP 生命周期跟随宿主进程；
- 工具协议和 API 网络访问被分开；
- 对桌面客户端、CLI、编辑器插件比较容易集成。

但也有一个非常重要的工程约束：

> stdout 只能输出 MCP 协议数据，普通日志必须写 stderr。

因此源码中使用 `console.error()` 打启动日志，而不是 `console.log()`。如果把普通日志写进 stdout，宿主进程可能会把日志误解析成 MCP JSON-RPC 消息，导致协议损坏。

`isEntryPoint` 判断也很关键：模块被测试 `import` 时，不应该自动启动 stdio 服务，否则测试会卡住。因此只有真正作为入口文件执行时，才调用 `main()`。

---

## 三、工具注册层到底做了什么

工具注册的核心类型在 [server-toolsets.ts](./clowder-ai/packages/mcp-server/src/server-toolsets.ts:32)：

```ts
type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: never) => Promise<unknown>;
};
```

每个工具本质上包含四件事：

```text
工具名
工具描述
输入参数定义
真正执行的 handler
```

例如：

```text
cat_cafe_post_message
描述：向线程发送消息
输入：content、threadId、replyTo、targetCats ...
handler：handlePostMessage
```

### 1. 为什么要做 schema 转换？

项目里存在两种参数 schema：

第一种是 Zod raw shape：

```ts
{
  content: z.string(),
  threadId: z.string().optional()
}
```

第二种是普通 JSON Schema：

```ts
{
  type: 'object',
  properties: {
    content: { type: 'string' }
  },
  required: ['content']
}
```

因此注册层要判断：

```text
如果 schema.type === 'object' 且有 properties
  -> 按 JSON Schema 处理
否则
  -> 按 Zod raw shape 处理
```

普通 JSON Schema 会通过 `jsonSchemaToZod()` 转成 Zod。当前转换器主要覆盖项目实际使用到的类型：

- string；
- enum；
- number / integer；
- boolean；
- array；
- object；
- required；
- description。

这样做的好处是：无论工具原始 schema 是什么格式，交给 MCP SDK 的最终输入校验方式是一致的。

### 2. 为什么使用 `registerTool()`，而不是 `server.tool()`？

源码在 [server-toolsets.ts](./clowder-ai/packages/mcp-server/src/server-toolsets.ts:516) 明确使用：

```ts
server.registerTool(name, {
  description,
  inputSchema,
  annotations,
}, handler);
```

而不是 SDK 的重载方法 `server.tool()`。

原因是 `server.tool()` 有多个重载，SDK 可能把普通 JSON Schema 误判成 annotations，导致参数槽位错位：

```text
本来应该是：
name + config + handler

错误解析成：
name + inputSchema + annotations + handler
```

结果可能是 handler 没有拿到正确参数，运行时直接崩溃。显式的 `registerTool()` 把 description、schema、annotations 和 handler 分开传入，避免了重载歧义。

面试时可以这样回答：

> 因为项目同时支持 Zod shape 和 plain JSON Schema，SDK 的重载 API 存在歧义，所以统一使用显式的 `registerTool(name, config, handler)`，提高注册行为的确定性。

---

## 四、工具为什么不是永远全部暴露

工具可见性有两层控制。

### 第一层：入口拆分

例如：

```text
collab.ts   -> 协作工具
memory.ts   -> 记忆和检索工具
signals.ts  -> 信号工具
audio.ts    -> 音频工具
finance.ts  -> 财务工具
limb.ts     -> 设备/外部动作工具
```

这是为了降低工具列表噪音，让模型更容易找到正确工具。

### 第二层：环境白名单

`server-toolsets.ts` 还会读取环境变量：

```text
CAT_CAFE_READONLY
CAT_CAFE_AGENT_KEY_SECRET
CAT_CAFE_DESKTOP_MODE
```

常见规则：

```text
普通模式：
  注册全部工具

readonly=true：
  只注册 READONLY_ALLOWED_TOOLS
  如果有 agent key，再加 AGENT_KEY_TOOLS

desktop mode：
  使用更严格的 10 工具白名单
  不与 readonly / agent-key 白名单做并集
```

`CAT_CAFE_DESKTOP_MODE` 优先级最高。当前支持 `fable-phase0` 和 `cloud-pro-phase0`；未知值会直接启动失败。

因此需要区分：

```text
拆分入口       解决工具太多的问题
环境白名单     解决当前运行环境权限过大的问题
```

这是两个不同层次的设计。

---

## 五、annotations 是提示，不是最终安全边界

每个 MCP 工具还有：

```ts
{
  readOnlyHint,
  destructiveHint,
  openWorldHint
}
```

含义可以理解为：

| 字段 | 含义 |
|---|---|
| `readOnlyHint` | 是否只读 |
| `destructiveHint` | 是否可能破坏已有数据 |
| `openWorldHint` | 是否访问外部世界或外部系统 |

例如：

```text
cat_cafe_search_evidence
  readOnlyHint=true
  destructiveHint=false
  openWorldHint=true

cat_cafe_shell_exec
  readOnlyHint=false
  destructiveHint=true
  openWorldHint=false

cat_cafe_post_message
  readOnlyHint=false
  destructiveHint=false
  openWorldHint=false
```

这些 annotations 是给 MCP 客户端和安全策略做参考的，不能替代 API 鉴权。

面试官如果问：

> `readOnlyHint=true` 是否意味着工具一定安全？

应该回答：

> 不是。annotations 只是能力和风险提示，真正的访问控制仍然由 API 路由中的 callback principal、thread scope 和业务校验决定。即使一个工具被错误标记为只读，API 侧也必须继续鉴权。

---

## 六、以 `cat_cafe_post_message` 为例，完整跟踪一次调用

假设模型想调用：

```json
{
  "content": "@opus46 请检查这个问题",
  "replyTo": "msg-123"
}
```

完整流程如下。

### 第 1 步：模型先看到工具描述

MCP 客户端通过 MCP 协议请求工具列表，Node 子进程返回：

```text
工具名
描述
输入 schema
风险 annotations
```

模型据此决定是否调用 `cat_cafe_post_message`。

### 第 2 步：MCP SDK 先校验参数

如果 `content` 不是字符串，或者字段格式不符合 schema，handler 根本不会执行，直接返回参数错误。

这一步属于“协议层输入校验”。

### 第 3 步：handler 做本地安全前置检查

`handlePostMessage()` 在 [callback-tools.ts](./clowder-ai/packages/mcp-server/src/tools/callback-tools.ts:710) 有一个防误投规则：

```text
如果当前环境有完整 invocation 凭证，
并且调用方又手动传入 threadId，
直接拒绝。
```

原因是 invocation 本身已经绑定了一个线程。普通 `post_message` 不允许调用者随意改变线程，否则旧 invocation 可能把消息发到错误线程。

因此：

```text
同线程发送：
  省略 threadId

跨线程发送：
  使用 cat_cafe_cross_post_message
```

注意，`agentKeyCatId` 只是共享 MCP 场景下选择 key 文件的辅助字段，不代表最终身份一定是 agent key。真正的身份判断必须看最终会发送什么 header。

### 第 4 步：自动生成幂等键

`_executePostMessage()` 会自动生成：

```ts
clientMessageId: input.clientMessageId ?? randomUUID()
```

这相当于给本次业务请求一个订单号。

如果用户没有传幂等键，系统自动生成；如果用户自己传了，那么重试时必须继续使用同一个值。

### 第 5 步：组装 callback 配置和身份 header

`callbackPost()` 调用 `getCallbackConfig()`：

[callback-tools.ts](./clowder-ai/packages/mcp-server/src/tools/callback-tools.ts:108)

它需要：

```text
CAT_CAFE_API_URL
```

以及以下两种身份之一：

```text
CAT_CAFE_INVOCATION_ID + CAT_CAFE_CALLBACK_TOKEN
```

或者：

```text
CAT_CAFE_AGENT_KEY_SECRET
```

最终 header 由 [buildAuthHeaders()](./clowder-ai/packages/mcp-server/src/tools/callback-tools.ts:136) 决定：

```text
完整 invocation 凭证存在：
  x-invocation-id
  x-callback-token

否则使用 agent key：
  x-agent-key-secret
```

优先级是 invocation 高于 agent key。

请求 body 大致是：

```json
{
  "content": "@opus46 请检查这个问题",
  "replyTo": "msg-123",
  "clientMessageId": "generated-uuid"
}
```

身份放在 header，而不是业务 body 中。

### 第 6 步：callback POST 做超时和重试

`callbackPost()` 进入 retry 层：

[callback-retry.ts](./clowder-ai/packages/mcp-server/src/tools/callback-retry.ts:78)

默认延迟：

```text
第一次请求
失败后等待 1 秒
再次失败等待 2 秒
再次失败等待 4 秒
```

每次请求有独立的 10 秒 timeout。

会重试的情况：

```text
408
429
5xx
网络异常
```

不会盲目重试的情况：

```text
400
401
403
404
```

因为这些通常是参数、凭证或权限问题，继续重试没有意义。

### 第 7 步：失败时可能进入 outbox

`post_message` 开启了 outbox：

```ts
{ enableOutbox: true }
```

如果经过 retry 仍然是可重试失败，例如 API 暂时不可用，则把请求保存到本地：

```text
~/.cat-cafe/callback-outbox/
```

保存内容包括：

```text
请求 URL
路径
body
身份 headers
attempts
lastError
queuedAt
```

下一次发送新的 callback 前，会先 flush 旧 outbox。

outbox 使用：

```text
原文件 -> .processing
```

的原子 rename 作为 claim，避免多个并发 flush 同时发送同一个文件。

如果入队成功，本次工具调用会返回：

```json
{
  "status": "queued_for_retry",
  "queuedAt": 1234567890
}
```

这里一定要注意：

> `queued_for_retry` 只表示“请求已经可靠地排队到本地”，不表示 API 已经执行成功。

### 第 8 步：API 的 callback preHandler 处理身份

API 注册了全局 callback 鉴权 hook：

[callback-auth-prehandler.ts](./clowder-ai/packages/api/src/routes/callback-auth-prehandler.ts:80)

顺序是：

```text
1. 如果 request.callbackAuth 已由 refresh route 填好，直接跳过
2. 先读 x-invocation-id + x-callback-token
3. 只有 header 完全没有时，才读旧版 body/query 凭证
4. 如果没有 invocation，再尝试 x-agent-key-secret
5. 完全没有凭证时，preHandler 本身 no-op
6. 半套 invocation 凭证 -> 401 missing_creds
7. 完整 invocation -> registry.verify()
```

为什么“完全没有凭证时 no-op”？

因为同一个 Fastify 实例里还存在 panel/browser 等非 callback 路由。全局 hook 不能假设所有请求都必须是 callback。

所以真正需要身份的 callback 路由必须显式调用：

```ts
requireCallbackAuth()
```

或者：

```ts
requireCallbackPrincipal()
```

这是一种“全局预处理 + 路由显式收紧”的设计。

### 第 9 步：生成 principal

认证通过后，API 不只是保存一个 boolean，而是生成一个有具体身份信息的 principal。

共享类型定义在 [callback-principal.ts](./clowder-ai/packages/shared/src/types/callback-principal.ts)。

Invocation principal：

```ts
{
  kind: 'invocation',
  invocationId,
  threadId,
  userId,
  catId
}
```

Agent-key principal：

```ts
{
  kind: 'agent_key',
  agentKeyId,
  userId,
  catId,
  scope: 'user-bound'
}
```

这一步的意义是：

```text
认证回答：你是谁？
principal 回答：你是谁，以及你绑定了什么上下文？
```

### 第 10 步：路由要求 principal

消息路由在 [callbacks.ts](./clowder-ai/packages/api/src/routes/callbacks.ts:841)：

```ts
const principal = requireCallbackPrincipal(request, reply);
```

这意味着 `post-message` 接受两种身份：

```text
invocation
agent key
```

但 proposal 路由使用的是 `requireCallbackAuth()`，只接受 invocation，不接受 agent key。

这是有意的权限区分：

```text
长期 agent key 可以发消息
但不能代表一次具体会话创建审批提案
```

### 第 11 步：检查线程范围

`resolvePrincipalThread()` 在 [callback-scope-helpers.ts](./clowder-ai/packages/api/src/routes/callback-scope-helpers.ts:99) 中区分两种身份。

Invocation：

```text
不传 threadId
  -> 默认使用 invocation 自带线程

传同一个 threadId
  -> 允许

传其他 threadId
  -> 必须检查用户是否有访问权限
```

Agent key：

```text
没有 threadId
  -> 400

有 threadId
  -> 查询 ThreadStore
  -> 校验线程是否属于当前用户或用户可见
```

为什么 agent key 必须显式传 threadId？

因为 agent key 是长期身份，不属于某一次具体会话，没有默认线程上下文。

### 第 12 步：检查 invocation 是否已经过期或被替代

InvocationRegistry 在 [InvocationRegistry.ts](./clowder-ai/packages/api/src/domains/cats/services/agents/invocation/InvocationRegistry.ts:20) 保存：

```text
invocationId
callbackToken
userId
catId
threadId
createdAt
expiresAt
clientMessageIds
```

默认 TTL 是 2 小时。

除了过期，还要检查它是不是当前 `(threadId, catId)` 位置上的最新 invocation：

```ts
if (!(await registry.isLatest(invocationId))) {
  return { status: 'stale_ignored' };
}
```

源码见 [callbacks.ts](./clowder-ai/packages/api/src/routes/callbacks.ts:1211)。

例如：

```text
旧 CLI 进程 A 正在运行
新的 CLI 进程 B 启动
B 接管了同一个线程和猫
A 之后又发来消息
```

此时 A 的 invocation 已经 stale，服务端不会再投递它的消息。

为什么返回 HTTP 200，而不是 401？

因为旧进程通常会自动 retry。如果返回 401 或 5xx，可能造成无休止重试。服务端返回 200 + `stale_ignored` 是在告诉客户端：

```text
请求格式正确，但业务上已经不再接受
```

MCP 客户端会识别这个状态，并把它转换成工具错误，明确告诉模型消息没有送达。

### 第 13 步：幂等去重

服务端根据 `clientMessageId` 去重。

Invocation 路径使用：

```text
registry.claimClientMessageId(invocationId, clientMessageId)
```

Agent key 路径使用：

```text
agentKeyRegistry.claimClientMessageId(agentKeyId, clientMessageId)
```

如果已经见过：

```json
{
  "status": "duplicate",
  "clientMessageId": "..."
}
```

这解决的是：

```text
客户端以为请求失败
实际服务端已经写成功
客户端再次重试
```

如果没有幂等键，就可能出现重复消息。

### 第 14 步：解析消息内容和目标猫

API 会：

```text
解析富文本 block
提取 @mention
解析显式 targetCats
检查目标猫是否存在、是否启用
检查目标猫是否属于当前线程参与者
收集 routing_warnings
```

如果显式指定的目标全部无效，会返回业务错误信息，而不是静默丢消息。

### 第 15 步：落库、队列和广播

消息会先进入 MessageStore，获得 messageId。

之后根据是否有 A2A 目标和队列能力，决定：

```text
有可入队的 A2A 目标：
  消息标记 deliveryStatus='queued'
  交给 QueueProcessor
  避免立即 broadcast，防止重复投递

没有有效队列目标：
  直接 broadcast

入队失败：
  fallback 到 broadcast，避免消息消失
```

所以准确说法不是“永远先广播”或“永远先入队”，而是：

> 消息先形成持久化记录，然后根据投递决策在队列和即时广播之间选择，并且在队列失败时有广播兜底。

### 第 16 步：返回结果给模型

成功结果类似：

```json
{
  "status": "ok",
  "threadId": "thread-1",
  "messageId": "msg-456",
  "routed": ["opus46"],
  "clientMessageId": "..."
}
```

但有两个“HTTP 200 不等于消息已送达”的特殊状态：

```text
stale_ignored
held
```

`held` 表示当前猫还有未读消息，系统暂时不发送新消息。MCP 客户端会把它转换成可操作的提示：

```text
先读取新消息
根据上下文修改原消息
或者传 acknowledgeHeld=true 强制发送
```

---

## 七、Invocation 和 Agent Key 的区别

这是面试很容易被问到的一点。

| 对比项 | Invocation | Agent key |
|---|---|---|
| 生命周期 | 默认 2 小时 | 默认 45 天 |
| 是否绑定线程 | 是 | 否 |
| 是否有默认 threadId | 有 | 没有 |
| 是否可创建 proposal | 可以 | 通常不允许 |
| 典型用途 | 一次猫会话 | 长期 agent、共享 MCP |
| 凭证形式 | invocationId + callbackToken | agent key secret |

Invocation 创建于 [InvocationRegistry.ts](./clowder-ai/packages/api/src/domains/cats/services/agents/invocation/InvocationRegistry.ts:100)，其中 `invocationId` 和 `callbackToken` 都是随机生成的。

Agent key 的生成在 [AgentKeyRegistry.ts](./clowder-ai/packages/api/src/domains/cats/services/agents/agent-key/AgentKeyRegistry.ts:6)：

```text
生成 key id
生成 32 字节随机 secret
生成 salt
保存 SHA-256(secret + salt)
只返回一次明文 secret
```

服务端存 hash，不保存明文 secret。

轮换时：

```text
旧 key 进入 grace period
生成新 key
旧 key 默认保留 24 小时宽限
```

因此 agent key 更像长期 API key，而 invocation 更像短期 session token。

---

## 八、为什么 callback 是 at-least-once，而不是 exactly-once

这套系统有三层“可能重复”的来源：

```text
HTTP retry
outbox replay
进程在请求成功后、收到响应前崩溃
```

例如：

```text
API 已经成功写入消息
但客户端 TCP 连接断了
客户端认为失败并重新 POST
```

客户端不可能仅凭网络结果知道服务端是否已经执行，所以只能采用：

```text
至少投递一次
业务层幂等去重
```

也就是：

```text
retry + outbox = at-least-once delivery
```

而不是 exactly-once。

因此系统必须依赖：

```text
post_message -> clientMessageId
proposal -> clientRequestId
```

来实现业务幂等。

面试回答可以这样说：

> 网络层只能尽力重试，无法可靠判断“服务端是否已经执行”。所以系统选择 at-least-once 投递，把 exactly-once 的效果交给服务端原子 claim 和业务幂等键实现。

---

## 九、为什么 GET 和 POST 的可靠性不对称

`callbackPost()`：

```text
有 retry
有 timeout
部分写操作有 outbox
```

`callbackGet()`：

```text
一次 fetch
没有 retry
没有 outbox
没有同样的 timeout 包装
```

这是因为读写的失败代价不同：

```text
GET 失败：
  稍后再查即可

POST 失败：
  可能导致消息、任务、审批请求丢失
  需要 retry 和本地排队
```

如果面试官问“为什么不统一处理”，可以回答：

> 写操作需要最终投递语义，读操作只需要可重新查询。两者使用同一套重试策略反而会导致读请求放大，以及对已经明确失败的写请求进行无意义重试。

---

## 十、Token 过期时怎么办

MCP 进程会启动后台 refresh loop：

[refresh-loop.ts](./clowder-ai/packages/mcp-server/src/refresh-loop.ts:153)

它不是一个暴露给模型的工具，而是后台 plumbing：

```text
等待一段时间
  -> POST /api/callbacks/refresh-token
  -> 服务端续期
  -> 根据剩余 TTL 计算下一次时间
```

为什么不把 refresh 做成 MCP 工具？

因为 refresh 不是模型的认知动作，不应该让模型主动决定“我要不要刷新 token”。它属于基础设施后台行为。

### refresh 的时间计算

服务端 cooldown 是 5 分钟。

客户端不能简单设置为：

```text
5 分钟 * 随机 jitter
```

因为 jitter 最低是 0.85，可能变成：

```text
5 分钟 * 0.85 = 4.25 分钟
```

这样就会早于服务端 cooldown，收到 429。

因此源码反推：

```ts
MIN_DELAY_MS = ceil(5min * 1.05 / 0.85)
```

大约是 6.18 分钟，保证加上 jitter 后也不会低于服务端 cooldown。

### 为什么 refresh 使用 preValidation？

刷新路由在 [callbacks.ts](./clowder-ai/packages/api/src/routes/callbacks.ts:3265) 使用 `preValidation`：

```text
读取 body/query
  -> peek，不滑动 TTL
  -> claim cooldown
  -> verifyLatest，原子完成验证、latest 检查、滑动 TTL
  -> 写 request.callbackAuth
```

这样可以避免：

```text
请求已经被 429 限流
但全局 preHandler 先 verify 并滑动了 TTL
```

同时，`verifyLatest()` 把：

```text
验证 token
检查是否最新
滑动 TTL
```

放到一个原子操作里，避免 `preValidation` 和 `preHandler` 之间出现竞态。

需要特别记住：

> 当前源码中，refresh 路由的 TTL 滑动发生在 `preValidation` 的 `verifyLatest()`，不是之后全局 preHandler 再滑动一次。

---

## 十一、结构化认证错误和 degradation

API 不只是返回 401，而是返回结构化原因：

```json
{
  "error": "callback_auth_failed",
  "reason": "expired",
  "message": "...",
  "hint": "..."
}
```

可能的 reason 包括：

```text
expired
invalid_token
unknown_invocation
missing_creds
stale_invocation
agent_key_expired
agent_key_revoked
agent_key_unknown
agent_key_scope_mismatch
```

客户端会把 reason 提取成：

```text
[reason=expired]
```

这样 degradation 层就不需要通过模糊匹配错误文案来判断。

当前只有以下两类适合降级：

```text
expired
unknown_invocation
```

因为它们通常表示：

```text
token 过期
API 重启导致内存 registry 丢失
```

而以下情况不应该自动 fallback：

```text
invalid_token
  -> 客户端可能传错凭证

stale_invocation
  -> 这个 invocation 已经被新 invocation 替代
  -> fallback 可能重新创建旧状态
```

`post_message` 明确配置：

```ts
policy: { kind: 'none' }
```

也就是说，凭证失效时没有安全的本地替代方案，只能提示模型恢复认证后重试。

---

## 十二、Proposal 和 Approval Hub 是什么

三个 proposal 路由：

```text
/api/callbacks/propose-thread
/api/callbacks/propose-session-handoff
/api/callbacks/propose-profile-update
```

它们不是“直接执行变更”，而是：

```text
猫提出申请
  -> API 创建 proposal
  -> 写入待审批状态
  -> 生成用户可见的确认卡片
  -> 等用户批准或拒绝
```

以 `propose-thread` 为例，[callback-propose-thread-routes.ts](./clowder-ai/packages/api/src/routes/callback-propose-thread-routes.ts:52) 的流程是：

```text
requireCallbackAuth
  -> Zod 校验 body
  -> 检查 invocation 是否最新
  -> 根据 clientRequestId 查重
  -> 校验 parentThreadId / projectPath
  -> 原子 reserve dedup
  -> 创建 proposal
  -> 追加 rich confirmation card
  -> 保存 cardMessageId
  -> broadcast proposal_created
```

“proposal 创建成功”只代表：

```text
审批项已经创建
确认卡已经对用户可见
```

不代表：

```text
新线程已经创建
session handoff 已经执行
profile 已经修改
```

为什么要检查 `cardMessageId`？

因为可能出现部分成功：

```text
proposal 写入成功
确认卡也写入成功
但 cardMessageId 标记保存失败
```

如果只看到 proposal record 就直接返回 deduped success，后续 UI 可能找不到审批卡。因此源码会扫描 source thread 尝试 self-heal；仍然不可见时返回 503 retryable，而不是返回虚假的成功。

客户端会自动生成 `clientRequestId`，防止 callback retry 创建重复 proposal。

Approval Hub 的两个读取接口：

```text
GET /api/approval-hub/pending
GET /api/approval-hub/settled
```

只负责：

```text
调用多个 adapter
聚合结果
排序
返回统一结构
```

它本身没有缓存，也没有副作用，不会因为查询动作改变审批状态。实现见 [approval-hub-routes.ts](./clowder-ai/packages/api/src/routes/approval-hub-routes.ts:25)。

---

## 十三、面试官可能追问什么

### 追问 1：MCP 和普通 REST API 有什么区别？

可以回答：

> MCP 是面向模型的工具协议，除了调用，还定义了工具名称、描述、输入 schema 和风险 annotations；REST API 主要面向程序之间的 HTTP 请求。Clowder 中模型先通过 MCP 调用工具，工具内部再通过 callback 调 REST API。

### 追问 2：为什么不让模型直接调用 API？

可以回答：

> MCP 子进程可以统一做参数校验、工具白名单、线程防误投、错误转换和本地文件能力，同时隐藏 callback 凭证细节。API 仍然是最终安全边界，但模型不需要直接理解 API URL、header 和内部路由。

### 追问 3：`requireCallbackPrincipal()` 和 `requireCallbackAuth()` 有什么区别？

可以回答：

> `requireCallbackAuth()` 只接受 invocation record，适用于必须绑定一次具体会话的操作，例如 proposal；`requireCallbackPrincipal()` 接受 invocation 或 agent key，适用于长期 agent 也需要调用的接口，例如 post-message。

### 追问 4：为什么有了 token 还要检查 thread scope？

可以回答：

> token 解决的是身份认证，不自动代表对所有线程都有权限。Invocation 带有默认 threadId，agent key 没有线程上下文，所以 API 还必须根据 userId、threadId 和 ThreadStore 做资源授权。

### 追问 5：为什么 `stale_ignored` 返回 200？

可以回答：

> 它表示传输层请求正常到达，但业务上发现旧 invocation 已被新 invocation 替代。返回 200 可以避免旧 CLI 因 401/5xx 持续 retry；MCP 客户端再把这个业务状态转换为模型可见的错误，避免误以为消息送达。

### 追问 6：outbox 能保证 exactly-once 吗？

可以回答：

> 不能。outbox 和 retry 只能保证尽力的 at-least-once 投递。网络可能在服务端成功后客户端收到响应前断开，所以仍然可能重发。exactly-once 效果要靠服务端的 `clientMessageId`、`clientRequestId` 和原子 claim 实现。

### 追问 7：如果消息已经落库，但队列挂了怎么办？

可以回答：

> 消息先持久化，然后根据队列可用性决定 queued 或立即 broadcast。入队失败时会 fallback 到 broadcast，尽量避免消息只写入数据库却没有任何实时送达路径。

### 追问 8：为什么 refresh 要放在 `preValidation`？

可以回答：

> 因为需要在全局 preHandler 验证和滑动 TTL 之前先做 cooldown claim，避免被 429 限流的请求仍然续期；同时 `verifyLatest()` 将 token 验证、stale 检查和 TTL 滑动合成原子操作，避免生命周期钩子之间的竞态。

### 追问 9：annotations 能不能作为权限控制？

可以回答：

> 不能。annotations 只是 MCP 能力和风险提示，最终权限必须在 API route 中通过 principal、scope、业务状态和资源所有权校验。

### 追问 10：多实例部署时 InvocationRegistry 怎么办？

可以回答：

> `InvocationRegistry` 是 facade，backend 可注入 memory 或 Redis。单实例测试可以用 memory；多实例生产环境需要共享 backend，否则 invocation 在实例 A 创建、请求落到实例 B 时可能无法验证。源码通过 backend 抽象保留了这种可替换性。

---

## 十四、最后给你一个三十秒面试收尾版本

> Clowder 的 MCP 模块可以看成模型和后端 API 之间的适配层。MCP 子进程通过 stdio 和宿主进程交换 JSON-RPC，向模型暴露带有 schema 和风险 annotations 的工具。工具 handler 负责参数校验、凭证组装、必要的本地安全检查，然后通过 callback HTTP 调用 API。API 侧先把 invocation token 或 agent key 解析成 callback principal，再做 thread scope 和 user ownership 授权。对于写操作，客户端有 retry 和 outbox，服务端用 clientMessageId 或 clientRequestId 做幂等，所以整体是 at-least-once，而不是 exactly-once。消息类接口还会检查 stale invocation，并在入队失败时回退到广播。Proposal 接口则只创建待审批项和确认卡，不直接执行最终变更。refresh loop 负责后台续期 invocation，Approval Hub 负责聚合待审批和已结束审批项。

把这个模块再压缩成一句话就是：

> **MCP 负责让模型“会调用”，callback 负责让工具“能请求”，API 负责决定这次请求“是否有权并真正生效”。**

<details><summary>2 previous messages</summary>

> 我会再把抽象层降一层：先用“一个模型想发消息”这个故事解释每个对象和每次状态变化，再把源码中的函数名对应上。最后补一组按“是什么、为什么、出错怎么办、如何保证不重复”的追问模板，方便你在面试中顺着追问展开。
>
> 附件还包含一些上一版解释没有展开的内容：本地工具与 callback 工具的边界、shell/path 安全、`hold_ball` 的互斥校验、远程 HTTP 入口，以及为什么有些“业务判断”必须留在 API。为了避免只讲消息链路，我再补齐这些横向设计，并注明附件中已经被源码更新过的地方。
</details>

你前面觉得“不够通俗”，主要是因为我直接进入了 `InvocationRegistry`、`preHandler`、outbox 这些实现细节，但没有先把“这个系统到底在解决什么问题”讲透。下面我换一种方式：

1. 先用一个具体场景建立整体画面；
2. 再把每个源码文件放到这个画面中；
3. 然后完整跟踪一次 `post_message`；
4. 最后给出面试官可能追问的回答模板。

---

# 一、先用一个具体场景理解整个系统

假设用户对一只猫说：

> “请让另一只猫检查一下这个 bug。”

模型可能决定调用：

```text
cat_cafe_post_message
```

这时并不是模型直接访问 Clowder 的数据库，而是经过下面几层：

```text
用户
  -> LLM
  -> MCP 工具调用
  -> Node MCP 子进程
  -> HTTP callback
  -> Clowder API
  -> 认证和权限检查
  -> 消息落库
  -> A2A 队列或 WebSocket 广播
  -> 另一只猫收到消息
```

可以把它类比成餐厅：

```text
模型              = 顾客
MCP 子进程         = 服务员
callback API      = 后厨和收银系统
数据库/队列        = 厨房和出餐流水线
```

顾客只说“我要点这道菜”；服务员负责把订单格式化；后厨才真正决定是否能做、库存是否足够、如何出餐。

对应到 Clowder：

- 模型只知道“我要调用哪个工具”；
- MCP 子进程把模型的自由 JSON 参数变成结构化请求；
- API 决定请求者是谁、有没有权限；
- API 最终修改消息、任务、审批等业务状态。

因此一定要记住：

> MCP 是工具协议，不是数据库访问层；callback 是工具进程到 API 的 HTTP 通道；API 才是最终业务权威。

---

# 二、源码实际上分成三层

## 第一层：MCP 入口层

入口文件包括：

```text
index.ts
collab.ts
memory.ts
signals.ts
audio.ts
finance.ts
limb.ts
```

以 [collab.ts](./clowder-ai/packages/mcp-server/src/collab.ts:27) 为例，它做的事情很少：

```text
创建一个 MCP Server
  -> 注册协作工具
  -> 创建 StdioServerTransport
  -> 连接 stdin/stdout
  -> 启动 refresh loop
```

旧的 [index.ts](./clowder-ai/packages/mcp-server/src/index.ts:23) 是 all-in-one 入口，会把多个 toolset 全部注册进去，主要用于兼容旧配置。

分体入口的意义是：

```text
collab.ts   只暴露消息、线程、任务等协作工具
memory.ts   只暴露记忆和检索工具
signals.ts  只暴露信号工具
audio.ts    只暴露音频工具
finance.ts  只暴露财务工具
limb.ts     只暴露设备或外部动作工具
```

这样模型每次看到的工具更少，更容易选对。

---

## 第二层：MCP 工具适配层

核心文件是：

```text
packages/mcp-server/src/server-toolsets.ts
packages/mcp-server/src/tools/*.ts
```

这一层负责：

```text
定义工具名字
定义工具描述
定义输入参数
校验模型参数
调用 callbackPost / callbackGet
把 HTTP 结果转换成 MCP ToolResult
```

例如 `cat_cafe_post_message` 的工具文件主要做：

```text
拿到 content
拿到 threadId / replyTo / targetCats
生成 clientMessageId
调用 callbackPost('/api/callbacks/post-message', body)
处理 stale_ignored / held / 401 等结果
返回模型能理解的文本或 JSON
```

它通常不负责决定“消息应该写入哪个数据库表”，业务判断仍然在 API 侧。

但不能把所有 `tools/*.ts` 都理解成机械 HTTP 转发。有几个重要例外：

- `handlePostMessage()` 会做 invocation 和 `threadId` 的防误投检查；
- `handleHoldBall()` 做跨字段互斥校验；
- `handleShellExec()` 先执行本地命令白名单和路径安全检查；
- proposal 工具自动生成 `clientRequestId`；
- 客户端会把 `stale_ignored`、`held` 转成更适合模型理解的错误；
- 富文本工具可能先做本地 JSON shape 校验。

所以更准确的说法是：

> MCP 工具层负责“必要的本地前置校验 + callback 请求组装 + 结果格式化”；最终业务裁决仍然在 API 侧。

---

## 第三层：API 业务层

主要文件包括：

```text
callbacks.ts
callback-auth-prehandler.ts
callback-scope-helpers.ts
callback-propose-*.ts
approval-hub-routes.ts
```

这一层才处理：

```text
请求者是谁
凭证是否有效
是否已过期
是否是最新 invocation
能否访问目标线程
是否重复提交
消息如何持久化
是否进入 A2A 队列
是否立即广播
是否创建审批项
```

这就是为什么 callback API 不能只看作“简单的 REST endpoint”。

---

# 三、MCP 子进程启动时发生了什么

以 [index.ts](./clowder-ai/packages/mcp-server/src/index.ts:32) 为例：

```text
1. initCatCafeDir()
2. createServer()
3. registerFullToolset()
4. new StdioServerTransport()
5. server.connect(transport)
6. startRefreshLoop()
7. 安装 SIGTERM / SIGINT 退出处理
```

`initCatCafeDir()` 会创建：

```text
~/.cat-cafe/chat
~/.cat-cafe/memory
~/.cat-cafe/workspace
~/.cat-cafe/assets
~/.cat-cafe/.state
```

也可以通过：

```text
CAT_CAFE_DATA_DIR
```

指定数据目录。

## 为什么日志必须写 stderr？

因为：

```text
stdout = MCP JSON-RPC 数据通道
stderr = 普通日志通道
```

如果启动日志写到 stdout：

```text
[cat-cafe] server started
```

宿主进程可能会把它当成 MCP JSON-RPC 内容解析，协议就被破坏。

因此源码使用：

```ts
console.error(...)
```

而不是：

```ts
console.log(...)
```

这是一个很适合面试时主动提到的工程细节。

## 为什么要有 `isEntryPoint`？

因为测试代码可能会：

```ts
import { createServer } from './index.js';
```

如果 import 时自动执行 `main()`，测试就会立即占用 stdin/stdout 并一直等待。`isEntryPoint` 确保只有真正作为 Node 入口执行时才启动 MCP 服务。

---

# 四、工具注册到底发生了什么

## 1. 所有工具先统一成 `ToolDef`

源码定义：

```ts
type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: never) => Promise<unknown>;
};
```

例如：

```text
name:
  cat_cafe_post_message

description:
  向当前线程或指定线程发送消息

inputSchema:
  content、threadId、replyTo、targetCats ...

handler:
  handlePostMessage
```

`handler: (args: never)` 看起来奇怪，实际上是为了让不同参数类型的工具能够先放到同一个数组里，注册时再进行类型转换。

## 2. 为什么 schema 既支持 Zod 又支持 JSON Schema？

项目中存在两种写法。

普通工具大多写成：

```ts
{
  content: z.string(),
  replyTo: z.string().optional()
}
```

某些 limb 工具则是：

```ts
{
  type: 'object',
  properties: {
    toolName: { type: 'string' }
  },
  required: ['toolName']
}
```

所以 `server-toolsets.ts` 要判断：

```text
如果有 type='object' 和 properties
  -> 当作 JSON Schema
  -> 调 jsonSchemaToZod()

否则
  -> 当作 Zod raw shape
  -> z.object(schema)
```

这样最终 MCP SDK 看到的都是统一的 Zod 对象。

## 3. 为什么不用 `server.tool()`？

源码明确使用：

```ts
server.registerTool(name, config, handler)
```

见 [server-toolsets.ts](./clowder-ai/packages/mcp-server/src/server-toolsets.ts:516)。

原因是 `server.tool()` 有多个重载，SDK 会尝试猜某个对象到底是：

```text
inputSchema
还是 annotations
```

普通 JSON Schema 可能被误判成 annotations，导致 handler 参数错位：

```text
正确：
name + config + handler

错误解析：
name + inputSchema + annotations + handler
```

最终表现就是运行时 handler 收不到正确参数。

面试回答可以直接说：

> 由于仓库同时存在 Zod raw shape 和 plain JSON Schema，SDK 的重载 API 存在歧义，因此统一使用显式的 `registerTool(name, config, handler)`，保证 schema、annotations 和 handler 的位置确定。

## 4. 注册时还会加什么？

每个工具会加三类 annotations：

```ts
{
  readOnlyHint,
  destructiveHint,
  openWorldHint
}
```

例如：

```text
search_evidence:
  只读，但可能查询外部知识源

post_message:
  有写操作，但不是破坏性操作

shell_exec:
  可能破坏数据，因此 destructiveHint=true
```

还会在成功的只读工具返回值上尝试追加 freshness notice。它的规则是：

```text
每次工具调用计数一次
至少间隔 5 次调用
每个 MCP 进程最多 3 条
没有 callback 配置就不请求 API
```

注意：

> annotations 是风险提示，不是最终权限控制。真正的权限检查在 API。

---

# 五、一次 `post_message` 调用到底怎么走

下面假设模型调用：

```json
{
  "content": "@opus46 请检查这个 bug",
  "replyTo": "msg-123"
}
```

## 第 1 步：MCP 客户端找到工具

模型通过 MCP 工具列表看到：

```text
cat_cafe_post_message
描述
输入 schema
风险 annotations
```

模型决定调用它。

## 第 2 步：MCP SDK 校验参数

例如：

```text
content 缺失
replyTo 不是字符串
targetCats 不是数组
```

都会在进入 handler 前被拒绝。

这一步属于“协议层输入校验”。

## 第 3 步：本地 handler 做线程防误投

[callback-tools.ts](./clowder-ai/packages/mcp-server/src/tools/callback-tools.ts:710) 会判断：

```text
如果当前使用完整 invocation 凭证，
并且用户又传了 threadId，
直接拒绝。
```

因为 invocation 已经绑定了一个线程。

规则是：

```text
同线程发送：
  省略 threadId

跨线程发送：
  使用 cat_cafe_cross_post_message
```

为什么要这样？

假设旧 invocation 绑定了线程 A，但模型手动传入线程 B。如果没有这个保护，旧进程就可能把消息投递到错误线程，形成“幽灵消息”。

## 第 4 步：生成 `clientMessageId`

如果调用方没有提供：

```ts
clientMessageId
```

客户端会自动生成 UUID：

```ts
clientMessageId: input.clientMessageId ?? randomUUID()
```

它相当于本次业务请求的订单号。

## 第 5 步：组装身份

`callbackPost()` 调用 `getCallbackConfig()`。

它至少需要：

```text
CAT_CAFE_API_URL
```

同时还要有以下一种身份：

```text
CAT_CAFE_INVOCATION_ID + CAT_CAFE_CALLBACK_TOKEN
```

或者：

```text
CAT_CAFE_AGENT_KEY_SECRET
```

请求 header 是：

```http
x-invocation-id: ...
x-callback-token: ...
```

或者：

```http
x-agent-key-secret: ...
```

身份不放在业务 body 中。

优先级是：

```text
完整 invocation 凭证
  > agent key
```

一个细节是：

> 半套 invocation 凭证不能单独组成 invocation 身份；但如果同时存在完整 agent key，客户端仍可以使用 agent key。只有半套 invocation 且没有 agent key 时，配置才不可用。

## 第 6 步：HTTP retry

`callbackPost()` 会进入 `postJsonWithRetry()`：

默认延迟：

```text
第一次请求
失败后等待 1 秒
再失败等待 2 秒
再失败等待 4 秒
```

每次请求有独立的 10 秒 timeout。

会重试：

```text
408
429
5xx
网络异常
```

不会重试：

```text
400
401
403
404
```

因为这些通常是参数、身份或权限问题，继续重试没有价值。

## 第 7 步：必要时写入 outbox

对于 `post_message` 这种重要写操作，源码开启：

```ts
enableOutbox: true
```

如果 retry 之后仍然是可重试失败，就写入：

```text
~/.cat-cafe/callback-outbox/
```

文件中保存：

```text
apiUrl
path
body
headers
attempts
lastError
queuedAt
```

下一次 callback 发送前，会先 flush 旧 outbox。

文件通过：

```text
原文件 -> .processing
```

的 rename 方式进行原子 claim，避免多个并发 flush 同时重放同一条请求。

入队成功时返回：

```json
{
  "status": "queued_for_retry",
  "queuedAt": 1234567890
}
```

这句话不能理解成“服务器已经完成业务”，准确含义是：

> 本次请求已经可靠保存到客户端本地，等待后续重试。

## 第 8 步：API preHandler 解析凭证

服务端在 [callback-auth-prehandler.ts](./clowder-ai/packages/api/src/routes/callback-auth-prehandler.ts:80) 中进行统一预处理：

```text
1. 如果 request.callbackAuth 已存在，跳过
2. 先读 invocation headers
3. 只有 header 完全没有时，才读旧版 body/query
4. 没有 invocation 时再尝试 agent key
5. 完全没凭证时，preHandler no-op
6. 半套 invocation 凭证，401 missing_creds
7. 完整 invocation，registry.verify()
```

为什么完全没凭证时不直接 401？

因为同一个 Fastify 实例还可能有：

```text
浏览器 panel 路由
普通页面路由
其他非 callback 路由
```

所以全局 hook 不能认为所有请求都必须是 callback。

真正需要认证的路由必须显式调用：

```ts
requireCallbackAuth()
```

或：

```ts
requireCallbackPrincipal()
```

这是“全局预处理 + 路由主动收紧”的设计。

## 第 9 步：principal 代表“认证后的身份”

验证成功后，API 会构造 `CallbackPrincipal`。

Invocation principal：

```ts
{
  kind: 'invocation',
  invocationId,
  threadId,
  userId,
  catId
}
```

Agent key principal：

```ts
{
  kind: 'agent_key',
  agentKeyId,
  userId,
  catId,
  scope: 'user-bound'
}
```

这里要区分：

```text
认证：你是谁？
授权：你能操作什么资源？
```

token 正确，只能证明身份正确，不代表可以访问任意 thread。

## 第 10 步：检查线程权限

`resolvePrincipalThread()` 在 [callback-scope-helpers.ts](./clowder-ai/packages/api/src/routes/callback-scope-helpers.ts:99) 中处理线程范围。

Invocation：

```text
不传 threadId
  -> 使用 invocation 自带线程

传同一个 threadId
  -> 允许

传其他 threadId
  -> 查询 ThreadStore 并检查 user 权限
```

Agent key：

```text
没传 threadId
  -> 400

传了 threadId
  -> 查询目标 thread
  -> 检查是否属于当前 user 或 user 可见
```

所以 agent key 没有默认 threadId，是因为它是长期身份，不是一次会话身份。

## 第 11 步：检查是不是旧 invocation

API 会调用：

```ts
registry.isLatest(invocationId)
```

如果一个新 invocation 已经接管了同一个：

```text
(threadId, catId)
```

位置，旧 invocation 再发消息就返回：

```json
{
  "status": "stale_ignored"
}
```

这个响应是 HTTP 200，但业务上表示：

```text
请求收到了，但消息没有送达
```

为什么不用 401 或 500？

因为旧 CLI 进程可能会自动重试。如果返回错误状态，旧进程可能不断重试，造成重试风暴。200 + 业务状态可以让传输层停止重试。

MCP 客户端随后会把它转换成明确错误：

```text
Message was NOT delivered:
this invocation has been superseded by a newer one
```

## 第 12 步：幂等去重

服务端根据 `clientMessageId` 做原子 claim。

Invocation 使用：

```ts
registry.claimClientMessageId(...)
```

Agent key 使用：

```ts
agentKeyRegistry.claimClientMessageId(...)
```

如果已经处理过：

```json
{
  "status": "duplicate",
  "clientMessageId": "..."
}
```

这就是为了处理：

```text
服务器已经成功写入
客户端响应丢失
客户端重新发送
```

没有幂等键，就可能产生重复消息。

## 第 13 步：解析 mention 和富文本

API 会继续处理：

```text
从 content 中提取 rich blocks
解析 @mention
解析显式 targetCats
检查目标猫是否存在
检查目标猫是否启用
检查目标猫是否是当前线程参与者
生成 routing_warnings
```

例如目标猫不存在时，不会默默丢掉，而是返回：

```text
cat_not_found
cat_disabled
target_not_in_thread
```

客户端还会把 400 的路由错误转换成：

```text
人类可读前缀
+
原始 JSON
```

这样模型能读懂，同时程序仍能解析机器字段。

## 第 14 步：落库、队列、广播

消息先写入 MessageStore，获得 messageId。

然后根据投递情况选择：

```text
存在可入队的 A2A 目标：
  deliveryStatus = queued
  交给 QueueProcessor
  暂时不立即广播

没有有效入队目标：
  直接 WebSocket broadcast

入队失败：
  fallback 到 broadcast
```

为什么 queued 时不同时 broadcast？

因为否则同一条消息可能出现：

```text
队列投递一次
即时广播一次
```

前端或目标猫就可能收到两次。

因此这里是：

```text
持久化成功
  -> 选择队列或广播
  -> 队列失败时广播兜底
```

## 第 15 步：返回工具结果

成功：

```json
{
  "status": "ok",
  "threadId": "thread-1",
  "messageId": "msg-456",
  "routed": ["opus46"],
  "clientMessageId": "..."
}
```

特殊状态：

```text
stale_ignored:
  当前 invocation 已过期，不再投递

held:
  当前猫有未读消息，新消息暂时保留
```

`held` 时，客户端会提示模型：

```text
先读取新消息
根据新上下文修改内容
或者 acknowledgeHeld=true 强制发送
```

---

# 六、Invocation 和 Agent Key 怎么区分

## Invocation

Invocation 是一次具体猫会话的短期身份。

`InvocationRecord` 包含：

```text
invocationId
callbackToken
userId
catId
threadId
expiresAt
clientMessageIds
```

默认 TTL 是 2 小时，源码见 [InvocationRegistry.ts](./clowder-ai/packages/api/src/domains/cats/services/agents/invocation/InvocationRegistry.ts:20)。

它的特点：

```text
短期
绑定 thread
绑定 user
绑定 cat
可以检查是否为最新 invocation
```

## Agent key

Agent key 是长期注册身份。

默认 TTL 是 45 天，可以轮换；旧 key 轮换后默认有 24 小时 grace period。

生成时：

```text
随机生成 secret
生成 salt
保存 SHA-256(secret + salt)
只把明文 secret 返回一次
```

它的特点：

```text
长期
不绑定 thread
绑定 user 和 cat
适合常驻 agent、共享 MCP、云端连接器
```

面试时可以这样概括：

> Invocation 更像一次登录 session；agent key 更像长期 API key。Invocation 自带线程上下文，agent key 没有，所以 agent key 调用必须显式提供 threadId。

---

# 七、为什么系统不是 exactly-once

系统中可能发生：

```text
HTTP retry
outbox replay
服务端执行成功但响应丢失
CLI 进程发送成功后立刻崩溃
```

因此客户端无法确定：

```text
“我没收到响应”是否代表服务端没执行
```

所以系统采用：

```text
at-least-once delivery
+
服务端幂等去重
```

而不是 exactly-once。

面试回答：

> 网络层无法可靠判断远端是否已经执行，因此只能保证至少投递一次；为了避免重复副作用，服务端通过 `clientMessageId`、`clientRequestId` 和原子 claim 实现业务幂等。

---

# 八、Proposal 和 Approval Hub

Proposal 不是直接执行动作，而是创建审批请求。

三个主要 proposal：

```text
propose-thread
propose-session-handoff
propose-profile-update
```

共同流程：

```text
Invocation 认证
  -> Zod 校验
  -> 检查是否最新
  -> clientRequestId 去重
  -> 创建 proposal
  -> 追加用户可见的确认卡片
  -> 广播 proposal_created
  -> 等用户 approve / reject
```

所以：

```text
proposal 创建成功
!=
目标状态已经变更
```

例如 `propose-thread` 成功，只表示：

```text
“申请新建线程”已经进入审批队列
```

并不代表线程已经创建。

## 为什么要检查 cardMessageId？

可能出现部分成功：

```text
proposal 已写入
确认卡也写入
但 cardMessageId 标记保存失败
```

如果仅凭 proposal record 就返回 deduped success，UI 可能找不到审批卡。

因此服务端会：

```text
扫描 source thread
查找对应 rich block
尝试回填 cardMessageId
仍然找不到 -> 503 retryable
```

这是在避免“数据库看起来成功，但用户实际上看不到审批项”。

## Approval Hub 做什么？

[approval-hub-routes.ts](./clowder-ai/packages/api/src/routes/approval-hub-routes.ts:25) 提供：

```text
GET /api/approval-hub/pending
GET /api/approval-hub/settled
```

它只做：

```text
调用各个 adapter
合并结果
排序
返回统一结构
```

不负责真正批准，也没有缓存和副作用。

这样不同 feature 的 proposal store 可以保持自己的数据结构，但对前端暴露统一的审批视图。

---

# 九、本地工具为什么也需要安全边界

`cat_cafe_shell_exec` 不是一个普通的任意 shell。

它只允许：

```text
pwd
ls
cat
git log
git status
git rev-parse
git diff
git show
```

并拒绝：

```text
rm -rf
mv / cp / mkdir
git checkout / commit
npm install
管道 |
重定向 >
命令分隔 ;
变量替换 $
反引号
glob 通配符
fork bomb
访问 Redis 6399
```

同时会：

```text
限制工作目录
检查每个路径是否在允许根目录内
跟随 realpath 防止符号链接逃逸
限制输出 256KB
限制执行时间 30 秒
```

这体现了一个原则：

> “只读工具”必须在实现层真正只读，不能仅靠工具名字或 annotations 判断。

---

# 十、stdio 入口和 remote-spike 入口的区别

默认入口：

```text
stdin/stdout
StdioServerTransport
```

`remote-spike.ts` 是另一种实验性远程入口：

```text
Streamable HTTP
默认绑定 127.0.0.1:3098
使用 ?token= 临时守卫
```

它还会做更严格的启动检查：

```text
必须配置 remote token
必须是 cloud-pro-phase0
必须 readonly=true
必须有 cat_id / user_id
必须有 agent key
禁止继承 invocation 凭证
```

并在响应输出层对常见密钥模式做脱敏。

为什么禁止继承 invocation 凭证？

因为远程云端连接器应该使用自己的 agent key。如果它意外继承父进程的 invocation 环境变量，由于 invocation 优先级更高，远程请求可能错误地以另一个会话身份执行。

---

# 十一、面试最容易追问的几个问题

## 1. MCP 和 REST callback 是什么关系？

> MCP 是模型到 Node 工具进程的协议，REST callback 是 Node 工具进程到 Clowder API 的通信方式。模型不会直接调用 callback API，而是先调用 MCP tool，tool handler 再发 HTTP。

## 2. 为什么 API 还要再鉴权，MCP schema 不是已经限制了吗？

> schema 只能限制参数格式，不能证明调用者是谁，也不能防止恶意客户端绕过 MCP 直接调用 API。因此 schema 属于输入校验，API principal 和 scope 才是安全边界。

## 3. 为什么要同时有 invocation 和 agent key？

> Invocation 适合一次具体会话，带 threadId、TTL 短、能判断是否被新会话替代；agent key 适合长期常驻 agent，不绑定线程，但调用时必须显式提供 threadId。

## 4. `preHandler` 没凭证时为什么不直接 401？

> 因为同一个 Fastify 实例中还有 panel/browser 路由，不能让 callback 鉴权逻辑影响所有请求。因此全局 hook 对无凭证请求 no-op，具体 callback route 必须显式调用 `requireCallbackAuth()` 或 `requireCallbackPrincipal()`。

## 5. 如何防止旧进程继续发消息？

> InvocationRegistry 为每个 `(threadId, catId)` 维护最新 invocation。业务路由调用 `isLatest()`，旧 invocation 返回 `stale_ignored`。返回 200 是为了避免旧进程进入 retry storm，但 MCP 客户端会把它转成明确错误。

## 6. 如何防止重复消息？

> 客户端为每次写操作生成 `clientMessageId`，服务端通过 registry 或 agent-key backend 原子 claim。即使 HTTP retry 或 outbox replay，也会被识别成 duplicate。

## 7. outbox 能不能保证 exactly-once？

> 不能。outbox 只保证请求在客户端本地持久化并至少尝试投递一次。服务端可能已经成功但客户端没收到响应，所以必须依赖业务幂等键消除重复副作用。

## 8. 为什么 refresh 用 `preValidation`？

> 因为需要在普通 preHandler 验证并滑动 TTL 之前先做 cooldown claim，否则被 429 限流的请求仍可能续期 token。`verifyLatest()` 又把 token 验证、latest 检查和 TTL 滑动合并为原子操作，避免竞态。

## 9. 为什么 proposal 不直接创建线程或修改 profile？

> 这些动作有较大副作用，需要用户确认。proposal 的成功语义只是“审批项和确认卡已经创建并可见”，最终状态变化要等用户 approve。

## 10. annotations 能不能代替权限控制？

> 不能。annotations 只是给 MCP 客户端和安全策略的风险提示；真正授权由 API 侧的 principal、thread scope、资源所有权和业务状态决定。

---

# 十二、你可以在面试中这样总结

> Clowder 的 MCP 模块可以看成模型和后端 API 之间的适配层。Node MCP 子进程通过 stdio 暴露带 schema 和 annotations 的工具，模型调用工具后，handler 负责参数校验、身份选择和 callback 请求组装。callback 客户端对写操作提供有界 retry 和 outbox，服务端则通过 invocation 或 agent key 生成 principal，再进行 thread scope、最新 invocation 和幂等检查。消息落库后根据 A2A 队列是否可用决定 queued 或 broadcast，并在入队失败时做广播兜底。Proposal 工具只创建待审批项，不直接执行最终变更；refresh loop 在后台续期 invocation；Approval Hub 负责聚合审批状态。整体保证的是 at-least-once 投递，依靠服务端幂等键避免重复副作用。

最简洁的一句话是：

> **MCP 负责让模型“会调用工具”，callback 负责让工具“能够请求 API”，API 负责判断这次请求“是谁发的、能操作什么、是否真的生效”。**

<details><summary>1 previous message</summary>

> 这一版我会专门补上前面容易跳过去的“中间过程”：给出实际的 MCP JSON-RPC、实际的 HTTP callback、每个对象在请求中的变化，以及不同失败状态的含义。这样你面对“请求从哪里来、凭证放哪、谁最终做决定、失败后会不会重复”这类连续追问时，可以按时间顺序回答。
</details>

这次我把它按“完全从零理解”的方式讲。你不需要先懂 MCP、Fastify、Zod 或 Redis，只要沿着一次“猫发消息”的时间线看，就能理解整个模块。

---

# 先记住最重要的一句话

> **MCP 解决“模型如何调用工具”；callback 解决“工具进程如何请求后端”；API 解决“请求者是谁、能访问什么、业务是否真正执行”。**

也就是说：

```text
模型
  --MCP JSON-RPC-->
Node MCP 子进程
  --HTTP callback-->
Clowder API
  --存储 / 队列 / 广播 / 审批-->
共享业务状态
```

MCP 不是数据库访问协议，也不是认证系统。

---

# 一、先认识 6 个对象

很多源码名词容易混淆。你可以把它们想象成“订单系统”中的不同东西。

## 1. `ToolDef`：工具目录中的一行

定义在 [server-toolsets.ts](./clowder-ai/packages/mcp-server/src/server-toolsets.ts:32)。

```ts
type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: never) => Promise<unknown>;
};
```

它描述的是：

```text
工具叫什么
工具做什么
需要哪些参数
真正执行哪个函数
```

例如：

```text
name:
  cat_cafe_post_message

inputSchema:
  content、threadId、replyTo、targetCats ...

handler:
  handlePostMessage
```

它还没有执行请求，只是“工具说明书”。

---

## 2. `CallbackConfig`：MCP 客户端手里的连接配置

它来自环境变量，例如：

```text
CAT_CAFE_API_URL
CAT_CAFE_INVOCATION_ID
CAT_CAFE_CALLBACK_TOKEN
CAT_CAFE_AGENT_KEY_SECRET
```

它表示：

```text
后端 API 地址是什么
我准备使用哪种身份
对应的凭证是什么
```

它只存在于 MCP 子进程这一侧。

---

## 3. `InvocationRecord`：API 服务器登记的一次调用

定义在 [InvocationRegistry.ts](./clowder-ai/packages/api/src/domains/cats/services/agents/invocation/InvocationRegistry.ts:20)。

```ts
{
  invocationId,
  callbackToken,
  userId,
  catId,
  threadId,
  createdAt,
  expiresAt,
  clientMessageIds
}
```

它表示：

```text
这个 invocation 属于哪个用户
代表哪只猫
绑定哪个 thread
token 是否过期
已经处理过哪些 clientMessageId
```

可以把它理解成服务器上的“登录 session 记录”。

---

## 4. `CallbackPrincipal`：请求验证之后的身份标签

定义在 [callback-principal.ts](./clowder-ai/packages/shared/src/types/callback-principal.ts)。

它只有两种：

```ts
{
  kind: 'invocation',
  invocationId,
  threadId,
  userId,
  catId
}
```

或者：

```ts
{
  kind: 'agent_key',
  agentKeyId,
  userId,
  catId,
  scope: 'user-bound'
}
```

它表示：

> API 已经验证完这个请求，现在给 request 贴上“这个请求是谁发的”标签。

因此：

```text
CallbackConfig      = 客户端准备带什么凭证
InvocationRecord    = 服务端登记了什么凭证
CallbackPrincipal   = 当前请求验证成功之后是谁
```

---

## 5. `CallbackActor`：业务代码使用的调用者信息

它是在 principal 或 invocation record 之上，又整理出：

```text
invocationId
parentInvocationId
threadId
userId
catId
```

`parentInvocationId` 主要用于让 callback 路径和 QueueProcessor 使用同一个外层 invocation 标识，从而保证前端去重一致。

这是比较深入的实现细节，面试官追问“为什么要 parentInvocationId”时可以提。

---

## 6. `OutboxEntry`：还没成功发送的请求

它是本地磁盘上的待重试记录：

```text
请求路径
请求 body
请求 headers
queuedAt
attempts
lastError
```

它不是业务消息本身，而是“如何把业务请求可靠送出去”的投递状态。

---

# 二、先看真实的两段协议

## 第一段：MCP 协议

模型调用工具时，MCP 侧逻辑上类似：

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "cat_cafe_post_message",
    "arguments": {
      "content": "@opus46 请检查这个 bug"
    }
  }
}
```

这条消息通过：

```text
stdin/stdout
```

传给 Node MCP 子进程。

MCP 子进程返回的也是 MCP 结果：

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"status\":\"ok\",\"messageId\":\"msg-123\"}"
      }
    ]
  }
}
```

注意，这里还没有 HTTP，也还没有 API。

---

## 第二段：callback HTTP

MCP 工具 handler 内部再发送：

```http
POST /api/callbacks/post-message
Content-Type: application/json
x-invocation-id: inv-abc
x-callback-token: token-xyz
```

body 类似：

```json
{
  "content": "@opus46 请检查这个 bug",
  "clientMessageId": "client-msg-uuid"
}
```

当前客户端把身份放在 header 中，不再把凭证放入 body。服务端仍然保留 body/query 读取逻辑，用于兼容旧版 MCP 客户端。

因此一定要区分：

```text
模型 -> MCP 子进程：JSON-RPC
MCP 子进程 -> API：HTTP + JSON
```

---

# 三、MCP 子进程是怎么启动的

以 [index.ts](./clowder-ai/packages/mcp-server/src/index.ts:32) 为例：

```text
1. 初始化 ~/.cat-cafe 目录
2. 创建 McpServer
3. 注册工具
4. 创建 StdioServerTransport
5. 连接 stdin/stdout
6. 启动后台 refresh loop
7. 安装 SIGTERM / SIGINT 退出处理
```

分体入口 [collab.ts](./clowder-ai/packages/mcp-server/src/collab.ts:27) 的结构一样，只是注册的工具集合不同。

## 为什么拆成多个入口？

因为 all-in-one 会一次性把大量工具塞进模型的工具列表：

```text
工具越多
  -> 模型选择噪音越大
  -> 工具描述占用上下文越多
  -> 误调用概率越高
```

所以拆成：

```text
collab
memory
signals
audio
finance
limb
```

让不同场景只挂载需要的工具。

`index.ts` 保留，是为了兼容旧配置。

## 为什么日志必须写 stderr？

因为：

```text
stdout = MCP JSON-RPC 通道
stderr = 普通日志通道
```

如果 stdout 出现：

```text
server started
```

宿主进程可能把它误认为协议数据，导致整个 MCP 会话解析失败。

## 为什么 import 时不能自动启动？

测试代码会 import：

```ts
import { createServer } from './index.js';
```

如果 import 就启动 stdio，测试会一直占用输入流。因此源码使用 `isEntryPoint`，只有真正执行入口文件时才运行 `main()`。

---

# 四、工具注册的完整过程

工具注册中枢是 [server-toolsets.ts](./clowder-ai/packages/mcp-server/src/server-toolsets.ts:516)。

注册时做四件事：

```text
1. 按环境筛选工具
2. 把输入 schema 转成 Zod
3. 加入 annotations
4. 调用 server.registerTool()
```

## 为什么要把 plain JSON Schema 转成 Zod？

项目中 schema 写法不统一。

大多数工具：

```ts
{
  content: z.string(),
  threadId: z.string().optional()
}
```

部分 limb 工具：

```ts
{
  type: 'object',
  properties: {
    toolName: { type: 'string' }
  },
  required: ['toolName']
}
```

所以注册层判断：

```text
有 type + properties
  -> 当作 JSON Schema
  -> jsonSchemaToZod()

否则
  -> 当作 Zod raw shape
  -> z.object(schema)
```

这保证 MCP SDK 最终拿到统一的运行时校验对象。

## 为什么不用 `server.tool()`？

因为 SDK 的 `server.tool()` 是重载函数，需要猜参数对象到底是：

```text
inputSchema
还是 annotations
```

plain JSON Schema 可能被误判成 annotations，最后造成：

```text
handler 参数位置错位
```

因此源码显式使用：

```ts
server.registerTool(name, {
  description,
  inputSchema,
  annotations,
}, handler);
```

面试回答：

> 项目同时支持 Zod raw shape 和 plain JSON Schema，而 SDK 的重载 API 存在歧义，所以使用显式 `registerTool`，让 schema、annotations、handler 的位置完全确定。

---

# 五、工具暴露有两层限制

## 第一层：按入口拆分

例如：

```text
collab.ts -> 协作工具
memory.ts -> 记忆工具
```

这是“减少模型看到的工具数量”。

## 第二层：按环境白名单过滤

`server-toolsets.ts` 会读取：

```text
CAT_CAFE_READONLY
CAT_CAFE_AGENT_KEY_SECRET
CAT_CAFE_DESKTOP_MODE
```

逻辑大致是：

```text
普通模式：
  暴露完整工具集

readonly=true：
  只暴露 READONLY_ALLOWED_TOOLS
  如果存在 agent key，再开放 AGENT_KEY_TOOLS

desktop mode：
  使用严格的 phase0 白名单
  不与 readonly / agent-key 做并集
```

这里体现的是：

```text
入口拆分 = 减少认知噪音
白名单过滤 = 限制能力范围
```

两者不是一个问题。

---

# 六、完整跟踪一次 `post_message`

下面按真实时间顺序走一遍。

假设模型想发送：

```text
@opus46 请检查这个 bug
```

## 第 1 步：模型选择工具

模型从 MCP 工具列表中看到：

```text
cat_cafe_post_message
description
inputSchema
annotations
```

它根据描述决定调用该工具。

---

## 第 2 步：MCP SDK 做参数校验

如果模型传入：

```json
{
  "content": 123
}
```

或者缺少必填字段，MCP 层直接拒绝。

这一步只回答：

```text
参数格式对不对？
```

它不回答：

```text
调用者是谁？
有没有权限？
```

---

## 第 3 步：`handlePostMessage()` 做本地线程保护

源码位置：

[callback-tools.ts](./clowder-ai/packages/mcp-server/src/tools/callback-tools.ts:710)

规则：

```text
如果是 invocation 身份，
普通 post_message 不允许传 threadId。

同线程：
  省略 threadId

跨线程：
  使用 cross_post_message
```

为什么？

因为 invocation 已经绑定了一个 thread。如果允许模型随便传 threadId，就可能发生：

```text
旧 invocation 属于 thread-A
模型手动传 thread-B
消息被错误发送到 thread-B
```

这就是“幽灵线程”或“误投递”问题。

需要注意：

```text
agentKeyCatId 只是选择哪个 agent key 文件
不是最终身份本身
```

真正决定身份的是最终发出的 header。

---

## 第 4 步：生成 `clientMessageId`

如果调用方没有提供：

```ts
clientMessageId
```

MCP 客户端自动生成 UUID。

这个 ID 是：

```text
本次业务请求的唯一订单号
```

不是 HTTP request id，而是业务幂等键。

---

## 第 5 步：`getCallbackConfig()` 读取身份

`callbackPost()` 会读取：

```text
CAT_CAFE_API_URL
```

以及两种身份之一：

```text
CAT_CAFE_INVOCATION_ID + CAT_CAFE_CALLBACK_TOKEN
```

或者：

```text
CAT_CAFE_AGENT_KEY_SECRET
```

规则是：

```text
完整 invocation 凭证优先
否则使用 agent key
```

半套 invocation：

```text
只有 invocationId
或只有 callbackToken
```

不能单独组成 invocation 身份。

但是，如果同时有完整 agent key，它可以退回到 agent key。不能简单说成“半套 invocation 一定返回 null”。

---

## 第 6 步：构造 HTTP 请求

`buildAuthHeaders()` 会生成：

```http
x-invocation-id: ...
x-callback-token: ...
```

或者：

```http
x-agent-key-secret: ...
```

完整 invocation 和 agent key 同时存在时，最终只发 invocation headers。

这条优先级非常重要，因为它意味着：

```text
不能通过传入 agentKeyCatId
改变真正的认证主体
```

---

## 第 7 步：callback POST 进行 retry

默认重试策略：

```text
第一次发送
失败后等待 1 秒
失败后等待 2 秒
失败后等待 4 秒
```

每次请求最多等待 10 秒。

可重试：

```text
网络异常
408
429
5xx
```

不可重试：

```text
400
401
403
404
```

原因很简单：

```text
网络暂时断了，重试可能恢复
参数错了，重试不会变好
权限错了，重试不会变好
```

---

## 第 8 步：失败时进入 outbox

`post_message` 启用了：

```ts
enableOutbox: true
```

如果 retry 结束后仍然是可重试错误，就写入：

```text
~/.cat-cafe/callback-outbox/
```

下一次 callback 调用前：

```text
先 flush 旧 outbox
再发送当前请求
```

文件名形如：

```text
${queuedAt}-${id}.json
```

`queuedAt` 放在文件名开头，配合 `readdir().sort()` 达到近似 FIFO 效果。

发送时先：

```text
request.json
  -> request.json.processing
```

这个 rename 是原子 claim，用来避免多个进程同时重放同一条请求。

如果本次请求成功入队，返回：

```json
{
  "status": "queued_for_retry",
  "queuedAt": 1234567890
}
```

这不是：

```text
服务器已经执行成功
```

而是：

```text
客户端已经把请求保存下来，未来会继续尝试
```

---

## 第 9 步：API preHandler 检查凭证

服务端入口是：

[callback-auth-prehandler.ts](./clowder-ai/packages/api/src/routes/callback-auth-prehandler.ts:80)

逻辑：

```text
1. 如果 request.callbackAuth 已存在，直接跳过
2. 先读 invocation headers
3. 两个 invocation header 都不存在时，才读 legacy body/query
4. 没有 invocation 时再检查 agent key
5. 完全无凭证时，preHandler no-op
6. 只有半套 invocation 时，401 missing_creds
7. 完整 invocation 交给 registry.verify()
```

为什么完整 invocation 验证失败后不自动切换 agent key？

因为这会产生安全问题：

```text
攻击者故意发送错误 invocation
然后借助另一个 agent key 继续执行
```

所以一旦请求明确带了 invocation 身份，服务端就按 invocation 路径处理，不能偷偷 fall through。

---

## 第 10 步：路由显式要求 principal

`post-message` 路由的第一道业务保护是：

```ts
const principal = requireCallbackPrincipal(request, reply);
```

它允许：

```text
invocation
agent key
```

而 proposal 路由使用：

```ts
requireCallbackAuth()
```

只允许 invocation。

所以不同 API 路由可以有不同的认证等级。

---

## 第 11 步：从身份推导线程权限

服务端不是看到 token 正确就允许访问所有 thread。

它还要判断：

```text
这个 user 能不能访问目标 thread？
```

在 [callback-scope-helpers.ts](./clowder-ai/packages/api/src/routes/callback-scope-helpers.ts:99) 中：

### Invocation

```text
不传 threadId
  -> 使用 invocation 自带的 threadId

传同一个 threadId
  -> 允许

传其他 threadId
  -> 查询 ThreadStore
  -> 检查 user 是否有权限
```

### Agent key

```text
不传 threadId
  -> 400

传 threadId
  -> 查询目标 thread
  -> 检查是否属于当前 user 或 user 可见
```

因此：

```text
认证 = 你是谁
授权 = 你能访问哪个 thread
```

两者不能混为一谈。

---

## 第 12 步：检查 invocation 是否最新

API 会调用：

```ts
registry.isLatest(invocationId)
```

假设：

```text
旧 invocation-A 正在运行
新 invocation-B 启动
B 接管同一个 thread + cat
A 又发来 callback
```

A 就会被视为 stale。

服务端返回：

```json
{
  "status": "stale_ignored"
}
```

这是：

```text
HTTP 请求成功到达
但业务上拒绝继续投递
```

为什么用 200？

因为如果返回 500 或 401，旧 CLI 可能无限 retry，造成重试风暴。

MCP 客户端会把这个 200 业务结果重新转换为工具错误：

```text
消息没有送达，因为当前 invocation 已被更新的 invocation 替代。
```

---

## 第 13 步：检查幂等键

服务端使用：

```text
clientMessageId
```

进行原子 claim。

Invocation 路径：

```ts
registry.claimClientMessageId(...)
```

Agent key 路径：

```ts
agentKeyRegistry.claimClientMessageId(...)
```

如果已经处理过：

```json
{
  "status": "duplicate",
  "clientMessageId": "..."
}
```

这是为了解决最常见的网络问题：

```text
服务端已经写成功
客户端没收到响应
客户端认为失败
客户端重新发送
```

没有幂等键，就会变成重复消息。

---

## 第 14 步：解析富文本和 mention

API 会：

```text
提取 rich block
解析 @mention
解析显式 targetCats
检查目标猫是否存在
检查目标猫是否启用
检查目标猫是否属于当前线程参与者
```

如果目标猫不存在，返回：

```text
cat_not_found
```

如果目标猫被禁用，返回：

```text
cat_disabled
```

这些错误在客户端会被格式化成：

```text
人类可读说明
+
原始 JSON
```

这样模型可以读懂，程序也能继续解析结构化字段。

---

## 第 15 步：消息落库

API 先将消息写入 MessageStore，拿到：

```text
messageId
```

此时消息已经有持久化记录。

---

## 第 16 步：选择队列还是广播

之后根据是否有 A2A 目标进行选择：

```text
有可入队目标：
  deliveryStatus='queued'
  交给 QueueProcessor
  暂时不立即 broadcast

没有有效目标：
  直接 WebSocket broadcast

入队失败：
  fallback 到 broadcast
```

为什么不能“队列和广播都做”？

因为会产生双投递：

```text
队列送一次
广播送一次
```

所以正确理解是：

> 先持久化消息，再根据投递条件选择队列或广播；入队失败时用广播兜底，避免消息消失。

---

## 第 17 步：返回给模型

正常返回：

```json
{
  "status": "ok",
  "threadId": "thread-1",
  "messageId": "msg-456",
  "routed": ["opus46"],
  "clientMessageId": "client-msg-uuid"
}
```

特殊返回：

```text
duplicate
  请求之前已经处理过

queued_for_retry
  请求已保存到本地 outbox

stale_ignored
  invocation 已被新 invocation 替代

held
  当前猫有未读消息，新消息暂时不发送
```

---

# 七、认证、授权和业务执行的区别

这三件事面试时一定要分开说。

## 1. 认证 Authentication

回答：

```text
你是谁？
```

例如：

```text
invocationId + callbackToken 是否匹配？
agent key 是否有效？
```

## 2. 授权 Authorization

回答：

```text
你能操作什么？
```

例如：

```text
这个 user 能不能访问 thread-B？
这只猫能不能操作另一个 cat 的 profile？
agent key 是否必须指定 threadId？
```

## 3. 业务执行 Business Effect

回答：

```text
最终数据有没有真正变化？
```

例如：

```text
消息有没有落库？
有没有进入队列？
有没有广播？
proposal 是否创建成功？
用户是否真正 approve？
```

所以：

```text
token 正确
  !=
thread 权限正确

thread 权限正确
  !=
消息一定已经送达

proposal 创建成功
  !=
最终操作已经执行
```

---

# 八、Invocation 的生命周期

## 1. 创建

API 生成：

```text
invocationId
callbackToken
userId
catId
threadId
expiresAt
```

然后把凭证注入 CLI 子进程环境变量。

## 2. 使用

每次 callback：

```text
MCP 读取环境变量
  -> 加入 HTTP header
  -> API registry.verify()
```

## 3. 滑动续期

成功验证时可以滑动 TTL，让长时间运行的猫不会因为没有调用工具而突然过期。

默认 TTL：

```text
2 小时
```

## 4. 被新 invocation 替代

同一个：

```text
(threadId, catId)
```

位置只能有一个最新 invocation。

旧 invocation 继续 callback：

```text
stale_ignored
```

## 5. 过期

超过 TTL 后：

```text
expired
```

## 6. registry 重启

如果 invocation 只存在内存中，API 重启可能丢失记录：

```text
unknown_invocation
```

所以 `InvocationRegistry` 设计成 backend 可替换，支持 memory 或 Redis。多实例部署时需要共享 backend，否则不同 API 实例可能无法识别同一个 invocation。

---

# 九、Refresh loop 为什么不是一个 MCP 工具

refresh loop 在：

[refresh-loop.ts](./clowder-ai/packages/mcp-server/src/refresh-loop.ts:153)

它会在后台定时调用：

```text
POST /api/callbacks/refresh-token
```

它不暴露给模型，是因为：

```text
刷新 token 是基础设施动作
不是模型需要思考的业务动作
```

客户端最小间隔大约 6.18 分钟，而服务端 cooldown 是 5 分钟。

原因是客户端有 `0.85 ~ 1.15` 的随机 jitter。如果直接使用 5 分钟，最短可能变成：

```text
5 分钟 × 0.85 = 4.25 分钟
```

早于服务端 cooldown，必然收到 429。

## refresh 的服务端顺序

[callbacks.ts](./clowder-ai/packages/api/src/routes/callbacks.ts:3265)：

```text
preValidation:
  1. 提取完整 invocation 凭证
  2. peek，不滑动 TTL
  3. claim 5 分钟 cooldown
  4. verifyLatest，原子完成：
       token 验证
       stale 检查
       TTL 滑动
  5. 写入 request.callbackAuth

handler:
  6. 重新读取 record
  7. 计算 ttlRemainingMs
```

为什么不放普通 preHandler？

因为如果先 verify 再判断 cooldown：

```text
即使最后返回 429
token 也已经被续期
```

这样 cooldown 就只是在“表面限流”，实际上请求仍然延长了 token 生命周期。

---

# 十、Proposal 的真实含义

Proposal 工具不是直接执行动作，而是创建“待审批申请”。

例如：

```text
cat_cafe_propose_thread
cat_cafe_propose_session_handoff
cat_cafe_propose_profile_update
```

通用流程：

```text
1. invocation 鉴权
2. Zod 校验
3. 检查 invocation 是否最新
4. 根据 clientRequestId 查重
5. 原子 reserve dedup
6. 创建 proposal
7. 写用户可见的确认卡
8. 记录 cardMessageId
9. 广播 proposal_created
10. 等用户 approve/reject
```

所以：

```text
proposal 创建成功
```

只表示：

```text
审批请求已经创建
确认卡已经对用户可见
```

不表示：

```text
线程已经创建
session 已经接力
profile 已经被修改
```

## 为什么要检查确认卡是否可见？

可能出现：

```text
proposal 写入成功
确认卡写入成功
但 cardMessageId 保存失败
```

如果只根据 proposal record 返回成功，用户可能根本看不到审批项。

因此源码会：

```text
扫描 source thread
寻找对应 rich block
尝试修复 cardMessageId
仍然找不到 -> 503 retryable
```

这属于“部分成功后的自愈”。

## Proposal 为什么也需要 `clientRequestId`？

因为 callback 也可能 retry：

```text
第一次 proposal 已创建
响应丢失
客户端重试
```

如果没有 `clientRequestId`，就会创建两个审批项。

---

# 十一、Approval Hub 是什么

Approval Hub 不是审批执行器，而是审批列表聚合器。

接口：

```text
GET /api/approval-hub/pending
GET /api/approval-hub/settled
```

它做的是：

```text
调用多个 feature adapter
合并结果
按时间排序
返回统一 ApprovalItem
```

不同 feature 可以有不同底层 store：

```text
F128 thread proposal
F193 dispatch proposal
F225 session handoff
F231 profile update
```

但前端不需要知道每个 feature 的内部存储结构。

这就是 adapter 的作用：

```text
内部数据结构不同
对外统一审批模型
```

---

# 十二、本地工具和 callback 工具的区别

并不是所有 MCP 工具都要调用 API。

例如一些本地只读工具：

```text
cat_cafe_search_evidence
cat_cafe_graph_resolve
cat_cafe_read_file_slice
```

可能直接读取本地索引或文件。

但本地工具也不能无限制地执行。

以 [shell-tools.ts](./clowder-ai/packages/mcp-server/src/tools/shell-tools.ts) 为例，只允许：

```text
pwd
ls
cat
git log
git status
git rev-parse
git diff
git show
```

拒绝：

```text
rm -rf
mv / cp / mkdir
git checkout / commit
npm install
管道 |
重定向 >
命令替换 $
反引号
glob 通配符
fork bomb
Redis 6399
```

还会：

```text
检查 cwd 是否在允许目录
检查每个路径
跟随 realpath 防止符号链接逃逸
限制输出 256KB
限制执行时间 30 秒
```

面试时可以说：

> 只读能力必须在实现层真正只读，不能只依赖工具名称或 `readOnlyHint`。

---

# 十三、错误状态应该怎么理解

| 状态 | 典型含义 |
|---|---|
| `400` | 参数格式、跨线程规则、项目路径等输入错误 |
| `401` | 凭证缺失、token 错误、过期、invocation 不存在 |
| `403` | 身份有效，但无权访问目标 thread 或资源 |
| `404` | 目标 thread 或资源不存在 |
| `429` | refresh cooldown 或业务限流 |
| `503` | thread store 暂时不可用、proposal 卡片仍在处理中等 |
| `200 + duplicate` | 请求已处理过 |
| `200 + stale_ignored` | 请求来自旧 invocation，业务忽略 |
| `200 + queued_for_retry` | 请求已落盘等待重试 |
| `200 + held` | 消息暂时被未读消息门控 |

这里最重要的是：

> HTTP 状态只表示传输或粗粒度处理结果，真正的业务语义还要看 JSON body 中的 `status`、`reason` 和 `message`。

---

# 十四、面试官连续追问时的回答套路

遇到任何 callback 工具，都按下面 7 个问题回答：

```text
1. 工具输入是什么？
2. MCP 层做了哪些参数和安全校验？
3. callback 使用哪种身份？
4. API 如何认证 principal？
5. 如何检查 thread/resource scope？
6. 如何防止 retry 造成重复？
7. 业务成功、排队、忽略、失败分别如何返回？
```

例如面试官问：

> 你们怎么保证 post_message 不会发错线程？

可以按顺序回答：

> MCP handler 对 invocation 调用者禁止手动传入 threadId，普通消息默认使用 invocation 绑定的线程，跨线程必须走 cross-post 工具。API 侧仍然会通过 principal 和 ThreadStore 重新校验目标 thread，不能只依赖客户端。这样客户端前置防误用，服务端最终防越权。

面试官问：

> 你们怎么保证消息不会重复？

回答：

> callback 层可能因为网络异常、超时和 outbox replay 重发，所以系统不追求 exactly-once，而是 at-least-once delivery。客户端生成 `clientMessageId`，服务端通过 invocation registry 或 agent-key registry 原子 claim；重复请求返回 duplicate，不再次写入业务状态。

面试官问：

> token 过期后是不是收到 401 就无限刷新？

回答：

> 不是。服务端返回结构化 reason。`expired` 和 `unknown_invocation` 可能进入刷新或降级处理；`invalid_token` 说明 token 本身不匹配，`stale_invocation` 说明调用已经被新 invocation 替代，这两类不能盲目刷新，否则可能掩盖客户端错误或重新创建旧状态。

面试官问：

> 为什么 proposal 不直接创建 thread？

回答：

> 因为创建 thread 或修改 profile 是高副作用操作，需要用户确认。MCP 工具只创建 proposal 和用户可见确认卡，用户 approve 之后才执行最终变更。proposal 的成功语义是“审批项已进入系统”，不是“最终动作已完成”。

面试官问：

> preHandler 没凭证时为什么不直接拒绝？

回答：

> 因为同一 Fastify 实例还服务 panel/browser 路由，全局 hook 不能把所有请求都当 callback。它对无凭证请求 no-op，但所有需要 callback 身份的路由必须显式调用 `requireCallbackAuth()` 或 `requireCallbackPrincipal()`。这是全局预处理和路由级授权的组合。

面试官问：

> 为什么 stale_invocation 返回 200 而不是 401？

回答：

> stale 表示请求到达且格式正确，只是业务上已经被更新的 invocation 替代。返回 401 或 5xx 会触发旧 CLI 继续 retry，可能产生重试风暴。服务端返回 200 + `stale_ignored`，MCP 客户端再把它转换成明确的“消息未送达”错误。

面试官问：

> outbox 是否保证消息一定送达？

回答：

> outbox 只能保证请求在客户端本地持久化，并在之后继续尝试发送。它不能保证 exactly-once，也不能单独证明服务器已执行。最终还需要服务端的幂等键、队列状态和业务结果确认。

---

# 十五、最终面试版总结

你可以直接这样说：

> Clowder 的 MCP 模块是模型和业务 API 之间的适配层。MCP 子进程通过 stdio 和宿主进程交换 JSON-RPC，向模型暴露带有 schema 和风险 annotations 的工具。模型调用工具后，handler 负责参数校验、线程防误投、凭证选择和 callback 请求组装。callback 客户端对写操作提供有界 retry 和 outbox，但整体只是 at-least-once，所以服务端还要用 `clientMessageId` 或 `clientRequestId` 做幂等。API 侧先验证 invocation token 或 agent key，生成 callback principal，再进行 thread scope 和资源所有权校验。以 post-message 为例，消息落库后根据是否有 A2A 目标选择队列或 WebSocket 广播，入队失败时广播兜底。Invocation 有 TTL 和 latest 机制，旧调用返回 `stale_ignored`；refresh loop 在后台续期 token。Proposal 工具只创建审批请求和确认卡，不直接执行最终变更，Approval Hub 负责聚合不同 feature 的审批状态。

最后压缩成一句话：

> **MCP 负责让模型“看见并调用工具”，callback 负责让工具“带着身份请求 API”，API 负责决定“这个请求能不能做、做在哪个资源上，以及业务是否真正生效”。**

<details><summary>1 previous message</summary>

> 我再补一层“面试白板版”：把一个 callback 请求拆成 API 侧的 8 道门，并把每一道门对应到源码函数。这样你可以从“整体架构”讲到“某一行为什么放在这里”，也能解释各种 400/401/403/429/503 和业务状态的区别。
</details>

下面按“面试白板”的顺序讲。你可以把 Clowder 的 MCP callback 模块理解成 **8 道门**：

```text
第 1 道：MCP 协议能不能收到调用
第 2 道：参数格式对不对
第 3 道：本地有没有明显的误用
第 4 道：请求带了什么身份
第 5 道：身份是否真实有效
第 6 道：这个身份能不能访问目标资源
第 7 道：请求是不是旧的、重复的
第 8 道：业务状态最终怎么落库、排队、广播或进入审批
```

前 3 道主要在 MCP 子进程，后 5 道主要在 API。

---

# 一、先把系统想象成一条流水线

假设用户说：

> “请让另一只猫检查这个 bug。”

模型决定调用：

```text
cat_cafe_post_message
```

整个过程是：

```text
用户
  -> LLM
  -> MCP Tool Call
  -> Node MCP 子进程
  -> callback HTTP 请求
  -> Clowder API
  -> 鉴权
  -> 线程权限检查
  -> 幂等检查
  -> 消息存储
  -> A2A 队列或 WebSocket 广播
  -> 另一只猫收到消息
```

对应的两个通信协议是：

```text
LLM <-> MCP 子进程：
  MCP JSON-RPC，走 stdin/stdout

MCP 子进程 <-> API：
  HTTP callback，走 JSON body + 身份 header
```

所以面试时第一句话就应该说清楚：

> MCP 不是 HTTP callback。MCP 负责模型和工具进程之间的协议，callback 负责工具进程和后端 API 之间的通信，API 才真正修改业务状态。

---

# 二、源码文件应该怎么分组理解

不要按文件名一个个死记，可以按职责分成几组。

| 模块 | 主要文件 | 作用 |
|---|---|---|
| MCP 入口 | `index.ts`、`collab.ts`、`memory.ts` 等 | 创建 MCP server，连接 stdio，启动 refresh |
| 工具注册 | [server-toolsets.ts](./clowder-ai/packages/mcp-server/src/server-toolsets.ts:516) | 汇总工具、过滤白名单、转换 schema、注册 annotations |
| 工具实现 | `packages/mcp-server/src/tools/*.ts` | 接收工具参数，组装 callback body，格式化结果 |
| HTTP 客户端 | [callback-tools.ts](./clowder-ai/packages/mcp-server/src/tools/callback-tools.ts:175) | 读取凭证、构造 header、发送 GET/POST |
| 可靠性 | `callback-retry.ts`、`callback-outbox.ts` | 超时、重试、本地落盘、后续重放 |
| 降级 | `degradation.ts` | 根据结构化认证错误决定是否允许 fallback |
| API 鉴权 | [callback-auth-prehandler.ts](./clowder-ai/packages/api/src/routes/callback-auth-prehandler.ts:80) | 解析 invocation 或 agent key，验证并生成 principal |
| API scope | [callback-scope-helpers.ts](./clowder-ai/packages/api/src/routes/callback-scope-helpers.ts:99) | 判断能访问哪个 thread、哪个 user 资源 |
| API 业务路由 | `callbacks.ts`、`callback-propose-*.ts` | 消息、任务、富文本、proposal 等真正业务逻辑 |
| 身份状态 | `InvocationRegistry`、`AgentKeyRegistry` | 保存 invocation、token、TTL、幂等键 |
| 审批聚合 | [approval-hub-routes.ts](./clowder-ai/packages/api/src/routes/approval-hub-routes.ts:25) | 聚合不同 feature 的 pending/settled proposal |
| 本地安全 | `path-validator.ts`、`shell-tools.ts` | 限制路径、命令、输出和执行时间 |

---

# 三、MCP 子进程启动时做了什么

以 [index.ts](./clowder-ai/packages/mcp-server/src/index.ts:32) 为例：

```text
1. initCatCafeDir()
2. createServer()
3. registerFullToolset()
4. new StdioServerTransport()
5. server.connect(transport)
6. startRefreshLoop()
7. 安装退出信号处理器
```

分体入口 [collab.ts](./clowder-ai/packages/mcp-server/src/collab.ts:27) 的流程一样，只是注册的工具更少。

## 为什么是子进程？

宿主进程负责启动 MCP Node 子进程，并通过 stdin/stdout 与它通信：

```text
宿主进程写 stdin
  -> MCP 子进程读取

MCP 子进程写 stdout
  -> 宿主进程读取
```

MCP 子进程把模型能调用的工具集中管理起来，同时把 API 凭证和业务 HTTP 细节隐藏在工具实现内部。

## 为什么日志必须写 stderr？

因为：

```text
stdout = MCP JSON-RPC 数据流
stderr = 普通日志流
```

如果写：

```text
console.log('server started')
```

这行文本可能被宿主进程误当成 MCP 数据，整个协议就会损坏。

因此源码使用：

```ts
console.error(...)
```

这是一个很好的面试加分点。

## 为什么有 `isEntryPoint`？

测试代码可能 import：

```ts
import { createServer } from './index.js';
```

如果 import 时就启动 stdio，测试会一直占用输入流。`isEntryPoint` 保证只有真正执行入口文件时才启动 `main()`。

---

# 四、MCP 工具注册阶段发生了什么

每个工具大致长这样：

```ts
{
  name: 'cat_cafe_post_message',
  description: '向线程发送消息',
  inputSchema: {
    content: z.string(),
    threadId: z.string().optional()
  },
  handler: handlePostMessage
}
```

注册层主要做四件事：

```text
1. 根据环境筛选工具
2. 把输入 schema 变成统一形式
3. 添加风险 annotations
4. 调用 MCP SDK 注册
```

## 为什么同一个项目同时有两种 schema？

大多数工具使用 Zod raw shape：

```ts
{
  content: z.string()
}
```

部分 limb 工具使用 plain JSON Schema：

```ts
{
  type: 'object',
  properties: {
    toolName: { type: 'string' }
  },
  required: ['toolName']
}
```

所以注册层要判断：

```text
有 type='object' 和 properties
  -> 当作 JSON Schema
  -> jsonSchemaToZod()

否则
  -> 当作 Zod raw shape
  -> z.object(schema)
```

## 为什么不用 `server.tool()`？

因为 `server.tool()` 有多个重载，它需要猜某个对象是：

```text
inputSchema
还是 annotations
```

plain JSON Schema 可能被误判成 annotations，最后导致：

```text
handler 参数位置错位
```

所以源码统一使用：

```ts
server.registerTool(name, {
  description,
  inputSchema,
  annotations,
}, handler);
```

面试可以这样回答：

> 项目同时支持 Zod raw shape 和 plain JSON Schema，而 SDK 的重载 API 存在歧义，所以使用显式 `registerTool()`，避免 schema、annotations 和 handler 的参数槽位错乱。

---

# 五、工具为什么不是全部都暴露

工具可见性有两层。

## 第一层：入口拆分

```text
collab.ts   -> 协作工具
memory.ts   -> 记忆工具
signals.ts  -> 信号工具
audio.ts    -> 音频工具
finance.ts  -> 财务工具
limb.ts     -> 设备/外部动作工具
```

目的：

```text
减少模型看到的工具数量
减少上下文占用
减少模型选错工具
```

## 第二层：环境白名单

`server-toolsets.ts` 根据环境变量过滤：

```text
CAT_CAFE_READONLY=true
CAT_CAFE_AGENT_KEY_SECRET=...
CAT_CAFE_DESKTOP_MODE=...
```

逻辑大致是：

```text
普通模式：
  暴露完整工具集

readonly=true：
  只暴露只读白名单
  如果有 agent key，再开放少量写工具

desktop mode：
  使用严格 phase0 白名单
  不和 readonly / agent-key 做并集
```

因此：

```text
入口拆分解决“模型看见太多工具”
白名单解决“当前环境拥有太多能力”
```

---

# 六、MCP 调用的实际数据长什么样

## 模型到 MCP 子进程

逻辑上类似：

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "cat_cafe_post_message",
    "arguments": {
      "content": "@opus46 请检查这个 bug"
    }
  }
}
```

MCP 子进程最后返回：

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"status\":\"ok\",\"messageId\":\"msg-123\"}"
      }
    ]
  }
}
```

## MCP 子进程到 API

```http
POST /api/callbacks/post-message
Content-Type: application/json
x-invocation-id: inv-abc
x-callback-token: token-xyz
```

body：

```json
{
  "content": "@opus46 请检查这个 bug",
  "clientMessageId": "client-msg-uuid"
}
```

当前版本的客户端把认证信息放在 header，不再放在 body。服务端仍保留 body/query 读取逻辑，兼容旧版 MCP 客户端。

---

# 七、完整讲解一次 `post_message`

这是面试最值得准备的实例。

## 第 1 道门：模型是否选择了正确工具

模型根据工具的：

```text
name
description
inputSchema
annotations
```

决定是否调用 `cat_cafe_post_message`。

工具描述其实很重要，它不仅是给人看的，也是给模型看的，相当于这个工具的 prompt。

---

## 第 2 道门：参数格式是否正确

MCP SDK 根据 schema 做运行时校验：

```text
content 是否为字符串
threadId 是否为字符串
targetCats 是否为数组
枚举值是否正确
长度是否超限
```

这里解决的是：

```text
参数格式问题
```

不解决：

```text
身份问题
权限问题
线程归属问题
```

---

## 第 3 道门：本地防误投检查

`handlePostMessage()` 有一个重要规则：

```text
如果当前使用 invocation 凭证，
普通 post_message 不允许手动传 threadId。
```

正确用法：

```text
同线程发送：
  省略 threadId

跨线程发送：
  使用 cat_cafe_cross_post_message
```

原因是 invocation 已经绑定 thread。如果模型随便传 threadId，可能发生：

```text
旧 invocation 属于 thread-A
模型传入 thread-B
消息错误地落到 thread-B
```

这就是线程误投。

注意：

```text
agentKeyCatId 只是选择 key 文件
不是认证主体
```

真正的认证主体取决于最终发出的 header。

---

## 第 4 道门：客户端选择凭证

`getCallbackConfig()` 读取：

```text
CAT_CAFE_API_URL
CAT_CAFE_INVOCATION_ID
CAT_CAFE_CALLBACK_TOKEN
CAT_CAFE_AGENT_KEY_SECRET
```

认证优先级：

```text
完整 invocation
  > agent key
```

完整 invocation 是：

```text
invocationId + callbackToken
```

只有一个字段时，不能单独组成 invocation 身份。

但如果：

```text
半套 invocation
+
完整 agent key
```

客户端仍然可以退回 agent key。只有半套 invocation 且没有 agent key 时，配置才不可用。

---

## 第 5 道门：构造 HTTP header

如果使用 invocation：

```http
x-invocation-id: ...
x-callback-token: ...
```

如果使用 agent key：

```http
x-agent-key-secret: ...
```

完整 invocation 和 agent key 同时存在时，最终只发 invocation header。

服务端也遵守同样的优先级：如果请求明确带了 invocation 凭证但 token 错误，不能偷偷改用 agent key，否则会产生认证绕过。

---

## 第 6 道门：retry 和 timeout

`callbackPost()` 默认最多经历：

```text
第一次请求
等待 1 秒
第二次请求
等待 2 秒
第三次请求
等待 4 秒
第四次请求
```

每次请求都有独立 10 秒 timeout。

重试条件：

```text
网络异常
408
429
5xx
```

不重试：

```text
400
401
403
404
```

因为：

```text
网络暂时失败，重试可能恢复
参数错误，重试没有意义
身份错误，重试没有意义
权限错误，重试没有意义
```

---

## 第 7 道门：必要时写入 outbox

对于 `post_message` 这种写操作，源码启用：

```ts
enableOutbox: true
```

如果 retry 之后仍然是可重试失败，请求会保存到：

```text
~/.cat-cafe/callback-outbox/
```

保存内容包括：

```text
apiUrl
path
body
headers
queuedAt
attempts
lastError
```

后续发送新的 callback 前，先 flush 旧 outbox。

重放时：

```text
原文件
  -> xxx.json.processing
  -> 成功则删除
  -> 仍可重试则更新 attempts 后恢复原文件
  -> 不可重试或超过上限则删除
```

`.processing` rename 是原子 claim，用于避免多个进程同时重放一个请求。

返回：

```json
{
  "status": "queued_for_retry",
  "queuedAt": 1234567890
}
```

准确含义是：

```text
请求已经持久化到本地，等待未来重试
```

不是：

```text
服务端业务已经成功执行
```

---

## 第 8 道门：API preHandler 解析认证

服务端在 [callback-auth-prehandler.ts](./clowder-ai/packages/api/src/routes/callback-auth-prehandler.ts:80) 中处理：

```text
1. request.callbackAuth 已存在 -> 跳过
2. 先读 x-invocation-id 和 x-callback-token
3. 只有两个 header 都不存在时，才读 legacy body/query
4. 没有 invocation 时检查 x-agent-key-secret
5. 完全无凭证 -> preHandler no-op
6. 只有半套 invocation -> 401 missing_creds
7. 完整 invocation -> registry.verify()
```

这里有一个容易被误解的点：

```text
preHandler 无凭证 no-op
```

不等于：

```text
业务路由允许匿名访问
```

因为同一个 Fastify 实例里还可能有 panel/browser 路由，所以全局 hook 不能把所有请求都直接判成 callback。

真正要求身份的路由必须显式调用：

```ts
requireCallbackAuth()
```

或者：

```ts
requireCallbackPrincipal()
```

这是通过路由纪律保证安全，而不是靠 TypeScript 自动保证。

---

## 第 9 道门：生成 principal

认证成功之后，服务端生成：

```ts
CallbackPrincipal
```

Invocation：

```ts
{
  kind: 'invocation',
  invocationId,
  threadId,
  userId,
  catId
}
```

Agent key：

```ts
{
  kind: 'agent_key',
  agentKeyId,
  userId,
  catId,
  scope: 'user-bound'
}
```

这个对象用于后续业务判断。

面试时可以明确说：

```text
认证 Authentication：
  你是谁？

授权 Authorization：
  你能操作什么资源？
```

---

## 第 10 道门：检查 thread scope

在 [callback-scope-helpers.ts](./clowder-ai/packages/api/src/routes/callback-scope-helpers.ts:99) 中：

### Invocation

```text
不传 threadId：
  使用 invocation 自带 threadId

传相同 threadId：
  允许

传其他 threadId：
  查询 ThreadStore
  检查当前 user 是否有访问权
```

### Agent key

```text
不传 threadId：
  400

传 threadId：
  查询目标 thread
  检查是否属于当前 user 或 user 可见
```

所以 agent key 没有默认 thread，是因为它是长期身份，不属于某一次具体会话。

---

## 第 11 道门：检查 invocation 是否是最新的

InvocationRegistry 维护同一个：

```text
(threadId, catId)
```

位置上的最新 invocation。

如果：

```text
旧 invocation-A 还在运行
新 invocation-B 接管了同一线程和猫
A 又发来 callback
```

API 返回：

```json
{
  "status": "stale_ignored"
}
```

这不是网络错误，而是业务状态：

```text
请求到了
但这个 invocation 已经失去执行资格
```

为什么返回 HTTP 200？

因为如果返回 401 或 500，旧 CLI 可能持续重试，形成 retry storm。200 + `stale_ignored` 可以让传输层停止重试。

MCP 客户端随后把它重新转换成错误，明确告诉模型：

```text
消息没有送达，因为当前 invocation 已被新的 invocation 替代。
```

---

## 第 12 道门：检查 `clientMessageId`

客户端自动生成：

```ts
clientMessageId = randomUUID()
```

API 侧做原子 claim：

```text
Invocation:
  registry.claimClientMessageId()

Agent key:
  agentKeyRegistry.claimClientMessageId()
```

如果已处理过：

```json
{
  "status": "duplicate",
  "clientMessageId": "..."
}
```

这解决的是：

```text
服务器已经写成功
客户端没收到响应
客户端重试
```

没有幂等键时，就可能变成重复消息。

---

## 第 13 道门：检查 mention 和富文本

API 会：

```text
解析 rich blocks
提取 @mention
解析 targetCats
检查目标猫是否存在
检查目标猫是否启用
检查目标猫是不是线程参与者
```

失败时可能得到：

```text
cat_not_found
cat_disabled
target_not_in_thread
```

这些错误会同时提供：

```text
人类可读提示
+
原始 JSON
```

这样模型能理解，程序也能继续读取结构化字段。

---

## 第 14 道门：消息落库和投递

消息先写入 MessageStore，得到：

```text
messageId
```

然后根据是否有有效 A2A 目标选择投递路径：

```text
有可入队目标：
  deliveryStatus='queued'
  交给 QueueProcessor
  不立即 broadcast

没有有效入队目标：
  直接 WebSocket broadcast

入队失败：
  fallback 到 broadcast
```

为什么不能同时队列和广播？

因为可能产生：

```text
队列投递一次
广播又投递一次
```

最终同一条消息被处理两次。

所以准确说法是：

> 先持久化消息，再根据投递条件选择队列或广播；如果队列失败，使用广播兜底，尽量避免消息消失。

---

# 十五、Invocation 和 Agent Key 的区别

| 对比项 | Invocation | Agent key |
|---|---|---|
| 作用 | 一次具体调用会话 | 长期注册身份 |
| 默认 TTL | 2 小时 | 45 天 |
| 是否绑定 thread | 是 | 否 |
| 是否有默认 thread | 有 | 没有 |
| 是否检查 latest | 是 | 不按 invocation latest 判断 |
| 是否适合 proposal | 是 | 通常不允许 |
| 典型用途 | 普通猫会话 | 常驻 agent、共享 MCP、云端连接器 |

Invocation 可以理解为：

```text
短期 session token
```

Agent key 可以理解为：

```text
长期 API key
```

Agent key 生成时不会保存明文 secret，而是保存：

```text
SHA-256(secret + salt)
```

轮换时：

```text
旧 key 进入 grace period
生成新 key
旧 key 默认保留 24 小时宽限
```

---

# 十六、为什么不是 exactly-once

callback 可能因为以下原因重复：

```text
HTTP retry
outbox replay
请求成功但响应丢失
客户端在收到响应前崩溃
```

客户端无法知道：

```text
“我没收到响应”
到底是服务端没执行
还是服务端已执行但响应没回来
```

因此系统只能采用：

```text
at-least-once delivery
+
业务幂等去重
```

面试回答：

> 网络层无法可靠判断远端是否已经执行，所以只能保证至少投递一次；服务端通过 `clientMessageId`、`clientRequestId` 和原子 claim，消除重复副作用。

---

# 十七、为什么 GET 和 POST 不一样

`callbackPost()`：

```text
有 timeout
有 retry
部分写操作有 outbox
```

`callbackGet()`：

```text
只发一次 fetch
没有 retry
没有 outbox
没有同样的 AbortSignal timeout
```

原因是：

```text
GET 失败：
  稍后重新查询即可

POST 失败：
  可能导致消息、任务或审批请求丢失
  需要尽力保证最终投递
```

这是有意的可靠性分层，不是实现遗漏。

---

# 十八、Token 过期和 refresh loop

Invocation 默认有效 2 小时。

如果猫长时间没有调用任何工具，token 也可能过期。因此 MCP 子进程会在后台运行 refresh loop：

```text
定时调用 /api/callbacks/refresh-token
  -> API 验证 invocation
  -> 滑动 TTL
  -> 返回剩余时间
  -> 客户端计算下一次刷新时间
```

refresh 不设计成 MCP 工具，因为：

```text
刷新 token 是基础设施动作
不是模型需要思考的业务动作
```

服务端 cooldown 是 5 分钟，但客户端最小间隔约 6.18 分钟：

```text
5 分钟 × 1.05 / 0.85 ≈ 6.18 分钟
```

原因是客户端有 `0.85 ~ 1.15` 的 jitter。如果最小间隔直接是 5 分钟，最短可能只有 4.25 分钟，必然撞上服务端限流。

refresh 路由在 [callbacks.ts](./clowder-ai/packages/api/src/routes/callbacks.ts:3265) 的 `preValidation` 中完成：

```text
1. 提取凭证
2. peek，不滑 TTL
3. claim cooldown
4. verifyLatest
5. 原子完成 token 验证、latest 检查和 TTL 滑动
6. 写入 request.callbackAuth
7. handler 重新读取 expiresAt
```

为什么不是普通 `preHandler`？

因为如果先由 preHandler 滑动 TTL，之后才发现 cooldown：

```text
请求最终返回 429
但 token 已经被续期
```

这样限流就只是表面上的。

---

# 十九、Proposal 和 Approval Hub

Proposal 工具包括：

```text
cat_cafe_propose_thread
cat_cafe_propose_session_handoff
cat_cafe_propose_profile_update
```

它们不是直接执行操作，而是：

```text
猫提出申请
  -> API 创建 proposal
  -> 生成用户可见确认卡
  -> 等待用户 approve/reject
```

`propose-thread` 的主要流程：

```text
1. requireCallbackAuth
2. Zod 校验
3. 检查 invocation 是否最新
4. clientRequestId 快速查重
5. 原子 reserve dedup
6. 创建 proposal
7. 追加 rich confirmation card
8. 保存 cardMessageId
9. 广播 proposal_created
```

因此：

```text
proposal 创建成功
!=
目标状态已经变化
```

例如：

```text
proposal-thread 成功
```

只表示：

```text
新建线程的申请已经进入审批流程
```

不表示：

```text
线程已经创建
```

## 为什么要检查确认卡是否可见？

可能发生部分成功：

```text
proposal 写入成功
确认卡也写入成功
但 cardMessageId 保存失败
```

如果只看 proposal record，就可能返回“已去重成功”，但用户根本看不到审批卡。

所以服务端会：

```text
扫描 source thread
查找对应 rich block
尝试回填 cardMessageId
仍然找不到 -> 503 retryable
```

这属于部分提交之后的自愈逻辑。

## Approval Hub 做什么？

Approval Hub 只负责：

```text
读取多个 adapter
合并 proposal
排序
返回统一审批视图
```

接口：

```text
GET /api/approval-hub/pending
GET /api/approval-hub/settled
```

它不负责：

```text
执行 approve
执行 reject
修改业务状态
```

---

# 二十、本地 shell 工具为什么不是任意 shell

`cat_cafe_shell_exec` 只允许少数只读命令：

```text
pwd
ls
cat
git log
git status
git rev-parse
git diff
git show
```

拒绝：

```text
rm -rf
mv / cp / mkdir
git checkout / commit
npm install
管道 |
重定向 >
命令替换 $
反引号
通配符
fork bomb
Redis 6399
```

还会：

```text
检查 cwd 是否在允许目录
检查每个文件路径
跟随 realpath 防止符号链接逃逸
限制输出 256KB
限制执行时间 30 秒
```

这体现了一个原则：

> 工具是否只读，必须在实现层真正保证，不能只依靠工具名称或 `readOnlyHint`。

---

# 二十一、错误状态怎么理解

| 返回 | 含义 |
|---|---|
| `400` | 参数错误、跨线程规则错误、路径不合法 |
| `401` | 缺凭证、token 错误、token 过期、invocation 不存在 |
| `403` | 身份有效，但无权访问目标 thread 或资源 |
| `404` | 目标 thread 或资源不存在 |
| `429` | refresh cooldown 或业务限流 |
| `503` | 暂时不可用、proposal 卡片仍在处理中、thread store 不可用 |
| `200 + duplicate` | 请求以前已经处理过 |
| `200 + stale_ignored` | 旧 invocation 的请求被业务忽略 |
| `200 + queued_for_retry` | 请求已经保存到本地 outbox |
| `200 + held` | 当前猫有未读消息，新消息暂时不发送 |

面试时不要只看 HTTP 状态码，要同时看：

```text
status
reason
message
```

因为：

```text
HTTP 200 也可能代表业务没有真正执行
HTTP 401 也可能需要根据 reason 分流
```

---

# 二十二、面试官最可能连续追问的 12 个问题

## 1. MCP 和 REST API 有什么区别？

> MCP 是面向模型的工具协议，描述工具名、输入 schema 和调用结果；REST 是程序之间的 HTTP 接口。Clowder 中模型先调用 MCP tool，tool handler 再调用 REST callback。

## 2. 为什么不让模型直接调用 API？

> 因为 MCP 层可以统一做 schema 校验、工具白名单、线程防误投、错误格式化和本地能力控制，同时隐藏 API URL 和认证细节。API 仍然是最终安全边界。

## 3. schema 能不能代替权限校验？

> 不能。schema 只能证明参数格式正确，不能证明调用者身份，也不能判断调用者是否有权访问目标 thread。权限必须在 API 侧检查。

## 4. Invocation 和 Agent Key 为什么都需要？

> Invocation 是短期、绑定具体 thread 的会话身份；agent key 是长期、不绑定 thread 的猫身份。前者适合普通会话，后者适合常驻 agent 和共享 MCP。

## 5. 为什么 agent key 调用必须传 threadId？

> 因为 agent key 没有会话上下文，不知道默认 thread。API 必须要求调用方明确指定 threadId，然后检查该 user 是否有权限。

## 6. 为什么 `preHandler` 无凭证时不直接 401？

> 因为同一个 Fastify 实例还服务 panel/browser 等非 callback 路由。全局 hook 对无凭证请求 no-op，但真正的 callback 路由必须显式调用 `requireCallbackAuth()` 或 `requireCallbackPrincipal()`。

## 7. 为什么 invocation 验证失败后不能 fallback 到 agent key？

> 因为请求已经明确选择了 invocation 身份。如果验证失败再偷偷切换 agent key，攻击者可能借助另一套身份绕过原本的认证失败。

## 8. 如何避免重复消息？

> callback 使用 `clientMessageId`，proposal 使用 `clientRequestId`。服务端通过 registry 或 backend 原子 claim，即使 retry 或 outbox replay，也只处理第一次。

## 9. outbox 能保证 exactly-once 吗？

> 不能。outbox 只能提供 at-least-once。服务端可能已经成功但客户端没收到响应，所以还需要业务幂等键消除重复副作用。

## 10. 为什么 `stale_ignored` 是 200？

> 旧 invocation 已经失去执行资格，但请求本身格式正常。返回 200 可以避免旧 CLI 因 401/5xx 继续重试；客户端再把这个业务状态转换成“消息未送达”。

## 11. 为什么消息有时走队列，有时直接广播？

> 如果有 A2A 目标且队列可用，先标记 queued，交给 QueueProcessor，避免队列和广播双投；没有有效队列目标或入队失败时，使用广播兜底，避免消息消失。

## 12. Proposal 成功是不是代表动作已经完成？

> 不是。Proposal 成功只代表审批项和确认卡已经创建并对用户可见。最终线程创建、session handoff 或 profile 修改要等用户批准之后才执行。

---

# 二十三、最后的面试总结版

你可以把下面这段直接背下来：

> Clowder 的 MCP 模块是模型和后端 API 之间的适配层。MCP 子进程通过 stdio 和宿主进程交换 JSON-RPC，向模型暴露带有输入 schema 和风险 annotations 的工具。模型调用工具后，handler 先做参数校验和必要的本地安全检查，再根据环境选择 invocation 或 agent-key 身份，通过 callback HTTP 请求 API。API 侧先验证凭证并生成 principal，再检查 thread scope、用户资源权限、invocation 是否最新以及请求是否重复。对于写操作，客户端提供有界 retry 和 outbox，但整体是 at-least-once，所以服务端还要依靠 clientMessageId 或 clientRequestId 做幂等。消息落库后，根据 A2A 队列是否可用选择 queued 或 WebSocket 广播，入队失败时广播兜底。Invocation 有 TTL、refresh 和 stale 机制；Proposal 只创建审批项和确认卡，不直接执行最终变更；Approval Hub 负责聚合审批状态。

最短的一句话是：

> **MCP 负责让模型会调用工具，callback 负责让工具带着身份请求 API，API 负责决定这次请求能不能做、能操作什么资源，以及业务是否真正生效。**
