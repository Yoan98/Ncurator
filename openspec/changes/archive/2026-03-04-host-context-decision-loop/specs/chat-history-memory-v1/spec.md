## MODIFIED Requirements

### Requirement: Maintain compact bounded session summary
The system MUST maintain a compact session summary suitable for inclusion in run prompts, and host run context MUST include bounded summary, bounded recent turns, and bounded local-instruction inputs used for host decisions.

#### Scenario: Summary participates in host decisions
- **WHEN** host begins analysis for a run
- **THEN** host receives bounded summary, bounded recent turns, and a bounded local-instruction bundle

## ADDED Requirements

### Requirement: Build deterministic local-instruction bundle for host
The host context builder MUST construct a deterministic local-instruction bundle from persisted memory fields (including user preferences and pinned facts) and runtime workspace policy metadata, with explicit priority order and size limits.

#### Scenario: Local instruction bundle is generated
- **WHEN** a run context is created
- **THEN** runtime generates a local-instruction bundle with deterministic ordering, bounded length, and no duplicated instruction entries

#### Scenario: Missing optional instruction sources
- **WHEN** session memory or workspace policy metadata is partially missing
- **THEN** runtime still provides a valid local-instruction bundle from available sources without failing run initialization
