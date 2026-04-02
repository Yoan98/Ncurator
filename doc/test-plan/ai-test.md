# NCurator-Desktop AI 测试计划

## 1. 总体目标

- 本计划用于定义 AI 域正式测试的范围与领域特有规则。
- 正式 / temp 准入、runner、raw logs、report 与正式 case 共享字段，统一遵循 `doc/test.md`。
- AI 正式测试只围绕三类稳定对象治理：
  1. `tool`
  2. `human`
  3. `director`

## 2. Suite 设计

### 2.1 `tool`

- `tool` 只验证真实生产工具调用，不允许 fake。
- 目标：验证 tool 与 `hand` 工具执行守卫在真实生产代码下的输入输出是否正常、合理。
- 约束：必须真实调用生产工具、真实 store、真实 review service、真实 artifact 流。
- 禁止：fake `documentsStore`、fake `embeddingService`、fake `resolveDocxOpenTarget`、fake tool result。

### 2.2 `human`

- `mock-llm`
  - 目标：在 non-live 条件下验证 `human` 的真实执行链路。
  - 约束：只允许 mock LLM 输入输出；必须真实走 `createAiRunContext -> human graph -> learning / hand / mouth -> store / review / artifact`。
  - 禁止：`humanReasonOverrides`、`toolExecutionOverrides`、`humanDeliveryOverride`、手工串 node、fake tool/store/review。
  - 覆盖要求：要通过不同 case 把关键节点与关键边都跑到，而不是只验证一条 happy path。
- `live`
  - 目标：验证真实模型下 `human` 的真实业务执行。
  - 约束：必须走真实 `ctx.chatStructured`、真实 KB、真实工具、真实 review / artifact。
  - 禁止：任何 scripted driver、`chatStructuredOverride`、fixture store override。
  - 覆盖要求：至少保留 1 条简单任务和 1 条复杂任务正式 case；如复杂任务有多条长期价值用例，可同时保留。

### 2.3 `director`

- `mock-llm`
  - 目标：在 non-live 条件下验证 `director` 的真实编排链。
  - 约束：只允许 mock LLM 输入输出；必须真实派发真实 `human`，并真实走 route / context / plan / synthesis。
  - 禁止：`runHumanTask` stub、fake `human` runner、手工拼接 director 节点结果。
  - 覆盖要求：要通过不同 case 把关键编排节点与关键转移边都跑到。
- `live`
  - 目标：验证真实模型下 `director -> human -> tools / KB / docx / artifacts` 的真实业务执行。
  - 约束：不允许任何 fake。
  - 禁止：scripted driver、`chatStructuredOverride`、`documentsStoreOverrides`、fake `human` runner。
  - 覆盖要求：至少保留 1 条简单任务和 1 条复杂任务正式 case；如复杂任务有多条长期价值用例，可同时保留。

## 3. 领域特有规则

### 3.1 Harness 规则

- AI 正式 backend case 必须使用生产 `createAiRunContext` 作为唯一正式 runtime 入口。
- formal harness 必须使用真实 `StorageService / DocumentsStore / ChatStore / DraftReviewStore / LlmConfigStore / DraftReviewService / EmbeddingService`。
- `mock-llm` 统一通过 scripted structured output driver 固定 LLM 输出；除 LLM 输出外，其余全部真实。
- `live` 统一通过真实 `LlmConfigStore` 注入 live 配置，并走生产 `chatStructured`。
- KB fixture 必须走真实导入、真实索引、真实检索。
- embedding 模型缺失时，harness 应优先通过真实生产下载链自动检查并下载，不得引入测试专用 embedding 替身。
- 旧式 fake API 一律不得进入 formal harness；一次性排查如果确实需要 fake，只允许写入 `tests/temp/**`。

### 3.2 `mock-llm` 与 `live` 设计口径

#### `mock-llm`

