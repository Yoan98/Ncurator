# NCurator-Desktop Core AI 测试计划

## 0. 共享约束

- Core AI 正式测试用例的文档约束、实现状态取值和用例字段定义，统一以 [test.md](/Users/test/work-space/NCurator-Desktop/doc/test.md) 为准。
- 本文只补充 Core AI 专属的总体目标、模型使用方式、阶段推进和领域用例。

## 1. 总体目标

本计划用于验证项目核心 AI 智能系统是否真的能接住用户诉求，并在本地优先约束下把事情做成，而不是只返回一段看起来合理的回答。

当前测试主轴聚焦三类真实诉求：

- 帮用户编辑或编写 `.docx` 文档
- 回答本地知识库问题
- 在必要时结合 `terminal` 读取工作区文件、生成中间材料或辅助完成前两类任务

本计划只描述这次 Core AI 专项测试的总体目标、模型使用方式、阶段推进和阶段用例。测试用例设计准则、测试目录、runner、raw log、report 契约统一以 [test.md](/Users/test/work-space/NCurator-Desktop/doc/test.md) 为准，这里不再重复展开。

## 2. 模型使用与诊断

- 默认所有设计模型调用的 case 先使用基础模型测试（AI_LIVE_PRIMARY_MODEL_NAME）。
- 同一 case 在相同输入、相同 fixture、相同运行前提下重复多次仍无法完成，或稳定卡在同一处时，可补跑更强模型（AI_LIVE_STRONG_MODEL_NAME）。
- 这样做的目的不是把更强模型当成默认方案，而是判断问题更像模型能力上限，还是上下文、编排、工具链问题。
- 如果更强模型能明显推进或直接完成任务，应把这类观察补充到 report 中，作为后续分析依据。
- 任何正式测试范围只要存在模型参与，就不能只依赖非 live case 得出阶段结论；是否真正成立，仍需以 `live` 证据为准。

## 3. 阶段计划

测试按阶段顺序推进，原则上上一阶段形成稳定结论后，再进入下一阶段。

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

`tool-docx-structure-read`

- 实现状态: `待检查`
- What: 验证文档读取基线
- Why: 所有文档任务都依赖这条基础链路
- How: 对带标题、正文、表格的样例文档完成 `open -> outline -> search -> get_block`
- Oracle:
  1. `open` 成功返回唯一目标文档句柄，后续读取都绑定同一文档。
  2. `outline` 返回的标题树包含 fixture 中预期的标题节点，顺序不乱序。
  3. `search` 与 `get_block` 最终定位到同一目标块，返回内容包含预期关键句。
  4. 全流程不发生写入、保存或版本变更。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

`tool-docx-targeting-and-ambiguous-search`

- 实现状态: `待检查`
- What: 验证块定位与歧义消解
- Why: 不解决歧义，后续编辑容易改错位置
- How: 多个相似标题或相似段落同时命中时，仍能稳定定位目标块
- Oracle:
  1. 歧义搜索先返回多个候选命中，而不是直接误改或误判成唯一目标。
  2. 经过补充定位后，最终只收敛到 1 个目标 `blockId`。
  3. 最终选中的块与 fixture 预期标题或段落一致，不落到同名的错误位置。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

`tool-docx-search-modes-and-scope`

- 实现状态: `待检查`
- What: 验证搜索模式与局部范围控制
- Why: 真实文档编辑常常需要先缩小范围再修改
- How: 覆盖 `literal / regex / semantic` 三种搜索方式，以及 `scope.blockIds` 的局部搜索
- Oracle:
  1. `literal`、`regex`、`semantic` 三种搜索模式都能返回各自应有的命中或空结果。
  2. 设置 `scope.blockIds` 后，返回结果只来自指定块范围，不泄漏到范围外。
  3. 相同 query 在不同模式下的结果差异可被日志回看，而不是被统一抹平。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

`tool-terminal-workspace-material-discovery`

- 实现状态: `待检查`
- What: 验证读取型 terminal 链路
- Why: 很多任务第一步就是先找材料
- How: 在多层目录里找到最新材料并提取可复用内容
- Oracle:
  1. 读取链路只访问工作区内路径，不发生工作区外读取。
  2. 最终命中的材料符合 fixture 约定的“最新”规则，而不是任意取到一份旧文件。
  3. 输出包含可回看的文件路径和提取结果，后续可直接复用。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

`tool-terminal-path-resolution`

- 实现状态: `待检查`
- What: 验证路径解析
- Why: 路径解析错误会直接破坏后续任务
- How: 混用相对路径、绝对路径和目录切换时仍能稳定定位文件
- Oracle:
  1. 相对路径、绝对路径和目录切换后的目标文件最终解析到同一真实文件。
  2. 路径解析不会因为 `cwd` 变化而指向错误文件或错误目录。
  3. 解析完成后的后续读取命中预期文件内容，而不是空文件或邻近文件。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

`tool-kb-hybrid-search`

- 实现状态: `待检查`
- What: 验证 `hybrid` 检索基线
- Why: `hybrid` 是本地检索的主路径之一
- How: 在限定 source scope 下返回可引用结果，并与已选范围保持一致
- Oracle:
  1. 返回结果只来自选定的 source scope，不混入未选范围。
  2. 至少有 1 条结果能够支撑问题回答，并带有可回看的来源信息。
  3. 返回结果的排序与收敛方向稳定指向目标资料，而不是在多份资料间漂移。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

`tool-kb-vector-search`

- 实现状态: `待检查`
- What: 验证 `vector` 检索基线
- Why: 需要单独确认语义检索能力边界
- How: 在相同 fixture 下验证纯向量检索的返回质量、空结果和范围收敛
- Oracle:
  1. 语义查询在有相关内容时能够召回预期文档或 chunk，而不是全部漏检。
  2. 在无相关内容的 fixture 下返回空结果或明确无结果，不伪造近似答案。
  3. 结果范围仍受 fixture 约束，不因向量召回扩大到错误资料。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

`tool-kb-fts-search`

- 实现状态: `待检查`
- What: 验证 `fts` 检索基线
- Why: 关键词检索是最容易被用户感知的基线
- How: 在相同 fixture 下验证关键词检索、精确命中和空结果边界
- Oracle:
  1. 关键词精确命中时，首批结果包含预期文档或 chunk。
  2. 无命中关键词返回空结果，而不是退化成泛化语义结果。
  3. 结果中的来源字段可用于回看具体命中文本。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

`tool-kb-list-documents-and-scope-filter`

- 实现状态: `待检查`
- What: 验证文档枚举与范围过滤
- Why: 很多问题会先找资料范围，再做检索
- How: 先列出文档，再按 source scope 限定检索范围
- Oracle:
  1. `list_documents` 返回的候选文档包含目标资料且名称可辨认。
  2. 把候选文档收窄成 source scope 后，后续检索只命中被选中的资料。
  3. 未被选中的文档不会继续出现在结果里。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

#### boundary

`tool-docx-save-conflict-and-overwrite`

- 实现状态: `待检查`
- What: 验证保存边界
- Why: 结果交付必须安全，不能在保存阶段失控
- How: 覆盖保存、另存为、路径冲突和 `overwrite` 行为
- Oracle:
  1. 未显式允许 `overwrite` 时，路径冲突会被阻止，不静默覆盖现有文件。
  2. `save_as` 能生成新的目标文件路径，并保留原始文档状态。
  3. 显式 `overwrite` 时只覆盖指定目标，不扩散到其他输出。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

`tool-docx-preview-validate-rollback`

- 实现状态: `待检查`
- What: 验证结果收敛能力
- Why: 工具不只要能改，还要能收敛和回退
- How: 多轮编辑后执行保存、预览、校验、历史回看与回滚
- Oracle:
  1. `preview` 与 `validate` 能反映当前编辑后的真实内容，而不是旧版本。
  2. 历史回看可以定位到本轮编辑前后的关键版本。
  3. `rollback` 后文档内容恢复到预期旧版本，之前错误修改不再保留。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

`tool-terminal-approval-and-boundary`

- 实现状态: `待检查`
- What: 验证审批与工作区边界
- Why: 本地优先和安全约束是这条链路的前提
- How: 覆盖审批请求、批准、拒绝、路径逃逸阻断
- Oracle:
  1. 需要审批的命令会先产出审批请求，再等待批准或拒绝。
  2. 批准后只执行被批准的目标命令，不额外扩张执行范围。
  3. 路径逃逸或工作区边界违规会被直接阻断，不进入实际执行。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

`tool-terminal-approval-denied-follow-up`

- 实现状态: `待检查`
- What: 验证审批拒绝后的收敛
- Why: 审批拒绝是常见分支，不能当异常遗漏
- How: 用户拒绝后，系统能停止执行并给出安全后续
- Oracle:
  1. 用户拒绝审批后，原命令不会被执行。
  2. 系统会返回明确的阻塞说明和可继续的下一步，而不是沉默失败。
  3. 拒绝分支不会伪造产物或伪造“已完成”状态。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

`tool-terminal-failure-and-long-output`

- 实现状态: `待检查`
- What: 验证失败路径可解释
- Why: 失败不可避免，但必须可回看、可理解
- How: 覆盖命令失败、长输出截断、超时终止后的收敛
- Oracle:
  1. 命令失败会回写失败状态和可解释的原因，不冒充成功。
  2. 长输出会被收敛展示，但仍保留足够的头尾或摘要用于回看。
  3. 超时终止后能明确区分“被终止”与“执行成功”。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

`tool-kb-empty-scope-and-no-result`

- 实现状态: `待检查`
- What: 验证知识库边界表现
- Why: 证据不足时必须安全收敛，而不是胡编
- How: 覆盖空范围、无结果和返回理由清晰性
- Oracle:
  1. 空范围会直接返回无结果，而不是跨范围检索。
  2. 无结果时给出明确原因或空结果标记，不伪造引用。
  3. 后续返回仍维持安全收敛，不把“没找到”写成结论。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

#### scenario

`tool-docx-mixed-structural-edit`

- 实现状态: `待检查`
- What: 验证复杂结构改写
- Why: 真实文档修改通常不是单一操作
- How: 同一 case 内完成章节改写、插入新段、删除旧段、更新表格负责人
- Oracle:
  1. 章节改写、新段插入、旧段删除和表格负责人更新四类操作都实际生效。
  2. 未被本 case 指定的章节或表格内容保持不变。
  3. 最终预览或保存结果能一次性反映全部结构性修改。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

`tool-docx-table-and-inline-rewrite`

