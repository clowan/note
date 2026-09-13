# Clowder AI 记忆系统：10 篇源码精读

> 整理日期：2026-09-12  
> 源码基线：`D:/AI/clower-1/clowder-ai`，提交 `6868041ca`  
> 用途：系统学习记忆模块，准备能够落到函数、字段、SQL、算法和故障边界的项目面试。  
> 范围：只新增本笔记目录，不修改 `clowder-ai` 源码、运行配置或真实持久化数据。

## 本轮质量修订：不只加长，而是补中间过程

- 每篇用固定资料、消息或事件贯穿，不在算法之间随意换一组无法对照的数据。
- 关键环节同时给输入、代码、变量/表格变化和输出，解释哪一个条件让它进入当前分支。
- 正常路径之外补失败、重入、边界条件，明确局部保证不能扩成全局保证。
- 实测、手算、模拟依赖和建议测试分别标注，避免把fixture通过说成生产效果。
- 新增[可复跑验证脚本及结果](D:/AI/clower-1/clowder-note/memory/verification/README.md)，可以核查“例子究竟怎么算出来”。

建议先对比修订后的[第03篇](D:/AI/clower-1/clowder-note/memory/03-关键词检索与渐进召回.md)：同四份资料从FTS到substring发生名次变化；再看[第06篇](D:/AI/clower-1/clowder-note/memory/06-后台摘要与Watermark.md)：205条消息两轮处理的实际状态。

## 一、阅读目录

以下10篇均有正文。本轮保持第1篇原文不变，实质重写第2—10篇：从概念摘要改为带固定样例、中间状态和分支推演的源码讲解。

| 篇章 | 重点 | 读完应能回答 |
|---|---|---|
| [01 消息写入与增量索引](D:/AI/clower-1/clowder-note/memory/01-消息写入与增量索引.md) | Redis 写入、listener、Dirty Set、hash、UPSERT、FTS、向量失效与补齐 | 一条消息如何从业务数据变成可检索条目？ |
| [02 文档索引编译器](D:/AI/clower-1/clowder-note/memory/02-文档索引编译器.md) | Scanner、anchor、摘要/关键词、版本、冲突、关系边、重建和一致性 | 文件如何编译成证据？全量和增量为什么不等价？ |
| [03 关键词检索与渐进召回](D:/AI/clower-1/clowder-note/memory/03-关键词检索与渐进召回.md) | 精确 anchor、FTS query、BM25、substring、entity | 原文存在为什么仍可能搜不到？query 怎样变成 SQL？ |
| [04 向量召回与混合检索](D:/AI/clower-1/clowder-note/memory/04-向量召回与混合检索.md) | embedding、vec0、RRF、候选池、hydration、raw、MCP 输出 | 向量命中如何还原成证据？过滤和截断在哪发生？ |
| [05 搜索结果重排算法](D:/AI/clower-1/clowder-note/memory/05-搜索结果重排算法.md) | authority、salience、Bayesian prior、分式时间衰减、MMR、shadow | 热门、相关、权威三种信号如何区分并组合？ |
| [06 后台摘要与 Watermark](D:/AI/clower-1/clowder-note/memory/06-后台摘要与Watermark.md) | gate、增量读取、模型文本解析、事务、carry_over、候选 | 摘要处理到哪里了？哪些操作原子，哪些只能补偿？ |
| [07 会话记忆与上下文接续](D:/AI/clower-1/clowder-note/memory/07-会话记忆与上下文接续.md) | 策略、封存、Transcript、digest、ThreadMemory、prompt 预算 | 换 session 后究竟哪段代码把哪些历史送回模型？ |
| [08 长期知识生命周期与安全](D:/AI/clower-1/clowder-note/memory/08-长期知识生命周期与安全.md) | Marker、批准、物化、重复检测、潜在冲突、canonical/backstop | 模型提出一条结论与正式知识发布之间隔着什么？ |
| [09 多知识域与记忆导航](D:/AI/clower-1/clowder-note/memory/09-多知识域与记忆导航.md) | Library、Graph、Recent、Coverage、Perspective、Profile、Event | 不同资料域如何被选择、导航、脱敏和回读？ |
| [10 召回评估与可靠性验证](D:/AI/clower-1/clowder-note/memory/10-召回评估与可靠性验证.md) | 消费归因窗口、目标匹配、MRR、shadow 对照、故障验证 | 怎样证明找到、读到、用对？能承诺什么可靠性？ |

