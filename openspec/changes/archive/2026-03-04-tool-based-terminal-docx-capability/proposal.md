## Why

The current runtime can route `docx` tasks but still returns a placeholder, and `terminal_exec` executes raw command text directly instead of decomposing natural-language objectives through tools. This makes capability behavior inconsistent with the intended host/capability architecture and limits safe, auditable automation for file-editing workflows.

## What Changes

- Refactor `terminal_exec` into a tool-driven capability loop where the model plans from natural-language task goals and can only execute commands via explicit terminal tools.
- Replace the `docx` placeholder with a Node.js-first tool-driven capability that supports inspect, edit-plan, apply, and save operations on `.docx` files.
- Introduce standardized file-artifact run events for capability outputs so Renderer can present open/reveal actions consistently.
- Tighten capability contracts and event typing for tool-based execution paths in Main/Renderer boundaries.

## Capabilities

### New Capabilities

- `terminal-exec-tool-loop`: Tool-first terminal capability that transforms natural-language objectives into bounded command steps with policy/approval enforcement.
- `docx-tool-capability`: Node.js-based DOCX capability implemented as LangChain tools for inspect/plan/apply/save workflows.
- `ai-run-file-artifacts`: Standardized artifact metadata events and UI handling for files created or updated by terminal/docx capabilities.

### Modified Capabilities

- None.

## Impact

- Affected code:
  - `src/main/services/ai/graph.ts` (capability execution path, terminal/docx executors)
  - `src/main/services/ai/tools/*` (new terminal/docx tools and adapters)
  - `src/shared/types.ts` (run event/task result contracts)
  - `src/preload/index.ts` and `src/renderer/src/pages/ChatPage.tsx` (artifact event/UI integration)
- Affected behavior:
  - `terminal_exec` accepts natural-language objectives and uses internal tools for iterative execution.
  - `docx` capability moves from `not_implemented` placeholder to concrete Node.js-first editing flow.
- Dependencies:
  - Add Node-side DOCX manipulation dependencies only if needed by implementation (no Python/system-tool baseline requirement).