- 实现状态: `待检查`
- What: 验证表格与行内文本混合改写
- Why: 周报、纪要、方案文档经常同时涉及表格和正文
- How: 同一轮操作中修改表格单元格、段落正文和局部文本替换
- Oracle:
  1. 表格单元格修改、段落正文改写和行内文本替换都在同一轮中生效。
  2. 行内替换只影响目标短语，不误伤同段其他文本。
  3. 最终内容同时保留表格结构和正文结构的完整性。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

`tool-docx-multi-document-session-isolation`

- 实现状态: `待检查`
- What: 验证多文档会话隔离
- Why: 多文档任务是后续高价值场景的基础
- How: 同一 run 中并行打开两份文档后，后续 `search / apply / save` 不会串到错误文档
- Oracle:
  1. 两份文档在同一 run 中拥有独立句柄或上下文，不会串写。
  2. 对文档 A 的 `search / apply / save` 不会影响文档 B，反之亦然。
  3. 最终输出路径和内容能一一对应到各自文档。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

`tool-terminal-batch-material-summary`

- 实现状态: `待检查`
- What: 验证批量材料发现与归并
- Why: 真实工作区任务很少只有一份输入材料
- How: 一次发现多份日报、会议纪要或风险清单，并提取可复用摘要
- Oracle:
  1. 一次批量发现中至少收敛出多份目标材料，而不是只处理首个命中。
  2. 输出摘要能覆盖多份输入的关键信息，并保留来源对应关系。
  3. 重复信息会被归并，不把同一事实重复堆叠成多条结论。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

`tool-terminal-artifact-producing-command`

- 实现状态: `待检查`
- What: 验证复杂命令与产物识别
- Why: `terminal` 不只是看输出，还要能接住产物
- How: 执行会生成中间文件的命令，检查摘要、产物识别与回读链路
- Oracle:
  1. 命令执行后能识别出实际生成的中间文件或产物路径。
  2. 产物会进入结构化回写或附件索引，而不是只留在命令 stdout 里。
  3. 后续可以基于该产物做回读或再处理。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

`tool-kb-document-discovery-to-targeted-search`

- 实现状态: `待检查`
- What: 验证从文档发现到定向检索的多步链路
- Why: 真实知识任务往往要先找范围，再确认精确证据，不能跨文档串证据
- How: 先列出候选文档，再把缩小后的 document scope 传给 `hybrid / fts`，确保结果稳定收敛到同一份资料
- Oracle:
  1. 文档发现阶段会先列出候选资料，而不是直接跨文档拼答案。
  2. 收窄后的 document scope 会稳定命中同一目标资料。
  3. 最终检索结果的证据链只来自被选中的文档。
- Not: 不验证 `human` / `director` 路由和最终用户交付。

#### live

- 当前 `tool` 阶段以纯工具链验证为主，不强制单独维护 `live` case；后续只有在工具路径真实引入模型参与时，才补对应 `live` 目录和 case。

### 3.2 `human`

做什么：单独验证 `human` 作为 AI 核心执行体，是否能基于目标自主推进任务、调用工具、处理阻塞并交付结果。

为什么：工具只是能力零件，真正决定“能不能把事做成”的是 `human`。

怎么做：从单步闭环开始，再覆盖多工具协作、失败纠偏、多轮续做、长任务、`watchHint` 收敛和部分完成场景。
落地规则：实现时按 `basic / boundary / scenario / live` 分组；`human` 的 `basic` 与 `live` 至少都要各自覆盖当前 skill 集合中的每个 skill。

当前实现前提：

- `human` 已切换为 `brain -> learning -> hand -> mouth` 的四节点内核
- 测试 override 以 `memoryOps + decision + nextAction` 契约为主，不再以旧 `HumanReasoningOutput` 或 `HumanStepDecision` 作为正式契约
- 收敛上限通过 `hand` 工具调用次数与 `watchHint` 控制，而不是旧 `watchdog` 或 graph state 中的 `maxSteps`
- 交付差异通过 `userInput` 表达，不再以 `objective` 或 `deliveryKind` 作为测试主契约

#### basic

`human-direct-kb-answer`

- 实现状态: `待检查`
- What: 验证单步自主完成
- Why: 最简单的单步任务必须先独立成立
- How: 直接读取知识库并交付可引用答案
- Oracle:
  1. 最终 `human` 结果为 `completed`，不是无故阻塞。
  2. 交付为面向用户的答案，并包含可回看的依据或引用。
  3. 执行链路只使用完成该问答所需的最小工具，不无意义扩张。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-direct-docx-edit`

- 实现状态: `待检查`
- What: 验证单工具文档闭环
- Why: 这是最常见的文档类基础任务
- How: 直接读取指定文档、完成局部修改并交付可审阅结果
- Oracle:
  1. 最终 `human` 结果为 `completed`，且完成了指定文档的局部修改。
  2. 交付中包含可审阅的文档结果或稳定产物引用。
  3. 修改范围收敛在指定目标位置，不误改无关段落。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-skill-workspace-cli`

- 实现状态: `待检查`
- What: 验证 `workspace-cli` 技能闭环
- Why: 每个 skill 都需要独立锚点，避免只在混合场景里被动覆盖
- How: 先学习 `workspace-cli`，再读取 workspace 文件或执行单条安全命令，并基于结果完成一次交付
- Oracle:
  1. `brainMemory.outside.learnedSkillIds` 中包含 `workspace-cli`。
  2. 读取文件或安全命令执行发生在学习该 skill 之后，而不是之前。
  3. 最终交付直接基于 workspace 结果，而不是脱离工作区臆测。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-skill-docx-read`

- 实现状态: `待检查`
- What: 验证 `docx-read` 技能闭环
- Why: 文档任务不只有写，读和定位也必须稳定成立
- How: 先学习 `docx-read`，再打开文档、定位结构或块内容，并完成一次基于文档内容的回答
- Oracle:
  1. `brainMemory.outside.learnedSkillIds` 中包含 `docx-read`。
  2. 执行链路完成文档打开、结构定位或块读取，而不是直接给结论。
  3. 最终回答能回指文档中的具体内容，不触发写入。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-skill-docx-write`

- 实现状态: `待检查`
- What: 验证 `docx-write` 技能闭环
- Why: 编辑能力必须能独立验证，不能只靠端到端场景带过
- How: 先学习 `docx-write`，在已知目标位置上完成一次局部修改或回滚，并保留可继续交付
- Oracle:
  1. `brainMemory.outside.learnedSkillIds` 中包含 `docx-write`。
  2. 局部修改或回滚真实落在指定目标块，不把写操作扩散到其他区域。
  3. 交付保留继续编辑或审阅所需的文档结果。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-skill-docx-delivery`

- 实现状态: `待检查`
- What: 验证 `docx-delivery` 技能闭环
- Why: 修改完成不等于可交付，校验、预览、落盘必须独立成立
- How: 先学习 `docx-delivery`，对已修改文档执行校验、预览或保存，并产出稳定交付
- Oracle:
  1. `brainMemory.outside.learnedSkillIds` 中包含 `docx-delivery`。
  2. 已修改文档会经过 `validate`、`preview` 或 `save` 中的交付步骤。
  3. 最终返回包含稳定的预览、校验结果或文件落盘引用。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-skill-kb-document-discovery`

- 实现状态: `待检查`
- What: 验证 `kb-document-discovery` 技能闭环
- Why: 很多知识任务先要找对文档，不能默认直接命中 chunk
- How: 先学习 `kb-document-discovery`，列出候选文档并收敛出目标资料
- Oracle:
  1. `brainMemory.outside.learnedSkillIds` 中包含 `kb-document-discovery`。
  2. 结果先收敛出候选文档，再定位到目标资料。
  3. 最终交付能够说明依据来自哪份文档，而不是只给裸结论。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-skill-kb-evidence-query`

- 实现状态: `待检查`
- What: 验证 `kb-evidence-query` 技能闭环
- Why: 证据查询是知识回答最基础的能力锚点
- How: 先学习 `kb-evidence-query`，再执行 chunk 检索并输出带依据的结论
- Oracle:
  1. `brainMemory.outside.learnedSkillIds` 中包含 `kb-evidence-query`。
  2. 执行链路会先取到 chunk 或证据，再形成结论。
  3. 最终答案中的关键判断都能回指到已检索到的证据。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-watchhint-projection`

- 实现状态: `待检查`
- What: 验证 `watchHint` 时间线投影
- Why: 收敛提示不只是内部状态，也必须能被可视化回看
- How: `watchHint` 能被正确投影为运行时间线项
- Oracle:
  1. `watchHint` 被回写到 `HumanState.watchHint`，不是只停留在内部推理。
  2. 时间线中出现对应的 `watch_hint` 或等价投影事件。
  3. 投影内容能关联到正确的任务或步骤，而不是悬空提示。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

#### boundary

`human-tool-failure-recovery`

- 实现状态: `待检查`
- What: 验证失败后换路
- Why: 自主纠偏能力是 `human` 的核心价值
- How: 块搜索失败后改走 `outline + get_block`，继续推进任务
- Oracle:
  1. 首次工具失败会被记录为失败路径，而不是被静默吞掉。
  2. 后续会改走替代路径继续推进，而不是重复同一失败调用。
  3. 最终交付保留恢复后的推进结果或明确说明仍剩余的阻塞。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-workspace-restricted-best-effort`

- 实现状态: `待检查`
- What: 验证工作区受限时的 best-effort 收敛
- Why: 本地优先场景里最常见的外部约束之一
- How: 缺工作区绑定时，请求补充 workspace，而不是空跑或乱答
- Oracle:
  1. 缺少 workspace 绑定时，结果以安全完成收敛，而不是伪造已执行的 workspace 动作。
  2. 交付中明确指出缺的是 workspace 还是具体材料。
  3. 在 workspace 补充前，不执行依赖 workspace 的读取或命令。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-approval-restricted-best-effort`

- 实现状态: `待检查`
- What: 验证审批受限时的 best-effort 收敛
- Why: 外部约束下的行为质量直接决定用户体验
- How: 需要执行命令或覆盖保存但未获批准时，能停在正确节点并给出继续条件
- Oracle:
  1. 需要审批的命令或覆盖保存在未获批准前不会真正执行。
  2. 结果会明确说明受限点和继续条件。
  3. 受限前已经完成的读取、分析或中间结果不会丢失。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-evidence-insufficient-safe-stop`

- 实现状态: `待检查`
- What: 验证证据不足时的安全行为
- Why: 不能把“查不到”变成“编出来”
- How: 找不到足够依据时明确说明缺口，并交付可继续的初稿或后续建议
- Oracle:
  1. 证据不足时不会编造事实或补全不存在的依据。
  2. 交付会明确说明缺口，并区分“草稿/建议”与“最终结论”。
  3. 如果已有部分可交付内容，会保留该部分而不是整体清空。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-no-redundant-recheck`

