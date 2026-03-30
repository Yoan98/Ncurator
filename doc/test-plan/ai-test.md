# NCurator-Desktop AI 测试计划

## 1. 总体目标

本计划用于定义 AI 正式测试的 suite 划分、group 归属与正式 case 清单。

AI 正式测试要同时覆盖三类长期风险：

1. 基础流程或基础函数是否还能走通
2. 边界异常情况下是否还能稳定收敛
3. 真实任务场景是否真的能完成

其中 `human` 与 `director` 必须包含真实 AI 调用的正式 case；`tool` 不承担模型推理验证，只验证工具与工具执行契约。

## 2. 阶段设计

测试按 suite 顺序推进，原则上先稳住基础工具与执行链，再进入更上层的智能执行与编排验证。

AI 正式测试当前分为三个 suite：

1. `tool`
2. `human`
3. `director`

### 2.1 `tool`

做什么：验证 AI 运行依赖的核心工具、工具契约和 `hand` 的工具执行守卫。

为什么：工具层不稳定时，上层执行、规划和真实任务验证都会失真。

怎么做：以 `docx / kb / terminal / hand` 四类 group 组织正式 case；要求每个 skill 下的每个 tool 至少有 1 条正式 case 显式调用；对 `docx` 额外覆盖大文本、复杂操作、格式类型、混合格式，以及 review-aware 草稿延续 / 回滚五类高风险场景。

### 2.2 `human`

做什么：验证 `human` 作为 AI 单任务执行核心，是否既能保证基础链路稳定，又能在真实任务中自主学习、调用工具并完成交付。

为什么：工具只是零件，`human` 才决定单任务执行链路能不能真正闭环。

怎么做：以 `basics / scenarios / live` 三类 group 组织正式 case；`basics` 覆盖 `brain / learning / hand / mouth` 的基础路径和共享状态边界，`scenarios` 覆盖复杂 docx 编辑与多工具联动任务，`live` 覆盖真实 AI 调用下的短任务与长任务执行。

### 2.3 `director`

做什么：验证 `director` 对整体 AI 链路的路由、补上下文、计划拆分、串行派发、综合交付和 run 收尾能力。

为什么：复杂任务进入哪条路径、上下文是否有价值、计划是否可执行、最终是否还能稳定收口，都属于 `director` 的职责。

怎么做：以 `basics / contracts / live` 三类 group 组织正式 case；`basics` 先保证 direct/context/plan 三条主路径和 complete 节点可走通，`contracts` 验证 `intent / context / plan / plan_exec` 的关键边界，`live` 验证普通任务仍然 human-first、复杂任务会进入增强路径且真实完成。

## 3. 用例登记字段

- 正式 case 在本文登记时，必须包含 `测试类型` 字段。
- AI 域当前正式 case 的 `测试类型` 固定为 `backend`。
- 即使是使用真实 AI 调用的 case，也仍然登记为 `backend`，不额外拆新的测试类型。
- suite 本身不再拆分 `backend` / `e2e`；测试类型只在 case 登记时体现。

## 4. Suite 归属规则

- AI 正式 case 必须先判断主要验证的是哪一层契约，再归到单一 suite。
- `tool` 只承接工具能力、工具契约和 `hand` 的工具执行守卫验证，不承接 `brain` 推理与 `director` 路由。
- `human` 只承接单任务执行、单任务交付、单任务异常收敛和单任务真实 AI 调用验证。
- `director` 统一承接路由、补上下文、计划拆分、计划执行衔接、最终综合交付和 run 收尾验证。
- 真实 AI 调用的正式 case 只放在 `human` 与 `director`，不放在 `tool`。
- Workbench 的用户可见行为、阻塞恢复、review、scope 与 e2e 不归入 AI 测试。
- AI 正式目录路径与 case 登记规则统一以 [test.md](../test.md) 为准。

## 5. Case 登记约定

- 本文中的 `用例名称` 直接作为稳定 `caseId` 使用。
- AI 新增正式 case 在登记时默认先标记为 `待检查`，落测试后再更新为实际实现状态。
- AI 当前不再新增 `e2e` 测试类型；正式文件统一使用普通测试文件名。
- AI 当前建议 group 划分如下：
  - `tool`：`docx`、`kb`、`terminal`、`hand`
  - `human`：`basics`、`scenarios`、`live`
  - `director`：`basics`、`contracts`、`live`
