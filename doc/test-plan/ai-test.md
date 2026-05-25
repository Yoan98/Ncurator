# NCurator-Desktop AI 测试计划

## 1. 总体目标

- 本计划用于定义 AI 域正式测试的范围与领域特有规则。
- 正式 / temp 准入、runner、raw logs 与正式 case 共享字段，统一遵循 `doc/test.md`。
- AI 正式测试只围绕两类稳定对象治理：
  1. `tool`
  2. `human`

## 2. 执行摘要

### 2.1 按 Suite / 分类汇总

- `tool / docx`
  - 通过率：`43 / 43`
  - 检测时间：`2026-04-29 16:39:22 +08:00`
- `tool / kb`
  - 通过率：`2 / 2`
  - 检测时间：`2026-04-16 16:16:05 +08:00`
- `tool / terminal`
  - 通过率：`4 / 4`
  - 检测时间：`2026-04-16 16:16:11 +08:00`
- `tool / hand`
  - 通过率：`4 / 4`
  - 检测时间：`2026-04-16 16:16:05 +08:00`
- `human / mock-llm`
  - 通过率：`15 / 15`
  - 检测时间：`2026-04-29 17:02:09 +08:00`
- `human / live`
  - 通过率：`7 / 7`
  - 检测时间：`2026-05-22 15:46:21 +08:00`
  - 样例评分：
    - `human-risk-report-draft-live`：`8.6 / 10`
      - `依据：已完成多源资料取证、参考上周风格并新建周报草稿；风险主线、负责人和后续动作都已对齐真实诉求，整体已是可用待发稿。当前主要问题转为成稿过程偏慢，且正文仍带少量测试友好的说明性痕迹。`
    - `human-docx-cause-remedy-reading-live`：`8.4 / 10`
      - `依据：已真实读取两份已选课件，过拟合与反走样的定义、成因和处理思路基本答对；对课件未明确写出的处理方法也保持了保守表达。当前主要问题是 formal 断言曾过度绑定 `docx_search` 路径，而不是最终答复质量不足。`
    - `human-docx-cross-source-summary-draft-live`：`8.8 / 10`
      - `依据：已真实读取两份已选课件，自主创建新的总结 docx，并把两份资料中的核心概念按“关键概念 / 出现原因 / 常见处理方式”整理为可直接复习的草稿文件。整体已满足用户“生成给同学复习用的 Word 总结文件”的真实诉求；当前主要不足是个别条目仍偏归纳扩写，离最克制的贴源摘要还有少量距离。`
    - `human-conversation-memory-multi-run-live`：`9.0 / 10`
      - `依据：真实双 run 下 conversation summary 与 recent turns 已成功承接，第二轮 brain 明确带回第一轮形成的风险主线、负责人分工、待确认项和后续动作；当前更合理的正式口径应聚焦“总结是否有效影响后续”，而不是把 Alice / Bob 的单点排序绑定为唯一正确答案。`
    - `human-context-compaction-natural-trigger-live`：`8.7 / 10`
      - `依据：已在 `15_000` window 下真实触发 compaction，压缩摘要、后续 `<compactions>` 与真实草稿读回都保持了风险主线、负责人和后续动作等核心事实；最新一轮 `mouth` 也已守住真实文件名。当前主要问题已从“任务未完成”转为“旧断言过度绑定 mouth 话术”，按任务完成度应评为高分通过样例。`

## 3. Suite 设计

### 3.1 `tool`

- `tool` 只验证真实生产工具调用，不允许 fake。
- 目标：验证 tool 与 `hand` 工具执行守卫在真实生产代码下的输入输出是否正常、合理。
- 约束：必须真实调用生产工具、真实 store、真实 review service、真实 artifact 流。
- 禁止：fake `documentsStore`、fake `embeddingService`、fake `resolveDocxOpenTarget`、fake tool result。

### 3.2 `human`

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

## 4. 领域特有规则

### 4.1 Harness 规则

- AI 正式 backend case 必须使用生产 `createAiRunContext` 作为唯一正式 runtime 入口。
- formal harness 必须使用真实 `StorageService / DocumentsStore / ChatStore / FileReviewStore / LlmConfigStore / FileReviewService / EmbeddingService`。
- `mock-llm` 统一通过 scripted LLM driver 固定 LLM 输出；除 LLM 输出外，其余全部真实。
- `live` 统一通过真实 `LlmConfigStore` 注入 live 配置，并走生产统一 LLM executor。
- 凡是会进入 `human` 的正式 run，必须在进入 `human` 前完成 embedding 基础服务 preflight；不允许把 embedding 初始化推迟到某个工具调用时才暴露。
- KB fixture 必须走真实导入、真实索引、真实检索。
- embedding 模型缺失时，harness 应优先通过真实生产下载链自动检查并下载，不得引入测试专用 embedding 替身。
- 旧式 fake API 一律不得进入 formal harness；一次性排查如果确实需要 fake，只允许写入 `tests/temp/**`。

### 4.2 `mock-llm` 与 `live` 设计口径

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
- 每次 formal `human / live` 执行完成后，除更新通过率、检测时间、备注外，还要在执行摘要中补充本轮已执行样例的完成度评分及简短依据。

### 4.3 目录与命令

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

## 5. 正式 Case 清单

### 5.1 `tool`


#### `docx`

##### `docx-minimal-edit-flow`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证最小 docx 打开、定位、编辑与继续读取链路。
- Why：这是 docx 工具链最基础的真实生产调用闭环。
- How：对 fixture docx 真实执行 `docx_search -> docx_read_blocks -> docx_text_edit -> docx_search -> docx_read_blocks`。
- Oracle：返回稳定 `currentRevisionRef/previousRevisionRef`，只目标 block 进入 `changedBlocks`，且修改后的结果可继续被读取工具消费。
- Not：不验证 `human` 的工具选择。

##### `docx-create-then-open-and-edit`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `docx_create` 新建的 docx 能立刻进入 `outline / read / edit` 主链。
- Why：cross-source summary 这类“先生成新 Word 文件再写内容”的真实场景，底层必须先守住 create 契约。
- How：真实执行 `docx_create -> docx_outline -> docx_read_blocks -> docx_paragraph_edit -> docx_search`。
- Oracle：create-target 结果返回稳定 `sourcePath / currentRevisionRef / created=true`；新文档可被继续读取；后续编辑会生成新 revision，且新内容可继续被搜索命中；正式目标路径在 commit 前不存在。
- Not：不验证 human 是否会选择 create。

##### `docx-create-existing-path-guard`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `docx_create` 不会覆盖已存在的目标路径。
- Why：create 能力一旦允许覆盖原文件，就会破坏 docx review / commit 的基本安全边界。
- How：先写入一份真实 docx，再对同一路径执行 `docx_create`。
- Oracle：返回 `invalid_input`；原文件 bytes 不变；当前 run 不产生新的 docx session。
- Not：不验证 UI 层如何展示报错。

