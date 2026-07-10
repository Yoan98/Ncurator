# NCurator-Desktop Workbench 测试计划

## 1. 总体目标

- 本计划用于定义 Workbench 用户可见交互能力的回归测试范围。
- Workbench 回归测试统一对齐 [workbench.md](/Users/test/work-space/NCurator-Desktop/doc/prd/workbench.md)，新增、调整或验收结论都应引用对应的 `WB-*` 需求编号与验收编号。
- 新增或调整测试、runner、raw logs、UI E2E 回归规则与真实 AI / live 断言规则，统一遵循 `doc/test.md`。
- Workbench UI E2E 回归测试必须通过真实 Electron UI 配模型、配工作区、发送消息、选择 `@` 资料、搜索、预览、回退和操作右侧面板。
- 涉及 AI 的 Workbench UI E2E 回归测试必须使用真实模型调用；测试只从 `AI_LIVE_BASE_URL`、`AI_LIVE_API_KEY`、`AI_LIVE_PRIMARY_MODEL_NAME` 读取 live 配置，并在应用内未配置时通过 Settings UI 新增配置。
- 真实执行 case 时，如果失败来自新的生产行为缺口或必须修改业务实现才能通过，不在测试实现中硬改生产行为；统一记录为待产品 / 生产实现决策项。

## 2. 执行摘要

### 2.1 当前状态

- 总体登记：`23` 个 e2e case，`1` 个 backend contract case。
- 当前有效结论：`20 / 23` 个 e2e case 已有有效通过；`web-read-from-search-result`、`web-read-direct-url`、`web-search-diagnostic` 已登记为网页能力补充回归，其中新增读取 case 待执行更新结论；`chat-run-service-contract` backend contract 有效通过。

### 2.2 按 Suite 汇总

- `conversation`
  - 登记 case：`9`
  - 有效通过：`9 / 9`
  - 检测时间：`2026-07-10 16:26:14 +0800`
  - 备注：`composer-attachments-context`、`composer-text-selection`、`reference-mention-keyboard`、`send-guard-mode-switch-and-preferences`、`workspace-root-path-required`、`user-message-actions`、`reference-token-lifecycle`、`session-delete-confirmation-and-context-ring`、`session-initial-create-and-title` 均已通过真实 Electron UI；涉及 AI 的 case 使用真实模型。
- `run`
  - 登记 case：`9` 个 e2e，`1` 个 backend contract
  - 有效通过：`6 / 9` 个 e2e，`1 / 1` 个 backend contract
  - 检测时间：e2e `2026-07-10 17:19:39 +0800`；backend `2026-07-10 16:25:36 +0800`
  - 备注：`ai-process-stream-and-final-answer`、`approval-batch-flow`、`stop-running-or-approval-run`、`run-navigation-snapshot-replay`、`web-search-diagnostic`、`browser-use-task-panel` 已通过真实 Electron UI、真实模型、真实 workspace 索引和真实 AI run；`web-read-from-search-result`、`web-read-direct-url` 为新增网页读取回归，待执行后更新有效结论；`chat-run-service-contract` 已通过 backend contract。`browser-use-task-panel` 使用当前用户选择的 `AI_LIVE_*` 配置，不引入 browser 专用模型配置；DashScope / openai-compatible / `deepseek-v4-flash` 已通过 Stagehand deepseek provider 映射、URL 先导航和 browser_use 结果摘要完成回归。
- `result`
  - 登记 case：`5`
  - 有效通过：`5 / 5`
  - 检测时间：`2026-07-10 16:26:14 +0800`
  - 备注：`docx-apply-force-revert-warning`、`docx-apply-panel-preview-and-revert`、`multi-file-apply-tabs`、`file-preview-actions`、`search-results-open-rules` 均已通过真实 Electron UI；`multi-file-apply-tabs` 使用两个真实小 docx 副本降低 live 模型处理大文档时的非确定性，仍覆盖真实多文件写回入口和右侧单文件面板切换。

### 2.3 当前边界

