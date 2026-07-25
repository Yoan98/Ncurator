# NCurator-Desktop Workbench 测试计划

## 1. 总体目标

- 本计划定义 Workbench 用户可见交互的回归范围，并对齐 [workbench.md](../prd/workbench.md) 的 `WB-*` 需求和验收编号。
- 通用测试、runner、raw logs、UI E2E 和 live 断言规则遵循 `doc/test.md`。
- Workbench UI E2E 回归测试必须通过真实 Electron UI 配模型、配工作区、发送消息、选择 `@` 资料、搜索、预览、回退和操作右侧面板。
- 涉及 AI 的 Workbench UI E2E 回归测试必须使用真实模型调用；测试只从 `AI_LIVE_BASE_URL`、`AI_LIVE_API_KEY`、`AI_LIVE_PRIMARY_MODEL_NAME`、`AI_LIVE_VISUAL_MODEL_NAME` 读取 live 配置，并在应用内未配置时通过 Settings UI 新增配置。
- case 因生产行为缺口失败时，不在测试中硬改业务行为，统一记录为产品或生产实现待决项。

## 2. 测试边界

- Workbench UI E2E 回归测试通过脚本在 case 运行时把 `tests/fixtures/workspace` 复制到临时目录，并默认通过 Settings UI 创建工作区、绑定真实目录、检查更新和更新索引。
- Workbench 正式 e2e 不允许直接调用 `workspacePrepare`、直接写模型配置、fake model、fake search、fake docx、fake AI event、fake attachment pick 或固定 document id。
- Workbench e2e 的 workspace 文件索引允许在测试环境通过 `NCURATOR_WORKSPACE_KNOWLEDGE_CACHE=1` 启用真实 split / vector 缓存；缓存只按文件内容 hash、扩展名、splitter 参数和 embedding model 复用计算结果，不替代 workspace 文件记录、document id、搜索结果或 UI 状态。
- Workbench 模型选择 helper 必须通过真实下拉搜索分别选择 `AI_LIVE_PRIMARY_MODEL_NAME` 和 `AI_LIVE_VISUAL_MODEL_NAME`。
- Workbench UI E2E 回归测试需要真实索引完成信号和 UI 可见状态作为等待条件；IPC observer 和 job 查询只能作为辅助证据，不能用来造业务状态。
- `file-preview-actions` 当前按生产真实索引能力覆盖 `pdf/docx/md/txt`：连续打开的文件要分别保留为资源 Tab，并能切回旧 Tab。
- docx apply case 需要真实 docx 输入、真实 AI 编辑、真实写回记录、真实预览和真实回退。
- text-file apply case 需要真实 Markdown 或代码文件、真实 `text_file_edit`、真实结构化 diff、独立 `TextFileDiffViewer` 和按原始 bytes 回退。
- `browser-use-task-panel` 需要真实 AI run 触发 `browser_use` 并驱动内置浏览器完成本地网页任务；同时验证多个浏览器 Tab 独立历史、共享持久站点数据、切换文件后网页状态不销毁，以及同 URL 标签不会让 Stagehand 串页，不能用 fake browser 替代。
- `web_search` 与 `web_crawl` 需要分开覆盖：搜索 case 只验证候选网页返回；读取 case 必须验证 AI 继续读取网页正文后再回答。
- Workbench 附件链路当前支持图片、`doc`、`docx`、`pptx`、`pdf`、`md`、`json`，统一保存到 `<workspace>/.ncurator/runtime/assets/<assetBucketId>/`；`assetBucketId` 为输入草稿 UUID，发送给 AI 时只传附件名称与路径，不再做发送前识图或文件解析。

## 3. Suite 设计

Workbench 顶层 suite 按用户任务闭环划分，不逐一复制 PRD 小节：

1. `conversation`
2. `run`
3. `result`

领域规则：

- `conversation` 验证会话、composer、模式、模型 / 工作区偏好、工作目录前置条件和 `@` 参考资料 token。
- `run` 验证智能模式运行中的过程流、持久化恢复、停止、审批、压缩提示和 AI 内置浏览器任务。
- `result` 验证搜索结果、普通文件预览、修改文件工作区、真实 docx 预览、文本 diff、回退和多文件修改入口。
- Workbench 测试全部是 `e2e`，覆盖 Electron、renderer、IPC、真实 AI、右侧面板和文件系统联动。
- 涉及 AI 的 case 必须记录模型、耗时、完成度评分和失败归因；Oracle 引用 [workbench.md](../prd/workbench.md) 的需求或验收编号。
- AI 内置浏览器 case 必须验证右侧浏览器面板、网页操作结果和最终 assistant 输出形成闭环，不能只验证面板出现。
- docx apply 相关 case 必须使用真实 docx 文件验证预览与回退；仅写入 `.docx` 后缀文本文件不满足回归 case 口径。
- 依赖工作区语义的测试统一复用 `tests/fixtures/workspace` 作为共享输入目录，但该目录只作为真实输入文件来源。
- `How` 和 `Oracle` 必须映射到 [workbench.md](../prd/workbench.md) 的需求或验收编号。

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
- `node scripts/test/workflow.mjs --domain workbench`
- `node scripts/test/workflow.mjs --domain workbench --type e2e`

