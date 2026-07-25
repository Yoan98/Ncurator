# NCurator-Desktop AI 测试计划

## 1. 总体目标

- 本计划定义 AI 域回归范围和领域规则。通用测试、runner、raw logs、UI E2E 和 live 断言规则统一遵循 `doc/test.md`。
- AI 回归只围绕两类稳定对象：
  1. `tool`
  2. `human`

## 2. Suite 设计

### 2.1 `tool`

- `tool` 只验证真实生产工具调用，不允许 fake。
- `tool / docx` 包含 `docx-edit-serial-actions-stability`，用于守住同一次 `docx_edit(actions)` 内插入、替换、删除后的 block 定位稳定性。
- `tool / text-file` 覆盖普通文本读取、四种写入 action、修改记录、结构化 diff 与回退前置数据。
- `tool / pdf` 使用真实 `深度学习.pdf`，覆盖元数据、页级正文、literal/regex 搜索、页面 PNG、工作区边界、损坏文件和结果大小限制。
- `tool / web-browsing` 包含 `web-crawl-contract`，用于守住 `web_crawl`、`web_search` 和 `browser_use` 工具契约。
- 目标：验证 tool 与 `hand` 执行守卫的生产输入输出。
- 约束：使用真实工具、store、docx apply service 和 artifact 流；禁止 fake `documentsStore`、`embeddingService`、`resolveDocxOpenTarget` 或 tool result。
- `web-browsing` 工具测试先覆盖冻结 sidecar bin 程序抓取与 `browser_use` 服务不可用诊断。

### 2.2 `human`

- `mock-llm`
  - 目标：在 non-live 条件下验证 `AiRunService -> human` 入口和 `human` 主链的真实执行链路。
  - 约束：只允许 mock LLM 输入输出；必须真实走 `createAiRunContext -> human graph -> learning / hand / mouth -> store / apply / artifact`。
  - 禁止：`humanReasonOverrides`、`toolExecutionOverrides`、手工串 node、fake tool/store/docx apply service。
  - 覆盖要求：要通过不同 case 把关键节点与关键边都跑到，而不是只验证一条 happy path。
- `live`
  - 目标：验证真实模型下 `human` 的真实业务执行。
  - 约束：必须走真实统一 LLM executor（包括 `ctx.chatStructured / ctx.chatText`）、真实 KB、真实工具、真实 apply / artifact。
  - 禁止：任何 scripted driver、`chatStructuredOverride`、fixture store override。
  - 覆盖要求：至少保留 1 条简单任务和 1 条复杂任务回归 case；如复杂任务有多条稳定用例，可同时保留。

## 3. 领域特有规则

### 3.1 Harness 规则

- AI backend 回归必须以生产 `createAiRunContext` 作为唯一 runtime 入口，并使用真实 store、apply service 和 embedding service。
- 每个 AI run 的文档 worker 资源统一通过 `AiRunResourceManager` 在 run 结束时释放；资源释放失败不能覆盖任务结果。
- `mock-llm` 只固定 LLM 输出，其余全部真实；`live` 通过真实 `LlmConfigStore` 和生产 LLM executor 执行。
- 凡是会进入 `human` 的回归 run，必须在进入 `human` 前完成 embedding 基础服务 preflight；不允许把 embedding 初始化推迟到某个工具调用时才暴露。
- KB fixture 必须走真实导入、真实索引、真实检索。
- embedding 模型缺失时，harness 应优先通过真实生产下载链自动检查并下载，不得引入测试专用 embedding 替身。
- 回归 harness 不得使用旧式 fake API。
- AI backend 回归统一使用默认 `testTimeout=900_000`、`hookTimeout=900_000`；不再为单个回归 case 单独配置超时。

### 3.2 `mock-llm` 与 `live` 设计口径

#### mock-llm 类别

- 目的：快速定位非 LLM 问题，并验证每个关键节点、关键边在真实生产 graph 中都能跑通。
- 允许：脚本化 LLM 输入输出。
- 不允许：脚本化 runtime 节点执行结果。
- 断言重点：节点流转、工具调用、审批事件、artifact、memory、错误收敛、状态收口。
- artifact 进入 conversation history 和 conversation memory 时只允许包含 `kind / path / operation`；内部 `capability / fileName / applyId` 不得进入提示词。
- 已经落地的文件修改不得因 `run_failed` 或 `run_cancelled` 丢失，终态消息与 Workbench 都必须继续显示对应修改记录。

#### live 类别

- 目的：验证真实业务场景在真实生产调用下可以完成。
- case 设计必须使用真实用户风格输入，不得把内部固定工具顺序写进用户输入。
- 断言口径统一遵循 `doc/test.md` 的真实 AI / live 断言规则。
- `human / live` 结果写入测试运行产物，不回写本计划；本计划只维护稳定 case、执行规则和 Oracle。

### 3.3 目录与命令

AI 回归测试目录：

- `tests/case/ai/tool/<group>/<case>.test.ts`
- `tests/case/ai/human/mock-llm/<case>.test.ts`
- `tests/case/ai/human/live/<case>.test.ts`

AI unit / 辅助测试目录：

- `tests/case/unit/ai/<case>.test.ts`

推荐命令：

- `pnpm test:ai`
- `pnpm test:ai:backend`
- `pnpm test:ai:tool`
- `pnpm test:ai:human:mock-llm`
- `pnpm test:ai:human:live`

## 4. 回归测试清单

### 4.0 结构化输出策略与服务重试

### 4.1 `tool`

#### docx 类别

##### `docx-legacy-doc-read-contract`

- 测试类型：`backend`
- What：旧版 .doc 文件可以通过现有 docx-read 工具读取，并明确拒绝写入。
- Why：旧格式读取是 AI 文档能力的兼容边界，写入拒绝必须可解释且不产生副作用。
- How：读取 outline、block、literal/regex 搜索，再尝试编辑并检查 decision hint。
- Oracle：读取结果有效；编辑返回“不支持写入旧版 .doc”及对应提示；源文件 bytes 不变。
- Not：不把旧版 .doc 写入转换为隐式成功。

##### `docx-minimal-edit-flow`

- 测试类型：`backend`
- What：最小 docx 打开、定位、编辑与继续读取链路。
- Why：docx 工具链最基础的真实生产调用闭环。
- How：对 fixture docx 真实执行 `docx_search -> docx_read_blocks -> docx_edit(replace_text) -> docx_search -> docx_read_blocks`。
- Oracle：写入成功并返回 `postWriteReadback`；只目标 block 发生变更，修改后的结果可继续被读取工具消费。
- Not：不验证 `human` 的工具选择。

##### `docx-create-then-open-and-edit`

- 测试类型：`backend`
- What：`docx_edit(create_document)` 新建的 docx 能立刻进入 `outline / read / edit` 主链。
- Why：cross-source summary 这类“先生成新 Word 文件再写内容”的真实场景，底层必须先守住 create 契约。
- How：真实执行 `docx_edit(create_document) -> docx_read_outline -> docx_read_blocks -> docx_edit(insert_blocks) -> docx_search`。
- Oracle：create-target 结果返回稳定 `sourcePath / postWriteReadback`；工具成功后目标路径立即存在且可被继续读取；后续编辑会生成新的可读状态，新内容可继续被搜索命中。
- Not：不验证 human 是否会选择 create。

##### `docx-create-existing-path-guard`

- 测试类型：`backend`
- What：`docx_edit(create_document)` 不会覆盖已存在的目标路径。
- Why：create 能力一旦在工具调用阶段覆盖原文件，就会破坏 docx replay 与 direct apply 的基本安全边界。
- How：先写入一份真实 docx，再对同一路径执行 `docx_edit(create_document)`。
- Oracle：返回 `invalid_input`；原文件 bytes 不变；当前 run 不产生新的 docx session。
- Not：不验证 UI 层如何展示报错。

##### `docx-create-with-content-direct-applies`

- 测试类型：`backend`
- What：仅执行 `docx_edit(create_document, blocks=...)` 也会立即创建目标 docx，并在 run 收尾生成 apply record。
- Why：真实模型很可能在 create 时一次写完内容，这条能力必须由回归测试保护，不能强依赖后续 edit。
- How：真实执行 `docx_edit(create_document)` 并直接 `applyDocxRunEdits`。
- Oracle：生成 `DocxApplyRecord(operation=created,status=applied)` 并包含 diff 预览 artifact 路径；目标文件立即存在；最终 artifacts 包含携带 `applyId` 的 docx file artifact。
- Not：不验证 `human` 是否会自然选择在 create 时创建完整文档。

##### `docx-direct-apply-checkpoint-revert`

- 测试类型：`backend`
- What：existing docx 在 `docx_edit` 成功时立即写回，run 收尾保存 checkpoint 和修改记录，并支持干净回退。
- Why：direct apply 模式下，写回与回退是替代旧确认提交流程的核心安全边界。
- How：真实编辑一份 docx，执行 `applyDocxRunEdits`，再执行 `DocxApplyService.revertRecord(force=false)`。
- Oracle：源文件在 apply 后立即变化；生成 `DocxApplyRecord(operation=updated,status=applied)`、checkpoint 与 diff 预览 artifact；真实源文件不包含 diff 标记；回退后源文件恢复 checkpoint，记录状态变为 `reverted`。
- Not：不验证用户界面的回退入口展示。

##### `docx-direct-apply-force-revert-after-user-change`

- 测试类型：`backend`
- What：AI 写回后用户又改文件时，首次回退提示风险，force=true 后仍允许恢复 checkpoint。
- Why：宽松模式的安全边界是 checkpoint 和显式风险提示，而不是阻止用户强制回退。
- How：真实编辑并 apply 后，外部改写源文件；先 `revertRecord(force=false)`，再 `revertRecord(force=true)`。
- Oracle：首次回退返回 `requiresForce=true` 和“恢复到本次修改前”风险 warning；强制回退后恢复 checkpoint 并覆盖后续修改。
- Not：不验证 UI 二次确认文案。

##### `docx-immediate-create-and-external-change-invalidates-session`

- 测试类型：`backend`
- What：create-target replay 后目标被外部创建时，apply 按 updated 备份并覆盖，回退恢复外部文件。
- Why：新建文件写回前若目标已被外部创建，应按 update 语义备份当前文件并覆盖，回退可恢复外部创建版本。
- How：真实执行 `docx_edit(create_document)` 建立 replay session，随后外部创建同名目标文件，再执行 `applyDocxRunEdits` 和回退。
- Oracle：生成 `DocxApplyRecord(operation=updated,before_exists=true)`；回退后恢复外部创建的文件。
- Not：不验证目标文件由真实用户还是测试进程创建。

##### `docx-large-document-navigation`

- 测试类型：`backend`
- What：长文档下的读取、定位和局部精读能力。
- Why：长文档最容易暴露基础定位问题。
- How：对高 block 数 fixture 真实调用 `docx_read_outline(ranges=block_index) / docx_search / docx_read_blocks`。
- Oracle：长文档下仍返回稳定 `blockId/blockIndex` 信息，且能定位并精读目标 block。
- Not：不验证编辑落盘。

##### `docx-outline-read-search-do-not-create-replay-session`

