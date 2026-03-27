# NCurator-Desktop Workspace 测试计划

## 1. 总体目标

本计划用于验证 Workspace 能否稳定承担“本地优先资料入口”这条职责，而不是只在 UI 上能看到一个列表。

当前长期回归主轴聚焦四类真实诉求：

- 正确校验、创建和更新工作空间根路径
- 稳定生成目录树快照，并按准备模式识别新增、删除与内容变更
- 在 `Settings -> Workspace` 中完成工作空间与网页资料管理
- 把 Workspace 产出的状态、范围与后续对话入口稳定接起来

测试用例设计准则、测试目录、runner、raw log、report 契约统一以 [test.md](/Users/test/work-space/NCurator-Desktop/doc/test.md) 为准，这里不再重复展开。

## 2. 模型与阶段边界

- Workspace 主测试域默认不依赖模型，不要求单独维护 `live` case。
- 只要验证目标已经进入 AI 运行链路，例如 `workspace required` 恢复、source scope 与 AI 协作等，正式结论仍以 [ai-test.md](/Users/test/work-space/NCurator-Desktop/doc/test-plan/ai-test.md) 中对应 case 为准。
- 本计划只覆盖 Workspace 自身的服务、IPC、设置页与资料管理交互，不替代 AI 端到端验证。

## 3. 长期回归口径

- 本计划只保留长期要回归的正式 case，不再为同一条业务规则在 `source-service / ipc / settings` 三层重复铺开。
- `source-service` 只保留底层快照与根路径约束；`ipc` 只保留生命周期桥接；`settings / scope` 保留用户可见主路径。
- 当前正式测试实现已移除，以下保留 case 统一从 `未实现` 重新开始登记；后续按本计划重建正式测试代码。

## 4. 阶段计划

本计划按四个阶段推进：

1. `source-service`
2. `ipc`
3. `settings`
4. `scope`

其中：

- `source-service / ipc` 属于 `backend`
- `settings / scope` 当前以 `e2e` 为主，必要时可先补 `backend` 辅助 case

### 4.1 `source-service`

做什么：验证工作空间根路径校验、目录扫描、目录树快照与 diff 模式。

为什么：这是整个 Workspace 功能的底座，底层不稳，IPC 和设置页结论都会失真。

怎么做：保留一个快照主路径和一个根路径约束主路径，避免同一规则在服务层过度拆分。

#### basic

`workspace-source-service-scan-and-diff`

- 实现状态: `未实现`
- What: 验证扫描结果与 diff 模式的基础闭环
- Why: 目录快照和 `full / presence_only / changes_only` 是后续准备与状态更新的基础
- How: 在隔离 workspace 中创建目录、受支持文件和不受支持文件；完成首次扫描后再执行新增、删除和内容修改，再分别计算三种 diff 结果
- Oracle:
  1. 扫描结果只收录受支持文件和目录节点，不把不受支持文件写进快照。
  2. `full` 模式同时识别新增、删除和内容变更。
  3. `presence_only` 模式忽略内容变更，只保留新增和删除。
  4. `changes_only` 模式只保留内容变更，不混入新增和删除。
- Not: 不验证数据库落盘；不验证 IPC；不验证设置页交互。

#### boundary

`workspace-source-service-root-validation`

- 实现状态: `未实现`
- What: 验证根路径规范化与非法路径拒绝
- Why: 根路径口径一旦不稳，去重、嵌套校验和 UI 展示都会失真
- How: 合并覆盖真实路径规范化、默认显示名生成、空路径、非目录路径、不存在路径以及父子目录嵌套冲突
- Oracle:
  1. 返回的 `normalizedRootPath` 是真实规范路径，而不是原始输入字符串。
  2. 空路径、非目录路径和不存在目录路径都会被拒绝，不会误创建工作空间。
  3. 已存在一个工作空间根路径时，再添加其父目录或子目录作为新工作空间都会被拒绝，并返回明确错误。
- Not: 不验证设置页提示文案；不验证 IPC 层包装。

### 4.2 `ipc`

做什么：验证工作空间与网页资料相关 IPC 能正确接住服务层结果。

为什么：前端最终依赖 IPC，而不是直接调用服务。

怎么做：保留一个工作空间生命周期 case 和一个网页资料生命周期 case，不再把创建、扫描、删除拆成多个重复基线。

#### basic

`workspace-ipc-workspace-lifecycle`

- 实现状态: `未实现`
- What: 验证工作空间创建、扫描、节点读取与删除闭环
- Why: 这是设置页和后续范围选择最基础的桥接链路
- How: 通过 IPC 创建工作空间，执行扫描，读取节点，再删除工作空间，并覆盖重复或嵌套路径被拒绝
- Oracle:
  1. 创建成功后列表立即可见，且新工作空间可以继续扫描和读取节点。
  2. 节点列表与扫描后的目录树一致，工作空间状态和最近扫描时间被正确更新。
  3. 重复或嵌套路径会返回 `success=false` 且不产生半成功记录；删除成功后列表和目录树节点一并清理。
- Not: 不验证设置页视觉；不验证准备写库。

#### scenario

`workspace-ipc-web-source-refresh-and-delete`

- 实现状态: `未实现`
- What: 验证网页资料的刷新与删除闭环
- Why: Workspace 现在同时负责本地与网页资料，不能只测本地文件
- How: 先导入网页资料，再执行刷新与删除
- Oracle:
  1. 网页资料进入列表后可被刷新。
  2. 刷新后状态和最近抓取时间会更新。
  3. 删除后列表中不再保留该网页资料。