- 实现状态: `待检查`
- What: 验证证据足够后的主动收敛
- Why: 避免无意义循环是工程可用性的关键
- How: 同一证据已足够时，不再重复调用同一工具做“再次确认”
- Oracle:
  1. 在证据已足够的情况下，不重复发起同类确认性工具调用。
  2. 执行链路会在合适位置收敛到交付，而不是继续空转。
  3. 日志中不存在仅为“再确认一次”而产生的冗余循环。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-partial-delivery-on-tool-limit`

- 实现状态: `待检查`
- What: 验证做不完时的安全收敛
- Why: “没完全做完”不应等同于“什么都没有”
- How: 在工具调用上限触发 `watchHint` 时保留已有进展并给出可继续交付
- Oracle:
  1. 工具调用上限命中后会写入 `watchHint` 或等价收敛信号。
  2. 已有事实、草稿或产物会被保留下来，不因限额而清零。
  3. 最终交付会明确标记剩余未完成部分，不把部分完成写成全部完成。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-invalid-execution-batch`

- 实现状态: `待检查`
- What: 验证非法 batch 被拒绝
- Why: 保守并行是这次 human 重构的重要安全边界
- How: 混合读写或不满足并行约束的 batch plan 会被 executor 拒绝并回到收敛
- Oracle:
  1. 非法 batch 会在执行前被拒绝，不真正落到工具层执行。
  2. 系统会回写 `watchHint` 并返回 `brain` 重新决策。
  3. 混合读写或违反并行约束的批次不会被误当成合法成功。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-repeated-skill-learning-redirect`

- 实现状态: `待检查`
- What: 验证重复学习的回退
- Why: 需要防止学习路径空转
- How: `brain` 请求已学习过的 skill 时，`learning` 不重复执行，而是写入 `watchHint` 并回到 `brain`
- Oracle:
  1. 重复学习请求不会再次执行学习流程。
  2. 系统会回写 `watchHint`，并把运行阶段切回 `brain`。
  3. `learnedSkillIds` 不会因为重复学习而出现重复污染。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-invalid-memory-op-recovery`

- 实现状态: `待检查`
- What: 验证非法记忆编辑的回退
- Why: 记忆编辑必须是安全、可恢复的
- How: 非法 `memoryOps` 不直接破坏 state，而是转成 `watchHint` 交回 `brain` 重决策
- Oracle:
  1. 非法 `memoryOps` 不会直接破坏已有 state。
  2. 系统会回写 `watchHint` 并要求 `brain` 重决策。
  3. 合法的记忆变更与非法变更不会被混成同一次成功提交。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

#### scenario

`human-terminal-docx-handoff`

- 实现状态: `待检查`
- What: 验证跨工具协作
- Why: 真实任务常常需要先取材再落文档
- How: 先在工作区找材料，再写入 docx 并形成可审阅交付
- Oracle:
  1. 先完成 workspace 材料读取，再进入 docx 写入或交付。
  2. 文档内容能体现从 workspace 提取出的事实，而不是脱离材料瞎写。
  3. 最终交付中同时保留材料来源线索和文档产物引用。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-kb-docx-bridge`

- 实现状态: `待检查`
- What: 验证知识到文档的转换
- Why: 能不能把“查到的信息”变成“可交付产物”很关键
- How: 先检索本地规范，再据此修改模板文档
- Oracle:
  1. 先完成 KB 证据获取，再基于证据修改模板文档。
  2. 文档改写内容与检索到的规范一致，不出现“查到 A，写成 B”。
  3. 最终交付同时包含文档结果和可回看的知识依据。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-multi-source-merge-delivery`

- 实现状态: `待检查`
- What: 验证多源材料归并
- Why: 多源归并是高价值真实场景的代表能力
- How: 汇总多份日报、纪要或风险清单后输出统一交付
- Oracle:
  1. 多份日报、纪要或清单都会进入归并，而不是只使用其中一份。
  2. 归并后的交付按统一结构输出，不把多源材料原样拼接。
  3. 重复事实被去重，来源关系仍可回看。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-review-handoff-structured-delivery`

- 实现状态: `待检查`
- What: 验证审阅前结构化交付
- Why: 文档类任务的真正落点不是一句话，而是可继续处理的结构化结果
- How: 文档修改完成后，输出稳定的 review handoff 交付，供后续进入 `draft_review_ready`
- Oracle:
  1. 交付 `deliveryMarkdown` 采用稳定的 review handoff 结构，而不是一句自然语言。
  2. 交付中保留可进入审阅阶段所需的文档结果或 review 引用。
  3. 下游可以基于该交付进入 `draft_review_ready`，而不是重新猜测修改内容。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-multi-turn-refinement`

- 实现状态: `待检查`
- What: 验证多轮目标保持
- Why: 用户真实使用里 follow-up 很常见
- How: 上一轮已有中间产物，本轮继续保守化或局部精修
- Oracle:
  1. 本轮会复用上一轮已有产物或上下文，而不是从头重做。
  2. 本轮修改只收敛到用户追加的精修目标，不覆盖上一轮已完成部分。
  3. 最终交付对应的是更新后的同一任务链路，而不是新的无关结果。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-long-task-project-brief`

- 实现状态: `待检查`
- What: 验证长任务工程能力
- Why: 复杂任务是否能真正完成，是 AI 价值上限所在
- How: 在较高执行上限下，串联完成“找材料、抽结论、写周报、补风险、生成审阅结果”
- Oracle:
  1. 执行链路覆盖取材、提炼、写作和审阅交付等关键阶段，而不是只完成其中一步。
  2. 最终交付至少包含 brief 主体和风险/未决项，不是碎片化中间结果。
  3. 若未能完全做完，也必须以部分完成方式安全收敛并保留已有产物。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-long-task-with-corrections`

- 实现状态: `待检查`
- What: 验证长任务中的纠偏稳定性
- Why: 长任务不是一次规划后就不会变化
- How: 长任务中途加入新约束或局部失败后，仍能保持目标不漂移
- Oracle:
  1. 中途新增约束或纠偏后，后续步骤会按新约束继续，而不是坚持旧方向。
  2. 先前已经确认错误的分支不会被继续扩写到最终结果里。
  3. 最终交付仍围绕原主目标收敛，不因中途修正而跑题。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-long-task-approval-branch`

- 实现状态: `待检查`
- What: 验证长任务中的审批分支
- Why: 真正的复杂任务经常包含安全分支
- How: 长任务中途需要审批时，能在批准与拒绝两条分支上都安全推进或收敛
- Oracle:
  1. 长任务遇到审批点时会暂停在正确分支，而不是越过审批继续执行。
  2. 批准后可以从阻塞点继续推进，不需要整条任务重跑。
  3. 拒绝后会安全收敛并保留已完成部分，而不是伪造后续结果。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

#### live

`human-live-direct-kb-answer`

- 实现状态: `待检查`
- What: 验证 live 单步知识问答
- Why: `human` 的最小 live 自主闭环必须成立
- How: 在真实模型下直接读取知识库并交付答案
- Oracle:
  1. 最终 `human` 结果为 `completed`，不是无故阻塞。
  2. 交付为面向用户的答案，并包含可回看的依据或引用。
  3. 执行链路只使用完成该问答所需的最小工具，不无意义扩张。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-live-direct-docx-edit`

- 实现状态: `待检查`
- What: 验证 live 单工具文档闭环
- Why: 文档类 live 基线不能只靠脚本化决策
- How: 在真实模型下完成 docx 改写与 preview 交付
- Oracle:
  1. 最终 `human` 结果为 `completed`，且完成了指定文档的局部修改。
  2. 交付中包含可审阅的文档结果或稳定产物引用。
  3. 修改范围收敛在指定目标位置，不误改无关段落。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-live-skill-workspace-cli`

- 实现状态: `待检查`
- What: 验证 live `workspace-cli` 技能闭环
- Why: `workspace-cli` 是本地优先路径的基础入口，必须在真实模型下成立
- How: 在真实模型下先学习 `workspace-cli`，再读取 workspace 文件或执行单条安全命令，并基于结果完成一次交付
- Oracle:
  1. `brainMemory.outside.learnedSkillIds` 中包含 `workspace-cli`。
  2. 读取文件或安全命令执行发生在学习该 skill 之后，而不是之前。
  3. 最终交付直接基于 workspace 结果，而不是脱离工作区臆测。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-live-skill-docx-read`

- 实现状态: `待检查`
- What: 验证 live `docx-read` 技能闭环
- Why: 文档定位能力是否可靠，最终要靠真实模型证明
- How: 在真实模型下先学习 `docx-read`，再打开文档、定位结构或块内容，并完成一次基于文档内容的回答
- Oracle:
  1. `brainMemory.outside.learnedSkillIds` 中包含 `docx-read`。
  2. 执行链路完成文档打开、结构定位或块读取，而不是直接给结论。
  3. 最终回答能回指文档中的具体内容，不触发写入。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-live-skill-docx-write`

- 实现状态: `待检查`
- What: 验证 live `docx-write` 技能闭环
- Why: 文档编辑能力不能只在 override 场景里成立
- How: 在真实模型下先学习 `docx-write`，在已知目标位置上完成一次局部修改或回滚，并保留可继续交付
- Oracle:
  1. `brainMemory.outside.learnedSkillIds` 中包含 `docx-write`。
  2. 局部修改或回滚真实落在指定目标块，不把写操作扩散到其他区域。
  3. 交付保留继续编辑或审阅所需的文档结果。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-live-skill-docx-delivery`

- 实现状态: `待检查`
- What: 验证 live `docx-delivery` 技能闭环
- Why: 文档任务最后的校验、预览、落盘在真实模型下也必须稳定
- How: 在真实模型下先学习 `docx-delivery`，对已修改文档执行校验、预览或保存，并产出稳定交付
- Oracle:
  1. `brainMemory.outside.learnedSkillIds` 中包含 `docx-delivery`。
  2. 已修改文档会经过 `validate`、`preview` 或 `save` 中的交付步骤。
  3. 最终返回包含稳定的预览、校验结果或文件落盘引用。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-live-skill-kb-document-discovery`

- 实现状态: `待检查`
- What: 验证 live `kb-document-discovery` 技能闭环
- Why: 文档发现是知识任务的重要入口，不能只在静态 case 中验证
- How: 在真实模型下先学习 `kb-document-discovery`，列出候选文档并收敛出目标资料
- Oracle:
  1. `brainMemory.outside.learnedSkillIds` 中包含 `kb-document-discovery`。
  2. 结果先收敛出候选文档，再定位到目标资料。
  3. 最终交付能够说明依据来自哪份文档，而不是只给裸结论。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-live-skill-kb-evidence-query`

