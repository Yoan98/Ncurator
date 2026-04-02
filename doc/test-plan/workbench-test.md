# NCurator-Desktop Workbench 测试计划

## 1. 总体目标

本计划用于定义 workbench 用户可见能力的正式测试范围。

workbench 正式测试统一对齐 [workbench.md](/Users/test/work-space/NCurator-Desktop/doc/prd/workbench.md)，新增、调整或验收结论都应引用对应的 `WB-*` 需求编号与验收编号。

正式 / temp 准入、runner、raw logs、report 与正式 case 共享字段，统一遵循 `doc/test.md`。

## 2. Suite 设计

workbench 的正式测试 suite 直接对齐 PRD 模块：

1. `core`
2. `session`
3. `composer`
4. `mode`
5. `scope`
6. `blocker`
7. `panel`
8. `review`


### 2.1 `core`

做什么：验证 workbench 的核心能力边界与上下文使用前提。

为什么：这是后续会话、发送、检索和执行的共同基础。

怎么做：围绕本地资料是否可选、显式资料范围是否影响执行、问答与受支持文件任务中的本地资料优先 / 模型知识回退、`terminal` 结果是否被后续交付消费、确认修改落盘能力边界是否清晰，以及标准任务是否能真正闭环交付组织正式 case。

### 2.2 `session`

做什么：验证会话初始化、切换、删除和续做主线保持。

为什么：会话状态一旦失真，后续所有运行态和右侧内容都会串线。

怎么做：围绕默认会话创建、切换重置、标题更新、删除后回退和同会话续做组织正式 case。

### 2.3 `composer`

做什么：验证输入、发送、取消和本地执行前置校验。

为什么：composer 是 workbench 的主入口，错误会直接放大到整条任务链路。

怎么做：围绕发送前置条件、键盘行为、智能/搜索发送路径、本地执行拦截、`terminal` 调用前置条件和取消运行组织正式 case。

### 2.4 `mode`

做什么：验证智能模式与搜索模式的切换和约束。

为什么：模式切换会直接改变发送路径、结果呈现和范围校验。

怎么做：围绕模式切换保持输入、搜索模式严格范围校验组织正式 case。

### 2.5 `scope`

做什么：验证 `@` 参考资料 token、工作区绑定分离和跨工作区清理规则。

为什么：资料范围是 workbench 和资料体系之间的核心接口。

怎么做：围绕候选来源、目录 / 文件 / 网页资料插入、多 token 共存、删除、重复去重、跨工作区清理和空候选提示组织正式 case。

### 2.6 `blocker`

做什么：验证 AI 运行中的阻塞、恢复和 warning。

为什么：审批、补工作区和未加载资料提示都会直接影响任务是否能继续完成。

怎么做：围绕审批阻塞、`workspace_required` 恢复和未加载资料 warning 组织正式 case。

### 2.7 `panel`

做什么：验证右侧内容面板的状态切换与内容打开规则。

为什么：搜索结果、文档查看和 review 入口都依赖右侧面板稳定收口。

怎么做：围绕空态、搜索结果、本地文档查看和 review 入口衔接组织正式 case。

### 2.8 `review`

做什么：验证确认修改流程。

为什么：review 是 workbench 中最直接影响文档落盘的用户可见链路。

怎么做：围绕 review 打开、默认选中、修改导航、提交前校验、现有受支持文件写回、新建受支持文件落盘、放弃、结束态、右侧回退和多 review 入口组织正式 case。

## 3. 领域特有规则

- Workbench 的用户可见行为默认归入本计划，不再挂到 AI 或 Settings 域下。
- `scope`、`workspace_required` 恢复、右侧面板和 `review` 统一归入 workbench。
- 当前 `tests/workbench/**` 下已实现的正式 case 只有 `panel` 与 `review` 的 6 条；本次新增的其余 case 默认先标记为 `未实现`。
- Workbench 当前不额外拆 `group`；若后续没有新增层级需求，正式 case 默认直接落在 `tests/workbench/<suite>/`。
- `How` 与 `Oracle` 必须显式映射到 [workbench.md](/Users/test/work-space/NCurator-Desktop/doc/prd/workbench.md) 的需求编号与验收编号。

## 4. 正式 Case 清单

### 4.1 `core`

