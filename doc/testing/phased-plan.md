# AI 阶段化测试计划

本文件只定义 AI 测试推进顺序、门禁条件和阶段产物，不承载测试架构细节。  
阶段结果与能力边界统一沉淀到 `doc/testing/upgrade-journal.md`。

关联文档：
- 测试架构规则见 [architecture.md](/Users/test/work-space/NCurator-Desktop/doc/testing/architecture.md)
- 用例治理规则见 [case-governance.md](/Users/test/work-space/NCurator-Desktop/doc/testing/case-governance.md)
- 当前 active case 清单见 [current-cases.md](/Users/test/work-space/NCurator-Desktop/tests/catalog/current-cases.md)
- 阶段执行结果与专题结论见 [upgrade-journal.md](/Users/test/work-space/NCurator-Desktop/doc/testing/upgrade-journal.md)

## 1. 阶段顺序（能力先行）

1. `tool capability`
2. `human`
3. `main intent`
4. `main context`
5. `plan 质量`
6. `ai 架构验收`

推进原则：
- 必须先在当前阶段收敛主要不稳定项，再进入下一阶段。
- `explicit_gap` 属于能力边界标注，不等同于 harness 故障。

## 2. 阶段门禁与产物

### 2.1 `tool capability`

- 目标：
  - 工具正确性、边界、安全、显式缺口可观测。
- 主要用例目录：
  - `tests/main/ai/capability/**`
- 主要命令：
  - `pnpm test:main:ai:capability`
  - `pnpm test:main:ai:capability:analyze`
- 阶段产物：
  - `tests/report/main-ai-capability/**`
  - `doc/testing/upgrade-journal.md`（追加 `tool capability` 阶段记录与专题结论）

### 2.2 `human`

- 目标：
  - human 子图在真实模型下完成单任务并正确收敛阻塞。
  - 产出可比较的质量分级、稳定性与效率数据，为 prompt/skill/tool/model 优化提供输入。
- 主要用例目录：
  - `tests/main/ai/human/**`
- 主要命令：
  - `pnpm test:human`
  - `pnpm test:human:analyze`
  - `pnpm test:human:batch -- --runs 5`
  - `pnpm test:human:compare -- --before <batchId> --after <batchId>`
- 阶段产物：
  - `tests/report/main-ai-human/**`
  - `tests/report/main-ai-human/human-assessment.md`
  - `tests/report/main-ai-human/batches/<batchId>/batch-summary.md`
  - `tests/report/main-ai-human/compare/<before>-vs-<after>.md`
  - `doc/testing/upgrade-journal.md` 追加记录

运行分层：
- 单次回归：成功路径、阻塞路径与 fail-fast 门禁。
- 覆盖扩展：补齐 local-kb、多 skill、workspace 缺失与恢复能力。
- 稳定性批次：关键 case 执行 `5-10` 轮，检查通过率、软成功比例、工具错误恢复与重复调用。
- 升级对比：固定用例集后，对 prompt/skill/tool/model 改动做前后对比。

建议口径：
- `human-default` 默认固定 case 集：`human-docx-edit`、`human-local-kb-answer`、`human-multi-skill-kb-then-shell`、`human-tool-error-recovery`。
- 升级对比以两个独立 batch 为输入，不直接拿全量历史 `human-assessment.md` 做前后对比，避免旧轮次污染成功率。

推进门槛：
- 成功路径通过率至少 `80%`。
- 阻塞路径语义正确率至少 `95%`。
- `unexpected_block` 不应多于 `soft_pass`。
- assessment 中不得存在未隔离的 `harness_fail` 结论污染。

### 2.3 `main intent`

- 目标：
  - `main_intent` 的三路分流（`need_context | direct_human | to_plan`）稳定。
  - context round-trip、`contextRounds` 上限降级与 local-first intent 契约可验证。
- 主要输入：
  - `tests/unit/main/ai/runtime/human-led-orchestration.test.ts`
  - `tests/main/ai/runtime/prompt.local-first-contract.test.ts`