- 实现状态: `待检查`
- What: 验证 live `kb-evidence-query` 技能闭环
- Why: 证据查询是 live 知识回答的最小能力锚点
- How: 在真实模型下先学习 `kb-evidence-query`，再执行 chunk 检索并输出带依据的结论
- Oracle:
  1. `brainMemory.outside.learnedSkillIds` 中包含 `kb-evidence-query`。
  2. 执行链路会先取到 chunk 或证据，再形成结论。
  3. 最终答案中的关键判断都能回指到已检索到的证据。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-live-terminal-docx-handoff`

- 实现状态: `待检查`
- What: 验证 live 跨工具 handoff
- Why: 这是最小 live 跨工具能力证明
- How: 在真实模型下先读 workspace，再写入 docx
- Oracle:
  1. 先完成 workspace 材料读取，再进入 docx 写入或交付。
  2. 文档内容能体现从 workspace 提取出的事实，而不是脱离材料瞎写。
  3. 最终交付中同时保留材料来源线索和文档产物引用。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-live-kb-docx-bridge`

- 实现状态: `待检查`
- What: 验证 live 知识到文档转换
- Why: 需要证明 KB 结果能被真实转成产物
- How: 在真实模型下先查规范，再改模板文档
- Oracle:
  1. 先完成 KB 证据获取，再基于证据修改模板文档。
  2. 文档改写内容与检索到的规范一致，不出现“查到 A，写成 B”。
  3. 最终交付同时包含文档结果和可回看的知识依据。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-live-evidence-insufficient-safe-stop`

- 实现状态: `待检查`
- What: 验证 live 安全收敛
- Why: 安全行为不能只在 contract case 中成立
- How: 在真实模型下证据不足时不编造答案
- Oracle:
  1. 证据不足时不会编造事实或补全不存在的依据。
  2. 交付会明确说明缺口，并区分“草稿/建议”与“最终结论”。
  3. 如果已有部分可交付内容，会保留该部分而不是整体清空。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-live-long-task-project-brief`

- 实现状态: `待检查`
- What: 验证 live 长任务工程能力
- Why: 长任务是否成立，只看 live 才有意义
- How: 在真实模型下完成多材料归并到 brief 交付
- Oracle:
  1. 执行链路覆盖取材、提炼、写作和审阅交付等关键阶段，而不是只完成其中一步。
  2. 最终交付至少包含 brief 主体和风险/未决项，不是碎片化中间结果。
  3. 若未能完全做完，也必须以部分完成方式安全收敛并保留已有产物。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

### 3.3 `context`

做什么：验证系统是否能主动收集和整理后续执行所需的关键上下文。

为什么：上下文质量直接决定 `intent` 判断是否稳定、`plan` 是否靠谱、`human` 能否在 follow-up 场景里接住任务。

怎么做：围绕续做、证据收集、缺失材料识别、多源信息整理和部分完成续接来设计 case。
落地规则：实现时仍按 `basic / boundary / scenario / live` 分组；凡是依赖真实模型理解上下文的路径，都要补对应 `live` case。

#### basic

`context-workspace-evidence-collection`

- 实现状态: `待检查`
- What: 验证工作区证据收集
- Why: 很多任务不是缺能力，而是缺前置材料
- How: 在规划前先读取工作区材料，沉淀后续执行需要的事实
- Oracle:
  1. 收集结果会沉淀为可复用的 `contextEvidence`，而不是只停留在一次性回答中。
  2. `contextEvidence` 中保留 workspace 事实摘要，不写入 routing 理由。
  3. 用于收集的交付形态保持为上下文说明，而不是直接冒充最终用户答案。
- Not: 不验证最终用户答案质量或最终交付文案。

`context-kb-evidence-collection`

- 实现状态: `待检查`
- What: 验证知识证据收集
- Why: 先有证据，再做判断，能明显降低误判
- How: 在回答或规划前先把相关 KB 证据聚合出来
- Oracle:
  1. KB 证据会被提炼成可复用的 `contextEvidence` 条目。
  2. 证据内容保留来源线索，后续节点可直接复用。
  3. 上下文收集阶段不会把证据收集错误地当成最终交付完成。
- Not: 不验证最终用户答案质量或最终交付文案。

`context-evidence-dedupe-and-append`

- 实现状态: `待检查`
- What: 验证上下文证据去重与追加
- Why: 多轮续做不能把同一 evidence 无限制堆积，否则后续判断会被噪音污染
- How: 连续两轮收集部分重复的 workspace 或 KB 证据，保留新增证据并避免重复沉淀
- Oracle:
  1. 重复 evidence 不会在 `contextEvidence` 中无限追加。
  2. 新增 evidence 会被正常追加，而不是被整轮覆盖掉。
  3. 最终 evidence 集合既保留旧有效证据，也包含本轮新增内容。
- Not: 不验证最终用户答案质量或最终交付文案。

#### boundary

`context-missing-material-detection`

- 实现状态: `待检查`
- What: 验证缺失输入识别
- Why: 缺上下文时如果继续执行，后面一定漂移
- How: 识别关键文件、工作区或资料不存在，并明确说明缺什么
- Oracle:
  1. 缺失的关键文件、工作区或资料会被明确点名，而不是泛泛说“信息不足”。
  2. 在缺材料场景下不会伪造新的 `contextEvidence`。
  3. 收集链路会停在安全收敛，而不是继续进入错误执行。
- Not: 不验证最终用户答案质量或最终交付文案。

`context-round-limit-to-plan`

- 实现状态: `待检查`
- What: 验证补上下文轮次上限
- Why: `need_context` 不能无限循环，否则任务永远进不到执行
- How: 连续多轮都只补到部分上下文时，产出足以供后续进入 `plan` 的信息并停止继续追问
- Oracle:
  1. 达到补上下文轮次上限后，不再继续无限追问。
  2. 已有上下文会被整理成足以进入下一步判断或计划的摘要。
  3. 流程会回到后续路由或计划阶段，而不是卡死在 `need_context`。
- Not: 不验证最终用户答案质量或最终交付文案。

#### scenario

`context-follow-up-reference-resolution`

- 实现状态: `待检查`
- What: 验证续做指代解析
- Why: follow-up 场景首先卡在能不能知道用户在说什么
- How: 正确接住“继续刚才第二段”“把上一版风险部分改保守一点”这类输入
- Oracle:
  1. 续做指代会解析到正确的上一轮段落、产物或修改目标。
  2. 解析出的目标会进入新的上下文说明或 `contextEvidence`，供后续使用。
  3. 不会把 follow-up 错解成一个全新、无关联的任务。
- Not: 不验证最终用户答案质量或最终交付文案。

`context-multi-source-evidence-assembly`

- 实现状态: `待检查`
- What: 验证多源上下文组装
- Why: 混合任务的关键不是单一证据，而是证据组装能力
- How: 同时从知识库和工作区收集关键信息，为后续计划提供输入
- Oracle:
  1. KB 与 workspace 两类证据都会进入最终的上下文包。
  2. 多源证据之间会做去重和结构化整理，而不是杂乱拼接。
  3. 后续计划或执行可以直接复用这些证据，而无需重新查一遍。
- Not: 不验证最终用户答案质量或最终交付文案。

`context-continue-after-partial-delivery`

- 实现状态: `待检查`
- What: 验证部分完成后的续接
- Why: 真实任务往往不是一轮就结束
- How: 上一轮只完成一部分时，本轮能基于已有产物继续推进
- Oracle:
  1. 上一轮已有中间产物会被识别并纳入本轮上下文。
  2. 本轮上下文重点指向“剩余未完成部分”，而不是重述已完成内容。
  3. 最终收集结果支持续做，而不是迫使任务重新开题。
- Not: 不验证最终用户答案质量或最终交付文案。

#### live

`context-live-follow-up-reference-resolution`

- 实现状态: `待检查`
- What: 验证 live 续做指代解析
- Why: 续做理解是否成立，不能只靠脚本化上下文
- How: 在真实模型下正确接住“继续上一版第二段”这类 follow-up 输入
- Oracle:
  1. 续做指代会解析到正确的上一轮段落、产物或修改目标。
  2. 解析出的目标会进入新的上下文说明或 `contextEvidence`，供后续使用。
  3. 不会把 follow-up 错解成一个全新、无关联的任务。
- Not: 不验证最终用户答案质量或最终交付文案。

`context-live-workspace-evidence-collection`

- 实现状态: `待检查`
- What: 验证 live 工作区证据收集
- Why: 工作区上下文是本地优先路径的关键前提
- How: 在真实模型下先从 workspace 收集事实，再交给后续链路使用
- Oracle:
  1. 收集结果会沉淀为可复用的 `contextEvidence`，而不是只停留在一次性回答中。
  2. `contextEvidence` 中保留 workspace 事实摘要，不写入 routing 理由。
  3. 用于收集的交付形态保持为上下文说明，而不是直接冒充最终用户答案。
- Not: 不验证最终用户答案质量或最终交付文案。

`context-live-multi-source-evidence-assembly`

- 实现状态: `待检查`
- What: 验证 live 多源上下文组装
- Why: 混合任务最容易暴露上下文收集质量问题
- How: 在真实模型下同时组装 KB 与 workspace 证据
- Oracle:
  1. KB 与 workspace 两类证据都会进入最终的上下文包。
  2. 多源证据之间会做去重和结构化整理，而不是杂乱拼接。
  3. 后续计划或执行可以直接复用这些证据，而无需重新查一遍。
- Not: 不验证最终用户答案质量或最终交付文案。

`context-live-continue-after-partial-delivery`

- 实现状态: `待检查`
- What: 验证 live 部分完成续接
- Why: 上下文续接是否稳定，最终要靠 live 证明
- How: 在真实模型下基于上一轮中间产物继续推进，而不是重新开始
- Oracle:
  1. 上一轮已有中间产物会被识别并纳入本轮上下文。
  2. 本轮上下文重点指向“剩余未完成部分”，而不是重述已完成内容。
  3. 最终收集结果支持续做，而不是迫使任务重新开题。
- Not: 不验证最终用户答案质量或最终交付文案。

### 3.4 `intent`

做什么：验证系统是否能在 `need_context`、`direct_human`、`to_plan` 等路径之间做出正确路由。

