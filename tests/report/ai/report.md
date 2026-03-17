# AI Domain Report

该文档基于当前仓库内 `tests/logs/ai/**` 的现有 raw logs 更新。

## Domain Overview

- analysisWindow: `2026-03-17` 阶段 1 `backend/tools` 最新通过批次 + 阶段 2 `backend/human` mock 全量通过批次 `20260317-123446-*` + `human-single-step-kb-answer` 的 `gpt-5` live 探针 `20260317-140339-612` + `gpt-5.2` live 探针 `20260317-140645-949` + 既有 `workbench` smoke
- analyzedScopes: `ai/backend/tools/docx`、`ai/backend/tools/terminal`、`ai/backend/tools/kb`、`ai/backend/human`、`ai/e2e/workbench`
- backendPassRate: 当前 mock 基线 `18/18 = 100.0%`；最新 `human-single-step-kb-answer` pair 探针 `2/2 = 100.0%`
- backendMockPassRate: 18/18 = 100.0%
- e2ePassRate: 2/2 = 100.0%
- overallAssessment: 阶段 2 `human` 的 mock backend 基线已经完整跑通，backend live raw log 也已经能记录真实 `modelName`。`/v1` 兼容性问题已在代码中修复，默认 pair baseline 已切到 `gpt-5 / gpt-5.2`，且 `human-single-step-kb-answer` 的首个 live pair 探针已经通过。当前阶段 2 不再受 `gpt-5-mini` channel 这类外部阻塞影响，但剩余关键 `human` case 的 pair 复跑尚未完成，因此还不能进入 `todo-stage-3.md`。

## Model Baseline

- primaryModel: `gpt-5`
- strongModel: `gpt-5.2`
- pairBaselineStatus: partial
- primaryProbeEvidence:
  - `tests/logs/ai/backend/human/human-single-step-kb-answer/20260317-140339-612/meta.json`
  - `tests/logs/ai/backend/human/human-single-step-kb-answer/20260317-140339-612/timeline.jsonl`
- strongProbeEvidence:
  - `tests/logs/ai/backend/human/human-single-step-kb-answer/20260317-125203-953/meta.json`
  - `tests/logs/ai/backend/human/human-single-step-kb-answer/20260317-125203-953/timeline.jsonl`
  - `tests/logs/ai/backend/human/human-single-step-kb-answer/20260317-140645-949/meta.json`
  - `tests/logs/ai/backend/human/human-single-step-kb-answer/20260317-140645-949/timeline.jsonl`
- modelSwitchKnobs:
  - `AI_LIVE_PRIMARY_MODEL_NAME`
  - `AI_LIVE_STRONG_MODEL_NAME`
- runtimeSelection:
  - 测试侧运行时显式选择 `primary` 或 `strong`
  - 不再通过额外环境变量覆盖本轮实际调用模型
- liveActivation:
  - 只要 live 配置可用，测试就默认直连模型
- runMode:
  - 阶段 1 `tool` 层 backend 维持 `single`
  - 阶段 2 起，`human` 关键样例、失败样例与 `golden cases` 进入 `pair`
- report-only fields:
  - `primaryModel`
  - `strongModel`
  - `runMode`
  - `primaryScore`
  - `strongScore`
- raw log constraint: 单次 run 仍然只通过 `meta.runtime.modelName` 记录真实执行模型，不修改 `meta.json / timeline.jsonl / artifacts.json` 固定契约
- harnessUpdate:
  - backend live case 已支持把 `runtime.modelName` 落进 raw log
  - 当 `AI_LIVE_BASE_URL` 为空且模型是 OpenAI 系列时，测试 harness 会默认使用官方兼容端点
  - 对 bare-origin 的 OpenAI 兼容网关地址，现在会自动规范为 `.../v1`
  - `human-single-step-kb-answer` 现已补齐 `listDocuments / hybrid / vector / fts` 的 stub，并在 live 模式下取消固定 delivery override，避免假阳性

## backend

### tools

#### docx

##### Evidence

