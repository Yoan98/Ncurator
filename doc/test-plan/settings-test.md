# NCurator-Desktop Settings 测试计划

## 1. 总体目标

本计划用于定义 Settings 用户可见能力的正式测试范围。

Settings 正式测试统一对齐 [settings.md](/Users/test/work-space/NCurator-Desktop/doc/prd/settings.md)，新增、调整或验收结论都应引用对应的 `SET-*` 需求编号与验收编号。

## 2. Suite 设计

Settings 的正式测试 suite 直接对齐 PRD 模块：

1. `model`
2. `workspace`
3. `web`
4. `vector`


### 2.1 `model`

做什么：验证大模型配置的加载、创建、编辑、启用和删除。

为什么：模型配置会直接影响 workbench 后续可用模型和状态刷新。

怎么做：围绕模型列表、表单校验、激活配置切换、配置变更事件和删除结果组织正式 case。

### 2.2 `workspace`

做什么：验证工作空间管理的页面行为及其 backend 支撑契约。

为什么：工作空间是本地资料进入系统的主要入口，设置结果会继续影响 workbench 的范围选择和本地执行前提。

怎么做：围绕工作空间加载、创建、扫描、按模式加载、错误与摘要、打开路径、移除和空态组织正式 case；需要时在 backend 层验证直接支撑这些行为的服务与 IPC 契约。

### 2.3 `web`

做什么：验证网页资料管理的页面行为及其 backend 支撑契约。

为什么：网页资料和本地工作空间共同构成资料入口，不能只验证本地一侧。

怎么做：围绕网页资料列表、筛选、添加、单条刷新、全部抓取、详情展示、外链打开和删除组织正式 case。

### 2.4 `vector`

做什么：验证向量模型的加载、下载、进度和错误收敛。

为什么：向量模型是后续检索与知识库能力的基础依赖。

怎么做：围绕模型列表、单任务下载、进度展示、完成刷新和失败反馈组织正式 case。

## 3. Suite 归属规则

- Settings 的用户可见行为默认归入本计划，不再单独维护 `workspace` 测试域。
- `workspace` 在这里是 Settings 下的 suite，不是独立测试 domain。

## 4. Case 登记约定

- 本文中的 `用例名称` 直接作为稳定 `caseId` 使用。
- 当前 `settings` 域下还没有已登记的正式测试文件，因此本文新增的正式 case 先统一标记为 `未实现`，后续再按确认后的取舍落测试代码。
- Settings 当前不额外拆 `group`；若后续没有新增层级需求，正式 case 默认直接落在 `tests/settings/<suite>/`。
- 文件映射规则：
  - `backend`：`tests/settings/<suite>/<caseId>.test.ts`
  - `e2e`：`tests/settings/<suite>/<caseId>.e2e.test.ts`
- `How` 与 `Oracle` 必须显式映射到 [settings.md](/Users/test/work-space/NCurator-Desktop/doc/prd/settings.md) 的需求编号与验收编号。

## 5. 正式 Case 清单

### 5.1 `model`

#### `model-config-list-contract`

- 用例名称：`model-config-list-contract`
- 测试类型：`backend`
- 实现状态：`未实现`
- What：验证大模型页初始化依赖的配置查询契约，能够返回完整配置列表并明确识别当前激活配置。
- Why：如果列表查询或当前配置识别失真，页面首屏、页头摘要和后续编辑/启用链路都会在错误对象上继续操作。
- How：构造至少两条模型配置，其中一条为当前激活配置；调用 Settings 大模型页使用的配置查询服务或 IPC，核对返回结果是否可直接支撑页面初始化；对齐 `SET-MODEL-001`，覆盖 `SET-MODEL-001-AC1`、`SET-MODEL-001-AC2`。
- Oracle：
  - 返回结果包含全部模型配置，不需要依赖额外刷新才能完成首屏初始化，对齐 `SET-MODEL-001-AC1`。
  - 返回结果中存在唯一当前激活配置标识，可同时支撑列表当前态和页头摘要当前态渲染，对齐 `SET-MODEL-001-AC2`。
- Not：不验证列表视觉样式、排序规则和新增/编辑表单交互。

#### `model-page-load-active-config`