- 目的：快速定位非 LLM 问题，并验证每个关键节点、关键边在真实生产 graph 中都能跑通。
- 允许：脚本化 LLM 输入输出。
- 不允许：脚本化 runtime 节点执行结果。
- 断言重点：节点流转、工具调用、审批事件、artifact、memory、错误收敛、状态收口。

#### `live`

- 目的：验证真实业务场景在真实生产调用下可以完成。
- case 设计必须使用真实用户风格输入，不得把内部 route、固定工具顺序或 plan 条数写进用户输入。
- 断言重点：完成态、关键 route、关键工具调用、关键 artifact、关键事实是否成立。
- 不对最终文案做精确文本断言。

### 3.3 目录与命令

正式 AI 测试目录：

- `tests/ai/tool/<group>/<case>.test.ts`
- `tests/ai/human/mock-llm/<case>.test.ts`
- `tests/ai/human/live/<case>.test.ts`
- `tests/ai/director/mock-llm/<case>.test.ts`
- `tests/ai/director/live/<case>.test.ts`

长期非 formal 测试目录：

- `tests/unit/ai/<case>.test.ts`

推荐命令：

- `pnpm test:ai`
- `pnpm test:ai:tool`
- `pnpm test:ai:human:mock-llm`
- `pnpm test:ai:human:live`
- `pnpm test:ai:director:mock-llm`
- `pnpm test:ai:director:live`
- `pnpm test:unit`
- `pnpm test:unit:ai`

## 4. 正式 Case 清单

### 4.1 `tool`

#### `docx`

##### `docx-minimal-edit-flow`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证最小 docx 打开、定位、编辑、校验与预览链路。
- Why：这是 docx 工具链最基础的真实生产调用闭环。
- How：对 fixture docx 真实执行 `docx_open -> docx_search / outline -> docx_apply_ops -> docx_validate -> docx_render_preview`。
- Oracle：返回稳定 `docId/newDocId`、只目标 block 进入 `changedBlocks`、`validate` 通过。
- Not：不验证 `human` 的工具选择。

##### `docx-large-document-navigation`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证长文档下的读取、定位和局部精读能力。
- Why：长文档最容易暴露基础定位问题。
- How：对高 block 数 fixture 真实调用 `docx_open / outline / search / get_block`。
- Oracle：长文档下仍返回稳定 block 信息与截断标记。
- Not：不验证编辑落盘。

##### `docx-complex-ops-batch`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证多类复杂编辑操作的真实执行契约。
- Why：复杂写入是 docx 工具层高风险区。
- How：覆盖 `replace_text / replace_block / insert_before / insert_after / delete_block / update_table_cell`。
- Oracle：各类 op 都能产生可继续消费的新快照与 `changedBlocks`。
- Not：不验证上层 op 选择策略。

##### `docx-format-variants-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 paragraph、heading、table、table_cell 的读取与修改契约。
- Why：不同 block 类型最容易只在各自路径暴露问题。
- How：使用混合 block fixture 真实执行读取、定位与修改。
- Oracle：各类 block 都可稳定识别和修改，不破坏其余结构。
- Not：不验证 run 级样式保留。

##### `docx-mixed-format-preservation`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证混合格式文本在编辑后的样式保留。
- Why：run 级样式保留是 docx 修改的重要风险。
- How：对包含 `bold / italic / underline / color` 的真实 docx 执行编辑并预览。
- Oracle：未修改部分样式保留，修改目标预览正确。
- Not：不验证 review UI。

##### `docx-review-aware-open-and-continue-edit`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 active review 下 `docx_open` 会基于 latest effective draft 继续编辑。
- Why：多轮未确认修改能否累计，依赖 review-aware open 的真实行为。
- How：通过真实 `DraftReviewStore + DraftReviewService` seed active review，再执行 `docx_open / docx_search / docx_apply_ops / docx_validate`。
- Oracle：读取内容来自最新草稿而非源文件，新增修改只叠加当前 delta。
- Not：不验证 review UI 与最终确认替换。