- 测试类型：`backend`
- What：纯读 docx 工具首次访问只创建 read session，不会提前创建 replay session。
- Why：read/write session 分层重构的根契约，破坏后会让只读场景重新回到高内存 replay 路径。
- How：真实执行 `docx_read_outline -> docx_read_blocks -> docx_search`，检查 runtime session 状态。
- Oracle：三次调用都成功；`readSessionCount=1`；`replaySessionCount=0`。
- Not：不验证编辑链路。

##### `docx-read-then-edit-upgrades-to-replay-session`

- 测试类型：`backend`
- What：纯读后首次编辑会升级到 replay session，并释放旧 read session。
- Why：升级动作必须把只读缓存收口掉，否则同一路径会长期保留两套运行态，违背本次重构目标。
- How：真实执行 `docx_read_outline -> docx_edit(insert_blocks) -> docx_search`，检查 runtime session 状态。
- Oracle：编辑成功；后续搜索可命中新文本；`readSessionCount=0`；`replaySessionCount=1`。
- Not：不验证 direct apply / revert。

##### `docx-read-then-edit-preserves-long-document-tail`

- 测试类型：`backend`
- What：长文档在 read 分页后升级到 replay session 时不会丢失尾部 block。
- Why：如果 replay snapshot 仍走固定 block 上限，read world 与 write world 会在长文档上出现静默分裂。
- How：先用 `docx_read_outline(ranges=block_index)` 读取 5000 之后的尾部范围，再对尾部 block 执行真实 `docx_edit(insert_blocks)` 与 `docx_search`。
- Oracle：尾部范围返回正确 `blockIndex`；尾部 block 编辑成功；后续搜索可命中新文本；`readSessionCount=0`；`replaySessionCount=1`。
- Not：不验证 AI 的读取策略。

##### `docx-search-unicode-normalization-contract`

- 测试类型：`backend`
- What：`docx_search` 会做兼容字形归一，能用普通查询或 regex 命中兼容字形文本。
- Why：docx 文本里常见兼容字形，如果检索不归一，AI 会把“文档已写”误判成“文档未写”。
- How：写入包含兼容字形文本的真实 docx，再分别执行 `docx_search(literal)` 与 `docx_search(regex)`。
- Oracle：普通查询可命中兼容字形 block，且返回稳定 blockId。
- Not：不比较字符偏移是否完全映射回原始编码位置。

##### `docx-search-scope-contract`

- 测试类型：`backend`
- What：`docx_search` 默认搜索当前文档全部 block，且 `docx_edit(replace_text).blockIds` 只在当前文档内进一步缩圈。
- Why：docx 搜索的核心契约，必须长期稳定，避免 prompt 与工具行为不一致。
- How：对同一 doc 先执行默认搜索，再通过限定编辑范围验证后续搜索结果只影响指定 block。
- Oracle：默认搜索可命中文档内多个 block，限定编辑后只修改指定 block 范围内的结果。
- Not：不验证 human 该如何选择何时缩圈。

##### `docx-search-literal-alias-fallback`

- 测试类型：`backend`
- What：`docx_search(literal)` 在 0 命中时会触发有限 alias fallback。
- Why：术语轻微变体是 docx 场景里的高频真实问题，必须由工具契约稳定承接。
- How：写入只包含“过度拟合”的真实 docx，再以“过拟合”执行 `docx_search(literal)`。
- Oracle：搜索结果命中目标 block，且显式返回 `effectiveQuery=过度拟合` 与 `appliedAliases`。
- Not：不引入通用大词库或无限 rewrite。

##### `docx-search-regex-contract`

- 测试类型：`backend`
- What：`docx_search(regex)` 可用，且非法 regex 会稳定报错。
- Why：regex 是 AI 换词失败后的重要兜底能力，必须守住输入契约。
- How：对真实 docx 执行合法 regex 搜索与非法 regex 搜索。
- Oracle：合法 regex 正常命中并返回 offsets；非法 regex 返回 `invalid_input`。
- Not：不比较不同 regex 引擎的高级语义差异。

##### `docx-search-semantic-contract`

- 测试类型：`backend`
- What：`docx_search(semantic)` 能返回相关 block，且结果带 score。
- Why：semantic 是换词失败后的召回增强能力，必须有回归契约保护。
- How：在 embedding ready 前提下，对真实 docx 执行 `docx_search(mode=semantic)`。
- Oracle：至少返回一个相关 block，且结果显式包含 `score`。
- Not：不比较召回排序的全局最优性。

##### `docx-read-range-contract`

- 测试类型：`backend`
- What：`docx_read_blocks(range=block_index)` 会返回连续区间 blocks。
- Why：“搜索 -> 精读”工作流的核心读取契约，必须长期稳定。
- How：先通过真实 `docx_read_outline` 定位起止 block，再执行区间 `docx_read_blocks`。
- Oracle：返回结果按文档顺序覆盖闭区间，且详细块都带 `blockId/blockIndex`。
- Not：不验证 AI 何时该扩大片段范围。

##### `docx-outline-pagination-contract`

- 测试类型：`backend`
- What：`docx_read_outline(ranges=block_index)` 可以读取长文档后半段。
- Why：如果只能重复看前几百块，AI 很容易误判“文档没写”。
- How：对长文档执行带 `block_index` range 的真实 `docx_read_outline`。
- Oracle：返回结果从指定 `blockIndex` 开始，并按闭区间返回目标块。
- Not：不验证 UI 层如何呈现分页。

##### `docx-auto-open-no-fake-failure`

- 测试类型：`backend`
- What：AI-facing docx 读取工具首次自动 open 时不再先发假失败结果。
- Why：同一 toolCallId “先失败后成功”的噪音会误导 brain 对工具稳定性的判断。
- How：对未预先打开的真实 docx 直接执行 `docx_search`，检查事件流中的 tool result。
- Oracle：同一次调用只返回一次成功结果，不出现 `sourcePath must be opened before ...`。
- Not：不验证内部显式 require 场景。

##### `docx-outline-truncation-contract`

- 测试类型：`backend`
- What：`docx_read_outline` 结果超出 AI-facing 体积门禁时返回 `result_too_large`。
- Why：长文档 outline 不能依赖 AI-controlled 数量上限截断，必须提示 brain 缩小范围。
- How：对长文档执行过大的真实 `docx_read_outline(ranges=...)`，检查返回 `ok=false`、失败文本与 decision hint。
- Oracle：返回 `ok=false`，失败文本明确为结果过大，且 decision hint 包含 `toolName/estimatedTokens/limit`。
- Not：不验证 human 是否一定继续读取后续内容。

##### `docx-complex-ops-serial-actions`

- 测试类型：`backend`
- What：多类复杂编辑操作的真实执行契约。
- Why：复杂写入是 docx 工具层高风险区。
- How：覆盖 `docx_edit(actions[])` 按输入顺序串行执行 `replace_text / delete_blocks / insert_blocks(before/after, paragraph/heading/table) / update_table_cell` action。
- Oracle：各类 action 都能写入成功并返回最终文档状态下可继续消费的 `postWriteReadback`。
- Not：不验证上层 op 选择策略。

##### `docx-edit-insert-blocks-order`

- 测试类型：`backend`
- What：`docx_edit(insert_blocks)` 在同一 anchor 后插入多条段落与表格时保持输入顺序。
- Why：结构插入顺序一旦漂移，后续 AI 读回确认和用户可见文档都会出现错位。
- How：在段落 A 后一次插入 `P1 / P2 / Table / P3`，再读取完整 outline。
- Oracle：最终顺序稳定为 `A / P1 / P2 / Table / P3 / B`，且返回 `createdBlocks` 与 `postWriteReadback`。
- Not：不验证多 action 串行插入；该场景由 `docx-edit-serial-multiple-inserts-preserve-created-blocks` 覆盖。

##### `docx-edit-serial-multiple-inserts-preserve-created-blocks`

- 测试类型：`backend`
- What：一次 `docx_edit(actions[])` 内多个 `insert_blocks` 会按 action 顺序稳定写入，并分别返回新增 block。
- Why：批量结构插入需要让后续读回和继续编辑能准确识别每个新增结构。
- How：在同一文档里先在 A 后插入两个段落，再在 C 前插入段落和表格。
- Oracle：最终顺序稳定，`createdBlocks` 能对应到本次新增的段落与表格，不误收尾部旧块。
- Not：不验证 replace/delete 与 insert 的混合漂移；该场景由串行动作稳定性 case 覆盖。

##### `docx-structural-op-behavior`

- 测试类型：`backend`
- What：文本替换不会创建新结构，段落/表格对象编辑可以创建独立结构块。
- Why：docx 工具必须清晰区分文本级修改与结构级修改，否则会污染后续 outline、read 和 createdBlocks 语义。
- How：先执行 `replace_text`，再执行段落与表格 `insert_blocks`，分别读取 outline。
- Oracle：`replace_text` 后 body 结构数量不变；对象插入后出现新增 paragraph/table 结构，且 changedBlocks 标记为结构插入。
- Not：不验证 run 级样式保留。

##### `docx-edit-serial-actions-resolve-original-target-after-insert-drift`

- 测试类型：`backend`
- What：单次 `docx_edit(actions[])` 内前序插入导致 blockIndex 漂移后，后序 action 仍能命中最初读取到的原始 blockId。
- Why：AI 常基于同一轮读取结果连续提交批量编辑，必须避免前序插入让后续目标误伤相邻旧块。
- How：先在 A 后插入 A1，再继续用最初读取到的 C blockId 执行 `replace_block`。
- Oracle：最终文档为 `A / A1 / B / C updated`，changedBlocks 同时记录插入与替换。
- Not：不支持同一次 actions 内引用本次刚创建且尚未回读的新 blockId。

##### `docx-edit-serial-actions-follow-replacement-successor`

- 测试类型：`backend`
- What：同一次 `docx_edit(actions[])` 内 `replace_block` 后继续引用同一原始 blockId，会解析到替换后的 successor。
- Why：批量编辑经常需要先替换整段，再继续对新段落做局部文字处理。
- How：先把目标段落替换为含 `keyword` 的新段落，再用同一原始 blockId 执行 `replace_text`。
- Oracle：最终文本包含二次修改后的 `styled-keyword`，并同时记录 `replace_block` 与 `replace_text`。
- Not：不验证跨多轮引用新增 block 的策略。

##### `docx-edit-serial-actions-fail-after-delete-without-committing`

- 测试类型：`backend`
- What：同一次 `docx_edit(actions[])` 内删除后再修改同一原始 blockId 会失败，且不会提交部分结果。
- Why：批量编辑失败必须保持 transaction 边界，不能留下半成功 working draft。
- How：先删除目标 block，再尝试对同一原始 block 执行 `replace_block`。
- Oracle：工具返回失败；active 文档仍保留原目标文本，不出现后续替换文本。
- Not：不支持同一次 actions 内引用本次刚创建且尚未回读的新 blockId。

##### `docx-format-variants-contract`

- 测试类型：`backend`
- What：paragraph、heading、table、table_cell 的读取与修改契约。
- Why：不同 block 类型最容易只在各自路径暴露问题。
- How：使用混合 block fixture 真实执行读取、定位与修改。
- Oracle：各类 block 都可稳定识别和修改，不破坏其余结构。
- Not：不验证 run 级样式保留。

##### `docx-positioned-layout-read-only-contract`