补充规则：

- `pnpm test:workbench:e2e` 是 Workbench UI 源码 E2E 回归测试入口。
- 需要验证正式安装包时使用 `pnpm test:e2e:package -- --bundle <release-bundle.json>`；它会校验并安装已构建候选包，再对安装后的真实应用执行 E2E，不重新构建，也不属于普通开发回归。发布时按 `doc/release.md` 的影响评估选择范围，不带过滤参数时执行全部 E2E。
- AI case 缺少 `AI_LIVE_BASE_URL`、`AI_LIVE_API_KEY`、`AI_LIVE_PRIMARY_MODEL_NAME`、`AI_LIVE_VISUAL_MODEL_NAME` 时必须 preflight fail，不得静默跳过。
- `conversation / run / result` 是稳定 suite，不因 PRD 小节增删而轻易重排。
- suite 下的 `session / composer / message / scope / process / blocker / browser / search / preview / apply` 是 group，只在同一 suite 内用于收敛相近 case。

## 5. 回归测试清单

### 5.1 `conversation`

#### `session-initial-create-and-title`

- 测试类型：`e2e`
- What：首次进入 Workbench 时只展示可输入草稿态，第一条用户消息真实发送后才创建会话并生成标题，第二条消息不再自动改写标题。
- Why：会话初始化和标题更新是 Workbench 最早的可见状态；草稿态提前落库会产生空会话。
- How：通过 Settings UI 新增真实模型配置并绑定真实工作区；检查会话记录数量，发送两条真实自然语言请求。
- Oracle：进入页面、点击新对话和选择工作区都不创建真实会话，对齐 `WB-SESSION-001`；第一条消息发送后才创建会话并生成标题，第二条消息不再改写标题，对齐 `WB-SESSION-003`。
- Not：不验证标题手动编辑，也不验证会话列表视觉样式。

#### `session-delete-confirmation`

- 测试类型：`e2e`
- What：会话删除确认，以及取消和确认删除。
- Why：会话删除是高风险操作，必须避免误删。
- How：通过真实 Workbench UI 创建会话；打开删除确认，分别覆盖取消和确认。
- Oracle：取消删除时会话保留；确认删除后会话从列表消失，对齐 `WB-SESSION-004`。
- Not：不验证历史会话批量管理和跨设备同步。

#### `workbench-help-entry`

- 测试类型：`e2e`
- What：Workbench 左侧使用帮助入口。
- Why：帮助入口必须独立于会话创建和模型运行保持可用。
- How：打开 Workbench，点击帮助入口并观察外链调用和当前路由。
- Oracle：入口可访问，打开官方中文手册且不改变当前会话路由，对齐 `WB-COMPOSER-011`。
- Not：不验证系统浏览器窗口样式。

#### `sidebar-app-update`

- 测试类型：`e2e`
- What：Workbench 左侧更新入口的隐藏、下载、进度、稍后重启、安装和失败重试状态。
- Why：更新入口属于 Workbench 用户交互，设置页不再重复提供该入口。
- How：使用更新 fixture 驱动各状态，通过真实 Renderer 交互观察按钮和 IPC observer。
- Oracle：无更新时入口隐藏；用户点击后才下载；下载中显示进度；下载完成可稍后或重启；失败可重试；旧设置路由回到大模型页，对齐 `WB-COMPOSER-012-AC1`、`WB-COMPOSER-012-AC2`、`WB-COMPOSER-012-AC3`。
- Not：fixture 不证明真实安装包下载、签名或安装成功。

#### `context-ring-usage`

- 测试类型：`e2e`
- What：智能模式上下文用量在 run 后刷新，并可查看已用与剩余比例。
- Why：用量提示错误会误导用户对后续可用上下文的判断。
- How：完成一次真实 AI run，读取圆圈可访问名称和 hover 提示。
- Oracle：圆圈展示已用与剩余信息，hover 展示百分比，对齐 `WB-COMPOSER-008`。
- Not：不验证 token 估算器的逐 token 精度。

#### `send-guard-mode-switch-and-preferences`

- 测试类型：`e2e`
- What：缺少模型时的模式提示、发送前置条件、模式切换保留输入，以及模型 / 工作区 / AI 推进偏好恢复。
- Why：Workbench 的任务入口依赖这些基础交互；任一状态失真都会导致用户无法发起任务、把任务发到错误上下文或使用错误资料边界。
- How：先在无模型配置状态下切换智能 / 搜索模式检查提示，再通过 UI 配置真实模型和工作区；覆盖无工作区、输入保留、模型 / 工作区选择、AI 推进偏好、重新进入页面后的恢复和真实发送。
- Oracle：无模型时智能模式快速显示配置提示；发送禁用态给出原因，工作区可用且输入非空时可发送，对齐 `WB-COMPOSER-001`、`WB-COMPOSER-005`；只绑定工作区、不插入本地参考资料时仍可发起通用任务，对齐 `WB-CORE-001`；模式切换、模型、工作区和推进偏好恢复对齐 `WB-MODE-001`、`WB-COMPOSER-007`。
- Not：不验证真实模型回答质量，只验证用户路径和发送前置条件。

