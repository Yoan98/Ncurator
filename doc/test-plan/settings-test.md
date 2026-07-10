# NCurator-Desktop Settings 测试计划

## 1. 总体目标

- 本计划用于定义 Settings 用户可见能力的回归测试范围。
- Settings 回归测试统一对齐 [settings.md](/Users/test/work-space/NCurator-Desktop/doc/prd/settings.md)，新增、调整或验收结论都应引用对应的 `SET-*` 需求编号与验收编号。
- 新增或调整测试、runner、raw logs、UI E2E 回归规则与真实 AI / live 断言规则，统一遵循 `doc/test.md`。
- Settings UI E2E 回归测试必须通过真实 UI 完成模型配置、工作区目录绑定、网页资料管理和向量模型入口操作；不得用 preload override、内部 IPC、脚本化目录选择返回值或脚本化下载进度替代产品结果。

## 2. 执行摘要

### 2.1 按 Suite 汇总

- `model`
  - 登记 case：`8`
  - 当前有效结论：`1 / 1`（backend）；e2e 待本轮真实 UI 回归确认。
  - 检测时间：backend `2026-07-09 19:08:20 +08:00`
  - 备注：model e2e 已改为通过 UI 新增、编辑、启用、删除；远端模型列表使用本地 HTTP 服务真实响应。
- `workspace / core`
  - 登记 case：`6`
  - 当前有效结论：`1 / 1`（backend）；e2e 待本轮真实 UI 回归确认。
  - 检测时间：backend `2026-07-09 19:08:20 +08:00`
  - 备注：workspace core e2e 已改为 UI 创建工作区、原生目录选择绑定真实目录、UI 删除。
- `workspace / files`
  - 登记 case：`12`
  - 当前有效结论：`5 / 5`（backend）；e2e 待本轮真实 UI 回归确认。
  - 检测时间：backend `2026-07-09 19:08:20 +08:00`
  - 备注：文件 e2e 通过真实目录、真实文件和 UI 触发扫描 / 更新索引。
- `workspace / web`
  - 登记 case：`7`
  - 当前有效结论：e2e 待本轮真实 UI 回归确认。
  - 检测时间：待更新
  - 备注：web e2e 已改为 UI 添加 URL；本地 HTTP 服务可作为真实网页输入。
- `vector`
  - 登记 case：`3`
  - 当前有效结论：`2 / 2`（backend）；e2e 待本轮真实 UI 回归确认。
  - 检测时间：backend `2026-07-09 19:08:20 +08:00`
  - 备注：vector e2e 只保留真实目录页入口；下载进度、结果、恢复、删除反馈属于 backend contract 或手动下载链路，不再用假进度冒充 e2e。

## 3. Suite 设计

Settings 的回归测试顶层 suite 直接对齐 PRD 模块：

1. `model`
2. `workspace`
3. `vector`

领域规则：

- `model` 验证大模型连接配置的加载、创建、编辑、启用、删除和远端模型列表刷新。
- `workspace` 验证工作空间容器及其下属 `files`、`web` 两类子区域的页面行为和 backend / IPC 支撑契约。
- `vector` 属于 Settings 产品域，但页面位于独立路由 `/model-download`，测试目录与 runner 仍统一归入 `tests/case/settings/vector/**`。
- `workspace` 在这里是 Settings 下的 suite，不是独立测试 domain；其下统一按 `core / files / web` 组织子区域。
- `workspace` 当前测试语义基于“具名工作空间容器 + 文件 tab + 网页 tab”，不再保留旧的“创建即绑定目录 / 全局状态 / 三种索引处理模式 / 打开路径 / 网页本地筛选”模型。
- `workspace` 相关回归测试默认复用 `tests/fixtures/workspace` 作为共享输入目录。
- `How` 与 `Oracle` 必须显式映射到 [settings.md](/Users/test/work-space/NCurator-Desktop/doc/prd/settings.md) 的需求编号与验收编号。

## 4. 回归测试清单

### 4.1 `model`

#### `model-config-list-contract`