- 用例名称：`model-page-load-active-config`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证用户进入大模型页后，配置列表与当前激活配置标识能在页面上完成初始化展示。
- Why：这是一条直接对齐首屏可见状态的用户链路，失败时用户会把问题感知为“设置页没加载出来”或“当前模型不明确”。
- How：准备包含当前激活配置的模型数据集，打开 Settings 的大模型页，等待页面完成初始化；对齐 `SET-MODEL-001`，覆盖 `SET-MODEL-001-AC1`、`SET-MODEL-001-AC2`。
- Oracle：
  - 页面打开后可以看到配置列表，而不是停留在未初始化或空白状态，对齐 `SET-MODEL-001-AC1`。
  - 当前激活配置在列表项和页头摘要中都有明确当前态标识，对齐 `SET-MODEL-001-AC2`。
- Not：不验证配置变更后的外溢刷新，也不验证删除结果。

#### `model-create-edit-form`

- 用例名称：`model-create-edit-form`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证新增和编辑配置的表单内容、预填逻辑与必填校验。
- Why：模型配置是后续 workbench 可用性的前提，一旦表单字段、预填或校验失真，用户很容易保存出不可用配置。
- How：分别进入新增和编辑流；新增流检查表单字段，编辑流检查预填；再覆盖缺少必填字段时点击保存的路径；对齐 `SET-MODEL-002`，覆盖 `SET-MODEL-002-AC1`、`SET-MODEL-002-AC2`、`SET-MODEL-002-AC3`。
- Oracle：
  - 新增表单可填写配置名称、Base URL、模型名称和 API Key，对齐 `SET-MODEL-002-AC1`。
  - 编辑现有配置时表单带出当前值，而不是打开空表单，对齐 `SET-MODEL-002-AC2`。
  - 必填字段不完整时保存被拦截，不会提交成功，对齐 `SET-MODEL-002-AC3`。
- Not：不验证保存成功后的事件派发和跨页面刷新。

#### `model-first-config-auto-activate`

- 用例名称：`model-first-config-auto-activate`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证当模型列表为空时，新增第一条配置后会自动成为当前模型。
- Why：第一条配置的默认激活规则是初次可用性的关键，如果这里失效，用户保存后仍无法立即使用模型。
- How：以空模型列表进入新增流，保存第一条有效配置；对齐 `SET-MODEL-003`，覆盖 `SET-MODEL-003-AC1`。
- Oracle：
  - 第一条配置保存成功后立即成为当前模型，并展示当前态标识，对齐 `SET-MODEL-003-AC1`。
- Not：不覆盖已有多条配置时的手动切换逻辑。

#### `model-enable-switch-current`

- 用例名称：`model-enable-switch-current`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证用户手动启用其他模型配置后，当前模型标识会正确切换。
- Why：启用切换是模型管理最核心的日常操作，错误会直接导致 workbench 用错模型。
- How：准备一条当前配置和一条非当前配置，在列表中对非当前配置执行“启用”；对齐 `SET-MODEL-003`，覆盖 `SET-MODEL-003-AC2`。
- Oracle：
  - 目标配置切换为当前模型，原激活配置失去当前态标识，对齐 `SET-MODEL-003-AC2`。
- Not：不验证切换后的跨页面刷新事件内容；该部分由 `model-active-config-change-event` 覆盖。

#### `model-active-config-change-event`

- 用例名称：`model-active-config-change-event`
- 测试类型：`backend`
- 实现状态：`未实现`
- What：验证保存当前激活配置或切换当前配置成功后，会向外派发 `check-llm-config` 事件，并使下游读取到最新配置。
- Why：Settings 页本身只是配置入口，真正风险在于其他页面是否能感知变更；如果事件不派发，页面间状态会长期失真。
- How：分别覆盖“编辑当前激活配置并保存成功”和“切换当前激活配置成功”两条路径，监听事件总线或 IPC 派发结果，并校验后续读取到的新激活配置；对齐 `SET-MODEL-004`，覆盖 `SET-MODEL-004-AC1`、`SET-MODEL-004-AC2`。
- Oracle：
  - 两条成功路径都会派发 `check-llm-config` 事件，对齐 `SET-MODEL-004-AC1`。
  - 事件派发后，下游读取到的当前模型配置已经更新到最新值，不需要重启页面，对齐 `SET-MODEL-004-AC1`、`SET-MODEL-004-AC2`。
- Not：不直接验证 workbench 页面 UI 刷新；workbench 侧展示和消费行为应在 workbench 测试计划中单独覆盖。