##### `docx-history-and-rollback`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 run 内历史查询与回滚能力。
- Why：复杂编辑任务必须可回退。
- How：多轮真实 `apply_ops` 后执行 `docx_get_history` 与 rollback，再 `validate`。
- Oracle：历史链可追溯，回滚只影响 run 内草稿，不改写磁盘源文件。
- Not：不验证 review 放弃 / 确认。

##### `docx-precondition-guard`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证未 `open` 或无效 `docId` 时的前置保护。
- Why：这是工具层最常见的异常入口。
- How：直接调用 `outline / search / apply_ops / validate` 覆盖非法输入。
- Oracle：返回明确失败，不产生新快照，不污染运行状态。
- Not：不验证上层重试策略。

##### `docx-save-overwrite-approval`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证另存为、覆盖写入与审批边界。
- Why：落盘是 docx 工具链最高风险动作之一。
- How：对真实修改后草稿执行保存到新路径、覆盖已有文件、审批通过 / 拒绝分支。
- Oracle：审批拒绝时原文件不改写，审批通过后返回正确落盘结果。
- Not：不验证 workbench 审批 UI。

#### `kb`

##### `kb-document-discovery-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `kb_list_documents` 在当前工作区默认范围内的真实列表、过滤与缩圈契约。
- Why：KB 资料发现必须真实调用生产检索存储。
- How：通过真实 `DocumentsStore.addDocument / addChunks` 导入多工作区 fixture 后执行列表查询。
- Oracle：结果默认只包含当前工作区文档，`documentIds` 只做进一步缩圈，空结果与非空结果都稳定可断言。
- Not：不验证问答文案。

##### `kb-evidence-search-family-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `kb_hybrid_search_chunks / kb_vector_search_chunks / kb_fts_search_chunks` 在当前工作区范围内的统一真实检索契约。
- Why：KB tool family 必须显式覆盖每个正式工具。
- How：对多工作区真实 seed 数据分别执行三种检索，并覆盖 `documentIds` 缩圈。
- Oracle：三种检索都返回稳定 `rows`，默认受当前工作区约束，且遵守 `documentIds` 缩圈语义。
- Not：不比较召回优劣。

#### `terminal`

##### `terminal-directory-inspection-readonly`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证目录检查类只读命令能真实执行并返回结构化摘要。
- Why：这是 terminal 工具最典型的只读路径。
- How：调用 `terminal_run_command` 读取目录信息。
- Oracle：返回真实 stdout 片段、退出码与可消费摘要。
- Not：不验证写操作。

##### `terminal-text-search-readonly`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证只读文本搜索命令的真实执行契约。
- Why：搜索是 terminal 工具最常见的辅助路径。
- How：调用 `terminal_run_command` 真实执行搜索命令。
- Oracle：返回可断言命中信息与正确退出状态。
- Not：不验证修改文件。

##### `terminal-risk-and-boundary-guard`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证危险命令与越界输入会被真实守卫拒绝。
- Why：terminal 风险边界必须靠正式测试长期守住。
- How：构造危险或越权命令调用 `terminal_run_command`。
- Oracle：返回明确拒绝，不执行实际破坏操作。
- Not：不验证 UI 提示。

##### `terminal-inline-edit-artifact-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证安全 inline edit 会生成可继续消费的 artifact。
- Why：terminal 修改路径必须产出稳定 artifact。
- How：对测试文件执行真实 inline edit 命令并读取返回产物。
- Oracle：artifact 信息完整，修改结果与磁盘状态一致。
- Not：不验证上层审批流。

#### `hand`

##### `hand-parallel-safety-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `hand` 的并行工具执行与聚合守卫。
- Why：工具执行器本身必须在真实结果下稳定收敛。
- How：通过真实 `hand` 执行多工具调用并检查状态收敛。
- Oracle：并行工具结果被正确聚合，运行状态无串扰。
- Not：不验证 `brain` 决策来源。