- Workbench UI E2E 回归测试通过脚本在 case 运行时把 `tests/fixtures/workspace` 复制到临时目录，并默认通过 Settings UI 创建工作区、绑定真实目录、检查更新和更新索引。
- Workbench 正式 e2e 不允许直接调用 `workspacePrepare`、直接写模型配置、fake model、fake search、fake docx、fake AI event、fake attachment pick 或固定 document id。
- Workbench e2e 的 workspace 文件索引允许在测试环境通过 `NCURATOR_WORKSPACE_KNOWLEDGE_CACHE=1` 启用真实 split / vector 缓存；缓存只按文件内容 hash、扩展名、splitter 参数和 embedding model 复用计算结果，不替代 workspace 文件记录、document id、搜索结果或 UI 状态。
- Workbench 模型选择 helper 已改为通过真实下拉搜索选择 `AI_LIVE_PRIMARY_MODEL_NAME`；`ai-process-stream-and-final-answer` 已验证 `deepseek-v4-flash` 可通过真实 UI 搜索选中。
- Workbench UI E2E 回归测试需要真实索引完成信号和 UI 可见状态作为等待条件；IPC observer 和 job 查询只能作为辅助证据，不能用来造业务状态。
- `file-preview-actions` 当前按生产真实索引能力覆盖 `pdf/docx/md/txt`：`.md`、`.markdown`、`.txt` 必须通过真实索引进入搜索结果，并从搜索结果打开右侧预览。
- docx apply case 需要真实 docx 输入、真实 AI 编辑、真实写回记录、真实预览和真实回退。
- `browser-use-task-panel` 需要真实 AI run 触发 `browser_use` 并驱动内置浏览器完成本地网页任务；当前已使用 DashScope / openai-compatible / `deepseek-v4-flash` 完成有效通过，不能用 fake browser 替代。
- `web_search` 与 `web_crawl` 需要分开覆盖：搜索 case 只验证候选网页返回；读取 case 必须验证 AI 继续读取网页正文后再回答。
- Workbench 附件链路当前固定保存到 `<workspace>/.ncurator/assets/<assetBucketId>/`，`assetBucketId` 为输入草稿 UUID，发送给 AI 时只传附件名称与路径，不再做发送前识图或文件解析。

## 3. Suite 设计

Workbench 的回归测试顶层 suite 按用户任务闭环划分，而不是逐一复制 PRD 小节：

1. `conversation`
2. `run`
3. `result`

领域规则：

- `conversation` 验证用户发起任务前后的会话壳、composer、模式、模型 / 工作区偏好、工作目录前置条件与 `@` 参考资料 token。
- `run` 验证智能模式运行中的过程流、持久化恢复、停止、审批、压缩提示和 AI 内置浏览器任务。
- `result` 验证搜索结果、文件预览、修改文件工作区、真实 docx 预览、回退和多文件修改入口。
- Workbench 回归测试优先使用 `e2e`，因为核心风险集中在 Electron、renderer 状态、IPC、真实 AI 调用、右侧面板和文件系统联动。
- `backend` 只用于稳定的纯契约测试，例如参考资料候选过滤、搜索范围 payload 或会话 / 修改记录查询契约；不得用 backend case 代替真实 UI 交互断言。
- 涉及 AI 的 case 必须记录模型、耗时、完成度评分和失败归因；Oracle 继续引用 [workbench.md](/Users/test/work-space/NCurator-Desktop/doc/prd/workbench.md) 的需求编号与验收编号。
- AI 内置浏览器 case 必须验证右侧浏览器面板、网页操作结果和最终 assistant 输出形成闭环，不能只验证面板出现。
- docx apply 相关 case 必须使用真实 docx 文件验证预览与回退；仅写入 `.docx` 后缀文本文件不满足回归 case 口径。
- 依赖工作区语义的测试统一复用 `tests/fixtures/workspace` 作为共享输入目录，但该目录只作为真实输入文件来源。
- `How` 与 `Oracle` 必须显式映射到 [workbench.md](/Users/test/work-space/NCurator-Desktop/doc/prd/workbench.md) 的需求编号与验收编号。

## 4. 目录与命令

Workbench 回归测试目录：

```text
tests/case/workbench/
  conversation/
    session/
    composer/
    scope/
  run/
    process/
    blocker/
    browser/
    persistence/
  result/
    search/
    preview/
    apply/
```

回归测试命令：

- `pnpm test:workbench`
- `pnpm test:workbench:e2e`
- `pnpm test:workbench:backend`
- `node scripts/test-workflow.mjs --domain workbench`
- `node scripts/test-workflow.mjs --domain workbench --type e2e`
- `node scripts/test-workflow.mjs --domain workbench --type backend`

