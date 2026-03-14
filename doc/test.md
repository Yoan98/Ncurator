# NCurator-Desktop 测试架构

## 1. 目标
- 测试架构分成三层：
  - 原始日志：`tests/logs/**`
  - 事实汇总稿：`tests/report/<domain>/facts/**`
  - Codex 后置分析文档：`tests/report/<domain>/report.md` 与 `tests/report/<domain>/current-summary.md`
- 原始日志契约统一使用 v2 三件套：
  - `meta.json`
  - `timeline.jsonl`
  - `artifacts.json`
- 测试样例只能记录事实，不能分析失败原因。

## 2. 目录结构

```text
tests/
  harness/
  fixtures/
  ai/
    backend/
      capability/
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
      facts/
      report.md
      current-summary.md
```

规则：

- 目录统一使用 kebab-case。
- `backend` 先于 `e2e`。
- `other/` 默认不参与 gating，也不参与 summary 汇总。

## 3. runner 与命令

统一入口是 `scripts/test-workflow.mjs`。

当前命令面：

- `pnpm test:ai`
- `pnpm test:ai:backend`
- `pnpm test:ai:backend:capability`
- `pnpm test:ai:e2e`
- `pnpm test:ai:sample`

runner 的职责只有四件事：

1. 找到目标测试文件并执行。
2. 落原始日志到 `tests/logs/**`。
3. 读取本次运行日志，生成 facts Markdown 到 `tests/report/<domain>/facts/**`。
4. 在 e2e 请求下先执行同域 backend。

runner 不负责：

- 写失败原因分析
- 写优化建议
- 更新正式 `report.md`
- 更新 `current-summary.md`

## 4. 原始日志契约 v2

每个 run 固定目录：

```text
tests/logs/<domain>/<layer>/<suite>/<capability?>/<caseId>/<runId>/
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
  - 只有确实生成 trace、截图、HTML 诊断页等二进制或大文本附件时才创建。

### 目录与命名规则

- `<domain>/<layer>/<suite>/<capability?>`
  - 目录层级仍然体现业务域和测试层。
  - 当前 runner 通过目录过滤测试范围。
- `<caseId>`
  - 对应用例稳定标识。
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
  - 当前原始日志契约版本。
  - v2 固定为 `2`。
- `runId`
  - 本次执行唯一标识，对应目录名。
- `caseId`
  - 说明这次 run 属于哪条用例。
- `scope`
  - 说明这次 run 属于哪个稳定测试范围。
  - 格式为 `<domain>/<layer>/<suite>/<capability?>`，不包含 `caseId`。
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

- 不再在 `meta.json` 顶层保留 `domain`、`layer`、`suite`、`capability`、`durationMs`、`modelName`、`fixtures`。
- 如果测试确实需要保留 fixture 依赖信息，应写在 `timeline.jsonl` 的 `run/start` 事件 `data` 中，而不是回退到 `meta.json` 顶层扩字段。

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
  - 事件的稳定语义名。
  - 例如：
    - `start`
    - `terminal-command-start`
    - `terminal-stdout-match`
    - `route-change`
    - `ipc-call`
    - `execution-failed`
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
- `data`
  - 结构化补充信息，可空。

约束：

- `timeline.jsonl` 只记录高价值语义事件，不记录底层噪音。
- 允许写“开始执行、点击按钮、断言通过、路由变化、保存 trace”。
- 禁止写“为什么失败、应该如何优化、模型能力不足”。
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
  - 当前附件索引契约版本。
  - v2 固定为 `2`。
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

## 5. backend 与 e2e 的统一约束

- backend 和 e2e 共用同一份 `meta.json` / `timeline.jsonl` / `artifacts.json` 基础契约。
- backend 与 e2e 的差异只体现在：
  - `meta.runtime.driver`
  - `meta.runtime.target`
  - `artifacts.json.items[].kind`
  - `timeline.jsonl` 中出现的语义事件名

### e2e 默认附件策略

- 成功 run：
  - 始终保留 Playwright trace。
  - 只有测试或 runtime 显式要求保留的关键截图才写入。
  - 默认不生成 Playwright HTML 诊断页。
- 失败 run：
  - 始终保留 Playwright trace。
  - 始终生成失败截图，并通过 `refs.assertionId` 或 `refs.stepId` 绑定。
  - 生成位于 `artifacts/playwright/report/index.html` 的 HTML 诊断页。
- v1 默认不保留 video。

## 6. facts 文档契约

facts 文档由 runner 自动生成，位置在 `tests/report/<domain>/facts/**`。

路径规则：

```text
tests/report/<domain>/facts/<layer>/<suite>/<capability?>/<caseId>.md
```

固定章节：

- `Overview`
- `Success Rate`
- `Run List`
- `Failed Runs`
- `Artifact References`
- `Pending Codex Analysis`

章节含义：

- `Overview`
  - 说明当前 facts 覆盖的是哪条 case、哪个范围、何时生成。
- `Success Rate`
  - 说明当前事实窗口内的通过数、失败数和成功率。
- `Run List`
  - 列出当前事实窗口纳入统计的 run。
  - 必须显示 `meta.json`、`timeline.jsonl`、`artifacts.json` 引用。
- `Failed Runs`
  - 列出失败 run 的直接事实，不做原因判断。
  - 必须展示失败 assertion / error 事实以及相关 artifact 引用。
- `Artifact References`
  - 给出应回看的附件路径，例如 trace、截图、HTML 诊断页。
- `Pending Codex Analysis`
  - 提示 Codex 后续必须做的动作。

facts 文档只做事实整理，不做结论。

## 7. 正式 report 与 current summary

当前正式分析文档固定放在：

```text
tests/report/<domain>/
  report.md
  current-summary.md
```

命名规则与含义：

- `report.md`
  - 当前业务域最近一次正式分析报告。
  - 是基于某次 facts 与 raw logs 写出的“本轮分析结果”。
- `current-summary.md`
  - 当前业务域的现状总览。
  - 不是单次运行报告，而是“截至现在，这个业务域整体处于什么状态”。

### `report.md` 固定章节

- `Overview`
- `Success Rate`
- `Failed Samples`
- `Failure Analysis`
- `Success Samples`
- `Optimization Decision`
- `Next Suggestions`

### `current-summary.md` 固定章节

- `Current Status`
- `Stable Points`
- `Unstable Points`
- `Current Priority`
- `Recent Changes`

## 8. Codex 后置分析工作流

当用户要求 Codex 跑测试并继续分析时，Codex 必须按以下顺序执行：

1. 运行目标测试命令。
2. 读取对应 facts 文档。
3. 必要时回看失败 run 的 `meta.json`、`timeline.jsonl` 与 `artifacts.json`。
4. 更新 `tests/report/<domain>/report.md`。
5. 更新 `tests/report/<domain>/current-summary.md`。

## 9. 明确禁止

- 测试样例直接输出失败原因分析。
- runner 自动调用测试所用 AI 模型生成 report / summary。
- report / summary 写入没有日志依据的推断。
- 为单个 runner 或单种工具单独再设计一套平行 raw log 契约。
