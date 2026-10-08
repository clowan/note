# 模块四：MCP 工具桥接与调用安全

> 完整学习稿 v2｜2026-10-04｜作者：wo / gpt-6-astra｜状态：已按 M4-P2-01/02 修订，待 gpt-61-sol1 独立复核；未自称关闭 finding 或通过。
>
> 源码：`D:\AI\clowder-ai`；固定 HEAD：`b1fe2966fa0a97d1e3cd2e174ed59fd1477b4fc4`。本章是当前仓库实现的讲解，不是对所有 MCP 产品、SDK 版本或部署的通用安全保证。文末 C1—C13 是源码与证据索引。
>
> 模块一至三已有独立内容放行；这不代表读者已经掌握。本章不修改产品实现、运行配置、真实凭据或运行数据库，不涉及另一个学习产品。

## 0. 简历原文与必须说明的版本差异

第四段原文，仅合并排版换行：

> MCP 工具桥接与调用安全：基于 MCP SDK / registerTool 按业务域注册工具，适配 Zod / JSON Schema 参数校验，以 stdio JSON-RPC 承接 CLI 工具调用，再经 HTTP Callback Bridge 访问 Fastify API，覆盖消息发送、跨线程协作、任务管理及会话交接提案；通过 Invocation Token / Agent Key 双路径认证、Agent/Thread 作用域、结合 Invocation Token 主动刷新与 TTL 续期支持长会话，并为交接提案保留人工审批入口。

历史原文来自已提供的消息 `0001790992157284-000008-753cd1ce`。本次沿用原分工：先从后端基础讲清业务，再深入源码与追问，不虚构个人提交或上线收益。

### 当前基线不能照背“TTL 续期”

源码已经将 Invocation 认证改为 active / terminal 生命周期：**active 认证记录的 expiresAt 为 null；终态记录才有用于清理认证墓碑的截止时间。** 刷新路由仍存在，但当前成功响应是 `expiresAt:null, ttlRemainingMs:null`，不能据旧注释声称每次刷新都延长数值 TTL。[C6][C8]

客户端刷新循环还保留数值 TTL 的自适应分支；遇到上述 null 响应时会进入可恢复回退调度。这是本章必须披露的兼容性差异，不包装成完全一致的滑动续期协议。

如果用当前实现介绍项目，可以改用这样的机制表述：

> 按 Invocation 生命周期和 Agent Key 分别识别调用主体，结合工具执行策略、线程作用域及业务门禁约束调用；通过当前凭据重读、主动刷新与兼容处理支持长会话，终态凭据不因刷新重新获得权限。

这是基于当前基线的表达建议，不是擅自覆盖原简历，也不表示本轮修复了刷新兼容问题。

---

## 1. 先认识五个参与者

### 1.1 模型：提出“我要调用哪个工具”

模型可以根据任务产生工具名称与参数，但这些参数是待检查的请求。模型写了某个 threadId 或 catId，不代表它因此拥有那个身份。

### 1.2 CLI / Agent 载体：运行模型并承接工具协议

本章关注已挂载家内 MCP server 的载体。载体把工具调用交给 MCP server，并将结果反馈到模型上下文。它不等同业务 API 的全部实现。

### 1.3 MCP server：工具协议适配层

它向客户端描述工具、接收参数、运行 handler。以协作工具面为例，入口创建 McpServer、注册 Collab toolset、连接 StdioServerTransport。[C1]

### 1.4 HTTP Callback Bridge：从工具 handler 到业务 API

handler 不必重新实现消息、任务、审批等业务逻辑，而是通过 callbackPost / callbackGet 向 API 提交结构化请求。这个“Bridge”在这里主要是函数与 HTTP 调用路径，不必理解成另外一台独立服务器。[C3]

### 1.5 Fastify API：认证、作用域与业务真相

API 识别可信主体，检查请求形状、当前状态、线程归属和业务条件，再由对应存储/owner 执行动作。[C4][C5][C10]

先记住一句话：**MCP 负责把工具调用接进来，API 负责决定这次调用能否做、代表谁做、最终做成什么。** 这只是职责分工，不意味着 MCP 层没有提前拒绝，也不意味着每个 API 都使用完全相同的门禁。

---

## 2. 一次“向当前线程提交中途进展”的完整旅程

继续前几章的 A/B 场景：A 正在执行一项已授权任务，需要向当前线程提交一条中途进展。这是教学场景，不是本次真的向业务线程发测试消息。

假设 A 有一组有效 Invocation 凭据，且不是只读重放执行。

### 2.1 模型提交业务参数，不提交认证身份

教学调用：

```json
{
  "content": "已核对会话恢复入口，正在检查异常分支。",
  "clientMessageId": "demo-progress-001"
}
```

对 invocation-token 调用者，`cat_cafe_post_message` 的公开 schema 不提供 threadId；handler 也会拒绝显式传入 threadId 的这种调用。当前线程从可信 invocation 主体取得；跨线程有专门入口，不靠给这个工具多塞一个字段绕过去。[C2][C3]

### 2.2 一张端到端业务图

```text
A 产生工具名与业务参数
    ↓
CLI / MCP client 发 tools/call
    ↓ stdio JSON-RPC（本仓相应入口）
MCP SDK 查已注册工具并检查输入 schema
    ↓
工具 handler 做该工具的提前检查
    ↓
重读当前认证配置，构造认证 HTTP headers
    ↓ HTTP callback
Fastify 认证 hook / route guard
    ↓
可信 principal：谁、哪次执行、哪个用户、适用线程
    ↓
业务 schema + 执行策略 + 线程/对象/状态门禁
    ↓
消息持久化与适用的路由/发布流程
    ↓
HTTP 响应 → ToolResult → CLI → 模型
```

[C1]—[C5][C10]

不要把图误读成“每个工具都会写消息”，或者“过了认证一定会到存储”。只读工具、长期 Agent Key、审批工具及特定 owner 动作有不同分支。

### 2.3 三种 ID 各管什么

| ID | 回答的问题 |
|---|---|
| JSON-RPC 请求 id | 这条协议响应对应哪次协议请求？ |
| invocationId | 这次业务调用属于哪个受管执行主体？ |
| clientMessageId / clientRequestId | 重试或重复投递是否属于同一个业务请求？ |

