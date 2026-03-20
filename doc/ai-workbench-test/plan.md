# NCurator-Desktop AI Workbench 测试总计划

## 1. 总体目标

本计划用于验证 `workbench` 页面上的 AI 是否真的能接住用户诉求，并在本地优先约束下把事情做成，而不是只返回一段看起来合理的回答。

当前测试主轴聚焦三类真实诉求：

- 帮用户编辑或编写 `.docx` 文档
- 回答本地知识库问题
- 在必要时结合 `terminal` 读取工作区文件、生成中间材料或辅助完成前两类任务

目标不是一次性做完所有自动化，而是先建立一版能持续推进的专项测试基线，为后续实现、诊断和优化提供统一框架。

本计划只描述这次 AI workbench 专项测试的总体目标、模型使用方式、阶段推进和阶段用例。测试用例设计准则、测试目录、runner、raw log、report 契约统一以 [test.md](/Users/test/work-space/NCurator-Desktop/doc/test.md) 为准，这里不再重复展开。

## 2. 模型使用与诊断

- 默认所有设计模型调用的 case 先使用基础模型测试（AI_LIVE_PRIMARY_MODEL_NAME）。
- 同一 case 在相同输入、相同 fixture、相同运行前提下重复多次仍无法完成，或稳定卡在同一处时，可补跑更强模型（AI_LIVE_STRONG_MODEL_NAME）。
- 这样做的目的不是把更强模型当成默认方案，而是判断问题更像模型能力上限，还是上下文、编排、工具链问题。
- 如果更强模型能明显推进或直接完成任务，应把这类观察补充到 report 中，作为后续分析依据。
- 任何正式测试范围只要存在模型参与，就不能只依赖非 live case 得出阶段结论；是否真正成立，仍需以 `live` 证据为准。

## 3. 阶段计划

下面的阶段负责说明“先做哪一批 case、后做哪一批 case”；
只有每个阶段完成，才能生成下一阶段的todo-stage文档

本计划按八个阶段推进：

1. `tool`
2. `human`
3. `context`
4. `intent`
5. `plan`
6. `entire`
7. `ui`
8. `final`

其中：

- `tool / human / context / intent / plan / entire` 属于 `backend`
- `ui / final` 属于 `e2e`

### 3.0 阶段内统一分层

每个阶段内部的正式 case 统一按四层组织：

- `basic`
  - 验证最小能力闭环，输入和断言都尽量收敛。
- `boundary`
  - 验证失败、阻塞、空结果、安全限制和预算收敛等边界行为。
- `scenario`
  - 验证真实任务链路，强调多步协作和真实交付。
- `live`
  - 验证真实模型参与下的正式执行路径。

补充约束：

- 纯工具阶段如果不涉及模型参与，可以暂时没有 `live` case。
- 只要阶段执行路径里有模型参与，就不能只靠 `basic / boundary / scenario` 得出能力成立结论，还需要 `live` 证据。

### 3.1 `tool`

做什么：验证 `docx`、`terminal`、`kb` 三类核心工具的基本调用、复杂操作和边界收敛。

为什么：这是上层 `human / context / intent / plan / entire` 的基础，底层不稳，上层结论都会失真。

怎么做：先覆盖基础读写与检索，再覆盖复杂链路，最后覆盖阻塞、失败和安全边界。

