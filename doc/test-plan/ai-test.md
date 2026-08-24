# NCurator-Desktop AI 测试计划

## 最新 Live 评估

| caseId | 状态 | 评分（0-100） | 模型 | 时间 | run 路径 | 简短依据 |
| --- | --- | ---: | --- | --- | --- | --- |
| human-risk-report-draft-live | 完成 | 97 | deepseek-v4-flash | 2026-08-13 20:15 CST | tests/logs/ai/human/live/human-risk-report-draft-live/20260813-201549-550 | 真实读取模板/上周周报与工作文档，docx_edit(insert_blocks) 新建周报并 apply，原文件全部未改。 |
| human-context-compaction-natural-trigger-live | 完成 | 97 | deepseek-v4-flash | 2026-08-13 19:56 CST | tests/logs/ai/human/live/human-context-compaction-natural-trigger-live/20260813-195642-816 | 真实长任务自然触发多轮压缩（usage_plus_delta），摘要结构与关键事实保留，压缩后连续推进并完成周报交付。 |
| human-excel-write-reconciliation-live | 完成 | 96 | deepseek-v4-flash | 2026-08-14 18:39 CST | tests/logs/ai/human/live/human-excel-write-reconciliation-live/20260814-183949-614 | 终端真实计算核对，四笔状态精确标记，SUMIF 公式正确，样式保持。 |
| human-excel-read-sales-gap-analysis-live | 完成 | 95 | deepseek-v4-flash | 2026-08-13 21:02 CST | tests/logs/ai/human/live/human-excel-read-sales-gap-analysis-live/20260813-210226-107 | 真实读取多 Sheet 并终端/python 计算差额，对话给出 P-100/P-300 优先级，源工作簿未改。 |
| human-kb-guided-docx-comparison-draft-live | 完成 | 96 | deepseek-v4-flash | 2026-08-13 20:12 CST | tests/logs/ai/human/live/human-kb-guided-docx-comparison-draft-live/20260813-201203-331 | KB 真实检索命中，两份目标 docx 写入并双 applyId artifact，来源课件未改。 |
| human-ppt-write-management-review-live | 完成 | 94 | deepseek-v4-flash | 2026-08-14 18:42 CST | tests/logs/ai/human/live/human-ppt-write-management-review-live/20260814-184258-961 | 新增摘要页并升级交付风险（李然/7月15日），封面与指标页保持不变，布局无越界、校验零错误。 |
| human-ppt-read-management-risk-review-live | 完成 | 92 | deepseek-v4-flash | 2026-08-14 18:44 CST | tests/logs/ai/human/live/human-ppt-read-management-risk-review-live/20260814-184455-621 | 真实 ppt 读取完成风险简报，视觉识别返回可用文本，未修改演示文稿。 |
| human-terminal-data-reconciliation-live | 完成 | 96 | deepseek-v4-flash | 2026-08-13 20:20 CST | tests/logs/ai/human/live/human-terminal-data-reconciliation-live/20260813-202008-775 | 终端对账，交付财务异常 CSV 金额/记录精确，输入文件未改（type 已按用户语句中文说明填写）。 |
| human-runtime-script-system-python-live | 完成 | 95 | deepseek-v4-flash | 2026-08-14 16:03 CST | tests/logs/ai/human/live/human-runtime-script-system-python-live/20260814-160300-706 | 本机 Python 在临时脚本目录运行临时脚本，得到确定性结果并核对。 |
| human-runtime-download-python-live | 完成 | 92 | deepseek-v4-flash | 2026-08-14 16:03 CST | tests/logs/ai/human/live/human-runtime-download-python-live/20260814-160340-415 | Python 不可用时自主下载便携运行时并运行临时脚本，得到正确结果。 |
| human-session-resume-with-new-selection-live | 完成 | 93 | deepseek-v4-flash | 2026-08-13 20:11 CST | tests/logs/ai/human/live/human-session-resume-with-new-selection-live/20260813-201154-716 | 新选中文件后会话记忆与任务主线延续，完整完成任务。 |
| human-docx-positioned-structural-edit-fallback-live | 完成 | 95 | deepseek-v4-flash | 2026-08-13 20:13 CST | tests/logs/ai/human/live/human-docx-positioned-structural-edit-fallback-live/20260813-201354-419 | 复杂定位区域写入被保护并返回明确诊断，其余区域编辑安全完成。 |
| human-legacy-doc-reading-live | 完成 | 94 | deepseek-v4-flash | 2026-08-13 19:56 CST | tests/logs/ai/human/live/human-legacy-doc-reading-live/20260813-195642-815 | 通过 docx 读取工具成功读取旧版 .doc 并准确回答五级风险与区别率，源文件未改。 |
| human-text-file-write-checkout-cutover-live | 完成 | 96 | deepseek-v4-flash | 2026-08-13 20:17 CST | tests/logs/ai/human/live/human-text-file-write-checkout-cutover-live/20260813-201727-173 | 两处端点和超时精确更新，重试与 telemetry 不变，写后核对完整。 |
| human-text-file-read-checkout-readiness-live | 完成 | 93 | deepseek-v4-flash | 2026-08-13 20:16 CST | tests/logs/ai/human/live/human-text-file-read-checkout-readiness-live/20260813-201642-554 | 只读审查准确识别就绪性风险与保留配置，源文件未改。 |
| human-web-search-by-url-live | 通过 | - | deepseek-v4-flash | 2026-08-24 01:05 CST | tests/logs/ai/human/live/human-web-search-by-url-live/20260824-012552-756 | 给定指定地址，web_search(url) 读取该页并基于正文回答。 |
| human-web-search-intent-query-live | 通过 | - | deepseek-v4-flash | 2026-08-24 01:03 CST | tests/logs/ai/human/live/human-web-search-intent-query-live/（isolated run, 已确认通过） | 纯文本诉求提炼意图，web_search(query) 读取官方文档回答。 |
| human-legacy-doc-edit-skip-live | 完成 | 88 | deepseek-v4-flash | 2026-08-21 23:11 CST | tests/logs/ai/human/live/human-legacy-doc-edit-skip-live/20260821-231108-129 | 验收口径收敛为「docx_edit 未成功编辑 .doc」；模型绕过 docx_edit 用 COM 改源文件的行为不再由本 case 约束。 |
| human-docx-visual-reading-live | 完成 | 92 | deepseek-v4-flash / qwen3.6-plus | 2026-08-21 23:04 CST | tests/logs/ai/human/live/human-docx-visual-reading-live/20260821-230430-243 | 根因是 workflow runner 未展开 `${AI_LIVE_BASE_URL}` 引用导致视觉配置 Invalid URL；修复后真实读取 DOCX 图片内容。 |
| human-pdf-visual-reading-live | 完成 | 92 | deepseek-v4-flash / qwen3.6-plus | 2026-08-21 23:07 CST | tests/logs/ai/human/live/human-pdf-visual-reading-live/20260821-230727-871 | 同上，视觉配置修复后 PDF 页面视觉读取正常，正确回答图形差异。 |
| human-docx-dangling-image-edit-live | 完成 | 93 | deepseek-v4-flash / qwen3.6-plus | 2026-08-21 23:04 CST | tests/logs/ai/human/live/human-docx-dangling-image-edit-live/20260821-230430-129 | 视觉配置修复 + 视觉识别并发池(3)后通过；docx_read_visuals 读图 230s→67s，13 项工时写回文档。 |

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
- `tool / image-generation` 覆盖 SVG 内部绘制输入、PNG/JPEG/WebP 转码、自动创建或更新、工作区内修改记录、Artifact、安全校验和工作区外绝对路径写入不记录回退。
- `tool / pdf` 使用真实 `深度学习.pdf`，覆盖元数据、页级正文、literal/regex 搜索、页面 PNG、工作区外绝对路径读取、损坏文件和结果大小限制。
- `tool / web-browsing` 包含 `web-search-contract`，用于守住 `web_search` 和 `browser_use` 工具契约。
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
- artifact 进入会话消息记录（`chat_session_message_log`）与提示词时只允许包含 `kind / path / operation`；内部 `capability / fileName / applyId` 不得进入提示词。
- 已经落地的文件修改不得因 `run_failed` 或 `run_cancelled` 丢失，终态消息与 Workbench 都必须继续显示对应修改记录。

#### live 类别

- 目的：验证真实业务场景在真实生产调用下可以完成。
- case 设计必须使用真实用户风格输入，不得把内部固定工具顺序写进用户输入。
- 断言口径统一遵循 `doc/test.md` 的真实 AI / live 断言规则。
- 涉及数据计算 / 对账 / 统计的真实 AI 场景，brain 系统提示词已要求计算必须通过 terminal 工具真实执行；live case 硬断言只校验完成态、关键产物与 terminal 计算是否真实发生（如产物修改记录 `source=terminal_tool`）。
- `human / live` 的完整证据写入测试运行产物；顶部“最新 Live 评估”仅由人工在复核 raw logs 与 artifact 后覆盖更新。

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

### 3.4 覆盖归属与去重规则