不能拿 JSON-RPC id 替代业务幂等键，也不能把“字符串看着像 invocationId”当作认证成功。

---

## 3. stdio JSON-RPC 与 HTTP，是两段不同的通信

### 3.1 stdio 是进程间协议通道

本仓 Collab MCP 入口调用 `server.connect(new StdioServerTransport())`。本地已安装 MCP SDK 版本为 1.26.0；本章基于该版本代码核验，不声称它是外部最新版本。[C1]

SDK 的 stdio 编解码器按换行提取 JSON-RPC 消息，序列化时在 JSON 后加换行。进程收到一段字节，不一定恰好就是一条完整消息，因此需要缓冲与拆包。

教学形状如下，并非真实请求抓包：

```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "method": "tools/call",
  "params": {
    "name": "cat_cafe_post_message",
    "arguments": {"content": "教学消息"}
  }
}
```

该对象描述“调用哪一个已注册工具”。它不是 API 的认证记录，也不是一条普通聊天消息。

### 3.2 为什么入口日志写 stderr

stdout 承担协议输出时，混入普通文本会影响按行 JSON 解析。当前协作入口使用 `console.error` 输出启动与故障日志，避免把这些普通日志写到协议 stdout。[C1]

这不等于本轮证明了所有依赖、所有异常路径永远不污染 stdout；本轮没有启动真实 stdio 子进程做全链测试。

### 3.3 HTTP callback 是下一段

MCP handler 使用配置的 apiUrl 调用相应 `/api/callbacks/...` 路径。它携带的是 HTTP 认证头和业务 JSON，返回 HTTP 状态及 JSON 结果。[C3]

区分两段协议有助于排障：

- 工具未注册、schema 不合法：可能在进入 HTTP 之前就失败。
- callback 401：进入了认证问题的范围。
- callback 403：可能是执行策略或作用域拒绝，应看具体错误。
- callback 503：可能是业务依赖不可用，不能直接解释为 MCP 协议错误。

stdio 不自动证明远端 HTTP 加密，HTTP 也不自动证明请求有业务权限。连接方式、部署边界和授权是不同问题；本章不修改 API 地址或网络配置。

---

## 4. registerTool：为什么不直接堆一个巨大的工具表

### 4.1 工具定义与业务域投影

当前实现从 canonical registry 投影 Collab、Memory、Signals 等工具面，并根据运行 profile、readonly 等条件选择可见工具。兼容导出的 allowlist 也是派生结果，而不是再维护一套平行真相源。[C1][C2]

好处是定义、能力边界与不同 server 面可以保持关联；代价是不能只看某个入口文件就判断最终暴露了哪些工具，还需要看实际 profile 与注册投影。

### 4.2 当前使用显式配置对象 API

注册器调用的形状是：

```text
server.registerTool(name, {
  description,
  inputSchema,
  annotations,
  可选元数据
}, handler)
```

当前代码特意使用显式 config-object 入口，避免旧重载路径把普通 JSON Schema 误认为 annotations，导致 handler 参数位置与预期不符。[C2]

`description` 帮助模型理解何时调用；`inputSchema` 定义参数形状；handler 处理执行。这三者都重要，但用途不同。

### 4.3 readOnlyHint 不是服务器端授权

工具 annotations 中的 readOnlyHint / destructiveHint 等是声明信息，不能独立替代 API 的真实执行策略。

当前还有两个不要混淆的概念：[C2][C4]

1. **MCP readonly 工具面**：按 profile 缩小可见工具集合；继承了 Agent Key 环境变量不应自动扩大工具面。
2. **API 的某种 read_only 执行策略**：当前对应代码会拒绝 callback 工具执行，而不只是拒绝被标为“写”的工具；replayDeniedToolNames 用于保留更强的拒绝原因。

两处名字类似，不代表语义完全一样。客户端看不到某工具是一层限制；服务器拒绝越权执行是另一层限制。

---

## 5. 参数校验：Zod 和 JSON Schema 各在哪一层

### 5.1 先讲人话

参数校验回答：

- content 是不是字符串？
- 必填字段有没有？
- 数字、数组、枚举是否满足对应约束？
- 这个 principal 的公开接口是否允许 threadId？

它不回答“这个用户是否拥有目标线程”，因为那需要结合可信身份和业务数据。

### 5.2 当前注册器有两种 schema 来源

Callback 工具主要使用 Zod raw shape；部分工具使用普通 JSON Schema。注册时，前者包成 Zod object，后者经 `jsonSchemaToZod()` 转换，以适配 SDK 的输入处理。[C2]

特定的 post_message invocation 契约和 agent-key 投影使用 strict object，拒绝不支持的字段，避免默认字段清理先把越界证据擦掉。

不能因此声称所有工具 schema 都 strict；不同定义和投影要分别核对。

### 5.3 转换器不是完整 JSON Schema 实现

当前转换器支持其实现的基础类型、字符串枚举、数组及顶层 required 等子集。它把 `integer` 转为 `z.number()`，没有在该分支追加 `.int()`；也没有实现完整的 minimum / maximum / pattern 等关键字。[C2]

本轮实际用如下教学 schema 检查：

```json
{
  "type": "object",
  "properties": {"count": {"type": "integer", "minimum": 10}},
  "required": ["count"]
}
```

经过该转换器后，`count:1.5` 仍可通过。这个检查用于防止讲义许诺“所有 JSON Schema 约束都被完整转换”；不代表所有实际工具都通过同一子集转换，也不是本轮已经修改了转换器。[C13]

### 5.4 API 仍要做业务输入校验

例如 post-message 与交接提案路由都对 request.body 做 schema 检查。原因是 API 不能把所有调用者都假定为忠实执行 SDK 校验的客户端。[C10][C11]

因此输入合法至少分两层：

```text
结构合法：参数是接口承认的形状
业务合法：在该身份、对象和当前状态下，这个动作允许发生
```

把第一层通过当成第二层通过，是面试中最需要避免的过度保证。

---

## 6. 从 handler 到 HTTP：凭据为什么不让模型手填

### 6.1 handler 只显式转发需要的业务字段

post_message handler 构造请求体，包含 content、clientMessageId 和适用的业务元数据；不会让模型通过 userId 或 catId 自封身份。不同动作另有 schema 与业务条件。[C3][C10]