- 文件映射规则：
  - `tool`：`tests/ai/tool/<group>/<caseId>.test.ts`
  - `human`：`tests/ai/human/<group>/<caseId>.test.ts`
  - `director`：`tests/ai/director/<group>/<caseId>.test.ts`
- `tool` suite 的正式 case 清单必须保证每个 skill 下的每个 tool 至少有 1 条 case 显式调用。
- `human/live` 与 `director/live` 必须使用真实 `ctx.chatStructured`，不得用 `humanReasonOverrides` 替代模型推理。
- `human/live` 与 `director/live` 的运行前提应通过 `tests/harness/backend/llmConfig.ts` 提供的 live 模型配置满足，至少包括：
  - `AI_LIVE_API_KEY`
  - `AI_LIVE_BASE_URL`
  - `AI_LIVE_PRIMARY_MODEL_NAME`
  - `AI_LIVE_STRONG_MODEL_NAME`
- `human/live` 与 `director/live` 的共享节流环境变量统一为 `NCURATOR_AI_LIVE_MIN_INTERVAL_MS`；live 测试层的重试与 backoff 预算使用代码默认值，不再额外暴露环境变量。
- `director/live` 默认不参与常规 live 运行；仅在需要显式执行时设置 `AI_ENABLE_DIRECTOR_LIVE=1`。
- `human/live` 与 `director/live` 的 `How / Oracle` 应优先断言结构化事实，如路由、节点步骤、工具调用、审批事件、artifact、完成态；不应对模型最终文案做精确文本断言。
- `human/basics`、`human/scenarios`、`director/basics` 与 `director/contracts` 应优先使用 `chatStructuredOverride`、`humanReasonOverrides`、`humanDeliveryOverride` 和工具执行 override 稳定固定链路，避免把基础回归建立在 live 模型随机性之上。

### 5.1 AI live case 设计与分析规则

- `human/live` 与 `director/live` 的 `How` 必须使用真实用户风格的自然诉求，不得通过输入脚本化内部路径。
- 禁止在 live `userInput` 中写死 `direct_human / plan / context` 目标、plan 条数、每轮工具数、内部工具名顺序，除非该约束本身就是要验证的真实用户需求。
- 普通诉求与复杂诉求的路由差异，应主要由任务复杂度、资料范围和交付物复杂度自然触发；需要固定路径验证时，应放在 `human/basics`、`human/scenarios`、`director/basics` 或 `director/contracts`。
- live `Oracle` 应优先断言行为类别与关键事实，如是否完成、是否进入低编排或增强路径、是否出现关键工具调用、是否产出 artifact；不应绑定精确 plan 条数、精确步骤序号或最终文案措辞。
- live report 归因必须先区分 `环境阻塞`、`case 设计偏差`、`实现行为偏差`；若多类问题同时存在，应并列记录，不能只保留 `429` 结论。

## 6. 正式 Case 清单

### 6.1 `tool`

#### 6.1.1 `docx`

#### `docx-minimal-edit-flow`

- 用例名称：`docx-minimal-edit-flow`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证“修改 docx 某一段话”的最小工具链能独立跑通。
- Why：这是最典型、最能说明工具层是否可用的真实任务拆解。
- How：准备包含目标段落的 fixture docx，依次调用 `docx_open -> docx_search` 或 `docx_outline -> docx_apply_ops -> docx_validate -> docx_render_preview`，必要时显式读取目标 block。
- Oracle：
  - 返回稳定 `docId/newDocId`，且只目标段落进入 `changedBlocks`。
  - `validate` 通过，preview artifact 可回看。
- Not：不验证 `human` 是否会自主选择这条链路。

#### `docx-large-document-navigation`

- 用例名称：`docx-large-document-navigation`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证大文本 docx 下的读取、定位和局部精读链路。
- Why：长文档最容易把 `open / outline / search / get_block` 的基础能力打坏。
- How：构造高 block 数量的长文档，覆盖 `docx_open`、`docx_outline`、`docx_search` 和 `docx_get_block`，同时验证局部定位与截断返回。
- Oracle：
  - `outline`、`search` 和 `get_block` 在长文档下仍返回稳定 block 信息。
  - 搜索命中位置、block 细节和截断标记可直接供上层继续定位。
