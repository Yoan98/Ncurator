# ai-task-slot-memory Specification

## Purpose
TBD - created by archiving change main-human-brain-architecture. Update Purpose after archive.
## Requirements
### Requirement: Provide task-scoped slot namespace
系统 MUST 为每个 human 任务维护独立 slot 命名空间，且不同任务之间 MUST 不共享隐式 slot 状态。

#### Scenario: Isolated slot namespace
- **WHEN** 两个任务并行或串行执行
- **THEN** 每个任务仅可读取和写入自身 slot 命名空间

### Requirement: Enforce consume and produce declarations
brain 的 `invoke_capability` 动作 MUST 显式声明 `consume` 与 `produce`，运行时 MUST 在执行前校验 `consume` 可读，在执行后校验 `produce` 提交结果。

#### Scenario: Missing consume slot
- **WHEN** 动作声明的 `consume` slot 不存在
- **THEN** 本步骤执行被拒绝并返回可诊断错误

#### Scenario: Produce slot commit succeeds
- **WHEN** capability 返回合法输出
- **THEN** 运行时将输出写入声明的 `produce` slot

### Requirement: Enforce expect.requiredOutputs before advancing
步骤完成后，系统 MUST 校验 `expect.requiredOutputs` 全部满足；若不满足 MUST 禁止进入下一步并交由 brain 重新决策或阻塞任务。

#### Scenario: Required output missing
- **WHEN** 本步骤结束后缺少 `expect.requiredOutputs` 中任一项
- **THEN** 运行时拒绝推进到下一步并返回缺失输出信息

### Requirement: Commit slot updates atomically per step
同一步骤产生的 slot 更新 MUST 以原子方式提交，提交失败时 MUST 不得出现部分成功状态。

#### Scenario: Partial write failure
- **WHEN** 本步骤写入多个 slot 且中途失败
- **THEN** 运行时回滚该步骤 slot 变更并标记提交失败

### Requirement: Store large payloads by references
对于大文本或文件型输出，系统 MUST 以引用（ref）方式写入 slot，并提供可用于后续步骤消费的摘要信息。

#### Scenario: Large output produced by tool
- **WHEN** 工具输出超过内联阈值
- **THEN** 运行时保存引用并在 slot 中记录 `ref + summary`