#### basic

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `tool-docx-structure-read` | 验证文档读取基线 | 对带标题、正文、表格的样例文档完成 `open -> outline -> search -> get_block` | 所有文档任务都依赖这条基础链路 |
| `tool-docx-targeting-and-ambiguous-search` | 验证块定位与歧义消解 | 多个相似标题或相似段落同时命中时，仍能稳定定位目标块 | 不解决歧义，后续编辑容易改错位置 |
| `tool-docx-search-modes-and-scope` | 验证搜索模式与局部范围控制 | 覆盖 `literal / regex / semantic` 三种搜索方式，以及 `scope.blockIds` 的局部搜索 | 真实文档编辑常常需要先缩小范围再修改 |
| `tool-terminal-workspace-material-discovery` | 验证读取型 terminal 链路 | 在多层目录里找到最新材料并提取可复用内容 | 很多任务第一步就是先找材料 |
| `tool-terminal-path-resolution` | 验证路径解析 | 混用相对路径、绝对路径和目录切换时仍能稳定定位文件 | 路径解析错误会直接破坏后续任务 |
| `tool-kb-hybrid-search` | 验证 `hybrid` 检索基线 | 在限定 source scope 下返回可引用结果，并与已选范围保持一致 | `hybrid` 是本地检索的主路径之一 |
| `tool-kb-vector-search` | 验证 `vector` 检索基线 | 在相同 fixture 下验证纯向量检索的返回质量、空结果和范围收敛 | 需要单独确认语义检索能力边界 |
| `tool-kb-fts-search` | 验证 `fts` 检索基线 | 在相同 fixture 下验证关键词检索、精确命中和空结果边界 | 关键词检索是最容易被用户感知的基线 |
| `tool-kb-list-documents-and-scope-filter` | 验证文档枚举与范围过滤 | 先列出文档，再按 source scope 限定检索范围 | 很多问题会先找资料范围，再做检索 |

#### boundary

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `tool-docx-save-conflict-and-overwrite` | 验证保存边界 | 覆盖保存、另存为、路径冲突和 `overwrite` 行为 | 结果交付必须安全，不能在保存阶段失控 |
| `tool-docx-preview-validate-rollback` | 验证结果收敛能力 | 多轮编辑后执行保存、预览、校验、历史回看与回滚 | 工具不只要能改，还要能收敛和回退 |
| `tool-terminal-approval-and-boundary` | 验证审批与工作区边界 | 覆盖审批请求、批准、拒绝、路径逃逸阻断 | 本地优先和安全约束是这条链路的前提 |
| `tool-terminal-approval-denied-follow-up` | 验证审批拒绝后的收敛 | 用户拒绝后，系统能停止执行并给出安全后续 | 审批拒绝是常见分支，不能当异常遗漏 |
| `tool-terminal-failure-and-long-output` | 验证失败路径可解释 | 覆盖命令失败、长输出截断、超时终止后的收敛 | 失败不可避免，但必须可回看、可理解 |
| `tool-kb-empty-scope-and-no-result` | 验证知识库边界表现 | 覆盖空范围、无结果和返回理由清晰性 | 证据不足时必须安全收敛，而不是胡编 |

#### scenario

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `tool-docx-mixed-structural-edit` | 验证复杂结构改写 | 同一 case 内完成章节改写、插入新段、删除旧段、更新表格负责人 | 真实文档修改通常不是单一操作 |
| `tool-docx-table-and-inline-rewrite` | 验证表格与行内文本混合改写 | 同一轮操作中修改表格单元格、段落正文和局部文本替换 | 周报、纪要、方案文档经常同时涉及表格和正文 |
| `tool-docx-multi-document-session-isolation` | 验证多文档会话隔离 | 同一 run 中并行打开两份文档后，后续 `search / apply / save` 不会串到错误文档 | 多文档任务是后续高价值场景的基础 |
| `tool-terminal-batch-material-summary` | 验证批量材料发现与归并 | 一次发现多份日报、会议纪要或风险清单，并提取可复用摘要 | 真实工作区任务很少只有一份输入材料 |
| `tool-terminal-artifact-producing-command` | 验证复杂命令与产物识别 | 执行会生成中间文件的命令，检查摘要、产物识别与回读链路 | `terminal` 不只是看输出，还要能接住产物 |
| `tool-kb-document-discovery-to-targeted-search` | 验证从文档发现到定向检索的多步链路 | 先列出候选文档，再把缩小后的 document scope 传给 `hybrid / fts`，确保结果稳定收敛到同一份资料 | 真实知识任务往往要先找范围，再确认精确证据，不能跨文档串证据 |

#### live

- 当前 `tool` 阶段以纯工具链验证为主，不强制单独维护 `live` case；后续只有在工具路径真实引入模型参与时，才补对应 `live` 目录和 case。

### 3.2 `human`

做什么：单独验证 `human` 作为 AI 核心执行体，是否能基于目标自主推进任务、调用工具、处理阻塞并交付结果。

为什么：工具只是能力零件，真正决定“能不能把事做成”的是 `human`。