- 主要命令：
  - `pnpm exec vitest --config vitest.ai.config.mts run tests/unit/main/ai/runtime/human-led-orchestration.test.ts`
  - `pnpm exec vitest --config vitest.ai.config.mts run tests/main/ai/runtime/prompt.local-first-contract.test.ts`
- 阶段产物：
  - `tests/report/main-ai-runtime/prompt-local-first-contract/**`
  - `Vitest` 单测结果（`tests/unit/main/ai/runtime/human-led-orchestration.test.ts`）
  - `doc/testing/upgrade-journal.md` 追加记录（包含 `main_intent` 分流、fallback 与证据写回结论）

### 2.4 `main context`

- 目标：
  - main graph 上下文收集、scope 语义、阻塞契约稳定。
- 主要用例目录：
  - `tests/main/ai/runtime/**`
- 主要命令：
  - `pnpm test:main:ai:runtime`
- 阶段产物：
  - `tests/report/main-ai-runtime/**`
  - `doc/testing/upgrade-journal.md` 追加记录

### 2.5 `plan 质量`

- 目标：
  - 计划拆解合理、任务粒度稳定、收敛路径可解释。
- 主要输入：
  - `tests/main/ai/runtime/**` + 定向补充计划质量用例
  - planner contract：`plan-contract-validation`、`plan-prompt-scope-preserve`
  - runtime quality：`plan-handoff-chain-3-step`、`plan-blocked-midway-still-synthesizes`、`plan-mixed-scope-objective-preserve`
  - live sampling：`plan-live-long-handoff-quality`
  - 必要时用 `tests/e2e/**` 验证计划对 UI 链路的影响
- 主要命令：
  - `pnpm test:runtime`
  - `pnpm exec vitest --config vitest.ai.config.mts run tests/main/ai/runtime/plan.contract.test.ts tests/main/ai/runtime/plan.runtime-quality.test.ts`
  - `pnpm exec vitest --config vitest.ai.config.mts run tests/main/ai/runtime/plan.live-quality.test.ts`
- 阶段产物：
  - 对应 suite 报告目录
  - `doc/testing/upgrade-journal.md` 追加记录

运行分层：
- deterministic gating：先锁定 planner contract、长 handoff 链、阻塞后 synthesis 与 mixed-scope objective preserve。
- live sampling：首轮只补 planner 生成质量样本，默认保持 `live-eval + batch_only`，避免直接污染主门禁。
- 链路补充：仅当 deterministic / live 结果提示 UI 投影有风险时，再补 e2e plan 链路验证。

### 2.6 `ai 架构验收`

- 目标：
  - 给定真实用户需求，验证当前 AI 架构端到端效果是否达标。
- 主要输入：
  - `tests/main/**` 主干能力
  - `tests/e2e/**` 关键链路
- 阶段产物：
  - 对应 suite 报告目录
  - `doc/testing/upgrade-journal.md` 追加记录

## 3. 当前阶段判定来源

- 当前阶段、推进决策、下一阶段目标，以 [upgrade-journal.md](/Users/test/work-space/NCurator-Desktop/doc/testing/upgrade-journal.md) 最新记录为准。
- 当前 active case inventory 以 [current-cases.json](/Users/test/work-space/NCurator-Desktop/tests/catalog/current-cases.json) 为准，不从 `tests/report/**` 目录反推。
- 本文件不维护按日期的阶段快照，避免与持续汇总文档发生漂移。

## 4. 每轮测试结束后的固定动作

1. 先运行 `pnpm test:catalog:generate`，确认当前 case catalog、latest report 与 archived 过滤结果有效。
2. 产出并检查 `tests/report/**` 结构化报告。
3. 追加更新 [upgrade-journal.md](/Users/test/work-space/NCurator-Desktop/doc/testing/upgrade-journal.md)：
   - 写明阶段、结果、风险、是否推进、下一轮优先级。
   - 在需要时补充该阶段专题结论（能力边界、显式缺口、门槛判定）。
4. 仅当“允许推进”明确成立时，开始下一阶段测试。
5. 仅当阶段顺序或门禁发生变化时，更新本文件。