#### `model-selector-and-provider-error`

- 测试类型：`e2e`
- What：模型选择按配置分组、视觉模型选择和 provider 错误反馈。
- Why：模型配置和视觉模型是智能任务能否启动的直接前提。
- How：通过真实设置页配置模型，回到 Workbench 选择主模型和视觉模型，触发受控 provider 错误。
- Oracle：候选按配置分组可搜索，视觉模型可单独选择；模型菜单打开后触发器 Tooltip 必须关闭，不能遮挡真实点击；provider 失败显示用户可读错误，对齐 `WB-COMPOSER-007` 与 `WB-CORE-006`。
- Not：不评价模型回答质量。

#### `user-message-actions`

- 测试类型：`e2e`
- What：用户消息 hover 操作、latest turn 编辑撤回、running 态编辑入口隐藏，以及用户消息附件展示。
- Why：用户编辑上一条消息依赖撤回最新 turn、回填 composer 和附件 UI 协同；任一状态错误都会导致重复发送、误编辑运行中消息或附件被正文挤压遮挡。
- How：使用真实 Workbench UI 创建工作区与会话，真实粘贴图片和 `md` 附件并发送 AI 请求；hover 用户消息并触发复制与编辑；在 running 状态检查用户消息气泡和附件布局。
- Oracle：hover 后显示时间、复制和编辑；复制给出成功反馈；编辑会撤回最新 turn 并回填原草稿，running 状态不显示编辑，对齐 `WB-SESSION-006`；附件显示在消息气泡上方，输入框附件关闭按钮可点击且不被遮挡。
- Not：不验证模型回答质量；附件输入通过真实保存与传递链路进入产品。

#### `composer-attachments-context`

- 测试类型：`e2e`
- What：`+` 与粘贴添加附件时，附件会保存到工作区 `.ncurator/runtime/assets/<assetBucketId>/`，不会提前创建真实会话；图片、`doc`、`docx`、`pptx`、`pdf`、`md`、`json` 可以添加，并保持图片预览、文件打开、删除、普通文本粘贴和格式提示行为。
- Why：附件链路已改为“统一落盘到工作区 + 只把路径交给 AI”，必须用回归测试守住真实保存路径和交互行为。
- How：创建并通过原生目录选择绑定真实工作区；点击添加附件后，在 Windows 系统文件窗口或 macOS Open 面板中用系统级键鼠选择真实文件，经过 Renderer → IPC → Main → 附件保存链路；另外通过粘贴覆盖不支持格式和大文件 warning。
- Oracle：未绑定工作区时提示先选择工作区且不添加附件；真实添加会落盘且不提前创建会话；图片预览、格式范围、不支持提示及只传名称与路径的发送上下文整体对齐 `WB-COMPOSER-010`。
- Not：不在跨平台业务回归中验证系统原生文件选择器的视觉细节；不通过 `attachmentPickResponse` 或直接 `attachmentSaveFile` 伪造附件结果。

#### `reference-mention-keyboard`

- 测试类型：`e2e`
- What：`@` 候选列表使用方向键移动时，当前高亮项能停在移动后的选项，不会因候选刷新跳回第一项。
- Why：`@` 候选选择依赖键盘稳定性；高亮项被刷新会导致用户插入错误资料范围。
- How：通过真实 Settings / Workbench UI 创建并准备真实工作区；在 composer 输入 `@` 打开候选列表，按 `ArrowDown` 后观察 active 候选项。
- Oracle：候选项数量大于 1；按下方向键后 active 候选项发生变化，并在短暂停留后保持不变，对齐 `WB-SCOPE-002-AC1`。
- Not：不验证 AI run 或底层检索质量。

#### `workspace-root-path-required`

- 测试类型：`e2e`
- What：已选工作区但未设置工作文件地址时，Settings 和 Workbench 都会给出轻提示，且 Workbench 发送按钮保持禁用；绑定目录后恢复可发送。
- Why：工作区名称选择和工作目录绑定已经拆开，若缺少“未绑定目录不可发送”的明确反馈，用户会误以为工作区已经可用。
- How：通过 Settings UI 创建未绑定目录的真实工作区；在 Settings 文件 tab 验证轻提示；进入 Workbench 选择该工作区和真实模型，确认发送按钮禁用与 composer 提示；再回到 Settings 绑定真实目录，返回 Workbench 发送真实请求。
- Oracle：未设置工作文件地址时，Settings 文件 tab 会提示设置后才能在 Workbench 发送任务，对齐 `SET-WORKSPACE-006-AC3`；Workbench 发送按钮保持禁用且 composer 提示前往设置页绑定地址，对齐 `WB-COMPOSER-005-AC1`、`WB-COMPOSER-005-AC2`；绑定目录后恢复发送并完成真实 AI 运行，对齐 `WB-CORE-006-AC1`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证运行中的工作区恢复流。

