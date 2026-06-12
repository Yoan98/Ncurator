# NCurator-Desktop Workbench 测试计划

## 1. 总体目标

- 本计划用于定义 Workbench 用户可见交互能力的正式测试范围。
- Workbench 正式测试统一对齐 [workbench.md](/Users/test/work-space/NCurator-Desktop/doc/prd/workbench.md)，新增、调整或验收结论都应引用对应的 `WB-*` 需求编号与验收编号。
- 正式 / 临时准入、runner、raw logs 与 Formal UI E2E 规则，统一遵循 `doc/test.md`。
- Workbench formal 测试重定义为真实 Electron e2e：通过 UI 配模型、配工作区、发送消息、选择 `@` 资料、搜索、预览、回退和操作右侧面板。
- Workbench formal e2e 不允许使用 fake model、fake search、fake docx、脚本化 AI 事件、脚本化 artifact、直接写 renderer 状态或直接调用内部 IPC 绕过用户路径。
- 涉及 AI 的 Workbench formal e2e 必须使用真实模型调用；测试只从 `AI_LIVE_BASE_URL`、`AI_LIVE_API_KEY`、`AI_LIVE_PRIMARY_MODEL_NAME` 读取 live 配置，并在应用内未配置时通过 Settings UI 新增配置。
- 如果实现 formal e2e 时发现必须改 `src/**` 或增加 testability 入口才能继续，本轮测试实现不修改生产代码，只记录为待产品 / 生产实现决策项。

## 2. 执行摘要

### 2.1 最近执行

- 检测时间：`未形成新的有效 formal 执行结论`
- 执行命令：`未执行完整有效 formal suite`
- 总体登记：`13` 个 e2e case。
- 当前有效结论：`0 / 13` 有效通过。
- 旧结论处理：`2026-06-12 11:14:15 +0800` 的 `6 / 12` 结果依赖 `[e2e:*]`、seed model、fake search、fake docx apply 等模拟路径，已废弃，不再作为 Workbench formal 结论。
- 当前实现状态：`tests/case/workbench/**` 下暂无 case 文件；旧模拟 case 和临时 blocker placeholder 均已删除，等待按本文重新设计并逐条实现。
- 最近验证执行：`2026-06-12 14:31:22 +0800` 运行 `pnpm test:workbench:e2e -- --case reference-token-lifecycle`，结果按预期失败在真实 UI 目录绑定阻塞点，确认不再静默跳过或模拟通过。

### 2.2 按 Suite 汇总

- `conversation`
  - 登记 case：`3`
  - 有效通过：`0 / 3`
  - 检测时间：`未形成新的有效 formal 执行结论`
  - 备注：暂无 case 实现；真实路径依赖 UI 配模型、UI 创建 / 绑定工作区和真实发送。
- `run`
  - 登记 case：`5`
  - 有效通过：`0 / 5`
  - 检测时间：`未形成新的有效 formal 执行结论`
  - 备注：暂无 case 实现；所有 AI 场景必须走真实模型和真实 AI run，审批、停止、browser_use 不能再用脚本化事件替代。
- `result`
  - 登记 case：`5`
  - 有效通过：`0 / 5`
  - 检测时间：`未形成新的有效 formal 执行结论`
  - 备注：暂无 case 实现；搜索、文件预览和 docx apply 必须来自真实索引、真实文件和真实 AI 写回记录。

### 2.3 待产品 / 生产实现决策的缺口

- Settings 工作区绑定目录当前通过系统原生目录选择器完成，Playwright 页面层无法像真实用户一样稳定选择 `tests/fixtures/workspace`；禁止使用 `pickDirectoryResponse` 或 `workspaceSetRootPath` 绕过后，依赖真实本地文件索引的 Workbench case 暂无法闭环。
- Settings 模型配置 UI 当前只提供 `base_url` 与 `api_key` 输入；Workbench 可以从真实远端模型列表中选择模型并保存默认模型，但如果远端模型列表未返回 `AI_LIVE_PRIMARY_MODEL_NAME`，页面没有手动填写 `default_model` / `model_name` 的用户路径。
- Workbench formal e2e 需要真实索引完成信号和 UI 可见状态作为等待条件；不得再读取内部 store 或注入 fixed document id 来制造搜索结果。
- docx apply case 需要真实 docx 输入、真实 AI 编辑、真实写回记录、真实预览和真实回退；旧的文本伪装 `.docx` 与脚本化 apply 记录均无效。
- `browser-use-task-panel` 需要真实 AI run 触发 `browser_use` 并驱动内置浏览器完成本地网页任务；旧脚本化 `browser_panel_opened` 事件无效。
- `src/main/testing/e2eFixtures.ts` 仍保留旧 `[e2e:*]` 替身基础设施；本轮按约束未修改 `src/**`，Workbench formal case 已停止使用，是否删除或隔离该生产侧测试入口需另行决策。