##### `docx-create-with-content-produces-review`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证仅执行 `docx_create(blocks=...)` 也能进入 review 主链并产出待确认稿。
- Why：真实模型很可能在 create 时一次写完内容，这条能力必须被正式保护，不能强依赖后续 edit。
- How：真实执行 `docx_create` 并直接 `finalizeDocxReviewRun`。
- Oracle：生成 `FileReviewDetail` 与 working/review/committed artifacts；review `output_operation=created`；正式目标路径在 commit 前不存在。

##### `docx-create-commit-creates-target-file`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 create-target review 只在 commit 成功后正式创建目标文件。
- Why：这是 create-target 语义与 PRD 的核心边界。
- How：真实执行 `docx_create -> finalize review -> persist review -> commitReview`。
- Oracle：commit 成功；commit result `operation=created`；commit 前目标路径不存在，commit 后目标路径存在。

##### `docx-create-discard-does-not-create-target-file`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 discard create-target review 不会创建正式目标文件。
- Why：放弃修改不能留下误创建的产物。
- How：真实执行 `docx_create -> finalize review -> persist review -> discardReview`。
- Oracle：discard 成功；目标路径继续不存在。

##### `docx-create-commit-conflict-when-target-appears-before-commit`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 create-target review 在目标路径被外部抢占创建后会触发 freshness conflict。
- Why：新建文件的提交门禁必须显式防止“旧审阅稿覆盖新外部文件”。
- How：真实执行 `docx_create -> finalize review -> persist review`，随后外部创建同名目标文件，再执行 `validateCommit / commitReview`。
- Oracle：`validateCommit` 返回 `source_changed`；`commitReview` 失败并把 review 标记为 `conflicted`。

##### `docx-large-document-navigation`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证长文档下的读取、定位和局部精读能力。
- Why：长文档最容易暴露基础定位问题。
- How：对高 block 数 fixture 真实调用 `docx_outline(ranges=block_index) / docx_search / docx_read_blocks`。
- Oracle：长文档下仍返回稳定 `blockId/blockIndex` 信息，且能定位并精读目标 block。
- Not：不验证编辑落盘。

##### `docx-outline-read-search-do-not-create-replay-session`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证纯读 docx 工具首次访问只创建 read session，不会提前创建 replay session。
- Why：这是 read/write session 分层重构的根契约，破坏后会让只读场景重新回到高内存 replay 路径。
- How：真实执行 `docx_outline -> docx_read_blocks -> docx_search`，检查 runtime session 状态。
- Oracle：三次调用都成功；`readSessionCount=1`；`replaySessionCount=0`。
- Not：不验证编辑链路。

##### `docx-read-then-edit-upgrades-to-replay-session`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证纯读后首次编辑会升级到 replay session，并释放旧 read session。
- Why：升级动作必须把只读缓存收口掉，否则同一路径会长期保留两套运行态，违背本次重构目标。
- How：真实执行 `docx_outline -> docx_paragraph_edit -> docx_search`，检查 runtime session 状态。
- Oracle：编辑成功；后续搜索可命中新文本；`readSessionCount=0`；`replaySessionCount=1`。
- Not：不验证 review/commit。

##### `docx-read-then-history-upgrades-to-replay-session`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `docx_history` 在纯读场景下会升级到 replay session，但不会伪造额外 revision。
- Why：`docx_history` 属于 revision world，需要统一走 replay 语义，同时保持初始历史真实。
- How：真实执行 `docx_outline -> docx_history`，检查 runtime session 状态与返回 revisions。
- Oracle：history 成功；只返回初始 `v1`；`readSessionCount=0`；`replaySessionCount=1`。
- Not：不验证 rollback。

##### `docx-read-then-edit-preserves-long-document-tail`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证长文档在 read 分页后升级到 replay session 时不会丢失尾部 block。
- Why：如果 replay snapshot 仍走固定 block 上限，read world 与 write world 会在长文档上出现静默分裂。
- How：先用 `docx_outline(ranges=block_index)` 读取 5000 之后的尾部范围，再对尾部 block 执行真实 `docx_paragraph_edit` 与 `docx_search`。
- Oracle：尾部范围返回正确 `blockIndex`；尾部 block 编辑成功；后续搜索可命中新文本；`readSessionCount=0`；`replaySessionCount=1`。
- Not：不验证 AI 的读取策略。

##### `docx-search-unicode-normalization-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `docx_search` 会做兼容字形归一，能用普通查询或 regex 命中兼容字形文本。
- Why：docx 文本里常见兼容字形，如果检索不归一，AI 会把“文档已写”误判成“文档未写”。
- How：写入包含兼容字形文本的真实 docx，再分别执行 `docx_search(literal)` 与 `docx_search(regex)`。
- Oracle：普通查询可命中兼容字形 block，且返回稳定 blockId。
- Not：不比较字符偏移是否完全映射回原始编码位置。

##### `docx-search-scope-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `docx_search` 默认搜索当前文档全部 block，且 `docx_text_edit.blockIds` 只在当前文档内进一步缩圈。
- Why：这是 docx 搜索的核心契约，必须长期稳定，避免 prompt 与工具行为不一致。
- How：对同一 doc 先执行默认搜索，再通过限定编辑范围验证后续搜索结果只影响指定 block。
- Oracle：默认搜索可命中文档内多个 block，限定编辑后只修改指定 block 范围内的结果。
- Not：不验证 human 该如何选择何时缩圈。

##### `docx-search-literal-alias-fallback`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `docx_search(literal)` 在 0 命中时会触发有限 alias fallback。
- Why：术语轻微变体是 docx 场景里的高频真实问题，必须由工具契约稳定承接。
- How：写入只包含“过度拟合”的真实 docx，再以“过拟合”执行 `docx_search(literal)`。
- Oracle：搜索结果命中目标 block，且显式返回 `effectiveQuery=过度拟合` 与 `appliedAliases`。
- Not：不引入通用大词库或无限 rewrite。

##### `docx-search-regex-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `docx_search(regex)` 可用，且非法 regex 会稳定报错。
- Why：regex 是 AI 换词失败后的重要兜底能力，必须守住输入契约。
- How：对真实 docx 执行合法 regex 搜索与非法 regex 搜索。
- Oracle：合法 regex 正常命中并返回 offsets；非法 regex 返回 `invalid_input`。
- Not：不比较不同 regex 引擎的高级语义差异。

##### `docx-search-semantic-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `docx_search(semantic)` 能返回相关 block，且结果带 score。
- Why：semantic 是换词失败后的召回增强能力，必须有正式契约保护。
- How：在 embedding ready 前提下，对真实 docx 执行 `docx_search(mode=semantic)`。
- Oracle：至少返回一个相关 block，且结果显式包含 `score`。
- Not：不比较召回排序的全局最优性。

##### `docx-read-range-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `docx_read_blocks(range=block_index)` 会返回连续区间 blocks。
- Why：这是“搜索 -> 精读”工作流的核心读取契约，必须长期稳定。
- How：先通过真实 `docx_outline` 定位起止 block，再执行区间 `docx_read_blocks`。
- Oracle：返回结果按文档顺序覆盖闭区间，且详细块都带 `blockId/blockIndex`。
- Not：不验证 AI 何时该扩大片段范围。

