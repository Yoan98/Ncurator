# NCurator-Desktop Settings 测试计划

## 1. 总体目标

- 本计划定义 Settings 用户可见能力的回归范围，并对齐 [settings.md](../prd/settings.md) 的 `SET-*` 需求和验收编号。
- 通用测试、runner、raw logs、UI E2E 和 live 断言规则遵循 `doc/test.md`。
- Settings 测试全部是 E2E，工作空间、目录、网页和模型状态必须通过真实 UI、原生系统交互与真实输入建立；只读 IPC / 数据库查询只能补充诊断证据，不能创建或修改业务状态。

## 2. Suite 设计

Settings 顶层 suite 对齐 PRD 模块：

1. `model`
2. `general`
3. `workspace`
4. `vector`

领域规则：

- `model` 验证大模型可用服务配置的加载、创建、编辑、删除和远端模型列表刷新。
- `general` 验证 AI 运行系统通知开关的加载、保存和关闭后的静默行为；系统通知中心的真实视觉展示按 macOS 与 Windows 发布前手动验证。
- `workspace` 验证工作空间容器及其下属 `files`、`web` 两类子区域的真实用户操作链路。
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
- How：通过 UI 覆盖删除成功路径；再以真实 SQLite 写锁制造持久化环境故障，仍由用户从 UI 发起删除，不注入接口响应。
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
- Oracle：成功设置后写入文件目录并刷新当前真实目录树，后台扫描进度不会阻塞根目录首层展示，对齐 `SET-WORKSPACE-006-AC1`、`SET-WORKSPACE-006-AC4`、`SET-WORKSPACE-008-AC1`、`SET-WORKSPACE-008-AC3`。
- Not：不验证不同操作系统的原生目录选择器样式，也不验证真实文件系统权限错误分支。

#### `workspace-directory-lazy-load`

- 测试类型：`unit + e2e`
- What：目录树只读取根目录或被展开目录的直属子项，并以加载反馈承载读取过程。
- Why：工作空间可能包含 `node_modules` 等超大目录；进入设置页不能递归枚举整个工作区。
- How：创建包含根目录文件、普通子目录、`node_modules` 和点开头文件/目录的真实临时目录；进入文件 tab 后验证根目录首层，展开普通子目录后验证其直属文件，再确认点开头项始终不可见。
- Oracle：`node_modules` 在根目录可见但其内容不会在首次加载时出现；子目录展开前不读取其子项，展开时显示局部 loading；点开头文件或目录在任意层级均不显示；页面没有全部展开/折叠入口，对齐 `SET-WORKSPACE-008-AC1`、`SET-WORKSPACE-008-AC4`、`SET-WORKSPACE-008-AC5`。
- Not：不以该 case 衡量文件系统吞吐或索引模型性能；全量扫描进度由索引 job 用例覆盖。

#### `workspace-remove-from-list`

- 测试类型：`e2e`
- What：用户在工作空间页移除工作空间后，左侧列表和右侧详情都不会继续展示已删除项。
- Why：列表和详情是用户确认移除成功的直接依据。
- How：创建一条工作空间，在详情区执行移除并确认。
- Oracle：移除成功后，该工作空间从列表中消失，对齐 `SET-WORKSPACE-006-AC2`；详情区不会继续显示已删除工作空间的陈旧数据。
- Not：不验证其他消费页面中的范围清理展示；只覆盖 Settings 页内可见结果。

#### `workspace-interrupted-jobs-recovery`

- 测试类型：`e2e`
- What：真实文件检查、网页检查和网页更新索引在程序关闭时被中断，重启后任务退出执行中状态并收敛为失败。
- Why：后台任务若在进程退出后永久保持 running，会残留执行中状态并给用户错误进度。
- How：通过 Settings UI 对 25,000 个真实文件启动检查；再对延迟响应的本地真实网页分别启动检查和更新索引；每次在进度可见时关闭并复用同一用户目录重启应用。
- Oracle：文件检查退出执行中状态、按钮恢复且 job 为失败，对齐 `SET-WORKSPACE-003-AC4`；网页检查 job 为失败，对齐 `SET-WEB-003-AC4`；网页索引 job 与执行中的网页均收敛为失败，对齐 `SET-WEB-004-AC6`。
- Not：只读 SQLite 查询用于确认已触发任务的最终状态，不写数据库、不伪造 running job；文件更新索引的底层记录收敛继续由 unit 覆盖。

### 3.3 `workspace / files`

本回归范围新增目录刷新生命周期约束：索引 job 运行期间目录树 IPC 必须为 0；任务成功或失败终态后，当前选中工作空间目录树只允许刷新一次。测试同时确认旧目录节点不因刷新被清空或折叠，扫描无可计算总数时显示活动状态而不是静态 0%。

#### `workspace-scan-progress-refresh`

