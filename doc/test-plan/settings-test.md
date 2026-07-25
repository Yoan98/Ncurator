# NCurator-Desktop Settings 测试计划

## 1. 总体目标

- 本计划定义 Settings 用户可见能力的回归范围，并对齐 [settings.md](../prd/settings.md) 的 `SET-*` 需求和验收编号。
- 通用测试、runner、raw logs、UI E2E 和 live 断言规则遵循 `doc/test.md`。
- Settings 测试全部是 E2E，必须通过真实 UI 完成被测行为；前置状态可以通过真实 IPC 建立，但不能替代当前 case 的按钮、进度、索引结果或页面刷新。

## 2. Suite 设计

Settings 顶层 suite 对齐 PRD 模块：

1. `model`
2. `general`
3. `workspace`
4. `vector`

领域规则：

- `model` 验证大模型可用服务配置的加载、创建、编辑、删除和远端模型列表刷新。
- `general` 验证 AI 运行系统通知开关的加载、保存和关闭后的静默行为；系统通知中心的真实视觉展示按 macOS 与 Windows 发布前手动验证。
- `workspace` 验证工作空间容器及其下属 `files`、`web` 两类子区域的页面行为和真实 IPC 链路。
- `vector` 属于 Settings 产品域，但页面位于独立路由 `/model-download`，测试目录与 runner 仍统一归入 `tests/case/settings/vector/**`。
- `workspace` 是 Settings 下的 suite，按 `core / files / web` 组织，语义为“具名工作空间 + 文件 tab + 网页 tab”。
- `workspace` 相关回归测试默认复用 `tests/fixtures/workspace` 作为共享输入目录。
- `How` 和 `Oracle` 必须映射到 [settings.md](../prd/settings.md) 的需求或验收编号。

## 3. 回归测试清单

### 3.1 `model`

#### `model-page-load-config-list`

- 测试类型：`e2e`
- What：用户进入大模型页后，配置列表能完成初始化展示。
- Why：该链路直接对应首屏状态，失败时用户会认为设置页没有加载。
- How：通过 UI 创建两条连接配置，重新打开 Settings 的大模型页，等待页面完成初始化。
- Oracle：页面打开后可以看到配置列表，对齐 `SET-MODEL-001-AC1`；列表中展示配置名称和服务地址，对齐 `SET-MODEL-001-AC2`。
- Not：不验证删除结果。

#### `model-create-edit-form`

- 测试类型：`e2e`
- What：新增和编辑连接配置的表单内容、预填逻辑、必填校验，以及空列表中第一条配置的普通服务语义。
- Why：连接配置是后续 workbench 可用性的前提，一旦表单字段、预填或校验失真，用户很容易保存出不可用配置。
- How：从空配置列表进入新增流，检查表单字段、必填校验和首次保存后的列表语义；再进入编辑流检查预填。
- Oracle：新增表单可填写配置名称、模型服务地址和 API Key，对齐 `SET-MODEL-002-AC1`；第一条配置保存后作为普通可用服务展示，不产生默认、当前或启用状态，对齐 `SET-MODEL-001-AC1`、`SET-MODEL-001-AC2`；编辑现有配置时表单带出当前值，对齐 `SET-MODEL-002-AC2`；必填字段不完整时保存被拦截，对齐 `SET-MODEL-002-AC3`；新增和编辑弹窗点击遮罩后保持打开且输入不丢失，对齐 `SET-MODEL-002-AC6`。
- Not：不验证 workbench 模型选择。

#### `model-free-key-entry`

- 测试类型：`e2e`
- What：大模型配置页展示免费 AI Key 官网入口，并保持与配置操作区的正确位置关系。
- Why：用户需要在新增配置前快速获得可体验的 Key，同时外链操作不能破坏当前设置页状态。
- How：进入大模型配置页，检查入口位于配置数量与“新增配置”之间，点击后收集真实 Renderer → Preload 外链调用信号。
- Oracle：入口位置和可访问名称符合 `SET-MODEL-004-AC1`；外链目标为 `https://www.ncurator.com/zh/free-keys` 且当前路由不变，对齐 `SET-MODEL-004-AC2`。
- Not：不访问外部网页内容，也不验证免费 Key 的实时可用性。

#### `model-remote-list-refresh`