#### `reference-token-lifecycle`

- 测试类型：`e2e`
- What：`@` 参考资料候选覆盖工作区全部本地目录 / 文件与网页资料、目录 / 文件 / 网页 token 插入、多 token 共存、键盘删除、去重、切工作区清理和空候选提示。
- Why：显式参考资料是用户控制 AI 上下文的核心入口，错误会直接导致搜索或 AI 执行范围偏离用户意图。
- How：创建真实 workspace，绑定 `tests/fixtures/workspace`，等待真实文件扫描并准备索引状态；添加真实 web source 并等待真实网页索引完成；输入 `@` 触发候选，选择文件、目录、网页；候选应覆盖工作区下本地项并显示索引状态，其中 md/txt 索引完成后应显示为已索引；选中即追加，同一资料才去重；通过 Backspace 删除 token；切工作区清理旧 token。
- Oracle：候选来源和发送范围对齐 `WB-SCOPE-001`、`WB-CORE-002`、`WB-CORE-004`；token 插入、共存、发送参数、键盘删除和图标对齐 `WB-SCOPE-002`；去重、跨工作区清理和空候选对齐 `WB-SCOPE-003`、`WB-SCOPE-004`；智能模式无 warning，搜索模式说明只覆盖已索引子文件，对齐 `WB-BLOCKER-003`。
- Not：不验证底层 KB 检索排序质量，也不验证 Settings 工作区资料配置细节。

#### `right-panel-layout-and-tabs`

- 测试类型：`e2e`
- What：空会话输入区布局、右侧默认无占位折叠、标签栏密度与折叠入口、Tab 溢出滚动、加号菜单文案、浏览器缩放菜单和地址栏“前往”按钮。
- Why：右侧资源工作台和聊天输入区共享窗口高度与标题栏命中区域，普通功能测试无法发现输入框被推出窗口、折叠按钮放错区域、Tab 无法滚动或原生浏览器遮挡浮层等视觉交互回归。
- How：直接进入无历史会话的真实 Workbench，先确认右侧 shell 不存在并测量空会话输入区位置；展开后连续创建八个真实浏览器 Tab，使用鼠标滚轮触发横向滚动并检查折叠 / 展开；打开浏览器更多菜单检查三段式缩放控件和地址栏“前往”按钮。
- Oracle：空会话输入区居中且右侧 shell 不占宽度；展开和折叠保留约 200ms 动画，折叠动画结束后 shell 才卸载；折叠态按钮位于主标题栏并在展开后隐藏；悬浮按钮不产生 document 横纵溢出；标签栏和浏览器工具栏均为 44px，标签栏无下边线；八个 Tab 溢出后滚轮可横向滚动；加号菜单显示“文件 / 浏览器”，缩放控件同排，地址栏显示“前往”按钮，浮层触发原生视图避让。
- Not：不验证公网网页、模型回答质量或系统窗口按钮本身；Stagehand targetId、共享持久分区和历史恢复继续由 `browser-use-task-panel` 覆盖。

#### `windows-empty-titlebar-drag-region`

- 测试类型：`e2e`
- What：Workbench 空会话的窗口拖动区和原生标题栏不遮挡输入区或右侧入口。
- Why：窗口层级错误会让首屏无法拖动或按钮无法点击。
- How：在可见窗口测量原生标题栏、拖动区和空态输入区，点击关键入口。
- Oracle：业务内容从标题栏下方开始，交互元素位于 `no-drag` 区，空态输入区可用，对齐 `WB-PANEL-001`、`WB-CORE-008`。
- Not：不验证系统窗口管理器的实际移动动画。

### 5.2 `run`

#### `ai-process-stream-and-final-answer`

- 测试类型：`e2e`
- What：智能模式真实发送后用户消息、assistant 占位、过程流、最终 markdown 输出和中间结果收口。
- Why：Workbench 的核心体验不是只启动 AI，而是让用户看见过程并得到可消费结果。
- How：真实工作区内准备带唯一事实的文件；用户通过 UI 发送自然语言总结请求；等待真实 AI run 完成。
- Oracle：用户消息、assistant 占位、各过程层、总结等待层、最终 markdown 和链接行为对齐 `WB-COMPOSER-003`、`WB-COMPOSER-009`；最终回答使用 workspace 中间结果并围绕用户诉求收口，对齐 `WB-CORE-005`、`WB-CORE-006`。
- Not：不对最终文案逐字断言，也不把真实模型质量问题误归因为 UI bug。

### 3.5 发布前真实检查

- `WB-BLOCKER-004`：上下文压缩必须由真实模型使用量和正式压缩阈值触发，检查运行中与完成态过程组；不得为 E2E 降低生产阈值或伪造 compaction 事件。该检查运行成本取决于模型上下文，不作为每次源码回归的固定 case。

#### `run-navigation-snapshot-replay`

