# NCurator-Desktop Workbench 测试计划

## 1. 总体目标

- 本计划定义 Workbench 用户可见交互的回归范围，并对齐 [workbench.md](../prd/workbench.md) 的 `WB-*` 需求和验收编号。
- 通用测试、runner、raw logs、UI E2E 和 live 断言规则遵循 `doc/test.md`。
- Workbench UI E2E 回归测试必须通过真实 Electron UI 配模型、创建伙伴、发送消息、选择 `@` 资料、预览、回退和操作右侧面板。设置页可另加文件地址，但发送不再要求绑定工作空间目录。
- 涉及 AI 的 Workbench UI E2E 回归测试必须使用真实模型调用；测试只从 `AI_LIVE_BASE_URL`、`AI_LIVE_API_KEY`、`AI_LIVE_PRIMARY_MODEL_NAME` 读取 live 配置，并在应用内未配置时通过 Settings UI 新增配置。
- case 因生产行为缺口失败时，不在测试中硬改业务行为，统一记录为产品或生产实现待决项。

## 2. 测试边界

- Workbench UI E2E 回归测试通过脚本在 case 运行时把 `tests/fixtures/workspace` 复制到临时目录；需要文件资料时通过 Settings UI 添加文件地址、检查更新和更新索引。前置始终是创建伙伴；不断言工作区选择器、`.ncurator` 或 `__draft__`。
- Workbench 正式 e2e 不允许直接调用 `workspacePrepare`、直接写模型配置、fake model、fake search、fake docx、fake AI event、fake attachment pick 或固定 document id。
- Workbench e2e 的 workspace 文件索引允许在测试环境通过 `NCURATOR_WORKSPACE_KNOWLEDGE_CACHE=1` 启用真实 split / vector 缓存；缓存只按文件内容 hash、扩展名、splitter 参数和 embedding model 复用计算结果，不替代 workspace 文件记录、document id、搜索结果或 UI 状态。Source E2E 直接共享内容缓存并按 case 隔离统计；Source 与正式包 E2E 在多 case 时都先执行 `warmup` 预热共享 fixture，正式包 E2E 再把缓存种子复制给隔离 case。
- Workbench 模型选择 helper 优先在预设模型区直接选择命中 `AI_LIVE_PRIMARY_MODEL_NAME` 的预设模型；未命中时通过底部「自定义模型」入口进入全部模型视图，按名称搜索选择 `AI_LIVE_PRIMARY_MODEL_NAME`。
- Workbench UI E2E 回归测试需要真实索引完成信号和 UI 可见状态作为等待条件；IPC observer 和 job 查询只能作为辅助证据，不能用来造业务状态。
- `file-preview-actions` 当前按生产真实索引能力覆盖 `pdf/docx/md/txt/xlsx/xlsm/xltx/xltm`：连续打开的文件要分别保留为资源 Tab，并能切回旧 Tab；Excel 普通预览还要覆盖只读、切 Sheet 和拖列宽后预览仍可用。`file-preview-external-change-auto-refresh` 另行覆盖所有实时预览的统一磁盘监听：以普通文本、DOCX、PPTX、XLSX 为代表验证，文件地址内的文件和 `userData/partners/{id}/runtime/assets` 中的真实附件复用同一预览刷新链路；审核 Diff 快照不监听。
- docx apply case 需要真实 docx 输入、真实 AI 编辑、真实写回记录、真实预览和真实回退。
- text-file apply case 需要真实 Markdown 或代码文件、真实 `text_file_edit`、真实结构化 diff、独立 `TextFileDiffViewer` 和按原始 bytes 回退。
- image generation apply case 需要真实模型先学习外置 `image-generation` 技能、真实调用 `image_generate`、生成可解码图片、展示修改入口和图片预览，并完成新建图片回退。
- `browser-use-task-panel` 需要真实 AI run 触发 `browser_use` 并驱动内置浏览器完成本地内容输入与 hover-退出网页任务（observe→actionId act，支持 text 注入）；同时验证多个浏览器 Tab 独立历史、共享持久站点数据、切换文件后网页状态不销毁，以及同 URL 标签不会让 Stagehand 串页，不能用 fake browser 替代。
- `web_search` 单独覆盖：搜索 case 验证 type=search 后 type=fetch 读取网页正文；直接 URL case 验证 type=fetch 读取网页正文后再回答。两类 case 均不得因 `web_search` 自动展开右侧搜索列表（该列表面板已不存在），对齐 `WB-CORE-007-AC4`。Composer 搜索模式与右侧搜索列表面板已删除，废弃 `WB-COMPOSER-004`、`WB-PANEL-002`。
- Workbench 附件链路不限文件扩展名，任何可被文件选择器选中的普通文件都可以添加，不因扩展名拒绝；`+` 和拖放保留源文件绝对路径，粘贴文件保存到 `userData/partners/{id}/runtime/assets/<assetBucketId>/`。`assetBucketId` 为输入草稿 UUID，发送给 AI 时只传附件名称与路径，不再做发送前识图或文件解析；文件是否可被 AI 工具处理由 AI 工具层自行判断。无伙伴时空态 Composer 不接受附件。
- Excel / PPT / DOCX / PDF 工具的输入输出、operation、原子失败与 diff artifact 语义由 AI tool 回归承担；Workbench apply case 只验证真实用户流程、预览入口、审核交互与回退，不重复枚举底层操作矩阵。其中 Excel 工具侧覆盖 `WB-EXCEL-001-AC3`、`WB-EXCEL-001-AC4`、`WB-EXCEL-001-AC6`、`WB-EXCEL-001-AC7`、`WB-EXCEL-002-AC2`、`WB-EXCEL-002-AC3`、`WB-EXCEL-002-AC5`、`WB-EXCEL-002-AC6`、`WB-EXCEL-002-AC7`、`WB-EXCEL-002-AC8`（`WB-EXCEL-002-AC3` 记录/baseline **只在 ai-test 硬断言**）；Workbench e2e 覆盖 `WB-EXCEL-001-AC5`、`WB-EXCEL-002-AC1`、`WB-EXCEL-002-AC4` 用户闭环（UI 可见单入口，不重复硬断言 AC3）。
- DOCX 读取结果和历史结果按递归 children 树展示，Workbench 必须能显示统一的 `nodeId`、visual kind、`imagePath` 和 story；DOCX 写结果复用统一状态展示，普通写入不展示冗余正文，创建操作只展示 `createdIds`。格式操作按 text、paragraph、table、row、cell、section 展示。图片理解统一由 `agent-control` 内置的 `read_image` 把图片加入主模型请求。
- Workbench 历史只展示白名单内的必要 DOCX 字段，不展示 worker、identity 或 replay 内部状态。DOCX 事件以 `nodeId` 定位，PPT 继续使用自己的 `location`，两套协议互不复用。

## 3. Suite 设计

Workbench 顶层 suite 按用户任务闭环划分，不逐一复制 PRD 小节：

1. `conversation`
2. `run`
3. `result`
4. `scheduled-task`

领域规则：

- `conversation` 验证伙伴、composer、时间轴与清空、模型偏好和 `@` 参考资料 token。发送门禁是已有伙伴 + 输入非空。
- `run` 验证智能模式运行中的过程流、持久化恢复、停止、审批、压缩提示和 AI 内置浏览器任务。
- `result` 验证普通文件预览、修改文件工作区、真实 docx 预览、文本 diff、回退和多文件修改入口。不再覆盖 Composer 搜索结果面板。
- `scheduled-task` 验证定时任务的入口、配置保存不建伙伴、到点/立即执行时按需创建专属伙伴、启用开关与往专属伙伴追加任务。
- Workbench 测试全部是 `e2e`，覆盖 Electron、renderer、IPC、真实 AI、右侧面板和文件系统联动。
- 涉及 AI 的 case 必须记录模型、耗时、完成度评分和失败归因；Oracle 引用 [workbench.md](../prd/workbench.md) 的需求或验收编号。
- AI 内置浏览器 case 必须验证右侧浏览器面板、网页操作结果和最终 assistant 输出形成闭环，不能只验证面板出现。
- docx apply 相关 case 必须使用真实 docx 文件验证预览与回退；仅写入 `.docx` 后缀文本文件不满足回归 case 口径。
- 依赖本地文件语义的测试统一复用 `tests/fixtures/workspace` 作为共享输入目录，但该目录只作为真实输入文件来源；运行时通过设置页添加为文件地址，并先创建伙伴。
- `How` 和 `Oracle` 必须映射到 [workbench.md](../prd/workbench.md) 的需求或验收编号。
- `WB-BLOCKER-003`（上下文压缩提示）依赖真实模型使用量与正式压缩阈值触发，运行成本不确定，不作为每次源码回归的固定 case，发布时按影响评估单独执行真实检查，检查运行中与完成态过程组，且不得为 E2E 降低生产阈值或伪造 compaction 事件。

## 4. 目录与命令

Workbench 回归测试目录：

```text
tests/case/workbench/
  conversation/
    partner/
    composer/
    timeline/
    message/
    scope/
  run/
    process/
    blocker/
    browser/
    persistence/
  result/
    preview/
    apply/
  scheduled-task/
```

回归测试命令：

- `pnpm test:workbench`
- `pnpm test:workbench:e2e`
- `node scripts/test/workflow.mjs --domain workbench`
- `node scripts/test/workflow.mjs --domain workbench --type e2e`

补充规则：

- `pnpm test:workbench:e2e` 是 Workbench UI 源码 E2E 回归测试入口。
- 需要验证正式安装包时使用 `pnpm test:e2e:package -- --bundle <release-bundle.json>`；它会校验并安装已构建候选包，再对安装后的真实应用执行 E2E，不重新构建，也不属于普通开发回归。发布时按 `doc/release.md` 的影响评估选择范围，不带过滤参数时执行全部 E2E。
- `conversation / run / result / scheduled-task` 是稳定 suite，不因 PRD 小节增删而轻易重排。
- suite 下的 `partner / composer / timeline / message / scope / process / blocker / browser / persistence / preview / apply` 是 group，只在同一 suite 内用于收敛相近 case。不存在 `search/` 目录。

## 5. 回归测试清单

### 5.1 `conversation`

#### `supported-writeback-format-summary`

- 测试类型：`e2e`
- What：Workbench 右侧空面板明确展示当前支持直接写回的文件格式。
- Why：用户需要区分可直接写回并回退的正式能力与仅可预览或自行尝试处理的格式。
- How：打开 Workbench 并展开右侧空面板，读取可见的支持格式说明。
- Oracle：说明包含 DOCX、PPTX、XLSX、PNG、JPEG、WebP 和 UTF-8 文本，不包含 GIF、SVG，对齐 `WB-CORE-003-AC1`、`WB-CORE-003-AC2`。
- Not：不重复验证各格式的工具实现和回退算法，这些由对应 AI tool 与 Workbench apply case 覆盖。

#### `partner-create-and-name`