为什么：路由错了，后面即使工具和 `human` 都能工作，也会在入口就走偏。

怎么做：用简单任务、复杂任务、上下文不足任务、纯搜索任务和混合任务来压路由判断。
落地规则：实现时按 `basic / boundary / scenario / live` 分组；路由判断如果依赖真实模型判别，最终仍需 `live` 证据。

#### basic

`intent-direct-human-routing`

- 实现状态: `待检查`
- What: 验证简单任务不过度规划
- Why: 简单任务被过度规划会显著拖慢体验
- How: 对简单知识问答或单步改写任务，直接进入 `direct_human`
- Oracle:
  1. `decision.mode` 为 `direct_human`，下一跳进入 `director_direct_human_exec`。
  2. 本轮不创建 `plan`，也不进入 `director_context_human`。
  3. 仅派发 1 个 direct human 任务，不把简单任务升级成多任务链路。
- Not: 不验证后续执行链路的最终完成质量。

`intent-docx-task-routing`

- 实现状态: `待检查`
- What: 验证多步文档编辑任务路由
- Why: 多步文档任务天然带依赖顺序，不能当普通问答处理
- How: 对明确要求多步读取、修改、保存或进入审阅的文档任务，进入多步链路
- Oracle:
  1. `decision.mode` 为 `to_plan`，下一跳进入 `director_plan`。
  2. 多步文档任务不会被错误压缩成 `direct_human`。
  3. 本轮路由结果保留文档编辑链路所需的多步特征。
- Not: 不验证后续执行链路的最终完成质量。

#### boundary

`intent-need-context-routing`

- 实现状态: `待检查`
- What: 验证上下文不足先补上下文
- Why: follow-up 最怕直接误执行
- How: 对“继续刚才那个”“改第二段”这类输入，先进入 `need_context`
- Oracle:
  1. `decision.mode` 为 `need_context`，下一跳进入 `director_context_human`。
  2. 在上下文不足时不会直接进入 `direct_human` 或 `director_plan`。
  3. 缺失的是指代或上下文信息，而不是被误判成复杂执行任务。
- Not: 不验证后续执行链路的最终完成质量。

`intent-search-mode-routing`

- 实现状态: `待检查`
- What: 验证纯搜索模式路由
- Why: 模式错路由会让 UI 与实际行为脱节
- How: 在 `纯搜索` 模式下优先走检索与展示，不误入完整任务执行链
- Oracle:
  1. 纯搜索输入不会被路由到多步执行链路。
  2. 最终意图保持在检索与展示范围内，而不是生成文档或执行命令。
  3. 路由结果不会因为有搜索词就误升级成 `to_plan`。
- Not: 不验证后续执行链路的最终完成质量。

#### scenario

`intent-to-plan-routing`

- 实现状态: `待检查`
- What: 验证复杂任务进入计划链路
- Why: 复杂任务如果误判成单步，通常做不完
- How: 对多步文档生成或多工具任务，正确进入 `to_plan`
- Oracle:
  1. `decision.mode` 为 `to_plan`，下一跳进入 `director_plan`。
  2. 复杂多步任务不会停留在 `direct_human`。
  3. 后续可生成多任务拆解，而不是只派发一个 direct task。
- Not: 不验证后续执行链路的最终完成质量。

`intent-after-context-routing`

- 实现状态: `待检查`
- What: 验证补完上下文后的重新路由
- Why: `need_context` 只是中间态，补完信息后必须重新做正确判断
- How: 在收集到足够 `contextEvidence` 后，对同一任务重新判断并进入 `direct_human` 或 `to_plan` 的正确路径
- Oracle:
  1. 补完 `contextEvidence` 后，不再重复进入 `need_context`。
  2. 同一任务会基于补齐后的上下文重新稳定路由到 `direct_human` 或 `to_plan`。
  3. 补上下文阶段新增的信息会实际影响这次路由结果。
- Not: 不验证后续执行链路的最终完成质量。

`intent-mixed-task-routing`

- 实现状态: `待检查`
- What: 验证混合任务路由
- Why: 混合任务是最容易被低估复杂度的一类
- How: 对“先查 KB，再看工作区，再改文档”这类输入，稳定进入 `to_plan`
- Oracle:
  1. “查 KB + 读 workspace + 改文档”这类混合任务会路由到 `to_plan`。
  2. 路由不会把混合链路误判成单步问答。
  3. 后续路径能够承接多工具依赖，而不是只有一个 direct task。
- Not: 不验证后续执行链路的最终完成质量。

#### live

`intent-live-direct-human-routing`

- 实现状态: `待检查`
- What: 验证 live 简单任务直达
- Why: 入口提速能力不能只靠静态规则判断
- How: 在真实模型下，简单任务仍直接进入 `direct_human`
- Oracle:
  1. `decision.mode` 为 `direct_human`，下一跳进入 `director_direct_human_exec`。
  2. 本轮不创建 `plan`，也不进入 `director_context_human`。
  3. 仅派发 1 个 direct human 任务，不把简单任务升级成多任务链路。
- Not: 不验证后续执行链路的最终完成质量。

`intent-live-need-context-routing`

- 实现状态: `待检查`
- What: 验证 live 上下文缺失路由
- Why: 续做场景的误路由风险最高
- How: 在真实模型下，follow-up 输入稳定进入 `need_context`
- Oracle:
  1. `decision.mode` 为 `need_context`，下一跳进入 `director_context_human`。
  2. 在上下文不足时不会直接进入 `direct_human` 或 `director_plan`。
  3. 缺失的是指代或上下文信息，而不是被误判成复杂执行任务。
- Not: 不验证后续执行链路的最终完成质量。

`intent-live-to-plan-routing`

- 实现状态: `待检查`
- What: 验证 live 复杂任务入计划链路
- Why: 复杂任务是否被正确识别，决定整条链路能否完成
- How: 在真实模型下，多步任务稳定进入 `to_plan`
- Oracle:
  1. `decision.mode` 为 `to_plan`，下一跳进入 `director_plan`。
  2. 复杂多步任务不会停留在 `direct_human`。
  3. 后续可生成多任务拆解，而不是只派发一个 direct task。
- Not: 不验证后续执行链路的最终完成质量。

`intent-live-search-mode-routing`

- 实现状态: `待检查`
- What: 验证 live 纯搜索模式路由
- Why: 模式理解是页面行为一致性的关键
- How: 在真实模型下，`纯搜索` 不误入完整任务执行链
- Oracle:
  1. 纯搜索输入不会被路由到多步执行链路。
  2. 最终意图保持在检索与展示范围内，而不是生成文档或执行命令。
  3. 路由结果不会因为有搜索词就误升级成 `to_plan`。
- Not: 不验证后续执行链路的最终完成质量。

`intent-live-mixed-task-routing`

- 实现状态: `待检查`
- What: 验证 live 混合任务路由
- Why: 混合任务最容易暴露复杂度判断失真
- How: 在真实模型下，混合任务稳定进入 `to_plan`
- Oracle:
  1. “查 KB + 读 workspace + 改文档”这类混合任务会路由到 `to_plan`。
  2. 路由不会把混合链路误判成单步问答。
  3. 后续路径能够承接多工具依赖，而不是只有一个 direct task。
- Not: 不验证后续执行链路的最终完成质量。

### 3.5 `plan`

做什么：验证生成的计划是否可执行、顺序合理、能真正解决复杂用户需求。

为什么：`plan` 不是展示思路，而是给后续执行用的任务骨架；拆错一步，后面会整条链路失真。

怎么做：围绕任务拆解、依赖顺序、阻塞收敛、续做重规划和长任务依赖链来设计 case。
落地规则：实现时按 `basic / boundary / scenario / live` 分组；计划质量的最终结论应基于真实模型下的 `live` case。

#### basic

`plan-docx-workflow-ordering`

- 实现状态: `待检查`
- What: 验证文档类计划顺序
- Why: 这是最基础也最容易写错顺序的一类计划
- How: 文档任务必须先取证、后编辑、再保存或进入审阅
- Oracle:
  1. 计划顺序满足“取证/读取 -> 编辑 -> 保存或进入审阅”。
  2. 不会在读取前先保存，也不会在编辑前直接进入审阅。
  3. 每个任务的依赖关系能解释为什么必须按这个顺序执行。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

`plan-kb-to-docx-task-breakdown`

- 实现状态: `待检查`
- What: 验证检索到文档的任务拆解
- Why: 混合链路的关键在于拆解是否完整
- How: 先查规范、再确认改写目标、最后落到文档修改
- Oracle:
  1. 计划中同时包含 KB 取证、改写目标确认和 docx 修改三个关键任务。
  2. 文档修改任务依赖前面的规范证据，而不是平行脱节。
  3. 拆解结果足以让后续 `human` 逐任务闭环执行。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

`plan-terminal-to-docx-task-breakdown`

- 实现状态: `待检查`
- What: 验证工作区到文档的任务拆解
- Why: 很多真实任务都是这类链路
- How: 先找文件、再读材料、再提炼内容、最后生成文档
- Oracle:
  1. 计划顺序覆盖找文件、读材料、提炼内容和生成文档四个关键步骤。
  2. 文档生成任务依赖前面的材料读取结果，而不是直接空写。
  3. 每个 task 的 `userInput` 能单独交给一个 `human` 执行。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

`plan-single-human-executable-task`

- 实现状态: `待检查`
- What: 验证每个计划任务都可被单个 `human` 执行
- Why: 如果 task 本身还需要再次拆解，计划就没有落到可执行粒度
- How: 检查每个 task 是否都有清晰目标、输入和可闭环的单任务边界
- Oracle:
  1. 每个任务都收敛成单一可执行目标，不把多个独立目标硬塞进一个 task。
  2. 每个任务都具备明确输入、输出和依赖，不依赖隐式上下文猜测。
  3. 不存在必须由多个 `human` 同时协作才能完成的单个 task。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

#### boundary

`plan-limited-task-convergence`

- 实现状态: `待检查`
- What: 验证结果受限时计划可收敛
- Why: 复杂任务不一定每次都能完整完成，但必须能收住
- How: 出现审批、缺文件或资料不足时，仍能产出明确后续
- Oracle:
  1. 任务结果受限时，对应 `DirectorPlanTask.status` 仍保持 `completed`。
  2. 受限结果不会让已完成 task 的 `deliveryMarkdown` 或 `artifacts` 丢失。
  3. 计划链路最终会进入 synthesis，且交付中保留限制说明。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

`plan-continue-after-limited-task`