- 测试类型：`e2e`
- What：真实 AI 输出过程中切到 Settings，完成后回到 Workbench 能通过持久化 snapshot replay 恢复过程流和最终 assistant 回答。
- Why：Workbench route 切换会导致 renderer 重新挂载；如果运行态只存在 renderer 内存中，用户离开页面后会丢失 AI 过程和最终回答。
- How：通过 UI 配置真实模型和真实工作区；发送真实 AI 请求，等待过程流出现后切到 Settings；停留到 AI run 完成，再回到 Workbench 读取恢复后的过程流和最终回答。
- Oracle：切换后恢复目标历史、过程流、最终回答和自身运行态，上一会话状态不泄漏，对齐 `WB-SESSION-002`；run event 包含 `answer_completed` 与 `run_completed`，对齐 `WB-COMPOSER-003-AC7`。
- Not：不覆盖审批等待恢复；审批恢复由 `approval-batch-flow` 覆盖。

#### `session-skill-memory-persistence`

- 测试类型：`e2e`
- What：同一 Workbench 会话的多轮 AI run 能复用已学习的技能并继续上一轮任务主线。
- Why：续做不能丢失已有上下文，也不能每轮重复学习同一技能。
- How：通过真实 Workbench UI 完成两轮请求，检查两轮 human steps、工具选择和最终结果。
- Oracle：第一轮学习 `docx-read` 技能；第二轮不重复 learning 且能使用该技能继续读取文档；两轮结果均完成，对齐 `WB-SESSION-005-AC1`、`WB-SESSION-005-AC2`。
- Not：不替代 AI backend 对技能图和 memory store 的契约测试。

#### `approval-batch-flow`

- 测试类型：`e2e`
- What：真实 AI 运行中触发需审批 terminal 操作后，composer 上方审批卡片的同意、拒绝和指导输入流程。
- Why：审批是高风险 terminal 执行的用户确认边界；UI 误执行或误恢复都会破坏安全约束。
- How：通过真实用户请求诱导 AI 产生需要审批的 terminal 操作；分别覆盖全同意、任一拒绝、填写指导输入和不操作期间保持等待。
- Oracle：整批同意后按原 serial 顺序继续，对齐 `WB-BLOCKER-001-AC1`；任一拒绝或填写指导输入时本批命令 0 执行并回到后续 AI 决策，对齐 `WB-BLOCKER-001-AC2`；指导输入不作为独立第三按钮，对齐 `WB-BLOCKER-001-AC3`；审批不因固定超时自动失败，对齐 `WB-BLOCKER-001-AC4`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证 terminal 工具安全指令集本身，该能力归 AI tool 测试。

#### `user-takeover-flow`

- 测试类型：`e2e`
- What：AI 请求用户接手浏览器、用户完成后继续和取消任务。
- Why：登录、验证码和人工确认无法由 AI 自动完成，等待状态必须可恢复且可释放。
- How：通过真实浏览器任务触发接手事件；测试以 Windows `user32` 或 macOS `CGEvent` 发送系统鼠标输入，点击嵌入网页中的确认按钮，再从 Workbench UI 完成继续或取消并覆盖切换会话后返回。
- Oracle：展示原因和对应浏览器；确认后从同一页面继续；取消后 run 结束且不再保留 blocker，对齐 `WB-BLOCKER-002`。
- Not：不验证第三方网站业务结果。

#### `stop-running-or-approval-run`

- 测试类型：`e2e`
- What：智能模式运行中底部发送按钮切换为停止图标，并能取消普通长任务和审批等待中的运行。
- Why：用户需要可靠中断长任务；审批等待时停止若不能释放等待，会造成运行态卡死。
- How：发送真实长任务请求和真实审批等待请求；运行中点击底部停止图标并观察运行态、审批态和反馈。
- Oracle：运行中发送按钮切换为停止图标且不显示独立取消按钮，对齐 `WB-COMPOSER-006-AC1`；当前会话列表项显示“任务运行中”，取消后标记消失，对齐 `WB-SESSION-002-AC5`；点击停止后当前运行结束并给出已取消反馈，对齐 `WB-COMPOSER-006-AC2`；审批等待时点击停止也结束 run，对齐 `WB-COMPOSER-006-AC3`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证后端 abort signal 在每个 AI 节点内部的细节。

#### `cancelled-run-keeps-artifact`

- 测试类型：`e2e`
- What：文件修改已经落地后取消运行，终态仍保留普通取消文案、修改文件入口和差异预览。
- Why：取消只应停止后续 AI 执行，不能隐藏已经发生的文件修改，否则用户无法检查和回退副作用。
- How：真实 AI 使用 `text_file_edit` 修改 Markdown，等待 `file_artifact` 后点击停止，再打开本轮修改记录。
- Oracle：assistant turn 显示不含 Markdown 标记的“已取消”；修改文件入口仍存在；文件内容已经更新；文本差异预览可打开。
- Not：不验证进程被强杀后的恢复，也不要求取消立即打断正在执行的 `wait_time`。

#### `browser-use-task-panel`