- 测试类型：`e2e`
- What：无伙伴时空态、创建弹窗提交即落库、标题就是伙伴名称且不因后续消息改名。
- Why：伙伴是一条一直聊下去的记录；草稿提升或「发第一条才创建」会产生空会话语义。
- How：打开 Workbench 确认无伙伴空态与「创建伙伴」入口；填写名称并选择外形/颜色后提交；再发送两条真实自然语言请求。
- Oracle：无伙伴时 Composer 空态且提供 44px 拖动区，侧栏列表区不展示空态文案，对齐 `WB-CORE-008`、`WB-SESSION-001-AC1`、`WB-CORE-001-AC2`；提交即写入 `partner` 并选中，对齐 `WB-SESSION-001`；创建时选择外形与颜色并对齐 `WB-SESSION-001-AC4`；标题等于伙伴 name 且第二条消息不改名，对齐 `WB-SESSION-003`；创建后尚无消息时侧栏副文案为「做点啥呢？」，发送后更新为最新用户语句预览，对齐 `WB-SESSION-001-AC5`。不存在 `__draft__`，对齐废弃的 `WB-SESSION-001-AC2`、`WB-SESSION-008-AC4`。
- Not：不验证标题手动编辑，也不验证侧栏视觉样式。

#### `partner-delete-confirmation`

- 测试类型：`e2e`
- What：伙伴删除确认，以及取消和确认删除。
- Why：伙伴删除是高风险操作，必须避免误删。
- How：通过真实 Workbench UI 创建伙伴；打开删除确认，分别覆盖取消和确认。
- Oracle：取消删除时伙伴保留；确认删除后伙伴从列表消失，级联清理 log/run/`partner_ui_state` 与浏览器标签，对齐 `WB-SESSION-004`。
- Not：不验证历史伙伴批量管理和跨设备同步。

#### `partner-pin-toggle`

- 测试类型：`e2e`
- What：伙伴置顶与取消置顶，图钉常驻，以及无「已置顶」分组文案。
- Why：置顶是侧边栏高频整理能力，错误排序或丢失状态会打断工作流。
- How：通过真实 Workbench UI 创建两个伙伴；悬停后点击置顶，确认该项排到最上方且图钉常驻；再取消置顶。
- Oracle：置顶后排到列表最上方、图钉无需悬停也可见、不出现「已置顶」文案，对齐 `WB-SESSION-009`。不再按工作空间分组。
- Not：不验证拖拽排序，也不验证跨设备同步。`WB-SESSION-009-AC4`（置顶重启持久化）标为不测。

#### `partner-edit`

- 测试类型：`e2e`
- What：侧栏编辑入口复用创建弹窗，保存后更新名称与形象。
- Why：伙伴名称和形象应可改，且不能误建成新伙伴或清掉对话。
- How：创建伙伴后悬停点击编辑，修改名称和外形后保存。
- Oracle：弹窗为「编辑伙伴」并预填原值；保存后仍是同一伙伴 id，侧栏显示新名称，对齐 `WB-SESSION-012`。
- Not：不验证颜色全量组合，也不走真实 AI 发送。

#### `workbench-help-entry`

- 测试类型：`e2e`
- What：Workbench 左侧使用帮助入口。
- Why：帮助入口必须独立于伙伴创建和模型运行保持可用。
- How：打开 Workbench，点击帮助入口并观察外链调用和当前路由。
- Oracle：入口可访问，打开官方中文手册且不改变当前伙伴路由，对齐 `WB-COMPOSER-011`。
- Not：不验证系统浏览器窗口样式。

#### `sidebar-app-update`

- 测试类型：`e2e`
- What：Workbench 左侧更新入口的可见性、下载进度、失败重试和重启操作。
- Why：日常更新入口必须保持紧凑、状态准确，并且不与旧设置入口重复。
- How：用更新 fixture 驱动无更新、可下载、下载中、下载完成和失败状态，并检查旧设置路由。
- Oracle：无更新时入口隐藏；用户点击后才下载；下载中显示进度；下载完成可稍后或重启；失败可重试；旧设置路由回到大模型页。对齐 `WB-COMPOSER-012-AC1`、`WB-COMPOSER-012-AC2`、`WB-COMPOSER-012-AC3`。
- Not：不覆盖数据库版本过高的启动恢复模式，也不证明真实安装包下载、签名或安装成功。

#### `database-version-update-required`

- 测试类型：`e2e`
- What：数据库版本高于当前应用支持版本时的仅更新恢复模式。
- Why：旧应用误开新 schema 数据库时，必须先升级应用，不能初始化业务层继续读写。
- How：先启动应用创建正式 schema，再关闭应用，在同一隔离 `userData/app.sqlite` 的合法迁移前缀后写入更高版本记录并重启，通过真实主进程版本检查进入恢复页；继续用更新 fixture 验证自动检查、下载、失败和重启安装。点击「前往官网下载」后除记录 renderer 调用外，还等待 `openExternalResult` 并断言 IPC 返回成功。
- Oracle：只显示恢复页及本机数据库版本和当前应用支持版本，Workbench 不存在；恢复页提供下载、重启安装、中文失败提示、官网下载页和退出入口，点击官网入口时 `open-external` 必须真正成功；底层英文错误不直接展示，失败后仍不能进入业务界面。对齐 `WB-COMPOSER-012-AC4`、`WB-COMPOSER-012-AC5`。
- Not：启动前数据库 fixture 只制造“未来 schema version”，不绕过或替换生产版本检查；更新 fixture 不证明真实安装包下载、签名、安装成功或安装后数据库兼容。

#### `context-ring-usage`

- 测试类型：`e2e`
- What：智能模式上下文用量在 run 后刷新，并可查看已用与剩余比例。
- Why：用量提示错误会误导用户对后续可用上下文的判断。
- How：完成一次真实 AI run，读取圆圈可访问名称和 hover 提示。
- Oracle：圆圈展示已用与剩余信息，hover 展示百分比，对齐 `WB-COMPOSER-008`。
- Not：不验证 token 估算器的逐 token 精度。

#### `send-guard-and-preferences`

- 测试类型：`e2e`
- What：缺少模型时的配置提示、发送前置条件（已有伙伴 + 输入非空），以及模型 / AI 推进偏好 / 执行权限按伙伴恢复；创建伙伴后真实发送一次并完成 AI 运行。
- Why：Workbench 的任务入口依赖这些基础交互；任一状态失真都会导致用户无法发起任务或把任务发到错误伙伴。原独立 case `partner-required-to-send` 与本 case 等价，已并入此处，避免双倍 live。
- How：先在无模型配置状态下检查提示，再通过 UI 配置真实模型并创建伙伴；覆盖无伙伴空态、输入保留、模型选择、AI 推进偏好、执行权限菜单的两条说明与完全访问高危风险弹窗确认/取消门禁、切换伙伴后的独立恢复和真实发送（Composer 提交，含 Enter 发送路径）。Composer 不再有 AI / 搜索切换，也不再有工作区选择器。
- Oracle：无模型时快速显示配置提示；无伙伴时 Composer 空态且不出现发送按钮，对齐 `WB-CORE-001-AC2`、`WB-COMPOSER-001`（无伙伴空态 **只在本 case 硬断言**）；有伙伴、未插 `@` 且输入非空时可发送，对齐 `WB-CORE-001-AC1`；发送走 Composer 提交并完成真实 AI 运行，对齐 `WB-COMPOSER-002-AC1`、`WB-CORE-006-AC1`；权限菜单同时展示“审核 / 涉及到风险操作需要你审核”和“完全访问 / 不受限制的操作你的电脑”；切换“完全访问”触发风险二次确认弹窗（取消维持审核、确认切换成功，切回审核免二次确认），对齐 `WB-COMPOSER-007-AC13`；模型、推进偏好和执行权限按伙伴恢复，对齐 `WB-MODE-001-AC1`、`WB-COMPOSER-007-AC5`、`WB-COMPOSER-007-AC9`、`WB-COMPOSER-007-AC12`、`WB-SESSION-008`。废弃的 `WB-COMPOSER-005`、`WB-MODE-001-AC2`、`WB-MODE-002`、`WB-MODE-003` 不测。
- Not：不验证真实模型回答质量，只验证用户路径和发送前置条件。Composer 已删除搜索模式，不再测智能 / 搜索互斥。`WB-COMPOSER-001-AC3`（有伙伴时 hover 禁用原因）、`WB-COMPOSER-007-AC6`（失效模型回退）、`WB-COMPOSER-007-AC11`（偏好写入 run 上下文）标为不测。`WB-COMPOSER-002-AC2`、`WB-COMPOSER-002-AC3`（Shift+Enter 换行、中文输入法组词）标为不测。`WB-CORE-006-AC2/AC3/AC4` 由 AI live 承担。

#### `partner-ui-state-isolation`

- 测试类型：`e2e`
- What：A/B 伙伴分别保存 Composer（包括执行权限）、资源标签、活动标签和展开状态，反复切换互不覆盖。
- Why：伙伴状态串联会让用户把输入、模型或资料发到错误上下文。
- How：给两个真实伙伴设置不同偏好、执行权限、模型、输入、引用、附件和右侧内容，通过真实伙伴列表来回切换。不断言工作区选择器或搜索模式。
- Oracle：每次切回只出现目标伙伴自己的完整 `partner_ui_state`，执行权限与其他 Composer 状态分别恢复，对齐 `WB-SESSION-002`、`WB-SESSION-008-AC1`、`WB-SESSION-008-AC2`。
- Not：不验证跨设备同步。

#### `partner-ui-state-restart-persistence`

- 测试类型：`e2e`
- What：正常关闭并使用同一用户目录重启后，恢复最后活动伙伴及其完整 UI 状态。
- Why：只在内存中隔离会导致用户重启后看到错误伙伴或丢失未发送工作。
- How：保存伙伴和未发送草稿状态，正常退出应用，再用相同 `NCURATOR_USER_DATA_PATH` 启动并读取界面。
- Oracle：最后活动伙伴、Composer、右侧面板和浏览器 URL / 历史 / 缩放均恢复，对齐 `WB-SESSION-008-AC3`、`WB-PANEL-004-AC12`。`workbench_ui_state` 只恢复 `active_view_key`，无 `draft_state_json`。
- Not：不要求恢复页面 JS、内存滚动或未提交表单。

#### `background-partner-ui-event-isolation`

- 测试类型：`e2e`
- What：A 伙伴的延迟 AI 或浏览器事件在用户切到 B 后只更新 A。
- Why：后台事件晚到时若按当前页面写状态，会无声覆盖用户正在操作的另一伙伴。
- How：在 A 启动受控延迟事件，完成前切到 B；事件完成后检查 B，再切回 A。
- Oracle：B 的 Composer 和面板不变化，A 显示延迟结果，对齐 `WB-SESSION-008-AC2`。
- Not：不评价模型回答质量。

#### `model-selector-and-provider-error`