- 测试类型：`e2e`
- What：点击“检查更新”后，页面会刷新文件树和需索引摘要。
- Why：这是用户识别待更新文件的第一步。
- How：通过原生目录选择绑定真实临时目录，写入 600 个真实文件，通过 Settings UI 触发检查更新并读取刷新后的文件树。
- Oracle：检查过程中先出现目录扫描的已扫描/已发现进度事件，再出现以真实文件总数计量的索引比对 `N/M` 进度事件，对齐 `SET-WORKSPACE-003-AC1`、`SET-WORKSPACE-003-AC5`；运行期间目录读取次数为 0，任务结束后目录树和摘要同步刷新且不出现 loading/空态闪烁，对齐 `SET-WORKSPACE-003-AC2`；离开再返回时恢复当前进度和按钮状态，对齐 `SET-WORKSPACE-003-AC3`。
- Not：不验证真实大目录性能和文件系统权限失败分支。

#### `workspace-prepare-refresh`

- 测试类型：`e2e`
- What：点击“更新索引”后，文件状态会刷新为已索引并同步更新摘要。
- Why：“索引已经可用”的核心用户反馈链路。
- How：复制共享 workspace 输入的隔离副本，通过 Settings UI 和原生目录选择完成创建与绑定；随后点击更新索引，读取刷新后的文件树和全部支持文件状态。
- Oracle：更新索引过程中出现持久化总进度，且检查更新/更新索引按钮保持可用，对齐 `SET-WORKSPACE-004-AC3`；运行期间目录读取次数为 0，终态只刷新一次且不因逐文件完成而闪烁或折叠，对齐 `SET-WORKSPACE-004-AC6`；共享 fixture 中全部支持文件真实进入处理范围，对齐 `SET-WORKSPACE-004-AC1`；更新后所有支持文件收敛为 `indexed / failed`，摘要和节点状态同步刷新，对齐 `SET-WORKSPACE-004-AC2`。
- Not：不验证向量内容质量和搜索召回结果。

#### `workspace-prepare-failed-retry`

- 测试类型：`e2e`
- What：已有失败文件再次点击“更新索引”时会被纳入本次处理范围，并且文件 tab 的可索引数量包含失败数量。
- Why：失败文件是用户最常见的重试对象，如果失败记录不再进入目标集，或者 UI 不把失败数算进可操作数量，用户会误判“没有东西可更新”。
- How：通过原生目录选择绑定包含真实损坏 docx 的临时目录，首次点击“更新索引”形成真实 failed 文件；再次点击更新索引，读取 active job、文件摘要和页面可索引数字。
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
- How：绑定真实工作空间输入并通过 UI 触发更新索引，执行中切到其他设置页，再返回工作空间页读取 active job 与 UI 状态。
- Oracle：返回后仍能看到 running job 对应的进度块，且检查更新/更新索引按钮保持可用，对齐 `SET-WORKSPACE-004-AC4`。
- Not：本 case 不关闭应用；真实进程退出由 `workspace-interrupted-jobs-recovery` 覆盖。

#### `workspace-detail-status-and-error`

- 测试类型：`e2e`
- What：文件 tab 用可索引数承载失败提示，并在索引失败后保留文件级错误状态；目录树文件项不再展示文件名下方辅助字项。
- Why：文件问题通常发生在索引阶段，如果失败只留在控制台，用户无法判断资料是否可用。
- How：通过原生目录选择绑定包含真实损坏 docx 的临时目录，点击更新索引并读取刷新后的文件树响应。
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
- Not：不验证真实网页正文切块、embedding 写入质量和索引失败以外的网络细节；向量模型未安装时“更新索引”禁用与提示由 `SET-WEB-004-AC7` 定义，本 case 运行于共享模型就绪环境，不触发该分支。

#### `web-prepare-progress-restore`

- 测试类型：`e2e`
- What：网页索引执行中离开并返回网页 tab 后，分阶段进度块和按钮状态会恢复。
- Why：网页索引包含抓取与索引两阶段，恢复时不能只恢复“执行中”标签而丢失当前阶段。
- How：通过 UI 添加延迟响应的本地真实网页，触发网页检查和更新索引后分别切到其他设置页，再返回网页 tab 读取 active job 与进度文案。
- Oracle：检查更新离开再返回时恢复当前进度，对齐 `SET-WEB-003-AC3`；更新索引离开再返回时恢复当前阶段且两个按钮保持可用，对齐 `SET-WEB-004-AC5`。
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

> 模型前置约定：所有 `real` 模式的 e2e case 默认注入共享向量模型目录（`os.tmpdir()/ncurator-e2e-shared-models`），由 `tests/harness/e2e/modelFixture.ts` 复用生产下载链自动准备真实模型并跨 run 复用；case 显式设置 `NCURATOR_MODELS_PATH` 时（如下载流程类 case 的隔离临时目录）尊重显式值，不注入共享目录。`fixture` 模式不注入。模型下载失败时 case 直接失败并保留日志，作为环境前置问题暴露。

#### `vector-model-catalog-load`

