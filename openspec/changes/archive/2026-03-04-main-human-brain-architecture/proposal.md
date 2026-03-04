## Why

当前 AI 运行时仍以 host 为中心，系统编排与单任务执行耦合，导致能力扩展后决策复杂度快速上升，且难以稳定复用“上一步结果驱动下一步动作”的执行范式。需要尽快重构为 `main graph + human graph` 双层架构，以建立更清晰的职责边界和可扩展执行协议。

## What Changes

- **BREAKING**：将现有 host 主导的运行时模型重构为 `main graph`（系统编排）+ `human graph`（单任务执行）双层模型，不保留旧 host 决策循环兼容路径。
- **BREAKING**：将能力执行改为“brain 分步驱动 + capability 原子执行”，移除 capability 内部 AI 循环，循环控制权统一收敛到 brain。
- **BREAKING**：brain 成为唯一工具调用入口，统一使用 LangGraph 的 tool 机制（`bindTools` / `ToolNode`）执行；即使是动态工具筛选，也必须在每一步先生成 active tools，再由 brain 在该集合内发起工具调用。
- 明确 capability 语义仅用于代码分层与维护（注册、元数据、策略约束、执行器实现），不再作为独立 AI 调度单元承载内部决策循环。
- 引入 human 单任务执行协议：`invoke_capability / complete_task / block_task`，并以 `consume / produce / expect` 约束步骤间数据依赖与完成判定。
- 引入按步骤动态筛选的工具暴露机制（Tool Broker），每步仅向 brain 暴露有限候选工具集，避免全量工具平铺导致决策退化。
- 更新主流程语义：probe/context/plan/finalize 保留在 main graph，plan 产出的每个任务必须具备独立执行契约并交由 human 独立完成。

## Capabilities

### New Capabilities

- `ai-human-task-runner`: 定义 human graph 的单任务运行协议、brain 分步决策循环、步骤级完成与阻塞语义。
- `ai-brain-tool-broker`: 定义步骤级工具筛选与动态暴露机制，约束 brain 每步候选工具集规模与选择边界。
- `ai-task-slot-memory`: 定义任务级状态槽（slot）读写、引用传递与步骤提交规则，确保“上一步结果可被下一步稳定消费”。

### Modified Capabilities

- `ai-runner`: 从 host 决策循环重构为 main/human 双层运行时编排模型，明确系统编排与单任务执行边界。
- `ai-node-capability-registry`: 从“可执行器注册”扩展为“可执行器 + 元数据 + 筛选约束”注册模型，以支撑 Tool Broker 选择。
- `ai-run-event-stream`: 调整事件语义以表达 main/human 双层执行阶段与步骤级执行过程，移除旧 host 语义假设。

## Impact

- 受影响代码：
  - `src/main/services/ai/graph.ts`
  - `src/main/services/ai/node/host/**`（将被重构/替换为 human 相关节点）
  - `src/main/services/ai/node/capability/**`
  - `src/main/services/ai/runtime.ts`
  - `src/main/services/ai/types.ts`
  - `src/shared/types.ts`
  - `src/renderer/src/pages/ChatPage.tsx`（事件展示语义适配）
- 受影响规范：
  - 新增 `openspec/specs/ai-human-task-runner/spec.md`
  - 新增 `openspec/specs/ai-brain-tool-broker/spec.md`
  - 新增 `openspec/specs/ai-task-slot-memory/spec.md`
  - 修改 `openspec/specs/ai-runner/spec.md`
  - 修改 `openspec/specs/ai-node-capability-registry/spec.md`
  - 修改 `openspec/specs/ai-run-event-stream/spec.md`
- 对外影响：
  - AI 运行时内部行为与事件阶段语义发生变更，按重构策略不保证旧 host 路径兼容。
