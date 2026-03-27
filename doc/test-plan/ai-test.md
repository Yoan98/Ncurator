# NCurator-Desktop Core AI 测试计划

## 1. 总体目标

本计划用于验证项目核心 AI 智能系统是否真的能接住用户诉求，并在本地优先约束下把事情做成，而不是只返回一段看起来合理的回答。

当前长期回归主轴聚焦四类真实诉求：

- 帮用户编辑或编写 `.docx` 文档，并进入可确认的交付状态
- 回答本地知识库问题，并给出可回看的依据
- 在必要时结合 `terminal` 读取工作区文件、生成中间材料或辅助完成前两类任务
- 在真实页面里处理审批、补工作区、确认修改和续做等关键中断路径

本计划只保留长期要回归的正式 case，不再把同一风险按实现层级镜像铺满。测试用例设计准则、测试目录、runner、raw log、report 契约统一以 [test.md](/Users/test/work-space/NCurator-Desktop/doc/test.md) 为准，这里不再重复展开。

## 2. 模型使用与诊断

- 默认所有涉及模型调用的 case 先使用基础模型测试（`AI_LIVE_PRIMARY_MODEL_NAME`）。
- 同一 case 在相同输入、相同 fixture、相同运行前提下重复多次仍无法完成，或稳定卡在同一处时，可补跑更强模型（`AI_LIVE_STRONG_MODEL_NAME`）。
- 这样做的目的不是把更强模型当成默认方案，而是判断问题更像模型能力上限，还是上下文、编排、工具链问题。
- 如果更强模型能明显推进或直接完成任务，应把这类观察补充到 report 中，作为后续分析依据。
- 任何正式测试范围只要存在模型参与，就不能只依赖非 `live` case 得出阶段结论；是否真正成立，仍需以 `live` 证据为准。
- `live` case 只保留每个阶段最关键的证明型路径，不再与非 `live` case 一一镜像。

## 3. 长期回归口径

- 本计划只保留长期回归 case；一次性排查、试运行 fixture、验证猜想，统一放入 `tests/temp/**`。
- 同一风险只保留一个稳定 owner 阶段：工具契约留在 `tool`，任务级执行契约留在 `human / context / intent / plan`，最终用户价值留在 `entire / final`。
- `entire` 与 `final` 是产品能力回归主干；`tool / human / context / intent / plan` 是工程契约回归主干。
- 当前正式测试实现已移除，以下保留 case 统一从 `未实现` 重新开始登记；后续按本计划重建正式测试代码。

## 4. 阶段计划

测试按阶段顺序推进，原则上上一阶段形成稳定结论后，再进入下一阶段。

本计划按七个阶段推进：

1. `tool`
2. `human`
3. `context`
4. `intent`
5. `plan`
6. `entire`
7. `final`

其中：

- `tool / human / context / intent / plan / entire` 属于 `backend`
- `final` 属于 `e2e`
- 纯页面布局、滚动、输入稳定性这类 UI-only 验证不再作为 Core AI 正式阶段单列；只有直接影响任务完成的页面行为，才作为 `final` case 的执行链路与验收点

### 4.1 `tool`

做什么：验证 `docx`、`terminal`、`kb` 三类核心工具的稳定能力边界。

为什么：这是上层 `human / context / intent / plan / entire` 的基础，底层不稳，上层结论都会失真。

怎么做：只保留长期必须稳定的基础读写、关键边界和交付收敛，不再按工具内部细分模式全面铺开。

#### basic

`tool-docx-structure-read`

- 实现状态: `未实现`
- What: 验证文档读取基线
- Why: 所有文档任务都依赖这条基础链路
- How: 对带标题、正文、表格的样例文档完成 `open -> outline -> search -> get_block`
- Oracle:
  1. `open` 成功返回唯一目标文档句柄，后续读取都绑定同一文档。
  2. `outline` 返回的标题树包含 fixture 中预期的标题节点，顺序不乱序。
  3. `search` 与 `get_block` 最终定位到同一目标块，返回内容包含预期关键句。
  4. 全流程不发生写入、保存或版本变更。
- Not: 不验证 `human / director` 路由和最终用户交付。

`tool-terminal-workspace-material-discovery`

- 实现状态: `未实现`
- What: 验证读取型 terminal 链路
- Why: 很多任务第一步就是先找材料
- How: 在多层目录里找到最新材料并提取可复用内容
- Oracle:
  1. 读取链路只访问工作区内路径，不发生工作区外读取。
  2. 最终命中的材料符合 fixture 约定的“最新”规则，而不是任意取到一份旧文件。
  3. 输出包含可回看的文件路径和提取结果，后续可直接复用。
- Not: 不验证 `human / director` 路由和最终用户交付。

`tool-kb-hybrid-search`

