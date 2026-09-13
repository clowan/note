# 06 后台摘要：跟着 205 条消息走完调度、解析、提交与恢复

<!-- memory-series-nav -->
[返回目录](D:/AI/clower-1/clowder-note/memory/README.md) · [上一篇](D:/AI/clower-1/clowder-note/memory/05-搜索结果重排算法.md) · [下一篇](D:/AI/clower-1/clowder-note/memory/07-会话记忆与上下文接续.md)
<!-- /memory-series-nav -->


> 源码基线：`6868041ca`；修订日期：2026-09-12。本篇以固定消息批次推演。已运行原始 `processThread()`、摘要解析器和提取出的资格判定函数；消息源/模型响应是可控 fixture，数据库使用 Node SQLite `:memory:` 与同步 transaction 适配器，没有调用真实 LLM/Redis。

## 本篇的主角不是“一个总结函数”，而是一项可中断的后台工作

Thread T42 持续聊天，已经积累 205 条新消息。系统希望生成更好的摘要，但必须回答：什么时候启动？读哪一段？生成一半失败怎么办？第一批只处理200条，剩下5条是否会饿死？模型说“人确认过”是否可信？

我们始终跟着同一个工作对象：

```text
thread_id = T42
消息 = m001 … m205
旧搜索摘要 = old-summary
last_summarized_message_id = null
pending_message_count = 205
```

