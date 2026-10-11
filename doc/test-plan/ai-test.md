# NCurator-Desktop AI 测试计划

## 1. 总体目标

- 本计划只定义 AI 域回归范围、领域特有规则与 case 清单。
- 通用测试分类、目录约定、runner / 常用命令、raw logs、UI E2E 与 live 断言规则统一遵循 [`doc/test.md`](../test.md)，本文不重复。
- AI 回归只围绕两类稳定对象：`tool` 与 `human`（含 `mock-llm` / `live`）。

## 2. Suite 设计

### 2.1 `tool`

- 负责生产工具 runtime 的完整输入输出、读写链、错误边界、原子性、修改记录与回退契约；只验证真实生产工具调用，不允许 fake。
- `tool / docx` 覆盖 7 个公开工具、单 operation 写入、稳定 `nodeId`、跨工具 Working 会话和 首次原始字节基线→最终确认落盘版本净 Diff。
- `tool / text-file` 覆盖普通文本按行分页读取、四种写入 action、修改记录、结构化 diff 与回退前置数据，以及按行号定位的文本搜索；unit 侧见 `tests/case/unit/ai/text-file-tool-contract.test.ts`。
- `tool / image-generation` 覆盖 SVG 内部绘制输入、PNG/JPEG/WebP 转码、自动创建或更新、工作地址内修改记录、Artifact、安全校验和工作地址外绝对路径写入不记录回退。
- `tool / pdf` 使用真实 `深度学习.pdf`，覆盖元数据、页级正文、literal/regex 搜索、页面 PNG、工作地址外绝对路径读取、损坏文件和结果大小限制。
- `tool / web-browsing` 包含 `web-crawl-contract`，用于守住 `web_search` 和 `browser_use` 工具契约。`browser_use` 网址协议、系统错误页、加载超时与 `navigate` 成败字段由 Workbench `browser-navigate-error-page` 与 unit `navigate-plan` 覆盖。
- `RUNTIME_TOOL_CATALOG` 中的全部工具均要求绑定专用 `modelResult.renderSuccess`（[`registry.ts`](../../src/main/services/ai/human/tools/registry.ts) compile-time 完整性检查）；**不对 prompt 措辞或 renderer 投影文字做 unit 单测**。工具契约由 **family unit contract**（如 `docx-tool-contract`、`terminal-tool-contract`、`text-file-tool-contract`）与 **backend tool integration** 保障。
- 约束：使用真实工具、store、docx apply service 和 artifact 流；禁止 fake `documentsStore`、`embeddingService`、`resolveDocxOpenTarget` 或 tool result。`web-crawl-contract` 里 `browser-use-navigate-returns-tab-for-follow-up` 等仍注入假 `browserUseService`、`web-search-returns-serp-by-search-type` 仍 mock search，待改为真实 CDP / 本地网页，不得当作已批准例外。
- `web-browsing` 工具测试先启动测试 Electron CDP host 和专用非持久化 partition，再让冻结 sidecar bin 的 Python Playwright 显式复用该测试 Electron 的 Node，通过隔离 context 抓取；host 必须 headless 且不得挂主窗口。该独立 host 可以继续开进程级调试口，与正式 App 无关。正式 App 的 `browser_use` 在无进程级 `--remote-debugging-port` 下，于 observe/act 时按 Tab 挂本机 CDP 桥。另覆盖 `browser_use` 服务不可用诊断。禁止使用 sidecar 内置 Node/浏览器或 Electron 默认 context。`web_search` 结果只回模型，不得自动展开右侧搜索列表（该面板已不存在）。

### 2.2 `human`

- `mock-llm`：在 non-live 下验证 `AiRunService -> human` 入口与主链；只允许固定 LLM 输入输出，必须真实走 `createAiRunContext -> human graph -> learning / hand -> store / apply / artifact`；禁止 `humanReasonOverrides`、`toolExecutionOverrides`、手工串 node、fake tool/store/docx apply service。要通过不同 case 把关键节点与关键边都跑到。
- `live`：验证真实模型下的真实业务执行；必须走真实 LLM executor、真实 KB、真实工具与 apply / artifact；禁止 scripted driver、`chatStructuredOverride`、fixture store override。用户输入不得包含内部工具名或固定调用顺序。至少保留 1 条简单与 1 条复杂回归 case；全内置服务商连通性由 Workbench `live-preset-provider-smoke` 覆盖。case 不设评分门槛，人工依据 raw logs 与 artifact 将 0–100 评估回写本文 §5 快照。live 环境变量复用 `doc/test-plan/workbench-test.md`「总体目标」中的共享服务商配置；通用断言规则遵循 `doc/test.md`。

## 3. 领域特有规则

### 3.1 Harness 规则

- fixture 可用 `tests/fixtures/workspace`；运行时作为设置页文件地址 + 伙伴，不再「绑定工作区才能跑」。
- AI backend 回归以生产 `createAiRunContext` 为唯一 runtime 入口，使用真实 store、apply service 和 embedding service；文档 worker 经 `AiRunResourceManager` 在 run 结束时释放，释放失败不得覆盖任务结果。
- `mock-llm` 只固定 LLM 输出，其余全部真实；`live` 走真实 `LlmConfigStore` 与生产 LLM executor。
- AI run 与 human harness 不准备 embedding；KB 工具调用时统一检查模型安装与本地初始化，不隐式下载或静默降级。需要 KB 的 fixture 显式通过真实下载 / 索引准备模型和资料；不使用 KB 的回归不准备模型。所有支持文件前置「文件名锚点」内容块；Excel 只索引文件名、文档标题与工作表名等元数据。
- 默认 `testTimeout` / `hookTimeout` 为 `900_000`；少数重型 live case 可覆写更长超时。

### 3.2 `mock-llm` 与 `live` 设计口径

#### mock-llm

- 目的：快速定位非 LLM 问题，并验证关键节点 / 边在真实生产 graph 中能跑通。
- 允许脚本化 LLM 输入输出；不允许脚本化 runtime 节点执行结果。
- 断言重点：节点流转、工具调用、审批事件、artifact、memory、错误收敛、状态收口。
- artifact 进入伙伴消息记录与提示词时只允许 `kind / path / operation`；内部 `capability / fileName / applyId` 不得进入提示词。
- 已落地的文件修改不得因 `run_failed` / `run_cancelled` 丢失；终态消息与 Workbench 须继续显示对应修改记录。

#### live

跨 run 缓存用例从已完成落盘的 LLM 日志按真实 `runId` 选择上一轮末次有效 brain 和下一轮首次 brain；禁止按日志数组长度切分轮次。断言记录双方 runId/callId、历史消息前缀和工具定义是否一致，以及服务端返回的缓存复用率。保留 85% 门槛；低命中与前缀改写分开归因，不用延时或降低门槛掩盖失败。

- 目的：验证真实业务场景在真实生产调用下可以完成。
- 涉及文件写入、审核交付的 Live case 使用生产 `AiRunService.run`，经过真正主 run 收尾后再断言审核。正式文件、最终校验值、自包含审核内容及工作快照清理均须核对，不能以 graph 回答结束代替收尾；同一伙伴多轮使用独立 runId。若最后一次受控写入后又由 terminal 修改正式文件，日志须记录当前校验与确认 B 的差异并复核原因，审核仍以确认 B 为准。
- case 使用真实用户风格输入；断言口径遵循 `doc/test.md` 的真实 AI / live 规则。
- 涉及计算 / 对账 / 统计时，brain 要求经 terminal 真实计算；live case 硬断言完成态、关键产物与 terminal 计算是否发生。终端改文件不进修改记录。
- 完整证据写入测试运行产物，文件交付同时归档正式文件和自包含审核（PPT 连同 SVG 资源），便于结束后复核实际效果；§5“最新 Live 评估”仅由人工复核后覆盖更新。

### 3.3 文件写盘、Run 收尾与历史审核

Word、PPT、Excel、普通文本统一由主 run 的文件会话管理。工具成功前正式文件完整写入、立即回读验证，并持久化唯一最新确认工作版本及结构身份。首次实际写入前保存原始字节 A；主 run 真正完成、失败或取消时仅计算 A→最后成功版本 B 的净差异。子任务结束、yield、模型回答及追加消息续接不触发收尾。正式文件后来变为 C，历史审核和最终校验值仍属于 B。

主要覆盖归 `ai/tool`：四类真实工具逐次解析正式文件；运行中无审核产物；收尾一次、恢复原样不留修改记录、新建空文件仍可撤销；连续修改、runtime 重建、子任务共享基线、纯格式和结构变化；A→B 后外部写 C 的历史审核；PPT 连续公式替换并在中途重建 runtime、移动/恢复、页码/层级顺移、纯文字对齐及备注仅修改标记；Excel 行列对齐、Sheet 重命名/同名重建、空白样式/尺寸/合并及合并区域行列操作。断言正式文件、审核中的实际内容、样式和标记，不能仅检查存在或计数。

`unit/ai` 覆盖共用发布边界和算法：保存前失败、保存后失败、回读不一致、快照持久化失败；错误包含实际原因和真实文件状态，不暴露内部路径，不自动恢复；下一次编辑重新读取磁盘。首次修改在尝试替换正式文件前失败时，不固定该次基线；重试以当时正式文件为 A。AI 生命周期覆盖正常/失败/取消、在途写入等待、进程中断和启动补生成、重复收尾及审核失败保留计算输入。不得增加生产故障开关。Excel 持久化失败用例必须到达目标失败阶段。

审核产物自包含：Word review.docx、Excel review.xlsx、PPT manifest.json 与前后 SVG/资源、文本 review.json（完整有序差异行及旧新行数）。完成记录保存后清理临时工作版本和 pending.json；原始 A 按内容寻址保存以支持原始字节回退。覆盖清理 B 后仍可渲染、文本未变行展开、新建撤销、后续修改确认、两轮依次撤销。Word 既有净比较、字符差异、格式和资源矩阵完整回归。失败或取消不否认已落盘事实。

### 3.4 结构化输出与服务重试

结构化输出统一走 `prompt_json`：所有结构化调用都是纯文本请求（不发送 `response_format`），模型按提示词中的 schema 描述输出 JSON，本地通过 `normalizePromptJsonText`（剥离代码块）+ `jsonrepair` + Schema 校验兜底。供应商对 `json_schema` / `json_object` 的能力支持无法可靠探测（`/v1/models` 大多不返回能力声明且分模型差异），因此不再维护任何运行期降级链、策略偏好存储或 transport 切换。

LLM 失败分类与重试信号遵循 `doc/ai-harness/human-harness.md` §8.4；测试验证结构化信号、不可重试边界及退避事件。相关单元覆盖在 `tests/case/unit/ai/structured-output-single-path.test.ts`（prompt_json 单一路径与解析兜底矩阵）、`tests/case/unit/ai/llm-error-classification.test.ts`（fatal/retryable/unknown 分类，含连接/超时类型信号）和 `tests/case/unit/ai/structured-chat-activity.test.ts`（退避与重试事件）。

## 4. 回归测试清单

### 4.1 `tool`

#### file-changes 类别

##### `file-change-immutable-review`

- 测试类型：backend / tool-real；suite `tool`，group `file-changes`。
- What：四类文件统一版本与审核闭环。
- Why：防止可变正式文件污染历史 B。
- How：真实公开工具写入，外部写 C，再显式 owner 收尾并解析审核。
- Oracle：四类真实工具正式 A→B，运行中无审核，外部 C 后收尾固定 B；删除临时版本、重复收尾与原始字节回退。

#### docx 类别

DOCX tool 回归以 7 个公开工具、story 内容树、稳定 `nodeId`、segment map 百分比区间、literal/regex 完整原文搜索、单 operation 写入、最多 20 目标的原子格式化和 首次原始字节基线→最终确认落盘版本净 Diff 为唯一现行协议。底层 OOXML、identity、保真与 Diff 细节由 `tests/case/unit/ai/docx-*.test.ts` 覆盖，包括 segment 无遗漏/无重叠、分页/分栏/section 边界、中英文混合 TF-IDF、DrawingML/VML 视觉锚点、TF-IDF/MMR 摘要预算、搜索全量计数但只构造前 10 条详情、无效搜索 scope、批量格式预校验和回滚、全部写 operation 矩阵、跨 story 身份、相同 run 插入、1-based 表格坐标和 visual 节点编辑清理。公开工具回归还必须验证错误 ID 不会提交部分修改。

##### `docx-public-tools`

- 测试类型：`backend`
- What：DOCX 公共工具共享编辑会话；读取返回继承后的有效格式，连续内容、格式、表格、图片、批注与修订操作后仍可回读。
- Why：公共工具必须让 AI 通过“定位 nodeId → 单次局部操作 → 精准读取确认”稳定完成真实任务，同时避免写工具把完整节点再次放入上下文。
- How：创建真实 DOCX，通过生产公共工具执行 outline/read/search、内容替换、段落格式、表格结构、图片与批注操作，并再次 read/search；另用真实 OOXML 样式准备文档默认、段落与字符多层继承、直接加粗和直接取消加粗，检查结构化读取与生产 modelResult 投影。
- Oracle：读取正确合并默认、段落、字符样式及直接格式；继承加粗可见，直接取消加粗保留为 false，普通文字不误加粗，缺失或循环样式不阻塞读取；模型文本的样式目录与文字节点引用对应。每次写入只接收一个 discriminated operation；未删除节点的 `nodeId` 保持稳定；普通写入返回空领域结果，创建操作只返回 `createdIds`；四个写工具看到同一 Working 状态，最终状态可由读取工具确认。

##### `docx-outline-pagination`

- 测试类型：`backend`
- What：`docx_read_outline` 按 `fromPercent`/`toPercent` 返回覆盖该根节点比例的完整 segment，并覆盖 360 字符 `textMap`、多 story、空文档和密集独立表格。
- Why：outline 是 AI 低上下文定位入口，必须能直接点名文档比例，包括 `0–100` 全文。
- How：创建超过 480 个根节点并带表格、页眉和超长中段的真实 DOCX，分别读取全文、前半、末尾；另建 50 个独立表格的文档请求全文。
- Oracle：返回 `fromPercent/toPercent/fromNodeIndex/toNodeIndex/totalRootCount/segments`；根节点无遗漏、无重叠，table 和跨 story 独立分段，`textMap` 不超过 360 字符且不返回 nodeId；`0–100` 返回该文档全部 segment。

##### `docx-auto-open-no-fake-failure`

- 测试类型：`backend`
- What：DOCX 工具自动打开真实绝对路径，不产生伪失败或重复会话。
- Why：AI 首次调用任意读写工具都应获得一致的 Source/Working 会话。
- How：对同一路径连续调用读工具并检查运行期 open 与 session 状态。
- Oracle：只建立一个当前会话，返回真实节点；错误路径和 `.doc` 写入返回明确错误。

##### `docx-apply-diff`

- 测试类型：`backend`
- What：真实 DOCX 公开工具写入到首尾净审阅、正式文件、统计、连续任务基线和 checkpoint 回退。
- Why：内容正确和全局红绿数量不足以证明审阅位置、局部范围和资源正确，不能按操作历史生成审阅。
- How：生产 createAiRunContext 与真实 docx 工具、Worker、store 和 apply service；隔离文档执行连续替换、恢复、表格、页眉、命名样式及批注，解析真实 Review OOXML 并回退。
- Oracle：字符级 Diff 只保留原始删除字符和最终新增字符；纯格式局部绿标、不覆盖原色/背景、不插入说明；不可见文档级变化有效计数但无假新增；恢复原状无记录；正式文件无系统标记；回退逐字节恢复。

##### `docx-net-review-matrix`

- 测试类型：`backend`
- What：DOCX 内容、格式、表格和资源的首尾净变化矩阵，包含重复内容、位置和字符范围。
- Why：防止只验证 operation 成功或标记存在而漏掉审阅语义。
- How：真实七个公开工具和 apply 链路；按下表准备真实隔离输入，执行生产写入后解析正式文件、review、记录，并从 checkpoint 回退；同一 case 内分开记录每个场景断言，禁止 fake executor/store 或伪造产物。
- Oracle：每个场景同时验证最终文件、审阅位置与范围、净统计、资源引用和回退；不同操作得到相同首尾状态时结果一致；去掉系统删除内容还原最终文字，去掉系统新增内容还原原始文字及顺序。

