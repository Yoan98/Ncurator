# NCurator-Desktop 测试架构

## 1. 目标

- 测试体系收敛为两层产物：
  - 原始日志：`tests/logs/**`
  - 正式分析文档：`tests/report/<domain>/report.md`
- 原始日志统一由三类文件组成：
  - `meta.json`
  - `timeline.jsonl`
  - `artifacts.json`
- 测试样例只记录事实，不直接写失败原因分析、优化建议或能力判断。

## 2. 目录结构

```text
tests/
  harness/
  fixtures/
  ai/
    backend/
      tools/
        terminal/
        docx/
        kb/
      human/
      main-intent/
      main-context/
      main-plan/
      entire/
    e2e/
      workbench/
  kb-search/
    backend/
    e2e/
  other/
  logs/
  report/
    ai/
      report.md
```

规则：

- 目录统一使用 kebab-case。
- 测试发现目录使用通用树形结构：`tests/<domain>/<layer>/<suite>/<groups...>/<case>.test.ts`。
- `suite` 是第一层稳定分类；`groups...` 是 suite 下可选的任意深度子目录。
- `other/` 默认不参与 gating，也不参与正式 report 汇总。

## 3. 测试用例设计策略

### 3.1 基础case
- 这类case要保证基础能力能正常使用。
- case 尽量短、输入尽量单一、断言聚焦核心结果。

### 3.2 边界case
- 这类case要覆盖失败、阻塞、歧义、安全限制、空结果、超时等边界情况的处理。

### 3.3 实际场景case
- 这类case是核心，要能直接对应真实用户诉求。

### 3.5 长期价值
- 设计每个case时需考虑它的长期性，适合后续重复回归。

### 3.6 临时case
- 一次性排查或待定样例统一放在 `tests/other/**`。
- 不要把临时用例混入正式 domain 目录。

## 4. runner 与命令

统一入口是 `scripts/test-workflow.mjs`。

当前命令面：

- `pnpm test:ai`
- `pnpm test:ai:backend`
- `pnpm test:ai:backend:tools`
- `pnpm test:ai:e2e`
- `pnpm test:ai:sample`

runner 支持的过滤参数：

- `--domain`
- `--layer`
- `--suite`
- `--group`，可重复传入
- `--case`
- `--runs`

runner 的职责只有三件事：

1. 找到目标测试文件并执行。
2. 落原始日志到 `tests/logs/**`。
3. 在 e2e 请求下先执行同域 backend。

runner 不负责：

- 写事实汇总稿
- 写失败原因分析
- 写优化建议
- 更新正式 `report.md`

## 5. 原始日志契约

每个 run 固定目录：

```text
tests/logs/<domain>/<layer>/<suite>/<groups...>/<caseId>/<runId>/
  meta.json
  timeline.jsonl
  artifacts.json
  artifacts/
```

其中：

- `meta.json`
  - 单次 run 的摘要索引。
  - 用来回答“本次 run 是谁、结果是什么、统计值是什么”。
- `timeline.jsonl`
  - 单次 run 的事实事件流。
  - 用来回答“本次 run 按顺序发生了什么”。
- `artifacts.json`
  - 单次 run 的附件索引。
  - 用来回答“本次 run 产生了哪些可回看的附件”。
- `artifacts/`
  - 可选目录。
  - 只有确实生成 trace、截图、HTML 诊断页等实体附件时才创建。

### 目录与命名规则

- `<domain>/<layer>/<suite>/<groups...>`
  - 目录层级体现业务域、测试层和 suite 树。
  - 当前 runner 通过目录过滤测试范围。
- `<caseId>`
  - 对应用例稳定标识。
  - 通常与测试文件名一致。
- `<runId>`
  - 单次执行唯一标识。
  - 当前格式：`YYYYMMDD-HHmmss-SSS`。

### `meta.json`

固定字段：

- `schemaVersion`
- `runId`
- `caseId`
- `scope`
- `status`
- `startedAt`
- `finishedAt`
- `stats`
- `runtime`

字段含义：

- `schemaVersion`
  - 日志 schema 版本号。
  - 固定值为 `3`。
- `runId`
  - 本次执行唯一标识，对应目录名。
- `caseId`
  - 说明这次 run 属于哪条用例。
- `scope`
  - 说明这次 run 属于哪个稳定测试范围。
  - 格式为 `<domain>/<layer>/<suite>/<groups...>`，不包含 `caseId`。