- 实现状态: `未实现`
- What: 验证 `hybrid` 检索基线
- Why: `hybrid` 是本地检索的主路径之一
- How: 在限定 source scope 下返回可引用结果，并与已选范围保持一致
- Oracle:
  1. 返回结果只来自选定的 source scope，不混入未选范围。
  2. 至少有 1 条结果能够支撑问题回答，并带有可回看的来源信息。
  3. 返回结果的排序与收敛方向稳定指向目标资料，而不是在多份资料间漂移。
- Not: 不验证 `human / director` 路由和最终用户交付。

#### boundary

`tool-docx-save-conflict-and-overwrite`

- 实现状态: `未实现`
- What: 验证保存边界
- Why: 结果交付必须安全，不能在保存阶段失控
- How: 覆盖保存、另存为、路径冲突和 `overwrite` 行为
- Oracle:
  1. 未显式允许 `overwrite` 时，路径冲突会被阻止，不静默覆盖现有文件。
  2. `save_as` 能生成新的目标文件路径，并保留原始文档状态。
  3. 显式 `overwrite` 时只覆盖指定目标，不扩散到其他输出。
- Not: 不验证 `human / director` 路由和最终用户交付。

`tool-terminal-approval-and-boundary`

- 实现状态: `未实现`
- What: 验证审批与工作区边界
- Why: 本地优先和安全约束是这条链路的前提
- How: 覆盖审批请求、批准、拒绝、路径逃逸阻断
- Oracle:
  1. 需要审批的命令会先产出审批请求，再等待批准或拒绝。
  2. 批准后只执行被批准的目标命令，不额外扩张执行范围。
  3. 路径逃逸或工作区边界违规会被直接阻断，不进入实际执行。
- Not: 不验证 `human / director` 路由和最终用户交付。

`tool-terminal-failure-and-long-output`

- 实现状态: `未实现`
- What: 验证失败路径可解释
- Why: 失败不可避免，但必须可回看、可理解
- How: 覆盖命令失败、长输出截断、超时终止后的收敛
- Oracle:
  1. 命令失败会回写失败状态和可解释的原因，不冒充成功。
  2. 长输出会被收敛展示，但仍保留足够的头尾或摘要用于回看。
  3. 超时终止后能明确区分“被终止”与“执行成功”。
- Not: 不验证 `human / director` 路由和最终用户交付。

`tool-kb-empty-scope-and-no-result`

- 实现状态: `未实现`
- What: 验证知识库边界表现
- Why: 证据不足时必须安全收敛，而不是胡编
- How: 覆盖空范围、无结果和返回理由清晰性
- Oracle:
  1. 空范围会直接返回无结果，而不是跨范围检索。
  2. 无结果时给出明确原因或空结果标记，不伪造引用。
  3. 后续返回仍维持安全收敛，不把“没找到”写成结论。
- Not: 不验证 `human / director` 路由和最终用户交付。

#### scenario

`tool-docx-preview-validate-rollback`

- 实现状态: `未实现`
- What: 验证结果收敛能力
- Why: 工具不只要能改，还要能校验、预览和回退
- How: 多轮编辑后执行预览、校验、历史回看与回滚
- Oracle:
  1. `preview` 与 `validate` 能反映当前编辑后的真实内容，而不是旧版本。
  2. 历史回看可以定位到本轮编辑前后的关键版本。
  3. `rollback` 后文档内容恢复到预期旧版本，之前错误修改不再保留。
- Not: 不验证 `human / director` 路由和最终用户交付。

### 4.2 `human`

做什么：验证 `human` 作为 AI 核心执行体，是否能基于目标自主推进任务、处理阻塞并稳定交付。

为什么：工具只是能力零件，真正决定“能不能把事做成”的是 `human`。

怎么做：只保留最小单步闭环、关键纠偏边界和真实高价值 handoff，不再按 skill 目录逐个铺满长期回归。

#### basic

`human-direct-kb-answer`

- 实现状态: `未实现`
- What: 验证单步自主完成
- Why: 最简单的单步知识任务必须先独立成立
- How: 直接读取知识库并交付可引用答案
- Oracle:
  1. 最终 `human` 结果为 `completed`，不是无故阻塞。
  2. 交付为面向用户的答案，并包含可回看的依据或引用。
  3. 执行链路只使用完成该问答所需的最小工具，不无意义扩张。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-direct-docx-edit`

- 实现状态: `未实现`
- What: 验证单工具文档闭环
- Why: 这是最常见的文档类基础任务
- How: 直接读取指定文档、完成局部修改并交付可审阅结果
- Oracle:
  1. 最终 `human` 结果为 `completed`，且完成了指定文档的局部修改。
  2. 交付中包含可审阅的文档结果或稳定产物引用。
  3. 修改范围收敛在指定目标位置，不误改无关段落。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

#### boundary

`human-evidence-insufficient-safe-stop`

- 实现状态: `未实现`
- What: 验证证据不足时的安全行为
- Why: 不能把“查不到”变成“编出来”
- How: 找不到足够依据时明确说明缺口，并交付可继续的初稿或后续建议
- Oracle:
  1. 证据不足时不会编造事实或补全不存在的依据。
  2. 交付会明确说明缺口，并区分“草稿/建议”与“最终结论”。
  3. 如果已有部分可交付内容，会保留该部分而不是整体清空。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-invalid-execution-batch`

