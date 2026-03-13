## Context

当前 `main-ai-runtime` 套件已经覆盖 scope、prompt、fail-fast、resultData 保真与 docx draft review 等契约，但缺少直接保护 `need_context -> contextEvidence -> 再决策` 主链路的测试样本。代码上，`main_intent` 会根据 history、selected scope、`contextEvidence` 和 `contextRounds` 做三路分流；`main_context_human` 再把 internal human 的 `summary + deliveryMarkdown` 追加回 `contextEvidence`。现有 runtime harness 以 capability-style case 为主，适合测纯函数与局部契约，不足以稳定复现多轮 context 收敛。

这次变更同时跨越：

- `src/main/services/ai/graph/*` 的可测试性 seam
- `tests/harness/main/**` 的 runtime harness 与报告契约
- `tests/main/ai/runtime/**` 的 deterministic/live case 组织
- `tests/report/main-ai-runtime/**` 与后续分析输入

因此需要先用 design 固定实现边界，避免在写 case 时把生产运行逻辑、测试 seam 和报告模型混在一起。

## Goals / Non-Goals

**Goals:**
- 为 `main context` 阶段建立可重复的 deterministic graph-level 测试入口，能稳定复现多轮 `need_context` 路径。
- 让 runtime 报告能够承载 context 专属信号，用于区分“状态机问题”“prompt/objective 问题”和“边界回归”。
- 补齐第一批 deterministic case，至少覆盖“context 解开歧义”和“context 轮次上限降级”。
- 如现有 harness 成本可控，补充首批 batch-only live runtime case，为后续 compare 提供样本。

**Non-Goals:**
- 本次不调整 `main_intent`、`context human`、`human_response` 的生产 prompt 策略。
- 本次不引入新的生产事件类型或改变 shared event contract。
- 本次不把 `main context` 做成独立 analyzer/compare 体系；首版只补足报告输入和受治理样本。
- 本次不覆盖 `plan 质量` 或完整端到端架构验收场景。

## Decisions

### 1. Deterministic main-context 测试通过“可注入 runHumanTask 的 main graph seam”实现

**Decision**

为 `buildMainGraph` 增加测试可选 seam：允许在不改变生产默认路径的前提下，注入自定义 `runHumanTask`。deterministic context case 通过 scripted `chatJson` 决策序列和 scripted `runHumanTask` 输出，驱动完整 main graph，而不是只分别单测 `intentNode` / `contextEnrichNode`。

**Why**

只测 node 级纯函数，无法证明 `contextEvidence` 回写后真的会影响下一轮 route；而直接驱动现有 human graph 又会把 deterministic 验证和真实模型行为耦合。保留生产默认 `createHumanGraphRunner`，同时为测试提供注入 seam，是最小且可维护的方案。

**Alternatives considered**

- 只分别测试 `intentNode` 和 `contextEnrichNode`
  - 优点：实现最轻
  - 缺点：不能覆盖完整 roundtrip
- 在测试里强行跑真实 human graph
  - 优点：更接近真实运行
  - 缺点：不可重复，难以定位到底是 routing 还是模型输出问题

### 2. Context 专属报告字段通过测试 harness 覆盖层注入，而不是新增生产事件

**Decision**

扩展 `runRuntimeCase` / reporter 的报告覆盖能力，允许 runtime case 以结构化方式写入 context 专属 metric/signal，例如：

- `contextRoundCount`
- `contextEvidenceCount`
- `fellBackByRoundCap`
- `contextDecisionSequence`
- `contextFinalRoute`
- `internalContextTaskIds`

这些字段落入 `metrics.json` / `signals.json`，但不修改生产 `AiRunEvent` 契约。

**Why**

当前缺的不是新的 UI 事件，而是测试结果能否稳定表达 context 行为。如果为了测试报告去改 shared event，会扩大生产面和回放契约影响范围。把 context 字段作为测试报告扩展，更符合本次需求，也更容易在 deterministic 和 live case 之间复用。