当前第一方 callbackPost / callbackGet 将自动认证信息放入 headers，不再自动双写到 body/query。

### 6.2 先选本地凭据，再构造 HTTP 认证头

这里必须分清两个阶段：**客户端从本地候选配置中选用哪类凭据**，以及**API 校验最终收到的 HTTP 请求**。本地候选是否完整，不等于它已经被原样发送到了 API。

下表讨论已配置 apiUrl、未显式设置 `forceAgentKey:true` 的默认客户端路径。先由 `resolveInvocationCredentials()` 取得文件优先、环境回退后的候选对，再由 `getCallbackConfig()` 判断是否完整；“可用 Agent Key”在本表仅指 resolver 可解析到的候选，最终有效性仍须服务端校验。[C3]

| 本地候选配置 | 客户端最终选择 / headers | 不可外推的保证 |
|---|---|---|
| 完整 Invocation id/token 对；无论是否另有 Agent Key | 保留完整对，`buildAuthHeaders` 优先发送 x-invocation-id + x-callback-token | 形状完整不证明 token 有效或执行仍 active |
| Invocation 只有 id 或只有 token，同时有可用 Agent Key | 舍弃不完整的 Invocation 字段，只发送 x-agent-key-secret | 得到的最多是对应 agent_key 主体，不会补出 Invocation/thread 权限 |
| 没有 Invocation 候选，但有可用 Agent Key | 发送 x-agent-key-secret | 仍须通过该 key 的校验及工具/线程/业务约束 |
| 不完整 Invocation 且无可用 Agent Key，或两类凭据都没有 | 无可用 callback config，工具报告配置缺失，不发送这一业务 HTTP 请求 | 不能假装已有认证主体 |

所以，“客户端半组配置 + 可用 key”**可以选择 Agent Key**；但如果 API **实际收到了半组 Invocation headers**，第 7 节的 hook 会返回 missing_creds，不会用同请求里的 Agent Key 补救。前者丢弃了半组字段，后者真的把半组字段发出去了；它们不是同一个 HTTP 请求。[C3][C4]

| 本轮隔离对照 | 实际发送 / 结果 |
|---|---|
| 只有 Invocation ID、没有 token；客户端另有有效 fixture key，经过真实 callbackPost helper | 只发送 Agent Key 认证头，合成 API probe 识别为 agent_key，没有 invocation thread |
| 直接向同一 API probe 发半组 Invocation header + 同一有效 fixture key | 401 / missing_creds |

这不是 API 用 key 代替了坏 Invocation，也不是提权成功。只接受 Invocation 的路由、线程作用域和业务门禁仍然适用。注册期的工具契约也先看完整 Invocation 对，否则按可用 Agent Key 等条件投影；它与请求发送后 API 的验证不是同一层。[C2]—[C5][C13]

显式 `forceAgentKey:true` 是另一个有意选择 key 的调用选项，不属于上表默认优先级；本轮不是通过改实现或改真实凭据来凑出这些结果。这里没有展示真实 token 或 secret。

### 6.3 长寿命 MCP 进程为什么要重读凭据

进程启动时的环境变量是那一刻的值。载体恢复后，如果 MCP 子进程持续存在，启动时的 invocation 凭据可能已经不是当前执行的凭据。

当前 `resolveInvocationCredentials()` 优先读取指定凭据文件中的完整 id/token 对，读取不到可用完整对象时回退到启动环境。[C3]

这说明：

- 当前凭据的来源需要由宿主维护；
- 文件优先并不是模型重新发明一个 token；
- 文件缺失后的环境回退也可能已经陈旧；取得候选后，还要经过 §6.2 的完整性/凭据路径选择，最终发送的凭据仍由服务端校验；
- 本轮没有读写真实凭据文件，只验证隔离的 fixture 文件。

### 6.4 Agent Key 选择器不是任意冒名参数

共享工具进程可用 agentKeyCatId 选择既有身份对应的凭据，但 resolver 会考虑 boundCatId、variant-map 等限制。请求身份与绑定身份冲突时不返回 key；已经进入指定身份/映射模式时，也不能任意退回另一只猫的通用 secret。[C3]

安全表达应是“选择已授予且符合绑定规则的凭据”，不是“传一个 catId 就能代表该猫”。

---

## 7. Fastify 认证：先确认是谁，再决定能做什么

### 7.1 认证 hook 的实际优先级

本节限定为 **API 已经收到 HTTP 请求之后**的认证 hook，不是在描述本地环境变量如何选用凭据。核心顺序：[C4]

1. 优先读取完整的 Invocation headers。
2. 仅当两个 Invocation header 都缺失时，尝试兼容 body/query 中的旧凭据。
3. 仍完全没有 Invocation 凭据时，才考虑 Agent Key 路径。
4. API 实际收到的 Invocation 凭据只有一半时，返回 missing_creds；不能拿同请求中的 Agent Key 补救。
5. 完整但错误的 Invocation 凭据，直接验证失败；不会自动降级成另一个身份。

本轮直接向 API 发送“部分 Invocation headers + 有效 Agent Key”及“错误完整 Invocation headers + 有效 Agent Key”，均未获得降级放行。另一个客户端用例只发送 Agent Key 因而识别为 agent_key，见 §6.2；不能把这里的服务器规则概括成“所有客户端半组配置都绝不选择 key”。[C13]

### 7.2 为什么不支持半 header、半 body 拼接

如果 header 提供 invocationId、body 提供 callbackToken，读取规则会变得模糊，还可能使不同 hook 对“这组凭据是什么”产生不同判断。

当前 extractCallbackCredentials 在这种混合来源下返回 null。旧 body/query 兼容路径只有在两个 header 都缺失时才适用。[C4]

第一方 headers-only 与服务端兼容旧 body/query 并不矛盾。迁移期必须如实说明剩余兼容面，不能说“服务端已经彻底禁用旧参数”。

### 7.3 principal 是服务端解析的主体

Invocation 验证成功后，API 根据记录推导 userId、catId、threadId、invocationId 等，而不是采信 body 中自报的值。

Agent Key principal 则包含 agentKeyId、userId、catId 与 scope，**没有凭空捏造当前 threadId 或 invocationId**。[C5]

可以把 principal 理解为“这张请求票据在服务端验明后，确认属于谁”。

### 7.4 无凭据时，不能只看全局 hook

