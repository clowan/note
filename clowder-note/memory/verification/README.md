# 记忆精读笔记：受控验证入口

> 日期：2026-09-12；源代码基线：`6868041ca`。这些脚本服务于教学例子的可复现性，不是生产性能报告。业务源码只读；结果文件写在本目录。

## 1. 三组验证不能混成一个“集成测试通过数”

| 脚本 | 本轮结果 | 实际执行范围 |
|---|---:|---|
| [memory-walkthrough-checks.mjs](D:/AI/clower-1/clowder-note/memory/verification/memory-walkthrough-checks.mjs) | 39个命名场景全部通过 | 原始TS模块、部分原始代码片段、生产schema上的内存SQLite；模型和NN为fixture |
| [05-ranking-checks.mjs](D:/AI/clower-1/clowder-note/memory/verification/05-ranking-checks.mjs) | 76项断言全部通过 | 排序函数与相关表达式；固定六份资料、时钟和统计桩 |
| [09-navigation-checks.mjs](D:/AI/clower-1/clowder-note/memory/verification/09-navigation-checks.mjs) | 71项断言全部通过 | 40项多库/导航 + 31项capsule/event；模拟store、内存SQLite、提取的源函数 |

“场景”中可能有多个断言，三个数字不要简单相加后宣传成端到端测试数量。第一篇保留的14个内存SQLite断言和此前7个纯函数断言属于前一轮记录，部分语义在本次场景中也被覆盖，不应重复计数凑成绩。

## 2. 运行环境与命令

本机实际运行：Node.js v24.14.0。脚本使用Node内置模块，无需为笔记安装项目依赖。

```powershell
node --experimental-transform-types "D:\AI\clower-1\clowder-note\memory\verification\memory-walkthrough-checks.mjs"
node "D:\AI\clower-1\clowder-note\memory\verification\05-ranking-checks.mjs"
node "D:\AI\clower-1\clowder-note\memory\verification\09-navigation-checks.mjs"
```

Node可能提示SQLite或类型转换API仍为experimental；本轮这些警告未导致检查失败。不要在旧版Node上仅凭文件存在就认定可运行，应确认支持registerHooks、node:sqlite等API。

源码漂移保护：主脚本检查23份相关源文件的LF归一化SHA-256；排序脚本检查它使用的源文件指纹；导航脚本校验基线提交和tracked源工作区。检查失败时应重新核对代码，不应简单删除护栏强行得到通过。

## 3. 结果文件

- [主流程结果](D:/AI/clower-1/clowder-note/memory/verification/results.json)
- [排序结果](D:/AI/clower-1/clowder-note/memory/verification/05-ranking-results.json)
- [导航结果](D:/AI/clower-1/clowder-note/memory/verification/09-navigation-results.json)

看生成时间、实际运行环境、通过/失败标记和每项scope，不要只截取一个绿色数字。重新运行会更新对应结果文件。

## 4. 主流程有哪些值得逐步看的例子？

### 关键词

- 同一query的三个渐进层，严格层为空时中间层只命中B。
- 新增D后，严格层非空就停止，不自动补满Top-K。
- keywords不是FTS第三列；substring路径才补回相应资料。
- 四文档覆盖度排序实际得到B/C/A/D。
- Entity边界拒绝cat→catalogue、F1→F10；与LIKE不同。
- 故意缺同步触发器时，主表和FTS count相等，MATCH仍为0。

### 向量接口

- 原始RRF累加循环在固定名次下产生可复核分数。
- JSON pair key编解码、错误key拒绝。
- revision-only变化不被当前model metadata检查判为不一致。

### 后台摘要

- 原始processThread处理205条消息，先m001—m200，再m201—m205。
- carry_over绕过体量/冷却，但不绕过quiet窗口。
- 模型null不推进、事务异常回滚、reEmbed异常不回滚已提交摘要。
- marker提交失败后candidate仍在segment中，可供补偿。
- 自然语言解析的感叹号、单段、fallback、噪声拒绝与第一条消息evidence。

### 会话与治理

- live与buffer原始合并片段；指纹缺少invocationId的局部边界。
- signals并非互斥语义分类。
- ThreadMemory裁剪与ledger更新；token计数和时间格式为明确的桩。
- bootstrap原始预算丢弃片段；不把字符桩当真实模型tokens。
- TF-IDF single-linkage形成链式簇。
- 完全相同文本仍被潜在冲突函数返回lexical_overlap。
- 旧治理状态转换表的合法/非法动作。

### 评估

- 工具报告命中数和成功解析候选数分开。
- 归因窗口是步数/时间条件的并集。
- 跨猫与下一invocation的边界；substring与失败Read的局部误归因风险。
- search文本里的thread anchor不自动变成thread targetRef。
- 双搜索一读取的ambiguous bundle、graph的双重身份。
- 一条只读shell命令消费多文档。
- 三次recall计算2/3的consumedAt3与4/9的consumedMRR。

## 5. 明确不覆盖什么？

不证明真实LLM生成质量、真实embedding近邻结果、生产better-sqlite3/vec0全栈兼容、provider完整事件契约、真实Redis持久化、多进程争用、磁盘断电恢复、完整HTTP权限体系、线上吞吐/时延或准确率提升。

Node SQLite适配器只补同步transaction和数组参数调用方式，目的在于执行所选源逻辑；不能当作把生产驱动替换掉的实现建议。

脚本初次构建期间纠正过测试端的浮点精确比较和SQLite驱动参数形式差异。最终报告为修正测试适配后重新运行的结果，业务源码没有因此改动。