- 测试类型：`backend`
- What：命中 positioned block 时，docx 写工具会统一拒绝自动编辑。
- Why：复杂定位排版 docx 即使只是原地改字也可能因结构重写而错位，这条 case 要长期守住 `positioned = read-only` 的能力边界。
- How：对真实 `图形学.docx` 执行 `docx_read_outline` 定位一个 positioned block，再分别尝试 `docx_edit(insert_blocks)`、`docx_edit(replace_text)`、`docx_edit(style_text)` 与 `docx_edit(update_table_cell)`。
- Oracle：四类写入都返回 `invalid_input`；错误信息稳定包含“当前命中复杂定位排版区域，暂不支持自动编辑”；不产生新的当前修订。
- Not：不验证 human 的回退话术，也不验证 positioned 文档中的读取质量。

##### `docx-insert-after-preserves-anchor-xml`

- 测试类型：`backend`
- What：纯 `insert_after` 不会改写 anchor 段落文本与 run 格式。
- Why：结构插入的底层实现若重写 anchor，会制造伪样式漂移并污染 replay / committed view 语义。
- How：构造带 mixed-format run 的 anchor 段落，执行 `docx_edit(insert_blocks after)`，再读取同一 anchor。
- Oracle：anchor 文本保持不变，run 列表逐项一致，changedBlocks 只记录 `insert_after`。
- Not：不验证 direct apply 产物。

##### `docx-created-blocks-resolve-inserted-range-not-shifted-tail`

- 测试类型：`backend`
- What：`createdBlocks` 依据插入区间解析，而不是依据前后 `blockId` 集合差。
- Why：当前 `blockId` 由 `blockIndex` 派生，结构插入后下游 block 会整体漂移，集合差会天然误认旧块。
- How：在 anchor 后插入一个段落，再检查 `createdBlocks` 与插入后 outline 的对应关系。
- Oracle：`createdBlocks` 只命中新插入段落，不包含下游旧段落。
- Not：不验证 table cell 创建。

##### `docx-insert-does-not-duplicate-downstream-blocks`

- 测试类型：`backend`
- What：replay projection 中插入后下游旧块不会重复、错位。
- Why：结构插入后的 replay 重绑若把新块误认成旧块，会直接造成 committed view 重复旧段落。
- How：对真实 docx 执行“插段落 + 插表格”，materialize committed view 后检查 outline 顺序。
- Oracle：下游旧段落只出现一次，新增段落与表格保持稳定顺序。
- Not：不验证 delete/replace 语义。

##### `docx-inserted-table-created-blocks-include-table-and-cells`

- 测试类型：`backend`
- What：表格插入后的 `createdBlocks` 同时包含 table 与 table_cell。
- Why：replay session 需要完整的新建结构元信息，否则插入表格容易只落 body block，缺少 cell 级引用。
- How：执行一次 `docx_edit(insert_blocks table after)`，直接检查 mutation result 的 `createdBlocks`。
- Oracle：返回 1 个 `table` 和全部对应的 `table_cell`。
- Not：不验证 direct apply 产物。

##### `docx-mixed-format-preservation`

- 测试类型：`backend`
- What：混合格式文本在编辑后的样式保留。
- Why：run 级样式保留是 docx 修改的重要风险。
- How：对包含 `bold / italic / underline / color` 的真实 docx 执行编辑，再通过 block 读取验证样式结果。
- Oracle：未修改部分样式保留，修改目标样式正确。
- Not：不验证 UI。

##### `docx-working-draft-hides-deleted-content`

- 测试类型：`backend`
- What：删除后的内容不会再出现在 AI 继续读取的 working draft 中。
- Why：working draft 是 AI 的当前有效视图，必须隐藏 deleted 内容，但不能丢失相邻未修改内容。
- How：对真实 docx 执行删除，再继续执行 `docx_search` 验证 deleted 文本消失、其余文本仍可读。
- Oracle：deleted 内容命中为 0，未修改内容仍稳定命中。
- Not：不验证 UI 展示层。

#### docx hand 类别

##### `hand-docx-single-file-multi-write-allowed`

- 测试类型：`backend`
- What：同一 `sourcePath` 一轮 hand 中允许连续多个 `docx_edit`。
- Why：hand 保持串行执行；跨 tool 调用的漂移由每次 `docx_edit` 基于最新 snapshot 绑定输入 blockId 解决，单个 `docx_edit(actions[])` 内的漂移由稳定 locator 串行解析解决，不再做同文件多写预拦截。
- How：构造同一文件上的 `docx_edit(replace_text) -> docx_edit(replace_text)` serial plan。
- Oracle：两次写入都成功，且不返回 `hand_docx_edit_failed`。
- Not：不验证单次 `docx_edit(actions=[...])` 内部串行 transaction。

##### `hand-docx-multi-file-single-write-allowed`

- 测试类型：`backend`
- What：一轮 hand 内对不同文件各写一次仍允许通过。
- Why：hand 不再按同文件写入次数做预拦截，多文件连续写也应继续保持稳定。
- How：真实执行 `fileA:docx_edit(replace_text) -> fileB:docx_edit(replace_text)`。
- Oracle：两次写都成功，两个文件各自进入最新编辑状态，且最新 outline 可读到更新后的内容。
- Not：不验证跨文件更多组合。

##### `hand-docx-same-file-read-write-read-allowed`

- 测试类型：`backend`
- What：同一文件在一轮中执行 `read -> write -> read` 仍允许通过。
- Why：hand 允许串行读写混排，围绕单次写的读回确认流程不应被误伤。
- How：真实执行 `docx_read_outline -> docx_edit(replace_text) -> docx_read_blocks`。
- Oracle：三步都成功，最后一次读取能看到写后内容，且不返回 `hand_docx_edit_failed`。
- Not：不验证额外的多次写。

##### `docx-write-then-outline-percent-sees-new-block`

- 测试类型：`backend`
- What：docx 写后立刻使用 `docx_read_outline(percent)` 读取当前 working draft 时，能看到新增块。
- Why：这直接覆盖 replay session stats 未同步导致 percent 漏块的回归问题。
- How：真实执行一次 `docx_edit(insert_blocks heading)`，随后立刻用 `ranges=[{type:'percent',fromPercent:0,toPercent:100}]` 读取。
- Oracle：outline 返回新增块，且 replay session 的 `stats.blockCount` 等于当前 active revision 的真实块数。
- Not：不验证更细的分页策略。

##### `docx-replay-stats-track-active-revision`

- 测试类型：`backend`
- What：replay session 暴露的 `stats` 会随着 revision 前进持续对齐当前 active snapshot。
- Why：`docx_read_outline(percent)`、写后读回与后续只读工具都依赖这份 stats 一致性。
- How：真实执行“插入一段 -> 再改写该段”，分别检查 `registerRevision` 后 replay session 的 `stats.blockCount`。
- Oracle：每次 revision 之后 `stats.blockCount` 都与当前真实 working draft 一致，不残留旧版本统计。
- Not：不验证 imageCount 等与 replay snapshot 无关的计数来源。

##### `docx-multi-round-created-block-edit`

- 测试类型：`backend`
- What：第 2/3 轮可继续编辑第 1 轮新增的段落和表格单元格。
- Why：cumulative replay 的核心价值就是多轮编辑可持续作用于新增结构。
- How：真实执行“插入段落 -> 改写新增段落 -> 插入表格 -> 更新新增 cell”。
- Oracle：新增段落与新增 cell 都可继续被定位和修改，最新 working draft 只暴露最新有效内容。
- Not：不验证 live 模型如何规划多轮编辑。

##### `docx-precondition-guard`

- 测试类型：`backend`
- What：未 `open`、无效 `sourcePath` 或无效修订引用时的前置保护。
- Why：这些是工具层最常见的异常入口。
- How：直接调用 `outline / read / edit` 覆盖非法输入。
- Oracle：返回明确失败，不产生新修订，不污染运行状态。
- Not：不验证上层重试策略。

##### `docx-apply-ops-invalid-snapshot-guard`

- 测试类型：`backend`
- What：`apply_ops` 产出无效 docx 时会被工程内部校验拦截。
- Why：validate 已下沉为工程门禁，必须有回归 case 守住“坏修订不能进入当前草稿”。
- How：对带损坏关系引用的真实 docx 执行 `docx_edit(replace_text)` 或结构编辑 action。
- Oracle：`apply_ops` 直接失败，且当前文档会话的修订引用不会推进到无效修订。
- Not：不验证上层如何决定重试或放弃。

#### text-file 类别

##### `text-file-read-write-contract`

- 测试类型：`backend`
- What：普通文本创建、范围读取、多个唯一编辑、replaceAll、AI-facing 简短结果、修改记录和结构化 diff。
- Why：普通文本工具是代码、Markdown 和配置文件处理的基础，必须保证 AI 不需要生成或解析 unified diff。
- How：真实调用 `text_file_read/text_file_edit`，连续执行 create、edit、replaceAll，再从统一修改记录读取 diff artifact 并用 before 内容重放。
- Oracle：文件内容正确；结果只包含简短文本；每次写入产生 `text_file` 修改记录与 artifact；结构化 diff 重放等于真实 after。
- Not：不验证 Workbench 视觉样式。

##### `text-file-atomic-guards-and-format-preservation`

- 测试类型：`backend`
- What：edit 多匹配失败、replaceAll 全部非重叠替换、不递归替换和 BOM/CRLF 保持。
- Why：歧义匹配或部分落盘会直接损坏用户代码，格式漂移会制造无关 diff。
- How：对真实 BOM/CRLF 文件执行歧义 edit、成功 replaceAll 和无匹配 replaceAll，并逐次比较 bytes。
- Oracle：失败时 bytes 不变；成功替换次数准确；新内容中的 oldText 不会被再次递归替换；BOM 与 CRLF 保持。
- Not：不支持正则 replaceAll。

#### pdf 类别

##### `pdf-inspect-read-search-contract`

- 测试类型：`backend`
- What：真实 PDF 的元数据、页级文本和搜索结果。
- Why：守住 PDF 文本阅读的基础契约。
- How：对 `深度学习.pdf` 执行 `pdf_inspect -> pdf_read_pages -> pdf_search`。
- Oracle：页数为 11，标题为“深度学习”，正文没有 NUL，且“过度拟合”能命中第 8 或第 9 页。
- Not：不识别页面图片。

##### `pdf-read-visuals-contract`

- 测试类型：`backend`
- What：指定页面会被渲染为可供其他工具使用的 PNG。
- Why：PDF 与图像识别需要通过普通图片路径解耦协作。
- How：渲染第 1、9 页并检查文件路径、PNG 文件头、源文件哈希和事件。
- Oracle：路径为 `.ncurator/runtime/assets/<uuid>/page-N.png`；图片真实存在；源 PDF 不变；不产生普通 artifact。
- Not：不在 PDF 工具内部做图像识别。

##### `pdf-result-size-contract`

- 测试类型：`backend`
- What：PDF 工具结果在页数、文本和视觉输出过大时遵守统一大小边界。
- Why：结果失控会污染上下文并掩盖后续工具调用。
- How：构造不同大小的 PDF 读取与视觉结果，检查截断、错误和原始文件不变。
- Oracle：结果不超过约定上限；超限返回可识别错误或受控截断，不生成伪造内容。
- Not：不评价模型最终回答措辞。