- `ai/tool` 负责生产工具 runtime 的完整输入输出、读写链、错误边界、原子性、修改记录与回退契约。
- `ChatRunService` 合同测试验证 run 结束不会扫描并归属未受控的工作区变化；只有受控文件工具与 terminal 命令窗口能创建 run 级修改记录。
- `ai/human/mock-llm` 负责真实 human graph 下的工具学习、工具选择、串联执行、暂停恢复和结果交付；只允许固定 LLM 输出，不允许替换工具执行结果。
- `ai/human/live` 负责真实模型在自然语言输入下能否自主选择并正确使用能力；用户输入不得包含内部工具名或固定调用顺序。
- Workbench E2E 负责用户可见的附件、预览、Diff、跨 Sheet 交互与回退闭环，不重复验证工具内部算法。
- Unit 只保留 schema、prompt、registry、纯编译/解析/渲染、协议、平台适配和服务算法等底层契约。完整生产工具 runtime 流程一律归 `ai-test`；新增等价 AI 用例并通过后，删除重复 Unit。
- 间接经过某个函数不算重复。只有测试输入、主要行为和 Oracle 均等价时才迁移或删除 Unit。

## 4. 回归测试清单

### 4.0 结构化输出与服务重试

结构化输出统一走 `prompt_json`：所有结构化调用都是纯文本请求（不发送 `response_format`），模型按提示词中的 schema 描述输出 JSON，本地通过 `normalizePromptJsonText`（剥离代码块）+ `jsonrepair` + Schema 校验兜底。供应商对 `json_schema` / `json_object` 的能力支持无法可靠探测（`/v1/models` 大多不返回能力声明且分模型差异），因此不再维护任何运行期降级链、策略偏好存储或 transport 切换。

LLM 错误只按 `fatal` / `retryable` / `unknown` 分类，服务重试只负责临时故障重连：429、5xx、超时和 `ResourceExhausted`（指数退避 2/4/8/15 秒）进入重试域；401/402/403 直接失败；其余错误不再触发任何降级。相关单元覆盖在 `tests/case/unit/ai/structured-output-single-path.test.ts`（prompt_json 单一路径与解析兜底矩阵）、`tests/case/unit/ai/llm-error-classification.test.ts`（fatal/retryable/unknown 分类）和 `tests/case/unit/ai/structured-chat-activity.test.ts`（退避与重试事件）。

### 4.1 `tool`

#### docx 类别

**DOCX 递归语义树与视觉测试补充**

- What：DOCX 读取返回递归语义树，并能按 visualId 读取视觉内容。
- How：使用 `灵感测试.docx` 验证 18 个 image visual 与 22 个真实空段落；覆盖 wrapper/run/visual 顺序、表格层级、Shape 文本框和五种 visual kind；使用含五种 visual kind 的真实 OOXML fixture，在隐藏 Electron 窗口中验证 chart、diagram、shape 的裁剪结果包含足量非白像素；使用 599/1034 张 VML 图片 fixture 检查性能和结果体积。
- Oracle：详细 block 只使用 children 递归树；outline 只返回 visual 统计；visualId 在未改视觉时稳定，失效视觉不能继续读取；批量视觉读取保持顺序且单项失败不影响其他项。

##### `docx-read-visuals-contract`

- 测试类型：`backend`，`tool-real`
- What：`docx_read_visuals` 可以从递归 block 的 public visualId 读取真实图片。
- Why：视觉节点只有能按需进入视觉模型，才不是仅供展示的无效元数据。
- How：从 `灵感测试.docx` 的 outline 定位含 visual 的 block，读取 visualId 后提交一个有效请求和一个 stale ID，并使用 mock 视觉模型返回固定识别文字。
- Oracle：结果顺序与请求一致；有效图片返回识别文字，stale ID 只产生单项错误；源文件 checksum 不变。
- Not：不验证 chart、diagram、shape 的页面裁剪精度；该能力由专门渲染 fixture 覆盖。

**DOCX 递归编辑、样式与视觉防误删测试补充**

- What：递归创建、全文替换、统一 style 和 visual 防误删共同构成新的写入协议。
- How：覆盖嵌套表格、hyperlink、多层样式、五种 patch、跨 run 匹配、不可跨 visual、`allowVisualLoss`、串行 action 原子失败和 docx_edit 成功结果只返回 `msg`。
- Oracle：旧简化创建 payload 与 `style_text` 被 schema 拒绝；目标类型不匹配不落盘；text-image-text 编辑后媒体、relationship 和非目标 XML 保持不变。

##### `docx-legacy-doc-read-contract`

- 测试类型：`backend`
- What：旧版 .doc 文件可以通过现有 docx-read 工具读取，并明确拒绝写入。
- Why：旧格式读取是 AI 文档能力的兼容边界，写入拒绝必须可解释且不产生副作用。
- How：读取 outline、block、literal/regex 搜索，再尝试编辑并检查错误信息。
- Oracle：读取结果有效；编辑返回“禁止尝试任何对 .doc 文件的编辑”错误信息；源文件 bytes 不变。
- Not：不把旧版 .doc 写入转换为隐式成功。

##### `docx-minimal-edit-flow`

- 测试类型：`backend`
- What：最小 docx 打开、定位、编辑与继续读取链路。
- Why：docx 工具链最基础的真实生产调用闭环。
- How：对 fixture docx 真实执行 `docx_search -> docx_read_blocks -> docx_edit(replace_text) -> docx_search -> docx_read_blocks`。
- Oracle：写入成功并向 AI 返回 `msg` 成功提示；只目标 block 发生变更，修改后的结果可继续被读取工具消费。
- Not：不验证 `human` 的工具选择。

##### `docx-create-then-open-and-edit`

- 测试类型：`backend`
- What：对不存在的路径执行 `docx_edit(insert_blocks)` 后，docx 能立刻进入 `outline / read / edit` 主链。
- Why：cross-source summary 这类新建 Word 文件的场景，底层必须守住“路径不存在即创建”契约。
- How：真实执行 `docx_edit(insert_blocks, 无 location) -> docx_read_outline -> docx_read_blocks -> docx_edit(insert_blocks) -> docx_search`。
- Oracle：内部结果保留 `sourcePath` 与新增 block 信息，面向 AI 只返回 `msg` 成功提示；工具成功后目标路径立即存在且可被继续读取；后续编辑会生成新的可读状态，新内容可继续被搜索命中。
- Not：不验证 human 是否会自主选择这条创建链路。

##### `docx-existing-path-is-edited-without-a-create-action`

- 测试类型：`backend`
- What：`docx_edit` 根据 `sourcePath` 是否存在自动选择创建或编辑。
- Why：删除独立创建 Action 后，已有文件必须直接进入安全的增量编辑流程。
- How：先写入一份真实 docx，再在同一次调用中执行带首块 `location(before)` 的插入和不带 `location` 的末尾追加。
- Oracle：原内容保留，显式 `before` 内容位于文档开头，无 `location` 内容位于文档末尾；当前 run 建立 docx session。
- Not：不验证 UI 层如何展示报错。

##### `docx-create-with-content-direct-applies`

- 测试类型：`backend`
- What：仅对新路径执行一次无锚点 `docx_edit(insert_blocks)` 也会立即创建目标 docx，并在提交当前 run 的 Docx 草稿时生成 apply record。
- Why：真实模型很可能一次写完新文档内容，这条能力必须由回归测试保护。
- How：真实执行 `docx_edit(insert_blocks, 无 location)` 并直接 `applyDocxRunEdits`。
- Oracle：生成 `DocxApplyRecord(operation=created,status=applied)` 并包含 diff 预览 artifact 路径；目标文件立即存在；最终 artifacts 包含携带 `applyId` 的 docx file artifact。
- Not：不验证 `human` 是否会自然选择一次创建完整文档。

##### `docx-direct-apply-checkpoint-revert`

- 测试类型：`backend`
- What：existing docx 在提交当前 run 的 Docx 草稿时写回，立即保存 checkpoint 和修改记录，并支持干净回退。
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
- How：对新路径真实执行无锚点 `docx_edit(insert_blocks)` 建立 replay session，随后外部创建同名目标文件，再执行 `applyDocxRunEdits` 和回退。
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
- What：`docx_read_outline` 按请求的 `ranges` 返回对应范围的结构块。
- Why：长文档 outline 应尊重请求范围返回结构块，便于 brain 精确缩小阅读范围。
- How：对包含 40 段的真实 docx 执行 `docx_read_outline(ranges=block_index 0-9)`，检查返回的结构块数量与范围。
- Oracle：返回 10 个结构块，blockIndex 从 0 到 9。
- Not：不验证 human 是否一定继续读取后续内容。

##### `docx-complex-ops-serial-actions`

- 测试类型：`backend`
- What：多类复杂编辑操作的真实执行契约。
- Why：复杂写入是 docx 工具层高风险区。
- How：覆盖 `docx_edit(actions[])` 按输入顺序串行执行 `replace_text / delete_blocks / insert_blocks(before/after, paragraph/heading/table) / update_table_cell` action。
- Oracle：各类 action 都能写入成功，内部结果保留 `changedBlocks/createdBlocks` 供继续消费，面向 AI 只返回 `msg` 成功提示。
- Not：不验证上层 op 选择策略。

