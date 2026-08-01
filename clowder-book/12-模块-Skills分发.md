# 12 · 模块：Skills 分发

> Skills 看起来是 prompt 工程，实际上是**配置分发 + 分布式一致性**。
>
> 一份源，symlink 到四个客户端目录，然后需要三层漂移检测、
> 七种异常分类、调谐循环、并发锁 —— 这套东西的形状和
> Kubernetes 的 reconcile loop 是一样的。
>
> 面试里讲这个模块的价值在于：**它能证明你会把 AI 场景的问题
> 映射到经典的工程问题上。**

---

## 0. 30 秒电梯版

> "48 个 Skill，每个是一个目录 + 一份 `SKILL.md`，
> 描述统一用三段式：`Use when` / `Not for` / `Output`——
> `Not for` 那段是防模型过度加载。
>
> 分发靠 symlink：一份源，链到 `~/.claude/skills/`、
> `~/.codex/skills/`、`~/.gemini/skills/`、`~/.kimi/skills/`。
> 【ADR】而且他们明确否掉了两个方案：
> 复制文件（会版本漂移）和目录级单个 symlink
> （因为**部分客户端不递归扫子目录，会出现"已链接但不可加载"的隐性故障**）。
>
> 然后就是配置分发的经典问题：symlink 会被破坏、
> 会被同名目录占用、会配置里启用了但没挂上。
> 所以有一个**三层漂移检测**：源 ↔ 全局配置 ↔ 项目配置 ↔ 挂载点，
> **只比相邻层**（跨层比会归因不清），七种异常各有名字和现成的中文提示。"

---

## 1. 它解决什么问题

### 问题一：方法论放哪儿

一只 Agent 要会 TDD、会 debug、会写 review 请求、会做 PPT、会写 skill。

```
全塞进 system prompt
  → 48 个 skill 的内容，几十万 token
    → 直接爆掉

不塞
  → Agent 不知道有这些方法论
    → 每次都从零开始
```

**答案是"按需加载"** —— 方法论存磁盘，Agent 需要时才读。

### 问题二：四种 CLI 的 Skills 支持完全不同

| CLI | Skills 支持 | 目录 |
|-----|-----------|------|
| Claude Code | 自动触发 | `~/.claude/skills/` |
| Codex CLI | **手动加载**（Agent 自己 `cat` 文件） | `~/.codex/skills/` |
| Gemini | 自动触发 | `~/.gemini/skills/` |
| Kimi | — | `~/.kimi/skills/` |
| opencode | 读 Claude 的目录 | （自动覆盖） |

**同一个 `tdd` skill，怎么让四端都能用、还不会各自漂移？**

### 问题三：漂移

```
用户手动删了一个 symlink
另一个工具在 ~/.claude/skills/tdd 建了个真目录
配置里启用了但忘了挂
挂上了但配置里已经删了
项目配置和全局配置不一致
```

**五种漂移形态，每种的修法不同。**

---

## 2. 不做会怎样

### 场景 A：不做统一分发，各端各一份

```
cat-cafe-skills/tdd/SKILL.md    改了一句
~/.claude/skills/tdd/SKILL.md   跟着改了
~/.codex/skills/tdd/SKILL.md    忘了改
~/.gemini/skills/tdd/SKILL.md   改错了
```

**结果：三只 Agent 对同一个流程有三种理解。**
而且这种不一致极难发现 —— 因为它表现为"某只 Agent 行为怪怪的"。

### 场景 B：目录级 symlink

【ADR】ADR-009 明确记录了这个方案被否的原因：

```
~/.claude/skills → cat-cafe-skills/     （一个 symlink 链整个目录）
  → 部分客户端不递归扫子目录
    → 链接存在，但 skill 加载不到
      → "已链接但不可加载"的隐性故障
```

**"隐性故障"** —— 你检查 symlink 存在、内容正确，
但 Agent 就是不加载。**最难查的那种。**

### 场景 C：不做漂移检测

```
某天 symlink 坏了
  → Agent 加载不到 tdd skill
    → 它照常干活，只是不写测试了
      → 没有任何报错
        → 一周后你发现新代码都没测试
```

**Skill 缺失是静默失败** ——
Agent 不会说"我找不到 tdd skill"，它会直接按自己的默认方式干。

---

## 3. 怎么设计的

### 3.1 Skill 的形态

`cat-cafe-skills/` 下 48 个 skill 目录 + 一个共享的 `refs/`。

每个 skill 一份 `SKILL.md`，头部是三段式描述：

```yaml
---
name: tdd
description: >
  Red-Green-Refactor 测试驱动开发纪律。
  Use when: 写新功能代码、修 bug、任何实现工作。
  Not for: 纯文档、纯调研、已有充分测试的 trivial 改动。
  Output: 失败测试 → 最小实现 → 重构，全程有测试保护。
triggers:
  - "写代码"
  - "test first"
  - "TDD"
  - "红绿重构"
---
```

**`Not for` 这段是关键**，它防的是**过度加载**：
写个文档也要 TDD 一下，改个 typo 也要先写测试。

