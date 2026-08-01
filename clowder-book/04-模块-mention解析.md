# 04 · 模块：@mention 解析

> 这个模块只有 260 行代码，但它承载了**全项目最核心的一个设计取舍**：
> **哪些事该由代码判断，哪些事该由模型判断。**
>
> 面试里如果只能讲一个模块，我推荐讲这个 —— 它小、好讲清楚、
> 而且能自然引出"我对 AI 系统设计的理解"。

---

## 0. 30 秒电梯版

> "在聊天软件里 `@某人` 是个通知；在这个系统里 `@某个 Agent` 是**路由指令**——
> 它决定下一个被唤醒的是哪个 LLM，搞错了就是叫醒错的模型、烧掉真金白银。
>
> 它的设计是**故意做得很笨**：只认行首的 `@`，句中的一律不路由。
> 因为'请让 @opus 来 review'到底是现在叫他还是只是提到他，
> 这是语境判断，正则永远做不对。
>
> 所以路由层严格到近乎迟钝，把'这条 @ 该不该我接'完全交给模型自己判断 ——
> 模型收到之后三选一：接、退、升。
> 项目的架构文档里有句话我印象很深：
> **'系统不试图猜测用户意图；它机械地路由，让接收方 agent 自己决定接不接。'**"

---

## 1. 它解决什么问题

一条文本进来，要从里面找出"这是给谁的"。

难点在于 `@` 这个符号出现在文本里有**七八种不同的含义**：

```
@opus 帮我看下                    → 叫他（要路由）
请让 @opus 来 review              → 提到他（不路由）
@opus 说的那个方案有问题            → 讨论他（不路由）
邮箱是 user@example.com           → 根本不是 mention
`@opus`                          → 代码里的示例（不路由）
```ts
// @opus 记得改这里
```                              → 代码块里的注释（不路由）
"你可以 @opus"                    → 引号里在教用户怎么用（不路由）
https://x.com/@opus              → URL 的一部分（不路由）
@opus-47 和 @opus 是两只不同的      → 前缀冲突
**@opus** 看下                    → LLM 爱加粗（要路由）
@ 布 偶 猫 你好                    → 流式输出把 handle 切开了（要路由）
```

**十种形态，只有三种要路由。**

---

## 2. 不做会怎样

### 场景 A：句中 @ 也路由

```
用户对 codex 说："等下让 @opus 也看一眼这个"
  → opus 被立刻叫醒
  → opus 收到上下文，发现是在讨论"待会儿让我看"
  → opus 说"好的，我等着"
  → 白烧一次完整调用
```

**一天几十次这种误报，成本很可观，而且用户会觉得这系统很吵。**

### 场景 B：代码块里的 @ 也路由

Agent 写文档时经常出现：

````
用法示例：
```
@opus 帮我实现 X
```
````

如果不剥代码块，**Agent 写个文档就把自己的队友全叫醒了。**

### 场景 C：不做前缀冲突处理

```
Agent 名单里有 @opus（Opus 4.7）和 @opus-47、@opus-48
用户写：@opus-48 帮我看下
  → 按顺序匹配先命中 @opus
  → 叫醒了错的那只
```

**这不只是"叫错人"，而且违反了"同一个体不能自审"的铁律**——
如果本该 opus-48 审 opus-47 的代码，路由错了就变成自审。

### 场景 D：不处理零宽字符

这个最阴险：

```
LLM 输出："​@codex 帮我 review"
             ↑ 这里有个 U+200B（零宽空格），控制台里完全看不见
  → line[0] !== '@'
  → 判定为不是行首 mention
  → 静默丢失路由
  → 用户等了半小时发现 codex 根本没被叫醒，但日志里什么错都没有
```

**"静默失败 + 不可见原因"是最难查的一类 bug。**

---

## 3. 怎么设计的

### 3.1 六层流水线

项目的架构文档 [at-mention-routing-system.md](../clowder-ai/docs/architecture/at-mention-routing-system.md)
画了这张图【源码】：