##### `docx-edit-insert-blocks-order`

- 测试类型：`backend`
- What：`docx_edit(insert_blocks)` 在同一 anchor 后插入多条段落与表格时保持输入顺序。
- Why：结构插入顺序一旦漂移，后续 AI 读回确认和用户可见文档都会出现错位。
- How：在段落 A 后一次插入 `P1 / P2 / Table / P3`，再读取完整 outline。
- Oracle：最终顺序稳定为 `A / P1 / P2 / Table / P3 / B`；内部 raw result 的 `createdBlocks/createdBlockIds` 正确，面向 AI 只返回 `msg` 成功提示。
- Not：不验证多 action 串行插入；该场景由 `docx-edit-serial-multiple-inserts-preserve-created-blocks` 覆盖。

##### `docx-edit-serial-multiple-inserts-preserve-created-blocks`

- 测试类型：`backend`
- What：一次 `docx_edit(actions[])` 内多个 `insert_blocks` 会按 action 顺序稳定写入，并分别返回新增 block。
- Why：批量结构插入需要让后续读回和继续编辑能准确识别每个新增结构。
- How：在同一文档里先在 A 后插入两个段落，再在 C 前插入段落和表格。
- Oracle：最终顺序稳定，内部 `createdBlocks` 能对应到本次新增的段落与表格，不误收尾部旧块；该字段不进入 AI 成功输出。
- Not：不验证 replace/delete 与 insert 的混合漂移；该场景由串行动作稳定性 case 覆盖。

##### `docx-structural-op-behavior`

- 测试类型：`backend`
- What：文本替换不会创建新结构，段落/表格对象编辑可以创建独立结构块。
- Why：docx 工具必须清晰区分文本级修改与结构级修改，否则会污染后续 outline、read 和内部 createdBlocks 语义。
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
- How：对真实 `图形学.docx` 执行 `docx_read_outline` 定位一个 positioned block，再分别尝试 `docx_edit(insert_blocks)`、`docx_edit(replace_text)`、`docx_edit(style)` 与 `docx_edit(update_table_cell)`。
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

##### `docx-diff-original-block-net-semantics`

- 测试类型：`backend / tool`
- What：同一个原始 block 在同一次 actions 和同一 run 多轮编辑后，Diff 只展示相对 run 初始版本的净变化。
- Why：原始 block 的每次 replacement 都直接进入 review projection 会重复显示旧内容，并放大红绿数量。
- How：真实覆盖 `A -> B -> C`、`A -> B -> A`、替换后删除，以及同一原始 block 在单次和多次 `docx_edit` 中连续变化；提交当前 run 的 Docx 草稿后解析真实 preview docx。
- Oracle：`A -> B -> C` 只出现一次红色 A 和一次绿色 C且不出现 B；`A -> B -> A` 不包含红绿标记；替换后删除只出现一次红色 A；正式 docx 始终是最终净稿，record 数量与净变化一致。
- Not：不验证 live 模型如何规划编辑步骤。

##### `docx-diff-generated-block-net-semantics`

- 测试类型：`backend / tool`
- What：本轮新增 block 后继续修改或删除时，Diff 只保留最终仍存在的 generated block。
- Why：新增内容的中间稿和已在本轮删除的临时结构不属于用户需要审核的最终差异。
- How：真实覆盖新增后多次替换、新增后删除、新增表格后修改单元格，并解析真实 preview docx。
- Oracle：新增后多次修改只显示最终绿色版本；新增后删除不显示任何净变化；表格不重复；正式文件和 record 统计与最终状态一致。
- Not：不验证原始 block 的替换链；由 `docx-diff-original-block-net-semantics` 覆盖。

##### `docx-precondition-guard`

- 测试类型：`backend`
- What：未 `open`、无效 `sourcePath` 或无效修订引用时的前置保护。
- Why：这些是工具层最常见的异常入口。
- How：直接调用 `outline / read / edit` 覆盖非法输入。
- Oracle：返回明确失败，不产生新修订，不污染运行状态。
- Not：不验证上层重试策略。

##### `docx-apply-ops-invalid-snapshot-guard`

- 测试类型：`backend`
- What：源 DOCX 已有无效图片关系时，`apply_ops` 仍可正常写入。
- Why：WPS 可打开的旧文档可能带有不可见的 `NULL` 图片残留，不能因此拒绝用户的正常编辑。
- How：构造同时含合法 `../customXml/item1.xml` 和缺失 `../NULL` 关系的 DOCX，执行真实 `docx_edit(replace_text)` 后重新读取。
- Oracle：`customXml` 不误报；`NULL` 被记录为源问题但不阻断编辑；修订正常推进且新文本可搜索。
- Not：不验证编辑器新增坏关系；由 `docx-validation-detects-new-relationship-problems` 覆盖。

##### `docx-validation-detects-new-relationship-problems`

- 测试类型：`backend`
- What：编辑结果新增缺失关系时，`docx_edit` 会拒绝该结果且不推进草稿。
- Why：兼容源文档历史脏数据不能放开编辑器自己生成的结构损坏。
- How：以无问题 DOCX 为基线，模拟编辑器产出带 `../NULL` 图片关系的结果后调用真实 `docx_edit(replace_text)`。
- Oracle：返回“本次编辑新增结构问题”；原文本仍可搜索；活动修订保持在 `v1`。
- Not：不验证完整 human 工具选择。

##### `docx-dangling-image-relationship-contract`

- 测试类型：`backend / tool-real`
- What：真实需求 DOCX 中的 `NULL` 图片残留不计入图片数量，且不阻止编辑。
- Why：用户在 WPS 中看不到该残留，模型和用户也不应看到虚假的“图片9”。
- How：读取真实附件的 outline，统计 visual 数量后替换文档标题并重新搜索写入文本。
- Oracle：源诊断仅含 `NULL` 缺失关系；读取结果只包含 8 张真实图片；编辑成功，写后残留关系仍保持原样。
- Not：不调用真实模型；完整自然语言回归由 `human-docx-dangling-image-edit-live` 覆盖。

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
- What：PDF 工具结果过大时不再在工具层硬失败，完整正文直接返回，由 hand 层统一截断并落盘。
- Why：结果大小统一守卫上移到 hand 层处理（截断 + 落盘 `.log` + `text-file-read` 读取），工具层不再对超长正文直接报错。
- How：构造 PDF 读取结果，压低 `modelContextWindowTokens`，调用 `pdf_read_pages` 检查完整正文正常返回。
- Oracle：工具层返回完整 `pages` 正文（不携带 `error`），不生成伪造内容，源 PDF 不变。
- Not：不评价模型最终回答措辞。

##### `pdf-failure-boundary-contract`

- 测试类型：`backend`
- What：PDF 输入边界会明确失败。
- Why：防止伪 PDF、非法 regex 和越界页码进入不确定状态，同时确认外部附件路径可以读取。
- How：分别传入越界页码、非法 regex、错误文件头以及指向工作区外的链接；Windows 使用无需提升权限的目录 junction，Unix 使用目录 symlink。
- Oracle：越界页码、非法 regex 和错误文件头返回明确失败；工作区外 PDF 通过符号链接仍可正常读取。
- Not：不做密码破解或损坏文件修复。

#### ppt 类别

##### `ppt-create-read-edit-commit`

- 测试类型：`backend / tool`
- What：`ppt_edit(actions=[insert_slide...])` 一次创建多页、读取、编辑、每次写后立即回读，以及写入时生成单一页面级 diff 记录。
- Why：PPT 工具必须同时守住直接写回和 run 级差异聚合。
- How：创建真实多页 PPT，连续读取和编辑，再检查写入保存的记录。
- Oracle：每次 `ppt_edit` 成功后正式文件立即存在、可解析且页面内容正确；同一文件只生成一条修改记录和页面级 diff。
- Not：不验证 human 的工具选择或页面审美。

##### `ppt-diff-slide-and-element-net-semantics`

- 测试类型：`backend / tool`
- What：真实 PPT runtime 按本 Run 首个 baseline 和最终文件生成 Diff Manifest v4，覆盖页面和元素的新增、删除、修改、移动、恢复与组合计数。
- Why：工具调用次数、插入删除造成的页码偏移和置顶造成的层级编号顺移都可能制造假 Diff，必须直接解析真实 artifact 验证净变化。
- How：对三个真实 PPT 连续执行页面 A→B→C、A→B→A、修改后删除、新增后继续修改、新增后删除、中间页删除、主动移动及移动后恢复；再分别改变元素内容、样式、位置、大小、层级，覆盖同元素多种修改、公式 replacement lineage、元素新增后修改、修改后删除、新增后删除、修改后恢复、备注修改后恢复，最后提交 Run 并读取 Manifest 和正式 PPT。
- Oracle：页面组合得到准确 `+3/-2`，元素组合得到准确 `+6/-1`，零净变化文件不生成记录；中间页增删不把后续页标记为移动，置顶只计算真实移动元素；中间稿和临时对象不进入 before/after；正式 PPT 可解析且无 Diff 污染，修改记录的 `insertCount/deleteCount/changeCount` 分别等于 v4 的 positive、negative 和两者之和。
- Not：不验证 Workbench 布局、按钮、颜色 CSS 或模型是否会自主选择操作；这些由 Workbench E2E 和 human/live case 承担。

