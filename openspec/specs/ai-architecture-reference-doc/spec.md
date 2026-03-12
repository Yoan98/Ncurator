# ai-architecture-reference-doc Specification

## Purpose
Define the canonical AI architecture entry doc and the synchronization rule between AI architecture docs, skills, and agent guidance.
## Requirements
### Requirement: Maintain canonical AI architecture reference document
The system MUST provide a canonical AI architecture reference at `doc/architecture/ai/README.md` for the active LangGraph chat architecture.

#### Scenario: Developer needs architecture baseline
- **WHEN** a task involves AI runtime, capability routing, or AI execution UI contracts
- **THEN** the canonical document provides current architecture boundaries, responsibilities, and extension rules

### Requirement: Require skill-based architecture doc reading for relevant tasks
The system MUST provide a dedicated skill that requires reading `doc/architecture/ai/README.md` when work involves AI architecture.

#### Scenario: AI architecture-related task is requested
- **WHEN** an agent receives an AI architecture task
- **THEN** workflow guidance directs the agent to read the AI architecture entry doc before making design or implementation changes

### Requirement: Keep architecture doc and agent rules synchronized
The system MUST update `AGENTS.md` and the AI architecture skill trigger rules together whenever AI architecture guidance changes.

#### Scenario: Architecture guidance is updated
- **WHEN** capability boundaries or runtime workflow rules change
- **THEN** both the canonical doc and agent guidance are updated in the same change set to avoid drift