- 实现状态: `未实现`
- What: 验证非法 batch 被拒绝
- Why: 保守并行是当前 `human` 的关键安全边界
- How: 混合读写或不满足并行约束的 batch plan 会被 executor 拒绝并回到 `brain`
- Oracle:
  1. 非法 batch 会在执行前被拒绝，不真正落到工具层执行。
  2. 系统会回写 `watchHint` 并返回 `brain` 重新决策。
  3. 混合读写或违反并行约束的批次不会被误当成合法成功。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-partial-delivery-on-tool-limit`

- 实现状态: `未实现`
- What: 验证做不完时的安全收敛
- Why: “没完全做完”不应等同于“什么都没有”
- How: 在工具调用上限触发 `watchHint` 时保留已有进展并给出可继续交付
- Oracle:
  1. 工具调用上限命中后会写入 `watchHint` 或等价收敛信号。
  2. 已有事实、草稿或产物会被保留下来，不因限额而清零。
  3. 最终交付会明确标记剩余未完成部分，不把部分完成写成全部完成。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

#### scenario

`human-terminal-docx-handoff`

- 实现状态: `未实现`
- What: 验证跨工具协作
- Why: 真实任务常常需要先取材再落文档
- How: 先在工作区找材料，再写入 docx 并形成可审阅交付
- Oracle:
  1. 先完成 workspace 材料读取，再进入 docx 写入或交付。
  2. 文档内容能体现从 workspace 提取出的事实，而不是脱离材料瞎写。
  3. 最终交付中同时保留材料来源线索和文档产物引用。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-review-handoff-structured-delivery`

- 实现状态: `未实现`
- What: 验证审阅前结构化交付
- Why: 文档类任务的真正落点不是一句话，而是可继续处理的结构化结果
- How: 文档修改完成后，输出稳定的 review handoff 交付，供后续进入 `draft_review_ready`
- Oracle:
  1. 交付 `deliveryMarkdown` 采用稳定的 review handoff 结构，而不是一句自然语言。
  2. 交付中保留可进入审阅阶段所需的文档结果或 review 引用。
  3. 下游可以基于该交付进入 `draft_review_ready`，而不是重新猜测修改内容。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

#### live

`human-live-direct-kb-answer`

- 实现状态: `未实现`
- What: 验证 live 单步知识问答
- Why: `human` 的最小 live 自主闭环必须成立
- How: 在真实模型下直接读取知识库并交付答案
- Oracle:
  1. 最终 `human` 结果为 `completed`，不是无故阻塞。
  2. 交付为面向用户的答案，并包含可回看的依据或引用。
  3. 执行链路只使用完成该问答所需的最小工具，不无意义扩张。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

`human-live-direct-docx-edit`

- 实现状态: `未实现`
- What: 验证 live 单工具文档闭环
- Why: 文档类 live 基线不能只靠脚本化决策
- How: 在真实模型下完成 docx 改写与 preview 或 review handoff 交付
- Oracle:
  1. 最终 `human` 结果为 `completed`，且完成了指定文档的局部修改。
  2. 交付中包含可审阅的文档结果或稳定产物引用。
  3. 修改范围收敛在指定目标位置，不误改无关段落。
- Not: 不验证 `director` 路由、`plan` 拆解和 UI 呈现。

### 4.3 `context`

做什么：验证系统是否能主动收集和整理后续执行所需的关键上下文。

为什么：上下文质量直接决定 `intent` 判断是否稳定、`plan` 是否靠谱、续做场景能否接住。

怎么做：只保留长期必须稳定的证据沉淀、缺失识别和 follow-up 指代解析路径。

#### basic

`context-workspace-evidence-collection`

- 实现状态: `未实现`
- What: 验证工作区证据收集
- Why: 很多任务不是缺能力，而是缺前置材料
- How: 在规划前先读取工作区材料，沉淀后续执行需要的事实
- Oracle:
  1. 收集结果会沉淀为可复用的 `contextEvidence`，而不是只停留在一次性回答中。
  2. `contextEvidence` 中保留 workspace 事实摘要，不写入 routing 理由。
  3. 用于收集的交付形态保持为上下文说明，而不是直接冒充最终用户答案。