```
 用户发送包含 @handle 的消息
            │
 ┌──────────────────────────┐
 │  1. 提及解析              │  从文本中提取 @handle
 │     (机械层)              │  去除代码块、校验 token 边界
 ├──────────────────────────┤
 │  2. 目标解析              │  @handle → catId
 │     (机械层)              │  检查可用性、推荐替代
 ├──────────────────────────┤
 │  3. 回退梯级              │  无显式 @：上次回复者 → 偏好 → 默认
 │     (机械层)              │
 ├──────────────────────────┤
 │  4. 分发调度              │  唤醒目标，串行或并行
 │     (机械层)              │  护栏：深度、去重、乒乓
 ├──────────────────────────┤
 │  5. 上下文组装            │  对话历史 + 身份 + 队友表
 │     (机械层)              │  预算：约 20 条、约 2000 token
 ├──────────────────────────┤
 │  6. LLM 判断层            │  Agent 读上下文后三选一：接/退/升
 │     (判断层)              │  "误 @ 检测"就住在这一层
 └──────────────────────────┘
```

文档里的总结【源码】：

> 第 1-5 层是**代码** —— 确定性的、可测试的、不涉及 LLM。
> 第 6 层是**猫本身** —— 非确定性的、感知上下文的、有判断力的。
>
> 核心设计洞察：**系统不试图猜测用户意图；
> 它机械地路由，让接收方 agent 自己决定接不接。**

### 3.2 规则：行首即路由

规则写在源码文件头【源码】：

```ts
/**
 * A2A Mention Detection
 * 从猫回复文本中检测对其他猫的 @mention。
 *
 * 规则 (F046 简化 — 行首即路由):
 * 1. 剥离围栏代码块 (```...```) 后再解析
 * 2. 仅匹配行首 mention（可带前导空白）→ 直接路由，无需动作词
 * 3. 长匹配优先 + token boundary，避免 `@opus-45` 误命中 `@opus`
 * 4. 过滤自调用
 * 5. F27: 返回所有匹配的猫 (上限 MAX_A2A_MENTION_TARGETS)
 * 6. 只在猫回复完整结束后解析 (由调用方保证)
 */
```

判定结果表：

```
@opus 请 review 一下              ← 路由（行首）
> @opus 你怎么看？                ← 路由（引用前缀 OK）
- @opus 检查一下测试              ← 路由（列表前缀 OK）
1. @opus 先看这个                 ← 路由（有序列表前缀 OK）
**@opus** 看下                    ← 路由（跳过 markdown 加粗）

请让 @opus 来 review              ← 不路由（句中）
邮箱是 user@example.com          ← 不路由（token 边界）
`@opus`                          ← 不路由（行内代码）
"你可以 @opus"                    ← 不路由（引号内）
```

**第 6 条"只在回复完整结束后解析"很重要**：
流式输出中途解析会把切成两半的 handle 解析错，
而且会在 Agent 还没说完的时候就派发下一个。

### 3.3 预处理：三层剥壳

**① 剥代码块**

```ts
const stripped = text.replace(/```[\s\S]*?```/g, '');
```

**② 剥引号内容**（`AgentRouter` 里的完整版）

```ts
const QUOTE_SPAN_PAIRS: readonly [string, string][] = [
  ['"', '"'], ['“', '”'], ['‘', '’'], ['「', '」'], ['『', '』'],
];
```

**中英文引号、日式括号全覆盖。**
因为引号里的 @ 通常是在"讨论"或"教用户怎么写"，不是在"调用"。

**③ 剥 URL**

```ts
const BARE_URL_PREFIX_BEFORE_MENTION_RE =
  /(?:^|[^a-z0-9_-])(?:[a-z0-9-]+\.)+[a-z0-9-]+(?:\/[^\s@]*)*\/$/i;
```

### 3.4 零宽字符处理

**这段是我觉得最能体现"多 Agent 系统独有 bug"的代码**【源码】：

```ts
/**
 * #969: Zero-width Unicode characters that LLMs may insert before mentions.
 * These are invisible in consoles but break line-start `@` detection.
 */
function isZeroWidthChar(code: number): boolean {
  return (
    code === 0x200b || // Zero Width Space
    code === 0x200c || // Zero Width Non-Joiner
    code === 0x200d || // Zero Width Joiner
    code === 0xfeff || // Zero Width No-Break Space (BOM)
    code === 0x00ad || // Soft Hyphen
    code === 0x2060    // Word Joiner
  );
}
```

配合行首扫描：