## 3. Suite 设计

Workbench 的正式测试顶层 suite 按用户任务闭环划分，而不是逐一复制 PRD 小节：

1. `conversation`
2. `run`
3. `result`

领域规则：

- `conversation` 验证用户发起任务前后的会话壳、composer、模式、模型 / 工作区偏好与 `@` 参考资料 token。
- `run` 验证智能模式运行中的过程流、停止、审批、补工作区、压缩提示和 AI 内置浏览器任务。
- `result` 验证搜索结果、文件预览、修改文件工作区、真实 docx 预览、回退和多文件修改入口。
- Workbench 正式测试优先使用 `e2e`，因为核心风险集中在 Electron、renderer 状态、IPC、真实 AI 调用、右侧面板和文件系统联动。
- `backend` 只用于稳定的纯契约测试，例如参考资料候选过滤、搜索范围 payload 或会话 / 修改记录查询契约；不得用 backend case 代替真实 UI 交互断言。
- 涉及 AI 的 case 必须记录模型、耗时、完成度评分和失败归因；Oracle 继续引用 [workbench.md](/Users/test/work-space/NCurator-Desktop/doc/prd/workbench.md) 的需求编号与验收编号。
- AI 内置浏览器 case 必须验证右侧浏览器面板、网页操作结果和最终 assistant 输出形成闭环，不能只验证面板出现。
- docx apply 相关 case 必须使用真实 docx 文件验证预览与回退；仅写入 `.docx` 后缀文本文件不满足正式 case 口径。
- 依赖工作区语义的测试统一复用 `tests/fixtures/workspace` 作为共享输入目录，但该目录只作为真实输入文件来源。
- `How` 与 `Oracle` 必须显式映射到 [workbench.md](/Users/test/work-space/NCurator-Desktop/doc/prd/workbench.md) 的需求编号与验收编号。

## 4. 目录与命令

正式 Workbench 测试目录：

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
  result/
    search/
    preview/
    apply/