#### `model-delete-config-feedback`

- 用例名称：`model-delete-config-feedback`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证删除模型配置后的列表刷新，以及删除失败时的错误反馈。
- Why：删除结果是最直接的用户确认反馈，缺失时用户会误判配置是否已经被移除。
- How：分别覆盖删除成功和删除失败两条路径；对齐 `SET-MODEL-005`，覆盖 `SET-MODEL-005-AC1`、`SET-MODEL-005-AC2`。
- Oracle：
  - 删除成功后，被删配置不再出现在列表中，对齐 `SET-MODEL-005-AC1`。
  - 删除失败时页面出现明确错误提示，对齐 `SET-MODEL-005-AC2`。
- Not：不定义删除后默认重新选中哪一项；只验证被删项移除和失败反馈。

### 5.2 `workspace`

#### `workspace-page-load-default-selection`

- 用例名称：`workspace-page-load-default-selection`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证工作空间页打开后会自动初始化列表和详情，并在未选中时默认选中第一条工作空间。
- Why：工作空间页的后续扫描、加载和详情展示都依赖首屏默认选中，如果这里失效，用户会看到看似“没有详情”的错误状态。
- How：准备至少两条工作空间且当前没有显式选中项，打开工作空间页并等待初始化完成；对齐 `SET-WORKSPACE-001`，覆盖 `SET-WORKSPACE-001-AC1`、`SET-WORKSPACE-001-AC2`。
- Oracle：
  - 页面打开后列表与详情区都完成初始化，不依赖手动刷新，对齐 `SET-WORKSPACE-001-AC1`。
  - 第一条工作空间自动成为当前选中项，详情区展示它的状态和摘要，对齐 `SET-WORKSPACE-001-AC2`。
- Not：不验证添加或移除工作空间的后续选中回退策略。

#### `workspace-add-selection-flow`

- 用例名称：`workspace-add-selection-flow`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证添加工作空间时，取消目录选择不会产生副作用，选择目录成功后会立刻创建并切到新工作空间。
- Why：目录选择器是最常见的外部依赖入口，如果取消和成功路径没有分清，用户很容易遇到误报错或误创建。
- How：覆盖目录选择器取消路径和选择目录成功路径；对齐 `SET-WORKSPACE-002`，覆盖 `SET-WORKSPACE-002-AC1`、`SET-WORKSPACE-002-AC2`。
- Oracle：
  - 用户取消目录选择时，不创建工作空间，也不出现失败提示，对齐 `SET-WORKSPACE-002-AC1`。
  - 创建成功后，新工作空间立刻出现在列表中并成为当前选中项，对齐 `SET-WORKSPACE-002-AC2`。
- Not：不验证后续自动扫描或自动加载；该需求未在 PRD 中定义。

#### `workspace-scan-contract`

- 用例名称：`workspace-scan-contract`
- 测试类型：`backend`
- 实现状态：`未实现`
- What：验证工作空间扫描请求的参数、进度事件和结果载荷契约，能支撑页面同步刷新扫描状态与目录树。
- Why：扫描过程涉及异步状态和目录快照，如果契约不稳定，页面层再完整也会展示出错或停留在旧数据。
- How：以选中工作空间为输入，调用扫描服务或 IPC，模拟进行中和完成态返回；对齐 `SET-WORKSPACE-003`，覆盖 `SET-WORKSPACE-003-AC1`、`SET-WORKSPACE-003-AC2`。
- Oracle：
  - 扫描执行中会产生可用于页面展示的动作状态或进度信息，对齐 `SET-WORKSPACE-003-AC1`。
  - 扫描成功结果包含最近扫描时间、状态和最新目录树信息，可直接驱动页面刷新，对齐 `SET-WORKSPACE-003-AC2`。
- Not：不验证页面上的进度文案和按钮禁用样式。

#### `workspace-scan-progress-refresh`

- 用例名称：`workspace-scan-progress-refresh`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证点击“先扫描”后，页面能展示进行中状态，并在完成后刷新时间、状态和目录树。
- Why：这是用户感知工作空间是否已被系统识别的第一条操作链路，失败会直接影响用户后续是否敢继续加载。
- How：在工作空间详情区点击“先扫描”，观察执行中和执行完成两个阶段；对齐 `SET-WORKSPACE-003`，覆盖 `SET-WORKSPACE-003-AC1`、`SET-WORKSPACE-003-AC2`。
- Oracle：
  - 扫描执行中，界面存在明确的进行中状态或进度反馈，对齐 `SET-WORKSPACE-003-AC1`。
  - 扫描成功后，最近扫描时间、状态和目录树同步刷新，对齐 `SET-WORKSPACE-003-AC2`。