- 测试类型：`backend`
- What：验证大模型页初始化依赖的连接配置查询契约，能够返回完整配置列表并明确识别当前激活配置。
- Why：如果列表查询或当前配置识别失真，页面首屏、页头摘要和后续编辑/启用链路都会在错误对象上继续操作。
- How：构造至少两条连接配置，其中一条为当前激活配置；调用 Settings 大模型页使用的配置查询服务或 IPC。
- Oracle：返回结果包含全部连接配置，对齐 `SET-MODEL-001-AC1`；返回结果中存在唯一当前激活配置标识，对齐 `SET-MODEL-001-AC2`。
- Not：不验证列表视觉样式、排序规则和新增/编辑表单交互。

#### `model-page-load-active-config`

- 测试类型：`e2e`
- What：验证用户进入大模型页后，配置列表与当前激活配置标识能在页面上完成初始化展示。
- Why：这是一条直接对齐首屏可见状态的用户链路，失败时用户会把问题感知为“设置页没加载出来”或“当前配置不明确”。
- How：准备包含当前激活配置的连接配置数据集，打开 Settings 的大模型页，等待页面完成初始化。
- Oracle：页面打开后可以看到配置列表，对齐 `SET-MODEL-001-AC1`；当前激活配置在列表项和页头摘要中都有明确当前态标识，对齐 `SET-MODEL-001-AC2`。
- Not：不验证配置变更后的外溢刷新，也不验证删除结果。

#### `model-create-edit-form`

- 测试类型：`e2e`
- What：验证新增和编辑连接配置的表单内容、预填逻辑与必填校验。
- Why：连接配置是后续 workbench 可用性的前提，一旦表单字段、预填或校验失真，用户很容易保存出不可用配置。
- How：分别进入新增和编辑流；新增流检查表单字段，编辑流检查预填；再覆盖缺少必填字段时点击保存的路径。
- Oracle：新增表单可填写模型服务地址和 API Key，对齐 `SET-MODEL-002-AC1`；编辑现有配置时表单带出当前值，对齐 `SET-MODEL-002-AC2`；必填字段不完整时保存被拦截，对齐 `SET-MODEL-002-AC3`。
- Not：不验证保存成功后的事件派发和跨页面刷新。

#### `model-remote-list-refresh`

- 测试类型：`e2e`
- What：验证连接配置可以通过模型列表入口获取远端模型，并能区分成功数量展示与失败反馈。
- Why：workbench 的模型切换依赖当前激活配置下的模型列表，如果刷新状态不清晰，用户无法判断当前配置是否可用于对话。
- How：准备一条当前连接配置，通过真实模型列表接口或真实本地 HTTP 服务分别覆盖成功和失败响应，在列表中打开模型列表并触发重新获取。
- Oracle：获取模型列表成功后，配置列表展示模型数量且弹窗展示具体模型，对齐 `SET-MODEL-002-AC4`；失败时列表和弹窗展示明确错误提示，对齐 `SET-MODEL-002-AC5`。
- Not：不验证模型列表持久化；当前模型列表仅作为展示和 workbench 下拉来源。

#### `model-first-config-auto-activate`

- 测试类型：`e2e`
- What：验证当配置列表为空时，新增第一条配置后会自动成为当前配置。
- Why：第一条配置的默认激活规则是初次可用性的关键，如果这里失效，用户保存后仍无法立即使用模型。
- How：以空配置列表进入新增流，保存第一条有效连接配置。
- Oracle：第一条配置保存成功后立即成为当前配置，并展示当前态标识，对齐 `SET-MODEL-003-AC1`。
- Not：不覆盖已有多条配置时的手动切换逻辑。

#### `model-enable-switch-current`

- 测试类型：`e2e`
- What：验证用户手动启用其他连接配置后，当前配置标识会正确切换。
- Why：启用切换是连接配置管理最核心的日常操作，错误会直接导致 workbench 用错模型服务或地址。
- How：准备一条当前配置和一条非当前配置，在列表中对非当前配置执行“启用”。
- Oracle：目标配置切换为当前配置，原激活配置失去当前态标识，对齐 `SET-MODEL-003-AC2`。
- Not：不验证切换后的跨页面刷新事件内容；该部分由 `model-active-config-change-event` 覆盖。