```ts
function getRouteLineStart(line: string): number | null {
  let cursor = line.match(LINE_START_MENTION_PREFIX_RE)?.[0].length ?? 0;
  // 跳过 #ideate / #execute 这类路由控制标签
  while (true) {
    while (line[cursor] === ' ' || line[cursor] === '\t') cursor++;
    const tag = line.slice(cursor).match(ROUTE_CONTROL_TAG_RE)?.[0];
    if (!tag) break;
    cursor += tag.length;
  }
  while (line[cursor] === ' ' || line[cursor] === '\t') cursor++;
  // #969: 跳过零宽字符和 markdown 加粗/斜体标记
  while (cursor < line.length && isZeroWidthChar(line.charCodeAt(cursor))) cursor++;
  while (cursor < line.length && (line[cursor] === '*' || line[cursor] === '_')) cursor++;
  while (cursor < line.length && isZeroWidthChar(line.charCodeAt(cursor))) cursor++;
  return line[cursor] === '@' ? cursor : null;
}
```

**注意零宽跳过做了两遍** —— 加粗标记前后都可能有零宽字符。

**面试里怎么用这段**：

> "这段代码我印象特别深，因为它是**只有多 Agent 系统才会遇到的 bug**。
>
> LLM 生成的文本里会混进零宽空格、零宽连接符、软连字符这些不可见字符。
> 你在控制台里看两行文本一模一样，但一个能路由一个不能 ——
> 因为 `line[0] === '@'` 判定失败了。
> 而且是**静默失败**：路由丢了，日志里什么都没有，
> 用户等半小时发现 Agent 根本没被叫醒。
>
> 这类 bug 在人类用户的系统里几乎不会出现，因为人不会打出零宽字符。
> 一旦你的输入源是 LLM，就得考虑它输出的所有不可见形态。"

### 3.5 空白修复：更狠的一招

```ts
function buildWhitespaceTolerantMentionPattern(pattern: string): RegExp {
  const interleaved = Array.from(pattern)
    .map((ch) => escapeRegExp(ch))
    .join(String.raw`\s*`);      // ← 每个字符之间允许任意空白
  return new RegExp(
    `(^|\\n)(${LINE_START_MARKDOWN_PREFIX_PATTERN})${interleaved}${HANDLE_BOUNDARY_PATTERN}`,
    'giu',
  );
}

function repairLineStartMentionWhitespace(text: string, entries: readonly MentionPatternEntry[]): string {
  let repaired = text;
  for (const entry of entries) {
    repaired = repaired.replace(
      buildWhitespaceTolerantMentionPattern(entry.pattern),
      (_match, lineStart: string, prefix: string) => `${lineStart}${prefix}${entry.pattern}`,
    );
  }
  return repaired;
}
```

**大白话**：把 `@ 布 偶 猫` 这种字符间插了空格的写法，
**先修复成 `@布偶猫`，然后再走正常解析**。

**为什么会有这种输入？**
① 流式输出的 token 边界可能把一个 handle 切开；
② 模型在中英混排时习惯性加空格。

**关键细节**：这个修复**只针对行首**（正则里有 `(^|\n)` 锚定）。
句中的 `@ opus` 不会被修复成 mention —— **严格性没有被牺牲。**

**这个设计我觉得很聪明**：它在"容错"和"严格"之间划了一条清晰的线 ——
**只在已经确定要路由的位置容错，不在判断要不要路由时容错。**

### 3.6 匹配：长匹配优先

```ts
const entries: MentionPatternEntry[] = [];
for (const [id, config] of Object.entries(allConfigs)) {
  if (currentCatId && id === currentCatId) continue;   // 过滤自调用
  for (const pattern of config.mentionPatterns) {
    entries.push({ catId: id as CatId, pattern: pattern.toLowerCase() });
  }
}
entries.sort((a, b) => b.pattern.length - a.pattern.length);   // ← 长的排前面
```

右边界检查：

```ts
const charAfter = segment[entry.pattern.length];
const isBoundary = !charAfter
  || TOKEN_BOUNDARY_RE.test(charAfter)
  || !HANDLE_CONTINUATION_RE.test(charAfter);
if (!isBoundary) continue;
```

`TOKEN_BOUNDARY_RE` 中英文标点全覆盖：

```ts
export const TOKEN_BOUNDARY_RE =
  /[\s,.:;!?()[\]{}<>，。！？、：；（）【】《》「」『』〈〉]/;
```

### 3.7 可用性检查放在"匹配时"而不是"建表时"

