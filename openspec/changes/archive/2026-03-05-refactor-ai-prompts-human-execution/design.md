## Context

当前 AI 运行时存在三类设计痛点：
- prompt 分散在 `main node / human node / memory` 多个文件，以内联字符串为主，复用和审计成本高，优化时容易出现行为漂移。
- human 子图虽然具备 step 循环，但普通工具调用失败时会快速进入阻塞终态，难以支持“任务分配后的自主渐进探索”。
- `HumanTaskInput.mode` 承担了历史语义标签作用，但对运行时核心行为约束有限，反而增加了跨模块契约负担与演进阻力。

本变更是跨模块架构调整，涉及 `src/main/services/ai` 的 graph/node/state/memory 与 `src/shared/types.ts` 契约，同时影响 `doc/ai-architecture.md` 的基线描述，需要先落设计文档再实施。

## Goals / Non-Goals

**Goals:**
- 建立统一的 prompt 管理目录与构建接口，使 main/human/memory prompt 可集中维护、复用与审计。
- 强化 human 子图为“观察-行动-验证”渐进式执行模型，在可恢复失败场景下允许继续探索。
- 移除 `HumanTaskInput.mode`，以 `taskId + objective` 作为最小输入契约，降低耦合。
- 保持 Main/Human 分层边界不变，兼容现有事件流主形态与 UI 消费方式。

**Non-Goals:**
- 不新增 capability 类型，不调整 capability registry 的能力集合。
- 不重构 renderer 侧 AI 事件消费逻辑（除非后续规格明确要求新增字段）。
- 不引入新的外部依赖或新的模型供应商集成。
- 不在本变更中重写业务工具实现（terminal/docx/retrieval 的具体工具逻辑保持不变）。

## Decisions

### 决策 1：引入统一 prompt registry 目录，替换节点内联 prompt
- 决策：
  - 在 `src/main/services/ai/prompts/` 下按域分层维护 prompt：
    - `main/intent.ts`, `main/plan.ts`, `main/finalize.ts`
    - `human/brain.ts`
    - `memory/sessionMemory.ts`
    - `shared/contracts.ts`, `shared/render.ts`, `index.ts`
  - 各 node 仅调用 prompt builder 获取 `system/user`（或 message 片段），不再直接拼接硬编码字符串。
- 选择原因：
  - 与现有 `src/main/services/ai/*` 域边界一致，避免跨层散落。
  - 能统一输出契约文本（JSON-only 等）并减少重复。
- 备选方案：
  - 方案 A：继续内联，仅抽工具函数拼接字符串。
  - 不采用原因：仍然分散，难以建立统一治理和版本化优化。

### 决策 2：human 执行采用“失败分级 + 渐进探索”而非“一次失败即阻塞”
- 决策：
  - 对普通工具调用结果按 `resultCode` 分级：
    - 不可恢复：`workspace_required`、`approval_denied`，直接收敛到 `block_task`。
    - 可恢复：`failed`、`invalid_input`，允许回到 brain 继续下一步探索，直到满足终止条件。
  - 终止条件保持显式：只能通过 `complete_task` 或 `block_task` 结束任务；步数预算超限仍触发终止保护。
- 选择原因：
  - 满足“human 自主渐进探索”目标，避免一次参数错误导致过早失败。
  - 与现有 step-bounded 机制兼容，增量改动可控。
- 备选方案：
  - 方案 A：仅优化 prompt，不改失败控制流。
  - 不采用原因：控制流仍会在普通失败时立即阻塞，无法兑现探索能力目标。

### 决策 3：移除 `HumanTaskInput.mode`，收敛为最小任务输入契约
- 决策：
  - `HumanTaskInput` 从 `{ taskId, mode, objective }` 调整为 `{ taskId, objective }`。
  - `context_enrich` 与 `plan_exec` 均通过任务目标与上下文证据驱动，不再传入模式标签。
  - human 首轮提示去除“任务模式”文案，改为“任务目标 + 约束 + 当前已知证据”。
- 选择原因：
  - `mode` 主要是提示词语义标签，对运行时边界价值有限。
  - 减少 shared 类型和 node 调用点的契约复杂度，便于后续扩展。
- 备选方案：
  - 方案 A：保留 `mode`，新增更多模式以表达策略。
  - 不采用原因：会继续扩大输入契约耦合，且无法本质提升执行质量。

### 决策 4：保持事件主协议稳定，优先复用现有可观测性
- 决策：
  - 保持现有 `human_step / task_result / tool_call_*` 事件语义不破坏。
  - 通过更高质量 `summary` 与 `resultData` 承载“渐进探索”可观测信息，避免前端联动改造。
- 选择原因：
  - 降低迁移风险，减少 UI 回归范围。
- 备选方案：
  - 方案 A：新增多种探索阶段事件类型。
  - 不采用原因：会扩大协议变更面，增加 renderer 适配成本。

## Risks / Trade-offs

- [可恢复失败下的循环风险] → 通过 `maxSteps`、重复调用抑制规则、明确 block 条件限制无效循环。
- [prompt 抽离后语义回归风险] → 先做“等价迁移”再做“行为优化”，每一步做事件回放对比。
- [移除 mode 的兼容风险] → 在同一变更内同步更新 shared type、state schema、main 调用点和文档，避免中间态。
- [文档与实现漂移风险] → 同步更新 `doc/ai-architecture.md` 与对应 specs，作为发布前检查项。

## Migration Plan

1. 建立 `prompts/` 目录与最小 builder 接口，完成现有 prompt 文本等价迁移（不改行为）。
2. 切换 main/human/memory 调用到 prompt registry，移除节点内联 prompt 字符串。
3. 调整 human tool 失败分级策略，实现可恢复失败回到 brain 的渐进探索循环。
4. 移除 `HumanTaskInput.mode`，联动修改 shared 类型、state schema、main 派发调用与 human 输入文本。
5. 更新 `doc/ai-architecture.md` 与变更 specs，确保架构文档、契约与运行时一致。
6. 验证：
   - 类型检查通过；
   - 关键事件流（plan/task/human/tool/finalize）可回放；
   - workspace/approval 边界行为不回退。

回滚策略：
- 若 human 渐进探索行为产生不可接受回归，优先回滚“失败分级策略”改动，保留 prompt registry 与 mode 移除成果；
- 若契约迁移引发兼容问题，回滚 shared 类型变更并恢复兼容层后再分步推进。

## Open Questions

- 是否需要在后续迭代引入 `allowedCapabilities`（按任务约束可用能力）以替代历史 `mode` 的弱约束语义？
- human 在“可恢复失败”场景下是否需要额外的失败计数键（例如按工具名计数）来更早触发阻塞，避免无效探索？
- prompt 优化后是否要建立固定评估基线（示例任务集 + 事件指标）作为后续迭代验收标准？