- 测试类型：`e2e`
- What：主模型选择只展示已配置服务商的预设模型，未配置服务商不展示并在无已配置预设服务商时显示空态；推荐配置默认选中预设稳定调用名；预设行含竖向不重叠价格档位图标；不可用预设禁用；自定义入口可选中 remote id 且不被强制改回预设；自定义视图无信息侧栏，并正确展示 provider 错误反馈。
- Why：主模型配置是智能任务能否启动的直接前提，预设区是用户首选的模型入口。
- How：通过真实设置页配置 live 推荐/自定义模型；回到 Workbench 展开选择器，检查未配置预设隐藏与空态、默认展示名为预设 label 而非 remote 带日期 id、预设行档位图标与侧栏字段、不可用预设禁用文案；进入自定义模型视图确认无侧栏、按名称搜索并选中后 pill 保持该模型名，随后完成一次真实请求并触发受控 provider 错误。
- Oracle：未配置预设模型不展示且无已配置预设服务商时显示空态，对齐 `WB-COMPOSER-007-AC2`、`WB-COMPOSER-007-AC3`；自定义入口和分组搜索对齐 `WB-COMPOSER-007-AC1`；默认选中、自定义选中不被强制改回预设与展示对齐 `WB-COMPOSER-007-AC4`；选择器只保留主模型且视觉能力仅在侧栏说明，对齐 `WB-COMPOSER-013-AC1`；伙伴保存 `configId + modelName`，对齐 `WB-COMPOSER-007-AC4`；provider 失败只请求一次，气泡短标题为「模型请求失败」，「查看详情」可见 HTTP/原文，对齐 `WB-COMPOSER-007`、`WB-CORE-006`、`WB-SESSION-007-AC8`。`WB-COMPOSER-007-AC14`（免费模型目录拼装与刷新）标为不测。
- Not：不评价模型回答质量。

#### `user-message-actions`

- 测试类型：`e2e`
- What：用户消息 hover 操作、latest turn 编辑撤回、running 态编辑入口隐藏，以及用户消息附件展示。
- Why：用户编辑上一条消息依赖撤回最新 turn、回填 composer 和附件 UI 协同；任一状态错误都会导致重复发送、误编辑运行中消息或附件被正文挤压遮挡。
- How：使用真实 Workbench UI 创建伙伴，必要时通过设置页添加文件地址；真实粘贴图片和 `md` 附件并发送 AI 请求；hover 用户消息并触发复制与编辑；在 running 状态检查用户消息气泡和附件布局。首条用户消息应可见居中时间条。
- Oracle：hover 后显示复制和编辑、不含时间；复制给出成功反馈；编辑会撤回最新 turn（含该 run 的 digest / 判定 / discard 书签）并回填原草稿，running 状态不显示编辑，对齐 `WB-SESSION-006`；首条用户消息上方居中时间条对齐 `WB-SESSION-013-AC1`、`WB-SESSION-013-AC5`；附件独立展示在消息气泡上方（条宽可宽于气泡、卡片顶边不被横滑容器裁切，规格与输入框附件卡对齐），输入框附件关闭按钮可点击且不被遮挡。
- Not：不验证模型回答质量；附件输入通过真实保存与传递链路进入产品。不在本 case 制造跨日或 30 分钟间隔（`WB-SESSION-013-AC2`、`WB-SESSION-013-AC3`、`WB-SESSION-013-AC4` 由 unit `message-time-label` 覆盖）。

#### `composer-attachments-context`

- 测试类型：`e2e / live`
- What：`+`、粘贴与拖入中间聊天区添加附件时，图片只以路径和元数据进入伙伴消息记录，常规文档和非白名单扩展名也能加入，并保持图片预览、文件打开、删除、普通文本粘贴和大文件提示行为。粘贴保存到伙伴 runtime assets。
- Why：`+` 与拖放必须把源文件路径交给 AI，粘贴仍需保存副本，回归必须守住这两条不同链路。
- How：创建伙伴；需要文件资料时通过设置页添加文件地址；通过系统文件窗口选择图片和多种文件，覆盖拖入、删除后重新添加图片、大文件 warning，并通过真实模型发送一次带附件消息；发送后读取 `ai_run` 与 log 投影消息。
- Oracle：文件拖入中间聊天区时显示覆盖层，放下后消失；无伙伴时不添加附件；`+` 选择的文件保留原始源路径；粘贴文件落到 `userData/partners/{id}/runtime/assets/`；图片预览和删除正常；发送后图片附件仍是路径，持久消息不含 Base64，对齐 `WB-COMPOSER-010`、`WB-COMPOSER-013-AC2`、`WB-COMPOSER-013-AC3`；运行时缓存、HTTP(S) 原地址和失效占位由 AI tool 契约覆盖，对齐 `WB-COMPOSER-013-AC4`。
- Not：不在跨平台业务回归中验证系统原生文件选择器的视觉细节；不通过 `attachmentPickResponse` 或直接 `attachmentSaveFile` 伪造附件结果。

#### `reference-mention-keyboard`

- 测试类型：`e2e`
- What：`@` 候选列表使用方向键移动时，当前高亮项能停在移动后的选项，不会因候选刷新跳回第一项。
- Why：`@` 候选选择依赖键盘稳定性；高亮项被刷新会导致用户插入错误资料范围。
- How：通过真实 Settings / Workbench UI 创建伙伴，并在设置页添加真实文件地址；在 composer 输入 `@` 打开候选列表，按 `ArrowDown` 后观察 active 候选项。
- Oracle：候选项数量大于 1；按下方向键后 active 候选项发生变化，并在短暂停留后保持不变，对齐 `WB-SCOPE-002-AC1`。
- Not：不验证 AI run 或底层检索质量。

#### `reference-token-lifecycle`

- 测试类型：`e2e`
- What：`@` 参考资料候选覆盖全部文件地址的当前真实本地目录 / 文件与全局网页资料、目录 / 文件 / 网页 token 插入、多 token 共存、键盘删除、去重和空候选提示。
- Why：显式参考资料是用户控制 AI 上下文的核心入口；未 `@` 时知识库默认全部已索引文件地址 + 全局网页。
- How：创建伙伴；通过设置页添加 `tests/fixtures/workspace` 为文件地址，等待真实文件扫描并准备索引状态；添加真实 web source 并等待真实网页索引完成；随后直接在该目录磁盘中新建文件，不触发“检查更新”或“更新索引”；输入 `@` 触发最多两级路径的平铺候选（每页最多 50）；选择文件、目录、网页均为点击即插入；同一资料才去重；通过 Backspace 删除 token。对话里不再切换工作空间，因此不测跨工作区清理。
- Oracle：候选来源和发送范围对齐 `WB-SCOPE-001`（含两级平铺与分页 `AC2`/`AC4`）、`WB-CORE-002`、`WB-CORE-004-AC1`；真实目录与新增未索引文件对齐 `WB-SCOPE-001-AC3`；token 插入、共存、发送参数、键盘删除和图标对齐 `WB-SCOPE-002`；去重和空候选对齐 `WB-SCOPE-003`、`WB-SCOPE-004`。废弃的 `WB-BLOCKER-002` 不测。
- Not：不验证底层 KB 检索排序质量，也不验证 Settings 文件地址配置细节。`WB-CORE-004-AC2`、`WB-CORE-004-AC3`（宽松补充 vs 严谨缺口）由 AI live 承担。

#### `right-panel-layout-and-tabs`

- 测试类型：`e2e`
- What：空伙伴输入区布局、右侧默认无占位折叠、标签栏密度与折叠入口、Tab 溢出滚动、伙伴级标签和展开状态恢复、中间|右分隔条拖拽与阈值吸合、窗口缩放时主区比例同步、浏览器缩放菜单、地址栏“前往”与“将打开外部浏览器”按钮。
- Why：右侧资源工作台和聊天输入区共享窗口高度与标题栏命中区域，普通功能测试无法发现输入框被推出窗口、折叠按钮放错区域、Tab 无法滚动、分隔条拖拽/吸合失效或原生浏览器遮挡浮层等视觉交互回归。
- How：直接进入真实 Workbench，先确认无伙伴空态右侧 shell 不存在并测量输入区位置；创建伙伴后展开右侧，拖拽中间|右分隔条确认宽度实时变化，拖至阈值以下确认立即吸合折叠；拉宽窗口确认中间与右侧按同一比例同步变宽；在 A/B 伙伴分别创建不同标签并设置不同活动标签和展开状态，来回切换；再连续创建八个浏览器 Tab 验证滚动和菜单。
- Oracle：各伙伴恢复自己的标签、活动状态和展开状态；右侧宽度比例、分隔条与吸合对齐 `WB-PANEL-001-AC10`（含 macOS 窗口边缘 live-resize 限帧与缩放期关闭面板 transition）；无消息时输入区保持居中，有消息后输入区固定在主区底部，对齐 `WB-COMPOSER-009-AC11`；其余布局、动画、滚动和菜单要求不变，对齐 `WB-PANEL-001`、`WB-SESSION-008`。
- Not：不验证公网网页、模型回答质量或系统窗口按钮本身；Stagehand targetId、共享持久分区和历史恢复继续由 `browser-use-task-panel` 覆盖。

#### `windows-empty-titlebar-drag-region`

- 测试类型：`e2e`
- What：Workbench 无伙伴空态的窗口拖动区和原生标题栏不遮挡空态文案或右侧入口。
- Why：窗口层级错误会让首屏无法拖动或按钮无法点击。
- How：在可见窗口测量原生标题栏、拖动区和无伙伴空态区域，点击关键入口。
- Oracle：业务内容从标题栏下方开始，交互元素位于 `no-drag` 区，无伙伴空态仍提供 44px 拖动区，对齐 `WB-PANEL-001`、`WB-CORE-008`。
- Not：不验证系统窗口管理器的实际移动动画。

#### `timeline-day-jump`

- 测试类型：`e2e`
- What：有消息后时间轴出现「今天」日节点；点击跳到当天最早一条消息；时间轴无独立滚动；已在可视区时点击不带动侧栏/Composer；节点固定间距贴底。Composer 左侧 gutter 不足时进入紧凑态（仅圆点，悬浮 Tooltip）；gutter 足够时即使右侧面板展开也不收起。
- Why：伙伴是一条一直聊下去的记录，用户需要按日定位；月/年用 DatePicker 选天，不再展开子节点；挤不挤取决于轴文案可用 gutter，而非面板开关。
- How：创建伙伴并完成一次真实 AI run（当天消息）；打开时间轴，记录侧栏/Composer/消息列表位置后点击今天日节点；对「仅今天」时间轴截图，核对轴线底端靠近输入框顶部、顶端与顶栏留空、由下向上渐隐。把中间栏收窄到 Composer 左侧 gutter 小于 72px 后确认 `data-compact=true`；再拉宽至 gutter 充足确认恢复完整态。月/年聚合与可选日集合（`WB-SESSION-010-AC2`、`WB-SESSION-010-AC5`）由 unit `message-timeline` 覆盖；滚顶懒加载与轴不独立滚动（`WB-SESSION-010-AC4`）沿用消息区既有懒加载，本 case 断言轴容器无独立滚动条。跨月假数据本机用 `scripts/dev/seed-partner-timeline.mjs` 灌入后真机截图核对固定间距与搜索图标。
- Oracle：时间轴可见且含「今天」、无空的昨/前天；点击今天后将该天最早一条贴到消息列表顶部；轴自身无独立滚动；侧栏与 Composer 位置不变，对齐 `WB-SESSION-010-AC1`、`WB-SESSION-010-AC2`、`WB-SESSION-010-AC3`、`WB-SESSION-010-AC4`、`WB-SESSION-010-AC5`、`WB-SESSION-010-AC6`、`WB-SESSION-010-AC7`（轴线止于最新节点、不向下突出）、`WB-SESSION-010-AC8`（按 gutter 宽度紧凑，不强制跟面板）。
- Not：不在 E2E 里直接写 SQLite / 伪造系统时钟灌跨月数据；不验证压缩算法。