当前全局 hook 在完全没有适用凭据时可能直接返回，留给具体路由处理不同入口需求。因此需要认证的 callback 路由还必须使用 requireCallbackPrincipal / requireCallbackAuth 等 guard。[C4]

这两个 guard 也不同：

- requireCallbackPrincipal：接受适用的统一主体；
- requireCallbackAuth：要求确切的 Invocation 认证记录。

一个 Agent Key 即使本身验证成功，也不等于能通过 Invocation-only 路由。本章通过真实 hook 加合成路由验证了该差异，但没有据此宣称审完所有 API 路由。

---

## 8. 授权：身份有效之后仍然可能被拒绝

### 8.1 线程作用域不是一个全局“能/不能跨线程”的开关

当前 helper 提供不同语义：[C5]

| helper / 场景 | 主要行为 |
|---|---|
| resolveBoundThreadScope | 要求请求线程与绑定线程相同，否则拒绝 |
| resolveScopedThreadId | 对适用跨线程请求检查可用 ThreadStore 与用户作用域 |
| resolvePrincipalThread 的 Agent Key 分支 | 要求明确 threadId，并验证线程归属/可见范围 |

同用户线程可能通过适用的跨线程校验；其他用户线程不能因为提供了合法 ID 就获得权限。缺少用于核验的 ThreadStore 时，相应路径返回 503，而不是默认放行。

system 创建的线程也不是全部开放：当前辅助判断会考虑非默认线程及该用户可见列表等条件，不能概括成“createdBy=system 都可读”。

### 8.2 同线程 post_message 与跨线程工具不同

Invocation 调用普通 post_message 时不应传 threadId；服务端结合该主体处理当前目标。跨线程协作走专门工具及对应作用域、路由、动作门禁。[C3][C10]

早拒绝可以省 HTTP 请求，但服务端仍是权威边界。不能因为客户端做了 guard，就跳过后端检查。

### 8.3 执行状态同样影响权限

post-message 等写路径还可能核验 latest invocation、TurnExecution ledger 的状态及 thread/user/cat/parent 身份是否一致。[C10]

所以合法 token 不代表“可以代表这个用户执行任何操作”。它只建立某一层可信主体；后续还要验证操作范围、执行状态、动作身份以及必要的审批。

本章不会把所有权限机制压成一个 `if (token) allow()`。

---

## 9. Invocation Token 与 Agent Key：为什么保留两条路径

### 9.1 Invocation Token 绑定一次受管执行

当前 Registry 创建 invocationId 与 callbackToken，并保存其对应记录。这里是服务端存储并比较的 opaque 凭据，不应因为名字叫 token 就擅自描述为 JWT、签名声明或无状态认证。[C6]

当前检查顺序区分未知 invocation、错误 token、已进入终态，以及适用的 latest 限制。错误 token 不应该直接当作“这次任务已 completed”。

### 9.2 Agent Key 面向没有当前 invocation 的持久接入

AgentKeyRegistry 绑定 catId 与 userId，当前 issue 使用随机 secret、salt 与 SHA-256 哈希保存校验材料，scope 为 user-bound。它有自己的过期、撤销、轮换与宽限期机制。[C7]

当前默认 TTL 为 45 天，轮换宽限配置默认为 24 小时；这是该类默认值，不是所有运行实例不可改变的常量，也不是本轮已执行真实密钥轮换。

不要把它说成“永久超级管理员 key”。有效 Agent Key 仍需通过具体 API 的主体类型与资源作用域要求。

### 9.3 三种“长期”别混淆

| 对象 | 当前实现的相关语义 |
|---|---|
| 模块三的原生 CLI ID 映射 | 某处默认 24 小时映射 TTL；不是认证 token |
| active Invocation 认证记录 | 无活动到期截止，权限随显式生命周期及执行真相变化 |
| Agent Key | 自己的 expiresAt、revokedAt、轮换与宽限机制 |

[C6][C7]

内部认证终态墓碑的 GC 又是第四件事，不是删除用户消息、线程或教学产物。

---

## 10. 长会话刷新：历史设计、当前服务端、兼容客户端

### 10.1 当前核心是生命周期，不是滑动 TTL

当前 MemoryAuthInvocationBackend 的 active 记录 `expiresAt:null`；Redis 脚本也保留 active 记录并移除旧式活动到期字段。终态包括 completed、failed、interrupted、replaced、revoked、canceled。[C6]

同一 thread/cat slot 建立新执行时，已有 active 凭据可能被置为 replaced。终态不会因为后续 refresh 获得新权限；容量满时也不能为了接纳新记录随便驱逐活跃认证主体。

内存后端虽然遵循这个逻辑，但不具备 Redis 后端的跨进程持久性。不要把“逻辑上没有 TTL”说成“任何部署重启后认证记录都一定还在”。

### 10.2 刷新路由现在做什么

当前 `/api/callbacks/refresh-token` 在 preValidation 中：[C8]

1. 提取完整凭据；
2. 检查适用的启动恢复状态；
3. peek 验证凭据，不为坏凭据消耗刷新 cooldown；
4. 尝试领取五分钟刷新 cooldown，重复请求可得到 429；
5. 用 verifyLatest 原子核验对应主体；
6. 成功时让后续认证 hook 使用已经核验的记录；
7. 读取当前记录，返回 `ok:true, expiresAt:null, ttlRemainingMs:null`。

注意当前实际 hook 是 **preValidation**。附近保留的旧说明提到 onRequest / slide，不能用旧注释替代正在执行的代码。

这段响应没有签发新 token，也没有给出一个被延长的数值 TTL。

### 10.3 客户端后台刷新循环仍存在

后台循环不是给模型调用的日常认知工具。当前单次刷新使用原始 fetch 与 10 秒超时，不叠加普通 POST 的秒级重试层；循环本身决定下次调度。[C8]

数值 TTL 分支采用“剩余值四分之一、上下界、抖动”的计算。实现特意抬高基础最小间隔，防止负向抖动落到服务端五分钟 cooldown 以内。

不能只背旧注释里的“5—30 分钟”：当前计算的下限包含安全余量，抖动也发生在基础 clamp 之后。

### 10.4 必须诚实讲出的兼容差异