##### `pdf-failure-boundary-contract`

- 测试类型：`backend`
- What：PDF 输入边界会明确失败。
- Why：防止路径逃逸、伪 PDF、非法 regex 和越界页码进入不确定状态。
- How：分别传入越界页码、非法 regex、错误文件头以及指向工作区外的链接；Windows 使用无需提升权限的目录 junction，Unix 使用目录 symlink。
- Oracle：每种输入都返回明确失败，不读取工作区外文件。
- Not：不做密码破解或损坏文件修复。

#### ppt 类别

##### `ppt-create-read-edit-commit`

- 测试类型：`backend / tool`
- What：`create_presentation.html[]` 一次创建多页、读取、编辑、每次写后立即回读，以及 Run 收尾生成单一页面级 diff 记录。
- Why：PPT 工具必须同时守住直接写回和 run 级差异聚合。
- How：创建真实多页 PPT，连续读取和编辑，再执行 Run 收尾。
- Oracle：每次 `ppt_edit` 成功后正式文件立即存在、可解析且页面内容正确；Run 收尾后同一文件只生成一条修改记录和页面级 diff。
- Not：不验证 human 的工具选择或页面审美。

##### `ppt-professional-element-edit`

- 测试类型：`backend / tool`
- What：元素位置、样式、图层、复制、线条、图片、表格、图表和公式更新。
- Why：专业 PPT 编辑依赖元素级能力，不能只覆盖整页创建。
- How：对真实 PPT 依次执行代表性的元素级编辑并重新读取结果。
- Oracle：操作成功；`postWriteReadback` 返回可继续使用的真实 elementId；最终 pptx 可解析。
- Not：不评价页面设计质量。

#### kb 类别

##### `kb-list-documents-contract`

- 测试类型：`backend`
- What：`kb_list_documents` 在当前工作区默认范围内的真实列表、`sourceNameQuery` 文档名过滤与缩圈契约。
- Why：KB 资料发现必须真实调用生产检索存储。
- How：通过真实 `DocumentsStore.addDocument / addChunks` 导入多工作区 fixture 后执行列表查询。
- Oracle：结果默认只包含当前工作区文档，`documentIds` 只做进一步缩圈，空结果与非空结果都稳定可断言；文件资料返回 `source_type=file` 与真实 `file_path`，网页资料返回 `source_type=web` 与真实 `source_url`。
- Not：不验证问答文案。

##### `kb-evidence-search-family-contract`

- 测试类型：`backend`
- What：`kb_search` 在不同 strategy 下的统一真实检索契约。
- Why：KB tool family 必须显式覆盖每个回归工具。
- How：对多工作区真实 seed 数据分别执行三种检索，并覆盖 `documentIds` 缩圈。
- Oracle：三种检索都返回稳定 `rows`，默认受当前工作区约束，且遵守 `documentIds` 缩圈语义；文件命中保留 `source_type=file` 与 `file_path`，网页命中保留 `source_type=web` 与 `source_url`，供最终引用生成可追溯地址。
- Not：不比较召回优劣。

#### terminal 类别

##### `terminal-directory-inspection-safe`

- 测试类型：`backend`
- What：AI 可仅通过 `terminal_run` 真实执行目录浏览与文本读取类安全指令。
- Why：terminal 工具最典型的安全执行路径。
- How：调用 `terminal_run` 执行当前平台 shell 命令，分别完成目录浏览与文件读取。
- Oracle：返回真实 stdout 片段、退出码与可消费摘要。
- Not：不验证写操作。

##### `terminal-text-search-safe`

- 测试类型：`backend`
- What：AI 可仅通过 `terminal_run` 真实执行安全文本搜索指令。
- Why：搜索是 terminal 工具最常见的辅助路径。
- How：调用 `terminal_run` 执行当前平台 shell 搜索命令。
- Oracle：返回可断言命中信息与正确退出状态。
- Not：不验证修改文件。

##### `terminal-result-unusable-docx-output`

- 测试类型：`backend`
- What：`terminal_run` 读到明显非文本/结构化文档输出时，会省略原始输出并回流 decision hint。
- Why：terminal 不能把 Word / Excel / PPT / PDF 等结构化文档的二进制内容带入后续 brain prompt。
- How：真实创建 docx 后执行 `terminal_run(cat report.docx)`，并对普通文本文件执行 `cat notes.txt` 作为低误伤对照。
- Oracle：docx 输出返回 `ok=false / reason=result_unusable / hand_tool_result_unusable`，stdout/stderr 不包含原始 `PK` 乱码；普通文本输出保持可读。
- Not：不验证所有二进制格式的 MIME 识别覆盖率。

##### `terminal-risk-and-boundary-guard`

- 测试类型：`backend`
- What：危险命令与普通文件写入命令都会按统一风险策略进入审批，审批拒绝后不会执行。
- Why：terminal 风险边界必须靠回归测试长期守住，并区分“等待/拒绝审批”和“执行失败”。
- How：在临时 workspace 中准备受保护文件，通过 deny-all 审批策略分别调用删除命令和创建目录命令。
- Oracle：两条命令各产生一次审批要求并返回 `approval_denied` 与 `not_executed`；受保护文件仍存在、目标目录未创建，不产生 `terminal_step_error`。
- Not：不验证 UI 提示。

##### `terminal-inline-edit-artifact-contract`

- 测试类型：`backend`
- What：terminal 只执行真实文件命令，不根据命令字符串直接生成修改记录或 artifact。
- Why：terminal、脚本和内部文件工具必须共享 Run 前后扫描这一套文件变化真相，避免重复记录和漏记无法静态分析的命令。
- How：通过 terminal 修改已有文件并创建新文件，检查工具结果、文件结果、工具期修改记录和 `file_artifact` 事件。
- Oracle：命令真实生效并经过审批；terminal 工具结果不包含 `artifacts`；工具执行阶段没有修改记录或 `file_artifact`，后续由顶层 Run 扫描统一捕获。
- Not：不在工具级 case 重复验证 WorkspaceChangeTracker；统一扫描由对应 tracker 和 Workbench 测试覆盖。

##### `terminal-inline-interpreter-execution`

- 测试类型：`backend`
- What：终端 inline interpreter 能在受控工作区执行内联 Node/Python 代码并返回真实结果。
- Why：AI 需要可靠的短脚本执行入口，不能把解释器调用误当成普通 shell 文本。
- How：通过 terminal 工具执行内联代码，检查命令、输出、工作目录和边界错误。
- Oracle：返回真实标记和正确退出状态；越界或不可用解释器被明确拒绝。
- Not：不替代持久终端会话的生命周期测试。

##### `terminal-persistent-session-contract`

- 测试类型：`backend`
- What：真实 PTY 持久终端保留当前路径、长命令让出控制权、增量读取和停止。
- Why：后台服务和长任务不能继续依赖单次 shell 超时或系统孤儿进程。
- How：在同一 terminalId 中真实执行 cd、pwd 和持续输出命令，同时新开第二终端；短命令若先返回 running，则通过 terminal_read 等到 idle 后再复用；长命令使用 terminal_read 读取输出并用 terminal_stop 停止。
- Oracle：同一终端保留路径，新终端从 workspace 根目录启动；长命令返回 command_still_running 且进程仍在；读取能取得真实增量输出；正常停止后终端回到 idle，强制停止后终端进入 closed，且均无子进程残留。
- Not：不验证 Workbench 浏览器联动，该能力由真实 e2e 覆盖。

#### web-browsing 类别

##### `web-crawl-page-contract`

- 测试类型：`backend`
- What：`web_crawl` 会返回 `requestedUrl/finalUrl`、标题、`markdown`、发布时间与分组 links；其中 `markdown` 内容来源于 crawl4ai 的 `fit_markdown`。
- Why：程序级网页抓取是低成本网页能力入口，必须稳定返回可被 brain 继续消费的网页事实和导航线索，同时保留 crawl4ai 的分组 links 与评分语义。
- How：启动本地 HTTP server，返回文章页 HTML，并通过真实冻结 sidecar bin 返回抓取结果。
- Oracle：结果包含 `requestedUrl`、`finalUrl`、`title`、`markdown`、`publishedAt`、`links.internal/external`，且 links 项包含 `intrinsicScore/contextualScore/totalScore`。
- Not：不验证复杂浏览器交互或外网可达性。

##### `web-search-contract`

- 测试类型：`backend`
- What：`web_search` 返回 query 与结构化候选网页结果。
- Why：网页搜索负责提供后续可读取的候选入口，不能只返回不可追踪的拼接文本。
- How：通过真实 web tool harness 调用 `web_search`，使用可控搜索服务返回候选页面。
- Oracle：结果保留原 query，候选项包含稳定 rank、标题和 URL，且第一条结果指向预期页面。
- Not：不验证候选页面正文读取；正文读取由 `web_crawl` 与 Workbench 网页读取 case 覆盖。

##### `web-crawl-entry-page-contract`

- 测试类型：`backend`
- What：`web_crawl` 只读取输入 URL 对应网页，并保留该页 links。
- Why：当前 contract 不再让 `web_crawl` 自己多跳跟进，后续要不要继续探索由 human 自己看 links 决定。
- How：启动本地 HTTP server，返回包含通知页和指南页链接的入口页，并通过真实冻结 sidecar bin 抓取该页。
- Oracle：结果命中输入 URL 对应页面正文，同时 links 中保留该页相关链接。
- Not：不验证自动多跳或搜索引擎级网页发现。

##### `web-crawl-http-failure-contract`

- 测试类型：`backend`
- What：`web_crawl` HTTP 失败时会保留错误文本、最终 URL 和状态码。
- Why：网页读取失败也必须保持可诊断，避免 `human` 误把空结果当成“网页无信息”。
- How：启动本地 HTTP server，返回 404 页面，并通过真实冻结 sidecar bin 执行抓取。
- Oracle：结果返回明确错误文本，同时保留 `finalUrl` 和 `statusCode`。
- Not：不验证复杂重定向链或外站错误页样式。

##### `web-crawl-too-large-contract`

- 测试类型：`backend`
- What：`web_crawl` 结果过大时会走统一 `hand_tool_result_too_large` 兜底。
- Why：网页正文可能很长，回归工具必须复用统一大小守卫，而不是把超长正文直接塞进 prompt。
- How：启动本地 HTTP server，返回超长正文页，通过真实冻结 sidecar bin 抓取，并把 tool harness 的 `modelContextWindowTokens` 压低到触发阈值。
- Oracle：结果返回 `web_crawl result too large`，且带有统一 `decisionHint`。
- Not：不验证压缩摘要或自动截断策略。

##### `image-analyze-contract`

- 测试类型：`backend`
- What：`image_analyze` 成功时直接返回普通文本。
- Why：图像识别能力不要求结构化 JSON，human 需要拿到模型原始可读文本自己决策下一步。
- How：启动本地 OpenAI-compatible HTTP server 返回普通文本，调用 `image_analyze(path, instruction)`。
- Oracle：工具结果直接是字符串，不包额外结构。
- Not：不验证具体视觉模型质量。

##### `image-analyze-uncertain-text-contract`