- `status`
  - 本次 run 的最终结果。
  - 当前值域是 `passed` / `failed`。
- `startedAt`
  - 本次 run 的开始时间。
- `finishedAt`
  - 本次 run 的结束时间。
- `stats`
  - 本次 run 的结构化统计。
  - 当前固定字段：
    - `durationMs`
    - `steps`
    - `assertions`
    - `errors`
    - `artifacts`
- `runtime`
  - 本次 run 的运行时摘要。
  - 当前固定字段：
    - `driver`
    - `target`
    - `modelName`

约束：

- `meta.json` 顶层只保留上述固定字段。
- 如果测试需要保留 fixture 依赖信息，应写在 `timeline.jsonl` 的 `run/start` 事件 `data` 中。

### `timeline.jsonl`

固定字段：

- `ts`
- `type`
- `name`
- `status`
- `id`
- `message`
- `data`

字段含义：

- `ts`
  - 当前事件发生时间。
- `type`
  - 事件大类。
  - 当前值域：
    - `run`
    - `step`
    - `assertion`
    - `artifact`
    - `signal`
    - `error`
- `name`
  - 事件的稳定语义名，不是脚本名。
  - 同类事实在不同 run、不同 case 中应尽量复用同一命名。
- `status`
  - 当前事件状态。
  - 当前值域：
    - `info`
    - `ok`
    - `failed`
    - `skipped`
- `id`
  - 可选稳定事件标识。
  - 当前主要用于 `step` 和 `assertion`，便于关联截图等附件。
- `message`
  - 当前事件的一句事实性自然语言。
  - 只写“发生了什么”，不写失败原因、优化建议或能力判断。
- `data`
  - 结构化补充信息，可空。
  - 只放按需原始观测值，不要求统一业务 schema。

约束：

- `timeline.jsonl` 只记录高价值语义事件，不记录底层噪音。
- `signal` 用于记录可观察到的外部信号，例如路由变化、IPC 调用、AI 事件。
- 当失败事件存在明确证据时，优先把证据放进 `data` 或 artifact，不要在 `message` 中写大段解释。
- e2e 下不把所有 Playwright 底层调用逐条倾倒进 timeline；底层重放依赖 `trace.zip`，timeline 只保留语义 step / assertion / signal。

### `artifacts.json`

固定字段：

- `schemaVersion`
- `items`

其中 `items` 每项固定字段：

- `id`
- `kind`
- `path`
- `refs`

字段含义：

- `schemaVersion`
  - 附件索引 schema 版本号。
  - 固定值为 `3`。
- `id`
  - 单个附件的稳定标识。
- `kind`
  - 附件类型。
  - 当前值域：
    - `trace`
    - `screenshot`
    - `video`
    - `playwright-report`
    - `jsonl`
    - `other`
- `path`
  - 相对当前 run 根目录的稳定路径。
- `refs`
  - 可选关联索引。
  - 当前字段：
    - `stepId`
    - `assertionId`

约束：

- `artifacts.json` 必须始终写出，即使 `items` 为空数组。
- `artifacts/` 目录只有在确实存在实体附件文件时才创建。

## 6. backend 与 e2e 的统一约束

- backend 和 e2e 共用同一份 `meta.json` / `timeline.jsonl` / `artifacts.json` 基础契约。
- backend 与 e2e 的差异只体现在：
  - `meta.runtime.driver`
  - `meta.runtime.target`
  - `artifacts.json.items[].kind`
  - `timeline.jsonl` 中出现的语义事件名与信号类型

### e2e 默认附件策略

- 成功 run：
  - 始终保留 Playwright trace。
  - 只有测试或 runtime 显式要求保留的关键截图才写入。
  - 默认不生成 Playwright HTML 诊断页。
- 失败 run：
  - 始终保留 Playwright trace。
  - 始终生成失败截图，并通过 `refs.assertionId` 或 `refs.stepId` 绑定。
  - 生成位于 `artifacts/playwright/report/index.html` 的 HTML 诊断页。
- 默认不保留 video。

## 7. 正式 report

当前正式分析文档固定放在：

```text
tests/report/<domain>/
  report.md
```

含义：

- `report.md`
  - 当前业务域唯一正式分析报告。
  - 是基于 `tests/logs/<domain>/**` 写出的当前现状分析。

