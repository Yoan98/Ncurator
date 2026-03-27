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

正式 case 在本文登记时，必须包含 `测试类型` 字段：

- `backend`
  - 用于隔离直接支撑 Settings 行为的服务与 IPC 契约。
- `e2e`
  - 用于直接对齐 PRD 的用户可见验收。

suite 本身不再拆分 `backend` / `e2e`；具体测试类型只在 case 登记时体现。

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
- 所有正式结论都应优先引用 [settings.md](/Users/test/work-space/NCurator-Desktop/doc/prd/settings.md) 中对应的 `SET-*` 编号。
- Settings 正式目录路径与 case 登记规则统一以 [test.md](/Users/test/work-space/NCurator-Desktop/doc/test.md) 为准。