#### `core-general-task-without-local-context`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证已绑定工作区但未显式选择任何本地参考资料时，智能模式仍可正常完成不依赖本地文档的通用任务。
- Why：如果系统把“没有显式本地参考资料”误当成硬前置，用户会直接把 workbench 感知成不可用。
- How：在已绑定工作区、无 `@` 范围的前提下，发送一个不涉及本地执行或文件修改的通用任务；对齐 `WB-CORE-001`，覆盖 `WB-CORE-001-AC1`、`WB-CORE-001-AC2`。
- Oracle：
  - 智能模式可以正常启动并产出 assistant 结果，而不是被错误拦截，对齐 `WB-CORE-001-AC1`。
  - 界面不会把“没有显式本地参考资料”表现成“无法使用 workbench”的错误状态，对齐 `WB-CORE-001-AC2`。
- Not：不验证本地执行、审批阻塞或确认修改。

#### `core-explicit-scope-affects-search-and-run`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证用户显式选择的参考资料，或仅绑定工作区时的默认工作区范围，会同时影响搜索模式和智能模式的执行收敛。
- Why：如果显式范围在任一路径上被忽略，用户就无法信任 workbench 的上下文控制。
- How：准备互斥的本地 / 网页资料 fixture，在搜索模式和智能模式下分别验证显式参考资料与“仅绑定工作区”的默认范围；对齐 `WB-CORE-002`，覆盖 `WB-CORE-002-AC1`、`WB-CORE-002-AC2`。
- Oracle：
  - 搜索模式结果只落在当前显式参考资料或工作区默认范围内，对齐 `WB-CORE-002-AC1`。
  - 智能模式最终结果不会忽略已经绑定的工作区或 `@` 参考资料，对齐 `WB-CORE-002-AC2`。
- Not：不验证资料不足时的模型知识回退。

#### `core-confirm-review-boundary-disclosure`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证 workbench 对“确认修改落盘能力”的边界表达准确：`docx` 可进入确认修改流程，其他类型不会被伪装成同一套保证能力。
- Why：这里需要守住的是确认修改 UI 的能力边界，而不是把 AI 的通用执行能力限制死。
- How：分别发起 `docx` 修改 / 新建任务与 `txt` / `md` 修改任务；对齐 `WB-CORE-003`，覆盖 `WB-CORE-003-AC1`、`WB-CORE-003-AC2`。
- Oracle：
  - `docx` 任务可进入确认修改落盘链路，对齐 `WB-CORE-003-AC1`。
  - `txt` / `md` 等非受支持类型不会被渲染成同一类确认修改入口或目标文件创建保证，对齐 `WB-CORE-003-AC2`。
- Not：不验证 `txt` / `md` 是否能被 AI 通过 `terminal` 尝试处理。

#### `core-local-first-with-general-fallback`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证用户绑定本地资料后，结果会优先使用本地资料；本地资料不足覆盖通用部分时，再退回模型通用知识继续完成。
- Why：这是 workbench 最核心的资料使用原则，一旦失真，结果要么脱离用户资料，要么无故阻塞。
- How：准备一份只覆盖部分事实的本地资料，发送同时需要本地事实和通用知识的任务；对齐 `WB-CORE-004`，覆盖 `WB-CORE-004-AC1`、`WB-CORE-004-AC2`。
- Oracle：
  - 结果中的本地部分明确收敛到当前资料范围，不会另起一套无关内容，对齐 `WB-CORE-004-AC1`。
  - 本地资料不足覆盖通用部分时，系统仍能继续给出可用结果，而不是无故阻塞，对齐 `WB-CORE-004-AC2`。
- Not：不验证 `terminal` 输出消费；该部分由单独 case 覆盖。

#### `core-terminal-result-consumed-by-delivery`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证智能模式中 `terminal` 的结果会被后续回答、分析或文件产物消费；若结果不足或执行失败，会明确说明限制。
- Why：如果 `terminal` 只留下“执行过”而不进入最终交付，执行链路对用户就是伪闭环。
- How：分别准备 `terminal` 成功和结果不足 / 失败的场景，检查最终用户可见输出；对齐 `WB-CORE-005`，覆盖 `WB-CORE-005-AC1`、`WB-CORE-005-AC2`。
- Oracle：
  - `terminal` 成功后，最终输出体现关键命令结果，对齐 `WB-CORE-005-AC1`。
  - `terminal` 输出不足或失败时，assistant 会明确说明限制，而不是编造结论或文档内容，对齐 `WB-CORE-005-AC2`。
- Not：不验证命令本身的风险审批细节；该部分由 blocker case 覆盖。