**这是个容易忽略但很重要的设计**【源码】：

```ts
// F182 KD-10: include ALL cats (including disabled) so patterns participate in matching;
// availability is checked at match-time via resolveCatTarget, not here.
```

```ts
const resolved = resolveCatTarget(entry.catId);
if ('error' in resolved) {
  if (!seen.has(entry.catId)) {
    seen.add(entry.catId);
    routing_warnings.push(resolved.error);   // ← 变成警告，不是静默丢弃
  }
} else if (!seen.has(entry.catId)) {
  seen.add(entry.catId);
  found.push(entry.catId);
}
```

**为什么要这么绕？** 对比一下两种做法：

```
❌ 建表时就过滤掉停用的 Agent：
   用户输入：@gemini 帮我看下      （gemini 当前没额度）
     → @gemini 根本不在 pattern 表里
       → 解析结果：没有 mention
         → 走回退梯级，路由给了默认 Agent
           → 用户看到布偶猫回复，完全不知道 gemini 被跳过了

✅ 匹配时才检查：
   → 命中 @gemini
     → resolveCatTarget 返回 error
       → routing_warnings 带上"gemini 当前不可用"
         → 用户看到明确提示
```

**"静默降级是多 Agent 系统里最糟糕的用户体验。"**
这个改动（F182 KD-10）就是在消灭它。

这条原则在项目里出现了好几次（见 [模块 11](11-模块-跨模型互审.md) 的
"不可用的 reviewer 也要列出来"），可以在面试里作为一条通用原则讲。

### 3.8 安全上限

```ts
/** Max number of distinct cats a single message can @mention (F27 safety limit) */
const MAX_A2A_MENTION_TARGETS = 2;

/** Max A2A chain depth, configurable via env (read at call time for hot-reload) */
export function getMaxA2ADepth(): number {
  return Number(process.env.MAX_A2A_DEPTH) || 15;
}
```

**`read at call time for hot-reload` 这个注释值得讲**：
不缓存、每次现读，这样运维可以在链跑飞的时候改环境变量立刻收紧，不用重启。

### 3.9 影子检测：不路由，但提醒

行首才路由，那句中的 `@` 完全忽略吗？不 —— 有一层"影子检测"【源码】：

```ts
/**
 * #417: Detect inline @mentions paired with action words — missed handoff candidates.
 * Used for write-side feedback only, NOT for routing.
 *
 * Conditions (all must hold):
 *  1. @pattern appears mid-line (not at line start)
 *  2. Action keyword immediately adjacent to @mention (proximity-based, not whole-line)
 *  3. Not inside a fenced code block or blockquote
 *  4. Target cat was not already routed via line-start mention
 *  5. Not a self-mention
 */
```

动作词识别分 @ 前和 @ 后两套正则，里面塞满了中文语言学：

```ts
export const BEFORE_HANDOFF_RE = /(?:ready\s+for|交接给?|转给|(?<![邀申敬])请|帮)\s*$/i;

export const AFTER_HANDOFF_RE =
  /^\s*(?:(?:review|check|fix|merge)(?![a-z])|(?:确认|处理|来处理|来看)(?![过了完好掉])|看一?下|帮忙|请(?![教示假求问]))/i;
```

**四种语言学手法，面试里讲一两个就够：**

| 手法 | 例子 | 排除的误报 |
|------|------|-----------|
| 负向后顾 `(?<![邀申敬])请` | "**请** @opus 看" 算 / "邀**请** @opus" 不算 | 邀请、申请、敬请 |
| 负向前瞻 `(?![过了完好掉])` | "@opus **确认**一下" 算 / "@opus **确认过**了" 不算 | 已完成的陈述 |
| 负向前瞻 `(?![a-z])` | "@opus **review**" 算 / "@opus **reviewed** it" 不算 | 英文过去式 |
| 负向前瞻 `请(?![教示假求问])` | "**请** @opus 看" 算 / "**请教** @opus" 不算 | 请教、请示、请假 |

**"确认" vs "确认过"、"review" vs "reviewed"** ——
一个是祈使句（在派活），一个是陈述句（在描述）。**祈使才是交接。**

这一层的产出只用于**写侧反馈**（提示作者"你是不是想交接给 codex？"），
不进路由。判断权还在人和模型手里。

### 3.10 两个"过早退出"的 bug

