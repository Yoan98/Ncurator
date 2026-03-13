# ai-task-delivery-handoff Specification

## Purpose
TBD - created by archiving change human-led-delivery-handoff. Update Purpose after archive.
## Requirements
### Requirement: Human 任务 MUST 产出正式交付物
每个 human 任务在进入完成或阻塞终态后 MUST 产出正式任务交付，且该交付 MUST 同时包含简短 `summary` 与完整 `deliveryMarkdown`；其中 `deliveryMarkdown` MUST 作为任务交付、plan handoff 和最终总结输入的真相源。

#### Scenario: 完成任务后生成正式交付
- **WHEN** human 完成当前 objective 并进入任务收敛阶段
- **THEN** runtime MUST 返回包含 `summary` 与 `deliveryMarkdown` 的任务结果，而不是只返回短摘要

#### Scenario: 阻塞任务仍生成可交接交付
- **WHEN** human 以阻塞终态结束任务
- **THEN** runtime MUST 仍然生成 `deliveryMarkdown`，明确写出已完成项、阻塞点与建议后续步骤，供后续总结或人工查看

### Requirement: Plan 子任务 MUST 通过 markdown handoff 顺序传递依赖
当运行进入计划执行路径时，系统 MUST 允许已完成子任务的 `deliveryMarkdown` 作为后续子任务 objective 的自然语言上下文，并 MUST NOT 以结构化字段依赖作为该链路成立的前置条件。

#### Scenario: 后续子任务接收前序 handoff
- **WHEN** 第 N 个计划任务开始执行且前面已有已完成任务
- **THEN** runtime MUST 将前序任务的 handoff 文本编译进新的 objective，使下一个 human 可以基于自然语言交接继续推进

#### Scenario: handoff 不要求固定 JSON schema
- **WHEN** 中间任务交付包含段落、列表、表格、链接或图片引用
- **THEN** 后续任务仍 MUST 能把该 markdown 作为有效 handoff 消费，而不是要求严格的结构化 JSON 字段

### Requirement: Plan 运行 MUST 通过 synthesis human 汇总最终答复
当 main 选择计划执行路径时，系统 MUST 在业务子任务结束后追加一次 synthesis human 运行，并由其基于原始用户请求与全部 handoff 生成最终用户答复。

#### Scenario: 全部业务任务完成后进入 synthesis
- **WHEN** 所有计划中的业务任务都已完成
- **THEN** runtime MUST 追加一次 synthesis human，并由该任务输出最终用户答复

#### Scenario: 中间任务阻塞后仍进入 synthesis
- **WHEN** 计划中的某个业务任务以阻塞终态结束
- **THEN** runtime MUST 停止后续业务任务派发，但仍 MUST 进入 synthesis human，以统一总结已完成部分、阻塞原因与下一步建议

