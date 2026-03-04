## MODIFIED Requirements

### Requirement: Emit plan and task progression events
The system MUST emit events for plan creation and task state transitions, and MUST keep pre-plan context enrichment actions semantically separate from user-visible execution plan lifecycle.

#### Scenario: Task state transitions
- **WHEN** tasks start/complete/fail
- **THEN** stream includes task lifecycle events with task ids

#### Scenario: Context enrichment occurs before planning
- **WHEN** host runs capability-based context enrichment actions before deciding to create a plan
- **THEN** stream does not emit `plan_created` until host explicitly chooses `create_plan`

#### Scenario: Pre-plan context enrichment uses workspace-bound capability
- **WHEN** host selects `terminal_exec` or `docx` for context enrichment and workspace gate is unmet
- **THEN** stream emits existing workspace/approval gating events without prematurely emitting user-visible plan lifecycle events

#### Scenario: Final-answer path without plan creation
- **WHEN** host chooses `final_answer` before `create_plan`
- **THEN** stream emits answer completion and run completion events without emitting `plan_created` or `task_*` plan lifecycle events

### Requirement: Emit UI-friendly activity events
The system MUST emit normalized activity events that describe user-visible AI actions for inline assistant-side rendering, including host decision and context-enrichment progress.

#### Scenario: Activity feed rendering
- **WHEN** runtime performs meaningful actions (read docs, run command, create/delete files, host decision, context enrichment, etc.)
- **THEN** stream includes activity events with status, action type, and concise human-readable summary

## ADDED Requirements

### Requirement: Preserve backward compatibility for event consumers
Event-stream evolution for host decision loops MUST be backward compatible for existing renderers consuming current event union types.

#### Scenario: New decision-loop observability is introduced
- **WHEN** runtime adds fields or event categories for host decision-loop observability
- **THEN** additions are incremental and existing event payload contracts remain parseable by prior consumers