- 测试类型：`backend`
- What：视觉模型返回“无法确认”类文本时，`image_analyze` 仍按正常结果透传。
- Why：无法确认不属于工具失败，而是模型识别结论的一部分。
- How：启动本地 OpenAI-compatible HTTP server 返回“无法确认”文本，调用 `image_analyze(path, instruction)`。
- Oracle：工具结果仍是成功字符串。
- Not：不验证 UI 渲染。

##### `image-analyze-unsupported-vision-contract`

- 测试类型：`backend`
- What：模型协议明确声明不支持图像识别时，`image_analyze` 返回稳定错误结果。
- Why：不支持图片输入属于模型能力边界，必须与普通“无法确认”文本和底层调用失败区分。
- How：启动本地 OpenAI-compatible HTTP server，返回 `supports_image_recognition=false`，再调用 `image_analyze`。
- Oracle：工具结果返回包含当前模型名的固定不支持图像识别错误，提示用户切换模型。
- Not：不验证 UI 中的模型切换操作。

##### `image-analyze-bottom-error-contract`

- 测试类型：`backend`
- What：视觉模型底层失败时，`image_analyze` 返回 error。
- Why：只有底层调用失败才应进入工具错误路径。
- How：启动本地 OpenAI-compatible HTTP server 返回失败响应，调用 `image_analyze(path, instruction)`。
- Oracle：工具结果返回 `{ error }`。
- Not：不验证 provider 重试策略。

##### `browser-use-keeps-one-tab-for-the-whole-run`

- 测试类型：`backend`
- What：同一 browser-use run 复用一个浏览器 tab，并在多次操作后保持上下文连续。
- Why：重复建 tab 会丢失页面状态、泄漏资源并改变 AI 工具语义。
- How：执行连续浏览器操作，记录 tab 标识和生命周期事件。
- Oracle：整个 run 只有一个 tab；后续操作使用同一上下文，run 结束后资源被清理。
- Not：不评价浏览器页面视觉质量。

##### `browser-use-service-unavailable-error`

- 测试类型：`backend`
- What：`browser_use` 在缺少内置浏览器服务时返回真实 diagnostic。
- Why：浏览器能力依赖 Electron 内置浏览器服务，服务不可用时必须进入现有工具失败兜底，而不是静默失败。
- How：在 tool harness 中不注入 `browserUseService`，直接调用 `browser_use(extract)`。
- Oracle：工具结果返回 `browser_use service unavailable`。
- Not：不验证 Stagehand 实际网页操作。

#### utility 类别

##### `wait-for-user-takeover-contract`

- 测试类型：`backend`
- What：AI 在需要用户接管时通过 wait 工具暂停并正确恢复或结束。
- Why：接管是 AI 架构的阻塞态，状态、提示和恢复边界必须稳定。
- How：构造 takeover 请求，观察事件、等待结果和用户响应后的终态。
- Oracle：只产生一个可识别的等待状态；响应后继续执行或安全结束，不重复调用和伪造完成。
- Not：不覆盖 Workbench 接管面板的视觉交互。

##### `wait-time-contract`

- 测试类型：`backend`
- What：`wait_time` 会等待指定秒数并返回实际等待毫秒数。
- Why：浏览器和其他异步任务需要一个明确的等待工具，避免把等待塞进其他工具参数。
- How：调用 `wait_time(seconds=0.05)` 并比较工具返回值与墙钟时间。
- Oracle：返回 `waitedMs`，且实际等待时间接近请求时长。
- Not：不验证浏览器页面加载状态。

#### human hand 类别

##### `hand-call-limit`

- 测试类型：`backend`
- What：`hand` 会在执行前拦截超过单轮调用上限的 `calls`。
- Why：`calls` 数量上限是工具执行失控前的第一道硬边界，不能等到部分工具已执行后才发现超限。
- How：直接构造 `HUMAN_HAND_CALL_LIMIT + 1` 个安全 terminal 调用交给真实 `hand` node。
- Oracle：返回 `hand_call_limit_exceeded` decision hint，detail 中包含 limit 与 callCount，且不会产生 `lastToolResults`。
- Not：不验证 hardActionLimit 的执行后收敛；该场景由 `hand-tool-limit-and-artifact-merge` 覆盖。

##### `hand-schema-preflight-invalid-input`

- 测试类型：`backend`
- What：`hand` preflight schema 失败时稳定返回 `invalid_input`，并保留具体 diagnostic。
- Why：模型常见错误是把工具参数包错层级，preflight 必须在真实工具执行前给出可恢复的结构化失败。
- How：向真实 `hand` node 提交双层嵌套的坏 `docx_edit` 参数。
- Oracle：工具结果为失败，diagnostic 指向 `calls[0].args`，并提升为 `hand_call_invalid` decision hint。
- Not：不验证 brain 如何根据该 hint 重写计划。

##### `hand-docx-edit-invalid-blockid-failed`

- 测试类型：`backend`
- What：`docx_edit` 使用不存在或过期 blockId 时失败，并返回统一 `hand_docx_edit_failed`。
- Why：无效 blockId 是 docx 多轮编辑的高频失败入口，必须稳定进入可恢复 hint，而不是静默写错位置。
- How：创建真实 docx 后，通过 `hand` 调用 `docx_edit(insert_blocks)`，anchorBlockId 使用不存在的 `b:99`。
- Oracle：`docx_edit` 返回失败；pending decision hint 为 `hand_docx_edit_failed`，detail 包含 toolName、sourcePath、action 与具体错误。
- Not：不验证 human 最终交付话术。

##### `hand-terminal-approval-batch`

- 测试类型：`backend`
- What：`hand` 会对当前 `calls` 中需审批的 `terminal_run` 做批量预检，并在整批未全部同意时 0 执行。
- Why：terminal 审批责任已经前移到 `hand` preflight，回归 case 必须长期守住“先整批审核，再决定是否执行”的主流程。
- How：通过真实 `human` hand 决策构造两个需审批 terminal 命令，并让审批批次返回 `approve + guide` 混合结果。
- Oracle：事件流出现 `approval_batch_required / approval_batch_decision`；整批在审批前不发生真实 tool execution；磁盘上不会产生任何副作用；`decision_hint(code='terminal_approval_blocked')` 会回流到 `brain`。
- Not：不验证前端审批卡片交互。

##### `hand-serial-docx-chain`

- 测试类型：`backend`
- What：`hand` 会按顺序执行真实 docx 写入与读回确认链路。
- Why：复杂 docx 链路依赖当前最新修订，必须通过回归 case 守住顺序执行契约。
- How：通过真实 `hand` 执行 `docx_edit(replace_text) -> docx_read_blocks`。
- Oracle：工具结果顺序稳定、全部成功，且不会在 hand 内直接产出 docx 交付 artifact。
- Not：不验证 `brain` 是否自然生成这条计划。

##### `hand-tool-limit-and-artifact-merge`

- 测试类型：`backend`
- What：`hand` 的工具次数限制与 artifact 合并行为。
- Why：工具执行层的关键边界。
- How：先执行不会直接产生 artifact 的 terminal 工具，再向后续状态注入已有 docx artifact，执行不产生 artifact 的 docx read，并触发 hardActionLimit 收敛。
- Oracle：terminal artifact 延迟到顶层 Run 扫描；显式已有 artifact 不被后续无 artifact 工具覆盖；超过 hardActionLimit 后产生 `hand_tool_limit_exceeded` decision hint、交付说明和当前工具结果。
- Not：不验证 `human` 全链路。

### 4.2 `human`

#### mock-llm 类别

##### `ai-run-service-human-only`

- 测试类型：`backend`
- What：`AiRunService` 在 mock-llm 模式下会直接进入真实 `human` graph。
- Why：run 入口已经是 human-only 运行时，必须有回归 case 长期守住这条入口事实。
- How：通过 `AiRunService.getInstance().run(...)` 启动一次真实 run，再用 scripted structured output 驱动 `brain -> learning -> hand -> mouth` 完成闭环。
- Oracle：真实出现 `human_brain`、`human_learning`、`human_hand`、`human_mouth` 四个 stage，`AiRunState.finalDeliveryMarkdown` 正常落地，且 `AiRunService` 自身不直接发 `run_completed`。
- Not：不验证更复杂 live 业务链路。

##### `ai-run-service-embedding-preflight`

- 测试类型：`backend`
- What：`AiRunService` 会在进入 `human` 前执行有界 embedding preflight，并支撑后续 semantic docx 搜索。
- Why：embedding 是 semantic 工具链的基础设施；preflight 应在模型可用时提前完成，但不能无限阻塞 AI run 启动。
- How：通过 `AiRunService.getInstance().run(...)` 启动真实 run，在 preflight 成功后执行 `docx_search(mode=semantic)`。
- Oracle：preflight 被调用一次；任务完成；semantic 搜索返回带 score 的真实命中。
- Not：不验证 preflight 超时后的工具层降级；该场景由 Workbench 持久化 E2E 和 `kb_search(keyword/auto)` 相关 case 覆盖。

##### `ai-run-service-embedding-preflight-failure`

- 测试类型：`backend`
- What：embedding preflight 失败时，`AiRunService` 会在进入 `human` 前直接失败收口。
- Why：基础服务明确失败时继续进入 human graph 会制造后续工具层噪音，应该在入口阶段明确失败；初始化卡住则由有界 preflight 超时保护。
- How：注入会抛错的 `ensureEmbeddingReady`，启动一次真实 `AiRunService` run。
- Oracle：run 状态为 `failed`，只返回统一的用户可见错误，不泄露底层 preflight 原文，事件流中没有任何 `human_step`。
- Not：不验证模型下载进度展示。

##### `learning-hand-mouth-smoke`

- 测试类型：`backend`
- What：`human` 在 mock-llm 模式下能稳定走通真实 `brain -> learning -> hand -> mouth` 主链路。
- Why：`human` graph 的最小真实闭环，后续所有复杂样例都建立在这条主链路之上。
- How：通过 scripted structured output 先学习一个真实 external skill（例如 `docx-read`），再直接执行一次 builtin terminal 工具 `terminal_run(pwd)`，最后进入真实 `mouth` 完成交付。
- Oracle：`human_brain`、`human_learning`、`human_hand`、`human_mouth` 四个 stage 都真实出现，且至少有一次真实 terminal 工具结果与一次真实最终交付。
- Not：不验证复杂分支、异常恢复或 live 模型质量。

##### `learning-tool-budget-tracking`

- 测试类型：`backend`
- What：真实 `learning` 会持续记录当前 active tool 数，并在预算未超限时保留当前已学习 skill 集。
- Why：`learning` 的 active tool 预算是后续扩展 `excel / ppt` 等新能力时的重要长期边界，回归 case 需要先守住基础统计与状态可见性。
- How：通过 scripted structured output 依次学习 `docx-read`、`docx-write`，再故意请求 builtin skill（如 `terminal + kb-retrieval`）；检查最后一轮真实 `human_learning` 事件中的 `learnedSkillIds`、`availableToolNames` 与 summary，并确认出现 builtin learning decision hint。
- Oracle：任务最终完成；最后一轮真实 `human_learning` 事件中只保留 external skill，`availableToolNames` 同时包含 builtin 与 learned external 的工具集合，summary 包含 `当前 active tools=` 且不包含 skill 淘汰文案；builtin skill 不占 active tool budget，但后续真实执行时仍计入工具调用次数限制。
- Not：不验证超过 `20` 个 active tools 后的淘汰算法细节。