#### `core-standard-task-delivery-smoke`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证用户给出一个标准任务并提供足够上下文后，workbench 能沿同一条任务链完成资料使用、必要执行和最终交付。
- Why：单点 contract 都通过，不代表用户任务真的能完成；这条 case 是 workbench 价值的 smoke。
- How：准备已绑定工作区和可 `@` 的本地资料，发送一个需要结合显式范围与只读执行结果完成的标准任务；对齐 `WB-CORE-006`，并补充覆盖 `WB-CORE-002`、`WB-CORE-004`、`WB-CORE-005` 的主链路协同。
- Oracle：
  - 在上下文充分且无需额外阻塞时，系统能把任务推进到可消费的最终结果或明确产物，而不是停留在中间态，对齐 `WB-CORE-006-AC1`。
  - 最终结果同时体现用户显式范围和执行得到的关键信息，不会把范围、执行结果和最终交付割裂开，对齐 `WB-CORE-006-AC2`。
- Not：不验证 review 落盘和审批阻塞分支。

### 4.2 `session`

#### `session-bootstrap-and-title-update`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证无历史会话时会自动创建默认会话，并在首条用户消息发送后更新标题。
- Why：这是会话主线的起点，若首屏和标题更新不稳，后续所有操作都会建立在错误上下文上。
- How：在空会话列表下进入 workbench，发送首条超过 20 个字符的消息，再继续发送第二条消息；对齐 `WB-SESSION-001`、`WB-SESSION-003`。
- Oracle：
  - 初始化后自动进入标题为“新对话”的默认会话，对齐 `WB-SESSION-001-AC1`、`WB-SESSION-001-AC2`。
  - 首条用户消息发送后，会话标题更新为该消息前 20 个字符，对齐 `WB-SESSION-003-AC1`。
  - 第二条消息发送后，不会再次自动改写已有标题，对齐 `WB-SESSION-003-AC2`。
- Not：不验证切换、删除和续做。

#### `session-switch-resets-runtime-state`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证切换会话后，主区消息、输入草稿、`@` 范围、阻塞状态和右侧内容都切换到目标会话上下文。
- Why：会话切换一旦串线，用户会同时失去任务边界和当前操作可信度。
- How：先在当前会话建立输入草稿、`@` token、阻塞提示和右侧状态，再切换到另一会话；对齐 `WB-SESSION-002`，覆盖 `WB-SESSION-002-AC1`、`WB-SESSION-002-AC2`。
- Oracle：
  - 切换后主区展示目标会话的历史消息，对齐 `WB-SESSION-002-AC1`。
  - 上一会话的搜索结果、确认修改、审批 / 补工作区提示、输入草稿和范围 token 都不会继续残留，对齐 `WB-SESSION-002-AC2`。
- Not：不验证删除会话后的回退。

#### `session-delete-current-fallback`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证删除普通会话和当前会话后，列表与当前选中状态都会正确回退，页面保持可继续聊天。
- Why：删除是高频管理动作，如果删完会话后页面卡死，用户会直接丢失操作能力。
- How：准备至少两条会话，分别删除非当前会话和当前会话；对齐 `WB-SESSION-004`，覆盖 `WB-SESSION-004-AC1`、`WB-SESSION-004-AC2`。
- Oracle：
  - 删除成功后，被删会话不再出现在列表中，对齐 `WB-SESSION-004-AC1`。
  - 删除当前会话后，页面会回落到最新列表中的可用会话或自动补新会话，并保持可继续聊天，对齐 `WB-SESSION-004-AC2`。
- Not：不验证会话排序策略。

#### `session-follow-up-keeps-task-mainline`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证同一会话内基于上一轮结果继续 refinement 时，系统会复用当前任务主线，而不是把它误当成全新无关任务。
- Why：续做是 workbench 的关键价值之一，如果续做断线，用户每轮都要重新铺上下文。
- How：同一会话内先生成上一轮可复用的结果或 review，再发送局部补充 / 修改请求；对齐 `WB-SESSION-005`，覆盖 `WB-SESSION-005-AC1`、`WB-SESSION-005-AC2`。
- Oracle：
  - 续做请求发出后，系统会复用上一轮相关产物或上下文，而不是丢失任务主线，对齐 `WB-SESSION-005-AC1`。
  - 续做完成后的结果体现的是对上一轮结果的继续修改或补充，而不是简单重复旧输出或重新开题，对齐 `WB-SESSION-005-AC2`。
- Not：不验证跨会话续做。

