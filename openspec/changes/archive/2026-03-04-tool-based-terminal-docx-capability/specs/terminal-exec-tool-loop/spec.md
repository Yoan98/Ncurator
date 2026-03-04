## ADDED Requirements

### Requirement: Accept natural-language terminal objectives
The `terminal_exec` capability MUST accept natural-language task objectives and MUST NOT require host planning to provide raw shell command text.

#### Scenario: Host dispatches a goal-oriented terminal task
- **WHEN** host emits a `terminal_exec` task with only objective text
- **THEN** the capability starts an internal tool-driven planning/execution loop without failing for missing raw command input

### Requirement: Execute commands only through terminal tools
The `terminal_exec` capability MUST execute shell commands only through explicit LangChain tools exposed to the capability agent.

#### Scenario: Capability needs to run a shell command
- **WHEN** the capability determines a command is needed
- **THEN** it issues a terminal command tool call and does not execute shell text outside the tool boundary

### Requirement: Enforce policy and approvals per command tool call
Each command tool call in `terminal_exec` MUST apply workspace boundary checks, risk classification, and approval gating before execution.

#### Scenario: Medium or high-risk command is proposed
- **WHEN** command risk is classified as `medium` or `high`
- **THEN** the capability emits approval-required flow and blocks execution until approved

### Requirement: Keep terminal loops bounded and finish explicitly
The `terminal_exec` capability MUST use bounded internal iteration and MUST terminate with explicit success/failure state.

#### Scenario: Loop reaches maximum steps without completion
- **WHEN** command iterations hit configured max-step limit before finish
- **THEN** the task is marked failed with a bounded-loop error and no further command execution occurs