- 测试类型：`e2e`
- What：AI 通过内置浏览器完成网页任务时，文件 / 多浏览器 Tab、独立页面导航、持久站点数据和真实网页操作结果形成闭环。
- Why：内置浏览器是 Electron 与 AI run 深度联动场景，仅 backend 或静态事件无法覆盖视口嵌入、导航和最终收口问题。
- How：先打开真实 Markdown 文件，再让 AI 使用 `browser_use` 操作本地测试页；AI Run 仍在进行时，用户通过 `+` 新建另一个浏览器标签，验证后续 observe / act / extract 不会跟随 UI 活动标签漂移；任务完成后切回文件再切回浏览器，检查网页状态保持。
- Oracle：文件和多个浏览器 Tab 可共存；真实 URL 导航、结果收口、targetId 隔离、共享持久分区、缩放/前往和随机 CDP 端口由浏览器组 case 合并对齐 `WB-PANEL-004`；真实 browser_use 结果包含 `BROWSER_TASK_DONE` 和口令。
- Not：不验证公网网页稳定性；本 case 使用本地测试网页减少外部波动；不允许用 fake browser 或 fake tool result 替代；不要求 live 模型必须在固定时限内结束整轮最终回答，只要真实内置浏览器已完成输入、点击和结果读取即可判定 browser panel 能力有效。

#### `browser-view-lifecycle`

- 测试类型：`e2e`
- What：内置浏览器原生视图在初次显示、面板折叠、Renderer 菜单避让和会话切换后仍可见、尺寸稳定且持续运行。
- Why：`WebContentsView` 由 Main 管理并覆盖在 Renderer 上方；生命周期或 bounds 同步错误会导致白屏、原生视图遮挡菜单、恢复后尺寸跳变，或切换会话时误销毁仍在运行的网页。
- How：通过 Settings UI 创建工作空间并用真实模型发送消息形成会话；在 Workbench UI 新建浏览器 Tab，从“浏览器地址”输入框点击“前往”打开带高对比颜色和自增计时器的本地真实网页；通过 UI 新建/切回会话、Escape 关闭菜单，并采集各阶段窗口像素、viewport 尺寸、zoom、WebContents id 与计时器值。
- Oracle：各阶段浏览器 viewport 均包含稳定的非白真实网页像素且尺寸、zoom 不变；Renderer 菜单打开时原生视图隐藏，关闭后恢复；折叠或切换会话只停放视图，不销毁 WebContents，计时器持续前进；回到原会话时面板直接按最终宽度恢复且不重播展开动画，对齐 `WB-PANEL-001-AC5`、`WB-PANEL-004-AC1`、`WB-PANEL-004-AC3`、`WB-PANEL-004-AC7`。
- Not：不验证公网网页、Stagehand 操作或最终 AI 回答；这些由 `browser-use-task-panel` 覆盖。

#### `web-search-diagnostic`

- 测试类型：`e2e`
- What：真实 AI 针对“DeepSeek 最近融资情况”先调用 `web_search`，并拿到结构化候选网页。
- Why：网页搜索是实时信息入口；如果模型没有调用搜索工具或搜索工具没有返回候选，后续网页读取和回答都会变成编造。
- How：通过真实 Workbench UI 发送 DeepSeek 融资搜索请求；等待真实 AI run 完成；从 run event 中读取 `web_search` 调用、query 和结果数量。
- Oracle：run 完成；至少一次 `web_search` query 包含 DeepSeek；最后一次搜索结果 `ok=true` 且候选网页数量大于 0；不出现 fake search / fake AI 信号。
- Not：不要求读取候选网页正文；正文读取由 `web-read-from-search-result` 覆盖。

#### `web-read-from-search-result`

- 测试类型：`e2e`
- What：真实 AI 先用 `web_search` 搜索 DeepSeek 融资候选网页，再用 `web_crawl` 读取网页正文后总结。
- Why：搜索结果只是候选列表，不是正文证据；必须守住“搜索后读取正文”的真实网页信息闭环。
- How：通过真实 Workbench UI 发送“搜索 DeepSeek 最近融资情况并读取最相关网页正文后总结”；等待真实 AI run 完成；检查 `web_search` 与 `web_crawl` 的工具调用和结果。
- Oracle：run 完成；`web_search` 有候选结果，`web_crawl` 读取正文，最终回答使用网页事实；搜索、读取、失败边界和严谨偏好限制由网页组 case 合并对齐 `WB-CORE-007`；不出现 fake 信号。
- Not：不固定具体新闻网页、金额或日期，避免公网搜索结果变化导致误判。

#### `web-read-direct-url`

- 测试类型：`e2e`
- What：用户直接给 URL 时，真实 AI 使用 `web_crawl` 读取网页正文，并回答正文中的唯一口令。
- Why：直接 URL 读取是网页阅读的最小闭环，不能退化成浏览器点击任务或只复述 URL。
- How：启动本地 HTTP 页面并写入唯一口令；通过真实 Workbench UI 要求 AI 读取该 URL 正文；等待真实 AI run 完成。
- Oracle：run 完成；至少一次 `web_crawl` 成功；不调用 `browser_use`；最终回答包含本地网页唯一口令；不出现 fake crawl / fake AI 信号。
- Not：不验证网页索引入库，也不验证交互式浏览器操作；这些分别由 Settings 网页索引 case 与 `browser-use-task-panel` 覆盖。