### `report.md` 建议结构

- `Domain Overview`
- 按 `backend` / `e2e` 展开
- 每个 layer / suite / groups 节点按需要继续下钻
- 每个节点至少包含：
  - `Evidence`
  - `Pass Rate`
  - `Failure Analysis`
  - `Current Assessment`
  - `Next Suggestions`

### `report.md` 格式约束

- 顶层标题使用 `# <Domain> Domain Report`。
- 顶层必须先有 `## Domain Overview`。
- `Domain Overview` 之后按 domain 下实际存在的 layer 展开，当前通常是 `## backend` 与 `## e2e`。
- layer 之下按目录树继续展开：
  - suite 使用 `###`
  - suite 下第一层 group 使用 `####`
  - 更深层 group 继续按 Markdown 标题层级递增
- 每个实际分析节点都必须包含以下固定小节，顺序保持一致：
  - `Evidence`
  - `Pass Rate`
  - `Failure Analysis`
  - `Current Assessment`
  - `Next Suggestions`
- `Evidence` 必须列出对应 run 的 `meta.json`、`timeline.jsonl`、`artifacts.json` 路径；如果有关键附件，也应一并列出。
- `Pass Rate` 只写当前节点覆盖范围内的统计，不混入其他节点数据。
- `Failure Analysis` 在没有 failed run 时应明确写“当前没有 failed run，因此无法给出失败模式结论”。
- `Current Assessment` 负责总结当前状态和主要不足。
- `Next Suggestions` 只写基于现有证据能支撑的下一步建议。

### `report.md` 最小示例

```md
# AI Domain Report

## Domain Overview

- analysisWindow: 当前仓库内 `tests/logs/ai/**` 的 raw logs
- analyzedScopes: `ai/backend/tools/terminal`、`ai/e2e/workbench`
- overallAssessment: 当前 backend sample 与 e2e smoke 已跑通，但失败路径覆盖仍不足。

## backend

### tools

#### terminal

##### Evidence

- `20260315-101530-112` | passed | `tests/logs/ai/backend/tools/terminal/terminal-basic-command/20260315-101530-112/meta.json` | `tests/logs/ai/backend/tools/terminal/terminal-basic-command/20260315-101530-112/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/terminal-basic-command/20260315-101530-112/artifacts.json`

##### Pass Rate

- totalRuns: 1
- passedRuns: 1
- failedRuns: 0
- successRate: 100.0%

##### Failure Analysis

- 当前没有 failed run，因此无法给出失败模式结论。

##### Current Assessment

- terminal happy path 已稳定产出 raw logs。
- 当前不足是还没有正式纳入失败/阻塞样例。

##### Next Suggestions

- 增加 `workspace-boundary-rejected`
- 增加 `approval-denied`

## e2e

### workbench

##### Evidence

- `20260315-103002-008` | passed | `tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260315-103002-008/meta.json` | `tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260315-103002-008/timeline.jsonl` | `tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260315-103002-008/artifacts.json`
- artifact references: `tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260315-103002-008/artifacts/trace/playwright-trace.zip`

##### Pass Rate

- totalRuns: 1
- passedRuns: 1
- failedRuns: 0
- successRate: 100.0%

##### Failure Analysis

- 当前没有 failed run，因此无法给出失败模式结论。

##### Current Assessment

- workbench smoke 主链路已可用。
- 当前不足是 approval、workspace required、review 等真实路径尚未纳入。

##### Next Suggestions

- 补充 approval 路径
- 补充 workspace required 场景
```

约束：

- report 只引用 raw logs 与 artifacts 作为证据来源。
- report 可以做分析与建议，但不得写入没有日志依据的推断。

## 8. Codex 后置分析工作流

当用户要求 Codex 跑测试并继续分析时，Codex 必须按以下顺序执行：

1. 运行目标测试命令。
2. 读取对应 domain 下的 raw logs。
3. 必要时回看失败 run 的 `meta.json`、`timeline.jsonl` 与 `artifacts.json`。
4. 更新 `tests/report/<domain>/report.md`。

## 9. 明确禁止

- 测试样例直接输出失败原因分析。
- runner 自动调用测试所用 AI 模型生成 report。
- report 写入没有日志依据的推断。
- 为单个 runner 或单种工具单独再设计一套平行 raw log 契约。