补充规则：

- `pnpm test:workbench:e2e` 是 Workbench UI E2E 回归测试入口。
- AI case 缺少 `AI_LIVE_BASE_URL`、`AI_LIVE_API_KEY`、`AI_LIVE_PRIMARY_MODEL_NAME` 时必须 preflight fail，不得静默跳过。
- `conversation / run / result` 是稳定 suite，不因 PRD 小节增删而轻易重排。
- suite 下的 `session / composer / message / scope / process / blocker / browser / search / preview / apply` 是 group，只在同一 suite 内用于收敛相近 case。

## 5. 回归测试清单

### 5.1 `conversation`

#### `session-initial-create-and-title`

- 测试类型：`e2e`
- What：验证首次进入 Workbench 时会自动创建初始会话，并在第一条用户消息真实发送后更新默认标题，第二条消息不再自动改写标题。
- Why：会话初始化和标题更新是 Workbench 最早的可见状态；失败时用户会看到空会话或无法区分任务主线。
- How：通过 Settings UI 新增真实模型配置；通过 Settings UI 创建并绑定真实工作区；进入 Workbench 后发送真实自然语言请求，再继续发送第二条真实请求。
- Oracle：没有历史会话时页面自动进入“新对话”，对齐 `WB-SESSION-001-AC1`、`WB-SESSION-001-AC2`；第一条用户消息后标题变为消息摘要，对齐 `WB-SESSION-003-AC1`；第二条消息不会再次自动改写标题，对齐 `WB-SESSION-003-AC2`；涉及 AI 的发送记录模型、耗时、完成度评分和失败归因。
- Not：不验证标题手动编辑，也不验证会话列表视觉样式。

#### `send-guard-mode-switch-and-preferences`

- 测试类型：`e2e`
- What：验证发送前置条件、模式切换保留输入、模型 / 工作区偏好恢复和失效回退。
- Why：Workbench 的任务入口依赖这些基础交互；任一状态失真都会导致用户无法发起任务或把任务发到错误上下文。
- How：通过 UI 配置真实模型和工作区；覆盖空输入、无工作区、发送中、模式切换、模型搜索、切换工作区 / 模型后重进页面，以及缓存候选失效后的回退；真实发送时走真实模型。
- Oracle：空白输入、未绑定工作区或发送中不会触发发送，且发送按钮 hover 可见禁用原因，对齐 `WB-COMPOSER-001-AC1` 至 `WB-COMPOSER-001-AC3`、`WB-COMPOSER-005-AC1`；拦截提示明确要求先选择工作区，对齐 `WB-COMPOSER-005-AC2`；切换模式后输入保留且发送路径按新模式执行，对齐 `WB-MODE-001-AC1`、`WB-MODE-001-AC2`；模型搜索、偏好恢复、失效回退、入口图标和“大聪明 / 没头脑”展示符合 `WB-COMPOSER-007-AC1` 至 `WB-COMPOSER-007-AC5`。
- Not：不验证真实模型回答质量，只验证用户路径和发送前置条件。

#### `user-message-actions`

- 测试类型：`e2e`
- What：验证用户消息 hover 操作、latest turn 编辑撤回、running 态编辑入口隐藏，以及用户消息附件展示。
- Why：用户编辑上一条消息依赖撤回最新 turn、回填 composer 和附件 UI 协同；任一状态错误都会导致重复发送、误编辑运行中消息或附件被正文挤压遮挡。
- How：使用真实 Workbench UI 创建工作区与会话，真实粘贴图片和 `md` 附件并发送 AI 请求；hover 用户消息并触发复制与编辑；在 running 状态检查用户消息气泡和附件布局。
- Oracle：hover 后显示时间、复制和编辑；复制给出成功反馈；编辑会撤回最新 turn 并把原文回填输入框；running 状态不显示编辑；图片和 `md` 附件显示在用户消息气泡上方，文件副标题显示 `MD`，输入框附件关闭按钮保持可点击且不被遮挡。
- Not：不验证模型回答质量；不再使用附件解析或图片识别 override。

#### `composer-attachments-context`