### 5.3 `result`

#### `search-results-open-rules`

- 测试类型：`e2e`
- What：搜索模式发送、completed assistant 结果摘要、右侧搜索结果、网页 / 本地结果打开规则和无可检索资料下的发送拦截。
- Why：搜索模式是 Workbench 的非 AI 路径，必须确保不误启动 AI，且右侧结果操作符合用户预期。
- How：通过 UI 创建并绑定真实工作区，等待本地文件和网页资料真实索引完成；切换搜索模式发送自然语言查询；点击网页结果和本地结果操作图标；再切换到无可检索资料范围发送搜索。
- Oracle：`Shift+Enter` 换行不发送，中文 composition 不被打断，`Enter` 按搜索模式发送，对齐 `WB-COMPOSER-002`；搜索不启动 AI 并展示摘要与命中，对齐 `WB-COMPOSER-004`；消息区和搜索过程对齐 `WB-COMPOSER-009`；网页与本地结果打开规则对齐 `WB-PANEL-002`；显式资料影响检索结果，对齐 `WB-CORE-002`；无可检索资料时不发送并保留输入，对齐 `WB-MODE-002`。
- Not：不验证 embedding 召回质量和排序算法。

#### `file-preview-actions`

- 测试类型：`e2e`
- What：右侧普通文件预览态、“全部 / 本会话改动”文件模式、稳定选中态、多个文件 Tab、定位文件、系统打开方式下拉、PDF 命中定位，以及 Markdown / 纯文本预览。
- Why：右侧面板是用户消费搜索 / 引用结果的主要区域，预览布局错误会直接阻断阅读。
- How：从真实搜索结果连续打开真实 pdf、docx、md、txt 文件；检查预览内容和工具条；展开打开方式菜单，确认触发系统关联应用查询、存在默认应用标记和至少一个系统返回的 Handler；确认产生四个文件 Tab，再切回 Markdown Tab。
- Oracle：加号文件标签、目录懒加载、PDF 命中定位、Markdown / UTF-8 文本预览、选中态、面包屑、系统打开方式与工具栏行为整体对齐 `WB-PANEL-003`；四个文件分别保留且旧 Tab 可恢复。
- Not：不在自动测试中真正启动外部应用或修改操作系统默认关联；不伪造 md/txt 搜索结果或右侧预览状态。

#### `text-file-apply-preview-and-revert`

- 测试类型：`e2e`
- What：同一个 Markdown 文件在普通预览时正常渲染，在 AI 修改记录中使用独立文本 diff，并能恢复原始 bytes。
- Why：普通预览和修改预览是两种不同语义；如果共用文件渲染器，用户看不到本次具体增加和删除内容。
- How：先从真实搜索结果打开 Markdown 普通预览；再通过真实 AI 调用 `replaceAll` 和 `edit` 修改该文件；点击 assistant 修改入口检查 `TextFileDiffViewer`；最后执行回退。
- Oracle：普通预览与修改 diff 共用一个文件 Tab；Run 终态后才展示修改入口；面包屑、工具栏、文件列表、历史批次、结构化 Diff、不可变展开和回退刷新整体对齐 `WB-PANEL-003`、`WB-APPLY-001`、`WB-APPLY-002`、`WB-APPLY-003`；确认回退后 bytes 与原始输入一致且有效改动标记消失。
- Not：不验证 unified diff 字符串；UI 只消费结构化 diff artifact。

#### `ppt-create-diff-and-revert`

- 测试类型：`e2e / live`
- What：真实 AI 创建两页 PPT 后，用户可打开页面级左右 diff、切换缩略图模式并回撤文件。
- Why：新建 PPT 必须同时验证文件交付、差异预览和回退闭环。
- How：通过真实 Workbench UI 请求 AI 创建两页 PPT，打开修改记录并操作差异预览和回退。
- Oracle：真实 PPT 创建、原子写入和 run 级修改记录对齐 `WB-PPT-001`、`WB-APPLY-002`；pptx 可解析，左右差异区和缩略图可见，全部页与变化页切换有效；回撤后新建文件被删除，对齐 `WB-APPLY-003`。
- Not：不逐字断言最终回答，不对页面审美打分。

#### `ppt-update-diff-interactions`

- 测试类型：`e2e`
- What：已有 PPT 更新后的左右差异、变化标记、缩略图筛选、缩放和拖动画布。
- Why：创建态与更新态的差异语义不同，不能只用新建 PPT case 代替。
- How：修改真实 PPT 的页面内容和顺序，打开修改记录并操作差异预览。
- Oracle：修改前后画面、变化页标记、全部页切换、同步切页、缩放和拖动均可用，对齐 `WB-PPT-002`。
- Not：不评价页面设计质量。

#### `terminal-background-service-flow`