##### `docx-outline-pagination-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `docx_outline(ranges=block_index)` 可以读取长文档后半段。
- Why：如果只能重复看前几百块，AI 很容易误判“文档没写”。
- How：对长文档执行带 `block_index` range 的真实 `docx_outline`。
- Oracle：返回结果从指定 `blockIndex` 开始，并按闭区间返回目标块。
- Not：不验证 UI 层如何呈现分页。

##### `docx-auto-open-no-fake-failure`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 AI-facing docx 读取工具首次自动 open 时不再先发假失败结果。
- Why：同一 toolCallId “先失败后成功”的噪音会误导 brain 对工具稳定性的判断。
- How：对未预先打开的真实 docx 直接执行 `docx_search`，检查事件流中的 tool result。
- Oracle：同一次调用只返回一次成功结果，不出现 `sourcePath must be opened before ...`。
- Not：不验证内部显式 require 场景。

##### `docx-outline-truncation-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `docx_outline` 结果超出 AI-facing 体积门禁时返回 `result_too_large`。
- Why：长文档 outline 不能依赖 AI-controlled 数量上限截断，必须提示 brain 缩小范围。
- How：对长文档执行过大的真实 `docx_outline(ranges=...)`，检查返回 code 与 decision hint。
- Oracle：返回 `result_too_large`，且 decision hint 包含 `totalBlockCount/estimatedTokens/limit/suggestedRanges`。
- Not：不验证 human 是否一定继续读取后续内容。

##### `docx-complex-ops-batch`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证多类复杂编辑操作的真实执行契约。
- Why：复杂写入是 docx 工具层高风险区。
- How：覆盖 `docx_text_edit / docx_delete / docx_paragraph_edit(insert_before/insert_after) / docx_heading_edit / docx_table_edit(update_cell)`。
- Oracle：各类 op 都能产生可继续消费的新修订与 `changedBlocks`。
- Not：不验证上层 op 选择策略。

##### `docx-format-variants-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 paragraph、heading、table、table_cell 的读取与修改契约。
- Why：不同 block 类型最容易只在各自路径暴露问题。
- How：使用混合 block fixture 真实执行读取、定位与修改。
- Oracle：各类 block 都可稳定识别和修改，不破坏其余结构。
- Not：不验证 run 级样式保留。

##### `docx-positioned-layout-read-only-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证命中 positioned block 时，docx 写工具会统一拒绝自动编辑。
- Why：复杂定位排版 docx 在 preview/review 语义下即使只是原地改字也可能因修订标记叠加而错位，这条 case 要长期守住 `positioned = read-only` 的能力边界。
- How：对真实 `图形学.docx` 执行 `docx_outline` 定位一个 positioned block，再分别尝试 `docx_paragraph_edit`、`docx_text_edit`、`docx_text_style_edit` 与 `docx_table_edit(insert_after)`。
- Oracle：四类写入都返回 `invalid_input`；错误信息稳定包含“当前命中复杂定位排版区域，暂不支持自动编辑”；不产生新的当前修订。
- Not：不验证 human 的回退话术，也不验证 positioned 文档中的读取质量。

##### `docx-insert-after-preserves-anchor-xml`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证纯 `insert_after` 不会改写 anchor 段落文本与 run 格式。
- Why：结构插入的底层实现若重写 anchor，会制造伪样式漂移并污染 review 语义。
- How：构造带 mixed-format run 的 anchor 段落，执行 `docx_paragraph_edit(insert_after)`，再读取同一 anchor。
- Oracle：anchor 文本保持不变，run 列表逐项一致，changedBlocks 只记录 `insert_after`。
- Not：不验证 review artifact。

##### `docx-created-blocks-resolve-inserted-range-not-shifted-tail`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `createdBlocks` 依据插入区间解析，而不是依据前后 `blockId` 集合差。
- Why：当前 `blockId` 由 `blockIndex` 派生，结构插入后下游 block 会整体漂移，集合差会天然误认旧块。
- How：在 anchor 后插入一个段落，再检查 `createdBlocks` 与插入后 outline 的对应关系。
- Oracle：`createdBlocks` 只命中新插入段落，不包含下游旧段落。
- Not：不验证 table cell 创建。

##### `docx-review-insert-does-not-duplicate-downstream-blocks`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 review artifact 中插入后下游旧块不会重复、错位。
- Why：结构插入后的 replay 重绑若把新块误认成旧块，会直接造成审阅稿重复旧段落。
- How：对真实 docx 执行“插段落 + 插表格”，finalize review 后直接检查 review artifact 的 outline 顺序。
- Oracle：下游旧段落只出现一次，新增段落与表格保持稳定顺序。
- Not：不验证 delete/replace 语义。

##### `docx-inserted-table-created-blocks-include-table-and-cells`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证表格插入后的 `createdBlocks` 同时包含 table 与 table_cell。
- Why：review replay 需要完整的新建结构元信息，否则插入表格容易只落 body block，缺少 cell 级引用。
- How：执行一次 `docx_table_edit(insert_after)`，直接检查 mutation result 的 `createdBlocks`。
- Oracle：返回 1 个 `table` 和全部对应的 `table_cell`。
- Not：不验证 review artifact。

##### `docx-mixed-format-preservation`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证混合格式文本在编辑后的样式保留。
- Why：run 级样式保留是 docx 修改的重要风险。
- How：对包含 `bold / italic / underline / color` 的真实 docx 执行编辑，再通过 block 读取验证样式结果。
- Oracle：未修改部分样式保留，修改目标样式正确。
- Not：不验证 review UI。

##### `docx-review-aware-open-and-continue-edit`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 active review 下 docx 自动 open 会基于 latest working draft 继续编辑。
- Why：多轮未确认修改能否累计，依赖 review-aware open 的真实行为。
- How：通过真实 `FileReviewStore + FileReviewService` seed active review，再执行 `docx_read_blocks / docx_text_edit`。
- Oracle：读取内容来自最新草稿而非源文件，新增修改只叠加当前 delta。
- Not：不验证 review UI 与最终确认替换。

##### `docx-working-draft-hides-deleted-content`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证删除后的内容不会再出现在 AI 继续读取的 working draft 中。
- Why：working draft 是 AI 的当前有效视图，必须隐藏 deleted 内容，但不能丢失相邻未修改内容。
- How：对真实 docx 执行删除，再继续执行 `docx_search` 验证 deleted 文本消失、其余文本仍可读。
- Oracle：deleted 内容命中为 0，未修改内容仍稳定命中。
- Not：不验证 review 展示层。

#### `hand`

##### `hand-serial-docx-chain`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 hand 在 `serial` 模式下会按顺序执行 `docx` 写入与后续读取。
- Why：这是 hand 承接 docx 写工具返回复核信息后继续执行后续读取的最小基线。
- How：真实执行 `docx_text_edit -> docx_read_blocks`。
- Oracle：工具结果按顺序成功返回，写工具结果包含 `postWriteReadback.regions`，且不产生旧写后阻断 decision hint。
- Not：不验证复杂定位恢复。