- 测试类型：`e2e`
- What：验证 `+` 与粘贴添加附件时，附件会保存到工作区 `.ncurator/assets/<assetBucketId>/`，不会提前创建真实会话，并保持图片预览、文件打开、删除、普通文本粘贴和格式提示行为。
- Why：附件链路已改为“统一落盘到工作区 + 只把路径交给 AI”，必须用回归测试守住真实保存路径和交互行为。
- How：创建真实工作区，通过真实粘贴图片和 `md` 文件触发产品附件保存逻辑；另外通过粘贴覆盖不支持格式和大文件 warning。
- Oracle：真实粘贴会触发附件保存；添加附件后没有真实会话；图片预览可打开；文件副标题显示 `MD`；不支持格式只提示不加入；大文件只提示不拦截；普通文本粘贴仍正常，对齐 `WB-COMPOSER-010-AC2`、`WB-COMPOSER-010-AC3`。
- Not：不验证系统原生文件选择器本身；不通过 `attachmentPickResponse` 或直接 `attachmentSaveFile` 伪造附件结果。

#### `reference-mention-keyboard`

- 测试类型：`e2e`
- What：验证 `@` 候选列表使用方向键移动时，当前高亮项能停在移动后的选项，不会因候选刷新跳回第一项。
- Why：`@` 候选选择依赖键盘稳定性；高亮项被刷新会导致用户插入错误资料范围。
- How：通过真实 Settings / Workbench UI 创建并准备真实工作区；在 composer 输入 `@` 打开候选列表，按 `ArrowDown` 后观察 active 候选项。
- Oracle：候选项数量大于 1；按下方向键后 active 候选项发生变化，并在短暂停留后保持不变，对齐 `WB-SCOPE-002-AC1` 与 `WB-COMPOSER-002-AC2` 的键盘交互口径。
- Not：不验证 AI run 或底层检索质量。

#### `workspace-root-path-required`

- 测试类型：`e2e`
- What：验证已选工作区但未设置工作文件地址时，Settings 和 Workbench 都会给出轻提示，且 Workbench 发送按钮保持禁用；绑定目录后恢复可发送。
- Why：工作区名称选择和工作目录绑定已经拆开，若缺少“未绑定目录不可发送”的明确反馈，用户会误以为工作区已经可用。
- How：通过 Settings UI 创建未绑定目录的真实工作区；在 Settings 文件 tab 验证轻提示；进入 Workbench 选择该工作区和真实模型，确认发送按钮禁用与 composer 提示；再回到 Settings 绑定真实目录，返回 Workbench 发送真实请求。
- Oracle：未设置工作文件地址时，Settings 文件 tab 会提示设置后才能在 Workbench 发送任务，对齐 `SET-WORKSPACE-006-AC3`；Workbench 发送按钮保持禁用且 composer 提示前往设置页绑定地址，对齐 `WB-COMPOSER-005-AC1`、`WB-COMPOSER-005-AC2`；绑定目录后恢复发送并完成真实 AI 运行，对齐 `WB-CORE-006-AC1`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证运行中补工作区恢复流；该产品语义已废弃。

#### `reference-token-lifecycle`

- 测试类型：`e2e`
- What：验证 `@` 参考资料候选覆盖工作区全部本地目录 / 文件与网页资料、目录 / 文件 / 网页 token 插入、多 token 共存、键盘删除、去重、切工作区清理和空候选提示。
- Why：显式参考资料是用户控制 AI 上下文的核心入口，错误会直接导致搜索或 AI 执行范围偏离用户意图。
- How：创建真实 workspace，绑定 `tests/fixtures/workspace`，等待真实文件扫描并准备索引状态；添加真实 web source 并等待真实网页索引完成；输入 `@` 触发候选，选择文件、目录、网页；候选应覆盖工作区下本地项并显示索引状态，其中 md/txt 索引完成后应显示为已索引；选中即追加，同一资料才去重；通过 Backspace 删除 token；切工作区清理旧 token。
- Oracle：候选来源符合当前工作区和模式，对齐 `WB-SCOPE-001-AC1`、`WB-SCOPE-001-AC2`；token 插入、共存和删除后发送参数符合 `WB-SCOPE-002-AC1` 至 `WB-SCOPE-002-AC3`；重复候选和跨工作区清理符合 `WB-SCOPE-003-AC1`、`WB-SCOPE-003-AC2`；空候选提示符合 `WB-SCOPE-004-AC1`、`WB-SCOPE-004-AC2`。
- Not：不验证底层 KB 检索排序质量，也不验证 Settings 工作区资料配置细节。