| 能力     | 覆盖场景 / Oracle                                                                             |
| -------- | --------------------------------------------------------------------------------------------- |
| 内容     | 新增、删除、替换、清空、整节点替换、连续修改、恢复、新增后删除、操作路径等价                  |
| 移动     | 上下、相邻、首尾、多段、重复文字、表格前后、移回；旧位置红删、新位置绿增；无变化移动成功      |
| 组合     | 先改后搬、先搬后改、连续搬、搬回保留改字、搬后删除                                            |
| 字符     | 中文英文、数字标点、离散修改、空白、emoji/组合字符、跨 run/超链接、相同文字重新分 run、长段落 |
| 格式     | 字符/段落/单元格/表格/节范围；原色及背景保留；格式恢复与间接命名样式变化                      |
| 表格     | 单元格改字/格式、行列增删、合并拆分、整表移动、对象替换                                       |
| 区域资源 | 正文、页眉页脚及支持的脚注/文本框；图片、编号、链接、字段等引用完整且旧资源保留               |
| 文档级   | 批注增改删、修订接受拒绝、样式和设置变化及恢复；不重复计数                                    |
| 生命周期 | 新建/回退删除、多文件隔离、连续执行首次基线、先进入编辑但后生成记录、零变化消除、统计一致     |
| 失败     | 无效目标、跨 story 禁止移动、批量预检/执行失败无部分写盘                                      |

公开协议覆盖矩阵如下。`docx-net-review-matrix` 的每个场景均走真实 runtime、Worker、文件、记录和回退服务；读取分页、搜索预算、定位错误和原子格式化另由对应公开用例验证。内部媒体 operation 不属于额外公开工具，公开入口使用 visual 节点的内容编辑协议。

| 公开工具                  | 全部操作 / 请求范围                                                                                                                                                                                       | 正式用例与核心断言                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `docx_read_outline`       | 百分比范围、空文档、多区域、密集表格、长段落                                                                                                                                                              | `docx-outline-pagination`、`docx-public-tools`：完整 segment、顺序、文字预算、真实当前状态                                                      |
| `docx_search`             | literal / regex、scope、计数、邻居、无效表达式                                                                                                                                                            | `docx-search-original-text-contract`、`docx-search-literal-contract`、`docx-search-regex-contract`：原文精确命中、稳定 ID、全量计数、失败无写入 |
| `docx_read_nodes`         | node IDs / node index、递归表格、visual                                                                                                                                                                   | `docx-public-tools`：定位后精准复读、跨工具状态共享、图片引用及创建 ID 可读                                                                     |
| `docx_content_edit`       | `replace_text`、`insert_nodes`、`replace_node`、`delete_node`、`move_node`                                                                                                                                | `docx-public-tools`、`docx-net-review-matrix`：文字/visual 创建替换删除移动、首尾顺序重建、等价路径、无变化移动、跨区域拒绝无部分提交           |
| `docx_format`             | `format_text`、`format_paragraph`、`format_section`、`reset_format`、`apply_named_style`、`create_named_style`、`update_named_style`、`delete_named_style`、`set_numbering`                               | `docx-public-tools`、`docx-net-review-matrix`：实际范围、纯格式 +0/-0、独立样式记录、恢复消除、批量无效目标不得部分生效                         |
| `docx_table_edit`         | `create_table`、`delete_table`、`insert_row`、`delete_row`、`insert_column`、`delete_column`、`merge_cells`、`split_cell`、`format_table`、`format_row`、`format_cell`                                    | `docx-net-review-matrix`：首尾行列/合并拓扑、对应单元格、格式范围、逐字节回退                                                                   |
| `docx_comments_revisions` | `add_comment`、`update_comment`、`reply_comment`、`delete_comment`、`enable_track_changes`、`disable_track_changes`、`accept_revision`、`reject_revision`、`accept_all_revisions`、`reject_all_revisions` | `docx-public-tools`、`docx-net-review-matrix`、`docx-apply-diff`：批注/设置独立变化、根级修订结构、原有用户修订保留、恢复/回退                  |

Unit `docx-diff` 补重复内容匹配、跨 run 字符、Unicode 分段、大范围文字变化与长段落耗时/输出规模；`docx-review-resources` 补超链接、旧新资源冲突、源文件已有 NULL/缺失图片关系、命名样式/默认样式/主题继承、缺失定义补全、节范围、用户修订保真。已有损坏图片关系保留原始目标，不复制不存在的资源；真实图片仍完整导入，审核不得产生新增校验问题或因残留图片阻断文字差异。`docx-node-identity`、`docx-operation-matrix` 和现有递归/visual 测试继续保障编辑能力；这些测试不能替代上述真实公开工具覆盖。Workbench 用例归属及界面 Oracle 见 Workbench 测试计划。

##### `docx-search-original-text-contract`

- 测试类型：`backend`
- What：literal 与 regex 都只搜索完整原文，不隐式改写 Unicode 字形。
- Why：工具必须返回真实出现位置，不能把归一化后的偏移误当成原文偏移。
- How：在真实 DOCX 中写入兼容字形并执行 `docx_search`。
- Oracle：兼容字形的精确查询命中并返回稳定 `nodeId`、当前 `nodeIndex`、`matchText` 和 `textContext`；不同字形不命中。

##### `docx-search-literal-contract`

- 测试类型：`backend`
- What：literal 搜索统计每个实际命中，并可返回前后各 2 个同 story 节点。
- Why：同节点多次出现也必须准确计数，邻居上下文用于一次调用判断位置。
- How：在五个连续段落的中心段写入两个相同关键词，分别执行精确查询和近似但不同的查询。
- Oracle：精确查询 `totalMatchCount=2`，两个 match 使用同一稳定 `nodeId`，邻居各 2 个；不同查询不触发硬编码别名；高频查询统计全部命中但只在 Worker 构造前 10 条详情，任一 scope nodeId 无效时返回 `invalid_input`。

##### `docx-search-regex-contract`

- 测试类型：`backend`
- What：regex 搜索执行显式正则并拒绝无效表达式。
- Why：复杂定位需要可预测的模式匹配和明确失败。
- How：对真实段落执行有效与无效 regex。
- Oracle：有效表达式按文档顺序返回节点；无效表达式不修改会话并返回输入错误。

#### text-file 类别

##### `text-file-read-write-contract`

- 测试类型：`backend`
- What：普通文本创建、范围读取、多个唯一编辑、replaceAll、AI-facing 简短结果、修改记录和结构化 diff。
- Why：普通文本工具是代码、Markdown 和配置文件处理的基础，必须保证 AI 不需要生成或解析 unified diff。
- How：真实调用 `text_file_read/text_file_edit`，连续执行 create、edit、replaceAll，再从统一修改记录读取 diff artifact 并用 before 内容重放。
- Oracle：文件内容正确；结果只包含简短文本；每次写入产生 `text_file` 修改记录与 artifact；结构化 diff 重放等于真实 after。

##### `text-file-atomic-guards-and-format-preservation`

- 测试类型：`backend`
- What：edit 多匹配失败、replaceAll 全部非重叠替换、不递归替换和 BOM/CRLF 保持。
- Why：歧义匹配或部分落盘会直接损坏用户代码，格式漂移会制造无关 diff。
- How：对真实 BOM/CRLF 文件执行歧义 edit、成功 replaceAll 和无匹配 replaceAll，并逐次比较 bytes。
- Oracle：失败时 bytes 不变；成功替换次数准确；新内容中的 oldText 不会被再次递归替换；BOM 与 CRLF 保持。

##### `text-file-bounded-line-window`

- 测试类型：`backend`
- What：`text_file_read` 只按行返回有界窗口，覆盖最多 2,000 行、约 51,200 UTF-8 bytes、单行 2,000 字符和 `nextStartLine`。
- Why：工具结果日志已经是多行渲染文本；生产者直接分页比“全量返回后再次 spill”更简单，也不会形成递归落盘。
- How：真实读取 3,000 行中英文文件、2,500 行短文件、超长单行和越界 `lineCount`，使用返回的 `nextStartLine` 连续读取。
- Oracle：窗口停在完整行边界；短行最多返回 2,000 行；超长行追加英文裁剪标记且不破坏 Unicode；续读位置连续；超过最大 `lineCount` 被 schema 拒绝。模型 delivery 为 `<content>` 原始行文本 + `totalLines` + 可选 `nextStartLine`，不含路径、行号前缀或英文 footer。

##### `text-file-search-contract`

- 测试类型：`backend`
- What：`text_file_search` 的 literal/regex 检索返回准确行号、单行超长文本的上下文裁剪与 truncated 标记、命中数上限和无效正则错误。
- Why：模型可先用搜索定位目标行，再用 `text_file_read(startLine)` 获取最小必要范围。
- How：真实调用 `text_file_search` 搜索多行文件（literal/regex）、含 emoji 文件（验证码点对齐）、单行超长 toolresult 日志、超过 10 个命中的文件，并构造无效正则。
- Oracle：行号为 1-based；命中行未超长时 `textContext` 返回整行且 `truncated=false`；单行超长文本裁剪上下文并标记 `truncated`；5 万个命中只保留前 10 条详情，`totalMatchCount` 仍为全量、`returnedMatchCount` 为 10；无效正则报错。

#### pdf 类别

##### `pdf-image-only-page-contract`

- 测试类型：`backend`
- What：没有文本层的纯扫描 PDF 仍返回整页图片路径。
- Why：纯图片 PDF 不能因为正文为空而失去后续主模型多模态读取能力。
- How：运行时生成仅包含一张图片的单页 PDF，并调用 `pdf_read_pages`。
- Oracle：正文为空且 `textStatus=empty`，`pageImagePath` 指向真实存在的页面图片。

##### `pdf-outline-read-search-contract`

- 测试类型：`backend`
- What：真实 PDF 的元数据、页级文本和搜索结果。
- Why：守住 PDF 文本阅读的基础契约。
- How：对 `深度学习.pdf` 执行 `pdf_outline -> pdf_read_pages -> pdf_search`。
- Oracle：页数为 11，标题为“深度学习”，正文没有 NUL，且“过度拟合”能命中第 8 或第 9 页。

##### `pdf-read-pages-image-contract`

- 测试类型：`backend`
- What：指定页面会被渲染为可供其他工具使用的 PNG。
- Why：PDF 与图像识别需要通过普通图片路径解耦协作。
- How：读取第 9 页并检查 `pageImagePath`、图片文件头、源文件哈希和事件。
- Oracle：路径为 `userData/partners/{id}/runtime/assets/pdf_read_pages-<uuid>/<hash>.<ext>`；图片真实存在；源 PDF 不变；不产生普通 artifact。

##### `pdf-result-size-contract`

- 测试类型：`backend`
- What：PDF 工具返回完整正文，统一结果投递层按 `doc/ai-harness/tool-design.md` 第 5 节判定拒绝、全文落盘或内联返回。
- Why：结果大小由统一投递层判断；仅超过内联字符预算且未超过字节或行数拒绝上限时，全文落盘并提供首尾预览与 `text_file_read` 续读指引。工具层不重复实现大小守卫。
- How：构造 PDF 读取结果，调用 `pdf_read_pages` 检查完整正文正常返回。
- Oracle：工具层返回完整 `pages` 正文（不携带 `error`），不生成伪造内容，源 PDF 不变。

##### `pdf-failure-boundary-contract`

- 测试类型：`backend`
- What：PDF 输入边界会明确失败。
- Why：防止伪 PDF、非法 regex 和越界页码进入不确定状态，同时确认外部附件路径可以读取。
- How：分别传入越界页码、非法 regex、错误文件头以及指向工作区外的链接；Windows 使用无需提升权限的目录 junction，Unix 使用目录 symlink。
- Oracle：越界页码、非法 regex 和错误文件头返回明确失败；工作区外 PDF 通过符号链接仍可正常读取。

#### ppt 类别

##### `ppt-create-read-edit-commit`

- 测试类型：`backend / tool`
- What：`ppt_edit` 按单次 operation 用元素规格创建页面、读取、编辑，以及主 run 收尾生成单一页面级 diff 记录。
- Why：PPT 工具必须同时守住直接写回和 run 级差异聚合。
- How：分两次 `insert_slide` 创建真实多页 PPT，连续读取和编辑，运行中检查正式文件，收尾后检查审核记录。
- Oracle：每次 `ppt_edit` 成功后正式文件立即存在、可解析且页面内容正确；写回只含 `slideId` / `createdElementIds` 等锚点；同一文件只生成一条修改记录和页面级 diff。

##### `ppt-diff-slide-and-element-net-semantics`

- 测试类型：`backend / tool`
- What：真实 PPT runtime 按本 Run 首个 baseline 和最终文件生成 Diff Manifest v4，覆盖页面和元素的新增、删除、修改、移动、恢复与组合计数。
- Why：工具调用次数、插入删除造成的页码偏移和置顶造成的层级编号顺移都可能制造假 Diff，必须直接解析真实 artifact 验证净变化。
- How：对三个真实 PPT 连续执行页面 A→B→C、A→B→A、修改后删除、新增后继续修改、新增后删除、中间页删除、主动移动及移动后恢复；再分别改变元素内容、样式、位置、大小、层级，覆盖同元素多种修改、中途重建 runtime 的连续公式 replacement lineage 与纯文字对齐、元素新增后修改、修改后删除、新增后删除、修改后恢复、备注修改后恢复；另对已有页执行 `replace_slide`（同 slideId 整页替换）；最后提交 Run 并读取 Manifest 和正式 PPT。
- Oracle：页面组合得到准确 `+3/-2`，元素组合得到准确 `+7/-1`，`replace_slide` 页为 modified 且元素旧全部 deleted、新全部 added；零净变化文件不生成记录；中间页增删不把后续页标记为移动，置顶只计算真实移动元素；中间稿和临时对象不进入 before/after；正式 PPT 可解析且无 Diff 污染，修改记录的 `insertCount/deleteCount/changeCount` 分别等于 v4 的 positive、negative 和两者之和。

##### `ppt-professional-element-edit`

- 测试类型：`backend / tool`
- What：元素位置、样式、图层、复制、线条、图片、表格、图表和公式更新。
- Why：专业 PPT 编辑依赖元素级能力，不能只覆盖整页创建。
- How：对真实 PPT 依次执行代表性的元素级编辑并重新读取结果；表格创建与更新使用非等宽列、非等高行、明确字号和字体，包含中文人名及全角括号。
- Oracle：操作成功；写回 `createdElementIds` 可继续用于后续编辑；正式 PPT 的列宽、行高、单元格字体和字号正确；审核 SVG 完整保留文字且换行后的字形不越出单元格，也不与相邻说明区域重叠；另一主 run 仅改变表格字号仍产生准确修改标记和前后 SVG；非法维度或不合框的表格在保存前失败。

##### `ppt-visual-runtime-contract`

- 测试类型：`backend`
- What：PPT 元素规格编译、画布边界、非法输入和原子失败保持稳定。
- Why：这是生产 PPT 工具的运行时契约，不应由 Unit 重复拥有完整 runtime 流程。
- How：用元素规格创建、插入、渲染和解析产物；非法出画布（960×540，单位 pt）或字号超过框高的输入应失败。
- Oracle：合法页面生成可解析 PPTX 且关键元素位置与字号（pt，与 bounds 同单位）稳定；非法页面返回可解释错误且不留下半成品。中文、全角标点的 SVG 换行按实际字体宽度测量；普通预览和审核生成使用同一测量规则。

#### excel 类别

##### `excel-blank-layout-and-sheet-identity`

- 测试类型：backend / tool-real；suite `tool`，group `excel`。
- What：空白布局和工作表、行列结构身份。
- Why：不能按空值或相同名称消除有效变化。
- How：真实工具连续编辑并重建 runtime，解析正式文件与 review.xlsx。
- Oracle：空白样式、尺寸、合并、列删除对齐，runtime 重建后 Sheet 重命名/同名重建（含已删除名称冲突）及恢复原样。

##### `excel-create-read-edit`

- 测试类型：`backend / tool`
- What：Excel 专用工具创建工作簿、用 `set_range` 写入数据和公式，并继续执行 workbook / search / range 读取和修改。
- Why：Excel 的值与公式必须由程序真实读写，不能用模型推算或用伪造工具结果代替。
- How：真实调用 `excel_edit` 一次一个 type 创建 xlsx，再调用 `excel_read` 的 workbook/search/range，并继续修改同一路径；另对已有 xlsx 执行修改和清空单元格，最后直接解析正式文件与 diff xlsx 文件。修改记录从 `listFileChangeRecords` 读取，不依赖工具写回。
- Oracle：新文件只包含显式新增的 Sheet，没有默认 `Sheet1`；正式文件包含准确值和公式且不带 diff 边框；diff 文件对新增、修改显示绿色中等粗细边框，对删除显示红色中等粗细边框并保留修改前值；同一路径只保留一条修改记录且差异相对首次写入前 baseline，对齐 `WB-EXCEL-001`、`WB-EXCEL-002-AC2`、`WB-EXCEL-002-AC3`（AC3 记录/baseline **只在本侧硬断言**，Workbench e2e 不重复）。

##### `excel-read-search-and-format-boundaries`

