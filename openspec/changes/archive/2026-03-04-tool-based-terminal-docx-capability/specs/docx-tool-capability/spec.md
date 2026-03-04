## ADDED Requirements

### Requirement: Implement docx capability as tool-driven execution
The `docx` capability MUST be implemented as a LangChain tool-driven executor and MUST NOT remain a placeholder response once this change is applied.

#### Scenario: Docx task is dispatched
- **WHEN** host dispatches a `docx` task
- **THEN** runtime executes concrete docx tools and returns a real task result instead of `not_implemented`

### Requirement: Keep docx runtime Node.js-first
The `docx` capability implementation MUST run with Node.js-compatible dependencies and MUST NOT require Python libraries or external system tools as baseline end-user requirements.

#### Scenario: Runtime dependency validation
- **WHEN** docx tools are installed and packaged for app runtime
- **THEN** capability operation succeeds without requiring Python or system package installation by end users

### Requirement: Provide structured docx tool set
The `docx` capability MUST expose structured tools for inspect, edit planning, applying edits, saving outputs, and explicit completion.

#### Scenario: Capability applies a user-requested edit
- **WHEN** user asks to modify an existing `.docx`
- **THEN** the capability performs inspect/plan/apply/save steps through typed tool calls before returning completion

### Requirement: Enforce workspace and write-safety policies for docx operations
The `docx` capability MUST require workspace binding for file actions and MUST gate destructive write operations behind approval.

#### Scenario: Request attempts to overwrite source docx file
- **WHEN** capability receives an in-place overwrite operation
- **THEN** runtime requests approval before write and defaults to save-as behavior when overwrite is not approved

### Requirement: Run bounded internal tool loops and finish explicitly
The `docx` capability MUST run an internal tool loop to satisfy the task objective, MUST enforce bounded loop limits (for example max-step and timeout), and MUST terminate with explicit success or failure state.

#### Scenario: Docx task requires multiple iterative tool steps
- **WHEN** a docx objective cannot be completed in a single tool call
- **THEN** the capability continues iterative inspect/plan/apply/save tool execution within configured limits until finish is emitted

#### Scenario: Docx loop exceeds configured bounds
- **WHEN** the capability reaches max-step or timeout limit before completion
- **THEN** the task is marked failed with a bounded-loop error and no further docx tool calls are executed