##### `hand-tool-limit-and-artifact-merge`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `hand` 的工具次数限制与 artifact 合并行为。
- Why：这是工具执行层的关键边界。
- How：通过真实工具结果触发 limit 与 artifact merge 分支。
- Oracle：超限被守卫拦截，artifact 合并结果稳定。
- Not：不验证 `human` 全链路。

### 4.2 `human`

#### `mock-llm`

##### `learning-hand-mouth-smoke`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `human` 在 mock-llm 模式下能稳定走通真实 `brain -> learning -> hand -> mouth` 主链路。
- Why：这是 `human` graph 的最小真实闭环，后续所有复杂样例都建立在这条主链路之上。
- How：通过 scripted structured output 依次驱动学习 `workspace-cli`、执行一次真实 `terminal_run_command(pwd)`，再进入真实 `mouth` 完成交付。
- Oracle：`human_brain`、`human_learning`、`human_hand`、`human_mouth` 四个 stage 都真实出现，且至少有一次真实 terminal 工具结果与一次真实 delivery 事件。
- Not：不验证复杂分支、异常恢复或 live 模型质量。

##### `learning-tool-budget-tracking`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证真实 `learning` 会持续记录当前 active tool 数，并在预算未超限时保留当前已学习 skill 集。
- Why：`learning` 的 active tool 预算是后续扩展 `excel / ppt` 等新能力时的重要长期边界，正式 case 需要先守住基础统计与状态可见性。
- How：通过 scripted structured output 依次学习 `workspace-cli + docx-read`、`docx-write + docx-delivery`、`kb-document-discovery + kb-evidence-query`，最后进入真实 `mouth` 收束；检查最后一轮真实 `human_learning` 事件中的 `learnedSkillIds`、`availableToolNames` 与 summary。
- Oracle：任务最终完成；最后一轮 `human_learning` 事件中保留全部已学习 skill，`availableToolNames` 长度为 `15`，summary 包含 `当前 active tools=15`，且不包含 skill 淘汰文案。
- Not：不验证超过 `20` 个 active tools 后的淘汰算法细节。

##### `watchhint-retry`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 duplicate learning 触发真实 `watch_hint` 后，graph 会回到 `brain` 并继续推进。
- Why：`watch_hint -> brain` 是 `human` 的核心收敛边之一，断掉后很多异常都无法恢复。
- How：第一轮先学习 `workspace-cli`，第二轮故意重复学习同一个 skill 触发 learning watch hint，随后再执行一次真实 `terminal_run_command(pwd)` 并完成交付。
- Oracle：事件流中真实出现 source 为 `learning` 的 `watch_hint`，并且在它之后仍发生真实 terminal 工具调用，任务最终完成。
- Not：不验证 live 模型是否会自然产生这类重复决策。

##### `tool-failure-recovery`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证真实工具失败结果会被 `human` 吸收，并继续收束到最终交付。
- Why：工具失败是高频真实场景，如果失败后链路无法继续，`human` 就不具备稳定执行能力。
- How：先学习 `workspace-cli`，再真实执行一个会失败的只读命令 `cat definitely-missing-file.txt`，随后由 `brain` 决定停止重试并进入 `mouth`。
- Oracle：真实 `terminal_run_command` 结果为失败，且 `human` 最终仍进入 `completed` 并产出最终交付。
- Not：不验证失败后的最佳补救策略是否最优。

##### `tool-limit-converge`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证真实 `hand` 在超过 `hardActionLimit` 后会发出收敛型 `watch_hint`。
- Why：工具调用上限是 autonomous 执行的重要失控保护，必须通过真实执行链守住。
- How：把 `hardActionLimit` 设为 `1`，先后真实执行两次只读 terminal 命令，让第二次调用命中上限保护。
- Oracle：事件流中出现 source 为 `hand` 且摘要包含“超过临时上限 1”的 `watch_hint`，任务最终完成。
- Not：不验证更高层是否继续扩展计划。

