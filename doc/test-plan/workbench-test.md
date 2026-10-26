# NCurator-Desktop Workbench 测试计划

## 1. 总体目标

- 本计划定义 Workbench 用户可见交互的测试范围，并对齐 [workbench.md](../prd/workbench.md) 的 `WB-*` 需求和验收编号。
- 通用测试、runner、raw logs、UI E2E 和 live 断言规则遵循 `doc/test.md`。
- Workbench UI E2E 测试必须通过真实 Electron UI 配模型、创建伙伴、发送消息、选择 `@` 资料、预览、回退和操作右侧面板。依赖资料时通过设置页添加文件地址，普通发送不要求资料目录。
- 涉及 AI 的 Workbench UI E2E 使用真实模型，共享 live 配置见 [测试规范](../test.md)。内置目标通过 Settings「推荐」类型准备；`custom` 目标通过「自定义」类型准备地址与 Key，并在 Composer 自定义模型列表选择指定型号；全内置服务商冒烟见 `live-preset-provider-smoke`。
- case 因生产行为缺口失败时，不在测试中硬改业务行为，统一记录为产品或生产实现待决项。

- 多语言发布回归只使用国内候选包：英文界面在同一国内包内通过设置并重启验证；国际官方服务通过手动切换线路联调。国际包不重复安装、UI 或升级回归，发行配置及更新入口由共用 backend Unit 检查。
- `SET-GENERAL-006-AC3` 的实际网络联调验证国际目录、签名、取票及一次免费模型流式调用；失败不跨线路及凭证隔离由 Unit `app-gateway` 验证。不以静态配置检查替代真实连通结论。

## 2. 测试边界

- Workbench UI E2E 测试通过脚本在 case 运行时把 `tests/fixtures/workspace` 复制到临时目录；需要文件资料时通过 Settings UI 添加文件地址、检查更新和更新索引。前置是创建伙伴；文件地址按场景添加，不作为通用发送门禁。
- Workbench 正式 e2e 不允许直接调用 `workspacePrepare`、直接写模型配置、fake model、fake search、fake docx、fake AI event、fake attachment pick 或固定 document id。现有用例的执行缺口见第 6 节。
- Workbench e2e 按 `knowledge: none / cached / cold` 声明索引需求，默认 none。需要真实索引时复用生产 split/vector 计算缓存并隔离本用例统计；不自动追加 UI 预热用例，不复用存储和 UI 状态。缓存身份、按需预热与清理规则遵循 [测试规范](../test.md)。
- Workbench 模型选择 helper 在 `custom` live 配置下直接进入「自定义模型」按名称搜索，等待异步返回的匹配选项可见后再判定是否存在，避免同名预设或免费模型改变测试入口；内置目标优先按预设 option 的稳定调用名 `data-testid`（`AI_LIVE_MODEL`）点选，未命中再按展示名，仍未命中则进入「自定义模型」按名称搜索。
- Workbench UI E2E 测试需要真实索引完成信号和 UI 可见状态作为等待条件；IPC observer 和 job 查询只能作为辅助证据，不能用来造业务状态。
- `file-preview-actions` 当前按生产真实索引能力覆盖 `pdf/docx/md/txt/xlsx/xlsm/xltx/xltm`：连续打开的文件要分别保留为资源 Tab，并能切回旧 Tab；Excel 普通预览还要覆盖只读、切 Sheet 和拖列宽后预览仍可用。`workspace-file-explorer-open-refresh` 覆盖列表打开/焦点刷新、右键行内新建和确认移到回收站，以及删除后禁止自动保存重建。`file-preview-external-change-auto-refresh` 另行覆盖所有实时预览的统一磁盘监听：以普通文本、DOCX、PPTX、XLSX 为代表验证，文件地址内的文件和 `userData/partners/{id}/runtime/assets` 中的真实附件复用同一预览刷新链路；审核 Diff 快照不监听；仅文件内容变化才提示“已自动刷新”，打开外部应用或仅元数据变化不提示。WPS 刷新分两条：`wps-sync-dispatch-on-write-and-revert` 覆盖馆长对 docx / xlsx / pptx 的 `/status` dispatch，不打开 WPS；真窗口刷新 `wps-office-reload-on-write-and-revert`（路径 `result/wps-office/`，`pnpm test:workbench:wps-office`）覆盖已授权 WPS 窗口，因本机授权弹窗可能卡住自动化。加载项与 `publish.xml` / `authaddin` 合并由 unit 覆盖；用户行为见 `WB-WPS-001`。
- docx apply case 需要真实 docx 输入、真实 AI 编辑、真实写回记录、真实预览和真实回退。
- text-file apply case 需要真实 Markdown 或代码文件、真实 `text_file_edit`、真实结构化 diff、独立 `TextFileDiffViewer` 和按原始 bytes 回退。
- image generation apply case 需要真实模型先加载外置 `image-generation` 工具包、真实调用 `image_generate`、生成可解码图片、展示修改入口和图片预览，并完成新建图片回退。
- `browser-use-task-panel` 需要真实 AI run 触发 `browser_use` 并驱动内置浏览器完成本地内容输入与 hover-退出网页任务（observe→actionId act，支持 text 注入）；必须在无进程级远程调试口下完成。同时验证多个浏览器 Tab 独立历史、共享持久站点数据、切换文件后网页状态不销毁，以及同 URL 标签不会让 Stagehand 串页，不能用 fake browser 替代。
- `web_search` 单独覆盖：搜索 case 验证 type=search 后 type=fetch 读取网页正文；直接 URL case 使用正文由 JavaScript 渲染的真实本地页面，验证冻结网页后台进程连接浏览器并取得正文，不设置本地地址绕过抓取的测试配置。两类 case 均验证结果只回模型、不自动展开右侧面板，对齐 `WB-CORE-007-AC4`；正式包从系统真实入口启动，规则见 `doc/test.md`。
- Workbench 附件链路不限制文件扩展名、大小、数量或目录大小；点击 `+` 直接打开可选择文件或目录的系统选择器，拖放接受文件与目录并保留源绝对路径，目录不递归扫描；附件卡片采用紧凑内边距，文件夹、音频和视频分别使用对应图标；图片保持灯箱预览，支持右侧文件预览的文档打开资源 Tab，文件夹打开系统文件管理器，音视频和其他不支持右侧预览的文件定位到系统文件所在位置；粘贴文件保存到 `userData/partners/{id}/runtime/assets/<assetBucketId>/`。`assetBucketId` 为输入草稿 UUID，发送给 AI 时只传附件名称与路径，不做发送前识图或文件解析；文件是否可被 AI 工具处理由 AI 工具层自行判断。无伙伴时空态 Composer 不接受附件。
- Excel / PPT / DOCX / PDF 工具的输入输出、operation、原子失败与 diff artifact 语义由 AI tool 测试承担；Workbench apply case 只验证真实用户流程、预览入口、审核交互与回退，不重复枚举底层操作矩阵。其中 Excel 工具侧（`WB-EXCEL-001` / `WB-EXCEL-002`）覆盖 `WB-EXCEL-001-AC3`、`WB-EXCEL-001-AC4`、`WB-EXCEL-001-AC6`、`WB-EXCEL-001-AC7`、`WB-EXCEL-002-AC2`、`WB-EXCEL-002-AC3`、`WB-EXCEL-002-AC5`、`WB-EXCEL-002-AC6`、`WB-EXCEL-002-AC7`、`WB-EXCEL-002-AC8`（`WB-EXCEL-002-AC3` 记录/baseline **只在 ai-test 硬断言**）；Workbench e2e 覆盖 `WB-EXCEL-001-AC5`、`WB-EXCEL-002-AC1`、`WB-EXCEL-002-AC4`、`WB-EXCEL-002-AC9` 用户闭环（UI 可见单入口，不重复硬断言 AC3）。

- 几何取证使用真实 DOM 与原生窗口 bounds；非整数 DPI 下，固定 CSS 尺寸只容许 0.05px 的布局量化误差。确认窗口须完整覆盖父内容区，不允许留缝，原生边界向外量化最多 2 DIP。原生菜单、确认窗口及桌面光标用例串行独占焦点。

### 文件审核共同验收

`result/apply` E2E 验证正式文件预览、固定审核内容、模式切换与回退的用户闭环。临时工作快照清理、首次字节基线、净差异及文件结构由 AI 的 `file-change-immutable-review` 和 Excel / PPT 工具用例补充；各层已验证子项与缺口见 §6。

## 3. Suite 设计

Workbench 顶层 suite 按用户任务闭环划分，不逐一复制 PRD 小节：

1. `conversation`
2. `run`
3. `result`
4. `scheduled-task`
5. `skills`

领域规则：

- `conversation` 验证伙伴、composer、时间轴与清空、模型偏好和 `@` 参考资料 token。发送门禁是已有伙伴 + 输入非空。
- `run` 验证智能模式运行中的过程流、追加消息安全交接、持久化恢复、停止、审批、压缩提示和 AI 内置浏览器任务。
- `result` 验证普通文件预览、修改文件工作区、真实 docx 预览、文本 diff、回退、多文件修改入口，以及馆长 WPS 通道对 docx / xlsx / pptx 的 dispatch 与本机已授权 WPS 中的 Word / Excel / PPT窗口刷新。
- `scheduled-task` 验证创建、编辑、资料引用、伙伴绑定、启用、定时与立即执行，以及删除和失效边界。
- Workbench 测试全部是 `e2e`，覆盖 Electron、renderer、IPC、真实 AI、右侧面板和文件系统联动。
- AI 提问统一归入 `run/blocker`：真实 UI 展示数字徽标单选、方框多选和无选项输入，无独立其他选项，推荐使用标题旁标签，覆盖手动下一步、多问题切换与刷新恢复；等待回答时侧栏伙伴行显示「需要你的协助」，刷新或切换伙伴后仍保留，提交、取消或结束后清除，审批等待不显示；提交后在对应 Activity 工具行下按顺序显示问题与用户答案。审批结果也在对应工具行下显示，不再使用旧图标前缀或 hover 替换文案。
- 涉及 AI 的 case 必须记录模型、耗时、完成度评分和失败归因；Oracle 引用 [workbench.md](../prd/workbench.md) 的需求或验收编号。
- AI 内置浏览器 case 必须验证右侧浏览器面板、网页操作结果和最终 assistant 输出形成闭环，不能只验证面板出现。
- docx apply 相关 case 必须使用真实 docx 文件验证预览与回退；仅写入 `.docx` 后缀文本文件不满足测试 case 口径。
- 依赖本地文件语义的测试统一复用 `tests/fixtures/workspace` 作为共享输入目录，但该目录只作为真实输入文件来源；运行时通过设置页添加为文件地址，并先创建伙伴。
- `WB-BLOCKER-003`（上下文压缩提示）依赖真实模型使用量与正式压缩阈值触发，运行成本不确定，不作为每次源码测试的固定 case，发布时按影响评估单独执行真实检查，检查运行中与完成态过程组，且不得为 E2E 降低生产阈值或伪造 compaction 事件。压缩阈值随当前模型 effectiveWindow（`min(256000, floor(modelContext × 0.8))`）。
- WPS 由 `wps-sync-dispatch-on-write-and-revert` 验证三格式写回后的 dispatch，`wps-office-reload-on-write-and-revert`（`pnpm test:workbench:wps-office`）验证真实窗口刷新。后者覆盖已授权的文字／表格／演示，全量 E2E 包含该组，发布按影响选择。未安装或对应组件未授权时跳过该格式；已授权但连接失败则失败，不得只测 DOCX 即宣称三格式通过。E2E 启动不覆盖加载项代码；通过 `/status` 检查对应组件、目标实例、close／reload 结果及重开后内容，具体断言见对应 case Oracle。
- WPS 相关 e2e 必须自带环境归零：进用例前和用例结束后各做一次「先不带 `/F` 请求关闭 wps / et / wpp，超时再强杀」，并清掉 `ncurator-workbench-wps-*` 临时工作区；三种格式之间也要归零。不归零时上一轮残留实例会连上本轮回环冒充本轮客户端，让 registry、dispatch 与断言随机失败，且临时工作区因文件锁删不掉。

## 4. 目录与命令

Workbench 测试目录：

```text
tests/case/workbench/
  conversation/
    partner/
    composer/
    timeline/
    message/
    scope/
    prefix-cache/      # 跨 run 前缀缓存
    provider-matrix/   # 独立连通性冒烟，仅专用命令或显式 --case 执行
  run/
    process/
    blocker/
    browser/
    persistence/
  result/
    preview/
    apply/
    wps-office/        # 正式 E2E：真开 WPS；发版按影响范围或全量测试
  scheduled-task/
  skills/
```

测试命令：