- 测试类型：`backend`
- What：`excel_read` 四种 type 的范围、格式与错误边界。
- Why：当前单一 happy path 无法保护多 Sheet、regex、大结果截断、格子预算和 Office Excel 格式兼容。
- How：真实读取 `xlsx/xlsm/xltx/xltm`，覆盖 `sheetName` 限定、网格 range、literal/regex、10 条 `returnedMatchCount` 与全量 `totalMatchCount`，大 range 走统一 spill，以及非法路径、range、regex 和格式。
- Oracle：结果 Sheet/range/值稳定；搜索最多返回 10 条且 `totalMatchCount` 反映全量命中；搜索只命中单元格值和公式，不搜表名；合法格式可读，非法输入稳定失败且不产生修改记录。

##### `excel-set-style-number-format-persistence`

- 测试类型：`backend`
- What：`set_range` 写值后 `set_style` 设 `#,##0`，并在 merge/auto_fit 后仍能被 ExcelJS、openpyxl 与 `excel_read type=style` 读回。
- Why：Create live 曾出现 openpyxl 验算报 D3–D19 为 General 而 D20 有千分位；需守住 standalone `set_style` 的 numberFormat 落盘路径。
- How：模拟部门明细表写入、合计行 inline style、`set_style D3:D20`、表头样式、merge 标题、auto_fit；分别用 ExcelJS、openpyxl（经 `.pip-cache/test-openpyxl`，缺失时自动 pip install --target）和 `excel_read style` 断言。
- Oracle：`D3`/`D19`/`D20` 的 number format 均为 `#,##0`。

##### `excel-edit-operations-and-atomicity`

- 测试类型：`backend`
- What：Excel 全部编辑 type、样式、工作簿结构、原子写入和累计修改记录，并校验非行位移类 diff xlsx 语义。
- Why：写入失败、外部并发修改或 record 持久化失败必须报告正式文件实际状态；同一次 run 的多轮编辑必须相对首个 baseline 生成累计 Diff；删除 Sheet、清空范围和边框粗细不能只靠 UI e2e 间接发现。
- How：真实覆盖 `set_range`/清空、公式、样式、行列与 Sheet 操作、no-op、外部修改冲突、同 run 两轮编辑；持久化失败边界在 unit/ai 使用真实发布阶段验证，不自动恢复；直接解析 diff xlsx 检查 sheet 顺序、tab 色、单元格值、边框、行高、列宽和合并单元格。
- Oracle：每个 type 落盘后可读；删除最后一个 Sheet 失败；新增 Sheet 在 Diff 中为绿色标签；删除 Sheet 按 baseline 原位置恢复完整旧内容并显示红色标签；清空范围保留修改前值并显示红色中等粗细边框；源 xlsx 不包含 diff 标记；no-op 不产生记录；外部冲突不覆盖文件；保存后失败不恢复正式文件，下一次重新读取；最终仅一条累计 record，Diff 相对首个 baseline。

##### `excel-diff-row-structure-semantics`

- 测试类型：`backend / tool`
- What：插入或删除首行、中间行、末行及连续多行时，Diff 按逻辑行对齐，只标记真实新增或删除的行。
- Why：按单元格地址直接比较会把删除行后的整体上移误判为大量绿色修改，并在末尾生成错误红色重复行。
- How：构造包含唯一行标签、公式、样式和行高的真实 xlsx，分别执行行插入、行删除、删除后继续修改，以及同一 run 多轮结构编辑；直接解析 preview xlsx 的行顺序、值和每个边框。
- Oracle：删除中间行只保留该旧行并标红一次；所有仅因上移或下移而换地址的行无边框；末尾没有重复行；插入行只标绿最终新增行；红绿地址集合和 record 统计精确等于净变化；正式 xlsx 无 diff 标记。

##### `excel-diff-cumulative-net-semantics`

- 测试类型：`backend / tool`
- What：同一 run 的多轮单元格、行和 Sheet 编辑只展示相对首个 baseline 的最终净变化。
- Why：中间操作、改回原值、先增后删和先删后恢复不应进入最终审核结果或放大变更计数。
- How：真实覆盖 `A -> B -> C`、`A -> B -> A`、清空后恢复、插入后删除、新增 Sheet 后删除，并解析最终正式文件与 preview xlsx。
- Oracle：中间版本不出现；恢复原值和先增后删不产生净标记；最终只保留一条 record；红绿数量、Sheet 顺序和实际最终状态完全一致。

##### `hand-excel-read-write-read`

- 测试类型：`backend`
- What：hand 在同一次调用中允许 Excel 读取、写入、再读取的真实串联。
- Why：Excel 工具单测通过不代表 hand 的 schema 预检、调用预算和 artifact 合并可以承载完整链路。
- How：真实执行 `excel_read(workbook) -> excel_edit -> excel_read(range)`。
- Oracle：三步均成功；后读可见前写结果；最终 artifact 和修改记录只指向目标工作簿。

#### kb 类别

##### `kb-list-documents-contract`

- 测试类型：`backend`
- What：`kb_list_documents` 对已索引文件与全局网页的真实列表、`sourceNameQuery` 文档名过滤与 `documentIds` 缩圈契约。
- Why：KB 资料发现必须真实调用生产检索存储。
- How：通过真实 `DocumentsStore.addDocument / addChunks` 导入文件与网页 fixture 后执行列表查询。
- Oracle：默认返回已 seed 的文件与网页文档；`documentIds` 只做进一步缩圈（不存在的 id 被忽略）；文件资料返回 `sourceType=file` 与真实 `filePath`，网页资料返回 `sourceType=web` 与真实 `sourceUrl`。

##### `kb-evidence-search-family-contract`

- 测试类型：`backend`
- What：`kb_search` 在不同 strategy 下的统一真实检索契约。
- Why：KB tool family 必须显式覆盖每个回归工具。
- How：对已 seed 的文件与网页数据分别执行三种检索，并覆盖 `documentIds` 缩圈。
- Oracle：三种检索都返回稳定 `items`；`documentIds` 缩圈语义成立（含全部不存在时返回空）；文件命中保留 `sourceType=file` 与 `filePath`，网页命中保留 `sourceType=web` 与 `sourceUrl`，供最终引用生成可追溯地址。

#### terminal 类别

##### `terminal-directory-inspection-safe`

- 测试类型：`backend`
- What：AI 可仅通过 `terminal_run` 真实执行目录浏览与文本读取类安全指令。
- Why：terminal 工具最典型的安全执行路径。
- How：调用 `terminal_run` 执行当前平台 shell 命令，分别完成目录浏览与文件读取。
- Oracle：返回真实 stdout 片段、退出码与可消费摘要。

##### `terminal-text-search-safe`

- 测试类型：`backend`
- What：AI 可仅通过 `terminal_run` 真实执行安全文本搜索指令。
- Why：搜索是 terminal 工具最常见的辅助路径。
- How：调用 `terminal_run` 执行当前平台 shell 搜索命令。
- Oracle：返回可断言命中信息与正确退出状态。

##### `terminal-result-unusable-docx-output`

- 测试类型：`backend`
- What：`terminal_run` 读到高比例替换符（`U+FFFD`）输出时，会省略原始输出并返回比例事实错误提示；普通文本不被误伤。
- Why：terminal 不能把大量替换符灌进后续 brain prompt；提示只需陈述不可读比例与样例。不按 ZIP/Office 路径特征拦截（避免误伤仍可能对模型有用的倾倒线索）。
- How：写入跨平台稳定的高比例 `U+FFFD` 文本文件并 `terminal_run` 读取，再对普通 `notes.txt` 做低误伤对照。
- Oracle：高比例替换符输出返回省略占位与「终端输出含过多不可读字符」提示（阈值 25%）；普通文本输出保持可读。

##### `terminal-risk-and-boundary-guard`

- 测试类型：`backend / mock-llm`
- What：危险命令与普通文件写入先进入 AI 审核；AI 要求人工确认且人工拒绝后不会执行。
- Why：terminal 风险边界必须靠回归测试长期守住；审批责任在 `hand` 预检，不在 `terminal_run` 内二次问审。
- How：在临时 workspace 中准备受保护文件，mock AI 审核返回 `needs_human_review`，再通过 deny-all 人工审批分别发起删除命令和创建目录命令。
- Oracle：两次 hand 各产生一次非 internal 的审批要求与 reject 决策；不产生 `terminal_step_started` / `tool_call_result(terminal_run)` / `terminal_step_error`；受保护文件仍存在、目标目录未创建。

##### `terminal-inline-interpreter-execution`

- 测试类型：`backend`
- What：终端 inline interpreter 能在受控工作区执行内联 Node/Python 代码并返回真实结果。
- Why：AI 需要可靠的短脚本执行入口，不能把解释器调用误当成普通 shell 文本。
- How：通过 terminal 工具执行内联代码，检查命令、输出、工作目录和边界错误。
- Oracle：返回真实标记和正确退出状态；越界或不可用解释器被明确拒绝。

##### `terminal-execution-contract`

- 测试类型：`backend`
- What：真实 PTY 终端从用户主目录执行命令、长命令让出控制权并可增量读取，退出码正确；允许后台分离执行，放行 fd 合并重定向。
- Why：后台服务和长任务不能依赖单次 shell 超时；分离执行（`&` / `Start-Process`）由模型自行管理生命周期，框架只关闭 PTY 会话本身；`2>&1` 等 fd 合并重定向只是输出流合并，不能误判为危险重定向。
- How：通过 `terminal_run` 分别执行 `pwd`、单命令内 `cd + pwd`、写文件后长 sleep、持续输出命令、写文件后非零退出；通过 `terminal_read` 携带返回的 `readEndPosition` 增量读取持续输出命令，验证单次读取有字符上限、`hasMoreOutput` 指示未读完且可用返回位置连续读完。以 `sleep … & wait`（windows `Start-Process … -Wait`）验证分离执行可完成，以 `echo redirect-ok 2>&1` 验证 fd 合并重定向正常执行。`maxWaitSeconds` 由本 case 与 unit 覆盖：指定后本次调用按该秒数盯，到点命令仍在跑。
- Oracle：命令默认从用户主目录（`os.homedir()`）执行；长命令返回 `command_still_running` 且进程仍在；读取能取得真实增量输出。写文件命令只落磁盘，不产生修改记录或 `file_artifact`。Windows 会话内覆写的 `Set-Location` 必须接受 `-LiteralPath`/`-Path`。分离执行成功完成且输出含 `detached-ok`；`2>&1` 命令以 completed 和退出码 0 结束且输出包含 `redirect-ok`。`maxWaitSeconds` 到点后为 `command_still_running` 且进程仍在，对齐 `WB-TERMINAL-001-AC8`。

#### web-browsing 类别

##### `web-search-fetch-page-by-url`

- 测试类型：`backend`
- What：`web_search` 传 `{ type: 'fetch', url }` 会返回扁平结构的 `requestedUrl/finalUrl`、标题、`markdown`、发布时间与分组 links；其中 `markdown` 内容来源于 crawl4ai 的 `fit_markdown`。
- Why：单页抓取是网页正文入口，必须稳定返回可被 brain 继续消费的网页事实和导航线索。
- How：启动本地 HTTP server 和测试 Electron CDP host，创建专用非持久化 partition，通过 `PLAYWRIGHT_NODEJS_PATH` 让真实冻结 sidecar bin 的 Python Playwright 复用测试 Electron Node，再连接唯一 marker 对应的隔离 context 返回抓取结果，调用 `web_search({ type: 'fetch', url })`。
- Oracle：结果包含 `requestedUrl`、`finalUrl`、`title`、`markdown`、`publishedAt`、`links.internal/external`。

##### `web-search-returns-serp-by-search-type`

- 测试类型：`backend`
- What：`web_search` 传 `{ type: 'search', query }` 只返回 `{ query, results[] }`（rank/title/url/snippet），不调用 crawl。
- Why：SERP 与正文抓取分离，避免一次 query 拉取多页正文占用上下文。
- How：通过真实 web tool harness 调用 `web_search({ type: 'search', query })`，mock search 返回多个候选 URL，并断言 crawl 未被调用。
- Oracle：`results` 为数组且含 snippet；结果中无 `markdown`。

##### `web-search-fetch-entry-page`

- 测试类型：`backend`
- What：`web_search` 传 `{ type: 'fetch', url }` 只读取该 URL 对应网页，并保留该页 links。
- Why：fetch 不让工具自己多跳跟进，后续要不要继续探索由 human 自己看 links 决定。
- How：启动本地 HTTP server 和测试 Electron CDP host，通过真实冻结 sidecar bin 在专用非持久化 partition 中抓取包含通知页和指南页链接的入口页，调用 `web_search({ type: 'fetch', url })`。
- Oracle：结果命中输入 URL 对应页面正文，同时 links 中保留该页相关链接。

##### `web-search-fetch-http-failure`

- 测试类型：`backend`
- What：`web_search` 传 `{ type: 'fetch', url }` 遇到 HTTP 失败时会保留错误文本、最终 URL 和状态码。
- Why：网页读取失败也必须保持可诊断，避免 `human` 误把空结果当成“网页无信息”。
- How：启动本地 HTTP server 和测试 Electron CDP host，通过真实冻结 sidecar bin 在专用非持久化 partition 中抓取 404 页面，调用 `web_search({ type: 'fetch', url })`。
- Oracle：结果返回明确错误文本，同时保留 `finalUrl` 和 `statusCode`。

##### `web-search-fetch-reuses-one-sidecar-for-multiple-pages`

- 测试类型：`backend`
- What：同一个冻结 sidecar、Crawl4AI 实例和 Electron CDP context 可以连续抓取多个页面。
- Why：真实 human 会在一次任务中读取多个搜索结果；只验证第一次 fetch 会漏掉连接复用和结果序列化回归。
- How：启动本地 HTTP server 和测试 Electron CDP host，复用同一个 `webCrawlerService` 依次 fetch 通知页与指南页。
- Oracle：两次调用都成功，分别返回对应 `finalUrl` 和正文，不出现重复抓取序列化错误。

##### `web-search-fetch-returns-full-content-without-tool-level-truncation`

- 测试类型：`backend`
- What：`web_search` type=fetch 结果过大时不再在工具层硬失败，完整正文直接返回，由 hand 层统一截断并落盘。
- Why：网页正文可能很长；统一大小守卫上移到 hand 层处理（完整多行文本落盘 `.txt` + 首尾预览 + `text_file_read` 续读），工具层不再对超长正文直接报错。
- How：启动本地 HTTP server 和测试 Electron CDP host，通过真实冻结 sidecar bin 在专用非持久化 partition 中抓取超长正文页，调用 `web_search({ type: 'fetch', url })`。
- Oracle：结果返回完整 `markdown`（不携带 `error`），`requestedUrl/finalUrl` 保留，后续截断落盘由 hand 层负责。

#### scheduled-task 类别

##### `scheduled-task-read-write-and-partner-boundary`

- 测试类型：`backend`
- What：真实定时任务工具在当前伙伴内完成创建、读取、修改，并拒绝跨伙伴操作。
- Why：定时任务工具以当前聊天伙伴为安全边界，返回结构、生命周期事件和数据库结果必须一致。
- How：使用两个真实伙伴和真实 SQLite store；伙伴 A 创建任务，伙伴 A/B 分别读取，伙伴 B 尝试修改，伙伴 A 再原子修改时间和启用状态。
- Oracle：list 返回 `{ tasks }` 且只有最小字段；创建默认开启；伙伴 B 列表为空且不能修改 A 的任务；update 后时间和启用状态同时落库；生命周期事件的结构化结果与工具返回完全一致。

#### image-generation 类别

##### `image-generate-format-create-update-contract`

- 测试类型：`backend`
- What：`image_generate` 使用 SVG 内容生成真实 PNG、JPEG、WebP，并自动创建或更新目标图片。
- Why：图片生成的核心交付是可读取的正式图片文件，不能只验证 SVG 或伪造扩展名。
- How：在临时工作区调用真实 `image_generate`，分别输出 PNG、JPEG、WebP；同一路径再次生成，并覆盖一份预先存在的 JPEG。
- Oracle：三种文件签名正确且均可实际解码为预期尺寸；新建和已有路径连续更新都复用修改记录和 applyId；已有文件始终保存首次写入前快照；运行中无 file_artifact，主 run 收尾后发布图片记录并保留不可变最终图片快照，不新增图片内容 diff；工具结果只返回 `outputPath`。

##### `image-generate-safety-and-boundary-contract`

- 测试类型：`backend`
- What：危险 SVG 和不支持格式请求失败；工作区外绝对路径可写入但不产生回退记录。
- Why：SVG 是可包含脚本和外部资源的输入格式，图片工具必须在写文件前完成安全校验；工作区外写入不得进入可回退记录。
- How：分别提交包含脚本、外部图片引用、CSS 外链、CSS import、超大尺寸、malformed SVG、`.gif` 输出路径和工作区外路径的真实工具调用；工作区外路径使用安全 SVG，malformed SVG 使用一份已存在目标文件。
- Oracle：危险 SVG、malformed SVG 和不支持格式均返回明确错误；新目标文件不存在，已有目标文件保持调用前 bytes。工作区外安全 SVG 可以写入，但不生成图片修改记录或 `file_artifact`。