- Not：不验证加载模式和加载摘要。

#### `workspace-load-mode-contract`

- 用例名称：`workspace-load-mode-contract`
- 测试类型：`backend`
- 实现状态：`未实现`
- What：验证工作空间加载时，界面选中的 `full`、`presence_only`、`changes_only` 模式会准确进入实际请求。
- Why：加载模式会直接影响知识库构建成本与范围，如果模式在请求层丢失，页面选择就是伪状态。
- How：分别以三种模式触发加载服务或 IPC，校验请求参数和返回载荷；对齐 `SET-WORKSPACE-004`，覆盖 `SET-WORKSPACE-004-AC1`、`SET-WORKSPACE-004-AC2`。
- Oracle：
  - 三种模式都会按当前选中值原样进入实际加载请求，对齐 `SET-WORKSPACE-004-AC1`。
  - 加载成功结果包含最近加载时间、摘要统计和状态信息，可供页面同步刷新，对齐 `SET-WORKSPACE-004-AC2`。
- Not：不验证加载按钮的交互文案和进度视觉反馈。

#### `workspace-load-by-mode`

- 用例名称：`workspace-load-by-mode`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证用户切换加载模式并点击“开始加载”后，页面会按选中模式执行，并刷新最近加载时间、摘要统计和状态 badge。
- Why：这是工作空间从“被识别”走向“可检索”的关键入口，如果页面只切换了 UI 状态而没有真正改变请求，用户后续结果会不可解释。
- How：在同一工作空间上切换加载模式并执行加载，观察成功后的页面状态；对齐 `SET-WORKSPACE-004`，覆盖 `SET-WORKSPACE-004-AC1`、`SET-WORKSPACE-004-AC2`。
- Oracle：
  - 当前选中的加载模式进入实际加载请求，而不是只停留在界面展示，对齐 `SET-WORKSPACE-004-AC1`。
  - 加载成功后，最近加载时间、摘要统计和状态 badge 同步刷新，对齐 `SET-WORKSPACE-004-AC2`。
- Not：不覆盖扫描目录树刷新；该部分由扫描 case 负责。

#### `workspace-detail-status-and-error`

- 用例名称：`workspace-detail-status-and-error`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证详情区会稳定展示工作空间的最近错误和摘要统计，而不是只在控制台暴露状态。
- Why：工作空间问题往往发生在扫描/加载之后，若错误与摘要不可见，用户无法判断当前资料是否可用。
- How：准备带最近错误与摘要统计的工作空间详情数据，进入详情区查看展示；对齐 `SET-WORKSPACE-005`，覆盖 `SET-WORKSPACE-005-AC1`、`SET-WORKSPACE-005-AC2`。
- Oracle：
  - 有错误时，详情区能直接看到最近一次错误，对齐 `SET-WORKSPACE-005-AC1`。
  - 详情区始终可见目录数、文件数、已加载数和待处理数，对齐 `SET-WORKSPACE-005-AC2`。
- Not：不验证错误产生原因或统计字段的内部计算逻辑。

#### `workspace-open-path-contract`

- 用例名称：`workspace-open-path-contract`
- 测试类型：`backend`
- 实现状态：`未实现`
- What：验证点击“打开路径”时，会通过系统能力定位当前工作空间目录。
- Why：这是 Settings 与宿主系统的直接交互点，页面层很难补救底层调用错误。
- How：以已选中工作空间为输入，触发“打开路径”调用，监听外壳层 IPC 或系统桥接调用；对齐 `SET-WORKSPACE-006`，覆盖 `SET-WORKSPACE-006-AC1`。
- Oracle：
  - 会以当前工作空间根目录为参数触发系统定位调用，对齐 `SET-WORKSPACE-006-AC1`。
- Not：不验证不同操作系统的原生窗口样式和 Finder/Explorer 具体呈现。

#### `workspace-remove-source-contract`