### 4.3 `composer`

#### `composer-send-guards-and-shortcuts`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证发送前置条件和输入框键盘行为。
- Why：composer 是 workbench 主入口，任何误发或无法发送都会直接中断主链路。
- How：覆盖纯空白输入、`Enter` 发送、`Shift + Enter` 换行以及发送中重复提交；对齐 `WB-COMPOSER-001`、`WB-COMPOSER-002`。
- Oracle：
  - 纯空白输入不会触发发送，对齐 `WB-COMPOSER-001-AC1`。
  - 发送中不会重复提交第二次相同操作，对齐 `WB-COMPOSER-001-AC2`。
  - 按 `Enter` 后会触发当前模式对应的发送逻辑，对齐 `WB-COMPOSER-002-AC1`。
  - 按 `Shift + Enter` 后，输入区保留内容并新增换行，不触发发送，对齐 `WB-COMPOSER-002-AC2`。
- Not：不验证智能 / 搜索模式内部发送路径细节。

#### `composer-smart-mode-run-bootstrap`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证智能模式发送时，主区先插入用户消息和 assistant 占位壳，再由事件流逐步补全内容。
- Why：这是用户感知 AI 已经启动运行的第一个反馈点，若这里缺失，界面会像“没反应”。
- How：在智能模式发送请求，观察消息区和运行事件；对齐 `WB-COMPOSER-003`，覆盖 `WB-COMPOSER-003-AC1`、`WB-COMPOSER-003-AC2`。
- Oracle：
  - 发送后主区先可见用户消息与 assistant 占位消息，对齐 `WB-COMPOSER-003-AC1`。
  - assistant 内容通过事件流逐步更新，而不是一次性静态替换，对齐 `WB-COMPOSER-003-AC2`。
- Not：不验证阻塞和取消。

#### `composer-search-mode-summary-no-run`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证搜索模式发送时不启动 AI 运行，而是直接进入搜索结果态。
- Why：搜索模式和智能模式的分界一旦失真，用户就无法判断当前会不会触发 AI 执行。
- How：切到搜索模式发送请求，检查 run 状态、主区摘要和右侧面板；对齐 `WB-COMPOSER-004`，覆盖 `WB-COMPOSER-004-AC1`、`WB-COMPOSER-004-AC2`。
- Oracle：
  - 搜索模式发送后不产生 `runId`，对齐 `WB-COMPOSER-004-AC1`。
  - 主区出现结果摘要消息，右侧进入搜索结果态，对齐 `WB-COMPOSER-004-AC2`。
- Not：不验证搜索结果打开规则；该部分由 panel case 覆盖。

#### `composer-local-execution-requires-workspace`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证工作区未绑定时，workbench 的发送入口会统一被拦截，而不是只在本地执行类请求时才拦截。
- Why：实际交互要求用户先选择工作区；如果发送入口还能在无工作区状态下工作，产品口径和实现就会分裂。
- How：覆盖工作区列表为空或绑定失效的场景，分别尝试智能模式与搜索模式发送；对齐 `WB-COMPOSER-005`，覆盖 `WB-COMPOSER-005-AC1`、`WB-COMPOSER-005-AC2`。
- Oracle：
  - 无工作区绑定时，不会直接启动 AI 运行或纯搜索，对齐 `WB-COMPOSER-005-AC1`。
  - 拦截提示会明确要求先选择工作区，并说明未显式插入 `@` 时默认使用当前工作区全部已导入资料，对齐 `WB-COMPOSER-005-AC2`。
- Not：不验证 `workspace_required` 运行中恢复；该部分由 blocker case 覆盖。

#### `composer-cancel-running-run`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证智能模式在运行中会显示取消入口，取消后当前运行结束并给出已取消反馈。
- Why：没有稳定的取消链路，长任务就会把用户困死在不可控状态。
- How：准备一个可持续一段时间的运行，在运行中点击取消；对齐 `WB-COMPOSER-006`，覆盖 `WB-COMPOSER-006-AC1`、`WB-COMPOSER-006-AC2`。
- Oracle：
  - 只有运行中才显示取消入口，对齐 `WB-COMPOSER-006-AC1`。
  - 取消成功后，当前运行结束并给出已取消反馈，对齐 `WB-COMPOSER-006-AC2`。
- Not：不验证取消后的会话续做。

### 4.4 `mode`