**面试话术**：

> "他们的 skill 描述统一用三段式：`Use when` / `Not for` / `Output`。
>
> `Not for` 我觉得是最容易被忽略但最有用的一段 ——
> 因为模型倾向于**过度加载**。
> 你告诉它有个 TDD skill，它写文档时也会想'我是不是该先写测试'。
> 明确写出'不适用于纯文档、纯调研、trivial 改动'能挡住这个。"

### 3.2 内容写法：预判模型的合理化路径

**这是我觉得这个模块最有 prompt 工程价值的地方。**

`tdd/SKILL.md` 正文不是步骤清单，而是**为什么 + 怎么做 + 常见异议**：

```markdown
**铁律：没有失败的测试，就没有实现代码。**

### 为什么顺序绝对不能反？（4 个常见异议的反驳）

| 异议 | 真相 |
|------|------|
| "写完再补测试，也能验证" | 测试写在实现后会立即通过——你永远不知道它是否真的在测你要的东西 |
| "我手工测了所有 case" | 手工测试没有记录、不能重跑、下次改动时你会忘了测什么 |
| "删掉 X 小时的工作太浪费" | 沉没成本谬误。留着无法信任的代码才是浪费 |
| "TDD 是教条，务实应该灵活" | TDD 本身就是务实的——它比事后调试快，是真正的捷径 |
```

**为什么要写"异议反驳"？**

```
模型会自己说服自己跳过步骤：
  "这个改动很小，直接写实现更高效"
     ↑ 这正是第三条异议

预先写好反驳 → 模型遇到这个念头时能认出来
```

**这是给 LLM 写文档的一个重要技巧：预判它的合理化路径，提前堵住。**

还有决策点：

```markdown
**关键决策点**：
- RED 阶段测试立即通过？→ 你在测已有行为，修测试
- RED 阶段报错而非失败？→ 修错误直到"正确地失败"
- GREEN 阶段其他测试挂了？→ 立即修，不要继续
- REFACTOR 后测试变红？→ 撤销 refactor，重来
```

**"正确地失败"** —— 测试因为 typo 报错和因为功能没实现而失败，是两回事。

### 3.3 路由：manifest 是单一真相源

`manifest.yaml` 头部：

```yaml
# Clowder AI Skills Manifest — 路由单一真相源
# 所有 skill 的触发规则、排除条件、产出契约、skill-to-skill next 链在此定义。
# SOP stage / suggested skill / hard rules / pitfalls 的机器真相源是 sop-definitions/development.yaml。
# CLAUDE.md / AGENTS.md / GEMINI.md 的路由表当前手工同步（Wave 2 计划自动生成）。
# lint 规则：pnpm check:skills
```

**注意它明确划了两个真相源的边界：**

```
cat-cafe-skills/manifest.yaml       → skill 的触发与路由
sop-definitions/development.yaml    → SOP 阶段与规则
```

每个条目：

```yaml
feat-lifecycle:
  category: "开发流程"
  description: >
    Use when: 开个新功能、new feature、F0xx、立项、feature 完成…
    Not for: 代码实现、review、merge（那些有专门的 skill）。
    Output: Feature 聚合文件 + BACKLOG 索引 + 真相源同步。
  triggers: ["开个新功能", "new feature", "F0xx", "立项", …]
  not_for: ["写代码", "review", "merge"]
  output: "Feature aggregate file / truth-source sync"
  next: ["writing-plans"]          # ← skill 之间的链
  sop_step: null
  merged_from: ["feat-kickoff", "feat-discussion", "feat-completion"]
```

**两个字段值得注意：**

**`next` —— skill 之间有链，形成工作流：**

```
feat-lifecycle → Design Gate → writing-plans → worktree → tdd
    → quality-gate → [fresh-context-review] → request-review → receive-review
    → merge-gate → feat-lifecycle(完成)
```

**`merged_from` —— 记录合并历史。**
曾经有三个 skill 合成了一个。保留这个字段是为了让旧引用还能被追溯。

### 3.4 BOOTSTRAP.md：加载入口和它的语气

`BOOTSTRAP.md` 是喂给模型的路由表。开头和结尾各有一段很硬的话：

```
<EXTREMELY_IMPORTANT>
你已加载 Cat Café Skills。路由规则定义在 `cat-cafe-skills/manifest.yaml`。
...
## 关键规则

1. **Skill 适用就必须加载，没有选择**
2. **完整流程见 `docs/SOP.md`；机器真相源见 `sop-definitions/development.yaml`**
3. **三条铁律**：Redis production Redis (sacred) / 同一个体不能 self-review / 不能冒充其他猫
4. **共用规则在 `refs/shared-rules.md`**（不在各猫文件里重复）
5. **Reviewer 选择是动态匹配**，禁止写死"reviewer 是Ragdoll"
...
IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.
</EXTREMELY_IMPORTANT>
```