##### `approval-denied-restricted-delivery`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证真实审批拒绝会阻止高风险命令落地，并把限制带入最终交付。
- Why：审批拒绝是正式生产边界，不能只靠 fake 测试覆盖。
- How：设置 `approvalPolicy=deny-medium-high`，学习 `workspace-cli` 后尝试真实执行 `mkdir blocked-dir`，然后进入最终说明。
- Oracle：真实工具结果返回 `approval_denied`，审批事件里存在 `approved=false`，磁盘上不会真的创建 `blocked-dir`，任务最终完成。
- Not：不验证用户如何在 UI 中恢复被拒绝的动作。

##### `delivery-mode-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证真实 `mouth` 在不同 `deliveryMode` 下会按各自生产契约输出。
- Why：`human -> director` 的交接边界依赖 `context_note` 与 `task_handoff` 的稳定格式。
- How：分别以 `context_note` 和 `task_handoff` 两种 internal delivery 运行同一条真实 `human` 主链路，最后都通过真实 `mouth` 完成交付。
- Oracle：`context_note` 输出包含 `可复用证据` 结构，`task_handoff` 输出包含 `关键证据` 结构，两者不混淆。
- Not：不验证 `director` 如何消费这些交付物。

##### `brain-memory-write-boundary`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证第一轮 `brain` 写入的 `facts / evidences / openQuestions` 会在下一轮真实 `brain` prompt 中继续可见。
- Why：memory 跨轮延续是 `human` 长链路推理的核心能力，必须由真实 graph 保证。
- How：第一轮 `brain` 通过 `memoryOps` 写入事实、证据和未决项，并触发一次真实 learning；第二轮 `brain` 读取真实 prompt，检查这些内容是否还在。
- Oracle：第二轮 `brain` prompt 中同时出现前一轮写入的 fact、evidence 和 open question，任务最终完成。
- Not：不验证更复杂的 memory 去重或压缩策略。

##### `complex-docx-edit`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 mock-llm 下 `human` 仍通过真实 docx 工具链完成打开、编辑和搜索。
- Why：复杂 docx 编辑是 `human` 的长期高价值真实任务类型。
- How：先写入 fixture docx，再通过真实 `docx_open -> docx_apply_ops -> docx_search` 完成一次正文替换并检索新内容。
- Oracle：真实 `docx_apply_ops` 只产生一处 `changedBlocks`，真实 `docx_search` 能命中新文本，任务最终完成。
- Not：不验证 review UI 或最终落盘流程。

##### `multi-tool-collaboration`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `human` 会通过真实 `hand` 执行一次并行多工具协作。
- Why：`human` 不能只验证单工具 happy path，还必须覆盖真实并行读工具场景。
- How：先 seed 真实 KB 文档，再学习 terminal 与 KB skill，随后在一次 `hand` 决策中并行执行 `terminal_run_command(pwd)` 与 `kb_list_documents`。
- Oracle：同一条任务中真实出现 terminal 与 KB 两类工具结果，任务最终完成。
- Not：不验证更复杂的多轮依赖型并行调度。

##### `kb-answer-with-real-kb`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 mock-llm 下的 KB 回答仍通过真实知识库存储、真实 embedding 与真实检索执行。
- Why：KB 是当前最敏感的 fake 风险点，必须单独有正式 case 显式守住。
- How：seed 两份真实 KB 文档，学习 KB skill 后真实执行 `kb_fts_search_chunks`，再通过真实 `mouth` 生成最终回答。
- Oracle：真实 KB 检索结果中包含目标文档 `doc-1` 的证据，且这条证据文本会进入真实 `mouth` prompt，任务最终完成。
- Not：不验证答案措辞或检索召回优劣。

#### `live`

