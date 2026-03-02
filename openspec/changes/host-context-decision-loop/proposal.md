## Why

当前 host 在运行时是“一次性生成计划再执行”，缺少显式的“先判断是否需要补充上下文，再决定直答或规划”的决策循环，导致行为与既有架构目标不一致。我们需要把这一步固化为稳定的运行时协议，让后续主要通过 host 提示词调优策略，而不是频繁改流程代码。

## What Changes

- 将 host 从 `ensurePlan` 单步规划调整为“决策动作循环”：`retrieve_context`、`create_plan`、`final_answer`。
- 将 `retrieve_context`、`create_plan`、`final_answer` 实现为 host 控制类 tools，由 host 通过 tool call 声明下一步动作，运行时执行器负责动作分发与边界控制。
- `retrieve_context` 允许 host 在已注册 capability（如 `local_kb_retrieval`、`terminal_exec`、`docx`）中自主选择用于上下文补充的能力。
- 在 run context 中补充“本地指令包”输入（来源于 memory 与 workspace policy），供 host 决策使用。
- 移除 `tasks: []` 强制回退 heuristic 任务的行为，允许 host 在信息充分时直接答复。
- 增强事件流可观测性，明确区分“内部上下文补充动作”与“最终执行计划”。
- 将 host 逻辑从 `graph.ts` 抽离到 `src/main/services/ai/node/host/` 目录，保留 `graph.ts` 作为路由编排层。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `ai-runner`: host 必须通过动作循环自主决定是否先补充上下文，再决定直答或生成执行计划。
- `chat-history-memory-v1`: host 上下文构建必须提供可控、边界化的本地指令输入，而不只包含 summary/recent turns。
- `ai-run-event-stream`: 事件流必须表达 host 决策与上下文补充过程，且不污染对用户展示的最终执行计划语义。

## Impact

- 受影响代码：
  - `src/main/services/ai/graph.ts`
  - `src/main/services/ai/node/host/**`
  - `src/main/services/ai/runtime.ts`
  - `src/main/services/ai/types.ts`
  - `src/shared/types.ts`
  - `src/renderer/src/pages/ChatPage.tsx`（仅当事件显示语义需要更新）
- 受影响规格：
  - `openspec/specs/ai-runner/spec.md`
  - `openspec/specs/chat-history-memory-v1/spec.md`
  - `openspec/specs/ai-run-event-stream/spec.md`
- 对外 IPC 基础接口保持兼容；新增事件字段或事件类型需保持向后兼容（增量添加）。