**"YOU DO NOT HAVE A CHOICE" 全大写英文写在中文文档末尾** ——
这是很直白的 prompt engineering：模型对全大写强调句的服从度更高。

**第 5 条也有意思**：禁止写死 reviewer。
这是在防模型把 [模块 11](11-模块-跨模型互审.md) 的动态匹配退化成硬编码 ——
它见过太多次"Ragdoll 做 reviewer"，就会开始假设那是规则。

### 3.5 `refs/` 共享层

```
refs/shared-rules.md              三猫共用协作规则（单一真相源，L0 的来源）
refs/decision-matrix.md           决策权漏斗矩阵
refs/commit-signatures.md         签名表 + @ 句柄
refs/pr-template.md               PR 模板
refs/review-request-template.md   Review 请求信模板
refs/mcp-callbacks.md             MCP callback surface 映射
refs/rich-blocks.md               Rich block 创建指南
refs/ppt-density-playbook.md      PPT 密度填充手法（9 种手段 + 量化门禁）
...
```

**"共用规则在 refs/，不在各猫文件里重复"这条规则本身就写在 BOOTSTRAP 里。**

[模块 07](07-模块-身份注入.md) 的 L0 治理块就是从
`refs/shared-rules.md` 编译出来的 —— **这是两个模块的接缝。**

### 3.6 分发：一源四链

```
cat-cafe-skills/tdd/  ←── ~/.claude/skills/tdd
                      ←── ~/.codex/skills/tdd
                      ←── ~/.gemini/skills/tdd
                      ←── ~/.kimi/skills/tdd
```

```ts
export const STANDARD_MOUNT_POINT_IDS: readonly StandardMountPointId[] =
  ['claude', 'codex', 'gemini', 'kimi'] as const;
```

**项目级优先，全局兜底：**

```ts
const candidatesFor = (id: SkillMountPointKey): string[] => [
  ...new Set([
    join(projectRoot, rules.mountPoints[id].path),        // 项目级
    join(home, DEFAULT_MOUNT_RULES.mountPoints[id].path), // 全局
  ]),
];
```

**和 [模块 08](08-模块-会话与抗压缩.md) 里 hook 的
用户级/项目级分层是同构的。**

**自定义挂载点：**

```ts
/**
 * F228: A skill mount target — ... adds support for
 * custom paths (ACP/A2A/unknown clients) via `MountRules.customPaths`.
 */
function resolveCustomMountPath(projectRoot: string, path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(home, path.slice(2));
  if (isAbsolute(path)) return path;
  return join(projectRoot, path);
}
```

**四个硬编码挂载点不够用**（ACP/A2A/未知客户端），所以支持配置任意路径。
注意 `~` 展开同时处理了 `~/` 和 `~\`（Windows）。

### 3.7 三层漂移检测

```
/**
 * Drift Detector — F228 Three-Layer Model
 *
 * Three data layers, each compared only to its adjacent:
 *
 *   cat-cafe-skills/ source
 *           ↕ checkGlobal (registration: source ↔ global config)
 *   Global capabilities.json
 *           ↕ checkProject (config sync: global ↔ project config)
 *   Project capabilities.json (mountPaths) ↔ mount point symlinks
 */
```

**"each compared only to its adjacent" —— 只比相邻层。**

**这是个很重要的约束，面试里值得讲：**

> "漂移检测他们做了三层，而且明确规定**只比相邻层，不跨层比**。
>
> 为什么？因为跨层比较会产生**归因不清**的报告。
> 如果直接比'源'和'symlink'，报出来'tdd 没挂上'——
> 到底是因为没在全局配置里注册？还是项目里没启用？还是 symlink 坏了？
> 三种原因三种修法，但报告分不清。
>
> 逐层比较之后，每个异常都能定位到具体一层，
> 而且**修法是确定的**。"

**七种异常，每层的两个方向各有名字：**

```ts
export type SkillIssueType =
  | 'conflict'        // 挂载点被同名目录/文件/外来链接占用
  | 'mount-missing'   // 期望的挂载点没有托管 symlink
  | 'unregistered'    // 源里有但全局配置没启用      ┐ 源 ↔ 全局
  | 'phantom'         // 全局配置里有但源里没了      ┘
  | 'config-new'      // 全局有，项目没有            ┐ 全局 ↔ 项目
  | 'config-orphan'   // 项目有，全局删了            ┘
  | 'stale-mount';    // 托管 symlink 但已不需要
```

### 3.8 消息在后端生成，前端逐字渲染

```ts
/**
 * F228: the fixed anomaly scenarios the detector recognizes. Each maps to a
 * single display-ready message so the frontend renders verbatim (no client-side
 * re-computation / cross-referencing of separate endpoints).
 */
export interface SkillIssue {
  skill: string;
  type: SkillIssueType;
  mountPointId?: string;
  /** Fully-formed Chinese message; rendered verbatim by the UI. */
  message: string;
}
```

```ts
const CONFLICT_KIND_LABEL: Record<DriftConflict['kind'], string> = {
  directory:      '存在同名目录占用',
  file:           '存在同名文件占用',
  'other-symlink': '存在同名链接占用',
};
const CONFLICT_OVERWRITE_WARNING = '立即同步会覆盖和清理已有内容，请先确认是否需要进行备份';