##### `decision-hint-retry`

- 测试类型：`backend`
- What：duplicate external learning 触发真实 `decision_hint` 后，graph 会回到 `brain` 并继续推进。
- Why：`decision_hint -> brain` 是 `human` 的核心收敛边之一，断掉后很多异常都无法恢复。
- How：第一轮先学习一个 external skill（如 `docx-read`），第二轮故意重复学习同一个 external skill 触发 learning decision hint，随后再执行一次真实 `terminal_run(pwd)` 并完成交付。
- Oracle：事件流中真实出现 source 为 `learning` 的 `decision_hint`，并且在它之后仍发生真实 terminal 工具调用，任务最终完成。
- Not：不验证 live 模型是否会自然产生这类重复决策。

##### `brain-output-schema-invalid-retry`

- 测试类型：`backend`
- What：`brain` 输出 hand plan schema 不合法时会产出 `brain_output_schema_invalid` decision hint，并在纠偏后继续完成任务。
- Why：结构化输出偶发坏参数是 LLM 链路的真实风险，graph 必须把它转成可恢复 hint。
- How：scripted brain 先返回带非法字段的 `docx_edit` hand plan，再返回完成任务决策。
- Oracle：任务最终完成；事件流出现 source 为 `brain` 的 `brain_output_schema_invalid` decision hint，且 detail 中包含 `nextAction.calls` 相关 issue。
- Not：不验证具体工具执行，因为坏 plan 应在执行前被拦截。

##### `decision-hint-contract-and-recovery`

- 测试类型：`backend`
- What：`decision_hint` 这一区域的回归 contract 稳定，且 `learning / brain / hand` 的关键来源分支都能在真实 graph 中产出 hint 并继续恢复推进。
- Why：`decision_hint` 是 `human` graph 的统一纠偏机制；一旦某个 hint 的结构或渲染链断裂，原本可恢复的分支就会在真实任务中升级成致命异常。
- How：在 mock-llm 下仍走真实 `human` graph、真实 learning node、真实 hand node 和真实工具；通过 scripted brain 依次触发 `learning_no_effect`、`brain_output_schema_invalid`、`hand_docx_positioned_write_blocked` 与 `hand_tool_limit_exceeded`，最后进入 `mouth` 收尾。
- Oracle：事件流中真实出现上述关键 `decision_hint`，且它们都带有稳定 detail contract；在 hint 之后 graph 仍能继续回到 `brain` 并最终完成任务。
- Not：不要求一条 case 穷举所有业务工具组合；重点是守住 `decision_hint` 的共享 contract 和关键来源回退链。

##### `tool-failure-recovery`

- 测试类型：`backend`
- What：真实工具失败结果会被 `human` 吸收，并继续收束到最终交付。
- Why：工具失败是高频真实场景，如果失败后链路无法继续，`human` 就不具备稳定执行能力。
- How：直接真实执行一个会失败的 builtin terminal 安全指令，随后由 `brain` 决定停止重试并进入 `mouth`。
- Oracle：真实 `terminal_run` 结果为失败，且 `human` 最终仍进入 `completed` 并产出最终交付。
- Not：不验证失败后的最佳补救策略是否最优。

##### `tool-limit-converge`

- 测试类型：`backend`
- What：真实 `hand` 在超过 `hardActionLimit` 后会发出收敛型 `decision_hint`。
- Why：工具调用上限是 autonomous 执行的重要失控保护，必须通过真实执行链守住。
- How：把 `hardActionLimit` 设为 `1`，先后真实执行两次只读 terminal 命令，让第二次调用命中上限保护。
- Oracle：事件流中出现 source 为 `hand` 且摘要包含“超过临时上限 1”的 `decision_hint`，任务最终完成。
- Not：不验证更高层是否继续扩展计划。

##### `approval-denied-restricted-delivery`

- 测试类型：`backend`
- What：真实批量审批拒绝会阻止需审批命令落地，并把限制带入最终交付。
- Why：审批拒绝是生产边界，不能只靠 fake 测试覆盖。
- How：设置 `approvalPolicy=deny-medium-high`，直接尝试真实执行 builtin terminal 命令 `mkdir blocked-dir`，然后进入最终说明。
- Oracle：事件流真实出现 `approval_batch_decision` 且至少一项为 `reject`；对应 terminal 命令不会真实执行；`decision_hint(code='terminal_approval_blocked')` 回流给后续 brain；磁盘上不会真的创建 `blocked-dir`，任务最终完成。
- Not：不验证用户如何在 UI 中恢复被拒绝的动作。

##### `brain-memory-write-boundary`

- 测试类型：`backend`
- What：第一轮 `brain` 写入的 thought memory 字段会在下一轮真实 `brain` prompt 中继续可见。
- Why：memory 跨轮延续是 `human` 长链路推理的核心能力，必须由真实 graph 保证。
- How：第一轮 `brain` 通过 `thought.todolist/progressionSummary` 更新任务推进记忆，并触发一次真实 learning；第二轮 `brain` 读取真实 prompt，检查这些内容是否还在。
- Oracle：第二轮 `brain` prompt 中出现前一轮写入的 todolist 与 progressionSummary 内容，任务最终完成。
- Not：不验证更复杂的 memory 压缩策略。

##### `conversation-memory-multi-run-recall`

- 测试类型：`backend`
- What：同一 `session` 下已有 covered `conversation memory` 与 covered 边界后的 recent turns 会在下一次真实 `brain` prompt 中共同带回。
- Why：跨任务连续性依赖持久 `conversation memory` 与未 covered 最近消息协同工作；只验证单次 summary happy path 无法证明 batch 边界后的内容仍可被召回。
- How：seed 一条带 `coveredMessageId / coveredTimestamp / coveredMessageCount` 的发布准备 summary，再 seed covered 边界之后的新 user/assistant turns；随后启动同一 session 的真实 `human` graph 并检查 prompt 与最终交付。
- Oracle：`brain` prompt 同时含 `<conversation_history>`、`<summary>` 与 `<recent_turns>`；summary 中旧状态不会继续出现；recent turns 中的新问题和产物状态可见；最终交付会提到 Bob、上线窗口冲突和下一步安排。
- Not：不验证 live 模型总结质量；不验证 session 隔离。

##### `ai-run-service-resume-snapshot`

- 测试类型：`backend`
- What：`AiRunService` 在同一 `session` 下会对 `timeout / network_error` 保存恢复快照，并在下一次 run 自动恢复语义上下文继续完成。
- Why：中断恢复依赖最小持久化快照，而不是在同一 run 内盲目重试；这条 contract 需要回归保护。
- How：首轮通过真实 `AiRunService` 启动一次 run，让真实 `brain` 先写入可恢复状态后命中 `timeout`；第二轮在同一 session 下不再显式传引用范围与工作区，验证真实 run 会自动恢复并继续完成；同时补一条 `network_error` 分支和一条普通 `error` 分支。
- Oracle：`timeout / network_error` 失败态会写出 `failureCode` 与 `resumeSnapshotSaved=true`，`ChatStore` 中保留最新恢复快照；下一轮同 session 会从 `context_budget -> brain` 重新开始，但带回恢复快照中的已学 skill / task run 语义，并在 brain prompt 中出现 `run_resumed_after_interruption` hint；成功完成后恢复快照被清空；普通 `error` 不保存恢复快照。
- Not：不验证 docx 临时运行态恢复；不验证 live provider 的真实网络抖动概率。

##### `context-compaction-ratio-and-fact-retention`

- 测试类型：`backend`
- What：mock-llm 下的真实 `context_compaction` 节点会保留关键事实、压缩到目标比例，并让后续 `brain` 通过 `<compactions>` 继续工作。
- Why：只验证“触发了压缩”还不够；回归测试还需要守住失败原因、约束和当前结论不被压丢，以及比例不失控。
- How：人工构造 6 轮历史，覆盖学习、首次事实读取、错误尝试、失败原因、仍生效约束、修正后的当前结论和 latest round；先直接执行真实 `context_compaction` 节点，再执行真实 `brain` 节点检查 prompt。
- Oracle：事件流出现 `context_compaction_started / context_compaction_completed`；只保留一个 `rounds` compaction block；`latest_round` 保留原文；压缩摘要保留审批未完成、未审批不可发布、Bob 和上线窗口冲突；后续 `brain` prompt 使用 `<compactions>` 且旧 history 不再以未压缩 rounds 渲染；`tokenEstimateAfter / sourceHistoryTokenEstimate <= 0.35`。
- Not：不验证 live 模型自由生成下的压缩质量；不验证多次滚动压缩合并。

##### `session-skill-memory-multi-run`

- 测试类型：`backend / mock-llm`
- What：同一 AI session 的多轮 human run 能复用已学习技能记忆。
- Why：技能记忆是 AI 架构跨轮次协作的核心，不应每轮重复 learning。
- How：第一轮学习并使用技能，第二轮继续同一任务，检查 brain 输入和 human steps。
- Oracle：第一轮写入技能；第二轮能看到技能且不重复 learning；两轮均正常完成。
- Not：不覆盖 Workbench UI 会话持久化，该路径由 Workbench E2E 覆盖。

##### `todolist-memory-maintenance`

- 测试类型：`backend`
- What：todolist 作为长期任务板会在 mock-llm 下跨轮维护 todo、done 与 obsolete 状态。
- Why：如果 todolist 不能跨轮保留并被重写成最新任务板，brain 很容易把长期记忆退化成单轮摘要。
- How：第一轮 `brain` 写入只含 todo 的 todolist，并触发一次真实 learning；第二轮 `brain` 读取真实 prompt 后，将 todolist 重写为包含 done、todo 与 obsolete 的新版本。
- Oracle：第二轮 `brain` prompt 中能看到第一轮写入的结构化 todolist 项，任务最终完成，且新的 todolist 成功写回 thought memory。
- Not：不验证除 `mouth` 收口前的 todo 检查之外的更复杂 todolist 机读策略。

##### `complex-docx-edit`

- 测试类型：`backend`
- What：mock-llm 下 `human` 仍通过真实 docx 工具链完成打开、编辑和搜索。
- Why：复杂 docx 编辑是 `human` 的长期高价值真实任务类型。
- How：先写入 fixture docx，再通过真实 `docx_edit(replace_text) -> docx_read_blocks -> docx_search` 完成一次正文替换、读取确认和定位。
- Oracle：真实 `docx_edit(replace_text)` 只产生一处 `changedBlocks`，真实 `docx_search` 与 `docx_read_blocks` 都能命中新文本，任务最终完成。
- Not：不验证 UI 或最终落盘流程。

##### `complex-docx-insert-structured-content`

- 测试类型：`backend`
- What：mock-llm 下 `human` 可以按对象类型提交段落与表格编辑参数。
- Why：复杂 docx 编辑不能只覆盖文本替换，还要保护 structured content 插入这类高价值写作场景。
- How：先读取真实 docx outline，定位 anchor 后通过真实 `docx_edit(insert_blocks)` 插入段落和表格，再读回确认。
- Oracle：任务最终完成；docx apply artifact 与 file artifact 正常生成；写入内容包含新增段落和表格结构。
- Not：不验证 live 模型是否自然选择同样的结构化参数。

##### `docx-read-fact-exposure`