- `docx-open-outline-search` | passed | `tests/logs/ai/backend/tools/docx/docx-open-outline-search/20260317-114448-597/meta.json` | `tests/logs/ai/backend/tools/docx/docx-open-outline-search/20260317-114448-597/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/docx-open-outline-search/20260317-114448-597/artifacts.json`
- `docx-mixed-edit-save-preview-validate` | passed | `tests/logs/ai/backend/tools/docx/docx-mixed-edit-save-preview-validate/20260317-114448-597/meta.json` | `tests/logs/ai/backend/tools/docx/docx-mixed-edit-save-preview-validate/20260317-114448-597/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/docx-mixed-edit-save-preview-validate/20260317-114448-597/artifacts.json`
- `docx-history-rollback-errors` | passed | `tests/logs/ai/backend/tools/docx/docx-history-rollback-errors/20260317-114448-599/meta.json` | `tests/logs/ai/backend/tools/docx/docx-history-rollback-errors/20260317-114448-599/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/docx-history-rollback-errors/20260317-114448-599/artifacts.json`
- `docx-save-overwrite-preview-boundaries` | passed | `tests/logs/ai/backend/tools/docx/docx-save-overwrite-preview-boundaries/20260317-114448-597/meta.json` | `tests/logs/ai/backend/tools/docx/docx-save-overwrite-preview-boundaries/20260317-114448-597/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/docx-save-overwrite-preview-boundaries/20260317-114448-597/artifacts.json`

##### Pass Rate

- totalRuns: 4
- passedRuns: 4
- failedRuns: 0
- successRate: 100.0%

##### Current Assessment

- 已覆盖结构读取、文本搜索、混合编辑、保存、预览、校验、历史链、回滚、overwrite 边界。
- `docx` 当前已经不再只停留在单点 API happy path，而是具备阶段 1 所需的闭环能力基线。

#### terminal

##### Evidence

- `terminal-basic-command` | passed | `tests/logs/ai/backend/tools/terminal/terminal-basic-command/20260317-114448-441/meta.json` | `tests/logs/ai/backend/tools/terminal/terminal-basic-command/20260317-114448-441/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/terminal-basic-command/20260317-114448-441/artifacts.json`
- `terminal-artifact-approval` | passed | `tests/logs/ai/backend/tools/terminal/terminal-artifact-approval/20260317-114448-597/meta.json` | `tests/logs/ai/backend/tools/terminal/terminal-artifact-approval/20260317-114448-597/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/terminal-artifact-approval/20260317-114448-597/artifacts.json`
- `terminal-guardrails-and-failure` | passed | `tests/logs/ai/backend/tools/terminal/terminal-guardrails-and-failure/20260317-114448-597/meta.json` | `tests/logs/ai/backend/tools/terminal/terminal-guardrails-and-failure/20260317-114448-597/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/terminal-guardrails-and-failure/20260317-114448-597/artifacts.json`
- `terminal-read-and-cancel` | passed | `tests/logs/ai/backend/tools/terminal/terminal-read-and-cancel/20260317-114448-596/meta.json` | `tests/logs/ai/backend/tools/terminal/terminal-read-and-cancel/20260317-114448-596/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/terminal-read-and-cancel/20260317-114448-596/artifacts.json`
- `terminal-timeout-and-truncation` | passed | `tests/logs/ai/backend/tools/terminal/terminal-timeout-and-truncation/20260317-114448-597/meta.json` | `tests/logs/ai/backend/tools/terminal/terminal-timeout-and-truncation/20260317-114448-597/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/terminal-timeout-and-truncation/20260317-114448-597/artifacts.json`

##### Pass Rate

- totalRuns: 5
- passedRuns: 5
- failedRuns: 0
- successRate: 100.0%

##### Current Assessment

- 已覆盖读取工作区材料、多段命令、产物识别、边界拦截、审批通过、审批拒绝、失败、timeout、输出截断与取消分支。
- `terminal` 已经具备阶段 1 需要的事实事件链，后续重点会从 tool 本身转向 `human` 如何使用这些能力。

#### kb

##### Evidence

- `kb-search-modes-and-scope` | passed | `tests/logs/ai/backend/tools/kb/kb-search-modes-and-scope/20260317-114448-845/meta.json` | `tests/logs/ai/backend/tools/kb/kb-search-modes-and-scope/20260317-114448-845/timeline.jsonl` | `tests/logs/ai/backend/tools/kb/kb-search-modes-and-scope/20260317-114448-845/artifacts.json`
- `kb-list-documents` | passed | `tests/logs/ai/backend/tools/kb/kb-list-documents/20260317-114448-936/meta.json` | `tests/logs/ai/backend/tools/kb/kb-list-documents/20260317-114448-936/timeline.jsonl` | `tests/logs/ai/backend/tools/kb/kb-list-documents/20260317-114448-936/artifacts.json`
- `kb-fts-and-no-result` | passed | `tests/logs/ai/backend/tools/kb/kb-fts-and-no-result/20260317-114448-936/meta.json` | `tests/logs/ai/backend/tools/kb/kb-fts-and-no-result/20260317-114448-936/timeline.jsonl` | `tests/logs/ai/backend/tools/kb/kb-fts-and-no-result/20260317-114448-936/artifacts.json`