原有补充笔记保留在：[Clowder AI 记忆检索笔记](D:/AI/clower-1/clowder-note/2026-09-12-Clowder-AI-记忆检索笔记.md)。未用本系列覆盖它。

## 二、先记住贯穿全书的三个不等式

```text
源记录已保存 ≠ 所有内容已经进入索引
索引能命中   ≠ 本次模型已经读取原文
被读取/常被用 ≠ 内容真实或本次任务成功
```

写入主线：

```text
MessageStore → listener → IndexBuilder → evidence / passage / vector
                         ↘ summary_state → 后台摘要 → segments / candidates
```

长期沉淀主线：

```text
模型建议/摘要候选 → Marker → 批准 → Markdown → 索引
```

消费主线：

```text
自动 bootstrap / MCP 主动检索 → 候选 → 原文下钻 → 本次 prompt / 工具结果
                                                   ↓
                                           工具日志 → 消费评估
```

这些是相互连接的流程，不是一个覆盖 Redis、SQLite、文件系统和模型服务的全局事务。

## 三、每篇如何使用

第一遍：顺序读 01—10，跟随同一类 thread/message/anchor 数据，先理解生产和消费如何连接。

第二遍：打开文中的源码行号，对每个算法确认输入、分支、输出和失败点。代码块会区分实际节选、简化流程与示意数据；不要把示意 ID 当真实记录。

面试准备：先选择自己真正参与的部分，再围绕以下问题复述：为什么需要它、谁调用、写了什么、后面谁读、哪里裁剪、失败如何恢复、如何验证。不要把“研究/复现/二开”说成亲自设计了仓库所有模块。

推荐专题路线：

- **检索算法**：02 → 03 → 04 → 05 → 09。
- **持续工作与长期沉淀**：01 → 06 → 07 → 08。
- **可靠性追问**：01 的异步刷新 → 06 的局部事务 → 07 的封存 → 08 的多阶段文件写入 → 10 的故障验证。

## 四、证据与验证口径

1. 本文以该提交本地源码为第一依据；注释和 Feature 文档用于背景，不自动当成运行保证。
2. 代码中的默认值不等于你当前进程的实际配置。off/shadow/on、服务启用和部署差异要另行核验。
3. 标为“静态风险/边界”的内容不等于已完成运行复现；“建议测试/优化”不等于本次已经执行或实现。
4. 第一篇的历史验证记录保留；本轮新增可复跑脚本：主流程39个命名场景、排序76项断言、导航71项断言均通过。各自使用原函数/代码片段、内存SQLite、固定时钟或统计桩，计数单位不同，不混加成集成测试总数。范围与命令见[验证入口](D:/AI/clower-1/clowder-note/memory/verification/README.md)。
5. 源码引用使用本机绝对路径与行号。切换版本后行号和行为可能变化，应重新核对；本书不是对上游最新版本的声明。
6. 目录生成时检查了所有源码/笔记链接的文件存在性、行号范围和 Markdown 围栏配对；这种结构检查不能代替逐项语义验证。

## 五、最值得警惕的“源码不等于想象”

- 普通文档主要索引标题、短摘要与关键词，不是已经实现所有正文的滑窗分块。
- FTS 渐进放宽找到非空层就停止，不自动填满 Top-K。
- RRF、词法保护、authority、消费重排、route salience 不属于一条无条件统一流程。
- MMR 使用关键词 Jaccard；时间衰减使用 `T/(T+age)`，不是通用指数公式。
- 默认摘要客户端解析自然语言并构造一个 segment；模型标签 `!` 不是人工确认的独立证明。
- Transcript 写出了偏移索引，但当前分页 reader 仍从头流式扫描。
- Marker 状态枚举、旧 MemoryGovernanceStore、profile 提案状态机并不是同一套强制状态机。
- collection 选择器不是完整租户鉴权；Perspective 的 route_identified 不代表读完正文。
- dirty 通知和多处副作用是 best-effort；不要承诺零丢失、全局原子或所有路径 exactly-once。

完整性状态：**10 篇正文与目录页已落地；各篇明确标注未执行的测试、实现边界和改进方向。**