怎么做：从单步闭环开始，再覆盖多工具协作、失败纠偏、多轮续做、长任务、`watchHint` 收敛和部分完成场景。

当前实现前提：

- `human` 已切换为 `brain -> learning -> hand -> mouth` 的四节点内核
- 测试 override 以 `memoryOps + decision + nextAction` 契约为主，不再以旧 `HumanReasoningOutput` 或 `HumanStepDecision` 作为正式契约
- 收敛上限通过 `hand` 工具调用次数与 `watchHint` 控制，而不是旧 `watchdog` 或 graph state 中的 `maxSteps`
- 交付差异通过 `userInput` 表达，不再以 `objective` 或 `deliveryKind` 作为测试主契约

#### basic

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `human-direct-kb-answer` | 验证单步自主完成 | 直接读取知识库并交付可引用答案 | 最简单的单步任务必须先独立成立 |
| `human-direct-docx-edit` | 验证单工具文档闭环 | 直接读取指定文档、完成局部修改并交付可审阅结果 | 这是最常见的文档类基础任务 |
| `human-watchhint-projection` | 验证 `watchHint` 时间线投影 | `watchHint` 能被正确投影为 workbench 时间线项 | 收敛提示不只是内部状态，也必须能被可视化回看 |

#### boundary

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `human-tool-failure-recovery` | 验证失败后换路 | 块搜索失败后改走 `outline + get_block`，继续推进任务 | 自主纠偏能力是 `human` 的核心价值 |
| `human-workspace-blocked-recovery` | 验证工作区阻塞上抛 | 缺工作区绑定时，请求补充 workspace，而不是空跑或乱答 | 本地优先场景里最常见的阻塞之一 |
| `human-approval-blocked-recovery` | 验证审批阻塞收敛 | 需要执行命令或覆盖保存但未获批准时，能停在正确节点并给出继续条件 | 阻塞时的行为质量直接决定用户体验 |
| `human-evidence-insufficient-safe-stop` | 验证证据不足时的安全行为 | 找不到足够依据时明确说明缺口，并交付可继续的初稿或后续建议 | 不能把“查不到”变成“编出来” |
| `human-no-redundant-recheck` | 验证证据足够后的主动收敛 | 同一证据已足够时，不再重复调用同一工具做“再次确认” | 避免无意义循环是工程可用性的关键 |
| `human-partial-delivery-on-tool-limit` | 验证做不完时的安全收敛 | 在工具调用上限触发 `watchHint` 时保留已有进展并给出可继续交付 | “没完全做完”不应等同于“什么都没有” |
| `human-invalid-execution-batch` | 验证非法 batch 被拒绝 | 混合读写或不满足并行约束的 batch plan 会被 executor 拒绝并回到收敛 | 保守并行是这次 human 重构的重要安全边界 |
| `human-repeated-skill-learning-redirect` | 验证重复学习的回退 | `brain` 请求已学习过的 skill 时，`learning` 不重复执行，而是写入 `watchHint` 并回到 `brain` | 需要防止学习路径空转 |
| `human-invalid-memory-op-recovery` | 验证非法记忆编辑的回退 | 非法 `memoryOps` 不直接破坏 state，而是转成 `watchHint` 交回 `brain` 重决策 | 记忆编辑必须是安全、可恢复的 |

#### scenario

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `human-terminal-docx-handoff` | 验证跨工具协作 | 先在工作区找材料，再写入 docx 并形成可审阅交付 | 真实任务常常需要先取材再落文档 |
| `human-kb-docx-bridge` | 验证知识到文档的转换 | 先检索本地规范，再据此修改模板文档 | 能不能把“查到的信息”变成“可交付产物”很关键 |
| `human-multi-source-merge-delivery` | 验证多源材料归并 | 汇总多份日报、纪要或风险清单后输出统一交付 | 多源归并是高价值真实场景的代表能力 |
| `human-review-handoff-structured-delivery` | 验证审阅前结构化交付 | 文档修改完成后，输出稳定的 review handoff 交付，供后续进入 `draft_review_ready` | 文档类任务的真正落点不是一句话，而是可继续处理的结构化结果 |
| `human-multi-turn-refinement` | 验证多轮目标保持 | 上一轮已有中间产物，本轮继续保守化或局部精修 | 用户真实使用里 follow-up 很常见 |
| `human-long-task-project-brief` | 验证长任务工程能力 | 在较高执行上限下，串联完成“找材料、抽结论、写周报、补风险、生成审阅结果” | 复杂任务是否能真正完成，是 AI 价值上限所在 |
| `human-long-task-with-corrections` | 验证长任务中的纠偏稳定性 | 长任务中途加入新约束或局部失败后，仍能保持目标不漂移 | 长任务不是一次规划后就不会变化 |
| `human-long-task-approval-branch` | 验证长任务中的审批分支 | 长任务中途需要审批时，能在批准与拒绝两条分支上都安全推进或收敛 | 真正的复杂任务经常包含安全分支 |