##### `ppt-professional-element-edit`

- 测试类型：`backend / tool`
- What：元素位置、样式、图层、复制、线条、图片、表格、图表和公式更新。
- Why：专业 PPT 编辑依赖元素级能力，不能只覆盖整页创建。
- How：对真实 PPT 依次执行代表性的元素级编辑并重新读取结果。
- Oracle：操作成功；`postWriteReadback` 返回可继续使用的真实 elementId；最终 pptx 可解析。
- Not：不评价页面设计质量。

##### `ppt-visual-runtime-contract`

- 测试类型：`backend`
- What：PPT HTML 视觉 runtime 的页面尺寸、字体、布局和非法输入保护保持稳定。
- Why：这是生产 PPT 工具的运行时契约，不应由 Unit 重复拥有完整 runtime 流程。
- How：从原 Unit visual smoke 迁移真实 runtime 输入，执行编译、渲染和产物解析。
- Oracle：合法页面生成可解析 PPTX 且关键元素位置稳定；非法页面返回可解释错误且不留下半成品。
- Not：不验证模型是否会生成高质量设计。

#### excel 类别

##### `excel-create-read-edit`

- 测试类型：`backend / tool`
- What：Excel 专用工具创建工作簿、批量写入数据和公式，并继续执行概览、搜索、范围读取和修改。
- Why：Excel 的值与公式必须由程序真实读写，不能用模型推算或用伪造工具结果代替。
- How：真实调用 `excel_edit` 创建 xlsx，再调用三个只读工具并继续修改同一路径；另对已有 xlsx 执行修改和删除单元格，最后直接解析正式文件与 diff xlsx 文件。
- Oracle：新文件只包含显式新增的 Sheet，没有默认 `Sheet1`；正式文件包含准确值和公式且不带 diff 边框；diff 文件对新增、修改显示绿色中等粗细边框，对删除显示红色中等粗细边框并保留修改前值；同一路径只保留一条修改记录，对齐 `WB-EXCEL-001`、`WB-EXCEL-002-AC2`、`WB-EXCEL-002-AC3`。
- Not：不验证 human 是否会选择 Excel 技能，也不评价表格视觉设计。

##### `excel-read-search-and-format-boundaries`

- 测试类型：`backend`
- What：Excel outline、search、read-cells 的范围、格式与错误边界。
- Why：当前单一 happy path 无法保护多 Sheet、regex、大结果截断和 Office Excel 格式兼容。
- How：真实读取 `xlsx/xlsm/xltx/xltm`，覆盖 Sheet scope、多 ranges、literal/regex、500 条截断，以及非法路径、range、regex 和格式。
- Oracle：结果 Sheet/range/值稳定；搜索最多返回 500 条并显式标记截断；合法格式可读，非法输入稳定失败且不产生修改记录。
- Not：不验证模型如何选择读取范围。

##### `excel-edit-operations-and-atomicity`

- 测试类型：`backend`
- What：Excel 全部编辑 action、样式、工作簿结构、原子写入和累计修改记录，并校验非行位移类 diff xlsx 语义。
- Why：写入失败、外部并发修改或 record 持久化失败都不能留下半提交状态；同一次 run 的多轮编辑必须相对首个 baseline 生成累计 Diff；删除 Sheet、清空范围和边框粗细不能只靠 UI e2e 间接发现。
- How：真实覆盖单元格写入/清空、公式、样式、行列与 Sheet 操作、no-op、外部修改冲突、record 持久化失败回滚和同 run 两轮编辑；直接解析 diff xlsx 检查 sheet 顺序、tab 色、单元格值、边框、行高、列宽和合并单元格。
- Oracle：每个 action 落盘后可读；删除最后一个 Sheet 失败；新增 Sheet 在 Diff 中为绿色标签；删除 Sheet 按 baseline 原位置恢复完整旧内容并显示红色标签；清空范围保留修改前值并显示红色中等粗细边框；源 xlsx 不包含 diff 标记；no-op 不产生记录；冲突与持久化失败恢复到安全状态；最终仅一条累计 record，Diff 相对首个 baseline。
- Not：不验证 Workbench 的 Diff 交互。

##### `excel-diff-row-structure-semantics`

- 测试类型：`backend / tool`
- What：插入或删除首行、中间行、末行及连续多行时，Diff 按逻辑行对齐，只标记真实新增或删除的行。
- Why：按单元格地址直接比较会把删除行后的整体上移误判为大量绿色修改，并在末尾生成错误红色重复行。
- How：构造包含唯一行标签、公式、样式和行高的真实 xlsx，分别执行行插入、行删除、删除后继续修改，以及同一 run 多轮结构编辑；直接解析 preview xlsx 的行顺序、值和每个边框。
- Oracle：删除中间行只保留该旧行并标红一次；所有仅因上移或下移而换地址的行无边框；末尾没有重复行；插入行只标绿最终新增行；红绿地址集合和 record 统计精确等于净变化；正式 xlsx 无 diff 标记。
- Not：不验证 Workbench Canvas 如何绘制边框。

##### `excel-diff-cumulative-net-semantics`

- 测试类型：`backend / tool`
- What：同一 run 的多轮单元格、行和 Sheet 编辑只展示相对首个 baseline 的最终净变化。
- Why：中间操作、改回原值、先增后删和先删后恢复不应进入最终审核结果或放大变更计数。
- How：真实覆盖 `A -> B -> C`、`A -> B -> A`、清空后恢复、插入后删除、新增 Sheet 后删除，并解析最终正式文件与 preview xlsx。
- Oracle：中间版本不出现；恢复原值和先增后删不产生净标记；最终只保留一条 record；红绿数量、Sheet 顺序和实际最终状态完全一致。
- Not：不验证 live 模型是否会产生这些操作序列。

##### `hand-excel-read-write-read`

- 测试类型：`backend`
- What：hand 在同一次调用中允许 Excel 读取、写入、再读取的真实串联。
- Why：Excel 工具单测通过不代表 hand 的 schema 预检、调用预算和 artifact 合并可以承载完整链路。
- How：真实执行 `excel_read_outline -> excel_edit -> excel_read_cells`。
- Oracle：三步均成功；后读可见前写结果；最终 artifact 和修改记录只指向目标工作簿。
- Not：不验证 human 是否自主选择这条顺序。

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
- What：`terminal_run` 读到明显非文本/结构化文档输出时，会省略原始输出并返回错误结果。
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
- What：terminal 只通过真实命令前后差异生成修改记录和 artifact，不根据命令字符串猜测文件产物。
- Why：terminal 命令需要在不依赖整次 Run 收尾扫描的前提下，记录无法静态分析的真实文件变化。
- How：通过 terminal 修改已有文件并创建新文件，检查工具结果、文件结果、工具期修改记录和 `file_artifact` 事件。
- Oracle：命令真实生效并经过审批；terminal 工具结果不包含 `artifacts`；命令完成后产生带当前 Run ID 的修改记录和 `file_artifact`。
- Not：不根据命令文本推断文件路径；差异只来自命令前后工作区快照。

##### `terminal-tracking-start-failure-cleanup`

- 测试类型：`backend`
- What：终端命令已建立追踪基线但 PTY 启动失败时，追踪上下文会被立即丢弃。
- Why：启动失败不应留下无法完成的快照、修改记录或文件 artifact。
- How：真实构建 terminal 工具，替换终端会话启动为明确失败的实现，并记录开始、完成和丢弃追踪调用。
- Oracle：恰好开始并丢弃同一个命令追踪 ID；不调用完成追踪，不产生修改记录或 `file_artifact`。
- Not：不验证 PTY 本身的启动错误归因；该能力由终端会话管理测试覆盖。

##### `terminal-inline-interpreter-execution`

- 测试类型：`backend`
- What：终端 inline interpreter 能在受控工作区执行内联 Node/Python 代码并返回真实结果。
- Why：AI 需要可靠的短脚本执行入口，不能把解释器调用误当成普通 shell 文本。
- How：通过 terminal 工具执行内联代码，检查命令、输出、工作目录和边界错误。
- Oracle：返回真实标记和正确退出状态；越界或不可用解释器被明确拒绝。
- Not：不替代终端执行与长命令让出控制权的生命周期测试。

##### `terminal-execution-contract`

