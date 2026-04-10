# NCurator-Desktop AI 测试计划

## 1. 总体目标

- 本计划用于定义 AI 域正式测试的范围与领域特有规则。
- 正式 / temp 准入、runner、raw logs 与正式 case 共享字段，统一遵循 `doc/test.md`。
- AI 正式测试只围绕两类稳定对象治理：
  1. `tool`
  2. `human`

## 2. Suite 设计

### 2.1 `tool`

- `tool` 只验证真实生产工具调用，不允许 fake。
- 目标：验证 tool 与 `hand` 工具执行守卫在真实生产代码下的输入输出是否正常、合理。
- 约束：必须真实调用生产工具、真实 store、真实 review service、真实 artifact 流。
- 禁止：fake `documentsStore`、fake `embeddingService`、fake `resolveDocxOpenTarget`、fake tool result。

### 2.2 `human`

- `mock-llm`
  - 目标：在 non-live 条件下验证 `AiRunService -> human` 入口和 `human` 主链的真实执行链路。
  - 约束：只允许 mock LLM 输入输出；必须真实走 `createAiRunContext -> human graph -> learning / hand / mouth -> store / review / artifact`。
  - 禁止：`humanReasonOverrides`、`toolExecutionOverrides`、手工串 node、fake tool/store/review。
  - 覆盖要求：要通过不同 case 把关键节点与关键边都跑到，而不是只验证一条 happy path。
- `live`
  - 目标：验证真实模型下 `human` 的真实业务执行。
  - 约束：必须走真实统一 LLM executor（包括 `ctx.chatStructured / ctx.chatText`）、真实 KB、真实工具、真实 review / artifact。
  - 禁止：任何 scripted driver、`chatStructuredOverride`、fixture store override。
  - 覆盖要求：至少保留 1 条简单任务和 1 条复杂任务正式 case；如复杂任务有多条长期价值用例，可同时保留。

## 3. 领域特有规则

### 3.1 Harness 规则

- AI 正式 backend case 必须使用生产 `createAiRunContext` 作为唯一正式 runtime 入口。
- formal harness 必须使用真实 `StorageService / DocumentsStore / ChatStore / DraftReviewStore / LlmConfigStore / DraftReviewService / EmbeddingService`。
- `mock-llm` 统一通过 scripted LLM driver 固定 LLM 输出；除 LLM 输出外，其余全部真实。
- `live` 统一通过真实 `LlmConfigStore` 注入 live 配置，并走生产统一 LLM executor。
- 凡是会进入 `human` 的正式 run，必须在进入 `human` 前完成 embedding 基础服务 preflight；不允许把 embedding 初始化推迟到某个工具调用时才暴露。
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
- case 设计必须使用真实用户风格输入，不得把内部固定工具顺序写进用户输入。
- 断言重点：完成态、关键工具调用、关键 artifact、关键事实是否成立。
- 不对最终文案做精确文本断言。
- transport / structured output 兼容性探针类 case，应至少分别覆盖一次 `force_non_stream` 与 `force_stream` 路径。

### 3.3 目录与命令

正式 AI 测试目录：

- `tests/ai/tool/<group>/<case>.test.ts`
- `tests/ai/human/mock-llm/<case>.test.ts`
- `tests/ai/human/live/<case>.test.ts`

长期非 formal 测试目录：

- `tests/unit/ai/<case>.test.ts`

推荐命令：

- `pnpm test:ai`
- `pnpm test:ai:backend`
- `pnpm test:ai:tool`
- `pnpm test:ai:human:mock-llm`
- `pnpm test:ai:human:live`
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

##### `docx-search-unicode-normalization-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `docx_search` 在 literal / regex 模式下会做兼容字形归一，能用普通查询命中兼容字形文本。
- Why：docx 文本里常见兼容字形，如果检索不归一，AI 会把“文档已写”误判成“文档未写”。
- How：写入包含兼容字形文本的真实 docx，再分别执行 literal 与 regex 搜索。
- Oracle：普通查询可命中兼容字形 block，且返回稳定 blockId。
- Not：不比较字符偏移是否完全映射回原始编码位置。

##### `docx-search-scope-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `docx_search` 默认搜索当前文档全部 block，且 `scope.blockIds` 只在当前文档内进一步缩圈。
- Why：这是 docx 搜索的核心契约，必须长期稳定，避免 prompt 与工具行为不一致。
- How：对同一 doc 先执行默认搜索，再传入 `scope.blockIds` 做缩圈搜索。
- Oracle：默认搜索可命中文档内多个 block，缩圈后只返回指定 blockIds 范围内的结果。
- Not：不验证 human 该如何选择何时缩圈。