#### `model-active-config-change-event`

- 测试类型：`e2e`
- What：验证保存当前激活配置或切换当前配置成功后，会向外派发 `check-llm-config` 事件，并使下游读取到最新配置。
- Why：Settings 页本身只是配置入口，真正风险在于其他页面是否能感知变更；如果事件不派发，页面间状态会长期失真。
- How：分别覆盖“编辑当前激活配置并保存成功”和“切换当前激活配置成功”两条路径，监听事件总线或 IPC 派发结果。
- Oracle：两条成功路径都会派发 `check-llm-config` 事件，对齐 `SET-MODEL-004-AC1`；事件派发后，下游读取到的当前连接配置已经更新，对齐 `SET-MODEL-004-AC1`、`SET-MODEL-004-AC2`。
- Not：不直接验证后续消费页面的 UI 刷新；这里只验证 Settings 触发的变更信号与下游可见最新配置。

#### `model-delete-config-feedback`

- 测试类型：`e2e`
- What：验证删除连接配置后的列表刷新，以及删除失败时的错误反馈。
- Why：删除结果是最直接的用户确认反馈，缺失时用户会误判配置是否已经被移除。
- How：分别覆盖删除成功和删除失败两条路径。
- Oracle：删除成功后，被删配置不再出现在列表中，对齐 `SET-MODEL-005-AC1`；删除失败时页面出现明确错误提示，对齐 `SET-MODEL-005-AC2`。
- Not：不定义删除后默认重新选中哪一项；只验证被删项移除和失败反馈。

### 4.2 `workspace / core`

#### `workspace-page-load-default-selection`

- 测试类型：`e2e`
- What：验证工作空间页打开后会自动初始化列表和详情，并默认选中第一条工作空间。
- Why：后续文件 / 网页管理都依赖首屏默认选中，如果这里失效，详情区会表现成“无从下手”。
- How：通过 UI 创建两个工作空间，进入工作空间页并等待第一条详情渲染完成。
- Oracle：页面打开后列表和详情区会自动完成初始化，对齐 `SET-WORKSPACE-001-AC1`；第一条工作空间自动成为当前选中项，且左侧同时表达文件数与网页数，对齐 `SET-WORKSPACE-001-AC2`、`SET-WORKSPACE-005-AC4`。
- Not：不验证添加或移除工作空间的后续选中回退策略。

#### `workspace-add-selection-flow`

- 测试类型：`e2e`
- What：验证添加工作空间时按名称创建空容器，并在成功后自动切换到新工作空间。
- Why：工作空间已从“目录快照”改为“具名容器”，首个创建动作必须反映这一语义。
- How：进入空工作空间页，覆盖空名称提交和有效名称提交两条路径。
- Oracle：名称为空时不允许提交，对齐 `SET-WORKSPACE-002-AC1`；创建成功后，新工作空间立即进入列表并成为当前选中项，对齐 `SET-WORKSPACE-002-AC2`。
- Not：不验证创建后自动扫描或自动索引；该需求未在 PRD 中定义。

#### `workspace-set-root-path`

- 测试类型：`e2e`
- What：验证文件 tab 内可以为当前工作空间绑定工作文件地址，并立即刷新目录树。
- Why：目录绑定已从“创建工作空间”移动到“文件 tab 内设置”，这是新的主操作链路。
- How：先创建未绑定目录的工作空间，再通过目录选择器为其设置工作文件地址。
- Oracle：成功设置后，当前工作空间会写入文件目录并刷新目录树，对齐 `SET-WORKSPACE-006-AC1`、`SET-WORKSPACE-008-AC3`。
- Not：不验证不同操作系统的原生目录选择器样式，也不验证真实文件系统权限错误分支。

#### `workspace-remove-source-contract`

