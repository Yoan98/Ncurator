## ADDED Requirements

### Requirement: Emit artifact metadata for capability file outputs
The runtime MUST emit artifact metadata events whenever terminal or docx capability writes or updates local files.

#### Scenario: Docx capability writes a new file
- **WHEN** `docx` capability saves an output document
- **THEN** event stream includes artifact metadata with run/task correlation, local path, and operation summary

### Requirement: Keep artifact events correlated and UI-usable
Artifact events MUST include fields required for deterministic run trace grouping and direct Renderer actions.

#### Scenario: Renderer receives mixed run events
- **WHEN** artifact events arrive among tool, terminal, and activity events
- **THEN** Renderer can associate each artifact with its run/task and render open/reveal actions without heuristic parsing

### Requirement: Preserve existing run flow when artifact emission fails
Artifact emission MUST fail gracefully and MUST NOT crash the active run if metadata reporting fails after a successful write.

#### Scenario: File write succeeds but artifact event serialization fails
- **WHEN** runtime cannot serialize or publish artifact metadata
- **THEN** task result remains successful and runtime emits a non-fatal activity/error trace for observability