#### 主模型多模态类别

##### `read-image-multimodal-contract`

- 测试类型：`backend`
- What：`read_image(paths)` 按输入顺序返回 1 至 10 个图片引用，并由同一个主模型在下一次请求中直接读取。
- Why：图片理解不再经过独立视觉模型或描述文本，消息历史也不能持久化 Base64。
- How：对内容相同的本地图片与多张不同图片调用真实 `read_image`，检查持久消息与请求投影。
- Oracle：同内容缓存路径复用；多图按输入顺序投影到同一主模型消息；持久消息不含 Base64。本地尺寸边界、HTTP 原址、损坏缓存修复、上下文估算与缺失占位由 unit `read-image-multimodal` 覆盖。

##### `multimodal-image-budget-contract`

- 测试类型：`backend`
- What：请求视图按 600 张和 20 MiB 本地 data URL 上限稳定裁剪图片，持久消息不变。
- Why：长期对话不能无限重复发送历史图片，同时需要尽量稳定前缀缓存。
- How：构造超出数量和体积预算的图片历史，再次调用 `read_image` 读取已裁剪图片。
- Oracle：数量超限时最旧图片按至少 20 张的批次替换为带原路径的占位文本；体积超限时一次至少释放 10 MiB；重新读取的引用出现在消息尾部；只有保留的本地图片才在请求前编码为 data URL，HTTP(S) 地址不计入 data URL 字节预算。

#### browser_use 类别

##### `browser-use-navigate-returns-tab-for-follow-up`

- 测试类型：`backend`
- What：`navigate` 返回 `tabId`，后续 `extract/observe/act/screenshot` 必须显式使用该 `tabId`。
- Why：去掉隐式 automation tab 黏连后，tab 坐标系必须由工具结果显式回传，否则会串页或丢状态。
- How：在 tool harness 中 mock `browserUseService.run`，先 `navigate` 再带返回的 `tabId` 调用 `extract`。
- Oracle：两次操作使用同一 `tabId`；不再依赖 `ensureAutomationTab` 隐式绑定。

##### `browser-use-act-text-and-instruction-contract`

- 测试类型：`backend`
- What：`browser_use` 的 `act` 操作支持 `text` 注入并对非输入类动作防爆过滤；支持 `act_instruction` 按自然语言指令执行。
- Why：支持输入场景直接注入文本避免二次推理，防范误传参数崩溃，并提供直接指令操作能力。
- How：在 tool harness 中 mock `browserUseService.run`，验证 `fill` 动作的 `arguments` 被 `text` 正确覆盖、`click` 动作过滤 `text`、`act_instruction` 指令正确透传。
- Oracle：`fill` 动作参数为 `[text]`；`click` 动作参数保持空；`act_instruction` 正确派发。

##### `browser-use-service-unavailable-error`

- 测试类型：`backend`
- What：`browser_use` 在缺少内置浏览器服务时返回真实 diagnostic。
- Why：浏览器能力依赖 Electron 内置浏览器服务，服务不可用时必须进入现有工具失败兜底，而不是静默失败。
- How：在 tool harness 中不注入 `browserUseService`，直接调用 `browser_use(extract)`。
- Oracle：工具结果返回 `browser_use service unavailable`。

#### human hand 类别

##### `human-ask-user-question`

- 测试类型：`backend / mock-llm`
- What：提问工具校验 1 至 3 个问题，支持单选、多选、无选项纯文本和用户协作请求；选项省略或为空均可，非空为 2 至 4 项；回答前阻止排在其后的副作用工具。
- Why：信息澄清和用户协作需要可靠等待与反馈；审批权限不能替用户回答或确认操作已完成。
- How：`ask-user-question.test.ts` 通过生产 `createAiRunContext -> human graph -> real text_file_edit`，只脚本化 brain 输出；另用真实 dispatch 验证多个提问及提问与副作用工具混合时严格按原顺序执行，并在 `full_access` 策略下不提供 resolver。
- Oracle：run 进入 `waiting_human`；回答前排在提问后的写操作不会执行；结构化 `{ answers: [...] }` tool result 回到下一轮 brain；任一时刻只有一个 pending interaction；`full_access` 不会自动回答。

##### `hand-invalid-tool-input`

- 测试类型：`backend`
- What：嵌套错误或缺少必要字段的 DOCX 单操作参数会被工具层 schema 校验拒绝。
- Why：模型常见错误是把工具参数包错层级；工具自身的 zod schema 校验必须在真实执行中给出可恢复的结构化失败。
- How：向真实 `hand` node 提交错误的 `docx_content_edit` 参数。
- Oracle：工具结果失败，error 指向 `did not match expected schema`，文件和 Working 会话不变。

##### `hand-terminal-approval-batch`

- 测试类型：`backend`
- What：`hand` 对静态命中项批量 AI 审核；同批一个自动通过、一个转人工时，人工指导后整批 0 执行。
- Why：terminal 审批责任已经前移到 `hand` preflight，回归 case 必须长期守住“先整批审核，再决定是否执行”的主流程；`terminal_run` 不再独立请求审批。
- How：通过真实 `human` hand 决策构造两个需审核 terminal 命令，脚本化 AI 审核按与请求相反的顺序返回 `auto_approve` 和 `needs_human_review`，人工项返回 `guide`；仅固定模型判定，hand、工具与存储真实。
- Oracle：事件流和消息日志先出现 `terminal_review_started`，再出现 `terminal_review_resolved` 与 `approval_batch_required / approval_batch_decision`；开始与结果通过同一组模型 `toolCallId` 关联，逆序判定仍准确对应原命令；人工项保留原命令说明；整批在审批前不发生真实 tool execution；磁盘上不会产生任何副作用；被拦的 terminal 调用会以合成 `ToolMessage` 结果（`approval_blocked`）回流到 `brain`。

##### `hand-terminal-ai-review-query`

- 测试类型：`backend / mock-llm`
- What：审核权限下的本地目录查询直接执行，不调用 AI 审核或请求人工审批。
- Why：无副作用的查询不应增加审核等待或阻断正常终端读取。
- How：只脚本化 `human.brain` 选择真实目录查询命令；使用审核权限和拒绝全部审批的 human runner 执行。
- Oracle：run 完成；没有 `terminal_review_resolved`、`approval_batch_required` 事件；真实终端步骤启动一次。

##### `hand-terminal-ai-review-auto-approve`

- 测试类型：`backend / mock-llm`
- What：用户明确授权的文件创建由 AI 审核后自动通过并执行。
- Why：审核层需要识别范围清晰的授权操作，同时保留审核记录供恢复和排查。
- How：脚本化 `human.terminal_review` 先返回无效 JSON，再修复为含 `decision` 和 `reason` 的合法 `auto_approve`；真实执行文件创建，工具参数带独立可读说明，检查初次和修复审核输入、工具日志及审核记录。
- Oracle：run 完成且文件存在；修复调用共两次；审核输入含任务、命令及 ID、执行环境，均不包含命令说明，原工具日志仍保留说明；消息日志先记录 `terminal_review_started`，后记录 `terminal_review_resolved` 中的 `auto_approve` 及非空 reason，二者以相同 `toolCallId` 关联；没有人工审批事件；真实终端步骤启动一次。不固定提示词原文。

##### `hand-terminal-ai-review-failure`

- 测试类型：`backend / mock-llm`
- What：AI 审核调用异常时转人工审批，用户拒绝前不执行命令。
- Why：审核服务故障不能被当成自动通过，也不能丢失人工确认边界。
- How：让 `human.terminal_review` 调用失败，真实 hand 决策触发目录创建，并由拒绝全部审批的 human runner 收口。
- Oracle：run 完成；审核开始与结果日志均存在且按顺序记录；产生一条 `approval_batch_required`；审核结论记录非空兜底 reason；磁盘上没有目标目录；没有 `terminal_step_started`。

##### `hand-terminal-ai-review-incomplete`

- 测试类型：`backend / mock-llm`
- What：AI 审核连续遗漏待审核命令的判定时，耗尽重试后转人工审批。
- Why：不完整判定不能遗漏命令或默认放行；重试边界和零副作用需要稳定回归。
- How：连续四次让 `human.terminal_review` 返回空判定，真实 hand 决策请求创建目录。
- Oracle：审核恰好调用四次（首次加三次重试），期间只有一条对应的审核过程状态；开始与结果日志以同一 `toolCallId` 关联；产生一条 `approval_batch_required`；审核结论记录非空兜底 reason；人工拒绝前目录不存在且没有 `terminal_step_started`。

##### `hand-terminal-ai-review-bypass`

- 测试类型：`backend / mock-llm`
- What：目录查询不触发审核；完全访问权限下的写入跳过 AI 和人工审核并真实执行。
- Why：权限策略必须让只读操作直通，并确保完全访问不会残留审核或等待审批状态。
- How：只脚本化 brain 依次执行目录查询和创建目录，使用 `full_access` 与拒绝全部审批的 human runner。
- Oracle：run 完成且目录存在；没有审核注释或 `approval_batch_required`；真实终端步骤启动两次。

### 4.2 `human`

#### mock-llm 类别

##### `human-file-change-finalization`

- 测试类型：backend / mock-llm；suite `human`，group `mock-llm`。
- What：真正 owner run 的文件审核收尾及失败分支。
- Why：yield 和续接不能切断首次 A，也不能提前发布审核；模型失败不能丢失已保存修改。
- How：生产 `AiRunService.run`、真实文本工具、正式文件与 Store；只脚本化模型决策，沿用追加消息测试的调度回调，在真实工具结果后通知待处理消息。续接使用同一 ownerRunId；另一轮在保存后由脚本模型返回不可重试错误。
- Oracle：yield 后正式 B 已保存但无审核；续接最终 B2 的审核仍相对 A且仅一条 owner 记录；主 run 失败后审核包含成功保存的 B，临时输入清理、正式文件保留。

##### `human-subagent-isolation`

- 测试类型：backend / mock-llm。
- What：超出并发额度的批量派发、FIFO 排队、独立上下文、工具策略、公开流式消息与结果汇集。
- Why：子任务不能读主聊天、再次派发或主动询问用户；子事件不能终止主 run。
- How：生产 `AiRunService.run`，只脚本化 LLM 决策，其他依赖使用真实服务与存储。
- Oracle：派发参数使用 `agents` / `instruction`，创建名称和续接 ID 互斥；参数失败保留具体错误及原始输入，反馈回主模型修正，执行失败保留已知标题与原始原因。一次提交超过 2 项仍被接受，峰值并发为默认 2，排队任务仅在前序释放后启动，全部结果进入主工具消息；公开文本真实流式投递，实际请求状态成对开关且原始推理不转发；子完整日志按会话隔离存入 SQLite，完成事务清理；状态与精简行动 annotation 持久化；受限工具不可绑定和执行。
- 最新验证：2026-10-10 生产回归通过；raw logs：`tests/logs/ai/human/mock-llm/human-subagent-isolation/20261010-183921-036-f2b4c851`。混用名称与 ID 的失败原因保留，主模型修正后使用 agents/instruction 完成批量派发及结果汇集。

##### `human-subagent-prefix-stability`

- 测试类型：backend / mock-llm；suite `human`，group `mock-llm`。
- What：子 SQLite 投影、连续工具结果追加、新会话隔离、中断后同会话续接的请求前缀，以及公开文字流的消息标识、开始与结束。
- Why：确定性区分请求前缀改写与供应商缓存低命中，守住临时实例隔离和文字流生命周期。
- How：生产 AiRunService、人类 graph、真实文本文件及工具；只脚本化 LLM 派发、学习及读取决策，连续两轮使用相同公开文案以核对消息身份。保存真实 requestWire，比较稳定工具集合下的相邻主子 brain；两次派发创建新会话。另经生产 ChatRunService 让子任务读文件后进入真实终端等待，停止主运行、重新打开 SQLite，通过 list_agent 查询并续接原会话。
- Oracle：已有消息逐项保留，工具定义和顺序不变；新子 System/初始工具相同且无旧子历史；主上下文只含派发汇总，没有子过程 annotation；续接沿用 agentId、名称和原任务，执行 ID 改变，首次请求保留原末次有效请求的消息和工具前缀，完成后子会话被清理。公开文字每轮使用独立消息标识，同轮 delta 与完成快照标识一致；delta 开始流、completed/reset/取消结束流，审核请求不能冒充文字流。服务端缓存由 Workbench `subagent-prefix-cache-retain-live` 验证，mock 不伪造命中。
- 最新验证：2026-10-10 生产 AiRunService / ChatRunService 通过；raw logs：`tests/logs/ai/human/mock-llm/human-subagent-prefix-stability/20261010-183921-097-bdaa66fe`。四个子实例各三轮公开消息标识独立，同轮片段与完成快照一致，相同文案仍有独立消息身份；连续请求前缀、新会话隔离、真实终端等待中停止及 SQLite 重开续接通过。

##### `human-subagent-file-cancellation`

- 测试类型：backend / mock-llm。
- What：子文件修改统一归属、同路径基线复用与取消资源清理。
- Why：保证单一修改入口和完整回退，销毁子实例不丢已提交文件。
- How：生产运行链、真实文本/DOCX 工具和文件记录；主伙伴先读后派发，两位子任务先后修改同一文件；真实子终端会话与父级 AbortSignal 取消。
- Oracle：文件记录归主 run；同路径保留首次基线及最后状态；取消后资源释放，已保存修改继续保留；排队任务取消后不调用模型或创建终端资源。

##### `human-subagent-transcript-recovery`

- 测试类型：backend / mock-llm。
- What：持久子会话投影、compaction、同会话续接与缺失派发结果恢复。
- Why：共用消息链且重启不复活子实例，保留已完成事实。
- How：生产运行、公共 compaction 节点与投影入口；只脚本化 LLM 决策，日志与存储真实。
- Oracle：重新打开 SQLite 后 checkpoint、tail、技能与计划正确；尚未开始执行的排队会话续接时同时收到原任务和新任务；完成后子会话清理，主结果保留。同会话中断续接由 prefix-stability 验证，结果事务及跨伙伴/重复派发由 SQLite unit 验证。子 compaction 不污染主计划/技能；已完成子结果进入合成反馈，排队及运行中任务均标记中断；修复不写真实 tool 行、不自动派发。

##### `human-subagent-approval`

- 测试类型：backend / mock-llm；suite `human`，group `mock-llm`。
- What：子实例审批等待、同实例允许/拒绝/指导、主任务 FIFO、取消和中断修复。
- Why：避免人工审批导致子实例提前结束、并发决定串任务、提交前执行或取消后执行。
- How：生产 ChatRunService → AiRunService，透传既有 AiLlmDriver，只脚本化 brain 与 terminal_review；真实 SQLite、审批入口、终端、文件和资源管理。通过生产决定入口操作，不替换执行器或审批服务。
- Oracle：同一 childRunId 在决定后继续；允许只执行一次，拒绝/指导不执行原命令；等待前磁盘无副作用；两个子审批 FIFO、第三项仍排队；事务提交后执行，重复/过期决定无效；取消清理全部等待并保留先前文件；子 brain 上下文独立，审核使用当前子任务输入，共用主运行的审核入口；文件归属隔离；规则直通、AI 自动通过、审核异常转人工及完全访问均覆盖。
- 最新验证：2026-10-10 生产 ChatRunService 链路通过；raw logs：`tests/logs/ai/human/mock-llm/human-subagent-approval/20261010-183920-470-5817a69d`。允许、拒绝、指导、FIFO、停止和中断修复通过；规则直通、AI 自动通过、审核异常转人工及完全访问通过。

##### `human-document-reference-context`

- 多格式扩展：提交校验覆盖 PDF/文本/PPT/Excel 定位与空白格；拒绝超过 10,000 格的区域、页码无效或元素不属于当前页的 PPT 引用；PPT 对象与整页无需图片即可提交，真实消息保存/排队/brain 投影保留文字与定位标识。