##### `docx-outline-truncation-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `docx_outline` 的结果会明确暴露“已截断、后续内容未包含”的事实。
- Why：如果只返回原始计数、不暴露截断语义，human 很容易把局部 outline 误当全文。
- How：对长文档执行真实 `docx_outline(maxBlocks=...)`，检查返回 summary 与事件预览。
- Oracle：返回结果既包含 `truncated=true`，也包含清晰文字说明“结果已截断，文档后续内容未包含”。
- Not：不验证 human 是否一定继续读取后续内容。

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
- What：验证 `hand` 的并行工具执行上限、只读安全约束与结果聚合守卫。
- Why：工具执行器本身必须在真实结果下稳定收敛。
- How：通过真实 `hand` 执行安全并行批次、`6` 个只读安全并行批次、超过上限的 `7` 个并行批次以及包含 mutating 调用的不安全批次。
- Oracle：`6` 个只读且 `parallelSafe` 的工具调用会被真实执行并正确聚合；`7` 个并行调用会在执行前被 `parallel_limit_exceeded` 拦截；包含 mutating 或非并行安全工具的批次会在执行前被 `parallel_requires_read_only` 拦截。
- Not：不验证 `brain` 决策来源。

##### `hand-serial-docx-chain`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `hand` 在 `serial` 模式下会按顺序执行真实 docx 写入、校验与预览链路。
- Why：复杂 docx 链路依赖最新快照，必须通过正式 case 守住串行执行契约。
- How：通过真实 `hand` 执行 `docx_apply_ops -> docx_validate -> docx_render_preview`。
- Oracle：工具结果顺序稳定、全部成功，且会产出 preview artifact。
- Not：不验证 `brain` 是否自然生成这条计划。

##### `hand-tool-limit-and-artifact-merge`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `hand` 的工具次数限制与 artifact 合并行为。
- Why：这是工具执行层的关键边界。
- How：通过真实工具结果触发 limit 与 artifact merge 分支。
- Oracle：超限被守卫拦截，artifact 合并结果稳定。
- Not：不验证 `human` 全链路。

##### `hand-history-recall`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 builtin `history-recall` 能通过真实 `hand` 链路加载旧历史，并写入 `loaded_history_context`。
- Why：过程历史的按需展开是长链路任务的重要收敛能力，需要有正式 case 长期守住。
- How：先 seed 历史 round，再通过真实 `hand` 调用 internal tool `history_recall`。
- Oracle：`execution.lastToolResults` 中出现 `history_recall`，且 `memory.history.loadedHistoryContext` 被真实写入。
- Not：不验证 `brain` 是否一定会主动触发这条能力。

### 4.2 `human`

#### `mock-llm`

##### `ai-run-service-human-only`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `AiRunService` 在 mock-llm 模式下会直接进入真实 `human` graph。
- Why：run 入口已经是 human-only 运行时，必须有正式 case 长期守住这条入口事实。
- How：通过 `AiRunService.getInstance().run(...)` 启动一次真实 run，再用 scripted structured output 驱动 `brain -> learning -> hand -> mouth` 完成闭环。
- Oracle：真实出现 `human_brain`、`human_learning`、`human_hand`、`human_mouth` 四个 stage，`AiRunState.finalDeliveryMarkdown` 正常落地，且 `AiRunService` 自身不直接发 `run_completed`。
- Not：不验证更复杂 live 业务链路。

##### `ai-run-service-embedding-preflight`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `AiRunService` 会在进入 `human` 前完成 embedding preflight，且 preflight 失败时会直接失败收口。
- Why：embedding 已被定义为 AI run 的基础设施，不应等到 semantic 工具调用时才第一次暴露未就绪问题。
- How：分别覆盖 preflight 成功后执行真实 semantic docx search，以及 preflight 直接失败的分支。
- Oracle：成功分支中 semantic docx search 正常返回结果；失败分支中 run 直接失败且不会进入 `human` stage。
- Not：不验证模型下载进度展示。

##### `learning-hand-mouth-smoke`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `human` 在 mock-llm 模式下能稳定走通真实 `brain -> learning -> hand -> mouth` 主链路。
- Why：这是 `human` graph 的最小真实闭环，后续所有复杂样例都建立在这条主链路之上。
- How：通过 scripted structured output 依次驱动学习 `workspace-cli`、执行一次真实 `terminal_run_command(pwd)`，再进入真实 `mouth` 完成交付。
- Oracle：`human_brain`、`human_learning`、`human_hand`、`human_mouth` 四个 stage 都真实出现，且至少有一次真实 terminal 工具结果与一次真实最终交付。
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