当前 `performRefreshTick` 只在 `ttlRemainingMs` 为 number 时认定进入数值 TTL 成功路径。服务端当前给 null，所以会返回内部 `ok:false, shouldReschedule:true` 的可恢复结果，按 fallback delay 再调度。[C8]

本轮用服务端当前形状的虚构响应实际验证了这个分支。它证明的是客户端函数面对该响应时的行为，不是对运行环境刷新效果做了测量，也不是本轮修复了接口契约。

另一区别是：有明确 terminal reason 的 401 会停止循环；其他形状的 401、429、网络失败等可能继续 fallback。不能把“401”全部概括成同一种原因或同一种调度结论。

---

## 11. HTTP 重试、Outbox 与幂等分别保证什么

### 11.1 普通 callbackPost 的有限重试

当前默认 retry delays 是 1、2、4 秒，意味着初次加最多三次相应重试。每次 fetch 有默认 10 秒超时；配置和特定工具可覆盖这些值。[C9]

主要针对 408、429、5xx 以及相应网络异常，401 等不会简单盲重试。部分明确的 terminal callback code 即使处于 5xx 也不重试。

callbackGet 没有自动套用同一个 POST 重试循环，不能把所有 HTTP helpers 说成统一重试策略。

### 11.2 请求失败不等于动作一定没发生

典型情况：API 已经写入消息，但客户端没有收到响应。此时如果发送全新的业务请求，就可能重复产生副作用。

所以 transport 重试与幂等配合：同一次 callbackPost 的序列化 payload 被复用；post_message 在进入这次传输前确定 clientMessageId，交接提案也先确定 clientRequestId。[C3][C9][C11]

如果模型重新发起一次新工具调用，而没有复用原业务键，自动生成的新 UUID 不会神奇地证明它仍是旧请求。

### 11.3 Outbox 是有条件的后续投递，不是已经完成

适用工具可开启 outbox。HTTP 重试后仍是可恢复失败、且成功保存到本地 outbox 时，`sendCallbackRequest` 可在客户端合成 `ok:true / data.status:queued_for_retry`，再由 callbackPost 包成非错误 ToolResult。**这不是 API 返回 HTTP 200**，也不能证明业务 API 已接纳动作。[C3][C9]

这不是“消息已经送达目标线程”，更不是“目标 Agent 已完成工作”。队列后续重放还会面对当前凭据状态、作用域与业务幂等条件。

本章没有运行宿主 outbox 重放。原 43 项脚本关闭 outbox；新增 3 项边界脚本仅在其中一项启用新鲜隔离 fixture outbox，入队前确认没有既有文件，只写入本次虚构请求，不读取或重放宿主或旧 fixture 队列。[C13]

### 11.4 不承诺全局 exactly-once

消息幂等键、提案保留键、HTTP 重试和 outbox 都有各自边界。它们不能自动覆盖所有外部工具副作用、跨系统事务或人工动作。

面试答法应该能明确说出：哪一层复用了什么请求身份，由哪个 owner 保存什么去重事实，以及哪些失败窗口仍需查询权威状态。

---

## 12. ToolResult、HTTP 200 与业务完成，不是同一个成功

### 12.1 工具结果的包装

当前工具层的基本结果是 content 数组，元素包含 text；错误结果还设置 `isError:true`。callbackPost 消费的是 `sendCallbackRequest` 的结果：其中 `ok:true` 既可能来自成功 HTTP 响应，也可能来自 HTTP 失败后本地 outbox 入队成功的合成结果；两者都能被包成非错误 ToolResult。因此，工具未标错误不能倒推出 API 曾返回 HTTP 200。[C3][C9]

模型需要读取结构化结果，而不是只看工具调用“没抛异常”。

### 12.2 三个反例

| 结果产生层 | 观察到的返回 | 应怎样理解 |
|---|---|---|
| 客户端本地 outbox + MCP 包装 | 非错误 ToolResult，正文 status=queued_for_retry | HTTP 尝试可能全部失败，只进入本地待投递；不证明 API 已接纳或业务完成 |
| API HTTP / 业务响应 | HTTP 200 + stale_ignored | 当前旧执行的动作没有按新请求执行 |
| 提案业务状态 | proposalId / pending | 提案已创建，不是人类已批准 |

本轮隔离反例只收到一条受控 HTTP 503，却在新鲜 fixture outbox 中新增了一个队列文件，最终得到非错误的 queued_for_retry ToolResult。没有任何 HTTP 200，也没有业务消息写入；“HTTP 失败”与“本地排队成功”可以同时成立。[C13]

相应 handler 有时会把特定业务状态进一步转为工具错误。例如交接提案 handler 将 stale_ignored / rejected 解释为没有创建本次有效提案。[C11]

不要由此推论所有工具都实现了相同的业务状态映射。**HTTP、MCP 包装、业务状态、人工批准和任务完成，应分别判断。**

---

## 13. 交接提案为什么必须保留人工审批

### 13.1 与模块三的连接

模块三讲了封存状态如何变化；这里讲谁有权提出和批准这个变化。

猫可以提出：已完成什么、下一步做什么、工作区、提交和注意事项。但提案创建本身不会封存当前 Session。[C11]

### 13.2 服务端不能信调用者指定的“我要封哪一个会话”

当前提案 callback 要求 Invocation 认证，检查 body，并从可信记录取 user/cat/thread 与确切源消息。纯 Agent Key 即使身份有效，也不能自动变成这个 Invocation-only 路由所需的执行来源。[C11]

提案逻辑再按可信作用域查当前 active session，不把模型传来的任意 sessionId 当目标。

### 13.3 防重复与防滥用

当前逻辑包含每个 active session 至多一个 pending/approving 提案、冷却和时间窗口上限；transport retry 使用 clientRequestId 对齐同一个提案。[C11]

这些约束各有存储/并发条件，不能单凭一个进程内用例宣称多实例所有竞态都已排除。

### 13.4 提案与批准是两段责任

```text
Agent 提交五件套
  ↓
API 认证、校验来源、检查当前会话与提案条件
  ↓
创建 pending 提案并进入可见审批流程
  ↓ 人类作出决定
批准路径再次核对当前对象，跨过封存提交点
  ↓
安排接续与后续处理
```

如果用户驳回，或者提案已经不再适用，就不能用“猫已经建议过”代替人类的批准。当前生命周期状态也应从 owner store 查询，而不是从旧卡片文字推断。