- 测试类型：`backend`
- What：真实 PTY 终端从工作区根目录执行命令、长命令让出控制权并可增量读取，命令级文件追踪与退出码正确；拒绝后台分离执行，放行 fd 合并重定向。
- Why：后台服务和长任务不能依赖单次 shell 超时或系统孤儿进程；`2>&1` 等 fd 合并重定向只是输出流合并，不能误判为后台执行或危险重定向。
- How：通过 `terminal_run` 分别执行 `pwd`、单命令内 `cd + pwd`、写文件后长 sleep、持续输出命令、写文件后非零退出；通过 `terminal_read` 携带返回的 `readEndPosition` 增量读取持续输出命令，验证单次读取有字符上限、`hasMoreOutput` 指示未读完且可用返回位置连续读完。以 `sleep 1 &`（windows `Start-Process`）验证分离执行被拒，以 `echo redirect-ok 2>&1` 验证 fd 合并重定向正常执行。
- Oracle：命令默认从 workspace 根目录执行；长命令返回 `command_still_running` 且进程仍在；读取能取得真实增量输出；写文件命令（完成与非零退出）均生成当前 run 的 `terminal_tool` 修改记录和 `file_artifact`。分离执行返回 `detached shell execution` 错误；`2>&1` 命令以 completed 和退出码 0 结束且输出包含 `redirect-ok`。
- Not：不验证 Workbench 浏览器联动，该能力由真实 e2e 覆盖。

#### web-browsing 类别

##### `web-search-reads-page-by-url`

- 测试类型：`backend`
- What：`web_search` 传 `url` 会返回 `requestedUrl/finalUrl`、标题、`markdown`、发布时间与分组 links；其中 `markdown` 内容来源于 crawl4ai 的 `fit_markdown`。
- Why：程序级网页读取是低成本网页能力入口，必须稳定返回可被 brain 继续消费的网页事实和导航线索，同时保留 crawl4ai 的分组 links 与评分语义。
- How：启动本地 HTTP server，返回文章页 HTML，通过真实冻结 sidecar bin 返回抓取结果，调用 `web_search({ url })`。
- Oracle：结果包含 `requestedUrl`、`finalUrl`、`title`、`markdown`、`publishedAt`、`links.internal/external`，且 links 项包含 `intrinsicScore/contextualScore/totalScore`。
- Not：不验证复杂浏览器交互或外网可达性。

##### `web-search-reads-content-by-query`

- 测试类型：`backend`
- What：`web_search` 传 `query` 会先搜索候选网页，并行爬取全部候选，返回数组（成功项带正文 markdown、失败项带 `error`）。
- Why：网页搜索与正文读取融合后，query 应产出可被 brain 消费的网页正文数组；失败项在数组中可见，brain 可据此避免重复访问被墙或失败的来源。
- How：通过真实 web tool harness 调用 `web_search({ query })`，使用可控搜索返回多个候选 URL，抓取服务对部分 URL 返回失败。
- Oracle：结果是数组，成功项包含该页 `requestedUrl` 与正文 `markdown`，失败项包含 `error`，两者按候选顺序并存。
- Not：不验证搜索引擎级网页发现与多跳。

##### `web-search-reads-entry-page`

- 测试类型：`backend`
- What：`web_search` 传 `url` 只读取该 URL 对应网页，并保留该页 links。
- Why：当前 contract 不让工具自己多跳跟进，后续要不要继续探索由 human 自己看 links 决定。
- How：启动本地 HTTP server，返回包含通知页和指南页链接的入口页，通过真实冻结 sidecar bin 抓取该页，调用 `web_search({ url })`。
- Oracle：结果命中输入 URL 对应页面正文，同时 links 中保留该页相关链接。
- Not：不验证自动多跳或搜索引擎级网页发现。

##### `web-search-http-failure`

- 测试类型：`backend`
- What：`web_search` 传 `url` 遇到 HTTP 失败时会保留错误文本、最终 URL 和状态码。
- Why：网页读取失败也必须保持可诊断，避免 `human` 误把空结果当成“网页无信息”。
- How：启动本地 HTTP server，返回 404 页面，通过真实冻结 sidecar bin 执行抓取，调用 `web_search({ url })`。
- Oracle：结果返回明确错误文本，同时保留 `finalUrl` 和 `statusCode`。
- Not：不验证复杂重定向链或外站错误页样式。

##### `web-search-returns-full-content-without-tool-level-truncation`

- 测试类型：`backend`
- What：`web_search` 结果过大时不再在工具层硬失败，完整正文直接返回，由 hand 层统一截断并落盘。
- Why：网页正文可能很长；统一大小守卫上移到 hand 层处理（截断 + 落盘 `.log` + `text-file-read` 读取），工具层不再对超长正文直接报错。
- How：启动本地 HTTP server，返回超长正文页，通过真实冻结 sidecar bin 抓取，调用 `web_search({ url })`。
- Oracle：结果返回完整 `markdown`（不携带 `error`），`requestedUrl/finalUrl` 保留，后续截断落盘由 hand 层负责。
- Not：不验证压缩摘要或自动截断策略。

#### image-generation 类别

##### `image-generate-format-create-update-contract`

- 测试类型：`backend`
- What：`image_generate` 使用 SVG 内容生成真实 PNG、JPEG、WebP，并自动创建或更新目标图片。
- Why：图片生成的核心交付是可读取的正式图片文件，不能只验证 SVG 或伪造扩展名。
- How：在临时工作区调用真实 `image_generate`，分别输出 PNG、JPEG、WebP；同一路径再次生成，并覆盖一份预先存在的 JPEG。
- Oracle：三种文件签名正确且均可实际解码为预期尺寸；新建和已有路径连续更新都复用修改记录和 applyId；已有文件始终保存首次写入前快照；Artifact capability 为 `image`；工具结果只返回 `outputPath`。
- Not：不评价图片审美，也不要求 AI 使用固定 SVG 结构。

##### `image-generate-safety-and-boundary-contract`

- 测试类型：`backend`
- What：危险 SVG 和不支持格式请求失败；工作区外绝对路径可写入但不产生回退记录。
- Why：SVG 是可包含脚本和外部资源的输入格式，图片工具必须在写文件前完成安全和路径校验。
- How：分别提交包含脚本、外部图片引用、CSS 外链、CSS import、超大尺寸、malformed SVG、`.gif` 输出路径和工作区外路径的真实工具调用；工作区外路径使用安全 SVG，malformed SVG 使用一份已存在目标文件。
- Oracle：所有调用均返回明确错误；新目标文件不存在；已有目标文件保持调用前 bytes；不生成图片修改记录或 `file_artifact`。
- Not：不把内部安全规则写入 Tool 提示词，也不穷举全部 SVG 标签。

#### image-recognition 类别

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

#### human hand 类别

##### `hand-invalid-tool-input`

- 测试类型：`backend`
- What：双层嵌套的坏工具参数会被工具层 schema 校验拒绝，并返回 `hand_docx_edit_failed` 错误。
- Why：模型常见错误是把工具参数包错层级；工具自身的 zod schema 校验必须在真实执行中给出可恢复的结构化失败。
- How：向真实 `hand` node 提交双层嵌套的坏 `docx_edit` 参数。
- Oracle：工具结果为失败，error 指向 `did not match expected schema`，并提升为 `hand_docx_edit_failed` 错误。
- Not：不验证 brain 如何根据该错误重写计划。

##### `hand-docx-edit-invalid-blockid-failed`

- 测试类型：`backend`
- What：`docx_edit` 使用不存在或过期 blockId 时失败，并返回统一 `hand_docx_edit_failed`。
- Why：无效 blockId 是 docx 多轮编辑的高频失败入口，必须稳定进入可恢复错误，而不是静默写错位置。
- How：创建真实 docx 后，通过 `hand` 调用 `docx_edit(insert_blocks)`，`location.blockId` 使用不存在的 `b:99`。
- Oracle：`docx_edit` 返回失败，error 包含 toolName、sourcePath、action 与具体错误。
- Not：不验证 human 最终交付话术。

##### `hand-terminal-approval-batch`

- 测试类型：`backend`
- What：`hand` 会对当前 `calls` 中需审批的 `terminal_run` 做批量预检，并在整批未全部同意时 0 执行。
- Why：terminal 审批责任已经前移到 `hand` preflight，回归 case 必须长期守住“先整批审核，再决定是否执行”的主流程。
- How：通过真实 `human` hand 决策构造两个需审批 terminal 命令，并让审批批次返回 `approve + guide` 混合结果。
- Oracle：事件流出现 `approval_batch_required / approval_batch_decision`；整批在审批前不发生真实 tool execution；磁盘上不会产生任何副作用；被拦的 terminal 调用会以合成 `ToolMessage` 结果（`approval_blocked`）回流到 `brain`。
- Not：不验证前端审批卡片交互。

##### `hand-serial-docx-chain`

- 测试类型：`backend`
- What：`hand` 会按顺序执行真实 docx 写入与读回确认链路。
- Why：复杂 docx 链路依赖当前最新修订，必须通过回归 case 守住顺序执行契约。
- How：通过真实 `hand` 执行 `docx_edit(replace_text) -> docx_read_blocks`。
- Oracle：工具结果顺序稳定、全部成功，且不会在 hand 内直接产出 docx 交付 artifact。
- Not：不验证 `brain` 是否自然生成这条计划。

### 4.2 `human`

#### mock-llm 类别

##### `human-image-generation`

- 测试类型：`backend / mock-llm`
- What：human 直接使用 builtin `image_generate` 生成并交付 PNG，无需学习。
- Why：Tool 测试不覆盖 Brain、Hand、Mouth 的技能装载和交付主链。
- How：只脚本化 LLM 决策，真实执行 human graph、图片渲染、修改记录和 Artifact。
- Oracle：主链经过 Hand、Mouth；只调用一次 `image_generate`；PNG 可解码且尺寸正确；Artifact 和最终交付文件名一致。
- Not：不验证真实模型自主选择技能，该行为由 Workbench 图片生成 Live E2E 覆盖。

