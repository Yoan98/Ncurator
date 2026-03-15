# AI Domain Report

该文档基于当前仓库内 `tests/logs/ai/**` 已提交的 raw logs 更新。

## Domain Overview

- analysisWindow: 当前仓库内已提交的 AI raw logs
- analyzedScopes: `ai/backend/tools/terminal`、`ai/e2e/workbench`
- backendPassRate: 3/3 = 100.0%
- e2ePassRate: 2/2 = 100.0%
- overallAssessment: backend terminal sample 与 workbench e2e smoke 已在新树形 scope 下产出 `schemaVersion=3` 的 raw logs；当前主要缺口仍然是失败/阻塞路径覆盖不足。

## backend

### tools

#### terminal

##### Evidence

- `20260314-152003-312` | passed | `tests/logs/ai/backend/tools/terminal/terminal-basic-command/20260314-152003-312/meta.json` | `tests/logs/ai/backend/tools/terminal/terminal-basic-command/20260314-152003-312/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/terminal-basic-command/20260314-152003-312/artifacts.json`
- `20260314-153523-044` | passed | `tests/logs/ai/backend/tools/terminal/terminal-basic-command/20260314-153523-044/meta.json` | `tests/logs/ai/backend/tools/terminal/terminal-basic-command/20260314-153523-044/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/terminal-basic-command/20260314-153523-044/artifacts.json`
- `20260314-162211-939` | passed | `tests/logs/ai/backend/tools/terminal/terminal-basic-command/20260314-162211-939/meta.json` | `tests/logs/ai/backend/tools/terminal/terminal-basic-command/20260314-162211-939/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/terminal-basic-command/20260314-162211-939/artifacts.json`

##### Pass Rate

- totalRuns: 3
- passedRuns: 3
- failedRuns: 0
- successRate: 100.0%

##### Failure Analysis

- 当前已提交样例中没有 failed run，因此无法给出失败模式层面的结论。
- timeline 已覆盖 workspace boundary check、risk classification、terminal command execution 与 stdout 断言，说明 happy path 的事实链完整。

##### Current Assessment

- backend terminal 样例已经完成从旧 `capability` 路径到 `tools` 路径的迁移。
- raw logs 足以让 Codex 直接回看单次执行细节，不再依赖 facts 中间产物。
- 当前不足是样例仍然只覆盖低风险成功路径。

##### Next Suggestions

- 增加 `workspace-boundary-rejected`
- 增加 `approval-denied`
- 增加 `invalid-input` 或命令失败场景

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

##### Next Suggestions

- 补充 approval accept / deny 路径
- 补充 workspace required 场景
- 补充 file artifact review 场景