```ts
// Scan ALL occurrences of this pattern in the line (not just first indexOf hit).
// Fixes: "之前 @codex 提过意见，现在 Ready for @codex review" 必须找到第二个
let searchFrom = 0;
while (searchFrom < normalized.length) {
  const idx = normalized.indexOf(entry.pattern, searchFrom);
  if (idx < 0) break;
  searchFrom = idx + 1;
  // ...
}
```

```ts
// Already routed via line-start: skip this entry but keep scanning other cats on same line.
if (routedSet.has(entry.catId)) break;
```

**两个 bug 的共同形态是：过早退出循环。**

- 同一行里同一个 handle 出现两次，第一次是叙述、第二次才是交接
- 同一行里有已路由的 Agent 和未路由的 Agent，不能因为第一个命中就整行跳过

**通用教训**【推断】：
"在多目标场景下，'找到一个就 break'几乎总是 bug。"
这句话可以在面试里当经验讲。

---

## 4. 为什么这么设计

### 决策 A：为什么只认行首（而不是"更聪明"）

**反过来想**：如果路由层想聪明一点会怎样？

```
"请让 @opus 来 review"
  → 聪明的路由：识别出"请…来 review"是请求介入 → 路由
  → 但也可能是：用户跟 codex 说"待会儿让 opus 看看" → 不该路由

"@opus 说的那个方案有问题"
  → 聪明的路由：@opus 在句首 → 路由
  → 但实际上：用户在跟第三方讨论 opus 的观点 → 不该路由
```

**语境判断天然是模型的活，不是正则的活。**

路由层一旦开始猜，就会陷入无穷的误报修补循环 ——
每加一条规则解决一类误报，就引入一类新的漏报。
而且每次误报都是真金白银。

**所以项目的选择是：路由层严格到近乎迟钝，把模糊全部留给模型。**

### 决策 B：这个取舍的收益和代价

| | 内容 |
|---|---|
| **收益 1** | 路由层可以被单元测试完全钉死（纯函数、无 LLM） |
| **收益 2** | 误路由的锅归模型不归代码 —— 而模型恰好擅长"这事该不该我干" |
| **收益 3** | 行为可预测：用户学会"想路由就放行首"之后，再也不会意外 |
| **代价 1** | 不保证。模型判断错了没有代码兜底 |
| **代价 2** | 用户要学一条规则（行首）—— 但这条规则极简单 |
| **代价 3** | 漏报变多：句中的真交接意图会被忽略 → 所以补了影子检测 |

**面试里一定要把代价说出来**，尤其代价 1。

### 决策 C：为什么"匹配时检查可用性"

见 §3.7。**一句话总结：可见的缺席胜过静默的消失。**

---

## 5. 否掉了哪些方案

### 方案一：句中 @ + 动作词也路由（曾经做过，后来退回）

**【源码】项目文档明确记录了：**

> 早期版本尝试过检测句中的"动作提及"（如"让 @opus 去..."），
> 但这带来了误报和歧义。当前设计**故意做得严格**：
> 你想路由到一只猫，就把 `@handle` 放在行首。简单、可预测、零歧义。

**这是一次真实的回退**。而且它没有完全丢掉 ——
那套动作词识别的逻辑现在活在"影子检测"里（§3.9），
只是**从路由降级成了提醒**。

**面试里这段特别值**：

> "他们早期做过句中检测 —— 用动作词判断'让 @opus 去做 X'是不是交接。
> 后来因为误报和歧义退回了，规则简化成'只认行首'。
>
> 但有意思的是那套动作词识别没删，而是**降级成了写侧提醒**：
> 检测到句中 @ 配动作词，就提示作者'你是不是想交接给他？'，
> 但不实际路由。
>
> 我觉得这个处理很成熟 —— **不是简单地删掉复杂逻辑，
> 而是把它从'决策'降级成'建议'**。
> 判断权交回给人，但信息不丢。"

### 方案二：用 LLM 做 mention 解析

【推断】项目没有记录否掉这个方案，但从设计上明显没选。我推测的理由：

| 理由 | 说明 |
|------|------|
| 成本 | 每条消息多一次调用，而消息量很大 |
| 延迟 | 路由是关键路径，多几百毫秒直接影响体感 |
| 不可测 | 路由结果不确定，回归测试没法写 |
| 循环依赖 | 用 LLM 决定叫醒哪个 LLM，谁来决定叫醒判断用的那个 |