- 测试类型：`backend`
- What：验证移除工作空间后，工作空间本体、文件索引记录和网页资料记录都被清理。
- Why：`SET-WORKSPACE-006-AC2` 的风险不只在当前列表消失，还在于派生资料范围是否残留脏数据。
- How：预置一条工作空间、一条文件索引记录和一条网页资料记录，然后执行删除。
- Oracle：工作空间列表不再返回被删项，对齐 `SET-WORKSPACE-006-AC2`；文件索引记录与网页资料记录同步消失，对齐 `SET-WORKSPACE-006-AC2`。
- Not：不直接验证后续消费入口的 UI 展示；这里只验证 Settings 列表与后续可选数据源同时清理。

#### `workspace-remove-from-list`

- 测试类型：`e2e`
- What：验证用户在工作空间页移除工作空间后，左侧列表和右侧详情都不会继续展示已删除项。
- Why：这是用户对“移除是否真的成功”的最直接确认反馈。
- How：创建一条工作空间，在详情区执行移除并确认。
- Oracle：移除成功后，该工作空间从列表中消失，对齐 `SET-WORKSPACE-006-AC2`；详情区不会继续显示已删除工作空间的陈旧数据。
- Not：不验证其他消费页面中的范围清理展示；只覆盖 Settings 页内可见结果。

#### `workspace-empty-tree-state`

- 测试类型：`e2e`
- What：验证无工作空间和文件树为空两类提示都能明确展示。
- Why：这些都是首屏阻塞状态，需要直接解释“现在为什么不能继续”。
- How：先进入无工作空间的 Settings 工作空间页，再通过 UI 创建一个未绑定目录的空工作区。
- Oracle：没有工作空间时，列表和详情区都给出明确空态，对齐 `SET-WORKSPACE-007-AC1`；当前目录没有可显示文件时，目录树区域给出空态，对齐 `SET-WORKSPACE-007-AC2`。
- Not：不验证旧本地导入提示；旧数据清理属于 backend / 启动迁移契约，不用假 e2e 制造。

### 4.3 `workspace / files`

#### `workspace-index-job-store-contract`

- 测试类型：`backend`
- What：验证 `workspace_index_job` 支持创建、读取 active、更新阶段进度和批量失败收敛。
- Why：文件和网页索引进度恢复都依赖同一张持久化 job 表，必须先稳定底层 store contract。
- How：预置同一工作区下多个 running job，更新其中一个任务进度后读取 active job，再调用失败收敛逻辑。
- Oracle：active 查询返回同资料类型最新 running job，对齐 `SET-WORKSPACE-004-AC3`；进度更新可持久化读取，对齐 `SET-WORKSPACE-004-AC4`；running job 可批量收敛为失败，对齐 `SET-WORKSPACE-004-AC5`、`SET-WEB-004-AC6`。
- Not：不验证前端订阅事件和按钮禁用，这些由 E2E case 覆盖。

#### `workspace-scan-contract`

- 测试类型：`backend`
- What：验证目录检查会生成文件索引记录，并由持久化 job 与派生摘要驱动页面刷新。
- Why：文件数、需索引数等摘要已不再缓存到 `workspace_source`，这里的契约必须稳定。
- How：扫描真实工作目录，写入 `workspace_source` 与 `workspace_file_index` 后读取派生摘要。
- Oracle：检查任务包含可供页面恢复的持久化 job 信息，对齐 `SET-WORKSPACE-003-AC1`、`SET-WORKSPACE-003-AC3`；工作空间本体只保留容器字段，文件摘要从文件索引记录派生，对齐 `SET-WORKSPACE-003-AC2`、`SET-WORKSPACE-005-AC2`。
- Not：不验证前端按钮状态和目录树视觉展示。

#### `workspace-scan-progress-refresh`

- 测试类型：`e2e`
- What：验证点击“检查更新”后，页面会刷新文件树和需索引摘要。
- Why：这是用户识别“哪些文件该重新建索引”的第一步。
- How：创建一条带扫描延迟的 fixture 工作空间，触发检查更新并读取刷新后的文件树响应。
- Oracle：检查过程中出现持久化进度反馈，且检查更新/更新索引按钮同时禁用，对齐 `SET-WORKSPACE-003-AC1`；检查成功后，文件树和需索引摘要同步刷新，对齐 `SET-WORKSPACE-003-AC2`。
- Not：不验证真实大目录性能和文件系统权限失败分支。