- Not：不验证编辑或落盘。

#### `docx-complex-ops-batch`

- 用例名称：`docx-complex-ops-batch`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证复杂编辑操作组合的执行契约。
- Why：复杂编辑是 docx 写入能力的核心风险区。
- How：在同一条 case 中覆盖 `replace_text`、`replace_block`、`insert_before`、`insert_after`、`delete_block` 和 `update_table_cell` 六类操作。
- Oracle：
  - 每类 op 都能产出正确的新快照和 `changedBlocks` 摘要。
  - 多操作顺序执行后，结果结构仍能继续被后续工具消费。
- Not：不验证 `human` 的 op 选择策略。

#### `docx-format-variants-contract`

- 用例名称：`docx-format-variants-contract`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 docx 各类格式 block 的读取与修改契约。
- Why：不同 block 类型常常只在各自路径上暴露 bug。
- How：构造同时包含 `paragraph`、`heading(style)`、`table` 和 `table_cell` 的 fixture docx，覆盖读取、定位和修改。
- Oracle：
  - 各类 block 都能被稳定识别、返回和修改。
  - 表格和单元格修改不会破坏其他 block 的结构。
- Not：不验证 run 级混合格式保留。

#### `docx-mixed-format-preservation`

- 用例名称：`docx-mixed-format-preservation`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证混合格式文本在编辑后的保留与更新。
- Why：run 级样式最容易在修改过程中丢失。
- How：构造包含 `bold / italic / underline / color` 的段落和表格单元格，执行修改后生成 preview。
- Oracle：
  - 未修改部分的 run 样式仍被保留。
  - 修改目标在 preview 中按预期呈现，不出现整段样式塌陷。
- Not：不验证最终用户审阅交互。

#### `docx-review-aware-open-and-continue-edit`

- 用例名称：`docx-review-aware-open-and-continue-edit`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证存在 active review 时，`docx_open` 会基于最新 effective draft 打开并继续编辑，而不是退回源文件。
- Why：同文件多轮未提交修改能否形成正确累计差异，前提就是工具层继续编辑的是最新草稿。
- How：准备同一路径的源 docx 与已累计修改的 effective draft，通过 `resolveDocxOpenTarget` 把 `docx_open` 指向 effective draft；随后调用 `docx_search` 或 `docx_get_block` 校验读取结果，再执行 `docx_apply_ops -> docx_validate`。
- Oracle：
  - `open` 后读取到的是 latest draft 内容，而不是源文件旧内容。
  - `apply_ops` 后的新快照保留前一轮草稿修改，并只叠加本轮 delta。
  - `validate` 通过，且工具仍跟踪原始 `sourcePath` 作为后续落盘目标。
- Not：不验证 review UI、确认替换源文件或 anchor 导航。

#### `docx-history-and-rollback`

- 用例名称：`docx-history-and-rollback`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证快照历史查询与回滚能力，包括多轮继续编辑后的撤销。
- Why：复杂编辑任务必须具备可回退能力，且撤销不能误伤磁盘源文件。
- How：执行多轮 `apply_ops` 后调用 `docx_get_history`，同时覆盖按 `steps` 回滚和按 `targetDocId` 回滚，再做一次 `validate` 并校验源文件磁盘内容未变。
- Oracle：
  - 历史链可追溯到祖先快照。
  - 回滚后当前 `docId` 回到目标祖先，且结构仍然有效。
  - 回滚只影响当前 run 内草稿快照，不会恢复或改写磁盘源文件。
- Not：不验证 review 的放弃或确认替换。

#### `docx-precondition-guard`

- 用例名称：`docx-precondition-guard`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证未 `open` 或无效 `docId` 时的前置保护。
- Why：这是最基础也最常见的工具异常入口。
- How：在不 `open` 的情况下直接调用 `docx_outline`、`docx_search`、`docx_apply_ops`、`docx_validate`，并覆盖无效 `docId`。
- Oracle：
  - 工具返回明确失败，不生成新快照。
  - 当前 run 状态不被污染，也不会误落盘。
- Not：不验证上层重试或纠偏。

#### `docx-save-overwrite-approval`