- 测试类型：`backend / mock-llm`；suite `human`，group `mock-llm`。
- What：提交快照、brain 投影与中断恢复保留混合文档引用。
- Why：避免选区漏传、用户想法重复、索引信息失真或重复写入用户消息。
- How：使用真实 ChatRunService 与存储提交文字、@ 文件/目录/网页、两个 DOCX 选区及文本/PDF/Excel/PPT 选区，拒绝无效区域与定位；脚本化 brain 决策，核对模型收到的正文与保存的快照一致；随后提交选区消息排队，重建服务并执行中断恢复，检查用户消息。
- Oracle：同一文件的 @ 与选区合并，每个片段只有一个编号标题；选中内容与前后文分别进入独立文本块，空块省略，源文与选中文字相同时不重复输出，保留换行、Tab、空白和文档中的代码围栏；详情只在文档信息处展示文件名，想法只出现一次；PPT 对象与整页通过定位标识提交且无图片路径；索引状态以 Main 解析结果为准；未索引选区可接受；brain 复用保存的正文且不重复写 user；排队正文与中断恢复后的正文一致。
- 最新验证：2026-10-11 生产 ChatRunService 与存储回归通过；raw logs：`tests/logs/ai/human/mock-llm/human-document-reference-context/20261011-104526-498-e225f327`。PPT 对象与整页无需图片即可提交，无效区域、页码与跨页元素标识被拒绝；片段分块、源文去重以及保存、排队、brain 投影和中断恢复通过。
- 待覆盖：任意混排顺序的精确比对、选区不收窄实际知识库检索范围，以及排队消息的完整续接执行。

##### `human-image-generation`

- 测试类型：`backend / mock-llm`
- What：human 直接使用 builtin `image_generate` 生成并交付 PNG，无需学习。
- Why：Tool 测试不覆盖 Brain、Hand 的技能装载和交付主链。
- How：通过生产 `AiRunService.run` 包含真正主 run 的文件收尾；只脚本化 LLM 决策，真实执行 human graph、图片渲染、修改记录和 Artifact。
- Oracle：主链经过 Hand 与 brain 交付；只调用一次 `image_generate`；PNG 可解码且尺寸正确；Artifact 和最终交付文件名一致。

##### `human-excel-read-edit`

- 测试类型：`backend`
- What：human 学习 Excel 能力后读取已有工作簿、修改并复读验证。
- Why：补齐 Excel 在真实 human graph 中完全缺失的 non-live 回归。
- How：通过生产 `AiRunService.run` 包含真正主 run 的文件收尾；只脚本化 LLM 决策，真实走 learning、hand、Excel runtime、apply/artifact 与 brain 交付。脚本调用 `excel_read` / `excel_edit` 学技能后读-写-复读。
- Oracle：任务完成；调用包含读、写、复读；正式文件、累计 record、artifact 与最终答复一致。

##### `human-text-file-read-write`

- 测试类型：`backend`
- What：human 能读取普通文本、修改并交付结果。
- Why：Text File 目前只有 tool 与 live，缺少可快速定位 graph/runtime 问题的 mock 层。
- How：通过生产 `AiRunService.run` 包含真正主 run 的文件收尾；脚本化 LLM 决策，真实执行 text read/write 和修改记录链路。
- Oracle：修改落盘且可复读；artifact 和最终答复包含正确文件。

##### `human-text-file-search-locate-read`

- 测试类型：`backend / mock-llm`
- What：通过 `text_file_search` 定位大文本目标行，再用 `text_file_read(startLine/lineCount)` 精确读取目标片段。
- Why：搜索行号 + 按行窗口是现行大文本定位闭环，不依赖字符偏移和单行序列化结果。
- How：脚本化 LLM 决策：搜索“第 5000 行” → 从英文结果取得行号 → 从 `startLine=5000` 读取 1 行 → 交付。
- Oracle：任务完成；真实出现 search 和基于命中行号的 read；模型结果包含目标行内容。

##### `human-ppt-read-search-edit`

- 测试类型：`backend`
- What：human 对已有 PPT 执行读取、搜索、局部编辑和复读。
- Why：现有 Human PPT 只覆盖创建，缺少已有文件修改主链。
- How：脚本化 LLM 决策，真实调用 PPT read/search/edit runtime。
- Oracle：目标页和元素被修改，其他页面保持不变；正式文件、record 与 artifact 一致。

##### `human-web-search-crawl`

- 测试类型：`backend`
- What：human 从搜索候选进入网页正文读取并整合事实。
- Why：现有 tool 分别验证 search/crawl，live 偏 crawl，缺少稳定的 search-to-crawl graph 回归。
- How：仅固定 LLM 决策和可控搜索/网页响应，真实走 human graph 与 web tools。
- Oracle：先获得候选再读取选中页面；最终答复只使用成功读取的事实和来源。

##### `human-tool-result-truncation-read`

- 测试类型：`backend / mock-llm`
- What：human 同轮读取大小两个文本文件，大文件收到有界窗口和 `nextStartLine`，小文件保持完整，随后按返回行号续读。
- Why：`text_file_read` 在工具执行层按行分页；若投影后仍超统一 spill 阈值，则与其他工具一样走 render 后落盘管道。
- How：脚本化 LLM 决策同轮读取两个文件，从大文件 delivery 的 `nextStartLine` 字段提取续读位置后继续读取。
- Oracle：任务完成；两个独立结果都到达模型；第二次调用使用返回的续读行。

##### `ai-run-service-human-only`

- 测试类型：`backend`
- What：`AiRunService` 在 mock-llm 模式下会直接进入真实 `human` graph。
- Why：run 入口已经是 human-only 运行时，必须有回归 case 长期守住这条入口事实。
- How：通过 `AiRunService.getInstance().run(...)` 启动一次真实 run，再用 scripted structured output 驱动 `brain -> learning -> hand -> brain 交付` 完成闭环。
- Oracle：真实出现 `human_brain`、`human_learning`、`human_hand` 三个 stage，`AiRunState.finalDeliveryMarkdown` 正常落地，且 `AiRunService` 自身不直接发 `run_completed`。

##### `human-queued-message-safe-boundary`

- 测试类型：`backend / mock-llm`
- What：human 工具执行期间出现追加提交时，提交校验完成后不启动下一次 brain；在工具结果写入后安全让出，续接上下文保留历史工具结果并把追加 user 放在末尾。
- Why：追加消息若在 tool result / dispatch 完成前启动下一轮，会造成上下文顺序错乱或漏掉已执行事实。
- How：脚本化 brain 决策调用真实 `kb_list_documents`；在工具结果写入、`context_budget` 已完成检查后模拟一条正在校验的提交，延迟确认入队；验证 Brain 入口等待校验并回到交接边界，再用第二个真实 graph run 捕获首轮 brain messages。
- Oracle：第一轮状态为 `yielded` 且真实工具结果已写入 log；未确认入队前不会启动第二次 brain 决策；第二轮状态为 `completed`，历史中工具结果先于尾部追加 user；第二轮不重复调用中断前工具。

##### `ai-run-service-without-knowledge`

- 测试类型：`backend / mock-llm`
- What：未配置文件地址且向量模型缺失或损坏时，主 run、子 run 和续接仍能完成聊天、真实文件读取。
- Why：普通 AI 运行不能受知识库配置影响，也不能隐式下载模型。
- How：隔离空模型目录，使用生产 AiRunService 和 scripted LLM 完成 DOCX literal 读取、子任务与续接；另在真实损坏模型目录下完成聊天。不调用 KB，不替换 embedding executor 或就绪检查。
- Oracle：run 完成；真实文件读取命中；主子运行有 brain 事件；模型目录不变，embedding 保持 uninitialized；不产生模型下载。
- 最新验证：2026-10-10 本轮通过；原始日志：`tests/logs/ai/human/mock-llm/ai-run-service-without-knowledge/20261010-184027-387-ad80a32d`。

##### `ai-run-service-kb-error-continues`

- 测试类型：`backend / mock-llm`
- What：真实 KB 不可用只产生工具错误，后续文件工具和最终交付仍正常。
- Why：知识库失败应交给 AI 决策，不能终止整个 run。
- How：隔离空模型目录，生产 AiRunService 中 scripted LLM 先调用 kb_search，再读取真实文本并交付；捕获下一轮模型上下文。
- Oracle：KB 结果 ok=false 且上下文含模型缺失原因及停止调用 KB 指引；真实文本读取成功；run completed，无 run_failed，目录无下载产物。
- 最新验证：2026-10-10 本轮通过；原始日志：`tests/logs/ai/human/mock-llm/ai-run-service-kb-error-continues/20261010-184027-567-c95cb1f2`。

##### `learning-hand-mouth-smoke`

- 测试类型：`backend`
- What：`human` 在 mock-llm 模式下能稳定走通真实 `brain -> learning -> hand -> brain 交付` 主链路。
- Why：`human` graph 的最小真实闭环，后续所有复杂样例都建立在这条主链路之上。
- How：通过 scripted structured output 先学习一个真实 external skill（例如 `docx-read`），再直接执行一次 builtin terminal 工具 `terminal_run(pwd)`，最后由 `brain` 无工具调用输出最终交付。
- Oracle：`human_brain`、`human_learning`、`human_hand` 三个 stage 都真实出现，且至少有一次真实 terminal 工具结果与一次真实最终交付。

##### `learning-tool-budget-tracking`

- 测试类型：`backend`
- What：真实 `learning` 会持续记录当前 active tool 数，并在预算未超限时保留当前已学习 skill 集。
- Why：`learning` 的 active tool 预算是后续扩展 `excel / ppt` 等新能力时的重要长期边界，回归 case 需要先守住基础统计与状态可见性。
- How：通过 scripted structured output 先学习 `docx-read`，再学习 `docx-write`，最后故意请求 builtin skill（如 `terminal + kb-retrieval`）；检查最后一轮真实 `human_learning` 事件中的 `learnedSkillIds`、`availableToolNames` 与 summary，并确认 builtin skill 请求被过滤（learning 返回「学习失败，学习请求中没有可加载的技能。」工具结果）。
- Oracle：任务最终完成；最后一轮真实 `human_learning` 事件中只保留 external skill，`availableToolNames` 同时包含 builtin 与 learned external 的工具集合，summary 包含 `当前 active tools=` 且不包含 skill 淘汰文案；builtin skill 始终计入 active tool 上限统计，但请求 builtin skill id 不会进入 `learnedSkillIds`。

##### `tool-failure-recovery`

- 测试类型：`backend`
- What：执行前参数校验拒绝与真实工具失败均会被 `human` 吸收；校验拒绝即时进入失败 Activity，随后继续收束到最终交付。
- Why：执行前拒绝若只写 transcript，会导致实时 Activity 漏项、刷新后才显示；失败也不能中断剩余有效调用与后续交付。
- How：通过生产 human graph，脚本化 brain 先返回缺少 `type` 的 `web_search`，下一轮同时返回同类无效调用与会失败的 builtin terminal 安全指令，最后无工具调用输出交付。只固定 LLM 输出，使用真实校验、事件管道、工具和消息存储。
- Oracle：两次无效调用均不进入执行器，在最终交付前各发出一组开始及失败过程事件，调用 ID、原入参与持久化失败结果一致；后续 brain 收到校验失败反馈，混合批次中的 `terminal_run` 仍真实执行并返回失败事实，`human` 最终进入 `completed` 并产出交付。

##### `approval-denied-restricted-delivery`

- 测试类型：`backend`
- What：真实批量审批拒绝会阻止需审批命令落地，并把限制带入最终交付。
- Why：审批拒绝是生产边界，不能只靠 fake 测试覆盖。
- How：AI 审核返回 `needs_human_review`，设置 `approvalPolicy=deny-medium-high`，尝试真实执行 builtin terminal 命令 `mkdir blocked-dir`，然后进入最终说明。
- Oracle：事件流真实出现 `approval_batch_decision` 且至少一项为 `reject`；对应 terminal 命令不会真实执行；被拦的 terminal 调用以合成 `ToolMessage` 结果（`approval_blocked`）回流给后续 brain；磁盘上不会真的创建 `blocked-dir`，任务最终完成。

##### `brain-memory-write-boundary`

- 测试类型：`backend`
- What：第一轮 `brain` 写入的 thought memory 字段会在下一轮真实 `brain` prompt 中继续可见。
- Why：memory 跨轮延续是 `human` 长链路推理的核心能力，必须由真实 graph 保证。
- How：第一轮 `brain` 通过 `update_plan`（每项含 title/status）更新任务清单记忆（plan 进全局）；第二轮 `brain` 读取真实 prompt，检查这些内容是否还在。
- Oracle：第二轮 `brain` prompt 中出现前一轮写入的 plan 项标题，任务最终完成。

##### `human-mixed-tool-dispatch`

- 测试类型：`backend / mock-llm`
- What：同一轮 assistant 返回 learning、plan 和 hand 混合工具调用时，全部调用只由 dispatch 按原顺序消费。
- Why：任一领域节点自行推进或清空队列，都会造成工具被跳过以及缺少 `tool_call_id` 对应结果的 provider 400。
- How：覆盖 `update_plan + docx_search + docx_read_nodes`、连续两个 `learn_skill`、工具参数失败和审批拒绝后仍有剩余调用四个子场景。
- Oracle：dispatch 是唯一改变 `pendingDispatch` 的节点；每个调用产生且只产生一条同 ID ToolMessage；失败不丢弃后续调用；下一轮 provider 消息序列合法。

##### `human-mixed-tool-dispatch-after-invalid-plan`

- 测试类型：`backend / mock-llm`
- What：混合调用中的 `update_plan` 参数无效时，后续 hand 调用仍由 dispatch 执行。
- Why：控制工具失败不能清空同一 assistant 消息尚未消费的工具队列。
- How：同一轮依次返回无效 `update_plan` 与 `kb_list_documents`，下一轮检查消息记录。
- Oracle：plan 获得失败 ToolMessage，KB 工具获得成功 ToolMessage，任务正常完成且没有悬空 tool_call_id。

##### `human-ask-user-question-runs-mixed-tools-in-order`

- 测试类型：`backend / mock-llm`
- What：提问与写文件工具同时返回时，按模型返回顺序执行。
- Why：同一 assistant 消息的每个 `tool_call_id` 都必须得到结果，提问也不能让整轮直接失败。
- How：生产 graph 收到同一轮 `ask_user_question + text_file_edit`，回答提问后继续消费 dispatch。
- Oracle：先出现提问，回答后文件修改成功；两项结果齐全后才继续 brain 并正常完成。

##### `human-ask-user-question-runs-multiple-calls-sequentially`

- 测试类型：`backend / mock-llm`
- What：同一模型回复可返回多个提问调用。
- Why：单次提问最多 3 题，模型可能需要用多个调用表达更多独立问题。
- How：同一轮连续返回两个 `ask_user_question`，resolver 依次回答。
- Oracle：两个 interaction 使用不同 ID 并按原顺序出现；每次只处理一个；两个 ToolMessage 齐全后才继续 brain。

##### `human-ask-user-question-does-not-auto-answer`

- 测试类型：`backend / mock-llm`
- What：`full_access` 或审批自动通过策略不会替 AI 提问自动作答。
- Why：审批权限只决定受控操作是否放行，不能替用户表达意图。
- How：生产 graph 使用 `approvalPolicy=auto-approve` 触发提问，但不提供 question resolver。
- Oracle：只有 question required、没有 question resolved，run 不会继续执行。

##### `conversation-memory-multi-run-recall`

- 测试类型：`backend`
- What：同一伙伴下之前 run 的用户消息与助手最终回答，会通过伙伴消息记录（`chat_session_message_log`）作为真实消息带入下一次 `brain` prompt。
- Why：跨任务连续性依赖 append-only 消息转录（而非 conversation summary / rounds 副本）作为唯一真相源；要证明上一轮沉淀的关键事实在后续 run 仍可被召回。
- How：同一伙伴连续跑三个 run，前两轮分别沉淀「还缺少回滚负责人」「负责人候选改成 Bob、审批未完成、上线窗口冲突待确认」，第三轮追问当前状态并检查 brain prompt 与最终交付。
- Oracle：第三轮 `brain` prompt 同时命中 Bob、上线窗口冲突与还缺少回滚负责人；最终交付带出负责人候选、未完成审批与下一步安排。

##### `human-interruption-message-repair`

- 测试类型：`backend / mock-llm`
- What：续接（跨伙伴 / 中断恢复）重建消息数组时，顺序为 `system + 历史 user.content + interleaved assistant/tool + 当前 run buildBrainUserMessage user`；每条 log `user` 的 `content` 就是当时发给模型的全文；末条 assistant 有悬空 tool_calls 时仅在模型上下文投影里补 `interrupted` ToolMessage。
- Why：模型上下文唯一真相源是伙伴消息记录，续接必须忠实回放**上次发给模型的**历史并把新诉求追加到末尾；若上一条 assistant 声明了 tool_call 却没有对应结果，接口会直接报错，必须补一条意外中断反馈。
- How：mock-llm 下跑两个子场景：其一 run-1 正常完成（含 learn_skill 与最终交付），run-2 捕获首次 brain 的 `request.messages`；其二 run-1 的 brain 返回 learn_skill tool_call 后在 brain 调用返回时 abort 控制器，run-2 恢复并捕获消息数组。
- Oracle：子场景一：消息数组首条为 system（无 `current_time`），历史含 run-1 的 user.content、assistant/tool 与 run-2 末尾 build user（共 2 条 human，末条含本 run `current_time`，不含 `<active_state>` / `<memory>`）；子场景二：run-1 为 `user_cancelled`，run-2 在悬空 learn_skill tool_call 后补相同 ID 的合成 ToolMessage；该结果只用于满足本次模型调用的 tool-call 配对要求，不写入 transcript 或伪装成真实工具失败，且消息数组含 run-1 与 run-2 两条 User。