**最后一条是根本原因**：路由必须有一个确定性的底座。

**注意这和我在 [模块 03](03-模块-路由与编排.md) §6.1 提的
"意图判断交给模型"不矛盾** —— 那是"串行还是并行"的判断，
可以异步、可以有默认值兜底；而"@ 是不是 mention"在关键路径上，必须确定。

### 方案三：单条消息不限扇出数

【源码】现在是 `MAX_A2A_MENTION_TARGETS = 2`，注释标了 `F27 safety limit`。

【推断】没限制会怎样：`@all` 之后每只 Agent 又 @ 出 3 只，
扇出 × 深度就没有上界了。**2 × 15 是一个能算出来的最坏成本，
这个可计算性本身就是价值。**

---

## 6. 如果重新设计

【推断】以下全是我的方案。

### 6.1 主路径改成结构化交接，文本扫描降级为兜底

**现在的根本问题**：Agent 的输出格式是它自己控制的，系统只能猜。
为此打的补丁清单：

```
isZeroWidthChar()                    LLM 插入不可见字符
repairLineStartMentionWhitespace()   handle 被空格切开
跳过 markdown 加粗                    模型爱给 @ 加粗
剥代码块 / 引号 / URL                 各种误报
长匹配优先 + token 边界               前缀冲突
两个"过早退出"的 bug                  扫描逻辑
```

**这六类补丁全部来自"从自由文本里提取结构"。**

**我的方案**：

```
Agent 想交接
  ├─ 主路径：调 MCP 工具
  │   handoff({ to: 'codex', reason: '...', effectClass: 'assign_work' })
  │   → 结构化，零解析问题
  │   → 能带 effect class（FYI / 协调 / 调查 / 派活）
  │   → 能带结构化的交接理由
  └─ 兜底：文本里写行首 @codex
      → 保留现在的全套解析（因为不是所有 CLI 都可靠地调工具）
```

**项目其实已经有这条路了** —— `F055 A2A MCP Structured Routing`，
但 ROADMAP 里状态还是 `spec`（没做）。**所以我这个方案和他们的路线图一致。**

**为什么不能只要结构化？**
纯文本输出的 Antigravity CLI 调工具不可靠，文本兜底必须保留。

**收益**：主路径不用处理那六类脏活；而且 `effectClass` 能让接收方
知道"这是通知我还是派我活"（现在这个信息只在跨帖场景有）。

### 6.2 给"漏路由"加显式反馈闸门

**现在的问题**：如果 Agent 想交接但写成了句中形式，路由就丢了。
影子检测会提醒，但**提醒是给作者的，接收方永远不知道有人想找它。**

**我的方案**：加一个"疑似漏交接"的可见状态：

```
检测到句中 @ + 动作词，且目标未被路由
  → 在对话流里插一条系统提示（用户可见）：
    "检测到可能的交接意图：@codex（未路由）。
     [立即路由] [忽略]"
  → 用户一键补救
```

**为什么这个改动有价值？**
现在的失败是静默的 —— 和 §3.7 要消灭的"静默降级"是同一类问题，
只是这次静默的是"漏路由"而不是"Agent 不可用"。
**同一个原则应该一致地应用。**

### 6.3 Handle 命名空间收紧

**现在的问题**：`mentionPatterns` 是自由字符串数组，
Agent 可以注册 `@opus`、`@布偶猫`、`@ragdoll`、`@claude-opus-4-6`。
于是要处理前缀冲突、同名消歧、长匹配优先。

**我的方案**：分两类 handle，规则不同：

```
主 handle（唯一、机器友好）：
  @opus-47   格式受限：^[a-z][a-z0-9-]{1,20}$
  → 保证不会有前缀冲突（禁止一个是另一个的前缀）
  → 注册时校验，冲突直接拒绝

别名（人类友好、可能歧义）：
  @布偶猫 @ragdoll
  → 允许歧义，但歧义时不路由，而是回一条"你是指 @opus-47 还是 @opus-48？"
```

**收益**：把"歧义"从"猜一个"改成"问一下"。
现在的 `isDefaultVariant` 机制（同名时只有默认变体能用短名）
本质上是在猜，猜错了就叫醒错的 Agent。

**代价**：多一轮交互。但对比"叫醒错的 Agent 烧一次调用"，问一句更便宜。