##### `brain-memory-write-boundary`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证第一轮 `brain` 写入的新 stable memory 字段会在下一轮真实 `brain` prompt 中继续可见。
- Why：memory 跨轮延续是 `human` 长链路推理的核心能力，必须由真实 graph 保证。
- How：第一轮 `brain` 通过 `updatedStableMemory` 局部更新任务笔记，并触发一次真实 learning；第二轮 `brain` 读取真实 prompt，检查这些内容是否还在。
- Oracle：第二轮 `brain` prompt 中同时出现前一轮写入的当前理解、关键依据和 checklist 内容，任务最终完成。
- Not：不验证更复杂的 memory 压缩策略。

##### `checklist-memory-maintenance`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 checklist 作为长期任务板会在 mock-llm 下跨轮维护 todo、done 与 obsolete 状态。
- Why：如果 checklist 不能跨轮保留并被重写成最新任务板，brain 很容易把长期记忆退化成单轮摘要。
- How：第一轮 `brain` 写入只含 todo 的 checklist，并触发一次真实 learning；第二轮 `brain` 读取真实 prompt 后，将 checklist 重写为包含 done、todo 与 obsolete 的新版本。
- Oracle：第二轮 `brain` prompt 中能看到第一轮写入的 checklist 与 note，任务最终完成，且新的 checklist 成功写回长期记忆。
- Not：不验证 runtime 是否解析 checklist 结构或对其状态做额外机读校验。

##### `complex-docx-edit`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 mock-llm 下 `human` 仍通过真实 docx 工具链完成打开、编辑和搜索。
- Why：复杂 docx 编辑是 `human` 的长期高价值真实任务类型。
- How：先写入 fixture docx，再通过真实 `docx_open -> docx_apply_ops -> docx_search` 完成一次正文替换并检索新内容。
- Oracle：真实 `docx_apply_ops` 只产生一处 `changedBlocks`，真实 `docx_search` 能命中新文本，任务最终完成。
- Not：不验证 review UI 或最终落盘流程。

##### `docx-read-fact-exposure`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 human 在 mock-llm 模式下能收到 docx 读取链路中的关键客观事实，包括 outline 截断说明与归一化后的搜索命中。
- Why：这一层如果事实暴露不足，human 很容易把“当前结果被截断”或“搜索已命中”误读成别的状态。
- How：构造包含长文档截断与兼容字形文本的真实 docx，通过 scripted brain 检查后续 prompt 是否包含“结果已截断，文档后续内容未包含”以及归一化搜索命中的事实。
- Oracle：后续 `brain` prompt 中可读到截断文字说明与搜索命中信息，最终任务完成且不会把文档中已写内容误报为“未写”。
- Not：不验证 live 模型在该场景下的自主策略优劣。

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
- Oracle：任务最终完成；事件流中至少出现一次 `terminal_run_command`、一次以 `kb_` 开头的检索工具调用、一次 `docx_open`、一次 `docx_apply_ops` 与一次 `docx_render_preview`；存在 preview/draft artifact，且原模板未被覆盖；最终答复能从用户视角说明改动的是“风险结论”和“负责人说明”两处、依据分别来自 `Weekly Risk Summary.md` 与 `Owner Note.md`，并明确已经生成预览且未覆盖原文件。
- Not：不绑定最终答案措辞，也不要求固定检索工具顺序。

##### `human-docx-cause-remedy-reading-live`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 live 模式下 `human` 会基于两份已选 `docx` 做跨文件精读，并准确回答“过拟合 / 反走样”的成因与处理思路。
- Why：真实用户在复习场景里经常已经选中了资料，但仍会把两个概念混在一起；这条 case 要长期守住“已选资料范围 + 跨文件准确回答”的正式能力，对齐 `WB-CORE-002-AC2`、`WB-CORE-004-AC1`、`WB-CORE-006-AC1`、`WB-CORE-006-AC2`。
- How：注入真实 live LLM 配置；把 `tests/fixtures/ai/docx/深度学习.docx` 与 `tests/fixtures/ai/docx/图形学.docx` 作为已选资料复制进 workspace；直接输入“我做题老把这两个点混在一起。你就按我刚选的这两份资料，帮我说清楚：过拟合和反走样各自是什么、为什么会出现、一般怎么处理。别补充课外知识，哪份文档没写你就直接说没写。”的自然语言诉求，让真实 `human` 自主完成。
- Oracle：任务最终完成；事件流中至少两次 `docx_open` 覆盖两份目标文档，且至少出现一次 `docx_search`、`docx_outline` 或 `docx_get_block`；最终回答同时命中“过拟合”的成因/处理事实组和“反走样”的成因/处理事实组；不出现 `docx_apply_ops` 或 `docx_save`。
- Not：不要求固定回答结构，也不对最终文案做逐字断言。