- 测试类型：`e2e`
- What：连接配置可以通过模型列表入口获取远端模型，并能区分成功数量展示与失败反馈。
- Why：workbench 的模型选择按配置项读取模型列表，如果刷新状态不清晰，用户无法判断该配置是否可用于对话。
- How：准备一条连接配置，通过真实模型列表接口或真实本地 HTTP 服务分别覆盖成功和失败响应，在列表中打开模型列表并触发重新获取。
- Oracle：获取模型列表成功后，配置列表展示模型数量且弹窗展示具体模型，对齐 `SET-MODEL-002-AC4`；失败时列表和弹窗展示明确错误提示，对齐 `SET-MODEL-002-AC5`。
- Not：不验证模型列表持久化；当前模型列表仅作为展示和 workbench 下拉来源。

#### `model-delete-config-feedback`

- 测试类型：`e2e`
- What：删除连接配置后的列表刷新，以及删除失败时的错误反馈。
- Why：删除结果是最直接的用户确认反馈，缺失时用户会误判配置是否已经被移除。
- How：通过 UI 覆盖删除成功路径；删除失败反馈由独立组件测试注入失败响应验证。
- Oracle：删除成功后，被删配置不再出现在列表中，对齐 `SET-MODEL-003-AC1`；失败响应保留原配置并显示脱敏错误，对齐 `SET-MODEL-003-AC2`。
- Not：不定义删除后 workbench 本地模型偏好如何恢复。

### 3.2 `workspace / core`

#### `workspace-page-load-default-selection`

- 测试类型：`e2e`
- What：工作空间页打开后会自动初始化列表和详情，并默认选中第一条工作空间。
- Why：后续文件 / 网页管理都依赖首屏默认选中，如果这里失效，详情区会表现成“无从下手”。
- How：通过 UI 创建两个工作空间，进入工作空间页并等待第一条详情渲染完成。
- Oracle：页面打开后列表和详情区自动初始化；头部只展示名称和工作空间操作；第一条工作空间自动选中且左侧同时表达文件数与网页数，对齐 `SET-WORKSPACE-001`、`SET-WORKSPACE-005-AC1`、`SET-WORKSPACE-005-AC4`。
- Not：不验证添加或移除工作空间的后续选中回退策略。

#### `workspace-add-selection-flow`

- 测试类型：`e2e`
- What：无工作空间和未绑定目录时的空状态，以及按名称创建空容器后自动切换到新工作空间。
- Why：工作空间已从“目录快照”改为“具名容器”，首个创建动作必须反映这一语义。
- How：进入无工作空间页面检查列表和详情空状态，覆盖空名称提交和有效名称提交，再检查新建未绑定工作空间的文件区空状态。
- Oracle：没有工作空间时显示选择提示；名称校验和创建流程对齐 `SET-WORKSPACE-002`；未绑定目录时明确提示设置后才能在 Workbench 发送，对齐 `SET-WORKSPACE-006-AC3`、`SET-WORKSPACE-007`。
- Not：不验证创建后自动扫描或自动索引；该需求未在 PRD 中定义。

#### `workspace-set-root-path`

- 测试类型：`e2e`
- What：文件 tab 内可以为当前工作空间绑定工作文件地址，并立即刷新目录树。
- Why：目录绑定已从“创建工作空间”移动到“文件 tab 内设置”，这是新的主操作链路。
- How：先创建未绑定目录的工作空间，再通过目录选择器为其设置工作文件地址。
- Oracle：成功设置后写入文件目录并刷新当前真实目录树，对齐 `SET-WORKSPACE-006-AC1`、`SET-WORKSPACE-008-AC1`、`SET-WORKSPACE-008-AC3`。
- Not：不验证不同操作系统的原生目录选择器样式，也不验证真实文件系统权限错误分支。

#### `workspace-remove-from-list`

- 测试类型：`e2e`
- What：用户在工作空间页移除工作空间后，左侧列表和右侧详情都不会继续展示已删除项。
- Why：列表和详情是用户确认移除成功的直接依据。
- How：创建一条工作空间，在详情区执行移除并确认。
- Oracle：移除成功后，该工作空间从列表中消失，对齐 `SET-WORKSPACE-006-AC2`；详情区不会继续显示已删除工作空间的陈旧数据。
- Not：不验证其他消费页面中的范围清理展示；只覆盖 Settings 页内可见结果。

