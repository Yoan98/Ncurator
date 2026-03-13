## 1. Deterministic Main-Context Harness

- [x] 1.1 为 `buildMainGraph` 增加测试可选的 `runHumanTask` 注入 seam，并保持生产默认路径不变
- [x] 1.2 新增 main-context deterministic harness，支持脚本化 `chatJson` 决策序列、脚本化 `runHumanTask` 输出和最终 `AiRunState` / event 回收

## 2. Runtime Report Contract Extension

- [x] 2.1 扩展 runtime case/report 类型，支持 `main-ai-runtime` context 用例写入受控的 context metrics/signals overrides
- [x] 2.2 扩展 `metrics.json` / `signals.json` / `summary.md`，落盘 `contextRoundCount`、`contextEvidenceCount`、`internalContextDeliveryCount`、`contextDecisionSequence`、`contextFinalRoute`、`fellBackByRoundCap` 等 context 专属字段

## 3. Deterministic Managed Cases

- [x] 3.1 新增 `context-roundtrip-resolves-reference` case，验证一次 context 往返后能从 `need_context` 收敛到非 context 路径
- [x] 3.2 新增 `context-max-rounds-falls-back-to-plan` case，验证 context 轮次上限命中后按契约降级到 `main_plan`

## 4. Live Runtime Samples

- [x] 4.1 新增 live main-runtime harness，直接通过 `AiRunService` 运行带 history / scope fixture 的 context 样本，并复用现有 `AI_LIVE_ENABLE` 约束
- [x] 4.2 新增 `context-anaphora-followup` 与 `context-local-evidence-insufficient` 两条 batch-only live runtime case

## 5. Verification And Governance

- [x] 5.1 运行定向 runtime 测试，验证 deterministic case 与报告字段落盘
- [x] 5.2 更新 test catalog / testing 文档，使新增 current case 与 context 阶段输入保持一致