#### live

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `human-live-direct-kb-answer` | 验证 live 单步知识问答 | 在真实模型下直接读取知识库并交付答案 | `human` 的最小 live 自主闭环必须成立 |
| `human-live-direct-docx-edit` | 验证 live 单工具文档闭环 | 在真实模型下完成 docx 改写与 preview 交付 | 文档类 live 基线不能只靠脚本化决策 |
| `human-live-terminal-docx-handoff` | 验证 live 跨工具 handoff | 在真实模型下先读 workspace，再写入 docx | 这是最小 live 跨工具能力证明 |
| `human-live-kb-docx-bridge` | 验证 live 知识到文档转换 | 在真实模型下先查规范，再改模板文档 | 需要证明 KB 结果能被真实转成产物 |
| `human-live-evidence-insufficient-safe-stop` | 验证 live 安全收敛 | 在真实模型下证据不足时不编造答案 | 安全行为不能只在 contract case 中成立 |
| `human-live-long-task-project-brief` | 验证 live 长任务工程能力 | 在真实模型下完成多材料归并到 brief 交付 | 长任务是否成立，只看 live 才有意义 |

### 3.3 `context`

做什么：验证系统是否能主动收集和整理后续执行所需的关键上下文。

为什么：上下文质量直接决定 `intent` 判断是否稳定、`plan` 是否靠谱、`human` 能否在 follow-up 场景里接住任务。

怎么做：围绕续做、证据收集、缺失材料识别、多源信息整理和部分完成续接来设计 case。
落地规则：实现时仍按 `basic / boundary / scenario / live` 分组；凡是依赖真实模型理解上下文的路径，都要补对应 `live` case。

#### basic

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `context-workspace-evidence-collection` | 验证工作区证据收集 | 在规划前先读取工作区材料，沉淀后续执行需要的事实 | 很多任务不是缺能力，而是缺前置材料 |
| `context-kb-evidence-collection` | 验证知识证据收集 | 在回答或规划前先把相关 KB 证据聚合出来 | 先有证据，再做判断，能明显降低误判 |

#### boundary

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `context-missing-material-detection` | 验证缺失输入识别 | 识别关键文件、工作区或资料不存在，并明确说明缺什么 | 缺上下文时如果继续执行，后面一定漂移 |

#### scenario

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `context-follow-up-reference-resolution` | 验证续做指代解析 | 正确接住“继续刚才第二段”“把上一版风险部分改保守一点”这类输入 | follow-up 场景首先卡在能不能知道用户在说什么 |
| `context-multi-source-evidence-assembly` | 验证多源上下文组装 | 同时从知识库和工作区收集关键信息，为后续计划提供输入 | 混合任务的关键不是单一证据，而是证据组装能力 |
| `context-continue-after-partial-delivery` | 验证部分完成后的续接 | 上一轮只完成一部分时，本轮能基于已有产物继续推进 | 真实任务往往不是一轮就结束 |

#### live

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `context-live-follow-up-reference-resolution` | 验证 live 续做指代解析 | 在真实模型下正确接住“继续上一版第二段”这类 follow-up 输入 | 续做理解是否成立，不能只靠脚本化上下文 |
| `context-live-workspace-evidence-collection` | 验证 live 工作区证据收集 | 在真实模型下先从 workspace 收集事实，再交给后续链路使用 | 工作区上下文是本地优先路径的关键前提 |
| `context-live-multi-source-evidence-assembly` | 验证 live 多源上下文组装 | 在真实模型下同时组装 KB 与 workspace 证据 | 混合任务最容易暴露上下文收集质量问题 |
| `context-live-continue-after-partial-delivery` | 验证 live 部分完成续接 | 在真实模型下基于上一轮中间产物继续推进，而不是重新开始 | 上下文续接是否稳定，最终要靠 live 证明 |

