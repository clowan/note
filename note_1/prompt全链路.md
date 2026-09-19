# 精读 prompt 组装全链路

> 你现在担任“源码精读导师 + 软件架构讲解者 + 技术面试辅导者”。
>
> 项目路径：D:\AI\clower-1\clowder-ai 目标模块：【prompt组装全链路】
>
> 我的目标：
> 我希望真正理解这个模块，并把这个项目作为技术面试中的项目经历，能够应对面试官从业务、架构、源码、算法、并发、可靠性到设计取舍的连续追问。
>
> 我不满足于：
>
> - 罗列文件、类名和函数职责；
> - 根据 README、架构文档或注释复述设计；
> - 只有流程图，没有实际字段、代码和状态变化；
> - 用“异步处理、状态机、幂等、缓存、原子性”等术语代替实现细节；
> - 泛泛地介绍常见设计，却没有确认项目实际如何实现。
>
> 我需要的是：
> 通俗易懂，但深入到关键算法和真实执行路径的系统性源码拆解。
> 不要求一次讲完，可以分篇讲解，但总体必须完整、连贯、可核查。
>
> 一、操作边界
>
> 1. 这是源码分析与学习任务，不是代码修改任务。
> 2. 不修改源码、配置、依赖、测试文件，不格式化代码，不回滚已有改动。
> 3. 不启动可能产生真实业务副作用的服务，不连接或修改真实数据库，不调用会产生费用或写入行为的外部接口。
> 4. 必要时可以调用经过检查的纯函数，或在完全隔离的内存环境中做最小验证。
> 5. 运行任何验证前，先检查导入副作用和测试初始化逻辑。无法安全验证时，明确说明，不强行运行。
> 6. 默认只在对话中输出，不擅自创建学习文档或其他文件。
> 7. 记录分析依据的本地版本或 commit；关键结论应对应当前工作区内容。
>
> 二、先确定范围和真实入口
>
> 开始时，请先定位真实仓库根目录，遵循仓库中的适用说明，然后检查：
>
> - 这个模块解决什么业务问题；
> - 它的边界是什么，哪些职责属于相邻模块；
> - 实际启动、注册、依赖注入和调用入口在哪里；
> - 谁调用它，它又调用谁；
> - 有哪些对外接口、核心数据结构、持久化结构和状态；
> - 有哪些默认关闭、条件启用、兼容、废弃或占位实现。
>
> 不要因为某个函数存在，就假定它已经接入运行路径。
> 需要同时检查定义、调用点、装配代码和相关条件分支。
>
> 如果模块名称含糊，先根据源码给出合理边界并说明假设；只有歧义会明显影响方向时，才向我提一个必要问题。
>
> 三、采用“分篇源码精读”，而不是一次性架构综述
>
> 先根据实际实现制定完整学习路线，明确：
>
> - 每篇解决什么问题；
> - 覆盖哪些子流程和关键算法；
> - 前后篇的依赖关系；
> - 哪些内容已经展开，哪些尚未展开。
>
> 章节数量由模块复杂度决定，不要机械套用固定目录，也不要为凑章节添加不存在的能力。
>
> 首次回答在给出路线之后，立即完整展开第一篇，不要只给目录。
> 后续每次集中讲透一个能够闭合的子流程；篇幅不足时继续拆分，不要牺牲关键实现细节。
> 等待我说“继续”后，再进入下一篇。
>
> 四、每篇按真实执行链讲解
>
> 选择一个贯穿本篇的具体场景和一组示例数据，沿着实际执行顺序推进：
>
> 入口 → 校验 → 路由/决策 → 核心处理 → 状态变化或存储 → 下游调用 → 返回结果。
>
> 对每个关键步骤说明：
>
> 1. 调用者是谁，调用发生在什么条件下；
> 2. 进入哪个函数，关键参数是什么；
> 3. 输入数据有哪些字段，字段由谁生成；
> 4. 函数读取什么状态、执行什么算法；
> 5. 数据经过哪些转换；
> 6. 写入哪里，返回什么，下一个消费者如何使用；
> 7. 同步、异步、事件回调、后台任务之间如何衔接；
> 8. 哪些路径会跳过、短路、失败、重试或降级。
>
> 请沿同一请求、消息或任务追踪 ID、状态和数据，不要让例子在每节重新开始。
> 涉及多个进程或协议时，明确区分通信两端，不要把 MCP、HTTP、进程内调用、CLI 输入输出等混成一条抽象箭头。
>
> 五、必须达到关键算法实现级别
>
> 遇到关键算法、状态机、队列、解析器或数据结构时，至少讲清：
>
> - 输入、输出和前置条件；
> - 核心数据结构及选择原因；
> - 实际判断条件、循环、排序、过滤、去重、更新规则；
> - 用小规模示例逐步推演中间状态；
> - 边界值、空输入、重复输入、异常输入如何处理；
> - 哪些性质由具体代码保证；
> - 时间、空间和 I/O 成本，说明分析假设；
> - 哪些工作虽然没有产生更新，却仍然发生了扫描或计算；
> - 适用范围、代价和可能的改进方向。
>
> 如果有公式，解释每个变量，并映射到代码，不要只给公式名称。
> 如果没有复杂数学算法，不要硬套；深入其分支逻辑、状态转换和并发协议即可。
>
> 六、代码证据要求
>
> 1. 关键结论提供可点击的绝对文件路径与准确行号。
> 2. 展示足够理解机制的实际代码或 SQL 节选，不要只有文件链接。
> 3. 原样节选、经过删减的代码、等价伪代码、示意数据必须区分。
> 4. 不要粘贴几百行代码后让我自行理解；解释关键语句如何共同实现行为。
> 5. 注释和设计文档只能作为线索，不能替代实现证据。
> 6. 文档、注释与实现不一致时，指出差异。
> 7. 对第三方库的关键语义，必要时查对应版本的官方资料；不能把通用知识直接当成本项目的实现。
> 8. 尚未找到调用点或无法验证的结论，标注待确认，不要补造缺失环节。
>
> 七、重点检查可靠性与并发边界
>
> 根据本模块实际情况，检查：
>
> - 哪些状态在内存，哪些持久化；
> - 操作顺序与事务范围；
> - await 前后可能发生什么交错；
> - 锁、CAS、唯一键、幂等键究竟保护什么；
> - 单进程保证是否能扩展到多进程；
> - 超时是否真正取消底层操作；
> - 重试是否会重复执行副作用；
> - 写入成功但通知失败、部分成功、进程重启时会怎样；
> - 是否存在补偿、重放、重建、死信或人工恢复路径；
> - 降级是否对调用者可见。
>
> 不要看到注释写“atomic/CAS/idempotent”，就直接宣称具备该保证。
> 不要把“可以修复”说成“必然自动恢复”，也不要把局部事务说成全链路强一致。
>
> 疑似缺陷要区分：
> 代码中已确认的行为、可能风险、尚未复现的问题。
> 分析时不擅自修复。
>
> 八、验证要具体、诚实、最小化
>
> 对于容易讲错的关键行为，优先考虑最小验证，例如纯函数输入输出、内存数据库、隔离的状态机推演。
>
> 报告清楚：
>
> - 使用的是实际源码还是算法复演；
> - 输入是什么；
> - 检查了什么断言；
> - 实际输出是什么；
> - 验证覆盖了哪个边界；
> - 哪些外部依赖或端到端行为没有验证。
>
> 不把“有测试文件”说成“测试通过”。
> 不把“小型验证通过”说成“整个模块正确”。
> 不编造性能、准确率、并发量或改进收益。
>
> 九、讲解必须通俗，但不能停留在比喻
>
> 使用顺序：
> 直觉解释 → 真实数据 → 实际代码 → 算法推演 → 设计取舍 → 边界。
>
> 首次出现的术语先用一句人话解释，再给正式名称。
> 重点解释“为什么这个条件写在这里”“如果去掉会怎样”“上下游怎么依赖它”。
>
> 可以解释设计价值，但要区分：
>
> - 文档明确记载的设计理由；
> - 根据当前实现作出的合理推断；
> - 你提出的改进建议。
>
> 不要反复复述整体架构来代替深入。
> 不要把每个普通赋值都机械翻译一遍，精力集中于关键机制。
>
> 十、每篇结束时形成面试闭环
>
> 给出本篇最有区分度的连续追问，采用：
>
> 面试官第一问
> → 可直接表达的准确回答
> → 面试官进一步追问
> → 源码级回答与边界。
>
> 不能只把问题留给我自测。
> 不能代替我编造个人贡献；帮助我区分开源已有能力、实际参与内容和未来改进设想。
>
> 最后简要列出：
>
> - 本篇已经讲透的机制；
> - 尚未验证或尚未覆盖的内容；
> - 下一篇的范围及它如何承接本篇。
>
> 最终验收标准：
> 读完后，我应该能不用看文件名，就解释这个子流程的数据怎样流动；
> 也能打开对应函数，说明关键算法、状态变化、失败处理和保证边界。
> 如果答案仍只有“是什么”和“为什么”，缺少“具体怎么执行”，就没有达到要求。
>
> 现在请先调查目标模块，给出基于实际源码的完整拆解路线，并开始第一篇。

<details><summary>3 previous messages</summary>