### 6.4 我不会改的

| 我原本的想法 | 为什么放弃 |
|------------|-----------|
| 用 LLM 解析 mention | 循环依赖 + 关键路径延迟 + 不可测（见 §5 方案二） |
| 放宽到句中路由 | 项目已经试过并退回了，我没有比他们更好的理由 |
| 提高扇出上限到 3~5 | 2 × 15 的可计算性有价值；真要多目标应该用结构化的 multi-mention |
| 把影子检测也删掉 | 它是漏报的补偿；删了漏报就完全不可见了 |

---

## 7. 和其他模块怎么咬合

### 上游（谁给它文本）

```
① 用户消息        → AgentRouter 解析显式 @
② Agent 回复文本   → route-serial 解析 A2A 交接（本模块主战场）
③ 外部平台消息     → infrastructure/connectors/mention-parser.ts（另一套解析器）
```

**注意 ③ 是独立的解析器**：飞书/企微的 @ 格式和文本 @ 不一样
（它们有结构化的 mention 字段），所以单独一套。

### 下游（解析结果给谁）

```
parseA2AMentions() → CatId[]
     │
     ├─ resolveRoutingDecisions()    护栏（模块 03）
     │    └─ worklist.push()
     │
     ├─ routing_warnings             → 前端展示"gemini 不可用"
     │
     └─ detectInlineActionMentions() → 写侧提醒（不路由）
```

### 依赖的共享状态

```
catRegistry.getAllConfigs()
  └─ mentionPatterns    ← 从 .cat-cafe/cat-catalog.json 读
       ↑
       同一份数据也被：
       ├─ SystemPromptBuilder 用来生成"你可以 @ 谁"（模块 07 的 S4 段）
       └─ 队友名册的 @mention 列（模块 07 的 S5 段）
```

**这个咬合点很重要，面试可以讲**：

`SystemPromptBuilder` 里有一段专门保证**不生成 registry 里不存在的 handle**【源码】：

```ts
function pickDisplayNameMention(config: CatConfig): string | null {
  // Do not synthesize @displayName unless the registry actually routes it.
  // Example: opus-47 shares displayName="布偶猫" but only registers @opus-47.
  return config.mentionPatterns.find((p) => p.toLowerCase() === expected) ?? null;
}
```

**大白话**：如果 prompt 告诉 Agent"你可以用 `@布偶猫`"，
但 registry 只注册了 `@opus-47`，那 Agent 写的 @ 会路由失败。

**所以"prompt 里能 @ 谁"和"解析器认哪些 handle"必须是同一份真相源。**
这是解析模块和身份模块之间最关键的一根线。

### 一个反向咬合：解析结果影响身份注入

```
parseA2AMentions 发现是 codex @ 的 opus
  → 路由把 directMessageFrom = 'codex' 传给 prompt 层
    → SystemPromptBuilder 注入 d2-direct-message.md
      → "你收到 codex 的直接消息，必须回复它（不是回复用户）"
        → 而且如果 codex 和 opus 同品种（同模型家族）
          → 额外注入 d3-same-breed-warning.md
             "⚠️ 对方是另一个独立分身，不是你的旧版或新版"
```

**这条链解释了为什么解析要区分"谁 @ 的"而不只是"@ 了谁"。**

---

## 8. 面试怎么讲

### 30 秒版

见 §0。

### 3 分钟版

> "这个模块只有 260 行，但它承载了全项目最核心的取舍。
>
> 规则是**只认行首的 `@`**。句中的 `@` 一律不路由。
> 因为'请让 @opus 来 review'到底是现在叫他还是只是提到他，
> 这是语境判断，正则做不对。
>
> 他们的架构文档把流水线画成六层：前五层是代码 ——
> 提及解析、目标解析、回退梯级、分发调度、上下文组装，全都是确定性的、
> 可测试的、不涉及 LLM；第六层是 Agent 本身 ——
> 读完上下文之后三选一：接、退、升。
> 文档里的原话是'系统不试图猜测用户意图；它机械地路由，
> 让接收方 agent 自己决定接不接'。
>
> 而且**他们早期真的试过更聪明的版本** —— 用动作词检测句中交接，
> 后来因为误报退回了。但那套逻辑没删，
> 降级成了'写侧提醒'：检测到句中 @ 配动作词就提示作者'你是不是想交接'，
> 不实际路由。我觉得这个处理很成熟 ——
> 不是删掉复杂逻辑，而是把它从'决策'降级成'建议'。
>
> 实现层面有个细节我印象很深：它专门跳过零宽 Unicode 字符。
> 因为 LLM 输出里会混进零宽空格，控制台看不见，
> 但 `line[0] === '@'` 判定失败 → 路由静默丢失。
> 这是**只有输入源是 LLM 才会遇到的 bug**。"