#### `context-clear-capsule`

- 测试类型：`e2e`
- What：伙伴有消息且空闲时出现「清空消息记录」胶囊；hover tooltip 含伙伴名与无法恢复说明；点击先确认，取消不删；确认后消息列表为空，仍停留在同一伙伴，草稿不变。
- Why：用户需要可理解的「清空对话」动作：确认后消息列表为空，下次发送不再带旧上下文；切换伙伴后只要仍有消息也应能清空。
- How：创建伙伴并完成一次真实 AI run；检查胶囊文案与 tooltip；点击胶囊后取消确认并断言消息仍在；再点胶囊并确认清空；断言消息为空、仍在同一伙伴、输入草稿不变。运行中不得出现清空入口。
- Oracle：有消息且空闲时可见对齐 `WB-SESSION-011-AC8`；确认后列表为空对齐 `WB-SESSION-011-AC1`；不换伙伴 / 草稿对齐 `WB-SESSION-011-AC2`；下次发送无旧上下文对齐 `WB-SESSION-011-AC3`（由清空后 message log 为空保证）；运行中不可用对齐 `WB-SESSION-011-AC4`；文案与 tooltip 对齐 `WB-SESSION-011-AC5`；确认框取消/确认对齐 `WB-SESSION-011-AC6`。
- Not：不验证 compaction；不在本 case 制造文件回退记录（`WB-SESSION-011-AC7` 由 unit `clear-partner-context-deletes-messages-and-runs-keeps-file-changes` 覆盖）。

### 5.2 `run`

#### `ai-process-stream-and-final-answer`

- 测试类型：`e2e`
- What：智能模式真实发送后，验证 Thought / Activity 过程层渲染与最终 markdown 收口（过程流主 case）。
- Why：重构后过程层是用户扫进度的主界面；需覆盖 Activity 折叠 header、展开平铺、学习/工具统一渲染，以及最终回答，而不是只断言“有过程块”。
- How：真实文件地址内准备带唯一事实的文件；先创建伙伴；用户通过 UI 发送自然语言总结请求；等待真实 AI run 完成；展开全部 Activity 面板并采集 header / body 文案。
- Oracle：用户消息与 assistant 过程流逐步出现，对齐 `WB-COMPOSER-003-AC1`、`WB-COMPOSER-003-AC2`；用户与 assistant 消息不展示头像，用户消息右对齐气泡，assistant 过程流/最终输出与 composer 内容 rail 对齐，最终 markdown 无独立背景卡片，对齐 `WB-COMPOSER-009-AC1`、`WB-COMPOSER-009-AC2`、`WB-COMPOSER-009-AC3`、`WB-COMPOSER-009-AC4`。运行中过程流可见，且“正在重试”与“让俺想想”不同时出现；“让俺想想”在 Brain 请求期间于过程区最下方展示，run 完成 / 失败 / 取消或产出正文后过程区不得仍挂着“让俺想想”，对齐 `WB-COMPOSER-003-AC3`。决策层（Thought）短摘要可见且不暴露原始长推理，以浅灰文本展示，未超出单行时不展示折叠图标，超出单行时单行省略，hover 时展示展开图标且垂直居中于单行文本，展开后常驻浅灰卡片背景、折叠按钮居顶对齐第一行并在内部滚动，对齐 `WB-COMPOSER-003-AC5`、`WB-COMPOSER-009-AC10`。若本轮确有可见工具调用：至少一块 Activity（`details` + summary + 展开行）；summary 为工具独立维护的 header 短句汇总（可独立成句，不携带命令参数/路径/query，不得出现展开行半截连词如「查看页面并」），根据单一动作或混合工具精准呈现对应专属语义图标（浏览器打开/查看/操作/提取/截图/滚动/标签、网页抓取/搜索、图片读取/生成或工作流闪电图标；截取页面并读取图片的成对视觉动作统一呈现为照片图标，不退化为闪电；浏览器操作不产生审批卡片与展开行审核绿勾）；展开行为带对象的工具原句且不含冒号强调；两次 Thought 之间的工具合并为 Activity，对齐 `WB-COMPOSER-003-AC6`、`WB-COMPOSER-009-AC5`、`WB-COMPOSER-009-AC6`、`WB-COMPOSER-014-AC5`、`WB-BLOCKER-001-AC8`。Header：按工具 UI 类型归并；同类多次为「短句 N 次」；归并后 ≤3 类用逗号 `,` 拼接（两侧无空格）；>3 类 summary 为「已完成 n 项」。若事件含 `learn_skill`：展开行文案含“正在学习 / 已学会”，且不作为独立学习层；若含 docx 工具：展开行文案含“Word 文档”；对齐 `WB-COMPOSER-009-AC8`、`WB-COMPOSER-009-AC9`、`WB-COMPOSER-009-AC10`。文件名、query、命令、URL 和技能名不使用粗体或冒号强调，对齐 `WB-COMPOSER-009-AC7`。过程区不出现最终收尾等待文案（如“让俺收尾”），最终回答直接流式收口，对齐 `WB-COMPOSER-003-AC4`、`WB-COMPOSER-014-AC1`、`WB-COMPOSER-014-AC2`。证据引用与 terminal 状态规则仍由同域其他 case / AI suite 覆盖，本 case 保持 `WB-COMPOSER-003-AC8`、`WB-COMPOSER-003-AC9` 的过程流兼容边界（不因过程层重构破坏）。自动重试与截断提示、计划进度环等由相关运行态 case 覆盖并继续对齐 `WB-COMPOSER-014-AC3`、`WB-COMPOSER-014-AC4`。最终 markdown 围绕工作区事实（Alice/Bob）且不裸露 chain-of-thought，对齐 `WB-CORE-005`、`WB-CORE-006`。仅切换伙伴或新建干净对话时不得凭空出现“正在 / 已检索知识库”，对齐 `WB-COMPOSER-009-AC12`。
- Not：不对最终文案逐字断言；不把真实模型是否调用某工具误归因为 UI bug（工具相关断言均以本轮实际事件为条件）。

#### `terminal-background-service-flow`

- 测试类型：`e2e`
- What：真实 AI 使用终端启动本地 HTTP 服务、让出控制权、通过内置浏览器验证页面。
- Why：终端后台服务、浏览器联动和进程清理的完整用户路径，静态事件或 fake tool result 无法覆盖。
- How：在真实临时目录创建带唯一标记的 HTML，经设置页添加为文件地址并创建伙伴；通过可见 Electron Workbench 发送请求，真实审批 terminal 命令，使用真实 PTY 启动 Python HTTP server，真实 browser_use 打开页面。
- Oracle：事件包含 terminal_command_yielded、terminal_run 和 browser_use；最终答复包含页面唯一标记；不存在 fake AI/tool/browser 信号。
- Not：不依赖公网，不允许测试进程替 AI 启动目标 HTTP 服务。

#### `terminal-unicode-file-list`

- 测试类型：`e2e`
- What：终端在当前平台处理 Unicode 路径和文件列表。
- Why：中文路径是 macOS 与 Windows 用户的常见场景，编码错误会直接破坏终端任务。
- How：在真实文件地址创建 Unicode 文件名，通过真实终端读取目录并返回结果。
- Oracle：终端结果保留 Unicode 文件名，任务完成后无乱码或跨伙伴泄漏，对齐 `WB-TERMINAL-001`。
- Not：不覆盖全部 shell 命令策略。

#### `run-navigation-snapshot-replay`

- 测试类型：`e2e`
- What：真实 AI 输出过程中切到 Settings，完成后回到 Workbench 能通过伙伴消息记录投影恢复过程流和最终 assistant 回答。
- Why：Workbench route 切换会导致 renderer 重新挂载；如果运行态只存在 renderer 内存中，用户离开页面后会丢失 AI 过程和最终回答。
- How：通过 UI 配置真实模型、创建伙伴，必要时添加文件地址；发送真实 AI 请求，等待过程流出现后切到 Settings；停留到 AI run 完成，再回到 Workbench 读取恢复后的过程流和最终回答。
- Oracle：切换后恢复目标历史、过程流、最终回答和自身运行态，上一伙伴状态不泄漏，对齐 `WB-SESSION-002`；run event 包含 `answer_completed` 与 `run_completed`，对齐 `WB-COMPOSER-003-AC7`。
- Not：不覆盖审批等待恢复；审批恢复由 `approval-batch-flow` 覆盖。

#### `session-skill-memory-persistence`

- 测试类型：`e2e`
- What：同一伙伴的多轮 AI run 能复用已学习的技能并继续上一轮任务主线。
- Why：续做不能丢失已有上下文，也不能每轮重复学习同一技能。
- How：通过真实 Workbench UI 完成两轮请求，检查两轮 human steps、工具选择和最终结果。
- Oracle：第一轮学习 `docx-read` 技能；第二轮不重复 learning 且能使用该技能继续读取文档；两轮结果均完成，对齐 `WB-SESSION-005-AC1`、`WB-SESSION-005-AC2`。
- Not：不替代 AI backend 对技能图和 memory store 的契约测试。无关新诉求丢弃旧对话原文、相关追问续做、未完成上一轮仍带历史，由 AI `human-context-scope-decision-live` / `context-scope-incomplete-run` 覆盖，对齐 `WB-SESSION-005-AC3`、`WB-SESSION-014-AC1`、`WB-SESSION-014-AC2`、`WB-SESSION-014-AC3`、`WB-SESSION-014-AC4`；用户侧无新的记忆指示或会话切换控件。

#### `approval-batch-flow`

