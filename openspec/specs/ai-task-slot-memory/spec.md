# ai-task-slot-memory Specification

## Purpose
本规格已废弃。运行时已移除 task slot memory / slot commit 机制，保留最小任务输入输出契约。

## Requirements
### Requirement: Remove slot-memory runtime dependency
系统 MUST 不再依赖 slot namespace、`consume/produce/expect` 或 slot 原子提交作为 human 步骤推进前提。

#### Scenario: Human step without slot declarations
- **WHEN** brain 发起 capability tool call
- **THEN** runtime 直接执行并根据 tool 结果继续循环或收敛，无需 slot 校验

### Requirement: Keep deterministic task-level outputs
系统 MUST 将 human 执行结果收敛为任务级输出（`status/summary/resultCode/resultData`），并由 main 聚合结果。

#### Scenario: Capability execution succeeds
- **WHEN** capability 返回成功结果
- **THEN** human 继续步骤循环或通过 `complete_task` 收敛，并以任务级结果返回给 main
