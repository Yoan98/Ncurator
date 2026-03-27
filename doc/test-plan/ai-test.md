# NCurator-Desktop Core AI 测试计划

## 1. 总体目标

本计划用于定义 AI 正式测试的 suite 划分与归属。

AI 的用户可见行为、页面交互与 e2e 验证统一归入 [workbench-test.md](/Users/test/work-space/NCurator-Desktop/doc/test-plan/workbench-test.md)。

## 2. 阶段设计

测试按 suite 顺序推进，原则上基础契约先稳定，再进入更上层编排验证。

AI 正式测试当前分为三个 suite：

1. `tool`
2. `human`
3. `director`

### 2.1 `tool`

做什么：验证 AI 运行依赖的核心工具与工具契约。

为什么：工具层不稳定时，上层执行与编排结论都会失真。

怎么做：以默认测试形态验证单个工具或单类工具是否满足上层调用前提，例如读取、写入、保存、审批、范围约束、失败回传和结果可回看。

### 2.2 `human`

做什么：验证 `human` 作为 AI 执行体，是否能基于明确目标自主推进、处理中断并形成可交付结果。

为什么：工具只是零件，`human` 才决定单任务执行链路能不能真正闭环。

怎么做：以默认测试形态验证单任务执行、工具协作、阻塞收敛、部分交付和 handoff 结构是否稳定。

### 2.3 `director`

做什么：验证 `director` 对整体 AI 链路的编排能力。

为什么：路由、补上下文、任务拆解、阶段切换和最终综合都属于 `director` 的职责；这一层不稳定时，系统会在进入执行前走偏。

怎么做：以默认测试形态统一覆盖 `context / intent / plan / entire` 范围，重点验证路由判断、上下文补齐、任务编排、执行衔接和综合交付。

## 3. 用例登记字段

- 正式 case 在本文登记时，必须包含 `测试类型` 字段。
- AI 域当前正式 case 的 `测试类型` 固定为 `backend`。
- suite 本身不再拆分 `backend` / `e2e`；测试类型只在 case 登记时体现。

## 4. Suite 归属规则

- AI 正式 case 必须先判断主要验证的是哪一层契约，再归到单一 suite。
- `tool` 只承接工具能力与工具契约验证。
- `human` 只承接单任务执行与单任务交付验证。
- `director` 统一承接路由、补上下文、任务编排和综合交付验证。
- Workbench 的用户可见行为、阻塞恢复、review、scope 与 e2e 不归入 AI 测试。
- AI 正式目录路径与 case 登记规则统一以 [test.md](/Users/test/work-space/NCurator-Desktop/doc/test.md) 为准。