本轮只验证了纯提案逻辑仍保持 session 为 active，没有触发真实审批、封存或 UI 回调。

---

## 14. 从威胁到守卫：面试时应能逐层定位

| 风险或错误 | 当前应核对的守卫 | 不能夸大的结论 |
|---|---|---|
| 参数类型错、缺必填 | SDK schema 与 API body schema | JSON 合法不等于业务合法 |
| 任意填 catId/userId 冒名 | 服务端从认证记录推导主体 | 所有 payload 字段都可信 |
| API 收到半组 Invocation headers | 服务器拒绝半组/混合拼接；客户端发送前的凭据选择另见 §6.2 | 不能把“客户端只选择 key”当作“API 用 key 补救半组请求” |
| 已结束执行继续回调 | active/terminal、latest 与执行账本 | 持有旧 token 就仍有权限 |
| 指向别人的线程 | 对应 bound/scope helper 与 owner 检查 | 线程 ID 不是秘密所以任何人都可用 |
| 长会话使用旧环境凭据 | 当前文件优先重读与服务端校验 | 读取文件失败后回退一定仍有效 |
| 只读重放再次写入 | 载体策略与 API toolExecutionPolicy | readOnlyHint 足以防越权 |
| 丢响应后重复执行 | 稳定业务键、owner 去重与状态查询 | HTTP 重试保证全部副作用恰好一次 |
| 旧 outbox 请求重新出现 | 当前认证/生命周期及特定恢复契约 | outbox 可以绕过终态 |
| 提案被误认为批准 | pending 与人类 decision 分离 | 返回 proposalId 就能继续不可逆动作 |
| 工具结果夹带不可信文本 | 保持工具数据与操作授权分离 | MCP 传输会自动消除提示注入 |

这是设计与核查框架，不是完整渗透测试结论。密钥泄露、网络部署、所有路由覆盖、所有日志脱敏、密码学侧信道等都不能由本轮局部测试一并认证。

---

## 15. 技术栈与设计取舍

| 组件 | 具体责任 | 主要取舍 |
|---|---|---|
| MCP SDK / registerTool | 协议工具描述、入口与校验衔接 | 要与实际 SDK 接口形状匹配 |
| Zod | 应用可执行的参数约束 | 不等于权限系统 |
| JSON Schema 适配 | 让特定普通 schema 接上 SDK | 当前只支持子集，不能悄悄许诺完整标准 |
| stdio JSON-RPC | CLI 与 MCP server 的消息交换 | 协议输出与普通日志应分离 |
| HTTP callback helpers | 传递业务参数与宿主认证头，处理响应/有限重试 | 网络失败窗口需要幂等与状态查询 |
| Fastify hook 与路由 | 认证、主体推导、业务验证和执行 | 公共 hook 不能代替每个业务入口的 guard |
| Invocation Registry | 一次受管执行的认证生命周期 | 要跟执行状态一致，不只看时间 |
| Agent Key Registry | 持久 agent 身份、过期/撤销/轮换 | 没有当前 invocation，不能伪造其权限 |
| 各 owner Store | 消息、提案、状态、去重事实 | 持久化事实与聊天文字分开 |
| Approval 流程 | 人类决定与后续受控动作 | 猫的提议不是人类授权 |

本项目选择保留业务 API 作为权威执行面，而不是让每个 MCP 工具各自实现一套消息、权限和审批存储。与此同时，工具层保留必要的早拒绝和明确描述，减少无效请求及模型误用。

---

## 16. 一段可以练习的 90 秒介绍

> 这个模块把模型的工具调用接到已有业务 API，而不是让模型直接拥有业务数据库权限。工具按域注册，通过 SDK 和 Zod 处理参数；CLI 到 MCP 走相应的 stdio JSON-RPC，handler 再通过 HTTP callback 调用 Fastify。
>
> 我们把参数合法、身份有效、资源授权和人工批准分开。Invocation 凭据绑定一次受管执行，Agent Key 则服务于持久接入；API 从认证记录取得用户和 Agent 身份，再检查线程、执行状态和业务条件。终态凭据不能因为还被保存着就继续使用。
>
> 为了应对长会话和网络故障，当前实现会重读适用凭据，保留主动刷新、有限重试和可选 outbox，并用业务键对齐重复请求。但当前 Invocation 已是生命周期认证，不能继续简单描述成所有 token 都靠滑动 TTL。会话交接工具只创建待批准提案，不能替代人类决定。

这里的“参与者视角”是表达训练；你实际负责哪些设计、代码与验证，仍应补充真实且可追溯的经历。

---

## 17. 二十个递进追问

### Q1：为什么 MCP server 还要再调用 HTTP API？

MCP 解决工具协议接入，API 复用业务身份、存储和审批规则。避免每个工具各造一套后端真相；代价是多一段传输、错误处理与认证衔接。见第 1—2 节。

### Q2：stdio 和 HTTP 的边界在哪里？

前者是本仓对应 CLI/MCP 入口的协议通道，后者是 handler 到业务 API 的请求。工具未注册、schema 失败、HTTP 401 和业务 pending 不应混成一个错误。见第 3 节。

### Q3：为什么日志不能随意写 stdout？

当前 stdio 按换行解析 JSON-RPC。普通日志不是协议消息，会污染通道；入口因此用 stderr 输出普通日志。不能据入口代码宣称所有依赖都已审完。见第 3 节。

### Q4：registerTool、schema、handler 分别做什么？

注册名称和说明，让客户端知道有这个工具；schema 约束参数；handler 执行该工具逻辑。模型可见性与运行授权还在其他层。见第 4—5 节。

### Q5：JSON Schema 转成 Zod 就完全等价了吗？

不一定。当前转换器是子集：integer 转 number、minimum 等未完整实现。本轮直接验证了该边界；具体 Callback 的原生 Zod shape 不能与此混为一谈。见第 5 节。

### Q6：SDK 已校验，API 为什么还校验？

API 不能信任每个客户端都使用同一个 SDK 或忠实执行前置检查，且业务状态、作用域需要服务端信息。见第 5、8 节。

### Q7：身份认证与授权有什么区别？

认证确认请求代表谁；授权确认这个主体对当前对象和动作能做什么。有效 token 仍可能因线程、策略或状态被拒绝。见第 7—8 节。