- 实现状态: `待检查`
- What: 验证受限结果后继续派发任务
- Why: best-effort 模型下，不应把“结果有限”误当成终止信号
- How: 某个 task 只能完成部分交付时，仍继续派发后续业务 task，并在最终汇总中统一说明限制
- Oracle:
  1. 首个业务 task 产出受限结果后，后续业务 task 仍继续派发。
  2. 后续流程最终进入 `director_synthesis_human` 完成汇总。
  3. 受限 task 保持 `completed` 状态，不新增额外状态字段。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

`plan-no-redundant-task`

- 实现状态: `待检查`
- What: 验证无意义重复任务控制
- Why: 冗余计划会放大模型成本和失败概率
- How: 不生成重复取证、重复确认、重复总结的任务
- Oracle:
  1. 计划中不存在语义重复的取证、确认或总结任务。
  2. 任务数保持在完成目标所需的最小集，而不是把同一步骤换说法重复列出。
  3. 重复任务不会仅因模型犹豫而被加入计划。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

`plan-partial-delivery-convergence`

- 实现状态: `待检查`
- What: 验证部分完成时的计划收尾
- Why: 复杂任务需要可继续的收尾，而不是硬失败
- How: 在预算不足或局部阻塞时，计划仍能保留已有成果并给出下一步
- Oracle:
  1. 预算不足或局部阻塞时，已完成任务的 handoff 会被保留。
  2. 未完成任务不会被误标记为 `completed`。
  3. 最终收尾会明确说明当前完成部分和建议下一步。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

#### scenario

`plan-follow-up-refinement-breakdown`

- 实现状态: `待检查`
- What: 验证续做任务重规划
- Why: follow-up 如果不能重用上下文，体验会很差
- How: 已有中间产物时，计划能围绕“继续完善”而不是重新做一遍
- Oracle:
  1. 已有中间产物会作为 refinement 输入复用，而不是重新从零规划。
  2. 任务拆解围绕“局部继续完善”展开，不重开整个主流程。
  3. 计划中会明确哪些部分沿用旧产物，哪些部分需要新增修改。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

`plan-long-task-dependency-chain`

- 实现状态: `待检查`
- What: 验证长任务依赖链
- Why: 长任务稳定性首先取决于依赖顺序是否合理
- How: 长任务下每个 task 都有清晰 `userInput` 和依赖关系
- Oracle:
  1. 长任务中的每个 task 都有清晰依赖，不出现无依赖漂浮任务。
  2. 依赖链整体保持有序、可执行，不出现明显逆序或循环。
  3. 最终会收敛到汇总或交付任务，而不是停在中间步骤。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

#### live

`plan-live-docx-workflow-ordering`

- 实现状态: `待检查`
- What: 验证 live 文档类计划顺序
- Why: 计划顺序错误会直接污染后续执行
- How: 在真实模型下，文档任务仍保持先取证后编辑再审阅的顺序
- Oracle:
  1. 计划顺序满足“取证/读取 -> 编辑 -> 保存或进入审阅”。
  2. 不会在读取前先保存，也不会在编辑前直接进入审阅。
  3. 每个任务的依赖关系能解释为什么必须按这个顺序执行。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

`plan-live-kb-to-docx-task-breakdown`

- 实现状态: `待检查`
- What: 验证 live 检索到文档拆解
- Why: 混合任务最考验计划粒度
- How: 在真实模型下，混合链路拆解仍完整可执行
- Oracle:
  1. 计划中同时包含 KB 取证、改写目标确认和 docx 修改三个关键任务。
  2. 文档修改任务依赖前面的规范证据，而不是平行脱节。
  3. 拆解结果足以让后续 `human` 逐任务闭环执行。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

`plan-live-follow-up-refinement-breakdown`

- 实现状态: `待检查`
- What: 验证 live 续做重规划
- Why: follow-up 计划最容易被重新开题取代
- How: 在真实模型下，已有产物时计划仍围绕 refinement 展开
- Oracle:
  1. 已有中间产物会作为 refinement 输入复用，而不是重新从零规划。
  2. 任务拆解围绕“局部继续完善”展开，不重开整个主流程。
  3. 计划中会明确哪些部分沿用旧产物，哪些部分需要新增修改。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

`plan-live-long-task-dependency-chain`

- 实现状态: `待检查`
- What: 验证 live 长任务依赖链
- Why: 长任务计划是否靠谱，只看 live 才有意义
- How: 在真实模型下，长任务仍保持清晰依赖顺序
- Oracle:
  1. 长任务中的每个 task 都有清晰依赖，不出现无依赖漂浮任务。
  2. 依赖链整体保持有序、可执行，不出现明显逆序或循环。
  3. 最终会收敛到汇总或交付任务，而不是停在中间步骤。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

`plan-live-limited-task-convergence`

- 实现状态: `待检查`
- What: 验证 live 受限结果计划收敛
- Why: 计划层的安全收尾不能只在静态 case 成立
- How: 在真实模型下，结果受限后仍能产出明确下一步
- Oracle:
  1. 任务结果受限后，对应 `DirectorPlanTask.status` 仍保持 `completed`。
  2. 受限结果不会让已完成 task 的 `deliveryMarkdown` 或 `artifacts` 丢失。
  3. 计划链路会继续执行并进入 synthesis，而不是提前终止。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

### 3.6 `entire`

做什么：在不依赖真实 UI 的前提下，验证从用户输入到最终交付的 backend 完整闭环。

为什么：这一层用于确认 `director + human + tools` 在 backend harness 下已经能把真实任务做完，而不是只验证零散节点。

怎么做：围绕真实用户任务做端到端 backend case，并用完成度判断任务是否真正达成。完成度建议采用 `0-3`：`0` 失败或阻塞、`1` 部分完成、`2` 主目标完成但仍需人工修补、`3` 完整完成。
落地规则：实现时按 `basic / boundary / scenario / live` 分组；`entire` 的 `basic` 至少覆盖 `docx / kb / workspace` 三类最小闭环，`scenario` 再覆盖混合链路与长任务；`entire` 的主结论默认以 `live` 为准。

#### basic

`entire-docx-rewrite-review-ready`

- 实现状态: `待检查`
- What: 验证现有 docx 改写闭环
- Why: 这是文档类任务的核心主路径
- How: 读取、修改文档并进入可审阅结果
- Oracle:
  1. backend 完整链路最终产出可审阅的 docx 结果或审阅引用。
  2. 修改内容与用户改写诉求一致，而不是只完成读取。
  3. 最终结果不是无故阻塞，且交付可被后续审阅消费。
- Not: 不验证页面级布局与交互细节。

`entire-docx-content-answer`

- 实现状态: `待检查`
- What: 验证文档内容问答闭环
- Why: 文档类任务不只有改写，定位和解释内容也是基础路径
- How: 读取现有 docx，定位指定标题或段落，并给出可回看的回答
- Oracle:
  1. 最终回答准确定位到指定标题、段落或块内容。
  2. 回答中保留可回看的文档定位依据，而不是泛泛复述。
  3. 整个链路不产生无关写操作。
- Not: 不验证页面级布局与交互细节。

`entire-kb-answer-with-citation`

- 实现状态: `待检查`
- What: 验证知识库问答闭环
- Why: 用户问答不能只给结论，不给证据
- How: 回答本地知识问题，并给出可回看依据
- Oracle:
  1. 最终答案包含明确结论和至少一条可回看的依据。
  2. 依据来自本地知识库，而不是外部或伪造来源。
  3. 结论与引用内容一致，不出现“引用 A，结论写成 B”。
- Not: 不验证页面级布局与交互细节。

`entire-kb-document-discovery-with-citation`

- 实现状态: `待检查`
- What: 验证先发现文档再回答的知识闭环
- Why: 不是所有知识问题都能直接命中 chunk，先找文档是核心路径之一
- How: 先列出候选知识文档，再收敛证据并给出带依据的回答
- Oracle:
  1. 链路先完成候选文档发现，再收敛到具体证据。
  2. 最终答案引用的是收窄后的目标文档，而不是跨文档拼接。
  3. 整个 backend 流程能闭环交付，不停留在“找到几篇文档”这一步。
- Not: 不验证页面级布局与交互细节。

`entire-workspace-material-summary-delivery`

- 实现状态: `待检查`
- What: 验证工作区材料直达交付闭环
- Why: 很多真实任务不需要写 docx，但必须能把本地材料直接变成交付
- How: 读取 workspace 中的笔记、日报或清单，并生成结构化摘要或汇报
- Oracle:
  1. workspace 材料被真实读取并进入最终摘要或汇报。
  2. 交付结果具备稳定结构，可直接消费，而不是原始片段拼接。
  3. 输出中的关键点可回指到 workspace 材料。
- Not: 不验证页面级布局与交互细节。

#### boundary

`entire-evidence-insufficient-safe-stop`

- 实现状态: `待检查`
- What: 验证证据不足时的完整收敛
- Why: 安全收敛本身也是完整结果的一部分
- How: 依据不足时给出明确缺口和可继续交付
- Oracle:
  1. 证据不足时，完整链路仍给出明确缺口和可继续方式。
  2. 不会在 backend 末端伪造“已完成”的最终答案。
  3. 如果已有部分成果，会以部分交付形式保留。
- Not: 不验证页面级布局与交互细节。

`entire-terminal-approval-to-docx-update`

- 实现状态: `待检查`
- What: 验证审批分支下的文档闭环
- Why: 审批分支必须和业务目标最终接上
- How: 先通过审批执行命令拿到产物，再写回现有周报模板
- Oracle:
  1. 审批通过后才执行命令并取得中间产物。
  2. 取得的产物会被继续写回目标 docx，而不是停在终端输出。
  3. 最终交付同时反映审批链路和文档更新结果。
- Not: 不验证页面级布局与交互细节。

#### scenario

`entire-workspace-to-docx`

- 实现状态: `待检查`
- What: 验证工作区材料生成文档闭环
- Why: 能把工作区材料变成成品，是高价值能力
- How: 从 `notes / todo` 提炼内容并生成结构化 docx
- Oracle:
  1. 工作区材料先被提炼，再写成结构化 docx 内容。
  2. 最终文档内容与材料事实一致，而不是模板空写。
  3. 交付包含可消费的文档结果或审阅引用。
- Not: 不验证页面级布局与交互细节。

`entire-kb-to-docx-hybrid`

- 实现状态: `待检查`
- What: 验证检索到文档的完整链路
- Why: 这是典型的混合任务闭环
- How: 先查规范，再改模板文档，结果可消费
- Oracle:
  1. KB 证据会驱动 docx 修改，而不是两段链路彼此脱节。
  2. 最终文档结果和知识依据同时存在，可回看来源。
  3. 混合链路能在 backend 内闭环收敛。