##### `human-excel-read-edit`

- 测试类型：`backend`
- What：human 学习 Excel 能力后读取已有工作簿、修改并复读验证。
- Why：补齐 Excel 在真实 human graph 中完全缺失的 non-live 回归。
- How：只脚本化 LLM 决策，真实走 learning、hand、Excel runtime、apply/artifact 和 mouth。
- Oracle：任务完成；调用包含读、写、复读；正式文件、累计 record、artifact 与最终答复一致。
- Not：不验证真实模型的工具选择能力。

##### `human-text-file-read-write`

- 测试类型：`backend`
- What：human 能读取普通文本、修改并交付结果。
- Why：Text File 目前只有 tool 与 live，缺少可快速定位 graph/runtime 问题的 mock 层。
- How：脚本化 LLM 决策，真实执行 text read/write 和修改记录链路。
- Oracle：修改落盘且可复读；artifact 和最终答复包含正确文件。
- Not：不重复穷举四种底层 write action。

##### `human-ppt-read-search-edit`

- 测试类型：`backend`
- What：human 对已有 PPT 执行读取、搜索、局部编辑和复读。
- Why：现有 Human PPT 只覆盖创建，缺少已有文件修改主链。
- How：脚本化 LLM 决策，真实调用 PPT read/search/edit runtime。
- Oracle：目标页和元素被修改，其他页面保持不变；正式文件、record 与 artifact 一致。
- Not：不验证视觉美学。

##### `human-web-search-crawl`

- 测试类型：`backend`
- What：human 从搜索候选进入网页正文读取并整合事实。
- Why：现有 tool 分别验证 search/crawl，live 偏 crawl，缺少稳定的 search-to-crawl graph 回归。
- How：仅固定 LLM 决策和可控搜索/网页响应，真实走 human graph 与 web tools。
- Oracle：先获得候选再读取选中页面；最终答复只使用成功读取的事实和来源。
- Not：不验证公网搜索排序质量。

##### `human-tool-result-truncation-read`

- 测试类型：`backend / mock-llm`
- What：human 读取超大工具结果时完整内容落盘到 `runtime/toolresult` 为 `.log` 文件，模型侧收到整串截断的信封。
- Why：工具结果大小守卫已从工具层上移到 hand 层（截断 + 落盘 + `text-file-read` 读取），需守住落盘与信封这一关键事实。
- How：脚本化 LLM 决策读取超大文本文件，真实走 hand 层截断与落盘链路。
- Oracle：任务完成；`runtime/toolresult` 下存在落盘的 `.log` 文件；落盘内容为完整的可解析 JSON；信封包含 `truncated`、`filePath(.log)`、`maxChars`、`totalChars`、`head` 前缀。
- Not：不验证公网搜索或真实模型工具选择。

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
- How：通过 scripted structured output 依次学习 `docx-read`、`docx-write`，再故意请求 builtin skill（如 `terminal + kb-retrieval`）；检查最后一轮真实 `human_learning` 事件中的 `learnedSkillIds`、`availableToolNames` 与 summary，并确认 builtin skill 请求被过滤（learning 返回「学习失败，学习请求中没有可加载的技能。」工具结果）。
- Oracle：任务最终完成；最后一轮真实 `human_learning` 事件中只保留 external skill，`availableToolNames` 同时包含 builtin 与 learned external 的工具集合，summary 包含 `当前 active tools=` 且不包含 skill 淘汰文案；builtin skill 不占 active tool budget，但后续真实执行时仍计入工具调用次数限制。
- Not：不验证超过 `20` 个 active tools 后的淘汰算法细节。

##### `tool-failure-recovery`

- 测试类型：`backend`
- What：真实工具失败结果会被 `human` 吸收，并继续收束到最终交付。
- Why：工具失败是高频真实场景，如果失败后链路无法继续，`human` 就不具备稳定执行能力。
- How：直接真实执行一个会失败的 builtin terminal 安全指令，随后由 `brain` 决定停止重试并进入 `mouth`。
- Oracle：真实 `terminal_run` 结果为失败，且 `human` 最终仍进入 `completed` 并产出最终交付。
- Not：不验证失败后的最佳补救策略是否最优。

##### `approval-denied-restricted-delivery`

- 测试类型：`backend`
- What：真实批量审批拒绝会阻止需审批命令落地，并把限制带入最终交付。
- Why：审批拒绝是生产边界，不能只靠 fake 测试覆盖。
- How：设置 `approvalPolicy=deny-medium-high`，直接尝试真实执行 builtin terminal 命令 `mkdir blocked-dir`，然后进入最终说明。
- Oracle：事件流真实出现 `approval_batch_decision` 且至少一项为 `reject`；对应 terminal 命令不会真实执行；被拦的 terminal 调用以合成 `ToolMessage` 结果（`approval_blocked`）回流给后续 brain；磁盘上不会真的创建 `blocked-dir`，任务最终完成。
- Not：不验证用户如何在 UI 中恢复被拒绝的动作。

##### `brain-memory-write-boundary`

- 测试类型：`backend`
- What：第一轮 `brain` 写入的 thought memory 字段会在下一轮真实 `brain` prompt 中继续可见。
- Why：memory 跨轮延续是 `human` 长链路推理的核心能力，必须由真实 graph 保证。
- How：第一轮 `brain` 通过 `update_plan`（每项含 title/status）更新任务清单记忆（plan 进全局）；第二轮 `brain` 读取真实 prompt，检查这些内容是否还在。
- Oracle：第二轮 `brain` prompt 中出现前一轮写入的 plan 项标题，任务最终完成。
- Not：不验证更复杂的 memory 压缩策略。

##### `conversation-memory-multi-run-recall`

- 测试类型：`backend`
- What：同一 `session` 下之前 run 的用户消息与助手最终回答，会通过会话消息记录（`chat_session_message_log`）作为真实消息带入下一次 `brain` prompt。
- Why：跨任务连续性依赖 append-only 消息转录（而非 conversation summary / rounds 副本）作为唯一真相源；要证明上一轮沉淀的关键事实在后续 run 仍可被召回。
- How：同一 session 连续跑三个 run，前两轮分别沉淀「还缺少回滚负责人」「负责人候选改成 Bob、审批未完成、上线窗口冲突待确认」，第三轮追问当前状态并检查 brain prompt 与最终交付。
- Oracle：第三轮 `brain` prompt 同时命中 Bob、上线窗口冲突与还缺少回滚负责人；最终交付带出负责人候选、未完成审批与下一步安排。
- Not：不验证 live 模型总结质量；不验证 session 隔离。

##### `ai-run-service-resume-snapshot`

- 测试类型：`backend`
- What：`AiRunService` 在同一 `session` 下会对 `timeout / network_error` 保存恢复快照，并在下一次 run 自动恢复语义上下文继续完成。
- Why：中断恢复依赖最小持久化快照，而不是在同一 run 内盲目重试；这条 contract 需要回归保护。
- How：首轮通过真实 `AiRunService` 启动一次 run，让真实 `brain` 先写入可恢复状态后命中 `timeout`；第二轮在同一 session 下不再显式传引用范围与工作区，验证真实 run 会自动恢复并继续完成；同时补一条 `network_error` 分支和一条普通 `error` 分支。
- Oracle：`timeout / network_error` 失败态会写出 `failureCode` 与 `resumeSnapshotSaved=true`，`ChatStore` 中保留最新恢复快照；下一轮同 session 会从 `context_budget -> brain` 重新开始，但带回恢复快照中的已学 skill / 任务计划语义；成功完成后恢复快照被清空；普通 `error` 不保存恢复快照。
- Not：不验证 docx 临时运行态恢复；不验证 live provider 的真实网络抖动概率。

##### `human-interruption-message-repair`

- 测试类型：`backend / mock-llm`
- What：续接（跨会话 / 中断恢复）重建消息数组时，顺序为 `system + 完整历史（含 mouth 交付 user 消息与最终答复）+ 尾部 buildBrainUserMessage user 消息`；末条 assistant 有悬空 tool_calls 时补 `interrupted` ToolMessage。
- Why：模型上下文唯一真相源是会话消息记录，续接必须忠实回放历史并把新诉求追加到末尾；若上一条 assistant 声明了 tool_call 却没有对应结果，接口会直接报错，必须补一条意外中断反馈。
- How：mock-llm 下跑两个子场景：其一 run-1 正常完成（含 learn_skill 与 mouth 交付），run-2 捕获首次 brain 的 `request.messages`；其二 run-1 的 brain 返回 learn_skill tool_call 后在 brain 调用返回时 abort 控制器，run-2 恢复并捕获消息数组。
- Oracle：子场景一：消息数组首条为 system、末条为含 `<task_goal>` 的 user 消息，历史含 run-1 原始 user、run-1 最终答复与 mouth 交付 user 消息；子场景二：run-1 为 `user_cancelled` 且 `resumeSnapshotSaved=true`，run-2 消息数组中悬空 learn_skill tool_call 后补了 `{ok:false,code:'interrupted'}` 的 ToolMessage，且末条为含 `<task_goal>` 的 user 消息。
- Not：不验证 live provider 真实网络抖动；不恢复 docx 临时运行态。