##### `human-docx-contextual-comparison-draft-live`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 live 模式下 `human` 会基于两份已选 `docx`，在目标 `docx` 的相关位置追加解释性段落和对照表，并生成不覆盖原文件的预览稿。
- Why：真实用户常见诉求不是“改占位符”，而是“在这块后面补一段更好懂的说明”；这条 case 覆盖跨文件取材、相关位置补写、结构化新增与 preview-only 交付，对齐 `WB-CORE-002-AC2`、`WB-CORE-003-AC1`、`WB-CORE-004-AC1`、`WB-CORE-006-AC1`、`WB-CORE-006-AC2`。
- How：注入真实 live LLM 配置；把 `tests/fixtures/ai/docx/深度学习.docx` 与 `tests/fixtures/ai/docx/图形学.docx` 作为已选资料复制进 workspace；直接输入“《图形学》里‘反走样’这一节我还是记不住。你参考我刚选的这两份 Word，直接在这一节最后补一小段更好理解的说明，再加个简单对照表，一列写反走样，一列写《深度学习》里的过拟合。直接给我可预览的版本就行，别改原文件，也不用先回我文字草稿。”的自然语言诉求，让真实 `human` 自主完成。
- Oracle：任务最终完成；事件流中至少两次 `docx_open` 覆盖两份目标文档；`docx_apply_ops` 前至少出现一次针对“反走样”的读取定位；至少出现一次 `docx_apply_ops` 与一次 `docx_render_preview`；存在 preview/draft artifact；不出现 `docx_save`；原始两份 `docx` 文件未被覆盖；写入请求里能看到新增说明段落与表格结构。
- Not：不要求固定 op 组合，也不对最终说明文案做逐字断言。

##### `human-kb-guided-docx-comparison-draft-live`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 live 模式下 `human` 在本地资料较多时，会先用 KB 缩圈定位相关资料，再回到目标 `docx` 做跨文件补写并交付预览。
- Why：真实用户常常记得主题、不记得文件名；这条 case 要长期守住“工作区默认范围 + KB 缩圈 + docx 继续执行”的正式能力，对齐 `WB-CORE-002-AC2`、`WB-CORE-004-AC1`、`WB-CORE-006-AC1`、`WB-CORE-006-AC2`。
- How：注入真实 live LLM 配置；workspace 中动态写入 `深度学习.docx`、`图形学.docx` 和若干干扰文件，并把目标 `docx` 与干扰资料同时 seed 到真实 KB；不传 `selectedReferences`，只绑定 workspace；直接输入“我工作区资料有点多，我忘了是哪份课件在讲反走样了。你先帮我找到那份，再参考讲过拟合的那份资料，直接在‘反走样’那一节最后补一段更好记的说明，再加个简单对照表，一列写反走样，一列写过拟合。直接给我可预览的版本就行，别改原文件，也不用先回我文字草稿。”的自然语言诉求，让真实 `human` 自主完成。
- Oracle：任务最终完成；事件流中至少出现一次 KB 工具调用；后续出现 `docx_open` 并覆盖最终参与编辑的目标 `docx`；至少出现一次 `docx_apply_ops` 与一次 `docx_render_preview`；存在 preview/draft artifact；不出现 `docx_save`；目标原始 `docx` 未被覆盖；新增内容同时涉及“反走样”和“过拟合”。
- Not：不强制固定执行路径，也不要求 KB 缩圈后必须再打开所有候选资料。

## 5. 验收口径

- `tool` suite 必须持续守住真实工具输入输出、审批边界和 artifact 契约。
- `human/mock-llm` 必须覆盖 `AiRunService -> human` 入口、`brain / learning / hand / mouth` 主链、memory 延续、watch hint 收敛与复杂工具协作。
- `human/live` 必须至少保留 1 条简单任务和 1 条复杂任务正式 case。
- `human` suite 必须继续支撑 `WB-CORE-002`、`WB-CORE-003`、`WB-CORE-004`、`WB-CORE-005`、`WB-CORE-006`。