- 测试类型：`e2e`
- What：真实 AI 运行中触发需审批 terminal 操作后，审核模式下 composer 上方审批卡片的同意、拒绝和指导输入流程，以及完全访问模式下的自动执行。
- Why：审批是高风险 terminal 执行的用户确认边界；UI 误执行或误恢复都会破坏安全约束。
- How：通过真实用户请求诱导 AI 产生需要审批的 terminal 操作；审核模式分别覆盖全同意、任一拒绝、填写指导输入和不操作期间保持等待；完全访问在新 run 中执行同类命令。
- Oracle：审核模式下整批同意后按原 serial 顺序继续，对齐 `WB-BLOCKER-001-AC1`；任一拒绝或填写指导输入时本批命令 0 执行并回到后续 AI 决策，对齐 `WB-BLOCKER-001-AC2`；指导输入不作为独立第三按钮，对齐 `WB-BLOCKER-001-AC3`；审批不因固定超时自动失败，对齐 `WB-BLOCKER-001-AC4`；完全访问下文件实际创建且没有审批事件、等待状态或审批卡片，对齐 `WB-BLOCKER-001-AC5`；等待时 Activity header 为「等待用户审核中」且无 blockers/toast，审完后工具行前缀结果图标且悬停揭示解释文案，对齐 `WB-BLOCKER-001-AC6`、`WB-BLOCKER-001-AC7`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证 terminal 工具安全指令集本身，该能力归 AI tool 测试。

#### `stop-running-or-approval-run`

- 测试类型：`e2e`
- What：智能模式运行中底部发送按钮切换为停止图标，并能取消普通长任务和审批等待。
- Why：用户需要可靠中断长任务；审批等待时停止若不能释放等待会造成运行态卡死。
- How：E2E 发送真实长任务和审批等待请求，运行中点击停止。
- Oracle：运行中发送按钮和取消反馈对齐 `WB-COMPOSER-006`（含 `browser_use`/Stagehand 执行中须立刻结束，对齐 `WB-COMPOSER-006-AC4`），伙伴运行标记对齐 `WB-SESSION-002-AC5`；用户停止后 run 标记为 `user_cancelled`，后续消息只靠日志继续，对齐 `WB-SESSION-007-AC1`。
- Not：不覆盖 Graph 运行上限；上限触发与恢复由 `interrupted-task-resume-flow` 覆盖。

#### `interrupted-task-resume-flow`

- 测试类型：`backend contract + real-model e2e`
- What：同一伙伴中的任务因达到 Graph 运行上限等原因中断后，从不可变消息日志恢复，并在用户后续消息中继续原任务。
- Why：恢复能力必须经过真实 Workbench、真实模型、Main 进程、持久化和 Renderer 的完整链路验证，不能只依赖 Mock LLM。
- How：真实模型 E2E 把首轮 Graph 上限降为 2，验证上限错误后发送继续语句；第二轮恢复正式上限并完成。Backend 覆盖日志投影、相同 `tool_call_id` 修复、计划投影、`compaction_checkpoint` 边界、重启标记、跨伙伴隔离、编辑和删除。
- Oracle：全部中断原因均可只靠日志继续；恢复语句只追加一次，历史 user 配置不变；未压缩时为历史过程 + 尾部新 user，已压缩时为 Compact User + 还没压进摘要的原文（可空）+ 尾部新 user；连续多次恢复不递归嵌套原始任务；切换伙伴或重启后只投影所属日志；编辑只撤回目标 user、关联 assistant/run 和该 run 全部日志（含 digest 与 discard 书签），不回滚已写文件；正常完成清空计划但保留日志；真实模型首轮显示“已达到运行上限，可继续对话推进”且第二轮恢复完成；失败气泡短标题 +「查看详情」保留原文，对齐 `WB-SESSION-007-AC1`、`WB-SESSION-007-AC2`、`WB-SESSION-007-AC3`、`WB-SESSION-007-AC4`、`WB-SESSION-007-AC5`、`WB-SESSION-007-AC6`、`WB-SESSION-007-AC7`、`WB-SESSION-007-AC8`。
- Not：不使用真实模型执行 200 个 Graph 步骤或调用 120 次真实工具；测试覆盖参数不能通过产品正常请求传入，也不改变工具软上限语义。

#### `cancelled-run-keeps-artifact`

- 测试类型：`e2e`
- What：文件修改已经落地后取消运行，终态仍保留普通取消文案、修改文件入口和审核模式。
- Why：取消只应停止后续 AI 执行，不能隐藏已经发生的文件修改，否则用户无法检查和回退副作用。
- How：真实 AI 使用 `text_file_edit` 修改 Markdown，等待 `file_artifact` 后点击停止，再打开本轮修改记录。
- Oracle：assistant turn 显示不含 Markdown 标记的“已取消”；修改文件入口仍存在；文件内容已经更新；文本审核模式可打开。
- Not：不验证进程被强杀后的恢复。

#### `browser-use-task-panel`

- 测试类型：`e2e`
- What：AI 通过内置浏览器完成网页任务时，文件 / 多浏览器 Tab、独立页面导航、持久站点数据和真实网页操作结果形成闭环；并验证 `observe → act(actionId)`（含文本输入和 hover 后出现的退出入口）。
- Why：内置浏览器是 Electron 与 AI run 深度联动场景，仅 backend 或静态事件无法覆盖视口嵌入、导航和最终收口问题；Stagehand 需以 observe 规划、actionId 确定性执行为主路径，且支持文本输入直接注入。
- How：先打开真实 Markdown 文件，再让 AI 使用 `browser_use` 操作本地测试页（在操作备注输入框输入内容 + 诱饵角色切换 + hover 消息图标才出现「退出登录」）；AI Run 仍在进行时，用户通过 `+` 新建另一个浏览器标签并折叠右栏，验证后续 observe / act / extract 在后台继续操作原目标；任务完成后展开右栏并切回 AI 浏览器标签，再切换文件和浏览器检查状态保持。
- Oracle：`navigate` 结果含 `tabId`；后续 observe/act 必带该 `tabId`；`act` 使用 `actionId`，支持输入类动作注入 `text` 参数；observe actions 含 `actionId/method/description/arguments/selector`；折叠期间原浏览器 `webContents` 不销毁且 AI 能完成输入、hover 与退出，展开后同一个 `webContents.id` 直接显示最新包含退出口令与备注内容的 `LOGOUT_OK_*` 结果；操作期间光标常驻且仅在 AI Run 结束时释放隐藏；对齐 `WB-PANEL-004`、`WB-PANEL-004-AC13`。
- Not：不验证公网网页稳定性；本 case 使用本地测试网页减少外部波动；不允许用 fake browser 或 fake tool result 替代；不要求 live 模型必须在固定时限内结束整轮最终回答，只要真实内置浏览器已完成退出并出现口令即可判定 browser panel 能力有效。

#### `browser-view-lifecycle`

- 测试类型：`e2e`
- What：内置浏览器原生视图在初次显示、面板折叠、原生自绘菜单、伙伴切换以及分栏拖拽调整后仍可见、尺寸稳定且持续运行，包括切走的伙伴面板同样处于展开状态后切回的呈现恢复。
- Why：`WebContentsView` 由 Main 管理并覆盖在 Renderer 上方；生命周期或 bounds 同步错误会导致白屏、原生视图遮挡菜单、恢复后尺寸跳变，或切换伙伴时误销毁仍在运行的网页。分栏拖拽期间高频更新 bounds 会导致 Windows DirectComposition 下原生视图原点跑偏且旧画面错位遮挡对话区，松手时的 CSS transition 补间动画会导致半秒滞后。分栏拖拽期间采用静态快照占位并阻断高频 bounds，松手瞬时无补间对齐并恢复原生 View，确保拖拽期间平滑跟手、松手无缝切回。伙伴切换后浏览器呈现依赖 `contentPanelCollapsed` 值变化触发的恢复，若前后两个伙伴面板均展开（值不变）会漏掉重新呈现，表现为地址栏正常但网页白屏。`setBounds` 在 bounds 未变时跳过 `applyAllVisibility`、或后台加载完成后挂载未强制重绘，也会出现同样白屏；此时加号 / 三点菜单还可能因 `WebContentsView` 抢焦点被立刻关掉。
- How：通过 Settings UI 添加文件地址并创建伙伴；在 Workbench UI 新建浏览器 Tab，导航真实本地网页并调整缩放；折叠、切换伙伴后验证运行期状态，再正常重启同一用户目录，验证 URL、历史和缩放恢复；最后分别通过关闭 Tab 和删除所属伙伴销毁浏览器。伙伴切换分支覆盖两种路径：新建伙伴（面板默认折叠）后切回，以及切到面板已展开的伙伴后切回，并直接断言主窗口 `contentView.children` 原生挂载计数恢复到 1 而非仅依赖像素采样。
- Oracle：运行期折叠或切换伙伴不销毁 WebContents；无论切走的伙伴面板是否展开，切回后同一 `webContents.id` 必须重新挂载到主窗口并恢复显示；重启后重新创建 WebContents 并恢复 URL、历史和缩放，但不要求表单、滚动内存或 JS 连续；关闭 Tab 或删除所属伙伴后状态清理；地址栏右侧“将打开外部浏览器”按钮可见且更多菜单不再含系统浏览器入口，对齐 `WB-PANEL-001-AC5`、`WB-PANEL-004-AC8`、`WB-PANEL-004-AC14`、`WB-PANEL-004-AC12`。
- Not：不验证公网网页、Stagehand 操作或最终 AI 回答；这些由 `browser-use-task-panel` 覆盖。

#### `web-read-from-search-result`

- 测试类型：`e2e`
- What：真实 AI 用 `web_search(type=search)` 搜索 DeepSeek 融资，并用 `type=fetch` 读取最相关网页正文后总结。
- Why：搜索必须落到网页正文证据上；必须守住 search → fetch 的真实网页信息闭环。
- How：通过真实 Workbench UI 发送约束型提示：只搜索一次、只 fetch 一条最相关新闻链接后总结；等待真实 AI run 完成；检查 `web_search` 的 search/fetch 工具调用和结果。
- Oracle：run 完成；至少一次 `web_search(type=search)` 的 query 包含 DeepSeek；至少一次 `type=fetch` 返回 `ok=true` 且正文非空；最终回答使用网页事实；运行期间右侧不得出现搜索列表面板（该面板已不存在），对齐 `WB-CORE-007-AC4`；搜索、读取、失败边界和严谨偏好限制由网页组 case 合并对齐 `WB-CORE-007`；不出现 fake 信号。
- Not：不固定具体新闻网页、金额或日期，避免公网搜索结果变化导致误判。

#### `web-read-direct-url`

- 测试类型：`e2e`
- What：用户直接给 URL 时，真实 AI 使用 `web_search(type=fetch)` 读取网页正文，并回答正文中的唯一口令。
- Why：直接 URL 读取是网页阅读的最小闭环，不能退化成浏览器点击任务或只复述 URL。
- How：启动本地 HTTP 页面并写入唯一口令；通过真实 Workbench UI 要求 AI 读取该 URL 正文；等待真实 AI run 完成。
- Oracle：run 完成；至少一次 `web_search` 成功；不调用 `browser_use`；最终回答包含本地网页唯一口令；右侧不得出现搜索列表面板（该面板已不存在），对齐 `WB-CORE-007-AC4`；不出现 fake crawl / fake AI 信号。
- Not：不验证网页索引入库，也不验证交互式浏览器操作；这些分别由 Settings 网页索引 case 与 `browser-use-task-panel` 覆盖。

### 5.3 `result`

