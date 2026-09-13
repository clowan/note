# Clowder AI 记忆检索笔记

**整理日期：2026-09-12**  
**范围：**普通文档索引粒度、全文分块决策、sqlite-vec / vec0、KNN、距离计算与 SQL 查询流程。  
**说明：**基于本次讨论中核对的源码与决策记录整理，不包含新增压测结果。

---

## 一、先记住整条检索链路

```text
建索引阶段：
文档或消息 → 提取待索引文本 → Embedding → 保存向量与 anchor

查询阶段：
用户问题 → Embedding → 向量最近邻搜索
         → 返回 anchor + distance
         → 回表读取证据并过滤
         → 返回结果与原文下钻入口
```

需要区分：

> **保存了原文 ≠ 原文所有内容都进入索引 ≠ 搜索能找到 ≠ 模型已经读取。**

例如，一段知识虽然存在于文档第七节，但没有进入摘要、关键词或其他索引线索，文档级语义检索仍可能找不到它。

---

## 二、为什么普通文档没有统一采用全文分块？

### 2.1 真实决策：分阶段推进，不是认定全文分块不好

F102 的 **KD-15，记录于 2026 年 3 月 11 日**，明确提出：

- 预留 `evidence_passages` 表；
- 第一版先不填；
- 已认识到文档级摘要的检索粒度可能不足。

因此，准确理解是：

```text
先做文档级统一索引
    ↓
预留更细粒度的 passage 扩展
    ↓
后续优先补齐消息级语义召回
```

**没有找到“经过对照实验，因此否决普通文档全文分块”的记录。**

其中“1000+ docs 后 summary 不够”是当时的规划判断，不能当作实测性能临界点。

