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

### `timeline.jsonl`

固定字段：

- `ts`
- `kind`
- `status`
- `message`
- `detail`

约束：

- `message` 只能写事实性自然语言。
- 允许写“调用了什么、返回了什么、断言通过还是失败”。
- 禁止写“为什么失败、应该如何优化、模型能力不足”。

## 5. facts 文档契约

facts 文档由 runner 自动生成，位置在 `tests/report/<domain>/facts/**`。

固定章节：

- `Overview`
- `Success Rate`
- `Run List`
- `Failed Runs`
- `Artifact References`
- `Pending Codex Analysis`

facts 文档只做事实整理，不做结论。

## 6. Codex 后置分析工作流

当用户要求 Codex 跑测试并继续分析时，Codex 必须按以下顺序执行：

1. 运行目标测试命令。
2. 读取对应 facts 文档。
3. 必要时回看失败 run 的 `meta.json` 和 `timeline.jsonl`。
4. 更新 `tests/report/<domain>/report.md`。
5. 更新 `tests/report/<domain>/current-summary.md`。

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

## 7. 明确禁止

- 测试样例直接输出失败原因分析。
- runner 自动调用测试所用 AI 模型生成 report / summary。
- report / summary 写入没有日志依据的推断。