### 5.2 `run`

#### `ai-process-stream-and-final-answer`

- 测试类型：`e2e`
- What：验证智能模式真实发送后用户消息、assistant 占位、过程流、最终 markdown 输出和中间结果收口。
- Why：Workbench 的核心体验不是只启动 AI，而是让用户看见过程并得到可消费结果。
- How：真实工作区内准备带唯一事实的文件；用户通过 UI 发送自然语言总结请求；等待真实 AI run 完成。
- Oracle：发送后先出现用户消息和 assistant 占位，对齐 `WB-COMPOSER-003-AC1`；过程事件逐步追加，对齐 `WB-COMPOSER-003-AC2`；本地占位、总结等待层、最终 markdown 和链接行为符合 `WB-COMPOSER-003-AC3`、`WB-COMPOSER-003-AC4`；决策层不展示原始 chain-of-thought，对齐 `WB-COMPOSER-003-AC5`；最终回答包含 workspace 唯一事实并围绕用户诉求收口，对齐 `WB-CORE-005-AC1` 至 `WB-CORE-005-AC3`、`WB-CORE-006-AC1` 至 `WB-CORE-006-AC3`；记录模型、耗时、完成度评分和失败归因。
- Not：不对最终文案逐字断言，也不把真实模型质量问题误归因为 UI bug。

#### `run-navigation-snapshot-replay`

- 测试类型：`e2e`
- What：验证真实 AI 输出过程中切到 Settings，完成后回到 Workbench 能通过持久化 snapshot replay 恢复过程流和最终 assistant 回答。
- Why：Workbench route 切换会导致 renderer 重新挂载；如果运行态只存在 renderer 内存中，用户离开页面后会丢失 AI 过程和最终回答。
- How：通过 UI 配置真实模型和真实工作区；发送真实 AI 请求，等待过程流出现后切到 Settings；停留到 AI run 完成，再回到 Workbench 读取恢复后的过程流和最终回答。
- Oracle：切走前过程流已出现；返回 Workbench 后仍能通过 `chatSessionSnapshotGet.runs` replay 看到过程流条目和最终回答，且 run event 包含 `answer_completed` 与 `run_completed`，对齐 `WB-SESSION-002-AC3` 与 `WB-COMPOSER-003-AC7`；记录模型、耗时、完成度评分和失败归因。
- Not：不覆盖审批等待恢复；审批恢复由 `approval-batch-flow` 和 `chat-run-service-contract` 覆盖。

#### `chat-run-service-contract`

- 测试类型：`backend`
- What：验证 Main 侧 `ChatRunService` 对智能模式提交、assistant placeholder、AI run 状态、事件日志、审批 snapshot、启动中断恢复和会话删除清理的持久化契约。
- Why：运行持久化的真相来源已经从 renderer 收敛到 Main；这些后端契约失败时，route 切换、reload、审批恢复和最终消息落库都会失真。
- How：使用临时 LanceDB 初始化 `StorageService` 与 `ChatRunService`，关闭自动真实 AI 启动，通过 contract 方式提交 AI run 并注入 run event。
- Oracle：`chatSubmit(ai)` 创建 user message、assistant placeholder 与 `running` run；`answer_completed/run_completed` 后 assistant message、run status、final answer 和 event log 正确；`approval_batch_required` 后 snapshot 返回 `waiting_approval` 与 pending approval；已完成 run 的过程事件可从 snapshot `runs` 恢复，token 级事件不会污染 replay；启动恢复会把遗留 active run 标记为 failed 并写入“运行已中断”；删除会话会同步清理 messages、run 和 event log，对齐 `WB-COMPOSER-003-AC1`、`WB-COMPOSER-003-AC2`、`WB-COMPOSER-003-AC7`、`WB-SESSION-002-AC3`、`WB-SESSION-002-AC4`。
- Not：不代替真实 UI 对 route 切换、审批点击或模型输出质量的验证。

#### `approval-batch-flow`