- 用例名称：`docx-save-overwrite-approval`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证保存到新路径、覆盖已有文件和审批边界。
- Why：落盘是 docx 工具链里风险最高的动作。
- How：先生成修改后的新快照，再分别覆盖“保存到新路径”“覆盖已有文件且 `overwrite=true`”“审批通过”和“审批拒绝”。
- Oracle：
  - 新建保存返回 `created`，覆盖保存触发审批。
  - 审批拒绝后，磁盘上原文件不被改写。
- Not：不验证 workbench 审批 UI，也不验证 review 的“确认替换 / 确认创建”；这些行为由 `workbench/review` 覆盖。

#### 6.1.2 `kb`

#### `kb-document-discovery-contract`

- 用例名称：`kb-document-discovery-contract`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `kb_list_documents` 的列表、过滤和范围收敛契约。
- Why：`kb-document-discovery` 这个 skill 不能缺失直接工具覆盖。
- How：准备多份知识文档和 `selectedDocumentIds`，调用 `kb_list_documents` 覆盖无过滤、关键词过滤和指定文档范围。
- Oracle：
  - 只返回允许范围内的文档，结果字段可直接供上层消费。
  - 列表为空和列表非空两类结果都稳定可断言。
- Not：不验证最终问答内容。

#### `kb-evidence-search-family-contract`

- 用例名称：`kb-evidence-search-family-contract`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `kb_hybrid_search_chunks`、`kb_vector_search_chunks` 和 `kb_fts_search_chunks` 三个工具的统一检索契约。
- Why：`kb-evidence-query` 下的每个工具都必须有正式 case 显式调用。
- How：对同一份 fixture 数据分别调用三种检索工具，覆盖普通范围和显式 `documentIds` 范围。
- Oracle：
  - 三种检索都返回稳定 `rows` 结构。
  - 三种检索都遵守文档范围约束，不越出当前选中资料范围。
- Not：不比较三种检索的召回优劣。

#### 6.1.3 `terminal`

#### `terminal-directory-inspection-readonly`

- 用例名称：`terminal-directory-inspection-readonly`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证目录与文件检查类只读命令的基础契约。
- Why：查询目录下文件是 terminal 最高频的基础场景之一。
- How：覆盖 `ls`、`find`、`pwd`、`stat` 或 `wc` 等只读命令。
- Oracle：
  - 命令成功执行且不需要审批。
  - 输出能稳定供后续推理消费，不错误识别为 mutating。
- Not：不验证写文件。

#### `terminal-text-search-readonly`

- 用例名称：`terminal-text-search-readonly`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证代码和文本搜索类命令的只读契约。
- Why：`rg / grep` 是 AI 编程工具极高频的基础能力。
- How：覆盖 `rg` 与 `grep` 两类搜索命令，验证普通查询和带路径参数查询。
- Oracle：
  - 搜索结果正确返回，且命令仍判定为只读。
  - 路径检查不允许搜索出 workspace 边界。
- Not：不验证复杂 shell 管道。

#### `terminal-inline-edit-artifact-contract`

- 用例名称：`terminal-inline-edit-artifact-contract`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证编辑文本类命令的 mutating 判定与 artifact 识别。
- Why：编辑文本指令是 AI 编程和自动化任务中的高频场景。
- How：覆盖一类原地编辑命令和一类生成文件命令，并传入 `expectedArtifacts`。
- Oracle：
  - 命令被识别为 mutating，必要时触发审批。
  - 目标文件被识别为 artifact 并进入结构化结果。
- Not：不验证具体业务文本是否正确改写。

#### `terminal-risk-and-boundary-guard`

- 用例名称：`terminal-risk-and-boundary-guard`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证高风险命令、路径逃逸和 workspace 边界保护。
- Why：terminal 是最容易越界的工具。
- How：覆盖高风险命令、相对路径逃逸、越界绝对路径和审批拒绝路径。
- Oracle：
  - 高风险命令触发审批，不直接执行。
  - 越界路径在执行前被拒绝，不产生副作用。
- Not：不验证用户侧阻塞恢复交互。

#### 6.1.4 `hand`

#### `hand-parallel-safety-contract`

- 用例名称：`hand-parallel-safety-contract`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `hand` 对并行工具批次的安全守卫。
- Why：并行失控会直接污染上层执行结论。
- How：分别构造只读安全批次与 mutating/unsafe 批次，例如 `docx_outline + docx_search` 与 `docx_apply_ops + docx_validate`。
- Oracle：
  - 安全批次会真正执行。
  - 不安全批次不会执行工具，而是写入 `watchHint` 返回 `brain`。
