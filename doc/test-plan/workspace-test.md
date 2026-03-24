# NCurator-Desktop Workspace 测试计划

## 0. 共享约束

- Workspace 正式测试用例的文档约束、实现状态取值和用例字段定义，统一以 [test.md](/Users/test/work-space/NCurator-Desktop/doc/test.md) 为准。
- 本文只补充 Workspace 专属的总体目标、阶段边界、阶段计划和领域用例。

## 1. 总体目标

本计划用于验证 Workspace 能否稳定承担“本地优先资料入口”这条职责，而不是只在 UI 上能看到一个列表。

当前测试主轴聚焦四类真实诉求：

- 正确校验、创建和更新工作空间根路径
- 稳定生成目录树快照，并按准备模式识别新增、删除与内容变更
- 在 `Settings -> Workspace` 中完成工作空间与网页资料管理
- 把 Workspace 产出的状态、范围与后续对话入口稳定接起来

测试用例设计准则、测试目录、runner、raw log、report 契约统一以 [test.md](/Users/test/work-space/NCurator-Desktop/doc/test.md) 为准，这里不再重复展开。

## 2. 模型与阶段边界

- Workspace 主测试域默认不依赖模型，不要求单独维护 `live` case。
- 只要验证目标已经进入 AI 运行链路，例如 `workspace required` 恢复、source scope 与 AI 协作等，正式结论仍以 [ai-test.md](/Users/test/work-space/NCurator-Desktop/doc/test-plan/ai-test.md) 中对应 case 为准。
- 本计划只覆盖 Workspace 自身的服务、IPC、设置页与资料管理交互，不替代 AI 端到端验证。

## 3. 阶段计划

本计划按四个阶段推进：

1. `source-service`
2. `ipc`
3. `settings`
4. `scope`

其中：

- `source-service / ipc` 属于 `backend`
- `settings / scope` 当前以 `e2e` 为主，必要时可先补 `backend` 辅助 case

### 3.0 阶段内统一分层

每个阶段内部的正式 case 统一按三层组织：

- `basic`
  - 验证最小能力闭环，输入和断言都尽量收敛。
- `boundary`
  - 验证失败、阻塞、空目录、非法路径、重复路径、冲突状态等边界行为。
- `scenario`
  - 验证真实用户链路，强调“创建 -> 扫描 -> 准备 -> 管理 -> 对话引用”的连续路径。

## 3.1 `source-service`

做什么：验证工作空间根路径校验、目录扫描、目录树快照与 diff 模式。

为什么：这是整个 Workspace 功能的底座，底层不稳，IPC 和设置页结论都会失真。

怎么做：先覆盖目录扫描与 diff，再覆盖重复 / 嵌套 / 非法路径等边界。

#### basic

`workspace-source-service-scan-and-diff`

- 实现状态: `已实现`
- What: 验证扫描结果与 diff 模式的基础闭环
- Why: 目录快照和 `full / presence_only / changes_only` 是后续准备与状态更新的基础
- How: 在隔离 workspace 中创建目录、受支持文件和不受支持文件；完成首次扫描后再执行新增、删除和内容修改，再分别计算三种 diff 结果
- Oracle:
  1. 扫描结果只收录受支持文件和目录节点，不把不受支持文件写进快照。
  2. `full` 模式同时识别新增、删除和内容变更。
  3. `presence_only` 模式忽略内容变更，只保留新增和删除。
  4. `changes_only` 模式只保留内容变更，不混入新增和删除。
- Not: 不验证数据库落盘；不验证 IPC；不验证设置页交互。

`workspace-source-service-normalize-and-name`

- 实现状态: `未实现`
- What: 验证根路径规范化和默认显示名生成
- Why: 根路径规范化错误会直接破坏去重、嵌套校验和 UI 展示
- How: 对真实绝对路径、带尾斜杠路径和自定义名称分别执行规范化与命名
- Oracle:
  1. 返回的 `normalizedRootPath` 是真实规范路径，而不是原始输入字符串。
  2. 未传入自定义名称时，默认显示名取目录 basename。
  3. 传入自定义名称时，优先返回用户指定名称。
- Not: 不验证扫描；不验证 diff；不验证设置页交互。

#### boundary

`workspace-source-service-nested-root-rejected`

- 实现状态: `已实现`
- What: 验证重复或嵌套工作空间会被拒绝
- Why: 嵌套工作空间会让快照、准备和范围绑定都出现重复或冲突
- How: 已存在一个工作空间根路径时，再尝试添加其子目录或父目录作为新工作空间
- Oracle:
  1. 子目录作为新工作空间时会被拒绝。
  2. 父目录作为新工作空间时也会被拒绝。
  3. 错误信息明确指向“工作空间之间不能重复或嵌套”。
- Not: 不验证 UI 提示文案；不验证数据库事务。

`workspace-source-service-invalid-root`

- 实现状态: `未实现`
- What: 验证非法根路径输入
- Why: 非目录、空路径或不存在路径必须尽早失败
- How: 分别传入空字符串、普通文件路径和不存在目录路径
- Oracle:
  1. 空路径会被拒绝。
  2. 非目录路径会被拒绝。
  3. 不存在路径不会被误创建成工作空间。
- Not: 不验证设置页错误提示；不验证 IPC 层包装。

#### scenario

`workspace-source-service-large-tree-conservative-scan`