- Not: 不验证页面级布局与交互细节。

`entire-follow-up-continuation`

- 实现状态: `待检查`
- What: 验证多轮续做闭环
- Why: backend 也必须证明 follow-up 能成立
- How: 接续前文后继续完成修改或补写
- Oracle:
  1. 本轮会接续上一轮已有上下文或产物继续执行。
  2. 最终结果体现的是“继续做”后的更新，而不是重复旧结果。
  3. 续做链路能在 backend 内闭环完成或安全收敛。
- Not: 不验证页面级布局与交互细节。

`entire-terminal-materials-to-delivery`

- 实现状态: `待检查`
- What: 验证工作区材料到最终交付
- Why: 多源工作区任务是实际使用重心之一
- How: 先找材料，再生成最终汇报或周报
- Oracle:
  1. 终端发现的材料会进入最终汇报或周报交付。
  2. 最终交付是结构化结果，不只是命令输出摘要。
  3. 关键事实仍能回指到原始工作区材料。
- Not: 不验证页面级布局与交互细节。

`entire-long-task-weekly-brief`

- 实现状态: `待检查`
- What: 验证长任务完整闭环
- Why: 这是 backend 综合能力的最高压测点
- How: 多源材料、多步依赖和审阅收敛都能成立
- Oracle:
  1. 多源材料、多步依赖和最终汇总三类环节都真实发生。
  2. 最终 brief 至少包含主结论、风险或未决项等核心结构。
  3. 如果存在局部阻塞，也会以可继续交付方式安全收口。
- Not: 不验证页面级布局与交互细节。

#### live

`entire-live-docx-rewrite-review-ready`

- 实现状态: `待检查`
- What: 验证 live 文档改写闭环
- Why: backend 最小完整交付必须在 live 成立
- How: 在真实模型下完成 docx 改写并进入可审阅结果
- Oracle:
  1. backend 完整链路最终产出可审阅的 docx 结果或审阅引用。
  2. 修改内容与用户改写诉求一致，而不是只完成读取。
  3. 最终结果不是无故阻塞，且交付可被后续审阅消费。
- Not: 不验证页面级布局与交互细节。

`entire-live-docx-content-answer`

- 实现状态: `待检查`
- What: 验证 live 文档内容问答闭环
- Why: 文档读取与定位能力的完整闭环需要真实模型证明
- How: 在真实模型下读取现有 docx，定位指定标题或段落，并给出可回看的回答
- Oracle:
  1. 最终回答准确定位到指定标题、段落或块内容。
  2. 回答中保留可回看的文档定位依据，而不是泛泛复述。
  3. 整个链路不产生无关写操作。
- Not: 不验证页面级布局与交互细节。

`entire-live-kb-answer-with-citation`

- 实现状态: `待检查`
- What: 验证 live 知识问答闭环
- Why: 问答类完整闭环不能只靠 contract case
- How: 在真实模型下回答本地知识问题并给出依据
- Oracle:
  1. 最终答案包含明确结论和至少一条可回看的依据。
  2. 依据来自本地知识库，而不是外部或伪造来源。
  3. 结论与引用内容一致，不出现“引用 A，结论写成 B”。
- Not: 不验证页面级布局与交互细节。

`entire-live-kb-document-discovery-with-citation`

- 实现状态: `待检查`
- What: 验证 live 文档发现后回答的知识闭环
- Why: 真实知识任务经常先要找对资料，再做证据收敛
- How: 在真实模型下先列出候选知识文档，再收敛证据并给出带依据的回答
- Oracle:
  1. 链路先完成候选文档发现，再收敛到具体证据。
  2. 最终答案引用的是收窄后的目标文档，而不是跨文档拼接。
  3. 整个 backend 流程能闭环交付，不停留在“找到几篇文档”这一步。
- Not: 不验证页面级布局与交互细节。

`entire-live-kb-to-docx-hybrid`

- 实现状态: `待检查`
- What: 验证 live 混合任务闭环
- Why: 混合闭环是 backend 能力连贯性的关键证明
- How: 在真实模型下先检索再改文档并形成可消费结果
- Oracle:
  1. KB 证据会驱动 docx 修改，而不是两段链路彼此脱节。
  2. 最终文档结果和知识依据同时存在，可回看来源。
  3. 混合链路能在 backend 内闭环收敛。
- Not: 不验证页面级布局与交互细节。

`entire-live-terminal-materials-to-delivery`

- 实现状态: `待检查`
- What: 验证 live 工作区材料到交付
- Why: 本地工作区任务是高价值真实路径
- How: 在真实模型下从 workspace 材料生成最终交付
- Oracle:
  1. 终端发现的材料会进入最终汇报或周报交付。
  2. 最终交付是结构化结果，不只是命令输出摘要。
  3. 关键事实仍能回指到原始工作区材料。
- Not: 不验证页面级布局与交互细节。

`entire-live-evidence-insufficient-safe-stop`

- 实现状态: `待检查`
- What: 验证 live 安全收敛闭环
- Why: 安全闭环本身就是最终验收的一部分
- How: 在真实模型下证据不足时仍完整收敛
- Oracle:
  1. 证据不足时，完整链路仍给出明确缺口和可继续方式。
  2. 不会在 backend 末端伪造“已完成”的最终答案。
  3. 如果已有部分成果，会以部分交付形式保留。
- Not: 不验证页面级布局与交互细节。

`entire-live-long-task-weekly-brief`

- 实现状态: `待检查`
- What: 验证 live 长任务完整闭环
- Why: 这是 `entire` 阶段最关键的 live 压测点
- How: 在真实模型下完成多源材料与审阅收敛的完整 backend 任务
- Oracle:
  1. 多源材料、多步依赖和最终汇总三类环节都真实发生。
  2. 最终 brief 至少包含主结论、风险或未决项等核心结构。
  3. 如果存在局部阻塞，也会以可继续交付方式安全收口。
- Not: 不验证页面级布局与交互细节。

### 3.7 `ui`

做什么：验证 Core AI 交互界面的交互、布局、样式和状态联动是否稳定可用。

为什么：backend 能跑通不代表用户在页面里能做成；UI 问题会直接让正确能力无法被使用。

怎么做：单独覆盖三栏布局、输入区、模式切换、assistant turn 折叠步骤、右侧内容面板联动、审批条、工作区条、审阅面板、小窗口和长内容滚动。
落地规则：实现时至少按 `basic / boundary / scenario` 分组；只有在 UI 用例直接依赖真实模型执行时才补 `live` case。

#### basic

`ui-three-pane-layout-baseline`

- 实现状态: `待检查`
- What: 验证基础布局稳定
- Why: 三栏模型是整个 Core AI 主界面的基础结构
- How: 左侧会话、中间对话与 assistant turn、右侧内容面板稳定呈现
- Oracle:
  1. 左侧会话、中间对话与右侧内容面板三栏都可见且可用。
  2. 切换 run 或消息后，三栏内容不会互相遮挡或整体塌陷。
  3. 关键主交互区不会因为初始布局错误而不可操作。
- Not: 不验证模型推理质量和 backend 内部中间 state 正确性。

`ui-input-and-send-stability`

- 实现状态: `待检查`
- What: 验证输入区稳定性
- Why: 用户的第一接触点就是输入区
- How: 输入区可见、可输入、可回车发送、可按钮发送、运行中可取消
- Oracle:
  1. 输入框可见、可编辑，并支持回车或按钮发送。
  2. 发送后会进入运行态，且运行中存在明确的取消入口。
  3. 一次用户操作不会触发重复发送或失焦丢输入。
- Not: 不验证模型推理质量和 backend 内部中间 state 正确性。

`ui-mode-and-scope-switching`

- 实现状态: `待检查`
- What: 验证模式与范围切换
- Why: 模式与范围是任务行为的重要前提
- How: `AI 对话 / 纯搜索`、范围选择切换稳定，状态显示一致
- Oracle:
  1. `AI 对话 / 纯搜索` 模式切换后，当前模式显示与实际行为一致。
  2. 范围选择切换后，界面能稳定显示当前选中的 scope。
  3. 后续发起的 run 会使用切换后的模式和范围，而不是旧状态。
- Not: 不验证模型推理质量和 backend 内部中间 state 正确性。

#### boundary

`ui-approval-and-workspace-banner-flow`

- 实现状态: `待检查`
- What: 验证提示条与交互流
- Why: 阻塞交互如果不清晰，用户无法完成流程
- How: 审批请求、工作区缺失、继续运行等 banner 状态清晰可操作
- Oracle:
  1. 审批或 workspace 缺失时会出现对应 banner，而不是静默卡住。
  2. banner 上的继续、批准、补充等操作可实际触发后续流程。
  3. banner 状态会随着阻塞解除而更新，不残留错误提示。
- Not: 不验证模型推理质量和 backend 内部中间 state 正确性。

`ui-small-window-and-overflow`

- 实现状态: `待检查`
- What: 验证小窗口布局与溢出
- Why: 小窗口问题会直接影响日常使用
- How: 在 `1440x900`、`1280x800`、`1024x768`、`900x700` 下不出现布局断裂
- Oracle:
  1. 列出的窗口尺寸下，关键按钮和主要面板不会被截断到不可点击。
  2. 内容溢出时以滚动收敛，不出现大片重叠或错位。
  3. 小窗口不会破坏三栏或主操作区的基本可用性。
- Not: 不验证模型推理质量和 backend 内部中间 state 正确性。

`ui-long-content-scroll-stability`

- 实现状态: `待检查`
- What: 验证长内容滚动稳定性
- Why: Core AI 交互界面天然会承载长内容，必须提前防守
- How: 长路径、长 JSON、长时间线、长审阅列表下滚动不冲突、不遮挡
- Oracle:
  1. 长消息、长 JSON、长时间线或长审阅列表都能正常滚动查看。
  2. 滚动时不会出现互相抢焦点、内容遮挡或跳动回顶。
  3. 关键操作区在长内容场景下仍可触达。
- Not: 不验证模型推理质量和 backend 内部中间 state 正确性。

#### scenario

`ui-run-timeline-inspector-linkage`

- 实现状态: `待检查`
- What: 验证运行态联动
- Why: Core AI 界面的关键价值之一就是可观察性
- How: 时间线点击、检查器详情、运行态信息能够保持同步
- Oracle:
  1. 点击时间线项后，检查器会同步切换到对应详情。
  2. 运行态信息、时间线选中态和检查器内容三者保持一致。
  3. 切换不同 run 时，联动关系不会串到上一条运行记录。