##### `hand-docx-single-file-multi-write-invalid`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证同一 `sourcePath` 一轮 hand 中出现第 2 次 docx 写时，会在执行前被判为非法 plan。
- Why：单文件多步写兼容逻辑已移除，正式约束改为“同文件每轮最多一次写”。
- How：构造同一文件上的 `docx_heading_edit -> docx_paragraph_edit` serial plan。
- Oracle：返回 `hand_plan_invalid`，`reason=docx_single_file_write_limit_exceeded`，并带稳定 `decisionHint`、违规工具名和触发文件。
- Not：不验证后续轮次如何改写计划。

##### `hand-docx-multi-file-single-write-allowed`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证一轮 hand 内对不同文件各写一次仍允许通过。
- Why：执行模型只收缩“同文件多写”，不影响多文件 batch 的效率收益。
- How：真实执行 `fileA:docx_text_edit -> fileB:docx_text_edit`。
- Oracle：两次写都成功，两个文件各自推进 revision，且最新 outline 可读到更新后的内容。
- Not：不验证跨文件更多组合。

##### `hand-docx-same-file-read-write-read-allowed`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证同一文件在一轮中执行 `read -> write -> read` 仍允许通过。
- Why：本次限制只针对“同一文件多次写”，不应误伤围绕单次写的读回确认流程。
- How：真实执行 `docx_outline -> docx_text_edit -> docx_read_blocks`。
- Oracle：三步都成功，最后一次读取能看到写后内容，且不返回 `hand_plan_invalid`。
- Not：不验证额外的多次写。

##### `docx-write-then-outline-percent-sees-new-block`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 docx 写后立刻使用 `docx_outline(percent)` 读取当前 working draft 时，能看到新增块。
- Why：这直接覆盖 replay session stats 未同步导致 percent 漏块的回归问题。
- How：真实执行一次 `docx_heading_edit`，随后立刻用 `ranges=[{type:'percent',fromPercent:0,toPercent:100}]` 读取。
- Oracle：outline 返回新增块，且 replay session 的 `stats.blockCount` 等于当前 active revision 的真实块数。
- Not：不验证更细的分页策略。

##### `docx-replay-stats-track-active-revision`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 replay session 暴露的 `stats` 会随着 revision 前进持续对齐当前 active snapshot。
- Why：`docx_outline(percent)`、写后读回与后续只读工具都依赖这份 stats 一致性。
- How：真实执行“插入一段 -> 再改写该段”，分别检查 `registerRevision` 后 replay session 的 `stats.blockCount`。
- Oracle：每次 revision 之后 `stats.blockCount` 都与当前真实 working draft 一致，不残留旧版本统计。
- Not：不验证 imageCount 等与 replay snapshot 无关的计数来源。

##### `docx-multi-round-created-block-edit`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证第 2/3 轮可继续编辑第 1 轮新增的段落和表格单元格。
- Why：cumulative replay 的核心价值就是多轮编辑可持续作用于新增结构。
- How：真实执行“插入段落 -> 改写新增段落 -> 插入表格 -> 更新新增 cell”。
- Oracle：新增段落与新增 cell 都可继续被定位和修改，最新 working draft 只暴露最新有效内容。
- Not：不验证 live 模型如何规划多轮编辑。

##### `docx-review-artifact-projection`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 finalize review 后同时生成 review artifact 与 working artifact，且 review artifact 使用稳定自定义样式与表格布局。
- Why：审阅稿格式稳定性是 docx review 的核心工程约束。
- How：真实执行结构化编辑并 finalize review，再直接检查生成的 review docx XML。
- Oracle：review artifact 不包含原生 `w:ins/w:del`，且插入表格带 `tblGrid / tblLayout / tcW`。
- Not：不验证 live 渲染外观。

##### `docx-review-commit-uses-working-artifact`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证提交审阅稿时按 committed view 语义落盘，而不是以 review artifact 或 working artifact 直接覆盖源文件。
- Why：最终落盘必须来自 committed view，不能把审阅标记或仅供 AI 继续编辑的 working draft 直接写回源文件。
- How：seed 一条 active review，再让 review / working / committed artifact 指向不同内容后执行 commit。
- Oracle：提交后 source 文件采用 committed artifact 内容，review-only 与 working-only 内容都不会写回。
- Not：不验证冲突处理。

##### `docx-risk-report-review-commit`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证风险周报场景在 review 生成后，既能产出包含目标修改的待确认稿，也能在 commit 后把最终内容落盘到源 `docx`。
- Why：通用 commit 契约之外，还需要一条贴近真实业务内容的 docx 提交样例，确认 review 到 commit 的整条链路在具体场景里可用。
- How：构造与 live 风险周报 case 相同的模板；通过真实 docx 工具执行两处占位符替换，随后 finalize review，直接检查 review artifact；再执行真实 `commitReview`，检查源文档最终内容。
- Oracle：review artifact 中能读到“待跟进”和“Alice”对应的修改结果；commit 成功后，源模板中两处占位符被最终内容替换，且不再保留 `RISK_TODO / OWNER_TODO`。
- Not：不覆盖 live 模型执行路径，不要求经过 KB 或 terminal。

##### `docx-review-discard-preserves-source`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 discard review 只清理 working/review/committed artifact，不影响 source 文件。
- Why：放弃审阅是非破坏性操作，必须长期稳定。
- How：真实编辑并 finalize review 后执行 discard，再检查 source 与 artifact 状态。
- Oracle：source 内容保持原样，review/working/committed artifact 被清理，review 状态变为 `discarded`。
- Not：不验证提交链路。

##### `docx-review-commit-conflict`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 source freshness 冲突时会拒绝覆盖并把 review 标记为 `conflicted`。
- Why：这是 committed view 落盘前的关键安全门禁。
- How：真实编辑并 finalize review 后，外部改写 source，再执行 `validateCommit / commitReview`。
- Oracle：`validateCommit` 返回 `source_changed`，`commitReview` 失败且 review 状态进入 `conflicted`。
- Not：不验证用户如何解决冲突。

##### `docx-history-and-rollback`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证任务过程内历史查询与回滚能力。
- Why：复杂编辑任务必须可回退。
- How：多轮真实编辑后执行 `docx_history` 与 rollback。
- Oracle：历史链可追溯，回滚只影响当前任务过程中的草稿修订，不改写磁盘源文件。
- Not：不验证 review 放弃 / 确认。

##### `docx-precondition-guard`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证未 `open`、无效 `sourcePath` 或无效修订引用时的前置保护。
- Why：这是工具层最常见的异常入口。
- How：直接调用 `outline / search / apply_ops / rollback` 覆盖非法输入。
- Oracle：返回明确失败，不产生新修订，不污染运行状态。
- Not：不验证上层重试策略。

##### `docx-apply-ops-invalid-snapshot-guard`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `apply_ops` 产出无效 docx 时会被工程内部校验拦截。
- Why：validate 已下沉为工程门禁，必须有正式 case 守住“坏修订不能进入当前草稿”。
- How：对带损坏关系引用的真实 docx 执行 `docx_text_edit` 或对象编辑工具。
- Oracle：`apply_ops` 直接失败，且当前文档会话的修订引用不会推进到无效修订。
- Not：不验证上层如何决定重试或放弃。