- 实现状态: `未实现`
- What: 验证大型目录扫描后仍能稳定生成完整快照
- Why: 真正用户目录往往层级深、文件多，不能只在小样例里成立
- How: 使用较多目录和文件构造大目录 fixture，完成一次完整扫描和 diff
- Oracle:
  1. 大目录不会导致扫描中断或返回残缺快照。
  2. 目录和文件的相对路径保持稳定，不因层级深度错乱。
  3. 后续 diff 仍能基于快照稳定识别变化。
- Not: 不验证 UI 虚拟树展示；不验证准备链路。

## 3.2 `ipc`

做什么：验证工作空间与网页资料相关 IPC 能正确接住服务层结果。

为什么：前端最终依赖 IPC，而不是直接调用服务。

怎么做：覆盖创建、列表、扫描、准备、删除和网页资料管理的最小闭环。

#### basic

`workspace-ipc-create-list-delete`

- 实现状态: `未实现`
- What: 验证创建、列出和删除工作空间的最小闭环
- Why: 这是用户最先接触的主路径
- How: 通过 IPC 创建工作空间，再查询列表并删除
- Oracle:
  1. 创建成功后列表立即可见。
  2. 删除后列表中不再出现该工作空间。
  3. 目录树节点也随删除一起清理。
- Not: 不验证设置页视觉；不验证准备链路。

`workspace-ipc-scan-and-nodes`

- 实现状态: `未实现`
- What: 验证扫描与节点列表 IPC
- Why: 设置页目录树依赖这条链路
- How: 创建工作空间后执行扫描，再通过节点 IPC 获取快照
- Oracle:
  1. 扫描成功后返回最新进度或成功结果。
  2. 节点列表与扫描后的目录树一致。
  3. 工作空间状态和最近扫描时间被正确更新。
- Not: 不验证准备写库；不验证网页资料。

#### boundary

`workspace-ipc-duplicate-root-rejected`

- 实现状态: `未实现`
- What: 验证重复或嵌套路径在 IPC 层也会被拒绝
- Why: 前端最终感知的是 IPC 返回，不是服务内部异常
- How: 通过 IPC 重复添加同一路径或嵌套路径
- Oracle:
  1. IPC 返回 `success=false`。
  2. 返回明确错误文案，而不是静默失败。
  3. 不会生成半成功的 workspace 记录。
- Not: 不验证设置页提示样式。

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

## 3.3 `settings`

做什么：验证 `Settings -> Workspace` 是唯一资料配置入口，并能完成主路径操作。

为什么：资料入口重构后，最大风险是功能还在但用户路径断了。

怎么做：覆盖入口、创建、扫描、准备、目录树与网页资料管理。

#### basic

`settings-workspace-tab-only-entry`

- 实现状态: `未实现`
- What: 验证 Workspace 已经成为唯一资料配置入口
- Why: 旧入口残留会让用户心智分裂
- How: 从主导航进入设置页，检查 `Workspace` 标签存在且旧资料来源页入口已移除
- Oracle:
  1. 设置页存在 `Workspace` 标签。
  2. 主导航中不再出现旧资料来源页入口。
  3. 通过设置页可看到工作空间与网页资料两个区域。
- Not: 不验证扫描或准备结果正确性。

#### boundary

`settings-workspace-empty-and-error-state`

- 实现状态: `未实现`
- What: 验证空态与错误态稳定呈现
- Why: 初次进入和失败恢复都是高频路径
- How: 在无工作空间、扫描失败或准备失败时打开设置页
- Oracle:
  1. 空态时有明确引导，不是空白页。
  2. 失败时可见错误信息，而不是只在控制台输出。
  3. 失败后仍可继续刷新、重新扫描或删除。
- Not: 不验证 AI 对话联动。

#### scenario

`settings-workspace-create-scan-prepare-flow`

- 实现状态: `未实现`
- What: 验证设置页中的创建、扫描和准备主路径
- Why: 这是迁移后用户最重要的正式操作链路
- How: 在设置页新建工作空间，执行扫描、切换准备模式并完成一次准备
- Oracle:
  1. 新工作空间创建后立即出现在列表中并可选中。
  2. 扫描后目录树和统计值正确刷新。
  3. 准备完成后状态、时间和进度结果可回看。
- Not: 不验证 AI 问答质量；不验证网页资料。

`settings-web-source-management`

- 实现状态: `未实现`
- What: 验证网页资料的添加、过滤、刷新和删除
- Why: Workspace 入口已经统一接管网页资料，不能漏掉这部分交互
- How: 通过设置页添加一条网页资料，再执行搜索过滤、刷新和删除
- Oracle:
  1. 新网页资料进入列表后可被过滤命中。
  2. 刷新和删除操作可从列表直接触发。
  3. 状态、最近抓取时间和错误信息可见。
- Not: 不验证抓取内容质量。

## 3.4 `scope`

做什么：验证 Workspace 输出能稳定进入后续范围选择与对话提示。

为什么：用户感知的不是“目录树已经生成”，而是“我能在对话里用起来”。

怎么做：覆盖 source scope 选择、已准备/未准备提示和继续运行恢复。

#### scenario

`workspace-source-scope-bindings-and-warnings`

- 实现状态: `未实现`
- What: 验证工作空间、目录、文件范围进入 source scope 后的状态与提示
- Why: 范围选择是 Workspace 和对话页之间的核心接口
- How: 选择已准备与未准备的工作空间 / 目录 / 文件，观察标签、提示和可执行性
- Oracle:
  1. 已准备和未准备范围会被正确区分。
  2. 纯搜索模式只接受已准备资料。
  3. AI 对话模式会明确提示未准备文件的代价。
- Not: 不验证 AI 最终答案；不验证真正的模型执行效果。