### Q8：为什么不让模型手填 userId/catId 作为调用身份？

那是请求正文，不能自证身份。可信主体由通过校验的服务端记录推导；正文中的业务对象 ID 也要再检查作用域。见第 6—8 节。

### Q9：Invocation Token 与 Agent Key 有何差别？

前者绑定受管执行和当前状态，后者绑定持久 agent/user 身份但没有天然的当前 invocation/thread。支持某类 principal，不代表每个工具都接受它。见第 9 节。

### Q10：为什么半组 Invocation 有时走 Agent Key，有时被拒绝？

先问处于哪一阶段。默认客户端路径中，本地 Invocation 候选不完整但有可用 Agent Key 时，可丢弃半组字段、只发送 key，API 因而识别为 agent_key。若 API 实际收到半组 Invocation headers，则返回 401/missing_creds；收到完整但错误的 Invocation 对，也不会在该 hook 用 key 补救。这是两种不同 HTTP 请求，不是权限提升：前者仍没有当前 invocation/thread，也不能越过 Invocation-only、线程及业务门禁。见第 6.2、7 节。

### Q11：你们的 token 是 JWT 吗？

当前这段 InvocationRegistry 使用生成的 opaque 凭据与服务端记录进行校验，不能凭 token 这个名字讲成 JWT。Agent Key 另有随机 secret 与哈希记录。见第 9 节。

### Q12：长会话为什么不会简单因为一个旧 TTL 到点就失效？

当前 active Invocation 记录没有活动到期截止，终态由生命周期控制。别把这与 Agent Key 自己的过期机制或模块三的 CLI ID 映射 TTL 混用。见第 9—10 节。

### Q13：那 refresh-token 现在还在做什么？

它验证完整凭据、刷新频率与 latest 状态，并返回当前生命周期相关响应；当前返回 null TTL，不是换发 token。客户端对此还有 fallback 差异，不能用旧注释讲成一致的滑动续期。见第 10 节。

### Q14：读取凭据文件是否意味着可以绕过服务端？

不是。文件提供候选凭据，仍要通过服务端状态与作用域检查；失效环境回退也可能失败。文件权限和宿主管理是另一个安全边界，本轮未对真实部署做全审计。见第 6 节。

### Q15：跨线程能不能操作？

看具体工具和作用域契约。绑定线程写入要求同线程；合法跨线程入口会核验 owner/可见范围。Agent Key 通常需显式目标，但显式填写不等于获得权限。见第 8 节。

### Q16：readOnlyHint 就能保证不写入吗？

不能。它是声明信息；工具面过滤、载体执行策略和 API guard 才是不同层的限制。当前一种 read_only 策略甚至拒绝全部 callback 工具执行，不能与只读工具面混为一谈。见第 4 节。

### Q17：重试为什么不会重复发消息？

只能有条件回答：同一次传输复用序列化请求和已确定的业务键，由对应 owner 去重。新工具调用可能生成新键，所有外部副作用也不自动被覆盖。见第 11 节。

### Q18：HTTP 200 就算成功了吗？

即使实际收到 HTTP 200，也要检查业务状态，例如 stale_ignored 不代表本次动作执行、pending 不代表人类批准。还要避免反向推断：非错误 ToolResult 不证明收到过 HTTP 200，HTTP 尝试全部 503 后，客户端本地 outbox 入队成功也能返回 queued_for_retry。要分别判断 HTTP 结果、MCP 包装、业务接纳/完成与审批。见第 11.3、12 节。

### Q19：猫提出交接后为什么还要人类确认？

建议和授权不同。提案身份来自当前执行，目标从实际 active 会话解析；批准路径再核对对象并进入封存，不能通过提交文字自己给自己授权。见第 13 节。

### Q20：怎样验证工具调用安全，而不是只说有 token？

按层证明：SDK 参数拒绝、认证优先级、主体推导、资源作用域、执行状态、幂等、审批及异常路径。再补真实 stdio、真实业务路由、持久化、多实例和 UI 端到端验证。本轮完成前面的隔离局部验证，不把它冒充全系统安全认证。见第 18 节。

---

## 18. 本轮实际验证与限制

在 `packages/api` 下实际执行：

```text
node --check ../../data/learning/verification/module04-v2/source-smoke-v1-replay.mjs
node --check ../../data/learning/verification/module04-v2/review-edge-cases.mjs
node --import tsx ../../data/learning/verification/module04-v2/source-smoke-v1-replay.mjs
node --import tsx ../../data/learning/verification/module04-v2/review-edge-cases.mjs
```

**本轮重新执行：原 43 项全部通过；审查新增的 3 项边界检查也全部通过；两个脚本分别退出 0，Node v24.21.0。** 两份脚本分别与 v1 作者脚本及 reviewer 反例脚本逐字节一致，副本、输出、结果及脚本哈希均保存在新的 module04-v2 目录，不覆盖双方旧证据。

### 原 43 项验证由三部分组成

1. **直接导入当前 src 的函数/对象检查**：schema 子集、凭据优先级、作用域 helper、认证生命周期、错误重试、刷新分支和 pending 提案。
2. **真实 MCP SDK 的 InMemoryTransport**：连接 client/server，列出真实注册的 post_message schema，验证错误参数在 HTTP 前被拒绝、合法调用到达 mock HTTP。
3. **Fastify inject**：将当前真实认证 hook/guard 接到合成 probe 路由，验证缺凭据、假冒 body、混合凭据、错误 Invocation 与有效 Agent Key、Invocation-only、旧 body 兼容、只读执行策略和撤销等情形。

### 新增的 3 项边界检查

1. 客户端只有 Invocation ID、没有 token，但存在有效 fixture Agent Key：真实 helper 最终只发 key，经合成 API probe 识别为 agent_key，没有 invocation thread。
2. 直接向同一 probe 发原始半组 Invocation header + 同一有效 fixture key：401 / missing_creds。
3. 所有受控 HTTP 尝试均为 503（本例一次），本地 outbox 入队后返回非错误 queued_for_retry ToolResult；新鲜隔离队列新增一个 fixture 文件。

这些检查复现当前实现，解释 v1 为何需要改讲义；不是修复后产品实现的 RED/GREEN，也不能替代 reviewer 对 v2 文字和追问的独立复核。

### 安全隔离