### 3.4 `intent`

做什么：验证系统是否能在 `need_context`、`direct_human`、`to_plan` 等路径之间做出正确路由。

为什么：路由错了，后面即使工具和 `human` 都能工作，也会在入口就走偏。

怎么做：用简单任务、复杂任务、上下文不足任务、纯搜索任务和混合任务来压路由判断。
落地规则：实现时按 `basic / boundary / scenario / live` 分组；路由判断如果依赖真实模型判别，最终仍需 `live` 证据。

#### basic

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `intent-direct-human-routing` | 验证简单任务不过度规划 | 对简单知识问答或单步改写任务，直接进入 `direct_human` | 简单任务被过度规划会显著拖慢体验 |
| `intent-docx-task-routing` | 验证文档编辑任务路由 | 对明确要求读取、修改、保存文档的任务，进入多步链路 | 文档任务天然带依赖顺序，不能当普通问答处理 |

#### boundary

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `intent-need-context-routing` | 验证上下文不足先补上下文 | 对“继续刚才那个”“改第二段”这类输入，先进入 `need_context` | follow-up 最怕直接误执行 |
| `intent-search-mode-routing` | 验证纯搜索模式路由 | 在 `纯搜索` 模式下优先走检索与展示，不误入完整任务执行链 | 模式错路由会让 UI 与实际行为脱节 |

#### scenario

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `intent-to-plan-routing` | 验证复杂任务进入计划链路 | 对多步文档生成或多工具任务，正确进入 `to_plan` | 复杂任务如果误判成单步，通常做不完 |
| `intent-mixed-task-routing` | 验证混合任务路由 | 对“先查 KB，再看工作区，再改文档”这类输入，稳定进入 `to_plan` | 混合任务是最容易被低估复杂度的一类 |

#### live

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `intent-live-direct-human-routing` | 验证 live 简单任务直达 | 在真实模型下，简单任务仍直接进入 `direct_human` | 入口提速能力不能只靠静态规则判断 |
| `intent-live-need-context-routing` | 验证 live 上下文缺失路由 | 在真实模型下，follow-up 输入稳定进入 `need_context` | 续做场景的误路由风险最高 |
| `intent-live-to-plan-routing` | 验证 live 复杂任务入计划链路 | 在真实模型下，多步任务稳定进入 `to_plan` | 复杂任务是否被正确识别，决定整条链路能否完成 |
| `intent-live-search-mode-routing` | 验证 live 纯搜索模式路由 | 在真实模型下，`纯搜索` 不误入完整任务执行链 | 模式理解是页面行为一致性的关键 |
| `intent-live-mixed-task-routing` | 验证 live 混合任务路由 | 在真实模型下，混合任务稳定进入 `to_plan` | 混合任务最容易暴露复杂度判断失真 |

### 3.5 `plan`

做什么：验证生成的计划是否可执行、顺序合理、能真正解决复杂用户需求。

为什么：`plan` 不是展示思路，而是给后续执行用的任务骨架；拆错一步，后面会整条链路失真。

怎么做：围绕任务拆解、依赖顺序、阻塞收敛、续做重规划和长任务依赖链来设计 case。
落地规则：实现时按 `basic / boundary / scenario / live` 分组；计划质量的最终结论应基于真实模型下的 `live` case。

#### basic

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `plan-docx-workflow-ordering` | 验证文档类计划顺序 | 文档任务必须先取证、后编辑、再保存或进入审阅 | 这是最基础也最容易写错顺序的一类计划 |
| `plan-kb-to-docx-task-breakdown` | 验证检索到文档的任务拆解 | 先查规范、再确认改写目标、最后落到文档修改 | 混合链路的关键在于拆解是否完整 |
| `plan-terminal-to-docx-task-breakdown` | 验证工作区到文档的任务拆解 | 先找文件、再读材料、再提炼内容、最后生成文档 | 很多真实任务都是这类链路 |