- Not: 不验证最终用户答案质量或最终交付文案。

#### boundary

`context-missing-material-detection`

- 实现状态: `未实现`
- What: 验证缺失材料识别
- Why: 上下文阶段必须能先发现“少了什么”，而不是盲目继续
- How: 材料、目标文档或关键指代缺失时，明确沉淀缺口而不是伪造上下文
- Oracle:
  1. 缺失项会被记录为上下文缺口，而不是被误写成已确认事实。
  2. 交付会说明缺的是 workspace、目标文件还是前序结果。
  3. 后续路由能够根据这些缺口决定是否继续补上下文。
- Not: 不验证最终用户答案质量或最终交付文案。

#### scenario

`context-follow-up-reference-resolution`

- 实现状态: `未实现`
- What: 验证续做引用解析
- Why: follow-up 最容易因为指代不清而直接误执行
- How: 对“继续刚才那个”“把第二段再压缩一点”这类输入先解析所指向的旧结果与目标范围
- Oracle:
  1. 上下文阶段会回指上一轮任务、产物或目标段落，而不是把 follow-up 当成全新任务。
  2. 沉淀出的 `contextEvidence` 能支撑后续重新路由或重规划。
  3. 引用解析失败时会保留明确缺口，而不是误绑到错误目标。
- Not: 不验证最终用户答案质量或最终交付文案。

#### live

`context-live-follow-up-reference-resolution`

- 实现状态: `未实现`
- What: 验证 live 续做引用解析
- Why: 指代解析高度依赖真实模型理解
- How: 在真实模型下，对 follow-up 输入稳定回指上一轮任务、产物或目标范围
- Oracle:
  1. 上下文阶段会回指上一轮任务、产物或目标段落，而不是把 follow-up 当成全新任务。
  2. 沉淀出的 `contextEvidence` 能支撑后续重新路由或重规划。
  3. 引用解析失败时会保留明确缺口，而不是误绑到错误目标。
- Not: 不验证最终用户答案质量或最终交付文案。

### 4.4 `intent`

做什么：验证系统是否能在 `need_context`、`direct_human`、`to_plan` 等路径之间做出正确路由。

为什么：路由错了，后面即使工具和 `human` 都能工作，也会在入口就走偏。

怎么做：只保留简单任务、上下文不足、纯搜索和混合任务四类长期高风险入口。

#### basic

`intent-direct-human-routing`

- 实现状态: `未实现`
- What: 验证简单任务不过度规划
- Why: 简单任务被过度规划会显著拖慢体验
- How: 对简单知识问答或单步改写任务，直接进入 `direct_human`
- Oracle:
  1. `decision.mode` 为 `direct_human`，下一跳进入 `director_direct_human_exec`。
  2. 本轮不创建 `plan`，也不进入 `director_context_human`。
  3. 仅派发 1 个 direct human 任务，不把简单任务升级成多任务链路。
- Not: 不验证后续执行链路的最终完成质量。

#### boundary

`intent-need-context-routing`

- 实现状态: `未实现`
- What: 验证上下文不足先补上下文
- Why: follow-up 最怕直接误执行
- How: 对“继续刚才那个”“改第二段”这类输入，先进入 `need_context`
- Oracle:
  1. `decision.mode` 为 `need_context`，下一跳进入 `director_context_human`。
  2. 在上下文不足时不会直接进入 `direct_human` 或 `director_plan`。
  3. 缺失的是指代或上下文信息，而不是被误判成复杂执行任务。
- Not: 不验证后续执行链路的最终完成质量。

`intent-search-mode-routing`

- 实现状态: `未实现`
- What: 验证纯搜索模式路由
- Why: 模式错路由会让 UI 与实际行为脱节
- How: 在 `纯搜索` 模式下优先走检索与展示，不误入完整任务执行链
- Oracle:
  1. 纯搜索输入不会被路由到多步执行链路。
  2. 最终意图保持在检索与展示范围内，而不是生成文档或执行命令。
  3. 路由结果不会因为有搜索词就误升级成 `to_plan`。
- Not: 不验证后续执行链路的最终完成质量。

#### scenario

`intent-mixed-task-routing`

- 实现状态: `未实现`
- What: 验证混合任务路由
- Why: 混合任务是最容易被低估复杂度的一类
- How: 对“先查 KB，再看工作区，再改文档”这类输入，稳定进入 `to_plan`
- Oracle:
  1. “查 KB + 读 workspace + 改文档”这类混合任务会路由到 `to_plan`。
  2. 路由不会把混合链路误判成单步问答。
  3. 后续路径能够承接多工具依赖，而不是只有一个 direct task。
- Not: 不验证后续执行链路的最终完成质量。

#### live

`intent-live-need-context-routing`