#### `mode-switch-preserves-draft-and-route`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证智能模式和搜索模式之间切换时，共用同一输入区并立即按新模式执行。
- Why：模式切换是高频动作，若草稿丢失或路由滞后，用户会立刻失去信任。
- How：在输入框写入内容后切换模式，再分别发送；对齐 `WB-MODE-001`，覆盖 `WB-MODE-001-AC1`、`WB-MODE-001-AC2`。
- Oracle：
  - 切换模式后，当前输入内容仍保留，对齐 `WB-MODE-001-AC1`。
  - 切换后下一次发送会立即按新模式执行，对齐 `WB-MODE-001-AC2`。
- Not：不验证搜索模式严格范围校验。

#### `mode-search-strict-scope-empty-guard`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证搜索模式下显式严格范围里没有已加载本地资料时，纯搜索会被阻止并展示明确提示。
- Why：这是搜索模式的重要保护，避免用户在空范围上得到不可解释的“无结果”。
- How：选择一个严格范围但其中没有任何已加载资料，然后发送搜索请求；对齐 `WB-MODE-002`，覆盖 `WB-MODE-002-AC1`、`WB-MODE-002-AC2`。
- Oracle：
  - 严格范围为空命中时，搜索不会执行，对齐 `WB-MODE-002-AC1`。
  - 用户收到“当前搜索范围没有已加载的本地资料，无法执行纯搜索”的明确提示，对齐 `WB-MODE-002-AC2`。
- Not：不验证普通非严格范围搜索。

### 4.5 `scope`

#### `scope-candidate-sources-follow-workspace`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证 `@` 候选来源会随当前工作区变化。
- Why：候选来源错误时，后续所有 token 插入和范围控制都会偏离预期。
- How：分别覆盖“工作区尚未完成绑定”和“已选工作区”的状态下输入 `@`；对齐 `WB-SCOPE-001`，覆盖 `WB-SCOPE-001-AC1`、`WB-SCOPE-001-AC2`。
- Oracle：
  - 工作区尚未完成绑定时，不返回其他工作区的本地目录或文件，也不会把网页-only 作为正常发送路径暴露给用户，对齐 `WB-SCOPE-001-AC1`。
  - 选中工作区后，候选中同时可出现目录、文件和网页资料，对齐 `WB-SCOPE-001-AC2`。
- Not：不验证 token 插入后的发送参数。

#### `scope-insert-each-type-and-multi-token`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证目录、文件和网页资料三类候选都能成功插入输入框，并支持多个 token 共存。
- Why：这是用户最标准的 `@` 操作路径，必须单独稳定。
- How：在已选工作区下依次插入一个目录 token、一个文件 token、一个网页 token，再继续插入额外本地 token 并发送；对齐 `WB-SCOPE-002`，覆盖 `WB-SCOPE-002-AC1`、`WB-SCOPE-002-AC2`。
- Oracle：
  - 目录、文件和网页资料都能成功插入为 token，并保留在输入流中，对齐 `WB-SCOPE-002-AC1`。
  - 输入区支持多个 token 共存，而不是后插入覆盖前一个范围，对齐 `WB-SCOPE-002-AC2`。
  - 发送后，全部已插入 token 都会进入后续发送参数，对齐 `WB-SCOPE-002-AC1`、`WB-SCOPE-002-AC2`。
- Not：不验证重复去重和删除逻辑。

#### `scope-token-delete-dedupe-and-workspace-cleanup`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证已插入范围不会重复出现，删除后会退出发送参数，切换工作区后旧工作区 token 会被清理。
- Why：多 token 一旦进入真实使用，清理规则是最容易失真的部分。
- How：先插入多个本地 token，再检查去重、删除其中一个 token、切换工作区；对齐 `WB-SCOPE-002`、`WB-SCOPE-003`。
- Oracle：
  - 已插入范围不重复出现在候选中，对齐 `WB-SCOPE-003-AC1`。
  - 删除 token 后，对应范围不再参与后续发送，对齐 `WB-SCOPE-002-AC3`。
  - 切换工作区后，旧工作区的目录、文件和网页 token 自动清理，对齐 `WB-SCOPE-003-AC2`。
- Not：不验证空候选提示。

#### `scope-empty-candidate-hint`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证无可插入范围时，系统会按上下文展示明确提示。
- Why：空候选是 `@` 交互的重要兜底，提示错了用户就不知道下一步该怎么操作。
- How：分别覆盖“工作区尚未完成绑定”和“已选工作区但没有匹配项”；对齐 `WB-SCOPE-004`，覆盖 `WB-SCOPE-004-AC1`、`WB-SCOPE-004-AC2`。
- Oracle：
  - 工作区尚未完成绑定时，提示“请先选择工作区”，对齐 `WB-SCOPE-004-AC1`。
  - 已选工作区但没有匹配项时，提示“当前工作区中没有匹配项”，对齐 `WB-SCOPE-004-AC2`。
