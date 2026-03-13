## Context

当前 AI 测试已经覆盖 capability、human、main context、renderer contract 与 deterministic e2e，但 `plan 质量` 仍缺少一组可以稳定治理、可进入 catalog、可落测试报告并能支持阶段推进决策的专门用例。现有 `tests/unit/main/ai/runtime/**` 主要验证运行时编排正确性，`tests/e2e/**` 主要验证计划在 UI 中的呈现，二者都不能直接回答 planner 输出是否稳定合理。

本次 change 的约束有三点：
- 必须沿用现有测试分层、catalog 与报告契约，不能再造一套平行评估体系。
- 必须区分 planner contract 问题、plan runtime/handoff 问题与 live 模型波动，避免调错层。
- 首轮需要尽快形成可执行 baseline，因此优先覆盖最小但高信号的 case 集。

## Goals / Non-Goals

**Goals:**
- 在 `main-ai-runtime` 下建立可受治理的 `plan 质量` 测试集合。
- 以最小集合覆盖 planner contract、长 handoff 链、阻塞后 synthesis 与 mixed-scope preserve。
- 让测试结果可以复用现有 `catalog -> report -> phased-plan -> upgrade-journal` 链路做阶段判断。
- 为后续 prompt/runtime 调整提供可归因的失败模式，而不是只得到笼统的 pass/fail。

**Non-Goals:**
- 不在本次 change 中引入新的独立测试 suite 或新的报告目录体系。
- 不把 planner 质量评估扩展成完整 DAG / dependsOn 模型验证。
- 不在首轮引入复杂的自动化语义评分器或新增大规模分析脚本。
- 不修改 AI runtime 的核心业务架构，除非为测试可观测性补齐最小缺口。

## Decisions

### 1. 复用 `main-ai-runtime`，不新建独立 suite

`plan 质量` 在阶段计划中被定义为基于 `tests/main/ai/runtime/**` 加定向补充用例推进，因此首轮继续落在 `main-ai-runtime` 下，保证 case catalog、报告目录和阶段记录都不分叉。

备选方案：
- 新建 `main-ai-plan-quality` suite。
- 否决原因：会引入新的 catalog/report 分组和分析入口，当前收益低于维护成本。

### 2. 先拆成 deterministic contract/runtime 与 live quality 两层

首轮测试分为两类：
- deterministic managed case：验证 planner contract 与 runtime handoff/synthesis 约束，可进入 gating。
- live plan quality case：验证真实模型下的计划粒度、scope fidelity 与收敛稳定性，初期先保留为非主门禁。

这样可以先冻结结构性边界，再逐步观察真实质量波动，避免把 live 波动直接污染主回归。

备选方案：
- 所有 plan 测试都直接走 live。
- 否决原因：无法快速区分是 prompt/runtime 缺陷还是模型随机性，阶段推进判断会失真。

### 3. 首轮复用现有 report 信号，缺口再增补

优先复用现有 `taskDeliveryCount`、`deliveryTaskIds`、`synthesisTriggered`、`finalDeliverySource`、`toolCounts`、`stepActionSequence` 等信号支撑 plan 质量判断。若首轮实现后仍无法稳定区分关键失败模式，再有选择地扩展 report contract。

备选方案：
- 先设计一套专门的 planner quality metrics/analyzer。
- 否决原因：当前主要目标是建立 baseline，不是先做指标平台。

### 4. 首批 case 只覆盖高信号最小集合

首轮实现聚焦以下场景：
- `plan-no-summary-task`
- `plan-objective-has-action-object-done`
- `plan-handoff-chain-3-step`
- `plan-blocked-midway-still-synthesizes`
- `plan-mixed-scope-objective-preserve`

这些 case 足以回答失败更偏向 planner、handoff 编译还是 synthesis/runtime 收口。

## Risks / Trade-offs

- [Risk] live case 波动较大，短期内难以直接设为 gating
  → Mitigation：首轮 live case 先标记为非主门禁或独立 profile，先看 3-5 轮采样模式。

- [Risk] 现有 report 信号不足以表达“过度拆分/欠拆分”等语义质量问题
  → Mitigation：首轮先通过结构化断言和 case 设计约束高信号失败模式；仅在证据不足时扩展报告字段。

- [Risk] 新增 plan case 后，容易与已有 runtime correctness 用例边界重叠
  → Mitigation：命名和断言口径上明确区分“contract correctness”与“plan quality”。

- [Risk] mixed-scope 质量问题可能同时暴露在 planner prompt 与 runtime objective 编译两层
  → Mitigation：分别保留 planner-only 与 runtime execution 两类 case，避免归因混淆。