#### `kb`

##### `kb-list-documents-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `kb_list_documents` 在当前工作区默认范围内的真实列表、`sourceNameQuery` 文档名过滤与缩圈契约。
- Why：KB 资料发现必须真实调用生产检索存储。
- How：通过真实 `DocumentsStore.addDocument / addChunks` 导入多工作区 fixture 后执行列表查询。
- Oracle：结果默认只包含当前工作区文档，`documentIds` 只做进一步缩圈，空结果与非空结果都稳定可断言。
- Not：不验证问答文案。

##### `kb-evidence-search-family-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `kb_search` 在不同 strategy 下的统一真实检索契约。
- Why：KB tool family 必须显式覆盖每个正式工具。
- How：对多工作区真实 seed 数据分别执行三种检索，并覆盖 `documentIds` 缩圈。
- Oracle：三种检索都返回稳定 `rows`，默认受当前工作区约束，且遵守 `documentIds` 缩圈语义。
- Not：不比较召回优劣。

#### `terminal`

##### `terminal-directory-inspection-readonly`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 AI 可仅通过 `terminal_run` 真实执行目录浏览与文本读取类只读命令。
- Why：这是 terminal 工具最典型的只读路径。
- How：调用 `terminal_run` 执行真实 shell 命令，分别完成目录浏览与文件读取。
- Oracle：返回真实 stdout 片段、退出码与可消费摘要。
- Not：不验证写操作。

##### `terminal-text-search-readonly`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 AI 可仅通过 `terminal_run` 真实执行只读文本搜索命令。
- Why：搜索是 terminal 工具最常见的辅助路径。
- How：调用 `terminal_run` 执行真实 shell 搜索命令。
- Oracle：返回可断言命中信息与正确退出状态。
- Not：不验证修改文件。

##### `terminal-risk-and-boundary-guard`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证危险命令与越界输入会被真实守卫拒绝。
- What：验证未命中只读白名单的命令与越界输入会被真实守卫拒绝。
- Why：terminal 风险边界必须靠正式测试长期守住。
- How：构造危险或越权命令调用 `terminal_run`。
- Oracle：返回明确拒绝，不执行实际副作用操作。
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

##### `hand-tool-call-order-contract`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `hand` 的多工具顺序执行、总调用数约束与结果聚合守卫。
- Why：工具执行器本身必须在真实结果下稳定收敛，且不能再暴露并行分支复杂度。
- How：通过真实 `hand` 执行多工具顺序调用、达到调用上限的批次，以及超过上限的批次。
- Oracle：多工具调用会按输入顺序真实执行并正确聚合；超过 `HUMAN_HAND_CALL_LIMIT` 的批次会在执行前被 `hand_call_limit_exceeded` 拦截。
- Not：不验证 `brain` 决策来源。

##### `hand-terminal-approval-batch`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `hand` 会对当前 `calls` 中需审批的 `terminal_run` 做批量预检，并在整批未全部同意时 0 执行。
- Why：terminal 审批责任已经前移到 `hand` preflight，正式 case 必须长期守住“先整批审核，再决定是否执行”的主流程。
- How：通过真实 `human` hand 决策构造两个需审批 terminal 命令，并让审批批次返回 `approve + guide` 混合结果。
- Oracle：事件流出现 `approval_batch_required / approval_batch_decision`；整批在审批前不发生真实 tool execution；磁盘上不会产生任何副作用；`decision_hint(code='hand_approval_blocked')` 会回流到 `brain`。
- Not：不验证前端审批卡片交互。

##### `hand-serial-docx-chain`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `hand` 会按顺序执行真实 docx 写入与读回确认链路。
- Why：复杂 docx 链路依赖当前最新修订，必须通过正式 case 守住顺序执行契约。
- How：通过真实 `hand` 执行 `docx_text_edit -> docx_read_blocks`。
- Oracle：工具结果顺序稳定、全部成功，且不会在 hand 内直接产出 docx 交付 artifact。
- Not：不验证 `brain` 是否自然生成这条计划。

##### `hand-tool-limit-and-artifact-merge`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `hand` 的工具次数限制与 artifact 合并行为。
- Why：这是工具执行层的关键边界。
- How：通过真实工具结果触发 limit 与 artifact merge 分支。
- Oracle：超限被守卫拦截，artifact 合并结果稳定。
- Not：不验证 `human` 全链路。

### 5.2 `human`

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
- How：分别覆盖 preflight 成功后执行真实 `docx_read_blocks`，以及 preflight 直接失败的分支。
- Oracle：成功分支中 `docx_read_blocks` 正常返回结果；失败分支中 run 直接失败且不会进入 `human` stage。
- Not：不验证模型下载进度展示。

##### `learning-hand-mouth-smoke`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `human` 在 mock-llm 模式下能稳定走通真实 `brain -> learning -> hand -> mouth` 主链路。
- Why：这是 `human` graph 的最小真实闭环，后续所有复杂样例都建立在这条主链路之上。
- How：通过 scripted structured output 先学习一个真实 external skill（例如 `docx-read`），再直接执行一次 builtin terminal 工具 `terminal_run(pwd)`，最后进入真实 `mouth` 完成交付。
- Oracle：`human_brain`、`human_learning`、`human_hand`、`human_mouth` 四个 stage 都真实出现，且至少有一次真实 terminal 工具结果与一次真实最终交付。
- Not：不验证复杂分支、异常恢复或 live 模型质量。

##### `learning-tool-budget-tracking`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证真实 `learning` 会持续记录当前 active tool 数，并在预算未超限时保留当前已学习 skill 集。
- Why：`learning` 的 active tool 预算是后续扩展 `excel / ppt` 等新能力时的重要长期边界，正式 case 需要先守住基础统计与状态可见性。
- How：通过 scripted structured output 依次学习 `docx-read`、`docx-write`，再故意请求 builtin skill（如 `terminal + kb-retrieval`）；检查最后一轮真实 `human_learning` 事件中的 `learnedSkillIds`、`availableToolNames` 与 summary，并确认出现 builtin learning decision hint。
- Oracle：任务最终完成；最后一轮真实 `human_learning` 事件中只保留 external skill，`availableToolNames` 同时包含 builtin 与 learned external 的工具集合，summary 包含 `当前 active tools=` 且不包含 skill 淘汰文案；builtin skill 不占 active tool budget，但后续真实执行时仍计入工具调用次数限制。
- Not：不验证超过 `20` 个 active tools 后的淘汰算法细节。

##### `decision-hint-retry`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 duplicate external learning 触发真实 `decision_hint` 后，graph 会回到 `brain` 并继续推进。
- Why：`decision_hint -> brain` 是 `human` 的核心收敛边之一，断掉后很多异常都无法恢复。
- How：第一轮先学习一个 external skill（如 `docx-read`），第二轮故意重复学习同一个 external skill 触发 learning decision hint，随后再执行一次真实 `terminal_run(pwd)` 并完成交付。
- Oracle：事件流中真实出现 source 为 `learning` 的 `decision_hint`，并且在它之后仍发生真实 terminal 工具调用，任务最终完成。
- Not：不验证 live 模型是否会自然产生这类重复决策。