```

正式命令：

- `pnpm test:workbench`
- `pnpm test:workbench:e2e`
- `pnpm test:workbench:backend`
- `node scripts/test-workflow.mjs --domain workbench`
- `node scripts/test-workflow.mjs --domain workbench --type e2e`
- `node scripts/test-workflow.mjs --domain workbench --type backend`

补充规则：

- `pnpm test:workbench:e2e` 是 Workbench formal UI e2e 的正式入口。
- AI case 缺少 `AI_LIVE_BASE_URL`、`AI_LIVE_API_KEY`、`AI_LIVE_PRIMARY_MODEL_NAME` 时必须 preflight fail，不得静默跳过。
- `conversation / run / result` 是稳定 suite，不因 PRD 小节增删而轻易重排。
- suite 下的 `session / composer / scope / process / blocker / browser / search / preview / apply` 是 group，只在同一 suite 内用于收敛相近 case。
- 每个正式 case 的 `caseId` 必须与最终测试文件名一致，并稳定映射到唯一日志目录。

## 5. 正式 Case 清单

### 5.1 `conversation`

#### `session-initial-create-and-title`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证首次进入 Workbench 时会自动创建初始会话，并在第一条用户消息真实发送后更新默认标题，第二条消息不再自动改写标题。
- Why：会话初始化和标题更新是 Workbench 最早的可见状态；失败时用户会看到空会话或无法区分任务主线。
- How：通过 Settings UI 新增真实模型配置；通过 Settings UI 创建并绑定真实工作区；进入 Workbench 后发送真实自然语言请求，再继续发送第二条真实请求。
- Oracle：没有历史会话时页面自动进入“新对话”，对齐 `WB-SESSION-001-AC1`、`WB-SESSION-001-AC2`；第一条用户消息后标题变为消息摘要，对齐 `WB-SESSION-003-AC1`；第二条消息不会再次自动改写标题，对齐 `WB-SESSION-003-AC2`；涉及 AI 的发送记录模型、耗时、完成度评分和失败归因。
- Not：不验证标题手动编辑，也不验证会话列表视觉样式。

#### `send-guard-mode-switch-and-preferences`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证发送前置条件、模式切换保留输入、模型 / 工作区偏好恢复和失效回退。
- Why：Workbench 的任务入口依赖这些基础交互；任一状态失真都会导致用户无法发起任务或把任务发到错误上下文。
- How：通过 UI 配置真实模型和工作区；覆盖空输入、无工作区、发送中、模式切换、模型搜索、切换工作区 / 模型后重进页面，以及缓存候选失效后的回退；真实发送时走真实模型。
- Oracle：空白输入、未绑定工作区或发送中不会触发发送，对齐 `WB-COMPOSER-001-AC1`、`WB-COMPOSER-001-AC2`、`WB-COMPOSER-005-AC1`；拦截提示明确要求先选择工作区，对齐 `WB-COMPOSER-005-AC2`；切换模式后输入保留且发送路径按新模式执行，对齐 `WB-MODE-001-AC1`、`WB-MODE-001-AC2`；模型搜索、偏好恢复、失效回退、入口图标和“大聪明 / 没头脑”展示符合 `WB-COMPOSER-007-AC1` 至 `WB-COMPOSER-007-AC5`。
- Not：不验证真实模型回答质量，只验证用户路径和发送前置条件。

#### `reference-token-lifecycle`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证 `@` 参考资料候选、目录 / 文件 / 网页 token 插入、多 token 共存、删除、去重、切工作区清理和空候选提示。
- Why：显式参考资料是用户控制 AI 上下文的核心入口，错误会直接导致搜索或 AI 执行范围偏离用户意图。
- How：通过 UI 创建真实 workspace，绑定 `tests/fixtures/workspace`，等待真实索引完成；通过 UI 添加真实 web source；输入 `@` 触发候选，选择文件、目录、网页；选中即追加，同一资料才去重；切工作区清理旧 token。
- Oracle：候选来源符合当前工作区和模式，对齐 `WB-SCOPE-001-AC1`、`WB-SCOPE-001-AC2`；token 插入、共存和删除后发送参数符合 `WB-SCOPE-002-AC1` 至 `WB-SCOPE-002-AC3`；重复候选和跨工作区清理符合 `WB-SCOPE-003-AC1`、`WB-SCOPE-003-AC2`；空候选提示符合 `WB-SCOPE-004-AC1`、`WB-SCOPE-004-AC2`。
- Not：不验证底层 KB 检索排序质量，也不验证 Settings 工作区资料配置细节。

### 5.2 `run`

#### `ai-process-stream-and-final-answer`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证智能模式真实发送后用户消息、assistant 占位、过程流、最终 markdown 输出和中间结果收口。
- Why：Workbench 的核心体验不是只启动 AI，而是让用户看见过程并得到可消费结果。
- How：真实工作区内准备带唯一事实的文件；用户通过 UI 发送自然语言总结请求；等待真实 AI run 完成。
- Oracle：发送后先出现用户消息和 assistant 占位，对齐 `WB-COMPOSER-003-AC1`；过程事件逐步追加，对齐 `WB-COMPOSER-003-AC2`；本地占位、总结等待层、最终 markdown 和链接行为符合 `WB-COMPOSER-003-AC3`、`WB-COMPOSER-003-AC4`；决策层不展示原始 chain-of-thought，对齐 `WB-COMPOSER-003-AC5`；最终回答包含 workspace 唯一事实并围绕用户诉求收口，对齐 `WB-CORE-005-AC1` 至 `WB-CORE-005-AC3`、`WB-CORE-006-AC1` 至 `WB-CORE-006-AC3`；记录模型、耗时、完成度评分和失败归因。
- Not：不对最终文案逐字断言，也不把真实模型质量问题误归因为 UI bug。

#### `approval-batch-flow`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证真实 AI 运行中触发需审批 terminal 操作后，composer 上方审批卡片的同意、拒绝和指导输入流程。
- Why：审批是高风险 terminal 执行的用户确认边界；UI 误执行或误恢复都会破坏安全约束。
- How：通过真实用户请求诱导 AI 产生需要审批的 terminal 操作；分别覆盖全同意、任一拒绝、填写指导输入和不操作期间保持等待。
- Oracle：整批同意后按原 serial 顺序继续，对齐 `WB-BLOCKER-001-AC1`；任一拒绝或填写指导输入时本批命令 0 执行并回到后续 AI 决策，对齐 `WB-BLOCKER-001-AC2`；指导输入不作为独立第三按钮，对齐 `WB-BLOCKER-001-AC3`；审批不因固定超时自动失败，对齐 `WB-BLOCKER-001-AC4`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证 terminal 工具安全指令集本身，该能力归 AI tool 测试。

#### `workspace-required-continue`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证 AI 运行中断为 `workspace_required` 后，用户补工作区并点击继续时可以基于原请求恢复运行。
- Why：工作区缺失是可恢复阻塞；如果恢复链路丢失原请求，用户会被迫重新描述任务。
- How：通过 UI 制造缺失或失效工作区状态并发送真实请求；再通过 Settings UI 补工作区，回到 Workbench 点击继续上一条请求。
- Oracle：未补工作区时继续按钮不会绕过校验，对齐 `WB-BLOCKER-002-AC1`；补工作区后插入“已补充工作区上下文，请继续处理上一条请求。”用户消息并以原请求重新启动运行，对齐 `WB-BLOCKER-002-AC2`；记录模型、耗时、完成度评分和失败归因。
- Not：不通过内部 API 直接把工作区标记为已补充。

#### `stop-running-or-approval-run`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证智能模式运行中底部发送按钮切换为停止图标，并能取消普通长任务和审批等待中的运行。
- Why：用户需要可靠中断长任务；审批等待时停止若不能释放等待，会造成运行态卡死。
- How：发送真实长任务请求和真实审批等待请求；运行中点击底部停止图标并观察运行态、审批态和反馈。
- Oracle：运行中发送按钮切换为停止图标且不显示独立取消按钮，对齐 `WB-COMPOSER-006-AC1`；点击停止后当前运行结束并给出已取消反馈，对齐 `WB-COMPOSER-006-AC2`；审批等待时点击停止也结束 run，对齐 `WB-COMPOSER-006-AC3`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证后端 abort signal 在每个 AI 节点内部的细节。

#### `browser-use-task-panel`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证 AI 通过内置浏览器完成网页任务时，右侧浏览器面板、页面导航、网页操作结果和最终回答形成闭环。
- Why：内置浏览器是 Electron 与 AI run 深度联动场景，仅 backend 或静态事件无法覆盖视口嵌入、导航和最终收口问题。
- How：启动本地测试网页；通过真实用户请求让 AI 使用 `browser_use` 操作页面；等待右侧浏览器面板、网页结果和最终 assistant 输出。
- Oracle：收到浏览器面板事件后右侧进入内置浏览器状态并随面板 resize 对齐，对齐 `WB-PANEL-004-AC1`；传入 URL 时先导航再执行网页操作，对齐 `WB-PANEL-004-AC2`；切换其他面板或收起时浏览器视图不遮挡其他内容，对齐 `WB-PANEL-004-AC3`；任务完成后最终 assistant 输出使用网页操作结果并与右侧浏览器状态形成闭环，对齐 `WB-PANEL-004-AC4`、`WB-CORE-005-AC1`、`WB-CORE-006-AC1`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证公网网页稳定性；本 case 使用本地测试网页减少外部波动。

### 5.3 `result`

#### `search-results-open-rules`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证搜索模式发送、搜索占位、右侧搜索结果、网页 / 本地结果打开规则和无可检索资料拦截。
- Why：搜索模式是 Workbench 的非 AI 路径，必须确保不误启动 AI，且右侧结果操作符合用户预期。
- How：通过 UI 创建并绑定真实工作区，等待本地文件和网页资料真实索引完成；切换搜索模式发送自然语言查询；点击网页结果和本地结果操作图标；再切换到无可检索资料范围发送搜索。
- Oracle：搜索模式不启动 AI run，对齐 `WB-COMPOSER-004-AC1`；搜索中和搜索成功状态符合 `WB-COMPOSER-004-AC2`、`WB-COMPOSER-004-AC3`；网页结果调用系统浏览器、本地结果进入文件预览且正文区域无动作，对齐 `WB-PANEL-002-AC1`、`WB-PANEL-002-AC2`；无可检索资料时不执行搜索并提示原因，对齐 `WB-MODE-002-AC1`、`WB-MODE-002-AC2`。
- Not：不验证 embedding 召回质量和排序算法。

#### `file-preview-actions`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证右侧普通文件预览态的预览优先布局、定位文件、系统打开入口和 PDF 命中定位。
- Why：右侧面板是用户消费搜索 / 引用结果的主要区域，预览布局错误会直接阻断阅读。
- How：从真实搜索结果或 assistant 内部链接打开真实 md、pdf、docx 文件；检查右侧工具条、预览主体、返回路径和 PDF 命中页定位。
- Oracle：普通文件打开后右侧主体用于预览且工具条提供定位文件和系统打开，对齐 `WB-PANEL-003-AC1`；PDF 搜索命中打开后保留整份 PDF 可滚动内容并定位到命中页，对齐 `WB-PANEL-003-AC3`。
- Not：不验证系统文件管理器或系统默认应用本身是否成功打开。

#### `docx-apply-panel-preview-and-revert`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证 AI 修改真实 docx 后，assistant 修改文件入口、右侧修改文件工作区、当前记录预览和干净回退闭环。
- Why：直接写回和回退是 Workbench 文件编辑能力的安全边界，只看 artifact 事件无法证明用户能检查和撤销修改。
- How：通过 UI 选择真实 docx 资料并发送真实编辑请求；等待 AI 写回；点击 assistant turn 中的修改文件入口；检查右侧默认 tab、状态和预览；执行回退并重新读取文件内容。
- Oracle：修改后源文件立即成为 AI 最终净稿且 assistant turn 展示本轮修改文件入口，对齐 `WB-APPLY-002-AC1`；点击入口后右侧进入修改文件工作区并默认加载本轮当前文件记录，对齐 `WB-APPLY-001-AC1`、`WB-APPLY-001-AC3`；未发生后续修改时回退恢复 checkpoint 且记录状态变为 `reverted`，对齐 `WB-APPLY-003-AC1`、`WB-APPLY-003-AC3`；文件预览与修改文件工作区采用预览优先布局，对齐 `WB-PANEL-003-AC1`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证 docx 编辑算法的所有格式保真细节，该能力归 AI tool docx 测试。

#### `docx-apply-force-revert-warning`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证 AI 写回后文件又被外部真实修改时，首次回退展示风险提示，确认后允许强制回退并刷新右侧状态。
- Why：强制回退是避免静默覆盖用户后续修改的关键安全交互。
- How：AI 写回真实 docx 后，由测试进程对同一个真实文件做外部修改；在右侧修改文件工作区点击回退，先观察风险提示，再确认强制回退。
- Oracle：检测到后续修改时首次回退不静默覆盖并展示风险提示，对齐 `WB-APPLY-004-AC1`；用户确认强制回退后恢复 checkpoint 或删除新建文件，对齐 `WB-APPLY-004-AC2`；右侧记录状态和预览在强制回退后刷新，对齐 `WB-APPLY-004-AC3`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证所有外部编辑器写入方式，只验证 checksum 不一致分支的用户可见交互。

#### `multi-file-apply-tabs`

- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证同一轮 AI 修改多个文件时，assistant turn 和右侧修改文件工作区保留全部入口，并能按文件 tab 切换对应记录。
- Why：多文件任务如果只保留最新或单个入口，用户无法检查和回退完整结果。
- How：通过 UI 选择至少两个真实 docx 文件并发送真实多文件编辑请求；等待 AI 写回；分别点击 assistant turn 中不同入口，并在右侧切换文件 tab。
- Oracle：同一轮多个修改记录都会出现在同一 assistant turn 中，对齐 `WB-APPLY-005-AC1`；打开工作区时默认落到当前文件 tab，对齐 `WB-APPLY-001-AC2`；点击不同入口或 tab 会加载对应记录和预览稿，而不是跳到最新轮次，对齐 `WB-APPLY-005-AC2`；切换 tab 时保留全部本轮入口和各自状态，对齐 `WB-APPLY-005-AC3`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证不同 AI 轮次的全部历史筛选 UI，只覆盖同一轮多文件入口和当前轮次隔离。