- Not：不验证候选列表视觉样式。

### 4.6 `blocker`

#### `blocker-approval-resume-and-reject`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证 AI 运行中的审批阻塞在批准和拒绝两条路径上都能稳定收敛。
- Why：审批阻塞是 workbench 中最直接影响任务继续与否的中断点。
- How：准备会触发审批的场景，分别执行批准和拒绝；对齐 `WB-BLOCKER-001`，覆盖 `WB-BLOCKER-001-AC1`、`WB-BLOCKER-001-AC2`。
- Oracle：
  - 审批条展示原因、风险级别、命令内容和批准 / 拒绝动作，对齐 `WB-BLOCKER-001`。
  - 审批通过后，当前运行恢复并继续执行，对齐 `WB-BLOCKER-001-AC1`。
  - 审批拒绝后，当前运行结束且被拒绝命令不会执行，对齐 `WB-BLOCKER-001-AC2`。
- Not：不验证命令执行结果是否被最终交付消费。

#### `blocker-workspace-required-replays-last-input`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证 `workspace_required` 作为运行时兜底恢复路径触发后，用户补工作区并点击继续时，会基于上一条真实输入重新启动运行。
- Why：虽然正常发送前已经要求工作区绑定，但如果恢复路径不能重放真实请求，异常状态下用户仍然会丢失任务主线。
- How：通过 stale/失效工作区场景触发 `workspace_required`，先不补工作区尝试继续，再补工作区后点击继续；对齐 `WB-BLOCKER-002`，覆盖 `WB-BLOCKER-002-AC1`、`WB-BLOCKER-002-AC2`。
- Oracle：
  - 未补工作区时，继续运行按钮不会绕过校验直接执行，对齐 `WB-BLOCKER-002-AC1`。
  - 补好工作区后，系统先插入“已补充工作区上下文，请继续处理上一条请求。”的用户消息，再以原请求重新启动运行，对齐 `WB-BLOCKER-002-AC2`。
- Not：不验证续跑后的最终任务结果质量。

#### `blocker-unloaded-sources-warning-by-mode`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证已选范围中存在未加载资料时，智能模式和搜索模式会显示不同 warning。
- Why：如果两种模式的 warning 混淆，用户会误解“为什么这次能读、那次搜不到”。
- How：选择包含未加载文件的范围，在智能模式和搜索模式下各发送一次请求；对齐 `WB-BLOCKER-003`，覆盖 `WB-BLOCKER-003-AC1`、`WB-BLOCKER-003-AC2`。
- Oracle：
  - 智能模式下提示 AI 可能直接读取原文件、耗时更长，对齐 `WB-BLOCKER-003-AC1`。
  - 搜索模式下提示纯搜索只检索已加载资料，未加载文件不会进入候选结果，对齐 `WB-BLOCKER-003-AC2`。
- Not：不验证未加载资料的后台准备逻辑。

### 4.7 `panel`

#### `panel-session-persistent-state`

- 测试类型：`e2e`
- 实现状态：`已实现`
- What：验证同一会话内继续发送消息时，右侧不会默认清空，而是保留当前搜索列表、文件预览或确认修改工作区；切换会话后才重置。
- Why：右侧从临时附属栏变为会话内持续工作区后，若状态被错误清空，用户会直接丢失当前阅读或确认上下文。
- How：在同一会话内先后覆盖搜索列表、文件预览和确认修改工作区三种状态，再发送新消息；随后切换到另一会话；对齐 `WB-PANEL-001`，覆盖 `WB-PANEL-001-AC1`、`WB-PANEL-001-AC2`。
- Oracle：
  - 同会话继续发送消息后，右侧仍保留当前相关状态，对齐 `WB-PANEL-001-AC1`。
  - 当前正在查看 A 文件时，B 文件的新 review 只能作为新 tab 加入，不能抢走当前焦点，对齐 `WB-PANEL-001-AC1`。
  - 切换会话后，右侧回到空态或新会话对应状态，对齐 `WB-PANEL-001-AC2`。
- Not：不验证 review 具体差异内容，只验证右侧状态收口。