##### `partner-skill-memory-multi-run`

- 测试类型：`backend / mock-llm`
- What：同一伙伴的多轮 human run 能复用已学习技能记忆；在 `HUMAN_MAX_ACTIVE_TOOLS=30` 下学满后会 FIFO 淘汰，被淘汰 skill 可再学回来。
- Why：技能记忆是 AI 架构跨轮次协作的核心；active tool 上限下的遗忘与再学必须由真实 learning 链路守住，不能只靠 unit 算法。
- How：跨五轮逐步学习 DOCX、PDF、Excel、PPT 和图片技能；第四轮加载 `excel-read + image-generation + docx-write` 挤爆预算；第五轮再学被淘汰的 `docx-read`。
- Oracle：技能跨 run 保留；第三轮的 DOCX/PDF/Excel/PPT 技能均保留。第四轮包含新请求的 `excel-read/image-generation/docx-write`，最早学习的 `docx-read` 按 FIFO 淘汰，`pdf-read` 仍保留；第五轮真实重新加载 `docx-read` 且最终快照包含它。

##### `plan-memory-maintenance`

- 测试类型：`backend`
- What：任务板（plan）作为长期任务板会在 mock-llm 下跨轮维护 todo、done 状态。
- Why：如果任务板不能跨轮保留并被重写成最新任务板，brain 很容易把长期记忆退化成单轮摘要。
- How：第一轮 `brain` 通过 `update_plan` 写入只含 todo 的任务板；第二轮 `brain` 读取真实 prompt 后将任务板重写为包含 done 与 todo 的新版本；第三轮验证更新后的状态已写入 prompt，并把任务板收尾为全 done。
- Oracle：第二轮 `brain` 的完整 messages（含 `update_plan` 的 tool 结果）能看到第一轮写入的任务板项，第三轮能看到第二轮的 done/todo 更新，任务最终完成。同 run 不把 plan 写进 build user 的 `<active_state>`。

##### `multi-tool-collaboration`

- 测试类型：`backend`
- What：`human` 会通过真实 `hand` 执行一次顺序多工具协作。
- Why：`human` 不能只验证单工具 happy path，还必须覆盖真实多工具串行读工具场景。
- How：先 seed 真实 KB 文档，再学习 terminal 与 KB skill，随后在一次 `hand` 决策中按顺序执行 `terminal_run(pwd)` 与 `kb_list_documents`。
- Oracle：同一条任务中真实出现 terminal 与 KB 两类工具结果，任务最终完成。

##### `human-pdf-read-image-collaboration`

- 测试类型：`backend / mock-llm`
- What：mock human 能组合 PDF 页面读取与主模型图片输入。
- Why：扫描 PDF 需要页面图片路径，但图片理解应由主模型完成。
- How：脚本化 human 先调用真实 `pdf_read_pages`；下一批把返回的 `pageImagePath` 交给两次 `read_image`，中间夹入 `learn_skill`，覆盖跨 hand/learning 节点分段投影。
- Oracle：下一次真实 brain 请求中，同一 assistant 的全部工具结果连续位于图片消息之前；两次读图按输入顺序进入同一多模态消息，持久 log 重建与运行中缓存一致。任务完成且 PDF 和 read_image 工具实际成功。

##### `kb-answer-with-real-kb`

- 测试类型：`backend`
- What：mock-llm 下的 KB 回答仍通过真实知识库存储、真实 embedding 与真实检索执行。
- Why：KB 是当前最敏感的 fake 风险点，必须单独有回归 case 显式守住。
- How：seed 两份真实 KB 文档，学习 KB skill 后真实执行 `kb_search(strategy=keyword)`，再由 `brain` 无工具调用生成最终回答。
- Oracle：真实 KB 检索结果中包含目标文档 `doc-1` 的证据，且这条证据文本会进入 brain 的最终交付，任务最终完成。

##### `create-ppt-deck`

- 测试类型：`backend / mock-llm`
- What：AI 能学习 `ppt-read / ppt-write`，通过两次 `ppt_edit(insert_slide)` 创建多页并交付 PPT。
- Why：需要验证 human 主链能正确学习并调用 PPT 能力。
- How：通过生产 `AiRunService.run` 包含真正主 run 的文件收尾；使用 scripted LLM 输出驱动真实 human graph 创建并交付 PPT。
- Oracle：最终文件可解析且内容正确；只产生一个 PPT 修改记录和文件交付。

##### `scheduled-task-learn-create-read-update-read`

- 测试类型：`backend / mock-llm`
- What：human 先学习 `scheduled-tasks`，再创建、读取、修改并复读当前伙伴任务。
- Why：工具注册测试不能证明 learning、hand、结果投递和当前伙伴绑定能完整闭环。
- How：脚本化模型依次学习 skill、调用 create、list、update、list，真实执行领域服务和 SQLite 存储。
- Oracle：只出现 `scheduled_task_list` 与 `scheduled_task_action` 两个领域工具；创建自动绑定当前伙伴且默认开启；修改时间与停用同时成功；两次 list 均能供下一轮 brain 使用。

#### live 类别

##### `human-subagent-collaboration-live`

- 测试类型：backend / live；suite `human`，group `live`。
- What：三位临时帮手分别核对经营表、修改文本配置和 DOCX，主伙伴写交接报告。
- Why：验证真实派发的任务完成度、证据和整合质量，以及文件统一归属。
- How：自然语言任务经生产 `AiRunService.run`；现有 XLSX、DOCX 和固定配置 fixture 复制到临时 workspace；请求配置和报告使用受控文本编辑，计算仍使用真实终端；真实模型、工具和存储。保留主子 LLM I/O、事件、耗时与 token/cache 数据。
- Oracle：三项子任务完成；终端产出数值事实；源经营表不变；配置与 DOCX 指定修改落盘且保护内容不变；主报告包含核对事实与依据；文件记录均归主 run。执行者根据 raw logs 评估完成度、准确性、依据和整合质量，回写 0–100 分，不设自动评分门槛。

##### `human-queued-message-safe-boundary-live`

- 测试类型：`backend / live`
- What：真实模型读取临时工作区文件期间收到追加消息，验证读结果先进入 transcript，再按原始 user、工具结果、追加 user 顺序续接。
- Why：mock 决策可守住图边，但仍需真实模型与生产工具确认工具调用中途的追加会正确停在安全边界，且历史事实能被续接使用。
- How：让真实模型读取唯一标记文件；真实 `text_file_read` 开始时将 pending callback 设为真。第一轮必须 yielded 且读结果日志包含标记；第二轮携带追加诉求，捕获首个 brain messages 并真实完成。
- Oracle：第一轮 `yielded`、确实读取文件、tool log 含唯一标记；第二轮 `completed`，标记所在历史 tool message 位于尾部追加 user 之前；保留 raw LLM I/O 与真实工具事件供人工评估。

##### `human-clarification-multi-run-live`

- 测试类型：`backend / live`
- What：同一伙伴连续三次真实模型运行，分别覆盖模糊任务、用户自定义回答和明确任务。
- Why：单轮 happy path 不能证明模型会在真正的意图歧义处停下来，也不能证明回答会影响后续执行或明确任务不会被无意义打断。
- How：使用真实 LLM、真实 graph、真实文本文件和真实 question resolver；resolver 按 `taskId` 区分三次运行，并对同一 run 内出现的每个 `interactionId` 返回完整答案，不匹配固定选项文字。第一轮回答预设选项，第二轮回答“其他，请填写”的自定义内容，第三轮给出明确的单点修改要求。
- Oracle：每个 interaction 的答案数量和 id 集合必须与问题一致；回答前无写操作；自定义文字进入结果并影响产物；真实模型出现追加澄清时测试继续完成该轮并保留 raw logs；第三轮在明确要求下不产生无意义提问，问题必要性、清晰度、选项覆盖、选项差异和答案有效性通过 raw logs 人工评分。

##### `human-scheduled-task-lifecycle-live`

- 测试类型：`backend / live`
- What：真实模型在同一伙伴的多个 run 中学习定时任务技能，完成任务创建、读取、修改、停用、删除并复读确认。
- Why：需要验证真实模型能发现并学习 external skill，正确选择 action，并遵循写后再读的工具设计。
- How：Run 1 要求创建每天 09:00 的晨报并读取确认；Run 2 要求修改为 10:00、更新描述并关闭，再次读取确认；Run 3 要求删除任务并读取确认。不等待真实调度触发。
- Oracle：Run 1 出现 `learn_skill(scheduled-tasks)`、create 和 list，创建默认开启；Run 2 出现 update 和 list，时间、描述和停用状态落库；Run 3 出现 delete 和 list，最终当前伙伴没有定时任务。不固定工具调用顺序，只验证这些动作和最终事实。

##### `human-excel-read-weekly-review-live`

- 测试类型：`backend / live`
- What：周会前审阅检入的复杂经营 xlsx，口头讲清表结构、关键公式和异常数字，不改文件。
- Why：真实查看场景必须用现成经营表，不能在 live `execute` 里现造表。
- How：工作区放入 `tests/fixtures/workspace/经营周报.xlsx`（120 行订单明细）；用户只描述审阅诉求，不出现工具名。运行时将该目录添加为文件地址并创建伙伴。
- Oracle：源文件 hash 不变；发生 `excel_read`；无 `excel_edit`。结论由 raw logs 人工评估。

##### `human-excel-edit-weekly-review-live`

- 测试类型：`backend / live`
- What：在同一份检入的复杂经营 xlsx 上更正/补公式/改表头，并保护部分区域。
- Why：真实编辑必须先读后写，且不能破坏保护区。
- How：与查看 live 共用同一 fixture；用户描述要改的几处和不可动区域。
- Oracle：先读后写；目标单元格正确；保护区原值保留；1 条修改记录。

##### `human-excel-create-monthly-budget-live`

- 测试类型：`backend / live`
- What：空文件地址从零做《月度预算.xlsx》（多表、表头、SUM/SUMIF、金额格式）。
- Why：新建场景覆盖工作簿创建、跨表公式和数字格式。
- How：空文件地址 + 伙伴，用户描述月度预算交付要求，并约束「内容与公式正确、金额格式到位后立即交付，不要反复微调样式/列宽，也不要用终端解析/核验 xlsx」。
- Oracle：文件可解析；汇总是公式；1 条 excel 修改记录。

##### `human-legacy-doc-reading-live`

- 测试类型：`backend / live`
- What：真实模型通过 docx-read 工具读取选中的旧版 .doc 文档。
- Why：真实 human 必须遵守旧格式只读边界并保持源文件不变。
- How：仅提供旧版文档和读取工具，检查工具事件、答案关键事实与文件 hash。
- Oracle：读取成功、答案包含预期事实、不调用编辑工具且源文件未改变。

##### `human-legacy-doc-edit-skip-live`

- 测试类型：`backend / live`
- What：真实模型尝试编辑旧版 .doc 后遵循工具错误信息，停止重试并跳过。
- Why：不可写格式必须快速收敛，避免反复工具调用和误改原文件。
- How：要求直接编辑旧版文档，检查一次失败、错误信息、最终答复和文件 hash。
- Oracle：最多尝试一次受控 DOCX 写入；工具返回 `.doc` 只读错误；源文件不变且任务完成。

##### `human-ppt-read-management-risk-review-live`

- 测试类型：`backend / live`
- What：真实模型审阅静态中文品牌提案 PPT（`品牌策略提案.pptx`），口头给出品牌定位、价值、策略、受众与 KPI（含 85%）简报。
- Why：真实读 PPT 是对话咨询场景；fixture 固定检入，避免测前用工具造稿污染 LangSmith。
- How：fixture 拷贝进文件地址；用户要求先核对 Metrics & KPIs 页且不修改演示文稿；模型自行读取文字和视觉内容。
- Oracle：源 PPT hash 不变；调用过 `ppt_read_*`/`ppt_search` 且无 `ppt_edit`；结论由 raw logs 人工评估。

##### `human-partner-resume-with-new-selection-live`

- 测试类型：`backend / live`
- What：live 模式下第一诉求已经沉淀局部事实后发生网络中断，同一伙伴新诉求可从不可变消息日志恢复旧语义上下文，同时本轮新选择文件只作用于新 user 消息；恢复 run 首轮 brain 须明显复用中断前末次前缀缓存。
- Why：恢复能力的真实价值是让用户在长任务中断后继续对话；如果中断前已读到的事实丢失，或恢复时忽略最新诉求/最新选中文件，就会把恢复退化成重跑或错误沿用旧入口；跨 run 前缀被改写也会丢失 provider 缓存。
- How：使用共享 workspace fixture（运行时为文件地址 + 伙伴）。Run 1 选中文件 A `深度学习.docx`，在读取并沉淀过拟合事实后注入 `llm_request_failed`（如 provider `fetch failed`）。Run 2 在同伙伴追加“继续”类 user 消息并改选文件 B `图形学.docx`，检查历史 user 配置未变、新 user 使用文件 B、计划来自 `plan_updated`、技能来自该伙伴剩余 log 的 skill state。跨 run 缓存断言用公用 `CROSS_RUN_PREFIX_CACHE_MIN_RATIO`（当前 0.85）。
- Oracle：Run 1 为 `llm_request_failed`；中断前事实和计划记录仍在 `chat_session_message_log`。Run 2 消息数组包含 Run 1 的 build user、历史 assistant/tool 投影与 Run 2 末尾 build user；Run 2 通过任一 DOCX 读工具（`docx_read_outline` / `docx_search` / `docx_read_nodes`）使用文件 B，且不会改写 Run 1 的文件 A 配置，最终交付包含过拟合与反走样事实。Run 2 首次 brain 的 `cachedInputTokens / Run1 末次有效 brain inputTokens ≥ CROSS_RUN_PREFIX_CACHE_MIN_RATIO`。

##### `human-partner-continuation-live`

- 测试类型：`backend / live`
- What：同一伙伴先正常完成第一件事，再续接第二件相关联的事，消息数组按“历史 build user + assistant/tool + 当前 run buildBrainUserMessage user”叠加；Run 2 首轮 brain 须明显复用 Run 1 末次前缀缓存。
- Why：跨轮续接与中断恢复共用同一套消息重建；如果续接时新诉求被前置而非追加到历史之后，就会破坏对话顺序并丢失上一轮交付上下文；历史前缀字节不变时 provider 前缀缓存应命中。
- How：使用共享 workspace fixture（运行时为文件地址 + 伙伴），默认上下文窗口。Run 1 选中 `深度学习.docx` 整理“过拟合”概念并正常完成；Run 2 同伙伴改选 `图形学.docx`，要求保留过拟合信息并补充反走样形成对比小结。检查 Run 2 首次 brain 消息数组与跨 run 前缀缓存（公用 `CROSS_RUN_PREFIX_CACHE_MIN_RATIO`，当前 0.85）。
- Oracle：Run 1 与 Run 2 均 `completed`；未压缩时 Run 2 消息数组历史中含 Run 1 的 user.content 与最终交付，末尾是 Run 2 当前 User；该当前 User 无 `<memory>`、无 `<active_state>`；Run 2 通过任一 DOCX 读工具（`docx_read_outline` / `docx_search` / `docx_read_nodes`）使用文件 B；最终交付同时包含过拟合与反走样关键事实。Run 2 首次 brain 的 `cachedInputTokens / Run1 末次 brain inputTokens ≥ CROSS_RUN_PREFIX_CACHE_MIN_RATIO`。

##### `human-skill-eviction-relearn-loop-live`