- Not：不验证 `brain` 后续纠偏质量。

#### `hand-tool-limit-and-artifact-merge`

- 用例名称：`hand-tool-limit-and-artifact-merge`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证工具调用上限与 runtime artifact 合并逻辑。
- Why：这是 `hand` 的核心运行态边界。
- How：拉低 `hardActionLimit`，并构造 terminal/docx 多工具结果共同产出 artifact 的场景。
- Oracle：
  - 超限时 `hand` 会写入收敛型 `watchHint`。
  - `runtimeArtifacts` 只在 `hand` 增长，且多个工具结果能正确合并。
- Not：不验证最终 `mouth` 文案。

### 6.2 `human`

#### 6.2.1 `basics`

#### `basic-learning-hand-mouth-smoke`

- 用例名称：`basic-learning-hand-mouth-smoke`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证最基础的 `brain -> learning -> hand -> mouth` 链路。
- Why：应先保证基础代码没有把主链路走断。
- How：使用 `humanReasonOverrides` 固定每一轮决策，显式走过四个部位。
- Oracle：
  - `brain / learning / hand / mouth` 四个部位都被执行。
  - 最终结果成功收束为 `completed`。
- Not：不验证真实模型推理。

#### `basic-watchhint-retry`

- 用例名称：`basic-watchhint-retry`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `watchHint` 触发后会回到 `brain` 再次决策。
- Why：这是 human 收敛和纠偏的基础机制。
- How：分别模拟 `memory_reducer` 和 `hand` 写入 `watchHint` 的路径。
- Oracle：
  - graph 不会中断，而是返回 `brain`。
  - 后续仍能继续推进到稳定结果。
- Not：不验证 live 模型质量。

#### `basic-delivery-mode-contract`

- 用例名称：`basic-delivery-mode-contract`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `user_answer`、`task_handoff` 和 `context_note` 三种 `deliveryMode` 的结果契约。
- Why：`mouth` 是 `human` 与 `director` 之间的稳定交接边界。
- How：分别运行三种模式，固定同一条任务完成路径。
- Oracle：
  - 三种模式都能完成交付。
  - 结果形态满足各自模式约束，不相互混淆。
- Not：不验证 director 的路由判断。

#### `basic-tool-failure-recovery`

- 用例名称：`basic-tool-failure-recovery`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证工具失败后的返回与后续收敛。
- Why：基础异常不能直接把 `human` 执行链打崩。
- How：注入失败的 tool result，再让后续 `brain` 决定继续还是结束。
- Oracle：
  - 失败工具结果能被写回 `lastParallelCallToolResults`。
  - `human` 能继续回到 `brain` 并稳定收口。
- Not：不验证真实模型是否选择最佳补救动作。

#### `basic-brain-memory-write-boundary`

- 用例名称：`basic-brain-memory-write-boundary`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `brainMemory.inside` 只允许由 `brain` 通过 `memoryOps` 修改。
- Why：这是当前架构中最关键的状态边界之一。
- How：运行一轮包含工具调用的任务，分别检查 `hand` 前后与下一轮 `brain` 后的状态。
- Oracle：
  - `hand` 只更新 `lastParallelCallToolResults`、`runtimeArtifacts` 和 trace。
  - `facts / evidences / openQuestions` 只在 `brain` 之后变化。
- Not：不验证最终交付内容。

#### `basic-tool-limit-converge`

- 用例名称：`basic-tool-limit-converge`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证工具调用超限后 `human` 会收敛而不是死循环。
- Why：这是 autonomous execution 防漂移的基础保护。
- How：降低 `hardActionLimit`，并构造多轮连续工具调用。
- Oracle：
  - `hand` 写入超限型 `watchHint`。
  - 后续 `brain` 会转向收敛或结束，而不是继续无限调用。
- Not：不验证 live 模型。

#### 6.2.2 `scenarios`

#### `complex-docx-edit-simulated`

- 用例名称：`complex-docx-edit-simulated`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证复杂 docx 编辑任务的非 live 长链路。
- Why：复杂 docx 编辑是 human 最核心也最易回归的真实任务类型之一。
- How：模拟“长文档 + 多格式 + 多操作 + validate/preview”的单任务编辑场景。
- Oracle：
  - human 能按预期串起 docx 读、写、delivery 工具。
  - 最终交付可稳定完成，并带有可回看的 artifact。