> <details><summary>Ran 106 commands</summary>
>
> - Ran `$root='D:\AI\clower-1\clowder-ai'; Write-Output '=== top package ==='; $i=0; Get-Content -LiteralPath "$root\package.json" -Encoding UTF8 | ForEach-Object { $i++; if($i -le 220){"${i}:$_"} }; Write-Output '=== api package ==='; $i=0; Get-Content -LiteralPath "$root\packages\api\package.json" -Encoding UTF8 | ForEach-Object { $i++; "${i}:$_" }; Write-Output '=== likely prompt/context files ==='; rg --files "$root\packages\api\src" | Where-Object { $_ -match '(prompt|context|routing|invocation|session|message|memory|system)' } | Sort-Object; Write-Output '=== symbol hits ==='; rg -n --glob '*.ts' --glob '*.tsx' "ContextAssembler|assembleContext|buildSystemPrompt|systemPrompt|promptParts|maxPromptTokens|invokeSingleCat|invoke.*Cat|routeSerial|routeParallel|SessionBootstrap|handoff|finalPrompt|userPrompt" "$root\packages\api\src"`
> - Ran `$src='D:\AI\clower-1\clowder-ai\packages\api\src'; Write-Output '=== api src top-level ==='; Get-ChildItem -LiteralPath $src | Select-Object Mode,Name; Write-Output '=== top-level ts ==='; Get-ChildItem -LiteralPath $src -File -Filter '*.ts' | Select-Object Name,Length; Write-Output '=== route filenames likely message ==='; Get-ChildItem -LiteralPath "$src\routes" -File -Filter '*.ts' | Where-Object { $_.Name -match 'message|thread|agent|cat|prompt|chat|invoke|routing' } | Select-Object Name,Length; Write-Output '=== cats service tree depth 4 ==='; Get-ChildItem -LiteralPath "$src\domains\cats\services" -Recurse -File -Filter '*.ts' | ForEach-Object { $_.FullName.Replace($src+'\','') } | Sort-Object`
> - Ran `$src='D:\AI\clower-1\clowder-ai\packages\api\src'; Write-Output '=== index imports/routes around messages and cats ==='; rg -n "messages|register.*Route|routeSerial|routeParallel|QueueProcessor|ContextAssembler|invokeSingleCat|Prompt" "$src\index.ts"; Write-Output '=== route registration symbols ==='; rg -n "export (async )?function|export const|app\.(post|get|put|delete)|register.*Message|messageRoutes|route.*Message" "$src\routes\messages.ts" "$src\routes\threads.ts" "$src\routes\cats.ts"; Write-Output '=== direct imports of messages.ts ==='; rg -n "from ['\"].*routes/messages|registerMessage|messageRoutes" "$src" --glob '*.ts'; Write-Output '=== routing files ==='; Get-ChildItem -LiteralPath "$src\domains\cats\services\agents\routing" -File -Filter '*.ts' | Select-Object Name,Length`
> - Ran `$src='D:\AI\clower-1\clowder-ai\packages\api\src'; Write-Output '=== index imports/routes around messages and cats ==='; rg -n 'messages|register.*Route|routeSerial|routeParallel|QueueProcessor|ContextAssembler|invokeSingleCat|Prompt' "$src\index.ts"; Write-Output '=== route registration symbols ==='; rg -n 'export (async )?function|export const|app\.(post|get|put|delete)|register.*Message|messageRoutes|route.*Message' "$src\routes\messages.ts" "$src\routes\threads.ts" "$src\routes\cats.ts"; Write-Output '=== direct imports of message route ==='; rg -n 'routes/messages|registerMessage|messageRoutes' "$src" --glob '*.ts'; Write-Output '=== routing files ==='; Get-ChildItem -LiteralPath "$src\domains\cats\services\agents\routing" -File -Filter '*.ts' | Select-Object Name,Length`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== $p [$s-$e] ==="; for($i=$s;$i -le [Math]::Min($e,$a.Count);$i++){"${i}:$($a[$i-1])"}}; $src='D:\AI\clower-1\clowder-ai\packages\api\src'; Show-Lines "$src\index.ts" 1540 1810; Show-Lines "$src\routes\messages.ts" 1 460`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le [Math]::Min($e,$a.Count);$i++){"${i}:$($a[$i-1])"}}; $p='D:\AI\clower-1\clowder-ai\packages\api\src\index.ts'; Show-Lines $p 1590 1705; Show-Lines $p 1706 1810`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts'; rg -n "router\.|messageStore\.append|broadcast|extract|mention|route|handleMessage|routing|invoke|deliveryMode|queueProcessor|invocationQueue|idempot" $p`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\AgentRouter.ts'; rg -n "export class AgentRouter|constructor\(|resolveTargetsAndIntent|async \*routeExecution|async \*route\(|routeExecution\(|route\(|routeSerial|routeParallel|build|context" $p`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le [Math]::Min($e,$a.Count);$i++){"${i}:$($a[$i-1])"}}; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\AgentRouter.ts'; Show-Lines $p 500 820; Show-Lines $p 1360 1450; Show-Lines $p 1388 1435; Show-Lines $p 1540 1730`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le [Math]::Min($e,$a.Count);$i++){"${i}:$($a[$i-1])"}}; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\AgentRouter.ts'; Show-Lines $p 603 790; Show-Lines $p 790 900; Show-Lines $p 1368 1435; Show-Lines $p 1540 1625; Show-Lines $p 1678 1735`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\AgentRouter.ts'; rg -n "getStrategyDeps|constructor\(options|this\.services|new SessionManager|new DeliveryCursorStore" $p; function Show-Lines($s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 725 815; Show-Lines 815 915; Show-Lines 1388 1435; Show-Lines 1540 1628`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\AgentRouter.ts'; Show-Lines $p 1328 1390; Show-Lines $p 1390 1438; Show-Lines $p 1620 1685`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; $p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts'; Show-Lines $p 437 650; Show-Lines $p 650 850; Show-Lines $p 850 1050`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; $p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts'; Show-Lines $p 600 760; Show-Lines $p 760 940; Show-Lines $p 940 1035`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 690 790; Show-Lines 790 890; Show-Lines 890 940`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 1035 1145; Show-Lines 1145 1235; Show-Lines 1235 1320`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 1115 1185; Show-Lines 1185 1250`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts'; Write-Output '=== imports first 220 ==='; $a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1;$i -le 240;$i++){"${i}:$($a[$i-1])"}; Write-Output '=== key prompt/context symbols ==='; rg -n "ContextAssembler|contextAssembler|systemPrompt|prompt|Prompt|build|history|contextBudget|maxPromptTokens|maxContextTokens|bootstrap|recall|memory|invokeSingleCat|invoke|instruction|parts|effective" $p`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts'; rg -n "assembleContext|buildInvocationContext|buildStaticIdentity|buildSessionBootstrap|invokeSingleCat|systemPrompt|contextBudget|maxPromptTokens|maxContextTokens|historyContext|systemParts|effectiveContext|userMessage|prompt:" $p`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts'; Show-Lines $p 500 650; Show-Lines $p 650 815; Show-Lines $p 815 930; Show-Lines $p 930 1035; Show-Lines $p 1060 1120; Show-Lines $p 1210 1270`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 600 700; Show-Lines 700 800; Show-Lines 800 900; Show-Lines 900 1020`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 673 740; Show-Lines 740 815; Show-Lines 815 880; Show-Lines 880 940`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 754 815; Show-Lines 815 856`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts'; rg -n "export async function\* routeSerial|incrementalMode|assembleIncrementalContext|contextHistory|history\?|RouteOptions|interface Route" $p | Select-Object -First 120; function Show-Lines($s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 240 430; Show-Lines 430 510`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\SystemPromptBuilder.ts'; Write-Output '=== symbols ==='; rg -n "export (function|interface|type|const)|function |const .* =|buildStaticIdentity|buildInvocationContext|nativeL0Injected|mcpAvailable|return" $p; Write-Output '=== size ==='; (Get-Content -LiteralPath $p -Encoding UTF8).Count`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\SystemPromptBuilder.ts'; rg -n "export function buildStaticIdentityPackOnly|export function buildStaticIdentity\(|export function buildInvocationContext\(|export function buildSystemPrompt\(" $p; function Show-Lines($s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 1 215; Show-Lines 431 590; Show-Lines 590 760; Show-Lines 760 975; Show-Lines 1068 1107`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\SystemPromptBuilder.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 431 520; Show-Lines 520 641; Show-Lines 642 740; Show-Lines 740 840`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\SystemPromptBuilder.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 520 590; Show-Lines 590 641; Show-Lines 642 705; Show-Lines 705 745`
> - Ran `$base='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context'; Write-Output '=== context files ==='; Get-ChildItem -LiteralPath $base -Recurse -File | ForEach-Object {$_.FullName.Replace('D:\AI\clower-1\clowder-ai\','')} | Sort-Object; Write-Output '=== template loader ==='; $p="$base\prompt-template-loader.ts"; $a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1;$i -le $a.Count;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\ContextAssembler.ts'; $a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "lines=$($a.Count)"; for($i=1;$i -le $a.Count;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts'; rg -n "export async function assembleIncrementalContext|function assembleIncrementalContext|export interface Incremental|type Incremental|shouldAppendExplicitCurrentMessage|assembleContext|smart|Smart|deliveryCursor|unseen|effectiveMaxContextTokens|contextText|coverageMap" $p`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 1 250; Show-Lines 650 820; Show-Lines 820 1020`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 180 250; Show-Lines 650 750; Show-Lines 750 850; Show-Lines 850 950; Show-Lines 950 1018`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 688 770; Show-Lines 770 850; Show-Lines 850 920; Show-Lines 920 950`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 780 850`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\invoke-single-cat.ts'; Write-Output '=== key symbols ==='; rg -n "export async function\* invokeSingleCat|interface Invoke|type Invoke|prompt:|systemPrompt|injectSystemPrompt|canSkipOnResume|isResume|contextHintPrefix|staging|service\.invoke|invoke\(|session|finalPrompt|effectivePrompt|providerPrompt|McpPromptInjector|prepend" $p`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\invoke-single-cat.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 600 700; Show-Lines 700 820; Show-Lines 820 940; Show-Lines 2920 3065; Show-Lines 3310 3360`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\invoke-single-cat.ts'; rg -n "effectivePrompt|injectSystemPrompt|baseOptions|contextHintPrefix|buildStagingPrepend|stagingPrepend|systemPrompt:" $p | Select-Object -First 160`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\invoke-single-cat.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 1800 1905; Show-Lines 1905 2005`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\invoke-single-cat.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 1873 1928`
> - Ran `$root='D:\AI\clower-1\clowder-ai'; Write-Output '=== default cat and configs ==='; rg -n "function getDefaultCatId|export function getDefaultCatId|DEFAULT_CAT|defaultCat|isDefault" "$root\packages\api\src\config" "$root\packages\shared\src" --glob '*.ts' --glob '*.json' --glob '*.yaml'; Write-Output '=== cat registry config files ==='; rg --files "$root" -g '*cat*config*' -g '*cats*.json' -g '*registry*.json' -g '!**/node_modules/**' | Sort-Object | Select-Object -First 100; Write-Output '=== configured cat ids likely ==='; rg -n '"clientId"|clientId:|displayName:|defaultModel:|provider:' "$root\config" "$root\cat-config.json" "$root\packages\shared\src" 2>$null | Select-Object -First 200`
> - Ran `$root='D:\AI\clower-1\clowder-ai'; Write-Output '=== cat template ids/providers ==='; $j=Get-Content -LiteralPath "$root\cat-template.json" -Encoding UTF8 -Raw | ConvertFrom-Json; $j.breeds | ForEach-Object { $b=$_; [PSCustomObject]@{breedId=$b.id; catId=$b.catId; displayName=$b.displayName; clientId=$b.clientId; defaultVariantId=$b.defaultVariantId; variants=(($b.variants | ForEach-Object { "$($_.id):$($_.catId):$($_.clientId):$($_.defaultModel)" }) -join '; ')} } | Format-Table -Wrap; Write-Output '=== default logic ==='; $p="$root\packages\api\src\config\cat-config-loader.ts"; $a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=809;$i -le 872;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$dir='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\providers'; rg -n "class .*Codex|injectsL0Natively|implements AgentService|async \*invoke\(|invoke\(prompt|developer_instructions|systemPrompt|resumeFallbackSystemPrompt" $dir --glob '*.ts' | Select-Object -First 300`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\providers\CodexAgentService.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 650 760; Show-Lines 760 860; Show-Lines 860 940`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\providers\CodexAgentService.ts'; rg -n "stdinInput|effectivePrompt|spawnCli|args," $p | Select-Object -First 100; function Show-Lines($s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 960 1040`
> - Ran `$src='D:\AI\clower-1\clowder-ai\packages\api\src'; rg -n "new CodexAgentService|CodexAgentService|register.*Agent|agentRegistry|createAgentService|providerFactory|create.*Service" "$src\index.ts" "$src\domains\cats\services\agents" --glob '*.ts' | Select-Object -First 300`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\index.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 1210 1340`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\index.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 1335 1375`
> - Ran `$src='D:\AI\clower-1\clowder-ai\packages\api\src'; rg -n "const messageStore|let messageStore|new RedisMessageStore|new MessageStore\(|createMessageStore|storageResult" "$src\index.ts" "$src\domains\cats\services\stores" --glob '*.ts' | Select-Object -First 200; $p="$src\domains\cats\services\stores\ports\MessageStore.ts"; rg -n "export interface StoredMessage|export interface IMessageStore|append\(|getByThreadAfter|deliveryStatus|origin|extra" $p`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== $p [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; $src='D:\AI\clower-1\clowder-ai\packages\api\src'; Show-Lines "$src\index.ts" 540 590; Show-Lines "$src\domains\cats\services\stores\factories\MessageStoreFactory.ts" 1 60; Show-Lines "$src\domains\cats\services\stores\ports\MessageStore.ts" 1 180; Show-Lines "$src\domains\cats\services\stores\ports\MessageStore.ts" 250 330`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\MessageStore.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 20 170`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\DeliveryCursorStore.ts'; $a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1;$i -le $a.Count;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$root='D:\AI\clower-1\clowder-ai\packages\api\src'; rg -n "ackCollectedCursors|upsertMaxBoundary|ackCursor\(|cursorBoundaries" "$root\domains\cats\services\agents\routing\route-serial.ts" "$root\routes\messages.ts" "$root\domains\cats\services\agents\routing\route-helpers.ts" "$root\domains\cats\services\agents\routing\AgentRouter.ts"; function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== $p [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines "$root\domains\cats\services\agents\routing\route-serial.ts" 3480 3525; Show-Lines "$root\domains\cats\services\agents\routing\AgentRouter.ts" 1388 1415`
> - Ran `$root='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores'; rg -n "generate.*Message|message.*id|next.*id|padStart|timestamp.*seq|create.*Id|randomUUID|getByThreadAfter" "$root\ports\MessageStore.ts" "$root\redis\RedisMessageStore.ts" "$root\redis\redis-message-parsers.ts" | Select-Object -First 200`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== $p [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; $base='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores'; Show-Lines "$base\ports\MessageStore.ts" 340 430; Show-Lines "$base\ports\MessageStore.ts" 560 610; Show-Lines "$base\redis\RedisMessageStore.ts" 1 140; Show-Lines "$base\redis\RedisMessageStore.ts" 500 545`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\providers\l0-compiler.ts'; $a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1;$i -le $a.Count;$i++){"${i}:$($a[$i-1])"}; Write-Output '=== compiler script refs ==='; rg -n "compile.*L0|buildStaticIdentity|governance|prompt" 'D:\AI\clower-1\clowder-ai\scripts' 'D:\AI\clower-1\clowder-ai\packages\api\src' --glob '*l0*' --glob '*prompt*compile*' --glob '*.mjs' | Select-Object -First 200`
> - Ran `$p='D:\AI\clower-1\clowder-ai\scripts\compile-system-prompt-l0.mjs'; rg -n "export async function compileL0|async function compileL0|const L0|system-prompt-l0|shared-rules|replace|catId|profile|primer|capsule|buildStaticIdentity|load" $p | Select-Object -First 220`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-parallel.ts'; rg -n "export async function\* routeParallel|assembleIncrementalContext|buildInvocationContext|buildStaticIdentity|buildStaticIdentityPackOnly|buildSessionBootstrap|effectiveContextBudget|systemPartsTokens|parts =|prompt =|invokeSingleCat|systemPrompt" $p`
> - Ran `$src='D:\AI\clower-1\clowder-ai\packages\api\src'; Write-Output '=== prompt hook files ==='; Get-ChildItem -LiteralPath "$src\domains\prompt-hooks" -Recurse -File | ForEach-Object {$_.FullName.Replace($src+'\','')} | Sort-Object; Write-Output '=== prompt-injection route symbols ==='; rg -n "app\.|export|register|hook|Prompt|prompt|layer|L[0-9]|enabled|inject" "$src\routes\prompt-injection.ts" "$src\routes\prompt-injection-hooks.ts" "$src\routes\prompt-injection-preview.ts" | Select-Object -First 300; Write-Output '=== runtime consumers of prompt-hooks ==='; rg -n "prompt-hooks|PromptHook|promptInjection|injectPrompt|hook.*prompt|run.*Hook|execute.*Hook" "$src" --glob '*.ts' | Select-Object -First 300`
> - Ran `$base='D:\AI\clower-1\clowder-ai\packages\api\src\config'; function Show-All($p){Write-Output "=== $p ===";$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=1;$i -le $a.Count;$i++){"${i}:$($a[$i-1])"}}; Show-All "$base\cat-budgets.ts"; Show-All "$base\hierarchical-context-config.ts"; Write-Output '=== token counter ==='; Show-All 'D:\AI\clower-1\clowder-ai\packages\api\src\utils\token-counter.ts'`
> - Ran `$root='D:\AI\clower-1\clowder-ai'; if(Test-Path -LiteralPath "$root\.cat-cafe"){ Get-ChildItem -LiteralPath "$root\.cat-cafe" -Force | Select-Object Mode,Name,Length } else { 'NO .cat-cafe directory' }; if(Test-Path -LiteralPath "$root\.cat-cafe\cat-catalog.json"){ $catalog=Get-Content -LiteralPath "$root\.cat-cafe\cat-catalog.json" -Raw -Encoding UTF8 | ConvertFrom-Json; 'catalog breeds:'; $catalog.breeds | ForEach-Object { [PSCustomObject]@{catId=$_.catId; defaultVariantId=$_.defaultVariantId; disabled=$_.disabled; variants=(($_.variants | ForEach-Object { "$($_.catId ?? $_.id):disabled=$($_.disabled):client=$($_.clientId):model=$($_.defaultModel):budget=$([bool]$_.contextBudget)"}) -join '; ')} } | Format-Table -Wrap }`
> - Ran `function Show-All($p){Write-Output "=== $p ===";$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=1;$i -le $a.Count;$i++){"${i}:$($a[$i-1])"}}; Show-All 'D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.schema.ts'; Show-All 'D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\IntentParser.ts'`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\AgentRouter.ts'; rg -n "private async parseAllMentions|parseAllMentions\(|async resolveTargets\(|async peekTargets\(|extract.*Mention|match.*mention|speechMention" $p | Select-Object -First 120`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\AgentRouter.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 930 1045; Show-Lines 1150 1235; Show-Lines 1235 1345`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\AgentRouter.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 1148 1228`
> - Ran `$p='D:\AI\clower-1\clowder-ai\cat-template.json'; Select-String -LiteralPath $p -Pattern '"catId": "codex"|"maxPromptTokens"|"maxContextTokens"|"maxMessages"|"maxContentLengthPerMsg"|"clientId": "openai"' -Context 3,6 | ForEach-Object { "LINE $($_.LineNumber): $($_.Line)"; $_.Context.PreContext; $_.Context.PostContext; '---' }`
> - Ran `$p='D:\AI\clower-1\clowder-ai\cat-template.json'; Select-String -LiteralPath $p -Pattern '"id": "maine-coon"' | ForEach-Object { $_.LineNumber }; $a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=345;$i -le 500;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$test='D:\AI\clower-1\clowder-ai\packages\api\test'; rg --files $test | Where-Object { $_ -match 'prompt|context|route-serial|route-parallel|incremental|system|session-bootstrap|l0|message-route' } | Sort-Object | Select-Object -First 300`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts'; rg -n "function sanitizeInjectedContent|export function sanitizeInjectedContent|sanitizeInjectedContent" $p | Select-Object -First 50; function Show-Lines($s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 540 650`
> - Ran `$src='D:\AI\clower-1\clowder-ai\packages\api\src'; rg -n "function capturePromptIfEnabled|export function capturePromptIfEnabled|PROMPT_CAPTURE|isPromptCapture|bootstrapTraceStore|INJECTION_TRACE|traceStore" "$src\infrastructure\debug\prompt-capture-store.ts" "$src\infrastructure\debug\prompt-capture-bridge.ts" "$src\domains\prompt-hooks\trace-bootstrap.ts" "$src\index.ts" | Select-Object -First 220`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== $p [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; $src='D:\AI\clower-1\clowder-ai\packages\api\src'; Show-Lines "$src\infrastructure\debug\prompt-capture-store.ts" 1 20; Show-Lines "$src\infrastructure\debug\prompt-capture-store.ts" 315 345; Show-Lines "$src\domains\prompt-hooks\trace-bootstrap.ts" 1 30; Show-Lines "$src\index.ts" 470 505`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts'; $a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=100;$i -le 155;$i++){"${i}:$($a[$i-1])"}; rg -n "function needsMcpInjection|export function needsMcpInjection|buildMcpCallbackInstructions" 'D:\AI\clower-1\clowder-ai\packages\api\src' --glob '*.ts'`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\McpPromptInjector.ts'; $a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1;$i -le $a.Count;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\providers\ClaudeAgentService.ts'; rg -n "export function resolveDefaultClaudeMcpServerPath|function resolveDefaultClaudeMcpServerPath" $p; $a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=120;$i -le 180;$i++){"${i}:$($a[$i-1])"}`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\providers\ClaudeAgentService.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 270 310`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\types.ts'; rg -n "export interface AgentServiceOptions|export interface AgentService|systemPrompt|resumeFallbackSystemPrompt|injectsL0Natively|invoke\(" $p; $a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1;$i -le 230;$i++){"${i}:$($a[$i-1])"}`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\types.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 250 330`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\invoke-single-cat.ts'; rg -n "let sessionId|const sessionId|sessionManager\.get|sessionManager\.set|isSessionChainEnabled|sessionChainActive|sessionStrategy" $p | Select-Object -First 200`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\invoke-single-cat.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 990 1105`
> - Ran `$src='D:\AI\clower-1\clowder-ai'; rg -n "buildSystemPrompt\(" "$src" --glob '*.ts' --glob '*.js' --glob '!**/node_modules/**' | Select-Object -First 100; rg -n "assembleContext\(" "$src\packages\api\src" --glob '*.ts' | Select-Object -First 100`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\AgentRouter.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 1421 1538`
> - Ran `$src='D:\AI\clower-1\clowder-ai\packages\api\src'; rg -n "routeSerial\(" "$src" --glob '*.ts'; rg -n "contextHistory:|history:" "$src\domains\cats\services\agents" --glob '*.ts' | Select-Object -First 120`
> - Ran `$paths=@('D:\AI\clower-1\clowder-ai\packages\mcp-server\dist\index.js','D:\AI\clower-1\clowder-ai\packages\api\..\mcp-server\dist\index.js'); foreach($p in $paths){"$p => $(Test-Path -LiteralPath $p)"}; Get-ChildItem -LiteralPath 'D:\AI\clower-1\clowder-ai\packages\mcp-server' -Force | Select-Object Mode,Name`
> - Ran `Write-Output ('CAT_CAFE_MCP_SERVER_PATH=' + ($env:CAT_CAFE_MCP_SERVER_PATH ?? '<unset>')); Write-Output ('PROMPT_CAPTURE=' + ($env:PROMPT_CAPTURE ?? '<unset>')); Write-Output ('MEMORY_STORE=' + ($env:MEMORY_STORE ?? '<unset>')); Write-Output ('REDIS_URL_set=' + [bool]$env:REDIS_URL); Write-Output ('DEFAULT_CAT_ID=' + ($env:DEFAULT_CAT_ID ?? '<unset>'))`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\providers\CodexAgentService.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 741 835`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\session\SessionBootstrap.ts'; rg -n "export async function buildSessionBootstrap|MAX_|budget|drop|recall|threadMemory|digest|task|handoff|return" $p | Select-Object -First 220; (Get-Content -LiteralPath $p -Encoding UTF8).Count`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 790 925`
> - Ran `$src='D:\AI\clower-1\clowder-ai\packages\api\src'; rg -n "interface.*InvocationRecordStore|class .*InvocationRecordStore|create\(input|idempotencyKey|outcome: 'duplicate'|outcome" "$src\domains\cats\services" --glob '*InvocationRecord*' --glob '*.ts' | Select-Object -First 220`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== $p [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; $src='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores'; Show-Lines "$src\ports\InvocationRecordStore.ts" 1 180; rg -n "class RedisInvocationRecordStore|create\(|idempotency|NX|lua|multi" "$src\redis\RedisInvocationRecordStore.ts" | Select-Object -First 120; Show-Lines "$src\redis\RedisInvocationRecordStore.ts" 1 150`
> - Ran `$dir='D:\AI\clower-1\clowder-ai\assets\prompt-templates'; foreach($name in @('d1-identity-anchor.md','d7-mode-solo.md','c1-mcp-callback.md','s1-identity.md')){ $p=Join-Path $dir $name; Write-Output "=== $p ==="; if(Test-Path -LiteralPath $p){$i=0; Get-Content -LiteralPath $p -Encoding UTF8 | ForEach-Object {$i++; "${i}:$_"}} else {'MISSING'} }; Write-Output '=== L0 template start ==='; $p='D:\AI\clower-1\clowder-ai\assets\system-prompts\system-prompt-l0.md'; $i=0; Get-Content -LiteralPath $p -Encoding UTF8 | Select-Object -First 120 | ForEach-Object {$i++; "${i}:$_"}`
> - Ran `Test-Path -LiteralPath 'D:\AI\clower-1\clowder-ai\packages\api\dist'; Test-Path -LiteralPath 'D:\AI\clower-1\clowder-ai\node_modules'; Test-Path -LiteralPath 'D:\AI\clower-1\clowder-ai\packages\api\node_modules'; Get-ChildItem -LiteralPath 'D:\AI\clower-1\clowder-ai' -Force | Where-Object {$_.Name -in @('node_modules','pnpm-lock.yaml')} | Select-Object Name,Mode`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\ContextAssembler.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 118 166`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\navigation-context.ts'; rg -n "export function formatNavigationHeader|return|lines.push" $p | Select-Object -First 120; function Show-Lines($s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 100 190`
> - Ran `$p='D:\AI\clower-1\clowder-ai\assets\prompt-templates\n1-navigation.md'; if(Test-Path -LiteralPath $p){$i=0;Get-Content -LiteralPath $p -Encoding UTF8|%{$i++;"${i}:$_"}}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\invoke-single-cat.ts'; rg -n "function appendTranscriptPathHints|appendTranscriptPathHints" $p; function Show-Lines($s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 720 790`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\providers\transcript-path-hints.ts'; $a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1;$i -le $a.Count;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\StagingContent.ts'; $a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1;$i -le $a.Count;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\cat-cafe-skills\refs\l0-staging-content.md'; if(Test-Path -LiteralPath $p){$a=Get-Content -LiteralPath $p -Encoding UTF8; "lines=$($a.Count)"; for($i=1;$i -le [Math]::Min(100,$a.Count);$i++){"${i}:$($a[$i-1])"}} else {'MISSING'}`
> - Ran `Get-ChildItem -LiteralPath 'D:\AI\clower-1\clowder-ai' -Force | Where-Object {$_.Name -match 'skill|cat-cafe'} | Select-Object Mode,Name,FullName; Test-Path -LiteralPath 'D:\AI\clower-1\clowder-ai\cat-cafe-skills'; rg --files 'D:\AI\clower-1\clowder-ai' -g 'l0-staging-content.md' -g '!**/node_modules/**'`
> - Ran `Get-ChildItem -LiteralPath 'D:\AI\clower-1\clowder-ai\cat-cafe-skills' -Force | Select-Object Mode,Name; if(Test-Path -LiteralPath 'D:\AI\clower-1\clowder-ai\cat-cafe-skills\refs'){Get-ChildItem -LiteralPath 'D:\AI\clower-1\clowder-ai\cat-cafe-skills\refs' -Force | Select-Object Name,Length | Sort-Object Name | Select-Object -First 100} else {'NO refs'}`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\MessageStore.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 571 630`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\SystemPromptBuilder.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 840 970`
> - Ran `foreach($n in @('d15-voice-off.md','d15-voice-on.md')){$p="D:\AI\clower-1\clowder-ai\assets\prompt-templates\$n";Write-Output "=== $n ===";$i=0;Get-Content -LiteralPath $p -Encoding UTF8|%{$i++;"${i}:$_"}}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\SystemPromptBuilder.ts'; $a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=626;$i -le 646;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$src='D:\AI\clower-1\clowder-ai\packages\api\src'; rg -n "function assertStorageReady|export function assertStorageReady" "$src" --glob '*.ts'; $p=(rg -l "export function assertStorageReady|function assertStorageReady" "$src" --glob '*.ts' | Select-Object -First 1); if($p){$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=1;$i -le $a.Count;$i++){"${i}:$($a[$i-1])"}}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\SessionContinuationCoordinator.ts'; rg -n "export class|prepareInvocationContext|return|content|capsule|sessionPolicy|consume" $p | Select-Object -First 200; (Get-Content -LiteralPath $p -Encoding UTF8).Count`
>
> </details>
>
> 核心热路径已经定位清楚，并发现两个很容易讲错、但很有面试价值的事实：
>
> 1. 当前消息路由的主路径不是“一次调用 `buildSystemPrompt()` 得到完整字符串”，而是分阶段组装；`buildSystemPrompt()` 在 `src` 中没有运行时调用点，热路径实际分别调用静态身份构造、动态调用上下文、增量历史组装，再由 `invokeSingleCat()` 做最后一轮前缀合并。
> 2. 虽然有 `ContextAssembler.assembleContext()`，但当前 `POST /api/messages → routeExecution()` 主链会带 `currentUserMessageId`，而 `AgentRouter` 总会持有 `DeliveryCursorStore`，所以正常会走 `assembleIncrementalContext()`；老的整段历史组装分支在这条实际入口上不会命中。
>
> 我会把这两点作为第一篇主线，而不是照着文件名讲。
>
> <details><summary>Ran 3 commands</summary>
>
> - Ran `git -c safe.directory='D:/AI/clower-1/clowder-ai' -C 'D:\AI\clower-1\clowder-ai' status --short --branch; git -c safe.directory='D:/AI/clower-1/clowder-ai' -C 'D:\AI\clower-1\clowder-ai' diff --stat; Write-Output '=== focused source callsite checks ==='; rg -n "buildSystemPrompt\(" 'D:\AI\clower-1\clowder-ai\packages\api\src' --glob '*.ts'; rg -n "assembleContext\(" 'D:\AI\clower-1\clowder-ai\packages\api\src' --glob '*.ts'; rg -n "assembleIncrementalContext\(" 'D:\AI\clower-1\clowder-ai\packages\api\src' --glob '*.ts'`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; $p='D:\AI\clower-1\clowder-ai\scripts\compile-system-prompt-l0.mjs'; Show-Lines $p 446 491; $p2='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\providers\l0-compiler.ts'; Show-Lines $p2 90 180; Show-Lines $p2 180 245`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\AgentRouter.ts'; $a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1738;$i -le 1753;$i++){"${i}:$($a[$i-1])"}`
>
> </details>
</details>

# 调查基线与结论

## 1. 本地版本基线

- **调查日期**：2026 年 9 月 18 日
- **真实仓库根目录**：`D:\AI\clower-1\clowder-ai`
- **分支**：`main`
- **Commit**：`6868041cae3b9dcab163a1fd85845b9778c3adc5`
- **Commit 说明**：`fix(issue-1032): disable PWA online hard reload (#1089)`
- **工作区**：`git status` 未显示源码改动。
- **适用说明**：已读取仓库根目录的 [`D:\AI\clower-1\clowder-ai\AGENTS.md:1-25`](./clowder-ai/AGENTS.md#L1-L25)。

本轮没有：

- 修改任何源码、配置、依赖或测试；
- 启动 API、Redis 或 Agent CLI；
- 连接数据库；
- 调用模型或外部接口；
- 运行可能写临时状态的测试。

因此下面的结论属于：

> **当前 commit 上的源码级静态追踪 + 确定性算法推演**，不是线上运行抓包，也不是端到端测试结果。

---

# 一、先给出模块边界

## 1. 这个模块解决的业务问题

用户看到的是一句：

```text
@codex #execute 请检查支付回调的并发重复执行风险
```

但真正发给模型的输入必须同时携带：

1. 这只猫是谁、有什么角色和硬约束；
2. 当前是单猫、串行还是并行模式；
3. 谁把任务传给它、是否属于 A2A 接力；
4. 当前 thread 中哪些消息它尚未看到；
5. whisper、内部消息、别的猫的思考流哪些不能看；
6. 上个 session 留下了什么摘要、任务和 handoff；
7. 当前有哪些 MCP 或 HTTP callback 能力；
8. 是否有 Pack、Guide、World、Signal、SOP 等条件上下文；
9. 整体是否超出当前猫的 Prompt 预算；
10. 最终应通过 provider 的哪个通道发送：用户文本、原生 system/developer channel，还是 CLI 参数。

所以它不是简单的：

```ts
finalPrompt = systemPrompt + history + userMessage;
```

更准确地说，它是一个**分层编译流水线**：

```text
HTTP 消息
  → 路由与持久化
  → 每轮动态上下文
  → 增量历史/智能窗口
  → session 接力材料
  → invocation 级二次前缀
  → provider 原生 L0 通道 + 本轮 Prompt 通道
  → CLI/SDK
```

---

## 2. 我给“prompt 组装全链路”划定的边界

### 纳入本模块

从：

```text
POST /api/messages
```

开始，一直追踪到：

```ts
service.invoke(effectivePrompt, options)
```

以及具体 Provider 将其转换为 CLI/SDK 参数为止。

核心链路是：

```text
messagesRoutes
  → AgentRouter.routeExecution
  → routeSerial / routeParallel
  → buildStaticIdentity* / buildInvocationContext
  → assembleIncrementalContext
  → buildSessionBootstrap
  → invokeSingleCat
  → AgentService.invoke
```

### 相邻但不作为主角

- `MessageStore`：提供原始消息和持久化，不负责决定 Prompt 结构。
- `InvocationQueue`：决定什么时候执行，不负责 Prompt 内容。
- `SessionSealer`：产生下一次 bootstrap 所需材料。
- Memory/Evidence/Task/World 服务：是上下文数据源。
- Provider event parser：解析模型输出，属于下游。
- WebSocket 广播：展示输出，属于通知层。

但在影响 Prompt 正确性、并发或恢复时，我仍会追踪这些边界。

---

## 3. 三个容易被文件名误导的关键结论

### 结论 A：当前热路径没有调用 `buildSystemPrompt()`

[`buildSystemPrompt()`](./clowder-ai/packages/api/src/domains/cats/services/context/SystemPromptBuilder.ts#L1071-L1093) 仍然存在，但对 `packages/api/src` 的调用点搜索只有它自己的定义。

真实热路径拆成了：

```ts
buildStaticIdentity(...)
buildStaticIdentityPackOnly(...)
buildInvocationContext(...)
```

调用证据在：

- [`route-serial.ts:682-798`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L682-L798)
- [`route-parallel.ts:230-300`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-parallel.ts#L230-L300)

所以面试时不能回答：

> “项目有一个 `buildSystemPrompt()`，把系统提示词都拼起来。”

更准确的回答是：

> 当前热路径把静态 L0、Pack 静态块、本轮动态上下文、历史增量和 invocation 前缀分阶段组装，`buildSystemPrompt()` 主要是兼容/测试接口，不是生产消息入口的总装函数。

---

### 结论 B：普通消息主路径走的是增量上下文，不是 `assembleContext()`

`routeSerial()` 的判断是：

```ts
const incrementalMode = Boolean(currentUserMessageId && deps.deliveryCursorStore);
```

见 [`route-serial.ts:458-494`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L458-L494)。

而当前真实装配中：

- `AgentRouter` 总会创建或接收一个 `DeliveryCursorStore`：
  [`AgentRouter.ts:735-776`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/AgentRouter.ts#L735-L776)
- `routeExecution()` 的 `userMessageId` 是必填参数：
  [`AgentRouter.ts:1542-1593`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/AgentRouter.ts#L1542-L1593)
- `messages.ts` 把已存储的消息 ID 传进去：
  [`messages.ts:1203-1209`](./clowder-ai/packages/api/src/routes/messages.ts#L1203-L1209)

因此正常路径会进入：

```ts
assembleIncrementalContext(...)
```

而不是：

```ts
assembleContext(...)
```

传统的 `assembleContext()` 只位于 `incrementalMode === false` 的后备分支：

[`route-serial.ts:978-1019`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L978-L1019)

---

### 结论 C：最终不是“一个 Prompt 字符串”，而是至少两个通道

以 Codex Provider 为例：

1. **非 Pack 的静态 L0**
   通过 Codex CLI 的 `developer_instructions` 配置传递。

2. **本轮动态 Prompt**
   通过 stdin 传给 `codex exec`。

这两个通道由不同代码生成，不能混为一谈。

---

# 二、真实启动、注册与依赖注入

## 1. Provider 是如何装配的

启动时先加载运行时猫配置，并为每只猫创建对应 `AgentService`：

```ts
switch (config.clientId) {
  case 'openai':
    service = new CodexAgentService({ catId });
    break;
  // ...
}
agentRegistry.register(id, service);
```

实际代码：

[`index.ts:1220-1328`](./clowder-ai/packages/api/src/index.ts#L1220-L1328)

注册完成后还会预热各猫的 L0：

```ts
await warmL0Cache(registeredCatIds, app.log);
```

见 [`index.ts:1335-1344`](./clowder-ai/packages/api/src/index.ts#L1335-L1344)。

注意其语义：

- 启动时预热失败只记录 warning；
- 真正 invocation 时还会重试；
- invocation 阶段若仍编译失败，则 Codex Provider **fail-closed**，不允许没有身份与治理规则的猫继续执行。

---

## 2. Router 是如何装配的

`AgentRouter` 接收的不是只有 Agent 服务，它还接收：

- MessageStore
- DeliveryCursorStore
- SessionChainStore
- TranscriptReader/Writer
- TaskStore
- EvidenceStore
- PackStore
- WorldStore
- GuideStore
- ConciergeStore
- SocketManager

实际装配见：

[`index.ts:1598-1638`](./clowder-ai/packages/api/src/index.ts#L1598-L1638)

这解释了为什么 Prompt 组装看上去“横跨很多模块”：这些模块不是都在修改同一个字符串，而是在 invocation 时作为**条件数据源**被查询。

---

## 3. HTTP 入口如何拿到 Router

`index.ts` 把同一个 Router 注入 `messagesRoutes`：

[`index.ts:1725-1805`](./clowder-ai/packages/api/src/index.ts#L1725-L1805)

真实入口是：

```ts
app.post('/api/messages', async (request, reply) => {
```

见 [`messages.ts:378-435`](./clowder-ai/packages/api/src/routes/messages.ts#L378-L435)。

---

## 4. 持久化装配

项目默认要求 Redis 可用；只有显式设置 `MEMORY_STORE=1` 才允许内存模式：

[`index.ts:544-574`](./clowder-ai/packages/api/src/index.ts#L544-L574)

消息存储工厂为：

```ts
if (redis) return new RedisMessageStore(...);
return new MessageStore(...);
```

见 [`MessageStoreFactory.ts:27-39`](./clowder-ai/packages/api/src/domains/cats/services/stores/factories/MessageStoreFactory.ts#L27-L39)。

所以：

- Redis 模式下，消息和 delivery cursor 可跨进程重启；
- 内存模式下，它们只在当前进程生存；
- “Prompt 组装算法相同”不等于“恢复保证相同”。

---

# 三、完整分篇路线

## 第一篇：一条用户消息如何变成 Codex CLI 的两路输入——本篇展开

覆盖：

- HTTP 校验；
- @mention 与 intent；
- 并发占槽和幂等记录；
- 用户消息先持久化；
- `routeExecution → routeSerial`；
- 动态上下文；
- 增量历史；
- Prompt 预算；
- `invokeSingleCat` 二次包装；
- Codex `developer_instructions + stdin`。

---

## 第二篇：Prompt 分层真相——L0、S、D、C、N、M 各是什么

重点拆：

- L0 编译器；
- S1-S13 静态段；
- D1-D21 本轮动态段；
- C1 MCP fallback；
- N1/N2 导航与历史；
- M1/M2 invocation 前缀；
- Pack、Governance、用户 Capsule；
- template overlay 与 Prompt Injection Console；
- 哪些段每轮注入、哪些只在 session 创建时注入；
- `buildSystemPrompt()` 为什么已经不是主链总入口。

依赖第一篇建立的执行骨架。

---

## 第三篇：增量上下文与预算算法

重点拆：

- `(userId, catId, threadId)` delivery cursor；
- `getByThreadAfter()`；
- whisper 与 thinking stream 可见性；
- reply preview；
- rich block digest；
- current message 去重；
- `maxPromptTokens / maxContextTokens / maxMessages / per-message chars`；
- tokenizer、双重保守预算；
- cursor 何时 ack；
- Redis CAS 与内存降级。

---

## 第四篇：冷启动 Smart Window

重点拆：

- `>15` 条或 `>10000` token 的触发条件；
- recent burst；
- tombstone；
- anchors；
- ThreadMemory；
- Evidence recall；
- Coverage Map；
- 最终降级顺序；
- 超时和 fail-open；
- 已扫描但最终没有进入 Prompt 的工作。

---

## 第五篇：Session、续接与上下文压缩

重点拆：

- SessionManager 与 SessionChainStore；
- fresh、resume、reborn；
- SessionBootstrap；
- handoff note、digest、task、recall 的预算和丢弃顺序；
- pending continuation 如何原子消费和失败恢复；
- context management hint；
- session stale/self-heal；
- fresh retry 时如何重新注入静态内容。

---

## 第六篇：串行、并行与 A2A Prompt 差异

重点拆：

- execute 与 ideate；
- serial worklist 如何增长；
- `previousResponses`；
- A2A `directMessageFrom`；
- ping-pong guard；
- parallel 每只猫的独立上下文；
- per-cat abort；
- remedial routing guard；
- 为什么 parallel 不继续 A2A 链。

---

## 第七篇：Provider 适配矩阵

逐个核查：

- Claude
- Codex
- Gemini
- OpenCode
- ACP
- Antigravity
- CatAgent
- A2A/Cloud bridge

回答：

- 谁有原生 L0 通道；
- 谁只能文本 prepend；
- systemPrompt 是否可能重复；
- session resume 参数；
- 图片如何传；
- Prompt 是进 argv、stdin、文件还是 HTTP body；
- 超时是否真的终止底层进程。

---

## 第八篇：可靠性、并发、可观测性与面试总复盘

覆盖：

- 队列与立即执行竞态；
- InvocationRecord 状态机；
- 幂等边界；
- Prompt 已发送但 cursor 未 ack；
- 重试是否可能重复工具副作用；
- 进程崩溃后的恢复能力；
- Prompt Capture、Injection Trace；
- 默认关闭与条件启用功能；
- 已确认行为、潜在风险、尚未复现问题；
- 项目级面试连续追问。

---

# 第一篇：一条用户消息如何变成 Codex CLI 的两路输入

# 1. 本篇贯穿场景

以下是**示意数据，不是运行日志**。

用户请求：

```json
{
  "content": "@codex #execute 请检查支付回调的并发重复执行风险",
  "threadId": "thread-pay-42",
  "idempotencyKey": "11111111-1111-4111-8111-111111111111"
}
```

身份来自请求头或 session：

```text
userId = user-7
```

进入请求前已有状态：

```text
deliveryCursor(user-7, codex, thread-pay-42) = M001

M001: co-creator 说明了支付业务
M002: opus 通过 callback 留下一条分析
```

本次请求存储后生成：

```text
M003: @codex #execute 请检查支付回调的并发重复执行风险
```

为了把一条确定分支讲闭合，本篇固定以下条件：

- thread 存在且未删除；
- 没有正在运行的 invocation；
- public 消息，不是 whisper；
- 单猫 `@codex`；
- 无图片、无 replyTo；
- Codex 是 fresh session；
- 没有激活 Pack、World、Guide 或上轮 Bootstrap；
- 示例中假设原生 Cat Cafe MCP 路径不可用，因此注入 C1 HTTP callback fallback；
- 这只是固定分支，不代表生产环境永远如此。

---

# 2. 第一步：请求校验

JSON 请求先过 Zod：

```ts
content: z.string().min(1).max(100000),
threadId: z.string().min(1).max(100).optional(),
idempotencyKey: z.string().uuid().optional(),
deliveryMode: z.enum(['immediate', 'queue', 'force']).optional(),
```

实际代码：

[`messages.schema.ts:14-35`](./clowder-ai/packages/api/src/routes/messages.schema.ts#L14-L35)

然后：

```ts
const parseResult = sendMessageSchema.safeParse(request.body);
```

失败直接返回 `400`，不会写消息，也不会组 Prompt：

[`messages.ts:419-435`](./clowder-ai/packages/api/src/routes/messages.ts#L419-L435)

## 一个隐藏细节：`mentions` 字段并不是路由真相源

Schema 中虽然接受：

```ts
mentions: z.array(catIdSchema()).optional()
```

但 JSON 解构时并没有读取 `parseResult.data.mentions`；实际路由使用的是：

```ts
router.resolveTargetsAndIntent(content, ...)
```

因此当前入口下：

> **目标猫来自 `content` 里的 `@mention`，不是请求体中的 `mentions` 数组。**

面试时如果说“前端把 mentions 数组传给后端，后端直接按数组路由”，会与当前实现不符。

---

# 3. 第二步：识别 `@codex` 和 `#execute`

## 3.1 mention 解析

Router 每次解析时会：

1. 收集所有猫配置中的 `mentionPatterns`；
2. 按字符串长度降序排序，优先最长匹配；
3. 扫描用户文本里的显式 `@`；
4. 去重；
5. 保留出现顺序；
6. 对未知或禁用的 mention 形成 `routing_warnings`。

核心代码：

```ts
allPatterns.sort((a, b) => b.pattern.length - a.pattern.length);

forEachUserMentionCandidate(lowerMessage, (pos) => {
  const matched = findMentionPatternAt(lowerMessage, pos, allPatterns);
  if (matched) {
    recordResolvedMention(...);
    return;
  }
  recordUnknownMentionWarning(...);
});
```

见 [`AgentRouter.ts:970-1024`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/AgentRouter.ts#L970-L1024)。

当前模板中 Codex 的 mention 包括：

```json
["@codex", "@缅因猫", "@缅因", "@maine", "@砚砚"]
```

它的 `clientId` 是 `openai`，默认模型配置为 `gpt-5.3-codex`：

[`cat-template.json:353-390`](./clowder-ai/cat-template.json#L353-L390)

因此示例得到：

```ts
targetCats = ['codex']
hasMentions = true
```

因为调用使用了 `{ persist: true }`，显式 mention 还会被写入 thread participants：

[`messages.ts:615-633`](./clowder-ai/packages/api/src/routes/messages.ts#L615-L633)

---

## 3.2 intent 解析

`IntentParser` 规则是：

```text
显式 #ideate  → ideate
显式 #execute → execute
无显式标签且目标猫数量 ≥ 2 → ideate
否则 → execute
```

见 [`IntentParser.ts:38-58`](./clowder-ai/packages/api/src/domains/cats/services/context/IntentParser.ts#L38-L58)。

示例得到：

```ts
intent = {
  intent: 'execute',
  explicit: true,
  promptTags: []
}
```

注意：

- 原始消息存储时仍保留 `#execute`；
- 真正交给 `routeSerial()` 的 `message` 会经过 `stripIntentTags()`；
- `@codex` 不会被移除。

所以后面的数据会出现两个版本：

```text
持久化版本：
@codex #execute 请检查支付回调的并发重复执行风险

routeSerial 参数版本：
@codex 请检查支付回调的并发重复执行风险
```

删除标签发生在：

[`AgentRouter.ts:1591-1594`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/AgentRouter.ts#L1591-L1594)

---

# 4. 第三步：决定立即执行还是排队

代码先检查目标猫是否忙：

```ts
const mode = deliveryMode ?? (hasActive ? 'queue' : 'immediate');
```

见 [`messages.ts:657-692`](./clowder-ai/packages/api/src/routes/messages.ts#L657-L692)。

示例中没有活动 invocation，因此：

```text
mode = immediate
```

## 如果猫正在忙会怎样

默认不是继续组装 Prompt，而是：

1. 先 enqueue；
2. 再写一条 `deliveryStatus: 'queued'` 的用户消息；
3. 返回 `202 queued`；
4. 直到出队时才真正执行 Prompt 组装。

排队消息被标记为：

```ts
deliveryStatus: 'queued'
```

见 [`messages.ts:694-790`](./clowder-ai/packages/api/src/routes/messages.ts#L694-L790)。

而历史读取会排除未投递消息：

```ts
if (!isDelivered(msg)) continue;
```

见 [`MessageStore.ts:571-605`](./clowder-ai/packages/api/src/domains/cats/services/stores/ports/MessageStore.ts#L571-L605)。

所以：

> “消息已经写入 MessageStore”不代表它已经进入 Prompt。排队消息必须先转成 delivered。

---

# 5. 第四步：占槽、幂等记录、消息持久化

## 5.1 为什么先占槽

最初的 `hasActive` 检查和真正执行之间存在 await，另一个请求可能插进来。

因此代码在创建 InvocationRecord 前调用：

```ts
tryStartThreadAll(threadId, targetCats, userId)
```

如果这时发现线程刚刚变忙，就降级为 queue。

真实代码：

[`messages.ts:831-920`](./clowder-ai/packages/api/src/routes/messages.ts#L831-L920)

这保护的是：

> 当前进程中的“检查空闲 → 注册执行槽”竞态。

它不是数据库级全局锁。多进程保证还要依赖 Redis InvocationRecord 等后续组件，不能仅凭这个内存 tracker 宣称全局原子。

---

## 5.2 创建 InvocationRecord

接下来创建：

```ts
{
  threadId: 'thread-pay-42',
  userId: 'user-7',
  targetCats: ['codex'],
  intent: 'execute',
  idempotencyKey: '1111...'
}
```

初始记录的重要字段为：

```ts
{
  userMessageId: null,
  status: 'queued'
}
```

数据结构见：

[`InvocationRecordStore.ts:15-56`](./clowder-ai/packages/api/src/domains/cats/services/stores/ports/InvocationRecordStore.ts#L15-L56)

Redis 实现把“检查幂等键 + 创建记录”放进同一个 Lua 脚本：

```lua
local existing = redis.call('GET', KEYS[1])
if existing then
  return {'duplicate', existing}
end

redis.call('SET', KEYS[1], ARGV[1], 'EX', ...)
redis.call('HSET', KEYS[2], ..., 'status', 'queued', ...)
return {'created', ARGV[1]}
```

见 [`RedisInvocationRecordStore.ts:33-46`](./clowder-ai/packages/api/src/domains/cats/services/stores/redis/RedisInvocationRecordStore.ts#L33-L46)。

### 幂等边界

只有客户端重复使用**同一个** `idempotencyKey` 时，才能得到原 invocation。

如果客户端没传，服务器每次请求都会重新：

```ts
randomUUID()
```

因此：

> 客户端不提供稳定幂等键时，网络重试仍可能产生两次独立 invocation。

---

## 5.3 写入用户消息

InvocationRecord 创建成功后才写用户消息：

```ts
storedUserMessage = await opts.messageStore.append({
  userId,
  catId: null,
  content,
  mentions: targetCats,
  timestamp: Date.now(),
  threadId: resolvedThreadId,
});
```

见 [`messages.ts:971-1014`](./clowder-ai/packages/api/src/routes/messages.ts#L971-L1014)。

得到的消息大致是：

```ts
{
  id: 'M003',
  threadId: 'thread-pay-42',
  userId: 'user-7',
  catId: null,
  content: '@codex #execute 请检查支付回调的并发重复执行风险',
  mentions: ['codex'],
  timestamp: 1758...
}
```

然后把 `M003` 回填到 InvocationRecord：

```ts
await invocationRecordStore.update(invocationId, {
  userMessageId: storedUserMessage.id,
});
```

---

## 5.4 HTTP 返回不等于模型已经完成

此时 HTTP 就返回：

```json
{
  "status": "processing",
  "invocationId": "...",
  "userMessageId": "M003"
}
```

见 [`messages.ts:1016-1027`](./clowder-ai/packages/api/src/routes/messages.ts#L1016-L1027)。

模型调用是在一个未等待的后台异步函数里继续：

```ts
void (async () => {
  // ...
})();
```

所以：

> HTTP 200/processing 只表示“调用记录和用户消息已经建立，后台开始处理”，不表示 Prompt 已发送成功，更不表示模型成功响应。

---

# 6. 第五步：进入 `routeExecution()`

后台执行前还有一个条件步骤：

```ts
sessionContinuationCoordinator.prepareInvocationContext(...)
```

它只对单猫 invocation 生效，可能把 pending continuation capsule 前置到 `content`。

见 [`messages.ts:1161-1191`](./clowder-ai/packages/api/src/routes/messages.ts#L1161-L1191)。

本例没有 pending continuation，因此内容不变。

随后调用：

```ts
router.routeExecution(
  userId,
  content,
  threadId,
  storedUserMessage.id,
  targetCats,
  intent,
  ...
)
```

见 [`messages.ts:1203-1248`](./clowder-ai/packages/api/src/routes/messages.ts#L1203-L1248)。

Router 做两件关键事情：

```ts
const cleanMessage = stripIntentTags(message);
const strategy =
  intent.intent === 'ideate' && targetCats.length > 1
    ? 'parallel'
    : 'serial';
```

见 [`AgentRouter.ts:1591-1616`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/AgentRouter.ts#L1591-L1616)。

本例：

```text
cleanMessage = "@codex 请检查支付回调的并发重复执行风险"
strategy = serial
```

然后进入：

```ts
routeSerial(...)
```

[`AgentRouter.ts:1681-1717`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/AgentRouter.ts#L1681-L1717)

---

# 7. 第六步：静态身份和本轮动态上下文分开生成

## 7.1 Codex 声明自己有原生 L0 通道

```ts
injectsL0Natively(): boolean {
  return true;
}
```

见 [`CodexAgentService.ts:699-716`](./clowder-ai/packages/api/src/domains/cats/services/agents/providers/CodexAgentService.ts#L699-L716)。

于是 `routeSerial()` 不再构建完整的文本版静态身份，而只构建 Pack 部分：

```ts
const staticIdentity = hasNativeL0
  ? buildStaticIdentityPackOnly(catId, { packBlocks })
  : buildStaticIdentity(catId, { mcpAvailable, packBlocks });
```

见 [`route-serial.ts:673-700`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L673-L700)。

`buildStaticIdentityPackOnly()` 如果没有激活 Pack，直接返回空串：

```ts
if (!pb) return '';
```

见 [`SystemPromptBuilder.ts:626-634`](./clowder-ai/packages/api/src/domains/cats/services/context/SystemPromptBuilder.ts#L626-L634)。

因此本例：

```text
staticIdentity = ""
```

这不代表 Codex 没有身份，而是：

> 非 Pack 的身份、治理、协作规则走另一条原生 L0 通道。

---

## 7.2 动态 InvocationContext

`routeSerial()` 构造：

```ts
const invocationContext = buildInvocationContext({
  catId,
  mode: 'independent',
  chainIndex: 1,
  chainTotal: 1,
  teammates: [],
  mcpAvailable,
  nativeL0Injected: true,
  a2aEnabled: true,
  // 其他条件字段
});
```

调用位置：

[`route-serial.ts:772-798`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L772-L798)

本例至少产生以下真实模板段。

### D1：身份锚点

模板原文：

```text
Identity: {{DISPLAY_NAME}}{{NICKNAME_PART}} (@{{CAT_ID}}, model={{RUNTIME_MODEL}})
```

[`d1-identity-anchor.md:1-5`](./clowder-ai/assets/prompt-templates/d1-identity-anchor.md#L1-L5)

示意渲染：

```text
Identity: 缅因猫/砚砚 (@codex, model=gpt-5.3-codex)
```

### D7：独立回答模式

```text
当前模式：独立回答。
```

[`d7-mode-solo.md:1-4`](./clowder-ai/assets/prompt-templates/d7-mode-solo.md#L1-L4)

### D15：Voice Mode

即使 voice mode 没开，也会显式注入一个 OFF 段：

[`SystemPromptBuilder.ts:854-861`](./clowder-ai/packages/api/src/domains/cats/services/context/SystemPromptBuilder.ts#L854-L861)

---

## 7.3 MCP callback 条件

判断为：

```ts
const mcpAvailable =
  (catConfig?.mcpSupport ?? false) && !!mcpServerPath;

const mcpInstructions = needsMcpInjection(mcpAvailable, catConfig?.clientId)
  ? buildMcpCallbackInstructions(...)
  : '';
```

见 [`route-serial.ts:682-707`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L682-L707)。

若原生 MCP 不可用，就注入 C1：

```text
## 协作方式
...
凭证: $CAT_CAFE_INVOCATION_ID + $CAT_CAFE_CALLBACK_TOKEN
可用工具: post-message / thread-context / ...
```

模板见：

[`c1-mcp-callback.md:5-21`](./clowder-ai/assets/prompt-templates/c1-mcp-callback.md#L5-L21)

它不是无条件存在：

- 原生 MCP 可用：不注入；
- Antigravity：明确跳过；
- 其他无 MCP Provider：注入 HTTP fallback。

判断代码：

[`McpPromptInjector.ts:32-65`](./clowder-ai/packages/api/src/domains/cats/services/agents/invocation/McpPromptInjector.ts#L32-L65)

---

# 8. 第七步：读取“Codex 尚未见过”的消息

## 8.1 为什么增量模式一定命中

```ts
const incrementalMode =
  Boolean(currentUserMessageId && deps.deliveryCursorStore);
```

本例两者都存在，因此进入：

```ts
assembleIncrementalContext(...)
```

---

## 8.2 输入状态

```text
cursor = M001
unseen = [M002, M003]
```

读取代码：

```ts
const cursor =
  await deliveryCursorStore.getCursor(userId, catId, threadId);

const unseen =
  await messageStore.getByThreadAfter(threadId, cursor, undefined, userId);
```

见 [`route-helpers.ts:719-734`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L719-L734)。

---

## 8.3 可见性过滤

过滤规则按代码实际顺序是：

```ts
if (m.userId === 'system') return false;
if (m.origin === 'briefing') return false;
if (!canViewMessage(m, viewer)) return false;
if (!m.extra?.crossPost && m.catId === catId) return false;
if (playMode && m.catId !== null && m.origin === 'stream') return false;
```

见 [`route-helpers.ts:735-752`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L735-L752)。

人话解释：

| 消息 | 是否进入 Prompt |
|---|---:|
| 用户 public 消息 | 是 |
| 发给当前猫的 whisper | 是 |
| 发给别人的 whisper | 否 |
| system 展示消息 | 否 |
| context briefing | 否 |
| 当前猫自己以前的普通输出 | 否 |
| 其他猫的 callback 发言 | 是 |
| play mode 下其他猫的 CLI stream 思考 | 否 |
| debug mode 下其他猫的 stream | 可见 |

因此本例：

```text
relevant = [M002, M003]
```

---

## 8.4 当前消息泄漏保护

代码专门计算：

```ts
currentMessageFilteredOut =
  currentId 存在于 unseen
  && 不存在于 relevant
```

见 [`route-helpers.ts:754-761`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L754-L761)。

这是为了解决：

> 如果当前消息是一个不应让这只猫看到的 whisper，不能因为“历史里没找到当前消息”而把原始文本再补进去，否则就泄漏了。

---

# 9. 第八步：Warm Path 还是 Smart Window

当前默认判断：

```ts
const countTrigger = relevant.length > 15;

const tokenTrigger =
  !countTrigger &&
  relevant.reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0
  ) > 10_000;
```

见：

- [`route-helpers.ts:832-840`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L832-L840)
- [`hierarchical-context-config.ts:28-38`](./clowder-ai/packages/api/src/config/hierarchical-context-config.ts#L28-L38)

本例：

```text
relevant.length = 2
token 数远小于 10000
```

因此走 **warm path**。

### 为什么先判断数量

如果消息已经超过 15 条，代码不会再遍历所有内容做 tokenizer 计算。

这是一种短路优化：

- 数量已足够触发 cold path；
- 再 tokenize 没有决策价值；
- 避免一次额外的 O(总文本 token 数) 扫描。

---

# 10. 第九步：即使是 Warm Path，也先构建导航上下文

在决定 warm/cold 之前，代码已经可能做了这些工作：

1. 查询当前 thread 的 tasks；
2. 查 active session 的 files touched；
3. 读 ThreadMemory 中的旧 artifact ledger；
4. 合并当前 artifact；
5. 排序 truth source；
6. 构建 `[导航]` 头。

见 [`route-helpers.ts:770-817`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L770-L817)。

所以：

> 最终导航块为空，不代表这些读取和计算没有发生。

这是面试中可以体现源码深度的点。

导航模板固定为：

```text
[导航]
{{INNER_CONTENT}}
[/导航]
```

[`n1-navigation.md:1-7`](./clowder-ai/assets/prompt-templates/n1-navigation.md#L1-L7)

---

# 11. 第十步：消息格式化与 token 裁剪

## 11.1 格式化

每条消息最终大致变成：

```text
[M002] [12:01 布偶猫] 支付业务要求同一个回调只执行一次
[M003] [12:02 co-creator] @codex #execute 请检查支付回调的并发重复执行风险
```

每行外层的 `[M003]` 来自增量组装器：

```ts
return `[${m.id}] ${rendered}`;
```

消息内部格式来自：

```ts
return `[${time} ${sender}${crossPostTag}] ${replyPrefix}${content}`;
```

见：

- [`route-helpers.ts:920-930`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L920-L930)
- [`ContextAssembler.ts:124-164`](./clowder-ai/packages/api/src/domains/cats/services/context/ContextAssembler.ts#L124-L164)

注意：这里读的是已经持久化的 M003，所以仍然含有 `#execute`。

---

## 11.2 Prompt 总预算

Codex 当前模板预算是：

```text
maxPromptTokens  = 240000
maxContextTokens = 216000
maxMessages      = 200
per-message chars = 100000
```

[`cat-template.json:386-390`](./clowder-ai/cat-template.json#L386-L390)

路由计算：

```ts
effectiveContextBudget = min(
  max(
    0,
    maxPromptTokens
      - incSystemTokens
      - incMessageTokens
      - 200
  ),
  maxContextTokens
)
```

实际代码：

[`route-serial.ts:888-915`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L888-L915)

变量映射：

- `maxPromptTokens`：整个本地 Prompt 预算上限；
- `incSystemTokens`：本轮可见的静态 Pack、动态 InvocationContext、mode、bootstrap、MCP fallback；
- `incMessageTokens`：当前经过 `stripIntentTags()` 的请求文本；
- `200`：固定 guard；
- `maxContextTokens`：历史上下文自身的硬上限。

Token 估算实际使用：

```ts
encodingForModel('gpt-4o').encode(...).length
```

见 [`token-counter.ts:11-35`](./clowder-ai/packages/api/src/utils/token-counter.ts#L11-L35)。

### 一个重要设计取舍

当前消息 M003 已经可能出现在增量历史中，但预算公式仍然先扣掉：

```ts
incMessageTokens = estimateTokens(message)
```

后面又对历史里的 M003 计数。

这意味着：

> 预算层面对当前消息进行了保守的双重预留，但最终 Prompt 不一定重复它。

好处是安全余量更大；代价是可能少利用一些上下文窗口。

---

## 11.3 超预算如何裁剪

Warm path 会：

1. 对每一行分别 tokenize；
2. 求总和；
3. 如果超预算，从最旧消息开始丢；
4. 直到剩余总量不超过预算；
5. 保留最近消息。

核心循环：

```ts
for (let i = 0; i < perLineTokens.length - 1; i++) {
  dropTokens += perLineTokens[i];
  if (totalTokens - dropTokens <= effectiveTokenBudget) {
    tokenTrimStart = i + 1;
    break;
  }
}
```

见 [`route-helpers.ts:953-976`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L953-L976)。

复杂度：

- 时间：`O(n + 总文本 tokenize 成本)`；
- 额外空间：`O(n + 格式化文本大小)`；
- I/O：至少一次 cursor 读取和一次 message history 读取，另外可能有 task/session/thread-memory 查询。

### 边界行为

循环最多丢到只剩最后一条。

因此如果：

```text
最后一条消息本身就大于 effectiveTokenBudget
```

Warm path 仍可能保留它；该路径没有再做一次和 smart path 相同的最终硬检查。

这是**代码中可以确认的边界行为**，但本轮没有构造实际超大消息复现，故暂不升级为已复现缺陷。

---

# 12. 第十一步：防止当前消息重复注入

增量结果会返回：

```ts
{
  contextText,
  boundaryId: 'M003',
  includesCurrentUserMessage: true,
  currentMessageFilteredOut: false
}
```

路由随后判断：

```ts
if (shouldAppendExplicitCurrentMessage(inc, currentUserMessageId)) {
  parts.push(message);
}
```

函数规则是：

```ts
if (includesCurrentUserMessage) return false;
if (currentMessageFilteredOut) return false;
if (contextText.includes(currentUserMessageId)) return false;
return true;
```

见 [`route-helpers.ts:219-239`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L219-L239)。

本例：

```text
includesCurrentUserMessage = true
```

所以不会再追加：

```text
@codex 请检查支付回调的并发重复执行风险
```

最终只有历史包里的原始 M003。

---

# 13. 第十二步：`routeSerial()` 形成每轮 Prompt

这是实际热路径的核心拼接代码。

## 实际代码节选

```ts
const parts = [
  invocationContext,
  catModePrompt,
  bootstrapContext,
  mcpInstructions,
].filter(Boolean);

if (inc.contextText) {
  parts.push(inc.contextText);
}

if (shouldAppendExplicitCurrentMessage(inc, currentUserMessageId)) {
  parts.push(message);
}

prompt = parts.join('\n\n---\n\n');
```

原始位置：

[`route-serial.ts:968-977`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L968-L977)

因此本例 `prompt` 的**等价结构示意**为：

```text
Identity: 缅因猫/砚砚 (@codex, model=gpt-5.3-codex)
当前模式：独立回答。
Voice Mode OFF: ...

---

## 协作方式
... HTTP callback instructions ...

---

[导航]
...
[/导航]

[对话历史增量 - 未发送过 2 条]
[M002] [12:01 布偶猫] 支付业务要求同一个回调只执行一次
[M003] [12:02 co-creator] @codex #execute 请检查支付回调的并发重复执行风险
[/对话历史]
```

这是结构推演，不是 Prompt Capture 的原样输出。

---

# 14. 第十三步：`invokeSingleCat()` 做最后一轮包装

`routeSerial()` 调用：

```ts
invokeSingleCat(deps.invocationDeps, {
  catId,
  service,
  prompt,
  userId,
  threadId,
  systemPrompt: staticIdentity,
  ...
})
```

见 [`route-serial.ts:1242-1268`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L1242-L1268)。

这时 `prompt` 已经包含：

- InvocationContext；
- MCP fallback；
- 增量历史；
- 当前用户消息；
- 可选 bootstrap。

但还没加入 invocation 层的：

- mission prefix；
- context-management hint；
- staging；
- transcript path hint；
- fresh/resume 静态 Pack 决策。

---

## 14.1 fresh/resume 决定 Pack 是否重新前置

实际判断：

```ts
const injectSystemPrompt =
  !canSkipOnResume ||
  !isResume ||
  forceReinjection ||
  registryChangedSinceStaticIdentity;
```

见 [`invoke-single-cat.ts:1873-1892`](./clowder-ai/packages/api/src/domains/cats/services/agents/invocation/invoke-single-cat.ts#L1873-L1892)。

然后：

```ts
let effectivePrompt =
  injectSystemPrompt && params.systemPrompt
    ? `${params.systemPrompt}\n\n---\n\n${promptWithMission}`
    : promptWithMission;
```

见 [`invoke-single-cat.ts:1894-1901`](./clowder-ai/packages/api/src/domains/cats/services/agents/invocation/invoke-single-cat.ts#L1894-L1901)。

对 Codex 而言，`params.systemPrompt` 是 **Pack-only**。

本例无 Pack，因此没有变化。

---

## 14.2 context-management hint 和 staging 每轮独立处理

代码继续：

```ts
const contextHintPrefix = takeContextHintPrefix(compressionKey);
if (contextHintPrefix) {
  effectivePrompt = `${contextHintPrefix}\n\n---\n\n${effectivePrompt}`;
}

const stagingPrepend = buildStagingPrepend(catId);
if (stagingPrepend) {
  effectivePrompt = `${stagingPrepend}\n\n---\n\n${effectivePrompt}`;
}
```

见 [`invoke-single-cat.ts:1903-1923`](./clowder-ai/packages/api/src/domains/cats/services/agents/invocation/invoke-single-cat.ts#L1903-L1923)。

这两个层不依赖静态身份是否在 resume 时被跳过，所以能够“每轮生效”。

当前 checkout 中，`StagingContent.ts` 所引用的：

```text
cat-cafe-skills/refs/l0-staging-content.md
```

并不存在；代码在 `ENOENT` 时返回空 staging：

[`StagingContent.ts:205-220`](./clowder-ai/packages/api/src/domains/cats/services/context/StagingContent.ts#L205-L220)

因此当前源码树条件下 staging 默认为空。部署环境如果补有该文件，则行为不同。

---

## 14.3 Transcript hint 最后追加

```ts
effectivePrompt =
  appendTranscriptPathHints(effectivePrompt, TRANSCRIPT_DIR, threadId);
```

只在存在 active transcript `meta.json` 时追加：

[`transcript-path-hints.ts:14-49`](./clowder-ai/packages/api/src/domains/cats/services/agents/providers/transcript-path-hints.ts#L14-L49)

本例没有 active transcript，因此不变。

---

# 15. 第十四步：Codex 把输入拆成两个通道

## 15.1 通道一：编译后的 L0

Codex 每次 invocation 都调用：

```ts
const compiledL0 =
  await compileL0ViaSubprocess({ catId });

return {
  args: [
    '--config',
    `developer_instructions=${toTomlString(compiledL0)}`
  ]
};
```

见 [`CodexAgentService.ts:718-738`](./clowder-ai/packages/api/src/domains/cats/services/agents/providers/CodexAgentService.ts#L718-L738)。

L0 编译器把以下内容填入模板：

```ts
IDENTITY_BLOCK
USER_CAPSULE
TEAMMATE_ROSTER
GOVERNANCE_L0
WORKFLOW_TRIGGERS
CVO_REF
L1-L7
```

见 [`compile-system-prompt-l0.mjs:451-488`](./clowder-ai/scripts/compile-system-prompt-l0.mjs#L451-L488)。

L0 模板可见的主要结构包括：

- 身份与伙伴声明；
- 客观性规则；
- 治理摘要；
- A2A 路由规则；
- 五条铁律；
- 工作流触发点；
- MCP 工具索引；
- 协作哲学。

模板真相源：

[`system-prompt-l0.md:1-92`](./clowder-ai/assets/system-prompts/system-prompt-l0.md#L1-L92)

---

## 15.2 L0 缓存与并发编译

`compileL0ViaSubprocess()`：

1. 先查进程内 `Map`；
2. 冷缓存时检查同一 cat 是否已有 in-flight Promise；
3. 并发请求共用同一编译 Promise；
4. 成功后写缓存；
5. 失败后移除 in-flight，下一次可以重试。

见 [`l0-compiler.ts:174-207`](./clowder-ai/packages/api/src/domains/cats/services/agents/providers/l0-compiler.ts#L174-L207)。

它保护的是：

> 单进程内同一 cat 的冷缓存并发编译。

它不等于多进程共享缓存；不同 API 进程仍可能各自编译。

---

## 15.3 通道二：本轮 `effectivePrompt`

Codex Provider 为 prompt 正文准备：

```ts
const promptArgs = ['--', '-'];
```

表示从 stdin 读取正文。

两种命令结构分别是：

```text
codex exec --json ... -- -
```

和：

```text
codex exec resume SESSION_ID --json ... -- -
```

二者都会带 `developerInstructionsArgs`：

[`CodexAgentService.ts:834-918`](./clowder-ai/packages/api/src/domains/cats/services/agents/providers/CodexAgentService.ts#L834-L918)

真正执行时：

```ts
const cliOpts = {
  command: codexCommand,
  args,
  stdinInput: effectivePrompt,
  ...
};
```

见 [`CodexAgentService.ts:1020-1040`](./clowder-ai/packages/api/src/domains/cats/services/agents/providers/CodexAgentService.ts#L1020-L1040)。

正文不放 argv 的理由也写进了实现注释：

- 避免 `ps`、`/proc/<pid>/cmdline` 等进程信息暴露完整历史；
- 避免长 Prompt 进入命令行。

---

# 16. 本例最终送给 Codex 的真实结构

以下是**结构示意，不是原样 Prompt Capture**：

```text
┌──────────────────────────────────────────────────┐
│ Codex CLI config channel                         │
│                                                  │
│ developer_instructions =                         │
│   编译后的 L0：                                  │
│   身份 + 用户 Capsule + 队友名册 + 治理规则      │
│   + 工作流 + 路由规则 + MCP 索引 + 协作哲学     │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│ stdinInput = effectivePrompt                     │
│                                                  │
│ [Pack-only static blocks]        本例为空         │
│ [mission prefix]                 本例为空         │
│ [context-management hint]        本例为空         │
│ [staging]                        当前 checkout 空 │
│                                                  │
│ D1 Identity anchor                              │
│ D7 当前模式：独立回答                            │
│ D15 Voice Mode OFF                              │
│                                                  │
│ ---                                              │
│                                                  │
│ C1 HTTP callback fallback                        │
│                                                  │
│ ---                                              │
│                                                  │
│ N1 导航块                                        │
│ N2 增量历史                                      │
│   M002                                           │
│   M003 当前用户消息                              │
│                                                  │
│ [transcript hints]              本例为空          │
└──────────────────────────────────────────────────┘
```

最关键的理解是：

> **Codex 的完整输入不等于 `effectivePrompt` 一个字符串。非 Pack L0 在 CLI 配置通道，本轮上下文在 stdin 通道。**

---

# 17. Cursor 状态何时变化

组装上下文时先得到：

```text
deliveryBoundaryId = M003
```

`routeSerial()` 不立即写 cursor，而是把 boundary 收集进 Map：

```ts
upsertMaxBoundary(cursorBoundaries, catId, deliveryBoundaryId);
```

见 [`route-serial.ts:3500-3514`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L3500-L3514)。

调用者在成功、abort 或异常清理路径中再统一：

```ts
deliveryCursorStore.ackCursor(...)
```

见 [`AgentRouter.ts:1739-1749`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/AgentRouter.ts#L1739-L1749)。

## 为什么错误后也 ack

源码理由是：

> 消息已经进入了发给猫的 Prompt。如果错误后不 ack，下一轮会反复把同一批消息再次投递。

这不是“模型一定处理成功”的确认，而是：

> “这批上下文已经被组装并尝试交付”的游标。

## 可靠性边界

如果进程发生硬崩溃：

```text
Prompt 已发送
→ 但 cursor 尚未持久化
→ 进程退出
```

那么下次可能重新投递同一批消息。

因此它更接近：

> **至少一次上下文投递，而不是严格恰好一次。**

Cursor 的单调更新：

- Redis 使用原子 compare-and-set；
- Redis 失败时降级到进程内 Map；
- 内存路径利用无 await 的单线程读改写。

见 [`DeliveryCursorStore.ts:42-105`](./clowder-ai/packages/api/src/domains/cats/services/stores/ports/DeliveryCursorStore.ts#L42-L105)。

---

# 18. 本篇失败、短路和降级汇总

| 条件 | 实际行为 |
|---|---|
| 请求字段非法 | `400`，不存消息、不组 Prompt |
| thread 不存在或已删除 | `400 THREAD_NOT_FOUND` |
| mention 无可路由目标 | `400 NO_TARGETS` |
| 目标正在忙 | 默认进入 queue，不立即组 Prompt |
| busy 检查后发生竞态 | `tryStartThreadAll()` 失败，降级 queue |
| 同一稳定 idempotencyKey 重试 | 返回已有 invocation |
| 没传 idempotencyKey 后网络重试 | 每次生成新 UUID，仍可能重复 invocation |
| 消息写入失败 | 释放执行槽，InvocationRecord 尝试标记 failed |
| optional Signal/World/Bootstrap 查询失败 | 多数 fail-open，不阻塞 invocation |
| Codex L0 编译失败 | fail-closed，输出 error/done，不启动无身份模型 |
| 当前消息是不可见 whisper | 标记 filtered，不允许原文 fallback |
| 历史超预算 | 从最旧消息开始丢，保留最近内容 |
| HTTP 已返回 processing，后台启动失败 | HTTP 成功不代表模型成功，后续通过 invocation 状态和事件暴露 |
| Prompt Capture 未显式开启 | 不落 Prompt 快照 |

Prompt Capture 默认关闭：

```ts
if (process.env.PROMPT_CAPTURE !== 'on') return false;
```

见 [`prompt-capture-store.ts:322-330`](./clowder-ai/packages/api/src/infrastructure/debug/prompt-capture-store.ts#L322-L330)。

---

# 19. 第一篇的算法成本

设：

- `P`：所有 mention pattern 数量；
- `n`：cursor 之后的消息数；
- `T`：这些消息的总文本 token 数；
- `k`：最终保留的消息数。

## mention 解析

当前实现每次调用都会重新：

1. 收集 pattern；
2. 排序；
3. 扫描消息。

大致成本：

```text
O(P log P + 文本扫描与匹配成本)
```

---

## Warm 增量上下文

- MessageStore 查询：取决于后端；
- 过滤：`O(n)`；
- 格式化：`O(总字符数)`；
- tokenizer：`O(T)`；
- token trim：`O(n)`；
- 输出空间：`O(k + 输出文本大小)`。

当消息数已经大于 15 时，代码跳过 warm 路径的全量 token 触发检查，直接进入 smart window，避免无意义的第一次 tokenizer 扫描。

---

## L0

- 热缓存：进程内 `Map` 查询，近似 `O(1)`；
- 冷缓存：启动一个 Node 子进程，存在明显进程 I/O 成本；
- 同进程同 cat 并发冷启动：共享 in-flight Promise；
- 不同进程：各自缓存，没有跨进程合并。

---

# 20. 本篇面试闭环

## 面试官第一问

**“你们项目里的 Prompt 是在哪个函数组装的？”**

### 可直接表达的回答

不是一个函数一次组完。

主链分三层：

1. `routeSerial/routeParallel` 组装本轮动态上下文、session bootstrap 和增量历史；
2. `invokeSingleCat` 再决定 fresh/resume 下是否前置 Pack，并加入 mission、context hint、staging 和 transcript hint；
3. Provider 将完整输入映射到自己的原生通道，例如 Codex 用 `developer_instructions` 传 L0、用 stdin 传本轮 Prompt。

---

## 面试官追问

**“那 `buildSystemPrompt()` 是干什么的？”**

### 源码级回答

当前 `src` 热路径没有调用它。生产路由实际分别调用：

- `buildStaticIdentity()` 或 `buildStaticIdentityPackOnly()`；
- `buildInvocationContext()`；
- `assembleIncrementalContext()`。

`buildSystemPrompt()` 仍是兼容性的组合函数，测试会使用，但不能据此把生产架构描述成单个 PromptBuilder。

---

## 面试官追问

**“怎么保证当前用户消息不会出现两遍？”**

### 源码级回答

用户消息先持久化，再把其 `messageId` 传入 Router。

增量上下文读取 cursor 之后的消息，通常已经包含当前消息；结果中会返回：

```ts
includesCurrentUserMessage
currentMessageFilteredOut
```

只有当前消息确实不存在、又不是因为 whisper 可见性被过滤时，才额外 append 原始请求。

另外还会用 `contextText.includes(currentUserMessageId)` 做一次防御性去重。

边界是：这依赖消息 ID 被写进增量历史文本；属于本次 Prompt 内去重，不是跨请求业务幂等。

---

## 面试官追问

**“上下文预算怎么算？”**

### 可直接表达的回答

先从猫的 `maxPromptTokens` 中扣掉本轮系统段、当前消息和 200 token guard，再和 `maxContextTokens` 取较小值，作为历史上下文预算。

超预算时从最旧消息开始丢，优先保留最近内容。

### 源码级边界

- 使用 `js-tiktoken` 的 `gpt-4o` 编码器做本地估算；
- 不是目标模型的真实 provider usage；
- 当前消息即使已在历史中，预算仍先单独扣一次，属于保守预留；
- Codex 原生 L0 没直接计入 `incSystemTokens`，主要通过 `maxContextTokens < maxPromptTokens` 的配置差额留出空间，而不是逐次精确测量编译后 L0。

---

## 面试官追问

**“为什么 Codex 的静态身份没有直接拼进 Prompt？”**

### 源码级回答

Codex 声明 `injectsL0Natively() === true`。

所以非 Pack 静态身份由 L0 编译器生成，并通过：

```text
--config developer_instructions=...
```

传入。

文本 Prompt 中只保留：

- Pack 静态块；
- 每轮变化的 D 段；
- session bootstrap；
- MCP fallback；
- 增量历史。

这样静态规则与每轮上下文可以独立演化，也避免把非 Pack L0 在两个通道重复注入。

---

## 面试官追问

**“这个流程的 exactly-once 保证怎么样？”**

### 源码级回答

不能宣称全链路 exactly-once。

能够确认的局部保证有：

- Redis InvocationRecord 创建使用 Lua 原子去重；
- 前提是客户端复用同一个 idempotencyKey；
- delivery cursor 在 Redis 中做单调 CAS；
- 单进程执行槽关闭了 busy check 与槽注册之间的竞态。

不能保证的地方：

- 客户端没传幂等键时，网络重试会生成新 UUID；
- Prompt 发出但 cursor ack 前进程崩溃，消息可能再次进入下一轮 Prompt；
- Provider 内工具副作用是否幂等，要看具体工具自身的 idempotency 设计；
- 进程内 Map 降级不提供多进程共享保证。

---

## 面试官追问

**“哪些失败是 fail-open，哪些是 fail-closed？”**

### 源码级回答

- L0 编译失败是 fail-closed，因为无身份和治理规则的模型被认为比本次调用失败更危险。
- World、Signal、SOP、Bootstrap 等增强上下文多数 fail-open，失败后少注入一层，但仍允许核心请求执行。
- whisper 可见性是 fail-closed：不确定时不能把原文 fallback 给无权限猫。
- Prompt Capture 默认关闭，观测缺失不阻断执行。

---

# 21. 本篇验证说明

## 已完成

- 当前 commit 上逐行追踪真实启动、注册、DI 和调用点；
- 核对 `buildSystemPrompt()` 的 `src` 调用情况；
- 核对 `assembleContext()` 与 `assembleIncrementalContext()` 的真实分支；
- 用一组固定示意数据推演：
  - target；
  - intent；
  - StoredMessage；
  - InvocationRecord；
  - delivery cursor；
  - warm context；
  - route prompt；
  - invocation prompt；
  - Codex CLI 两路输入。

## 未执行

- 没有运行 API；
- 没有启动 Redis；
- 没有真实调用 Codex CLI；
- 没有捕获真实 Prompt；
- 没有执行测试。

当前仓库没有安装 `node_modules`，也没有 API/MCP 的 `dist` 产物；为了遵守只读和无副作用边界，本轮没有安装依赖或构建。

因此不能说：

- “测试已经通过”；
- “Provider 一定收到了该 Prompt”；
- “线上 Redis 状态与示例一致”。

---

# 22. 本篇已经讲透与下一篇

## 已经讲透

- 真实入口与依赖装配；
- 单猫立即执行链；
- 原消息和 clean message 的区别；
- 用户消息为什么先存储；
- Prompt 为什么不是由一个函数完成；
- 增量上下文为什么是当前主路径；
- 当前消息如何去重与防 whisper 泄漏；
- Prompt 预算公式和裁剪方向；
- Codex 的 L0 与 stdin 双通道；
- 幂等、占槽、cursor 的局部保证和边界。

## 尚未展开

- L0 中每个静态段的来源和覆盖优先级；
- Pack 与 L0 为什么必须分开；
- Prompt overlay 如何编辑、校验和热失效；
- Smart Window 内部的 burst、anchor、tombstone、evidence；
- SessionBootstrap 的 2000-token 丢弃算法；
- parallel/A2A 路径；
- 其他 Provider 的不同通道；
- retry、timeout、取消和工具副作用的可靠性。

## 下一篇

下一篇将进入：

> **Prompt 分层真相：L0、S1-S13、D1-D21、C1、N1/N2、M1/M2 分别从哪里来，什么时候注入，在哪个通道生效。**

它会直接承接本篇最后的“两路输入”，把每一层展开到模板、条件和覆盖顺序，而不是重新讲一遍总架构。

> 继续下一篇。
>
> 沿用已经确定的源码精读标准和章节路线。先简短确认上一篇已经覆盖的内容，以及本篇在完整执行链中的位置，然后直接进入新的源码细节，不要重新长篇介绍整体架构。
>
> 本篇仍必须包含：
>
> - 实际入口、调用点和下游消费者；
> - 贯穿的示例数据及中间状态；
> - 关键代码、SQL或状态转换；
> - 算法逐步推演、复杂度与边界；
> - 异常、并发、重试和一致性分析；
> - 必要且安全的最小验证；
> - 连续面试追问及准确回答。
>
> 如果当前版本发生变化，先核对受影响实现。
> 如果发现前文表述过强或有误，给出源码证据并纠正。
> 一次讲不完就拆分，但不要通过压缩算法细节来凑成一篇。
> 结尾更新已完成、待覆盖和下一篇范围。

<details><summary>4 previous messages</summary>

> 我会先只读核对当前 HEAD 与工作区，确认上一篇基线没有漂移；随后直接进入第二篇：**L0、S/D/C/N/M 各层的真实来源、条件、覆盖顺序和最终消费者**。本篇会沿用同一个 `@codex #execute` 请求，但把“上一章只画出的两路输入”逐层展开。
>
> <details><summary>Ran 30 commands</summary>
>
> - Ran `$mem='C:\Users\Administrator\.codex\memories\MEMORY.md'; Select-String -LiteralPath $mem -Pattern 'prompt|L0|SystemPromptBuilder|staging|ContextAssembler|CodexAgentService' -Context 2,3 | ForEach-Object { "LINE $($_.LineNumber): $($_.Line)"; $_.Context.PreContext; $_.Context.PostContext; '---' }; Write-Output '=== git baseline ==='; git -c safe.directory='D:/AI/clower-1/clowder-ai' -C 'D:\AI\clower-1\clowder-ai' rev-parse HEAD; git -c safe.directory='D:/AI/clower-1/clowder-ai' -C 'D:\AI\clower-1\clowder-ai' status --short --branch`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== $p [$s-$e] ==="; for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\SystemPromptBuilder.ts'; Show-Lines $p 48 210; Show-Lines $p 642 740; Show-Lines $p 740 840; Show-Lines $p 840 967`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\SystemPromptBuilder.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ===";for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 145 210; Show-Lines 642 715; Show-Lines 715 790; Show-Lines 790 840`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\SystemPromptBuilder.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=692;$i -le 742;$i++){"${i}:$($a[$i-1])"}`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ===";for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\prompt-template-loader.ts'; Show-Lines $p 20 120; Show-Lines $p 120 235; Show-Lines $p 288 310`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\prompt-template-loader.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=135;$i -le 165;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\assets\prompt-injection-manifest.yaml'; $a=Get-Content -LiteralPath $p -Encoding UTF8; "lines=$($a.Count)"; for($i=1;$i -le $a.Count;$i++){"${i}:$($a[$i-1])"}`
> - Ran `Get-ChildItem -LiteralPath 'D:\AI\clower-1\clowder-ai\assets' -Force | Select-Object Mode,Name,Length; rg --files 'D:\AI\clower-1\clowder-ai' -g '*prompt*manifest*.yaml' -g '*prompt*manifest*.yml' -g '!**/node_modules/**'`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== $p [$s-$e] ===";for($i=$s;$i -le [Math]::Min($e,$a.Count);$i++){"${i}:$($a[$i-1])"}}; $p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\prompt-injection.ts'; (Get-Content -LiteralPath $p -Encoding UTF8).Count; Show-Lines $p 1 180; Show-Lines $p 168 330; Show-Lines $p 330 450`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\prompt-injection.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ===";for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 110 220; Show-Lines 220 330`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\prompt-injection-hooks.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=1;$i -le $a.Count;$i++){"${i}:$($a[$i-1])"}; Write-Output '=== preview route ==='; $p2='D:\AI\clower-1\clowder-ai\packages\api\src\routes\prompt-injection-preview.ts';$b=Get-Content -LiteralPath $p2 -Encoding UTF8;for($i=1;$i -le $b.Count;$i++){"${i}:$($b[$i-1])"}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\prompt-injection-preview.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=35;$i -le 88;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$root='D:\AI\clower-1\clowder-ai'; rg -n "prompt-injection-manifest|compiled-preview|prompt-injection/segment|D21|S13" "$root\packages\web\src" "$root\packages\api\src" --glob '*.ts' --glob '*.tsx' --glob '*.js' | Select-Object -First 300`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\rules.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 320 390; Write-Output '=== web data source ==='; rg -n "prompt-injection|segments|rules" 'D:\AI\clower-1\clowder-ai\packages\web\src\components\settings' --glob '*.tsx' | Select-Object -First 200`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\governance-l0.ts'; $a=Get-Content -LiteralPath $p -Encoding UTF8; "lines=$($a.Count)"; rg -n "export|function|local|override|cache|hash|extract|anchor|loadCompiled|compileGovernance|readFile|return" $p | Select-Object -First 250`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\governance-l0.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ===";for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 1 65; Show-Lines 65 150; Show-Lines 150 220; Show-Lines 219 285; Show-Lines 285 348`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\governance-l0.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=150;$i -le 218;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$base='D:\AI\clower-1\clowder-ai\packages\api\src\domains\packs'; Write-Output '=== pack files ==='; Get-ChildItem -LiteralPath $base -Recurse -File -Filter '*.ts' | Select-Object -ExpandProperty FullName; Write-Output '=== getActivePackBlocks ==='; $p="$base\getActivePackBlocks.ts"; $a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1;$i -le $a.Count;$i++){"${i}:$($a[$i-1])"}; Write-Output '=== pack compiler refs ==='; rg -n "CompiledPackBlocks|masksBlock|workflowsBlock|guardrailBlock|defaultsBlock|worldDriverSummary|compile|priority|active" $base --glob '*.ts' | Select-Object -First 300`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\packs\PackCompiler.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=1;$i -le $a.Count;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$root='D:\AI\clower-1\clowder-ai\packages\api\src'; rg -n "clearL0Cache\(" $root --glob '*.ts'`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\profile-update-decision-routes.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=35;$i -le 65;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\SystemPromptBuilder.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=300;$i -le 430;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$src='D:\AI\clower-1\clowder-ai\packages\api\src'; rg -n "initGovernanceOverlay\(" $src --glob '*.ts'; rg -n "clearL0Cache|warmL0Cache|initGovernance" "$src\index.ts" | Select-Object -First 80`
> - Ran ``$root='D:\AI\clower-1\clowder-ai'; $paths=@(
>   "$root\.cat-cafe\prompt-overlays",
>   "$root\cat-cafe-skills\refs\shared-rules.local.md",
>   "$root\cat-cafe-skills\refs\shared-rules.local-override.md",
>   "$root\cat-cafe-skills\refs\l0-staging-content.md",
>   "$root\assets\prompt-injection-manifest.yaml"
> ); foreach($p in $paths){"$(Test-Path -LiteralPath $p) `t $p"}; Write-Output '=== template local-capable bases ==='; foreach($n in @('workflow-triggers.yaml','mcp-tools.md','c1-mcp-callback.md')){$p=Join-Path "$root\assets\prompt-templates" $n; "$(Test-Path -LiteralPath $p) `t $p"}``
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ===";for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; $p='D:\AI\clower-1\clowder-ai\scripts\compile-system-prompt-l0.mjs'; Show-Lines $p 1 130; Show-Lines $p 180 330; Show-Lines $p 330 445`
> - Ran `$p='D:\AI\clower-1\clowder-ai\scripts\compile-system-prompt-l0.mjs'; rg -n "function buildIdentityBlock|function buildTeammateRoster|function buildWorkflowTriggers|function renderCvoRef|async function bootstrapCatRegistry|function resolveModel|function pick" $p`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\scripts\compile-system-prompt-l0.mjs';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ===";for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 100 180; Show-Lines 180 250; Show-Lines 250 330`
> - Ran `$p='D:\AI\clower-1\clowder-ai\scripts\compile-system-prompt-l0.mjs';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=210;$i -le 240;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$root='D:\AI\clower-1\clowder-ai'; rg -n "HARD_CAP_L0|6000|L0.*cap|token cap|hard_cap" "$root\scripts\compile-system-prompt-l0.test.mjs" "$root\packages\api\test\l0-compiler.test.js" "$root\packages\api\test\staging-content.test.js" "$root\cat-cafe-skills" --glob '*.md' --glob '*.js' --glob '*.mjs' | Select-Object -First 250`
> - Ran `rg --files 'D:\AI\clower-1\clowder-ai' -g '*compile-system-prompt-l0*.test*' -g '!**/node_modules/**'; rg -n "L0.*6000|6000.*L0|hard cap" 'D:\AI\clower-1\clowder-ai\packages\api\test\l0-compiler.test.js' 'D:\AI\clower-1\clowder-ai\packages\api\test\system-prompt-builder.test.js' | Select-Object -First 100`
>
> </details>
>
> 我已经核对：HEAD 仍是 `6868041cae3b9dcab163a1fd85845b9778c3adc5`，工作区仍无源码改动，因此不需要重做上一篇。接下来我会额外核查“模板注册表里声明的文件是否真实存在、当前 overlay/manifest/staging 状态”，因为这一篇最容易把 Console 展示元数据误当成运行时真相。
>
> <details><summary>Ran 34 commands</summary>
>
> - Ran `$root='D:\AI\clower-1\clowder-ai'; $loader=Join-Path $root 'packages\api\src\domains\cats\services\context\prompt-template-loader.ts'; $raw=Get-Content -LiteralPath $loader -Raw -Encoding UTF8; $matches=[regex]::Matches($raw,"base:\s*'([^']+)'\s*,\s*local:\s*'([^']*)'"); $rows=@(); foreach($m in $matches){$base=$m.Groups[1].Value;$local=$m.Groups[2].Value;$basePath=Join-Path $root ('assets\prompt-templates\'+$base);$overlayPath=if($local){Join-Path $root ('.cat-cafe\prompt-overlays\'+$local)}else{$null};$rows += [pscustomobject]@{base=$base;baseExists=Test-Path -LiteralPath $basePath;local=$local;overlayExists=if($overlayPath){Test-Path -LiteralPath $overlayPath}else{$false}}}; Write-Output ('registeredEntries='+$rows.Count); Write-Output ('uniqueBaseFiles='+(($rows.base|Sort-Object -Unique).Count)); Write-Output '=== missing bases ==='; $rows|Where-Object{-not $_.baseExists}|Sort-Object base -Unique|Format-Table -AutoSize; Write-Output '=== local-capable ==='; $rows|Where-Object{$_.local}|Sort-Object base -Unique|Format-Table -AutoSize; Write-Output '=== source-only runtime artifacts ==='; foreach($rel in @('assets\prompt-injection-manifest.yaml','cat-cafe-skills\refs\l0-staging-content.md','cat-cafe-skills\refs\shared-rules.local.md','cat-cafe-skills\refs\shared-rules.local-override.md')){ $p=Join-Path $root $rel; [pscustomobject]@{path=$rel;exists=Test-Path -LiteralPath $p} } | Format-Table -AutoSize`
> - Ran `$root='D:\AI\clower-1\clowder-ai'; $loader=Join-Path $root 'packages\api\src\domains\cats\services\context\prompt-template-loader.ts'; $raw=Get-Content -LiteralPath $loader -Raw -Encoding UTF8; $matches=[regex]::Matches($raw,"base:\s*'([^']+)'\s*,\s*local:\s*'([^']*)'"); $rows=@(); foreach($m in $matches){$base=$m.Groups[1].Value;$local=$m.Groups[2].Value;$basePath=Join-Path $root ('assets\prompt-templates\'+$base);$overlayPath=if($local){Join-Path $root ('.cat-cafe\prompt-overlays\'+$local)}else{$null};$rows += [pscustomobject]@{base=$base;baseExists=Test-Path -LiteralPath $basePath;local=$local;overlayExists=if($overlayPath){Test-Path -LiteralPath $overlayPath}else{$false}}}; Write-Output ('registeredEntries='+$rows.Count); Write-Output ('uniqueBaseFiles='+(($rows.base|Sort-Object -Unique).Count)); Write-Output '=== missing bases ==='; $missing=$rows|Where-Object{-not $_.baseExists}|Sort-Object base -Unique; if($missing){$missing|Format-Table -AutoSize}else{'none'}; Write-Output '=== local-capable ==='; $rows|Where-Object{$_.local}|Sort-Object base -Unique|Format-Table -AutoSize; Write-Output '=== source-only runtime artifacts ==='; $artifacts=@(); foreach($rel in @('assets\prompt-injection-manifest.yaml','cat-cafe-skills\refs\l0-staging-content.md','cat-cafe-skills\refs\shared-rules.local.md','cat-cafe-skills\refs\shared-rules.local-override.md')){ $p=Join-Path $root $rel; $artifacts += [pscustomobject]@{path=$rel;exists=Test-Path -LiteralPath $p} }; $artifacts|Format-Table -AutoSize`
> - Ran `Write-Output ('CAT_CODEX_MODEL=' + ($env:CAT_CODEX_MODEL ?? '<unset>')); Write-Output ('CAT_CODEX_EFFORT=' + ($env:CAT_CODEX_EFFORT ?? '<unset>')); Write-Output ('CAT_CAFE_MCP_SERVER_PATH=' + ($env:CAT_CAFE_MCP_SERVER_PATH ?? '<unset>'))`
> - Ran `$src='D:\AI\clower-1\clowder-ai'; rg -n "@segment M1|@segment M2|renderSegment\('M1'|renderSegment\('M2'|m1-dispatch-mission|m2-transcript-hints" "$src" --glob '*.ts' --glob '*.mjs' --glob '*.md' --glob '!**/node_modules/**' | Select-Object -First 250`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== $p [$s-$e] ===";for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; $p='D:\AI\clower-1\clowder-ai\packages\api\src\config\governance\mission-pack.ts'; Show-Lines $p 1 100; $p2='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\invoke-single-cat.ts'; Show-Lines $p2 1370 1445; $p3='D:\AI\clower-1\clowder-ai\assets\prompt-templates\m1-dispatch-mission.md'; Show-Lines $p3 1 80; $p4='D:\AI\clower-1\clowder-ai\assets\prompt-templates\m2-transcript-hints.md'; Show-Lines $p4 1 80`
> - Ran `$root='D:\AI\clower-1\clowder-ai'; rg -n "@segment B|@segment N|\[B1\]|\[N2\]|Session Bootstrap" "$root\packages\api\src" "$root\assets\prompt-templates" --glob '*.ts' --glob '*.md' | Select-Object -First 250`
> - Ran `$dir='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\providers'; rg -n "injectsL0Natively\(\): boolean|injectsL0Natively\?" $dir --glob '*.ts'`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== $p [$s-$e] ===";for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; $d='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\providers'; Show-Lines "$d\ClaudeAgentService.ts" 315 340; Show-Lines "$d\ClaudeBgCarrierService.ts" 165 182; Show-Lines "$d\OpenCodeAgentService.ts" 200 220; Show-Lines "$d\claude-carrier-factory.ts" 70 140; Show-Lines "$d\claude-carrier-factory.ts" 145 185`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\providers\claude-carrier-factory.ts'; rg -n "CARRIER_CHAIN|next|fallbackCarrier|createCarrierByTier|for await|injectsL0" $p | Select-Object -First 180; function Show-Lines($s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 185 300`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\providers\claude-carrier-factory.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=1;$i -le 70;$i++){"${i}:$($a[$i-1])"}; rg -n "selectFirstHealthyTier|FALLBACK|CHAIN" 'D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\providers' --glob '*carrier*' --glob '*.ts' | Select-Object -First 100`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\memory\f163-types.ts'; rg -n "alwaysOnInjection|freezeFlags|default|ALWAYS" $p; $a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1;$i -le [Math]::Min($a.Count,220);$i++){"${i}:$($a[$i-1])"}`
> - Ran `$src='D:\AI\clower-1\clowder-ai\packages\api\src'; rg -n "promptTags:|skill:" "$src\domains\cats\services" "$src\routes" --glob '*.ts' | Select-Object -First 250`
> - Ran `$root='D:\AI\clower-1\clowder-ai'; rg -n "@segment H[0-9]|\[H[0-9]\]|H1|H2|H3" "$root\.claude" "$root\packages\api\src" --glob '*.sh' --glob '*.ts' --glob '*.md' 2>$null | Select-Object -First 250`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\prompt-hooks\trace-collector.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; "lines=$($a.Count)"; for($i=1;$i -le $a.Count;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\infrastructure\debug\prompt-capture-bridge.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=55;$i -le 125;$i++){"${i}:$($a[$i-1])"}`
> - Ran ``$dir='D:\AI\clower-1\clowder-ai\assets\prompt-templates'; function Render-Template([string]$name,[hashtable]$vars){$content=(Get-Content -LiteralPath (Join-Path $dir $name) -Encoding UTF8 | Where-Object {-not $_.TrimStart().StartsWith('<!--')}) -join "`n"; $content=$content.Trim(); return [regex]::Replace($content,'\{\{(\w+)\}\}',{param($m) $k=$m.Groups[1].Value; if($vars.ContainsKey($k)){[string]$vars[$k]}else{$m.Value}})}; $cases=@(
>   @{id='D1';file='d1-identity-anchor.md';vars=@{DISPLAY_NAME='缅因猫';NICKNAME_PART='/砚砚';CAT_ID='codex';RUNTIME_MODEL='gpt-5.3-codex'}},
>   @{id='D7';file='d7-mode-solo.md';vars=@{}},
>   @{id='D12';file='d12-active-participant.md';vars=@{ACTIVE_LABEL='布偶猫/宪宪(opus)'}},
>   @{id='D13';file='d13-routing-policy.md';vars=@{ROUTING_PARTS='review prefer @codex (支付安全审查)'}},
>   @{id='D14';file='d14-sop-stage.md';vars=@{FEATURE_ID='F-PAY-17';STAGE='review';SUGGESTED_SKILL='code-review';SOURCE_PART=' (workflow-sop)'}},
>   @{id='D15';file='d15-voice-off.md';vars=@{}},
>   @{id='C1';file='c1-mcp-callback.md';vars=@{EXAMPLE_HANDLE='@opus'}}
> ); foreach($c in $cases){$out=Render-Template $c.file $c.vars;$unresolved=[regex]::Matches($out,'\{\{\w+\}\}').Count; Write-Output "=== $($c.id) unresolved=$unresolved ==="; Write-Output $out }``
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\providers\l0-compiler.ts'; rg -n "isL0GenerationCurrent|l0Cache\.set|compileGeneration|child\.on|close|exit" $p; function Show-Lines($s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 214 300`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\governance-l0.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=112;$i -le 149;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\cat-cafe-skills\refs\shared-rules.md'; $raw=Get-Content -LiteralPath $p -Raw -Encoding UTF8; $anchors=@('## Rule 0','### Push Back 协议','## 第一性原理','## 世界观','## Magic Words','## 10. @ 路由与球权','## 14. 共享状态文件只在 main 改','## 16. 实事求是','### 46 hotfix 标签 + 跨猫升级 review','fallback 层数检测协议','创意-实现解耦协议','## 0. 身份契约','## 17. 决策漏斗'); $missing=$anchors|Where-Object{-not $raw.Contains($_)}; Write-Output ('requiredAnchors='+$anchors.Count); Write-Output ('missingAnchors='+$missing.Count); if($missing){$missing}; foreach($prefix in @('P','W')){$max=if($prefix -eq 'P'){5}else{8};$bad=@();for($i=1;$i -le $max;$i++){$pattern="(?m)^###\s+$prefix$i\.\s+.+$";$count=[regex]::Matches($raw,$pattern).Count;if($count -ne 1){$bad += "$prefix$i=$count"}};Write-Output "$prefix-heading-anomalies=$($bad.Count)";if($bad){$bad}}; $magic=[regex]::Matches($raw,'(?m)^\|\s*「([^」]+)」\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$')|Where-Object{-not $_.Groups[1].Value.Contains('拉闸词')}; Write-Output ('magicWordRows='+$magic.Count)`
> - Ran `$p='D:\AI\clower-1\clowder-ai\cat-cafe-skills\refs\shared-rules.md'; Select-String -LiteralPath $p -Pattern 'Magic Words|拉闸词|「' -Context 2,20 | Select-Object -First 120 | ForEach-Object {"$($_.LineNumber):$($_.Line)"; $_.Context.PreContext; $_.Context.PostContext; '---'}`
> - Ran `node -e "const fs=require('fs'); const p='D:/AI/clower-1/clowder-ai/cat-cafe-skills/refs/shared-rules.md'; const s=fs.readFileSync(p,'utf8'); const rows=[...s.matchAll(/^\|\s*「([^」]+)」\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm)].filter(m=>!m[1]?.includes('拉闸词')); console.log({rows:rows.length, first:rows[0]?.[1], last:rows.at(-1)?.[1]});"`
> - Ran `git -c safe.directory='D:/AI/clower-1/clowder-ai' -C 'D:\AI\clower-1\clowder-ai' ls-files -- 'assets/prompt-injection-manifest.yaml' 'cat-cafe-skills/refs/l0-staging-content.md' 'cat-cafe-skills/refs/shared-rules.local.md' 'cat-cafe-skills/refs/shared-rules.local-override.md'; rg -n "prompt-injection-manifest|l0-staging-content|shared-rules\.local" 'D:\AI\clower-1\clowder-ai\.gitignore' 'D:\AI\clower-1\clowder-ai\**\.gitignore' 2>$null`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\ThreadStore.ts'; rg -n "export interface ThreadRoutingPolicyV1|interface ThreadRouting|routingPolicy|Workflow|voiceMode|ThreadParticipantActivity" $p | Select-Object -First 100; $a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1;$i -le 160;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$src='D:\AI\clower-1\clowder-ai\packages\api\src'; rg -n "modeSystemPrompt|modeSystemPromptByCat|contextHistory" $src --glob '*.ts'`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=85;$i -le 155;$i++){"${i}:$($a[$i-1])"}`
> - Ran `function Show-Lines($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-parallel.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== [$s-$e] ===";for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; Show-Lines 105 230; Show-Lines 230 380; Show-Lines 380 565`
> - Ran ``$root='D:\AI\clower-1\clowder-ai'; foreach($p in @("$root\private\profile\landy-capsule.md","$root\private\profile\relationship\codex-primer.md")){"$(Test-Path -LiteralPath $p) `t $p"}``
> - Ran `$p='D:\AI\clower-1\clowder-ai\cat-template.json'; Select-String -LiteralPath $p -Pattern 'coCreator|co-creator|operator|timeZone|mentionPatterns' -Context 1,5 | Select-Object -First 80 | ForEach-Object {"LINE $($_.LineNumber): $($_.Line)"; $_.Context.PreContext; $_.Context.PostContext; '---'}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\config\capabilities\capability-write-guards.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=1;$i -le [Math]::Min($a.Count,220);$i++){"${i}:$($a[$i-1])"}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\packs\PackSecurityGuard.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;for($i=1;$i -le $a.Count;$i++){"${i}:$($a[$i-1])"}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\packs\PackStore.ts'; rg -n "async list|async get|readdir|sort|installedAt|return" $p | Select-Object -First 150; $a=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1;$i -le [Math]::Min($a.Count,180);$i++){"${i}:$($a[$i-1])"}`
> - Ran `git -c safe.directory='D:/AI/clower-1/clowder-ai' -C 'D:\AI\clower-1\clowder-ai' status --short --branch; git -c safe.directory='D:/AI/clower-1/clowder-ai' -C 'D:\AI\clower-1\clowder-ai' diff --stat`
> - Ran ``$dir='D:\AI\clower-1\clowder-ai\assets\prompt-templates'; function Render-Template([string]$name,[hashtable]$vars){$content=(Get-Content -LiteralPath (Join-Path $dir $name) -Encoding UTF8 | Where-Object {-not $_.TrimStart().StartsWith('<!--')}) -join "`n"; $content=$content.Trim(); return [regex]::Replace($content,'\{\{(\w+)\}\}',{param($m) $k=$m.Groups[1].Value; if($vars.ContainsKey($k)){[string]$vars[$k]}else{$m.Value}})}; $d12=Render-Template 'd12-active-participant.md' @{ACTIVE_LABEL='布偶猫(opus)'}; Write-Output $d12``
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\prompt-template-loader.ts'; $lines=Get-Content -LiteralPath $p -Encoding UTF8; $ids=@(); foreach($line in $lines){ if($line -match '^\s*([A-Za-z0-9_]+):\s*\{\s*base:'){ $ids += $matches[1] } }; Write-Output ('ids='+$ids.Count); Write-Output ($ids -join ', ');`
>
> </details>
</details>

# 第二篇：Prompt 分层真相——L0、S、D、B、C、N、M 到底各自负责什么

## 0. 与上一篇的衔接

上一篇已经讲透：

```text
POST /api/messages
→ 目标猫与 intent
→ InvocationRecord / MessageStore
→ routeExecution
→ routeSerial
→ 增量历史与预算
→ invokeSingleCat
→ Codex developer_instructions + stdin
```

本篇位于完整链路中的这一段：

```text
routeSerial 收集 thread/session/pack 等状态
              ↓
        各层 Prompt 内容生成
              ↓
invokeSingleCat 调整层次与 fresh/resume 行为
              ↓
Provider 消费不同通道
```

当前版本没有变化：

- HEAD 仍是 `6868041cae3b9dcab163a1fd85845b9778c3adc5`
- 分支仍是 `main`
- 工作区仍无源码改动

---

# 1. 先纠正和精确化三个容易讲错的地方

## 1.1 `M1/M2` 的运行时含义，不是“用户消息/未读消息”

真实运行时代码中：

- **M1**：外部项目 Dispatch Mission Context
- **M2**：会议 transcript 路径提示

来源分别是：

- [`mission-pack.ts:46-64`](./clowder-ai/packages/api/src/config/governance/mission-pack.ts#L46-L64)
- [`transcript-path-hints.ts:28-49`](./clowder-ai/packages/api/src/domains/cats/services/agents/providers/transcript-path-hints.ts#L28-L49)

但 `compiled-preview` 接口构造了一个仅供前端展示的伪结构：

```text
[M1] 用户消息
[M2] 未读消息摘要
```

见 [`prompt-injection-preview.ts:176-183`](./clowder-ai/packages/api/src/routes/prompt-injection-preview.ts#L176-L183)。

因此：

> Console 的 preview 命名不是运行时 Segment 真相源。实际含义要看运行时调用点和模板注册表。

上一篇没有依赖这个错误命名；本篇把它精确化。

---

## 1.2 `compiled-preview` 不是“实际本轮 Prompt”

它会把 D1-D21 的原始模板几乎全部排列出来：

[`prompt-injection-preview.ts:82-161`](./clowder-ai/packages/api/src/routes/prompt-injection-preview.ts#L82-L161)

但真实运行时只会根据条件选择少数段。

例如用户直接 `@codex` 时：

- D2 直接消息来源：没有；
- D3 同族分身：没有；
- D4 跨 thread 回复：没有；
- D5 乒乓警告：没有；
- D8/D21：Codex 有 native L0，因此没有；
- D16-D20：是否存在取决于 thread 状态和 feature flag。

所以 preview 更接近：

> “可用 Segment 目录和模板展示”

而不是：

> “这一次真实发送给模型的 Prompt Capture”。

---

## 1.3 “L0 有 6000-token 运行时硬限制”目前证据不足

`StagingContent.ts` 注释声称 L0 的 6000-token cap 由：

```text
scripts/compile-system-prompt-l0.test.mjs
```

强制检查：

[`StagingContent.ts:1-18`](./clowder-ai/packages/api/src/domains/cats/services/context/StagingContent.ts#L1-L18)

但当前 checkout 中没有这个测试文件，也没有看到 L0 编译器运行时调用 tokenizer 校验 6000 token。

因此当前能够确认的是：

- 这是设计注释中的预算约束；
- 当前源码里的 L0 编译器没有运行时 token hard guard；
- 不能把它表述为“生产运行时必然保证”。

---

# 2. 本篇继续沿用的示例

用户消息仍然是：

```json
{
  "content": "@codex #execute 请检查支付回调的并发重复执行风险",
  "threadId": "thread-pay-42",
  "idempotencyKey": "11111111-1111-4111-8111-111111111111"
}
```

为了观察更多 D 段，本篇给同一 thread 增加一些**示意状态**：

```ts
routeThread = {
  id: 'thread-pay-42',
  title: '支付回调重复执行风险审查',
  backlogItemId: 'PAY-17',
  voiceMode: false,
  routingPolicy: {
    v: 1,
    scopes: {
      review: {
        preferCats: ['codex'],
        reason: '支付安全审查'
      }
    }
  }
}
```

参与者活动：

```ts
activeParticipants = [
  {
    catId: 'opus',
    lastMessageAt: 1758_000_100_000,
    messageCount: 3
  },
  {
    catId: 'codex',
    lastMessageAt: 0,
    messageCount: 0
  }
]
```

Workflow SOP：

```ts
sopStageHint = {
  featureId: 'F-PAY-17',
  stage: 'review',
  suggestedSkill: 'code-review',
  suggestedSkillSource: 'workflow-sop'
}
```

本篇固定的其他分支：

```text
目标猫：codex
模式：independent
nativeL0Injected：true
mcpAvailable：false
active pack：无
session bootstrap：无，fresh session
world/guide/concierge/signal：无
always_on injection：off
active transcript：无
external project dispatch：否
```

当前工作区还确认了：

- 没有 `.cat-cafe/prompt-overlays`
- 没有 `shared-rules.local.md`
- 没有 `shared-rules.local-override.md`
- 没有 `private/profile/landy-capsule.md`
- 没有 `codex-primer.md`
- 没有 `l0-staging-content.md`
- 没有 `prompt-injection-manifest.yaml`

因此本篇示例使用基础模板，不包含本地覆盖。

---

# 3. 先建立准确的分层坐标系

这里的“层”有三种不同含义，不能混在一起。

## 3.1 Provider 通道层

回答：

> 内容最终通过什么协议位置传给模型？

例如 Codex：

```text
native L0 → developer_instructions
本轮内容 → stdin prompt
```

---

## 3.2 内容生命周期层

回答：

> 这段内容多久变化一次？

| 层 | 生命周期 |
|---|---|
| L0 | 猫配置、治理规则等变化时重新编译 |
| S | session/static，通常 fresh session 注入 |
| D | 每次 invocation 重新生成 |
| B | session #2+ 的接力材料 |
| C | 每轮工具回调能力说明 |
| N | 当前 thread 的导航与未读历史 |
| M | invocation 级外部任务和 transcript 前缀/后缀 |

---

## 3.3 同一字符串中的文本顺序

回答：

> 同一 Prompt 文本中谁在前、谁在后？

这与 Provider 通道优先级不是一回事。

例如 Codex 的 L0 根本不在 stdin 字符串里；因此不能只通过字符串先后判断它和 D/N 层的关系。

---

# 4. 真实运行时总装顺序

当前热路径的等价结构是：

```text
Provider 原生通道：
  L0

stdin / message prompt：
  staging                     条件
  context-management hint     条件
  S Pack-only static blocks   条件、fresh/reinject
  M1 external mission         条件
  D dynamic invocation        每轮
  modeSystemPrompt            当前标准入口未接入
  B1 session bootstrap        条件
  C1 callback fallback        条件
  N1 navigation               主路径每轮
  N2 incremental context      主路径每轮
  explicit current message    仅 N2 中确实没有时
  M2 transcript path hint     条件、末尾追加
```

`routeSerial()` 内部先组：

```ts
const parts = [
  invocationContext,
  catModePrompt,
  bootstrapContext,
  mcpInstructions,
].filter(Boolean);

if (inc.contextText) parts.push(inc.contextText);

if (shouldAppendExplicitCurrentMessage(...)) {
  parts.push(message);
}

prompt = parts.join('\n\n---\n\n');
```

见 [`route-serial.ts:968-977`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L968-L977)。

之后 `invokeSingleCat()` 再包：

```ts
const promptWithMission = missionPrefix
  ? `${missionPrefix}\n\n${prompt}`
  : prompt;

let effectivePrompt =
  injectSystemPrompt && params.systemPrompt
    ? `${params.systemPrompt}\n\n---\n\n${promptWithMission}`
    : promptWithMission;
```

再前置 hint、staging，并在最后追加 transcript：

[`invoke-single-cat.ts:1873-1926`](./clowder-ai/packages/api/src/domains/cats/services/agents/invocation/invoke-single-cat.ts#L1873-L1926)

---

# 5. L0：原生静态身份与治理层

# 5.1 L0 的实际入口

Codex 的下游消费者是：

```ts
compileL0ViaSubprocess({ catId })
```

然后转成：

```text
--config developer_instructions=<compiled L0>
```

见 [`CodexAgentService.ts:718-738`](./clowder-ai/packages/api/src/domains/cats/services/agents/providers/CodexAgentService.ts#L718-L738)。

L0 编译不是在 API 进程中直接 import 源文件，而是启动一个 Node 子进程：

```ts
const child = spawnFn(
  process.execPath,
  [scriptPath, '--cat', catId, '--profile-dir', profileDir],
  ...
);
```

见 [`l0-compiler.ts:214-259`](./clowder-ai/packages/api/src/domains/cats/services/agents/providers/l0-compiler.ts#L214-L259)。

原因是编译脚本需要 import API 的 `dist`：

```js
await import('../packages/api/dist/config/cat-config-loader.js')
```

见 [`compile-system-prompt-l0.mjs:100-130`](./clowder-ai/scripts/compile-system-prompt-l0.mjs#L100-L130)。

---

# 5.2 L0 的输入

主模板是：

[`system-prompt-l0.md:1-92`](./clowder-ai/assets/system-prompts/system-prompt-l0.md#L1-L92)

它包含 13 组变量：

```text
L1_CONTENT
L2_CONTENT
L3_CONTENT
L4_CONTENT
L5_CONTENT
L6_CONTENT
L7_CONTENT

IDENTITY_BLOCK
USER_CAPSULE
TEAMMATE_ROSTER
GOVERNANCE_L0
WORKFLOW_TRIGGERS
CVO_REF
```

定义见：

[`compile-system-prompt-l0.mjs:3-37`](./clowder-ai/scripts/compile-system-prompt-l0.mjs#L3-L37)。

---

# 5.3 L0 编译算法逐步推演

## 第一步：加载运行时猫配置

编译器使用无参数：

```js
loadCatConfig()
```

这意味着它读取：

```text
cat-template.json
+ .cat-cafe/cat-catalog.json overlay
```

而不是只使用基础模板。

然后将所有变体注册到 `catRegistry`：

[`compile-system-prompt-l0.mjs:110-130`](./clowder-ai/scripts/compile-system-prompt-l0.mjs#L110-L130)。

本例当前没有 `.cat-cafe/cat-catalog.json`，因此 `codex` 使用基础模板配置。

---

## 第二步：加载 L1-L7

```js
for (const [placeholder, filename] of Object.entries(L0_SECTION_TEMPLATES)) {
  result = result.replace(
    `{{${placeholder}}}`,
    loadL0SectionTemplate(filename)
  );
}
```

见 [`compile-system-prompt-l0.mjs:475-479`](./clowder-ai/scripts/compile-system-prompt-l0.mjs#L475-L479)。

加载模板时会删除：

- HTML comment 行；
- `── [Lx] ... ──` 编译标注行。

实际实现：

[`compile-system-prompt-l0.mjs:74-91`](./clowder-ai/scripts/compile-system-prompt-l0.mjs#L74-L91)

注意：

> 主模板本身保留展示标签，而子模板内部的重复标签被移除，避免重复注入。

---

## 第三步：生成 Identity Block

本例得到的核心结构为：

```text
你是 缅因猫/砚砚（缅因猫）。
昵称 "砚砚" 的由来见 docs/stories/cat-names/。
角色：代码审查专家，擅长安全分析、测试覆盖和代码质量把控
性格：严谨认真，注重细节，会直言不讳地指出问题
Identity constant: @codex model=gpt-5.3-codex
```

如果猫配置有硬限制，还会追加：

```text
被 @ 做这类任务时请 push back 或退回给 @ 你的猫。
```

生成代码：

[`compile-system-prompt-l0.mjs:217-238`](./clowder-ai/scripts/compile-system-prompt-l0.mjs#L217-L238)。

模型解析优先级是：

```text
compileL0(runtimeModel 显式参数)
→ getCatModel(catId)，可读环境变量覆盖
→ config.defaultModel
```

---

## 第四步：用户 Capsule

文件来源：

```text
private/profile/landy-capsule.md
```

行为分三种：

```text
文件缺失      → 空串，不注入
可见字符 ≤300 → 注入“主人画像”
可见字符 >300 → throw，L0 编译失败
```

“可见字符”算法是：

```js
[...body.replace(/\s/g, '')].length
```

即：

- 空格、换行不计；
- 中文、英文、标点都计数；
- 不是 token 计数。

见 [`compile-system-prompt-l0.mjs:390-424`](./clowder-ai/scripts/compile-system-prompt-l0.mjs#L390-L424)。

如果存在：

```text
private/profile/relationship/codex-primer.md
```

则只向 L0 写入一个读取指针，而不是把 primer 全文塞入：

[`compile-system-prompt-l0.mjs:426-439`](./clowder-ai/scripts/compile-system-prompt-l0.mjs#L426-L439)。

本例两个文件都不存在，因此：

```text
USER_CAPSULE = ""
```

---

## 第五步：队友名册

算法：

1. 读取所有 cat 配置；
2. 排除当前猫；
3. 排除不可用猫；
4. 对每只猫解析当前运行模型；
5. 获取 dossier 摘要；
6. 回退到 `teamStrengths` 或 `roleDescription`；
7. 把 restrictions 合并进 caution；
8. 输出 Markdown 表格。

见 [`compile-system-prompt-l0.mjs:250-295`](./clowder-ai/scripts/compile-system-prompt-l0.mjs#L250-L295)。

复杂度大致为：

```text
O(C)
```

其中 `C` 是已注册猫数量；但 dossier 查询可能产生额外文件读取。

---

## 第六步：治理规则确定性投影

它不是调用模型做摘要，而是从：

```text
cat-cafe-skills/refs/shared-rules.md
```

按固定 anchor 抽取。

必须存在 13 个锚点，包括：

```text
Rule 0
Push Back
第一性原理
世界观
Magic Words
@ 路由与球权
身份契约
决策漏斗
...
```

缺少任一 anchor 就 throw：

[`governance-l0.ts:150-176`](./clowder-ai/packages/api/src/domains/cats/services/context/governance-l0.ts#L150-L176)。

此外：

- P1-P5 每个必须恰好出现一次；
- W1-W8 每个必须恰好出现一次；
- Magic Words 必须至少 9 条；
- 重复和缺失都失败。

见：

- [`governance-l0.ts:112-145`](./clowder-ai/packages/api/src/domains/cats/services/context/governance-l0.ts#L112-L145)
- [`governance-l0.ts:178-216`](./clowder-ai/packages/api/src/domains/cats/services/context/governance-l0.ts#L178-L216)

这保证的是：

> `shared-rules.md` 的结构漂移会显式导致编译失败，而不是静默生成一个缺字段的治理摘要。

---

## 第七步：Workflow Trigger

优先级：

```text
workflow-triggers.local.yaml
→ workflow-triggers.yaml
```

Local overlay 是**整份映射替换**，不是 deep merge。

若 local YAML 解析失败：

```text
回退 base YAML
```

若 base 也失败：

```text
返回空 map
```

见 [`compile-system-prompt-l0.mjs:164-214`](./clowder-ai/scripts/compile-system-prompt-l0.mjs#L164-L214)。

选择当前猫的 workflow 时：

```text
breedId
→ catId
→ displayName 推导家族
→ “无 per-breed 触发点配置”
```

见 [`compile-system-prompt-l0.mjs:298-318`](./clowder-ai/scripts/compile-system-prompt-l0.mjs#L298-L318)。

---

## 第八步：替换主模板变量

最后执行：

```js
return result
  .replace('{{IDENTITY_BLOCK}}', buildIdentityBlock(...))
  .replace('{{USER_CAPSULE}}', capsuleSection)
  .replace('{{TEAMMATE_ROSTER}}', buildTeammateRoster(catId))
  .replace('{{GOVERNANCE_L0}}', governanceL0.content)
  .replace('{{WORKFLOW_TRIGGERS}}', ...)
  .replace('{{CVO_REF}}', ...);
```

见 [`compile-system-prompt-l0.mjs:451-488`](./clowder-ai/scripts/compile-system-prompt-l0.mjs#L451-L488)。

这里使用的是普通字符串 `.replace()`，每个调用只替换第一个匹配项。

当前模板每个变量只出现一次，因此正常；如果未来同一变量在模板里重复出现，后续出现不会被替换。这是一个当前未触发的扩展边界。

---

# 6. Governance Overlay 的优先级与信任边界

治理规则有独立的覆盖机制，不走 Prompt Overlay API。

优先级是：

```text
shared-rules.local-override.md
→ shared-rules.md 确定性编译 + shared-rules.local.md 追加
→ shared-rules.md 确定性编译
```

见 [`governance-l0.ts:219-282`](./clowder-ai/packages/api/src/domains/cats/services/context/governance-l0.ts#L219-L282)。

区别非常重要。

## `.local.md`

先对 base 执行 anchor 检查和确定性编译，再把本地内容追加：

```text
基础治理仍然存在
+ 本地附加规则
```

## `.local-override.md`

直接返回 override 全文：

```ts
if (override !== null) {
  return {
    content: override.trimEnd(),
    source: 'override'
  };
}
```

它不再对 base 或 override 做 P1-P5、W1-W8 等 anchor 检查。

因此它是：

> 高信任的完整替换逃生口，而不是普通局部配置。

当前 checkout 两种治理 overlay 都不存在。

---

# 7. L0 缓存状态机与并发

L0 使用三个进程内结构：

```ts
l0Cache
l0InflightPromises
l0CacheGenerations
```

状态转换可以写成：

```text
MISS
  → 创建 compilePromise
  → 放入 inflight
  → 子进程编译
  → generation 未变化
      → 写入 cache
  → 删除 inflight
  → HIT
```

并发冷启动：

```text
请求 A：MISS → 创建 Promise
请求 B：发现 inflight → await 同一个 Promise
```

见 [`l0-compiler.ts:174-207`](./clowder-ai/packages/api/src/domains/cats/services/agents/providers/l0-compiler.ts#L174-L207)。

## 清缓存时的 generation guard

如果编译过程中发生：

```ts
clearL0Cache()
```

代码会：

1. 清 cache；
2. 删除 inflight 引用；
3. 增加 generation。

旧编译即使后来成功，也只有在 generation 仍相同时才写回：

```ts
if (isL0GenerationCurrent(catId, compileGeneration)) {
  l0Cache.set(catId, result);
}
```

见 [`l0-compiler.ts:261-277`](./clowder-ai/packages/api/src/domains/cats/services/agents/providers/l0-compiler.ts#L261-L277)。

这防止：

> 清缓存后，旧的慢编译结果又把缓存污染回去。

## 保证边界

它只保证：

- 当前 Node 进程；
- 当前 catId；
- 当前 generation。

它不提供：

- 多进程共享缓存；
- 多实例 cache invalidation；
- Redis 分布式版本号。

---

# 8. S 层：静态身份不是一条统一路径

# 8.1 S1-S13 的实际含义

| Segment | 内容 | 条件 |
|---|---|---|
| S1 | 身份、角色、性格 | 猫配置存在 |
| S2 | 硬限制 | `restrictions` 非空 |
| S3 | Pack Masks | Pack 有 masks |
| S4 | 协作格式 | 有可调用队友 |
| S5 | 队友名册 | 有其他可用猫 |
| S6 | 每家族 Workflow Trigger | 找到对应配置 |
| S7 | Pack Workflows | Pack 有 workflow |
| S8 | co-creator 引用 | 常规存在 |
| S9 | Governance Digest | 常规存在 |
| S10 | Pack Guardrails | Pack 有 guardrails |
| S11 | Pack Defaults | Pack 有 defaults |
| S12 | Pack World Driver | Pack 有 world driver |
| S13 | MCP 工具详细文档 | `mcpAvailable=true` |

实际构造顺序：

[`SystemPromptBuilder.ts:461-605`](./clowder-ai/packages/api/src/domains/cats/services/context/SystemPromptBuilder.ts#L461-L605)

---

## 8.2 非 native Provider

调用：

```ts
buildStaticIdentity(catId, {
  mcpAvailable,
  packBlocks
})
```

完整 S1-S13 以文本形式进入 `params.systemPrompt`。

随后 `invokeSingleCat()`：

- fresh session：前置到本轮 Prompt；
- resume：可能跳过，依赖 session 内已有身份；
- context compression 或 registry 变化：强制重新注入。

---

## 8.3 Native L0 Provider

调用：

```ts
buildStaticIdentityPackOnly(...)
```

它只返回：

```text
S3  masks
S7  workflows
S10 guardrails
S11 defaults
S12 world driver
```

代码顺序：

```ts
[
  masksBlock,
  workflowsBlock,
  guardrailBlock,
  defaultsBlock,
  worldDriverSummary
]
```

见 [`SystemPromptBuilder.ts:626-634`](./clowder-ai/packages/api/src/domains/cats/services/context/SystemPromptBuilder.ts#L626-L634)。

其他内容由 native L0 中的对应部分承担：

| 非 native S 段 | Native L0 对应 |
|---|---|
| S1/S2 | `IDENTITY_BLOCK` |
| S4 | L3 路由规则 |
| S5 | `TEAMMATE_ROSTER` |
| S6 | `WORKFLOW_TRIGGERS` |
| S8 | `CVO_REF` |
| S9 | `GOVERNANCE_L0` |
| S13 | L5 MCP quick index |

因此本例 Codex：

```text
native L0：有
Pack-only static：空
```

---

# 9. Pack 编译算法与边界

每轮路由都会尝试：

```ts
getActivePackBlocks(packStore)
```

算法是：

```text
store.list()
→ 没有 Pack：null
→ 取 manifests[0]
→ store.get(name)
→ PackCompiler.compile()
→ CompiledPackBlocks
```

见 [`getActivePackBlocks.ts:14-31`](./clowder-ai/packages/api/src/domains/packs/getActivePackBlocks.ts#L14-L31)。

## 编译映射

```text
masks/          → masksBlock
guardrails.yaml → guardrailBlock
defaults.yaml   → defaultsBlock
workflows/      → workflowsBlock
world-driver    → worldDriverSummary

knowledge/      → 不进 Prompt，走 RAG
expression/     → 不进 Prompt
bridges/        → 当前阶段跳过
```

见 [`PackCompiler.ts:1-18`](./clowder-ai/packages/api/src/domains/packs/PackCompiler.ts#L1-L18)。

Pack 不是把原始 YAML 直接拼入 Prompt，而是：

1. YAML parse；
2. Zod schema 校验；
3. 转成固定 Markdown；
4. 无效文件记录 warning，并跳过该 block。

例如 guardrail：

```ts
const severityTag =
  c.severity === 'block' ? '🚫' : '⚠️';

lines.push(`- ${severityTag}${scopeNote} ${c.rule}`);
```

见 [`PackCompiler.ts:63-77`](./clowder-ai/packages/api/src/domains/packs/PackCompiler.ts#L63-L77)。

---

## Pack 安全边界

安装阶段还有 `PackSecurityGuard`：

- 检测常见 Prompt Injection 文案；
- 禁止覆盖 catId、provider、model、mentionPatterns 等身份字段；
- 禁止 Pack 自带 capabilities；
- guardrail 只能加严，不能放松。

见 [`PackSecurityGuard.ts:29-116`](./clowder-ai/packages/api/src/domains/packs/PackSecurityGuard.ts#L29-L116)。

但要诚实区分：

- 这是正则和 schema 防线；
- 不是语义级模型安全证明；
- 已安装文件若被绕过安装流程手工篡改，invocation 编译失败时只会返回 `null`；
- `getActivePackBlocks()` 把“无 Pack”和“Pack 编译失败”都表现为 `null`，调用者看不出区别。

---

## Pack 的一个潜在顺序风险

注释称：

```text
first installed wins
```

但 `PackStore.list()` 使用：

```ts
readdir(this.baseDir)
```

没有显式排序，也没有持久化 `installedAt`：

[`PackStore.ts:48-59`](./clowder-ai/packages/api/src/domains/packs/PackStore.ts#L48-L59)。

因此当前更准确的描述是：

> Phase A 取目录枚举返回的第一个 Pack，而不是有明确数据库序号的“最早安装 Pack”。

这在单 Pack 场景没有影响；多 Pack 场景下可能依赖文件系统枚举顺序。属于源码确认的潜在风险，未做跨文件系统复现。

---

# 10. D 层：每轮动态 InvocationContext

上游 `routeSerial()` 先读取：

- active participants；
- thread routing policy；
- voiceMode；
- bootcamp state；
- workflow SOP；
- guide；
- concierge；
- linked Signal；
- always_on evidence；
- world state；
- mention routing feedback；
- cross-thread reply metadata。

主要读取点：

- [`route-serial.ts:503-589`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L503-L589)
- [`route-serial.ts:640-798`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L640-L798)

然后调用纯函数：

```ts
buildInvocationContext(context)
```

---

## 10.1 本例进入 Builder 的状态

```ts
{
  catId: 'codex',
  mode: 'independent',
  chainIndex: 1,
  chainTotal: 1,
  teammates: [],
  mcpAvailable: false,
  nativeL0Injected: true,
  a2aEnabled: true,

  activeParticipants: [
    { catId: 'opus', lastMessageAt: ..., messageCount: 3 }
  ],

  routingPolicy: {
    v: 1,
    scopes: {
      review: {
        preferCats: ['codex'],
        reason: '支付安全审查'
      }
    }
  },

  sopStageHint: {
    featureId: 'F-PAY-17',
    stage: 'review',
    suggestedSkill: 'code-review',
    suggestedSkillSource: 'workflow-sop'
  },

  voiceMode: false
}
```

---

## 10.2 D1-D21 条件表

| 段 | 条件 | 本例 |
|---|---|---:|
| D1 Identity Anchor | cat 存在 | ✅ |
| D2 Direct Message From | A2A 且来自另一只猫 | ❌ |
| D3 Same-breed Warning | D2 且显示名相同、catId 不同 | ❌ |
| D4 Cross-thread Reply | 有 structured crossThreadReplyHint | ❌ |
| D5 Ping-pong Warning | 同一对猫连续互传 ≥2 | ❌ |
| D6 Teammates | 本次 invocation 还有其他目标猫 | ❌ |
| D7 Mode | 总会选择 solo/serial/parallel 之一 | ✅ solo |
| D8 A2A Ball Check | 非 parallel、A2A enabled、没有 native L0 | ❌ |
| D9 Routing Feedback | 上一次 mention 被抑制 | ❌ |
| D10 Critique | `promptTags` 含 `critique` | ❌ |
| D11 Skill Trigger | 有 `skill:*` tag | ❌ |
| D12 Active Participant | 有非自身活跃猫 | ✅ opus |
| D13 Routing Policy | policy v1、有未过期规则 | ✅ |
| D14 SOP Hint | thread 关联 workflow SOP | ✅ |
| D15 Voice | 总会注入 ON 或 OFF | ✅ OFF |
| D16 Bootcamp | 有 bootcampState | ❌ |
| D17 Guide | guide candidate 匹配 | ❌ |
| Concierge | concierge thread + config | ❌ |
| D18 World Context | 有 world envelope | ❌ |
| D19 Constitutional Docs | always_on mode=`on` 且有文档 | ❌ |
| D20 Signal Articles | thread 关联 Signal | ❌ |
| D21 Handoff Tree | 与 D8 相同的长锚点条件 | ❌ |

具体分支：

- [`SystemPromptBuilder.ts:642-789`](./clowder-ai/packages/api/src/domains/cats/services/context/SystemPromptBuilder.ts#L642-L789)
- [`SystemPromptBuilder.ts:791-966`](./clowder-ai/packages/api/src/domains/cats/services/context/SystemPromptBuilder.ts#L791-L966)

---

# 11. D 层关键算法，而不只是条件列表

## 11.1 D3 同族防冒充

仅当：

```text
directMessageFrom != currentCat
且两只猫 displayName 相同
```

才注入。

比较的是：

```ts
fromConfig.displayName === config.displayName
```

然后同时写入：

- 对方 variant/model；
- 自己 variant/model。

见 [`SystemPromptBuilder.ts:664-689`](./clowder-ai/packages/api/src/domains/cats/services/context/SystemPromptBuilder.ts#L664-L689)。

它防的是：

> 同名不同分身之间的身份混淆，不是普通不同猫之间的 handoff。

---

## 11.2 D4 effect-class 约束

跨 thread hint 不是从历史文本猜，而是由结构化：

```ts
StoredMessage.extra.crossPost
```

提供。

不同 effect 有明确行为：

```text
fyi         → 只确认，不执行
coordinate  → 可以讨论，不改代码
investigate → 可以读和调查，不写代码
assign_work → 不使用上述禁止执行约束
```

见 [`SystemPromptBuilder.ts:692-715`](./clowder-ai/packages/api/src/domains/cats/services/context/SystemPromptBuilder.ts#L692-L715)。

因此这不是“Prompt 里看到一个 fyi 单词就触发”，而是上游持久化的结构字段。

---

## 11.3 D7 模式选择

```ts
if serial && chainIndex/chainTotal:
  serial template
else if parallel:
  parallel template
else:
  solo template
```

见 [`SystemPromptBuilder.ts:742-758`](./clowder-ai/packages/api/src/domains/cats/services/context/SystemPromptBuilder.ts#L742-L758)。

即使 `mode='serial'`，但缺少 chainIndex 或 chainTotal，也会落到 solo 分支。

这是类型允许、运行逻辑更严格的边界。

---

## 11.4 D8/D21 去重 native L0

判断：

```ts
const shouldInjectA2ALongAnchors =
  context.mode !== 'parallel'
  && context.a2aEnabled
  && !context.nativeL0Injected;
```

见 [`SystemPromptBuilder.ts:760-769`](./clowder-ai/packages/api/src/domains/cats/services/context/SystemPromptBuilder.ts#L760-L769)。

原因：

- native L0 已经含 L3 路由规则；
- 再在 D 层注入长版球权检查和 handoff tree 会重复；
- 非 native Provider 需要 D8/D21 每轮补强，避免 session 压缩后丢失。

---

## 11.5 D9 最多只展示两个目标

```ts
items.slice(0, 2)
```

见 [`SystemPromptBuilder.ts:771-775`](./clowder-ai/packages/api/src/domains/cats/services/context/SystemPromptBuilder.ts#L771-L775)。

所以即使一次有更多 mention 被抑制，Prompt 也只提示前两个，属于信息量控制。

---

## 11.6 D11 的真实来源

普通 `IntentParser` 只认识：

```text
critique
```

不会从用户文本直接产生任意 `skill:xxx`。

D11 的 `skill:*` 主要可由队列条目的 `suggestedSkill` 生成：

```ts
promptTags: [`skill:${entry.suggestedSkill}`]
```

见 [`QueueProcessor.ts:1237`](./clowder-ai/packages/api/src/domains/cats/services/agents/invocation/QueueProcessor.ts#L1237)。

因此 Preview 中把 D11 写成“Signal 触发”并不完整。

---

## 11.7 D12 只取一个最活跃的非自身参与者

算法：

```ts
activeParticipants
  .filter(p => p.catId !== currentCat)
  .find(p => p.lastMessageAt > 0)
```

见 [`SystemPromptBuilder.ts:791-805`](./clowder-ai/packages/api/src/domains/cats/services/context/SystemPromptBuilder.ts#L791-L805)。

它不会把所有活跃参与者都塞进 Prompt。

本例：

```text
最近活跃：布偶猫(opus)
```

---

## 11.8 D13 有明确裁剪规则

只处理：

```text
review
architecture
```

每个 scope：

- expired 规则跳过；
- avoid 最多 3 只；
- prefer 最多 3 只；
- reason 去掉换行；
- 为空则整个 scope 不输出。

见 [`SystemPromptBuilder.ts:807-838`](./clowder-ai/packages/api/src/domains/cats/services/context/SystemPromptBuilder.ts#L807-L838)。

复杂度是常数级，因为 scope 集合固定为两个，列表最多取三个输出。

---

## 11.9 D15 永远存在

`voiceMode=true` 注入 ON，否则注入 OFF。

因此：

```text
voiceMode 缺失
```

不等于：

```text
没有 D15
```

而是：

```text
D15_off
```

---

## 11.10 D19 默认关闭

F163 flag 默认值：

```ts
alwaysOnInjection: ... ?? 'off'
```

见 [`f163-types.ts:22-32`](./clowder-ai/packages/api/src/domains/memory/f163-types.ts#L22-L32)。

三种模式：

```text
off    → 不查询
shadow → 查询但不注入
on     → 查询并把文档传给 D19
```

查询逻辑见 [`route-serial.ts:729-751`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L729-L751)。

注意：

> shadow 模式下虽然 Prompt 不变，查询和实验记录工作仍然发生。

---

# 12. 本例的 D 层实际输出

本轮使用与 `renderTemplate()` 等价的只读模板重放，得到：

```text
Identity: 缅因猫/砚砚 (@codex, model=gpt-5.3-codex)

当前模式：独立回答。

最近活跃：布偶猫(opus)

Routing: review prefer @codex (支付安全审查)

SOP: F-PAY-17 stage=review → load skill: code-review (workflow-sop)

Voice Mode OFF: 不强制发语音。默认用文字回复。你仍然可以发 audio rich block，
但仅在co-creator明确要求语音时才发。
```

所有已提供变量都完成替换，没有残留 `{{VAR}}`。

这些段按代码顺序组成一个 `invocationContext` 字符串，随后作为一个整体进入 `parts[0]`。

---

# 13. D 层的成本与边界

`buildInvocationContext()` 本身主要是纯字符串处理，但其上游数据获取不是免费的。

## 计算成本

设：

- `C`：本次 teammate 数；
- `P`：active participants 数；
- `A`：always_on docs 数；
- `S`：Signal articles 数；
- `W`：world characters/events 数。

大致为：

```text
O(C + P + A + S + W)
```

其中 D13 和 D9 有固定小上限。

## I/O 成本来自 Builder 之前

可能发生：

- ThreadStore 读；
- WorkflowSopStore 读；
- Signal lookup；
- EvidenceStore query；
- WorldStore 多次读；
- Guide/Concierge Store 读；
- PackStore 文件扫描。

这些 lookup 多数使用 try/catch fail-open。

因此：

> D 层最终只输出 D1/D7/D15，并不代表这轮只做了三个纯函数调用。

---

# 14. B、C、N、M 层

# 14.1 B1：Session Bootstrap

入口：

```ts
buildSessionBootstrap(...)
```

只在：

```text
不是 reborn
且 session-chain enabled
且有 SessionChainStore
且有 TranscriptReader
```

时尝试。

见 [`route-serial.ts:813-855`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L813-L855)。

它的消费者是：

```ts
parts = [
  invocationContext,
  modePrompt,
  bootstrapContext,
  mcpInstructions
]
```

本例 fresh session，返回空。

其内部 2000-token 算法和：

```text
recall → task → digest → threadMemory
```

丢弃顺序留到 Session 专篇详细推演。

---

# 14.2 C1：HTTP Callback Fallback

真实条件：

```ts
clientId !== 'antigravity' && !mcpAvailable
```

见 [`McpPromptInjector.ts:32-65`](./clowder-ai/packages/api/src/domains/cats/services/agents/invocation/McpPromptInjector.ts#L32-L65)。

所以它不是简单的：

```text
非 Claude → 注入
```

本例设定 `mcpAvailable=false`，因此 C1 存在。

---

# 14.3 N1：导航

在增量上下文中，无论 warm/cold 都会先构建：

```text
[导航]
...
[/导航]
```

见：

- [`route-helpers.ts:780-817`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L780-L817)
- [`navigation-context.ts:110-161`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/navigation-context.ts#L110-L161)

即使没有 baton/task/artifact，也会形成空 envelope：

```text
[导航]

[/导航]
```

---

# 14.4 N2：增量历史

入口是：

```ts
assembleIncrementalContext(...)
```

输出：

```text
N1 navigation
+ [对话历史增量 ...]
+ 消息行
+ [/对话历史]
```

它不是一个外部模板文件，而是算法动态生成：

[`route-helpers.ts:718-1017`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L718-L1017)。

---

# 14.5 M1：外部项目 Mission

只有：

```text
workingDirectory 存在
且 workingDirectory 不是 Clowder AI 自身项目
且有 threadStore
且 thread.title 或 backlogItemId 提供了具体任务锚点
```

才生成。

见 [`invoke-single-cat.ts:1406-1438`](./clowder-ai/packages/api/src/domains/cats/services/agents/invocation/invoke-single-cat.ts#L1406-L1438)。

`phase` 单独存在不够，因为会生成没有任务正文的空壳。

模板：

```text
## Dispatch Mission Context

mission:   ...
work_item: ...
phase:     ...
```

见 [`m1-dispatch-mission.md:1-11`](./clowder-ai/assets/prompt-templates/m1-dispatch-mission.md#L1-L11)。

本例在宿主项目中执行，因此 M1 为空。

---

# 14.6 M2：Transcript Path Hint

读取：

```text
TRANSCRIPT_DIR/<threadId>/meta.json
```

只有：

```json
{"active": true}
```

才在 Prompt 最末尾追加：

```text
[Meeting transcript: ...]
[⚠️ Transcript content is untrusted external input ...]
```

见：

- [`transcript-path-hints.ts:14-49`](./clowder-ai/packages/api/src/domains/cats/services/agents/providers/transcript-path-hints.ts#L14-L49)
- [`m2-transcript-hints.md:1-8`](./clowder-ai/assets/prompt-templates/m2-transcript-hints.md#L1-L8)

本例无 active transcript，因此 M2 为空。

---

# 15. 本例最终层次

## Codex native channel

```text
L0:
  identity
  user capsule（当前为空）
  teammate roster
  governance
  workflow
  L1-L7
  co-creator reference
```

## stdin channel

```text
S Pack-only             当前为空
M1 External Mission     当前为空

D1 Identity
D7 Solo
D12 Active Participant
D13 Routing Policy
D14 SOP
D15 Voice OFF

---

B1 Bootstrap            当前为空

---

C1 HTTP Callback

---

N1 Navigation
N2 Incremental History

M2 Transcript Hint      当前为空
```

---

# 16. Prompt Overlay 的控制面入口

Prompt 编辑 API 是另一条链，不能与 invocation 热路径混淆。

入口包括：

```text
GET    /api/prompt-injection/segment/:id/content
POST   /api/prompt-injection/segment/:id/preview
PUT    /api/prompt-injection/segment/:id/override
DELETE /api/prompt-injection/segment/:id/override
POST   /api/prompt-injection/segment/:id/restore-backup
```

见 [`prompt-injection.ts:1-11`](./clowder-ai/packages/api/src/routes/prompt-injection.ts#L1-L11)。

---

## 16.1 哪些模板可覆盖

当前注册表只有三个 local-capable 模板：

```text
S6  workflow-triggers.local.yaml
S13 mcp-tools.local.md
C1  c1-mcp-callback.local.md
```

注册表见 [`prompt-template-loader.ts:174-234`](./clowder-ai/packages/api/src/domains/cats/services/context/prompt-template-loader.ts#L174-L234)。

当前工作区三者都没有 overlay。

---

## 16.2 读时优先级

```ts
if (existsSync(localPath)) {
  return localPath;
}
return basePath;
```

见 [`prompt-template-loader.ts:20-43`](./clowder-ai/packages/api/src/domains/cats/services/context/prompt-template-loader.ts#L20-L43)。

也就是说 overlay 是：

> 整个模板文件替换，不是块级 merge。

---

## 16.3 写权限

PUT/DELETE/restore 需要：

1. Cookie-backed session user；
2. 请求来自直接 localhost；
3. 没有代理转发头；
4. Host 和 Origin 都是 loopback；
5. 配置了 owner 时必须是 owner。

见：

- [`prompt-injection.ts:34-68`](./clowder-ai/packages/api/src/routes/prompt-injection.ts#L34-L68)
- [`capability-write-guards.ts:90-125`](./clowder-ai/packages/api/src/config/capabilities/capability-write-guards.ts#L90-L125)

普通 `X-Cat-Cafe-User` header fallback 不够。

---

## 16.4 写入原子性

保存时：

1. 现有 `.local` 复制成 `.bak`；
2. 新内容写临时文件；
3. `renameSync()` 替换目标；
4. finally 删除残留 tmp。

见 [`prompt-injection.ts:93-119`](./clowder-ai/packages/api/src/routes/prompt-injection.ts#L93-L119) 和 [`prompt-injection.ts:303-319`](./clowder-ai/packages/api/src/routes/prompt-injection.ts#L303-L319)。

它保证：

- 单个 rename 不会暴露半写文件；
- 当前 Node 进程中同步写操作不会在中间被事件循环打断。

它不保证：

- 多 API 进程之间串行；
- 两个进程同时 PUT 时的全局顺序；
- `.bak` 一定对应最终覆盖前的那个版本。

多进程下属于 last-writer-wins，且没有文件锁。

---

## 16.5 Markdown 变量不做严格校验

模板渲染：

```ts
return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
  return key in vars ? vars[key] : match;
});
```

未提供的变量会原样保留：

[`prompt-template-loader.ts:45-55`](./clowder-ai/packages/api/src/domains/cats/services/context/prompt-template-loader.ts#L45-L55)。

写接口：

- YAML 会校验为 string-valued mapping；
- Markdown 只检查非空；
- 不校验新写入的 `{{TYPO_VAR}}` 是否能被运行时提供。

所以错误 overlay 可能把：

```text
{{TYPO_VAR}}
```

原样送入 Prompt。

这是“显式暴露配置错误”，但不是 fail-closed。

---

# 17. Overlay 与 L0 Cache 的一致性

UI 保存后只对 S6 执行：

```ts
clearL0Cache()
```

见 [`prompt-injection.ts:121-125`](./clowder-ai/packages/api/src/routes/prompt-injection.ts#L121-L125)。

原因：

- S6 被编入 native L0，需要重新编译；
- C1 每轮懒加载，不在 L0；
- S13 是非 native 静态路径懒加载，native L0 用的是 L5，不是 S13。

## 一致性边界

`clearL0Cache()` 是进程内操作。

因此多进程部署中：

```text
进程 A 保存 S6 overlay并清自己的 cache
进程 B 不收到通知
进程 B 继续使用旧 L0
```

当前没有看到：

- Redis pub/sub cache invalidation；
- 共享 generation；
- 文件 watcher。

所以 S6 overlay 的热更新保证是：

> 单进程即时；多进程不保证同时生效。

---

# 18. 当前 Prompt Injection Console 的两个实现差异

## 18.1 Manifest 当前缺失

`GET /api/prompt-injection/manifest` 会读取：

```text
assets/prompt-injection-manifest.yaml
```

文件不存在时返回 `404`：

[`rules.ts:340-375`](./clowder-ai/packages/api/src/routes/rules.ts#L340-L375)。

当前 checkout 中这个文件确实不存在。

影响：

- Console 的完整 Segment Registry 页面会失败；
- Hook H1-H3 的 resolver 也会得到空 manifest；
- 但运行时 S/D/C/N/M 模板仍能通过代码里的 `TEMPLATE_FILES` 工作。

因此：

> Manifest 缺失损坏的是管理/展示面，不直接阻断主 Prompt 热路径。

---

## 18.2 Preview 对 native L0 的判断是硬编码 clientId

Preview 使用：

```ts
new Set(['anthropic', 'openai', 'opencode'])
```

见 [`prompt-injection-preview.ts:28-30`](./clowder-ai/packages/api/src/routes/prompt-injection-preview.ts#L28-L30)。

真实热路径使用：

```ts
service.injectsL0Natively?.() ?? false
```

见 [`route-serial.ts:689-694`](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L689-L694)。

两者不是完全等价。

例如 Claude Carrier 可以动态选择：

```text
bg_daemon       → native
interactive_pty → 当前没有 native capability 方法
print_sdk       → native
```

见 [`claude-carrier-factory.ts:70-127`](./clowder-ai/packages/api/src/domains/cats/services/agents/providers/claude-carrier-factory.ts#L70-L127)。

所以：

> Preview 的 `isNativeL0` 是近似展示判断，实际运行时能力由具体 Service 实例决定。

---

# 19. 一个值得记录的 Provider Fallback 潜在风险

这是本篇调查发现的**可能风险，尚未复现**。

Claude Router 在 invocation 前调用：

```ts
wrapper.injectsL0Natively()
```

Wrapper 返回当前 active carrier 的能力：

[`claude-carrier-factory.ts:174-178`](./clowder-ai/packages/api/src/domains/cats/services/agents/providers/claude-carrier-factory.ts#L174-L178)。

Route 据此决定：

```text
传完整 static identity
还是只传 Pack-only
```

但 invocation 中若当前 carrier 抛出 quota/structural 错误，Wrapper 会：

1. 选择另一个 fallback carrier；
2. 把同一个 `prompt` 和同一个 `options` 原样传给 fallback。

见 [`claude-carrier-factory.ts:228-287`](./clowder-ai/packages/api/src/domains/cats/services/agents/providers/claude-carrier-factory.ts#L228-L287)。

降级链是：

```text
bg_daemon → interactive_pty → print_sdk → api_key
```

其中 native capability 可能变化。

可能出现：

### native → non-native

Route 只传了 Pack-only，fallback carrier 又没有 native L0：

```text
可能缺完整身份
```

### non-native → native

Route 已把完整 identity 放进消息文本，fallback carrier 又注入 native L0：

```text
可能重复身份
```

当前代码没有在切换 carrier 时重新协商 `injectsL0Natively`。

这属于：

- 由代码结构推导出的风险；
- 未运行 carrier 故尚未复现；
- 后续 Provider 专篇会继续核对每个 carrier 的真实输入行为。

---

# 20. Injection Trace 和 Prompt Capture 的证据边界

## Injection Trace

对于 native L0，它只记录：

```text
Pack-only aggregate
```

不会把 native L0 按 S/L 段逐段记录：

[`trace-collector.ts:94-129`](./clowder-ai/packages/api/src/domains/prompt-hooks/trace-collector.ts#L94-L129)。

而它自己明确说 delivery 是：

```text
route-level observation only
actual delivery depends on provider/session
```

见 [`trace-collector.ts:146-165`](./clowder-ai/packages/api/src/domains/prompt-hooks/trace-collector.ts#L146-L165)。

所以 Trace 能证明：

> Route 构造了什么。

不能独立证明：

> Provider 最终一定收到了什么。

---

## Prompt Capture

Prompt Capture 默认关闭。

开启后，native L0 通过异步编译器另外获取：

```ts
const l0 = await fetcher(input.catId);
```

失败只写 diagnostics，不阻塞 invocation：

[`prompt-capture-bridge.ts:63-103`](./clowder-ai/packages/api/src/infrastructure/debug/prompt-capture-bridge.ts#L63-L103)。

所以 Prompt Capture 是更完整的观测面，但仍是：

- fire-and-forget；
- 可能晚于 invocation；
- L0 获取失败时只有 `effectivePrompt`；
- 不是 Provider 端回显。

---

# 21. 本篇最小验证

本轮没有启动服务或安装依赖，只执行了只读文件验证和算法复演。

## 21.1 模板注册表完整性

检查 `TEMPLATE_FILES`：

```text
注册 key：50
唯一基础文件：48
基础文件缺失：0
```

50 个 key 比源码注释中的“all 49 segments”多一个；主要存在 D7、D15 的 alias key。

Local-capable 文件只有：

```text
workflow-triggers.local.yaml
mcp-tools.local.md
c1-mcp-callback.local.md
```

当前三者都不存在。

---

## 21.2 代表性模板渲染

使用与 `stripComments + renderTemplate` 等价的只读重放：

```text
D1  unresolved=0
D7  unresolved=0
D12 unresolved=0
D13 unresolved=0
D14 unresolved=0
D15 unresolved=0
C1  unresolved=0
```

没有残留占位符。

这是算法复演，不是调用项目编译产物。

---

## 21.3 Governance 结构验证

按源码中的精确正则和锚点检查：

```text
required anchors：13
missing anchors：0
P1-P5 异常：0
W1-W8 异常：0
Magic Words rows：10
```

因此当前 `shared-rules.md` 满足治理编译器的结构前置条件。

---

## 21.4 未执行 L0 子进程

当前仓库没有：

```text
node_modules
packages/api/dist
```

而 L0 编译脚本需要 import API `dist`。

所以没有强行运行：

```text
compile-system-prompt-l0.mjs
```

不能把上述结构验证说成“完整 L0 编译通过”。

---

# 22. 面试连续追问

## 第一问

**“你们的系统 Prompt 是一个大字符串吗？”**

### 可直接回答

不是。它至少分为 native L0 和本轮 message prompt 两个 Provider 通道；本轮 message prompt 内部又分 static Pack、dynamic invocation、session bootstrap、callback、navigation/history 和 mission/transcript 层。

---

## 追问

**“L0 和 S 层有什么区别？”**

### 源码级回答

L0 是原生 system/developer channel 使用的编译结果，包含身份、治理、路由和工具索引。

S 层是逻辑上的静态 Segment。对非 native Provider，S1-S13 以完整文本前置；对 native Provider，非 Pack S 段已经折叠进 L0，message prompt 只保留 Pack S3/S7/S10/S11/S12。

---

## 追问

**“为什么 Pack 不直接编进 L0？”**

### 源码级回答

Pack 是项目级、可变化内容，需要 invocation 时加载；L0 是按 cat 缓存的身份/治理层。

如果把 Pack 固化进 L0：

- 切换项目或 Pack 时缓存容易串；
- 需要频繁重编译全 L0；
- 外部项目的可变指令会污染猫的核心身份缓存。

因此 native Provider 采用：

```text
L0 原生通道
+ Pack-only message prepend
```

---

## 追问

**“治理规则如何避免文档改坏后静默少注入？”**

### 源码级回答

不是模型摘要，而是确定性解析。

代码要求 13 个 anchor 存在，P1-P5 和 W1-W8 每个恰好一次，Magic Words 至少 9 条；缺失或重复直接 throw。这样 shared-rules 的结构漂移会让 L0 编译失败，而不是生成残缺治理摘要。

边界是 `.local-override.md` 会直接替换治理内容，绕过上述结构投影，因此它属于高信任本地入口。

---

## 追问

**“动态上下文每轮都注入哪些？”**

### 可直接回答

D1 identity anchor、D7 mode 和 D15 voice on/off 基本是常驻；其余按结构化状态条件注入。

例如：

- A2A sender → D2；
- 同族分身 → D3；
- cross-post → D4；
- route policy → D13；
- workflow SOP → D14；
- always_on 文档且 feature flag 为 on → D19。

不是通过关键词猜，而是上游把结构字段传入 `InvocationContext`。

---

## 追问

**“Prompt Console 展示的就是实际 Prompt 吗？”**

### 源码级回答

不是。

`compiled-preview` 会展示所有可能的 D 模板和占位符，不执行真实条件选择；它对 native L0 的判断也只是按 clientId 的硬编码集合。

真实条件应以：

```ts
service.injectsL0Natively()
buildInvocationContext()
routeSerial()
invokeSingleCat()
```

为准。真实 Prompt 要看 Prompt Capture，但 Capture 默认关闭且 native L0 获取仍可能失败。

---

## 追问

**“Prompt 模板热更新有强一致性吗？”**

### 源码级回答

单进程内部分具备：

- 文件写使用 temp + rename；
- S6 保存后清当前进程 L0 cache；
- 模板读取是 lazy，下轮即可读取新文件。

但多进程没有：

- 文件锁；
- Redis pub/sub；
- 共享 cache generation。

所以不是多实例强一致，可能出现某些进程使用新模板、另一些还使用旧 L0。

---

## 追问

**“这里有哪些可靠性取舍？”**

### 准确回答

- L0 失败：fail-closed，因为不能让猫在无身份治理状态下工作。
- Pack 失败：fail-open，Pack 消失但核心 invocation 继续。
- World/Signal/SOP 等动态数据失败：大多 fail-open。
- Markdown overlay 未解析变量：原样保留，属于 loud misconfiguration，但不阻断。
- Prompt Capture/Trace 失败：不阻断热路径。
- 本地 override 权限严格，但多进程生效不是原子的。

---

# 23. 本篇完成与下一篇

## 已完成

- L0 的真实编译入口、输入、算法和下游；
- Governance 的确定性抽取；
- 用户 Capsule 和 teammate roster；
- L0 cache/inflight/generation 并发协议；
- S1-S13 在 native/non-native Provider 下的不同走法；
- Pack 编译、安全与第一 Pack 选择边界；
- D1-D21 的真实条件、算法与本例输出；
- B1/C1/N1/N2/M1/M2 的准确含义和位置；
- Prompt Overlay 写入、权限、备份和缓存失效；
- Console Preview 与运行时实现的差异；
- Injection Trace/Prompt Capture 的证据边界；
- Claude carrier 中 native capability 变化的潜在风险。

## 尚未展开

- Delivery cursor 的 Redis key、CAS 和多轮边界；
- warm context 的完整过滤、reply preview、rich block digest；
- token trim 的全部边界；
- Smart Window 的 burst、anchor、tombstone、ThreadMemory、Evidence；
- cursor 在成功、错误、取消时的 ack 顺序；
- session bootstrap 的 2000-token 算法；
- Provider fallback 风险的实际复现。

## 下一篇

下一篇进入既定路线的第三篇：

> **增量上下文与预算算法：一只猫到底能看到哪些消息，cursor 如何推进，whisper/stream/replyTo 如何过滤，以及超预算时究竟丢掉什么。**

届时会继续使用 `thread-pay-42 / M001-M003 / codex`，逐条推演：

```text
Redis/Memory message rows
→ cursor
→ unseen
→ relevant
→ formatted lines
→ token trim
→ boundary
→ ack
```

> 继续下一篇。
>
> 沿用已经确定的源码精读标准和章节路线。先简短确认上一篇已经覆盖的内容，以及本篇在完整执行链中的位置，然后直接进入新的源码细节，不要重新长篇介绍整体架构。
>
> 本篇仍必须包含：
>
> - 实际入口、调用点和下游消费者；
> - 贯穿的示例数据及中间状态；
> - 关键代码、SQL或状态转换；
> - 算法逐步推演、复杂度与边界；
> - 异常、并发、重试和一致性分析；
> - 必要且安全的最小验证；
> - 连续面试追问及准确回答。
>
> 如果当前版本发生变化，先核对受影响实现。
> 如果发现前文表述过强或有误，给出源码证据并纠正。
> 一次讲不完就拆分，但不要通过压缩算法细节来凑成一篇。
> 结尾更新已完成、待覆盖和下一篇范围。

<details><summary>9 previous messages</summary>

> 我先核对当前 HEAD、工作区与第三篇关键文件是否漂移；若基线不变，就直接承接上一篇的分层结果，进入 **N1/N2 增量上下文：cursor → unseen → 可见性过滤 → 格式化 → 双重裁剪 → boundary → ack**。本篇会继续沿 `thread-pay-42 / codex`，但扩充消息样本，以覆盖 whisper、stream、queued、replyTo、rich block 和异常游标。
>
> <details><summary>Ran a command</summary>
>
> - Ran `$mem='C:\Users\Administrator\.codex\memories\MEMORY.md'; $lines=Get-Content -LiteralPath $mem -Encoding UTF8; for($i=124;$i -le 149;$i++){"${i}:$($lines[$i-1])"}; Write-Output '=== git baseline ==='; git -c safe.directory='D:/AI/clower-1/clowder-ai' -C 'D:\AI\clower-1\clowder-ai' rev-parse HEAD; git -c safe.directory='D:/AI/clower-1/clowder-ai' -C 'D:\AI\clower-1\clowder-ai' log -1 --format='%H%n%cI%n%s'; git -c safe.directory='D:/AI/clower-1/clowder-ai' -C 'D:\AI\clower-1\clowder-ai' status --short --branch`
>
> </details>
>
> 版本未变化，仍是 `6868041cae3b9dcab163a1fd85845b9778c3adc5`，工作区未显示源码改动。上一篇已经把 L0/S/D/B/C/N/M 的来源和通道拆开；本篇只聚焦其中 N1/N2，并追踪它的持久化状态：**每只猫在每个用户、每个 thread 上“上次送到哪里”的 delivery cursor。**
>
> <details><summary>Ran 8 commands</summary>
>
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== $p [$s-$e] ==="; for($i=$s;$i -le [Math]::Min($e,$a.Count);$i++){"${i}:$($a[$i-1])"}}; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts'; Show-Lines $p 180 260; Show-Lines $p 580 690; Show-Lines $p 688 880; Show-Lines $p 880 1020`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== $p [$s-$e] ==="; for($i=$s;$i -le [Math]::Min($e,$a.Count);$i++){"${i}:$($a[$i-1])"}}; $base='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores'; Show-Lines "$base\ports\MessageStore.ts" 20 170; Show-Lines "$base\ports\MessageStore.ts" 340 430; Show-Lines "$base\ports\MessageStore.ts" 540 610; Show-Lines "$base\redis\RedisMessageStore.ts" 500 570; Show-Lines "$base\visibility.ts" 1 260`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== $p [$s-$e] ==="; for($i=$s;$i -le [Math]::Min($e,$a.Count);$i++){"${i}:$($a[$i-1])"}}; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\ContextAssembler.ts'; Show-Lines $p 34 166; Show-Lines $p 167 232; $t='D:\AI\clower-1\clowder-ai\packages\api\src\utils\token-counter.ts'; Show-Lines $t 1 75`
> - Ran `function Show-Lines($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8; Write-Output "=== $p [$s-$e] ==="; for($i=$s;$i -le [Math]::Min($e,$a.Count);$i++){"${i}:$($a[$i-1])"}}; $base='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores'; Show-Lines "$base\ports\DeliveryCursorStore.ts" 1 125; Show-Lines "$base\ports\DeliveryCursorStore.ts" 125 240; rg -n "setDeliveryCursor|getDeliveryCursor|deliveryCursor" 'D:\AI\clower-1\clowder-ai\packages\shared\src' 'D:\AI\clower-1\clowder-ai\packages\api\src' --glob '*.ts' | Select-Object -First 240`
> - Ran `function S($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;Write-Output "=== route-helpers $s-$e ===";for($i=$s;$i -le $e;$i++){"${i}:$($a[$i-1])"}}; S 594 665; S 665 780; S 780 880; S 874 950; S 950 1018`
> - Ran `function S($s,$e){$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\visibility.ts';$a=Get-Content -LiteralPath $p -Encoding UTF8;Write-Output "=== visibility $s-$e ===";for($i=$s;$i -le [Math]::Min($e,$a.Count);$i++){"${i}:$($a[$i-1])"}}; S 1 150`
> - Ran `function S($p,$s,$e){$a=Get-Content -LiteralPath $p -Encoding UTF8;Write-Output "=== $p $s-$e ===";for($i=$s;$i -le [Math]::Min($e,$a.Count);$i++){"${i}:$($a[$i-1])"}}; $m='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\MessageStore.ts'; S $m 340 430; S $m 571 606; $r='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\redis\RedisMessageStore.ts'; S $r 77 175; S $r 512 570; rg -n "markDelivered\(|deliveryStatus.*delivered|zadd\(|deliveredAt" $r | Select-Object -First 120`
> - Ran `$roots=@('D:\AI\clower-1\clowder-ai\packages\shared\src','D:\AI\clower-1\clowder-ai\packages\api\src'); rg -n "class SessionStore|setDeliveryCursor|getDeliveryCursor|DELIVERY_CURSOR|deliveryCursor" $roots --glob '*.ts' | Select-Object -First 300`
>
> </details>
>
> Context compaction
>
> Source: automatic
> Status: completed
>
> 我会先核对当前 `HEAD`、仓库说明和上一篇留下的增量上下文关键点，再直接完成第三篇；全程只读，不启动服务或连接外部依赖。重点会补齐 **boundary/ack 的真实时机、Redis CAS、多进程边界，以及几个尚待证实的风险点**。
>
> <details><summary>Ran 38 commands</summary>
>
> - Ran `$ErrorActionPreference='Stop'; Write-Host '--- memory hits ---'; Select-String -LiteralPath 'C:\Users\Administrator\.codex\memories\MEMORY.md' -Pattern 'prompt|源码精读|source-grounded|ContextAssembler|incremental|增量上下文' -Encoding UTF8 | Select-Object -First 40 | ForEach-Object { '{0}:{1}:{2}' -f $_.Path,$_.LineNumber,$_.Line }; Write-Host '--- repo state ---'; git -c safe.directory='D:/AI/clower-1/clowder-ai' -C 'D:\AI\clower-1\clowder-ai' status --short --branch; git -c safe.directory='D:/AI/clower-1/clowder-ai' -C 'D:\AI\clower-1\clowder-ai' rev-parse HEAD; git -c safe.directory='D:/AI/clower-1/clowder-ai' -C 'D:\AI\clower-1\clowder-ai' log -1 --format='%h %ci %s'; Write-Host '--- instructions ---'; Get-Content -LiteralPath 'D:\AI\clower-1\clowder-ai\AGENTS.md' -Encoding UTF8 -TotalCount 220`
> - Ran `$ErrorActionPreference='Stop'; $mem='C:\Users\Administrator\.codex\memories\MEMORY.md'; $lines=Get-Content -LiteralPath $mem -Encoding UTF8; foreach($range in @(@(124,155),@(196,222))){ Write-Host ('--- MEMORY {0}-{1} ---' -f $range[0],$range[1]); for($i=$range[0];$i -le $range[1];$i++){ '{0,4}: {1}' -f $i,$lines[$i-1] } }; Write-Host '--- skill ---'; Get-Content -LiteralPath 'C:\Users\Administrator\.codex\memories\skills\source-grounded-interview-analysis\SKILL.md' -Encoding UTF8 -TotalCount 260`
> - Ran `$ErrorActionPreference='Stop'; Set-Location 'D:\AI\clower-1\clowder-ai'; rg -n --hidden --glob '!node_modules' --glob '!dist' "assembleIncrementalContext|ackCollectedCursors|recordDeliveryBoundary|seed.*seen|advanceSeen|deliveryCursorStore|getByThreadAfter|atomic.*Max|compare.*set|lua|markDelivered|softDelete|deletedAt|currentMessageFilteredOut|sanitizeInjectedContent|resolveVisibleReplyParent" packages/api/src packages/shared/src | Select-Object -First 500`
> - Ran `$ErrorActionPreference='Stop'; function Show-Lines([string]$Path,[int]$Start,[int]$End){ $ls=Get-Content -LiteralPath $Path -Encoding UTF8; Write-Host "--- $Path:$Start-$End ---"; for($i=$Start;$i -le [Math]::Min($End,$ls.Count);$i++){ '{0,5}: {1}' -f $i,$ls[$i-1] } }; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts'; Show-Lines $p 180 245; Show-Lines $p 570 680; Show-Lines $p 680 850; Show-Lines $p 850 1040; Show-Lines $p 1040 1220; Show-Lines $p 1220 1360`
> - Ran `$ErrorActionPreference='Stop'; function Show-Lines([string]$Path,[int]$Start,[int]$End){ $ls=Get-Content -LiteralPath $Path -Encoding UTF8; Write-Host ('--- {0}:{1}-{2} ---' -f $Path,$Start,$End); for($i=$Start;$i -le [Math]::Min($End,$ls.Count);$i++){ '{0,5}: {1}' -f $i,$ls[$i-1] } }; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts'; Show-Lines $p 180 245; Show-Lines $p 570 680; Show-Lines $p 680 850; Show-Lines $p 850 1040; Show-Lines $p 1040 1220; Show-Lines $p 1220 1360`
> - Ran `$ErrorActionPreference='Stop'; function Show-Lines([string]$Path,[int]$Start,[int]$End){ $ls=Get-Content -LiteralPath $Path -Encoding UTF8; Write-Host ('--- {0}:{1}-{2} ---' -f $Path,$Start,$End); for($i=$Start;$i -le [Math]::Min($End,$ls.Count);$i++){ '{0,5}: {1}' -f $i,$ls[$i-1] } }; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts'; Show-Lines $p 240 280; Show-Lines $p 594 680; Show-Lines $p 680 770; Show-Lines $p 770 860; Show-Lines $p 860 950; Show-Lines $p 950 1040`
> - Ran `$ErrorActionPreference='Stop'; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts'; $ls=Get-Content -LiteralPath $p -Encoding UTF8; foreach($r in @(@(659,759),@(760,859),@(860,950))){ Write-Host ('--- {0}-{1} ---' -f $r[0],$r[1]); for($i=$r[0];$i -le $r[1];$i++){ '{0,5}: {1}' -f $i,$ls[$i-1] }}`
> - Ran `$ErrorActionPreference='Stop'; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts'; $ls=Get-Content -LiteralPath $p -Encoding UTF8; for($i=754;$i -le 859;$i++){ '{0,5}: {1}' -f $i,$ls[$i-1] }`
> - Ran `$ErrorActionPreference='Stop'; function Show([string]$p,[int]$s,[int]$e){$l=Get-Content -LiteralPath $p -Encoding UTF8; Write-Host ('--- {0}:{1}-{2} ---' -f $p,$s,$e); for($i=$s;$i -le [Math]::Min($e,$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}; Show 'D:\AI\clower-1\clowder-ai\packages\api\src\config\cat-budgets.ts' 1 160; Show 'D:\AI\clower-1\clowder-ai\packages\api\src\config\hierarchical-context-config.ts' 1 180; rg -n "function estimateTokens|export function estimateTokens|encodingForModel" packages/api/src packages/shared/src | Select-Object -First 100`
> - Ran `$ErrorActionPreference='Stop'; function Show([string]$p,[int]$s,[int]$e){$l=Get-Content -LiteralPath $p -Encoding UTF8; Write-Host ('--- {0}:{1}-{2} ---' -f $p,$s,$e); for($i=$s;$i -le [Math]::Min($e,$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}; Show 'D:\AI\clower-1\clowder-ai\packages\api\src\config\cat-budgets.ts' 87 132; Show 'D:\AI\clower-1\clowder-ai\packages\api\src\utils\token-counter.ts' 1 90`
> - Ran `$ErrorActionPreference='Stop'; rg -n "class DeliveryCursorStore|interface.*Cursor|ackCursor|getCursor|getMentionAckCursor|ackMention|seenCursor|getSeenCursor|ackSeen" 'D:\AI\clower-1\clowder-ai\packages\api\src' | Select-Object -First 200; $p=(rg -l "class DeliveryCursorStore" 'D:\AI\clower-1\clowder-ai\packages\api\src' | Select-Object -First 1); Write-Host "FILE=$p"; if($p){$l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1;$i -le $l.Count;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}`
> - Ran `$p=(rg -l "class DeliveryCursorStore" 'D:\AI\clower-1\clowder-ai\packages\api\src' | Select-Object -First 1); Write-Output $p`
> - Ran `$ErrorActionPreference='Stop'; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\DeliveryCursorStore.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; foreach($r in @(@(1,120),@(121,240))){Write-Host ('--- {0}-{1} ---' -f $r[0],$r[1]); for($i=$r[0];$i -le [Math]::Min($r[1],$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\DeliveryCursorStore.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=61;$i -le 175;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\shared\src\utils\redis.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; foreach($r in @(@(1,160),@(160,260))){ Write-Host ('--- {0}-{1} ---' -f $r[0],$r[1]); for($i=$r[0];$i -le [Math]::Min($r[1],$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}`
> - Ran `$ErrorActionPreference='Stop'; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; foreach($r in @(@(440,505),@(860,940),@(3460,3530))){Write-Host ('--- route-serial {0}-{1} ---' -f $r[0],$r[1]); for($i=$r[0];$i -le [Math]::Min($r[1],$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}; Write-Host '--- ack references routes ---'; rg -n "ackCollectedCursors|cursorBoundaries|deliveryBoundaries|ackCursor\(" 'D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts' 'D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\AgentRouter.ts' 'D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\QueueProcessor.ts'`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=883;$i -le 940;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }; Write-Host '--- 3488-3517 ---'; for($i=3488;$i -le 3517;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `$ErrorActionPreference='Stop'; rg -n "shouldAppendExplicitCurrentMessage|inc\.contextText|incrementalContext|assembledContext|promptParts|contextText" 'D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts' | Select-Object -First 120`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=930;$i -le 1015;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `rg -n "invokeSingleCat\(|prompt," 'D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts' | Select-Object -First 80`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1225;$i -le 1275;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\AgentRouter.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; foreach($r in @(@(1550,1710),@(1730,1760))){Write-Host ('--- AgentRouter {0}-{1} ---' -f $r[0],$r[1]); for($i=$r[0];$i -le [Math]::Min($r[1],$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\AgentRouter.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1710;$i -le 1737;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `$ErrorActionPreference='Stop'; $p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; foreach($r in @(@(1035,1075),@(1215,1260),@(1365,1465),@(1500,1565))){ Write-Host ('--- messages {0}-{1} ---' -f $r[0],$r[1]); for($i=$r[0];$i -le [Math]::Min($r[1],$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1365;$i -le 1456;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=3360;$i -le 3555;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1180;$i -le 1275;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `$ErrorActionPreference='Stop'; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\QueueProcessor.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; foreach($r in @(@(855,890),@(1245,1280),@(1410,1510))){Write-Host ('--- QueueProcessor {0}-{1} ---' -f $r[0],$r[1]); for($i=$r[0];$i -le [Math]::Min($r[1],$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}`
> - Ran `$ErrorActionPreference='Stop'; rg -n "let _seq|function generate.*Id|generateMessageId|class MessageStore|getByThreadAfter\(|markDelivered\(|softDelete\(|hardDelete\(" 'D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores' | Select-Object -First 250`
> - Ran `$ErrorActionPreference='Stop'; function Show([string]$p,[int]$s,[int]$e){$l=Get-Content -LiteralPath $p -Encoding UTF8; Write-Host ('--- {0}:{1}-{2} ---' -f $p,$s,$e); for($i=$s;$i -le [Math]::Min($e,$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\MessageStore.ts'; Show $p 330 375; Show $p 550 620; Show $p 640 750; $r='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\redis\RedisMessageStore.ts'; Show $r 480 575; Show $r 725 785; Show $r 835 885`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\redis\RedisMessageStore.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=490;$i -le 575;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }; Write-Host '--- MessageStore delete and deliver ---'; $q='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\MessageStore.ts'; $m=Get-Content -LiteralPath $q -Encoding UTF8; for($i=640;$i -le 745;$i++){ '{0,5}: {1}' -f $i,$m[$i-1] }`
> - Ran `$ErrorActionPreference='Stop'; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\visibility.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1;$i -le [Math]::Min(180,$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }; Write-Host '--- ContextAssembler relevant ---'; $q='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\ContextAssembler.ts'; if(Test-Path $q){$m=Get-Content -LiteralPath $q -Encoding UTF8; for($i=1;$i -le [Math]::Min(220,$m.Count);$i++){ '{0,5}: {1}' -f $i,$m[$i-1] }} else {rg -l "function formatMessage|export function formatMessage" 'D:\AI\clower-1\clowder-ai\packages\api\src'}`
> - Ran `rg -l "export function canViewMessage|resolveVisibleReplyParent" 'D:\AI\clower-1\clowder-ai\packages\api\src'; rg -l "export function formatMessage" 'D:\AI\clower-1\clowder-ai\packages\api\src'`
> - Ran `$ErrorActionPreference='Stop'; function Show([string]$p,[int]$s,[int]$e){$l=Get-Content -LiteralPath $p -Encoding UTF8; Write-Host ('--- {0}:{1}-{2} ---' -f $p,$s,$e); for($i=$s;$i -le [Math]::Min($e,$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}; Show 'D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\visibility.ts' 1 160; Show 'D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\ContextAssembler.ts' 1 210`
> - Ran `$ErrorActionPreference='Stop'; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\visibility.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=91;$i -le 135;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }; Write-Host '--- ContextAssembler 1-170 ---'; $q='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\ContextAssembler.ts'; $m=Get-Content -LiteralPath $q -Encoding UTF8; for($i=1;$i -le 170;$i++){ '{0,5}: {1}' -f $i,$m[$i-1] }`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\visibility.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=126;$i -le [Math]::Min(175,$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `$ErrorActionPreference='Stop'; Set-Location 'D:\AI\clower-1\clowder-ai'; rg -n --glob '*test*' --glob '*spec*' "deletedAt|softDelete|hardDelete|tombstone|cursor.*deleted|includeDeleted|assembleIncrementalContext" packages/api/src packages/api/test packages/api/tests 2>$null | Select-Object -First 500`
> - Ran `$ErrorActionPreference='Stop'; Set-Location 'D:\AI\clower-1\clowder-ai'; rg -l --glob '*test.js' --glob '*test.ts' "assembleIncrementalContext" packages/api/test packages/api/src | Sort-Object; rg -n --glob '*test.js' --glob '*test.ts' "getByThreadAfter|currentMessageFilteredOut|zero.*budget|token.*trim|filtered.*cursor|boundaryId|cursor.*expired|queued.*delivered" packages/api/test packages/api/src | Select-Object -First 500`
>
> </details>
>
> 版本未变化：仍是 `main@6868041cae3b9dcab163a1fd85845b9778c3adc5`，工作区干净。当前源码已经确认了一个需要在本篇纠正的点：**“成功前 ack，ack 失败会使调用失败”只是调用处注释表达；实际 `ackCollectedCursors()` 会逐项吞掉错误并只记录日志，因此 ack 与 invocation succeeded 并非事务绑定。**下面我继续核对删除消息、队列重排和并发测试证据。
>
> <details><summary>Ran 43 commands</summary>
>
> - Ran `$ErrorActionPreference='Stop'; Set-Location 'D:\AI\clower-1\clowder-ai'; Write-Host '--- package/test env ---'; Get-Content -LiteralPath 'packages/api/package.json' -Encoding UTF8 -TotalCount 220; Write-Host ('root node_modules=' + (Test-Path -LiteralPath 'node_modules')); Write-Host ('api node_modules=' + (Test-Path -LiteralPath 'packages/api/node_modules')); Write-Host '--- relevant test headings ---'; foreach($f in @('packages/api/test/f148-assemble-incremental.test.js','packages/api/test/incremental-context-budget.test.js','packages/api/test/incremental-context-token-budget.test.js','packages/api/test/incremental-context-prompt-budget.test.js','packages/api/test/route-strategies.test.js','packages/api/test/route-serial-cursor-monotonic.test.js','packages/api/test/concurrent-fault-drill.test.js','packages/api/test/redis-message-store.test.js','packages/api/test/soft-delete.test.js')){ if(Test-Path -LiteralPath $f){ Write-Host "### $f"; rg -n "describe\(|it\(|test\(" $f | Select-Object -First 120 }}`
> - Ran `$ErrorActionPreference='Stop'; function Show([string]$p,[int]$s,[int]$e){$l=Get-Content -LiteralPath $p -Encoding UTF8; Write-Host ('--- {0}:{1}-{2} ---' -f $p,$s,$e); for($i=$s;$i -le [Math]::Min($e,$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}; Show 'D:\AI\clower-1\clowder-ai\packages\api\test\f148-assemble-incremental.test.js' 1 125; Show 'D:\AI\clower-1\clowder-ai\packages\api\test\incremental-context-budget.test.js' 1 260; Show 'D:\AI\clower-1\clowder-ai\packages\api\test\incremental-context-token-budget.test.js' 1 300`
> - Ran `$ErrorActionPreference='Stop'; foreach($f in @('incremental-context-budget.test.js','incremental-context-token-budget.test.js','incremental-context-prompt-budget.test.js')){ $p="D:\AI\clower-1\clowder-ai\packages\api\test\$f"; Write-Host "--- $f ---"; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1;$i -le $l.Count;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}`
> - Ran `$ErrorActionPreference='Stop'; function Show([string]$p,[int]$s,[int]$e){$l=Get-Content -LiteralPath $p -Encoding UTF8; Write-Host ('--- {0}:{1}-{2} ---' -f $p,$s,$e); for($i=$s;$i -le [Math]::Min($e,$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}; Show 'D:\AI\clower-1\clowder-ai\packages\api\test\redis-message-store.test.js' 350 445; Show 'D:\AI\clower-1\clowder-ai\packages\api\test\soft-delete.test.js' 1 175; Show 'D:\AI\clower-1\clowder-ai\packages\api\test\soft-delete.test.js' 289 340; Show 'D:\AI\clower-1\clowder-ai\packages\api\test\route-serial-cursor-monotonic.test.js' 1 170; Show 'D:\AI\clower-1\clowder-ai\packages\api\test\concurrent-fault-drill.test.js' 1 145; Show 'D:\AI\clower-1\clowder-ai\packages\api\test\concurrent-fault-drill.test.js' 230 310`
> - Ran `$ErrorActionPreference='Stop'; function Show([string]$p,[int]$s,[int]$e){$l=Get-Content -LiteralPath $p -Encoding UTF8; Write-Host ('--- {0}:{1}-{2} ---' -f $p,$s,$e); for($i=$s;$i -le [Math]::Min($e,$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}; Show 'D:\AI\clower-1\clowder-ai\packages\api\test\soft-delete.test.js' 88 172; Show 'D:\AI\clower-1\clowder-ai\packages\api\test\soft-delete.test.js' 289 337; Show 'D:\AI\clower-1\clowder-ai\packages\api\test\route-serial-cursor-monotonic.test.js' 1 175; Show 'D:\AI\clower-1\clowder-ai\packages\api\test\concurrent-fault-drill.test.js' 1 125`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\test\route-serial-cursor-monotonic.test.js'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1;$i -le $l.Count;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }; Write-Host '--- soft 323-337 ---'; $q='D:\AI\clower-1\clowder-ai\packages\api\test\soft-delete.test.js'; $m=Get-Content -LiteralPath $q -Encoding UTF8; for($i=323;$i -le 337;$i++){ '{0,5}: {1}' -f $i,$m[$i-1] }`
> - Ran `Set-Location 'D:\AI\clower-1\clowder-ai'; rg -n "revealWhispers|revealedAt|reveal.*whisper|ackCursor.*reveal|deliveryCursor.*reveal" packages/api/src packages/api/test | Select-Object -First 300`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\threads.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=960;$i -le 1010;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `$ErrorActionPreference='Stop'; $p='D:\AI\clower-1\clowder-ai\packages\api\test\route-strategies.test.js'; $l=Get-Content -LiteralPath $p -Encoding UTF8; foreach($r in @(@(1060,1175),@(1250,1360),@(2110,2190))){ Write-Host ('--- {0}-{1} ---' -f $r[0],$r[1]); for($i=$r[0];$i -le [Math]::Min($r[1],$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}; Write-Host '--- f148 privacy references ---'; rg -n "whisper|filtered|currentMessageFilteredOut|revealed|system|briefing|stream" 'D:\AI\clower-1\clowder-ai\packages\api\test\f148-assemble-incremental.test.js' | Select-Object -First 200`
> - Ran `Set-Location 'D:\AI\clower-1\clowder-ai'; rg -n "assembleIncrementalContext|shouldAppendExplicitCurrentMessage|deliveryBoundaryId|cursorBoundaries|ackCursor|effectiveContextBudget|ackSeenCursor" packages/api/src/domains/cats/services/agents/routing/route-parallel.ts | Select-Object -First 200`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-parallel.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; foreach($r in @(@(350,505),@(1510,1575))){Write-Host ('--- route-parallel {0}-{1} ---' -f $r[0],$r[1]); for($i=$r[0];$i -le [Math]::Min($r[1],$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}`
> - Ran `$ErrorActionPreference='Stop'; rg -n "generateSortableId|zadd\(MessageKeys\.thread|timestamp.*score|deliveryStatus" 'D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\redis\RedisMessageStore.ts' | Select-Object -First 180; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\redis\RedisMessageStore.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; foreach($r in @(@(1,120),@(270,365))){Write-Host ('--- {0}-{1} ---' -f $r[0],$r[1]); for($i=$r[0];$i -le [Math]::Min($r[1],$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\redis\RedisMessageStore.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=108;$i -le 170;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `Set-Location 'D:\AI\clower-1\clowder-ai'; rg -n --glob '*test*' "older.*id|lexicographic|re.?deliver|deliveredAt.*cursor|cursor.*deliveredAt|score.*cursor|queued.*cursor|cursor.*queued|markDelivered.*cursor|infinite.*delivery|duplicate.*queued" packages/api/test packages/api/src | Select-Object -First 400`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\test\route-strategies.test.js'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1235;$i -le 1345;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }; Write-Host '--- callback cursor comment ---'; $q='D:\AI\clower-1\clowder-ai\packages\api\test\callback-routes.test.js'; $m=Get-Content -LiteralPath $q -Encoding UTF8; for($i=4085;$i -le 4125;$i++){ '{0,5}: {1}' -f $i,$m[$i-1] }`
> - Ran `Set-Location 'D:\AI\clower-1\clowder-ai'; rg -l --glob '*test.js' "DeliveryCursorStore" packages/api/test | Sort-Object; rg -n --glob '*test.js' "ackCursor|setDeliveryCursor|getDeliveryCursor|monotonic|Redis.*cursor|CAS.*cursor|cursor.*CAS" packages/api/test | Select-Object -First 400`
> - Ran `$ErrorActionPreference='Stop'; $p='D:\AI\clower-1\clowder-ai\packages\api\test\cursor-store-atomicity.test.js'; $l=Get-Content -LiteralPath $p -Encoding UTF8; foreach($r in @(@(1,180),@(180,360))){Write-Host ('--- cursor atomicity {0}-{1} ---' -f $r[0],$r[1]); for($i=$r[0];$i -le [Math]::Min($r[1],$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\index.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=510;$i -le 590;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }; rg -n "new RedisMessageStore|new MessageStore|sessionStore =|createRedisClient|REDIS" $p | Select-Object -First 120`
> - Ran `Set-Location 'D:\AI\clower-1\clowder-ai'; rg -n '"catId"\s*:\s*"codex"|"maxPromptTokens"|"maxContextTokens"|"maxMessages"|"maxContentLengthPerMsg"' cat-template.json .cat-cafe/cat-catalog.json 2>$null | Select-Object -First 180; if(Test-Path -LiteralPath 'cat-template.json'){Write-Host '--- codex nearby ---'; $l=Get-Content -LiteralPath 'cat-template.json' -Encoding UTF8; $hits=Select-String -InputObject $l -Pattern '"catId": "codex"'; foreach($h in $hits){$s=[Math]::Max(1,$h.LineNumber-20);$e=[Math]::Min($l.Count,$h.LineNumber+50); for($i=$s;$i -le $e;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}}`
> - Ran `rg -n "async hydrateMessages|hydrateMessages\(" 'D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\redis\RedisMessageStore.ts' | Select-Object -First 30; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\redis\RedisMessageStore.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=930;$i -le 1005;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `rg -n "export function isDelivered|function isDelivered" 'D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\MessageStore.ts'; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\MessageStore.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=175;$i -le 220;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\MessageStore.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1;$i -le 45;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `Set-Location 'D:\AI\clower-1\clowder-ai'; rg -n "InstanceLease|instance lease|api-instance|acquire.*lease|single instance|lease" packages/api/src/index.ts packages/api/src/infrastructure packages/api/src | Select-Object -First 250`
> - Ran `$ErrorActionPreference='Stop'; function Show([string]$p,[int]$s,[int]$e){$l=Get-Content -LiteralPath $p -Encoding UTF8; Write-Host ('--- {0}:{1}-{2} ---' -f $p,$s,$e); for($i=$s;$i -le [Math]::Min($e,$l.Count);$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }}; Show 'D:\AI\clower-1\clowder-ai\packages\api\src\index.ts' 3540 3610; Show 'D:\AI\clower-1\clowder-ai\packages\api\src\services\ApiInstanceLease.ts' 1 135; Show 'D:\AI\clower-1\clowder-ai\packages\api\src\services\ApiInstanceLease.ts' 135 280`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\services\ApiInstanceLease.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=80;$i -le 155;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `$p='C:\Users\Administrator\.codex\memories\skills\source-grounded-interview-analysis\SKILL.md'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1;$i -le $l.Count;$i++){ '{0,4}: {1}' -f $i,$l[$i-1] }`
> - Ran `$ErrorActionPreference='Stop'; Write-Host '--- setup-cat-registry ---'; Get-Content -LiteralPath 'D:\AI\clower-1\clowder-ai\packages\api\test\helpers\setup-cat-registry.js' -Encoding UTF8 -TotalCount 260; Write-Host '--- with-test-home ---'; Get-Content -LiteralPath 'D:\AI\clower-1\clowder-ai\packages\api\scripts\with-test-home.sh' -Encoding UTF8 -TotalCount 260`
> - Ran `node -e "const unseen=[['M002','other-callback',true],['M003','other-stream',false],['M004','whisper-other',false],['M005','whisper-codex',true],['M006','system',false],['M007','briefing',false],['M008','own-normal',false],['M009','public-reply',true],['M010','current-user',true],['M011','queued',false]]; const relevant=unseen.filter(x=>x[2]).map(x=>x[0]); const weights=new Map([['M002',40],['M005',70],['M009',90],['M010',50]]); const maxMessages=3,budget=150; const capped=relevant.slice(-maxMessages); const ws=capped.map(x=>weights.get(x)); const total=ws.reduce((a,b)=>a+b,0); let drop=0,start=0; if(total>budget){for(let i=0;i<ws.length-1;i++){drop+=ws[i];if(total-drop<=budget){start=i+1;break;}}if(total-drop>budget)start=ws.length-1;} const final=capped.slice(start); const overWeights=[70,90,200]; let d=0,s=0,t=overWeights.reduce((a,b)=>a+b,0);for(let i=0;i<overWeights.length-1;i++){d+=overWeights[i];if(t-d<=150){s=i+1;break;}}if(t-d>150)s=overWeights.length-1; const existing='0000000000000010-000000-aaaa',lateQueued='0000000000000005-000000-bbbb'; const ack=existing>lateQueued?existing:lateQueued; console.log(JSON.stringify({storeReturned:['M002','M003','M004','M005','M006','M007','M008','M009','M010'],relevant,capped,weights:ws,total,final,boundary:final.at(-1),singleOversize:{weights:overWeights,kept:overWeights.slice(s),stillOver:overWeights.slice(s).reduce((a,b)=>a+b,0)>150},lateQueuedVsCursor:{existing,lateQueued,ack,canAdvance:ack===lateQueued}},null,2));"`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\ContextAssembler.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=40;$i -le 88;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }; Write-Host '--- format time ---'; $q='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\format-time.ts'; $m=Get-Content -LiteralPath $q -Encoding UTF8; for($i=1;$i -le $m.Count;$i++){ '{0,5}: {1}' -f $i,$m[$i-1] }`
> - Ran `$p='D:\AI\clower-1\clowder-ai\cat-template.json'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=350;$i -le 395;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `rg -n "persistenceContext\.failed|governanceErrorCode|ackCollectedCursors" 'D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\QueueProcessor.ts' | Select-Object -First 100; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\QueueProcessor.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1370;$i -le 1465;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `Set-Location 'D:\AI\clower-1\clowder-ai'; rg -n "class InvocationTracker|startAll\(|track.*slot|active.*cat|slotKey|preempt" packages/api/src/domains/cats/services/agents packages/api/src | Select-Object -First 300`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\InvocationTracker.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=55;$i -le 150;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }; rg -n "startAll|acquireGuard|tryAcquire" $p`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\InvocationTracker.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=380;$i -le 465;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `rg -n "startAll\(|tryStartThreadAll\(" 'D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts' | Select-Object -First 30; $p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=970;$i -le 1035;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=805;$i -le 965;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\QueueProcessor.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=970;$i -le 1020;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `Write-Output ('api-dist=' + (Test-Path -LiteralPath 'D:\AI\clower-1\clowder-ai\packages\api\dist')); Write-Output ('shared-dist=' + (Test-Path -LiteralPath 'D:\AI\clower-1\clowder-ai\packages\shared\dist')); git -c safe.directory='D:/AI/clower-1/clowder-ai' -C 'D:\AI\clower-1\clowder-ai' status --short --branch`
> - Ran `node -e "const ids=['M002','M005','M009','M010'],w=[40,70,90,50],budget=150;const total=w.reduce((a,b)=>a+b,0);let drop=0,start=0;for(let i=0;i<w.length-1&&total>budget;i++){drop+=w[i];if(total-drop<=budget){start=i+1;break;}}if(total>budget&&total-drop>budget)start=w.length-1;console.log(JSON.stringify({ids,weights:w,total,budget,dropped:ids.slice(0,start),kept:ids.slice(start),remaining:w.slice(start).reduce((a,b)=>a+b,0),boundary:ids.at(-1),zeroBudget:{context:'navigationHeader only',boundary:ids.at(-1),rawCurrentFallback:true}},null,2));"`
> - Ran `rg -n "catSignal|signal\.aborted|if \(.*aborted" 'D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts' | Select-Object -First 100; $p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=540;$i -le 625;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=1520;$i -le 1610;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }; for($i=3600;$i -le 3690;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
> - Ran `Set-Location 'D:\AI\clower-1\clowder-ai'; rg -n "export async function\* invokeSingleCat|catch \(err\)|yield.*type: 'error'|finally" packages/api/src/domains/cats/services/agents/invocation/invoke-single-cat.ts | Select-Object -First 160`
> - Ran `$p='D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\invoke-single-cat.ts'; $l=Get-Content -LiteralPath $p -Encoding UTF8; for($i=3440;$i -le 3545;$i++){ '{0,5}: {1}' -f $i,$l[$i-1] }`
>
> </details>
</details>

# 第三篇：增量上下文——游标、可见性、预算裁剪与最终 Ack

## 0. 承接、位置与版本核对

上一篇已经讲清：

- Prompt 不是一个字符串函数一次生成，而是 L0、静态段、动态调用上下文、Bootstrap、MCP、历史上下文等分层拼接；
- 当前主链使用 `assembleIncrementalContext()`，而不是传统全量 `assembleContext()`；
- Codex 的静态身份和本轮 stdin Prompt 是两条不同输入通道。

**本篇的位置**是：

```text
Prompt 静态层已经准备好
→ 从 MessageStore 找出“这只猫尚未接收的消息”
→ 做权限/角色过滤
→ 格式化、预算裁剪
→ 拼入本轮 Prompt
→ 调用 Provider
→ 根据执行结果推进 delivery cursor
```

### 当前版本

截至 **2026-09-19**，工作区仍是：

```text
branch: main
HEAD: 6868041cae3b9dcab163a1fd85845b9778c3adc5
commit: fix(issue-1032): disable PWA online hard reload (#1089)
```

工作区干净，本次没有修改文件。

### 对前文两个可能过强表述的纠正

1. **Warm Path 虽然写了“消息数裁剪 + token 裁剪”两刀，但当前内置猫的大批量请求不会实际走第一刀。**

   原因是 `relevant.length > 15` 时，代码已经提前转去 Smart Window；而内置猫的 `maxMessages` 最小也有 100。因此对当前内置配置：

   ```text
   0～15 条 → Warm Path
   16 条及以上 → Smart Window
   ```

   Warm Path 的 `maxMessages` 第一刀，只对 `maxMessages < 15` 的自定义猫配置，或未来阈值变化后才可能真正生效。

2. `messages.ts` 注释说“先 ack，再标 succeeded，这样 ack 抛错会进入失败路径”，但实际 `ackCollectedCursors()` **逐项捕获错误并只记录日志，不向上抛出**。所以 delivery cursor 的持久化与 invocation succeeded **不是事务绑定**。

3. “零上下文预算返回空 Prompt”也不够准确。它返回的是 `navigationHeader`；而当前用户消息如果可见，还可能由外层作为 raw message 补回。

---

# 1. 本篇真实执行链

用户消息已由 `POST /api/messages` 持久化为 `M010` 后，入口是：

```text
messages.ts
  → router.routeExecution(...)
    → routeSerial(...) / routeParallel(...)
      → assembleIncrementalContext(...)
        → DeliveryCursorStore.getCursor()
        → MessageStore.getByThreadAfter()
        → visibility filter
        → navigation context
        → warm/cold decision
        → format + token trim
      → shouldAppendExplicitCurrentMessage()
      → invokeSingleCat()
      → 收集 boundary
  → ackCollectedCursors()
  → DeliveryCursorStore.ackCursor()
  → Redis Lua CAS / in-memory fallback
```

当前消息先落库，再把真实 `storedUserMessage.id` 传给路由：

```ts
storedUserMessage = await opts.messageStore.append({
  userId,
  catId: null,
  content,
  mentions: targetCats,
  timestamp: Date.now(),
  threadId: resolvedThreadId,
  ...
});

for await (const msg of router.routeExecution(
  userId,
  content,
  resolvedThreadId,
  storedUserMessage.id,
  targetCats,
  intent,
  { cursorBoundaries, ... },
)) {
  ...
}
```

源码：

- [D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts:970-1003](./clowder-ai/packages/api/src/routes/messages.ts#L970-L1003)
- [D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts:1203-1247](./clowder-ai/packages/api/src/routes/messages.ts#L1203-L1247)

`routeSerial()` 只有在同时存在当前消息 ID 和 cursor store 时才启用增量模式：

```ts
const incrementalMode =
  Boolean(currentUserMessageId && deps.deliveryCursorStore);
```

然后计算可用于历史上下文的剩余预算：

```ts
const incSystemTokens = estimateTokens(
  [staticIdentity, invocationContext, catModePromptForBudget,
   bootstrapContext, mcpInstructions]
    .filter(Boolean)
    .join('\n'),
);

const incMessageTokens = estimateTokens(message);

const effectiveContextBudget = Math.min(
  Math.max(
    0,
    incBudget.maxPromptTokens
      - incSystemTokens
      - incMessageTokens
      - 200,
  ),
  incBudget.maxContextTokens,
);
```

源码：

- [D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts:458-488](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L458-L488)
- [D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts:883-915](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L883-L915)

最终组装结果成为 `invokeSingleCat()` 的 `prompt`：

```ts
const parts = [
  invocationContext,
  catModePrompt,
  bootstrapContext,
  mcpInstructions,
].filter(Boolean);

if (inc.contextText) parts.push(inc.contextText);

if (shouldAppendExplicitCurrentMessage(inc, currentUserMessageId)) {
  parts.push(message);
}

prompt = parts.join('\n\n---\n\n');
```

下游调用：

```ts
for await (const msg of invokeSingleCat(deps.invocationDeps, {
  catId,
  service,
  prompt,
  userId,
  threadId,
  systemPrompt: staticIdentity,
  ...
})) {
  ...
}
```

源码：

- [D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts:968-977](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L968-L977)
- [D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts:1231-1269](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L1231-L1269)

---

# 2. 贯穿本篇的示例状态

继续使用支付回调审查场景：

```text
userId              = user-7
threadId             = thread-pay-42
catId                = codex
thinkingMode         = play
currentUserMessageId = M010
deliveryCursor       = M001
```

为了阅读方便，下面用 `M001` 等别名。真实 ID 类似：

```text
0001789...-000123-a1b2c3d4
```

其生成结构是：

```ts
timestamp.padStart(16)
+ "-"
+ processSequence.padStart(6)
+ "-"
+ uuidSuffix
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\MessageStore.ts:340-353](./clowder-ai/packages/api/src/domains/cats/services/stores/ports/MessageStore.ts#L340-L353)

`M001` 之后，线程中存在：

| ID | 关键字段 | 含义 |
|---|---|---|
| M002 | `catId=opus, origin=callback, public` | Opus 的公开回调 |
| M003 | `catId=opus, origin=stream` | Opus 思考流 |
| M004 | `catId=null, whisperTo=[opus]` | 只发给 Opus 的私语 |
| M005 | `catId=null, whisperTo=[codex]` | 发给 Codex 的私语 |
| M006 | `userId=system` | UI 错误徽章 |
| M007 | `origin=briefing` | Context Briefing 内部消息 |
| M008 | `catId=codex, origin=callback` | Codex 自己此前发出的消息 |
| M009 | `catId=null, replyTo=M000`，带 diff rich block | 用户回复旧消息 |
| M010 | `catId=null` | 本轮“检查支付回调并发风险” |
| M011 | `deliveryStatus=queued` | 尚未真正送达的排队消息 |

---

# 3. 第一步：读取每只猫自己的 delivery cursor

Cursor key 是：

```ts
`${userId}:${catId}:${threadId}`
```

所以本例是：

```text
user-7:codex:thread-pay-42
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\DeliveryCursorStore.ts:25-36](./clowder-ai/packages/api/src/domains/cats/services/stores/ports/DeliveryCursorStore.ts#L25-L36)

注意这里有三个**互相独立**的命名空间：

| Cursor | 语义 | 是否决定 Prompt 增量 |
|---|---|---:|
| delivery cursor | Prompt 历史投递前沿 | 是 |
| mention ack cursor | 哪些 `@mention` 已消费 | 否 |
| seen cursor | 猫通过 Prompt/MCP 被认为已读到哪里 | 否 |

因此不能把“猫通过 MCP 读过消息”直接等价成“下轮 Prompt 不再投递”。

## 3.1 Redis 和内存取最大值

```ts
const memValue = this.cursors.get(key);

const redisValue =
  await this.sessionStore.getDeliveryCursor(userId, catId, threadId);

if (redisValue != null) {
  return memValue && memValue > redisValue
    ? memValue
    : redisValue;
}

return memValue;
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\DeliveryCursorStore.ts:42-59](./clowder-ai/packages/api/src/domains/cats/services/stores/ports/DeliveryCursorStore.ts#L42-L59)

这解决的是：

```text
Redis 曾短暂故障
→ cursor 只推进到了进程内 Map
→ Redis 恢复后仍然比较两边最大值
→ 不会直接退回旧 Redis cursor
```

但它不是持久化保证：

- Redis 写失败后只落在内存；
- 进程此时崩溃，这次推进仍会丢失；
- 没有 cursor outbox 或重放日志。

---

# 4. 第二步：MessageStore 找出 cursor 之后的消息

入口代码没有传 limit：

```ts
const cursor =
  await deps.deliveryCursorStore.getCursor(userId, catId, threadId);

const unseen =
  await fetchAfterCursor(
    deps.messageStore,
    threadId,
    cursor,
    userId,
  );
```

`fetchAfterCursor()` 实际调用：

```ts
messageStore.getByThreadAfter(
  threadId,
  afterId,
  undefined,
  userId,
);
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts:659-672](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L659-L672)

## 4.1 内存实现

内存实现按 `messages` 数组顺序扫描：

```ts
let cursorSeen = !afterId;

for (const msg of this.messages) {
  if (msg.threadId !== threadId) continue;

  if (!cursorSeen) {
    if (msg.id === afterId) cursorSeen = true;
    continue;
  }

  if (userId && msg.userId !== userId &&
      !isSystemUserMessage(msg)) continue;

  if (!isDelivered(msg)) continue;

  matches.push(msg);
}
```

如果 cursor 对应消息已经被内存上限淘汰，就退化为：

```ts
if (msg.id <= afterId) continue;
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\MessageStore.ts:571-605](./clowder-ai/packages/api/src/domains/cats/services/stores/ports/MessageStore.ts#L571-L605)

复杂度：

```text
正常扫描：O(T)
cursor 找不到时：最坏再扫描一次，约 O(2T)
空间：O(U)
```

其中：

- `T` 是内存 store 中的消息数，默认最多 2000；
- `U` 是 cursor 后符合条件的消息数。

## 4.2 Redis 实现

Redis 线程消息使用 ZSET：

```text
key    = msg:thread:{threadId}
score  = timestamp 或 queued 消息的 deliveredAt
member = messageId
```

Cursor 存在时：

1. 先查 cursor 的 score；
2. 同 score 的消息通过 ID 做 tie-break；
3. score 更高的消息全部加入。

```ts
const afterScore = await redis.zscore(key, afterId);

const sameScore =
  await redis.zrangebyscore(key, afterScore, afterScore);

const sameFiltered =
  sameScore.filter(id => id !== afterId && id > afterId);

const higherScore =
  await redis.zrangebyscore(key, `(${afterScore}`, '+inf');

ids = [...sameFiltered, ...higherScore];
```

Cursor 已不在 ZSET 中时：

```ts
ids = await redis.zrange(key, 0, -1);
ids = ids.filter(id => id > afterId);
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\redis\RedisMessageStore.ts:512-560](./clowder-ai/packages/api/src/domains/cats/services/stores/redis/RedisMessageStore.ts#L512-L560)

随后用一次 Redis pipeline 对全部 ID 执行 `HGETALL`：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\redis\RedisMessageStore.ts:930-983](./clowder-ai/packages/api/src/domains/cats/services/stores/redis/RedisMessageStore.ts#L930-L983)

### 一个重要成本边界

Smart Window 可以缩小最终 Prompt，但**不会避免前面的全量读取**。

因为此处没有 limit，所以冷启动积累了 5000 条未读时，执行顺序仍然是：

```text
先从 Redis 取出全部 cursor 后 ID
→ hydrate 全部消息 hash
→ 过滤
→ 才判断 relevant.length > 15
→ 再进入 Smart Window
```

因此 Smart Window 主要节省的是：

- 模型输入 token；
- 最终 Prompt 大小；

它不必然节省 MessageStore 的扫描和 Redis hydration I/O。

## 4.3 Store 层先过滤 queued/canceled

```ts
export function isDelivered(msg) {
  return !msg.deliveryStatus ||
         msg.deliveryStatus === 'delivered';
}
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\MessageStore.ts:23-29](./clowder-ai/packages/api/src/domains/cats/services/stores/ports/MessageStore.ts#L23-L29)

因此本例：

```text
M002 ～ M010 → 进入 unseen
M011 queued   → Store 层直接过滤
```

旧消息没有 `deliveryStatus`，为了兼容，被当成 delivered。

---

# 5. 第三步：Route 层做“这只猫能不能看”的过滤

实际代码：

```ts
const viewer =
  thinkingMode === 'play'
    ? { type: 'cat', catId }
    : { type: 'user' };

const relevant = unseen.filter(m => {
  if (m.userId === 'system') return false;
  if (m.origin === 'briefing') return false;
  if (!canViewMessage(m, viewer)) return false;

  if (
    !m.extra?.crossPost &&
    m.catId !== null &&
    m.catId === catId
  ) return false;

  if (
    thinkingMode === 'play' &&
    m.catId !== null &&
    m.origin === 'stream'
  ) return false;

  return true;
});
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts:732-752](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L732-L752)

本例逐条执行后：

| ID | 结果 | 原因 |
|---|---:|---|
| M002 | 保留 | 其他猫的公开 callback |
| M003 | 过滤 | play 模式隐藏其他猫 stream |
| M004 | 过滤 | whisper recipient 不是 codex |
| M005 | 保留 | whisper recipient 是 codex |
| M006 | 过滤 | `userId=system` |
| M007 | 过滤 | `origin=briefing` |
| M008 | 过滤 | Codex 自己的普通消息 |
| M009 | 保留 | 用户公开消息 |
| M010 | 保留 | 当前用户消息 |

所以：

```text
unseen   = [M002,M003,M004,M005,M006,M007,M008,M009,M010]
relevant = [M002,M005,M009,M010]
```

Whisper 的核心规则是：

```ts
if (viewer.type === 'user') return true;
if (!msg.visibility || msg.visibility === 'public') return true;

if (msg.visibility === 'whisper') {
  if (msg.revealedAt) return true;
  return msg.whisperTo?.includes(viewer.catId) ?? false;
}
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\visibility.ts:25-48](./clowder-ai/packages/api/src/domains/cats/services/stores/visibility.ts#L25-L48)

---

# 6. 当前消息为什么既不能重复，也不能泄漏

代码在预算裁剪之前计算：

```ts
const currentMessageFilteredOut = Boolean(
  currentUserMessageId &&
  !relevant.some(m => m.id === currentUserMessageId) &&
  unseen.some(m => m.id === currentUserMessageId)
);
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts:754-761](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L754-L761)

语义是：

```text
当前消息确实在 Store 返回结果里
但没有进入 relevant
→ 它是“被过滤”，而不是“Store 里缺失”
```

随后：

```ts
if (
  inc.includesCurrentUserMessage ||
  inc.currentMessageFilteredOut
) return false;

if (
  currentUserMessageId &&
  inc.contextText.includes(currentUserMessageId)
) return false;

return true;
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts:219-239](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L219-L239)

这解决了两个相反的问题。

## 情况 A：M010 已经在历史包中

```text
includesCurrentUserMessage = true
→ 不再把 raw message 附加一次
→ 避免重复
```

## 情况 B：M010 是只发给 Opus 的 whisper

```text
M010 ∈ unseen
M010 ∉ relevant
currentMessageFilteredOut = true
→ 禁止 raw fallback
→ 不会把私语泄漏给 Codex
```

## 情况 C：M010 因 token 裁剪从历史包掉出

`currentMessageFilteredOut` 在预算裁剪之前计算，因此它仍然是 `false`：

```text
includesCurrentUserMessage = false
currentMessageFilteredOut  = false
→ raw M010 被附加
```

所以当前可见用户指令即使从历史窗口中被裁掉，通常仍能进入最终 Prompt。

### 一个边界

第三个判断只是：

```ts
inc.contextText.includes(currentUserMessageId)
```

它不是结构化解析。理论上，如果其他内容碰巧包含当前消息 ID 字符串，也可能误判为“已经注入”，从而抑制 raw fallback。目前没有看到针对这种误命中的测试。

---

# 7. Navigation 工作发生在 Warm/Cold 分流之前

在判断是否进入 Smart Window 前，代码已经可能执行：

1. 查 active session；
2. 查 thread 内 session chain；
3. 查 transcript 的 files touched；
4. 查 thread tasks；
5. 查 ThreadMemory 中已有 artifact ledger；
6. merge ledger；
7. 对 truth source 排序；
8. 生成 navigation header。

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts:688-817](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L688-L817)

这些读取多数采用 fail-open：

```ts
try {
  ...
} catch {
  return [];
}
```

或者：

```ts
catch {
  // tasks stay empty
}
```

所以：

- Navigation 失败通常不阻断 Provider；
- 但 Prompt 会静默缺少导航信息；
- “最后 navigationHeader 为空”不代表没有做过存储读取、合并和排序。

`assembleIncrementalContext()` 本身也没有接收 `AbortSignal`。因此用户在这些 await 过程中取消，并不代表底层 SessionStore、TaskStore、ThreadStore 查询立刻取消。

---

# 8. Warm/Cold 决策：15 条和 10K token

实际判断：

```ts
const countTrigger =
  relevant.length > 15;

const tokenTrigger =
  !countTrigger &&
  relevant.reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0,
  ) > 10_000;

const isColdMention =
  countTrigger || tokenTrigger;
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts:832-853](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L832-L853)

边界是：

```text
15 条           → Warm
16 条           → Cold
恰好 10,000 token → Warm
大于 10,000       → Cold
```

先判断消息数，是为了：

```text
如果 16 条已经触发 Cold
→ 不再 tokenize 所有正文
```

但注意，MessageStore 的全量读取和 route 过滤已经发生。

本例只有：

```text
relevant.length = 4
```

假设四条原始正文总计不到 10K token，因此走 Warm Path。

---

# 9. Warm Path 格式化：Rich Block、replyTo 与清洗

执行顺序不是直接把 `m.content` 拼进去，而是：

```text
Rich Block 摘要
→ 清除嵌套历史 envelope
→ 建 replyTo parent map
→ 必要时定向 fetch cursor 前 parent
→ formatMessage()
→ 加消息 ID
```

## 9.1 Rich Block 不注入完整 JSON

```ts
case 'card':
  return `[卡片: ${b.title ?? '无标题'}]`;

case 'diff':
  return `[代码 diff: ${b.filePath ?? '未知文件'}]`;

case 'checklist':
  return `[清单: ${b.title ?? `${b.items.length} 项`}]`;

case 'media_gallery':
  return `[图片: ${b.items.length} 张]`;
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts:639-663](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L639-L663)

例如 M009：

```json
{
  "content": "请审查这段支付回调修复",
  "extra": {
    "rich": {
      "blocks": [
        {
          "kind": "diff",
          "filePath": "src/pay/callback.ts"
        }
      ]
    }
  }
}
```

先变成：

```text
请审查这段支付回调修复
[代码 diff: src/pay/callback.ts]
```

## 9.2 嵌套历史清洗

如果历史消息正文中又包含：

```text
[对话历史 - 最近 ...]
[对话历史增量 - 未发送过 ...]
[对话历史增量 - 智能窗口...]
```

代码会跳过整个 envelope，直到：

```text
[/对话历史]
```

或：

```text
---
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts:594-624](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L594-L624)

设计目标是避免：

```text
旧 Prompt 中包含一份历史
→ 旧 Prompt 被当作普通消息保存
→ 下一轮又把旧历史套进新历史
→ Prompt 越来越大
```

但它不是通用 Prompt Injection 防火墙：

- 只识别从行首开始的三种固定 header；
- 用户主动输入相同 header，后续正文也可能被误删；
- header 前有空格时不会命中；
- `---` 仍然被作为旧格式终止符。

## 9.3 replyTo parent

先从完整 `relevant` 建 Map：

```ts
const baseMap = new Map(buildMessageMap(relevant));
```

所以 Map 查询平均是 O(1)。

若 M009 回复的 M000 位于 cursor 之前，Map 中没有，就执行定向 fetch：

```ts
const missingReplyIds = [
  ...new Set(
    capped
      .filter(m => m.replyTo && !baseMap.has(m.replyTo))
      .map(m => m.replyTo),
  ),
];

const resolved = await Promise.all(
  missingReplyIds.map(id =>
    resolveVisibleReplyParent(messageStore, id, options),
  ),
);
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts:897-919](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L897-L919)

定向 fetch 的 parent 必须：

- 同 thread；
- 已 delivered；
- 未删除；
- 不是 system/briefing；
- 当前 viewer 可见；
- play 模式下不能是其他猫的 stream。

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\visibility.ts:95-109](./clowder-ai/packages/api/src/domains/cats/services/stores/visibility.ts#L95-L109)

最终 preview 最长 60 字符：

```text
[↩ 布偶猫: 先确认回调幂等键和数据库唯一约束…]
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\ContextAssembler.ts:146-164](./clowder-ai/packages/api/src/domains/cats/services/context/ContextAssembler.ts#L146-L164)

最终 M009 的示意格式为：

```text
[M009] [10:14 UTC co-creator]
[↩ 布偶猫: 先确认回调幂等键和数据库唯一约束…]
请审查这段支付回调修复
[代码 diff: src/pay/callback.ts]
```

这是**格式示意**；实际会在一条格式化消息中输出，并使用真实 ID 和 UTC 时间。

---

# 10. 预算算法：究竟怎么算、裁掉谁

## 10.1 Codex 当前默认预算

当前模板：

```json
{
  "maxPromptTokens": 240000,
  "maxContextTokens": 216000,
  "maxMessages": 200,
  "maxContentLengthPerMsg": 100000
}
```

源码：

[D:\AI\clower-1\clowder-ai\cat-template.json:354-390](./clowder-ai/cat-template.json#L354-L390)

但运行时 catalog 可以覆盖；环境变量目前只直接覆盖 `maxPromptTokens`，不会同比例重算 `maxContextTokens`：

[D:\AI\clower-1\clowder-ai\packages\api\src\config\cat-budgets.ts:87-130](./clowder-ai/packages/api/src/config/cat-budgets.ts#L87-L130)

## 10.2 公式

设：

- \(P\)：`maxPromptTokens`
- \(S\)：静态身份、动态上下文、Bootstrap、MCP 等 token
- \(M\)：本轮 raw message token
- \(G\)：200 token guard
- \(C\)：`maxContextTokens`

则增量上下文预算：

\[
B = \min(\max(0, P-S-M-G), C)
\]

对应源码：

```ts
Math.min(
  Math.max(0, maxPromptTokens - systemTokens - messageTokens - 200),
  maxContextTokens,
)
```

注意：即使当前消息已经位于 `inc.contextText` 中，`M` 仍然会被预留一次。这是一种偏保守的预算策略，会少利用一部分上下文容量，但更不容易溢出。

## 10.3 Token 计数不是 Provider 的真实 usage

实现使用：

```ts
encodingForModel('gpt-4o')
```

对文本执行 tokenizer：

```ts
return encoder.encode(
  text,
  NO_SPECIAL_TOKENS,
  NO_SPECIAL_TOKENS,
).length;
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\utils\token-counter.ts:9-35](./clowder-ai/packages/api/src/utils/token-counter.ts#L9-L35)

因此它是发送前预算估计，不是 Codex CLI 返回的实际输入 token。

---

## 10.4 第一刀：消息数 cap

实际代码：

```ts
const wasCapped =
  relevant.length > budget.maxMessages;

const capped =
  wasCapped
    ? relevant.slice(-budget.maxMessages)
    : relevant;
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts:874-884](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L874-L884)

性质：

- 永远保留最新后缀；
- 不排序，依赖 MessageStore 已按投递顺序返回；
- 被第一刀裁掉的旧消息不会生成摘要；
- boundary 最终仍会指向最新消息，旧消息将被视为已跨过。

但再次强调：当前 Codex 的 `maxMessages=200`，而 16 条时已经进入 Smart Window，所以本例和当前内置配置的 Warm Path 中，这一刀通常不触发。

---

## 10.5 每条消息先做字符截断

`formatMessage()` 对单条正文做 head-tail 截断：

```text
前 40%
+ [...truncated N chars...]
+ 后 60%
```

这样保留：

- 开头的背景；
- 结尾的结论、请求或报错。

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\context\ContextAssembler.ts:103-116](./clowder-ai/packages/api/src/domains/cats/services/context/ContextAssembler.ts#L103-L116)

---

## 10.6 第二刀：从最旧消息开始按 token 删除

实际核心循环：

```ts
const perLineTokens =
  lines.map(line => estimateTokens(line));

const totalTokens =
  perLineTokens.reduce((a, b) => a + b, 0);

let dropTokens = 0;

for (let i = 0; i < perLineTokens.length - 1; i++) {
  dropTokens += perLineTokens[i];

  if (
    totalTokens - dropTokens
    <= effectiveTokenBudget
  ) {
    tokenTrimStart = i + 1;
    break;
  }
}

if (
  totalTokens - dropTokens
  > effectiveTokenBudget
) {
  tokenTrimStart = perLineTokens.length - 1;
}
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts:953-976](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L953-L976)

### 用本例复演

为了展示算法，使用预设 token 权重；这不是实际 tokenizer 输出：

| 消息 | 格式化后示意 token |
|---|---:|
| M002 | 40 |
| M005 | 70 |
| M009 | 90 |
| M010 | 50 |

设：

```text
effectiveTokenBudget = 150
total = 250
```

逐步执行：

```text
初始：
[M002=40, M005=70, M009=90, M010=50]
剩余 250，超预算

丢 M002：
剩余 210，仍超预算

再丢 M005：
剩余 140，满足预算

最终：
[M009, M010]
```

最终：

```text
boundaryId                = M010
includesCurrentUserMessage = true
```

Prompt 历史包：

```text
[对话历史增量 - 未发送过 2 条]
[M009] ...
[M010] ...
[/对话历史]
```

因为 `M010` 已包含在包中，外层不会再次添加 raw 当前消息。

## 10.7 复杂度

设：

- `R`：relevant 消息数；
- `L`：格式化文本总长度/token 数；
- `P`：缺失的 reply parent 数。

Warm Path 的核心成本约为：

```text
过滤：              O(U)
建 messageMap：     O(R)
格式化：            O(L)
tokenize：          O(L)
token trim 扫描：   O(R)
reply parent I/O：  O(P) 个并发 fetch
空间：              O(R + L)
```

即使最后只保留 2 条，前面的 4 条仍然全部：

- rich digest；
- sanitize；
- format；
- tokenize。

这是典型的“虽然没有进入最终 Prompt，但计算已经发生”。

---

# 11. Warm Path 的三个重要边界

## 11.1 最后一条消息可能单独超过预算

循环最多删除到只剩最后一条。

如果权重为：

```text
[70, 90, 200]
budget = 150
```

最终仍会保留：

```text
[200]
```

所以 Warm Path 保证的是：

```text
尽量保留最新消息
```

而不是：

```text
最终 contextText 一定 <= effectiveTokenBudget
```

## 11.2 Navigation 和 envelope 不在 line token 总和中

第二刀只统计 `lines`，没有把以下内容一起做最终 hard check：

```text
navigationHeader
[对话历史增量 - 未发送过 N 条]
[/对话历史]
换行与分隔符
```

因此即使所有消息行恰好等于预算，完整 `contextText` 仍可能略超。

Smart Window 后面有最终整体 `estimateTokens(contextText)` 检查，但 Warm Path 没有。这个差异会在下一篇对照。

## 11.3 零预算仍可能保留导航和当前消息

当：

```text
effectiveTokenBudget <= 0
```

返回：

```ts
{
  contextText: navigationHeader,
  boundaryId: capped[capped.length - 1]?.id,
  includesCurrentUserMessage: false,
  degradation: "...未读消息全部丢弃",
}
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts:933-950](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L933-L950)

本例会得到：

```text
boundaryId = M010
```

随后外层发现：

```text
includesCurrentUserMessage = false
currentMessageFilteredOut  = false
```

于是仍把 raw M010 加到 Prompt。

所以准确语义是：

```text
历史消息正文被丢弃；
可见的当前请求仍尽量保留；
navigationHeader 也可能继续存在。
```

---

# 12. Boundary 到底表示什么

Warm Path 最终：

```ts
const boundaryId =
  finalCapped[finalCapped.length - 1]?.id;
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts:978-1017](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L978-L1017)

因此本例：

```text
Prompt 实际包含 M009、M010
但 boundary = M010
```

被 token 裁掉的 M002、M005 也位于 M010 之前。Ack 到 M010 后，它们不会再次投递。

所以 delivery cursor 更准确的语义是：

> “已经被本轮上下文处理过，或者按照预算策略决定跳过的消息前沿。”

而不是：

> “每一条都确实展示给了模型。”

这也是为什么零预算仍然可以推进 boundary。

---

# 13. 三个 Cursor 的状态变化

假设开始时：

```text
deliveryCursor = M001
seenCursor     = M001
mentionAck     = M000
```

## T1：增量上下文组装完成

`routeSerial()` 会立即把 `seenCursor` 推到 delivery boundary：

```ts
if (deliveryBoundaryId && deps.deliveryCursorStore) {
  await deps.deliveryCursorStore.ackSeenCursor(
    userId,
    catId,
    threadId,
    deliveryBoundaryId,
  );
}
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts:916-928](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L916-L928)

状态：

```text
deliveryCursor = M001
seenCursor     = M010
```

注意此时 `invokeSingleCat()` 还没有执行。

所以这里的 `seen` 实际是：

```text
已经准备给这只猫
```

并不严格等价于：

```text
Provider 已成功接收并解析
```

如果进程在 seen 推进后、Provider 启动前崩溃：

- delivery cursor 仍是 M001；
- 下次 Prompt 会重投；
- 但 freshness gate 可能已经把它们视为 seen。

好在 seen cursor 不控制增量 Prompt，所以不会直接造成历史丢失。

## T2：Provider 执行完成

`routeSerial()` 不立即写 delivery cursor，而是先收集到：

```text
cursorBoundaries[codex] = M010
```

并用 `upsertMaxBoundary()` 防止同一 invocation 中 A2A 重入时 boundary 倒退：

```ts
const current = cursorBoundaries.get(catId);

if (!current || boundaryId > current) {
  cursorBoundaries.set(catId, boundaryId);
}
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-helpers.ts:240-254](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-helpers.ts#L240-L254)

Boundary 收集发生在猫本轮处理的后段，即使 Provider 以 error event 结束，也会收集：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\route-serial.ts:3500-3515](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/route-serial.ts#L3500-L3515)

## T3：调用者最终 Ack

正常成功路径：

```ts
await router.ackCollectedCursors(
  userId,
  resolvedThreadId,
  cursorBoundaries,
);

await invocationRecordStore.update(invocationId, {
  status: 'succeeded',
});
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts:1441-1456](./clowder-ai/packages/api/src/routes/messages.ts#L1441-L1456)

最终：

```text
deliveryCursor = M010
seenCursor     = M010
mentionAck     = M000  // 完全不受影响
```

---

# 14. 成功、错误、取消与崩溃时分别怎样

| 情况 | delivery cursor | 后果 |
|---|---|---|
| 正常成功 | 推进到已收集 boundary | 下次不再投递 |
| Provider yield error + done | 通常仍推进 | 避免同一历史无限重投 |
| 后续猫失败，前面猫已完成 | 只 ack 已完成猫 | 每只猫独立 |
| 用户取消时当前猫已完成 | 已完成 boundary 会 ack | 已消费部分不重投 |
| 当前猫尚未走到 boundary 收集 | 不推进 | 下次可能重投 |
| `persistenceContext.failed` | 当前直接入口没有执行 ack | 下次可能重投 |
| governance gate 失败 | 没有执行成功路径 ack | 下次可能重投 |
| Provider 已收到 Prompt，但进程在 ack 前崩溃 | 不推进 | 至少一次式重投 |
| ack 已持久化，但 status 还未写 succeeded 时崩溃 | cursor 已推进 | 状态可能含糊，但历史不重投 |
| Redis 写失败、进程仍活着 | 回退到内存 cursor | 本进程内通常不重投 |
| Redis 写失败后进程重启 | 内存 cursor 丢失 | 可能重投 |

取消与异常路径对“已经完成的猫”执行 best-effort ack：

- [D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts:1365-1405](./clowder-ai/packages/api/src/routes/messages.ts#L1365-L1405)
- [D:\AI\clower-1\clowder-ai\packages\api\src\routes\messages.ts:1523-1553](./clowder-ai/packages/api/src/routes/messages.ts#L1523-L1553)

队列执行路径也采用相同思想：

- [D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\invocation\QueueProcessor.ts:1426-1457](./clowder-ai/packages/api/src/domains/cats/services/agents/invocation/QueueProcessor.ts#L1426-L1457)

---

# 15. Redis CAS 究竟保证了什么

Redis 使用 Lua：

```lua
local cur = redis.call('GET', KEYS[1])

if cur and ARGV[1] <= cur then
  return 0
end

redis.call(
  'SET',
  KEYS[1],
  ARGV[1],
  'EX',
  tonumber(ARGV[2])
)

return 1
```

源码：

[D:\AI\clower-1\clowder-ai\packages\shared\src\utils\redis.ts:59-72](./clowder-ai/packages/shared/src/utils/redis.ts#L59-L72)

默认 TTL：

```text
604800 秒 = 7 天
```

源码：

[D:\AI\clower-1\clowder-ai\packages\shared\src\utils\redis.ts:95-114](./clowder-ai/packages/shared/src/utils/redis.ts#L95-L114)

它保证：

> 对同一个 Redis key，并发写入时，值不会因为较晚到达的旧 ID 而倒退。

例如：

```text
请求 A：ack M010
请求 B：ack M005
```

无论到达顺序如何，Redis 最终不会从 M010 回到 M005。

## 它不保证

1. `读取 cursor → 查询消息 → 调 Provider → ack` 不是一个事务；
2. 两个并发 invocation 仍可能读取到同一个旧 cursor；
3. CAS 不会阻止两次 Prompt 都携带相同历史；
4. Provider 副作用与 cursor ack 之间没有两阶段提交；
5. TTL 只在成功推进时刷新，CAS no-op 不刷新；
6. Redis TTL 到期后，进程内 Map 仍可能保留 cursor；但重启或内存淘汰后会失去它。

`DeliveryCursorStore` 的 Redis 失败回退：

```ts
try {
  await sessionStore.setDeliveryCursor(...);
  ...
  return;
} catch {
  // fallback
}

const current = this.cursors.get(key);

if (current && effective <= current) return;

this.upsertMap(this.cursors, key, effective);
```

内存读写之间没有 `await`，因此单 Node 进程内这段不会发生协程交错。

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\DeliveryCursorStore.ts:61-107](./clowder-ai/packages/api/src/domains/cats/services/stores/ports/DeliveryCursorStore.ts#L61-L107)

---

# 16. Ack 与 succeeded 并不具备事务关系

调用处的注释是：

```ts
// ack cursors before marking succeeded so that if ack
// throws, the catch block sees running→failed
```

但实际 Ack 聚合函数：

```ts
async ackCollectedCursors(...): Promise<void> {
  for (const [catId, boundaryId] of boundaries) {
    try {
      await this.deliveryCursorStore.ackCursor(...);
    } catch (err) {
      log.error({ catId, err }, 'ackCollectedCursors failed');
    }
  }
}
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\agents\routing\AgentRouter.ts:1739-1751](./clowder-ai/packages/api/src/domains/cats/services/agents/routing/AgentRouter.ts#L1739-L1751)

所以真实语义是：

```text
尽力 ack
→ 单只猫 ack 失败只记录日志
→ 方法仍 resolve
→ invocation 仍可标 succeeded
```

不过 `DeliveryCursorStore.ackCursor()` 自己会把普通 Redis 故障降级到内存，所以真正传播到这一层的异常已经比较少。

准确结论：

> 系统尽量保证 cursor 单调，但没有保证“invocation succeeded 一定意味着 delivery cursor 已持久化到 Redis”。

---

# 17. 多进程边界：CAS 能并发，但 ID 顺序不是全局序列

Message ID 的 `_seq` 是模块内变量：

```ts
let _seq = 0;
```

所以：

- 单进程、时间戳非递减时，ID 基本可按插入顺序比较；
- 多进程分别从 `_seq=0` 开始；
- 同毫秒跨进程消息的 UUID 后缀会参与字典序；
- 字典序不再严格代表真实插入先后；
- 外部提供的回退时间戳也可能让后来插入的消息拥有更小 ID。

不过当前 Redis 正常启动路径会获取 **API namespace singleton lease**：

```ts
const leaseResult = await apiInstanceLease.acquire();

if (!leaseResult.acquired) {
  throw new Error(
    'Redis namespace already has a live API instance; refusing to start.'
  );
}
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\index.ts:3556-3597](./clowder-ai/packages/api/src/index.ts#L3556-L3597)

Lease 默认：

```text
TTL       = 30 秒
heartbeat = 10 秒
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\services\ApiInstanceLease.ts:102-119](./clowder-ai/packages/api/src/services/ApiInstanceLease.ts#L102-L119)

因此准确表述是：

> Cursor CAS 本身能承受并发写入，但当前系统并不依靠 message ID 实现通用的多实例水平扩展；正常 Redis 部署额外通过 namespace lease 限制为单个活跃 API 实例。

---

# 18. 已确认行为与疑似风险

## 18.1 已确认的条件性问题：soft-deleted 正文可能进入 Prompt

源码链完整成立：

### 第一步：soft delete 不清空正文

```ts
msg.deletedAt = Date.now();
msg.deletedBy = deletedBy;
```

`msg.content` 保留。

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\ports\MessageStore.ts:652-662](./clowder-ai/packages/api/src/domains/cats/services/stores/ports/MessageStore.ts#L652-L662)

### 第二步：cursor path 明确包含 deleted 消息

内存 `getByThreadAfter()` 没有过滤 `deletedAt`。

Redis 更明确：

```ts
const messages =
  await this.hydrateMessages(ids, {
    includeDeleted: true,
  });
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\redis\RedisMessageStore.ts:554-560](./clowder-ai/packages/api/src/domains/cats/services/stores/redis/RedisMessageStore.ts#L554-L560)

现有测试也明确要求 cursor path 保留删除行：

[D:\AI\clower-1\clowder-ai\packages\api\test\soft-delete.test.js:153-163](./clowder-ai/packages/api/test/soft-delete.test.js#L153-L163)

### 第三步：route-level relevant 没有 `deletedAt` 判断

过滤条件只检查：

- system；
- briefing；
- whisper；
- own message；
- stream。

没有：

```ts
if (m.deletedAt) return false;
```

### 第四步：Warm Path 继续读取 `m.content`

因此，如果一条 soft-deleted 消息还位于某只猫的 cursor 之后，它的原文可能进入 Prompt。

准确分类：

- **代码数据流已确认；**
- **没有运行端到端复现；**
- 只影响尚未被该猫 cursor 跨过，或 cursor 丢失后重新扫描到的删除消息；
- hard delete 会清空正文，因此 hard-deleted tombstone 不会泄漏原文。

建议方向不是简单在 Store 层过滤，因为 cursor 仍要跨过 tombstone。更合理的是分离：

```text
scanBoundaryMessages：用于推进 frontier
deliverableMessages：真正可注入 Prompt 的正文
```

---

## 18.2 Filtered-only batch 会重复扫描

假设 cursor 后只有 M004：

```text
M004 = whisperTo=[opus]
target = codex
```

则：

```text
unseen   = [M004]
relevant = []
```

Warm Path 返回原 cursor：

```text
boundaryId = M001
```

因此下次 Codex invocation 还会重新读取和过滤 M004。

这不是无限增长，只是：

```text
没有新的可见消息时，每轮重复扫描；
一旦后面出现 M010 这样的可见消息，
boundary 会推进到 M010，同时跨过 M004。
```

这里可能是为了允许“私语后来 reveal 后再投递”，但存在非对称情况：

```text
M004 被隐藏
→ 后面 M010 让 cursor 推到 M010
→ 之后 reveal M004
→ reveal API 只设置 revealedAt，不回退 cursor
→ Codex 不会通过增量 Prompt 再看到 M004
```

Reveal 路由只更新消息，没有 cursor 重置：

[D:\AI\clower-1\clowder-ai\packages\api\src\routes\threads.ts:968-996](./clowder-ai/packages/api/src/routes/threads.ts#L968-L996)

这是**源码确认的行为边界**；当前未找到文档说明 reveal 是否要求对 Agent 进行追溯投递，因此不直接定性为缺陷。

---

## 18.3 Queued 消息存在“两套顺序”风险

Redis queued 消息真正送达时，会把 ZSET score 改为 `deliveredAt`：

```ts
pipeline.zadd(
  MessageKeys.thread(msg.threadId),
  String(deliveredAt),
  id,
);
```

源码：

[D:\AI\clower-1\clowder-ai\packages\api\src\domains\cats\services\stores\redis\RedisMessageStore.ts:854-873](./clowder-ai/packages/api/src/domains/cats/services/stores/redis/RedisMessageStore.ts#L854-L873)

于是存在两套顺序：

```text
查询顺序：deliveredAt score
cursor CAS 顺序：messageId 内的原始 send timestamp
```

构造条件：

```text
现有 cursor ID   = 由较晚发送的消息生成，字典序较大
queued message ID = 较早生成，字典序较小
queued deliveredAt = 后来才真正送达，ZSET score 较大
```

那么：

1. Redis 查询会把 queued message 放在 cursor 后；
2. Prompt 会收到它；
3. boundary 可能是这个较小 ID；
4. `ackCursor()` 与现有较大 cursor 取 max；
5. cursor 不推进；
6. 下次按 score 查询时，它可能再次出现。

我做的纯算法复演得到：

```text
existing cursor = ...0010...
late queued ID  = ...0005...
max(existing, queued) = existing
canAdvance = false
```

现有 Redis 测试只验证了“重新打分后能查到 queued message”：

[D:\AI\clower-1\clowder-ai\packages\api\test\redis-message-store.test.js:405-439](./clowder-ai/packages/api/test/redis-message-store.test.js#L405-L439)

尚未看到测试覆盖：

```text
deliveredAt 排序
+ 较旧 messageId
+ delivery cursor CAS
```

因此分类为：

- **源码推导出的重复投递风险；**
- **完成了算法复演；**
- **没有 Redis 端到端复现。**

内存实现则有相反风险：`markDelivered()` 只改状态、不重排数组。如果 queued 消息已经位于 cursor 之前，之后才 delivered，它可能永远不会被 `getByThreadAfter()` 读到。

---

# 19. 最小验证报告

## 19.1 为什么没有运行项目测试

我先检查了测试初始化：

- API 测试会导入 `dist`；
- 完整测试命令会先 build；
- `setup-cat-registry.js` 会创建隔离临时模板目录；
- `with-test-home.sh` 会创建并删除临时 HOME；
- 当前 checkout 没有 `node_modules`；
- 当前也没有 `packages/api/dist`、`packages/shared/dist`。

因此没有强行构建或运行测试，避免：

- 修改 `dist`；
- 安装依赖；
- 创建大量测试临时状态；
- 触发 Redis 集成测试。

## 19.2 实际执行的验证

只运行了无导入、无文件写入的 `node -e` 算法复演。

输入：

```text
relevant = [M002,M005,M009,M010]
weights  = [40,70,90,50]
budget   = 150
```

断言：

1. 从最旧消息开始裁剪；
2. 保留最新后缀；
3. boundary 等于最后保留消息；
4. 最后一条单独超预算时仍保留；
5. 较旧 queued ID 不能让字典序 cursor 前进。

实际输出：

```text
dropped   = [M002,M005]
kept      = [M009,M010]
remaining = 140
boundary  = M010

single oversized last message:
kept      = [200]
stillOver = true

late queued ID:
canAdvance = false
```

验证覆盖：

- Warm token trim 循环；
- “至少保留最后一条”边界；
- ID 单调 CAS 与 deliveredAt 顺序冲突的最小例子。

没有验证：

- 实际 `js-tiktoken` token 数；
- Redis Lua 运行；
-真实 QueueProcessor 端到端；
- Provider 接收结果；
- soft-delete 的真实 Prompt 捕获。

项目源码和工作区均未修改，最终 `git status` 仍为干净状态。

---

# 20. 连续面试追问

## 追问链一：为什么不用每轮全量历史

**面试官第一问：这个项目怎么避免每次把整个会话历史发给模型？**

可直接回答：

> 它为每个 `userId + catId + threadId` 保存独立的 delivery cursor。每次调用只查询 cursor 之后已 delivered 的消息，再按当前猫的 whisper、stream、自身消息等可见性规则过滤，最后组装成增量历史包。

**面试官追问：那是不是 exactly-once？**

源码级回答：

> 不是。Cursor CAS 只保证单个 key 不倒退，不能把“读消息、调用 Provider、保存输出、推进 cursor”组成一个事务。如果 Provider 已收到 Prompt 但进程在 ack 前崩溃，下一轮会重复投递，所以更接近 at-least-once。相反，预算裁掉的旧消息也会随着 boundary 推进而永久跳过，所以它也不是逐条 exactly-once delivery。

**进一步追问：那 cursor 到底表示什么？**

> 它表示“已经处理或根据预算策略决定跨过的上下文前沿”，不等价于“每一条都真正显示给模型”。

---

## 追问链二：当前消息被预算裁掉怎么办

**面试官第一问：如果 token 不够，当前用户消息会不会被历史裁剪逻辑丢掉？**

可直接回答：

> 当前消息有双保险。增量结果会记录它是否最终进入历史包；如果没有进入，同时也不是因为 whisper 权限被过滤，路由层会把 raw 当前消息单独附加到 Prompt。

**面试官追问：为什么还要区分 `currentMessageFilteredOut`？**

源码级回答：

> 因为“Store 里没有这条消息”和“Store 里有，但这只猫无权看”是两个完全不同的语义。如果只判断 `includesCurrentUserMessage=false` 就补 raw message，那么发给 Opus 的 whisper 会泄漏给 Codex。代码先在未预算裁剪的 `unseen` 与 `relevant` 之间比较，确认是不是权限过滤。

**进一步追问：零预算时呢？**

> 历史正文会被丢弃并推进 boundary，但当前可见用户消息仍会作为 raw message 补回；navigation header 也可能保留。因此零预算不是整个 Prompt 为空。

---

## 追问链三：CAS 是否意味着并发安全

**面试官第一问：项目用了 Redis Lua CAS，是不是就完全并发安全？**

可直接回答：

> 它只保证同一个 cursor key 的写入单调，不保证全链路只执行一次。两个调用仍可能同时读到同一旧 cursor，并把同一批历史发送给两个 Provider 调用。

**面试官追问：多实例呢？**

源码级回答：

> Message ID 的 sequence 是进程内变量，本身不是跨进程全局序列。正常 Redis 启动路径通过 API namespace lease 拒绝第二个活跃 API 实例，所以当前架构实际上把单实例作为重要前提。不能只凭 Lua CAS 宣称支持无约束的水平扩展。

**进一步追问：Queued 消息为什么复杂？**

> Redis 查询按 deliveredAt score 排序，而 cursor CAS 按原始 message ID 字典序比较。晚投递的 queued 消息可能查询顺序靠后、ID 却更小，导致查询能读到但 ack 无法前进。当前有测试覆盖重新打分查询，但没有看到覆盖这一组合的端到端测试。

---

# 21. 面试时如何区分项目已有能力与个人贡献

可以说：

> 这个项目已有基于 per-cat cursor 的增量上下文、可见性隔离、预算裁剪和 Redis 单调 CAS。我通过源码追踪发现，delivery cursor 的实际语义是“处理前沿”，而不是严格投递确认，并识别了 soft-delete 注入、Warm Path 最终 hard cap、queued 消息双顺序等边界。

不要直接说：

> 我设计并实现了这套增量上下文和 Redis CAS。

除非你确实提交过相应代码。

可以把下面内容表述为改进设想：

1. 分离“用于推进 boundary 的行”和“可注入正文的行”，阻止 soft-deleted 内容进入 Prompt；
2. Cursor 改成统一的 `(deliverySequence, messageId)`，避免 deliveredAt 与 ID 双顺序；
3. Warm Path 增加包含 navigation/envelope 的最终整体 hard cap；
4. Ack 失败向 invocation 状态显式暴露，或增加 durable cursor outbox；
5. 将 `preparedCursor` 和真正的 `seenCursor` 分开，避免 Provider 启动前就标记 seen。

---

# 22. 本篇闭环

## 已经讲透

- 增量上下文的实际入口和 Provider 下游；
- delivery、mention-ack、seen 三类 cursor；
- 内存与 Redis 的 `getByThreadAfter()`；
- queued/canceled、system、briefing、whisper、own-message、stream 过滤；
- 当前消息防重复与防泄漏；
- Navigation 在 Warm/Cold 分流前发生的实际 I/O；
- 15 条/10K token 分流边界；
- Rich Block、replyTo preview、历史 envelope 清洗；
- Warm Path token 裁剪算法、复杂度和极端边界；
- boundary 的真实语义；
- success/error/cancel/crash 下的 ack；
- Redis Lua CAS 的保证和非保证；
- 单实例 lease 与多进程边界；
- soft-delete 和 queued 顺序风险。

## 尚未完成或未验证

- 没有运行实际项目测试；
- 没有运行 Redis E2E；
- soft-delete 风险未做端到端 Prompt 捕获；
- queued ID/score 风险只做了算法复演；
- Smart Window 内部如何压缩 16 条以上消息尚未展开；
- Evidence recall 的超时是否真正取消底层检索尚未展开。

## 下一篇

下一篇进入 **Smart Window 完整算法**：

```text
cold trigger
→ recent burst 检测
→ omitted messages
→ tombstone
→ 高价值 anchors
→ ThreadMemory
→ Evidence recall
→ Coverage Map
→ 分层降级
→ 最终 hard cap
```

重点会解释：

- 15 分钟 burst 是怎样从后往前切的；
- tombstone 的关键词、时间范围、参与者如何生成；
- anchor 如何打分、排序和去重；
- ThreadMemory 与实时消息谁优先；
- Evidence recall 的 500ms timeout 是否取消底层查询；
- 为什么降级顺序是 evidence → memory/coverage → anchors → tombstone → burst；
- Smart Window 与本篇 Warm Path 在保证边界上的真实差异。