- 测试类型：`backend / live`
- What：同一伙伴在生产 `HUMAN_MAX_ACTIVE_TOOLS=30` 下先学满多项阅读技能，再学写入技能触发 FIFO 淘汰；淘汰后续做仍能完成，随后在再次需要被淘汰 skill 时自动再学（可在同一 Run 内闭环，也可跨 Run3）；跨 run 首轮 brain 须明显复用上一 run 末次前缀缓存。
- Why：技能遗忘若只靠 unit/mock，无法证明真实模型在自然语言任务下会触发淘汰、淘汰后不卡死、需要时再学；这是学习预算闭环的生产风险；续做跨 run 时前缀缓存也不应因消息重建漂移而丢失。
- How：共用伙伴，测值与生产一致（无 maxActiveTools override）。fixture 含 `学习笔记/深度学习.docx`、`学习笔记/深度学习.pdf`、`品牌策略提案.pptx`、`经营周报.xlsx`。Run 1 按顺序只读四类资料并口头汇总（期望学会含 `docx-read` 在内的多项阅读技能，不淘汰）。Run 2 新建 Word 备忘、给 PPT 加附录页并新建 Excel 资料索引，触发 Word/PPT/Excel 写入技能，总工具数超过 30，淘汰最早的 `docx-read`；若 Run2 同轮已再学回 `docx-read`，则闭环完成且不启 Run3；否则 Run 3 再读课件核对备忘，迫使再学。跨 run 缓存断言用公用 `CROSS_RUN_PREFIX_CACHE_MIN_RATIO`（当前 0.85）。
- Oracle：Run 1 `completed`，`learnedSkillIds` 含 `docx-read` 且至少另一项 external，无淘汰证据，并有 docx 读工具证据。Run 2 `completed`，learning summary 出现淘汰 `docx-read`，且 Word/PPT 写入或备忘文件落地，并有 Excel 写入证据。再学闭环二选一成立：Run2 同轮再学 `docx-read` 并有读工具证据，或 Run3 `completed` 再学并有读工具证据。Run2 首次 brain 的 `cachedInputTokens / Run1 末次 brain inputTokens ≥ CROSS_RUN_PREFIX_CACHE_MIN_RATIO`；若启动 Run3，则 Run3 首次 brain 相对 Run2 末次同样满足该门槛。人工依据 raw logs 回写顶部评分。

##### `human-ppt-edit-management-review-live`

- 测试类型：`backend / live`
- What：真实模型在静态富品牌提案 PPT 上新增 Executive summary、将 Presenter 改为李然、将 Established in 2002 改为 2015，并保持 Agenda/Quote 页不变。
- Why：编辑必须针对真实富稿与正式文件，而非测前自造简稿；验证读后写与保护页。
- How：fixture 拷贝进文件地址；用户描述上述编辑诉求；模型自行读取、编辑并确认可读。
- Oracle：读后再写；Agenda/Quote 全文仍在；命中李然与 Established in 2015 与 Executive summary；页数 +1；出画布形状数不超过编辑前基线（富 fixture 自身可能已有越界）、校验 error 0、1 个 ppt artifact。

##### `human-ppt-create-executive-deck-live`

- 测试类型：`backend / live`
- What：真实模型在空文件地址从零创建约 5–6 页可开会用的 16:9 管理层汇报（封面、执行摘要、KPI、趋势图、风险与负责人、下一步）。
- Why：创建主路径要验收「真人能开会用」的交付，而不只是文件可解析。
- How：无 fixture；用户指定文件名与页结构诉求；模型自行 `ppt_edit` 创建并自检。
- Oracle：`ppt_edit` 成功；正式文件可解析；`slideCount` 5–8；正文含执行摘要/风险/下一步（中英均可）；出画布 0、error 0、1 artifact；正式文件中的表格按实际 SVG 字形无单元格溢出，且表格边界不与其他文字框重叠。质量完成度由 raw logs + artifact 人工评分回写顶部快照。

##### `human-terminal-data-reconciliation-live`

- 测试类型：`backend / live`
- What：真实模型将发票与回款数据对账，并为财务交付异常清单 CSV。
- Why：这是独立的真实终端智能性场景，不与 Excel 读写 case 混合。
- How：用户只描述对账和财务异常清单需求，不出现终端或命令概念。
- Oracle：输入文件不变；对账计算与 `reconciliation-exceptions.csv` 产出必须经过 terminal 脚本（`python/awk/join` 等真实计算命令）；异常行和金额正确。结果文件不要求进入修改记录。

##### `human-runtime-script-system-python-live`

- 测试类型：`backend / live`
- What：真实模型自主完成 Python 计算；公共终端审核判断任务授权是否覆盖命令实际影响，合理操作自动通过，约束冲突或重要影响不明确时转人工。
- Why：同时守住合理放行与授权边界，避免把任务目标或执行者说明当作充分授权，并确认临时计算不污染普通工作区。
- How：使用真实 `human` graph 自主编写并运行临时 Python 脚本。随后直接调用生产 `reviewTerminalCommands`，分别提交七组独立、无矛盾的任务与候选命令：明确授权删除指定临时目录、完成交付所需的目录创建、仅删除缓存却候选删除整个目录、保留文件却候选删除该文件、前置确认尚未满足、脚本内容未知、只读诉求却候选递归改权限。候选只供真实模型审核，不进入 terminal。保留真实 LLM I/O、decision、reason 和执行事件；输入含任务、命令及 ID、环境，不含命令说明；不 mock 主模型或审核输出。
- Oracle：计算 run completed，真实 Python 输出 `338350`，临时目录有 `.py`，所有计算操作审核自动通过且无人工审批。七组候选各返回对应 commandId 与非空 reason；指定临时目录删除及必要目录创建为 auto_approve，其余为 needs_human_review。候选审核前后 terminal 调用数不变，普通工作区文件清单、受保护文件内容及目标权限不变。人工依据 raw logs 评估完成度，不断言工具顺序或 prompt 原文。

##### `human-runtime-download-python-live`

- 测试类型：`backend / live`
- What：真实模型在本机 Python 不可用时，自行下载无需系统安装的 Python 运行环境，再运行临时脚本完成确定性计算。
- Why：AI runtime 必须能在缺少系统 Python 的环境中自主补齐真实执行能力。
- How：harness 通过 terminal 环境 PATH 覆盖隐藏系统 Python（`python`/`python3` → exit 127），不限制工具；用户以自然语言说明 Python 不可用、请自行准备可运行环境并完成计算。
- Oracle：run completed；terminal 结果包含确定性标记；临时脚本目录出现 `.py`；存在下载/安装/调用非系统 Python 的命令证据。

##### `human-context-compaction-natural-trigger-live`

- 测试类型：`backend / live`
- What：live 模式下 `human` 会先用普通短问铺出一条完整历史轮，再在风险周报长任务中自然触发压缩；压完后发给主模型的数组为 `[System] + [Compact User] + 原文 tail`。同一次可走历史 + 半截。Run 2 未压出 checkpoint 则不发 Run 3。续做再压，且 Run 3 首轮 brain 必须明显复用 Run 2 末次前缀缓存。
- Why：相比单独直调节点，live 回归更应该守住“真实 graph 中自然压缩、当前工作仍能做完”的能力；同时守住跨 run 只 append 新 user、历史前缀字节不变时 provider 前缀缓存应命中。
- How：复用风险周报 live 的真实文件地址。override 仍走生产公式（`modelContext × 0.8` 得压缩线）。要让压缩线为 45_000，注入 `humanRuntimeOverrides.modelContextWindowTokens=56_250`（`ceil(45_000 / 0.8)`），effectiveWindow 即 45_000。tail 由 effectiveWindow × `CONTEXT_COMPACTION_TAIL_RATIO`（0.1）算出，不再单独 override keep。切点只认伙伴 log 可见行（`seq > historyFloorSeq` 的 `user|assistant|tool`），`throughSeq` 为 firstKept 之前最大 seq；压完用同一投影函数（`appendCurrentUser=false`）重投影。`context_compaction_started` / `completed` 带 `throughSeq` / `firstKeptSeq` / `historyFloorSeq` / `historyFloorKind`（`compaction` / `none`） / `isSplitTurn` / `foldedCount` / `tailCount`；timeline assertion `data` 只记切点与 roles，prompt 回看 `llm-io.jsonl`。case 结束写出 `artifacts/message-log-annotations.json`。Run 1 发普通短问（上周周报文件名），不要求自己压到。Run 2 用更重的周报诉求（必须逐份打开模板、上周周报、客户周会、交付合规、供应商、法务、站会、Q2 复盘及三份 txt，并打开一次根目录经营周报.xlsx 把关键数字写进财务节；按材料分小节且每节引用原句，不能只扫目录或写成一段总述），靠材料正文与 Excel 阅读技能堆过 45k，应压到，覆盖历史 + 半截。Run 2 若未压出 checkpoint，不发 Run 3，直接按 Run 2 断言失败。Run 3 同伙伴、不再 @ 上周周报/已交周报，要求对照刚写的本周周报和上周周报、补风险对照、标题改为「九月第一周」、核法务口径，从而再压至少一次。Run 3 首次 brain 用 `cachedInputTokens / Run2 末次 brain inputTokens` 与公用跨 run 门槛 `CROSS_RUN_PREFIX_CACHE_MIN_RATIO`（当前 0.85，定义于 `tests/harness/core/continuation-prefix-cache.ts`）对比。brain 的 `llm-io` 另记 `requestWire`（发给 LangChain 的 messages 含 assistant `toolCalls.arguments` 字符串，以及每个工具的完整 `parameters` schema），跨 run 缓存断言会把 Run2 末次 vs Run3 首次的第一处 diff 写进 timeline。固定开销（工具 schema + system）几乎不随压缩减少，过小窗口会连续压缩；过线靠加重 Run 2 用户诉求，不靠降阈值。continuation / resume live 仍分开，不并入本 case。
- Oracle：Run 1 `completed`，不要求压缩。Run 2 至少一次完整 compaction；每次 started/completed 都带有效切点字段；压完后下一次 brain 消息为 `system + human(checkpoint) + 原文 tail`，不能 System 后直接 AI；落库 checkpoint 为六栏（半轮可含 Turn Context）；提示词无 `<previous-summary>` / `[round]` / `<current>` / `<earlier>`；含「上周周报」、不编造「上周工作周报.docx」；周报 docx 交付成功；不对 tail 逐条复述。Run 3 首次 brain 为 `system, human(checkpoint), …原文…, human(新任务)`，不能 System 后直接 AI；再压至少一次且 `completed`，切点字段同样有效；「目标 / 进度 / 下一步 / 约束与偏好」说的是对照、改标题或法务，而不是整段重填周报。Run 3 首次 brain 必须带回 provider 缓存 usage，且 `cachedInputTokens / Run2 末次 brain inputTokens ≥ CROSS_RUN_PREFIX_CACHE_MIN_RATIO`。按 10 分制评估压缩生命周期、摘要结构和文件交付，严格超过 8 分通过。

##### `human-risk-report-draft-live`

- 测试类型：`backend / live`
- What：live 模式下 `human` 会在一个真实长任务里串起模板定位、上周周报风格参考、多源工作资料取证、新建本周周报 docx 并直接写回交付。
- Why：`human/live` 需要至少一条长期高价值复杂样例，覆盖 workspace 搜索、真实材料辨别、跨 `docx + txt` 综合、create-target 写入与最终交付链路；同时守住“共享 workspace 中全部已支持文件都已进入真实 KB，且关键事实可能来自 KB 命中的 txt 或后续读取材料”的更真实用户环境。
- How：注入真实 live LLM 配置；workspace 直接使用 `tests/fixtures/workspace` 共享目录，并在 run 前通过真实生产文件 ingestion 链把该目录下当前所有已支持文件索引进 KB；随后由测试在运行时重建 `工作/` 目录：包含一份不可直接覆盖的周报模板、一份只能参考风格的上周已发版周报、多份提供本周事实的 `docx` 工作文档、数份必须读取的 `txt` 口径/跟进材料，以及少量看起来相关但不应直接采用的干扰文件；直接输入“帮我写下这周的周报，基于这个周报模版和我的工作文档信息，记得参考我上周写的周报风格来哦”的自然语言诉求，让真实 `human` 自主完成。
- Oracle：任务最终完成；共享 workspace 中全部已支持文件均被索引；事件流中至少出现一次 `terminal_run`、至少一次真实资料读取/检索步骤以及一次对不在既有参考列表中的新路径的 DOCX 写入（允许通过终端复制模板创建新文件后再用 docx 写工具编辑）；模型会打开模板和上周周报；最终输出 artifacts 中包含携带 `applyId` 的 docx file artifact，且所有 DOCX 写入都落在新交付路径上；模板与既有参考 `docx` 文件不被覆盖。按 10 分制评估文件交付、原文件安全、未闭环风险、负责人动作和谨慎结论，严格超过 8 分通过；否定上下文中的“风险已解除”等文字不得误判成正向收口。

##### `human-docx-positioned-structural-edit-fallback-live`

- 测试类型：`backend / live`
- What：live 模式下 `human` 在复杂 positioned docx 中会跳过命中的复杂定位排版区域，并继续尝试处理其他可安全编辑的位置。
- Why：这类由 `framePr` / 绝对定位 shape 组成的 docx 即使只是原地改字也可能因结构重写而错位；这条 case 要长期守住“positioned 区域只读、自动写入必须拒绝并给用户手动提示”的能力，对齐 `WB-CORE-003-AC1`、`WB-CORE-004-AC1`、`WB-CORE-006-AC1`、`WB-CORE-006-AC2`。
- How：注入真实 live LLM 配置；只将 `图形学.docx` 作为已选资料复制进 workspace；直接输入“我准备把这份图形学讲义发给同学复习，想把‘反走样’这一节补得更容易记一些。你直接在这一节后面加一段更通俗的说明，再加一个很短的总结表，帮助大家快速区分两种常见做法。”的自然语言诉求，让真实 `human` 自主完成。
- Oracle：事件流中至少一次 `docx_search` / `docx_read_nodes` / `docx_read_outline` 覆盖 `图形学.docx`；至少一次 DOCX 写入请求因为命中复杂定位排版区域失败，并返回稳定 `hand_docx_positioned_write_blocked` 与 `diagnostic.message`；命中区域不得发生成功写入，但允许继续编辑其他非定位区域；允许改为生成独立补充稿，也允许在最终答复中直接交付可粘贴的完整说明和总结表。按 10 分制评估目标读取、保护触发、写入安全、手动说明、内容可用性和 artifact 一致性，严格超过 8 分通过，不把内部完成状态作为单独失败条件。

##### `human-kb-guided-docx-comparison-draft-live`

- 测试类型：`backend / live`
- What：live 模式下 `human` 会先用 KB 缩圈找出讲“反走样 / 过拟合”的两份源资料，再把内容分别回写到用户明确指定的两份目标 docx。
- Why：真实用户常常记得主题、不记得文件名，而且希望把资料内容整理回自己的教学文档；这条 case 要长期守住“文件地址默认范围 + KB 缩圈 + 多源读取 + 多目标 docx 回写”的能力，对齐 `WB-CORE-002-AC2`、`WB-CORE-004-AC1`、`WB-CORE-006-AC1`、`WB-CORE-006-AC2`。
- How：注入真实 live LLM 配置；workspace 使用共享 fixture，只把 `学习笔记/图形学.docx` 与 `学习笔记/深度学习.docx` 建入 KB；用户明确指定将过拟合补到根目录 `人工智能探究课堂PRD.docx`、反走样补到 `交互式探究学习案例：产业转移.docx`，均追加到文末，避免无人交互 case 因概念映射或插入位置不明确而等待提问。走完整生产工具发现及 `AiRunService` 收尾，来源课件保持不变。
- Oracle：真实 `kb_search` 返回有效命中；两份目标文档分别发生成功 paragraph 写入并产生两组携带 `applyId` 的 file artifact；两份来源课件保持不变。成功的 DOCX 写结果只能是空 `result` 或 `createdIds`，不得返回 `changes`。重复写入次数不做硬性限制；是否冗余、是否 grounded 由人工读 logs/产物评分。按 10 分制评估 KB 证据、两份目标文件、grounded 内容、来源安全和最终交付，严格超过 8 分通过；只完成一个目标文件最多 8 分，不能通过。

##### `human-pdf-visual-reading-live`

- 测试类型：`backend / live`
- What：真实模型会自主组合 PDF 页面读取和主模型多模态输入。
- Why：PDF 工具不内置图片理解，必须验证工具解耦后 AI 仍能完成图文结合阅读。
- How：只选择 `深度学习.pdf`，询问第 1 页训练闭环和第 9 页 Proper fit / Overfit 图形差异，仅开放 PDF 读取工具与内置 `read_image`。
- Oracle：任务完成；`pdf_read_pages` 返回第 9 页 `pageImagePath`，模型调用 `read_image` 并识别成功；路径位于 `userData/partners/{id}/runtime/assets/pdf_read_pages-<uuid>/<hash>.<ext>`；不调用 terminal、KB、docx；最终答复同时说明训练闭环和两组曲线差异；源 PDF 不变。

##### `human-docx-visual-reading-live`