- 测试类型：`e2e`
- What：验证真实 AI 运行中触发需审批 terminal 操作后，composer 上方审批卡片的同意、拒绝和指导输入流程。
- Why：审批是高风险 terminal 执行的用户确认边界；UI 误执行或误恢复都会破坏安全约束。
- How：通过真实用户请求诱导 AI 产生需要审批的 terminal 操作；分别覆盖全同意、任一拒绝、填写指导输入和不操作期间保持等待。
- Oracle：整批同意后按原 serial 顺序继续，对齐 `WB-BLOCKER-001-AC1`；任一拒绝或填写指导输入时本批命令 0 执行并回到后续 AI 决策，对齐 `WB-BLOCKER-001-AC2`；指导输入不作为独立第三按钮，对齐 `WB-BLOCKER-001-AC3`；审批不因固定超时自动失败，对齐 `WB-BLOCKER-001-AC4`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证 terminal 工具安全指令集本身，该能力归 AI tool 测试。

#### `approval-switch-session-consistency`

- 测试类型：`e2e`
- What：验证审批同意后立刻切换到其他会话，再切回原会话时，不再显示旧审批卡片。
- Why：审批状态已经由 SQLite transaction 管理；如果 UI 恢复仍读到旧 pending approval，用户会误以为还需要重复审批，但后台 run 已经继续执行。
- How：触发真实审批等待，点击同意后马上切换会话，再切回原会话。
- Oracle：切回后原会话不显示旧审批卡片，run 已从 `waiting_approval` 回到运行或完成状态，对齐 `WB-BLOCKER-001-AC1` 与会话恢复一致性要求。
- Not：不验证 terminal 工具本身执行结果；只验证审批状态持久化和会话切换恢复。

#### `chat-session-open-light-path`

- 测试类型：`backend`
- What：验证打开会话首屏只加载 session、最近 50 条消息和 active runs，不触发全量 run/event/context usage 查询。
- Why：会话切换卡顿的主要风险来自首屏路径过重，而不是单次 SQLite 查询本身。
- How：构造包含大量历史消息、run event 和 context usage 的会话，调用 `chatSessionOpen` 并观察 store 调用或返回范围。
- Oracle：返回最近 50 条消息且 seq 正序；只恢复 running / waiting approval runs；完整 event replay、context usage、file changes detail 不在首屏路径执行。
- Not：不验证前端滚动分页和详情展开；这些属于独立 UI 交互。

#### `stop-running-or-approval-run`

- 测试类型：`e2e`
- What：验证智能模式运行中底部发送按钮切换为停止图标，并能取消普通长任务和审批等待中的运行。
- Why：用户需要可靠中断长任务；审批等待时停止若不能释放等待，会造成运行态卡死。
- How：发送真实长任务请求和真实审批等待请求；运行中点击底部停止图标并观察运行态、审批态和反馈。
- Oracle：运行中发送按钮切换为停止图标且不显示独立取消按钮，对齐 `WB-COMPOSER-006-AC1`；点击停止后当前运行结束并给出已取消反馈，对齐 `WB-COMPOSER-006-AC2`；审批等待时点击停止也结束 run，对齐 `WB-COMPOSER-006-AC3`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证后端 abort signal 在每个 AI 节点内部的细节。

#### `browser-use-task-panel`

- 测试类型：`e2e`
- What：验证 AI 通过内置浏览器完成网页任务时，右侧浏览器面板、页面导航和真实网页操作结果形成闭环。
- Why：内置浏览器是 Electron 与 AI run 深度联动场景，仅 backend 或静态事件无法覆盖视口嵌入、导航和最终收口问题。
- How：启动本地测试网页；通过真实用户请求让 AI 使用 `browser_use` 操作页面；等待右侧浏览器面板打开、网页输入框被填入、提交按钮被点击，并从真实 browser_use 结果中读到页面结果。
- Oracle：收到浏览器面板事件后右侧进入内置浏览器状态并随面板 resize 对齐，对齐 `WB-PANEL-004-AC1`；传入 URL 时先导航再执行网页操作，对齐 `WB-PANEL-004-AC2`；切换其他面板或收起时浏览器视图不遮挡其他内容，对齐 `WB-PANEL-004-AC3`；任务完成后真实 browser_use 结果包含本地网页返回的 `BROWSER_TASK_DONE` 和口令，对齐 `WB-PANEL-004-AC4`、`WB-CORE-005-AC1`、`WB-CORE-006-AC1`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证公网网页稳定性；本 case 使用本地测试网页减少外部波动；不允许用 fake browser 或 fake tool result 替代；不要求 live 模型必须在固定时限内结束整轮最终回答，只要真实内置浏览器已完成输入、点击和结果读取即可判定 browser panel 能力有效。