- 测试类型：`backend`
- What：human 在 mock-llm 模式下能收到 docx 读取链路中的关键客观事实，包括 outline 截断说明与归一化后的搜索命中。
- Why：这一层如果事实暴露不足，human 很容易把“当前结果被截断”或“搜索已命中”误读成别的状态。
- How：构造包含长文档截断与兼容字形文本的真实 docx，通过 scripted brain 先执行 `docx_read_outline`、再执行 `docx_search` 与 `docx_read_blocks`，检查后续 prompt 是否包含相关事实。
- Oracle：后续 `brain` prompt 中可读到截断文字说明、归一化搜索命中与区间精读正文，最终任务完成且不会把文档中已写内容误报为“未写”。
- Not：不验证 live 模型在该场景下的自主策略优劣。

##### `docx-search-alias-then-range-read`

- 测试类型：`backend`
- What：mock-llm 下 `human` 会先做 alias fallback 搜索，再进入区间精读。
- Why：docx 新工作流里最关键的自主使用模式，必须有 scripted 回归。
- How：构造只写“过度拟合”的真实 docx，scripted brain 先执行 `docx_search(query=过拟合)`，再以返回 blockId 执行区间 `docx_read_blocks`。
- Oracle：`docx_search` 返回 alias fallback 事实，`docx_read_blocks` 返回定义/成因/处理线索，任务最终完成。
- Not：不验证 live 模型是否一定会采用相同工具顺序。

##### `multi-tool-collaboration`

- 测试类型：`backend`
- What：`human` 会通过真实 `hand` 执行一次顺序多工具协作。
- Why：`human` 不能只验证单工具 happy path，还必须覆盖真实多工具串行读工具场景。
- How：先 seed 真实 KB 文档，再学习 terminal 与 KB skill，随后在一次 `hand` 决策中按顺序执行 `terminal_run(pwd)` 与 `kb_list_documents`。
- Oracle：同一条任务中真实出现 terminal 与 KB 两类工具结果，任务最终完成。
- Not：不验证更复杂的多轮依赖型工具调度。

##### `human-pdf-read-visuals-collaboration`

- 测试类型：`backend / mock-llm`
- What：mock human 能组合 PDF 文本读取与 PDF 视觉读取，直接得到识图结果。
- Why：PDF 视觉能力属于 AI 架构工具协作，不应依赖 Workbench 或伪造事件。
- How：用本地视觉服务和脚本化 human 决策调用 `pdf_read_pages` 与 `pdf_read_visuals`。
- Oracle：两类工具均成功；视觉结果包含服务返回的信息；不调用旧的 render/image-analyze 路径。
- Not：不验证真实模型的自主决策。

##### `kb-answer-with-real-kb`

- 测试类型：`backend`
- What：mock-llm 下的 KB 回答仍通过真实知识库存储、真实 embedding 与真实检索执行。
- Why：KB 是当前最敏感的 fake 风险点，必须单独有回归 case 显式守住。
- How：seed 两份真实 KB 文档，学习 KB skill 后真实执行 `kb_search(strategy=keyword)`，再通过真实 `mouth` 生成最终回答。
- Oracle：真实 KB 检索结果中包含目标文档 `doc-1` 的证据，且这条证据文本会进入真实 `mouth` prompt，任务最终完成。
- Not：不验证答案措辞或检索召回优劣。

##### `create-ppt-deck`

- 测试类型：`mock-llm`
- What：AI 能学习 `ppt-read / ppt-write`，通过 `create_presentation.html[]` 一次创建多页并交付 PPT。
- Why：需要验证 human 主链能正确学习并调用 PPT 能力。
- How：使用 scripted LLM 输出驱动真实 human graph 创建并交付 PPT。
- Oracle：最终文件可解析且内容正确；只产生一个 PPT 修改记录和文件交付。
- Not：不验证真实模型的自主规划质量。

#### live 类别

##### `human-legacy-doc-reading-live`

- 测试类型：`backend / live`
- What：真实模型通过 docx-read 工具读取选中的旧版 .doc 文档。
- Why：真实 human 必须遵守旧格式只读边界并保持源文件不变。
- How：仅提供旧版文档和读取工具，检查工具事件、答案关键事实与文件 hash。
- Oracle：读取成功、答案包含预期事实、不调用编辑工具且源文件未改变。

##### `human-legacy-doc-edit-skip-live`

- 测试类型：`backend / live`
- What：真实模型尝试编辑旧版 .doc 后遵循 decision hint，停止重试并跳过。
- Why：不可写格式必须快速收敛，避免反复工具调用和误改原文件。
- How：要求直接编辑旧版文档，检查一次失败、提示事件、最终答复和文件 hash。
- Oracle：只尝试一次编辑；出现 legacy_doc_edit_unsupported；源文件不变且任务完成。

##### `human-create-ppt-deck-live`

- 测试类型：`live`
- What：真实模型能学习 `ppt-read / ppt-write`，读取工具描述中的 HTML 规则并自主创建多页 PPT。
- Why：真实模型必须能理解 PPT 规则并完成可交付文件。
- How：使用自然语言请求真实模型创建多页 PPT，并读取最终文件和修改记录。
- Oracle：最终文件可解析且内容正确；只产生一个 PPT 修改记录和文件交付。
- Not：不逐字断言最终回答，也不评价主观审美。

##### `human-conversation-memory-multi-run-live`

- 测试类型：`backend`
- What：live 模式下基于真实 workspace 的 conversation memory 会在双 run 间延续关键业务状态，并被后续真实 `brain` 正确带回。
- Why：真实环境里的会话连续性不能脱离 workspace 语义；如果记忆里提到的对象在工作区中不存在，模型会合理地转去做环境核验，导致样例失真。
- How：复用风险周报 live 的真实 workspace；第一轮只做“状态梳理，不新建文件”；随后构造达到 conversation memory 触发阈值的完整轮次，通过 live `conversation.memory` 调用总结应覆盖的 10 条旧消息，并保存 covered 边界；第二轮在同一 session、同一 workspace 下追问“当前最关键的待确认项、应该先找谁、为什么”，允许模型继续读取真实资料。
- Oracle：`summary` 非空且保留风险主线、负责人、待确认项与下一步；summary batch 为 10 条消息，保存的 `coveredMessageId / coveredTimestamp / coveredMessageCount` 与本次 compaction 边界一致，最新 5 个完整轮次保留为 recent turns；第二轮 `brain` prompt 同时出现 `<conversation_history>`、`<summary>` 与 `<recent_turns>`；即使模型重新读取文件，也不应偏离第一轮形成的连续业务主线；最终交付继续命中负责人、阻塞项和后续动作，并体现第一轮总结对第二轮真实判断的延续影响。按 10 分制评估，达到 8 分即可通过。
- Not：不要求第二轮禁止 reread workspace；不逐字约束 live 模型措辞；不验证 session 隔离。

##### `human-session-resume-with-new-selection-live`

- 测试类型：`backend`
- What：live 模式下第一诉求已经沉淀局部事实后发生网络中断，同一 session 新诉求可恢复旧语义上下文，同时本轮新选择文件会覆盖中断快照里的旧选择范围。
- Why：恢复能力的真实价值是让用户在长任务中断后继续对话；如果中断前已读到的事实丢失，或恢复时忽略最新诉求/最新选中文件，就会把恢复退化成重跑或错误沿用旧入口。
- How：使用已有共享 workspace fixture，即 `tests/fixtures/workspace`。Run 1 选中文件 A `深度学习.docx`，让真实模型读取并沉淀“过拟合/过度拟合”的定义、原因和处理信息；测试 driver 在确认工具结果中已经出现过拟合事实后，于后续 `human.brain` 调用注入 `network_error`，保存恢复快照。Run 2 恢复真实 LLM 配置，同 session 继续提问并显式改选文件 B `图形学.docx`，要求保留过拟合信息并补充反走样信息形成对比小结。
- Oracle：Run 1 注入失败为 `network_error` 且 `resumeSnapshotSaved=true`；恢复快照中能看到中断前沉淀的过拟合事实；Run 2 成功完成；Run 2 的 brain prompt / llm-io 中出现中断恢复 hint 文案，且包含本轮新选择文件 B 与恢复出的过拟合上下文；最终交付同时包含过拟合与反走样关键事实；Run 2 成功后恢复快照被清空。
- Not：不验证真实 provider 的随机网络抖动；不要求 live 模型逐字复述 hint 文案；不恢复 docx 临时运行态。

##### `human-runtime-inline-code-live`

- 测试类型：`backend / live`
- What：真实模型使用 runtime inline code 执行代码并返回确定性结果。
- Why：runtime 是 AI 架构的执行能力，必须验证真实解释器调用而非文本猜测。
- How：只开放 terminal/runtime 相关工具，检查执行命令、结果标记和资源边界。
- Oracle：实际执行 inline code 并返回预期标记；无伪造工具事件。

##### `human-runtime-script-assets-live`

- 测试类型：`backend / live`
- What：真实模型执行脚本并将临时产物写入受控 UUID runtime assets 目录。
- Why：脚本和产物是 AI 工具协作的真实交付边界，不能污染工作区。
- How：检查脚本执行、assets 路径、文件内容和清理结果。
- Oracle：脚本真实运行；产物位于 UUID assets 子目录；工作区没有安装/临时污染文件。

##### `human-runtime-download-node-live`

- 测试类型：`backend / live`
- What：本地 Node.js 不可用时，真实模型下载无需系统安装的 Node.js runtime 并完成代码执行。
- Why：AI runtime 必须能在缺少系统 Node.js 的环境中自主补齐真实执行能力。
- How：隐藏系统 Node.js，只开放 terminal 工具，要求模型把 runtime 安装到受控 `user_runtime` 目录后执行确定性代码。
- Oracle：下载后的 Node.js 真实执行并返回预期标记；安装文件只存在于指定 runtime 目录；工作区无安装产物。

##### `human-runtime-download-python-live`

- 测试类型：`backend / live`
- What：本地 Python 不可用时，真实模型下载无需系统安装的 Python runtime 并完成代码执行。
- Why：AI runtime 必须能在缺少系统 Python 的环境中自主补齐真实执行能力。
- How：隐藏系统 Python，只开放 terminal 工具，要求模型把 runtime 安装到受控 `user_runtime` 目录后执行确定性代码。
- Oracle：下载后的 Python 真实执行并返回预期标记；安装文件只存在于指定 runtime 目录；工作区无安装产物。

##### `human-context-compaction-natural-trigger-live`

- 测试类型：`backend`
- What：live 模式下 `human` 会基于真实 brain usage 与新增 history 增量在风险周报长任务中自然触发 `context_compaction`，并在压缩后继续完成交付。
- Why：相比单独直调节点，live 回归更应该守住“真实 graph 中自然压缩且不影响任务完成”的能力。
- How：复用风险周报 live 的真实 workspace 与业务输入，通过 `humanRuntimeOverrides.modelContextWindowTokens=16_000` 提供可工作的上下文空间，并让真实任务在多轮资料读取后自然进入 `context_budget -> context_compaction -> context_budget -> brain`。
- Oracle：至少发生一次完整 compaction；不限制压缩次数。逐次检查固定摘要结构、任务锚点、已确认路径、无编造和无“已完成又未读取”的进度矛盾，并检查全部压缩比；后续 `brain` prompt 保留 compaction 与 task progress；最终周报文件成功 apply。按 10 分制评估压缩生命周期、摘要结构、摘要质量、连续性和文件交付，严格超过 8 分通过。
- Not：不绑定压缩次数，不要求固定资料读取顺序，也不因合理表达差异判失败。