function conflictToIssue(conflict: DriftConflict): SkillIssue {
  const occupancy = CONFLICT_KIND_LABEL[conflict.kind];
  const pointer = conflict.pointsTo ? ` → ${conflict.pointsTo}` : '';
  return {
    skill: conflict.skill,
    type: 'conflict',
    mountPointId: conflict.mountPointId,
    message: `${conflict.mountPointId} ${occupancy}${pointer}（${CONFLICT_OVERWRITE_WARNING}）`,
  };
}
```

**为什么后端生成完整句子？** 注释说了：
`no client-side re-computation / cross-referencing of separate endpoints`。

**大白话**：前端如果要自己拼消息，就得知道七种异常各自的语义、
还得从多个接口拉数据交叉引用。
**一旦后端加了第八种异常，前端就漏了。**

**把消息生成放后端，异常类型的演进就只需要改一处。**

### 3.9 稳定排序 + 状态指纹

```ts
const ISSUE_TYPE_ORDER: SkillIssueType[] = [
  'conflict', 'mount-missing', 'config-new', 'config-orphan',
  'unregistered', 'phantom', 'stale-mount',
];

function sortSkillIssues(issues: SkillIssue[]): SkillIssue[] {
  return issues.sort((a, b) =>
    a.skill.localeCompare(b.skill) ||
    ISSUE_TYPE_ORDER.indexOf(a.type) - ISSUE_TYPE_ORDER.indexOf(b.type) ||
    (a.mountPointId ?? '').localeCompare(b.mountPointId ?? ''),
  );
}
```

**排序顺序按严重程度**：`conflict`（会覆盖用户数据）排最前，
`stale-mount`（多余的链接）排最后。

```ts
export interface DriftResult {
  newSkills: string[];
  conflicts: DriftConflict[];
  stale: string[];
  issues: SkillIssue[];
  /** Stable state fingerprint over the raw drift buckets. */
  driftHash: string;
}
```

`driftHash` 让前端可以"状态没变就不重渲染"、
让告警可以"同一状态不重复通知"。

### 3.10 一段"为什么不做去重"的论证

```ts
/**
 * Build the display-ready issue list from the distinct scenario buckets.
 * Scenarios are naturally disjoint per (skill, type) — a skill with a mount
 * conflict is not also reported as mount-missing (checkMountDrift), and
 * registration/config buckets concern skills outside the mount expected-set —
 * so no de-dup pass is needed here.
 */