#### `workspace-prepare-contract`

- 测试类型：`backend`
- What：验证更新索引只处理 `可索引 / 失败` 文件，不再暴露旧三种处理模式。
- Why：新模型的核心是增量索引，不再允许“模式选择”成为伪交互。
- How：构造 `needs_index / failed / indexed` 三类记录，验证实际目标集。
- Oracle：更新索引的目标仅包含 `needs_index` 与 `failed`，对齐 `SET-WORKSPACE-004-AC1`；同一工作区文件任务重复启动返回已有 running job，对齐 `SET-WORKSPACE-004-AC3`；契约中不再向产品模型暴露 `full / presence_only / changes_only` 等旧模式，对齐 `SET-WORKSPACE-004`。
- Not：不验证真实 embedding、chunk 写入和单文件索引失败细节。

#### `workspace-prepare-refresh`

- 测试类型：`e2e`
- What：验证点击“更新索引”后，文件状态会刷新为已索引并同步更新摘要。
- Why：这是“索引已经可用”的核心用户反馈链路。
- How：创建一条带索引延迟的 fixture 工作空间，触发更新索引并读取刷新后的文件树响应。
- Oracle：更新索引过程中出现持久化总进度，且检查更新/更新索引按钮同时禁用，对齐 `SET-WORKSPACE-004-AC3`；更新成功后，`indexed / needs_index` 摘要和节点状态同步刷新，对齐 `SET-WORKSPACE-004-AC2`。
- Not：不验证向量内容质量和搜索召回结果。

#### `workspace-prepare-real-fixture-refresh`

- 测试类型：`e2e`
- What：验证 Settings 页面点击“更新索引”时，会对共享真实工作区 fixture 中的支持文件执行真实索引链路，并完成状态收敛。
- Why：现有文件索引 E2E 需要覆盖真实 docx 加载、切分、embedding 与本地索引写入；该链路是用户手动点击更新索引时最容易出现闪退的真实风险面。
- How：把 `tests/fixtures/workspace` 原样复制到隔离临时目录，创建工作空间并绑定该目录，从 Settings 文件 tab 点击“更新索引”，轮询持久化 job、摘要和文件节点状态。
- Oracle：更新索引执行中出现持久化进度且两个索引操作按钮禁用，对齐 `SET-WORKSPACE-004-AC3`；任务结束后应用仍存活，支持文件状态收敛为 `indexed / failed`，文件摘要同步刷新，对齐 `SET-WORKSPACE-004-AC1`、`SET-WORKSPACE-004-AC2`。
- Not：不验证检索召回排序和向量语义质量；只验证真实文件索引链路不会停留在执行中或导致页面不可用。

#### `workspace-prepare-failed-retry`

- 测试类型：`e2e`
- What：验证已有失败文件再次点击“更新索引”时会被纳入本次处理范围，并且文件 tab 的可索引数量包含失败数量。
- Why：失败文件是用户最常见的重试对象，如果失败记录不再进入目标集，或者 UI 不把失败数算进可操作数量，用户会误判“没有东西可更新”。
- How：创建真实工作空间并绑定共享 workspace fixture 的隔离副本，先通过测试注入或服务契约制造一个 `failed` 文件索引记录，再从 Settings 文件 tab 点击“更新索引”，读取 active job 的目标数量、文件摘要和页面可索引数字。
- Oracle：本次 job 的目标数量包含失败文件，对齐 `SET-WORKSPACE-004-AC1`；页面“可索引”数字等于 `needs_index_count + failed_file_count`，并在存在失败文件时展示 `含失败 N 个` 辅助文案，且失败文件重试后状态发生收敛，对齐 `SET-WORKSPACE-004-AC2`、`SET-WORKSPACE-005-AC2`。
- Not：不要求失败文件最终一定成功；允许因真实文件内容或环境依赖再次失败，但必须确认发生了重试。