##### `tool-failure-recovery`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证真实工具失败结果会被 `human` 吸收，并继续收束到最终交付。
- Why：工具失败是高频真实场景，如果失败后链路无法继续，`human` 就不具备稳定执行能力。
- How：直接真实执行一个会失败的 builtin terminal 只读命令 `cat definitely-missing-file.txt`，随后由 `brain` 决定停止重试并进入 `mouth`。
- Oracle：真实 `terminal_run` 结果为失败，且 `human` 最终仍进入 `completed` 并产出最终交付。
- Not：不验证失败后的最佳补救策略是否最优。

##### `tool-limit-converge`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证真实 `hand` 在超过 `hardActionLimit` 后会发出收敛型 `decision_hint`。
- Why：工具调用上限是 autonomous 执行的重要失控保护，必须通过真实执行链守住。
- How：把 `hardActionLimit` 设为 `1`，先后真实执行两次只读 terminal 命令，让第二次调用命中上限保护。
- Oracle：事件流中出现 source 为 `hand` 且摘要包含“超过临时上限 1”的 `decision_hint`，任务最终完成。
- Not：不验证更高层是否继续扩展计划。

##### `approval-denied-restricted-delivery`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证真实批量审批拒绝会阻止需审批命令落地，并把限制带入最终交付。
- Why：审批拒绝是正式生产边界，不能只靠 fake 测试覆盖。
- How：设置 `approvalPolicy=deny-medium-high`，直接尝试真实执行 builtin terminal 命令 `mkdir blocked-dir`，然后进入最终说明。
- Oracle：事件流真实出现 `approval_batch_decision` 且至少一项为 `reject`；对应 terminal 命令不会真实执行；`decision_hint(code='hand_approval_blocked', reason='user_rejected')` 回流给后续 brain；磁盘上不会真的创建 `blocked-dir`，任务最终完成。
- Not：不验证用户如何在 UI 中恢复被拒绝的动作。

##### `brain-memory-write-boundary`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证第一轮 `brain` 写入的 thought memory 字段会在下一轮真实 `brain` prompt 中继续可见。
- Why：memory 跨轮延续是 `human` 长链路推理的核心能力，必须由真实 graph 保证。
- How：第一轮 `brain` 通过 `thought.todolist/progressionSummary` 更新任务推进记忆，并触发一次真实 learning；第二轮 `brain` 读取真实 prompt，检查这些内容是否还在。
- Oracle：第二轮 `brain` prompt 中出现前一轮写入的 todolist 与 progressionSummary 内容，任务最终完成。
- Not：不验证更复杂的 memory 压缩策略。

##### `conversation-memory-multi-run-recall`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证同一 `session` 下连续多次 run 后，`conversation memory` 会保留稳定主线、覆盖过时状态，并在下一次真实 `brain` prompt 中带回。
- Why：跨任务连续性依赖持久 `conversation memory`；如果只能做单次 update happy path，就无法证明旧状态会被覆盖、未解决事项会被保留。
- How：先 seed 一条发布准备主线；连续两次调用真实 `updateConversationMemoryAfterRun`，分别写入“负责人候选为 Alice”和“负责人更新为 Bob 且上线窗口冲突待确认”；随后启动同一 session 的真实 `human` graph 并检查 prompt 与最终交付。
- Oracle：保存下来的 `summary` 同时保留当前有效状态、未解决事项和产物状态；后续 `brain` prompt 同时含 `<conversation_summary>` 与 `<recent_turns>`；旧状态不会继续出现；最终交付会提到 Bob、上线窗口冲突和下一步安排。
- Not：不验证 live 模型总结质量；不验证 session 隔离。

##### `context-compaction-ratio-and-fact-retention`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 mock-llm 下的真实 `context_compaction` 节点会保留关键事实、压缩到目标比例，并让后续 `brain` 通过 `<compactions>` 继续工作。
- Why：只验证“触发了压缩”还不够；正式回归还需要守住失败原因、约束和当前结论不被压丢，以及比例不失控。
- How：人工构造 6 轮历史，覆盖学习、首次事实读取、错误尝试、失败原因、仍生效约束、修正后的当前结论和 latest round；先直接执行真实 `context_compaction` 节点，再执行真实 `brain` 节点检查 prompt。
- Oracle：事件流出现 `context_compaction_started / context_compaction_completed`；只保留一个 `rounds` compaction block；`latest_round` 保留原文；压缩摘要保留审批未完成、未审批不可发布、Bob 和上线窗口冲突；后续 `brain` prompt 使用 `<compactions>` 且旧 history 不再以未压缩 rounds 渲染；`tokenEstimateAfter / sourceHistoryTokenEstimate <= 0.35`。
- Not：不验证 live 模型自由生成下的压缩质量；不验证多次滚动压缩合并。

##### `todolist-memory-maintenance`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 todolist 作为长期任务板会在 mock-llm 下跨轮维护 todo、done 与 obsolete 状态。
- Why：如果 todolist 不能跨轮保留并被重写成最新任务板，brain 很容易把长期记忆退化成单轮摘要。
- How：第一轮 `brain` 写入只含 todo 的 todolist，并触发一次真实 learning；第二轮 `brain` 读取真实 prompt 后，将 todolist 重写为包含 done、todo 与 obsolete 的新版本。
- Oracle：第二轮 `brain` prompt 中能看到第一轮写入的结构化 todolist 项，任务最终完成，且新的 todolist 成功写回 thought memory。
- Not：不验证除 `mouth` 收口前的 todo 检查之外的更复杂 todolist 机读策略。

##### `complex-docx-edit`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 mock-llm 下 `human` 仍通过真实 docx 工具链完成打开、编辑和搜索。
- Why：复杂 docx 编辑是 `human` 的长期高价值真实任务类型。
- How：先写入 fixture docx，再通过真实 `docx_text_edit -> docx_read_blocks -> docx_search` 完成一次正文替换、读取确认和定位。
- Oracle：真实 `docx_text_edit` 只产生一处 `changedBlocks`，真实 `docx_search` 与 `docx_read_blocks` 都能命中新文本，任务最终完成。
- Not：不验证 review UI 或最终落盘流程。

##### `docx-read-fact-exposure`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 human 在 mock-llm 模式下能收到 docx 读取链路中的关键客观事实，包括 outline 截断说明与归一化后的搜索命中。
- Why：这一层如果事实暴露不足，human 很容易把“当前结果被截断”或“搜索已命中”误读成别的状态。
- How：构造包含长文档截断与兼容字形文本的真实 docx，通过 scripted brain 先执行 `docx_outline`、再执行 `docx_search` 与 `docx_read_blocks`，检查后续 prompt 是否包含相关事实。
- Oracle：后续 `brain` prompt 中可读到截断文字说明、归一化搜索命中与区间精读正文，最终任务完成且不会把文档中已写内容误报为“未写”。
- Not：不验证 live 模型在该场景下的自主策略优劣。

