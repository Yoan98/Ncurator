# NCurator-Desktop Workbench 测试计划

## 1. 总体目标

本计划用于定义 workbench 用户可见能力的正式测试范围。

workbench 正式测试统一对齐 [workbench.md](/Users/test/work-space/NCurator-Desktop/doc/prd/workbench.md)，新增、调整或验收结论都应引用对应的 `WB-*` 需求编号与验收编号。

## 2. Suite 设计

workbench 的正式测试 suite 直接对齐 PRD 模块：

1. `core`
2. `session`
3. `composer`
4. `mode`
5. `scope`
6. `blocker`
7. `panel`
8. `review`

正式 case 在本文登记时，必须包含 `测试类型` 字段：

- `backend`
  - 用于隔离支撑 workbench 行为的契约验证。
- `e2e`
  - 用于直接对齐 PRD 的用户可见验收。

suite 本身不再拆分 `backend` / `e2e`；具体测试类型只在 case 登记时体现。

### 2.1 `core`

做什么：验证 workbench 的核心能力边界与上下文使用前提。

为什么：这是后续会话、发送、检索和执行的共同基础。

怎么做：围绕本地资料是否可选、显式资料范围是否影响执行、问答与受支持文件任务中的本地资料优先 / 模型知识回退、`terminal` 结果是否被后续交付消费、当前受支持文件类型的新增 / 编辑能力边界是否清晰等规则组织正式 case。

### 2.2 `session`

做什么：验证会话初始化、切换、删除和续做主线保持。

为什么：会话状态一旦失真，后续所有运行态和右侧内容都会串线。

怎么做：围绕默认会话创建、切换重置、标题更新、删除后回退和同会话续做组织正式 case。

### 2.3 `composer`

做什么：验证输入、发送、取消和本地执行前置校验。

为什么：composer 是 workbench 的主入口，错误会直接放大到整条任务链路。

怎么做：围绕发送前置条件、键盘行为、智能/搜索发送路径、本地执行拦截、`terminal` 调用前置条件和取消运行组织正式 case。

### 2.4 `mode`

做什么：验证智能模式与搜索模式的切换和约束。

为什么：模式切换会直接改变发送路径、结果呈现和范围校验。

怎么做：围绕模式切换保持输入、搜索模式严格范围校验组织正式 case。

### 2.5 `scope`

做什么：验证 `@` 资料范围、source scope 和范围清理规则。

为什么：资料范围是 workbench 和资料体系之间的核心接口。

怎么做：围绕候选来源、插入删除、重复去重、跨工作区清理和空候选提示组织正式 case。

### 2.6 `blocker`

做什么：验证 AI 运行中的阻塞、恢复和 warning。

为什么：审批、补工作区和未加载资料提示都会直接影响任务是否能继续完成。

怎么做：围绕审批阻塞、`workspace_required` 恢复和未加载资料 warning 组织正式 case。

### 2.7 `panel`

做什么：验证右侧内容面板的状态切换与内容打开规则。

为什么：搜索结果、文档查看和 review 入口都依赖右侧面板稳定收口。

怎么做：围绕空态、搜索结果、本地文档查看和 review 入口衔接组织正式 case。

### 2.8 `review`

做什么：验证确认修改流程。

为什么：review 是 workbench 中最直接影响文档落盘的用户可见链路。

怎么做：围绕 review 打开、默认选中、修改导航、提交前校验、现有受支持文件写回、新建受支持文件落盘、放弃、结束态和多 review 入口组织正式 case。

## 3. Suite 归属规则

- Workbench 的用户可见行为默认归入本计划，不再挂到 AI 或 Settings 域下。
- `scope`、`workspace_required` 恢复、右侧面板和 `review` 统一归入 workbench。
- 所有正式结论都应优先引用 [workbench.md](/Users/test/work-space/NCurator-Desktop/doc/prd/workbench.md) 中对应的 `WB-*` 编号。
- Workbench 正式目录路径与 case 登记规则统一以 [test.md](/Users/test/work-space/NCurator-Desktop/doc/test.md) 为准。