#### `workspace-prepare-file-failure-isolated`

- 测试类型：`e2e`
- What：验证单个文件索引失败不会导致 Settings 页面或 Electron 应用退出，并会留下文件级失败状态与错误信息。
- Why：真实更新索引可能遇到损坏文件、过大文件或 loader/native 异常；单文件失败必须被隔离为资料级失败，不能拖垮整个应用。
- How：在真实工作空间隔离目录中放入一个会触发索引失败的支持文件和一个可索引文件，从 Settings 文件 tab 点击“更新索引”，观察 job、页面存活状态、成功文件与失败文件状态。
- Oracle：应用在索引结束后仍可响应 IPC 和页面查询，对齐 `SET-WORKSPACE-004-AC5` 的失败收敛语义；失败文件保留 `failed / last_error`，其他文件不因该失败丢失状态，对齐 `SET-WORKSPACE-004-AC2`、`SET-WORKSPACE-008-AC2`。
- Not：不模拟操作系统强杀；如果 native 崩溃导致进程退出，该 case 应失败并作为后续 worker/child process 隔离修复的回归目标。

#### `workspace-prepare-progress-restore`

- 测试类型：`e2e`
- What：验证文件索引执行中离开并返回工作空间页后，进度块和按钮状态会恢复。
- Why：索引任务已切换为持久化后台 job，页面生命周期不能影响用户对任务状态的判断。
- How：创建带 prepare 延迟的 fixture 工作空间，触发更新索引后切到其他设置页，再返回工作空间页读取 active job 与 UI 状态。
- Oracle：返回后仍能看到 running job 对应的进度块，且检查更新/更新索引按钮继续禁用，对齐 `SET-WORKSPACE-004-AC4`。
- Not：不模拟真实 Electron 进程退出；中断收敛由 `workspace-interrupted-job-recovery-contract` 覆盖。

#### `workspace-detail-status-and-error`

- 测试类型：`e2e`
- What：验证文件 tab 用可索引数承载失败提示，并在索引失败后保留文件级错误状态；目录树文件项不再展示文件名下方辅助字项。
- Why：文件问题通常发生在索引阶段，如果失败只留在控制台，用户无法判断资料是否可用。
- How：创建一条 prepare 会失败的 fixture 工作空间，触发更新索引并读取刷新后的文件树响应。
- Oracle：文件 tab 的可索引数字包含失败数量并展示 `含失败 N 个` 辅助文案，对齐 `SET-WORKSPACE-005-AC2`；文件索引失败后，失败状态和错误信息保留在文件级记录中，目录树文件项只保留文件名与状态标记，对齐 `SET-WORKSPACE-008-AC2`。
- Not：不验证错误文案的逐字 UI 展示，也不验证恢复失败文件后的二次成功链路。

#### `workspace-index-worker-contract`

- 测试类型：`backend`
- What：验证 workspace 文件索引 worker 协议与 embedding batch 限制。
- Why：更新索引的稳定性依赖文件级 worker 响应和受控 batch，若 batch 过大或 worker 错误不能文件级收敛，真实工作区更新索引可能重新出现卡顿或闪退。
- How：用纯函数覆盖 batch 组装规则；用 cached split/vector 请求覆盖 worker 成功响应；用不支持文件请求覆盖 worker JS error 返回；用临时 worker 脚本模拟非 0 exit 后重建 worker。
- Oracle：batch 同时满足最多 `4` 个 chunk 和最多 `12000` 字符，单 chunk 超过 `12000` 时单独 embed，单 chunk 超过 `40000` 时失败；worker 成功返回 main 可写库的 split/chunks/vectors，worker JS error 返回文件级失败响应，worker exit 会让当前请求失败并在下一次文件请求中重建 worker，对齐 `SET-WORKSPACE-004-AC1`、`SET-WORKSPACE-004-AC2`。
- Not：不验证真实 embedding 语义质量；不验证 native crash 进程隔离，若 worker_threads 仍遇到原生崩溃，应升级到进程级隔离方案。