```

**注释里论证了"为什么不用去重"，而不是保险起见加一个去重。**

**这种"说清楚为什么不做"的注释很珍贵** ——
它让后来的人不会因为"稳妥起见"加上一个多余的 O(n²) 去重。

**面试可以当经验讲**：

> "有个注释我觉得很值得学：它论证了'为什么不需要去重'——
> 因为七种异常场景在 (skill, type) 维度上天然互斥。
>
> 大部分人会保险起见加一个去重 pass。
> 但**写清楚'为什么不需要'比加一个防御更好**，
> 因为它让后来的人知道这个不变量存在，
> 也不会因为'稳妥起见'加一个多余的 O(n²)。"

### 3.11 同步引擎：调谐循环

```ts
/** Skill Sync Engine — F228: syncProject reconciles symlinks with config. */
```

**"reconciles"** —— Kubernetes 式的调谐：
不管当前是什么状态，收敛到期望状态。

**三态分类，且路径比较分两级：**

```ts
/** Classify a mount path: 'missing' | 'managed' | 'conflict'. */
export async function classifyMountPath(
  linkPath: string, skillsSource: string, skillName: string,
): Promise<'missing' | 'managed' | 'conflict'> {
  let stat;
  try {
    stat = await lstat(linkPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw err;
  }
  if (!stat.isSymbolicLink()) return 'conflict';     // 是真目录/文件 → 冲突

  const target = await readlink(linkPath);
  const absoluteTarget = isAbsolute(target) ? target : resolve(dirname(linkPath), target);
  const expectedTarget = resolve(skillsSource, skillName);
  if (pathsEqual(absoluteTarget, expectedTarget)) return 'managed';

  // 路径字符串不等 → 再比 realpath（可能中间有 junction/软链）
  const [realTarget, realExpected] = await Promise.all([
    realpath(absoluteTarget).catch(() => absoluteTarget),
    realpath(expectedTarget).catch(() => expectedTarget),
  ]);
  return pathsEqual(realTarget, realExpected) ? 'managed' : 'conflict';
}
```

**为什么要两级比较？**

```
~/.claude/skills/tdd  →  D:/AI/clowder-ai/cat-cafe-skills/tdd
期望的是               →  D:/AI/clowder-ai/cat-cafe-skills/tdd
（但项目目录本身在 AppData 里通过 junction 映射过来）

字符串不等，realpath 相等 → 这是"托管的"，不是冲突
```

**误判成冲突会导致同步引擎去删用户的正确链接。**

`realpath` 失败时 `.catch(() => absoluteTarget)` 回退到原路径 ——
链接指向不存在的目标时不崩。

### 3.12 平台差异

```ts
function symlinkTargetFor(linkPath: string, sourcePath: string): string {
  return process.platform === 'win32' ? sourcePath : relative(dirname(linkPath), sourcePath);
}
```

- **Unix**：相对路径 —— 整个目录移动了链接还有效
- **Windows**：绝对路径 —— 相对符号链接在 Windows 上支持很差

### 3.13 目录级挂载的迁移

```ts
async function convertDirectoryLevelMount(
  skillsDir: string, defaultSource: string, enabledSkillNames: string[],
  sourceMap: ReadonlyMap<string, string>,
): Promise<boolean> {
  try {
    if (!(await isManagedDirectoryLevelSkillsSymlink(skillsDir, defaultSource))) return false;
  } catch { return false; }
  await rm(skillsDir);
  await mkdir(skillsDir, { recursive: true });
  // ...逐个建 skill 级 symlink
}
```

**老版本把整个 `skills/` 目录链过去，新版本要 per-skill 挂载**
（才能选择性启用）。所以要迁移。

**注意迁移前的检查**：`isManagedDirectoryLevelSkillsSymlink`——
**只有确认这是"我们自己建的"目录级链接才删。**
用户自己建的软链不能碰。

**这个判断很重要**：一个"自动修复"功能如果会删用户的东西，
那它比不修复更糟。

### 3.14 并发和安全

```ts
import {
  readCapabilitiesConfig,
  withCapabilityLock,      // ← 并发锁
  writeCapabilitiesConfig,
} from '../config/capabilities/capability-orchestrator.js';

import { isValidSkillName, validateSkillName } from '../config/governance/skill-sync.js';
```

**`withCapabilityLock`**：多只 Agent 可能同时触发同步，配置文件读写要加锁。

**`validateSkillName`**：skill 名会变成路径的一部分。
没有校验的话，一个叫 `../../../etc` 的 skill 就是路径穿越漏洞。

### 3.15 同一套模式，项目里复用了三次

```
packages/api/src/skills/       drift-detector.ts  skill-sync-engine.ts  skill-sync-all.ts
packages/api/src/mcp/          mcp-drift-detector.ts  mcp-sync-engine.ts  mcp-sync-all.ts
packages/api/src/agent-hooks/  sync-targets.ts (checkDrift/applySync)   health.ts
```

**统一骨架：**

```
render(期望状态) → 读(当前状态) → diff → 报告漂移 → 用户确认 → apply
                                       ↑
                                 dry-run 可预览
```

`sync-targets.ts` 里的 dry-run：

```ts
export function applySync(target: SyncTarget, dryRun: boolean): void {
  const rendered = target.render();
  if (dryRun) {
    console.log(`\n=== ${target.name} -> ${target.targetPath} (dry-run) ===\n`);
    console.log(rendered);
    return;
  }
  // ...真写
}
```

**JSON 目标做规范化比较：**

```ts
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))   // ← key 排序
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}
```

**递归排序 key 之后再比较** ——
否则用户手改过格式（缩进、key 顺序）就会被误判成漂移。

---

## 4. 为什么这么设计

### 决策 A：为什么 symlink 而不是复制

【ADR】ADR-009 的否决理由（见 §5）。核心是**版本漂移**。

**symlink 的本质优势**：它让"一份源"这个约束**物理成立**——
不是靠流程保证，而是文件系统保证。

### 决策 B：为什么 per-skill 而不是目录级

【ADR】ADR-009：部分客户端不递归扫子目录，会有"已链接但不可加载"的隐性故障。

**额外收益**（现在才用上）：per-skill 挂载才能**选择性启用**——
不是所有项目都需要全部 48 个 skill。

### 决策 C：为什么消息在后端生成

见 §3.8。**核心是"异常类型的演进只改一处"。**

---

## 5. 否掉了哪些方案

### 方案一：只保留项目级 skills，不做用户级分发

**【ADR】ADR-009 否决理由：**

> **备选方案 A**：仅保留项目级 skills（不做用户级分发）
> 不选原因：每个项目都要重复配置，
> 三猫跨项目协作规则无法稳定复用。

**"跨项目协作规则无法复用"** ——
Agent 去别的仓库干活时（项目里叫"出征"），基础方法论应该跟着走。

**这和 [模块 08](08-模块-会话与抗压缩.md) 里
hook 的用户级/项目级分层是同一个判断。**

### 方案二：复制文件到四套目录

**【ADR】ADR-009：**

> **备选方案 B**：把 skill 文件复制到三套用户目录（不使用 symlink）
> 不选原因：会形成**多份副本并导致版本漂移**，
> 后续维护成本高且容易失配。

### 方案三：目录级单个 symlink

**【ADR】ADR-009：**

> **备选方案 C**：目录级单个 symlink（不按 skill 粒度链接）
> 不选原因：部分客户端不会递归扫描子目录，
> 可能出现**"已链接但不可加载"的隐性故障**。

**这三条否决理由的层次很清晰，面试里可以完整背下来：**

```
方案 A（只项目级）  → 跨项目不能复用
方案 B（复制）      → 版本漂移
方案 C（目录级链接） → 隐性故障（链接在但加载不到）
```

**而且 ADR 还写了不做边界：**

> **不做边界**：本轮不引入自动安装器和跨机器同步脚本，
> 先以单一源目录 + 用户级链接为基线。

### 方案四：把新 MCP 工具都加到 prompt 清单

**【ADR】ADR-037**（见 [模块 07](07-模块-身份注入.md) §5 方案四）。

**这条和 Skills 相关**：ADR-037 的优先级里第二档就是
"relevant skill refs or SOP docs"——
**skill 文档是工具发现的主要渠道之一。**

### 方案五：工具级 hook 全 Agent 统一

**【ADR】ADR-019**（见 [模块 08](08-模块-会话与抗压缩.md) §3.12）。

**这条和 Skills 相关**：因为 skill 是"靠模型自觉遵守"的机制，
而 hook 是"靠系统强制"的机制。ADR-019 的判断是
**能力不一致的强制机制不如一致的自觉机制**。

---

## 6. 如果重新设计

【推断】以下全是我的方案。

### 6.1 加"Skill 加载遥测"闭环

**现在最大的缺口**：**不知道 skill 有没有被真的加载和使用。**

```
Skill 缺失是静默失败：
  symlink 坏了 → Agent 加载不到 tdd → 它照常干活只是不写测试
    → 没有任何报错
