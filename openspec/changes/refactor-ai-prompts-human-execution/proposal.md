## Why

当前 AI 运行时的核心 prompt 分散在多个节点与服务中，导致约束难以统一、优化难以复用、回归风险高。与此同时，human 子图在失败处理上过早阻塞，难以实现“任务分配后自主渐进探索”，需要尽快完成架构级收敛与升级。

## What Changes

- 新增统一的 AI prompt 管理能力，将 main/human/memory 等 prompt 从节点内联字符串提取到独立目录并集中维护。
- 统一 prompt 构建与渲染方式，约束输出契约与变量注入边界，降低提示词漂移与重复维护成本。
- 优化 human brain 的执行策略，使其围绕任务目标执行“观察-行动-验证”的渐进式工具循环，并明确完成与阻塞判定。
- **BREAKING**：移除 `HumanTaskInput.mode`（`context | dispatch`）字段，改为由任务目标与运行上下文驱动 human 执行，不再以任务模式作为输入契约的一部分。
- 同步更新 AI 架构参考文档，移除与 `mode` 绑定的过时表述，保持文档与运行时一致。

## Capabilities

### New Capabilities
- `ai-prompt-registry`: 定义 AI prompt 的统一目录、构建接口与治理规则，覆盖 main/human/memory 三类运行时 prompt 的集中管理与复用。

### Modified Capabilities
- `ai-human-task-runner`: 调整 human 任务输入契约并强化渐进式探索策略，明确失败分类后的继续探索与终止条件。
- `ai-runner`: 更新 main->human 调度契约，移除 `mode` 依赖并对齐新的 prompt 管理与执行边界。

## Impact

- 受影响代码：
  - `src/main/services/ai/node/main/*`
  - `src/main/services/ai/node/human/*`
  - `src/main/services/ai/graph/*`
  - `src/main/services/ai/state/stateSchemas.ts`
  - `src/main/services/ai/memory.ts`
  - `src/shared/types.ts`
  - `doc/ai-architecture.md`
- 受影响系统：
  - AI 运行时（Main Graph / Human Subgraph）
  - 跨进程 AI 输入输出契约（HumanTaskInput）
  - AI 提示词治理与维护流程
- API/契约影响：
  - `HumanTaskInput` 字段变更为破坏性调整，需要主流程与子图调用点同步迁移。
- 依赖影响：
  - 不新增外部依赖，主要为现有 AI 运行时内部重构与行为优化。