#### `panel-search-local-preview-modal`

- 测试类型：`e2e`
- 实现状态：`已实现`
- What：验证搜索模式下点击本地结果会使用 modal 预览文件，关闭 modal 后仍停留在搜索列表；网页结果继续外部打开。
- Why：这是右侧从“列表+嵌入预览”切到“列表+modal”后的核心交互边界，错误会直接破坏搜索上下文。
- How：在搜索模式准备同时包含本地与网页结果的 fixture，分别点击两类结果；对齐 `WB-PANEL-002`，覆盖 `WB-PANEL-002-AC1`、`WB-PANEL-002-AC2`。
- Oracle：
  - 点击网页结果时，触发系统浏览器打开，不进入本地预览，对齐 `WB-PANEL-002-AC1`。
  - 点击本地结果时，打开文件预览 modal；关闭 modal 后，搜索列表和当前选中命中仍在，对齐 `WB-PANEL-002-AC2`。
- Not：不验证文档渲染细节和外部浏览器窗口样式。

#### `panel-preview-priority-layout`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证普通文件打开后，右侧主体空间默认让给文件预览，只保留轻量工具条。
- Why：文件预览如果被工具栏或其他面板挤占，用户会直接失去阅读主场景。
- How：打开一个普通本地文档预览，检查右侧布局和元素占用；对齐 `WB-PANEL-003`，覆盖 `WB-PANEL-003-AC1`。
- Oracle：
  - 普通文件打开后，右侧除轻量工具条外全部用于文件预览，对齐 `WB-PANEL-003-AC1`。
- Not：不验证 review 文件 tab 和提交动作。

### 4.8 `review`

#### `review-cumulative-docx-diff`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证同一文件多轮未提交修改后，最新 review 展示的是“源文件 vs 当前最新草稿”的累计差异，而不是仅最后一轮增量。
- Why：这是 `WB-REVIEW-008` 的核心语义，若后端仍按增量出 review，右侧会漏掉先前轮次仍然成立的差异。
- How：构造同一 `docx` 文件的源文档与最新草稿，覆盖“第一轮改第 3 块，第二轮改第 2 / 3 块”的场景，直接调用累计 diff 生成逻辑；对齐 `WB-REVIEW-008`，覆盖 `WB-REVIEW-008-AC1`、`WB-REVIEW-008-AC2`。
- Oracle：
  - 输出的 change seeds 同时包含相对源文件仍然成立的第 2 / 3 块差异，对齐 `WB-REVIEW-008-AC1`。
  - 若后一轮覆盖了前一轮某处改动，则输出只保留最新仍成立的差异，不残留旧标记，对齐 `WB-REVIEW-008-AC2`。
- Not：不验证 renderer tab 切换和 anchor 定位；这里只验证后端累计 diff 事实。

#### `review-table-cell-cumulative-diff`

- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证表格在行列结构不变时，会收敛成单元格级累计 diff；结构变化时退化为整表替换。
- Why：`docx` 的表格是累计 diff 最容易失真的结构，如果这里不稳，review 会错误放大为整块替换或漏掉单元格变更。
- How：分别构造“同一单元格多轮修改且表格结构不变”和“表格行列结构变化”的源文档 / 最新草稿，调用累计 diff 生成逻辑；对齐 `WB-REVIEW-008`，并补充支撑 `WB-REVIEW-004` 的文件级确认边界。
- Oracle：
  - 表格结构不变时，输出 `update_table_cell`，并指向正确的 `(row,col)` 单元格。
  - 表格结构变化时，输出退化为整表 `replace_block`，而不是错误地生成失真的单元格更新。
- Not：不验证 commit/discard UI；这里只验证表格 diff 退化策略。

#### `review-file-tabs-and-file-level-actions`

- 测试类型：`e2e`
- 实现状态：`已实现`
- What：验证多文件 review 在右侧按文件 tab 展示，切换 tab 后只操作当前文件，并保持预览优先布局。
- Why：这是新的 review 工作区核心入口，若 tab 聚合或文件级动作串线，会直接造成错误确认 / 放弃。
- How：准备同一会话内多个待确认文件，进入确认修改工作区后切换 tab，并分别执行确认或放弃；对齐 `WB-PANEL-003`、`WB-REVIEW-001`、`WB-REVIEW-004`、`WB-REVIEW-006`、`WB-REVIEW-007`。
- Oracle：
  - 右侧以一文件一 tab 展示全部 active review 文件，不会互相覆盖，对齐 `WB-PANEL-003-AC2`、`WB-REVIEW-007-AC2`。
  - 先确认替换当前文件后，只当前文件被写回并从 active tabs 中移除，其他文件继续保留，对齐 `WB-REVIEW-004-AC1`。
  - 放弃剩余文件时，只当前 tab 对应文件退出 review，其他文件不受影响，对齐 `WB-REVIEW-004-AC3`。
  - 当全部 active review 都结束后，右侧确认修改工作区回退为空态，不残留过期确认内容，对齐 `WB-REVIEW-006-AC1`。