### 3.3 `workspace / files`

#### `workspace-scan-progress-refresh`

- 测试类型：`e2e`
- What：点击“检查更新”后，页面会刷新文件树和需索引摘要。
- Why：这是用户识别待更新文件的第一步。
- How：创建一条带扫描延迟的 fixture 工作空间，触发检查更新并读取刷新后的文件树响应。
- Oracle：检查过程中出现持久化进度反馈，对齐 `SET-WORKSPACE-003-AC1`；成功后文件树和摘要刷新，对齐 `SET-WORKSPACE-003-AC2`；离开再返回时恢复当前进度和按钮状态，对齐 `SET-WORKSPACE-003-AC3`。
- Not：不验证真实大目录性能和文件系统权限失败分支。

#### `workspace-prepare-refresh`

- 测试类型：`e2e`
- What：点击“更新索引”后，文件状态会刷新为已索引并同步更新摘要。
- Why：“索引已经可用”的核心用户反馈链路。
- How：复制共享 workspace fixture 的隔离副本，在 setup 阶段通过真实 IPC 绑定目录；随后通过 Settings UI 触发更新索引，读取刷新后的文件树和全部支持文件状态。原生目录选择由 `workspace-set-root-path` 单独覆盖。
- Oracle：更新索引过程中出现持久化总进度，且检查更新/更新索引按钮同时禁用，对齐 `SET-WORKSPACE-004-AC3`；共享 fixture 中全部支持文件真实进入处理范围，对齐 `SET-WORKSPACE-004-AC1`；更新后所有支持文件收敛为 `indexed / failed`，摘要和节点状态同步刷新，对齐 `SET-WORKSPACE-004-AC2`。
- Not：不验证向量内容质量和搜索召回结果。

#### `workspace-prepare-failed-retry`

- 测试类型：`e2e`
- What：已有失败文件再次点击“更新索引”时会被纳入本次处理范围，并且文件 tab 的可索引数量包含失败数量。
- Why：失败文件是用户最常见的重试对象，如果失败记录不再进入目标集，或者 UI 不把失败数算进可操作数量，用户会误判“没有东西可更新”。
- How：创建真实工作空间并绑定共享 workspace fixture 的隔离副本，先通过测试注入或服务契约制造一个 `failed` 文件索引记录，再从 Settings 文件 tab 点击“更新索引”，读取 active job 的目标数量、文件摘要和页面可索引数字。
- Oracle：本次 job 的目标数量包含失败文件，对齐 `SET-WORKSPACE-004-AC1`；页面“可索引”数字等于 `needs_index_count + failed_file_count`，并在存在失败文件时展示 `含失败 N 个` 辅助文案，且失败文件重试后状态发生收敛，对齐 `SET-WORKSPACE-004-AC2`、`SET-WORKSPACE-005-AC2`。
- Not：不要求失败文件最终一定成功；允许因真实文件内容或环境依赖再次失败，但必须确认发生了重试。

#### `workspace-prepare-file-failure-isolated`

- 测试类型：`e2e`
- What：单个文件索引失败不会导致 Settings 页面或 Electron 应用退出，并会留下文件级失败状态与错误信息。
- Why：真实更新索引可能遇到损坏文件、过大文件或 loader/native 异常；单文件失败必须被隔离为资料级失败，不能拖垮整个应用。
- How：在真实工作空间隔离目录中放入一个会触发索引失败的支持文件和一个可索引文件，从 Settings 文件 tab 点击“更新索引”，观察 job、页面存活状态、成功文件与失败文件状态。
- Oracle：应用在索引结束后仍可响应 IPC 和页面查询，对齐 `SET-WORKSPACE-004-AC5` 的失败收敛语义；失败文件保留 `failed / last_error`，其他文件不因该失败丢失状态，对齐 `SET-WORKSPACE-004-AC2`、`SET-WORKSPACE-008-AC2`。
- Not：不模拟操作系统强杀；如果 native 崩溃导致进程退出，该 case 应失败并作为后续 worker/child process 隔离修复的回归目标。

#### `workspace-prepare-progress-restore`