#### `workspace-interrupted-job-recovery-contract`

- 测试类型：`backend`
- What：验证启动恢复会把遗留的工作空间索引任务和条目级执行中状态收敛为失败。
- Why：程序被直接关闭时退出钩子不可靠，必须靠下次启动恢复避免长期停留在索引中。
- How：预置 running job、文件 `indexing`、网页 `crawling / indexing`，调用存储恢复逻辑。
- Oracle：running job 被标记为失败，对齐 `SET-WORKSPACE-004-AC5`、`SET-WEB-004-AC6`；文件和网页执行中状态分别收敛为失败状态，对齐 `SET-WORKSPACE-004-AC5`、`SET-WEB-004-AC6`。
- Not：不模拟真实操作系统强杀，只验证启动恢复的数据收敛规则。

### 4.4 `workspace / web`

#### `workspace-detail-contains-web-management`

- 测试类型：`e2e`
- What：验证网页资料管理直接内嵌在当前工作空间详情区内，并与文件 tab 平级切换。
- Why：网页不再从属于文件区域；如果这里退回旧布局，交互心智会再次偏向文件主视角。
- How：创建工作区和网页资料，进入工作空间详情并切到网页 tab。
- Oracle：网页 tab 内直接出现索引状态面板、列表和添加入口，对齐 `SET-WORKSPACE-005-AC3`、`SET-WEB-001-AC3`；整个操作停留在 `/settings/workspace` 内完成，对齐 `SET-WORKSPACE-005-AC3`。
- Not：不验证网页列表项的打开和删除动作；这些由独立 case 覆盖。

#### `web-add-sources-dialog`

- 测试类型：`e2e`
- What：验证网页资料添加弹窗支持空输入校验、多行 URL 提交和成功后的清空收尾。
- Why：这是网页资料进入系统的主入口。
- How：进入网页 tab，覆盖空输入提交、多行 URL 提交和再次打开弹窗三条路径。
- Oracle：输入为空时提交被拦截，对齐 `SET-WEB-002-AC1`；多行 URL 提交后，网页资料进入当前工作区列表，对齐 `SET-WEB-002-AC2`；提交成功后弹窗关闭且输入被清空，对齐 `SET-WEB-002-AC3`。
- Not：不验证 URL 抓取内容质量，也不验证 include/exclude selector 的解析效果。

#### `web-scan-summary-refresh`

- 测试类型：`e2e`
- What：验证点击“检查更新”后，网页状态会刷新为需索引，并同步更新摘要统计。
- Why：网页和文件一样，需要先判断“内容是否变了”再决定是否重建索引。
- How：预置一条已索引网页，执行“检查更新”并读取刷新后的网页列表。
- Oracle：检查执行中出现持久化进度，且检查更新/更新索引按钮同时禁用，对齐 `SET-WEB-003-AC1`；检查成功后，网页列表状态与需索引摘要同步刷新，对齐 `SET-WEB-003-AC2`。
- Not：不验证真实网页 HTTP 缓存头、正文 diff 算法和网络失败分支。

#### `web-prepare-summary`

- 测试类型：`e2e`
- What：验证点击“更新索引”后，网页会区分成功索引与爬取失败，并刷新摘要统计。
- Why：网页索引是“爬取 + 建索引”两阶段链路，失败类型必须可区分。
- How：预置一条成功网页和一条带失败标记的网页，先执行“检查更新”，再执行“更新索引”。
- Oracle：更新索引执行中出现抓取/索引分阶段进度，且检查更新/更新索引按钮同时禁用，对齐 `SET-WEB-004-AC4`；成功处理的网页转为已索引，对齐 `SET-WEB-004-AC2`；失败网页被标记为爬取失败，失败数量同步更新，对齐 `SET-WEB-004-AC3`。
- Not：不验证真实网页正文切块、embedding 写入质量和索引失败以外的网络细节。

#### `web-prepare-progress-restore`