```

项目里有 `SkillLoadEventLog`（在 `tool-usage/` 下），
但从代码看它只在部分路径接了线。

**我的方案**：

```
① 每个 SKILL.md 末尾加一个"确认位"：
   加载后 Agent 必须在回复里带一个标记（或调一个轻量 MCP 工具）
   → 系统能统计"这个 skill 这周被加载了几次"

② 交叉验证：
   SOP 阶段是 impl（应该用 tdd） × 实际没有 tdd 加载记录
   → 告警"应加载但未加载"

③ 反向统计：
   某个 skill 三个月零加载
   → 要么它没用，要么它的触发条件写得不对
   → 进 review 队列
```

**为什么这个改动优先级最高？**
因为**分发做得再完美，如果没被加载也是白搭**。
而现在完全没有这个反馈。

**这也和项目自己的原则一致** ——
[模块 15](15-模块-Self-Evolution.md) 里写着
"沉淀不是目的，可调用才是；写了没人读 = 没写"。
**Skill 也是沉淀，同一个标准该适用。**

### 6.2 manifest 到 BOOTSTRAP 的投影自动化

**现在的问题**：manifest 里的注释自己说了：

```
# CLAUDE.md / AGENTS.md / GEMINI.md 的路由表当前手工同步（Wave 2 计划自动生成）
```

**"手工同步"就是漂移源。** 而且 BOOTSTRAP.md 里那张 48 行的表格
也是手工维护的。

**我的方案**：

```
manifest.yaml（真相源）
  ├──→ 生成 BOOTSTRAP.md 的路由表段落
  ├──→ 生成 CLAUDE.md / AGENTS.md / GEMINI.md 的路由表
  └──→ CI 检查：生成物过期就红
```

**项目已经有这个模式了**（`check:sop-definitions` 检查生成物过期），
直接复用。而且 `check:skills:manifest` 已经存在，
只是现在校验的是 manifest 自身而不是投影。

**收益**：改一个 skill 的触发条件，四个地方自动同步。

### 6.3 Skill 依赖和冲突显式化

**现在的问题**：`next` 字段表达了"下一步"，
但没有表达"前置依赖"和"互斥"。

```
现在只能靠 Not for 用自然语言说：
  "Not for: review 未通过、自检未完成"

但这是给模型读的，不是可判定的
```

**我的方案**：

```yaml
merge-gate:
  requires:                    # 硬前置（可判定）
    - skill: quality-gate
      evidence: gate-report    # 必须有这个产物
    - skill: request-review
      evidence: reviewer-approval
  conflicts_with: [tdd]        # 不该同时激活
  next: [feat-lifecycle]
```

**收益**：
- 可以在加载时校验"你要用 merge-gate，但没有 quality-gate 的产物"
- 冲突能被检测（同时加载了 tdd 和 merge-gate 说明流程理解错了）

**代价**：`evidence` 要能被机器识别 ——
这需要 skill 的产出物有结构化标记。
**这一点和 [模块 14](14-模块-SOP门禁.md) 的
`manual_only` → `future_candidate` 升级路径是同一件事。**

### 6.4 Skill 内容加"版本 + 变更影响面"

**现在的问题**：改一个 skill 的内容，
**不知道会影响哪些正在进行的工作。**

```
某只 Agent 正在按 tdd skill 的旧版本干活
  → 你改了 tdd skill
    → 它下次加载会读到新版本
      → 但它已经按旧版本做了一半
