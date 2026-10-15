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

- `model` 验证模型服务配置的加载、创建、编辑、删除，以及推荐／自定义类型与去重。
- `general` 验证通知、日志入口和伙伴缓存清理；系统通知中心及 Finder／Explorer 的真实展示按发布前检查验证。
- `workspace` 按 core／files／web 验证文件地址、真实目录、索引操作与全局网页，默认复用 `tests/fixtures/workspace` 输入。索引速度通过真实 UI 和操作系统线程取证，底层独立进程证据由 Knowledge 提供。
- `vector` 验证向量模型列表、下载、删除和换源；页面为 `/settings/vector`，测试归 `tests/case/settings/vector/**`。

## 3. 回归测试清单

### 3.1 `model`

#### `model-page-load-config-list`

- 测试类型：`e2e`
- What：用户进入大模型页后，配置列表能完成初始化展示，并区分预设配置与自定义配置。
- Why：该链路直接对应首屏状态，失败时用户会认为设置页没有加载。
- How：通过 UI 创建一条预设服务商配置和一条自定义配置，重新打开 Settings 的大模型页，等待页面完成初始化。
- Oracle：页面打开后可以看到配置列表，对齐 `SET-MODEL-001-AC1`；配置名称与「自定义」标签区分预设/自定义，对齐 `SET-MODEL-001-AC3`。`SET-MODEL-001-AC2`（服务商图标与脱敏 API Key 展示形态）不测。

#### `model-create-edit-segment-flow`

- 测试类型：`e2e`
- What：新增和编辑配置弹框的「推荐 / 自定义」类型切换、推荐无名称、服务商去重与编辑改服务商语义。
- Why：连接配置是后续 workbench 可用性的前提，类型、去重和改名语义任一失真，用户很容易保存出重复或不可用配置。
- How：通过真实 UI 新增推荐配置，核对默认类型、无名称输入框、保存后的默认地址与服务商去重提示；切到自定义逐项清空名称、地址、API Key，验证必填拦截，再保存有效配置；尝试重名，检查遮罩不关闭且保留输入；编辑自定义检查完整回填，编辑推荐更换服务商后记录数不增加。
- Oracle：新增弹框存在「类型（推荐 / 自定义）」且默认推荐，推荐类型无名称输入框、只要求下拉选择服务商并填写 API Key，对齐 `SET-MODEL-002-AC1`；推荐配置保存后名称等于服务商名、地址为目录默认地址、同服务商仅一条，已配置服务商在下拉中禁用并标注「已配置」，对齐 `SET-MODEL-002-AC2`；自定义类型名称重复时保存被拦截，对齐 `SET-MODEL-002-AC3`；编辑推荐配置服务商下拉可改、改为其他服务商仍为推荐类型且未新增记录，编辑自定义配置带出完整值，对齐 `SET-MODEL-002-AC4`；必填字段不完整时保存被拦截，对齐 `SET-MODEL-002-AC5`；弹窗点击遮罩后保持打开且输入不丢失，对齐 `SET-MODEL-002-AC6`。

#### `model-delete-config-feedback`

- 测试类型：`e2e`
- What：删除连接配置后的列表刷新，以及删除失败时的错误反馈。
- Why：删除结果是最直接的用户确认反馈，缺失时用户会误判配置是否已经被移除。
- How：通过 UI 覆盖删除成功路径；再以真实 SQLite 写锁制造持久化环境故障，仍由用户从 UI 发起删除，不注入接口响应。
- Oracle：删除成功后，被删配置不再出现在列表中，对齐 `SET-MODEL-003-AC1`；失败响应保留原配置并显示脱敏错误，对齐 `SET-MODEL-003-AC2`。

### 3.2 `workspace / core`

#### `workspace-page-load-default-selection`

- 测试类型：`e2e`
- What：工作空间页打开后会自动初始化文件地址树和网页 tab，不再默认选中某个具名工作空间。
- Why：后续文件 / 网页管理都依赖首屏初始化，如果这里失效，详情区会表现成“无从下手”。
- How：通过 UI 添加两条文件地址，进入工作空间页并等待文件树与网页 tab 渲染完成。
- Oracle：页面打开后文件地址树和网页 tab 自动初始化，对齐 `SET-WORKSPACE-001-AC1`、`SET-WORKSPACE-005-AC3`。

#### `workspace-set-root-path`