- 测试子进程在调用凭据 resolver 前清除相关继承认证选择，设置明显虚构的 fixture 凭据。
- 只读写学习验证目录里的虚构凭据文件；没有读取宿主真实 token/key 文件。
- fetch 由受控响应替代；没有真实 HTTP 请求，没有监听端口。
- 原 43 项显式关闭 outbox；新增反例仅对新鲜隔离 fixture 目录开启一次本地入队，先确认目录无旧条目，不读取/重放宿主或既有 fixture 队列。
- Registry 和提案使用内存实现；日志与审计输出定向隔离目录。
- 没有产品实现、运行配置、数据库或真实审批变化。

### 未验证

没有启动真实 CLI 或 stdio MCP 子进程；没有运行完整真实 callbacks 业务路由、Redis/SQLite、真实网络断连/超时、outbox 重放、真实 credential rotation、浏览器审批、多实例、完整工具到业务 E2E 或全量 suite。

特别注意：Fastify inject 的 probe 路由是验证用合成路由，不是本轮实际调用了生产 post-message；SDK InMemoryTransport 也不是 stdio 字节流验收。局部措施不等于完整权限矩阵、所有日志脱敏或提示注入防御已经通过。

### 文件证据

```text
data/learning/verification/module04-v2/
  source-smoke-v1-replay.mjs        原作者 43 项脚本逐字节副本
  source-smoke-output.txt / source-smoke-result.json
  source-smoke-exit-code.txt
  review-edge-cases.mjs            reviewer 3 项脚本逐字节副本
  review-edge-cases-output.txt / edge-cases-result.json
  review-edge-exit-code.txt
  script-provenance.json           两份脚本哈希及来源
  fixture-credentials.json         仅虚构测试值
  fixture-broken-credentials.json  仅损坏格式测试值
  outbox-edge/                    本次隔离 fixture 入队，不随教材发布
```

讲义还必须由非作者独立复核。工具测试通过、内容审查通过、用户理解和完整产品验收是四件不同的事。

---

## 19. 源码索引与继续学习的边界

| 编号 | 本轮核查坐标 | 支撑内容 |
|---|---|---|
| C1 | `packages/mcp-server/src/collab.ts`；`canonical-server-tools.ts`、`canonical-tool-registry.ts`；本地 `packages/mcp-server/node_modules/@modelcontextprotocol/sdk/package.json` 与 `dist/esm/shared/stdio.js` | 工具面入口、SDK 版本、stdio 消息编解码 |
| C2 | `packages/mcp-server/src/server-toolsets.ts`：19—81、145—165、215—281；`json-schema-to-zod.ts` | canonical 投影、注册契约、strict 与转换子集 |
| C3 | `packages/mcp-server/src/tools/callback-tools.ts`：98—209、231—310、910—990、1091—1144；`tools/invocation-auth.ts`；`packages/shared/src/utils/agent-key-credentials.ts`：65—115；`tools/file-tools.ts`：18—44 | 认证选择、headers、凭据重读、handler 参数与 ToolResult |
| C4 | `packages/api/src/routes/callback-auth-prehandler.ts`：23—45、89—188、207—225、255—273；`packages/api/src/domains/cats/services/agents/invocation/tool-execution-policy.ts`：14—93 | 身份优先级、兼容规则、guard、执行策略 |
| C5 | `packages/api/src/routes/callback-scope-helpers.ts`：78—189 | principal 与不同线程作用域契约 |
| C6 | `packages/api/src/domains/cats/services/agents/invocation/InvocationRegistry.ts`：1—108、200—301；`MemoryAuthInvocationBackend.ts`：25—86、152—185；`RedisAuthInvocationLua.ts` 的 active PERSIST、verify 与 terminal 分支 | opaque token、active/terminal、替换、墓碑及持久化边界 |
| C7 | `packages/api/src/domains/cats/services/agents/agent-key/AgentKeyRegistry.ts`；`MemoryAgentKeyBackend.ts`：1—66 | Agent Key 哈希材料、user-bound、过期/撤销/轮换 |
| C8 | `packages/mcp-server/src/refresh-loop.ts`：19—78、118—157、205 起；`packages/api/src/routes/callbacks.ts`：6305—6403 | 刷新调度、cooldown、当前 null TTL 响应与兼容差异 |
| C9 | `packages/mcp-server/src/tools/callback-retry.ts`；`callback-outbox.ts`：169—206 | 有限重试、相同 payload、条件 outbox、queued_for_retry |
| C10 | `packages/api/src/routes/callbacks.ts`：1398 起、2115—2233；工具 handler 见 C3 | 写入主体、业务校验、latest 与执行账本边界 |
| C11 | `packages/mcp-server/src/tools/callback-tools.ts`：2791—2829；`packages/api/src/routes/callback-propose-session-handoff-routes.ts`：29—38、110—130、193—215、229—255；`packages/api/src/domains/cats/services/session/sessionHandoffPropose.js` 对应源码为 `sessionHandoffPropose.ts`；同目录 `sessionHandoffApprove.ts` | 稳定提案键、可信来源、pending 与人类批准分离 |
| C12 | 原始简历消息 `0001790992157284-000008-753cd1ce`；教学要求 `0001791002895437-000010-6d7c0fec`；分工 `0001791009790580-000003-70ab2711` | 当前教材的既定目标与历史原文，未编造个人贡献 |
| C13 | `data/learning/verification/module04-v2/`；初审报告 `data/learning/reviews/2026-10-04-module04-v1-3625a0a3-sol1-review.md` | 本轮原 43 项重放 + 3 项边界检查、脚本同源哈希、真实输出与限制；M4-P2-01/02 的修订依据 |

模块三放行来源：`thread_mus0q6ds3cz9umwb#0001791085073144-000075-0973ed5c`。本章是新内容，不能借用上一章 approved 代替本章审查。

本章最值得记住的是六个“不等于”：

1. **工具可见，不等于该次调用已获授权。**
2. **参数合法，不等于身份和资源作用域合法。**
3. **身份有效，不等于可以冒充另一条 invocation。**
4. **MCP 包装非错误、HTTP 成功与业务完成，不能互相替代。**
5. **重试投递，不等于全部副作用恰好一次。**
6. **提出建议，不等于获得人类批准。**

下一章是「本地记忆与混合检索」；本章不提前展开 BM25、向量与 RRF 算法。