#### `web-search-diagnostic`

- 测试类型：`e2e`
- What：验证真实 AI 针对“DeepSeek 最近融资情况”先调用 `web_search`，并拿到结构化候选网页。
- Why：网页搜索是实时信息入口；如果模型没有调用搜索工具或搜索工具没有返回候选，后续网页读取和回答都会变成编造。
- How：通过真实 Workbench UI 发送 DeepSeek 融资搜索请求；等待真实 AI run 完成；从 run event 中读取 `web_search` 调用、query 和结果数量。
- Oracle：run 完成；至少一次 `web_search` query 包含 DeepSeek；最后一次搜索结果 `ok=true` 且候选网页数量大于 0；不出现 fake search / fake AI 信号。
- Not：不要求读取候选网页正文；正文读取由 `web-read-from-search-result` 覆盖。

#### `web-read-from-search-result`

- 测试类型：`e2e`
- What：验证真实 AI 先用 `web_search` 搜索 DeepSeek 融资候选网页，再用 `web_crawl` 读取网页正文后总结。
- Why：搜索结果只是候选列表，不是正文证据；必须守住“搜索后读取正文”的真实网页信息闭环。
- How：通过真实 Workbench UI 发送“搜索 DeepSeek 最近融资情况并读取最相关网页正文后总结”；等待真实 AI run 完成；检查 `web_search` 与 `web_crawl` 的工具调用和结果。
- Oracle：run 完成；`web_search` query 包含 DeepSeek 且有候选结果；至少一次 `web_crawl` 成功；最终回答包含 DeepSeek 和融资 / 投资 / funding 相关信息；不出现 fake search / fake crawl / fake AI 信号。
- Not：不固定具体新闻网页、金额或日期，避免公网搜索结果变化导致误判。

#### `web-read-direct-url`

- 测试类型：`e2e`
- What：验证用户直接给 URL 时，真实 AI 使用 `web_crawl` 读取网页正文，并回答正文中的唯一口令。
- Why：直接 URL 读取是网页阅读的最小闭环，不能退化成浏览器点击任务或只复述 URL。
- How：启动本地 HTTP 页面并写入唯一口令；通过真实 Workbench UI 要求 AI 读取该 URL 正文；等待真实 AI run 完成。
- Oracle：run 完成；至少一次 `web_crawl` 成功；不调用 `browser_use`；最终回答包含本地网页唯一口令；不出现 fake crawl / fake AI 信号。
- Not：不验证网页索引入库，也不验证交互式浏览器操作；这些分别由 Settings 网页索引 case 与 `browser-use-task-panel` 覆盖。

### 5.3 `result`

#### `search-results-open-rules`

- 测试类型：`e2e`
- What：验证搜索模式发送、completed assistant 结果摘要、右侧搜索结果、网页 / 本地结果打开规则和无可检索资料下的发送拦截。
- Why：搜索模式是 Workbench 的非 AI 路径，必须确保不误启动 AI，且右侧结果操作符合用户预期。
- How：通过 UI 创建并绑定真实工作区，等待本地文件和网页资料真实索引完成；切换搜索模式发送自然语言查询；点击网页结果和本地结果操作图标；再切换到无可检索资料范围发送搜索。
- Oracle：搜索模式不启动 AI run，对齐 `WB-COMPOSER-004-AC1`；搜索提交期间防重复提交且成功后展示 completed assistant 结果摘要和右侧命中列表，对齐 `WB-COMPOSER-004-AC2`、`WB-COMPOSER-004-AC3`；网页结果调用系统浏览器、本地结果进入文件预览且正文区域无动作，对齐 `WB-PANEL-002-AC1`、`WB-PANEL-002-AC2`；无可检索资料时不执行发送并保留当前输入，对齐 `WB-MODE-002-AC1`、`WB-MODE-002-AC2`。
- Not：不验证 embedding 召回质量和排序算法。

#### `file-preview-actions`