- 测试类型：`e2e`
- What：文件 tab 可以直接添加目录作为工作地址，并立即刷新目录树；顶层节点就是各地址。
- Why：文件地址已从“具名容器再绑目录”改为直接丢入路径。
- How：进入无地址页面检查空态，再通过目录选择器添加一条真实目录；再尝试添加已包含的子路径，确认弹出「目录已包含」并拒绝；再验证父路径自动替换子根。包含关系判定另由 unit `workspace-root-containment-contract` 覆盖。
- Oracle：空态提示还没有文件地址，对齐 `SET-WORKSPACE-007-AC1`；成功添加后写入地址并刷新真实目录树，顶层即该地址，对齐 `SET-WORKSPACE-006-AC1`、`SET-WORKSPACE-008-AC1`；添加子路径弹窗拒绝、添加父路径自动替换对齐 `SET-WORKSPACE-006-AC5`；添加后启动扫描且结束后可索引数更新，对齐 `SET-WORKSPACE-006-AC4`。`SET-WORKSPACE-007-AC2`（地址内无可显示文件的树空态）不测。

#### `workspace-directory-lazy-load`

- 测试类型：`e2e`
- What：目录树只读取各地址或被展开目录的直属子项，并以加载反馈承载读取过程。
- Why：文件地址可能包含 `node_modules` 等超大目录；进入设置页不能递归枚举整个森林。
- How：添加包含根目录文件、普通子目录、`node_modules` 和点开头文件/目录的真实临时目录；进入文件 tab 后验证顶层首层，展开普通子目录后验证其直属文件，再确认点开头项始终不可见。检查目录开/关的 `react-icons` 图形、Office 原有彩色专属图标、MD/普通文件的 Phosphor Light 细线图标及目录的 Bootstrap `BsFolder / BsFolder2Open` 图标、与 `@` 候选一致的目录 16px / 文件 18px 尺寸（非整数 DPI 的 CSS 布局量化误差最多 0.05px）、行高及 hover 背景，再展开后点击目录树右上刷新，确认已展开节点仍展开、未展开目录不会被全部展开。
- Oracle：`node_modules` 在顶层可见但其内容不会在首次加载时出现；子目录展开前不读取其子项，展开时显示局部 loading；点开头文件或目录在任意层级均不显示；页面没有全部展开/折叠入口，顶层地址行可单独折叠，对齐 `SET-WORKSPACE-008-AC1`、`SET-WORKSPACE-008-AC4`、`SET-WORKSPACE-008-AC5`。目录树右上刷新只更新已展示节点状态、不重置展开折叠，对齐 `SET-WORKSPACE-008-AC6`。Office 原有彩色图标、MD/普通文件/目录库图标、目录 16px / 文件 18px 尺寸与开/关形状、行对齐和未选中行无 hover 底色对齐 `SET-WORKSPACE-008-AC7`。新添加后只展开该地址、其余折叠由产品交互覆盖，本 case 不强制断言。

#### `workspace-remove-from-list`

- 测试类型：`e2e`
- What：用户在文件 tab 行尾移除文件地址后，目录树不再展示该项。
- Why：树是用户确认移除成功的直接依据。
- How：添加一条文件地址，在顶层行尾执行移除并确认。
- Oracle：移除成功后，该地址从树中消失，对齐 `SET-WORKSPACE-006-AC2`。

#### `workspace-interrupted-jobs-recovery`

- 测试类型：`e2e`
- What：真实文件检查、网页检查和网页更新索引在程序关闭时被中断，重启后任务退出执行中状态并收敛为失败。
- Why：后台任务若在进程退出后永久保持 running，会残留执行中状态并给用户错误进度。
- How：通过 Settings UI 对 25,000 个真实文件启动检查；再对延迟响应的本地真实网页分别启动检查和更新索引；每次在进度可见时关闭并复用同一用户目录重启应用。
- Oracle：文件检查退出执行中状态、「检查更新」按钮恢复可点且 job 为失败，对齐 `SET-WORKSPACE-003-AC4`（「更新索引」可因无向量模型或无可索引文件保持禁用，不纳入本断言）；网页检查 job 为失败，对齐 `SET-WEB-003-AC4`；网页索引 job 与执行中的网页均收敛为失败，对齐 `SET-WEB-004-AC6`。

### 3.3 `workspace / files`

索引 job 运行期间目录树 IPC 必须为 0，终态只刷新一次，不清空或折叠旧节点；扫描无可计算总数时显示活动状态，左侧可索引数对全部文件地址合计。多地址顺序、索引速度及取消交互见对应 case；中断恢复、检索拦截、取消状态机等底层证据与手动 / 不测 / 暂缓范围见 §5。

#### `workspace-scan-progress-refresh`