- 测试类型：`backend / live`
- What：真实模型能从 DOCX 递归 visual 节点取得 `nodeId` 和 `imagePath`，并按需读取普通图片。
- Why：mock 只能证明协议可串联，live 还要验证模型在自然语言任务下会自主选择视觉读取，并能使用真实识图结果回答。
- How：只选择含五种 visual kind 的真实 OOXML fixture，要求模型找到标有 IMAGE 的普通图片，说明标题、主要颜色和基本图形；只开放 DOCX 读取工具，不在用户输入中提供工具名或调用顺序。
- Oracle：任务完成；模型读取递归节点并成功调用 `read_image`；主模型和最终答复都能使用图片内容，最终答复识别出蓝色、矩形和圆形；不调用任何 DOCX 写工具；源 DOCX 不变。

##### `human-docx-dangling-image-edit-live`

- 测试类型：`backend / live`
- What：真实模型能读取带 `NULL` 图片残留的需求 DOCX，识别真实图片、评估需求并写回开发时间；主 run 收尾生成可独立解析的审核，残留图片不阻断净差异。
- Why：这条回归覆盖用户真实的“读图 + 分析 + 同文件编辑”闭环，防止底层脏关系再次被算成虚假图片或阻止写入。
- How：使用真实附件和用户原句，通过生产主 run 与完整工具发现链执行；从统一记录读取本轮修改，直接解析正式 DOCX 与审核产物。
- Oracle：任务完成；调用 DOCX 提纲与正文读取（`docx_read_nodes` 或 `docx_search`）、`read_image` 和成功的 `docx_content_edit`；图片读取没有缺失文件错误，最终答复不出现“图片9”，产出的 DOCX 比原文新增至少 12 条有效工时表达，接受小数、区间及天、人天、人日、工作日、小时等自然表述。

##### `human-web-search-by-url-live`

- 测试类型：`backend / live`
- What：live 模式下用户直接给指定地址，`human` 通过 `web_search({ type: 'fetch', url })` 读取该页正文并回答。
- Why：用户给定具体网址时，`human` 应直接 fetch 该地址而不是先搜索，这是网页读取的低成本入口，必须稳定。
- How：启动本地 HTTP server 承载通知页（含申请对象与截止日期），用户输入明确给出该通知页 URL，要求模型阅读该页并回答两个事实。
- Oracle：事件流中至少一次成功调用 `web_search(type=fetch)` 且 `finalUrl` 命中给定地址；最终答复包含页面正文里的申请对象与截止日期。

##### `human-web-search-intent-query-live`

- 测试类型：`backend / live`
- What：live 模式下用户只给纯文本诉求、不给网址，`human` 提炼搜索意图后通过 `web_search(type=search)` 获取候选，并用 `type=fetch` 读取官方文档回答。
- Why：真实用户常只描述诉求不给网址；`human` 应提炼关键词走 search 而非直接 fallback 浏览器。
- How：不向用户输入提供 URL，用户以「记不清官方网址、帮忙搜索官方文档中 CSV 读取与写入 API 用法」的自然语言诉求要求搜索并阅读官方页面；要求模型自行提炼意图并读取官方文档页面完成整理。
- Oracle：至少一次成功调用 `web_search(type=search)`；`pandas.read_csv` 与 `pandas.DataFrame.to_csv` 两个 `pandas.pydata.org` 官方 API 页面都必须成功 fetch，并基于正文回答。

##### `human-text-file-read-checkout-readiness-live`

- 测试类型：`backend / live`
- What：真实模型在上线前阅读 checkout 配置，并直接向用户说明主备地址、超时、重试和 telemetry 是否具备切换条件。
- Why：读配置是常见的上线前审查场景，用户不需要了解底层工具或要求生成额外文件。
- How：只给出自然语言的审查诉求；只开放真实 `text_file_read`。
- Oracle：任务完成；发生真实读取；源文件 hash 不变；结论质量由 raw logs 人工评估。

##### `human-text-file-write-checkout-cutover-live`

- 测试类型：`backend / live`
- What：真实模型执行一次明确的 checkout 服务地址切换，并保留重试和 telemetry 配置。
- Why：真实配置变更必须验证目标修改和非目标内容完整性，而不是固定底层 edit action。
- How：用户明确给出两处旧地址、目标地址、超时和不可修改项；模型自行读取、编辑并复核。
- Oracle：最终文件两处地址和超时精确更新；重试与 telemetry 不变；不检查最终回答文案。

##### `human-terminal-preview-service-live`

- 测试类型：`backend / live`
- What：live 模型能在项目子目录启动临时 HTTP 预览服务，真实访问页面、确认服务收到请求并彻底停止服务。
- Why：工具契约正确不代表模型能完成「起服务 → 确认 → 用完关掉」；放行后台分离后，模型可走前台长跑 + 读终端，也可走 `nohup`/后台 + 等待再确认，不强制 `terminal_read`。
- How：在临时 workspace 的 `preview-site` 中创建带唯一标记的页面，为用户提供一个随机空闲端口；用户只描述启动预览、真实访问确认标记、确认服务收到请求、用完关闭的诉求，不指定工具或命令。由真实模型自主决策。
- Oracle：任务 `completed`；页面标记出现在最终交付或真实工具结果中；服务在模型完成后不可达（由模型关闭，框架不在会话结束时强杀拆出去的后台进程）。路径满足其一即可：① 出现 `command_still_running`/`terminal_command_yielded` 且随后有成功的 `terminal_read` 或 wait-like 终端命令；② 出现 wait-like 终端命令（`sleep` / `Start-Sleep` / `time.sleep` / `ping -c|-n` / `timeout` 等跨平台等待语义）。

## 5. 最新 Live 评估

| caseId                                              | 状态 | 评分（0-100） | 模型                             | 时间                 | run 路径                                                                                                  | 简短依据                                                                                                                                                                                                                                                         |
| --------------------------------------------------- | ---- | ------------: | -------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| human-subagent-collaboration-live | 完成 | 88 | qwen3.8-flash | 2026-10-10 14:47 CST | tests/logs/ai/human/live/human-subagent-collaboration-live/20261010-144742-669-e69ff387 | 555s；三项完成，销售/退货/净额为 91,824,000 / 422,000 / 91,402,000；配置与 DOCX 的受控审核、主文件归属及保护项通过，完成子会话清理。人工质量评分 88/100：事实及文件交付完整；主伙伴重复独立计算，122 行报告及多轮链接/时间修订增加耗时和 token。主 24 次调用，输入/输出 501,127 / 16,888；子 34 次，518,455 / 16,974；总缓存读 941,824（92.4%）。 |
| human-risk-report-draft-live                        | 完成 |            94 | deepseek-flash                   | 2026-10-05 15:05 CST | tests/logs/ai/human/live/human-risk-report-draft-live/20261005-150552-320-b3053e8c                        | 11 次 Word 编辑交付新周报，来源文件保护和先生成后舍弃的草稿清理通过；独立审核可解析、确认 B 保留。73s。                                                                                                                                                          |
| human-context-compaction-natural-trigger-live       | 完成 |            90 | qwen3.8-flash                    | 2026-09-12 13:38 CST | tests/logs/ai/human/live/human-context-compaction-natural-trigger-live/20260912-130017-162                | 去掉 discard/digest 后四断言通过（2269s）。Run1 未压；Run2 预算 36297 过 36k，半截 throughSeq=75 后多次历史压（112/136/182/235/283/304）并交付；Run3 再压 333/366（半截）/376/397/437。`historyFloorKind` 仅 none/compaction。跨 run 缓存 0.993（35840/36101）。 |
| human-excel-read-weekly-review-live                 | 完成 |            91 | deepseek-v4-flash                | 2026-08-30 13:46 CST | tests/logs/ai/human/live/human-excel-read-weekly-review-live/20260830-134623-663                          | Oracle 通过；四表结构/公式/退货异常/口径不对等讲清；6×excel_read。过程仍 6×terminal 验算略多。缓存 83.6%。                                                                                                                                                       |
| human-excel-edit-weekly-review-live                 | 完成 |            95 | deepseek-flash                   | 2026-10-05 15:06 CST | tests/logs/ai/human/live/human-excel-edit-weekly-review-live/20261005-150618-395-56b40350                 | 4 次 excel_edit：表头、680000 和扣退货净额公式正确，保护区保持原样；单条审核工作簿与 B 清理通过。38s。                                                                                                                                                           |
| human-excel-create-monthly-budget-live              | 完成 |            92 | deepseek-flash                   | 2026-10-05 15:06 CST | tests/logs/ai/human/live/human-excel-create-monthly-budget-live/20261005-150658-161-c84b8c3c              | 两表预算、SUMIF/COUNTIF 和金额格式断言通过，正式文件与独立审核均可解析；14 次编辑、10 次读取，复核略多。38s。                                                                                                                                                    |
| human-kb-guided-docx-comparison-draft-live          | 完成 |            95 | deepseek-flash                   | 2026-10-05 15:09 CST | tests/logs/ai/human/live/human-kb-guided-docx-comparison-draft-live/20261005-150900-453-4712c312          | KB 证据与原文读取后两次编辑，按明确主题映射更新两份 Word；来源保护、独立审核、B 清理通过。79s。                                                                                                                                                                  |
| human-ppt-create-executive-deck-live | 完成 | 94 | deepseek-flash | 2026-10-05 17:02 CST | tests/logs/ai/human/live/human-ppt-create-executive-deck-live/20261005-170203-691-aad35e9c | 6 页简报、正式 PPT 和自包含 SVG 审核通过；按实际字体检查表格无单元格溢出、无其他文字框重叠。审核图与 LibreOffice 独立渲染人工复核，中文、全角括号和底部说明完整。87s。 |
| human-ppt-edit-management-review-live | 完成 | 94 | deepseek-flash | 2026-10-05 17:02 CST | tests/logs/ai/human/live/human-ppt-edit-management-review-live/20261005-170203-693-c804081e | 3 次编辑新增摘要、改汇报人与成立年份；议程/愿景保护、9→10 页、独立前后 SVG 和确认 B 清理通过。56s。 |
| human-ppt-read-management-risk-review-live          | 完成 |            90 | qwen3.8-flash                    | 2026-08-30 12:39 CST | tests/logs/ai/human/live/human-ppt-read-management-risk-review-live/20260830-123903-652                   | 中文提案只读，Oracle 通过；KPI 85% 正确。缓存 74.1%（首轮占比高）。                                                                                                                                                                                              |
| human-terminal-data-reconciliation-live             | 完成 |            96 | deepseek-v4-flash                | 2026-08-13 20:20 CST | tests/logs/ai/human/live/human-terminal-data-reconciliation-live/20260813-202008-775                      | 终端对账，交付财务异常 CSV 金额/记录精确，输入文件未改（type 已按用户语句中文说明填写）。                                                                                                                                                                        |
| human-runtime-script-system-python-live | 完成 | 95 | qwen3.8-flash | 2026-10-08 18:21 CST | tests/logs/ai/human/live/human-runtime-script-system-python-live/20261008-182147-485-1b65adb5 | 含 JSON 样例的公共审核通过七组授权边界，八次审核 ID 与 reason 准确；真实 Python 得到 338350，普通工作区保持。85s；报告和旧临时脚本说明略长。 |
| human-runtime-download-python-live                  | 完成 |            92 | deepseek-v4-flash                | 2026-08-14 16:03 CST | tests/logs/ai/human/live/human-runtime-download-python-live/20260814-160340-415                           | Python 不可用时自主下载便携运行时并运行临时脚本，得到正确结果。                                                                                                                                                                                                  |
| human-partner-resume-with-new-selection-live | 缓存未达标 | 93 | deepseek-flash | 2026-10-05 17:02 CST | tests/logs/ai/human/live/human-partner-resume-with-new-selection-live/20261005-170203-704-8862e8b1 | 中断后同伙伴续做，保留旧事实并使用新选择文件完成草稿，功能断言通过；请求前缀及工具定义完整保留，但服务端返回缓存复用 64.75%（19456/30047），未达 85%。66s。 |
| human-partner-continuation-live | 完成 | 91 | deepseek-flash | 2026-10-05 17:03 CST | tests/logs/ai/human/live/human-partner-continuation-live/20261005-170302-079-ba8b5605 | 两轮正常完成，历史追加、新选文件和双主题事实通过；日志等待落盘并按真实 runId 配对后，前缀及工具定义一致，缓存复用 90.95%（73344/80646），达到 85% 门槛。338s。 |
| human-docx-positioned-structural-edit-fallback-live | 完成 |            85 | deepseek-flash                   | 2026-10-05 15:09 CST | tests/logs/ai/human/live/human-docx-positioned-structural-edit-fallback-live/20261005-150900-453-0b6d3dc1 | 复杂定位原稿 hash 未变，非定位文件编辑与独立审核通过；模型在临时副本多次试探保护边界并处理 stale nodeId，过程有冗余。79s。                                                                                                                                       |
| human-legacy-doc-reading-live                       | 完成 |            94 | deepseek-v4-flash                | 2026-08-13 19:56 CST | tests/logs/ai/human/live/human-legacy-doc-reading-live/20260813-195642-815                                | 通过 docx 读取工具成功读取旧版 .doc 并准确回答五级风险与区别率，源文件未改。                                                                                                                                                                                     |
| human-text-file-write-checkout-cutover-live         | 完成 |            96 | deepseek-flash                   | 2026-10-05 15:07 CST | tests/logs/ai/human/live/human-text-file-write-checkout-cutover-live/20261005-150706-485-43600589         | 两处端点及超时准确更新，重试/telemetry 不变；两次编辑，完整行 JSON 审核与 B 清理通过。9s。                                                                                                                                                                       |
| human-text-file-read-checkout-readiness-live        | 完成 |            93 | deepseek-v4-flash                | 2026-08-13 20:16 CST | tests/logs/ai/human/live/human-text-file-read-checkout-readiness-live/20260813-201642-554                 | 只读审查准确识别就绪性风险与保留配置，源文件未改。                                                                                                                                                                                                               |
| human-web-search-by-url-live                        | 完成 |            95 | qwen3.8-flash                    | 2026-09-01 16:24 CST | tests/logs/ai/human/live/human-web-search-by-url-live/20260901-162353-087                                 | 指定地址后连续 2×fetch 通知页与指南页，事实回答正确，errors=0。                                                                                                                                                                                                  |
| human-web-search-intent-query-live                  | 完成 |            90 | qwen3.8-flash                    | 2026-09-01 16:24 CST | tests/logs/ai/human/live/human-web-search-intent-query-live/20260901-162353-087                           | 2×search + 2×fetch 成功读取 read_csv 与 DataFrame.to_csv 官方 API 页，errors=0。                                                                                                                                                                                 |
| human-terminal-preview-service-live                 | 完成 |            88 | qwen3.8-flash                    | 2026-08-31 18:30 CST | tests/logs/ai/human/live/human-terminal-preview-service-live/20260831-183019-685                          | 启动预览服务、确认页面并关闭服务，前台 yield/读终端或后台+wait 两条路径均可。                                                                                                                                                                                    |
| human-legacy-doc-edit-skip-live                     | 完成 |            88 | deepseek-v4-flash                | 2026-08-21 23:11 CST | tests/logs/ai/human/live/human-legacy-doc-edit-skip-live/20260821-231108-129                              | .doc 写入失败后停止重试，源文件不变，任务完成。                                                                                                                                                                                                                  |
| human-docx-visual-reading-live | 完成 | 93 | deepseek-flash | 2026-10-05 17:04 CST | tests/logs/ai/human/live/human-docx-visual-reading-live/20261005-170424-148-371e1d67 | 读取正文和真实图片，回答图片中的关键事实，来源文件 hash 不变；工具及完成态断言通过。31s。 |
| human-pdf-visual-reading-live                       | 完成 |            92 | deepseek-v4-flash / qwen3.6-plus | 2026-08-21 23:07 CST | tests/logs/ai/human/live/human-pdf-visual-reading-live/20260821-230727-871                                | PDF 页级视觉读取与识图，正确回答图形差异，源 PDF 未改。                                                                                                                                                                                                          |
| human-docx-dangling-image-edit-live | 完成 | 94 | qwen3.8-flash | 2026-10-05 20:52 CST | tests/logs/ai/human/live/human-docx-dangling-image-edit-live/20261005-205238-152-888b3656 | 按 .env 配置执行，14 次 Word 编辑补齐 13 项评估和总览；原正文顺序与 7 张图片字节保留，审核包含全部评估及绿色标记。正式文件与确认 B 校验一致，清理工作快照后审核独立解析通过；原有 NULL 坏链保持不变。293s，本轮整体缓存命中 90.80%。 |
| human-skill-eviction-relearn-loop-live | 缓存未达标 | 92 | deepseek-flash | 2026-10-05 17:03 CST | tests/logs/ai/human/live/human-skill-eviction-relearn-loop-live/20261005-170332-050-46c8fb53 | 两轮完成 FIFO 淘汰、同轮重学、Word/PPT 写入；独立审核与 B 清理通过。读图和学习混合批次无消息顺序错误。前缀和工具定义一致，缓存复用 50.69%（9088/17929），未达 85%。51s。 |
