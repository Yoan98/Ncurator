## Context

The active runtime is a host-led LangGraph architecture with capability dispatch in Main process. `terminal_exec` currently executes `task.input` as raw command text and only uses AI after command execution to decide next steps. `docx` is registered but implemented as a placeholder returning `not_implemented`.  

This creates a mismatch with the intended capability model: capabilities should internally orchestrate their own bounded tool loops and expose auditable traces. It also blocks the requirement to support Node.js-first docx editing inside the same runtime boundary and event model.

## Goals / Non-Goals

**Goals:**
- Convert `terminal_exec` into a LangChain tool-driven capability loop that starts from natural-language objectives.
- Implement `docx` as a LangChain tool-driven capability with inspect/plan/apply/save flow under Node.js-only baseline constraints.
- Extend run events with explicit file artifact metadata for terminal/docx outputs.
- Preserve current workspace boundary and approval policy model while reusing it inside tools.

**Non-Goals:**
- Rewriting host planning into a separate multi-agent framework.
- Adding Python-based docx dependencies or system-tool requirements as baseline runtime prerequisites.
- Building a full WYSIWYG docx editor in Renderer.

## Decisions

### 1) Capability-local agent loops will use LangChain tools

`terminal_exec` and `docx` will each bind a dedicated tool set and run internal loop steps through `ToolNode` style execution. Model output is constrained to tool calls plus explicit finish signaling.

Rationale:
- Aligns both capabilities with the same observable execution pattern.
- Keeps host graph simple: host dispatches objective, capability handles execution details.
- Improves auditability through tool-level events.

Alternatives considered:
- Keep `terminal_exec` as raw command executor and only toolize `docx`: rejected because it keeps inconsistent capability semantics.
- Move command/docx planning back to host: rejected due to tighter coupling and larger host state complexity.

### 2) `terminal_exec` command execution is wrapped by a single execution tool

A dedicated `terminal_run_command` tool will encapsulate boundary checks, risk classification, approval requests, command execution, and step events. A separate `terminal_finish` tool signals completion.

Rationale:
- Centralizes safety checks in one deterministic path.
- Prevents hidden execution side channels.

Alternatives considered:
- Multiple low-level tools (`check_boundary`, `classify_risk`, `run_shell`): rejected for higher orchestration overhead and easier policy bypass by bad tool sequencing.

### 3) `docx` will use deterministic adapters behind tools

The `docx` capability agent will call typed tools (`docx_inspect`, `docx_apply_edits`, `docx_save_output`, `docx_finish`). Internally, edits are executed by deterministic Node adapters over docx OOXML data.

Rationale:
- Keeps model responsible for intent/planning, not raw XML mutation.
- Reduces document corruption risk and improves repeatability.

Alternatives considered:
- Let model produce direct XML patches: rejected for safety and reliability reasons.
- Keep placeholder and route edits through terminal shell scripts: rejected because this bypasses typed contracts and Node-first runtime design.

### 4) File outputs will be first-class run artifacts

Introduce explicit artifact events carrying run/task correlation, file path, operation type, and summary. Renderer consumes these events for direct open/reveal actions.

Rationale:
- Eliminates fragile path extraction from generic JSON blobs.
- Aligns with capability trace UX and future file capabilities.

Alternatives considered:
- Continue parsing paths from text output: rejected for low reliability and poor typing.

## Risks / Trade-offs

- [Risk] Tool loops can increase prompt/tool round latency compared with raw command execution.  
  Mitigation: enforce strict max steps, concise tool IO previews, and small control prompts.

- [Risk] Docx structural edits may still break rare complex layouts.  
  Mitigation: constrain first version to supported operations and return explicit unsupported-operation errors.

- [Risk] New artifact event contracts require synchronized Main/Shared/Renderer changes.  
  Mitigation: add discriminated union types first, then incremental UI adoption with fallback rendering.

- [Risk] Approval frequency may rise because more operations become explicit tool calls.  
  Mitigation: keep existing risk classification and tune thresholds only after telemetry review.

## Migration Plan

1. Introduce typed tool contracts and shared event additions for terminal/docx/artifacts.
2. Refactor `terminal_exec` from raw-input execution to tool-driven loop using existing execution primitives.
3. Replace docx placeholder executor with tool-driven implementation and Node adapters.
4. Add artifact event emission for terminal/docx writes and wire Renderer actions to these events.
5. Validate via typecheck and smoke tests for retrieval path, terminal objective execution, docx editing path, and artifact UI actions.

Rollback strategy:
- Keep capability registration boundaries unchanged so rollback can restore previous terminal/docx executors while preserving host flow.
- If artifact event integration causes UI issues, fallback to existing right-panel JSON rendering without blocking run completion.

## Open Questions

- Which exact first-release docx edit operations are mandatory (text replace, section append, table cell update)?
- Should overwrite approval policy be unified for terminal and docx writes or remain capability-specific?
- Do we want a separate `docx_validate` tool in V1, or defer validation to a later capability iteration?