- Not：不验证 docx 累计 diff 的具体内容；该部分由 backend case 覆盖。

#### `review-change-navigation-and-anchor`

- 测试类型：`e2e`
- 实现状态：`已实现`
- What：验证确认修改工作区通过上一处 / 下一处切换当前修改时，计数与 docx 预览 anchor 会同步变化。
- Why：这是 review 工作区的核心阅读路径，如果计数变化了但预览没定位，用户无法准确审阅对应差异。
- How：准备单文件 review，进入确认修改工作区后依次点击下一处和上一处，检查当前修改计数与 docx 预览 anchor；对齐 `WB-REVIEW-001`、`WB-REVIEW-002`。
- Oracle：
  - 打开 review 后默认选中第一条修改，对齐 `WB-REVIEW-001-AC2`。
  - 点击上一处 / 下一处时，当前修改计数明确变化，对齐 `WB-REVIEW-002-AC1`。
  - docx 预览随当前修改切换到不同 anchor，并可回到原始 anchor，对齐 `WB-REVIEW-002-AC2`。
- Not：不验证 docx 渲染像素细节；这里只验证导航与 anchor 对齐关系。

#### `review-pre-submit-validation-and-create-target`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证新建 `docx` 的确认修改在提交前会执行校验，只有 `ready=true` 时才允许最终创建目标文件。
- Why：提交前校验是确认落盘的门禁，如果这里失守，就会把无效确认副本直接写成最终文件。
- How：准备一个新建 `docx` 的 review，先覆盖校验失败再修复为通过，随后提交创建；对齐 `WB-REVIEW-003`、`WB-REVIEW-004`。
- Oracle：
  - 校验有问题时，界面逐条展示问题并阻止本次提交落盘，对齐 `WB-REVIEW-003-AC1`。
  - 校验通过后，界面允许继续完成确认创建，对齐 `WB-REVIEW-003-AC2`。
  - 提交成功后，仅当前文件 tab 对应的确认文档被创建为目标文件，对齐 `WB-REVIEW-004-AC2`。
- Not：不验证修改现有 `docx` 的覆盖写回。

#### `review-ended-state-collapse`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证 review 已 `committed`、`discarded` 或 `superseded` 后，界面会收敛为只读结束态。
- Why：结束态如果还暴露无效操作，用户很容易对已经结束的 review 再次误操作。
- How：分别制造 `committed`、`discarded` 和 `superseded` 的 review，打开对应详情；对齐 `WB-REVIEW-005`，覆盖 `WB-REVIEW-005-AC1`、`WB-REVIEW-005-AC2`。
- Oracle：
  - 已结束 review 不再展示提交、放弃和确认副本操作入口，对齐 `WB-REVIEW-005-AC1`。
  - 界面明确展示结束原因；若仍提供查看入口，只指向有效的源文件或当前可用结果，对齐 `WB-REVIEW-005-AC2`。
- Not：不验证结束原因的产生逻辑。

#### `review-turn-entries-preserved-and-cleared`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证同一 run 生成多个确认文档时，assistant turn 会保留全部入口；当当前会话 review 清空后，失效入口会同步清理。
- Why：如果 turn 入口被覆盖或不清理，用户会在主区看到失效导航，误以为还能继续确认。
- How：准备同一 run 生成多个 review 入口的场景，先检查 assistant turn 列表，再把当前会话所有 active review 处理完；对齐 `WB-REVIEW-006`、`WB-REVIEW-007`。
- Oracle：
  - 同一 run 生成的多个确认文档入口都会出现在同一 assistant turn 中，不会被后写 target 覆盖，对齐 `WB-REVIEW-007-AC1`。
  - 当前会话的 active review 清空后，assistant turn 不继续展示失效的确认修改入口，对齐 `WB-REVIEW-006-AC2`。
- Not：不验证右侧 review tab 的切换；该部分由多文件 review case 覆盖。