#### `image-generation-preview-and-revert`

- 测试类型：`e2e / live`
- What：真实 AI 根据用户请求生成 PNG 图片，用户可以从修改入口预览并回退删除该图片。
- Why：工具级转码成功不能证明真实模型会使用图片生成技能，也不能证明最终图片能进入 Workbench 的预览和回退闭环。
- How：通过真实 Workbench UI 请求 AI 在文件地址内生成指定文件名的简单 PNG；等待 run 完成后打开修改入口，检查图片预览，再执行统一回退确认。
- Oracle：真实调用 `image_generate` 且输入只有 `outputPath/svg`，正式文件具有 PNG 签名，对齐 `WB-IMAGE-001-AC1`、`WB-IMAGE-001-AC2`；assistant 修改入口、右侧预览和新建文件回退删除对齐 `WB-APPLY-002-AC7`、`WB-APPLY-003-AC7`。
- Not：不对图片审美打分，不固定 SVG 元素结构或模型调用轮数；自动创建/更新由 AI 测试计划的 `image-generate-format-create-update-contract` 覆盖 `WB-IMAGE-001-AC3`，失败无副作用由 `image-generate-safety-and-boundary-contract` 覆盖 `WB-IMAGE-001-AC4`。

#### `image-generation-update-preview-and-revert`

- 测试类型：`e2e / live`
- What：真实 AI 更新已有 PNG 后，Workbench 直接预览最终图片并可回退恢复原始 bytes。
- Why：新建图片回退删除不能证明已有图片的首次写入前快照和恢复链路正确。
- How：先在临时文件地址放置有效 PNG，再通过真实 Workbench UI 请求 AI 更新同一路径；检查更新结果和图片预览，执行统一回退后重新读取文件。
- Oracle：真实调用 `image_generate`，目标图片产生修改 Artifact，最终文件地址只交付目标图片；更新后正式文件变化且仍为 PNG；右侧直接预览且没有 Diff 切换；回退后 bytes 与原图完全一致，对齐 `WB-IMAGE-001-AC2`、`WB-APPLY-002-AC7`、`WB-APPLY-003-AC7`。
- Not：不评价图片审美，不要求模型生成固定 SVG 结构。

#### `file-preview-actions`

- 测试类型：`e2e`
- What：右侧普通文件预览态、“全部 / 本次运行改动”文件模式、稳定选中态、多个文件 Tab、定位文件、系统打开方式下拉、PDF 命中定位、Markdown / 纯文本预览，以及 Excel 只读预览。
- Why：右侧面板是用户消费引用结果和打开文件的主要区域，预览布局错误会直接阻断阅读。
- How：创建伙伴并添加文件地址后，从文件列表连续打开真实 pdf、docx、md、txt 文件；检查预览内容和工具条；展开打开方式菜单，确认触发系统关联应用查询、存在默认应用标记和至少一个系统返回的 Handler；确认产生四个文件 Tab，再切回 Markdown Tab；从文件列表打开 `xlsx/xlsm/xltx/xltm`，对 `xlsx` 尝试双击输入、切 Sheet 和拖列宽。
- Oracle：加号文件标签、目录懒加载、PDF 命中定位、Markdown / UTF-8 文本预览、Excel 只读且可浏览、选中态、面包屑、系统打开方式与工具栏行为整体对齐 `WB-PANEL-003`、`WB-EXCEL-002-AC1`；各文件分别保留且旧 Tab 可恢复；从“打开文件”选择器选中文件后选择器 Tab 被文件 Tab 原位替换、不残留，对齐 `WB-PANEL-001-AC1`。
- Not：不在自动测试中真正启动外部应用或修改操作系统默认关联；不伪造 md/txt 搜索结果或右侧预览状态。

#### `file-preview-external-change-auto-refresh`

- 测试类型：`e2e`
- What：右侧实时预览的当前文件被外部程序保存后自动刷新；该行为覆盖所有支持预览的文件类型，不只限文本或文件地址根目录文件；切换、关闭或进入审核 Diff 后停止旧监听；普通文件通过外部应用打开时不显示 AI 修改提醒。
- Why：用户可能同时使用 WPS、Word 或文本编辑器修改文件，Workbench 必须及时展示磁盘最新内容，同时不能让旧 Tab 的监听干扰当前预览。
- How：从真实临时文件地址打开 DOCX、PPTX 和 XLSX；测试进程对每个当前文件执行真实写入，并等待对应预览重新加载，其中 DOCX 验证新正文内容、PPTX 验证新渲染图、XLSX 验证新工作簿加载完成。另通过真实附件链路把 DOCX 保存到 `userData/partners/{id}/runtime/assets`，在修改记录切至预览模式后执行外部保存并等待真实文件重载；切回审核 Diff 后再保存，确认快照不被刷新。随后切换和关闭 Tab，再修改旧文件；外部应用打开使用仅在 E2E observer 环境生效的 no-op 启动开关，仍走正式关联应用查询和 IPC 成功分支。Markdown 与 TXT 的"编辑中外部保存"冲突行为由 `markdown-editor-edit-save` / `plain-text-editor-edit-save` 覆盖，本 case 不再断言其"已自动刷新"提示。
- Oracle：连续保存只显示一次“检测到当前文件被外部修改，已自动刷新”，DOCX、PPTX、XLSX 均展示或加载最终磁盘版本；文件地址和 `userData/partners/{id}/runtime/assets` 路径中的预览模式均监听真实当前文件，审核 Diff 固定为历史快照；这些类型代表 `WB-PANEL-003-AC18` 所列的不可编辑预览格式共用的监听和重载链路。切换、关闭或进入审核模式后旧监听不再触发提示；普通文件打开外部应用不显示重新打开提醒，对齐 `WB-PANEL-003-AC18`、`WB-PANEL-003-AC19`。
- Not：不伪造文件变化、预览内容或 AI 修改记录；不真正启动外部应用，不验证 WPS/Word 自身是否支持热更新。

#### `markdown-editor-edit-save`

- 测试类型：`e2e`
- What：右侧打开真实 Markdown 文件后直接进入即时渲染（IR）编辑态，无工具栏/操作按钮；点击任意位置输入文字并实时渲染，编辑后无需保存按钮自动落盘；光标进入链接局部露出 markdown 源；空闲时外部保存自动重载，编辑中外部保存被自动覆盖；编辑区撑满面板无右侧灰色残留；标题前不显示 H1/H2 等标题级别标签（Vditor 默认 `::before`）与 `#`/`##` 等标题源标记、标题无下划线；拉宽窗口后页面不白屏。
- Why：即时渲染点击即编辑与自动保存是本次产品能力核心，任何渲染、保存或外部覆盖分支错误都会导致内容丢失或磁盘不一致；编辑区布局、标题标签/标记与窗口缩放稳定性影响核心编辑体验。
- How：用真实临时文件地址创建 Markdown 文件（含标题、段落、链接、代码块），从文件列表打开；确认编辑器无工具栏且内容渲染为排版；点击段落输入追加文字，等待约 500ms 后读取磁盘校验已自动落盘且编辑区实时渲染；创建含链接的内容，点击链接确认局部露出 `[text](url)` 源码、离开恢复渲染；空闲时测试进程外部写入文件，确认编辑区自动重载为外部内容；编辑中输入新内容后外部写入文件，等待自动保存，确认磁盘为本地新内容（纯覆盖，无冲突提示）；测量编辑区宽度与父容器宽度一致（无灰色残留）；点击标题后确认 `.vditor-ir__marker--heading` 保持隐藏、标题 `::before` 计算样式 `content` 为 `none`（无 H1/H2 标签）；通过 Electron `setSize` 拉宽窗口后确认根节点仍在且编辑器仍可见（不白屏）。
- Oracle：Markdown 打开即 IR 编辑态，无保存按钮/工具栏/未保存标记；输入自动落盘，磁盘字节与编辑结果一致；链接局部转源码、其余保持渲染；空闲外部写入自动重载、编辑中外部写入被自动覆盖，对齐 `WB-EDIT-001-AC1`、`WB-EDIT-001-AC2`、`WB-EDIT-001-AC4`、`WB-EDIT-001-AC5`；AI 修改记录「审核」态仍为只读 Diff，切入「预览」后可编辑文本进入编辑态，对齐 `WB-EDIT-001-AC7`；保存不产生 AI 修改记录，对齐 `WB-EDIT-001-AC8`；编辑区宽度等于父容器宽度且背景为白（无灰色残留）；标题前无可见标题级别标签与标题源标记、标题无下划线，对齐 `WB-EDIT-001-AC9`；拉宽窗口后页面保持存活不白屏。
- Not：不验证 markdown 语法解析的所有细节；不验证编辑器内点击 assistant 标准 Markdown 链接打开行为。

#### `plain-text-editor-edit-save`

- 测试类型：`e2e`
- What：右侧打开真实 TXT / JSON / 代码等 UTF-8 文本后直接进入纯文本编辑框，输入与保存一致、不 markdown 化改写，编辑后自动落盘；保存保留 CRLF 与 UTF-8 BOM；编辑框每行前显示行号。
- Why：普通用户也会编辑纯文本文件，若被 markdown 化改写或丢失换行/BOM 会造成内容损坏；行号是纯文本查看与定位的基础。
- How：用真实临时文件地址创建带 BOM 的 CRLF TXT 文件与 JSON 文件；打开后确认文本左侧 padding 区域显示 1/2/3… 行号；输入追加内容，等待约 500ms 后读取磁盘 bytes 校验内容一致、换行仍为 CRLF、BOM 保留；再对 JSON 文件编辑，等待自动落盘并确认无 markdown 语法改写。
- Oracle：纯文本编辑框不渲染 markdown 结构（`#`、`**` 保持字面量），编辑后自动落盘且磁盘字节与编辑结果一致并保留 CRLF/BOM，对齐 `WB-EDIT-001-AC3`、`WB-EDIT-001-AC4`、`WB-EDIT-001-AC6`；每行前显示从 1 开始的行号，对齐 `WB-EDIT-001-AC10`。
- Not：不验证 JSON 的语义合法性或格式化，只验证内容不被改写。

#### `text-file-apply-preview-and-revert`