- 实现状态: `未实现`
- What: 验证 live 上下文缺失路由
- Why: 续做场景的误路由风险最高
- How: 在真实模型下，follow-up 输入稳定进入 `need_context`
- Oracle:
  1. `decision.mode` 为 `need_context`，下一跳进入 `director_context_human`。
  2. 在上下文不足时不会直接进入 `direct_human` 或 `director_plan`。
  3. 缺失的是指代或上下文信息，而不是被误判成复杂执行任务。
- Not: 不验证后续执行链路的最终完成质量。

### 4.5 `plan`

做什么：验证生成的计划是否可执行、顺序合理、能真正解决复杂用户需求。

为什么：`plan` 不是展示思路，而是给后续执行用的任务骨架；拆错一步，后面会整条链路失真。

怎么做：只保留顺序正确、任务粒度正确、受限收敛和续做重规划四类长期必须稳定的计划能力。

#### basic

`plan-docx-workflow-ordering`

- 实现状态: `未实现`
- What: 验证文档类计划顺序
- Why: 这是最基础也最容易写错顺序的一类计划
- How: 文档任务必须先取证、后编辑、再保存或进入审阅
- Oracle:
  1. 计划顺序满足“取证/读取 -> 编辑 -> 保存或进入审阅”。
  2. 不会在读取前先保存，也不会在编辑前直接进入审阅。
  3. 每个任务的依赖关系能解释为什么必须按这个顺序执行。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

`plan-single-human-executable-task`

- 实现状态: `未实现`
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

- 实现状态: `未实现`
- What: 验证结果受限时计划可收敛
- Why: 复杂任务不一定每次都能完整完成，但必须能收住
- How: 出现审批、缺文件或资料不足时，仍能产出明确后续
- Oracle:
  1. 任务结果受限时，对应 `DirectorPlanTask.status` 仍保持 `completed`。
  2. 受限结果不会让已完成 task 的 `deliveryMarkdown` 或 `artifacts` 丢失。
  3. 计划链路最终会进入 synthesis，且交付中保留限制说明。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

#### scenario

`plan-follow-up-refinement-breakdown`

- 实现状态: `未实现`
- What: 验证续做任务重规划
- Why: follow-up 如果不能重用上下文，体验会很差
- How: 已有中间产物时，计划能围绕“继续完善”而不是重新做一遍
- Oracle:
  1. 已有中间产物会作为 refinement 输入复用，而不是重新从零规划。
  2. 任务拆解围绕“局部继续完善”展开，不重开整个主流程。
  3. 计划中会明确哪些部分沿用旧产物，哪些部分需要新增修改。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

#### live

`plan-live-docx-workflow-ordering`

- 实现状态: `未实现`
- What: 验证 live 文档类计划顺序
- Why: 计划顺序错误会直接污染后续执行
- How: 在真实模型下，文档任务仍保持先取证后编辑再审阅的顺序
- Oracle:
  1. 计划顺序满足“取证/读取 -> 编辑 -> 保存或进入审阅”。
  2. 不会在读取前先保存，也不会在编辑前直接进入审阅。
  3. 每个任务的依赖关系能解释为什么必须按这个顺序执行。
- Not: 不验证具体工具调用实现细节和 UI 呈现。

### 4.6 `entire`

做什么：在不依赖真实 UI 的前提下，验证从用户输入到最终交付的 backend 完整闭环。

为什么：这一层用于确认 `director + human + tools` 在 backend harness 下已经能把真实任务做完，而不是只验证零散节点。

怎么做：围绕真实用户任务做端到端 backend case，并用完成度判断任务是否真正达成。完成度建议采用 `0-3`：`0` 失败或阻塞、`1` 部分完成、`2` 主目标完成但仍需人工修补、`3` 完整完成。

#### basic

`entire-docx-rewrite-review-ready`

- 实现状态: `未实现`
- What: 验证现有 docx 改写闭环
- Why: 这是文档类任务的核心 backend 主路径
- How: 读取、修改文档并进入可审阅结果
- Oracle:
  1. backend 完整链路最终产出可审阅的 docx 结果或审阅引用。
  2. 修改内容与用户改写诉求一致，而不是只完成读取。
  3. 最终结果不是无故阻塞，且交付可被后续审阅消费。
- Not: 不验证页面级布局与交互细节。

`entire-kb-answer-with-citation`

- 实现状态: `未实现`
- What: 验证知识库问答闭环
- Why: 用户问答不能只给结论，不给证据
- How: 回答本地知识问题，并给出可回看依据
- Oracle:
  1. 最终答案包含明确结论和至少一条可回看的依据。
  2. 依据来自本地知识库，而不是外部或伪造来源。
  3. 结论与引用内容一致，不出现“引用 A，结论写成 B”。
- Not: 不验证页面级布局与交互细节。

`entire-workspace-material-summary-delivery`