#### boundary

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `plan-blocked-task-convergence` | 验证阻塞时计划可收敛 | 出现审批、缺文件或资料不足时，仍能产出明确后续 | 复杂任务不一定每次都能完整完成，但必须能收住 |
| `plan-no-redundant-task` | 验证无意义重复任务控制 | 不生成重复取证、重复确认、重复总结的任务 | 冗余计划会放大模型成本和失败概率 |
| `plan-partial-delivery-convergence` | 验证部分完成时的计划收尾 | 在预算不足或局部阻塞时，计划仍能保留已有成果并给出下一步 | 复杂任务需要可继续的收尾，而不是硬失败 |

#### scenario

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `plan-follow-up-refinement-breakdown` | 验证续做任务重规划 | 已有中间产物时，计划能围绕“继续完善”而不是重新做一遍 | follow-up 如果不能重用上下文，体验会很差 |
| `plan-long-task-dependency-chain` | 验证长任务依赖链 | 长任务下每个 task 都有清晰 `userInput` 和依赖关系 | 长任务稳定性首先取决于依赖顺序是否合理 |

#### live

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `plan-live-docx-workflow-ordering` | 验证 live 文档类计划顺序 | 在真实模型下，文档任务仍保持先取证后编辑再审阅的顺序 | 计划顺序错误会直接污染后续执行 |
| `plan-live-kb-to-docx-task-breakdown` | 验证 live 检索到文档拆解 | 在真实模型下，混合链路拆解仍完整可执行 | 混合任务最考验计划粒度 |
| `plan-live-follow-up-refinement-breakdown` | 验证 live 续做重规划 | 在真实模型下，已有产物时计划仍围绕 refinement 展开 | follow-up 计划最容易被重新开题取代 |
| `plan-live-long-task-dependency-chain` | 验证 live 长任务依赖链 | 在真实模型下，长任务仍保持清晰依赖顺序 | 长任务计划是否靠谱，只看 live 才有意义 |
| `plan-live-blocked-task-convergence` | 验证 live 阻塞计划收敛 | 在真实模型下，阻塞后仍能产出明确下一步 | 计划层的安全收尾不能只在静态 case 成立 |

### 3.6 `entire`

做什么：在不依赖真实 UI 的前提下，验证从用户输入到最终交付的 backend 完整闭环。

为什么：这一层用于确认 `main + human + tools` 在 backend harness 下已经能把真实任务做完，而不是只验证零散节点。

怎么做：围绕真实用户任务做端到端 backend case，并用完成度判断任务是否真正达成。完成度建议采用 `0-3`：`0` 失败或阻塞、`1` 部分完成、`2` 主目标完成但仍需人工修补、`3` 完整完成。
落地规则：实现时按 `basic / boundary / scenario / live` 分组；`entire` 的主结论默认以 `live` 为准。

#### basic

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `entire-docx-rewrite-review-ready` | 验证现有 docx 改写闭环 | 读取、修改文档并进入可审阅结果 | 这是文档类任务的核心主路径 |
| `entire-kb-answer-with-citation` | 验证知识库问答闭环 | 回答本地知识问题，并给出可回看依据 | 用户问答不能只给结论，不给证据 |

#### boundary

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `entire-evidence-insufficient-safe-stop` | 验证证据不足时的完整收敛 | 依据不足时给出明确缺口和可继续交付 | 安全收敛本身也是完整结果的一部分 |
| `entire-terminal-approval-to-docx-update` | 验证审批分支下的文档闭环 | 先通过审批执行命令拿到产物，再写回现有周报模板 | 审批分支必须和业务目标最终接上 |

#### scenario

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `entire-workspace-to-docx` | 验证工作区材料生成文档闭环 | 从 `notes / todo` 提炼内容并生成结构化 docx | 能把工作区材料变成成品，是高价值能力 |
| `entire-kb-to-docx-hybrid` | 验证检索到文档的完整链路 | 先查规范，再改模板文档，结果可消费 | 这是典型的混合任务闭环 |
| `entire-follow-up-continuation` | 验证多轮续做闭环 | 接续前文后继续完成修改或补写 | backend 也必须证明 follow-up 能成立 |
| `entire-terminal-materials-to-delivery` | 验证工作区材料到最终交付 | 先找材料，再生成最终汇报或周报 | 多源工作区任务是实际使用重心之一 |
| `entire-long-task-weekly-brief` | 验证长任务完整闭环 | 多源材料、多步依赖和审阅收敛都能成立 | 这是 backend 综合能力的最高压测点 |