- 测试类型：`e2e`
- What：同一个 Markdown 文件打开即进入编辑态并展示最新内容，AI 运行完成后无需点击修改项即可显示非零修改数量，切换伙伴再切回后不点击仍保持真实数量，在 AI 修改记录中使用独立文本 diff，并能恢复原始 bytes。
- Why：编辑态和修改预览是两种不同语义；如果共用文件渲染器，用户看不到本次具体增加和删除内容；伙伴切换后的数量恢复不能依赖用户点击触发补算。
- How：先打开 Markdown（进入编辑态）；再通过真实 AI 调用 `replaceAll` 和 `edit` 修改该文件，等待 run 完成但不点击修改项，确认 assistant 修改列表已经显示非零 `+/-` 数量；检查编辑态静默刷新为最新内容；切换伙伴再切回，不点击修改项确认数量仍为非零；再点击 assistant 修改入口检查 `TextFileDiffViewer`、工具栏没有独立定位按钮且系统应用下拉包含“打开所在文件夹”；通过 E2E no-op 外部启动成功分支检查重新打开提醒，最后执行回退。
- Oracle：AI 写入后编辑态显示最新内容且不误报外部修改；编辑态与审核模式共用一个文件 Tab；Run 终态后修改入口在未点击时已显示真实非零数量；切换伙伴再切回后未点击时数量仍为真实非零，不重置为 0，对齐 `WB-APPLY-005-AC4`；审核模式展示差异数量、修改状态和回退，预览模式全部隐藏；预览模式对 Markdown/UTF-8 文本进入应用内编辑态（与普通打开一致），对齐 `WB-EDIT-001-AC7`、`WB-PANEL-003-AC14`；已应用记录打开外部应用后显示重新打开提醒；文件夹入口打开的文件列表从工具栏底部贴右悬浮，不改变预览宽度，可通过外部点击、Escape 或选择文件关闭；当前已经是最新记录且处于预览模式时，再次点击文件总分类仍会重置到最新审核模式；历史批次、结构化 Diff、不可变展开和回退刷新整体对齐 `WB-PANEL-003`、`WB-APPLY-001`、`WB-APPLY-002`、`WB-APPLY-003`；确认回退后 bytes 与原始输入一致且有效改动标记消失。
- Not：不验证 unified diff 字符串；UI 只消费结构化 diff artifact。

#### `file-change-run-scope`

- 测试类型：`e2e / live`
- What：两个伙伴各完成一次真实终端写入后，每条 assistant 修改入口与右侧“本次运行改动”只展示该 `{ partnerId, runId }` 的文件。
- Why：文件改动归属已经是 run 级，后台或历史伙伴完成时不能把其他 run 的记录混入当前审核列表。
- How：在首个伙伴让真实 AI 只通过 `terminal_run` 创建第一个文件；再创建第二个伙伴（可共用同一文件地址），让真实 AI 创建另一个文件；分别打开两条修改入口，再回到首个伙伴复查右侧变更列表。
- Oracle：两条 run 和两个伙伴 ID 均不同；每条 assistant 卡片只含自身文件；右侧“本次运行改动 1”只含当前 run 文件，切回历史伙伴后仍不出现另一 run 的文件，对齐 `WB-PANEL-003`、`WB-APPLY-003`。
- Not：不要求两个终端命令实际时间重叠；重叠命令的允许重复归属由后端并发单测覆盖。

#### `ppt-create-diff-and-revert`

- 测试类型：`e2e / live`
- What：真实 AI 创建两页 PPT 后，用户可打开页面级左右 diff、看到准确 `+2/-0`、切换审核/预览并回撤文件；运行时生成的 `userData/partners/{id}/runtime/assets` 资源不出现在修改文件和右侧变更列表。
- Why：新建 PPT 必须同时验证文件交付、审核模式和回退闭环。
- How：通过真实 Workbench UI 请求 AI 创建两页 PPT，打开修改记录，操作审核/预览、缩放、拖拽和回退。
- Oracle：真实 PPT 创建、原子写入和 run 级修改记录对齐 `WB-PPT-001`、`WB-APPLY-002`；pptx 可解析，修改文件与右侧“本次运行改动”只显示用户 PPT、不显示 `userData/partners/{id}/runtime/assets` 内的运行时资源；审核模式显示两页和 `+2/-0`，预览模式显示正式 PPT，现有缩放拖拽可用；回撤后新建文件被删除，对齐 `WB-APPLY-003`。
- Not：不逐字断言最终回答，不对页面审美打分。

#### `ppt-update-diff-interactions`

- 测试类型：`e2e`
- What：已有 PPT 更新后的左右差异、绿色新增/修改/移动、红色删除、准确 `+N/-N`、缩略图筛选、审核/预览、缩放和拖动画布。
- Why：创建态与更新态的差异语义不同，不能只用新建 PPT case 代替。
- How：让真实 AI 对已有四页 PPT 主动移动一页、修改一页、删除中间页、新增一页，并要求末页完全不变；打开修改记录并操作审核/预览、筛选、同步切页、缩放、拖动、关联应用打开和回退。关联应用启动在 E2E 中使用 no-op 成功分支，不实际启动 Office/WPS。
- Oracle：正式 PPT 内容和顺序正确；审核显示准确 `+3/-1`、三个绿色页面标记和一个红色删除标记；删除中间页不会把未改末页标绿，变化筛选为四页、全部模式为五个 before/after 对齐项；已应用记录成功交给外部应用后显示“关闭后重新打开”提示；审核/预览切换、同步缩放拖动不变，底部「滚轮缩放 / 拖拽平移」提示固定可见（缩放或拖拽后仍在），回退后 bytes 与 baseline 完全一致，对齐 `WB-PANEL-003-AC19`、`WB-PPT-002`、`WB-APPLY-003`。
- Not：不评价页面设计质量。

#### `excel-update-diff-and-revert`

- 测试类型：`e2e / live`
- What：真实 AI 修改已有 Excel 后，用户在同一个只读网格中查看红绿单元格边框，并能回退到原始文件。
- Why：Excel 修改预览不能依赖模型描述，也不适合 PPT 式左右画面对比，必须直接验证工作簿数据、公式和单元格级 diff。
- How：通过真实 Workbench UI 用自然语言请求 AI 对已有 xlsx 分两轮修改；打开修改记录，显式切换“预览/审核”，在两种模式下尝试编辑、切换工作表和拖列宽；通过 E2E no-op 成功分支打开关联应用，再执行回退。
- Oracle：正式 xlsx 的值和公式准确且没有 diff 边框；同一 run 两轮修改在 UI 上只见一条本 run 修改入口；两种模式都通过 Univer 只读预览、可切换工作表且不出现 PPT 前后预览；已应用记录成功交给外部应用后显示“关闭后重新打开”提示；回退后 bytes 与修改前一致；真实调用包含 `excel_read` 和至少两次 `excel_edit`；对齐 `WB-PANEL-003-AC19`、`WB-EXCEL-001-AC5`、`WB-EXCEL-002-AC1`、`WB-EXCEL-002-AC4`。
- Not：不逐字断言最终回答，不把模型直接计算的文本结果当作数据正确性证据；不在 Workbench e2e 枚举新增、修改、删除、清空、删除 Sheet 的全部 diff 细节，这些由 AI tool Excel case 直接解析 diff xlsx 覆盖；`WB-EXCEL-002-AC3`（同路径一条记录 + 相对首次写入前 baseline）只在 `ai-test` `excel-create-read-edit` 硬断言，本 case 不重复硬断言。

#### `excel-create-diff-and-revert`

- 测试类型：`e2e / live`
- What：真实 AI 新建多 Sheet Excel 后，用户可查看全部新增单元格的绿色 Diff，并通过回退删除新文件。
- Why：新建文件的 baseline 为空，Diff 与回退语义不同于已有文件更新，不能由更新 case 间接代替。
- How：通过真实 Workbench UI 用自然语言请求创建包含 Data/Notes 的 xlsx；打开修改入口，在两个 Sheet 检查新增边框，再执行回退。
- Oracle：正式文件可解析且两个 Sheet 数据正确；所有抽查新增单元格为绿色；真实调用包含 Excel 写入和创建后的读取核对；回退后新建文件不存在。
- Not：不评价表格视觉设计，不要求固定工具调用顺序。

#### `docx-apply-panel-preview-and-revert`

- 测试类型：`e2e`
- What：AI 修改真实 docx 后，assistant 修改文件入口在未点击时显示真实非零修改数量，右侧修改文件工作区、当前记录预览和干净回退闭环。
- Why：直接写回和回退是 Workbench 文件编辑能力的安全边界，只看 artifact 事件无法证明用户能检查和撤销修改。
- How：通过 UI 选择真实 docx 资料并发送真实编辑请求；等待 AI 写回但不点击 assistant turn 中的修改文件入口，确认它显示真实非零 `+/-` 数量；再点击入口检查右侧文件面包屑、无模式标签状态、预览，以及系统应用下拉内的“打开所在文件夹”；通过 E2E no-op 成功分支选择关联应用，再执行回退并重新读取文件内容。
- Oracle：受支持写回类型边界对齐 `WB-CORE-003`；修改后源文件成为最终净稿，Run 结束后入口在未点击时已显示真实非零数量；DOCX 已应用记录成功交给外部应用后显示“关闭后重新打开”提示；右侧默认选中、Review Docx、写回和回退闭环对齐 `WB-PANEL-003-AC19`、`WB-APPLY-001`、`WB-APPLY-002`、`WB-APPLY-003`。
- Not：不验证 docx 编辑算法的所有格式保真细节，该能力归 AI tool docx 测试。

#### `docx-attachment-apply-status-and-cell-diff`

- 测试类型：`e2e / live`
- What：通过 Composer `+` 添加文件地址内的真实 DOCX 附件，让 AI 修改已有表格单元格的文字和格式，验证附件保留源文件绝对路径时仍保持成功状态和单元格 Diff。
- Why：附件链路现在保留源文件绝对路径且不限扩展名；文件地址内的附件写回必须仍生成修改记录与审核内容，防止附件上下文退化或专用写入记录被误判失败。
- How：在临时文件地址根目录创建包含已有表格的 DOCX，通过 `+` 附件流程添加并发送明确的单元格替换和样式修改请求；等待 Run 完成后打开 assistant 修改入口，检查状态、Review Docx、预览模式监听真实资产文件、审核模式快照和真实磁盘文件。
- Oracle：正式 DOCX 包含最终单元格内容；修改记录为 `applied` 且路径保持文件地址内源文件绝对路径，不出现失败红条或“本次未检测到文件内容变化”；审核预览在对应单元格展示红绿净变化，未变单元格不整表高亮，对齐 `WB-PANEL-003-AC20`、`WB-PANEL-003-AC21`、`WB-APPLY-003-AC9`、`WB-COMPOSER-010-AC2`。
- Not：不使用 fake DOCX、fake AI event 或伪造修改记录；不验证粘贴副本保存链路，该链路由 `composer-attachments-context` 覆盖。

#### `terminal-rename-change-notice-and-revert`

- 测试类型：`e2e`
- What：真实 AI 通过终端 `mv` 重命名文件后，验证命令级差异记录、非专用变更说明和确认回退闭环。
- Why：终端和脚本没有专用 Diff，但仍属于本次运行的 AI 改动；若只覆盖内置编辑工具，会漏掉产品的重要通用执行路径。
- How：在临时文件地址要求真实 AI 只使用 `terminal_run` 重命名文件；等待 Run 完成后点击修改入口，检查前后文件名和内容未变化说明；点击回退并确认，再读取磁盘状态。
- Oracle：重命名记录在 terminal 命令结束后进入 assistant 修改入口和“本次运行改动”；预览区展示原文件名、当前文件名和“文件内容没有变化”，不出现“没有专用预览稿”；统一回退确认出现后才执行，最终原文件名及原始 bytes 恢复，重命名目标消失。
- Not：不尝试区分重叠 terminal 命令共同看到的变化；允许按各自命令窗口重复记录。