### 常见追问

**Q：为什么不用 LLM 来判断这个 @ 该不该路由？**

> "四个理由，最根本的是**循环依赖** ——
> 用 LLM 决定叫醒哪个 LLM，那谁来决定叫醒判断用的那个？
> 路由必须有一个确定性的底座。
>
> 另外三个是工程性的：成本（消息量大，每条多一次调用）、
> 延迟（路由在关键路径上）、不可测（结果不确定，回归测试没法写）。
>
> 不过我认为**串并判断**（并行还是串行）应该交给模型 ——
> 那个不在关键路径上，可以有默认值兜底，而且它确实是语义判断。
> 现在它用的是机械规则'≥2 只就并行'，
> 遇到'@A 实现，做完让 @B review'这种明显串行的语义会判错。"

**Q：如果 Agent 就是不按规则写 @，怎么办？**

> "这是这个设计的真实代价 —— **它不保证**。
>
> 现在的应对是三层：
> 一，prompt 里教（L0 里有'@ 是路由指令'，还有 handoff 决策树模板）；
> 二，空白修复容错（`@ 布 偶 猫` 会被修成 `@布偶猫`，但只在行首）；
> 三，影子检测提醒作者。
>
> 但我认为根本的解法是**结构化交接** ——
> 让 Agent 调一个 `handoff()` MCP 工具而不是写文本。
> 他们其实有这个 feature（F055），但 ROADMAP 里还是 spec 状态。
> 我会把它做成主路径，文本扫描降级为兜底 ——
> 因为现在为了从自由文本里提取结构，打了至少六类补丁：
> 零宽字符、空白修复、markdown 加粗、代码块剥离、引号剥离、前缀冲突。
> 这六类脏活全部来自'猜 Agent 想干什么'。"

**Q：`@opus` 和 `@opus-47` 怎么区分？**

> "长匹配优先 —— pattern 表按长度降序排，长的先匹配。
> 加上右边界检查：`@opus` 命中后要看下一个字符是不是 token 边界，
> `@opus-47` 里 `@opus` 后面是 `-`，不是边界，所以不算命中。
>
> 但我觉得这个方案是在**补救一个本该在注册时避免的问题**。
> 我会在注册 handle 时就禁止前缀关系 ——
> 主 handle 必须唯一且互不为前缀，格式受限；
> 人类友好的别名允许歧义，但歧义时不猜，
> 而是回一句'你是指 @opus-47 还是 @opus-48'。
>
> 现在的 `isDefaultVariant` 机制（同名时只有默认变体能用短名）本质上是在猜，
> 猜错了就叫醒错的 Agent —— 而且这会破坏'同一个体不能自审'的铁律。"

---

## 9. 本模块要点

| 要点 | 内容 |
|------|------|
| **核心取舍** | 前五层机械（代码），第六层判断（模型） |
| **行首即路由** | 句中不路由；是踩过坑之后的收紧 |
| **早期试过更聪明** | 动作词检测句中交接 → 误报 → 退回 → 降级成写侧提醒 |
| **零宽字符** | LLM 输出的不可见字符会让路由静默丢失 |
| **空白修复** | 只在行首容错，判断要不要路由时不容错 |
| **长匹配优先 + 右边界** | 防 `@opus-47` 被 `@opus` 截胡 |
| **可用性匹配时查** | 停用的 Agent 也进 pattern 表，命中给警告不静默丢 |
| **2 × 15** | 扇出 × 深度 = 可计算的最坏成本 |
| **影子检测的语言学** | 负向后顾/前瞻区分祈使句和陈述句 |
| **别过早 break** | 多目标扫描里"找到一个就退出"几乎总是 bug |
| **我的改进** | 结构化交接为主路径 / 漏路由要可见 / handle 命名空间收紧 |

---

→ [05 调用生命周期与队列](05-模块-调用生命周期.md)