依据：[`F102：KD-15`](D:/AI/clower-1/clowder-ai/docs/features/F102-memory-adapter-refactor.md#L1268)。

### 2.2 当前普通 Markdown 的索引方式

| 内容 | 当前主要处理方式 |
|---|---|
| 文档摘要 | 提取标题之后第一个合适正文段落，限制到约 300 字符 |
| 文档向量 | 对 `title + summary` 做 embedding |
| 章节线索 | 提取章节标题作为关键词 |
| 消息原文 | 以 message / transcript passage 为更细粒度的检索对象 |

注意：

> **这里的文档 summary 主要是短摘录，不是保证覆盖全文信息的智能总结。**

源码：

- [`extractSummary()`](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/CatCafeScanner.ts#L439)
- [`extractSectionKeywords()`](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/CatCafeScanner.ts#L453)
- [`文档 embedding 输入`](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/embed-utils.ts#L33)

### 2.3 这种设计首先服务于“知识导航”

项目倾向于：

```text
找到相关知识材料 → 给出坐标 → Agent 打开原文判断
```

而不是：

```text
一次搜索直接返回可以当成最终答案的内容
```

这种方式适合查 Feature、决策、教训等具有稳定 anchor 的知识对象。后续消息级优化，则重点解决“知道讨论过，但找不到具体旧消息”的问题。

依据：[`F209：证据优先与消息级召回`](D:/AI/clower-1/clowder-ai/docs/features/F209-evidence-recall-optimization.md#L16)。

### 2.4 收益与代价

| 收益 | 代价 |
|---|---|
| 索引对象简单，便于管理文档状态和关系 | 文档深处的细节可能漏召回 |
| embedding 输入较少 | 向量无法表达未进入输入的信息 |
| 更新、去重链路相对简单 | 依赖 Agent 找到文档后继续读取 |

这些是**从实现推导的工程取舍**，不是已验证的实验收益。

两种说法不能混淆：

- **全文分块建索引，不等于把全文都注入上下文。**
- **要求读取原文，不等于不能使用分块索引。**

如果实际问题是“正文细节根本没进入候选集”，可以考虑章节级分块，并保留父文档 anchor、状态、来源和行范围。**这是改进方向，不是当前已完成的能力。**

---

## 三、vec0、KNN、HNSW 分别是什么？

### 3.1 四个层次

| 层次 | 解决的问题 | 本项目对应 |
|---|---|---|
| Embedding 模型 | 文字如何变成向量？ | 独立 embedding 服务 |
| 距离度量 | 两个向量有多接近？ | 默认 L2 距离 |
| 最近邻搜索方法 | 如何找到最近的向量？ | 当前扫描式精确 KNN |
| 数据库接入形式 | 如何通过 SQL 存取向量？ | sqlite-vec 的 `vec0` 虚拟表 |

### 3.2 vec0 不是 ANN 算法名

本次核对的依赖锁定版本是 **sqlite-vec 0.1.9**。

该版本在项目这条路径中：

- 使用 `vec0` 虚拟表；
- 扫描向量、计算距离、选择 Top-K；
- 不是 HNSW 图搜索。

**HNSW 是一种 ANN 方法；vec0 是虚拟表模块，两者不是同一层次的概念。**

### 3.3 精确 KNN 与 HNSW

| 项目 | 当前精确 KNN | HNSW |
|---|---|---|
| 核心方式 | 扫描并计算距离 | 沿多层邻近图搜索 |
| 是否需要 HNSW 图 | 否 | 是 |
| 是否存在近似搜索漏邻居 | 不因图搜索近似而漏 | 可能 |
| 主要扩展挑战 | 向量数量增大带来的计算量 | 图构建、内存和参数管理 |

注意：

> **精确最近邻，只是对已存向量和距离函数精确，不保证语义正确。**

---

## 四、Query 向量与文档向量到底怎么比较？

### 4.1 不是直接比较向量大小

正确过程：

```text
两个向量
    ↓
计算一个标量距离
    ↓
比较不同候选的距离大小
```

例如：

```text
A = [0.8, 0.6]
B = [0.6, 0.8]
```

不能根据某一维更大，就说哪个向量“整体更相关”。

应当把它们理解为多维空间里的点，查找离 query 所在位置最近的点。

### 4.2 L2 距离公式

\[
d(q,x)=\sqrt{\sum_{i=1}^{d}(q_i-x_i)^2}
\]

计算步骤：

1. 对应维度相减；
2. 差值平方；
3. 累加；
4. 开平方。

### 4.3 手算示例

以下为二维教学数据，不是真实模型输出：

```text
查询 q = [ 0.6,  0.8]

文档 A = [ 0.8,  0.6]
文档 B = [ 0.0,  1.0]
文档 C = [-0.6, -0.8]
```

| 候选 | 距离计算 | L2 距离 |
|---|---|---:|
| A | √[(-0.2)² + 0.2²] | 0.2828 |
| B | √[0.6² + (-0.2)²] | 0.6325 |
| C | √[1.2² + 1.6²] | 2.0000 |

因此：

```text
距离从小到大：A → B → C
若 k = 2：返回 A、B
```

这些向量自身的长度都是 1，但相互距离不同：

> **向量长度不等于向量间距离；归一化后仍然需要计算远近。**

---

## 五、默认 L2，为什么又和余弦排序有关？

### 5.1 数据库配置是默认 L2

当前向量表没有显式设置：

```sql
distance_metric=cosine
```

所以不能直接说“数据库配置的是余弦距离”。

依据：[`向量表定义`](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/schema.ts#L755)。

### 5.2 自带 embedding 服务会归一化

服务对截取到目标维度后的非零向量进行 L2 归一化：

```python
normalized = vector / vector_norm
```

依据：[`embedding 服务的归一化处理`](D:/AI/clower-1/clowder-ai/scripts/services/embed-api.py#L195)。

对于单位向量：

\[
\|q\|=\|x\|=1
\]

可以推导：

\[
\|q-x\|^2=2-2\cos(q,x)
\]

因此：

```text
L2 距离越小 ⇔ 余弦相似度越大
```

准确表述：

> **数据库使用 L2；当最终查询向量和库内向量都保持归一化时，L2 最近邻排序与余弦相似度排序等价。**

### 5.3 两个边界

- 更换 embedding 服务、修改维度或再次截断后，需要重新确认归一化。
- 不能直接用 `1 - L2距离` 当成余弦相似度。

单位向量条件下：

\[
\cos(q,x)=1-\frac{d_{\mathrm{L2}}^2}{2}
\]

---

## 六、SQL 如何触发向量查询？

### 6.1 项目代码

```ts
search(queryVec: Float32Array, k: number) {
  return this.db
    .prepare(`
      SELECT anchor, distance
      FROM evidence_vectors
      WHERE embedding MATCH ? AND k = ?
    `)
    .all(queryVec, k);
}
```

源码：[`VectorStore.search()`](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/VectorStore.ts#L23)。

### 6.2 参数与字段的含义

| SQL 部分 | 含义 |
|---|---|
| 第一个 `?` | 查询向量，不是中文问题 |
| 第二个 `?` | 最近邻数量 K |
| `embedding MATCH ?` | 对该向量列执行最近邻搜索 |
| `k = ?` | 向 vec0 传入结果数量参数 |
| `anchor` | 命中证据的标识 |
| `distance` | 候选与本次查询之间的距离 |

`k`、`distance` 是虚拟表模块提供的特殊隐藏列，不应当按普通业务字段理解。

尤其注意：

> **`k = 20` 是保留最近的 20 条，不是只扫描 20 条。**

`distance` 也不是文档固定属性：换一个 query，同一文档的距离就可能改变。

### 6.3 谁在执行距离计算？

```text
TypeScript 绑定参数并执行 SQL
    ↓
SQLite 调用 vec0 虚拟表模块
    ↓
模块识别 MATCH、k 等约束
    ↓
校验查询向量类型和维度
    ↓
按内部存储块计算距离、合并 Top-K
    ↓
返回 anchor + distance
```

不是 TypeScript 自己逐个计算，也不是向量扩展在现场理解自然语言。

---

## 七、为什么最终要 5 条，向量层却先取 20 条？

上层代码：

```ts
const pool = Math.min(
  Math.max(limit * 4, 20),
  100,
);

const queryVec = await embedding.embed([query]);

const nnResults = vectorStore.search(
  queryVec[0],
  pool,
);
```

如果：

```text
limit = 5
```

那么：

```text
pool = min(max(5 × 4, 20), 100)
     = 20
```

后续流程：

```text
先取得最多 20 个向量近邻
    ↓
用 anchor 回查 evidence_docs
    ↓
应用类型、状态、thread 等过滤
    ↓
按原距离顺序最多保留 5 条
```

源码：[`semanticNNSearch()`](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/SqliteEvidenceStore.ts#L1152)。

### 后置过滤的局限

假设最近的 20 条中，只有 2 条符合业务条件：

```text
向量候选：20 条
过滤后：2 条
最终返回：可能只有 2 条
```

即使第 21、22 名符合条件，也没进入这次候选池。

因此：

> **向量层精确，不代表有限候选池经过业务过滤后的结果一定完整。**

这来自项目当前“先召回、再回表过滤”的实现，不代表 sqlite-vec 本身不支持过滤。

---

## 八、与 Hybrid、RRF 的关系

```text
查询
 ├─ BM25 → 关键词候选
 └─ Embedding + vec0 KNN → 语义候选
                ↓
              RRF 融合
                ↓
          后续重排与证据返回
```

需要区分：

- **L2**：距离函数。
- **KNN**：最近邻查询。
- **HNSW**：一种近似最近邻方法。
- **RRF**：融合不同候选排行榜的方法。

**使用 RRF，不会把底层精确 KNN 变成 HNSW。**

同时，后续重排可能改变最终结果顺序，因此“L2 与余弦排序等价”只描述满足归一化条件的向量检索层。

依据：[`hybridRRFSearch()`](D:/AI/clower-1/clowder-ai/packages/api/src/domains/memory/SqliteEvidenceStore.ts#L1230)。

---

## 九、面试防错清单

| 不准确的说法 | 更准确的说法 |
|---|---|
| 项目认为全文分块不好 | 项目先做文档级索引，并明确预留细粒度扩展 |
| 全文分块会把整个文档塞进上下文 | 索引粒度与返回预算是不同问题 |
| vec0 就是一个 ANN 算法 | vec0 是 SQLite 虚拟表模块 |
| 这里用了 HNSW | 本次核对的版本和路径使用扫描式精确 KNN |
| Query 向量与文档向量直接比大小 | 先计算距离，再比较距离大小 |
| `k=20` 就只比较 20 条记录 | 搜索后保留最近的 20 条 |
| distance 是答案置信度 | distance 是向量距离 |
| 归一化后所有向量都一样 | 长度相同，不代表方向、距离相同 |
| 配置明确使用 cosine | 默认 L2；满足条件时排序等价于 cosine |
| 精确 KNN 保证检索正确 | 它不保证 embedding 语义质量或最终业务召回完整 |
| 每次查询重新向量化所有文档 | 文档向量提前保存，查询时主要计算 query 向量 |

---

## 十、可直接复述的总结

> Clowder 的普通文档主要先建立标题和简短摘要的文档级索引，后续又补了消息级 passage 语义召回。这是阶段性演进，不是认定全文分块没有价值。
>
> 语义检索时，项目先把问题转成向量，通过 sqlite-vec 的 vec0 虚拟表执行最近邻查询。vec0 不是 HNSW；本次核对的路径采用扫描式精确 KNN，默认计算 L2 距离。查询向量与存储向量不是直接比大小，而是先算出距离，再选择距离最小的候选。
>
> 项目自带 embedding 服务会归一化，因此在最终向量保持单位长度的条件下，L2 排序与余弦排序等价。向量层返回 anchor 后，系统还会回表获取证据、应用业务过滤，并给 Agent 提供继续读取原文的入口。

**总链路：**

```text
文本 → 向量
两个向量 → 距离
很多距离 → Top-K
Top-K 的 anchor → 证据
证据 → 原文核查 → 回答
```