##### Pass Rate

- totalRuns: 3
- passedRuns: 3
- failedRuns: 0
- successRate: 100.0%

##### Current Assessment

- 已覆盖 `hybrid / vector / fts`、source scope 过滤、`list documents` 与无结果返回。
- `kb` 阶段 1 的重点已经从“能不能查”推进到“范围约束是否正确”，为下一阶段 `human` 引证和多工具串联打好了底。

### human

##### Evidence

- `human-single-step-kb-answer` | passed | `tests/logs/ai/backend/human/human-single-step-kb-answer/20260317-123446-336/meta.json` | `tests/logs/ai/backend/human/human-single-step-kb-answer/20260317-123446-336/timeline.jsonl` | `tests/logs/ai/backend/human/human-single-step-kb-answer/20260317-123446-336/artifacts.json`
- `human-blocked-on-workspace` | passed | `tests/logs/ai/backend/human/human-blocked-on-workspace/20260317-123446-337/meta.json` | `tests/logs/ai/backend/human/human-blocked-on-workspace/20260317-123446-337/timeline.jsonl` | `tests/logs/ai/backend/human/human-blocked-on-workspace/20260317-123446-337/artifacts.json`
- `human-approval-denied` | passed | `tests/logs/ai/backend/human/human-approval-denied/20260317-123446-327/meta.json` | `tests/logs/ai/backend/human/human-approval-denied/20260317-123446-327/timeline.jsonl` | `tests/logs/ai/backend/human/human-approval-denied/20260317-123446-327/artifacts.json`
- `human-self-correction-after-tool-failure` | passed | `tests/logs/ai/backend/human/human-self-correction-after-tool-failure/20260317-123446-339/meta.json` | `tests/logs/ai/backend/human/human-self-correction-after-tool-failure/20260317-123446-339/timeline.jsonl` | `tests/logs/ai/backend/human/human-self-correction-after-tool-failure/20260317-123446-339/artifacts.json`
- `human-docx-iterative-edit` | passed | `tests/logs/ai/backend/human/human-docx-iterative-edit/20260317-123446-340/meta.json` | `tests/logs/ai/backend/human/human-docx-iterative-edit/20260317-123446-340/timeline.jsonl` | `tests/logs/ai/backend/human/human-docx-iterative-edit/20260317-123446-340/artifacts.json`
- `human-terminal-docx-handoff` | passed | `tests/logs/ai/backend/human/human-terminal-docx-handoff/20260317-123446-336/meta.json` | `tests/logs/ai/backend/human/human-terminal-docx-handoff/20260317-123446-336/timeline.jsonl` | `tests/logs/ai/backend/human/human-terminal-docx-handoff/20260317-123446-336/artifacts.json`
- `human-single-step-kb-answer` | passed | `tests/logs/ai/backend/human/human-single-step-kb-answer/20260317-140339-612/meta.json` | `tests/logs/ai/backend/human/human-single-step-kb-answer/20260317-140339-612/timeline.jsonl` | `tests/logs/ai/backend/human/human-single-step-kb-answer/20260317-140339-612/artifacts.json`
- `human-single-step-kb-answer` | passed | `tests/logs/ai/backend/human/human-single-step-kb-answer/20260317-140645-949/meta.json` | `tests/logs/ai/backend/human/human-single-step-kb-answer/20260317-140645-949/timeline.jsonl` | `tests/logs/ai/backend/human/human-single-step-kb-answer/20260317-140645-949/artifacts.json`

##### Pass Rate

- totalRuns: 8
- passedRuns: 8
- failedRuns: 0
- successRate: 100.0%

##### Failure Analysis

- 历史探针 `20260317-125244-991` 曾记录过旧 primary baseline `gpt-5-mini` 的 channel `503`，但这条已随默认 baseline 改为 `gpt-5` 而失效，只保留为迁移背景。
- 探针 `20260317-140150-170` 暴露过强模型直接使用模型内知识、未走本地证据链的问题，因此本轮对 objective 增加了“只允许基于本地知识库回答”的约束。
- 探针 `20260317-140420-707` 暴露出 `gpt-5.2` 在该 case 上会触发 `bounded_loop_error`，因此 live `maxSteps` 已从 `10` 放宽到 `16`。