- 实现状态: `未实现`
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

- 实现状态: `未实现`
- What: 验证证据不足时的完整收敛
- Why: 安全收敛本身也是完整结果的一部分
- How: 依据不足时给出明确缺口和可继续交付
- Oracle:
  1. 证据不足时，完整链路仍给出明确缺口和可继续方式。
  2. 不会在 backend 末端伪造“已完成”的最终答案。
  3. 如果已有部分成果，会以部分交付形式保留。
- Not: 不验证页面级布局与交互细节。

`entire-terminal-approval-to-docx-update`

- 实现状态: `未实现`
- What: 验证审批分支下的文档闭环
- Why: 审批分支必须和业务目标最终接上
- How: 先通过审批执行命令拿到产物，再写回现有周报模板
- Oracle:
  1. 审批通过后才执行命令并取得中间产物。
  2. 取得的产物会被继续写回目标 docx，而不是停在终端输出。
  3. 最终交付同时反映审批链路和文档更新结果。
- Not: 不验证页面级布局与交互细节。

#### scenario

`entire-kb-to-docx-hybrid`

- 实现状态: `未实现`
- What: 验证检索到文档的完整链路
- Why: 这是典型的混合任务 backend 闭环
- How: 先查规范，再改模板文档，结果可消费
- Oracle:
  1. KB 证据会驱动 docx 修改，而不是两段链路彼此脱节。
  2. 最终文档结果和知识依据同时存在，可回看来源。
  3. 混合链路能在 backend 内闭环收敛。
- Not: 不验证页面级布局与交互细节。

`entire-follow-up-continuation`

- 实现状态: `未实现`
- What: 验证多轮续做闭环
- Why: backend 也必须证明 follow-up 能成立
- How: 接续前文后继续完成修改或补写
- Oracle:
  1. 本轮会接续上一轮已有上下文或产物继续执行。
  2. 最终结果体现的是“继续做”后的更新，而不是重复旧结果。
  3. 续做链路能在 backend 内闭环完成或安全收敛。
- Not: 不验证页面级布局与交互细节。

#### live

`entire-live-docx-rewrite-review-ready`

- 实现状态: `未实现`
- What: 验证 live 文档改写闭环
- Why: backend 最小完整交付必须在 live 成立
- How: 在真实模型下完成 docx 改写并进入可审阅结果
- Oracle:
  1. backend 完整链路最终产出可审阅的 docx 结果或审阅引用。
  2. 修改内容与用户改写诉求一致，而不是只完成读取。
  3. 最终结果不是无故阻塞，且交付可被后续审阅消费。
- Not: 不验证页面级布局与交互细节。

`entire-live-kb-to-docx-hybrid`

- 实现状态: `未实现`
- What: 验证 live 混合任务闭环
- Why: 混合闭环是 backend 能力连贯性的关键证明
- How: 在真实模型下先检索再改文档并形成可消费结果
- Oracle:
  1. KB 证据会驱动 docx 修改，而不是两段链路彼此脱节。
  2. 最终文档结果和知识依据同时存在，可回看来源。
  3. 混合链路能在 backend 内闭环收敛。
- Not: 不验证页面级布局与交互细节。

### 4.7 `final`

做什么：用真实页面交互模拟用户提出问题、等待执行、拿到结果的完整 e2e 流程。

为什么：这是最终验收层，判断标准不是某一层是否通过，而是用户是否真的在页面上解决了问题。

怎么做：围绕高价值真实任务做完整 e2e。审批、workspace required、review 和续做等页面交互，只有在它们直接影响任务最终完成时才纳入正式 case。`final` 阶段的完成判断默认以真实模型下的 `live` e2e 为准。

#### basic

`final-docx-rewrite-completion`