##### `session-skill-memory-multi-run`

- 测试类型：`backend / mock-llm`
- What：同一 AI session 的多轮 human run 能复用已学习技能记忆。
- Why：技能记忆是 AI 架构跨轮次协作的核心，不应每轮重复 learning。
- How：第一轮学习并使用技能，第二轮继续同一任务，检查 brain 输入和 human steps。
- Oracle：第一轮写入技能；第二轮能看到技能且不重复 learning；两轮均正常完成。
- Not：不覆盖 Workbench UI 会话持久化，该路径由 Workbench E2E 覆盖。

##### `todolist-memory-maintenance`

- 测试类型：`backend`
- What：任务清单（todolist）作为长期任务板会在 mock-llm 下跨轮维护 todo、done 状态。
- Why：如果任务清单不能跨轮保留并被重写成最新任务板，brain 很容易把长期记忆退化成单轮摘要。
- How：第一轮 `brain` 写入只含 todo 的任务清单，并触发一次真实 learning；第二轮 `brain` 读取真实 prompt 后，将任务清单重写为包含 done 与 todo 的新版本。
- Oracle：第二轮 `brain` prompt 中能看到第一轮写入的结构化任务清单项，任务最终完成，且新的任务清单成功写回 thought memory。
- Not：不验证除 `mouth` 收口前的 todo 检查之外的更复杂任务清单机读策略。

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

##### `human-docx-read-visuals-collaboration`

- 测试类型：`backend / mock-llm`
- What：mock human 看到 DOCX 递归树里的 visual 节点后，可以选择 `docx_read_visuals` 并直接得到识图结果。
- Why：visualId 只有能进入模型决策上下文并驱动真实视觉读取，才构成完整能力。
- How：使用 `灵感测试.docx` 和本地视觉服务；脚本化模型先读 outline，再读取含 visual 的 block，并在后续 prompt 确认递归 visual 节点和 visualId 后调用视觉读取工具。
- Oracle：工具顺序为 outline、block、visual；识图结果进入后续 brain prompt；不调用 `image_analyze`；任务完成。
- Not：不验证真实模型的自由规划质量，不验证 chart、diagram 和 shape 的裁剪精度。

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

- 测试类型：`backend / mock-llm`
- What：AI 能学习 `ppt-read / ppt-write`，通过 `ppt_edit.actions[]` 一次创建多页并交付 PPT。
- Why：需要验证 human 主链能正确学习并调用 PPT 能力。
- How：使用 scripted LLM 输出驱动真实 human graph 创建并交付 PPT。
- Oracle：最终文件可解析且内容正确；只产生一个 PPT 修改记录和文件交付。
- Not：不验证真实模型的自主规划质量。

#### live 类别

##### `human-excel-read-sales-gap-analysis-live`

- 测试类型：`live`
- What：真实模型在销售周会前审阅多 Sheet 工作簿，并给出未达标产品和优先级分析。
- Why：用户只表达经营诉求；模型必须自行选择读取和真实计算能力。
- How：不出现工具名，不修改工作簿；要求计算实际额、目标额和差额后直接向用户汇报。
- Oracle：源文件完整；发生真实 Excel 读取和终端计算；结论由 raw logs 人工评估。
- Not：不生成仅供测试消费的 JSON，不断言最终回答文案。

##### `human-excel-write-reconciliation-live`

- 测试类型：`live`
- What：真实模型在财务结账场景中更新既有对账工作簿。
- Why：对账、精确标记、公式和写后复核是实际 Excel 交付能力。
- How：用户只描述销售与回款核对、待补票标记和汇总需求；模型自行选择计算手段。
- Oracle：正式工作簿的目标单元格、公式、样式和非目标数据正确；发生真实终端计算、Excel 写入和写后复核。
- Not：不生成额外 JSON，不断言最终回答文案。

##### `human-legacy-doc-reading-live`

- 测试类型：`backend / live`
- What：真实模型通过 docx-read 工具读取选中的旧版 .doc 文档。
- Why：真实 human 必须遵守旧格式只读边界并保持源文件不变。
- How：仅提供旧版文档和读取工具，检查工具事件、答案关键事实与文件 hash。
- Oracle：读取成功、答案包含预期事实、不调用编辑工具且源文件未改变。
- Not：不验证旧版 `.doc` 的编辑能力；该格式只允许读取。

##### `human-legacy-doc-edit-skip-live`

- 测试类型：`backend / live`
- What：真实模型尝试编辑旧版 .doc 后遵循工具错误信息，停止重试并跳过。
- Why：不可写格式必须快速收敛，避免反复工具调用和误改原文件。
- How：要求直接编辑旧版文档，检查一次失败、错误信息、最终答复和文件 hash。
- Oracle：只尝试一次编辑；docx_edit 返回「禁止尝试任何对 .doc 文件的编辑」错误；源文件不变且任务完成。
- Not：不要求模型绕过格式限制，也不把失败后的多次重试视为可接受结果。

##### `human-ppt-read-management-risk-review-live`

- 测试类型：`backend / live`
- What：真实模型审阅经营复盘 PPT，并直接向管理层汇报风险、负责人、期限、决策事项和图表趋势。
- Why：真实读 PPT 是对话咨询场景，不应要求用户接收测试专用 JSON 文件。
- How：用户要求核对图表但不修改演示文稿；模型自行读取文字和视觉内容。
- Oracle：源 PPT 不变；真实文字读取和有可用文本的视觉识别均成功；结论由 raw logs 人工评估。
- Not：不写 `management-risk-review.json`，不匹配最终回答文案。

##### `human-session-resume-with-new-selection-live`

- 测试类型：`backend`
- What：live 模式下第一诉求已经沉淀局部事实后发生网络中断，同一 session 新诉求可恢复旧语义上下文，同时本轮新选择文件会覆盖中断快照里的旧选择范围。
- Why：恢复能力的真实价值是让用户在长任务中断后继续对话；如果中断前已读到的事实丢失，或恢复时忽略最新诉求/最新选中文件，就会把恢复退化成重跑或错误沿用旧入口。
- How：使用已有共享 workspace fixture，即 `tests/fixtures/workspace`。Run 1 选中文件 A `深度学习.docx`，让真实模型读取并沉淀“过拟合/过度拟合”的定义、原因和处理信息（需完成多轮定位、交叉核对、更新计划、写草稿）；测试 driver 在确认工具结果中已经出现过拟合事实且脑回合数达到门槛后，于后续 `human.brain` 调用注入 `network_error`，保存恢复快照。Run 2 恢复真实 LLM 配置，同 session 继续提问并显式改选文件 B `图形学.docx`，要求保留过拟合信息并补充反走样信息形成对比小结。
- Oracle：Run 1 注入失败为 `network_error` 且 `resumeSnapshotSaved=true`；恢复快照保持最小化语义（保留 plan / 已学技能等），中断前沉淀的过拟合事实通过会话消息转录在 Run 2 的 brain prompt / llm-io 中恢复；Run 2 消息数组末尾为 `buildBrainUserMessage` 的 user 消息（`<task_goal>` 为 Run 2 输入），其前是 Run 1 完整历史；Run 2 成功完成，brain prompt / llm-io 出现本轮新选择文件 B 与恢复出的过拟合上下文（含“训练时间过久 / 记住过多训练数据”等事实短语）；最终交付同时包含过拟合与反走样关键事实；Run 2 成功后恢复快照被清空。
- Not：不验证真实 provider 的随机网络抖动；不要求 live 模型逐字复述 hint 文案；不恢复 docx 临时运行态。

##### `human-cross-session-continuation-live`

- 测试类型：`backend / live`
- What：同一 session 先正常完成第一件事，再续接第二件相关联的事，消息数组按“完整历史 + 尾部 user 消息”叠加。
- Why：跨会话续接与中断恢复共用同一套消息重建；如果续接时新诉求被前置而非追加到历史之后，就会破坏对话顺序并丢失上一轮交付上下文。
- How：使用共享 workspace fixture。Run 1 选中 `深度学习.docx` 整理“过拟合”概念并正常完成；Run 2 同 session 改选 `图形学.docx`，要求保留过拟合信息并补充反走样形成对比小结。检查 Run 2 首次 brain 消息数组。
- Oracle：Run 1 与 Run 2 均 `completed`；Run 2 消息数组末尾为 `buildBrainUserMessage` 的 user 消息，其前历史包含 Run 1 原始 user 消息与 Run 1 最终交付；Run 2 使用文件 B；最终交付同时包含过拟合与反走样关键事实。
- Not：不验证 UI 会话持久化（由 Workbench E2E 覆盖）；不要求固定工具顺序。

##### `human-ppt-write-management-review-live`