##### Current Assessment

- 已覆盖单步闭环、多工具串联、`workspace_required` 阻塞、审批拒绝、阻塞后部分交付、失败纠偏和多轮 refinement。
- 当前 `human` 已经不是“只能单工具调通”，而是能在 backend 测试里验证关键事件链与任务收敛方向。
- mock 基线已全部刷新到最新 raw logs，live 基线也已具备真实 `modelName` 记录能力。
- `/v1` 兼容性已通过代码修复兜住，`gpt-5 / gpt-5.2` 的单步 KB live pair 样例也已经通过。
- 当前剩余缺口不再是外部 channel 问题，而是阶段 2 仍缺少另外三个关键 `human` case 的 pair 对比证据。

##### Next Suggestions

- 把 `.env` 中的 `AI_LIVE_BASE_URL` 固定为带 `/v1` 的 OpenAI 兼容端点，避免其他 live 链路重复踩同一问题。
- 按 `human-docx-iterative-edit`、`human-terminal-docx-handoff`、`human-blocked-on-workspace` 的顺序补齐 `gpt-5 / gpt-5.2` pair 复跑。
- 把最新环境变量口径固定为 `AI_LIVE_PRIMARY_MODEL_NAME / AI_LIVE_STRONG_MODEL_NAME`，pair 复跑时由测试侧显式选择 `primary / strong`，避免后续再引回额外开关。
- 完成 `pair` 记录后，再关闭阶段 2 并创建 `todo-stage-3.md`，避免在缺少模型对比证据时提前进入 `intent / context / plan`。

## e2e

### workbench

##### Evidence

- `20260314-153210-722` | passed | `tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260314-153210-722/meta.json` | `tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260314-153210-722/timeline.jsonl` | `tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260314-153210-722/artifacts.json`
- `20260314-162218-992` | passed | `tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260314-162218-992/meta.json` | `tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260314-162218-992/timeline.jsonl` | `tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260314-162218-992/artifacts.json`
- artifact references: `tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260314-153210-722/artifacts/trace/playwright-trace.zip`、`tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260314-162218-992/artifacts/trace/playwright-trace.zip`

##### Pass Rate

- totalRuns: 2
- passedRuns: 2
- failedRuns: 0
- successRate: 100.0%

##### Failure Analysis

- 当前已提交样例中没有 failed run，因此还不能判断 approval、workspace required、review 等真实用户路径的失败模式。
- e2e timeline 中的 route、IPC、AI event signal 已经为后续失败定位提供了足够事实锚点。

##### Current Assessment

- workbench smoke 主链路可用，且 trace artifact 已在新 schema 下保留。
- backend / e2e 都已经切到直接基于 raw logs 的分析方式。
- 当前不足是 e2e 仍只有 smoke 覆盖，场景深度不够。

## Stage Completion

- stage: `阶段 1 / tool`
- status: completed
- completedAt: `2026-03-17`
- nextStage: `阶段 2 / human`

## Current Progress

- activeStage: `阶段 2 / human`
- status: in progress
- completedHumanCases: `6`
- mockBaselineStatus: `completed`
- pairBaselineStatus: `partial`
- strongProbeStatus: `passed`
- remainingFocus:
  - 补齐 `human-docx-iterative-edit`、`human-terminal-docx-handoff`、`human-blocked-on-workspace` 的 `primaryModel / strongModel` 对比
  - 完成阶段 2 退出条件后再创建 `todo-stage-3.md`

## Next Stage Candidate Todolist

- gatedOn: `阶段 2 的 GPT pair baseline 完成`
- `tests/ai/backend/main-intent/intent-direct-human.test.ts`
- `tests/ai/backend/main-intent/intent-to-plan-docx-task.test.ts`
- `tests/ai/backend/main-intent/intent-need-context-follow-up.test.ts`
- `tests/ai/backend/main-intent/intent-hybrid-task-routing.test.ts`
- `tests/ai/backend/main-context/context-follow-up-reference-resolution.test.ts`
- `tests/ai/backend/main-context/context-workspace-file-discovery.test.ts`
- `tests/ai/backend/main-context/context-hybrid-evidence-collection.test.ts`
- `tests/ai/backend/main-plan/plan-docx-edit-workflow.test.ts`
- `tests/ai/backend/main-plan/plan-kb-docx-hybrid-workflow.test.ts`
- `tests/ai/backend/main-plan/plan-terminal-assisted-docx-workflow.test.ts`