- `pnpm test:workbench:e2e`
- `pnpm test:workbench:provider-matrix`（独立全服务商冒烟；执行隔离规则见[测试规范](../test.md#32-runner-与常用命令)）
- `pnpm test:workbench:wps-office`（本机已授权 WPS，可单独执行；发版按影响范围或全量测试）

自动更新模拟（聚合入口，不证明真实安装成功）：

```bash
pnpm test:update
pnpm test:update:backend
pnpm test:update:e2e
```

- `test:update` = backend 契约 + 模拟页面 E2E。
- `test:update:backend`：`unit/release`，验证主进程更新状态、发布配置、发布元数据和 release fragment。
- `test:update:e2e`：Workbench case `sidebar-app-update` 与 `database-version-update-required`（见下方 case 规格）。
- 自动更新是允许在测试侧注入受控状态的 E2E 特例：可提供更新可用、下载进度、完成和失败快照，但不得修改生产代码来支持模拟；`database-version-update-required` 还允许在 Electron 启动前向隔离 `userData/app.sqlite` 写入未来 migration 记录以真实触发仅更新模式，只能准备数据库输入，不能伪造主进程启动状态或绕过版本检查。
- 真实覆盖升级与禁止降级验证见 [`doc/deploy/design.md`](../deploy/design.md)，不在本计划与 `test:update` 内。

补充规则：

- `pnpm test:workbench:e2e` 是 Workbench UI 源码 E2E 测试入口。
- 需要验证正式安装包时，调试使用 `pnpm test:e2e:package --bundle <release-bundle.json>`；它会校验并安装已构建候选包，再对安装后的真实应用执行所选正式 E2E，不重新构建。发布时通过 `release:win` / `release:mac` 的 `--test-only` 按影响评估选择范围，不带过滤参数时执行全部正式 E2E。
- `conversation / run / result / scheduled-task` 是稳定 suite，不因 PRD 小节增删而轻易重排。
- suite 下的 `partner / composer / timeline / message / scope / prefix-cache / provider-matrix / process / blocker / browser / persistence / preview / apply / wps-office` 是 group，只在同一 suite 内用于收敛相近 case。不存在 `search/` 目录。

## 5. 测试清单

### 5.1 `conversation`

#### `supported-writeback-format-summary`

- 测试类型：`e2e`
- What：Workbench 右侧空面板明确展示当前支持直接写回的文件格式。
- Why：用户需要区分可直接写回并回退的正式能力与仅可预览或自行尝试处理的格式。
- How：打开 Workbench 并展开右侧空面板，读取可见的支持格式说明。
- Oracle：说明包含 DOCX、PPTX、XLSX、PNG、JPEG、WebP 和 UTF-8 文本，不包含 GIF、SVG，对齐 `WB-CORE-003-AC1`、`WB-CORE-003-AC2`。

#### `partner-create-and-name`

- 测试类型：`e2e`
- What：无伙伴时空态、创建弹窗提交即落库、标题就是伙伴名称且不因后续消息改名。
- Why：伙伴是一条一直聊下去的记录；草稿提升或「发第一条才创建」会产生空会话语义。
- How：打开 Workbench 确认无伙伴空态与「创建伙伴」入口；填写名称并选择外形/颜色后提交；再发送两条真实自然语言请求。
- Oracle：无伙伴时 Composer 空态且提供 44px 拖动区，侧栏列表区不展示空态文案，对齐 `WB-CORE-008`、`WB-SESSION-001-AC1`、`WB-CORE-001-AC2`；提交即写入 `partner` 并选中，对齐 `WB-SESSION-001`；创建时选择外形与颜色并对齐 `WB-SESSION-001-AC4`；标题等于伙伴 name 且第二条消息不改名，对齐 `WB-SESSION-003`；创建后尚无消息时侧栏副文案为「做点啥呢？」，发送后更新为最新用户语句预览，对齐 `WB-SESSION-001-AC5`。 已核对的具体验收：`WB-SESSION-003-AC2`。

#### `partner-delete-confirmation`

- 测试类型：`e2e / exclusive`
- What：内置浏览器上方的原生伙伴删除确认，以及关闭、取消和确认删除。
- Why：伙伴删除是高风险操作，必须避免误删。
- How：通过真实 Workbench UI 创建伙伴并从新增资源菜单打开内置浏览器；导航到持续发送心跳的本地网页；在原生确认子窗口中操作关闭、取消、Escape、遮罩与确认。只读采集子窗口父子关系、bounds、浏览器实例、可见性和网页心跳。
- Oracle：确认子窗口可见且完整覆盖主窗口内容区域；Windows 非整数 DPI 造成的边界外扩最多 2 DIP，不允许留出未覆盖区域；弹窗期间网页心跳继续、浏览器实例与视口不变且保持可见；关闭、取消、Escape、点击遮罩均保留伙伴并销毁子窗口；确认后伙伴与浏览器标签移除，对齐 `WB-SESSION-004`。 已核对的具体验收：`WB-SESSION-004-AC1`、`WB-SESSION-004-AC4`。

#### `partner-pin-toggle`

- 测试类型：`e2e`
- What：伙伴置顶与取消置顶，图钉常驻，以及无「已置顶」分组文案。
- Why：置顶是侧边栏高频整理能力，错误排序或丢失状态会打断工作流。
- How：通过真实 Workbench UI 创建两个伙伴；悬停后点击置顶，确认该项排到最上方且图钉常驻；再取消置顶。
- Oracle：置顶后排到列表最上方、图钉无需悬停也可见、不出现「已置顶」文案，对齐 `WB-SESSION-009`。不再按工作空间分组。 已核对的具体验收：`WB-SESSION-009-AC2`。

#### `partner-edit`

- 测试类型：`e2e`
- What：侧栏编辑入口复用创建抽屉，保存后更新名称与形象。
- Why：伙伴名称和形象应可改，且不能误建成新伙伴或清掉对话。
- How：通过真实右侧表单创建伙伴，检查空输入提示使用该伙伴名称；再悬停点击编辑，修改名称和外形后保存，检查空输入提示同步新名称；只读查询确认 id 和总数。
- Oracle：抽屉为「编辑伙伴」并预填原值；保存后仍是同一伙伴 id，侧栏显示新名称，对齐 `WB-SESSION-012`；创建和改名后的 Composer 空输入提示均使用当前伙伴名称，对齐 `WB-COMPOSER-001-AC4` 的伙伴名称部分。

#### `workbench-help-entry`

- 测试类型：`e2e`
- What：Workbench 左侧使用帮助入口。
- Why：帮助入口必须独立于伙伴创建和模型运行保持可用。
- How：打开 Workbench，点击帮助入口并观察外链调用和当前路由。
- Oracle：入口可访问，打开官方中文手册且不改变当前伙伴路由，对齐 `WB-COMPOSER-011`。

#### `sidebar-app-update`

- 测试类型：`e2e`
- What：Workbench 左侧更新入口的可见性、下载进度、失败重试和重启操作。
- Why：日常更新入口必须保持紧凑、状态准确，并且不与旧设置入口重复。
- How：用更新 fixture 驱动无更新、可下载、下载中、下载完成和失败状态，并检查旧设置路由。
- Oracle：无更新时入口隐藏；用户点击后才下载；下载中显示进度；下载完成可稍后或重启；失败可重试；旧设置路由回到大模型页。对齐 `WB-COMPOSER-012-AC1`、`WB-COMPOSER-012-AC2`、`WB-COMPOSER-012-AC3`。

#### `database-version-update-required`

- 测试类型：`e2e`
- What：数据库版本高于当前应用支持版本时的仅更新恢复模式。
- Why：旧应用误开新 schema 数据库时，必须先升级应用，不能初始化业务层继续读写。
- How：先启动应用创建正式 schema，再关闭应用，在同一隔离 `userData/app.sqlite` 的合法迁移前缀后写入更高版本记录并重启，通过真实主进程版本检查进入恢复页；继续用更新 fixture 验证自动检查、下载、失败和重启安装。点击「前往官网下载」后除记录 renderer 调用外，还等待 `openExternalResult` 并断言 IPC 返回成功。
- Oracle：只显示恢复页及本机数据库版本和当前应用支持版本，Workbench 不存在；恢复页提供下载、重启安装、中文失败提示、官网下载页和退出入口，点击官网入口时 `open-external` 必须真正成功；底层英文错误不直接展示，失败后仍不能进入业务界面。对齐 `WB-COMPOSER-012-AC4`、`WB-COMPOSER-012-AC5`。

#### `context-ring-usage`

- 测试类型：`e2e / live`
- What：智能模式上下文用量在 run 后刷新，并可查看已用比例与 tokens。
- Why：用量提示错误会误导用户对后续可用上下文的判断。
- How：创建空工作地址，不准备资料或知识库索引；记录运行前圆环用量，执行含固定输入的真实 AI run。通过只读 aiContextUsageGet 获取生产摘要，核对共用圆环及 hover 的已用 / 最大 tokens 与摘要一致，并确认已用 tokens 更新。
- Oracle：圆圈与 hover 展示的已用百分比及已用 / 最大 token 须与生产摘要一致，不展示剩余，对齐 `WB-COMPOSER-008-AC1`；百分比与中文标签之间空白不影响判定。run 后显示值随生产上下文摘要更新，且大于运行前值，对齐 `WB-COMPOSER-008-AC2`。仅存在“已用”文案不足以判定通过。

#### `chat-without-knowledge-model`

- 测试类型：`e2e / live`
- What：未配置工作空间、未安装向量模型仍可发送并完成真实聊天。
- Why：默认 E2E 模型准备不能掩盖首次使用的运行门禁。
- How：通过既有 NCURATOR_MODELS_PATH 注入独立空模型目录，跳过 harness 默认模型预热；真实 UI 配聊天模型、创建伙伴并发送；只读 observer 收集运行事件、下载状态和 embedding runtime。
- Oracle：真实 run completed；模型目录没有下载产物；无下载任务；embedding runtime uninitialized 且 pid 为空，对齐 WB-COMPOSER-001-AC5。

#### `send-guard-and-preferences`

- 测试类型：`e2e`
- What：缺少模型时的配置提示（本机 localStorage 仅首次出现一次）、发送前置条件（已有伙伴 + 输入非空），以及模型 / AI 推进偏好 / 执行权限按伙伴恢复；创建伙伴后真实发送一次并完成 AI 运行。
- Why：Workbench 的任务入口依赖这些基础交互；任一状态失真都会导致用户无法发起任务或把任务发到错误伙伴。
- How：先在无模型配置状态下检查提示，再通过 UI 配置真实模型并创建伙伴；覆盖无伙伴空态、输入保留、模型选择、AI 推进偏好、执行权限菜单的两条说明与完全访问高危风险弹窗确认/取消门禁、切换伙伴后的独立恢复和真实发送（Composer 提交，含 Enter 发送路径）。
- Oracle：无模型且本机从未展示过该提示时快速显示配置提示（展示后写入 localStorage，之后即使仍无模型也不再弹出）；无伙伴时 Composer 空态且不出现发送按钮，对齐 `WB-CORE-001-AC2`、`WB-COMPOSER-001`（无伙伴空态 **只在本 case 硬断言**）；有伙伴、未插 `@` 且输入非空时可发送，对齐 `WB-CORE-001-AC1`；发送走 Composer 提交并完成真实 AI 运行，对齐 `WB-COMPOSER-002-AC1`、`WB-CORE-006-AC1`；权限菜单同时展示“审核 / 涉及到风险操作需要你审核”和“完全访问 / 不受限制的操作你的电脑”；切换“完全访问”触发风险二次确认弹窗（取消维持审核、确认切换成功，切回审核免二次确认），对齐 `WB-COMPOSER-007-AC13`；模型、推进偏好和执行权限按伙伴恢复，对齐 `WB-COMPOSER-007-AC5`、`WB-COMPOSER-007-AC9`、`WB-COMPOSER-007-AC12`、`WB-SESSION-008`。`WB-COMPOSER-002-AC2`、`WB-COMPOSER-002-AC3`（Shift+Enter 换行、中文输入法组词）不测。

#### `partner-ui-state-isolation`

- 测试类型：`e2e`
- What：A/B 伙伴分别保存 Composer（包括执行权限）、资源标签、活动标签和展开状态，反复切换互不覆盖。
- Why：伙伴状态串联会让用户把输入、模型或资料发到错误上下文。
- How：切换后先等待目标草稿和面板展开状态同时稳定，再原子读取可选面板正文，避免 count 与 textContent 之间面板卸载的竞态。经 UI 创建 A/B 伙伴，分别输入草稿、选择资料偏好和执行权限；在 A 打开文件资源标签，在 B 收起/展开资源面板，展开前等待收起动画结束、真实展开按钮出现；来回切换后核对可见状态及只读持久化快照。
- Oracle：草稿、偏好、执行权限及活动资源标签和展开状态各自恢复，对齐 `WB-SESSION-002`、`WB-SESSION-008-AC1/AC2`。本例不验证完整模型/引用/附件矩阵，也不验证 Brain 思考中切回的 `WB-SESSION-002-AC3`，这些属于覆盖边界。

#### `partner-ui-state-restart-persistence`

- 测试类型：`e2e`
- What：正常关闭并使用同一用户目录重启后，恢复最后活动伙伴及其完整 UI 状态。
- Why：只在内存中隔离会导致用户重启后看到错误伙伴或丢失未发送工作。
- How：经 UI 创建伙伴、输入草稿并选择执行权限；经资源菜单创建浏览器，在地址栏依次导航两个真实本地页面，每次等待实际网页完成加载并确认两条真实历史后用工具栏放大；等待只读快照落盘后正常退出，用同一用户目录重启；只读记录重启前后的真实浏览器导航历史与加载状态。
- Oracle：最后活动伙伴、草稿、执行权限、面板以及浏览器 URL / 历史 / 缩放恢复，对齐 `WB-SESSION-008-AC3`、`WB-PANEL-004-AC12`；不把这些断言扩展为全部 Composer 字段的重启矩阵。

#### `background-partner-ui-event-isolation`

- 测试类型：`e2e`
- What：A 伙伴的浏览器导航在用户切到 B 后完成，只更新 A。
- Why：后台事件晚到时若按当前页面写状态，会无声覆盖用户正在操作的另一伙伴。
- How：经 UI 创建两个伙伴并输入不同草稿，在 A 的浏览器地址栏导航到真实本地 HTTP 页面；服务器暂缓响应，切到 B 后释放真实响应，再检查 B 并切回 A。不注入应用状态或伪造事件。
- Oracle：B 草稿和面板展开状态不变、无 A 浏览器标签；切回 A 可见原草稿、对应浏览器标签及已加载 URL，对齐 `WB-SESSION-008-AC2`。

#### `model-selector-and-provider-error`

- 测试类型：`e2e`
- What：主模型选择只展示已配置服务商的预设模型，未配置服务商不展示；无已配置预设且无免费目录时显示空态，有免费目录则在统一列表展示免费行；推荐配置默认选中预设稳定调用名；预设统一列表（付费在上、免费在下、无分区标题）；列表右上角有统一目录刷新（不单独占顶栏行）；悬浮/聚焦预设或免费行时右侧显示信息侧栏；预设/免费行含接口 `iconUrl`；不可用预设禁用；自定义入口可选中 remote id 且不被强制改回预设，并正确展示 provider 错误反馈。
- Why：主模型配置是智能任务能否启动的直接前提，预设区是用户首选的模型入口。
- How：使用空工作地址，通过真实设置页配置 live 自定义模型（非预设服务商模式），不准备资料索引；回到 Workbench 展开选择器，等待目录结束 loading；检查无「免费模型」分区标题、右上角刷新按钮可见；若有免费行则悬停并断言右侧信息侧栏出现；预设 option 数为 0；若官网免费目录可用则可见免费 option 与「免费」文案及图标，否则可见「暂无已配置的预设模型」空态；进入自定义模型视图后侧栏消失，按名称搜索并选中后 pill 保持该模型名。完成一次真实请求，再让真实模型执行只读 `pwd`，后续长文字请求开始时点击停止；第三次再次执行 `pwd` 后，既有转发代理只将工具结果后的模型请求改为不存在的模型名，取得真实 provider 错误。三次终态均 hover 上下文用量环，使用只读上下文查询核对 tooltip，不切换伙伴。
- Oracle：未配置预设服务商时不展示付费预设行，对齐 `WB-COMPOSER-007-AC2`；悬浮信息侧栏对齐 `WB-COMPOSER-007-AC3`；统一列表 / 右上角刷新入口 / 免费行（若目录非空）与侧栏「免费」+ 稳定性提示对齐 `WB-COMPOSER-007-AC14` 的 UI 部分；自定义入口和分组搜索对齐 `WB-COMPOSER-007-AC1`；默认选中、自定义选中不被强制改回预设与展示对齐 `WB-COMPOSER-007-AC4`；选择器只保留主模型且不另加视觉图标，对齐 `WB-COMPOSER-013-AC1`；伙伴保存 `configId + modelName`，对齐 `WB-COMPOSER-007-AC4`；provider 失败请求仅一次，气泡短标题为「模型请求失败」，「查看详情」可见 HTTP 状态码和错误原文，对齐 `WB-COMPOSER-007`、`WB-CORE-006`、`WB-SESSION-007-AC8`。成功、取消、失败后三次上下文用量均与日志投影一致，取消及失败后用量包含新增工具上下文，对齐 `WB-COMPOSER-013-AC5` 的终态刷新边界；不证明含图片历史下的发送拦截。

#### `live-preset-provider-smoke`

- 测试类型：`e2e / live`（路径 `conversation/provider-matrix/`，独立连通性检查；仅专用命令或显式 `--case live-preset-provider-smoke` 执行）
- What：对 `.env` 中已填写 `AI_LIVE_KEY_*` 的每个内置服务商，经真实 Settings「推荐」配置 + Composer 预设 option（稳定调用名 testid）选模，各发一句「你好」；免费目录非空时，再选择一个免费型号完成真实调用。
- Why：日常全量 live 只跑 `AI_LIVE_PROVIDER`/`AI_LIVE_MODEL` 选定目标；需要 smoke 覆盖已配置服务商，以及正式包中的免费模型官网调用与鉴权链路。
- How：通过专用命令或显式 case 选择独立执行，不随日常或全量回归运行。读取 `listConfiguredLiveLlmTargets()`，默认测试模型须在当前推荐目录中；为每个目标走 Settings UI 创建推荐服务商；创建伙伴后依次点预设 option（不得走自定义搜索兜底）并发送「你好」，等待 run 完成。随后通过只读 `freeModelsGet` 取得公开目录；目录非空时点击对应免费 option 并发送「你好」，观测真实完成事件与回答，记录型号、标签与截图；目录为空时明确记录该覆盖缺口。
- Oracle：每个已配置 Key 的服务商都有非空最终回答；未配置 Key 的服务商不参与、不失败。免费目录非空时，所选免费型号必须真实完成且回答非空，不能因免费通道失败而跳过；目录为空只证明已配置服务商连通性。本检查提供外部服务连通性证据，PRD 功能行为由常规功能用例覆盖。

#### `prefix-cache-retain-live`

- 测试类型：`e2e / live`（路径 `conversation/prefix-cache/`）
- What：同一伙伴经真实 Workbench UI 连续三轮短任务（Run1 `@` 选中极短笔记抽出事实，Run2/Run3 同选中文件追问），相邻跨 run 首轮 brain 均须明显复用上一 run 末次前缀缓存，且 `toolsHash` 一致。
- Why：验证真实发送链路中的前缀缓存。纯闲聊测不到 tool 历史投影与 tools 前缀稳态；backend 直调 `AiRunService` 也绕过 Composer `@` 选中与生产发送组装。若消息重建或工具表漂移导致缓存丢失，会拖高成本并放大续接不稳定。
- How：发布时通过 `--target package` 在隔离安装的国内候选包执行；源码执行仅用于开发排查。创建空临时 workspace，仅写入 `cache-retain-note.txt`，经 Settings 添加文件地址并建伙伴、选 live 模型。每轮用 `@` 选中该文件再发送（不得 `sendWorkbenchMessage` 清空 token）。Run1 要求读笔记说出项目代号（硬断言文本读工具）；Run2 问发布窗口；Run3 问负责人。e2e observer 只采集生产 `recordLlmIo` 并写入 `llm-io.jsonl`。两段跨 run 缓存用公用 `CROSS_RUN_PREFIX_CACHE_MIN_RATIO`（当前 0.85）；硬断言相邻段 `toolsHash` 相等；按实际 runId 选择完成日志中的请求，禁止按数组长度切分；断言 data 附带双方 runId/callId、历史前缀是否一致和 `requestWireDiff` 供排障。
- Oracle：三轮均 `completed`，对齐 `WB-SESSION-005`；Run1 有 `text_file_read` / `text_file_search` 证据，且发送带 `@` 选中，对齐 `WB-CORE-002`；Run2 首次 brain 相对 Run1 末次、以及 Run3 首次 brain 相对 Run2 末次，均满足 `cachedInputTokens / 上一末次 inputTokens ≥ CROSS_RUN_PREFIX_CACHE_MIN_RATIO`，且两段 `toolsHash` 分别一致。没有 live key 必须失败，不能跳过。

#### `user-message-actions`

- 测试类型：`e2e`
- What：用户消息 hover 操作、latest turn 编辑确认与撤回、running 态编辑入口隐藏，以及用户消息附件展示。
- Why：用户编辑上一条消息依赖确认后撤回最新 turn、回填 composer 和附件 UI 协同；任一状态错误都会导致重复发送、误编辑运行中消息或附件被正文挤压遮挡。
- How：使用真实 Workbench UI 创建伙伴，必要时通过设置页添加文件地址；真实粘贴图片和 `md` 附件并发送 AI 请求，另发送含长 URL 的用户消息并收窄中间栏；hover 用户消息并触发复制与编辑；编辑确认框确认后再断言回填；在 running 状态检查用户消息气泡和附件布局。首条用户消息应可见居中时间条。
- Oracle：hover 后显示复制和编辑、不含时间；复制给出成功反馈；点击编辑出现确认框，确认后撤回最新 turn 并回填原草稿，running 状态不显示编辑，对齐 `WB-SESSION-006`；长 URL 在不超过消息区 66% 宽度的右对齐气泡内换行且没有横向溢出，对齐 `WB-COMPOSER-009-AC4`；首条用户消息上方居中时间条对齐 `WB-SESSION-013-AC1`、`WB-SESSION-013-AC5`；跨日与 30 分钟间隔由 unit `message-time-label` 覆盖 `WB-SESSION-013-AC2`、`WB-SESSION-013-AC3`、`WB-SESSION-013-AC4`。附件独立展示在消息气泡上方（条宽可宽于气泡、卡片顶边不被横滑容器裁切，使用紧凑卡片规格与输入框附件卡对齐）；文档附件点击打开右侧文件预览，文件夹打开系统文件管理器，音视频和不支持预览的文件定位到系统文件所在位置；图片仍打开灯箱；输入框附件关闭按钮可点击且不被遮挡。

#### `composer-attachments-context`

- 测试类型：`e2e / live`
- What：`+` 系统选择器选择文件或文件夹、真实源路径文件拖放、粘贴添加附件时，附件只以路径进入伙伴消息记录，常规文档和非白名单扩展名可加入，并保持图片灯箱、文档右侧预览、文件夹打开系统文件管理器、音视频与其他不支持预览文件定位系统文件、删除、普通文本粘贴行为。附件卡片采用紧凑内边距并显示文件夹、音频、视频对应图标。粘贴保存到伙伴 runtime assets；发送后多附件横向滚动可到达首尾。
- Why：`+` 与拖放必须把源文件路径交给 AI，粘贴仍需保存副本，测试必须守住这两条不同链路。
- How：创建伙伴；需要文件资料时通过设置页添加文件地址；点击 `+` 在同一系统窗口分别选择文件与文件夹，并用真实本地文件拖放验证源路径进入草稿；覆盖多个附件、目录打开与移除、图片预览，并通过真实模型发送一次多附件消息；发送后读取 `ai_run` 与 log 投影消息，检查附件横向滚动首尾。Playwright 的合成拖放无法忠实构造操作系统目录拖入项，因此目录原生拖放需在桌面手工验收。
- Oracle：文件/目录拖入中间聊天区时显示“松开以添加文件或文件夹”覆盖层，放下后消失；无伙伴时不添加附件；`+` 系统选择器和拖放的文件、目录均保留原始绝对路径，文件和目录卡片只显示对应图标与名称、不显示类型副标签，卡片使用紧凑尺寸并可打开/移除，文件/媒体图标保持输入框原有配色与图形；文档点击打开右侧文件预览，文件夹点击打开系统文件管理器，音视频和其他不支持预览的文件点击定位系统文件，图片保持灯箱；粘贴文件落到 `userData/partners/{id}/runtime/assets/`；发送后附件仍为路径，持久消息不含 Base64；附件区溢出后首尾均可通过横向滚动访问且边界滚动不阻断消息纵向滚动，对齐 `WB-COMPOSER-010`、`WB-COMPOSER-013-AC2`、`WB-COMPOSER-013-AC3`；运行时缓存、HTTP(S) 原地址和失效占位由 AI tool 契约覆盖，对齐 `WB-COMPOSER-013-AC4`。`WB-COMPOSER-013-AC5` 的 backend 判断由 unit `message-log-vision-context` 覆盖；有效图片历史下实际 UI 发送拦截待补。

#### `reference-mention-keyboard`

- 测试类型：`e2e`
- What：`@` 候选列表使用方向键移动时，当前高亮项能停在移动后的选项，不会因候选刷新跳回第一项；长文本粘贴和连续换行后，输入末行与底部工具栏保持可见。
- Why：`@` 候选选择依赖键盘稳定性；高亮项被刷新会导致用户插入错误资料范围，长输入末行被遮挡会妨碍继续编辑。
- How：通过真实 Settings / Workbench UI 创建伙伴，并在设置页添加真实文件地址；在 composer 输入 `@` 打开候选列表，检查 Office/PDF 图标保留配色和尺寸，目录/MD/普通文件复用库图标，并在候选和插入后的引用标签中一致；读取名称文字色、token 底色及图标尺寸，CSS 尺寸测量只容许非整数 DPI 的 0.05px 量化误差；按 `ArrowDown` 后观察 active 候选项，再插入目录并继续输入，核对重绘后图标、文字及光标输入保持正确。随后通过全选删除引用和正文验证真正空态；Shift+Enter、空格/制表符/零宽字符粘贴后内容原样保留且占位隐藏，通过上下方向键和点击删除换行后恢复占位；普通多行正文、引用边界前后删除、原生撤销及清空后继续输入保持正常。再通过原生剪贴板粘贴长正文、连续 Shift+Enter 并继续输入，测量末字的真实 Range 矩形、输入区高度和发送按钮可见性，最后清空恢复。
- Oracle：候选项数量大于 1；按下方向键后 active 候选项发生变化，并在短暂停留后保持不变，对齐 `WB-SCOPE-002-AC1`；候选及插入的引用标签保留 DOCX 等类型的原有彩色图标，目录图标为 16px、其他类型为 18px；名称统一正文色，token 无独立灰底；目录使用 Bootstrap 的 `BsFolder / BsFolder2Open`，MD/普通文件使用 Phosphor Light 细线库图标，对齐 `WB-PANEL-003-AC30`；仅空白/换行/零宽字符保留输入并隐藏占位；删除到真正为空后占位显示，光标占位与零长度空节点不撑出幽灵空行；正常多行正文、引用前后删除、撤销及继续输入通过，符合 `WB-COMPOSER-001-AC4`、`WB-COMPOSER-002-AC2`；长正文高度受限、末行完整可见、内容及换行保留且工具栏可见，清空后恢复紧凑高度，对齐 `WB-COMPOSER-001-AC6`。

#### `reference-token-lifecycle`

- 测试类型：`e2e`
- What：`@` 参考资料候选覆盖全部文件地址的当前真实本地目录 / 文件与全局网页资料、目录 / 文件 / 网页 token 插入、多 token 共存、键盘删除、去重和空候选提示。
- Why：显式参考资料是用户控制 AI 上下文的核心入口；未 `@` 时知识库默认全部已索引文件地址 + 全局网页。
- How：创建伙伴；通过设置页添加 `tests/fixtures/workspace` 为文件地址，等待真实文件扫描并准备索引状态；添加真实 web source 并等待真实网页索引完成；随后直接在该目录磁盘中新建文件，不触发“检查更新”或“更新索引”；输入 `@` 触发最多两级路径的平铺候选（每页最多 50）；选择文件、目录、网页均为点击即插入；同一资料才去重；通过 Backspace 删除 token。对话里不再切换工作空间，因此不测跨工作区清理。
- Oracle：候选来源和发送范围对齐 `WB-SCOPE-001`（含两级平铺与分页 `AC2`/`AC4`）、`WB-CORE-002`、`WB-CORE-004-AC1`；真实目录与新增未索引文件对齐 `WB-SCOPE-001-AC3`；token 插入、共存、发送参数、键盘删除和图标对齐 `WB-SCOPE-002`（含 MD 专属图标与普通文件区分 `AC5`）；去重和空候选对齐 `WB-SCOPE-003`、`WB-SCOPE-004`。`WB-CORE-004-AC2/AC3` 的真实偏好行为尚无专门 AI live 场景，见自动化覆盖边界。 已核对的具体验收：`WB-SCOPE-002-AC2`、`WB-SCOPE-003-AC1`、`WB-SCOPE-004-AC2`。

#### `right-panel-layout-and-tabs`

- 测试类型：`e2e / exclusive`
- What：空伙伴输入区布局、右侧默认无占位折叠、标签栏密度与折叠入口、Tab 溢出滚动、伙伴级标签和展开状态恢复、两条分隔线的左右调整光标、中间|右分隔条拖拽与阈值吸合、窗口缩放时主区比例同步、浏览器缩放菜单、地址栏“前往”与“将打开外部浏览器”按钮。
- Why：右侧资源工作台和聊天输入区共享窗口高度与标题栏命中区域，普通功能测试无法发现输入框被推出窗口、折叠按钮放错区域、Tab 无法滚动、分隔条拖拽/吸合失效或原生浏览器遮挡浮层等视觉交互测试。
- How：串行独占桌面焦点，直接进入真实 Workbench，先确认无伙伴空态右侧 shell 不存在并测量输入区位置；创建伙伴后展开右侧，在侧栏边界和中间|右边界分别通过真实鼠标悬停，读取命中元素与其计算光标，并监听 Electron 原生 cursor-changed 取证；文件选择器与原生浏览器两种面板均检查分隔线热区；拖拽中间|右分隔条确认宽度实时变化，拖至阈值以下确认立即吸合折叠；拉宽窗口确认中间与右侧按同一比例同步变宽；在 A/B 伙伴分别创建不同标签并设置不同活动标签和展开状态，来回切换；通过真实鼠标拖动分隔条将右侧面板收窄至 440px，再连续创建八个浏览器 Tab 验证溢出滚动、关闭标签后拖拽区恢复和菜单；向原生菜单窗口发送 Electron 原生 Escape 按键输入，验证 before-input-event 关闭链路，等待窗口关闭与入口展开状态恢复后读取 viewport 和 zoom。
- Oracle：两条分隔线热区实际命中拖动控件、光标为水平双向调整，原生浏览器不覆盖分隔线；各伙伴恢复自己的标签、活动状态和展开状态；右侧宽度比例、分隔条与吸合对齐 `WB-PANEL-001-AC10`（含 macOS 窗口边缘 live-resize 限帧与缩放期关闭面板 transition）；无消息时输入区保持居中，有消息后输入区固定在主区底部，对齐 `WB-COMPOSER-009-AC11`；其余布局、动画、滚动和菜单要求不变，对齐 `WB-PANEL-001`、`WB-SESSION-008`。

#### `windows-empty-titlebar-drag-region`

- 测试类型：`e2e`
- What：Workbench 无伙伴空态的窗口拖动区和原生标题栏不遮挡空态文案或右侧入口。
- Why：窗口层级错误会让首屏无法拖动或按钮无法点击。
- How：在可见窗口测量原生标题栏、拖动区和无伙伴空态区域，点击关键入口。
- Oracle：业务内容从标题栏下方开始，交互元素位于 `no-drag` 区，无伙伴空态仍提供 44px 拖动区，对齐 `WB-PANEL-001`、`WB-CORE-008`。 已核对的具体验收：`WB-CORE-008-AC1`、`WB-CORE-008-AC2`、`WB-CORE-008-AC3`。

#### `timeline-day-jump`

- 测试类型：`e2e`
- What：有消息后时间轴出现「今天」日节点；点击跳到当天最早一条消息；时间轴无独立滚动；已在可视区时点击不带动侧栏/Composer；节点固定间距贴底。完整态轴文案会与 Composer / 审批卡左缘碰撞时进入紧凑态（仅圆点，悬浮 Tooltip）；不会碰撞时即使右侧面板展开也不收起；审批替换 Composer 时轴线仍在。
- Why：伙伴是一条一直聊下去的记录，用户需要按日定位；月/年用 DatePicker 选天，不再展开子节点；挤不挤取决于轴文案可用 gutter，而非面板开关。
- How：在空工作地址创建伙伴并完成一次真实 AI run（当天消息），不准备资料或知识库索引；打开时间轴，记录侧栏/Composer/消息列表位置后点击今天日节点；对「仅今天」时间轴截图，核对轴线底端靠近输入框顶部、顶端与顶栏留空、由下向上渐隐。把中间栏收窄到完整态轴文案会与 Composer 左缘碰撞后确认 `data-compact=true`；再拉宽至不再碰撞确认恢复完整态。滚顶懒加载与轴不独立滚动（`WB-SESSION-010-AC4`）沿用消息区既有懒加载，本 case 断言轴容器无独立滚动条。月/年聚合与可选日集合由 unit `message-timeline` 与 e2e `timeline-month-day-pick` 覆盖。
- Oracle：时间轴可见且含「今天」、无空的昨/前天；点击今天后将该天最早一条瞬时贴顶；轴自身无独立滚动；侧栏与 Composer 位置不变；gutter 不足进入紧凑态、充足时恢复，对齐 `WB-SESSION-010-AC1`、`WB-SESSION-010-AC3`、`WB-SESSION-010-AC4`、`WB-SESSION-010-AC6`、`WB-SESSION-010-AC7`、`WB-SESSION-010-AC8`。
- 标题栏补充：真实消息出现后，在右侧面板折叠和展开时分别测量聊天标题栏；标题栏整体为 44px 拖动区，左右留白和中部命中元素均可拖动，折叠态的右侧展开按钮为 `no-drag` 且点击可展开面板，对齐 `WB-CORE-008-AC1`。自动化验证配置、几何命中及按钮操作，系统级鼠标拖动窗口保留人工验收。

#### `timeline-month-day-pick`

- 测试类型：`e2e`
- What：打开伙伴或滚到底部后最新日贴顶且轴高亮该日；近端日节点第一次点击即贴顶且高亮不闪回月节点；月节点搜索可选有消息的天；选天后瞬时跳到该天且轴不展开；同一天再打开仍可点并再次跳转；选天关闭弹层后不会再跳到该月最早日；点月节点才跳该月最早日；高亮节点大于未选中节点。
- Why：墙钟一次发送只有「今天」，近端日期下方消息往往撑不满一屏；常驻阅读留白让滚到底与点轴共用「顶部是哪天」；月/年选天、重复点同一天、弹层点击穿透必须走 Electron UI。
- How：墙钟下一次真实发送只能产生「今天」节点，无法覆盖月/年选天。已批准例外：启动 Workbench 让隔离 `userData` 落库后重启，`prepareUserData` 调用 `scripts/dev/seed-partner-timeline.mjs --force` 向隔离 `userData/app.sqlite` 写入专用伙伴「时间轴 · 预览」的跨日/月/年消息；种子只造出墙钟一次发送得不到的日期分布，此后交互仍走真实 UI，不得用 IPC 或内部状态跳转。通过真实 UI 点开该伙伴。打开后断言「今天」贴顶且轴高亮今天。再点近一周内的日节点一次，断言目标日贴顶且高亮停在该日、短等后不闪回月节点。打开某月节点 DatePicker，确认无消息日不可选；从种子的 45、44、20 天前记录中选择同月的两个日期，按较晚日期点对应格子（不得假定相邻两天一定同月，也不得用日历最后一格代替），断言贴顶的是那天而不是该月最早日，轴仍是月节点。把消息列表滚到底后断言回到今天贴顶且轴高亮今天，再打开同一搜索点同一天仍能跳回。再点该月节点，跳到该月最早有消息日并稳定停留。截图核对比例与高亮节点更大。
- Oracle：对齐 `WB-SESSION-010-AC2`、`WB-SESSION-010-AC3`、`WB-SESSION-010-AC5`、`WB-SESSION-010-AC6`、`WB-SESSION-010-AC9`。

#### `context-clear-capsule`

- 测试类型：`e2e / exclusive`
- What：伙伴有消息且空闲时出现「清空消息记录」胶囊；hover tooltip 含伙伴名与无法恢复说明；点击先确认，取消不删；确认后消息列表为空，仍停留在同一伙伴，草稿不变。
- Why：用户需要可理解的「清空对话」动作：确认后消息列表为空，下次发送不再带旧上下文；切换伙伴后只要仍有消息也应能清空。
- How：创建伙伴，让真实 AI 文件工具修改临时工作目录的正式文件；检查胶囊文案与 tooltip，再通过资源菜单打开持续发送心跳的本地网页。操作真实原生确认子窗口，只读核对父子关系、内容区覆盖、浏览器可见性、视口和心跳。确认框默认不勾选，问号悬浮/聚焦按 PRD 文案显示源文件备份与删除后不可回退说明，点击问号不切换勾选；点击选项文字和键盘空格可切换。分别通过关闭、取消、Escape、遮罩退出，消息及历史仍在，重新打开恢复未勾选。默认确认清空，断言消息为空、备份与审核仍可读取、正式文件保持当前内容、仍在同一伙伴且输入草稿不变。再完成一次真实 AI run，点击选项行空白处勾选后清空，核对历史记录、备份及审核实际删除。只读 IPC 和磁盘读取用于核对，不注入业务状态。运行中不得出现清空入口。
- Oracle：有消息且空闲时可见对齐 `WB-SESSION-011-AC8`；确认后列表为空对齐 `WB-SESSION-011-AC1`；不换伙伴 / 草稿对齐 `WB-SESSION-011-AC2`；下次发送无旧上下文对齐 `WB-SESSION-011-AC3`（由清空后 message log 为空保证）；运行中不可用对齐 `WB-SESSION-011-AC4`；文案与 tooltip 对齐 `WB-SESSION-011-AC5`；原生确认完整覆盖父窗口内容区（Windows 非整数 DPI 边界外扩最多 2 DIP，不允许留缝）且不打断网页，关闭/取消/Escape/遮罩销毁子窗口并保留消息，对齐 `WB-SESSION-011-AC6`。换无关新话题用清空消息记录得到干净上下文，对齐 `WB-SESSION-005-AC3`、`WB-SESSION-005-AC4`、`WB-SESSION-011-AC3`。默认不勾选、帮助悬浮/聚焦且不误勾选、整行点击/键盘切换、取消后重置及两种清理范围由本 E2E 验证，对齐 `WB-SESSION-011-AC7`；Unit `clear-partner-context-deletes-messages-and-runs-keeps-file-changes` 和 `partner-cache-service` 补充后端清理、独立备份及正式文件边界。

#### `docx-selection-reference`

- 测试类型：`e2e / exclusive`（包含真实 AI 调用）；suite `conversation`，group `composer`。
- What：真实 DOCX 任意连续文字选区、表格行列与合并占位、系统 toast、AI 引用入口与对勾确认输入条、可点击的紫色高亮、左侧连续编号、混合正文、双向同步、定位与草稿生命周期。
- Why：确保原文准确，引用与想法关联，两侧使用同一内容。
- 几何取证：共用轨道为 16px、滑块为 14px，固定 CSS 尺寸沿用最多 0.05px 的非整数 DPI 布局量化误差；滑块同步、原文定位和拖动行为断言独立保留。
- 固定输入：跨文件表格选区使用政府网站发布的中文原件 `航空航天模型课程标准（试行版）.docx`，其课程等级表提供“阶段”“等级”等原始单元格文字。
- How：通过鼠标起点与 Shift 终点选择部分单词、跨段落、跨单元格、整表及正文/表格混选；复用 workspace DOCX，并用 `docx-selection-layout.docx` 覆盖单元格内换行、空单元格、横向/纵向合并、跨页、页眉页脚、图片混选及反向选择。只读 DOM 取证和引用原文核对；AI 引用入口出现后按 Ctrl/Cmd+C，读取系统剪贴板并核对当前所选原文；确认、高亮、点击重新编辑和定位均走真实 UI。纯图片选区检查系统 toast 合并与自动消失，文档内无提示条；重复/重叠选区保持静默。核对 AI 引用入口、“描述你想对引用内容做什么”placeholder、对勾提示、字号、高度、浮层翻转/缩放和未确认输入；发送后检查真实脑模型输入的引用分块及源文件未被提问修改；再用真实临时 DOCX 选择定位段，仅输入“精简下”，核对写回后所选段变短、未选中的同章场景段完全保留，普通 DOCX 预览自动出现切换并可进入审核；双向编辑、跳转和两侧删除，核对左侧编号、原文与想法关联及右侧高亮清理；切换伙伴和文件，实际发送后新增选区检查从 1 开始，再编辑历史消息并刷新 Renderer 检查持久化草稿。
- Oracle：覆盖 `WB-DOCUMENT-REFERENCE-001-AC1` 的跨段落/跨页/跨单元格/整表/正文混选、页眉页脚、反向选择、表格行列分隔与空/合并占位、单元格内换行、图片混选和无文字 toast，`WB-DOCUMENT-REFERENCE-001-AC2` 的两阶段入口、对勾及新增/编辑提示、小字号紧凑高度、输入后保留紫色高亮、浮层边界/翻转/滚动/缩放、空内容禁用、Enter 确认、Shift+Enter 换行和 Esc/外部点击关闭，`WB-DOCUMENT-REFERENCE-001-AC3` 的图标编号胶囊和两侧编辑同步，`WB-DOCUMENT-REFERENCE-001-AC4` 的右侧无编号、仅高亮文字可悬停和点击、定位、重复/重叠选择静默保留、删除后左侧连续编号与右侧高亮清理、删空及发送后从 1 开始和内容不串，`WB-DOCUMENT-REFERENCE-001-AC5` 的伙伴隔离及内存/持久化边界，`WB-DOCUMENT-REFERENCE-001-AC6` 的接受后清理、历史编号保留和历史编辑。刷新后选区消失，普通文字与 @ 引用保留；真实局部精简保留未选中正文，提问不写文件，引用按片段标题分块且选中内容与前后文清楚分隔，DOCX 改动收尾后普通预览自动提供审核切换。
- 待覆盖：文本框文字、IME、想法内 @ 混排、关闭资源 Tab、应用进程重启及附件恢复、外部原文变化后的定位 toast、提交期间锁定、提交失败保留、排队成功清理及历史复制。
- 浮层边界：缩小窗口并通过真实分栏拖拽缩窄预览，确保正文溢出；选择段落末尾文字并用真实滚轮将选区靠近预览底部，验证输入条向上避让及恢复分栏/窗口后输入保留，不依赖窗口尺寸低于应用最小值或固定文字换行位置。
- 双向编辑取证：通过真实鼠标将光标放在左侧想法文字内部再输入，验证右侧读取到更新内容；不使用会跨过内联引用边界的整行 End 键作为想法编辑的前置定位。
- 位置标记条验收：补充 `WB-DOCUMENT-REFERENCE-001-AC7`，文件打开后通过 Escape 收起保持展开的文件列表，再操作正文与轨道。自动检查已保存引用生成紫色标记，重叠引用通过鼠标、Enter、Space 按正文顺序轮流定位并短暂强调，包括确认顺序不同于正文顺序；核对临时选区不显示、发送后清理、16px 共用轨道、仅隐藏 DOCX 原生竖向滚动条。长正文通过真实鼠标验证轨道拖动、滚轮、空白点击、滑块同步及滑块覆盖色块时点击定位；拖动不触发强调或循环切换。删除逐项更新、伙伴/文件隔离、窗口变化、外部原文变化后的可靠定位、更多密集引用及长区域边界列入人工验收。
- 模型投影验收：片段使用无属性 `<用户选中片段N>` 标签，首段选区没有前文时省略空前文块；原文放在 `<选中内容>`，非空后文放在 `<定位信息>` 内的 `<选中内容的后文>`，片段内部不插入空白行或额外定位说明句，纯提问保持源文件字节不变。

#### `multi-format-selection-reference`

- 测试类型：`e2e / exclusive`（包含真实 AI 调用）；suite `conversation`，group `composer`。
- What：MD/TXT、PDF、Excel、PPTX 的选区引用及分块混合提交，统一定位块，Excel/PPT 仅靠范围或对象标识读取内容，以及 PPT 元素/组合点击与画布拖拽的互斥和光标反馈。
- Why：确保复用交互仍保留各格式的准确定位和内部快照，模型能按 Excel 范围与 PPT 对象标识读取源内容。
- How：使用真实可见 Electron 窗口并串行独占桌面焦点，以便验证系统剪贴板；通过文件列表打开预览后手动收起列表，再通过鼠标/键盘选择文本、单元格以及 PPT 文本框/图片/整页，确认引用并切换文件；TXT 和 PDF 在 AI 引用入口出现后直接按 Ctrl/Cmd+C 并读取系统剪贴板。隔离 Markdown 副本增加标题、列表、粗体、行内代码、GFM 表格及重复段落，真实跨样式拖选时随编辑器重排更新鼠标终点，再复制、确认、回跳编辑与删除，核对源片段、行号及源字节；PDF 对选区截图统计深色文字像素，覆盖临时、确认后及悬停高亮，文字仍清楚可见。想法输入框另选部分文字复制，证明复制遵循当前焦点。Excel 明确操作表格主画布，验证浮层可见、想法确认和 Composer token，再由真实 AI 按引用范围读取；在隔离工作区的 PPT 副本加入既有 DOCX fixture 的真实内嵌 PNG，以及含两个文字子元素与无文字形状的嵌套组合，作为图片/组合点击与拖动输入，不改原始 fixture。核对组合子元素只渲染一次，点击任一子元素都引用最外层组合；真实 AI 通过页/元素标识读取源内容及子元素关系。PPT 在 100%、最小 25% 和放大后从文字、图片、已引用元素及空白处左键拖动，包含超过旧边界的大幅位移；通过真实鼠标与只读 DOM 观测精确画布位移、光标、浮层、原生文字选区和 toast，核对缩放按钮保留位移、滚轮跨越 100% 时保持鼠标锚点、“适应窗口”恢复中心；覆盖拖回起点、Esc 取消手势、单击编辑以及空格/中键快捷操作，整页引用后仍可点击新元素引用。只读采集可选 PPT 元素 ID，与真实 `ppt_read_slides` 返回的 ID 比对；TXT 编辑想法、删除重建、修改原文后回跳验证失效，再恢复原文；TXT 临时、已保存及悬停高亮截图统计深色文字像素，确认文字未被覆盖。真实悬停 TXT、MD、Excel 已保存选区（含回跳定位后的滚动）并读取命中控件的计算光标，验证单击编辑仍正常。已配置真实模型时，纯空格、换行或零宽字符保持输入、隐藏占位且发送禁用，Enter 不提交；删除后确认首个 TXT 引用位于第一行，输入有效想法后发送可用。随后插入一个 @ 文件，通过 composer DOM 几何与文本核对宽度足够时保持同行且未插入换行；主动留下首行空行、将光标移到末尾后手动新增一个换行再追加 MD 引用；逐字核对只新增这个换行，引用追加不额外增行。混合发送前附加首尾空白，读取提交前编辑区实际首尾空白，与用户消息及真实模型请求逐字比对；核对手动首行换行数量、首尾和段内换行保留，并检查用户消息 token 的文字色、透明底色、18px 图标与源文件字节。
- Oracle：覆盖 `WB-DOCUMENT-REFERENCE-002-AC1`、`WB-DOCUMENT-REFERENCE-002-AC2`、`WB-DOCUMENT-REFERENCE-002-AC3`、`WB-DOCUMENT-REFERENCE-002-AC4`、`WB-DOCUMENT-REFERENCE-002-AC5` 的基础引用与提交链路；混合引用使用无属性标签及必要嵌套，片段编号只在标签名出现，文档元数据与首个片段、同一文档内不同片段之间没有空白行，文字内容独立于定位块，行号、页码与前后文在 `<定位信息>` 内，片段内部不插入空白行或额外定位说明句。Excel 片段只含“工作表”与“选中单元格范围”，没有内部 display/cells/merges 快照，真实模型按范围读取值或公式，工具内容进入下一轮模型。PPT 片段只含页码与一个选中页面/元素标识，无文字快照、重复页面字段或选区图片路径。PPT 点击引用完整文本框、图片、无文字形状和最外层嵌套组合，子元素不重复渲染；标识与真实工具结果匹配，下一轮模型收到工具读取的文字及组合子元素标识；任意缩放比例下拖拽位移完整跟随鼠标且不受画布边界限制，无浮层、toast、原生文字选择或新增引用，拖回起点不误触编辑；缩放不强制回中，滚轮保持鼠标位置对应的画布点，适应窗口恢复 100% 和中心；空白处始终使用抓手，元素点击光标与拖动抓紧光标分开；纯提问不写源文件，失效文本选区不错误高亮；消息保存/排队/恢复由 AI `human-document-reference-context` 生产服务测试覆盖，DOCX 共用交互及原生复制由既有 case 回归；文字原生选区在引用入口出现时仍可复制，PDF 高亮各状态保留透明度且不盖住 canvas 正文，Markdown 源位置与跨样式可见正文正确对应，重复文字通过块位置和上下文定位；TXT 高亮各状态保留正文像素，MD/TXT/Excel 已保存选区命中控件显示手形且可单击编辑；空草稿首个引用从第一行开始；纯空白输入占位隐藏且不能发送，发送按钮与 Main 正文校验一致，对齐 `WB-COMPOSER-001-AC1/AC4`；追加引用不主动换行，手动首行及段内换行保留，发送后模型用户诉求保留首尾空白；@ 候选、composer 和已发送消息统一名称正文色、透明 token 底色及 18px 图标，对齐 `WB-SCOPE-002-AC4/AC5`、`WB-DOCUMENT-REFERENCE-001-AC3/AC4`。
- 待覆盖：`WB-DOCUMENT-REFERENCE-002-AC1` 的跨 Sheet/缩放与各格式双向编辑排列；`WB-DOCUMENT-REFERENCE-002-AC2` 的真实 AI 局部改字外围不变；`WB-DOCUMENT-REFERENCE-002-AC3` 的合并/空白格 UI、范围拒绝 UI 及真实 AI 局部填公式；`WB-DOCUMENT-REFERENCE-002-AC4` 的跨 PDF 页及磁盘保存失败；`WB-DOCUMENT-REFERENCE-002-AC5` 的选区草稿伙伴切换和进程重启。

### 5.2 `run`

#### `subagent-delegation-browser-sidecar`

- 测试类型：e2e / live；suite `run`，group `subagent`；serviceMode `real`。
- What：并行浏览器与 sidecar、子任务头像和悬浮云、主文件回退，以及运行停止与崩溃续聊。
- 云取证：排除 Tooltip 退场动画中的旧云，等待入场完成且 SVG 变换可逆后，在同一次 DOM 快照中确认唯一活动云、公开文字、轮廓边界与黑球动画；悬浮及完成态绑定对应子执行 ID，避免多轮查询跨越消息切换。唯一活动云、文字边界与隐藏周期要求保持不变。
- 子任务取证：列表与完成记录按该主运行实际产生的全部子执行 ID 核对，包含模型后续补充派发的帮手；初始三项任务和所有最终子任务均须完成。停止阶段绑定当次待加载子任务的行与云，停止后全部实际子任务均须退出运行态。
- 输入范围：主任务和续接任务明确只完成列出的交付，必要事实核对一次并简短汇报，不追加字节、哈希、字符数统计、多重交叉验证或验证脚本。保留真实网页、文件、完成事件和原有断言，保持 30 分钟总时限及各阶段时限。
- 短暂状态取证：发送后先检查初始思考与排队行/悬浮云，再等待自动文字流，避免任务完成后才查询排队状态。网页帮手在提交表单及核验资料数字后分别简短报告进展，为同一子任务的多轮真实文字流提供输入；不延迟模型、不阻塞工具来制造排队。创建伙伴时先正常点击稳定的输入框再填写，提交后等待弹框关闭再继续下一项 UI 操作。
- Why：覆盖独立标签、共享 sidecar、背景 UI 和临时实例资源之间的真实交互风险。
- How：真实 UI 配置模型和完全访问权限、发送、切伙伴、悬浮及回退。请求每位开始操作前及完成网页提交后简短说明进展，供同一子任务多轮真实文字流 UI 验证；只读 DOM observer 记录新消息自动开云、黑球及隐藏周期，自动观察忽略手动悬浮和聚焦时段，并记录消息替换及隐藏状态；三项任务分别提交独立表单、读取 JS 资料和真实搜索，配置和报告使用受控文本编辑；另以独立伙伴分别运行停止、崩溃阶段，保存文件的子任务完成时中断另一个待加载网页，再续聊同会话创建新执行实例。续接消息提供完整新任务文本，先检查真实派发参数包含新资料 URL，再等待交付；漏传新目标立即失败，避免误访问永不返回的旧网页。真实网站为输入，禁用 localhost 抓取快路；observer、只读 IPC 和原生视图检查只取证；harness 仅终止自身应用进程并以同 userData 重启。
- Oracle：对齐 `WB-SUBAGENT-001-AC1`、`WB-SUBAGENT-001-AC2`、`WB-SUBAGENT-001-AC3`、`WB-SUBAGENT-001-AC4`、`WB-SUBAGENT-001-AC5`、`WB-SUBAGENT-001-AC6`、`WB-SUBAGENT-001-AC7`。标签和页面结果不串；后台视图隐藏、viewport 有效、真实截图有效且不遮挡界面；sidecar 完成 JS 抓取与搜索；切换和折叠不抢选择，切回后的子列表与实际派发事件逐项一致，不写死模型派发数量。竖排头像/名称、排队灰态、运行及完成头像状态、最新消息流式云与黑球、隐藏滚动条和自动滚底符合 PRD。派发调用不出现在 Activity；派发失败及刷新后的错误展示由 `subagent-delegation-display` 验证。尚无可见文案时悬浮显示「我在思考中」且无文字流黑球；同一子任务连续多条消息均在首个可见字自动开云、文字流结束后黑球消失及 2 秒隐藏；同一消息的片段、快照和工具状态更新不重开，新消息重置周期、同组只有一个自动云、hover/focus 优先且历史不自动重播。长文字与黑球不越过云轮廓安全区域。修改归主回答且真实 UI 回退恢复磁盘。停止释放控制并保留文件；重启保留完成记录、未完成投影中断；续聊相同 agentId、新执行 ID，并使用新的网页输入。

#### `subagent-delegation-display`

- 测试类型：e2e / live；suite `run`，group `subagent`；serviceMode `real`，与浏览器生命周期用例共用文件。
- What：派发调用只显示助手行，成功及启动前失败均不进入 Activity，失败云与刷新后的历史错误一致。
- Why：隐藏通用工具记录后仍须看见失败原因，不能把派发失败误当作真实子执行。
- How：真实 UI 配模型、伙伴及完全访问权限，要求原样续接不存在的会话，执行生产 Store 校验；从真实失败事件读取原因并悬浮核对云，刷新后再次核对。随后自然语言请求创建一位助手核对简单数字，检查真实调用使用 agents/instruction、助手完成及成功记录无 Activity。无事件、状态或输出注入。
- Oracle：对齐 `WB-SUBAGENT-001-AC2`。失败只出现一个临时帮手行，云显示「我干失败了：」加实际错误，刷新保留原因；未产生真实子执行。成功调用使用新字段，出现真实助手及完成结果；派发不出现在 Activity。缺失错误的未知错误兜底由文案逻辑保证；已有目标重试去重由过程投影维护。

#### `subagent-prefix-cache-retain-live`

- 测试类型：e2e / live；suite `run`，group `subagent`；serviceMode `real`。
- What：同一持久子会话中断后新执行首次请求的前缀与真实缓存，以及子内部连续调用和父派发收口缓存。
- Why：SQLite 转录、恢复工具包/checkpoint 和续接追加不能改写既有模型前缀。
- How：发布时通过 `--target package` 在隔离安装的国内候选包执行；源码执行仅用于开发排查。真实 UI 配置模型、派发两项任务，复制现有排期/口径/备注/财务跟进 fixture 到临时资料目录，待续接任务依次核对排期、主负责人和财务执行动作。主伙伴只派发与汇总，不提前探测网页，完整转达各子任务的文件与网页核对要求。一个完成，另一个读完后进入真实待加载网页；同时取得子任务执行 `browser_use` 与页面请求证据后，通过 UI 停止并要求查询、续接原子会话，不能把其他网络访问当作子任务已进入待加载状态。相同模型/工作区短间隔续接，不填充提示或伪造输出/usage。真实本地页面只作输入，observer/只读 IPC 只取证。
- Oracle：对齐 `WB-SUBAGENT-001-AC10`。同 agentId、不同 childRunId；原任务/历史事实保留，最终交付正确且输入不变，完成清理子日志。每个完成的子任务及续接主任务至少有一对连续请求，逐对核对已有消息与工具前缀，并确认实际缓存复用；允许一轮调用多个读取工具。 每份资料从模型请求的工具消息正文取证，不再次 JSON 序列化，避免 Windows 路径转义影响匹配；证据须含完整或工作目录相对路径及真实正文锚点，允许通过文本工具或终端读取；交付仍须包含全部来源路径。比较中断前末次带完整 usage 请求与续接首次请求的工具及已有消息前缀，实际 cachedInputTokens 超过该子会话首次请求的 inputTokens，证明复用包含新增历史；前缀变化、usage 缺失或仅公共前缀命中失败。复用率为续接 cachedInputTokens / 中断前 inputTokens，85%为评估参考，记录首轮/末轮输入规模区分公共前缀和历史复用，不要求所有短请求达 85%。保留请求差异、主子关联、截图、usage 和人工评估。重启持久性由恢复 E2E 验证。

#### `subagent-approval-flow`

- 测试类型：e2e / live；suite `run`，group `subagent`；serviceMode `real`。
- What：子任务共用人工审批的来源、FIFO、允许/拒绝/指导、同实例继续，以及等待中的停止与恢复。
- Why：验证决定返回正确执行者、落盘前无副作用、界面恢复和旧审批失效。
- How：真实 UI 配置审核权限；各阶段建立独立伙伴和临时文件范围。用户给出两项 `agents` / `instruction` 参数，要求一次调用 `delegate_to_subagent` 原样传递具体命令、绝对路径及授权条件；第一项先用文本工具保存已授权文件，两项再各自调用 `terminal_run` 请求执行具体清理命令。每项只检查自己的目标目录及本任务保存文件，不读取其他任务文件；主伙伴只汇总结果和审批决定，不接管或重试清理。任务明确工具放行后命令会递归删除整个目标目录及其内容，当前尚未授权删除且可删除范围尚未确认，必须先由用户在人工审批卡确认，仅返回命令说明不算完成。不附带与操作冲突的保留要求。先确认实际派发、工具调用及真实审核进入两项等待，再通过 UI 允许/拒绝、指导/拒绝、切伙伴及刷新；另覆盖等待时停止和异常退出，续聊查询并继续原未完成子会话，创建新的执行实例来写文本报告。harness 保留刷新前真实事件/I/O，只读 IPC 取当前批次；模型、审核和审批结果均不注入。未进入人工审批时依据真实任务、调用和审核 reason 记录失败；等待两项审批期间发现目录已删除则立即失败，不计为审批交互通过。自动审核、规则直通、完全访问及异常转人工分支由 AI 回归覆盖。
- 补充验收：指导 placeholder 与可见来源均使用当前子伙伴名；下一批来源和草稿不串，单次选择不提交，最后明确提交整批。
- Oracle：对齐 `WB-SUBAGENT-001-AC8`、`WB-SUBAGENT-001-AC9`，以及 `WB-SUBAGENT-001-AC2` 的审批等待态。真实审核输入保留各子任务及命令 ID，不含工具的命令说明；人工卡片仍显示原操作说明。仅一个可操作批次，来源及指导 placeholder 准确；两项等待时主状态保持 waiting_approval（读取伙伴快照的 `run.status`），头像静止、云为「等待你审核操作」且无黑球。决定前目录未删除；允许后原 childRunId 继续、命令只执行一次，拒绝/指导不执行原命令；下一批不串来源并清空草稿。切换/刷新保留当前批次；停止清除等待、未执行命令且保留先前文件；重启旧审批失效、子任务中断，续聊相同未完成 agentId 的新执行实例。同步回归主审批 `approval-batch-flow` 和 `stop-running-or-approval-run`。

#### `ai-process-stream-and-final-answer`

- 测试类型：`e2e`
- What：智能模式真实发送后，验证 run 用时、过程记录折叠、Thought / Activity 过程层渲染与最终 markdown 收口（过程流主 case）。
- Why：重构后过程层是用户扫进度的主界面；需覆盖 Activity 折叠 header、展开平铺、加载/工具统一渲染，以及最终回答，而不是只断言“有过程块”。
- How：真实文件地址内准备带唯一事实的文件；先创建伙伴；用户通过 UI 发送自然语言总结请求，并明确要求用 `text_file_read` 读取工作区内一个不存在的文本文件，不能以终端存在性检查替代，使真实只读工具返回一次失败；run 运行期间检查已处理时间出现并递增，完成后检查固定用时、默认收起和最终回答可见；通过界面点击展开过程记录与全部 Activity 面板，采集 header / body 文案；加载项采用“加载 + 名称”的统一文案。成功正文读取可由文本或 Word 读取工具完成，不限定模型必须选择文本工具；缺失文本读取仍验证真实失败。
- Oracle：用户消息与 assistant 过程流逐步出现，对齐 `WB-COMPOSER-003-AC1`、`WB-COMPOSER-003-AC2`；用户与 assistant 消息不展示头像，用户消息右对齐气泡，assistant 过程流/最终输出与 composer 内容 rail 对齐，最终 markdown 无独立背景卡片，对齐 `WB-COMPOSER-009-AC1`、`WB-COMPOSER-009-AC2`、`WB-COMPOSER-009-AC3`、`WB-COMPOSER-009-AC4`。运行中过程流可见；“让俺想想”在 Brain 请求期间于过程区最下方展示，run 完成 / 失败 / 取消或产出正文后过程区不得仍挂着“让俺想想”，对齐 `WB-COMPOSER-003-AC3`。若本轮碰巧出现自动重试，仍不得与“让俺想想”同时出现；强制打出重试行、单行就地更新与 429 退避由 `llm-retry-process-row` 覆盖，对齐 `WB-COMPOSER-015`。决策层（Thought）短摘要可见且不暴露原始长推理，以正常正文色（#37352F）展示，运行中与完成后保持相同强调度，未超出单行时不展示折叠图标，超出单行时单行省略，hover 时展示展开图标且垂直居中于单行文本，展开后常驻浅灰卡片背景、折叠按钮居顶对齐第一行并在内部滚动，对齐 `WB-COMPOSER-003-AC5`、`WB-COMPOSER-009-AC10`。若本轮确有可见工具调用：至少一块 Activity（`details` + summary + 展开行）；summary 为工具独立维护的 header 短句汇总（可独立成句，不携带命令参数/路径/query，不得出现展开行半截连词如「查看页面并」），根据单一动作或混合工具精准呈现对应专属语义图标（询问用户使用困惑表情图标；浏览器打开/查看/操作/提取/截图/滚动/标签、网页抓取/搜索、图片读取/生成或工作流闪电图标；截取页面并读取图片的成对视觉动作统一呈现为照片图标，不退化为闪电；浏览器操作不产生审批卡片与展开行审核绿勾）；展开行为带对象的工具原句且不含冒号强调；若含 `read_image`：展开行含「读取图片」文案且按入参 `paths` 展示可点击缩略图（`workbench-read-image-thumb-*`），点击后打开与附件相同的 `ImageLightbox`；两次 Thought 之间的工具合并为 Activity，对齐 `WB-COMPOSER-003-AC6`、`WB-COMPOSER-009-AC5`、`WB-COMPOSER-009-AC6`、`WB-COMPOSER-014-AC5`、`WB-BLOCKER-001-AC8`。Header：按工具 UI 类型归并；同类多次为「短句 N 次」；归并后 ≤3 类用顿号 `、` 拼接（两侧无空格）；>3 类 summary 为「已完成 n 项」。若事件含 `load_toolset` / `load_skill`：展开行文案含“正在加载 / 已加载”，且不作为独立加载层；若含 docx 工具：展开行文案含“Word 文档”；对齐 `WB-COMPOSER-009-AC8`、`WB-COMPOSER-009-AC9`、`WB-COMPOSER-009-AC10`。文件名、query、命令、URL 和工具包或说明技能名不使用粗体或冒号强调，对齐 `WB-COMPOSER-009-AC7`。过程区不出现最终收尾等待文案（如“让俺收尾”），最终回答直接流式收口，对齐 `WB-COMPOSER-003-AC4`、`WB-COMPOSER-014-AC1`、`WB-COMPOSER-014-AC2`。证据引用与 terminal 状态规则仍由同域其他 case / AI suite 覆盖，本 case 保持 `WB-COMPOSER-003-AC8`、`WB-COMPOSER-003-AC9` 的过程流兼容边界（不因过程层重构破坏）。自动重试行由 `llm-retry-process-row` 覆盖；`WB-COMPOSER-014-AC3` 的截断提示和半截回答上下文边界、`WB-COMPOSER-014-AC4` 的计划进度环交互没有专门 UI 断言，见自动化覆盖边界。最终 markdown 围绕工作区事实（Alice/Bob）且不裸露 chain-of-thought，对齐 `WB-CORE-005`、`WB-CORE-006`。仅切换伙伴或新建干净对话时不得凭空出现“正在 / 已检索知识库”，对齐 `WB-COMPOSER-009-AC12`。

- Oracle：run 开始后过程内容出现前也显示「已处理」计时和分隔线，且运行至少 1 秒后用时递增；不足一分钟只显示秒数，不出现「0分钟」。完成后用时固定，且不足一分钟只显示秒数；运行中计时和 Thought 内容使用正常正文色；完成后「用时」文字及展开/收起箭头为中性灰色（#9B9A97），文字 13px、箭头 14px，Thought 保持正常正文色；Activity header 与展开面板内容保持灰色层级，已完成过程不整体降低透明度；过程默认收起。展开过程后 Thought / Activity 可见，再次收起不影响最终回答。对齐 `WB-COMPOSER-016-AC1` 至 `WB-COMPOSER-016-AC3`。
- Oracle：任何工具失败或部分失败时 Activity header 保持中性灰色层级（流光期间可使用正文色），header 失败文案可以保留；展开后具体失败工具行显示红色提示。

- Oracle：计时和数量文案中的数字与中文标签允许空白差异，仍检查秒数格式、计时递增、完成后固定用时以及准确的工具计数。

#### `queue-message-during-run`

- 测试类型：`e2e / live`
- What：真实模型读取资料期间从 Composer 追加消息，验证单一主按钮、浅灰待处理气泡、安全续接，以及交接后旧过程固定用时和消息显示顺序。
- Why：AI backend case 不覆盖 Renderer 输入、运行态单按钮切换、pending 气泡投影和 IPC 续接；发送草稿时停止入口暂时切换为排队发送，发送后必须恢复。
- How：在临时工作区创建三个文本输入，通过真实 UI 发送跨文件汇总请求；观察 `text_file_read` 开始后检查空草稿时唯一主按钮为停止，输入第一条消息后同一按钮切换为发送并提交排队，再输入第二条消息重复提交；确认每次清空草稿后按钮恢复为停止；等待原 run 正常结束及续接 run 完成，并检查原 user 气泡位于对应助手过程卡之前。记录真实模型、run 事件与最终回答。
- Oracle：原过程固定用时必须含数值及秒单位，中文标签与数字之间空白不影响判定。
- Oracle：任一时刻 Composer 仅有一个主按钮；空草稿时标签为停止，有可发送内容时同一按钮标签为发送；发送后草稿清空且标签恢复为停止。两条待处理消息都按 FIFO 显示为浅灰气泡且无编辑入口；续接使用第二条消息作为最新诉求并完成。初始 run 交接后原过程行显示固定“用时”，对应用户气泡排在其助手过程行之前。工具结果先于追加消息由 AI live `human-queued-message-safe-boundary-live` 覆盖；FIFO transcript、停止 / 中断后不自动启动由 unit `chat-run-service-contract` 覆盖，对齐 `WB-COMPOSER-017`、`WB-COMPOSER-006`。 已核对的具体验收：`WB-COMPOSER-006-AC1`。

#### `llm-retry-process-row`

- 测试类型：`e2e`
- What：受控 429 后过程区出现自动重试行：第一次为 `正在重试 1/5`，随后在同一行更新次数；运行中不得与“让俺想想”同时出现，也不得叠多行。
- Why：免费/共享额度模型会稳定打出 429；重试行叠层或与思考等待并存是用户可直接看见的过程层 bug，过程流主 case 不保证本轮出现重试。
- How：经 Settings 添加自定义模型，指向本地 OpenAI 兼容代理；代理对前两次 `chat/completions` 返回真实 HTTP 429，其后转发 live 上游。Workbench 选中该自定义模型并发送短请求；运行中持续采集过程区重试行数、次数文案与“让俺想想”是否共存，直至 run 完成。
- Oracle：必须见到 `正在重试 1/5` 且随后在同一行见到 `2/5`，对齐 `WB-COMPOSER-015-AC1`；任一时刻过程区最多一行“正在重试 / 重试失败”，对齐 `WB-COMPOSER-015-AC2`；重试行 running 时不得同时出现“让俺想想”，对齐 `WB-COMPOSER-015-AC3`、`WB-COMPOSER-003-AC3`。前两次 chat 为 429、第三次起转发上游；429 退避毫秒以及断网/`TimeoutError`/调用层 `TIMEOUT` 分类由 unit `llm-error-classification` 覆盖。run 完成后过程区不得再留“已重试 / 正在重试”，对齐 `WB-COMPOSER-015-AC4`。

#### `terminal-background-service-flow`

- 测试类型：`e2e`
- What：真实 AI 使用终端启动本地 HTTP 服务、让出控制权、通过内置浏览器验证页面。
- Why：终端后台服务、浏览器联动和进程清理的完整用户路径，静态事件或 fake tool result 无法覆盖。
- How：在真实临时目录创建带唯一标记的 HTML，经设置页添加为文件地址并创建伙伴；通过可见 Electron Workbench 发送请求，真实审批 terminal 命令，使用真实 PTY 启动 Python HTTP server，真实 browser_use 打开页面。
- Oracle：事件包含 terminal_command_yielded、terminal_run 和 browser_use；最终答复包含页面唯一标记；不存在 fake AI/tool/browser 信号。

#### `terminal-unicode-file-list`

- 测试类型：`e2e`
- What：终端在当前平台处理 Unicode 路径和文件列表。
- Why：中文路径是 macOS 与 Windows 用户的常见场景，编码错误会直接破坏终端任务。
- How：在真实文件地址创建 Unicode 文件名，通过真实终端读取目录并返回结果。
- Oracle：终端结果保留 Unicode 文件名，任务完成后无乱码或跨伙伴泄漏，对齐 `WB-TERMINAL-001`。

#### `run-navigation-snapshot-replay`

- 测试类型：`e2e`
- What：真实 AI 输出过程中切到 Settings，完成后回到 Workbench 能通过伙伴消息记录投影恢复过程流和最终 assistant 回答。
- Why：Workbench route 切换会导致 renderer 重新挂载；如果运行态只存在 renderer 内存中，用户离开页面后会丢失 AI 过程和最终回答。
- How：通过 UI 配置真实模型、创建伙伴，必要时添加文件地址；发送真实 AI 请求，等待过程流出现后切到 Settings；停留到 AI run 完成，再回到 Workbench 读取恢复后的过程流和最终回答。
- Oracle：切换后恢复目标历史、过程流、最终回答和自身运行态，上一伙伴状态不泄漏，对齐 `WB-SESSION-002`；run event 包含 `answer_completed` 与 `run_completed`，对齐 `WB-COMPOSER-003-AC7`。恢复后的用时基于同一 run 的持久化开始和结束时间，完成态过程默认收起，对齐 `WB-COMPOSER-016-AC3`。

#### `session-skill-memory-persistence`

- 测试类型：`e2e`
- What：同一伙伴的多轮 AI run 能复用已加载的工具包并继续上一轮任务主线。
- Why：续做不能丢失已有上下文，也不能每轮重复加载同一工具包。
- How：通过真实 Workbench UI 完成两轮请求，检查两轮 human steps、工具选择和最终结果。
- Oracle：第一轮加载 `docx-read` 工具包；第二轮不重复 toolset_loading 且能使用该工具包继续读取文档；两轮结果均完成，对齐 `WB-SESSION-005-AC1`、`WB-SESSION-005-AC2`。同一伙伴续做不自动丢掉还没压缩的历史原文，对齐 `WB-SESSION-005-AC3`。

#### `approval-batch-flow`

- 测试类型：`e2e / live`
- What：一个真实 Workbench E2E case 使用六轮 run 验证只读查询直通、AI 审核自动通过、AI 转人工后的同意/拒绝/指导，以及完全访问跳过审核。
- Why：审批是高风险 terminal 执行的用户确认边界；UI 误执行或误恢复都会破坏安全约束。
- How：使用真实模型与 Workbench UI，不注入或固定审核输出。同一个 case 依次运行六轮：审核权限下直接运行平台原生只读命令列出工作区一级名称（Windows 使用 PowerShell `Get-ChildItem`，macOS 使用 `ls -1`，不包子 shell）；按用户明确授权创建命名目录；分别在三个隔离临时目录内准备 `cache.tmp` 与 `keep.txt`，用户要求通过终端工具提交删除整个指定临时目录的命令，并明确当前尚未授权删除、需先在人工审批卡决定；收到拒绝或指导后不得替代删除；完全访问下写入文件。Windows 创建轮使用正斜杠路径传递给 PowerShell，避免模型转写长反斜杠路径时漏字符；删除命令按当前平台生成：Windows 使用 PowerShell `Remove-Item -LiteralPath <quoted-path> -Recurse -Force`，macOS 使用 shell `rm -rf <quoted-path>`。待审删除任务没有保留文件与整目录删除的矛盾要求；未实际提交预期命令或另走主动提问时保留证据并失败；同意与拒绝通过真实审批卡点选后按 Enter 确认，指导输入 Shift+Enter 换行并用 Enter 发送；检查输入采用 Ant Design 默认间距和标准单行高度、选项无尾部勾叉、键盘焦点无整行蓝色外描边，指导轮刷新会话并检查 Activity 恢复。完全访问轮若模型通过提问卡指出目标路径错误，E2E 选择实际 workspace 路径后继续，仍须确认真实文件写入且没有审核或审批。所有目标都位于本次 E2E 创建的临时 workspace 内。记录每轮 terminal command、`human.terminal_review` 输入/输出、reason、审批事件、决定事件、终端步骤及文件树快照。真实模型未发出预期命令、审核没有转人工或选择了其他分支时，case 失败并保留实际证据，不跳过该轮、不代为决定。
- 补充验收：覆盖选择后不提交或自动翻页、Enter 下一步与最终批量提交且不切换选择；输入复用全局 Ant Design Input 默认间距与单行高度，默认和悬停时无边框及阴影，点击聚焦时显示，失焦后隐藏；无尾部勾叉，选项键盘焦点无整行蓝色外描边，对齐 `WB-BLOCKER-001-AC9`；指导替代允许选择，清空指导后恢复未选；明确验证全部允许才执行、任意拒绝或指导整批零执行；对应伙伴名、长命令和窄宽度正确。
- Oracle：只读轮至少有一个 `terminal_step_started`，没有 `human.terminal_review` 调用、审批事件或审批卡，且 workspace 文件树和文件内容前后相同。创建轮的真实审核输出必须对实际 terminal command 返回 `auto_approve` 与非空 reason；允许命令附加只读核验，仍须实际执行指定创建命令、退出成功且仅新增命名目录；无审批事件/卡片。三个删除轮都必须有完成态 `human.terminal_review` 输出，decision 为 `needs_human_review`、reason 非空；decision 的 `commandId` 与审批项 `itemId` 对应，审批项命令与该轮要求执行的命令一致（Windows 可由 `powershell -NoProfile -Command` 透明包装，但命令体须逐字一致），并真实出现审批卡。卡片等待态及布局对齐 `WB-BLOCKER-001-AC1`、`WB-BLOCKER-001-AC2`、`WB-BLOCKER-001-AC3`、`WB-BLOCKER-001-AC4`、`WB-BLOCKER-001-AC6`。同意轮记录 `approve` 并执行待审命令，目标临时目录被删除且其余 workspace 文件树不变；拒绝轮记录 `reject`，待审删除命令未启动或执行（允许审批前只读核验），两份文件及内容保持原样；指导轮记录 `guide`、run 正常完成、没有执行删除命令，两份文件及内容保持原样，刷新后 Activity 中仍显示指导结果，对齐 `WB-BLOCKER-001-AC7`。审批决定文字须与实际 UI 动作相符。只读查询对齐 `WB-BLOCKER-001-AC13`；自动通过、人工决策后的影响范围和完全访问边界共同覆盖 `WB-BLOCKER-001-AC5`、`WB-BLOCKER-001-AC14`。AI backend case `hand-terminal-approval-batch`、`hand-terminal-ai-review-auto-approve`、`hand-terminal-ai-review-failure`、`hand-terminal-ai-review-incomplete` 继续覆盖稳定分类与失败回退契约。完全访问轮真实创建目标文件且没有审核调用、审批事件或审批卡片。记录模型、耗时、完成度评分和失败归因。
- Oracle：在发送前安装只读 DOM 观察记录 `正在审核终端命令` 是否出现；审核期间尚无 `terminal_step_started`；从审核到执行 / 人工等待 / 拒绝，同一命令只对应一个 Activity 工具项且只计一次，对齐 `WB-BLOCKER-001-AC15`。AI 自动通过和转人工结果、人工同意/拒绝/指导结果均显示在命令项下带内嵌竖线的审核结果区域；审核区域只对 AI / 人工审核产生，不展示内部 reason。审核期间流光动效只在 Activity header，展开后的命令行没有流光动效。刷新后过程与审核结论从持久化日志恢复，拒绝或指导显示「命令未执行」，不显示为工具执行失败。Activity header 在成功、失败和部分失败状态下均保持中性灰色层级（流光期间可使用正文色），展开后的失败工具行保留红色提示，对齐 `WB-COMPOSER-009-AC16`。

#### `stop-running-or-approval-run`

- 测试类型：`e2e`
- What：智能模式普通运行期间停止入口保持可用，并能取消普通长任务和审批等待；计划中的 doing 图标运行时旋转，停止后保留计划并暂停旋转；审批卡替代 Composer 时不提供普通追加消息输入。
- Why：用户需要可靠中断长任务；审批等待时停止若不能释放等待会造成运行态卡死。
- How：先发送真实长任务，在等待模型响应时立即停止，保留原停止入口覆盖。开启新会话后，请求真实模型建立并维护三步计划并执行资料分析长任务；等待真实 doing 计划事件，hover 进度浮层，读取图标动画及前后 transform 并截图；通过真实停止按钮取消后再次 hover，检查计划保留、动画暂停且无“进行中”状态文字，开启新会话后进度隐藏。随后在隔离 workspace 中准备 `cache.tmp` 和 `keep.txt`，要求通过 terminal 工具提交删除整个目录的命令，并明确当前尚未授权删除，需先在人工审批卡决定。使用真实模型和 UI，不注入审核结果；发送前安装只读 DOM 观察审核期间 header 与命令项的流光状态。任务要求一致；模型未提交操作而另走提问时保留证据并失败。只有收到当前 run 的 `approval_batch_required` 且审批卡可见后才点击停止；命令未进入审批等待或 run 已结束时立即以事件证据失败，不继续等待一个永远不会出现的审批卡。
- Oracle：真实计划含 doing；浮层 loading 在运行中实际旋转、停止后暂停且计划保留，无“进行中”状态文字；新会话清空进度，对齐 `WB-COMPOSER-014-AC4` 的三态展示、hover 与中断保留。运行中停止入口和取消反馈对齐 `WB-COMPOSER-006`（含 `browser_use`/Stagehand 执行中须立刻结束，对齐 `WB-COMPOSER-006-AC4`；清理中唯一主按钮转圈且禁用，对齐 `WB-COMPOSER-006-AC5`；等待模型首个 token 时停止须立刻 `user_cancelled`，对齐 `WB-COMPOSER-006-AC6`），伙伴运行标记对齐 `WB-SESSION-002-AC5`；用户停止后 run 标记为 `user_cancelled`，后续消息只靠日志继续，对齐 `WB-SESSION-007-AC1`；取消后用时停止递增、过程默认收起且仍可展开，对齐 `WB-COMPOSER-016-AC2`；审批等待时普通输入框和 Composer 主按钮均不存在，且不显示「需要你的协助」，对齐 `WB-COMPOSER-017-AC4`、`WB-SESSION-014-AC1`。真实审核期间 Activity header 有流光，展开命令项没有流光；取消审批 run 后清除等待卡和运行态，待审删除命令没有 `terminal_step_started`，`cache.tmp` 与 `keep.txt` 均原样保留，对齐 `WB-BLOCKER-001-AC10`。 已核对的具体验收：`WB-COMPOSER-006-AC2`、`WB-COMPOSER-006-AC3`。

#### `interrupted-task-resume-flow`

- 测试类型：`e2e`
- What：同一伙伴中的任务因达到 Graph 运行上限等原因中断后，从不可变消息日志恢复，并在用户后续消息中继续原任务。
- Why：恢复能力必须经过真实 Workbench、真实模型、Main 进程、持久化和 Renderer 的完整链路验证，不能只依赖 Mock LLM。
- How：真实模型 E2E 把首轮 Graph 上限降为 2，验证上限错误后发送继续语句；第二轮恢复正式上限并完成。Backend 覆盖日志投影、相同 `tool_call_id` 修复、计划投影、`compaction_checkpoint` 边界、重启标记、跨伙伴隔离、编辑和删除。
- Oracle：全部中断原因均可只靠日志继续；恢复语句只追加一次，历史 user 配置不变；未压缩时为历史过程 + 尾部新 user，已压缩时为 Compact User + 还没压进摘要的原文（可空）+ 尾部新 user；连续多次恢复不递归嵌套原始任务；切换伙伴或重启后只投影所属日志；编辑只撤回目标 user、关联 assistant/run 和该 run 全部日志，不回滚已写文件；正常完成清空计划但保留日志；真实模型首轮显示“已达到运行上限，可继续对话推进”且第二轮恢复完成；失败气泡短标题 +「查看详情」保留原文，对齐 `WB-SESSION-007-AC1`、`WB-SESSION-007-AC2`、`WB-SESSION-007-AC3`、`WB-SESSION-007-AC4`、`WB-SESSION-007-AC5`、`WB-SESSION-007-AC6`、`WB-SESSION-007-AC7`、`WB-SESSION-007-AC8`。

#### `cancelled-run-keeps-artifact`

- 测试类型：`e2e`
- What：文件修改已经落地后取消运行，终态不展示取消或失败内容，但仍保留修改文件入口和审核模式。
- Why：取消只应停止后续 AI 执行，不能隐藏已经发生的文件修改，否则用户无法检查和回退副作用。
- How：真实 AI 使用 `text_file_edit` 修改 Markdown，随后执行真实的 60 秒终端等待以保留停止操作窗口；只读等待源文件内容实际更新后点击停止，再打开本轮修改记录。
- Oracle：assistant turn 不显示失败气泡或“已取消”正文，Activity 不残留「等待用户处理」；修改文件入口仍存在，文件内容已经更新，文本审核模式可打开；对齐 `WB-BLOCKER-001-AC10`。

#### `browser-use-task-panel`

- 测试类型：`e2e`
- What：AI 通过内置浏览器完成网页任务时，文件 / 多浏览器 Tab、独立页面导航、持久站点数据和真实网页操作结果形成闭环；并验证 `observe → act(actionId)`（含文本输入和 hover 后出现的退出入口）。
- Why：内置浏览器是 Electron 与 AI run 深度联动场景，仅 backend 或静态事件无法覆盖视口嵌入、导航和最终收口问题；Stagehand 需以 observe 规划、actionId 确定性执行为主路径，且支持文本输入直接注入。
- How：先打开真实 Markdown 文件，再让 AI 使用 `browser_use` 操作本地测试页（在操作备注输入框输入内容 + 诱饵角色切换 + hover 消息图标才出现「退出登录」）；AI Run 仍在进行时，用户通过 `+` 新建另一个浏览器标签并折叠右栏，验证后续 observe / act / extract 在后台继续操作原目标；任务完成后展开右栏并切回 AI 浏览器标签，再切换文件和浏览器检查状态保持。observe/act 必须走按 Tab 挂上的本机 CDP 桥，而不是应用自己打开的进程级调试口。
- 补充验收：追加真实网页人工协作场景：模型打开既有本地页面后发起无选项提问；等待期间通过原生鼠标事件点击页面真实“用户确认”按钮，再在卡片回复；页面正文以“协作确认结果”明确标注反馈，模型重新提取该实际结果后继续。使用真实 UI、真实页面和真实模型，不依赖外部验证码、不增加模拟路径。
- Oracle：`navigate` 结果含 `tabId`；后续 observe/act 必带该 `tabId`；成功 `navigate` 给模型拆成 Title / URL 而不是一行 Page；`act` 使用 `actionId`，支持输入类动作注入 `text` 参数；observe actions 含 `actionId/method/description/arguments/selector`；折叠期间原浏览器 `webContents` 不销毁且 AI 能完成输入、hover 与退出，展开后同一个 `webContents.id` 直接显示最新包含退出口令与备注内容的 `LOGOUT_OK_*` 结果；操作期间光标常驻且仅在 AI Run 结束时释放隐藏；对齐 `WB-PANEL-004`、`WB-PANEL-004-AC10`、`WB-PANEL-004-AC13`、`WB-PANEL-004-AC18`。Playwright 驱动 Electron 窗口自带的调试口不作为本 case 失败条件；应用启动不得 `appendSwitch('remote-debugging-port')` 由 unit `cdp-endpoint-service` 守住。

#### `browser-view-lifecycle`

- 测试类型：`e2e`
- What：内置浏览器原生视图在初次显示、面板折叠、原生自绘菜单、伙伴切换以及分栏拖拽调整后仍可见、尺寸稳定且持续运行，包括切走的伙伴面板同样处于展开状态后切回的呈现恢复。
- Why：`WebContentsView` 由 Main 管理并覆盖在 Renderer 上方；生命周期或 bounds 同步错误会导致白屏、原生视图遮挡菜单、恢复后尺寸跳变，或切换伙伴时误销毁仍在运行的网页。分栏拖拽期间高频更新 bounds 会导致 Windows DirectComposition 下原生视图原点跑偏且旧画面错位遮挡对话区，松手时的 CSS transition 补间动画会导致半秒滞后。分栏拖拽期间采用静态快照占位并阻断高频 bounds，松手瞬时无补间对齐并恢复原生 View，确保拖拽期间平滑跟手、松手无缝切回。伙伴切换后浏览器呈现依赖 `contentPanelCollapsed` 值变化触发的恢复，若前后两个伙伴面板均展开（值不变）会漏掉重新呈现，表现为地址栏正常但网页白屏。`setBounds` 在 bounds 未变时跳过 `applyAllVisibility`、或后台加载完成后挂载未强制重绘，也会出现同样白屏；此时加号 / 三点菜单还可能因 `WebContentsView` 抢焦点被立刻关掉。
- How：通过 Settings UI 添加文件地址并创建伙伴；在 Workbench UI 新建浏览器 Tab，导航真实本地网页；通过可见地址栏发起延迟 HTTP 导航，折叠后才释放响应，验证隐藏时完成导航；折叠、切换伙伴后验证运行期状态，再正常重启同一用户目录，验证 URL、历史和缩放恢复；最后分别通过关闭 Tab 和原生确认子窗口删除所属伙伴销毁浏览器。伙伴切换分支覆盖两种路径：新建伙伴（面板默认折叠）后切回，以及切到面板已展开的伙伴后切回，并直接断言主窗口 `contentView.children` 原生挂载计数恢复到 1 而非仅依赖像素采样。
- Oracle：运行期折叠或切换伙伴不销毁 WebContents；无论切走的伙伴面板是否展开，切回后同一 `webContents.id` 必须重新挂载到主窗口并恢复显示；重启后重新创建 WebContents 并恢复 URL、历史和缩放，但不要求表单、滚动内存或 JS 连续；关闭 Tab 或删除所属伙伴后状态清理；地址栏右侧“将打开外部浏览器”按钮可见且更多菜单不再含系统浏览器入口，对齐 `WB-PANEL-001-AC5`、`WB-PANEL-004-AC8`、`WB-PANEL-004-AC14`、`WB-PANEL-004-AC12`。

#### `browser-navigate-error-page`

- 测试类型：`e2e`
- What：地址栏输入什么协议就打开什么；裸主机只补 https 且失败不改 http；写明 http 能打开真实页；写明 https 失败停在馆长统一错误页并展示 Chromium 错误码、保留 tabId；加载中地址栏底边可见进度线，错误页出现后进度线淡出；AI `navigate` 等到真实内容再成功，失败把 `Error` 与 `tabId` 一并返回。
- Why：用户倾向访问啥就是啥，不自动 https→http。WebContentsView 不会画出 Chrome 外壳那张 `chrome-error://` 页；主框架 `did-fail-load` 必须落到同一张馆长错误页，底部是 Chromium 给出的真实 `ERR_` 码，不能停在白屏。
- How：启动只提供 HTTP 的本地页面。Workbench 打开浏览器 Tab：地址栏只填 `127.0.0.1:端口/path`，确认停在 https 错误页且没有改成 http；再填明确 `http://…` ，加载中可见浅蓝色底线，等到页面口令出现；再对同一 http 地址走 AI `navigate` 与 `screenshot`（Stagehand 连本机 CDP 桥）；另一次写明无法解析的 https 主机，确认错误页标题为「无法访问此站点」、含「无法加载」与 Chromium `ERR_` 错误码、地址栏仍是 https、工具失败含 `tabId`。页面第一屏故意空白、约 1.5s 后再出标题和输入框，覆盖验证页等待。
- Oracle：裸主机保持 https 并出现错误页，对齐 `WB-PANEL-004-AC15`；明确 http 打开含口令的页并对齐 `WB-PANEL-004-AC9`；加载中可见地址栏底边浅蓝色进度线，错误页出现后进度线必须淡出，对齐 `WB-PANEL-004-AC19`；对该 Tab 截图成功即证明 Stagehand 走按需 CDP 桥，对齐 `WB-PANEL-004-AC10`；明确 https 失败无 `chrome-error://`，错误页为馆长统一 Chrome 式「无法访问此站点」页并含 Chromium `ERR_` 错误码，对齐 `WB-PANEL-004-AC16`；AI `navigate` 成功含 `tabId` 与最终 http URL，失败含 `error` 与同一 `tabId`，对齐 `WB-PANEL-004-AC17`、`WB-PANEL-004-AC18`。Playwright 驱动窗口会自带 `--remote-debugging-port`，不作为本 case 失败条件。

#### `browser-navigate-cnipa-https`

- 测试类型：`e2e`
- What：地址栏打开 `https://epub.cnipa.gov.cn/` 时保持 https，失败或超时时画出馆长错误页，不自动改 http。
- Why：这是会掐 https 或长时间转圈的真实站点；去掉协议降级后，用户必须看到错误页而不是白屏进度条。
- How：Workbench 打开浏览器 Tab，输入明确 https 地址，加载中可见浅蓝色进度线，等到错误页或真实首页，且地址栏仍是 https。明确 http 的产品链路由 `browser-navigate-error-page` 的真实本地页面验证；专利站公网 http 首页没有应用链路自动化证据。
- Oracle：最终 URL 仍是 https，不是 `chrome-error://`，不是自动改成的 http；若打不开则出现馆长「无法访问此站点」页（底部为 Chromium `ERR_`）且进度线淡出，对齐 `WB-PANEL-004-AC15`、`WB-PANEL-004-AC16`、`WB-PANEL-004-AC19`。

#### `web-read-from-search-result`

- 测试类型：`e2e`
- What：真实 AI 用 `web_search(type=search)` 搜索 DeepSeek 融资，并用 `type=fetch` 读取最相关网页正文后总结。
- Why：搜索必须落到网页正文证据上；必须守住 search → fetch 的真实网页信息闭环。
- How：通过 Settings UI 添加空文件地址并创建伙伴、配置真实模型，不依赖文件资料索引；在真实 Workbench UI 发送约束型提示：只搜索一次、只 fetch 一条最相关新闻链接后总结；等待真实 AI run 完成；按 toolCallId 分别关联 `web_search` 的 search/fetch 输入和结果。正式包经系统真实入口启动，记录实际程序路径、版本、进程及工作目录，验证后台 sidecar 不依赖父进程工作目录。
- Oracle：run 完成；至少一次 `web_search(type=search)` 的 query 包含 DeepSeek，且该 search 调用返回 `ok=true` 和非空搜索结果；至少一次 `type=fetch` 返回 `ok=true` 且正文非空，不能用 fetch 成功替代 search 成功；最终回答使用网页事实；运行期间右侧不得出现搜索列表面板（该面板已不存在），对齐 `WB-CORE-007-AC4`；本 case 只验证搜索与读取成功链路；失败边界和严谨偏好限制见 §6 自动化覆盖边界；不出现 fake 信号。 已核对的具体验收：`WB-CORE-007-AC1`。

#### `web-read-direct-url`

- 测试类型：`e2e`
- What：用户直接给 URL 时，真实 AI 使用 `web_search(type=fetch)` 读取网页正文，并回答正文中的唯一口令。
- Why：直接 URL 读取是网页阅读的最小闭环，不能退化成浏览器点击任务或只复述 URL。
- How：通过 Settings UI 添加空文件地址并创建伙伴、配置真实模型，不依赖文件资料索引。启动真实本地 HTTP 页面，初始 HTML 没有正文，由 JavaScript 请求正文接口后渲染本次唯一口令；通过真实 Workbench UI 要求 AI 读取该 URL 正文；等待真实 AI run 完成。不注入模型结果，不直接调用抓取 IPC，不绕过生产 HTTP → 浏览器抓取流程；正式包经系统真实入口启动。
- Oracle：run 完成；与该 URL 的 fetch 调用关联的结果 `ok=true` 且正文包含本次唯一口令；本地服务记录正文接口被浏览器请求，证明抓取进程完成真实渲染；不调用 `browser_use`；右侧不得出现搜索列表面板（该面板已不存在），对齐 `WB-CORE-007-AC4`；不出现 fake crawl / fake AI 信号。

### 5.3 `result`

#### `image-generation-preview-and-revert`

- 测试类型：`e2e / live`
- What：真实 AI 根据用户请求生成 PNG 图片，用户可以从修改入口预览并回退删除该图片。
- Why：工具级转码成功不能证明真实模型会使用图片生成工具包，也不能证明最终图片能进入 Workbench 的预览和回退闭环。
- How：通过真实 Workbench UI 请求 AI 在文件地址内生成指定文件名的简单 PNG；等待 run 完成后打开修改入口，检查图片预览，再执行统一回退确认。
- Oracle：真实调用 `image_generate` 且输入只有 `outputPath/svg`，正式文件具有 PNG 签名，对齐 `WB-IMAGE-001-AC1`、`WB-IMAGE-001-AC2`；assistant 修改入口、右侧预览和新建文件回退删除对齐 `WB-APPLY-002-AC7`、`WB-APPLY-003-AC7`。自动创建/更新由 AI `image-generate-format-create-update-contract` 覆盖 `WB-IMAGE-001-AC3`，失败无副作用由 `image-generate-safety-and-boundary-contract` 覆盖 `WB-IMAGE-001-AC4`。

#### `image-generation-update-preview-and-revert`

- 测试类型：`e2e / live`
- What：真实 AI 更新已有 PNG 后，Workbench 直接预览最终图片并可回退恢复原始 bytes。
- Why：新建图片回退删除不能证明已有图片的首次写入前快照和恢复链路正确。
- How：先在临时文件地址放置有效 PNG，再通过真实 Workbench UI 请求 AI 更新同一路径；检查更新结果和图片预览，执行统一回退后重新读取文件。
- Oracle：真实调用 `image_generate`，目标图片产生修改 Artifact，最终文件地址只交付目标图片；更新后正式文件变化且仍为 PNG；右侧直接预览且没有 Diff 切换；回退后 bytes 与原图完全一致，对齐 `WB-IMAGE-001-AC2`、`WB-APPLY-002-AC7`、`WB-APPLY-003-AC7`。

#### `file-preview-actions`

- 测试类型：`e2e`
- What：右侧普通文件预览态、“全部 / 本次运行改动”文件模式、稳定选中态、多个文件 Tab、定位文件、系统打开方式下拉、PDF 命中定位、Markdown / 纯文本预览，以及 Excel 只读预览。
- Why：右侧面板是用户消费引用结果和打开文件的主要区域，预览布局错误会直接阻断阅读。
- How：创建伙伴并添加文件地址后，从文件列表连续打开真实 pdf、docx、md、txt 文件；检查预览内容和工具条；展开打开方式菜单，确认触发系统关联应用查询、存在默认应用标记和至少一个系统返回的 Handler；docx / xlsx 在打开方式含 WPS 时工具栏问号可见，pdf / md / txt / xlsm 不可见；确认产生四个文件 Tab，再切回 Markdown Tab；从文件列表打开 `xlsx/xlsm/xltx/xltm`，关闭保持展开的悬浮文件列表后，对 `xlsx` 尝试进入单元格编辑并输入，用原生复制核对内容仍保持原值，再切 Sheet 和拖列宽。在隔离工作簿加入无缓存及过期缓存公式，通过组件只读权限保留选区与复制，使用真实网格选中与复制读取显示结果，包含零值和跨 Sheet 引用。工作簿同时包含足够的行，通过真实鼠标拖选 C17:C20，检查 AI 引用浮层可见且位于预览内，输入想法后添加到 Composer，核对工作表、范围和四行快照；滚动后从 Composer 回跳编辑并删除引用，再切 Sheet 验证单格引用入口。只读读取 DOM 区分表格主画布与内嵌文字编辑器画布，不用任意第一个 canvas 作为网格。
- Oracle：加号文件标签、目录懒加载、PDF 命中定位、Markdown / UTF-8 文本预览、Excel 只读且可浏览、选中态、面包屑、系统打开方式与工具栏行为整体对齐 `WB-PANEL-003`、`WB-EXCEL-002-AC1`；WPS 问号说明及点击直达专项手册对齐 `WB-PANEL-003-AC22`；各文件分别保留且旧 Tab 可恢复；从“打开文件”选择器选中文件后选择器 Tab 被文件 Tab 原位替换、不残留，对齐 `WB-PANEL-001-AC1`。目录打开刷新由 `workspace-file-explorer-open-refresh` 覆盖。普通预览 FORCED 计算无缓存与过期缓存公式，结果显示准确，打开预览不写回源文件。多行区域和跨 Sheet 单格都能显示 AI 引用入口，确认后范围与快照准确，滚动后 Composer 回跳、编辑和删除可用；对齐 `WB-DOCUMENT-REFERENCE-002-AC1`。

- 默认应用补充验收：应用行名称实际绘制在行内且不被裁掉，应用较多时列表滚动且底部设置与文件夹入口仍在浮层可见范围内，应用行仅本次打开，生效应用仅显示“默认”，无逐行设置按钮；经“默认打开应用…”进入同一浮层选择页，标题可返回，选择只保存偏好并返回列表，不触发外部打开，选择“使用系统设置”清除偏好；不常驻显示扩展名及生效范围说明。通过真实菜单设置默认、一次性打开、恢复系统设置，跨 Tab／伙伴及重启恢复，覆盖 WB-PANEL-003 的馆长偏好规则；应用失效与查询失败按真实环境人工补验，不注入系统关联。

#### `workspace-file-explorer-open-refresh`

- 测试类型：`e2e`
- What：无文件目录时统一空态与设置跳转、返回后的伙伴/草稿/资源 Tab 恢复、已配置空目录提示，以及文件列表打开/焦点刷新；常驻与悬浮列表右键新建/重命名、单框命名、持久选择与外部取消、删除确认与回收站、删除后停止文本保存。
- Why：列表若继续使用挂载时缓存，用户在资源管理器或 AI 写盘后打开列表会长时间看不到新文件；同时若收起时仍因焦点/Run 后台刷目录，会造成无谓 IO。新建还须保证 Office 文件有效且不覆盖同名文件，删除须防止延迟自动保存重建。
- How：使用独立空模型目录，不复用 runner 的已安装向量模型缓存；无文件地址且未下载向量模型时，通过 UI 创建两个伙伴，在第二个伙伴填写草稿并新建“打开文件”Tab；检查全宽统一空态，点击“前往设置”进入工作空间文件页，通过系统目录选择器添加真实临时空目录，点击“返回工作台”检查原伙伴、草稿、活动 Tab 与空目录提示；测试进程写入种子文件，打开文件后依次写入新文件，再展开列表验证刷新。列表收起时模拟窗口失焦/聚焦并断言 `workspaceDirectoryList` 调用数不增加，展开时模拟焦点确认刷新。最后从普通文件预览跳到设置，通过 UI 移除目录，返回后检查预览仍在且悬浮文件列表复用统一空态。在同一 case 的真实临时目录，通过右键菜单分别创建 DOCX/XLSX/PPTX/自定义后缀，读取实际 OOXML 包检查空白内容结构；准备真实子目录，通过目录右键验证创建位置及输入行顺序；文件右键检查新建/重命名/删除，并通过文件的新建子菜单验证在其所在目录创建，并验证关闭菜单后持续高亮、未选中行无 hover 背景和外部点击清除选择。通过原行重命名，等待提交完成后清除旧文件名筛选，再确认文件内容、旧路径消失、重名不覆盖与打开 Tab 的标题/预览路径更新。常驻与悬浮列表分别检查不自动打开、不切换活动 Tab 和预览；验证重名与非法名称的提示、Escape/外部点击取消及筛选清空，并断言选择类型后主/子菜单完全关闭。通过真实 UI 打开新建文本、编辑后确认移到回收站，等待超过自动保存延时并切换 Tab，确认文件不被重建。选择根文件从常驻切到悬浮列表后，检查目录展开、筛选和选中状态保持；连续打开两份文件检查列表不关闭且两份预览均可用，对齐 `WB-PANEL-003-AC13`。所有被测创建、重命名、编辑与删除均通过 UI，不直接调用写入 IPC。
- Oracle：无目录统一引导和设置往返对齐 `WB-PANEL-003-AC23`；打开/展开时焦点刷新对齐 `WB-PANEL-003-AC13`。菜单显示 `Word / Excel / PPT / 其他文件`，不显示中文类型说明或后缀；四种类型、三种目录定位、常驻/悬浮右键对齐 `WB-PANEL-003-AC24`；行内命名、重名/非法输入、取消对齐 `WB-PANEL-003-AC25`；真实 Office 结构有效、新建后原 Tab/预览保持且列表可见对齐 `WB-PANEL-003-AC26`；删除取消、确认后的磁盘移除与列表更新对齐 `WB-PANEL-003-AC27`；删除已编辑文本后显示已删除且延迟/关闭不重建文件对齐 `WB-PANEL-003-AC28`；持久选择/清除、菜单与统一图标对齐 `WB-PANEL-003-AC30`；原行重命名、重名不覆盖、Tab/预览更新与旧路径不重建对齐 `WB-PANEL-003-AC31`。输入法组词、切换工作目录期间取消、回收站失败保留弹窗与重试、AI 历史审核快照保留列入本 case 人工验收边界；主进程路径范围/排他创建与失败无永久删除由 Unit `workspace-root-containment-contract` 补证，编辑保存拒绝重建由 Unit `text-file-write-service` 补证。

#### `file-preview-external-change-auto-refresh`

- 测试类型：`e2e`
- What：右侧实时预览的当前文件被外部程序保存后自动刷新；该行为覆盖所有支持预览的文件类型，不只限文本或文件地址根目录文件；切换、关闭或进入审核 Diff 后停止旧监听；普通文件通过外部应用打开时不显示 AI 修改提醒。
- Why：用户可能同时使用 WPS、Word 或文本编辑器修改文件，Workbench 必须及时展示磁盘最新内容，同时不能让旧 Tab 的监听干扰当前预览。
- How：创建空的真实临时文件地址并通过 UI 打开 DOCX、PPTX 和 XLSX，不把知识库索引作为预览前置；测试进程对每个当前文件执行真实写入，并等待对应预览重新加载，其中 DOCX 验证新正文内容、PPTX 验证新渲染图、XLSX 验证新工作簿加载完成。另通过真实附件链路把 DOCX 保存到 `userData/partners/{id}/runtime/assets`，在修改记录切至预览模式后执行外部保存并等待真实文件重载；切回审核 Diff 后再保存，确认快照不被刷新。随后切换和关闭 Tab，再修改旧文件；外部应用打开使用仅在 E2E observer 环境生效的 no-op 启动开关，仍走正式关联应用查询和 IPC 成功分支。Markdown 与 TXT 的"编辑中外部保存"冲突行为由 `markdown-editor-edit-save` / `plain-text-editor-edit-save` 覆盖，本 case 不再断言其"已自动刷新"提示。
- Oracle：连续保存只显示一次“检测到当前文件被外部修改，已自动刷新”，DOCX、PPTX、XLSX 均展示或加载最终磁盘版本；文件地址和 `userData/partners/{id}/runtime/assets` 路径中的预览模式均监听真实当前文件，审核 Diff 固定为历史快照；这些类型代表 `WB-PANEL-003-AC18` 所列的不可编辑预览格式共用的监听和重载链路。仅文件内容变化才提示；切换、关闭或进入审核模式后旧监听不再触发提示；普通文件打开外部应用不显示重新打开提醒，对齐 `WB-PANEL-003-AC18`、`WB-PANEL-003-AC19`。

#### `markdown-editor-edit-save`

- 测试类型：`e2e`
- What：右侧打开真实 Markdown 文件后直接进入即时渲染（IR）编辑态，无工具栏/操作按钮；点击任意位置输入文字并实时渲染，编辑后无需保存按钮自动落盘；点击 `https` 链接触发 `openExternal`；空闲时外部保存自动重载，编辑中外部保存被自动覆盖；编辑区撑满面板无右侧灰色残留；标题前不显示 H1/H2 等标题级别标签（Vditor 默认 `::before`）与 `#`/`##` 等标题源标记、标题无下划线；拉宽窗口后页面不白屏。
- Why：即时渲染点击即编辑与自动保存是该产品能力核心，任何渲染、保存或外部覆盖分支错误都会导致内容丢失或磁盘不一致；编辑区布局、标题标签/标记与窗口缩放稳定性影响核心编辑体验；链接点击打开是 Markdown 阅读可用性的基础。
- How：使用空临时文件地址创建本用例所需 Markdown，不准备无关文件或向量索引（含标题、段落、链接、代码块），从文件列表打开，通过工具栏按钮关闭保持展开的悬浮文件列表；确认编辑器无工具栏且内容渲染为排版；点击段落输入追加文字，等待约 500ms 后读取磁盘校验已自动落盘且编辑区实时渲染；点击 `https://example.com` 链接，断言观测到 `openExternal` 调用且 payload 为该 URL；空闲时测试进程外部写入文件，确认编辑区自动重载为外部内容；编辑中输入新内容后外部写入文件，等待自动保存，确认磁盘为本地新内容（纯覆盖，无冲突提示）；另打开空 Markdown，确认编辑区可见，实际输入文字并验证自动落盘；测量编辑区宽度与父容器宽度一致（无灰色残留）；点击标题后确认 `.vditor-ir__marker--heading` 保持隐藏、标题 `::before` 计算样式 `content` 为 `none`（无 H1/H2 标签）；通过 Electron `setSize` 拉宽窗口后确认根节点仍在且编辑器仍可见（不白屏）。
- Oracle：Markdown 打开即 IR 编辑态，无保存按钮/工具栏/未保存标记；输入自动落盘，磁盘字节与编辑结果一致；点击 https 链接调用 `openExternal`，对齐 `WB-EDIT-001-AC2`；空闲外部写入自动重载、编辑中外部写入被自动覆盖，对齐 `WB-EDIT-001-AC1`、`WB-EDIT-001-AC4`、`WB-EDIT-001-AC5`；AI 修改记录「审核」态仍为只读 Diff，切入「预览」后可编辑文本进入编辑态，对齐 `WB-EDIT-001-AC7`；保存不产生 AI 修改记录，对齐 `WB-EDIT-001-AC8`；编辑区宽度等于父容器宽度且背景为白（无灰色残留）；标题前无可见标题级别标签与标题源标记、标题无下划线，对齐 `WB-EDIT-001-AC9`；拉宽窗口后页面保持存活不白屏。

#### `markdown-editor-image-preview`

- 测试类型：`e2e`
- What：右侧打开含相对路径本地图与失效图的 Markdown 后，存在的本地图正文可显示；双击好图打开 `ImageLightbox`；双击失效图不打开预览并出现「图片无法加载」toast；保存后磁盘源仍保留原相对路径。
- Why：微信导出等真实 Markdown 常用相对图片路径；若只挡双击而不解析路径，预览能力不可用；若继续用 Vditor 默认白底预览，失效图会出现空白破图层。
- How：在空临时文件地址仅写入本用例的 1×1 PNG 与 Markdown，不准备向量索引（`![](./media/preview-ok.png)` 与缺失相对路径图）；从文件列表打开 Markdown，并通过工具栏按钮关闭悬浮文件列表；等待好图 `img` 加载且 `src` 为 `blob:`；双击好图断言出现附件预览 modal（关闭/下载按钮）且无 `.vditor-img`；双击失效图断言无 modal、页面出现「图片无法加载」文案；读取磁盘 Markdown 确认仍含 `./media/preview-ok.png`。
- Oracle：相对路径图可显示且双击进 `ImageLightbox`，对齐 `WB-EDIT-001-AC11`、`WB-EDIT-001-AC12`；失效图双击 toast 且不进预览，对齐 `WB-EDIT-001-AC13`；磁盘源路径不被改写，对齐 `WB-EDIT-001-AC11`；`http(s)` 可直接显示见 `WB-EDIT-001-AC14`。

#### `plain-text-editor-edit-save`

- 测试类型：`e2e`
- What：右侧打开真实 TXT / JSON / 代码等 UTF-8 文本后直接进入纯文本编辑框，输入与保存一致、不 markdown 化改写，编辑后自动落盘；保存保留 CRLF 与 UTF-8 BOM；编辑框每行前显示行号。
- Why：普通用户也会编辑纯文本文件，若被 markdown 化改写或丢失换行/BOM 会造成内容损坏；行号是纯文本查看与定位的基础。
- How：用空的真实临时文件地址创建带 BOM 的 CRLF TXT 文件与 JSON 文件，不创建伙伴，也不把知识库索引作为编辑前置；打开后确认文本左侧 padding 区域显示 1/2/3… 行号且文本框可编辑；输入追加内容，等待约 500ms 后读取磁盘 bytes 校验内容一致、换行仍为 CRLF、BOM 保留；再对 JSON 文件编辑，等待自动落盘并确认无 markdown 语法改写。
- Oracle：纯文本编辑框不渲染 markdown 结构（`#`、`**` 保持字面量），编辑后自动落盘且磁盘字节与编辑结果一致并保留 CRLF/BOM，对齐 `WB-EDIT-001-AC3`、`WB-EDIT-001-AC4`、`WB-EDIT-001-AC6`；每行前显示从 1 开始的行号，对齐 `WB-EDIT-001-AC10`。

#### `text-file-apply-preview-and-revert`

- 测试类型：`e2e`
- 模式入口补充：在审核切到真实预览后，重复点击对话中的同一修改入口，必须重新打开当前批次审核且不新增 Tab；从悬浮列表选择当前修改文件进入审核后保持列表展开，对齐 `WB-PANEL-003-AC13/AC14`。
- What：同一个 Markdown 文件打开即进入编辑态并展示最新内容，AI 运行完成后无需点击修改项即可出现预览/审核切换且保持阅读位置，同时显示非零修改数量，切换伙伴再切回后不点击仍保持真实数量，在 AI 修改记录中使用独立文本 diff，并能恢复原始 bytes。
- Why：编辑态和修改预览是两种不同语义；如果共用文件渲染器，用户看不到本次具体增加和删除内容；伙伴切换后的数量恢复不能依赖用户点击触发补算。
- How：先打开 Markdown（进入编辑态）；再通过真实 AI 调用 `replaceAll` 和 `edit` 修改该文件，等待 run 完成但不点击修改项，确认 assistant 修改列表已经显示非零 `+/-` 数量；检查编辑态静默刷新为最新内容、原 Tab 和文档视图保留，新增切换入口但仍在预览；从“全部”重新打开该文件确认带切换入口，再切审核检查 Diff；保持审核并发送不修改文件的后续提问，确认该历史批次不会被新运行清空；切换伙伴再切回，不点击修改项确认数量仍为非零；再点击 assistant 修改入口检查 `TextFileDiffViewer`、工具栏没有独立定位按钮且系统应用下拉包含“打开所在文件夹”；通过 E2E no-op 外部启动成功分支检查重新打开提醒，最后执行回退。 测试进程在审核打开后真实写入 C，切到预览检查 C、切回审核检查当前 C、左侧仍为 A，并展开完整未变行；回退验证后续修改确认。
- Oracle：覆盖 `WB-EDIT-001-AC15/AC16/AC18`，双栏当前文件编辑保存和撤销、原始 AI 记录保持不变；AI 写入后编辑态显示最新内容且不误报外部修改；不点击修改项即出现模式切换、默认仍为预览且不重挂文档视图；从“全部”打开已修改文件仍可切审核，伙伴恢复后关联记录保持；编辑态与审核模式共用一个文件 Tab；Run 终态后修改入口在未点击时已显示真实非零数量；切换伙伴再切回后未点击时数量仍为真实非零，不重置为 0，对齐 `WB-APPLY-005-AC4`；审核模式展示差异数量、修改状态和回退，预览模式全部隐藏；预览模式对 Markdown/UTF-8 文本进入应用内编辑态（与普通打开一致），对齐 `WB-EDIT-001-AC7`、`WB-PANEL-003-AC14`；已应用记录打开外部应用后显示重新打开提醒；文件夹入口打开的文件列表从工具栏底部贴右悬浮，不改变预览宽度，可通过外部点击、Escape 或选择文件关闭；当前已经是最新记录且处于预览模式时，再次点击文件总分类仍会重置到最新审核模式；历史批次、结构化 Diff、不可变展开和回退刷新整体对齐 `WB-PANEL-003`、`WB-APPLY-001`、`WB-APPLY-002`、`WB-APPLY-003`；确认回退后 bytes 与原始输入一致且有效改动标记消失。

- 双栏补充验收：顶部标题与图标操作同一行，左右标题为“本次运行前／当前文件（可编辑）”，右侧暂不可编辑时标明只读；上一处／下一处差异及折叠图标具备准确可访问名称。未变行显示中文“已折叠 N 行”，支持单击展开，恢复箭头提示中文。真实 Monaco 左侧 A 只读、右侧 C 可编辑，输入／撤销／单块恢复／同步滚动／折叠／换行；保存后磁盘含完整内容，保留 BOM 和 CRLF，切换模式／记录前 flush；原始 AI 计数不变，对齐 WB-EDIT-001-AC7/AC15/AC16/AC18。大文件超时、文件缺失及保存失败列入真实人工验收，对齐 AC17。
- 目标与生命周期：对话修改入口及文件列表均按 `workbench-preview.md` 定位，真实 AI 额外生成辅助文件时仍检查目标文件；展开差异后移开鼠标并等待悬浮提示关闭，再操作系统打开菜单；审核与预览切换、伙伴恢复和回退期间，不得出现 Monaco 模型早于编辑器释放的异常。

#### `ppt-create-diff-and-revert`

- 测试类型：`e2e / live`
- What：真实 AI 创建两页 PPT 后，用户可打开页面级左右 diff、看到准确 `+2/-0`、切换审核/预览并回撤文件；运行时生成资源与临时脚本不出现在修改文件和右侧变更列表。
- Why：新建 PPT 必须同时验证文件交付、审核模式和回退闭环。
- How：创建空临时 workspace，经真实 Settings 和 Workbench UI 请求 AI 创建两页 PPT，第一页含中文负责人和全角括号的风险表，并通过文本文件工具在系统提供的运行时脚本目录创建仅用于检查页数和标记的 Python 脚本。通过只读伙伴信息和隔离用户数据目录定位并读取脚本，确认文件及真实修改事件确实存在；打开修改记录，操作审核/预览、缩放、拖拽和回退；从审核图片 URL 和预览内联 SVG 的实际显示内容收集浏览器字形边界。
- Oracle：真实 PPT 创建、原子写入和 run 级修改记录对齐 `WB-PPT-001`、`WB-APPLY-002`；pptx 可解析，真实临时校验脚本存在于伙伴 `runtime/scripts` 目录；修改文件与右侧“本次运行改动”只显示一个用户 PPT，不显示伙伴 `runtime/assets` 生成资源或临时脚本，对齐 `WB-APPLY-005-AC1`，数量文案允许空白差异。审核模式显示两页和 `+2/-0`，预览模式显示正式 PPT；两种模式都完整保留负责人姓名及全角括号，浏览器实际字形不越出表格单元格；现有缩放拖拽可用；回撤后新建文件被删除，对齐 `WB-APPLY-003`。

#### `ppt-update-diff-interactions`

- 测试类型：`e2e / live`
- What：已有 PPT 更新后的左右差异、绿色新增/修改/移动、红色删除、准确 `+N/-N`、缩略图筛选、审核/预览、缩放和拖动画布。
- Why：创建态与更新态的差异语义不同，不能只用新建 PPT case 代替。
- How：在空临时 workspace 中准备四页基线 PPT，让真实 AI 主动移动一页、修改一页、删除中间页、新增一页，并要求末页完全不变；打开修改记录并操作审核/预览、筛选、同步切页、缩放、拖动、关联应用打开和回退。审核视图在 100% 从左侧拖动，在 25% 从右侧大幅拖动，核对两侧精确同步位移；再验证滚轮放大后的平移。关联应用启动在 E2E 中使用 no-op 成功分支，不实际启动 Office/WPS。测试进程将正式 PPT 首页面文字改为 C，直接读取普通预览的交互 SVG 与审核的固定 SVG，验证预览 C、历史审核仍为 B，并确认强制回退。
- Oracle：正式 PPT 内容和顺序正确；审核显示准确 `+3/-1`、三个绿色页面标记和一个红色删除标记；删除中间页不会把未改末页标绿，变化筛选为四页、全部模式为五个 before/after 对齐项；已应用记录成功交给外部应用后显示“关闭后重新打开”提示；审核/预览切换、同步缩放拖动不变，任意缩放比例下左右画布精确跟随拖拽且不受边界限制，底部「滚轮缩放 / 拖拽平移」提示固定可见（缩放或拖拽后仍在），回退后 bytes 与 baseline 完全一致，对齐 `WB-PANEL-003-AC19`、`WB-PPT-002`、`WB-APPLY-003`。

#### `excel-update-diff-and-revert`

- 测试类型：`e2e / live`
- What：真实 AI 修改已有 Excel 后，用户在同一个只读网格中查看红绿单元格边框，并能回退到原始文件。
- Why：Excel 修改预览不能依赖模型描述，也不适合 PPT 式左右画面对比，必须直接验证工作簿数据、公式和单元格级 diff。
- How：通过真实 Workbench UI 用自然语言请求 AI 对已有 xlsx 分两轮修改，限定使用 Excel 工具且无需终端备份，清空含公式的明细行，保留汇总行原位置；整行插入/删除的逻辑对齐另由 AI backend 矩阵覆盖；打开修改记录，显式切换“预览/审核”，在两种模式下尝试编辑并用原生复制核对单元格原值，切换工作表和拖列宽；通过 E2E no-op 成功分支打开关联应用，再执行回退。测试进程将正式工作表重命名为 External C，以界面实际 Sheet 标签验证预览 C、历史审核仍为 B，并确认强制回退。在隔离输入增加共享样式和含公式的清空区域，真实 AI 局部修改后以网格复制取证核对普通预览与固定审核结果，并解析目标范围之外的值、样式和审核边框。
- Oracle：正式 xlsx 的值和公式准确且没有 diff 边框，Data 第 3 行内容清空，汇总保留在第 4 行且行数保持 46；同一 run 两轮修改在 UI 上只见一条本 run 修改入口；两种模式都通过 Univer 只读预览、可切换工作表且不出现 PPT 前后预览；审核态被改过的 Data 工作表 tab 有绿点、未改的 Notes 无绿点，预览态均无绿点；已应用记录成功交给外部应用后显示“关闭后重新打开”提示；回退后 bytes 与修改前一致；真实调用包含 `excel_read` 和至少两次 `excel_edit`；对齐 `WB-PANEL-003-AC19`、`WB-EXCEL-001-AC5`、`WB-EXCEL-002-AC1`、`WB-EXCEL-002-AC4`、`WB-EXCEL-002-AC9`。目标范围之外的共享样式不串改；普通预览显示重算结果，审核显示真实 A/B 的固定结果，恢复显示的删除内容不参与再次计算。
- 覆盖边界：整行插入/删除的结构对齐由 AI backend 验证；UI E2E 使用清空区域验证删除内容恢复后的固定审核结果，数值参数字符串兼容不在本次改动范围。

#### `excel-create-diff-and-revert`

- 测试类型：`e2e / live`
- What：真实 AI 新建多 Sheet Excel 后，用户可查看全部新增单元格的绿色 Diff，并通过回退删除新文件。
- Why：新建文件的 baseline 为空，Diff 与回退语义不同于已有文件更新，不能由更新 case 间接代替。
- How：通过真实 Workbench UI 用自然语言请求创建包含 Data/Notes 的 xlsx；打开修改入口，在两个 Sheet 检查新增边框，再执行回退。
- Oracle：正式文件可解析且两个 Sheet 数据正确；所有抽查新增单元格为绿色；审核态 Data 与 Notes 工作表 tab 均有绿点；真实调用包含 Excel 写入和创建后的读取核对；回退后新建文件不存在；对齐 `WB-EXCEL-002-AC9`。

#### `docx-review-position-and-inline-diff`

- 测试类型：`e2e / live`
- What：真实 AI 精简带继承加粗的混合格式段落，并验证 Word 移动、逐字和局部格式审阅效果。
- Why：读取遗漏继承格式或编辑重建段落可能丢失局部加粗与缩进；真实 Review 与 renderer 还需保持一致。
- How：隔离 Word 使用原创的公开资料整理工作台说明，包含长正文、两处通过字符样式继承的加粗概念及段落缩进；通过真实 UI 自然语言要求精简并保留核心概念和原格式，同时移动风险段落、修改指定单字和加粗指定文字（含原有前景色与黄色底色）。收集实际模型读取结果与写入调用，按目标 Word 文件名选择修改记录，检查最终文件、审核与预览，再回退；模型生成辅助文件时不依赖修改记录的数量或排列，不指定工具顺序或精简后的完整文案。
- Oracle：长段落确实精简，核心概念、继承加粗和原有缩进保留，普通文字不误加粗，其他内容不变；完全未变的文字及有效格式不误标。删除段落在原位置，新增在最终位置；同位置改字只标实际字符，格式只标目标文字；已有底色用绿色边框，原色和底色保留；不复制或新增说明；审核/预览与最终文件一致，回退恢复原始 bytes。对齐 WB-APPLY-003-AC8/AC11/AC12/AC13。
- 位置标记条验收：补充 `WB-PANEL-003-AC29`，检查 Review DOM 保留 inserted/deleted/formatted 语义，红绿分列、点击定位真实范围与强调、半透明滑块与标记同轨、原有字体颜色不误标、模式切换无残留；人工验收补充密集循环、重复文字、图片与表格变化、字体/图片延迟加载和文档首尾长区域。

#### `docx-apply-panel-preview-and-revert`

- 测试类型：`e2e`
- What：AI 修改真实 docx 后，assistant 修改文件入口在未点击时显示真实非零修改数量，右侧修改文件工作区、当前记录预览和干净回退闭环。
- Why：直接写回和回退是 Workbench 文件编辑能力的安全边界，只看 artifact 事件无法证明用户能检查和撤销修改。
- How：通过 UI 选择真实 docx 资料并发送真实编辑请求；等待 AI 写回但不点击 assistant turn 中的修改文件入口，确认它显示真实非零 `+/-` 数量；再点击入口检查右侧文件面包屑、无模式标签状态、预览，以及系统应用下拉内的“打开所在文件夹”；通过 E2E no-op 成功分支选择关联应用，再执行回退并重新读取文件内容。
- Oracle：受支持写回类型边界对齐 `WB-CORE-003`；修改后源文件成为最终净稿，Run 结束后入口在未点击时已显示真实非零数量；DOCX 已应用记录成功交给外部应用后显示“关闭后重新打开”提示；右侧默认选中、Review Docx、写回和回退闭环对齐 `WB-PANEL-003-AC19`、`WB-APPLY-001`、`WB-APPLY-002`、`WB-APPLY-003`。
- 位置标记条验收：补充 `WB-PANEL-003-AC29`，通过真实 UI 验证切入预览与回退后保留 16px 滚动轨道且无审核标记；审核标记语义与导航由 `docx-review-position-and-inline-diff` 覆盖，历史批次切换列入人工验收。
- 模式入口验收：补充 `WB-PANEL-003-AC13/AC14`，审核切预览后重复点击对话中的同一修改入口必须重回审核；从普通文件预览点击修改入口必须审核且复用原 Tab；切换其他 Tab 再回来保留预览；回退后再次点修改入口默认预览。文本文件的同一入口规则由 `text-file-apply-preview-and-revert` 补证，PPT/Excel 共用入口的逐格式重复点击保留人工验收边界。

#### `wps-sync-dispatch-on-write-and-revert`

- 测试类型：`e2e / exclusive`
- What：真实 AI 写回并回退已有 docx、xlsx、pptx 后，馆长回环 `GET /status` 对每条路径各记录至少一次 open dispatch。
- Why：WPS 窗口刷新依赖加载项；若馆长写盘后没有 dispatch，窗口不可能更新。这条不打开 WPS，用来单独定位三种格式的挂钩。只测 docx 不能证明表格 / 演示写盘也会通知。回环优先端口 `18723`，并行包测会抢端口，因此独占执行。
- How：通过真实 Workbench UI 依次选择 `sample-edit.docx`、`经营周报.xlsx`、`品牌策略提案.pptx`，编辑指令明确包含当前目标文件名和本轮标记。不连接 `/events`、不打开 WPS。每种格式写回后轮询 `127.0.0.1` 的 `/status`，确认 `lastDispatches` 含该路径；再确认回退后再增加一次。
- Oracle：磁盘写回含标记、回退恢复原文；每种格式写回后该路径至少 1 次 dispatch，回退后次数继续增加，对齐 `WB-WPS-001-AC2`、`WB-WPS-001-AC3`。无客户端时仍记录 dispatch；未连接时不发 close，对齐 `WB-WPS-001-AC4`。

#### `wps-office-review-navigation`

- 测试类型：`e2e / exclusive`（`result/wps-office/`，真实已授权组件）。
- What：Office 审核点击打开 WPS 并定位当前文件，覆盖未打开与已打开两次点击。
- Why：仅验证启动或写回刷新不能证明差异区域定位成功。
- How：隔离伙伴通过真实 UI 选择完全访问，在工作区注册与索引前给三类临时输入添加本轮唯一文件名，避免表格恢复窗口的同名冲突；WPS 关闭时由真实 AI 修改三类文件；通过“默认打开应用…”选择页设置馆长默认 WPS，通过审核区域点击启动并读取真实加载项选择回报，再次点击验证已打开路径。每个组件分别记录授权与失败原因，未授权明确跳过；不会通过内部 IPC 触发被测导航，读取索引和状态仅收集证据。Excel 按真实审核工作簿的行高列宽计算点击位置，并通过拖动分隔条保证目标可见；PPT 点击审核 SVG 中与索引对应的实际元素身份。macOS 演示通过实际 SlideID 校验，表格打开时重算造成的未保存状态不得阻止可唯一确认的单元格定位。
- Oracle：`WB-WPS-001-AC6/AC7`：已授权组件必须给出当前文件与实际选区的 located/container 回报，两次导航不得写入文件，也不得触发 close/reload；未授权组件不伪造覆盖。未保存编辑、多实例及位置失效由协议 Unit 补证与真机人工验收；Word 追加文字及邻段变化、PPT 原元素改字、Excel 无关保存与可唯一确认的行列位移仍可定位，重复／目标删除有 toast，原文件与未保存状态不变。

#### `wps-office-reload-on-write-and-revert`

- 测试类型：`e2e / exclusive`（路径 `result/wps-office/`；可单独执行，发版按影响范围选择或随全量测试）
- What：本机已授权的 WPS 打开目标 docx、xlsx、pptx 后，真实 AI 写回/回退让对应组件加载项先 close 放锁再写盘再 open，窗口摘录分别含标记和恢复原文。
- Why：只证明馆长 dispatch 不能证明用户看到的 WPS 窗口已换新稿。Windows 上 WPS 独占锁必须先 close 才能写盘。文字、表格、演示是独立客户端，只测 docx 不能证明 Excel / PPT 窗口会刷新。授权弹窗可能卡住无人值守自动化，因此提供单独命令；发版时按影响范围选择，发版全量测试包含该 case。
- How：在隔离伙伴内通过真实 UI 选择完全访问并确认，再执行 WPS 刷新和导航闭环。执行 `pnpm test:workbench:wps-office` 或 `--case wps-office-reload-on-write-and-revert`；可用测试专属 `WPS_E2E_HOSTS=et`（逗号分隔 `wps/et/wpp`）单独诊断组件，未选组件明确记为本轮未执行，子集通过不代表三格式通过。不覆盖拷加载项、不点授权、不用辅助功能点 UI。进用例前先做 WPS 环境归零（Windows 不带 `/F` 请求关闭 wps / et / wpp；macOS 先只向主进程发送 TERM，保留加载项子进程完成退出，超时再清理全部残留进程；临时工作区仅由各 case 的资源作用域回收，不按前缀批量删除其他轮次的目录，超时残留由 runner 按通用过期规则清理），否则上一轮残留实例会冒充本轮客户端。馆长回环先起来；`publish.xml` 与授权 path 保持 `http://127.0.0.1:18723/addon/`。若回环不在优先端口 `18723`（说明本机另有馆长占用），跳过整案，因为已打开的 WPS 仍从优先端口拉加载项。独占 `18723` 时，先在注册工作区与索引前为 `sample-edit.docx`、`经营周报.xlsx`、`品牌策略提案.pptx` 的临时副本添加本轮唯一文件名；真实引用、AI 指令、修改入口和 WPS 校验均使用该名称，避免表格恢复窗口中的旧同名文件阻塞。再分别用本机 WPS 打开临时工作区文件：macOS 走 `open -a`，归零后仅对 Launch Services 尚未注销旧进程导致的 `-600` 在 5 秒内重试准备打开，其他错误直接失败；Windows 按注册表 `InstallRoot` 与默认安装目录解析启动器 / 对应组件 exe（`wps.exe` / `et.exe` / `wpp.exe`），进程拉起后立即返回、不等待 WPS 退出。等待 `/status` 出现对应组件客户端（`wps` / `et` / `wpp`）且该文档已登记。再通过真实 Workbench UI 发送编辑；写盘前加载项 close 并上报 `remaining`，馆长等到文件锁释放再写盘；写回后读该路径 `reload-result` 摘录含标记，回退后摘录不含标记。标记落点必须在加载项摘录采样范围内（xlsx 指定写 `H1`，pptx 指定第一页包含“2026 秋季品牌升级方案”的文本框；不能让模型自选任意空白单元格或含糊选择正文，否则会产生采样遗漏或阻塞提问），摘录采样为表格 200 行 × 50 列、演示前 10 页、单次上限 20000 字符。macOS 原子写回后通过 Launch Services 指定 WPS 重开目标，以重新交付新文件的访问权限，并从实际持有文档的客户端取摘录；Windows 的 `remaining` 为 0 时由占位文档撑住组件进程后继续走加载项 open，占位建不起来才用对应组件 exe 拉起（不得 `cmd start` 把表格/演示塞进已打开的文字窗口），再经 list 轮询取摘录、不再二次 Open；被指派实例报 open 失败或超时则降级一次系统打开。格式之间保留已打开的 WPS 组件和窗口，按实际文档 clientId 投递，验证多组件连续使用；仅整案开始与结束时归零，避免逐格式强退造成加载项初始化竞态。单种格式失败记录原因并归零 WPS 后继续跑后面的格式，不得让 docx 或 xlsx 的问题把 pptx 挡在门外。本机未装 WPS、或该组件 `authaddin` 未授权则跳过该格式；该组件已授权但约 90 秒内加载项未连接则该格式失败。三种格式都未授权才跳过整案。
- 初始文档准备：macOS 连续切换格式时，第一次系统打开可能只创建后台标签，尚未启动该组件加载项。若 2 秒内目标仍未登记，仅再发送一次相同文件的系统打开请求以激活标签；不发送内部导航、不改授权、不把发出打开请求当作已就绪。最终仍须实际组件与目标路径登记后才执行被测编辑流程。
- macOS 真机前置：上轮被强退后，先从 WPS 正常退出并处理临时文档的保存提示，再执行独立 case。进程归零不等于清除了 WPS 自身的恢复状态；恢复标签导致已授权加载项未启动时，保留该轮失败及未连接证据，正常退出后另行复验，不能将其记为定位成功。首次启动及异常恢复后的加载项生命周期列入人工检查边界。
- Oracle：磁盘写回含标记、回退恢复原文；已授权的每种格式都必须给出结论，同一路径的回退只产生一次重开 dispatch，加载项 `reload-result` 写回后摘录含标记、回退后摘录不含标记，对齐 `WB-WPS-001-AC1`、`WB-WPS-001-AC2`、`WB-WPS-001-AC3`。断言数据按格式列出 covered / failed 及失败原因，本轮选中的任一已授权格式未 covered 即失败。未连接时不发 close；刷新失败不回滚已成功写盘，对齐 `WB-WPS-001-AC4`。超时报错必须带上 `clientId`、已登记文档和被拒的 close / open 回报原因，便于区分「投错实例」和「组件真的打不开」。用例结束后在删除临时工作区前先归零 WPS，清理目录遇到占用不作为失败。

- 联动反馈人工验收：`WB-WPS-001-AC8/AC9`：分别验证明确禁用、启用未连接、状态无法确认和已连接但目标未就绪；不得把无连接等同未授权。审核点击和一次性 WPS 打开共用弹框及手册入口，同问题去重、多问题合并；再次点击审核的 toast 明确当前原因及无法定位。启用且连接恢复后，清除该类型的过时提示，再次禁用应重新弹框，其他类型的提醒记录保留；仅旧连接存活或仅启用但未连接都不得当作恢复。已知目标刷新失败有提示，未在 WPS 使用的普通文件写盘不弹框。官网同一手册覆盖 macOS／Windows，Windows 真机结果单独登记。授权配置解析、按 host 判断、恢复通知及通知协议由 `unit/workbench/wps-sync-service.test.ts` 补证，不代替真实首次授权和 UI 弹框闭环。

- 导航补充验收：通过审核区域点击并收集实际 WPS navigate-result（活动文档及实际选区），覆盖三组件、未打开／已打开、多实例、未保存编辑、后续结构变化和删除目标，默认非 WPS 不导航。WB-WPS-001-AC6/AC7 的 macOS、Windows 真机覆盖单独列明，不以 mock 或启动成功替代定位；未授权环境明确跳过。

#### `docx-attachment-apply-status-and-cell-diff`

- 测试类型：`e2e / live`
- What：通过 Composer `+` 添加文件地址内的真实 DOCX 附件，让 AI 修改已有表格单元格的文字和格式，验证附件保留源文件绝对路径时仍保持成功状态和单元格 Diff。
- Why：附件链路现在保留源文件绝对路径且不限扩展名；文件地址内的附件写回必须仍生成修改记录与审核内容，防止附件上下文退化或专用写入记录被误判失败。
- How：在临时文件地址根目录创建包含已有表格的 DOCX，通过 `+` 附件流程添加并发送明确的单元格替换和样式修改请求；等待 Run 完成后打开 assistant 修改入口，检查状态、Review Docx、预览模式监听真实资产文件、审核模式快照和真实磁盘文件。
- Oracle：正式 DOCX 包含最终单元格内容；修改记录为 `applied` 且路径保持文件地址内源文件绝对路径，不出现失败红条或“本次未检测到文件内容变化”；审核预览在对应单元格展示红绿净变化，未变单元格不整表高亮，对齐 `WB-PANEL-003-AC20`、`WB-PANEL-003-AC21`、`WB-APPLY-003-AC9`、`WB-COMPOSER-010-AC2`。

#### `docx-apply-force-revert-warning`

- 测试类型：`e2e`
- What：AI 写回后文件又被外部真实修改时，首次回退展示风险提示，确认后允许强制回退并刷新右侧状态。
- Why：强制回退是避免静默覆盖用户后续修改的关键安全交互。
- How：AI 写回真实 docx 后，由测试进程对同一个真实文件做外部修改；在右侧修改文件工作区点击回退，先确认统一回退提示，再观察风险提示并确认强制回退。 切换审核/预览并读取实际 DOCX 渲染文本，验证预览 C、历史审核 B。
- Oracle：审核模式不创建普通预览文件监听，外部修改不会刷新审核快照或显示普通预览刷新提示，对齐 `WB-PANEL-003-AC18`；首次点击只展示统一确认且不写磁盘，对齐 `WB-APPLY-004-AC1`；确认后检测到后续修改，再展示“仍然回退这次修改？”风险提示；用户确认强制回退后恢复 checkpoint 或删除新建文件，对齐 `WB-APPLY-004-AC2`；右侧记录状态和预览在强制回退后刷新，对齐 `WB-APPLY-004-AC3`；记录模型、耗时、完成度评分和失败归因。

#### `multi-file-apply-tabs`

- 测试类型：`e2e`
- What：同一轮 AI 修改多个文件时，assistant turn 保留全部入口；右侧为每个文件保留资源 Tab，并可切回旧文件；文件入口超过 3 个时默认折叠展示并可展开/收起。
- Why：多文件任务如果只保留最新或单个入口，用户无法检查和回退完整结果；入口过多时折叠能避免单条消息占用过宽列表。
- How：通过 UI 创建工作地址并直接引用真实 docx 文件，不把知识库索引作为文件编辑前置；发送真实多文件编辑请求，分别点击两个修改入口，确认生成两个文件 Tab，再点击第一个 Tab 恢复其记录。另准备同一轮修改超过 3 个文件的真实输入，确认列表默认只展示前 3 个入口、底部展示“显示剩余 N 个文件”与三角图标；点击后展示全部入口且底部变为“收起文件”，再次点击恢复折叠；头部总数始终为完整数量。
- Oracle：多个修改入口、对应记录加载和切换后入口保留整体对齐 `WB-APPLY-005`；点击入口新增或激活对应文件 Tab，对齐 `WB-PANEL-001-AC1`；超过 3 个入口的折叠、展开与收起交互对齐 `WB-APPLY-005-AC5`。头部总数与剩余数量必须准确，数字与中文单位之间空白不影响判定。

#### `apply-workspace-collapsed-restore`

- 测试类型：`e2e / live`
- What：审核模式展开状态下折叠右侧面板，切换伙伴再切回后面板必须保持折叠；异步修改记录刷新只更新内容，不得把面板重新展开，展开后直接展示最新审核内容。
- Why：伙伴切换会恢复目标伙伴自己的展开状态（`WB-PANEL-001-AC5`）；如果恢复过程中的记录刷新强制展开面板，折叠态用户会反复被打断。
- How：用户明确要求使用应用的文本编辑能力修改 Markdown（不通过命令行/脚本写入，以便产生受控审核），完成后通过真实 UI 创建第二个伙伴，切回原伙伴并打开审核模式；折叠面板后切到第二个伙伴，再切回原伙伴，等待异步记录刷新窗口；确认面板保持折叠，再手动展开并检查审核内容与文件 Tab。
- Oracle：切回后 shell 不存在且仅保留右缘展开按钮，对齐 `WB-PANEL-001-AC5`；手动展开后展示目标文件的最新审核内容且文件 Tab 保留，对齐 `WB-PANEL-001-AC1`。

#### `human-interaction-question-card`

- 测试类型：`e2e / live`
- What：统一提问卡允许每题 0 至 4 个选项，支持单个候选项、单选、多选、无选项输入；无独立其他选项，无自动跳题，手动下一步并最终提交；Activity 回显、伙伴切换与刷新恢复正确。
- Why：无选项协作、选择补充与批次隔离必须由真实 UI 和产品链路验证。
- How：真实模型通过一次提问询问仅一个候选项的单选、2 至 4 项多选和无选项纯输入三题，真实 UI 点选、取消、填写、翻页与提交；选项行获得焦点后 Enter 下一步，回复框 Enter 下一步和最终发送，空回答 Enter 不前进，Shift+Enter 换行；检查输入采用 Ant Design 默认间距与标准单行高度、无尾部勾叉与选项键盘焦点无整行蓝色外描边；切伙伴和刷新后恢复待处理卡并清空草稿，后续交互继续回答。通过日志检查提交前后运行和工具状态，不注入 UI / IPC 状态。
- Oracle：对应 `WB-BLOCKER-001-AC9`、`WB-BLOCKER-001-AC11`、`WB-BLOCKER-001-AC12`、`WB-SESSION-014-AC2`；无普通 Composer，单项无分页、多项显示数量与箭头；多选有轻提示；输入为 Ant Design TextArea，默认间距紧凑、单行不额外撑高，多行按内容增长；有选项时输入默认和悬停无边框及阴影，点击聚焦后显示，失焦后隐藏，纯输入题保留完整细描边；选择行无尾部勾叉和蓝色焦点外描边；每题选项不超过 4 项，单个候选项可选择并提交；纯输入无需选项，空白不能发送；选择后仍停留当前题，翻页保留草稿，最后统一提交，选项焦点与回复框 Enter 执行对应主动作，Shift+Enter 换行，空回答按 Enter 不前进，问答在 Activity 回显。协助标签正确出现和清除，新交互不继承草稿。
- 人工验收（`WB-BLOCKER-001-AC11`）：推荐标签紧贴标题，以浅蓝底深蓝字显示；未选、选中和改选其他项时持续可见；深灰编号只表达已选；长标题及窄窗口下不溢出。

### 5.4 `scheduled-task`

定时任务测试单独归类，Oracle 引用 [`workbench.md`](../prd/workbench.md) 的 `ST-*` 编号。调度触发时点由真实程序运行与系统时间决定，case 通过「下一分钟」级别的短周期调度验证端到端触发，不伪造系统时钟。服务单测覆盖伙伴绑定、默认开启、最新 Composer 配置、缺少主模型和伙伴失效停用。

#### `scheduled-task-view-entry-and-isolation`

- 测试类型：`e2e`
- What：左侧栏「创建伙伴」下方存在「定时任务」入口；点击后整个主区域（除左侧伙伴列表外）切换为定时任务视图，聊天对话与资源面板不再显示；点击「创建伙伴」或点击任意伙伴返回聊天视图。
- Why：定时任务是一个独立的全主区视图，不与聊天对话或资源面板并存，避免状态交叉。
- How：通过真实 UI 点击「定时任务」入口确认整块主区切换为定时任务视图且无聊天；随后点击「创建伙伴」返回聊天视图并打开创建弹窗（伙伴点击返回由 `scheduled-task-trigger-and-session-refresh` 覆盖）。
- Oracle：入口位置与样式对齐 `ST-ENTRY-001-AC1`；点击后主区整块切换且无聊天对齐 `ST-ENTRY-001-AC2`；视图无聊天 / 无资源面板对齐 `ST-VIEW-001-AC1`；点击「创建伙伴」返回聊天并对齐 `ST-VIEW-001-AC3`。

#### `scheduled-task-config-lifecycle`

- 测试类型：`e2e`
- What：新增、必填拦截、编辑、启用开关、立即执行确认与删除完整闭环；右侧抽屉标题关闭按钮、Esc、底部取消和未保存确认正确；字段顺序为名称、描述、伙伴、周期、时间；手动伙伴使用最多显示四项（208px）的可滚动列表，任务描述复用 Composer 输入框，以行内 token 展示 `@` 资料且默认高度 120px 并内部滚动；新建默认开启；编辑保存不改变启用状态。
- Why：配置是定时任务可执行的前提；立即执行是占用兜底的入口。
- How：通过真实 UI 首次打开定时任务视图并进入新增，等待 Composer 输入框就绪，确认页面未进入全局异常态；检查统一右侧表单、名称 / 描述 / 伙伴字段顺序、固定 footer、标题栏关闭按钮可用及遮罩不关闭；干净表单点击关闭按钮后关闭；重开后修改名称，通过标题关闭按钮、底部取消与 Esc 分别打开未保存确认，取消确认后继续编辑，再通过底部取消确认放弃；检查伙伴列表最多完整显示四项（208px），第五项需内部滚动才能到达，滚至列表底部并选择伙伴；检查描述输入框初始高度为 120px、超长内容只在输入框内部滚动；填写名称、普通文本任务描述、执行时间和周期后保存；编辑已创建任务，检查纯文本与引用 token 回填并从列表重新绑定伙伴，确认启用状态不变；继续确认立即执行可携带引用，最后删除并二次确认。另通过 UI 覆盖名称、描述可清空字段的必填拦截及每周未选星期的拦截；执行时间禁用清空，周期有默认选项且不可清空，不构造不可达状态；删除先取消并核对任务仍在，再确认删除。
- Oracle：新增与编辑预填对齐 `ST-FORM-001-AC1`；首次新建与编辑打开后输入框正常就绪、全局异常页不存在；必填缺失拦截对齐 `ST-FORM-001-AC2`；每周必选星期对齐 `ST-FORM-001-AC3`；Drawer 尺寸、字段顺序、滚动、footer、遮罩及标题关闭按钮交互对齐 `ST-FORM-001-AC4`、`ST-FORM-001-AC10`；手动伙伴列表限高、内部滚动、选择和真实绑定对齐 `ST-FORM-001-AC6`、`ST-FORM-001-AC9`；描述输入默认高度、内部滚动和正文 token 回填对齐 `ST-FORM-001-AC8`；编辑保存不改启用对齐 `ST-FORM-001-AC7` / `ST-SWITCH-001-AC3`；新建默认开启对齐 `ST-SWITCH-001-AC1`；删除二次确认对齐 `ST-DELETE-001-AC1/AC2`；列表展示对齐 `ST-LIST-001-AC2/AC4`；启用后数量 chip 对齐 `ST-ENTRY-001-AC3` / `ST-VIEW-001-AC4`；立即执行确认对齐 `ST-RUN-004-AC1`。

- 布局补充：页头两按钮为 28px，表单底部为 32px，尺寸按布局高度验收；配置表单右侧滑出，名称等字段 label 均可见并采用统一样式；手动与 AI 创建的伙伴列表单项时无多余底部留白，多项超限后滚动。

#### `scheduled-task-description-reference`

- 测试类型：`e2e`
- What：在定时任务 Composer 输入框中输入普通文本并通过 `@` 选择真实文件，确认资料以行内 token 展示、候选面板能避开抽屉顶部碰撞并落在可视内容区域内，保存后立即执行。
- Why：正文文本、行内引用 token、持久化 contentNodes 与触发消息必须保持一致；输入中的 Markdown 符号不得被误渲染或丢失。
- How：只复制真实 `sample-edit.docx` 到隔离工作地址，不准备无关资料或知识库索引。通过真实 UI 打开新建抽屉，确认无独立引用按钮；缩小窗口并滚动描述框靠近内容区顶部，再输入 `@`。读取候选面板与描述框 / 抽屉内容区的真实 bounding box，验证上方空间不足时面板翻转到下方且未越出可视内容区域，随后恢复窗口。再输入包含 Markdown 标记的普通文本并选择 `sample-edit.docx`，检查 token 位于正文流且 Markdown 标记仍是字面文本；从 IPC 读取任务的 `contentNodes` / `selectedReferences`，核对保存的正文在原位置包含 `@sample-edit.docx`，再立即执行并读取绑定伙伴的用户消息，核对同一正文及引用节点。
- Oracle：上方空间不足时 `@` 候选面板显示在描述输入框下方且完整位于抽屉可视内容区域；`@` 候选成功插入正文行内 token，编辑时原位回填；文本不会被 Markdown 渲染；任务保存后同时包含纯文本、按顺序排列的引用节点和 `selectedReferences`；触发消息保留同一引用，对齐 `ST-FORM-001-AC8`、`ST-FORM-001-AC11`、`ST-RUN-001-AC1`。

#### `scheduled-task-ai-create`

- 测试类型：`e2e`
- What：从定时任务视图进入 AI 创建，选择伙伴后切换到该伙伴聊天并预填任务设置引导语。
- Why：AI 创建只负责准备当前伙伴的对话草稿，不应创建任务、发送消息或启动运行。
- How：通过真实 UI 打开 AI 创建，检查伙伴列表初始最多完整显示四项、第五项需内部滚动才能到达及选中态，选择伙伴并确认；读取当前聊天草稿、伙伴选中状态和消息记录，切换伙伴后再切回确认草稿仍然存在。
- Oracle：AI 创建和手动任务编辑器均使用最多显示四项后内部滚动的伙伴列表，动态头像、截断和选中态正确，对齐 `ST-FORM-001-AC9`；AI 创建切换到所选伙伴；草稿等于任务设置引导语；没有用户消息和运行状态变化，对齐 `ST-FORM-001-AC12`。

#### `scheduled-task-partner-deletion`

- 测试类型：`e2e`
- What：删除绑定伙伴后，定时任务保留、清空绑定并停用，重新绑定后仍保持原停用状态。
- Why：伙伴删除不能静默删除任务，也不能让失效任务继续执行。
- How：通过真实 UI 创建绑定任务，在原生确认子窗口中确认删除绑定伙伴，从任务列表读取状态，再编辑任务绑定另一个伙伴并保存。
- Oracle：删除伙伴后任务显示未绑定且开关禁用；重新绑定成功但启用状态仍为关闭，对齐 `ST-PARTNER-001-AC1`、`ST-SWITCH-001-AC3`。

#### `scheduled-task-trigger-and-session-refresh`

- 测试类型：`e2e / live`
- What：创建一个未来分钟触发的定时任务，到点后向绑定伙伴追加任务消息；伙伴列表无需手动刷新即展示运行状态；当前查看的伙伴不被切换。
- Why：这是定时任务的核心闭环，验证真实调度、真实 AI run 与前端伙伴列表刷新联动。
- How：在真实 UI 配置一个每天 + 未来分钟时刻的任务；等待到点，轮询绑定伙伴的运行状态并确认当前选中伙伴不变。触发时通过真实侧栏 DOM 等待目标伙伴的运行标记，无需刷新；保持当前伙伴和草稿。任务使用将来可到达的分钟时刻，允许为准备操作预留时间。
- Oracle：到点往绑定伙伴追加对齐 `ST-RUN-001-AC1`；不改变当前查看伙伴对齐 `ST-RUN-001-AC2`；从定时任务视图点伙伴返回聊天对齐 `ST-VIEW-001-AC2`；伙伴列表刷新对齐 `ST-RUN-002-AC1/AC2`。

#### `scheduled-task-busy-cancel-and-run-now`

- 测试类型：`e2e / live`；suite `scheduled-task`。
- What：伙伴忙碌时取消到点执行、顺延周期，胶囊关闭与立即执行确认遵守占用限制。
- Why：避免后台任务打断当前交互或在空闲后意外补跑，并守住用户主动恢复执行的入口。
- How：真实 UI 创建伙伴与两个独立命名任务，使用真实模型进入 waiting_human 并等待真实到点。只读确认未提交、顺延和提示保留；切回伙伴时问答卡片替换 Composer，提示暂不显示。任务列表确认立即执行时仍被占用限制拒绝；通过问答卡片提交回答，检查 Composer 恢复后提示含任务名。等待原 run 结束后关闭第一条提示，切换回来查看另一条提示并确认立即执行。不注入状态、不改系统时间。
- Oracle：忙碌到点不新增任务消息、下一周期顺延，对齐 `ST-RUN-001-AC3`；问答期间隐藏胶囊、提交回答恢复 Composer 后显示含任务名的胶囊，关闭只消除提示，主操作先确认，对齐 `ST-RUN-005-AC1/AC2/AC3`；仍忙碌时拒绝执行，空闲后只启动一次，对齐 `ST-RUN-004-AC2/AC3`。

### 5.5 `skills`

新增 suite `skills`，全部通过真实 UI、IPC、SQLite 和文件系统完成，不通过写 IPC、模拟选择器或伪造模型改变结果。目录导入使用现有 macOS / Windows 原生目录选择器自动化。只读 IPC 和文件读取用于取证。

#### `user-skill-create-edit`

- 测试类型：e2e。
- What：统一顶栏、右侧表单、Markdown 创建编辑与重命名、冲突、取消和持久性。
- Why：文本类 skill 应易于编写，界面遵循工作台配置规范。
- How：UI 创建两个 skill，检查 44px 拖拽区、页头入口和右侧定位；检查名称、描述、内容 label 可见且样式一致，输入聚焦只有底线，无标签页和源码切换；使用格式工具及 `/` 菜单编写标题、列表及代码块，保存后重开；测试重名失败保留草稿、未保存关闭、窄窗、重启和删除。重启后首次操作直接编辑已有 skill，再连续关闭并打开不同 skill，检查工具栏、已保存正文与输入可用性。开发服务器启动后，可用 `ELECTRON_RENDERER_URL` 指向真实开发页面执行同一用例，覆盖 React StrictMode 重复初始化；仍使用 runner 的隔离数据目录和真实产品链路。
- Oracle：`WB-SKILL-001-AC1/AC3/AC6`；无旧说明/伙伴选择/导入独立按钮；首次编辑和连续重开不空白、不串正文，Markdown、名称与绑定正确，取消不写盘。

#### `user-skill-import-replace`

- 测试类型：e2e / exclusive。
- What：统一创建入口内选择本地导入、预览、确认和替换。
- Why：导入也是创建方式，选择目录不能自动发布。
- How：通过表单顶栏导入与真实目录选择器选两个同名版本；检查同一表单可编辑导入内容，展开附带文件并预览；确认/取消及替换未保存草稿确认，读取真实资源和权限取证。
- Oracle：`WB-SKILL-001-AC2/AC3`；确认前不发布到正式目录，取消不变，未知 YAML/资源/执行位保留，同名替换保留名称和伙伴选择，源目录删除后仍可用。

#### `user-skill-partner-budget`

- 测试类型：e2e / exclusive。
- What：伙伴创建/编辑内多选与预算、取消和失败原子性。
- Why：伙伴的能力配置应在伙伴表单中完成。
- How：UI 创建包含单份超过 32 KiB 的长正文，在伙伴右侧表单搜索、多选、取消或保存；检查可见 label、简短帮助文案和用量圆环，尝试合计超限并同时修改伙伴属性，以及编辑/替换共享内容造成多伙伴超限，再停用释放额度。
- Oracle：`WB-SKILL-001-AC3/AC7`；长正文可保存、读取及启用，圆环比例等于所选正文总字节 / 64 KiB，每项比例使用相同分母。圆环不显示百分比文字，tooltip 只有「伙伴 skill 正文容量」及已用 / 最大用量，不出现单份上限；超限拒绝且伙伴属性/绑定均不变，切换伙伴隔离；损坏内容停用由 Unit 补充。

#### `user-skill-use-live`

- 测试类型：e2e / live；group `live`，原生目录选择要求 `execution: exclusive`。
- What：用户通过统一创建入口导入、伙伴编辑配置后，真实 AI 使用规范及资源，编辑后使用新规则。
- Why：证明新入口到模型闭环。
- How：UI 导入、伙伴编辑内启用周报内容，用户提供业务事实生成文件；Markdown 编辑后再发任务，记录真实请求、工具和产物。
- Oracle：`WB-SKILL-001-AC4/AC5`；按名称加载，正文和资源进入模型，两轮使用各自有效规则且保留上版；不逐字匹配最终回答。

#### `user-skill-management-live`

- 测试类型：e2e / live；skills / live；knowledge none。
- What：自然语言创建并启用、更新以及停用 skill 后的页面与配置闭环。
- Why：AI 创建后的列表、资源、容量和过程呈现必须与真实持久化一致。
- How：真实 UI 建立伙伴与模型配置，通过聊天要求创建含资源的规范并启用；到管理页打开正文、资源，再聊天更新并核对页面同步，最后停用并打开伙伴配置核对。核对按需加载 skill 管理及批量配置，查询/更新过程和简短成功结果；以真实文本和工具事件核对连续动作合并为 Activity、收起/展开箭头与加载名称；单一类型显示对应扳手/厚书，混合为流程图标，刷新后历史一致；不写 IPC、伪造事件或模型结果。
- Oracle：名称、正文、资源和启停与文件/绑定一致，容量刷新且未保存草稿不被覆盖；「加载 skill 管理」蓝色扳手与 Skill 正文加载紫色厚书参与 Activity 合并，名称、箭头和单类/混合图标规则在历史与实时一致。对应 `WB-SKILL-002-AC1/AC2/AC4/AC5/AC6`；部分失败的状态分支由共享投影 Unit 与真实 backend 补充。

权限、原子回滚、预算精确边界与损坏配置停用由 Unit 补充；缓存命中率由现有缓存专项验证。

## 6. 自动化覆盖边界

- `WB-SKILL-002-AC3`：服务与工具层由 `skill-config-and-current-partner-binding`、`user-skills` Unit 验证最终预算和回滚；`user-skill-partner-budget` 提供界面超限拒绝证据，AI 触发失败后的全部界面组合需人工验收。

- `WB-COMPOSER-001-AC6`：`reference-mention-keyboard` 自动检查空对话的长文本粘贴、连续换行后的末行可见、内部滚动、工具栏可见和清空后高度恢复；已有消息、窄窗口自动换行及附件组合仍做界面专项验收。
- `WB-WPS-001-AC6/AC7`：真实 WPS 导航、多个实例和未保存内容保护需要已授权的 macOS／Windows 逐机验收；协议 Unit 不能替代真实选区证据。后续编辑通过原文、对象身份或单元格上下文定位，歧义时仅打开并说明，不使用未确认的旧坐标。
- `WB-EDIT-001-AC17`：大文件超时、超长行、保存失败和文件删除使用真实输入人工验收，不增加生产故障开关。

| 验收                                       | 当前证据与缺口                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WB-DOCUMENT-REFERENCE-001-AC7`            | 部分覆盖：`docx-selection-reference` 已验证 16px 共用轨道、隐藏原生竖向条、滑块同步、拖动/滚轮/空白点击、覆盖色块定位与拖动不误触，以及紫色标记、正文排序的重叠循环、鼠标/键盘定位与强调、临时选区无标记和发送清理。删除逐项更新、伙伴/文件隔离、窗口变化后标记位置、外部原文变化、更多密集引用及长区域保留人工验收边界。 |
| `WB-PANEL-003-AC29`                        | 部分覆盖：`docx-review-position-and-inline-diff` 与 `docx-apply-panel-preview-and-revert` 已验证同轨叠层、红删绿增、格式语义、点击定位、预览与回退无残留；轨道滚动交互由 `docx-selection-reference` 验证共用组件。密集循环、重复文字、图片/表格、延迟加载、首尾长区域和历史批次切换保留人工验收边界。                     |
| `WB-CORE-004-AC2/AC3`、`WB-CORE-007-AC3`   | 待补：默认 / 宽松补充和严谨资料边界没有专门真实模型场景。偏好选择、持久化或 prompt 格式检查不能代替行为验证。                                                                                                                                                                                                             |
| `WB-COMPOSER-014-AC3`                      | 部分覆盖：重试行见 `llm-retry-process-row`；输出截断、半截回答与网络中断上下文的完整 UI 断言待补。                                                                                                                                                                                                                        |
| `WB-COMPOSER-014-AC4`                      | 部分覆盖：`stop-running-or-approval-run` 通过真实模型和 UI 验证 doing loading 的旋转、停止后暂停、hover、中断保留与新会话清空；完成比例、正常完成隐藏和恢复后旋转仍需专项验收。                                                                                                                                                                                                                                                            |
| `WB-SESSION-001-AC6`、`WB-SESSION-012-AC3` | 部分覆盖：已有创建 / 编辑用例走正常路径，UI 重名拦截与历史重名记录只改形象分支待补。                                                                                                                                                                                                                                      |
| `WB-COMPOSER-013-AC5`                      | 部分覆盖：unit `message-log-vision-context` 检验有效图片判断和免费无 vision gate；`model-selector-and-provider-error` 验证成功、失败、取消后无需切换伙伴即刷新上下文用量。含图片历史下的真实 UI 禁用、提示与发送拦截，以及跨伙伴查询不串状态仍需人工验收。                                                                |
| `WB-COMPOSER-013-AC6`                      | AI backend `human-read-image-no-vision` 覆盖工具能力反馈、无图片请求与 graph 继续交付；unit `read-image-multimodal` 覆盖支持视觉、目录未命中和非免费模型。真实免费模型的解释及文字续聊列入人工验收。                                                                                                                      |
| `ST-RUN-003-AC1/AC2`                       | 部分覆盖：`tests/case/unit/scheduled-task-service.test.ts` 以依赖时钟检验启动错过 / 容忍窗口后顺延且不补跑；真实应用关闭 / 系统休眠恢复需桌面人工验收。                                                                                                                                                                   |
| `ST-RUN-001-AC3`                           | 部分覆盖：`scheduled-task-busy-cancel-and-run-now` 实测 waiting_human 到点不提交并顺延；Unit 验证占用策略和空闲后不补跑。running / waiting_approval 的独立 UI 场景未验证。                                                                                                                                                |
| `ST-RUN-005-AC1`                           | `scheduled-task-busy-cancel-and-run-now` 验证问答卡片收起、Composer 恢复后的提示；waiting_approval 的独立 UI 场景未验证。                                                                                                                                                                                                 |

### 需求级用例的逐项覆盖边界

以下说明需求级用例的实际证据及未验证子项；需求编号引用只表示主题归属，不代表全部验收已测。未核实的项目按未证实覆盖处理，补齐证据后移入具体 Oracle。

| 验收                                                                        | 现有相关 case / 证据状态                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WB-CORE-002-AC2`                                                           | 部分覆盖：`reference-token-lifecycle` 验证引用 token 与发送参数，`prefix-cache-retain-live` 验证实际读取；已选范围优先但非唯一搜索范围的行为未专门断言。                                                                                                                                                                                  |
| `WB-CORE-005-AC1/AC2/AC3`                                                   | 部分覆盖：`ai-process-stream-and-final-answer` 核对 Alice/Bob 事实、成功/失败读取与不泄露推理；资料不足时解释缺口及结论组织需人工质量验收。                                                                                                                                                                                               |
| `WB-CORE-006-AC2/AC3/AC4`                                                   | 部分覆盖：`model-selector-and-provider-error` 检查 provider 错误与详情；一般失败解释、简单/复杂任务的 plan 使用边界待补。                                                                                                                                                                                                                 |
| `WB-CORE-007-AC2/AC5/AC6`                                                   | 部分覆盖：`web-read-from-search-result` 走成功路径；失败不伪造、无独立窗框及不可挂起的失败场景待补。                                                                                                                                                                                                                                      |
| `WB-SESSION-002-AC1/AC2/AC4`                                                | 部分覆盖：`partner-ui-state-isolation` 检查草稿、权限和面板隔离；加载不闪空、历史消息切换与审批恢复没有覆盖全部分支的对应断言。                                                                                                                                                                                                           |
| `WB-SESSION-003-AC3`                                                        | 部分覆盖：`partner-create-and-name` 检查侧栏名称；顶栏与 name 一致未单独断言。                                                                                                                                                                                                                                                            |
| `WB-SESSION-004-AC2/AC3`                                                    | 部分覆盖：`partner-delete-confirmation` 检查列表删除与浏览器销毁；回落可继续操作和伙伴磁盘目录清理未逐项断言。                                                                                                                                                                                                                            |
| `WB-SESSION-006-AC1/AC2/AC3/AC4`                                            | 部分覆盖：`user-message-actions` 检查入口、运行中无编辑、撤回消息和附件；复制反馈、取消确认、完整草稿恢复及失败恢复待补。                                                                                                                                                                                                                 |
| `WB-SESSION-008-AC5/AC6`                                                    | 部分覆盖：现有偏好/面板用例未对删除 UI 快照及失效模型、引用、附件修复逐项断言。                                                                                                                                                                                                                                                           |
| `WB-SESSION-009-AC1/AC3/AC4`                                                | 部分覆盖：`partner-pin-toggle` 验证取消后图钉不常驻；图标样式、取消后区域排序及重启持久化待补。                                                                                                                                                                                                                                           |
| `WB-SESSION-012-AC1/AC2`                                                    | 部分覆盖：`partner-edit` 验证名称回填、伙伴数量、新形象和侧栏；形象初始回填、顶栏及消息保留缺少独立断言。                                                                                                                                                                                                                                 |
| `WB-COMPOSER-001-AC2/AC3/AC4`                                               | 部分覆盖：`send-guard-and-preferences` 检查无伙伴空态与无模型提示，`queue-message-during-run` 验证运行中追加；空白发送和占位见 `multi-format-selection-reference`、`reference-mention-keyboard`，`partner-edit` 检查创建及改名后的伙伴名称占位。提交去重、全部禁用原因及改名后 AI 自称待补。                                              |
| `WB-COMPOSER-007-AC6/AC7/AC11/AC15`                                         | 部分覆盖：`model-selector-and-provider-error` 走自定义与免费目录；失效快照回退、付费目录、入口图标及偏好实际影响资料边界待补。                                                                                                                                                                                                            |
| `WB-COMPOSER-017-AC1/AC2/AC3/AC5/AC6/AC7`                                   | 部分覆盖：`queue-message-during-run` 检查单一按钮、两条浅灰追加消息、续接输入和固定用时；最终回答期追加、异常保留、悬空工具修复与校验竞态未完整验证。                                                                                                                                                                                     |
| `WB-COMPOSER-010-AC1/AC3/AC4/AC5/AC6`                                       | 部分覆盖：`composer-attachments-context` 核对多格式附件、路径与无预解析、图标、预览及横滑证据；无伙伴添加、任意数量/大小边界和系统目录原生拖放未全部自动化，原生目录拖放需人工验收。                                                                                                                                                      |
| `WB-COMPOSER-011-AC1/AC2`                                                   | 部分覆盖：`workbench-help-entry` 检查可访问名称、官方 URL 和路由；说明文案及草稿保留未逐项断言。                                                                                                                                                                                                                                          |
| `WB-SCOPE-001-AC1/AC2/AC4`                                                  | 部分覆盖：`reference-token-lifecycle` 检查文件/网页分组与目录插入；无伙伴入口、两级边界及分页/滚动未覆盖全部分支。                                                                                                                                                                                                                        |
| `WB-SCOPE-002-AC3/AC4/AC5`                                                  | 部分覆盖：`reference-token-lifecycle` 检查键盘删除、部分图标和发送 token；删除后发送范围、历史回显及所有格式图标矩阵待补。                                                                                                                                                                                                                |
| `WB-BLOCKER-003-AC1/AC2`                                                    | 人工验收：真实上下文压缩过程提示；现有测试边界明确不强制 live 触发压缩。                                                                                                                                                                                                                                                                  |
| `WB-PANEL-001-AC2/AC3/AC4/AC6/AC7/AC8/AC9`                                  | 部分覆盖：`right-panel-layout-and-tabs` 检查菜单、标签、原生浏览器菜单和分隔条；`text-file-apply-preview-and-revert` 检查同路径只保留一个 Tab。关闭活动/非活动/最后标签的完整矩阵和全部几何约束未逐项验证。                                                                                                                               |
| `WB-PANEL-003-AC1/AC2/AC3/AC4/AC5/AC6/AC7/AC8/AC9/AC10/AC11/AC12/AC15/AC16` | 部分覆盖：`file-preview-actions` 检查 PDF/DOCX/Markdown/TXT/Excel 预览、系统打开菜单及文件选择器；`text-file-apply-preview-and-revert` 检查预览/审核切换和文件列表。所列验收包含的其他细分交互不能仅凭需求级引用视作已测。                                                                                                                |
| `WB-APPLY-002-AC1/AC2/AC3/AC4/AC5/AC6/AC8`                                  | 已有 UI 写回链路；累计基线和单一记录由 AI `file-change-immutable-review`、`ppt-create-read-edit-commit`、`excel-create-read-edit` 补充，文本原子校验由 `text-file-atomic-guards-and-format-preservation` 补充。WPS 证据按 `wps-office-reload-on-write-and-revert` 的实际组件授权状态判断，不能把跳过算通过。                              |
| `WB-WPS-001-AC5`                                                            | 人工验收：首次组件授权提示与授权后不重复弹窗、已运行 WPS 的加载项更新。`wps-office-reload-on-write-and-revert` 使用已授权组件，不能证明此项首次安装体验。                                                                                                                                                                                 |
| `WB-WPS-001-AC8/AC9`                                                        | 人工验收：加载项状态说明框、同问题去重、连续问题合并、失败 toast 和手册直达；状态解析及按组件隔离由 `unit/workbench/wps-sync-service.test.ts` 补证。Windows 真机行为单独检查。                                                                                                                                                            |
| `WB-PANEL-004-AC1/AC2/AC3/AC4/AC5/AC6/AC7/AC11`                             | 部分覆盖：`browser-use-task-panel` 验证后台操作与恢复后内容；原生菜单/缩放见 `right-panel-layout-and-tabs`。动画全程、同 URL target 隔离、所有存储类型与全部生命周期组合尚缺逐项 UI 证据。                                                                                                                                                |
| `WB-APPLY-001-AC1/AC2/AC3`                                                  | 部分覆盖：文本、DOCX 和 PPT 审核 E2E 验证默认审核及模式切换，多文件选择见 `multi-file-apply-tabs`；每种格式的面包屑、预览隐藏回退等组合未逐项断言。                                                                                                                                                                                       |
| `WB-APPLY-003-AC1/AC2/AC3/AC5/AC6/AC10/AC14/AC15/AC16`                      | 部分覆盖：文本/PPT/Excel E2E 核对正式 C 与审核 B、回退及新建删除；AI `file-change-immutable-review` 补充临时版本清理与原始 bytes。保存失败恢复、跨 run、缺失/损坏审核和全部视觉结构的 UI 组合未全部验证；WPS 需按组件授权结果单独核对。                                                                                                   |
| `WB-TERMINAL-001-AC3/AC4/AC7/AC8`                                           | 部分覆盖：E2E `terminal-unicode-file-list` 只验中文列目录；AI `terminal-execution-contract` 验证 maxWaitSeconds 后仍运行，`terminal-risk-and-boundary-guard` 验证拒绝审批不执行；进程退出清理、跨伙伴隔离与真实计算需分别以相关 backend / live case 结果核对，不能合称本 E2E 全覆盖。                                                     |
| `WB-APPLY-005-AC1/AC2/AC3`                                                  | 部分覆盖：`multi-file-apply-tabs` 检查四个文件、逐项点击后的对应内容和列表保留；全部格式/历史记录组合没有逐项 UI 证据。                                                                                                                                                                                                                   |
| `WB-PPT-001-AC1/AC2/AC3/AC4/AC5/AC9/AC10`                                   | 部分覆盖：`ppt-create-diff-and-revert` 和 `ppt-update-diff-interactions` 验证真实创建/编辑；AI `ppt-create-read-edit-commit`、`ppt-professional-element-edit`、`ppt-visual-runtime-contract` 补充结构、元素和保存前失败。公式内部只读与所有非法输入的 UI 证据未全覆盖。                                                                   |
| `WB-PPT-002-AC1/AC2/AC3/AC4/AC5/AC6/AC7/AC8/AC9/AC10/AC11`                  | 部分覆盖：`ppt-update-diff-interactions` 验证前后页、变化/全部缩略图、红绿标记、缩放平移和回退；AI `ppt-diff-slide-and-element-net-semantics` 补充净变化统计。逐页滚动同步等 UI 子项待补。                                                                                                                                                |
| `WB-EXCEL-001-AC3/AC4/AC6/AC7`                                              | backend 补充：AI `excel-create-read-edit` 检查无默认 Sheet1；`excel-edit-operations-and-atomicity` 检查最后 Sheet、冲突和落盘边界；`excel-read-search-and-format-boundaries` 检查读取格式。宏/模板拒绝写入的用户提示与结构冲突的完整矩阵不能由现有 UI 成功链路代替。                                                                      |
| `WB-EXCEL-002-AC2/AC3/AC5/AC6/AC7/AC8`                                      | backend 补充：AI `excel-create-read-edit` 覆盖 AC2/AC3，`excel-edit-operations-and-atomicity` 与 `excel-blank-layout-and-sheet-identity` 覆盖 Sheet 审核结构，`excel-diff-row-structure-semantics`、`excel-diff-cumulative-net-semantics` 覆盖行对齐和净变化；这些是文件内容证据，非全量 UI 渲染验证。Sheet 移动不支持的边界未单列 case。 |
| `ST-VIEW-001-AC5`                                                           | 部分覆盖：`scheduled-task-partner-deletion` 没有定时视图下删除弹窗可见与可操作的独立 Oracle。                                                                                                                                                                                                                                             |
| `ST-LIST-001-AC1/AC3`                                                       | 部分覆盖：`scheduled-task-config-lifecycle` 检查创建后列表、摘要与入口；重开初始化及无任务空态没有明确断言。                                                                                                                                                                                                                              |
| `ST-SWITCH-001-AC2`                                                         | 部分覆盖：`scheduled-task-config-lifecycle` 检查开关值；关闭后等待到点不触发尚无 E2E。                                                                                                                                                                                                                                                    |