- 测试类型：`backend / live`
- What：真实模型更新既有管理层汇报 PPT，新增摘要页、升级风险并更新行动期限。
- Why：PPT 修改必须验证真实正式文件、受保护页和视觉复核，而非模型口头说明。
- How：用户描述管理层评审诉求；模型自行读取、编辑并检查页面可读性。
- Oracle：目标页和保护页正确，正式 PPT 可解析，artifact 与 apply record 存在，视觉识别返回可用文本。
- Not：不生成额外 JSON，不检查固定工具顺序。

##### `human-terminal-data-reconciliation-live`

- 测试类型：`backend / live`
- What：真实模型将发票与回款数据对账，并为财务交付异常清单 CSV。
- Why：这是独立的真实终端智能性场景，不与 Excel 读写 case 混合。
- How：用户只描述对账和财务异常清单需求，不出现终端或命令概念。
- Oracle：输入文件不变；对账计算与 `reconciliation-exceptions.csv` 产出必须经过 terminal 脚本（`python/awk/join` 等真实计算命令），对应修改记录 `source` 必须为 `terminal_tool`；异常行和金额正确。
- Not：不生成测试专用 JSON，不混入终端协议、runtime 下载或临时目录契约。

##### `human-runtime-script-system-python-live`

- 测试类型：`backend / live`
- What：真实模型在本机 Python 可用时，用本机 Python 在临时脚本目录（`runtime_paths.scripts`）编写并运行临时脚本，完成确定性计算并核对结果。
- Why：runtime 脚本是 AI 架构的临时执行入口，必须验证真实模型能自主把临时脚本放进运行时目录并用本机解释器执行，而非文本猜测。
- How：不限制工具；用户以自然语言要求用 Python 计算并核对，并说明脚本是临时用途、放在临时脚本目录。harness 只检查 terminal 事件、运行产物与脚本目录。
- Oracle：run completed；terminal 结果包含确定性标记；命令使用 `python`/`python3`；临时脚本目录出现 `.py`；工作区普通目录无正式产物。
- Not：不验证下载安装 runtime；该路径由独立下载 case 验证。

##### `human-runtime-download-python-live`

- 测试类型：`backend / live`
- What：真实模型在本机 Python 不可用时，自行下载无需系统安装的 Python 运行环境，再运行临时脚本完成确定性计算。
- Why：AI runtime 必须能在缺少系统 Python 的环境中自主补齐真实执行能力。
- How：harness 通过 terminal 环境 PATH 覆盖隐藏系统 Python（`python`/`python3` → exit 127），不限制工具；用户以自然语言说明 Python 不可用、请自行准备可运行环境并完成计算。
- Oracle：run completed；terminal 结果包含确定性标记；临时脚本目录出现 `.py`；存在下载/安装/调用非系统 Python 的命令证据。
- Not：不修改或依赖系统级 Python 安装，不预设下载 URL 或固定步骤。

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
- Oracle：任务最终完成；共享 workspace 中全部已支持文件均被索引；事件流中至少出现一次 `terminal_run`、至少一次真实资料读取/检索步骤以及一次对新路径的 `docx_edit(insert_blocks)`；模型会打开模板和上周周报；最终输出 artifacts 中包含携带 `applyId` 的 docx file artifact；模板与既有参考 `docx` 文件不被覆盖。按 10 分制评估文件交付、原文件安全、未闭环风险、负责人动作和谨慎结论，严格超过 8 分通过；否定上下文中的“风险已解除”等文字不得误判成正向收口。
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

##### `human-docx-visual-reading-live`

- 测试类型：`backend / live`
- What：真实模型能从 DOCX 递归 visual 节点取得 visualId，并按需读取普通图片。
- Why：mock 只能证明协议可串联，live 还要验证模型在自然语言任务下会自主选择视觉读取，并能使用真实识图结果回答。
- How：只选择含五种 visual kind 的真实 OOXML fixture，要求模型找到标有 IMAGE 的普通图片，说明标题、主要颜色和基本图形；只开放 DOCX 读取工具，不在用户输入中提供工具名或调用顺序。
- Oracle：任务完成；模型读取详细 block 并成功调用 `docx_read_visuals`；识图结果和最终答复都包含 IMAGE，最终答复识别出蓝色、矩形和圆形；不调用 `image_analyze` 或 `docx_edit`；源 DOCX 不变。
- Not：不通过 backend live 重复验证 chart、diagram、shape 的 BrowserWindow 渲染；该链路由真实 Electron 渲染测试覆盖。

##### `human-docx-dangling-image-edit-live`

- 测试类型：`backend / live`
- What：真实模型能读取带 `NULL` 图片残留的需求 DOCX，识别真实图片、评估需求并写回开发时间。
- Why：这条回归覆盖用户真实的“读图 + 分析 + 同文件编辑”闭环，防止底层脏关系再次被算成虚假图片或阻止写入。
- How：使用真实附件和用户原句，只开放 DOCX 读取、图片读取和编辑工具，并注入主模型与视觉模型配置。
- Oracle：任务完成；调用 DOCX 读取、视觉读取和成功的 `docx_edit`；视觉结果没有缺失图片错误，最终答复不出现“图片9”，产出的 DOCX 比原文新增至少 12 条有效工时表达。
- Not：不要求固定的估时数值、工具调用次数或最终答复措辞；未配置 live 模型时按规范跳过。

##### `human-web-search-by-url-live`

- 测试类型：`backend`
- What：live 模式下用户直接给指定地址，`human` 通过 `web_search(url)` 读取该页正文并回答。
- Why：用户给定具体网址时，`human` 应直接读取该地址而不是先搜索，这是网页读取的低成本入口，必须稳定。
- How：启动本地 HTTP server 承载通知页（含申请对象与截止日期），用户输入明确给出该通知页 URL，要求模型阅读该页并回答两个事实。
- Oracle：事件流中至少一次成功调用 `web_search(url)` 且 `finalUrl` 命中给定地址；最终答复包含页面正文里的申请对象与截止日期。
- Not：不要求多跳或跨域；只要给定地址被直接读取并基于正文回答。

##### `human-web-search-intent-query-live`

- 测试类型：`backend`
- What：live 模式下用户只给纯文本诉求、不给网址，`human` 提炼搜索意图后通过 `web_search(query)` 搜索并读取官方文档回答。
- Why：真实用户常只描述诉求不给网址；`human` 应提炼关键词走 query 搜索而非直接 fallback 浏览器。
- How：不向用户输入提供 URL，只给“查找 pandas 官方文档 CSV 读取和写入 API 并说明”的自然语言诉求；要求模型自行提炼意图并读取官方文档页面完成整理。
- Oracle：至少一次成功调用带 `query` 的 `web_search`；至少读取一个 `pandas.pydata.org` 官方 API 页面并基于正文回答。
- Not：不要求复杂跨域或深链路，也不要求模型第一次就命中最终文档页；因 query 搜索偶发不可用，允许模型在搜索失败时用 `browser_use` 兜底读取官方页面。

##### `human-text-file-read-checkout-readiness-live`

- 测试类型：`backend / live`
- What：真实模型在上线前阅读 checkout 配置，并直接向用户说明主备地址、超时、重试和 telemetry 是否具备切换条件。
- Why：读配置是常见的上线前审查场景，用户不需要了解底层工具或要求生成额外文件。
- How：只给出自然语言的审查诉求；只开放真实 `text_file_read`。
- Oracle：任务完成；发生真实读取；源文件 hash 不变；结论质量由 raw logs 人工评估。
- Not：不检查最终回答的固定文本。

##### `human-text-file-write-checkout-cutover-live`

- 测试类型：`backend / live`
- What：真实模型执行一次明确的 checkout 服务地址切换，并保留重试和 telemetry 配置。
- Why：真实配置变更必须验证目标修改和非目标内容完整性，而不是固定底层 edit action。
- How：用户明确给出两处旧地址、目标地址、超时和不可修改项；模型自行读取、编辑并复核。
- Oracle：最终文件两处地址和超时精确更新；重试与 telemetry 不变；不检查最终回答文案。
- Not：不要求 `replaceAll`、`edit` 或固定调用顺序。

Terminal preview-service protocol coverage remains in `ai/tool/terminal`.

- 测试类型：`backend`
- What：live 模型能在项目子目录启动临时 HTTP 预览服务，真实访问页面、读取服务日志并彻底停止服务。
- Why：工具契约正确不代表模型能理解 `command_still_running`，也不代表它会在完成检查后主动清理长时间运行的进程。
- How：在临时 workspace 的 `preview-site` 中创建带唯一标记的页面，为用户提供一个随机空闲端口；用户只描述“进入目录启动预览、确认页面、检查请求日志、用完关闭”的真实诉求，不指定工具或命令。仅开放三个 terminal 工具，由真实模型自主决策。
- Oracle：服务命令在 `preview-site` 中运行并返回 `command_still_running`；模型使用 `terminal_read` 读取服务终端，页面标记出现在真实终端结果和最终答复中；运行结束后服务终端由框架清理；工具结果不包含 `availableActions` 或内部 `commandId`。
- Not：不绑定 Python、curl 等具体命令，不要求固定工具调用轮数，不验证 Workbench UI 或公网访问。
