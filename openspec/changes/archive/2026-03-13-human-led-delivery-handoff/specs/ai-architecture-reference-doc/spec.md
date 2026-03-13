## MODIFIED Requirements

### Requirement: Maintain canonical AI architecture reference document
The system MUST provide a canonical AI architecture reference at `doc/architecture/ai/README.md` for the active LangGraph chat architecture, and that document MUST describe the current boundaries of `main orchestration`、`human delivery`、`direct_human`、`plan execution` and `synthesis human`.

#### Scenario: Developer needs architecture baseline
- **WHEN** a task involves AI runtime, capability routing, human delivery, task handoff, or AI execution UI contracts
- **THEN** the canonical document MUST provide the current architecture boundaries, responsibilities, runtime flow, and extension rules for the active human-led delivery model

### Requirement: Keep architecture doc and agent rules synchronized
The system MUST update `AGENTS.md` and the AI architecture skill trigger rules together whenever AI architecture guidance changes, including changes to main/human boundaries, task delivery semantics, or default canonical diagrams.

#### Scenario: Architecture guidance is updated
- **WHEN** runtime workflow rules, human delivery semantics, or canonical architecture diagrams are updated
- **THEN** both the canonical doc and agent guidance MUST be updated in the same change set to avoid drift

## ADDED Requirements

### Requirement: Provide canonical AI architecture diagrams
canonical AI architecture docs MUST include stable architecture diagrams for the active runtime, and these diagrams MUST at least cover the overall main/human execution flow and the plan handoff/synthesis flow.

#### Scenario: Developer reads architecture overview
- **WHEN** a developer opens the canonical AI architecture entry doc
- **THEN** the document MUST provide a current high-level architecture diagram that shows how main orchestration and human delivery interact

#### Scenario: Developer reads plan handoff design
- **WHEN** a developer needs to understand how plan tasks pass context and how final synthesis works
- **THEN** the canonical docs MUST provide a diagram or equivalent visual showing sequential handoff and synthesis human aggregation