- 测试类型：`e2e`
- What：验证右侧普通文件预览态的预览优先布局、定位文件、系统打开入口、PDF 命中定位，以及 Markdown / 纯文本预览。
- Why：右侧面板是用户消费搜索 / 引用结果的主要区域，预览布局错误会直接阻断阅读。
- How：从真实搜索结果打开真实 pdf、docx、md、txt 文件；检查右侧工具条、预览主体、返回路径、PDF 命中页定位、Markdown 标题 / 列表 / 表格 / 代码块渲染，以及纯文本换行保留。
- Oracle：普通文件打开后右侧主体用于预览且工具条提供定位文件和系统打开，对齐 `WB-PANEL-003-AC1`；PDF 搜索命中打开后保留整份 PDF 可滚动内容并定位到命中页，对齐 `WB-PANEL-003-AC3`；md/txt 必须来自真实索引搜索命中，并打开同一右侧文件预览面板。
- Not：不验证系统文件管理器或系统默认应用本身是否成功打开；不伪造 md/txt 搜索结果或右侧预览状态。

#### `docx-apply-panel-preview-and-revert`

- 测试类型：`e2e`
- What：验证 AI 修改真实 docx 后，assistant 修改文件入口、右侧修改文件工作区、当前记录预览和干净回退闭环。
- Why：直接写回和回退是 Workbench 文件编辑能力的安全边界，只看 artifact 事件无法证明用户能检查和撤销修改。
- How：通过 UI 选择真实 docx 资料并发送真实编辑请求；等待 AI 写回；点击 assistant turn 中的修改文件入口；检查右侧文件名、工作区路径、编辑标签、状态和预览；执行回退并重新读取文件内容。
- Oracle：修改后源文件立即成为 AI 最终净稿且 assistant turn 展示本轮修改文件入口，对齐 `WB-APPLY-002-AC1`；点击入口后右侧进入修改文件工作区并默认加载本轮当前文件记录，对齐 `WB-APPLY-001-AC1`、`WB-APPLY-001-AC3`；未发生后续修改时回退恢复 checkpoint 且记录状态变为 `reverted`，对齐 `WB-APPLY-003-AC1`、`WB-APPLY-003-AC3`；文件预览与修改文件工作区采用预览优先布局，对齐 `WB-PANEL-003-AC1`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证 docx 编辑算法的所有格式保真细节，该能力归 AI tool docx 测试。

#### `docx-apply-force-revert-warning`

- 测试类型：`e2e`
- What：验证 AI 写回后文件又被外部真实修改时，首次回退展示风险提示，确认后允许强制回退并刷新右侧状态。
- Why：强制回退是避免静默覆盖用户后续修改的关键安全交互。
- How：AI 写回真实 docx 后，由测试进程对同一个真实文件做外部修改；在右侧修改文件工作区点击回退，先观察风险提示，再确认强制回退。
- Oracle：检测到后续修改时首次回退不静默覆盖并展示风险提示，对齐 `WB-APPLY-004-AC1`；用户确认强制回退后恢复 checkpoint 或删除新建文件，对齐 `WB-APPLY-004-AC2`；右侧记录状态和预览在强制回退后刷新，对齐 `WB-APPLY-004-AC3`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证所有外部编辑器写入方式，只验证 checksum 不一致分支的用户可见交互。

#### `multi-file-apply-tabs`

- 测试类型：`e2e`
- What：验证同一轮 AI 修改多个文件时，assistant turn 保留全部入口；右侧修改文件面板只展示当前点击的单个文件记录。
- Why：多文件任务如果只保留最新或单个入口，用户无法检查和回退完整结果。
- How：通过 UI 选择至少两个真实 docx 文件并发送真实多文件编辑请求；等待 AI 写回；分别点击 assistant turn 中不同入口，检查右侧面板只显示被点击文件，并确认不再出现右侧文件 tab。
- Oracle：同一轮多个修改记录都会出现在同一 assistant turn 中，对齐 `WB-APPLY-005-AC1`；点击哪个修改文件入口，右侧就加载该文件记录，对齐 `WB-APPLY-001-AC2`；点击不同入口会加载对应记录和预览稿，而不是跳到最新轮次，对齐 `WB-APPLY-005-AC2`；全部本轮入口保留在 assistant turn 列表中，对齐 `WB-APPLY-005-AC3`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证不同 AI 轮次的全部历史筛选 UI，只覆盖同一轮多文件入口和当前轮次隔离。