- 用例名称：`workspace-remove-source-contract`
- 测试类型：`backend`
- 实现状态：`未实现`
- What：验证移除工作空间后，该工作空间会从 Settings 列表数据源与后续资料范围依赖的数据源中同时消失。
- Why：`SET-WORKSPACE-006-AC2` 的真实风险不只在当前列表消失，还在于其他入口是否继续拿到已删除的工作空间。
- How：执行移除工作空间操作后，分别查询 Settings 工作空间列表数据源与后续范围选择依赖的数据源；对齐 `SET-WORKSPACE-006`，覆盖 `SET-WORKSPACE-006-AC2`。
- Oracle：
  - 被移除工作空间不再出现在后续列表查询结果中，对齐 `SET-WORKSPACE-006-AC2`。
  - 被移除工作空间不再出现在后续资料范围可选数据源中，对齐 `SET-WORKSPACE-006-AC2`。
- Not：不直接验证 workbench 范围选择器的 UI 展示；该 UI 行为应在 workbench 测试计划中单独覆盖。

#### `workspace-remove-from-list`

- 用例名称：`workspace-remove-from-list`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证用户在工作空间页移除工作空间后，当前列表和详情区不会继续展示已删除项。
- Why：这是用户对“移除”是否成功的最直接确认，如果页面还保留旧项，会造成强烈的状态错觉。
- How：在工作空间页选中某条工作空间并执行移除；对齐 `SET-WORKSPACE-006`，覆盖 `SET-WORKSPACE-006-AC2` 在 Settings 页内的可见结果。
- Oracle：
  - 移除成功后，该工作空间从列表中消失，对齐 `SET-WORKSPACE-006-AC2`。
  - 详情区不会继续显示已删除工作空间的陈旧数据。
- Not：不验证 workbench 会话中的范围清理展示；只覆盖 Settings 页内可见结果。

#### `workspace-empty-tree-legacy-hints`

- 用例名称：`workspace-empty-tree-legacy-hints`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证无工作空间、无可追踪文件和旧本地导入残留三类提示都能在页面上明确展示。
- Why：这些都属于用户进入页面后最容易遇到的“为什么现在不能继续”的解释性状态，缺失时用户会把系统理解为异常。
- How：分别准备三类 fixture：没有工作空间、存在工作空间但没有可追踪文件、检测到旧本地导入数据；对齐 `SET-WORKSPACE-007`，覆盖 `SET-WORKSPACE-007-AC1`、`SET-WORKSPACE-007-AC2`、`SET-WORKSPACE-007-AC3`。
- Oracle：
  - 没有工作空间时，详情区展示明确空态提示，而不是空白页，对齐 `SET-WORKSPACE-007-AC1`。
  - 没有可追踪文件时，目录树区域显示“没有可追踪文件”，对齐 `SET-WORKSPACE-007-AC2`。
  - 检测到旧本地导入数据时，页面顶部出现迁移清理提醒，对齐 `SET-WORKSPACE-007-AC3`。
- Not：不验证迁移清理动作本身的执行结果；这里只验证提示出现。

### 5.3 `web`

#### `web-page-load-filter-selection`

- 用例名称：`web-page-load-filter-selection`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证网页资料页打开后会初始化列表与详情，本地筛选能按标题、URL 或标准化 URL 生效，并在筛选结果非空时默认选中第一条。
- Why：网页资料的数据量和筛选频率都较高，如果首屏和筛选状态不稳定，后续刷新、查看和删除都没有可靠入口。
- How：准备多条网页资料，分别覆盖首屏初始化、按标题/URL/标准化 URL 筛选、筛选后无结果三条路径；对齐 `SET-WEB-001`，覆盖 `SET-WEB-001-AC1`、`SET-WEB-001-AC2`、`SET-WEB-001-AC3`。
- Oracle：
  - 页面打开后，来源列表和详情区完成初始化，对齐 `SET-WEB-001-AC1`。
  - 输入关键字后，列表按标题、URL 或标准化 URL 过滤，对齐 `SET-WEB-001-AC2`。
  - 筛选结果为空时，页面明确展示筛选为空，而不是加载失败，对齐 `SET-WEB-001-AC3`。
- Not：不验证新增、抓取和删除动作。

#### `web-add-sources-dialog`