#### live

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `entire-live-docx-rewrite-review-ready` | 验证 live 文档改写闭环 | 在真实模型下完成 docx 改写并进入可审阅结果 | backend 最小完整交付必须在 live 成立 |
| `entire-live-kb-answer-with-citation` | 验证 live 知识问答闭环 | 在真实模型下回答本地知识问题并给出依据 | 问答类完整闭环不能只靠 contract case |
| `entire-live-kb-to-docx-hybrid` | 验证 live 混合任务闭环 | 在真实模型下先检索再改文档并形成可消费结果 | 混合闭环是 backend 能力连贯性的关键证明 |
| `entire-live-terminal-materials-to-delivery` | 验证 live 工作区材料到交付 | 在真实模型下从 workspace 材料生成最终交付 | 本地工作区任务是高价值真实路径 |
| `entire-live-evidence-insufficient-safe-stop` | 验证 live 安全收敛闭环 | 在真实模型下证据不足时仍完整收敛 | 安全闭环本身就是最终验收的一部分 |
| `entire-live-long-task-weekly-brief` | 验证 live 长任务完整闭环 | 在真实模型下完成多源材料与审阅收敛的完整 backend 任务 | 这是 `entire` 阶段最关键的 live 压测点 |

### 3.7 `ui`

做什么：验证 `workbench` 的交互、布局、样式和状态联动是否稳定可用。

为什么：backend 能跑通不代表用户在页面里能做成；UI 问题会直接让正确能力无法被使用。

怎么做：单独覆盖三栏布局、输入区、模式切换、时间线与检查器联动、审批条、工作区条、审阅中心、小窗口和长内容滚动。
落地规则：实现时至少按 `basic / boundary / scenario` 分组；只有在 UI 用例直接依赖真实模型执行时才补 `live` case。

#### basic

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `ui-three-pane-layout-baseline` | 验证基础布局稳定 | 左侧会话、中间对话与 `Assistant Run`、右侧时间线与检查器稳定呈现 | 三栏模型是整个 workbench 的基础结构 |
| `ui-input-and-send-stability` | 验证输入区稳定性 | 输入区可见、可输入、可回车发送、可按钮发送、运行中可取消 | 用户的第一接触点就是输入区 |
| `ui-mode-and-scope-switching` | 验证模式与范围切换 | `AI 对话 / 纯搜索`、范围选择切换稳定，状态显示一致 | 模式与范围是任务行为的重要前提 |

#### boundary

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `ui-approval-and-workspace-banner-flow` | 验证提示条与交互流 | 审批请求、工作区缺失、继续运行等 banner 状态清晰可操作 | 阻塞交互如果不清晰，用户无法完成流程 |
| `ui-small-window-and-overflow` | 验证小窗口布局与溢出 | 在 `1440x900`、`1280x800`、`1024x768`、`900x700` 下不出现布局断裂 | 小窗口问题会直接影响日常使用 |
| `ui-long-content-scroll-stability` | 验证长内容滚动稳定性 | 长路径、长 JSON、长时间线、长审阅列表下滚动不冲突、不遮挡 | workbench 天然会承载长内容，必须提前防守 |

#### scenario

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `ui-run-timeline-inspector-linkage` | 验证运行态联动 | 时间线点击、检查器详情、运行态信息能够保持同步 | workbench 的核心价值之一就是可观察性 |
| `ui-draft-review-center-operations` | 验证审阅中心操作 | 支持逐条接受、拒绝、全部接受和提交，状态无错乱 | 文档类任务最后常常收敛在审阅中心 |

#### live

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `ui-live-run-timeline-inspector-linkage` | 验证 live 运行态联动 | 在真实模型执行时，时间线和检查器仍保持同步 | 真实运行会放大 UI 状态联动问题 |
| `ui-live-approval-and-workspace-banner-flow` | 验证 live 阻塞提示流 | 在真实模型执行时，审批与 workspace banner 仍清晰可恢复 | 阻塞交互必须在真实链路里可用 |
| `ui-live-draft-review-center-operations` | 验证 live 审阅中心操作 | 在真实模型产出审阅结果后，审阅中心操作仍稳定 | 审阅中心是真实文档任务的最终 UI 落点 |