##### `docx-search-alias-then-range-read`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 mock-llm 下 `human` 会先做 alias fallback 搜索，再进入区间精读。
- Why：这是 docx 新工作流里最关键的自主使用模式，必须有正式 scripted 回归。
- How：构造只写“过度拟合”的真实 docx，scripted brain 先执行 `docx_search(query=过拟合)`，再以返回 blockId 执行区间 `docx_read_blocks`。
- Oracle：`docx_search` 返回 alias fallback 事实，`docx_read_blocks` 返回定义/成因/处理线索，任务最终完成。
- Not：不验证 live 模型是否一定会采用相同工具顺序。

##### `multi-tool-collaboration`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 `human` 会通过真实 `hand` 执行一次顺序多工具协作。
- Why：`human` 不能只验证单工具 happy path，还必须覆盖真实多工具串行读工具场景。
- How：先 seed 真实 KB 文档，再学习 terminal 与 KB skill，随后在一次 `hand` 决策中按顺序执行 `terminal_run(pwd)` 与 `kb_list_documents`。
- Oracle：同一条任务中真实出现 terminal 与 KB 两类工具结果，任务最终完成。
- Not：不验证更复杂的多轮依赖型工具调度。

##### `kb-answer-with-real-kb`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 mock-llm 下的 KB 回答仍通过真实知识库存储、真实 embedding 与真实检索执行。
- Why：KB 是当前最敏感的 fake 风险点，必须单独有正式 case 显式守住。
- How：seed 两份真实 KB 文档，学习 KB skill 后真实执行 `kb_search(strategy=keyword)`，再通过真实 `mouth` 生成最终回答。
- Oracle：真实 KB 检索结果中包含目标文档 `doc-1` 的证据，且这条证据文本会进入真实 `mouth` prompt，任务最终完成。
- Not：不验证答案措辞或检索召回优劣。

#### `live`

##### `human-conversation-memory-multi-run-live`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 live 模式下基于真实 workspace 的 conversation memory 会在双 run 间延续关键业务状态，并被后续真实 `brain` 正确带回。
- Why：真实环境里的会话连续性不能脱离 workspace 语义；如果记忆里提到的对象在工作区中不存在，模型会合理地转去做环境核验，导致样例失真。
- How：复用风险周报 live 的真实 workspace；第一轮只做“状态梳理，不新建文件”，完成后通过真实 `updateConversationMemoryAfterRun` 写入 session memory；第二轮在同一 session、同一 workspace 下追问“当前最关键的待确认项、应该先找谁、为什么”，允许模型继续读取真实资料。
- Oracle：`summary` 非空且保留风险主线、负责人、待确认项与下一步；第二轮 `brain` prompt 同时出现 `<conversation_summary>` 与 `<recent_turns>`；即使模型重新读取文件，也不应偏离第一轮形成的连续业务主线；最终交付继续命中负责人、阻塞项和后续动作，并体现第一轮总结对第二轮真实判断的延续影响。
- Not：不要求第二轮禁止 reread workspace；不逐字约束 live 模型措辞；不验证 session 隔离。

##### `human-context-compaction-natural-trigger-live`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 live 模式下 `human` 会基于真实 brain usage 与新增 history 增量在风险周报长任务中自然触发 `context_compaction`，并在压缩后继续完成正式交付。
- Why：相比单独直调节点，正式 live 更应该守住“真实 graph 中自然压缩且不影响任务完成”的能力。
- How：复用风险周报 live 的真实 workspace 与业务输入，只通过 `humanRuntimeOverrides.modelContextWindowTokens=18_750` 缩小上下文窗口，让真实任务在多轮资料读取后自然走到少量 `context_budget -> context_compaction -> context_budget -> brain`。
- Oracle：事件流出现 1-2 次 `context_budget_evaluated(decision=compact)` 且 snapshot 使用 `basis=usage_plus_delta` 与 `budgetTokens`、对应的 `context_compaction_started / completed`；存在真实 `human.context_compaction` LLM 调用；后续 `brain` prompt 出现 `<compactions>`；`latest_round` 仍保留原文；完成事件和日志中可看到压缩摘要、源历史 token 与压缩后 token；最终形成周报草稿产物。
- Not：不要求 live 模型严格达到 25% 理想比例；不要求每次都走固定资料读取顺序。

##### `human-risk-report-draft-live`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 live 模式下 `human` 会在一个真实长任务里串起模板定位、上周周报风格参考、多源工作资料取证、新建本周周报 docx 与待确认稿交付。
- Why：`human/live` 需要至少一条长期高价值复杂样例，覆盖 workspace 搜索、真实材料辨别、跨 `docx + txt` 综合、create-target 写入与最终交付链路；同时守住“共享 workspace 中全部已支持文件都已进入真实 KB，但关键事实仍可能来自非 KB 文本材料”的更真实用户环境。
- How：注入真实 live LLM 配置；workspace 直接使用 `tests/fixtures/workspace` 共享目录，并在 run 前通过真实生产文件 ingestion 链把该目录下当前所有已支持文件索引进 KB；随后由测试在运行时重建 `工作/` 目录：包含一份不可直接覆盖的周报模板、一份只能参考风格的上周已发版周报、多份提供本周事实的 `docx` 工作文档、数份必须读取的 `txt` 口径/跟进材料，以及少量看起来相关但不应直接采用的干扰文件；直接输入“帮我写下这周的周报，基于这个周报模版和我的工作文档信息，记得参考我上周写的周报风格来哦”的自然语言诉求，让真实 `human` 自主完成。
- Oracle：任务最终完成；共享 workspace 中全部已支持文件均被索引；事件流中至少出现一次 `terminal_run`、至少一次真实资料读取/检索步骤（可来自 `docx_*`、`kb_*` 或其他正式支持的读工具）以及一次 `docx_create`；模型会打开模板和上周周报；最终输出 artifacts 中同时包含 `draft_review` 与 `draft`；正式模板与既有工作 `docx` 文件都不被覆盖；新建周报待确认稿中应写入本周整体判断、负责人说明和后续动作；若发生 docx 写，则写工具结果应包含 `postWriteReadback.regions`；不要求固定取证路径，不要求固定风险结论措辞，只要任务真实完成即可通过。
- Not：不绑定最终答案措辞，不要求固定是否使用 `docx_outline` 还是 `docx_read_blocks`，也不强制一定调用 KB；若模型仅凭工作区材料完成任务，也视为符合预期。