##### `human-risk-report-draft-live`

- 测试类型：`backend`
- What：live 模式下 `human` 会在一个真实长任务里串起模板定位、上周周报风格参考、多源工作资料取证、新建本周周报 docx 并直接写回交付。
- Why：`human/live` 需要至少一条长期高价值复杂样例，覆盖 workspace 搜索、真实材料辨别、跨 `docx + txt` 综合、create-target 写入与最终交付链路；同时守住“共享 workspace 中全部已支持文件都已进入真实 KB，且关键事实可能来自 KB 命中的 txt 或后续读取材料”的更真实用户环境。
- How：注入真实 live LLM 配置；workspace 直接使用 `tests/fixtures/workspace` 共享目录，并在 run 前通过真实生产文件 ingestion 链把该目录下当前所有已支持文件索引进 KB；随后由测试在运行时重建 `工作/` 目录：包含一份不可直接覆盖的周报模板、一份只能参考风格的上周已发版周报、多份提供本周事实的 `docx` 工作文档、数份必须读取的 `txt` 口径/跟进材料，以及少量看起来相关但不应直接采用的干扰文件；直接输入“帮我写下这周的周报，基于这个周报模版和我的工作文档信息，记得参考我上周写的周报风格来哦”的自然语言诉求，让真实 `human` 自主完成。
- Oracle：任务最终完成；共享 workspace 中全部已支持文件均被索引；事件流中至少出现一次 `terminal_run`、至少一次真实资料读取/检索步骤以及一次 `docx_edit(create_document)`；模型会打开模板和上周周报；最终输出 artifacts 中包含携带 `applyId` 的 docx file artifact；模板与既有参考 `docx` 文件不被覆盖。按 10 分制评估文件交付、原文件安全、未闭环风险、负责人动作和谨慎结论，严格超过 8 分通过；否定上下文中的“风险已解除”等文字不得误判成正向收口。
- Not：不绑定最终答案措辞，不要求固定是否使用 `docx_read_outline` 还是 `docx_read_blocks`，也不强制一定调用 KB；若模型仅凭工作区材料完成任务，也视为符合预期。

##### `human-docx-positioned-structural-edit-fallback-live`

- 测试类型：`backend`
- What：live 模式下 `human` 在复杂 positioned docx 中会跳过命中的复杂定位排版区域，并继续尝试处理其他可安全编辑的位置。
- Why：这类由 `framePr` / 绝对定位 shape 组成的 docx 即使只是原地改字也可能因结构重写而错位；这条 case 要长期守住“positioned 区域只读、自动写入必须拒绝并给用户手动提示”的能力，对齐 `WB-CORE-003-AC1`、`WB-CORE-004-AC1`、`WB-CORE-006-AC1`、`WB-CORE-006-AC2`。
- How：注入真实 live LLM 配置；只将 `图形学.docx` 作为已选资料复制进 workspace；直接输入“我准备把这份图形学讲义发给同学复习，想把‘反走样’这一节补得更容易记一些。你直接在这一节后面加一段更通俗的说明，再加一个很短的总结表，帮助大家快速区分两种常见做法。”的自然语言诉求，让真实 `human` 自主完成。
- Oracle：事件流中至少一次 `docx_search` / `docx_read_blocks` / `docx_read_outline` 覆盖 `图形学.docx`；至少一次 docx 写入请求因为命中复杂定位排版区域失败，并返回稳定 `hand_docx_positioned_write_blocked` 与 `diagnostic.message`；命中区域不得发生成功写入，但允许继续编辑其他非定位区域；允许改为生成独立补充稿，也允许在最终答复中直接交付可粘贴的完整说明和总结表。按 10 分制评估目标读取、保护触发、写入安全、手动说明、内容可用性和 artifact 一致性，严格超过 8 分通过，不把内部完成状态作为单独失败条件。
- Not：不要求固定使用哪一种 docx 写工具，也不要求最终答复使用固定措辞。

##### `human-kb-guided-docx-comparison-draft-live`

- 测试类型：`backend`
- What：live 模式下 `human` 会先用 KB 缩圈找出讲“反走样 / 过拟合”的两份源资料，再把内容分别回写到用户明确指定的两份目标 docx。
- Why：真实用户常常记得主题、不记得文件名，而且希望把资料内容整理回自己的教学文档；这条 case 要长期守住“工作区默认范围 + KB 缩圈 + 多源读取 + 多目标 docx 回写”的能力，对齐 `WB-CORE-002-AC2`、`WB-CORE-004-AC1`、`WB-CORE-006-AC1`、`WB-CORE-006-AC2`。
- How：注入真实 live LLM 配置；workspace 使用共享 fixture，只把 `学习笔记/图形学.docx` 与 `学习笔记/深度学习.docx` 建入 KB；用户明确指定根目录的 `人工智能探究课堂PRD.docx` 与 `交互式探究学习案例：产业转移.docx` 为目标文件。case 只开放完成该任务需要的 terminal、KB search、DOCX 读取和写入工具，避免把目标文件误当成待索引来源反复查询。
- Oracle：真实 `kb_search` 返回有效命中；两份目标文档分别发生成功写入并产生两组携带 `applyId` 的 file artifact；两份来源课件保持不变。按 10 分制评估 KB 证据、两份目标文件、grounded 内容、来源安全和最终交付，严格超过 8 分通过；只完成一个目标文件最多 8 分，不能通过。
- Not：不强制固定执行路径，也不要求 KB 缩圈后必须再打开所有候选资料。

##### `human-pdf-visual-reading-live`

- 测试类型：`backend / live`
- What：真实模型会自主组合 PDF 文本读取、页面渲染和通用图像识别。
- Why：PDF 工具不内置图片理解，必须验证工具解耦后 AI 仍能完成图文结合阅读。
- How：只选择 `深度学习.pdf`，询问第 1 页训练闭环和第 9 页 Proper fit / Overfit 图形差异，仅开放 PDF 四个工具与 `image_analyze`。
- Oracle：任务完成；调用 `pdf_read_pages`、包含第 9 页的 `pdf_render_pages` 和 `image_analyze`；第 9 页图像识别必须成功且全部图像识别失败数为 0；识别路径来自 render 输出并位于 `.ncurator/runtime/assets/<uuid>/page-9.png`；不调用 terminal、KB、docx；最终答复同时说明训练闭环和两组曲线差异，不能用“无法识别图片”等内容绕过；源 PDF 不变。
- Not：不固定工具调用顺序和最终措辞，不要求把 PDF 页面图片登记为 artifact。

##### `human-web-crawl-multi-hop-cross-domain-reading-live`

- 测试类型：`backend`
- What：live 模式下 `human` 会围绕用户给出的入口网址持续多次调用 `web_crawl`，跨域并多跳整理分散网页事实。
- Why：真实用户常会给一个入口站点，但答案往往分散在专题页、通知页、办理指南页和申报入口页；这条 case 要长期守住“给入口网址后继续探索链接、跨域推进并最终收口”的能力。
- How：启动两组本地 HTTP server：入口站点先提供城市公共服务导航与就业补贴专题页，再通过外链跳到另一域名下的人社通知页；通知页、办理指南页和申报入口页分别承载申请对象/截止时间、材料清单、线上办理方式等部分事实，且前序页面均有有效信息但不足以一次拿全；输入自然语言诉求，明确要求模型继续找、不要补网页未写内容。
- Oracle：任务最终完成；事件流中至少四次成功调用 `web_crawl`；`web_crawl` 成功结果覆盖专题页、通知页和申报入口页，办理指南页至少出现在显式访问 URL 或成功结果中，且访问 URL 覆盖至少两个域名；最终答复同时覆盖申请对象、材料、截止时间和线上办理方式四组网页事实；不出现 `browser_use` 或 `terminal_run`。
- Not：不要求固定访问顺序，也不要求单次 `web_crawl` 内部自动跨域；允许模型通过多轮显式 `web_crawl` 调用完成跨域推进。

##### `human-web-crawl-url-inference-reading-live`

- 测试类型：`backend`
- What：live 模式下 `human` 在用户不提供网址时，会先推断官网地址，再通过 `web_crawl` 完成官网文档整理。
- Why：真实用户有时只会描述“去官网帮我看某两个条目”，不会直接给具体网址；这条 case 要长期守住“先判断目标官网，再继续抓取资料页面完成任务”的能力。
- How：不向用户输入提供 URL，只给“基于 pandas 官网文档分别说明 `read_csv` 和 `DataFrame.to_csv` 及其最直接使用区别”的自然语言诉求；要求模型自行判断官网地址并通过 `web_crawl` 读取官网文档页面完成整理。
- Oracle：任务最终完成；事件流中至少两次调用 `web_crawl`；调用 URL 落在 `pandas.pydata.org` 官网文档域名上；最终答复同时说明 `read_csv` 与 `to_csv` 的用途，并概括它们一个偏读取 CSV、一个偏写出 CSV 的直接区别；不出现 `browser_use` 或 `terminal_run`。
- Not：不要求复杂跨域或深链路，也不要求模型第一次就命中最终文档页，只要最终能自行推断官网地址并完成整理即可。

##### `human-text-file-read-write-live`

- 测试类型：`backend`
- What：live 模型读取代码文件后，使用 `replaceAll` 修改统一关键词、使用 `edit` 修改唯一块，并回读确认。
- Why：工具契约正确不等于模型会正确选择 action；必须验证真实模型能区分唯一编辑和全部替换。
- How：只开放 `text_file_read/text_file_edit`，准备包含两处 `OLD_API_URL` 和一处 timeout 的真实 TypeScript 文件，要求全部改名并精确修改 timeout。
- Oracle：任务完成；至少一次 `replaceAll` 参数正确、一次 `edit` 参数有效；最终文件无旧关键词；写入工具结果不包含 diff、previewPath 或 unified patch。
- Not：不要求固定调用轮数，不验证 Workbench UI。

##### `human-terminal-preview-service-live`

- 测试类型：`backend`
- What：live 模型能在项目子目录启动临时 HTTP 预览服务，真实访问页面、读取服务日志并彻底停止服务。
- Why：工具契约正确不代表模型能理解 `command_still_running`，也不代表它会在完成检查后主动清理长时间运行的进程。
- How：在临时 workspace 的 `preview-site` 中创建带唯一标记的页面，为用户提供一个随机空闲端口；用户只描述“进入目录启动预览、确认页面、检查请求日志、用完关闭”的真实诉求，不指定工具或命令。仅开放三个 terminal 工具，由真实模型自主决策。
- Oracle：服务命令在 `preview-site` 中运行并返回 `command_still_running`；模型使用 `terminal_read` 读取服务终端，页面标记出现在真实终端结果和最终答复中；模型使用 `terminal_stop(closeTerminal=true)` 停止并关闭服务终端；端口最终不可访问；工具结果不包含 `availableActions` 或内部 `commandId`。
- Not：不绑定 Python、curl 等具体命令，不要求固定工具调用轮数，不验证 Workbench UI 或公网访问。
