# NCurator-Desktop 测试架构

## 1. 目标
- 测试架构分成三层：
  - 原始日志：`tests/logs/**`
  - 事实汇总稿：`tests/report/<domain>/facts/**`
  - Codex 后置分析文档：`tests/report/<domain>/report.md` 与 `tests/report/<domain>/current-summary.md`
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

## 4. 原始日志契约

每个 run 固定目录：

```text
tests/logs/<domain>/<layer>/<suite>/<capability?>/<caseId>/<runId>/
  meta.json
  timeline.jsonl
  artifacts/
```

### 目录与文件命名规则

- `<domain>`
  - 业务域目录名。
  - 当前例子：`ai`。
- `<layer>`
  - 测试层级目录名。
  - 当前例子：`backend`。
- `<suite>`
  - suite 目录名。
  - 当前例子：`capability`。
- `<capability?>`
  - 可选能力目录。
  - 当前例子：`terminal`。
- `<caseId>`
  - 对应用例唯一标识。
  - 当前例子：`terminal-basic-command`。
- `<runId>`
  - 单次执行唯一标识。
  - 当前格式：`YYYYMMDD-HHmmss-SSS`，例如 `20260314-132107-700`。
  - 含义是“本次执行开始时间”，用于区分同一 case 的多次运行。
- `meta.json`
  - 单次运行的摘要索引。
  - 用来回答“这次 run 是谁、何时跑的、结果是什么”。
- `timeline.jsonl`
  - 单次运行的时间线事实流。
  - 用来回答“这次 run 具体按什么顺序发生了什么”。
- `artifacts/`
  - 可选目录。
  - 只在需要额外保存附件、输出文件或截图时创建。

### `meta.json`

固定字段：

- `runId`
- `caseId`
- `domain`
- `layer`
- `suite`
- `capability`
- `startedAt`
- `finishedAt`
- `status`
- `gitSha`
- `modelName`
- `fixtures`

字段含义：

- `runId`
  - 本次执行唯一标识，对应目录名。
- `caseId`
  - 说明这次 run 属于哪条用例。
- `domain`
  - 说明这次 run 属于哪个业务域。
- `layer`
  - 说明这次 run 属于 `backend` 还是 `e2e`。
- `suite`
  - 说明这次 run 属于哪一个测试分类。
- `capability`
  - 说明这次 run 是否进一步归属于某项能力；无则为 `null`。
- `startedAt`
  - 本次 run 的开始时间。
- `finishedAt`
  - 本次 run 的结束时间。
- `status`
  - 本次 run 的最终结果。
  - 当前值域是 `passed` / `failed`。
- `gitSha`
  - 运行代码对应的 git 提交短哈希。
  - 用来帮助判断“这次结果对应哪个代码状态”。
- `modelName`
  - 测试执行过程中真正使用的模型名。
  - 当前 terminal sample 不需要模型，所以是 `null`。
- `fixtures`
  - 本次 run 声明依赖的 fixture 列表。

### `timeline.jsonl`

固定字段：

- `ts`
- `kind`
- `status`
- `message`
- `detail`

字段含义：

- `ts`
  - 当前事件的发生时间。
- `kind`
  - 当前事件是什么类型。
  - 当前常见值：`run_start`、`tool_call`、`tool_result`、`assertion`、`run_end`、`error`。
- `status`
  - 当前事件状态。
  - 当前常见值：`info`、`ok`、`failed`、`skipped`。
- `message`
  - 当前事件的一句事实性自然语言。
  - 只回答“发生了什么”，不回答“为什么发生”。
- `detail`
  - 结构化补充信息，可空。
  - 例如命令、cwd、退出码、stdout、stderr、risk level。

约束：

- `message` 只能写事实性自然语言。
- 允许写“调用了什么、返回了什么、断言通过还是失败”。
- 禁止写“为什么失败、应该如何优化、模型能力不足”。

## 5. facts 文档契约

facts 文档由 runner 自动生成，位置在 `tests/report/<domain>/facts/**`。

### 目录与文件命名规则

facts 路径规则：

```text
tests/report/<domain>/facts/<layer>/<suite>/<capability?>/<caseId>.md
```

含义：

- `<domain>`
  - 业务域，例如 `ai`。
- `facts`
  - 明确表示这里放的是 runner 自动整理的事实稿，不是最终分析报告。
- `<layer>/<suite>/<capability?>`
  - 与 log 的业务范围对齐，方便从 facts 反查 logs。
- `<caseId>.md`
  - 以稳定 caseId 命名。
  - 一个 case 对应一份当前 facts 文档；后续同 case 再运行时由 runner 覆盖为最新事实稿。

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
- `Failed Runs`
  - 列出失败 run 的直接事实，不做原因判断。
- `Artifact References`
  - 给出应回看的 logs 或后续 report / summary 目标路径。
- `Pending Codex Analysis`
  - 提示 Codex 后续必须做的动作。

facts 文档只做事实整理，不做结论。

## 6. 正式 report 与 current summary 的目录、文件名和含义

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
  - 说明本次分析覆盖的范围和直接结论。
- `Success Rate`
  - 说明本次分析所依据的成功率和样本范围。
- `Failed Samples`
  - 列出失败样例及其直接现象。
- `Failure Analysis`
  - 基于 facts 和 raw logs 写出的失败原因分析。
- `Success Samples`
  - 列出可复用的成功路径或成功模式。
- `Optimization Decision`
  - 判断当前是否需要优化、优化方向是什么。
- `Next Suggestions`
  - 给出下一步应补的测试、应修的能力或应推进的层级。

### `current-summary.md` 固定章节

- `Current Status`
  - 当前业务域总体状态。
- `Stable Points`
  - 当前已较稳定的能力或路径。
- `Unstable Points`
  - 当前高风险或覆盖不足的点。
- `Current Priority`
  - 当前最应优先处理的事项。
- `Recent Changes`
  - 最近一次重构、补测或能力变化的摘要。

## 7. Codex 后置分析工作流

当用户要求 Codex 跑测试并继续分析时，Codex 必须按以下顺序执行：

1. 运行目标测试命令。
2. 读取对应 facts 文档。
3. 必要时回看失败 run 的 `meta.json` 和 `timeline.jsonl`。
4. 更新 `tests/report/<domain>/report.md`。
5. 更新 `tests/report/<domain>/current-summary.md`。

## 8. 明确禁止

- 测试样例直接输出失败原因分析。
- runner 自动调用测试所用 AI 模型生成 report / summary。
- report / summary 写入没有日志依据的推断。