### 3.8 `final`

做什么：用真实页面交互模拟用户提出问题、等待执行、拿到结果的完整 e2e 流程。

为什么：这是最终验收层，判断标准不是某一层是否通过，而是用户是否真的在页面上解决了问题。

怎么做：围绕高价值真实任务做完整 e2e，并继续使用完成度判断最终结果是否可消费。
落地规则：实现时按 `basic / boundary / scenario / live` 分组；`final` 阶段的完成判断以真实模型下的 `live` e2e 为准。

#### basic

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `final-docx-rewrite-completion` | 验证文档类最终完成 | 用户在界面中输入改写诉求，最终拿到可消费结果或审阅结果 | 这是最核心的页面级主任务 |
| `final-kb-answer-completion` | 验证知识库问答最终完成 | 用户在页面中提问，最终拿到答案和依据展示 | 问答是最直接、最可感知的完成标准 |

#### boundary

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `final-terminal-approval-completion` | 验证审批分支最终完成 | 覆盖等待审批、批准继续、拒绝收敛，并最终回到用户目标 | 审批链路必须在真实交互里验证 |
| `final-workspace-required-and-resume` | 验证工作区补充后的恢复能力 | 工作区缺失时提示补充，补充后继续运行并完成目标 | 本地优先链路必须证明可以中断后恢复 |

#### scenario

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `final-kb-docx-hybrid-completion` | 验证混合任务最终完成 | 先检索后改文档的链路在界面中完整跑通 | 混合任务最能体现整套架构是否连贯 |
| `final-follow-up-continuation` | 验证多轮续做最终完成 | 接续上一轮产物继续修改，并让用户拿到更新后的结果 | 连续对话是 workbench 的核心使用方式 |
| `final-review-partial-acceptance` | 验证审阅中心部分接受闭环 | 用户只接受部分修改、拒绝其余修改后提交最终结果 | 文档任务不能只做到“给出建议”，还要支持选择性收敛 |
| `final-long-task-stability` | 验证长任务真实交互稳定性 | 长任务在界面里仍能保持步骤连贯并最终收敛 | backend 成立不代表真实页面长任务也稳定 |

#### live

| 用例名称 | 目标 | 描述 | 为什么 |
| --- | --- | --- | --- |
| `final-live-docx-rewrite-completion` | 验证 live 文档类最终完成 | 在真实模型下，用户通过界面拿到可消费文档结果或审阅结果 | 页面主路径必须以 live 为准 |
| `final-live-kb-answer-completion` | 验证 live 知识问答最终完成 | 在真实模型下，界面中问答能稳定返回答案和依据展示 | 最直观的用户价值必须在真实模型下成立 |
| `final-live-kb-docx-hybrid-completion` | 验证 live 混合任务最终完成 | 在真实模型下，先检索再改文档的页面链路完整跑通 | 混合任务是最终验收层的重要能力证明 |
| `final-live-follow-up-continuation` | 验证 live 多轮续做最终完成 | 在真实模型下，用户接续上一轮产物继续修改并拿到结果 | 连续对话稳定性只能靠 live e2e 判断 |
| `final-live-terminal-approval-completion` | 验证 live 审批分支最终完成 | 在真实模型下，审批等待、批准继续、拒绝收敛都能回到用户目标 | 审批链路必须在真实交互里被验证 |
| `final-live-review-partial-acceptance` | 验证 live 审阅中心部分接受闭环 | 在真实模型下，用户部分接受修改后仍能提交最终结果 | 选择性收敛是真实文档任务的重要落点 |
| `final-live-long-task-stability` | 验证 live 长任务真实交互稳定性 | 在真实模型下，长任务在页面里仍能保持连贯并收敛 | 最终验收层的长任务结论只能来自 live |
| `final-live-workspace-required-and-resume` | 验证 live 工作区补充后的恢复能力 | 在真实模型下，工作区缺失后补充并继续运行仍能完成目标 | 本地优先恢复链路必须用真实交互证明 |