##### `human-file-retention-answer-live`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 live 模式下 `human` 会基于真实已选资料完成常见规则问答。
- Why：`human/live` 需要至少有一条高频真实问答样例，证明真实模型下的单目标资料检索闭环可执行。
- How：注入真实 live LLM 配置，seed 一份与“审批未通过时保留原文件”相关的真实 KB 文档并限制在已选范围内，然后直接输入“审批没通过时原文件到底要不要保留”的自然语言诉求，让真实 `human` 自主完成。
- Oracle：任务最终完成，且真实工具结果中至少出现一次以 `kb_` 开头的检索工具调用，最终结论明确指向保留原文件。
- Not：不对最终文案做精确文本断言。

##### `human-risk-report-draft-live`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 live 模式下 `human` 会在一个真实长任务里串起模板定位、资料取证、docx 编辑与预览交付。
- Why：`human/live` 需要至少一条长期高价值复杂样例，覆盖 workspace、KB、docx 与最终交付链路。
- How：注入真实 live LLM 配置；workspace 中动态写入带 `RISK_TODO / OWNER_TODO` 占位符的周报模板和干扰文件；seed 两份真实 KB 文档分别提供风险结论与负责人说明并限制在已选范围内；直接输入“找到上周 Word 周报模板，按已选资料补全风险结论与负责人，生成预览且不要覆盖原文件”的自然语言诉求，让真实 `human` 自主完成。
- Oracle：任务最终完成；事件流中至少出现一次 `terminal_run_command`、一次以 `kb_` 开头的检索工具调用、一次 `docx_open`、一次 `docx_apply_ops` 与一次 `docx_render_preview`；存在 preview/draft artifact，且原模板未被覆盖。
- Not：不绑定最终答案措辞，也不要求固定检索工具顺序。

### 4.3 `director`

#### `mock-llm`

##### `simple-task-stays-human-first`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `director` 在 mock-llm 模式下会通过真实 `human-first` 路径完成简单任务。
- Why：`direct_human` 是 `director` 的默认低编排路径，必须先独立守住。
- How：把 `director.intent` 固定为 `direct_human`，然后让真实 `human` 学习 terminal skill、真实执行 `terminal_run_command(pwd)` 并完成最终交付。
- Oracle：真实发生一次 `director_direct_human_exec` 的 `task_started/task_completed`，最终 run 完成且交付中包含 human-first 结果。
- Not：不验证更复杂的 route 切换。

##### `context-enrich-then-direct`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `director` 会先走真实 context human，再回到 intent 并进入 direct human。
- Why：`need_context -> direct_human` 是复杂度中等任务的重要过渡路径。
- How：第一次 `director.intent` 固定为 `need_context`，由真实 `human` 产出 `context_note`；第二次 `director.intent` 再固定为 `direct_human`，由真实 `human` 完成任务。
- Oracle：最终 run 完成，`contextRounds=1`，且 `contextEvidence` 中保留了 context human 产出的可复用证据。
- Not：不验证 evidence 质量高低或 context 摘要文案。

##### `context-round-cap`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `contextRounds` 达到上限后，`director` 会直接转入 `plan` 阶段而不再重复调用 intent。
- Why：如果没有这个保护，`director` 可能卡死在 context 循环。
- How：把 `maxContextRounds` 设为 `1`，首次 `intent` 返回 `need_context`，context 完成后继续推进，检查是否直接进入真实 `plan` 路径。
- Oracle：整个 run 最终完成，`intent` 只被调用一次，且最终 state 中已经生成计划任务。
- Not：不验证 planner 产出的任务质量。

##### `plan-exec-then-synthesis`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `director` 会通过真实 `human` 逐项执行计划，再进入 synthesis 完成最终综合输出。
- Why：`to_plan -> plan_exec -> synthesis` 是 `director` 最核心的增强路径主干。
- How：固定 `intent=to_plan`，planner 产出两个任务，然后由真实 `human` 分别完成两个 handoff，最后再由真实 synthesis human 产出最终结果。
- Oracle：`plan_created` 真实出现一次，`director_plan_exec` 真实串行启动两个任务，所有计划任务都完成，最终输出完成。
- Not：不验证 live planner 是否会自然拆成相同任务。