##### `human-docx-cause-remedy-reading-live`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 live 模式下 `human` 会基于两份已选 `docx` 做跨文件精读，并准确回答“过拟合 / 反走样”的成因与处理思路；同时工作区存在其他 docx 干扰项也不会偏题。
- Why：真实用户在复习场景里经常已经选中了资料，但 workspace 中通常不止这两份文档；这条 case 要长期守住“已选资料范围优先 + 跨文件准确回答”的正式能力，对齐 `WB-CORE-002-AC2`、`WB-CORE-004-AC1`、`WB-CORE-006-AC1`、`WB-CORE-006-AC2`。
- How：注入真实 live LLM 配置；把 `tests/fixtures/workspace` 共享目录复制进 workspace，其中只将 `学习笔记/深度学习.docx` 与 `学习笔记/图形学.docx` 作为已选资料；直接输入“我这两天复习的时候老把这两个概念混了。你就按我刚选的这两份课件，帮我讲清楚：过拟合和反走样分别是什么、为什么会出现、一般怎么处理。别自己补课外内容，哪份资料没写你就直接告诉我没写。”的自然语言诉求，让真实 `human` 自主完成。
- Oracle：任务最终完成；事件流中至少出现一次 `docx_search`，并且至少两次 `docx_read_blocks` / `docx_outline` / `docx_search` 覆盖两份已选目标文档；最终回答同时命中“过拟合”的定义/成因事实组，并对处理办法给出文档内事实或明确说明“没写”；同时命中“反走样”的成因/处理事实组；不出现 docx 编辑工具；回答不应明显被 workspace 里的其他 docx 干扰。
- Not：不要求固定回答结构，也不对最终文案做逐字断言。

##### `human-docx-cross-source-summary-draft-live`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 live 模式下 `human` 会读取两份已选课件，自主创建一份新的总结 docx，并把跨源总结写进去。
- Why：真实用户常见诉求不只是“口头总结”或“补现有主稿”，也包括“新建一份能直接发出去的总结报告”；这条 case 要长期守住跨源读取、单目标写入与不覆盖原文件的正式能力，对齐 `WB-CORE-002-AC2`、`WB-CORE-003-AC1`、`WB-CORE-004-AC1`、`WB-CORE-006-AC1`、`WB-CORE-006-AC2`。
- How：注入真实 live LLM 配置；把 `深度学习.docx` 与 `图形学.docx` 作为已选资料复制进 workspace；直接输入“帮我基于我刚选的这两个文件，生成一个给同学复习用的 Word 总结文件，文件名就叫《深度学习与图形学复习总结》。里面把关键概念、出现原因和常见处理方式整理清楚；哪份资料没写你就直接说明没写。”的自然语言诉求，让真实 `human` 自主完成。
- Oracle：任务最终完成；事件流中至少两次 `docx_search` / `docx_read_blocks` / `docx_outline` 覆盖两份源资料；至少出现一次 `docx_create`；存在 `draft_review_ready` 事件，最终输出 artifacts 中同时包含 `draft_review` 与 `draft`；两份原始源 `docx` 文件未被覆盖；创建目标只应落在 `深度学习与图形学复习总结.docx` 上，且正式目标路径在 commit 前不存在；最终答复应包含“过拟合/过度拟合”与“反走样”两个主题。
- Not：不要求固定总结结构，也不要求一定生成表格。

##### `human-docx-positioned-structural-edit-fallback-live`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 live 模式下 `human` 在复杂 positioned docx 中不会执行任何自动编辑，而是对命中复杂定位排版区域的写入请求做优雅回退。
- Why：这类由 `framePr` / 绝对定位 shape 组成的 docx 即使只是原地改字，在 preview/review 语义下也可能因修订标记叠加而错位；这条 case 要长期守住“positioned 区域只读、自动写入必须拒绝并给用户手动提示”的正式能力，对齐 `WB-CORE-003-AC1`、`WB-CORE-004-AC1`、`WB-CORE-006-AC1`、`WB-CORE-006-AC2`。
- How：注入真实 live LLM 配置；只将 `图形学.docx` 作为已选资料复制进 workspace；直接输入“我准备把这份图形学讲义发给同学复习，想把‘反走样’这一节补得更容易记一些。你直接在这一节后面加一段更通俗的说明，再加一个很短的总结表，帮助大家快速区分两种常见做法。”的自然语言诉求，让真实 `human` 自主完成。
- Oracle：任务最终完成；事件流中至少一次 `docx_search` / `docx_read_blocks` / `docx_outline` 覆盖 `图形学.docx`；至少一次 docx 写入请求因为命中复杂定位排版区域失败，并返回稳定 `diagnostic.message`；原始 `docx` 文件未被覆盖；最终答复明确说明未在原文中自动编辑，并给出回退处理。回退结果允许两种形态：一是仅给出建议手动补充的内容且不生成 `draft_review` / `draft` artifact；二是改为生成独立补充稿，并在 artifacts 中产出对应的 `draft_review` 与 `draft`。
- Not：不要求固定使用哪一种 docx 写工具，也不要求最终答复使用固定措辞。

##### `human-kb-guided-docx-comparison-draft-live`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证 live 模式下 `human` 在不传 `selectedReferences` 且 workspace 存在整组 docx 时，会先用 KB 缩圈找出讲“反走样 / 过拟合”的两份源资料，再把内容分别回写到另外两份目标 docx。
- Why：真实用户常常记得主题、不记得文件名，而且希望把资料内容整理回自己的教学文档；这条 case 要长期守住“工作区默认范围 + KB 缩圈 + 多源读取 + 多目标 docx 回写”的正式能力，对齐 `WB-CORE-002-AC2`、`WB-CORE-004-AC1`、`WB-CORE-006-AC1`、`WB-CORE-006-AC2`。
- How：注入真实 live LLM 配置；workspace 直接使用 `tests/fixtures/workspace` 共享目录，不传 `selectedReferences`；在 run 前通过真实生产文件 ingestion 链把该目录下当前所有已支持文件（当前为全部 `docx`）索引进 KB，其中既包括 `学习笔记/` 下的 `图形学.docx` 与 `深度学习.docx`，也包括两份目标教学文档和其他 docx 干扰项；直接输入“我工作区里这几份课件和教学材料有点多，我想把里面跟反走样和过拟合有关的内容整理进两份教学文档里。你先把相关资料找出来看一遍，再把适合老师讲‘概念区分’的内容分别补到课堂 PRD 和交互式案例里，写法尽量像备课备注和课堂引导语，不要像教材摘抄。”的自然语言诉求，让真实 `human` 自主完成。
- Oracle：任务最终完成；共享 workspace 中全部已支持文件均被索引；事件流中至少出现一次 KB 工具调用；至少两次允许的 docx 编辑成功，且写入目标落在 `人工智能探究课堂PRD.docx` 与 `交互式探究学习案例：产业转移.docx` 两份目标稿上；存在至少两次 `draft_review_ready` 事件，最终输出 artifacts 中同时包含两组 `draft_review` 与 `draft`；原始源/目标 `docx` 文件未被覆盖；最终答复明确说明更新了哪两份教学文档，且内容保持“概念区分 / 备课备注 / 课堂引导语”风格。
- Not：不强制固定执行路径，也不要求 KB 缩圈后必须再打开所有候选资料。

## 6. 验收口径

- `tool` suite 必须持续守住真实工具输入输出、审批边界和 artifact 契约。
- `human/mock-llm` 必须覆盖 `AiRunService -> human` 入口、`brain / learning / hand / mouth` 主链、memory 延续、decision hint 收敛与复杂工具协作。
- `human/live` 必须至少保留 1 条简单任务和 1 条复杂任务正式 case。
- `human` suite 必须继续支撑 `WB-CORE-002`、`WB-CORE-003`、`WB-CORE-004`、`WB-CORE-005`、`WB-CORE-006`。