- 用例名称：`web-add-sources-dialog`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证网页资料添加弹窗的空输入校验、多行 URL 提交和成功后的收尾反馈。
- Why：网页资料导入通常成批发生，如果弹窗校验和成功收尾不稳定，用户会反复提交或误判是否已入队。
- How：打开添加弹窗，分别覆盖空输入提交和多行 URL 成功提交；对齐 `SET-WEB-002`，覆盖 `SET-WEB-002-AC1`、`SET-WEB-002-AC2`。
- Oracle：
  - 输入为空时，提交会被拦截，并提示至少输入一个 URL，对齐 `SET-WEB-002-AC1`。
  - 提交成功后，提示“网页资料已加入队列”，输入内容被清空，对齐 `SET-WEB-002-AC2`。
- Not：不验证后续抓取实际完成结果；这里只验证入队入口。

#### `web-refresh-one-source`

- 用例名称：`web-refresh-one-source`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证用户对当前选中的网页资料执行重新抓取时，会看到刷新中的状态，并在成功后刷新最近抓取时间和状态。
- Why：单条重新抓取是最常见的纠错动作，如果状态更新滞后，用户无法判断当前网页是否已被重新处理。
- How：选中一条网页资料并执行重新抓取，覆盖执行中和执行成功两阶段；对齐 `SET-WEB-003`，覆盖 `SET-WEB-003-AC1`、`SET-WEB-003-AC2`。
- Oracle：
  - 抓取执行中，当前网页资料显示刷新中的状态，对齐 `SET-WEB-003-AC1`。
  - 抓取成功后，最近抓取时间和状态被刷新，对齐 `SET-WEB-003-AC2`。
- Not：不验证“全部抓取”的汇总反馈。

#### `web-refresh-visible-list-contract`

- 用例名称：`web-refresh-visible-list-contract`
- 测试类型：`backend`
- 实现状态：`未实现`
- What：验证“全部抓取”只会对当前列表中的网页资料发起重新抓取，不会误触发被筛掉的项目。
- Why：这个约束决定了筛选与批量动作是否真正联动，若契约错误，用户在小范围操作时会不知情地刷新更多网页。
- How：在存在“当前可见列表”和“当前被筛掉列表”的前提下触发全部抓取，再覆盖当前列表为空的分支；对齐 `SET-WEB-004`，覆盖 `SET-WEB-004-AC1`，并约束 `SET-WEB-004` 的执行范围。
- Oracle：
  - 当前列表为空时，不发送抓取请求，对齐 `SET-WEB-004-AC1`。
  - 当前列表非空时，只有当前列表中的网页资料进入重新抓取请求，不包含被筛掉的项目。
- Not：不验证页面上的汇总提示文案；该部分由 `web-refresh-all-summary` 覆盖。

#### `web-refresh-all-summary`

- 用例名称：`web-refresh-all-summary`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证“全部抓取”在空列表和非空列表两种场景下的页面反馈。
- Why：批量动作的风险在于用户不容易从单条状态反推整体结果，因此必须有明确的空态短路和汇总反馈。
- How：分别覆盖当前列表为空时点击“全部抓取”和当前列表非空且抓取完成的路径；对齐 `SET-WEB-004`，覆盖 `SET-WEB-004-AC1`、`SET-WEB-004-AC2`。
- Oracle：
  - 当前列表为空时，不执行抓取，并提示“暂无可抓取的网页资料”，对齐 `SET-WEB-004-AC1`。
  - 全部抓取结束后，页面按成功数和失败数给出汇总反馈，对齐 `SET-WEB-004-AC2`。
- Not：不验证每条网页资料详情区的单条状态刷新。

#### `web-open-url-contract`

- 用例名称：`web-open-url-contract`
- 测试类型：`backend`
- 实现状态：`未实现`
- What：验证点击网页资料 URL 时，系统会调用默认浏览器打开原网页，而不是进入本地预览路径。
- Why：这是 Settings 页与宿主系统的另一个直接交互点，如果打开错目标，用户会误以为原始来源地址已经丢失。
- How：在网页资料详情中触发打开 URL 操作，监听系统浏览器打开调用参数；对齐 `SET-WEB-005`，覆盖 `SET-WEB-005-AC2`。
- Oracle：
  - 调用参数是原网页 URL，而不是本地文档预览路径，对齐 `SET-WEB-005-AC2`。
- Not：不验证浏览器窗口的系统行为和详情区文案展示。

#### `web-detail-and-delete`