- 实现状态: `未实现`
- What: 验证文档类最终完成
- Why: 这是最核心的页面级主任务
- How: 用户在 AI 模式中输入改写诉求，最终拿到可消费文档结果或审阅结果。对齐 PRD：`WB-COMPOSER-003`、`WB-PANEL-003`、`WB-REVIEW-001`、`WB-REVIEW-003`、`WB-REVIEW-004`、`WB-REVIEW-005`。
- Oracle:
  1. 用户发起任务后，主区先出现 assistant 占位并最终收敛到可消费结果。对齐 `WB-COMPOSER-003-AC1`、`WB-COMPOSER-003-AC2`。
  2. 若结果进入 review，页面能从文件查看顺畅进入确认修改流程。对齐 `WB-PANEL-003-AC2`、`WB-REVIEW-001-AC1`。
  3. 结束态不残留无效确认操作，且结果语义与原诉求一致。对齐 `WB-REVIEW-005-AC1`、`WB-REVIEW-005-AC2`。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-kb-answer-completion`

- 实现状态: `未实现`
- What: 验证知识库问答最终完成
- Why: 问答是最直接、最可感知的完成标准
- How: 用户在 AI 模式中提问，最终拿到答案和依据展示。对齐 PRD：`WB-CORE-001`、`WB-COMPOSER-003`。
- Oracle:
  1. 用户提问后，主区能看到最终答案。对齐 `WB-COMPOSER-003-AC2`。
  2. 答案附带依据展示或可回看的引用，且不伪装成无来源结论。对齐 `WB-CORE-001` 的可用性边界。
  3. 整个交互以用户可消费结果结束，而不是停在运行中或空白态。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

#### boundary

`final-terminal-approval-completion`

- 实现状态: `未实现`
- What: 验证审批分支最终完成
- Why: 审批链路必须在真实交互里验证
- How: 覆盖等待审批、批准继续、拒绝收敛，并最终回到用户目标。对齐 PRD：`WB-BLOCKER-001`。
- Oracle:
  1. 需要审批时，页面会暂停并展示审批条。对齐 `WB-BLOCKER-001-AC1`、`WB-BLOCKER-001-AC2`。
  2. 批准后流程继续回到用户目标，拒绝后安全收敛并说明原因。
  3. 无论批准还是拒绝，都不会出现伪造“已完成”的假结果。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-workspace-required-and-resume`

- 实现状态: `未实现`
- What: 验证工作区补充后的恢复能力
- Why: 本地优先链路必须证明可以中断后恢复
- How: 工作区缺失时提示补充，补充后继续运行并完成目标。对齐 PRD：`WB-COMPOSER-005`、`WB-BLOCKER-002`。
- Oracle:
  1. 缺少 workspace 时，不会直接启动本地执行，并会明确提示补充工作区。对齐 `WB-COMPOSER-005-AC1`、`WB-COMPOSER-005-AC2`。
  2. 补充 workspace 后，页面会插入“已补充工作区上下文，请继续处理上一条请求。”并重新启动原请求。对齐 `WB-BLOCKER-002-AC1`、`WB-BLOCKER-002-AC2`。
  3. 恢复后的最终结果仍对应最初用户目标，而不是重新开题。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

#### scenario

`final-kb-docx-hybrid-completion`

- 实现状态: `未实现`
- What: 验证混合任务最终完成
- Why: 混合任务最能体现整套架构是否连贯
- How: 先检索后改文档的链路在界面中完整跑通。对齐 PRD：`WB-CORE-002`、`WB-COMPOSER-003`、`WB-PANEL-003`。
- Oracle:
  1. 页面链路先完成检索，再完成文档修改或审阅结果生成。
  2. 最终用户既能拿到文档结果，也能回看依据。
  3. 混合任务不会在 UI 层断成两个互不关联的半成品。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-follow-up-continuation`

- 实现状态: `未实现`
- What: 验证多轮续做最终完成
- Why: 连续对话是 Core AI 系统的核心使用方式
- How: 接续上一轮产物继续修改，并让用户拿到更新后的结果。对齐 PRD：`WB-SESSION-005`。
- Oracle:
  1. 第二轮交互会接住上一轮产物、上下文或 review 结果继续处理。对齐 `WB-SESSION-005-AC1`。
  2. 最终显示的是更新后的结果，而不是重复上一轮输出。对齐 `WB-SESSION-005-AC2`。
  3. 多轮对话上下文在页面里保持连续，不丢任务主线。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-review-confirm-session-completion`

- 实现状态: `未实现`
- What: 验证确认文档提交闭环
- Why: 文档任务现在以“确认文档副本 -> normalize -> 替换源文件”为最终收敛路径，页面必须证明这条链路成立
- How: 用户在 workbench 中打开确认文档，确认提交后检查结束态状态卡与源文件入口。对齐 PRD：`WB-PANEL-003`、`WB-REVIEW-001`、`WB-REVIEW-003`、`WB-REVIEW-004`、`WB-REVIEW-005`。
- Oracle:
  1. 待确认阶段只展示确认文档副本入口和确认相关操作，不把源文件冒充成确认文档。对齐 `WB-PANEL-003-AC2`、`WB-REVIEW-001-AC1`。
  2. 提交成功后页面切到结束态状态卡，不再展示确认文档预览或确认文档打开按钮。对齐 `WB-REVIEW-004-AC1`、`WB-REVIEW-005-AC1`。
  3. 结束态里用户只能通过明确的“源文件”入口继续查看结果，页面标签与目标文件语义一致。对齐 `WB-REVIEW-005-AC2`。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-review-multi-targets-preserved`

- 实现状态: `未实现`
- What: 验证同一轮多个确认文档入口不会丢失
- Why: 一次 run 修改多个 docx 时，如果 workbench 只保留一个确认入口，用户就无法完成其余文档的确认
- How: 同一轮 E2E fixture 生成多个确认文档，检查 assistant turn 和右侧面板都能逐个进入。对齐 PRD：`WB-REVIEW-007`。
- Oracle:
  1. 同一 run 下生成的多个确认文档都会出现在同一 assistant turn 的确认列表里。对齐 `WB-REVIEW-007-AC1`。
  2. 点击不同确认文档入口时，右侧会加载对应的确认会话，而不是始终停留在最后一个。对齐 `WB-REVIEW-007-AC2`。
  3. 多个确认会话之间不会互相覆盖或丢失导航入口。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-review-conflict-blocks-commit`