- Not：不验证真实模型决策。

#### `multi-tool-collaboration-simulated`

- 用例名称：`multi-tool-collaboration-simulated`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 human 在单任务里联动多种工具完成任务。
- Why：human 不应只会单工具单步执行。
- How：模拟 `kb_list_documents -> kb_search -> docx_open/search/apply_ops/validate/render_preview` 的任务链。
- Oracle：
  - human 能串联多个 skill 和多个 tool。
  - 中间结果能被后续动作继续消费，不会中途断链。
- Not：不验证 director 编排。

#### `approval-denied-restricted-delivery`

- 用例名称：`approval-denied-restricted-delivery`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证审批拒绝后的任务收敛与受限交付。
- Why：真实任务里审批拒绝一定会发生。
- How：让 `docx_save` 覆盖已有文件或高风险 terminal 命令被拒绝审批。
- Oracle：
  - human 不会重复撞同一拒绝动作。
  - 最终交付明确说明阻塞点、未完成项和当前已得到的结果。
- Not：不验证用户侧恢复交互。

#### 6.2.3 `live`

#### `kb-answer-autonomous-live`

- 用例名称：`kb-answer-autonomous-live`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证真实 AI 调用下的单任务 KB 问答能力。
- Why：这是 `human` 作为单任务执行核心的最基础 live 证明。
- How：使用 live 模型和固定 KB fixture，直接输入自然语言问题，不覆写推理，也不在输入里指定内部检索步骤。
- Oracle：
  - trace 至少覆盖 `brain` 与一次真实工具调用。
  - 最终结果为 `completed`，且消费了本地资料结果。
- Not：不验证 director 路由。

#### `docx-edit-autonomous-live`

- 用例名称：`docx-edit-autonomous-live`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证真实 AI 调用下的简单 docx 编辑能力。
- Why：这是最直接对应真实用户编辑诉求的 live case。
- How：提供简单 docx，直接给自然语言编辑目标和交付要求，如“修改某段并给 preview”，不在输入里指定内部工具顺序。
- Oracle：
  - 真实出现 docx 读取、定位、写入和至少一个 delivery 工具调用。
  - 任务完成并产出可回看的 artifact 或稳定交付说明。
- Not：不验证复杂多任务拆分。

#### `long-task-multi-tool-live`

- 用例名称：`long-task-multi-tool-live`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证真实 AI 调用下的长任务流程和多工具联动。
- Why：human 的智能度不能只靠短任务证明。
- How：使用 live 模型执行“先查资料，再改 docx，再给出交付说明”的长任务，不在输入里限制每轮工具数或固定步骤序。
- Oracle：
  - 真实出现多轮 `brain / hand` 交替和多工具联动。
  - 任务最终稳定完成，不因长链路而直接漂移或中断。
- Not：不对最终文案做强文本断言。

### 6.3 `director`

#### 6.3.1 `basics`

#### `basic-direct-path-smoke`

- 用例名称：`basic-direct-path-smoke`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 direct 路径的基础 graph 链路。
- Why：这是 `human-first` 默认路径，必须最先稳定。
- How：固定 `intent=direct_human` 并 stub direct human 输出。
- Oracle：
  - `director_intent -> director_direct_human_exec -> director_complete` 能完整走通。
  - 最终 run 进入稳定完成态。
- Not：不验证 live 路由质量。

#### `basic-context-path-smoke`

- 用例名称：`basic-context-path-smoke`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 context 路径的基础链路。
- Why：补上下文路径一旦断掉，复杂任务会直接走偏。
- How：固定 `intent=need_context`，stub context human 输出，再让第二轮 intent 继续后续路径。
- Oracle：
  - `contextRounds`、`contextEvidence` 和 `contextObjective` 更新正确。
  - graph 能从 `director_context_human` 正常回到 `director_intent`。
- Not：不验证 evidence 质量。

#### `basic-plan-path-smoke`

- 用例名称：`basic-plan-path-smoke`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 plan 路径的基础 graph 链路。
- Why：复杂任务主干应先证明可走通，再谈质量。
- How：固定 `intent=to_plan`，stub planner 输出和各子任务 human 输出。
- Oracle：
  - `director_plan -> director_plan_exec -> director_synthesis_human -> director_complete` 能完整走通。
  - 计划结果、任务执行结果和最终交付都能稳定回写。