- 测试类型：`e2e`
- What：验证网页索引执行中离开并返回网页 tab 后，分阶段进度块和按钮状态会恢复。
- Why：网页索引包含抓取与索引两阶段，恢复时不能只恢复“执行中”标签而丢失当前阶段。
- How：创建带 prepare 延迟的 fixture 工作区，触发网页更新索引后切到其他设置页，再返回网页 tab 读取 active job 与进度文案。
- Oracle：返回后仍能看到 running job 对应的分阶段进度，且检查更新/更新索引按钮继续禁用，对齐 `SET-WEB-004-AC5`。
- Not：不验证无抓取动作时直接展示第二步的真实内容缓存分支；该分支由后端 job 状态能力保留。

#### `web-detail-and-delete`

- 测试类型：`e2e`
- What：验证网页列表项展示标题、URL、状态和抓取时间，并在删除成功后刷新列表。
- Why：这是网页资料管理最基础的可见反馈。
- How：预置一条网页资料，检查列表项展示内容后执行删除。
- Oracle：列表项展示标题、URL、状态和抓取时间，对齐 `SET-WEB-005-AC1`；删除成功后，该网页资料从列表中消失，对齐 `SET-WEB-005-AC3`。
- Not：不验证删除后的 document/chunk 物理清理契约；这里只覆盖 Settings 页内可见结果。

#### `web-open-url-contract`

- 测试类型：`e2e`
- What：验证点击“打开”按钮时，会通过系统浏览器打开原网页地址。
- Why：如果这里误打开本地索引副本或失去外链能力，网页资料的原始上下文就被切断了。
- How：通过 UI 添加目标 URL，在网页 tab 点击打开按钮，用 IPC observer 辅助确认 `openExternal` 收到原始 URL。
- Oracle：触发 `openExternal(originalUrl)`，对齐 `SET-WEB-005-AC2`。
- Not：不验证系统浏览器窗口是否真的出现在前台，也不验证不同操作系统的外链打开体验。

### 4.5 `vector`

#### `vector-model-catalog-load`

- 测试类型：`e2e`
- What：验证向量模型页打开后，真实模型目录能加载，并展示下载或已安装状态。
- Why：向量模型是检索能力的基础依赖，如果列表加载状态不清晰，用户无法判断是否还需要下载模型。
- How：打开 Settings 向量模型页，等待真实模型目录渲染。
- Oracle：页面至少展示一个模型卡片，且每个模型有下载按钮或已安装标识，对齐 `SET-VECTOR-001-AC1`。
- Not：不验证下载进度、下载成功、下载失败和删除反馈；这些不能再通过假进度 e2e 验证。

#### `vector-download-single-task-contract`

- 测试类型：`backend`
- What：验证向量模型下载在服务层只允许同一时间一个任务进行。
- Why：并发下载会争用本地模型目录、进度通道和最终安装状态，必须在服务层建立单任务边界。
- How：在 backend contract 中控制下载执行耗时，先启动一个下载任务，再尝试启动第二个任务。
- Oracle：已有下载任务时，新的下载入口不可继续触发新任务，对齐 `SET-VECTOR-002-AC1`。
- Not：不验证真实下载速度、网络失败和磁盘写入完整性。

#### `vector-download-startup-resume-contract`

- 测试类型：`backend`
- What：验证应用启动时遇到进行中的向量模型下载快照，会恢复后台下载并继续上报进度。
- Why：如果启动恢复失效，用户会误以为长时间下载已经丢失，重新进入页面时也无法看到一致的进度状态。
- How：预置一条进行中的下载快照，初始化向量模型下载服务，观察是否恢复同一模型下载、继续上报进度，并在完成后清理快照。
- Oracle：服务初始化后自动恢复同一模型下载并持续上报进度，对齐 `SET-VECTOR-002-AC4`。
- Not：不验证真实网络环境下的跨版本兼容；这里只覆盖本地快照恢复与同步。

下载进度、下载结果、页面切换恢复和删除反馈不再登记为正式 e2e。它们需要真实大文件下载环境，短期由 `vector-download-single-task-contract` 和 `vector-download-startup-resume-contract` 覆盖服务契约，必要时另建真实下载手动回归。