- Not: 不验证页面排版；不验证 AI 检索效果。

### 4.3 `settings`

做什么：验证 `Settings -> Workspace` 是正式资料配置入口，并能完成主路径操作。

为什么：用户感知的是页面入口、状态反馈和可执行操作，而不是后端服务细节。

怎么做：只保留空态/错误态、工作空间主路径、网页资料主路径三个长期高价值 case。

#### boundary

`settings-workspace-empty-and-error-state`

- 实现状态: `未实现`
- What: 验证空态与错误态稳定呈现
- Why: 初次进入和失败恢复都是高频路径
- How: 在无工作空间、扫描失败或准备失败时打开设置页。对齐 PRD：`SET-WORKSPACE-001`、`SET-WORKSPACE-005`、`SET-WORKSPACE-007`。
- Oracle:
  1. 空态时有明确引导，不是空白页。对齐 `SET-WORKSPACE-007-AC1`。
  2. 失败时可见最近错误信息，而不是只在控制台输出。对齐 `SET-WORKSPACE-005-AC1`。
  3. 失败后仍可继续刷新、重新扫描或删除，不会把详情区锁死。对齐 `SET-WORKSPACE-001-AC1`、`SET-WORKSPACE-005-AC2`。
- Not: 不验证 AI 对话联动。

#### scenario

`settings-workspace-create-scan-prepare-flow`

- 实现状态: `未实现`
- What: 验证设置页中的创建、扫描和准备主路径
- Why: 这是迁移后用户最重要的正式操作链路
- How: 在设置页新建工作空间，执行扫描、切换准备模式并完成一次准备。对齐 PRD：`SET-WORKSPACE-001`、`SET-WORKSPACE-002`、`SET-WORKSPACE-003`、`SET-WORKSPACE-004`、`SET-WORKSPACE-005`、`SET-WORKSPACE-006`。
- Oracle:
  1. 页面加载后列表和详情区完成初始化；创建成功后，新工作空间立即出现在列表中并成为当前选中项。对齐 `SET-WORKSPACE-001-AC1`、`SET-WORKSPACE-001-AC2`、`SET-WORKSPACE-002-AC2`。
  2. 扫描执行中能看到状态或进度，扫描完成后目录树、最近扫描时间和状态同步刷新。对齐 `SET-WORKSPACE-003-AC1`、`SET-WORKSPACE-003-AC2`。
  3. 加载模式会进入实际请求，加载完成后最近加载时间、摘要统计和状态 badge 同步刷新。对齐 `SET-WORKSPACE-004-AC1`、`SET-WORKSPACE-004-AC2`、`SET-WORKSPACE-005-AC2`。
- Not: 不验证 AI 问答质量；不验证网页资料。

`settings-web-source-management`

- 实现状态: `未实现`
- What: 验证网页资料的添加、过滤、刷新和删除
- Why: Workspace 入口已经统一接管网页资料，不能漏掉这部分交互
- How: 通过设置页添加一条网页资料，再执行搜索过滤、刷新和删除。对齐 PRD：`SET-WEB-001`、`SET-WEB-002`、`SET-WEB-003`、`SET-WEB-005`。
- Oracle:
  1. 页面打开后，网页资料列表和详情区完成初始化；输入关键字后，列表按标题、URL 或标准化 URL 过滤。对齐 `SET-WEB-001-AC1`、`SET-WEB-001-AC2`、`SET-WEB-001-AC3`。
  2. 新网页资料提交成功后进入列表，并可从当前列表直接触发刷新。对齐 `SET-WEB-002-AC2`、`SET-WEB-003-AC1`、`SET-WEB-003-AC2`。
  3. 状态、最近抓取时间和错误信息可见；删除成功后，该网页资料从列表中消失。对齐 `SET-WEB-005-AC1`、`SET-WEB-005-AC3`。
- Not: 不验证抓取内容质量。

### 4.4 `scope`

做什么：验证 Workspace 输出能稳定进入后续范围选择与对话提示。

为什么：用户感知的不是“目录树已经生成”，而是“我能在对话里用起来”。

怎么做：保留一个正式 case，统一覆盖 source scope 绑定、prepared/unprepared 区分和 AI / 搜索模式下的 warning。

#### scenario

`workspace-source-scope-bindings-and-warnings`

- 实现状态: `未实现`
- What: 验证工作空间、目录、文件范围进入 source scope 后的状态与提示
- Why: 范围选择是 Workspace 和对话页之间的核心接口
- How: 通过 backend 正式 case 覆盖 source scope 的绑定、prepared/unprepared 区分和 search 模式过滤；再通过 workbench e2e case 覆盖 AI 模式与纯搜索模式下的用户提示文案。对齐 PRD：`WB-SCOPE-001`、`WB-SCOPE-003`、`WB-MODE-002`、`WB-BLOCKER-003`。
- Oracle:
  1. 已准备和未准备范围会被正确区分，切换工作区后旧工作区本地范围会被清理。对齐 `WB-SCOPE-001-AC1`、`WB-SCOPE-001-AC2`、`WB-SCOPE-003-AC2`。
  2. 纯搜索模式只接受已准备资料，并在严格范围无命中时给出明确提示。对齐 `WB-MODE-002-AC1`、`WB-MODE-002-AC2`。
  3. AI 对话模式会明确提示未准备文件的代价；搜索模式会明确提示未加载文件不会进入候选结果。对齐 `WB-BLOCKER-003-AC1`、`WB-BLOCKER-003-AC2`。
- Not: 不验证 AI 最终答案；不验证真正的模型执行效果。