只有把这些状态连起来，watermark、事务和候选回放才有具体意义。源码入口：[processThread](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/SummaryCompactionTask.ts#L107)。

## 1. 先排除三个同名但不属于本篇的 summary

| 名称 | 谁生成 | 本篇是否直接维护 |
|---|---|---|
| thread 基础搜索 summary | IndexBuilder 拼接有限消息 | 不是本任务生产，但与它共用一个读模型字段 |
| digest / ThreadMemory | TranscriptWriter 和规则合并 | 否，属于会话交接 |
| handoff digest | 可选交接模型 | 否 |
| abstractive summary | 本篇后台任务 | 是 |

本篇直接写 `summary_segments`、`summary_state` 和 `evidence_docs.summary`。它没有把模型结果直接写进 Redis 的 ThreadMemory。

区分生产者特别重要：同一个 thread 的“摘要”可能来自不同过程，不能只看到变量名 summary 就推断是模型总结。

## 2. 启动时并不是无条件注册这个任务

index.ts 先检查 `F102_ABSTRACTIVE==='on'` 与 indexBuilder 存在，才创建客户端与 TaskSpec，注册进统一调度器。长期候选输出还单独看 `F102_DURABLE_CANDIDATES`。

所以：

```text
摘要模块代码存在
  ≠ 当前实例已经注册该任务
  ≠ 注册后每轮一定执行
  ≠ 每次执行都会输出长期候选
```

开关属于流程入口。私有函数 processThread 的职责不是替所有入口再实现一遍部署开关；本任务测试调用它时，是有意直接验证业务算法，不代表真实实例开关被启用。

依据：[启动注册](D:/AI/clower-1/clowder-ai/packages/api/src/index.ts#L1060)、[候选开关](D:/AI/clower-1/clowder-ai/packages/api/src/index.ts#L1137)。

## 3. Gate 第一关：thread 是否已经安静下来？

实际代码先检查 lastActivity：

```ts
if (lastActivity) {
  const quietMs = now - lastActivity.lastMessageAt;
  if (quietMs < config.quietWindowMinutes * 60 * 1000) return false;
}
```

默认 quietWindowMinutes=10。即使积压很多、包含高价值信号，也先经过这一关。

为什么不热聊中每次都总结？因为摘要快照持续被新消息追赶，频繁生成会增加重复工作。安静窗口是一个调度策略，不代表超过10分钟的内容就更重要。

若 lastActivity 不存在，这段检查本身被跳过。代码没有在这里自动把“没有活动信息”判定成“正在热聊”。失败与缺数据语义要追到实际函数，不要补充源码不存在的分支。

## 4. Gate 第二、三关：体量和冷却怎样组合？

源码核心逻辑：

```ts
const highSignal = hasHighValueSignal(state.pending_signal_flags);
const isCarryOver = state.carry_over === 1;

const volumeOk = isCarryOver
  || state.pending_message_count >= 20
  || state.pending_token_count >= 1500
  || highSignal;

const bypassCooldown = highSignal || isCarryOver;
```

默认常规冷却为2小时。由此得到：

```text
quiet_ok
AND (carry_over OR count_ok OR token_ok OR signal_ok)
AND (carry_over OR signal_ok OR cooldown_ok)
```

不要把所有门槛误读为同时满足。也不要说 carry_over 绕过所有门槛：安静窗口在它之前，仍然生效。

### 4.1 把具体状态代进去

| 状态 | quiet | count/token | signal | carry | 近期已总结 | 结果 |
|---|---|---|---|---|---|---|
| 205条，还在热聊 | 否 | 满足 | 任意 | 任意 | 任意 | 不运行 |
| 5条普通尾部 | 是 | 不满足 | 无 | 0 | 否 | 不运行 |
| 5条含决定信号 | 是 | 不满足 | 有 | 0 | 是 | 可运行 |
| 5条未处理尾批 | 是 | 不满足 | 无 | 1 | 是 | 可运行 |
| 25条普通消息 | 是 | 满足 | 无 | 0 | 是 | 冷却阻止 |

本轮实际运行过“5条+carry_over=1+近期总结”：安静时 true，热聊时 false，去掉 carry 后 false。这里是原始判定函数提取后的固定时钟验证。

默认检查间隔30分钟，常规每轮最多5个 thread；TaskSpec 的冷启动预算还有放宽，不能说任何情况都硬限制5个。依据：[配置](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/summary-config.ts#L5)、[资格函数](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/SummaryCompactionTask.ts#L67)、[TaskSpec](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/SummaryCompactionTaskSpec.ts#L76)。

## 5. 读数据时：为什么必须 after watermark，而不是最近200条？

进入本例后，调用：

```ts
const messages = await deps.getMessagesAfterWatermark(
  state.thread_id,
  state.last_summarized_message_id,
  200,
);
```

本例 watermark=null，取 m001…m200，留下 m201…m205。

如果错误地改为“最新200条”，会取 m006…m205，m001…m005 被跳过。而 watermark 若据此推进，之后再也不会自然回到这五条。

因此关键不是“200这个数字”，而是**消息读取接口必须和进度字段具有一致的顺序语义**。启动接线使用 getByThreadAfter，不是 latest-N 后随便切片。

同一轮还从 evidence_docs 读取当前 summary，作为 previousSummary。它只是一份当前读模型，可能来自此前模型摘要，也可能来自基础拼接。

依据：[消息区间读取](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/SummaryCompactionTask.ts#L116)、[实际存储适配](D:/AI/clower-1/clowder-ai/packages/api/src/index.ts#L1113)。

## 6. 发给模型的是怎样的任务？

客户端使用 API key profile，向兼容的 `/v1/messages` 发请求。该提交使用 `claude-opus-4-6`、max_tokens=8192；这是源码事实，不是最新模型推荐。

输入包括旧 summary 和本批消息；system prompt 强调你是总结者，不是继续参与聊天。要求自然语言格式：

```markdown
# 讨论主题

约200–400字符的内容、决定、风险和下一步。

## Durable Knowledge
[decision!] 某个长期决定 — 结论
[lesson] 某个长期教训 — 结论
```

设计分工是模型输出可读文本，程序提取与补齐结构。它没有在这条请求中使用严格 JSON Schema 来约束完整 TopicSegment。

HTTP错误、没 text、解析返回空时客户端返回 null。这个 fetch 没有像 EmbeddingService 那样显式带 AbortSignal.timeout；外层若结束等待，也不自动意味着底层网络请求被取消。

依据：[摘要 prompt](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/AbstractiveSummaryClient.ts#L49)、[实际客户端](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/AbstractiveSummaryClient.ts#L278)。

## 7. 解析器第一步：标题如何变成 topicLabel/topicKey？

`parseNaturalLanguageOutput()` 先拒绝空/太短文本，再用正则找 Markdown 标题或粗体标题。找不到则尝试第一条合理长度的非空行，再不行按 threadId 生成兜底标题。

topicKey 来自：小写 → 非英文数字/指定中文字符替换为连字符 → 去首尾连字符 → 截到60字符。

例子：

```text
topicLabel = 回调重试的幂等策略
topicKey   = 回调重试的幂等策略
```

另一种有标点的标题可能变为连字符串。这里没有调用聚类模型证明两个标题属于同一主题，topicKey 是可用的归类字段，不是主题真值。

### 7.1 三个长度限制不是一回事

- 200–400字符：prompt 给模型的写作要求；
- 800字符：解析器清理后 summary 的截断上限；
- 8192 token：模型响应预算。

如果面试官问“怎么保证摘要不超400字”，应该回答当前代码不是严格验证400字，而是生成要求加后续800字符截断。不要用prompt要求替代程序约束。

依据：[标题和正文解析](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/AbstractiveSummaryClient.ts#L138)。

## 8. 解析器第二步：正文和候选如何分开？

正文截取标题后、Durable 标题或 candidate 标签之前的文本。之后过滤标题行、合并空白、截断。如果没得到正文，还有整体清理文本的兜底分支。

这不是完整 Markdown AST 解析器；它依赖有限格式约定。例如候选边界识别明确看 Durable 或标签，不能默认任何风格的段落标题都具有同样语义。

候选正则识别：

```text
[decision!]、[decision]
[lesson!]、[lesson]
[method!]、[method]
```

各组意义：kind、可选感叹号、title、可选 claim。没有独立 claim 时回退到 title。接着再做实现噪声过滤，而不是任何标签行都照单收录。

## 9. 一个感叹号如何变成“明确确认”？

真实转换：

```ts
const isExplicit = match[2] === '!';
confidence: isExplicit ? 'explicit' : 'inferred'
```

请把两层证据分开：

```text
prompt要求：只有人确认或相应共识时才输出 !
程序行为：只要模型输出 !，这里就转成 explicit
```

程序没有在这个解析函数里重新定位人类确认消息、验证用户身份、核对确认 span。因此 explicit 是模型输出标签的解释，不是人工审批系统签发的证明。

实际纯函数例子：同一段输出，把 `[decision!]` 改成 `[decision]`，其他字不变，confidence 从 explicit 变成 inferred。它没有重新理解对话；只是解析符号。

依据：[候选解析](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/AbstractiveSummaryClient.ts#L219)。

## 10. 噪声拒绝 gate 拒绝的是什么？

当前包括：标题不足8字符；以若干代码操作词开头；标题有特定代码文件扩展名或 camelCase 标识符；标题加claim中至少出现两个代码工件词。

例如“修改foo.ts”很可能被过滤；“网络重试必须保持业务幂等”更符合长期原则。

它是便宜的启发式，不保证短标题都没价值，也不保证留下来的都是正确长期知识。英文/中文风格、命名习惯都会影响命中。候选超过2个时，explicit优先，再按已有次序截断。

这段算法回答的是“尽量不要把一次具体改文件记成永久原则”，不是完整的知识有效性审查。依据：[isImplementationNoise](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/AbstractiveSummaryClient.ts#L195)。

### 10.1 再把三个边界输入真的送进解析器

为了区分“prompt要求”与“程序约束”，本轮实际检查了三个输入：

| 模型返回文本 | 程序观察 |
|---|---|
| 只有一个足够长的Markdown标题，没有正文 | 返回null，没有可提交摘要 |
| 没有Markdown标题，但有一条足够长的纯文本句子 | 可走兜底，形成一个segment |
| 有摘要，候选是`[decision!] 修复了 parser.ts 中的错误 — ...` | 噪声gate拒绝该候选 |

第三条尤为重要：感叹号并不会绕过所有检查。它只决定一个通过候选抽取后的confidence值；题名仍可能先被噪声gate剔除。

第二条也说明接口不是“格式稍有偏差就全部失败”的严格解析器。兜底提高了可用性，但可能让同一句文字同时被用作标题和摘要，结构变得粗糙。哪个取舍更合适，要结合任务失败率与摘要质量，而不是只追求解析成功率。

定位源码时，可以沿这个顺序设置断点：titleMatch→titleEnd→candidateStart→summaryText→summary→extractCandidates→buildSingleSegment。每一步都是普通字符串或数组，能打印出来核查，没必要把解析器想成另一轮黑箱模型推理。

对应检查：`06-parser-format-fallback-and-noise-rejection`，输出保存在本目录的验证报告。
## 11. 程序补出的 evidence 为什么不是精确引用？

实际候选构造：

```ts
evidence: [{
  threadId: input.threadId,
  messageId: input.messages[0]?.id ?? '',
  span: '',
}],
relatedAnchors: [],
```

我们用两条消息演示：m101 解释响应丢失，m102 才明确做决定。解析结果的 evidence 仍指向 m101，因为程序选的是批次第一条，而不是确认那一条；span为空。

这能帮助追到大致批次，但不能用作“程序已精准定位决定原句”的保证。若要加强可信度，需要让候选携带真实消息引用，并验证引用存在、说话者和确认内容，而不是只把类型命名成 Evidence 就认为可审计性已经完成。

还有一个相似细节：默认 `buildSingleSegment()` 将输入第一条和最后一条当作段的范围，boundaryReason='single batch'、boundaryConfidence='high'。它没有真的按语义把本批拆成多个主题。

本轮添加第二个标题再调用解析器，segments.length仍为1。因此接口是数组、配置里有maxTopicSegments=3，不代表当前默认客户端已经实现多主题分段。

依据：[候选字段](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/AbstractiveSummaryClient.ts#L231)、[单段构造](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/AbstractiveSummaryClient.ts#L249)。

## 12. 模型成功返回后：为什么要一个事务写三处？

本例生成 new-summary。程序在一个 SQLite 事务中做：

```text
① INSERT summary_segments
   记录 m001…m200、message_count=200、summary、candidates、模型/prompt元数据
② UPDATE evidence_docs
   将 thread-T42 的搜索摘要设为 new-summary
③ UPDATE summary_state
   watermark=m200，pending清零，summary_type=abstractive
```

考虑两种错误顺序：

- 先改进度，摘要写失败：以为处理过，却没有摘要；
- 先写摘要，进度失败：下一次重复处理。

事务把这三处数据库状态绑在一起，避免本批内部只提交一部分。

但模型调用已经发生在事务之前。它不在事务里；reEmbed和候选写文件又发生在事务之后。不是一个把外部世界包起来的大事务。

依据：[事务完整代码](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/SummaryCompactionTask.ts#L137)。

### 12.1 我们实际注入了怎样的失败？

测试在内存数据库中添加“更新summary时抛错”的触发器，再运行原始processThread。

观察：

```text
任务抛错
summary_segments 行数仍为0
watermark仍为null
```

这验证了当前同步transaction适配下，这批数据库修改会一起回滚。它不是多进程事务隔离或生产better-sqlite3所有行为的完整证明。

## 13. 205 条消息第一轮后，状态究竟是什么？

本轮原始processThread的实际输出：

| 项目 | 第一轮后 |
|---|---|
| watermark | m200 |
| 已写摘要段 | m001—m200，200条 |
| pending_message_count | 5 |
| carry_over | 1 |
| summary_type | abstractive |

注意 pending 不是始终零。事务提交后，程序再调用：

```text
getMessagesAfterWatermark(T42, m200, 1)
```

发现还有消息，再取最多200条剩余批次，重新计算pending并设carry_over。

实际读取调用顺序是：

```text
after=null, limit=200
after=m200, limit=1
after=m200, limit=200
```

第一步处理数据，后两步处理是否有积压与大致积压量。这种后置检查也为生成期间新到消息提供继续处理的机会，但读取失败仍是best-effort，不是完整可靠消息队列。

依据：[carry_over 补计数](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/SummaryCompactionTask.ts#L244)。

## 14. 第二轮只有 5 条，为什么可以立刻继续？

刚总结过，常规冷却还没过去；只有5条，也没达到20条门槛。如果沿用普通条件，就可能让尾部长期饿死。

carry_over=1 解决的正是这个情况。保持thread安静时，再调用原始processThread，得到：

```text
第二段：m201—m205，message_count=5
watermark：m205
pending_message_count：0
carry_over：0
summary_segments：共2条
```

这个两轮过程已经实际验证，不只是表格推测。它说明carry_over是“有未完成工作”的状态，不是对内容重要性的判定。

如果这时用户又开始聊天，quiet gate仍可阻止下一轮；先前的高优先级积压标记不会取消安静窗口。

## 15. 三种失败，为什么恢复动作不同？

### A. 模型返回 null

没有可提交结果，processThread返回false。实测没有新增segment，watermark不动。以后满足条件可重试。

### B. 数据库事务内失败

本批数据库写入回滚。实测进度与段都没提交，不能把它当已完成。

### C. reEmbed失败

发生在摘要事务之后。实测processThread仍成功，watermark已推进，new-summary保留；缺的是新的向量表示，而不是摘要正文。

这个区别来自执行顺序，不是“所有异常都统一重试一遍”。如果对C盲目从头重新生成摘要，可能反而重复工作；应考虑只补派生向量。

依据：[事务后的reEmbed](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/SummaryCompactionTask.ts#L200)。

## 16. 候选文件写失败，摘要为什么不能当作没发生？

候选已经作为JSON存在summary_segments.candidates中，随后才调用submitCandidate。若文件提交失败，异常被记录，但不会回滚摘要事务。

本轮模拟 submitCandidate 抛错，观察：

```text
watermark已到m020
summary_segments仍保存1个candidate
marker文件没有写入
```

这就是可供补偿的数据来源。启动时有代码扫描已存candidate，并根据现有marker的content集合去重后回放。

但是content去重不是数据库唯一业务键；回放不是每个异常瞬间都自动完成的持久任务系统。要追问恢复频率和重入，应继续看启动与调度路径，而不是听到“有回放”就认定最终不丢。

依据：[候选副作用](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/SummaryCompactionTask.ts#L217)、[启动补偿](D:/AI/clower-1/clowder-ai/packages/api/src/index.ts#L1170)。

### 16.1 自动 approved 不等于文件已发布

开关启用时，explicit候选被推进normalized、approved；method映射为lesson。这个回调没有在此处调用materialize，所以approved与Markdown存在、索引成功还是不同阶段。

结合第9节可知，自动批准依赖的是模型标签。要说清楚这一条安全边界，而不是把它宣传成所有长期知识都被人逐条审批过。

## 17. 为什么局部事务还不能证明全局 exactly-once？

并发推演：两个worker先后读到同一旧watermark，都去请求模型；第一个回来提交，第二个再回来也可能提交相同区间。一个事务内部原子，不等于事务之前读取并发进度的动作自动受保护。

当前部署是否通过调度器防止这种重入，需要检查整体任务锁/运行账本。这一段processThread本身不能单独证明多实例唯一执行。

可能的强化方向包括按thread租约、watermark CAS、消息区间幂等键、固定prompt版本的唯一约束。这里是设计建议，不是本文偷偷实现的功能。

## 18. 同一个搜索摘要为什么还可能被另一条路径改写？

沿时间线看：

```text
t0：本篇写 new-summary，source_hash=abstractive-...
t1：新消息触发 dirty thread
t2：IndexBuilder 重新拼接有限消息，计算普通内容hash
t3：upsert 写回 evidence_docs.summary
```

这说明evidence_docs.summary不只有本篇一个写入者。后续基础读模型可能替换模型生成摘要，而summary_segments是另外保存的段记录。

如果出现“刚总结完怎么又像聊天拼接”，应先看字段所有权和两条写入路径，而不是直接怀疑模型忘记。修复方案可能需要明确读模型优先级或分列，单纯加锁只控制时间顺序，不解决谁有权覆盖什么内容的语义。

依据：[模型摘要写入](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/SummaryCompactionTask.ts#L175)、[dirty thread写入](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/IndexBuilder.ts#L910)。

## 19. 复杂度与验证边界

程序每批最多处理200条，但模型输入还包括previousSummary；模型时延不能只由消息数量估计。解析器大体线性处理响应文本，候选数上限小；SQLite事务按实际segments数量写入，默认客户端目前一批一个segment。

进度、pending token估计和摘要token估计也并不都使用同一个精确tokenizer。它们有调度/观测性质，不能当模型真实计费量。

可复跑结果见 [results.json](D:/AI/clower-1/clowder-note/memory/verification/results.json)：包括双批205条、模型null、事务失败、reEmbed失败、候选失败、gate与解析器场景。数据库是`:memory:`，模型与消息读取是fixture，生产控制流是真正导入的processThread；没有真实网络服务和多进程压力测试。

## 20. 面试官追问时，怎样用本例回答？

**为什么不是取最新200条？** 因为必须从watermark之后继续，最新窗口会跳过旧积压。本例205条若取最新200条，就丢掉前5条的处理机会。

**为什么5条也能继续？** carry_over同时绕过体量与冷却，但不绕过安静窗口；两轮实测最后到m205。

**模型输出是强结构化的吗？** 此客户端输出自然语言，程序正则提取并补字段；默认只构造一个segment。

**explicit可信到什么程度？** 这里由模型输出的感叹号映射，没有独立确认原句验证。

**哪些操作属于事务？** segment、搜索摘要和watermark；不包含LLM、reEmbed和marker文件。

**模型/数据库/向量失败都同样重试吗？** 不同，先看失败发生在提交前还是提交后，再选择重跑生成还是只补派生工作。

**你证明了整个任务不丢不重吗？** 没有。已验证局部控制流与事务语义，跨worker互斥、文件补偿和部署级保证仍需额外测试。
