## MODIFIED Requirements

### Requirement: Orchestrate host-led loops with explicit capabilities
The system MUST orchestrate runs with host-led control and capability nodes including `local_kb_retrieval`, `terminal_exec`, and extensible future capabilities, MUST exclude legacy writing-workflow task models from active dispatch, and MUST execute host decisions as a bounded action loop rather than one-shot planning.

#### Scenario: Host loops over capability-based context enrichment
- **WHEN** host determines context is insufficient
- **THEN** it dispatches a host-selected context-enrichment capability and re-enters analysis until stop conditions are met

#### Scenario: Host emits a structured next action
- **WHEN** host receives current run context and evidence
- **THEN** it emits exactly one host-control tool call (`retrieve_context`, `create_plan`, or `final_answer`) for runtime execution

#### Scenario: Host selects terminal/docx for context enrichment
- **WHEN** host decides that file-system or docx-bound evidence is required before planning
- **THEN** runtime dispatches `retrieve_context` using the selected capability kind (`terminal_exec` or `docx`) under existing workspace/policy gates

#### Scenario: Legacy writing task shape appears in plan
- **WHEN** plan parsing encounters legacy writing-workflow task kind or payload shape
- **THEN** runtime rejects the task as unsupported legacy capability and continues only with valid capability-based tasks

### Requirement: Let host choose direct response vs execution plan
The host MUST decide whether to answer directly or create an execution plan after optional context enrichment, and runtime MUST NOT force heuristic execution tasks when host has concluded direct response is sufficient.

#### Scenario: Informational request
- **WHEN** no executable action is needed
- **THEN** host emits direct response without dispatching execution capabilities

#### Scenario: Action request
- **WHEN** local actions are needed
- **THEN** host emits plan tasks and dispatches capability execution

#### Scenario: Host chooses no plan after enrichment
- **WHEN** host finishes context enrichment and selects `final_answer`
- **THEN** runtime completes without synthesizing fallback plan tasks

### Requirement: Track completion by host action semantics
The runtime MUST update run/task completion according to host action type so that `retrieve_context` is treated as internal context progression, `create_plan` enters plan/task lifecycle, and `final_answer` terminates the run directly.

#### Scenario: Host executes retrieve_context
- **WHEN** host emits `retrieve_context` and the selected capability returns a terminal step result
- **THEN** runtime marks only the internal context-enrichment step as complete and re-enters host decision loop without emitting `plan_created`

#### Scenario: Host executes create_plan
- **WHEN** host emits `create_plan`
- **THEN** runtime emits `plan_created`, transitions plan tasks into lifecycle tracking, and updates completion through `task_*` events

#### Scenario: Host executes final_answer
- **WHEN** host emits `final_answer`
- **THEN** runtime emits final answer stream and completes the run without creating execution plan tasks

## ADDED Requirements

### Requirement: Keep host decision loop bounded and fail-safe
Host decision and pre-plan context enrichment MUST execute within configured bounds (round count, timeout, and cancellation checks) and MUST degrade safely when bounds are reached.

#### Scenario: Decision loop reaches configured bound
- **WHEN** host keeps requesting context enrichment beyond configured max rounds
- **THEN** runtime stops further enrichment and forces terminal routing to `create_plan` or `final_answer` with explicit failure-safe handling

#### Scenario: Context-enrichment capability is blocked by workspace gate
- **WHEN** host selects a workspace-bound capability for `retrieve_context` without valid workspace binding
- **THEN** runtime emits workspace-required gating signals and returns control to host with a bounded fallback path