**Alternatives considered**

- 新增 `main_decision` 等生产事件
  - 优点：运行回放更完整
  - 缺点：生产契约面扩大，超出本次测试变更范围
- 只在断言里校验，不落盘 context 指标
  - 优点：实现简单
  - 缺点：后续无法用报告结果判断是否需要调整

### 3. Live runtime case 复用 `AiRunService`，但保持 batch-only / env-gated

**Decision**

新增轻量 `main runtime live` harness，直接调用 `AiRunService`，通过 stub `llmStore/chatStore/documentsStore/draftReviewService` 与真实 LLM 配置复用现有运行路径。首批 live context case 默认 `test.skipIf(!isLiveSuiteEnabled())`，metadata 标为 `live-eval + batch_only`，不进入 gating。

**Why**

`main context` 的质量问题最终仍要回到真实模型上判断。直接复用 `AiRunService` 能最大程度贴近生产，同时用 env gate 把 flakiness 和成本隔离在 batch-only 层。

**Alternatives considered**

- 不做 live runtime case，只做 deterministic
  - 优点：稳定
  - 缺点：无法回答 context prompt 是否真的有价值
- 让 live case 直接进入 gating
  - 优点：覆盖更强
  - 缺点：成本和波动不适合作为主回归

### 4. 第一批样本固定为“两条 deterministic + 两条 live”

**Decision**

首批样本固定为：

- deterministic
  - `context-roundtrip-resolves-reference`
  - `context-max-rounds-falls-back-to-plan`
- live
  - `context-anaphora-followup`
  - `context-local-evidence-insufficient`

其中 deterministic 进入 `main-ai-runtime` 受治理 current cases；live 样本先按 `batch_only` 进入 catalog，作为后续 compare 的起点。

**Why**

这一组样本同时覆盖了“mechanism works”和“real model value”两条主线，又不会把首轮 scope 扩得过大。

**Alternatives considered**

- 先补更多 deterministic 再说
  - 优点：更稳
  - 缺点：无法尽快形成调优依据
- 直接从 live compare 开始
  - 优点：更贴近最终目标
  - 缺点：问题归因困难

## Risks / Trade-offs

- [Risk] 将 `buildMainGraph` 暴露出测试 seam 后，被生产调用误用
  → Mitigation：保持参数可选，默认路径仍在生产内部创建 `createHumanGraphRunner`，测试 seam 仅在 tests 中使用。

- [Risk] report 覆盖层让 runtime case 可以写入自定义字段，降低报告一致性
  → Mitigation：新增字段只允许走显式类型定义，不接受任意键值；context 字段统一命名并写入 spec。

- [Risk] live runtime case 受模型波动影响，短期内不稳定
  → Mitigation：只标记为 `batch_only`，并用 `AI_LIVE_ENABLE` gating；首轮不把它们纳入 `gating`。

- [Risk] 第一批样本只覆盖了 context 主链路，仍不能替代后续 `plan 质量`
  → Mitigation：在 design 和文档中明确其目标边界是 `main context`，不外推到 `plan 质量`。

## Migration Plan

1. 扩展 OpenSpec specs/design/tasks，固定 context 测试 seam、报告字段和第一批样本。
2. 修改 runtime graph 与测试 harness，支持 scripted `runHumanTask` 和 context 专属 report override。
3. 新增两条 deterministic runtime case，并确保纳入 `main-ai-runtime` catalog。
4. 实现 live runtime harness 与两条 batch-only 样本；若环境未启用 live，仅验证其 fail-fast/skip 行为与 metadata。
5. 运行定向 runtime suite，更新 catalog 与相关 testing 文档。

## Open Questions

- 首版是否需要单独的 `main-ai-runtime` analyzer，还是先依赖每个 case 的结构化报告与 journal 汇总即可？
- context 专属 signals 是否只覆盖 current cases，还是后续也要给 capability / e2e 套件开放同类机制？