- 测试类型：`e2e`
- What：点击“检查更新”后，页面会刷新文件树和需索引摘要。
- Why：这是用户识别待更新文件的第一步。
- How：通过原生目录选择添加真实临时目录，写入 600 个真实文件，通过 Settings UI 触发检查更新并读取刷新后的文件树。
- Oracle：检查成功后页面可索引/摘要反映真实发现结果（如可索引数与树内容），对齐 `SET-WORKSPACE-003-AC2`；过程进度通过 job 事件或进度块可见，扫描很快完成时允许采不到中间 UI，但若采到事件则应包含目录扫描与索引比对两阶段结构，对齐 `SET-WORKSPACE-003-AC1`、`SET-WORKSPACE-003-AC5`；运行期间目录读取次数为 0；离开再返回时恢复当前进度和按钮状态，对齐 `SET-WORKSPACE-003-AC3`。

#### `workspace-prepare-refresh`

- 测试类型：`e2e`
- What：点击“更新索引”后，文件状态会刷新为已索引并同步更新摘要。
- Why：“索引已经可用”的核心用户反馈链路。全仓唯一的向量 warmup，预热共享 fixture 的 split/vector 缓存。
- How：复制共享 workspace 输入的隔离副本，通过 Settings UI 添加为文件地址并点击更新索引，读取刷新后的文件树和全部支持文件状态。共享 fixture 含 `.doc`、`docx`、`pdf`、`md`、`txt`、`xlsx`、`xlsm` 等全部受支持类型，其中 excel 只以元数据方式索引进库。不切换、不断言索引速度。点击后等待进度块出现，再等到目标总数算出后读取进度文案。
- Oracle：更新索引过程中出现持久化进度条和进度条下方的当前处理文件文案，「检查更新」可用，「更新索引」文案变为「取消」且可点，对齐 `SET-WORKSPACE-004-AC3`、`SET-WORKSPACE-004-AC12`；未知总数时进度条保持活动状态，目标数确定后按已处理目标数 / 目标总数计算比例，每个目标（包括失败目标）只计一次，进度块标题右侧不显示百分比或 `已处理/总数`；运行期间目录读取次数为 0，终态只刷新一次且不因逐文件完成而闪烁或折叠，对齐 `SET-WORKSPACE-004-AC7`；共享 fixture 中全部支持文件真实进入处理范围，对齐 `SET-WORKSPACE-004-AC1`；更新后所有支持文件收敛为 `indexed / failed`，摘要和节点状态同步刷新，对齐 `SET-WORKSPACE-004-AC2`。

#### `workspace-index-speed`