- 测试类型：`e2e`
- What：真实 AI 使用持久终端启动本地 HTTP 服务、让出控制权、通过内置浏览器验证页面并停止服务。
- Why：持久终端、多终端决策、浏览器联动和进程清理的完整用户路径，静态事件或 fake tool result 无法覆盖。
- How：在真实临时 workspace 创建带唯一标记的 HTML；通过可见 Electron Workbench 发送请求，真实审批 terminal 命令，使用真实 PTY 启动 Python HTTP server，真实 browser_use 打开页面，最后 terminal_stop。
- Oracle：事件包含 terminal_command_yielded、terminal_command_stopped、terminal_run、terminal_stop 和 browser_use；最终答复包含页面唯一标记；任务结束后真实端口不可访问；不存在 fake AI/tool/browser 信号。
- Not：不依赖公网，不允许测试进程替 AI 启动目标 HTTP 服务。

#### `terminal-unicode-file-list`

- 测试类型：`e2e`
- What：持久终端在当前平台处理 Unicode 路径和文件列表。
- Why：中文路径是 macOS 与 Windows 用户的常见场景，编码错误会直接破坏终端任务。
- How：在真实工作区创建 Unicode 文件名，通过真实终端读取目录并返回结果。
- Oracle：终端结果保留 Unicode 文件名，任务完成后无乱码或跨会话泄漏，对齐 `WB-TERMINAL-001`。
- Not：不覆盖全部 shell 命令策略。

#### `docx-apply-panel-preview-and-revert`

- 测试类型：`e2e`
- What：AI 修改真实 docx 后，assistant 修改文件入口、右侧修改文件工作区、当前记录预览和干净回退闭环。
- Why：直接写回和回退是 Workbench 文件编辑能力的安全边界，只看 artifact 事件无法证明用户能检查和撤销修改。
- How：通过 UI 选择真实 docx 资料并发送真实编辑请求；等待 AI 写回；点击 assistant turn 中的修改文件入口；检查右侧文件面包屑、无模式标签状态和预览；执行回退并重新读取文件内容。
- Oracle：受支持写回类型边界对齐 `WB-CORE-003`；修改后源文件成为最终净稿并展示入口；右侧默认选中、Review Docx、写回和回退闭环对齐 `WB-APPLY-001`、`WB-APPLY-002`、`WB-APPLY-003`。
- Not：不验证 docx 编辑算法的所有格式保真细节，该能力归 AI tool docx 测试。

#### `terminal-rename-change-notice-and-revert`

- 测试类型：`e2e`
- What：真实 AI 通过终端 `mv` 重命名文件后，验证 Run 扫描记录、非专用变更说明和确认回退闭环。
- Why：终端和脚本没有专用 Diff，但仍属于本会话 AI 改动；若只覆盖内置编辑工具，会漏掉产品的重要通用执行路径。
- How：在临时工作区要求真实 AI 只使用 `terminal_run` 重命名文件；等待 Run 完成后点击修改入口，检查前后文件名和内容未变化说明；点击回退并确认，再读取磁盘状态。
- Oracle：重命名记录进入 assistant 修改入口和“本会话改动”；预览区展示原文件名、当前文件名和“文件内容没有变化”，不出现“没有专用预览稿”；统一回退确认出现后才执行，最终原文件名及原始 bytes 恢复，重命名目标消失。
- Not：不尝试区分 AI Run 执行期间并行发生的用户外部修改，此窗口内变化按产品规则统一归入该 Run。

#### `docx-apply-force-revert-warning`

- 测试类型：`e2e`
- What：AI 写回后文件又被外部真实修改时，首次回退展示风险提示，确认后允许强制回退并刷新右侧状态。
- Why：强制回退是避免静默覆盖用户后续修改的关键安全交互。
- How：AI 写回真实 docx 后，由测试进程对同一个真实文件做外部修改；在右侧修改文件工作区点击回退，先确认统一回退提示，再观察风险提示并确认强制回退。
- Oracle：首次点击只展示统一确认且不写磁盘，对齐 `WB-APPLY-004-AC1`；确认后检测到后续修改，再展示“仍然回退这次修改？”风险提示；用户确认强制回退后恢复 checkpoint 或删除新建文件，对齐 `WB-APPLY-004-AC2`；右侧记录状态和预览在强制回退后刷新，对齐 `WB-APPLY-004-AC3`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证所有外部编辑器写入方式，只验证 checksum 不一致分支的用户可见交互。

#### `multi-file-apply-tabs`

- 测试类型：`e2e`
- What：同一轮 AI 修改多个文件时，assistant turn 保留全部入口；右侧为每个文件保留资源 Tab，并可切回旧文件。
- Why：多文件任务如果只保留最新或单个入口，用户无法检查和回退完整结果。
- How：通过 UI 选择至少两个真实 docx 文件并发送真实多文件编辑请求；分别点击两个修改入口，确认生成两个文件 Tab，再点击第一个 Tab 恢复其记录。
- Oracle：多个修改入口、对应记录加载和切换后入口保留整体对齐 `WB-APPLY-005`；点击入口新增或激活对应文件 Tab，对齐 `WB-PANEL-001-AC1`。
- Not：不验证不同 AI 轮次的全部历史筛选 UI，只覆盖同一轮多文件入口和当前轮次隔离。
