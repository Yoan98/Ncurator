## REMOVED Requirements

### Requirement: Orchestrate host-led loops with explicit capabilities
**Reason**: 旧 requirement 仍以 host/finalization 为中心描述运行时，无法表达 `main` 纯编排、`human` 负责任务交付的新边界。
**Migration**: 使用新的 main orchestration 模型：`main_intent -> main_context_human | main_direct_human_exec | main_plan -> main_plan_exec -> main_synthesis_human -> main_complete`。

### Requirement: Let host choose direct response vs execution plan
**Reason**: 旧 requirement 以 `direct response` 和 `finalization` 为终点，不再适用于 `direct_human` 与 plan+synthesis human 的收口方式。
**Migration**: 使用新的路由语义：`need_context | direct_human | to_plan`，并在 plan 结束后追加 synthesis human。

### Requirement: Host owns final response streaming
**Reason**: 最终答复流不再由 main finalization 统一生成，而是由 direct human 或 synthesis human 的 delivery 节点发出。
**Migration**: 所有最终用户答复都通过 human delivery 生成；main 仅负责 orchestration 和 run 收尾。

## MODIFIED Requirements

### Requirement: Support cancellation and fail-fast routing
运行时 MUST 在 main/human 双层都支持取消与失败快速收敛；取消发生后 MUST 停止当前 human、后续业务任务派发和 synthesis 调用；业务任务出现不可恢复阻塞时 MUST 停止后续业务任务，但在未取消的前提下 MUST 继续进入 synthesis human 汇总当前运行状态。

#### Scenario: Cancel during direct or planned human execution
- **WHEN** direct human、计划中的业务 human 或 synthesis human 执行过程中收到取消信号
- **THEN** runtime MUST 立即停止当前执行并结束 run，且不得继续派发剩余业务任务或 synthesis

#### Scenario: Unrecoverable business task block in plan mode
- **WHEN** 某个计划中的业务任务返回不可恢复的阻塞终态
- **THEN** main MUST 停止后续业务任务派发，并将已完成交付与阻塞信息带入 synthesis human，而不是继续盲目推进剩余业务任务

## ADDED Requirements

### Requirement: Main graph MUST 只负责编排而不负责任务交付
系统 MUST 继续使用双层运行模型，其中 `main graph` 仅负责意图判断、上下文补充、计划生成、任务派发和 run 收尾；正式任务交付与最终用户答复 MUST 由 human 生成。

#### Scenario: Main graph orchestrates current runtime stages
- **WHEN** 新 run 启动
- **THEN** main graph MUST 按 `intent -> context human | direct human | plan -> plan exec -> synthesis human -> complete` 的当前架构推进，而不是进入 finalization 生成答复

#### Scenario: Legacy writing task shape appears
- **WHEN** 计划中出现 legacy writing-workflow 任务形态
- **THEN** runtime MUST 继续将其视为不支持的旧任务形态并拒绝调度

### Requirement: Main MUST route runs to direct human or planned execution
系统 MUST 在 main 层完成 `need_context | direct_human | to_plan` 三路路由决策；若无需 plan，runtime MUST 直接派发一个 direct human 执行用户请求并输出最终答复。

#### Scenario: Direct human path
- **WHEN** 用户请求可由单个 human 独立完成且不需要 plan
- **THEN** main MUST 派发 direct human，并由该 human 直接生成最终用户答复

#### Scenario: Plan execution path
- **WHEN** 用户请求需要多个业务子任务才能完成
- **THEN** main MUST 生成业务任务列表并逐个派发到独立 human 运行，且 planner 输出中不得混入系统收口用的总结任务

### Requirement: Plan runs MUST append synthesis human before completion
当运行进入计划路径时，main MUST 在业务任务结束后自动追加一个 synthesis human，用于汇总全部子任务交付并生成最终用户答复；该 synthesis 步骤 MUST 由 runtime 注入，而不是由 planner 负责规划。

#### Scenario: Synthesis follows completed business tasks
- **WHEN** 计划中的业务任务全部完成
- **THEN** main MUST 追加 synthesis human，再进入 run 完成收尾

#### Scenario: Synthesis is runtime-owned rather than planner-owned
- **WHEN** planner 输出业务任务列表
- **THEN** runtime MUST 将最终总结视为系统追加步骤，而不是要求 planner 把总结任务显式写进计划中