```

**我的方案**：

```yaml
---
name: tdd
version: 3                      # 内容版本
breaking_changes_at: [3]        # 哪些版本是破坏性变更
---
```

```
Agent 加载 skill 时记录版本
  → 如果中途 skill 升级到了破坏性版本
    → 注入一条提示"你依赖的 tdd skill 已从 v2 升到 v3（破坏性），
       建议重新读一遍再继续"
```

**为什么值得？**
因为 skill 是 Agent 的"工作方法"，中途换方法比中途换需求更容易出错。

**代价**：需要跟踪"哪次加载用了哪个版本"——
依赖 §6.1 的加载遥测。**两个改动是配套的。**

### 6.5 我不会改的

| 我原本的想法 | 为什么放弃 |
|------------|-----------|
| 改成复制文件（避免 symlink 的平台差异） | 【ADR】版本漂移的代价远大于平台适配 |
| 目录级挂载（少 48 个 symlink） | 【ADR】隐性故障 + 不能选择性启用 |
| 前端自己拼异常消息（后端只给结构化数据） | 异常类型演进时前端会漏；后端生成只改一处 |
| 把 skill 内容压缩得更短 | 异议反驳和决策点是核心价值，压缩了就变成无效的步骤清单 |
| 去掉 `refs/` 共享层，各 skill 自包含 | 会导致同一条规则在多处重复，违反单一真相源 |

---

## 7. 和其他模块怎么咬合

### 上游

```
用户在 Console 点"同步 Skills"
Agent 通过 MCP 调 skill 管理工具
启动时的自动检查
CI 的 pnpm check:skills / check:skills:mount
```

### 下游

```
skill-sync-engine 建好 symlink
   ↓
Agent CLI 启动时扫自己的 skills 目录
   ↓
Claude/Gemini 自动触发 · Codex 靠 BOOTSTRAP 的路由表手动 cat
   ↓
Agent 读到 SKILL.md → 按里面的方法论干活
```

### 三根跨模块线

**线一：`refs/shared-rules.md` → L0 编译**

```
cat-cafe-skills/refs/shared-rules.md（本模块管分发）
   └──→ 模块 07 的 compileGovernanceL0FromMarkdown（编译成 L0）
        └──→ 每次调用的 prompt
```

**这是两个模块最紧的接缝** ——
如果 skill 分发坏了，`shared-rules.md` 读不到，
**L0 编译会 fail closed，API 直接启动失败。**

**这其实是个好设计**：Skill 分发的故障会被 L0 的 fail-closed 立刻暴露，
而不是静默降级。

**线二：manifest 的 `sop_step` → SOP 阶段**

```
manifest.yaml 的 sop_step 字段
   ↕ 双向引用
sop-definitions/development.yaml 的 suggested_skill 字段
   └──→ 模块 07 的 D14 段（SOP 阶段提示）
        └──→ "当前 impl 阶段，建议 skill: writing-plans"
```

**两个真相源交叉引用**，所以有 `check:skills:manifest` 校验一致性。

**线三：skill 文档 → 工具发现（ADR-037）**

```
ADR-037 的认知入口优先级第二档：
  "Relevant skill refs or SOP docs — scenario guidance, parameters, examples,
   side effects, and gotchas."
   └──→ 新增 MCP 工具时，主要在 skill 文档里教怎么用
        └──→ 而不是往 prompt 里塞清单