- 测试类型：`e2e`
- What：文件索引执行中离开并返回工作空间页后，进度块和按钮状态会恢复。
- Why：索引任务已切换为持久化后台 job，页面生命周期不能影响用户对任务状态的判断。
- How：创建带 prepare 延迟的 fixture 工作空间，触发更新索引后切到其他设置页，再返回工作空间页读取 active job 与 UI 状态。
- Oracle：返回后仍能看到 running job 对应的进度块，且检查更新/更新索引按钮继续禁用，对齐 `SET-WORKSPACE-004-AC4`。
- Not：不模拟真实 Electron 进程退出；中断收敛由 `workspace-interrupted-job-recovery-contract` 覆盖。

#### `workspace-detail-status-and-error`

- 测试类型：`e2e`
- What：文件 tab 用可索引数承载失败提示，并在索引失败后保留文件级错误状态；目录树文件项不再展示文件名下方辅助字项。
- Why：文件问题通常发生在索引阶段，如果失败只留在控制台，用户无法判断资料是否可用。
- How：创建一条 prepare 会失败的 fixture 工作空间，触发更新索引并读取刷新后的文件树响应。
- Oracle：文件 tab 的可索引数字包含失败数量并展示 `含失败 N 个` 辅助文案，对齐 `SET-WORKSPACE-005-AC2`；文件索引失败后，失败状态和错误信息保留在文件级记录中，目录树文件项只保留文件名与状态标记，对齐 `SET-WORKSPACE-008-AC2`。
- Not：不验证错误文案的逐字 UI 展示，也不验证恢复失败文件后的二次成功链路。

### 3.4 `workspace / web`

#### `web-add-sources-dialog`

- 测试类型：`e2e`
- What：网页资料管理内嵌在工作空间详情中，并验证添加弹窗的空输入校验、多行 URL 提交和成功后的清空收尾。
- Why：网页资料进入系统的主入口。
- How：进入工作空间详情的网页 tab，确认列表和添加入口保持在 `/settings/workspace`，再覆盖空输入提交、多行 URL 提交和再次打开弹窗三条路径。
- Oracle：网页管理位于工作空间详情且不跳转独立路由，对齐 `SET-WORKSPACE-005-AC3`、`SET-WEB-001-AC3`；输入为空时提交被拦截，对齐 `SET-WEB-002-AC1`；点击遮罩后弹窗保持打开且已输入 URL 不丢失，对齐 `SET-WEB-002-AC4`；多行 URL 提交后，网页资料进入当前工作区列表，对齐 `SET-WEB-002-AC2`；提交成功后弹窗关闭且输入被清空，对齐 `SET-WEB-002-AC3`。
- Not：不验证 URL 抓取内容质量，也不验证 include/exclude selector 的解析效果。

#### `web-prepare-summary`

- 测试类型：`e2e`
- What：网页“检查更新 → 更新索引”完整链路会先刷新可索引状态，再区分成功索引与爬取失败并刷新摘要。
- Why：网页索引是“爬取 + 建索引”两阶段链路，失败类型必须可区分。
- How：预置一条成功网页和一条带失败标记的网页，先执行“检查更新”，再执行“更新索引”。
- Oracle：网页列表、摘要、失败数量和操作区初始化对齐 `SET-WEB-001-AC1`、`SET-WEB-001-AC2`；检查进度和完成状态对齐 `SET-WEB-003-AC1`、`SET-WEB-003-AC2`；更新时网页进入抓取/索引状态，对齐 `SET-WEB-004-AC1`；成功与失败分别收敛，对齐 `SET-WEB-004-AC2`、`SET-WEB-004-AC3`；分阶段进度对齐 `SET-WEB-004-AC4`。
- Not：不验证真实网页正文切块、embedding 写入质量和索引失败以外的网络细节。

#### `web-prepare-progress-restore`

- 测试类型：`e2e`
- What：网页索引执行中离开并返回网页 tab 后，分阶段进度块和按钮状态会恢复。
- Why：网页索引包含抓取与索引两阶段，恢复时不能只恢复“执行中”标签而丢失当前阶段。
- How：创建带 prepare 延迟的 fixture 工作区，触发网页更新索引后切到其他设置页，再返回网页 tab 读取 active job 与进度文案。
- Oracle：检查更新离开再返回时恢复当前进度，对齐 `SET-WEB-003-AC3`；更新索引离开再返回时恢复当前阶段且两个按钮继续禁用，对齐 `SET-WEB-004-AC5`。
- Not：不验证无抓取动作时直接展示第二步的真实内容缓存分支；该分支由后端 job 状态能力保留。