- 用例名称：`web-detail-and-delete`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证网页资料详情区的错误空态展示，以及删除成功后的列表刷新。
- Why：详情区承担了用户定位问题和确认删除结果的双重职责，缺一都会影响资料管理效率。
- How：分别覆盖“当前网页资料没有抓取错误”和“删除当前网页资料成功”两条路径；对齐 `SET-WEB-005`，覆盖 `SET-WEB-005-AC1`、`SET-WEB-005-AC3`。
- Oracle：
  - 没有错误时，详情区明确显示“暂无抓取错误”，对齐 `SET-WEB-005-AC1`。
  - 删除成功后，该网页资料从列表中消失，对齐 `SET-WEB-005-AC3`。
- Not：不验证 URL 外链打开；该能力由 `web-open-url-contract` 覆盖。

### 5.4 `vector`

#### `vector-model-catalog-load`

- 用例名称：`vector-model-catalog-load`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证向量模型页打开后，模型列表能成功加载并区分已安装模型与可下载模型；失败时给出明确错误提示。
- Why：向量模型是检索能力的基础依赖，如果列表加载状态不清晰，用户无法判断是否还需要下载模型。
- How：分别覆盖模型列表加载成功和失败两条路径；对齐 `SET-VECTOR-001`，覆盖 `SET-VECTOR-001-AC1`、`SET-VECTOR-001-AC2`。
- Oracle：
  - 加载成功后，可区分已安装模型与可下载模型，并看到名称、说明与标签等信息，对齐 `SET-VECTOR-001-AC1`。
  - 获取模型列表失败时，页面给出明确错误提示，对齐 `SET-VECTOR-001-AC2`。
- Not：不验证具体下载过程和下载结果。

#### `vector-download-single-task-contract`

- 用例名称：`vector-download-single-task-contract`
- 测试类型：`backend`
- 实现状态：`未实现`
- What：验证向量模型下载的单任务约束与进度事件契约，确保同一时间只能有一个下载任务，并能持续上报进度字段。
- Why：下载任务跨时长较长且依赖宿主环境，若不先锁住底层契约，页面会很容易出现并发触发或进度丢失。
- How：启动一个下载任务后尝试触发第二个下载，并模拟进度事件流；对齐 `SET-VECTOR-002`，覆盖 `SET-VECTOR-002-AC1`、`SET-VECTOR-002-AC2`。
- Oracle：
  - 已有下载任务时，新的下载请求会被阻止，对齐 `SET-VECTOR-002-AC1`。
  - 进度事件持续包含百分比、当前文件、已完成文件数和总文件数，对齐 `SET-VECTOR-002-AC2`。
- Not：不验证页面按钮禁用样式和下载完成后的已安装展示。

#### `vector-download-progress`

- 用例名称：`vector-download-progress`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证下载过程中，页面会持续更新总进度、当前文件和已完成文件数，并阻止其他模型继续触发下载。
- Why：下载过程用户等待时间长，进度和并发约束是避免重复操作与误判的关键反馈。
- How：在向量模型页启动一个下载任务并持续注入进度更新；对齐 `SET-VECTOR-002`，覆盖 `SET-VECTOR-002-AC1`、`SET-VECTOR-002-AC2`。
- Oracle：
  - 已有下载任务时，其他模型的下载入口不可继续触发新任务，对齐 `SET-VECTOR-002-AC1`。
  - 下载过程中，界面持续更新当前文件、完成数和总进度，对齐 `SET-VECTOR-002-AC2`。
- Not：不验证成功安装后的最终状态切换。

#### `vector-download-result-feedback`

- 用例名称：`vector-download-result-feedback`
- 测试类型：`e2e`
- 实现状态：`未实现`
- What：验证向量模型下载完成后会刷新为已安装状态，下载失败时会提示失败原因并退出下载中状态。
- Why：下载的最终状态决定用户是否可以继续使用检索能力；如果收敛不清晰，用户会反复点击下载或误判环境异常。
- How：分别覆盖下载成功和下载失败两条路径；对齐 `SET-VECTOR-003`，覆盖 `SET-VECTOR-003-AC1`、`SET-VECTOR-003-AC2`。
- Oracle：
  - 下载完成后，对应模型显示为“已安装”，不再显示下载按钮，对齐 `SET-VECTOR-003-AC1`。
  - 下载失败时，界面提示失败原因，并退出下载中状态，对齐 `SET-VECTOR-003-AC2`。
- Not：不验证模型文件本体内容或磁盘落地实现细节。