- 测试类型：`e2e`
- What：向量模型页打开后，真实模型目录能加载，并展示下载或已安装状态。
- Why：向量模型是检索能力的基础依赖，如果列表加载状态不清晰，用户无法判断是否还需要下载模型。
- How：打开 Settings 向量模型页，等待真实模型目录渲染。
- Oracle：页面至少展示一个模型卡片，且每个模型有下载按钮或已安装标识，对齐 `SET-VECTOR-001`。
- Not：不执行下载和删除；真实下载与删除由下一条 case 覆盖。

#### `vector-model-download-delete-flow`

- 测试类型：`e2e`
- What：用户下载产品列表中的真实向量模型，观察真实进度和页面恢复，再完成删除确认、取消与成功删除。
- Why：模型下载是索引前置能力，必须验证应用现有下载逻辑、真实网络传输、真实落盘和用户操作形成完整闭环。
- How：关闭代理软件 TUN 模式，在临时模型目录和隔离的 Electron 子进程用户目录中启动真实应用，避免复用本机已有模型；从 Settings 点击产品列表中的模型下载，离开并返回页面，等待下载完成，再分别取消和确认删除。
- Oracle：下载中展示当前文件、文件完成数和总进度，离开页面后任务继续且返回时恢复进度，对齐 `SET-VECTOR-002`；完成后显示已安装，网络失败则 case 失败并保留 raw logs，对齐 `SET-VECTOR-003`；删除先确认、取消后仍安装、确认后恢复下载入口，对齐 `SET-VECTOR-004`。临时模型目录不与其他安装共享，删除后重新下载为真实完整下载，对齐 `SET-VECTOR-004-AC7`。
- Not：不修改产品模型清单、下载地址、文件内容、下载服务或生产代码；临时模型目录只隔离测试落盘数据，不改变下载逻辑。测试不主动制造网络和文件系统故障。更换源交互的状态机由 unit 契约测试覆盖，不在此处注入下载故障。

#### `vector-model-download-delete-while-active`

- 测试类型：`e2e`
- What：用户在产品列表中的向量模型真实下载过程中删除该模型，验证下载被取消、部分文件被移除、页面回到可下载状态且不提示下载失败。
- Why：下载中删除是用户对长时间下载的唯一中断手段，如果删除被拒绝或留下半截文件，模型状态会长期不可用。
- How：关闭代理软件 TUN 模式，在临时模型目录和隔离的 Electron 子进程用户目录中启动真实应用；点击下载并等待进度进入大文件（`onnx/model.onnx`）流式传输阶段，立即点击删除并确认，观察进度消失、下载入口恢复、模型目录移除且无错误提示。
- Oracle：下载中展示删除入口且确认弹框说明删除将取消下载，确认后进度消失并恢复下载入口，对齐 `SET-VECTOR-004-AC5`；页面不出现下载失败错误，对齐 `SET-VECTOR-004-AC6`；下载与删除均只由真实用户操作触发各一次产品 IPC。
- Not：不等待下载完成；不修改产品模型清单、下载地址、文件内容、下载服务或生产代码；不验证磁盘上遗留 `.part` 临时文件之外的其他产物。

#### `vector-model-download-source-switch`

- 测试类型：`e2e`
- What：默认下载源失效时，用户在失败提示处点击“更换源下载”，在弹窗中选择另一源并完成模型安装。
- Why：换源是下载可靠性的兜底闭环，失败提示、失败清理、弹窗标注失败源、选源重下与 IPC 透传任一处断裂都会让用户无法完成模型安装。
- How：启动真实应用前注入两个本地 mock 端点（`NCURATOR_MODELSCOPE_ENDPOINT` 返回 500 使默认源失效，`NCURATOR_HF_MIRROR_ENDPOINT` 提供完整模型元数据与文件）；在临时模型目录中点击下载，等待失败提示，确认模型目录被清理，再点击“更换源下载”，在弹窗中确认 huggingface-mirror 带“最近失败”标记而选择它，等待安装完成。
- Oracle：失败区展示“下载失败”与“更换源下载”入口，对齐 `SET-VECTOR-003-AC2/AC3`；弹窗列出两个源并标注最近失败的源，确认后从所选源重新完整下载并完成安装，对齐 `SET-VECTOR-003-AC4`；失败后模型目录无残留，对齐“换源为完整下载”；IPC 共触发两次 `downloadModel`，第二次携带 `huggingface-mirror`，对齐换源由用户主动选择。
- Not：不访问真实外网；mock 只替换端点地址，不改变产品下载逻辑、模型清单或文件内容；不验证下载文件内容有效性；源选择、失败清理与错误标识的服务层状态机由 backend workflow 中的 `model-download-source-contract` unit 用例覆盖，不在本 case 重复。

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

### 4. 发布前真实检查

- `SET-GENERAL-001`：自动化 case 覆盖开关默认值和关闭后静默，unit 覆盖通知参数携带馆长图标；四类真实终态通知、馆长 logo 展示、点击系统通知返回对应会话、系统通知不可用时应用保持稳定，必须在 Windows 与 macOS 候选包上使用真实系统通知检查，不伪造通知对象或点击事件。