##### `context-evidence-reuse`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证真实 context human 产出的可复用 evidence 会进入后续 director 的 plan prompt。
- Why：如果 context 证据不能复用，context 路径就会退化成一次性说明文字，无法支撑后续编排。
- How：先让真实 context human 产出包含 `Alice owns the risk` 的 `context_note`，再进入真实 `director.plan`，检查 planner prompt 是否看到了这条 evidence。
- Oracle：最终 run 完成，且 planner 收到的真实 prompt 中包含 `Alice owns the risk`。
- Not：不验证 planner 对证据的理解质量。

##### `plan-exec-serial-merge`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `director_plan_exec` 会按计划顺序串行派发真实 `human` 子任务。
- Why：计划执行一旦乱序，后续状态合并和综合输出都会失真。
- How：planner 产出 `task-a`、`task-b` 两个任务，随后由真实 `human` 依次完成两个 handoff，再进入 synthesis。
- Oracle：`director_plan_exec` 的 `task_started` 顺序严格为 `task-a,task-b`，最终 run 完成。
- Not：不验证并行计划执行策略。

##### `complex-kb-docx-synthesis`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `director` 在 mock-llm 模式下仍会通过真实 `human` 跑通 `KB + docx + synthesis` 复杂组合链路。
- Why：这是当前 `director` 最接近真实复杂业务的正式样例，能够同时守住检索、编辑和综合输出。
- How：seed 真实 KB 文档与真实 docx 文件，固定 `intent=to_plan` 后产出 `task-kb` 和 `task-docx`，再分别通过真实 `human` 完成 KB 搜索与 docx 编辑，最后进入 synthesis。
- Oracle：真实 KB 检索结果中包含目标文档 `doc-1`，真实 `docx_apply_ops` 产生一处 `changedBlocks`，最终 run 完成。
- Not：不验证更复杂的多阶段 artifact 渲染或最终文案风格。

#### `live`

##### `director-approval-reply-live`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 live 模式下 `director` 会把一个常见资料问答回复任务走成真实 `human-first` 路径。
- Why：`director/live` 需要至少有一条简单真实样例，证明单目标、单交付任务会优先 direct 给 `human` 而不是误升级为 plan。
- How：注入真实 live LLM 配置，seed 一份与“审批未通过时保留原文件”相关的真实 KB 文档并限制在已选范围内；直接输入“同事来问审批没过时原文件怎么处理，帮我整理一段两三句话回复”的自然语言诉求，让真实 `director` 自主路由并执行。
- Oracle：最终 run 完成；真实发生一次 `director_direct_human_exec`；不出现 `plan_created`；事件流中至少出现一次以 `kb_` 开头的真实工具调用；最终交付内容非空。
- Not：不对路由原因文本或最终回答措辞做精确断言。

##### `director-risk-report-delivery-live`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 live 模式下 `director` 会把一个真实长任务拆解为资料整理、模板补全与最终交付。
- Why：`director/live` 需要至少一条长期高价值复杂样例，覆盖 plan、human 子任务、synthesis 与 artifact 合并。
- How：注入真实 live LLM 配置；workspace 中动态写入带占位符的周报模板和干扰文件；seed 两份真实 KB 文档分别提供风险结论与负责人说明并限制在已选范围内；直接输入“把本周风险周报整件事做完：整理资料、找模板、补全文档、生成预览、给交付说明”的自然语言诉求，让真实 `director -> human` 自主完成。
- Oracle：最终 run 完成；事件流中出现 `plan_created`、至少一次 `director_plan_exec` 与一次 `director_synthesis_human`；全链路至少出现一次 `terminal_run_command`、一次以 `kb_` 开头的检索工具调用、一次 `docx_apply_ops` 与一次 `docx_render_preview`；`finalArtifacts` 中存在 preview/draft artifact。
- Not：不绑定最终 route 说明文本，也不固定 KB 工具选择顺序。