```

### 和 SOP 的关系（容易混）

```
manifest.yaml            → skill 的触发与路由（什么时候加载哪个）
development.yaml         → SOP 的阶段与规则（流程走到哪、有什么硬规则）
docs/SOP.md              → 人类可读的流程叙事
每个 SKILL.md            → 该步骤的执行细节
```

**每个 SKILL.md 头部都声明从属关系：**

```markdown
> **SOP 位置**: 本 skill 是 `sop-definitions/development.yaml` stage `review` 的执行细节。
> **上一步**: `quality-gate` | **下一步**: `receive-review`
```

**四份文档，两个真相源，交叉引用声明清楚。**

---

## 8. 面试怎么讲

### 30 秒版

见 §0。

### 3 分钟版

> "48 个 skill，每个一个目录 + 一份 markdown。
> 描述统一用三段式：`Use when` / `Not for` / `Output`——
> `Not for` 那段是防模型过度加载，
> 因为你告诉它有 TDD skill，它写文档时也会想'是不是该先写测试'。
>
> **内容写法我觉得最有价值。**
> `tdd/SKILL.md` 里不只是步骤，而是有一张'4 个常见异议的反驳'表：
> '写完再补测试也能验证'、'我手工测了'、'删掉几小时工作太浪费'、
> 'TDD 是教条'。
> 因为**模型会自己说服自己跳过步骤** ——
> 预先写好反驳，它遇到这个念头时能认出来。
> 这是给 LLM 写文档的一个重要技巧：预判它的合理化路径，提前堵住。
>
> **分发这块本质上是配置分发问题。**
> 一份源 symlink 到四个客户端目录。
> 【ADR】他们明确否掉了三个方案：
> 只做项目级（跨项目不能复用）、
> 复制文件（版本漂移）、
> 目录级单个 symlink（**部分客户端不递归扫子目录，
> 会出现'已链接但不可加载'的隐性故障**）。
>
> 然后就是经典的一致性问题：三层漂移检测 ——
> 源 ↔ 全局配置 ↔ 项目配置 ↔ 挂载点，
> **只比相邻层**，因为跨层比会归因不清（'没挂上'到底是哪一层的问题）。
> 七种异常各有名字，每层的两个方向各一个。
>
> 有两个实现细节我印象比较深：
> 一是路径比较分两级 —— 先比字符串，不等再比 realpath，
> 因为项目目录可能通过 junction 映射，
> 误判成冲突会让同步引擎删掉用户的正确链接。
> 二是异常消息在**后端**生成完整中文句子，前端逐字渲染 ——
> 因为前端自己拼的话，后端加第八种异常时前端就漏了。"

### 常见追问

**Q：为什么用 symlink 而不是复制？**

见 §5 三条 ADR 否决理由。

**Q：怎么知道 skill 真的被用了？**

> "**这是我认为现在最大的缺口。**
>
> Skill 缺失是**静默失败** —— symlink 坏了，Agent 加载不到 tdd，
> 它照常干活只是不写测试，没有任何报错。
> 一周后你发现新代码都没测试。
>
> 项目里有 `SkillLoadEventLog`，但从代码看只在部分路径接了线。
>
> 我会做三件事：
> 一，加载确认位 —— 每个 SKILL.md 要求 Agent 加载后带个标记，
> 能统计"这周被加载了几次"；
> 二，交叉验证 —— SOP 阶段是 impl（应该用 tdd）
> 但没有 tdd 加载记录 → 告警"应加载但未加载"；
> 三，反向统计 —— 某个 skill 三个月零加载，
> 要么它没用，要么触发条件写错了，进 review 队列。
>
> 为什么优先级最高？因为**分发做得再完美，没被加载也是白搭**。
> 而且这和项目自己的原则一致 ——
> 他们在 Self-Evolution 里写着'沉淀不是目的，可调用才是；
> 写了没人读 = 没写'。Skill 也是沉淀，同一个标准该适用。"

**Q：这套机制和 Kubernetes 有什么关系？**

> "形状是一样的，我数了下能一一对应：
>
> 单一数据源 = `cat-cafe-skills/` + manifest；
> 副本 = 四个挂载点的 symlink；
> 一致性检查 = 三层 drift detector；
> 调谐循环 = `syncProject` reconcile（源码注释里就用了 reconciles 这个词）；
> 冲突解决 = `conflict` 类型 + 覆盖警告；
> 版本漂移 = `unregistered`/`phantom`/`stale-mount`；
> 幂等 = classify → 只改需要改的；
> 并发控制 = `withCapabilityLock`。
>
> **一旦这么看，那七种异常就不再是'啰嗦'，而是必需的** ——
> 因为它们对应了配置分发的七种真实失败模式。
>
> 而且同一套'渲染-比较-同步'骨架在项目里复用了三次：
> Skills、MCP 配置、Agent hooks。复用三次说明它确实通用。"

---

## 9. 本模块要点

| 要点 | 内容 |
|------|------|
| **三段式描述** | `Use when` / `Not for` / `Output`；`Not for` 防过度加载 |
| **写异议反驳** | 预判模型的合理化路径，提前堵住 |
| **"正确地失败"** | typo 报错和功能未实现的失败是两回事 |
| **manifest 是路由真相源** | 与 SOP 真相源边界清晰，交叉引用 |
| **`next` 链** | skill 之间形成工作流 |
| **全大写强调** | "YOU DO NOT HAVE A CHOICE" 是刻意的 prompt 手法 |
| **禁止写死 reviewer** | 防模型把动态匹配退化成刻板印象 |
| **【ADR-009】三个否决** | 只项目级（不能复用）/ 复制（漂移）/ 目录级链接（隐性故障） |
| **只比相邻层** | 跨层比会归因不清 |
| **七种异常** | 每层两个方向各一个名字 |
| **消息后端生成** | 前端 verbatim；异常类型演进只改一处 |
| **两级路径比较** | 字符串 → realpath，防 junction 误判成冲突 |
| **迁移前先确认托管** | 用户自建的链接不能碰 |
| **Skill 名要校验** | 会变成路径，否则是路径穿越漏洞 |
| **渲染-比较-同步** | 项目里复用三次的骨架 |
| **本质是配置分发** | 能和 K8s 的 reconcile 一一对应 |
| **我的改进** | **加载遥测闭环（最高优先）** / manifest 投影自动化 / 依赖与冲突显式化 / skill 版本 |

---

→ [13 MCP 回调桥](13-模块-MCP回调桥.md)