- Not: 不验证模型推理质量和 backend 内部中间 state 正确性。

`ui-draft-review-center-operations`

- 实现状态: `待检查`
- What: 验证审阅中心操作
- Why: 文档类任务最后常常收敛在审阅中心
- How: 支持逐条接受、拒绝、全部接受和提交，状态无错乱
- Oracle:
  1. 逐条接受、拒绝、全部接受等操作都会更新对应审阅状态。
  2. 提交时只提交当前被接受的修改，不把拒绝项混进去。
  3. 操作过程中不会出现计数、选中态或结果预览错乱。
- Not: 不验证模型推理质量和 backend 内部中间 state 正确性。

#### live

`ui-live-run-timeline-inspector-linkage`

- 实现状态: `待检查`
- What: 验证 live 运行态联动
- Why: 真实运行会放大 UI 状态联动问题
- How: 在真实模型执行时，时间线和检查器仍保持同步
- Oracle:
  1. 点击时间线项后，检查器会同步切换到对应详情。
  2. 运行态信息、时间线选中态和检查器内容三者保持一致。
  3. 切换不同 run 时，联动关系不会串到上一条运行记录。
- Not: 不验证模型推理质量和 backend 内部中间 state 正确性。

`ui-live-approval-and-workspace-banner-flow`

- 实现状态: `待检查`
- What: 验证 live 阻塞提示流
- Why: 阻塞交互必须在真实链路里可用
- How: 在真实模型执行时，审批与 workspace banner 仍清晰可恢复
- Oracle:
  1. 审批或 workspace 缺失时会出现对应 banner，而不是静默卡住。
  2. banner 上的继续、批准、补充等操作可实际触发后续流程。
  3. banner 状态会随着阻塞解除而更新，不残留错误提示。
- Not: 不验证模型推理质量和 backend 内部中间 state 正确性。

`ui-live-draft-review-center-operations`

- 实现状态: `待检查`
- What: 验证 live 审阅中心操作
- Why: 审阅中心是真实文档任务的最终 UI 落点
- How: 在真实模型产出审阅结果后，审阅中心操作仍稳定
- Oracle:
  1. 逐条接受、拒绝、全部接受等操作都会更新对应审阅状态。
  2. 提交时只提交当前被接受的修改，不把拒绝项混进去。
  3. 操作过程中不会出现计数、选中态或结果预览错乱。
- Not: 不验证模型推理质量和 backend 内部中间 state 正确性。

### 3.8 `final`

做什么：用真实页面交互模拟用户提出问题、等待执行、拿到结果的完整 e2e 流程。

为什么：这是最终验收层，判断标准不是某一层是否通过，而是用户是否真的在页面上解决了问题。

怎么做：围绕高价值真实任务做完整 e2e，并继续使用完成度判断最终结果是否可消费。
落地规则：实现时按 `basic / boundary / scenario / live` 分组；`final` 阶段的完成判断以真实模型下的 `live` e2e 为准。

#### basic

`final-docx-rewrite-completion`

- 实现状态: `待检查`
- What: 验证文档类最终完成
- Why: 这是最核心的页面级主任务
- How: 用户在界面中输入改写诉求，最终拿到可消费结果或审阅结果
- Oracle:
  1. 用户通过页面输入改写诉求后，最终拿到可消费文档结果或审阅结果。
  2. 结果与原始改写要求一致，而不是只返回解释文本。
  3. 页面级链路能收敛到完成态，不卡在中间流程。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-kb-answer-completion`

- 实现状态: `待检查`
- What: 验证知识库问答最终完成
- Why: 问答是最直接、最可感知的完成标准
- How: 用户在页面中提问，最终拿到答案和依据展示
- Oracle:
  1. 用户提问后，页面中能看到最终答案。
  2. 答案附带依据展示或可回看的引用。
  3. 整个交互以用户可消费结果结束，而不是停在运行中或空白态。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

#### boundary

`final-terminal-approval-completion`

- 实现状态: `待检查`
- What: 验证审批分支最终完成
- Why: 审批链路必须在真实交互里验证
- How: 覆盖等待审批、批准继续、拒绝收敛，并最终回到用户目标
- Oracle:
  1. 需要审批时，页面会暂停并等待用户操作。
  2. 批准后流程继续回到用户目标，拒绝后安全收敛并说明原因。
  3. 无论批准还是拒绝，都不会出现伪造“已完成”的假结果。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-workspace-required-and-resume`

- 实现状态: `待检查`
- What: 验证工作区补充后的恢复能力
- Why: 本地优先链路必须证明可以中断后恢复
- How: 工作区缺失时提示补充，补充后继续运行并完成目标
- Oracle:
  1. 缺少 workspace 时，页面会明确提示补充。
  2. 补充 workspace 后，原任务能够继续而不是重新开题。
  3. 恢复后的最终结果仍对应最初用户目标。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

#### scenario

`final-kb-docx-hybrid-completion`

- 实现状态: `待检查`
- What: 验证混合任务最终完成
- Why: 混合任务最能体现整套架构是否连贯
- How: 先检索后改文档的链路在界面中完整跑通
- Oracle:
  1. 页面链路先完成检索，再完成文档修改或审阅结果生成。
  2. 最终用户既能拿到文档结果，也能回看依据。
  3. 混合任务不会在 UI 层断成两个互不关联的半成品。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-follow-up-continuation`

- 实现状态: `待检查`
- What: 验证多轮续做最终完成
- Why: 连续对话是 Core AI 系统的核心使用方式
- How: 接续上一轮产物继续修改，并让用户拿到更新后的结果
- Oracle:
  1. 第二轮交互会接住上一轮产物继续修改。
  2. 最终显示的是更新后的结果，而不是重复上一轮输出。
  3. 多轮对话上下文在页面里保持连续，不丢任务主线。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-review-partial-acceptance`

- 实现状态: `待检查`
- What: 验证审阅中心部分接受闭环
- Why: 文档任务不能只做到“给出建议”，还要支持选择性收敛
- How: 用户只接受部分修改、拒绝其余修改后提交最终结果
- Oracle:
  1. 用户只接受部分修改时，最终结果只应用被接受的部分。
  2. 被拒绝的修改不会被偷偷带入最终提交。
  3. 提交后页面状态与最终文档结果保持一致。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-long-task-stability`

- 实现状态: `待检查`
- What: 验证长任务真实交互稳定性
- Why: backend 成立不代表真实页面长任务也稳定
- How: 长任务在界面里仍能保持步骤连贯并最终收敛
- Oracle:
  1. 长任务在页面里能持续展示运行进展，而不是中途失联。
  2. 过程中即使有多步切换，任务主线仍保持连贯。
  3. 最终会收敛到可消费结果或明确的安全收尾。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

#### live

`final-live-docx-rewrite-completion`

- 实现状态: `待检查`
- What: 验证 live 文档类最终完成
- Why: 页面主路径必须以 live 为准
- How: 在真实模型下，用户通过界面拿到可消费文档结果或审阅结果
- Oracle:
  1. 用户通过页面输入改写诉求后，最终拿到可消费文档结果或审阅结果。
  2. 结果与原始改写要求一致，而不是只返回解释文本。
  3. 页面级链路能收敛到完成态，不卡在中间流程。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-live-kb-answer-completion`

- 实现状态: `待检查`
- What: 验证 live 知识问答最终完成
- Why: 最直观的用户价值必须在真实模型下成立
- How: 在真实模型下，界面中问答能稳定返回答案和依据展示
- Oracle:
  1. 用户提问后，页面中能看到最终答案。
  2. 答案附带依据展示或可回看的引用。
  3. 整个交互以用户可消费结果结束，而不是停在运行中或空白态。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-live-kb-docx-hybrid-completion`

- 实现状态: `待检查`
- What: 验证 live 混合任务最终完成
- Why: 混合任务是最终验收层的重要能力证明
- How: 在真实模型下，先检索再改文档的页面链路完整跑通
- Oracle:
  1. 页面链路先完成检索，再完成文档修改或审阅结果生成。
  2. 最终用户既能拿到文档结果，也能回看依据。
  3. 混合任务不会在 UI 层断成两个互不关联的半成品。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-live-follow-up-continuation`

- 实现状态: `待检查`
- What: 验证 live 多轮续做最终完成
- Why: 连续对话稳定性只能靠 live e2e 判断
- How: 在真实模型下，用户接续上一轮产物继续修改并拿到结果
- Oracle:
  1. 第二轮交互会接住上一轮产物继续修改。
  2. 最终显示的是更新后的结果，而不是重复上一轮输出。
  3. 多轮对话上下文在页面里保持连续，不丢任务主线。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-live-terminal-approval-completion`

- 实现状态: `待检查`
- What: 验证 live 审批分支最终完成
- Why: 审批链路必须在真实交互里被验证
- How: 在真实模型下，审批等待、批准继续、拒绝收敛都能回到用户目标
- Oracle:
  1. 需要审批时，页面会暂停并等待用户操作。
  2. 批准后流程继续回到用户目标，拒绝后安全收敛并说明原因。
  3. 无论批准还是拒绝，都不会出现伪造“已完成”的假结果。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-live-review-partial-acceptance`

- 实现状态: `待检查`
- What: 验证 live 审阅中心部分接受闭环
- Why: 选择性收敛是真实文档任务的重要落点
- How: 在真实模型下，用户部分接受修改后仍能提交最终结果
- Oracle:
  1. 用户只接受部分修改时，最终结果只应用被接受的部分。
  2. 被拒绝的修改不会被偷偷带入最终提交。
  3. 提交后页面状态与最终文档结果保持一致。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-live-long-task-stability`

- 实现状态: `待检查`
- What: 验证 live 长任务真实交互稳定性
- Why: 最终验收层的长任务结论只能来自 live
- How: 在真实模型下，长任务在页面里仍能保持连贯并收敛
- Oracle:
  1. 长任务在页面里能持续展示运行进展，而不是中途失联。
  2. 过程中即使有多步切换，任务主线仍保持连贯。
  3. 最终会收敛到可消费结果或明确的安全收尾。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-live-workspace-required-and-resume`

- 实现状态: `待检查`
- What: 验证 live 工作区补充后的恢复能力
- Why: 本地优先恢复链路必须用真实交互证明
- How: 在真实模型下，工作区缺失后补充并继续运行仍能完成目标
- Oracle:
  1. 缺少 workspace 时，页面会明确提示补充。
  2. 补充 workspace 后，原任务能够继续而不是重新开题。
  3. 恢复后的最终结果仍对应最初用户目标。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。