- 测试类型：`e2e / exclusive`
- What：独立小目录上，默认慢速真实更新索引一次，再补文件切高速再更新索引一次，比较两档嵌入进程的操作系统线程证据。
- Why：档位是否生效，看的是更新索引时电脑上嵌入进程的线程数是否按 intraOp 增加，不是进程名里的数字，也不是共享 warmup fixture。
- How：通过原生目录选择添加空临时目录；每次更新索引前写入 ≥50KB / 400 段待索引 txt 并检查更新，确认可索引数 ≥ 1 且「更新索引」可点。点击后以慢/高速变为 disabled 为同步点（允许进度块可见作为并列信号，10–30s，失败 dump actionable / 按钮 / embedding / job）；不要把进度条可见当作唯一同步点，也不用 360s 去等它。锁定后再数嵌入进程线程。嵌入 runtime PID 由主进程只读 IPC 提供。线程数分别用 `ps -M` 与 `Get-Process.Threads.Count`。
- Oracle：默认慢速后可切换高速，对齐 `SET-WORKSPACE-009-AC1`；更新索引进行中禁用慢/高速，终态后恢复，对齐 `SET-WORKSPACE-009-AC4`；两次更新索引拉起不同嵌入进程，线程增量及 Windows 零增量时的稳态差按 [Knowledge 线程预算用例](knowledge-test.md#index-speed-thread-budget) 判定；两个 txt 均索引完成。

#### `workspace-prepare-sequential-addresses`

- 测试类型：`e2e`
- What：多个文件地址时，「更新索引」等前一个地址 job 终态后再启动下一个。
- Why：并行 kickoff 会叠满嵌入线程，和慢/高速档位冲突，也违反更新索引的地址顺序。
- How：通过原生目录选择添加两个真实临时目录（各含一个 txt）；切换高速后点击更新索引；只读 job IPC 记录两个地址的 running / 终态时间。
- Oracle：第二个地址的 job `started_at` 不早于第一个地址 `finished_at`，且第一个 running 期间第二个没有 running job，对齐 `SET-WORKSPACE-004-AC11`。

#### `workspace-prepare-failed-retry`

- 测试类型：`e2e`
- What：已有失败文件再次点击“更新索引”时会被纳入本次处理范围。
- Why：失败文件是用户最常见的重试对象，如果失败记录不再进入目标集，用户会误判“没有东西可更新”。
- How：通过原生目录选择添加包含损坏 docx 的临时目录，两次由 UI 点击“更新索引”；每次等待真实终态，并通过只读 IPC 收集任务身份、目标数、处理数和文件状态。输入保持不变，必须看到第二个不同的任务实际处理原失败文件。
- Oracle：两次任务 ID 不同，均包含并处理唯一失败文件；损坏输入使两次任务均以 failed 终态结束且 failed_count 为 1，第二次完成后文件仍为 failed，对齐 `SET-WORKSPACE-004-AC1/AC2`。只有旧 failed 状态不算重试证据。可索引数与失败提示由 `workspace-detail-status-and-error` 承担。

#### `workspace-prepare-file-failure-isolated`

- 测试类型：`e2e`
- What：单个文件索引失败不会导致 Settings 页面或 Electron 应用退出，并会留下文件级失败状态与错误信息。
- Why：真实更新索引可能遇到损坏文件、过大文件或 loader/native 异常；单文件失败必须被隔离为资料级失败，不能拖垮整个应用。
- How：在真实文件地址隔离目录中放入一个会触发索引失败的支持文件和一个可索引文件，从 Settings 文件 tab 点击“更新索引”，观察 job、页面存活状态、成功文件与失败文件状态。
- Oracle：应用在索引结束后仍可响应 IPC 和页面查询，对齐 `SET-WORKSPACE-004-AC8`；失败文件保留 `failed / last_error`，其他文件不因该失败丢失状态，对齐 `SET-WORKSPACE-004-AC2`、`SET-WORKSPACE-008-AC2`。

#### `workspace-prepare-progress-restore`

- 测试类型：`e2e`
- What：文件索引执行中离开并返回工作空间页后，进度块和按钮状态会恢复。
- Why：索引任务已切换为持久化后台 job，页面生命周期不能影响用户对任务状态的判断。
- How：添加真实文件地址并通过 UI 触发更新索引，执行中切到其他设置页，再返回工作空间页读取 active job 与 UI 状态。
- Oracle：返回后仍能看到 running job 对应的进度块，「检查更新」可用，「更新索引」文案为「取消」且可点，对齐 `SET-WORKSPACE-004-AC4`、`SET-WORKSPACE-004-AC12`。

#### `workspace-detail-status-and-error`

- 测试类型：`e2e`
- What：文件 tab 用可索引数承载失败提示，并在索引失败后保留文件级错误状态；目录树文件项不再展示文件名下方辅助字项。
- Why：文件问题通常发生在索引阶段，如果失败只留在控制台，用户无法判断资料是否可用。
- How：通过原生目录选择添加包含真实损坏 docx 的临时目录，点击更新索引并读取刷新后的文件树响应。
- Oracle：文件 tab 的可索引数字包含失败数量并对全部地址合计，展示 `含失败 N 个` 辅助文案，对齐 `SET-WORKSPACE-005-AC2`；文件索引失败后，失败状态和错误信息保留在文件级记录中，目录树文件项只保留文件名与状态标记，对齐 `SET-WORKSPACE-008-AC2`。

#### `workspace-prepare-cancel`

- 测试类型：`e2e`
- What：更新索引进行中点「取消」，确认框说明尚未完成的不再继续；继续后进度仍可见，停止后按钮恢复且仍有未完成文件。
- Why：用户需要能停掉长时间索引并关掉应用，不能把没做完的文件标成失败。
- How：添加含多个真实文件的临时目录，进度可见且 `processed_count < total_count` 后点「取消」；先选「继续更新」检查进度仍可见，再点「取消」并「停止」。
- Oracle：进行中按钮文案为「取消」且可点，对齐 `SET-WORKSPACE-004-AC12`；弹框不展示已完成/剩余数量，并说明尚未完成的将不会继续索引，继续后进度仍可见，对齐 `SET-WORKSPACE-004-AC13`；停止后按钮回到「更新索引」，仍有可索引或失败文件且未全部变成失败，部分覆盖 `SET-WORKSPACE-004-AC3/AC14`。已完成保留和未完成状态回退由 Knowledge `workspace-index-cancel-contract` 补充；地址顺序停止和当前批之后停由 `tests/case/unit/workspace/files/workspace-index-worker-contract.test.ts` 补充 `SET-WORKSPACE-004-AC15/AC16`，完整取消链路未逐项验证。

#### `workspace-prepare-cancel-after-complete`

- 测试类型：`e2e`
- What：运行中打开取消确认框，任务自然成功后确认框自动关闭，原任务和文件保持完成状态。
- Why：避免任务已经完成后仍残留取消入口，或把已完成结果回退为取消。
- How：添加含唯一内容的真实文件，通过 Settings UI 启动索引并记录 running prepare job ID；必须在运行中打开确认框，再等待任务自然完成和确认框关闭。只读查询同一 job 的 SQLite 终态，核对预期文件集合与索引状态；未打开确认框即失败，不跳过场景或吞掉操作错误。
- Oracle：确认框实际在 running 期间可见；自然完成后确认框和进度隐藏，按钮恢复「更新索引」；同一 job 为 `succeeded`、目标数和处理数等于输入文件数、失败数为 0，预期文件集合非空且全部 `indexed`。这是 `SET-WORKSPACE-004-AC17` 的成功终态 UI 补充；终态状态判断由 `tests/case/unit/workspace/files/workspace-index-job-progress.test.ts` 补充，完整任务收口、失败终态和 UI 点击竞态未全覆盖。

### 3.4 `workspace / web`

#### `web-add-sources-dialog`

- 测试类型：`e2e`
- What：网页资料管理是全局一份，并验证添加弹窗的空输入校验、多行 URL 提交和成功后的清空收尾。
- Why：网页资料进入系统的主入口。
- How：进入工作空间页的网页 tab，确认列表和添加入口保持在 `/settings/workspace`，再覆盖空输入提交、多行 URL 提交和再次打开弹窗三条路径。
- Oracle：网页管理位于工作空间页且不跳转独立路由，对齐 `SET-WORKSPACE-005-AC3`、`SET-WEB-001-AC3`；输入为空时提交被拦截，对齐 `SET-WEB-002-AC1`；点击遮罩后弹窗保持打开且已输入 URL 不丢失，对齐 `SET-WEB-002-AC4`；多行 URL 提交后进入全局网页列表，对齐 `SET-WEB-002-AC2`；提交成功后弹窗关闭且输入被清空，对齐 `SET-WEB-002-AC3`。

#### `web-prepare-summary`

- 测试类型：`e2e`
- What：网页“检查更新 → 更新索引”完整链路会先刷新可索引状态，再区分成功索引与爬取失败并刷新摘要。
- Why：网页索引是“爬取 + 建索引”两阶段链路，失败类型必须可区分。
- How：预置一条成功网页和一条带失败标记的网页，先执行“检查更新”，再执行“更新索引”。
- Oracle：网页列表、摘要、失败数量和操作区初始化对齐 `SET-WEB-001-AC1`、`SET-WEB-001-AC2`；检查进度和完成状态对齐 `SET-WEB-003-AC1`、`SET-WEB-003-AC2`；更新时网页进入抓取/索引状态，对齐 `SET-WEB-004-AC1`；成功网页为 `indexed`、失败网页为 `crawl_failed` 并刷新摘要，部分覆盖 `SET-WEB-004-AC2/AC3`，抓取时间值同步及实际索引失败分支待补；分阶段进度条和下方阶段处理文案可见，「检查更新」可用，「更新索引」文案变为「取消」且可点；目标总数算出后按已处理目标数 / 目标总数计算比例，每个目标（包括失败目标）只计一次，进度块标题右侧不显示百分比或 `已处理/总数`，对齐 `SET-WEB-004-AC4`、`SET-WEB-004-AC10`。

#### `web-prepare-progress-restore`

- 测试类型：`e2e`
- What：网页索引执行中离开并返回网页 tab 后，分阶段进度块和按钮状态会恢复。
- Why：网页索引包含抓取与索引两阶段，恢复时不能只恢复“执行中”标签而丢失当前阶段。
- How：通过 UI 添加延迟响应的本地真实网页，触发网页检查和更新索引后分别切到其他设置页，再返回网页 tab 读取 active job 与进度文案。
- Oracle：检查更新离开再返回时恢复当前进度，对齐 `SET-WEB-003-AC3`；更新索引离开再返回时恢复当前阶段，「检查更新」可用，「更新索引」文案为「取消」且可点，对齐 `SET-WEB-004-AC5`、`SET-WEB-004-AC10`。

#### `web-prepare-cancel`

- 测试类型：`e2e`
- What：网页更新索引进行中点「取消」，确认框说明尚未完成的不再继续，停止后未完成网页不落成已索引。
- Why：网页抓取可能很慢，用户需要和文件 tab 同一套停法。
- How：添加延迟响应的本地真实网页，进度可见后点「取消」；覆盖继续与停止。
- Oracle：进行中按钮为「取消」且可点，弹框不展示数量并说明尚未完成的将不会继续索引，继续后进度仍可见，对齐 `SET-WEB-004-AC10`、`SET-WEB-004-AC11`；停止后没有 `crawling / indexing`、至少一项未索引、没有新失败，按钮回到「更新索引」，部分覆盖 `SET-WEB-004-AC12/AC13`。已完成保留与旧失败状态回退由 Knowledge `workspace-index-cancel-contract` 补充；共用嵌入函数的当前批取消由 `tests/case/unit/workspace/files/workspace-index-worker-contract.test.ts` 补充，不能算作本 UI case 的逐项证据。

#### `web-detail-and-delete`

- 测试类型：`e2e`
- What：网页列表项展示 URL、更新时间标签和删除入口，删除成功后刷新列表。
- Why：网页资料管理最基础的可见反馈。
- How：预置一条网页资料，检查列表项展示内容后执行删除。
- Oracle：列表项含目标 URL、「最近更新时间」标签和删除入口，部分覆盖 `SET-WEB-005-AC1`；标题、状态及抓取时间值没有逐项断言。删除成功后，该网页资料从列表中消失，对齐 `SET-WEB-005-AC3`。

#### `web-open-url-contract`

- 测试类型：`e2e`
- What：点击“打开”按钮时，会通过系统浏览器打开原网页地址。
- Why：如果这里误打开本地索引副本或失去外链能力，网页资料的原始上下文就被切断了。
- How：通过 UI 添加目标 URL，在网页 tab 点击打开按钮，用 IPC observer 辅助确认 `openExternal` 收到原始 URL。
- Oracle：触发 `openExternal(originalUrl)`，对齐 `SET-WEB-005-AC2`。

### 3.5 `vector`

> 模型前置约定：所有 `real` 模式的 e2e case 默认注入共享向量模型目录（`os.tmpdir()/ncurator-e2e-shared-models`），由 `tests/harness/e2e/modelFixture.ts` 复用生产下载链自动准备真实模型并跨 run 复用；case 显式设置 `NCURATOR_MODELS_PATH` 时（如下载流程类 case 的隔离临时目录）尊重显式值，不注入共享目录。`fixture` 模式不注入。模型下载失败时 case 直接失败并保留日志，作为环境前置问题暴露。

#### `vector-model-catalog-load`

- 测试类型：`e2e`
- What：向量模型页打开后，真实模型目录能加载，并展示下载或已安装状态。
- Why：向量模型是检索能力的基础依赖，如果列表加载状态不清晰，用户无法判断是否还需要下载模型。
- How：打开 Settings 向量模型页，等待真实模型目录渲染。
- Oracle：页面至少展示一个模型卡片，每个模型有下载按钮或已安装标识，对齐 `SET-VECTOR-001-AC1`；目录加载失败提示见自动化缺口。

#### `vector-model-download-delete-flow`

- 测试类型：`e2e`
- What：用户下载产品列表中的真实向量模型，观察真实进度和页面恢复，再完成删除确认、取消与成功删除。
- Why：模型下载是索引前置能力，必须验证应用现有下载逻辑、真实网络传输、真实落盘和用户操作形成完整闭环。
- How：关闭代理软件 TUN 模式，在临时模型目录和隔离的 Electron 子进程用户目录中启动真实应用，避免复用本机已有模型；从 Settings 点击产品列表中的模型下载，离开并返回页面，等待下载完成，再分别取消和确认删除。
- Oracle：下载中展示文件、完成数和进度，离开后继续且返回恢复，对齐 `SET-VECTOR-002-AC2/AC3`；完成后显示已安装，对齐 `SET-VECTOR-003-AC1`；删除先确认，取消保留安装，确认后恢复下载入口，对齐 `SET-VECTOR-004-AC1/AC3/AC4`。临时模型目录不与其他安装共享；网络失败则 case 失败并保留 raw logs。

#### `vector-model-download-delete-while-active`

- 测试类型：`e2e`
- What：用户在产品列表中的向量模型真实下载过程中删除该模型，验证下载被取消、部分文件被移除、页面回到可下载状态且不提示下载失败。
- Why：下载中删除是用户对长时间下载的唯一中断手段，如果删除被拒绝或留下半截文件，模型状态会长期不可用。
- How：关闭代理软件 TUN 模式，在临时模型目录和隔离的 Electron 子进程用户目录中启动真实应用；点击下载并等待进度进入大文件（`onnx/model.onnx`）流式传输阶段，立即点击删除并确认，观察进度消失、下载入口恢复、模型目录移除且无错误提示。
- Oracle：下载中展示删除入口且确认弹框说明删除将取消下载，确认后进度消失并恢复下载入口，对齐 `SET-VECTOR-004-AC5`；页面不出现下载失败错误，对齐 `SET-VECTOR-004-AC6`；下载与删除均只由真实用户操作触发各一次产品 IPC。

#### `vector-model-download-source-switch`

- 测试类型：`e2e`
- What：默认下载源失效时，用户在失败提示处点击“更换源下载”，在弹窗中选择另一源并完成模型安装。
- Why：换源是下载可靠性的兜底闭环，失败提示、失败清理、弹窗标注失败源、选源重下与 IPC 透传任一处断裂都会让用户无法完成模型安装。
- How：沿用本 case 已批准的两个本地 mock 下载端点：modelscope 返回 500，huggingface-mirror 提供模型元数据与文件。真实 UI 下载失败后确认清理目录，打开换源弹窗并核对 modelscope 为最近失败源；选择 huggingface-mirror 后取消，确认失败状态保留且未重试；再次打开并选源，确认前仍无新下载，确认后等待安装完成。
- Oracle：失败提示、换源入口与最近失败源标记正确，对齐 `SET-VECTOR-003-AC2/AC3/AC4`；取消后失败状态保留、确认前始终只有第一次下载请求，对齐 `SET-VECTOR-003-AC5/AC6`；确认后第二次 downloadModel 携带 huggingface-mirror 并完成安装，失败目录已清理。

### 3.6 `general`

#### `partner-cache-cleanup`

- 测试类型：`e2e / live`
- What：通用设置按伙伴、目录和截止日期清理真实缓存，保留聊天及其他伙伴。
- Why：永久删除必须核对候选、确认取消、隔离范围和实际磁盘结果。
- How：通过 Workbench UI 创建两个伙伴、配置真实模型与完全放行权限；第一轮真实 AI 使用文件工具修改临时工作目录的正式文件并生成 runtime/assets 中的运行资源，第二个伙伴用真实 AI 生成独立运行资源。通过设置 UI 打开清理弹框，核对今天/明天截止日期、目录勾选、汇总和空选择禁用；点击文件夹入口观察真实打开 IPC；操作真实原生确认子窗口，取消后检查文件仍在，再确认清理第一个伙伴的 assets 和 file-changes。只读 IPC 和磁盘读取补充消息、源文件与隔离证据，不注入业务状态、不改文件日期。
- Oracle：入口/文案对齐 `SET-GENERAL-004-AC1`；四类目录和无逐文件列表对齐 `SET-GENERAL-004-AC2`；日期筛选和真实删除对齐 `SET-GENERAL-004-AC3`；汇总含所选资源类型、无候选时禁用清理，部分覆盖 `SET-GENERAL-004-AC4`，日期排序、数量/空间/总计一致性待补；打开目录调用与全部伙伴禁用对齐 `SET-GENERAL-004-AC5`（Finder/Explorer 展示发布前人工检查）；取消不删除、确认后清理并禁用空候选，部分覆盖 `SET-GENERAL-004-AC6`，释放空间报告未断言；伙伴/聊天/其他伙伴和外部文件保留对齐 `SET-GENERAL-004-AC7`。Unit `partner-cache-service` 补充 `SET-GENERAL-004-AC3/AC8/AC9/AC10` 的严格时间边界、完整历史清理、保留备份回退、运行互斥、草稿保护、符号链接和失败恢复；缺失目录提示由 Unit 和人工检查覆盖 `SET-GENERAL-004-AC5`。

#### `settings-titlebar-drag-region`

- 测试类型：`e2e`
- What：Settings 的原生窗口层、业务内容拖动区和页面操作保持分层。
- Why：任一层位置错误都会导致窗口无法拖动、侧栏无法切换或页面按钮被遮挡。
- How：打开 Settings，检查 36px 原生标题栏、业务内容起点、拖动区域、侧栏切换按钮命中和页面按钮可用性。
- Oracle：Windows 原生标题栏独立位于业务内容上方，对齐 `SET-GENERAL-002-AC1`；主内容和侧栏拖动区可命中，侧栏按钮为 `no-drag` 且可折叠/展开，对齐 `SET-GENERAL-002-AC2`。

#### `settings-help-entry`

- 测试类型：`e2e`
- What：设置页向量模型下方的使用帮助入口。
- Why：设置帮助与 Workbench 帮助是官方手册入口，位置和外链必须稳定。
- How：打开设置页，检查入口位置和可访问名称，点击后观察外链调用与路由。
- Oracle：入口样式和位置对齐 `SET-HELP-001-AC1`；打开官方中文手册且不改变设置路由，对齐 `SET-HELP-001-AC2`。

#### `system-notification-settings`

- 测试类型：`e2e`
- What：通用设置中的 AI 运行完成通知开关可以关闭，并通过真实 IPC 持久化。
- Why：通知是跨进程能力，开关状态必须由主进程保存，不能只停留在 Renderer 内存。
- How：通过 Settings UI 打开通用页，关闭开关，重新读取 `app-settings-get`，再恢复开关。
- Oracle：开关默认开启，对齐 `SET-GENERAL-001-AC1`；关闭后 UI 与主进程设置一致，仅覆盖 `SET-GENERAL-001-AC3` 的开关持久化前提。实际禁止发送由 backend Unit `tests/case/unit/system-notification-service.test.ts` 补充；真实 OS 效果见 §4 的补充检查。

#### `error-log-open-directory`

- 测试类型：`e2e`
- What：通用设置展示错误日志说明，并可从文件夹图标打开日志目录。
- Why：用户遇到索引或运行错误后，需要能自行找到并发送 `app.log`。
- How：通过 Settings UI 打开通用页，确认说明和可访问名称，点击文件夹按钮并通过 IPC observer 收集调用。
- Oracle：带文件夹图标的“打开”按钮可见，说明包含“将 app.log 发给作者排查问题”，点击后调用 `errorLogOpenDirectory`，对齐 `SET-GENERAL-003-AC3`。`app-error-log-service` backend unit 验证错误日志生成、隐私脱敏和 2MB 截断，对齐 `SET-GENERAL-003-AC1`、`SET-GENERAL-003-AC2`。

## 4. 发布前真实检查

- `SET-GENERAL-001`：通知开关由 Settings E2E 验证，通知服务行为由 Unit 验证。候选包上尽可能补充检查四类真实终态通知、馆长 logo、点击返回对应伙伴及系统通知不可用时的稳定性；受系统权限或工具能力限制的部分如实记录为未验证，不阻塞发布，也不要求用户介入。不伪造通知对象或点击事件，不将 Unit 结果记为真实 OS 检查通过。

## 5. 自动化覆盖边界

以下是当前证据边界，引用 AC 仅完成验收登记，不代表 UI 已自动验证。

| 验收 | 当前证据与缺口 |
| --- | --- |
| `SET-VECTOR-001-AC2`、`SET-VECTOR-004-AC2/AC7` | 待补：目录加载失败、删除失败、删除后再次完整下载没有对应 E2E。 |
| `SET-VECTOR-002-AC1` | 部分覆盖：`tests/case/unit/knowledge/vector/vector-download-service-contract.test.ts` 检验下载互斥；其他模型按钮禁用缺少 UI 断言。 |
| `SET-VECTOR-002-AC4` | 部分覆盖：同一 Unit 文件检验启动续传与非默认源保留；重启后的进度恢复 UI 待补。 |

### 底层证据与 UI 边界

以下区分已存在的底层断言、未验证的 UI 子项及手动 / 不测 / 暂缓范围；不能把底层证据算作完整 UI 验收。

| 验收 | 现有相关 case / 证据状态 |
| --- | --- |
| `SET-GENERAL-001-AC2/AC4/AC5/AC6` | 真实 OS 补充检查见 §4；`tests/case/unit/system-notification-service.test.ts` 覆盖终态去重、禁用、不可用和通知点击，未自动验证 OS 展示与启动中断通知。 |
| `SET-WORKSPACE-004-AC5` | backend 已覆盖：Knowledge `workspace-interrupted-job-recovery-contract` 与 `workspace-index-job-store-contract` 验证启动恢复后的 job / 文件失败收敛；文件索引中途关闭再重启的 UI 闭环未覆盖。 |
| `SET-WORKSPACE-004-AC9`、`SET-WEB-004-AC8` | backend 已覆盖：Knowledge `kb-indexing-blocks-search` 验证索引拦截、检查不拦截及终态恢复，`workspace-index-cancel-contract` 补充取消后的检索恢复。 |
| `SET-WORKSPACE-004-AC6` | 手动 / 暂缓：向量模型缺失时的按钮禁用与说明、安装后恢复没有独立 UI 验证。 |
| `SET-WORKSPACE-004-AC10` | 不测：无地址 / 无可索引文件的低价值 UI 门禁，不单独建立自动化 case。 |
| `SET-WORKSPACE-009-AC2/AC3` | UI 待补：索引速度问号文案、文件与网页 tab 共用全局档位没有逐项断言。 |
| `SET-WEB-003-AC5` | 不测：网页空列表及可索引为 0 时的检查按钮门禁，不单独建立自动化 case。 |
| `SET-WEB-004-AC7` | 手动 / 暂缓：向量模型缺失时的网页索引按钮禁用与说明、安装后恢复没有独立 UI 验证。 |
| `SET-WEB-004-AC9` | 不测：可索引为 0 时的网页索引按钮门禁，不单独建立自动化 case。 |
| `SET-WEB-004-AC14` | 暂缓独立 UI 自动化；文件侧的自然完成 UI 与取消终态判断 Unit 仅作相关证据，不能代替网页成功 / 失败终态的确认竞态。 |