- Not：不验证 live 模型规划质量。

#### `basic-complete-terminal-state`

- 用例名称：`basic-complete-terminal-state`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `director_complete` 的终态收尾规则。
- Why：终态错误会污染整条 run 生命周期。
- How：分别从 `running`、`completed`、`failed` 和 `cancelled` 输入 complete 节点。
- Oracle：
  - 正常完成路径收束为 `completed`。
  - 已经是 `failed / cancelled / completed` 的 run 不被二次覆盖。
- Not：不验证业务内容。

#### 6.3.2 `contracts`

#### `context-evidence-reuse-contract`

- 用例名称：`context-evidence-reuse-contract`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 context human 输出只提取可复用证据，不回写整段原文。
- Why：这决定了后续 `intent / plan / synthesis` 吃到的是证据还是噪音。
- How：构造同时包含高价值证据和解释性废话的 `context_note`。
- Oracle：
  - 只高价值证据进入 `contextEvidence`，并按去重逻辑合并。
  - `contextObjective` 被清空，stage 返回 `director_intent`。
- Not：不验证 live 模型生成质量。

#### `intent-context-round-cap-contract`

- 用例名称：`intent-context-round-cap-contract`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 context 轮次到上限后的强制转 plan 行为。
- Why：否则系统可能卡死在补上下文循环。
- How：把 `contextRounds` 置到上限，再输入仍需额外上下文或规划的任务。
- Oracle：
  - 不再进入 `director_context_human`。
  - 下一跳直接进入 `director_plan`。
- Not：不验证 plan 质量。

#### `plan-task-shape-contract`

- 用例名称：`plan-task-shape-contract`
- 测试类型：`backend`
- 实现状态：`部分实现`
- What：验证 planner 产出的任务都能交给单个 `human` 闭环执行。
- Why：坏计划会直接拖垮后续执行。
- How：对 planner 的结构化输出做正反两类样例校验，包含空任务列表和不可执行任务。
- Oracle：
  - 每个 task 都包含动作、对象和完成判据。
  - 不会把“最终总结”写成业务 task；空或不可执行计划会 fail-fast。
- Not：不验证 task 内部求解。

#### `plan-exec-serial-merge-contract`

- 用例名称：`plan-exec-serial-merge-contract`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `director_plan_exec` 的串行派发、当前任务回写和 artifacts 合并。
- Why：这是复杂任务最终能否稳定收口的核心骨架。
- How：stub 多个任务输出，部分任务带 artifact，再进入 synthesis。
- Oracle：
  - 任务严格按游标串行执行，且只更新当前任务。
  - `finalArtifacts` 正确合并计划阶段与 synthesis 阶段结果。
- Not：不验证 live 规划判断。

#### 6.3.3 `live`

#### `simple-task-human-first-live`

- 用例名称：`simple-task-human-first-live`
- 测试类型：`backend`
- 实现状态：`待调整`
- What：验证普通任务在真实 AI 调用下仍然走 `human-first`。
- Why：这是当前架构的首要原则。
- How：使用 live 模型运行单任务 KB 问答或单文档总结类自然请求，不在输入中提前指定“不要 plan”或固定工具路径。
- Oracle：
  - run 保持低编排行为，默认由一个 direct human 完成单任务交付。
  - 不进入 `context / plan`，或至少不能出现无必要的增强链路。
- Not：不验证复杂任务拆分。

#### `complex-task-plan-and-synthesis-live`

- 用例名称：`complex-task-plan-and-synthesis-live`
- 测试类型：`backend`
- 实现状态：`待调整`
- What：验证复杂任务在真实 AI 调用下进入增强路径并最终完成真实任务。
- Why：这是 `director` 编排能力最关键的实战验证。
- How：使用 live strong model 执行“先取资料事实，再改 docx，最后综合交付”的复杂任务，不在输入中写死 plan 条数或阶段脚本。
- Oracle：
  - run 不走 `direct_human`，而是进入增强路径并完成关键任务链。
  - 最终由 synthesis human 完成交付并正确合并 plan 阶段 artifacts。
- Not：不对最终文案做精确文本断言。