- 实现状态: `未实现`
- What: 验证确认文档与源文件冲突时的阻断
- Why: 用户外部修改源文件后，系统必须阻止基于旧确认文档直接覆盖
- How: 生成确认文档后人为制造源文件变化，再进入提交前校验与提交入口。对齐 PRD：`WB-REVIEW-003`。
- Oracle:
  1. 页面会展示源文件冲突提示，而不是把旧确认文档当成可直接提交的结果。对齐 `WB-REVIEW-003-AC1`。
  2. 提交按钮在冲突未解决前不可用，或点击后会被校验阻断。对齐 `WB-REVIEW-003-AC1`。
  3. 冲突态不会伪造“已提交”或错误清理确认文档。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

#### live

`final-live-docx-rewrite-completion`

- 实现状态: `未实现`
- What: 验证 live 文档类最终完成
- Why: 页面主路径必须以 live 为准
- How: 在真实模型下，用户通过界面拿到可消费文档结果或审阅结果。对齐 PRD：`WB-COMPOSER-003`、`WB-PANEL-003`、`WB-REVIEW-001`、`WB-REVIEW-003`、`WB-REVIEW-004`、`WB-REVIEW-005`。
- Oracle:
  1. 用户通过页面输入改写诉求后，最终拿到可消费文档结果或审阅结果。
  2. 结果与原始改写要求一致，而不是只返回解释文本。
  3. 页面级链路能收敛到完成态，不卡在中间流程。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-live-kb-answer-completion`

- 实现状态: `未实现`
- What: 验证 live 知识问答最终完成
- Why: 最直观的用户价值必须在真实模型下成立
- How: 在真实模型下，界面中问答能稳定返回答案和依据展示。对齐 PRD：`WB-CORE-001`、`WB-COMPOSER-003`。
- Oracle:
  1. 用户提问后，页面中能看到最终答案。
  2. 答案附带依据展示或可回看的引用。
  3. 整个交互以用户可消费结果结束，而不是停在运行中或空白态。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-live-kb-docx-hybrid-completion`

- 实现状态: `未实现`
- What: 验证 live 混合任务最终完成
- Why: 混合任务是最终验收层的重要能力证明
- How: 在真实模型下，先检索再改文档的页面链路完整跑通。对齐 PRD：`WB-CORE-002`、`WB-COMPOSER-003`、`WB-PANEL-003`。
- Oracle:
  1. 页面链路先完成检索，再完成文档修改或审阅结果生成。
  2. 最终用户既能拿到文档结果，也能回看依据。
  3. 混合任务不会在 UI 层断成两个互不关联的半成品。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-live-workspace-required-and-resume`

- 实现状态: `未实现`
- What: 验证 live 工作区补充后的恢复能力
- Why: 本地优先恢复链路必须用真实交互证明
- How: 在真实模型下，工作区缺失后补充并继续运行仍能完成目标。对齐 PRD：`WB-COMPOSER-005`、`WB-BLOCKER-002`。
- Oracle:
  1. 缺少 workspace 时，页面会明确提示补充。
  2. 补充 workspace 后，原任务能够继续而不是重新开题。
  3. 恢复后的最终结果仍对应最初用户目标。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。

`final-live-review-confirm-session-completion`

- 实现状态: `未实现`
- What: 验证 live 确认文档提交闭环
- Why: 确认文档模式是 live 文档任务的真实收敛路径，必须在真实模型下成立
- How: 在真实模型下完成文档修改，进入确认文档，提交后检查页面结束态与源文件结果。对齐 PRD：`WB-PANEL-003`、`WB-REVIEW-001`、`WB-REVIEW-003`、`WB-REVIEW-004`、`WB-REVIEW-005`。
- Oracle:
  1. 待确认阶段只展示确认文档副本入口和确认相关操作，不把源文件冒充成确认文档。
  2. 提交成功后页面切到结束态状态卡，不再展示确认文档预览或确认文档打开按钮。
  3. 结束态里用户只能通过明确的“源文件”入口继续查看结果，页面标签与目标文件语义一致。
- Not: 不验证内部 graph 中间 state 与低层工具实现细节。