#### `web-detail-and-delete`

- 测试类型：`e2e`
- What：网页列表项展示标题、URL、状态和抓取时间，并在删除成功后刷新列表。
- Why：网页资料管理最基础的可见反馈。
- How：预置一条网页资料，检查列表项展示内容后执行删除。
- Oracle：列表项展示标题、URL、状态和抓取时间，对齐 `SET-WEB-005-AC1`；删除成功后，该网页资料从列表中消失，对齐 `SET-WEB-005-AC3`。
- Not：不验证删除后的 document/chunk 物理清理契约；这里只覆盖 Settings 页内可见结果。

#### `web-open-url-contract`

- 测试类型：`e2e`
- What：点击“打开”按钮时，会通过系统浏览器打开原网页地址。
- Why：如果这里误打开本地索引副本或失去外链能力，网页资料的原始上下文就被切断了。
- How：通过 UI 添加目标 URL，在网页 tab 点击打开按钮，用 IPC observer 辅助确认 `openExternal` 收到原始 URL。
- Oracle：触发 `openExternal(originalUrl)`，对齐 `SET-WEB-005-AC2`。
- Not：不验证系统浏览器窗口是否真的出现在前台，也不验证不同操作系统的外链打开体验。

### 3.5 `vector`

#### `vector-model-catalog-load`

- 测试类型：`e2e`
- What：向量模型页打开后，真实模型目录能加载，并展示下载或已安装状态。
- Why：向量模型是检索能力的基础依赖，如果列表加载状态不清晰，用户无法判断是否还需要下载模型。
- How：打开 Settings 向量模型页，等待真实模型目录渲染。
- Oracle：页面至少展示一个模型卡片，且每个模型有下载按钮或已安装标识，对齐 `SET-VECTOR-001-AC1`。
- Not：不下载或删除正式模型；自动化不得用伪模型目录、伪下载源或生产故障开关替代真实用户链路。

### 3.6 `general`

#### `settings-titlebar-drag-region`

- 测试类型：`e2e`
- What：Settings 的原生窗口层、业务内容拖动区和页面操作保持分层。
- Why：任一层位置错误都会导致窗口无法拖动、侧栏无法切换或页面按钮被遮挡。
- How：打开 Settings，检查 36px 原生标题栏、业务内容起点、拖动区域、侧栏切换按钮命中和页面按钮可用性。
- Oracle：Windows 原生标题栏独立位于业务内容上方，对齐 `SET-GENERAL-002-AC1`；主内容和侧栏拖动区可命中，侧栏按钮为 `no-drag` 且可折叠/展开，对齐 `SET-GENERAL-002-AC2`。
- Not：不验证不同窗口管理器的实际拖动手感。

#### `settings-help-entry`

- 测试类型：`e2e`
- What：设置页向量模型下方的使用帮助入口。
- Why：设置帮助与 Workbench 帮助是官方手册入口，位置和外链必须稳定。
- How：打开设置页，检查入口位置和可访问名称，点击后观察外链调用与路由。
- Oracle：入口样式和位置对齐 `SET-HELP-001-AC1`；打开官方中文手册且不改变设置路由，对齐 `SET-HELP-001-AC2`。
- Not：不验证系统浏览器窗口样式。

#### `system-notification-settings`

- 测试类型：`e2e`
- What：通用设置中的 AI 运行完成通知开关可以关闭，并通过真实 IPC 持久化。
- Why：通知是跨进程能力，开关状态必须由主进程保存，不能只停留在 Renderer 内存。
- How：通过 Settings UI 打开通用页，关闭开关，重新读取 `ai-runtime-settings-get`，再恢复开关。
- Oracle：开关默认开启，关闭后 UI 与主进程设置均为关闭，对齐 `SET-GENERAL-001-AC1`、`SET-GENERAL-001-AC3`。
- Not：自动化不伪造通知对象、终态或点击事件；系统通知展示和点击导航保留为发布前真实人工检查。