#### `terminal-update-delete-change-and-revert`

- 测试类型：`e2e / live`
- What：真实 AI 通过终端修改文本文件内容和删除文件后，分别验证行级 Diff 预览与回退恢复原始 bytes、删除记录说明与回退恢复文件。
- Why：终端是通用执行路径，内容修改和删除两条记录与内置文件工具共用同一回退入口；若只覆盖重命名，会漏掉终端产生的最常见两类可回退记录。
- How：在临时文件地址要求真实 AI 只使用 `terminal_run`，在一次 Run 中修改一个文本文件内容（如追加唯一标记行）并删除另一个文件；等待 Run 完成后分别打开两条修改入口：修改记录检查行级 Diff 预览（不出现“没有专用预览稿”），删除记录检查“本次删除了该文件”说明；分别点击回退并确认，再读取磁盘状态。
- Oracle：两条记录在 terminal 命令结束后进入 assistant 修改入口和“本次运行改动”；修改记录在审核模式展示普通行级 Diff，对齐 `WB-APPLY-003-AC4`；回退后文本文件恢复原始 bytes 且记录状态变为 `reverted`，对齐 `WB-APPLY-003-AC1`；删除记录展示删除说明，回退后文件恢复且 bytes 与删除前一致，对齐 `WB-APPLY-003-AC2`。
- Not：不验证 terminal 命令审批交互和重叠命令窗口归属，该能力由 AI tool terminal 回归和 `terminal-rename-change-notice-and-revert` 覆盖。

#### `docx-apply-force-revert-warning`

- 测试类型：`e2e`
- What：AI 写回后文件又被外部真实修改时，首次回退展示风险提示，确认后允许强制回退并刷新右侧状态。
- Why：强制回退是避免静默覆盖用户后续修改的关键安全交互。
- How：AI 写回真实 docx 后，由测试进程对同一个真实文件做外部修改；在右侧修改文件工作区点击回退，先确认统一回退提示，再观察风险提示并确认强制回退。
- Oracle：审核模式不创建普通预览文件监听，外部修改不会刷新审核快照或显示普通预览刷新提示，对齐 `WB-PANEL-003-AC18`；首次点击只展示统一确认且不写磁盘，对齐 `WB-APPLY-004-AC1`；确认后检测到后续修改，再展示“仍然回退这次修改？”风险提示；用户确认强制回退后恢复 checkpoint 或删除新建文件，对齐 `WB-APPLY-004-AC2`；右侧记录状态和预览在强制回退后刷新，对齐 `WB-APPLY-004-AC3`；记录模型、耗时、完成度评分和失败归因。
- Not：不验证所有外部编辑器写入方式，只验证 checksum 不一致分支的用户可见交互。

#### `multi-file-apply-tabs`

- 测试类型：`e2e`
- What：同一轮 AI 修改多个文件时，assistant turn 保留全部入口；右侧为每个文件保留资源 Tab，并可切回旧文件；文件入口超过 3 个时默认折叠展示并可展开/收起。
- Why：多文件任务如果只保留最新或单个入口，用户无法检查和回退完整结果；入口过多时折叠能避免单条消息占用过宽列表。
- How：通过 UI 选择至少两个真实 docx 文件并发送真实多文件编辑请求；分别点击两个修改入口，确认生成两个文件 Tab，再点击第一个 Tab 恢复其记录。另准备同一轮修改超过 3 个文件的真实输入，确认列表默认只展示前 3 个入口、底部展示“显示剩余 N 个文件”与三角图标；点击后展示全部入口且底部变为“收起文件”，再次点击恢复折叠；头部总数始终为完整数量。
- Oracle：多个修改入口、对应记录加载和切换后入口保留整体对齐 `WB-APPLY-005`；点击入口新增或激活对应文件 Tab，对齐 `WB-PANEL-001-AC1`；超过 3 个入口的折叠、展开与收起交互对齐 `WB-APPLY-005-AC5`。
- Not：不验证不同 AI 轮次的全部历史筛选 UI，只覆盖同一轮多文件入口和当前轮次隔离。

#### `apply-workspace-collapsed-restore`

- 测试类型：`e2e / live`
- What：审核模式展开状态下折叠右侧面板，切换伙伴再切回后面板必须保持折叠；异步修改记录刷新只更新内容，不得把面板重新展开，展开后直接展示最新审核内容。
- Why：伙伴切换会恢复目标伙伴自己的展开状态（`WB-PANEL-001-AC5`）；如果恢复过程中的记录刷新强制展开面板，折叠态用户会反复被打断。
- How：真实 AI 修改一个 Markdown 文件并打开审核模式；折叠面板后创建第二个伙伴，再切回原伙伴，等待异步记录刷新窗口；确认面板保持折叠，再手动展开并检查审核内容与文件 Tab。
- Oracle：切回后 shell 不存在且仅保留右缘展开按钮，对齐 `WB-PANEL-001-AC5`；手动展开后展示目标文件的最新审核内容且文件 Tab 保留，对齐 `WB-PANEL-001-AC1`。
- Not：不验证记录刷新时序的精确毫秒数，只验证刷新完成后面板不改变折叠状态。

### 5.4 `scheduled-task`

定时任务回归单独归类，Oracle 引用 [`workbench.md`](../prd/workbench.md) 的 `ST-*` 编号。调度触发时点由真实程序运行与系统时间决定，case 通过「下一分钟」级别的短周期调度验证端到端触发，不伪造系统时钟。下列 AC 由 unit `tests/case/unit/scheduled-task-service.test.ts` 承担，不进入 Workbench E2E 发现范围：`ST-PARTNER-001-AC2`、`ST-RUN-001-AC3`、`ST-RUN-001-AC4`、`ST-RUN-003-AC1/AC2`、`ST-RUN-004-AC2/AC3`、`ST-RUN-005-AC1/AC2/AC3`。`ST-PARTNER-001-AC1`（删除专属伙伴后任务仍在）标为不测。

#### `scheduled-task-view-entry-and-isolation`

- 测试类型：`e2e`
- What：左侧栏「创建伙伴」下方存在「定时任务」入口；点击后整个主区域（除左侧伙伴列表外）切换为定时任务视图，聊天对话与资源面板不再显示；点击「创建伙伴」或点击任意伙伴返回聊天视图。
- Why：定时任务是一个独立的全主区视图，不与聊天对话或资源面板并存，避免状态交叉。
- How：通过真实 UI 点击「定时任务」入口确认整块主区切换为定时任务视图且无聊天；随后点击「创建伙伴」返回聊天视图并打开创建弹窗（伙伴点击返回由 `scheduled-task-trigger-and-session-refresh` 覆盖）。
- Oracle：入口位置与样式对齐 `ST-ENTRY-001-AC1`；点击后主区整块切换且无聊天对齐 `ST-ENTRY-001-AC2`；视图无聊天 / 无资源面板对齐 `ST-VIEW-001-AC1`；点击「创建伙伴」返回聊天并对齐 `ST-VIEW-001-AC3`。
- Not：不验证定时任务实际触发调度，只验证入口与视图切换。已启用数量 chip（`ST-ENTRY-001-AC3` / `ST-VIEW-001-AC4`）由 `scheduled-task-config-lifecycle` 在启用开关后覆盖。点击伙伴返回聊天对齐 `ST-VIEW-001-AC2`，由 `scheduled-task-trigger-and-session-refresh` 承担。`ST-VIEW-001-AC5`（定时任务视图下删除伙伴确认弹窗可见）标为不测。

#### `scheduled-task-config-lifecycle`

- 测试类型：`e2e`
- What：新增、必填拦截、编辑、启用开关、立即执行确认与删除完整闭环；每周模式必须选择星期几；执行权限位于偏好下方；保存不创建专属伙伴；启用后侧栏与标题栏出现已启用数量 chip，关闭或删除后消失；编辑保存不改变启用状态。
- Why：配置是定时任务可执行的前提；专属伙伴在执行时按需创建，立即执行是占用兜底的入口。
- How：通过真实 UI 打开视图新增任务并填写名称、提示词、执行时间（TimePicker）、主模型、偏好与执行权限（不选伙伴），保存后确认出现在列表且侧栏不新增 `定时 ·` 专属伙伴、`partnerId` 为空；先打开启用开关，再编辑并保存，确认仍为启用且数量 chip 仍在；点立即执行弹出确认后取消；删除并二次确认。
- Oracle：新增与编辑预填对齐 `ST-FORM-001-AC1`；必填缺失拦截对齐 `ST-FORM-001-AC2`；每周必选星期对齐 `ST-FORM-001-AC3`；保存不建专属伙伴对齐 `ST-FORM-001-AC6`；编辑保存不改启用对齐 `ST-FORM-001-AC7` / `ST-SWITCH-001-AC3`（只在本 case 断言）；默认关闭对齐 `ST-SWITCH-001-AC1`；删除二次确认对齐 `ST-DELETE-001-AC1/AC2`；列表展示对齐 `ST-LIST-001-AC2/AC4`；启用后数量 chip 对齐 `ST-ENTRY-001-AC3` / `ST-VIEW-001-AC4`；立即执行确认对齐 `ST-RUN-004-AC1`。
- Not：不验证到点后的真实 AI 执行。`ST-FORM-001-AC4`、`ST-SWITCH-001-AC2`、`ST-LIST-001-AC1`、`ST-LIST-001-AC3`（空列表文案）标为不测。忙碌取消、执行时创建/重建伙伴、错过补跑与立即执行忙提示由 unit 承担，见本节引言。

#### `scheduled-task-trigger-and-session-refresh`

- 测试类型：`e2e / live`
- What：启用一个下一分钟触发的定时任务，到点后创建专属伙伴（若尚无）并追加任务消息；伙伴列表无需手动刷新即展示运行状态；当前查看的非专属伙伴不被切换。
- Why：这是定时任务的核心闭环，验证真实调度、真实 AI run 与前端伙伴列表刷新联动。
- How：在真实 UI 配置并启用一个每天 + 当前系统时间下一分钟的任务（保存时不创建专属伙伴）；等待到点，轮询出现 `定时 ·` 专属伙伴、运行状态并完成，同时确认当前选中伙伴不变。
- Oracle：到点往专属伙伴追加对齐 `ST-RUN-001-AC1`；不改变当前查看伙伴对齐 `ST-RUN-001-AC2`；从定时任务视图点伙伴返回聊天对齐 `ST-VIEW-001-AC2`；伙伴列表刷新对齐 `ST-RUN-002-AC1/AC2`；执行时创建专属伙伴对齐 `ST-PARTNER-001-AC2` / `ST-RUN-001-AC4`。
- Not：不验证跨天 / 跨周边界调度，不验证程序关闭 / 休眠期间错过补跑（`ST-RUN-003` 由 unit 承担）；不验证忙碌取消胶囊（unit 覆盖）。
