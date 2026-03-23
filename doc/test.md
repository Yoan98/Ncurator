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
          basic/
          boundary/
          scenario/
          live/
        docx/
          basic/
          boundary/
          scenario/
          live/
        kb/
          basic/
          boundary/
          scenario/
          live/
      human/
        basic/
        boundary/
        scenario/
        live/
      director-intent/
        basic/
        boundary/
        scenario/
        live/
      director-context/
        basic/
        boundary/
        scenario/
        live/
      director-plan/
        basic/
        boundary/
        scenario/
        live/
      entire/
        basic/
        boundary/
        scenario/
        live/
    e2e/
      workbench/
        basic/
        boundary/
        scenario/
        live/
  kb-search/
    backend/
      basic/
      boundary/
      scenario/
      live/
    e2e/
      basic/
      boundary/
      scenario/
      live/
  temp/
  logs/
  report/
    ai/
      report.md
```

规则：

- 目录统一使用 kebab-case。
- 测试发现目录使用通用树形结构：`tests/<domain>/<layer>/<suite>/<groups...>/<case>.test.ts`。
- `suite` 是第一层稳定分类；`groups...` 是 suite 下可选的任意深度子目录。
- 正式测试目录默认优先使用四类稳定分组：`basic`、`boundary`、`scenario`、`live`。
- `basic / boundary / scenario` 用于组织稳定回归基线；`live` 用于组织真实模型路径验证。
- 只要某个正式测试范围涉及模型参与，就必须在该范围下维护 `live/` 目录和对应的 live case。
- `temp/` 默认不参与 gating，也不参与正式 report 汇总。

## 3. 测试用例设计原则

### 3.1 基础case
- 这类case要保证基础能力能正常使用。
- case 尽量短、输入尽量单一、断言聚焦核心结果。

### 3.2 边界case
- 这类case要覆盖失败、阻塞、歧义、安全限制、空结果、超时等边界情况的处理。

### 3.3 实际场景case
- 这类case是核心，要能直接对应真实用户诉求。

### 3.4 Live case
- 这类case用于验证真实模型参与下的正式执行路径。
- 只要生产路径中存在模型参与，就不能只靠 `basic / boundary / scenario` 得出能力成立结论。
- `live` case 应优先依赖真实 fixture、真实流程和正式交付，而不是只验证脚本化骨架。
- 对 `human`、长任务、端到端任务这类能力，`live` 是主结论来源；非 live case 主要用于稳定回归与诊断。

### 3.5 长期价值
- 设计每个case时需考虑它的长期性，适合后续重复回归。
- 进入正式 domain 目录的 case 默认都应具备长期回归价值。
- 长期 case 应有稳定目标、稳定输入、稳定验收口径。
- 对涉及模型的长期 case，应规划对应的 `live` 验证，不把“脚本化通过”当作最终完成。
- 所有长期维护的正式 case，必须先对齐 `doc/test-plan/**` 下对应测试计划中的用例定义，再实现测试代码。
- 不允许绕过 `test-plan` 直接新增正式测试用例代码；如果测试计划中还没有对应 case，必须先补文档，再落测试实现。
- 正式测试代码中的 `caseId`、目录归属、分组层级和核心验收口径，必须与 `test-plan` 中对应 case 保持一致。

### 3.6 临时case
- 一次性排查、临时验证或待定样例统一放在 `tests/temp/**`。
- 不要把临时用例混入正式 domain 目录。
- 临时 case 不参与正式 report，也不作为阶段完成依据。
- 如果某条临时 case 需要转为长期维护 case，必须先补齐 `doc/test-plan/**` 中的正式用例定义，再迁入正式测试目录。

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

补充规则：

- 默认按 `suite` 运行时，runner 只收集非 `live/` 正式 case，避免把稳定回归和 live 验证混在同一批执行里。
- `live` case 应通过显式 `--group live` 或显式 `--case` 运行。

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

- `总览`
- `总览` 至少包含：
  - `分析范围`
  - `总体结论`
  - `下一阶段建议`
- 按 `backend` / `e2e` 展开
- 每个 layer / suite / groups 节点按需要继续下钻
- 每个节点至少包含：
  - `证据`
  - `通过率`
  - `失败分析`
  - `当前评估`
  - `下一步建议`

### `report.md` 格式约束

- 顶层标题使用 `# <Domain> 域测试报告`。
- 顶层必须先有 `## 总览`。
- `总览` 下必须先包含以下固定小节，顺序保持一致：
  - `### 分析范围`
  - `### 总体结论`
  - `### 下一阶段建议`
- `总体结论` 中的统计口径固定拆成两类：
  - `历史总数据`：基于当前 analysis window 内全部 raw runs 统计
  - `最新总数据`：每个 case 只看最新一轮 run 的修复后统计
- `总览` 之后按 domain 下实际存在的 layer 展开，当前通常是 `## backend` 与 `## e2e`。
- layer 之下按目录树继续展开：
  - suite 使用 `###`
  - suite 下第一层 group 使用 `####`
  - 更深层 group 继续按 Markdown 标题层级递增
- 每个实际分析节点都必须包含以下固定小节，顺序保持一致：
  - `证据`
  - `通过率`
  - `失败分析`
  - `当前评估`
  - `下一步建议`
- `证据` 默认只列出能定位该条证据的最小信息，例如 `caseId`、`runId`、`status`。
- 不要在 report 正文里机械展开 `meta.json`、`timeline.jsonl`、`artifacts.json` 这些文件名。
- 只有当失败分析或结论明确依赖某个关键附件时，才额外补充附件名称或用途说明。
- `通过率` 只写当前节点覆盖范围内的统计，不混入其他节点数据。
- `通过率` 固定拆成两组：
  - `历史总数据`：`totalRuns`、`passedRuns`、`failedRuns`、`historicalSuccessRate`
  - `最新总数据`：`latestCaseCount`、`latestPassedCases`、`latestFailedCases`、`latestSuccessRate`
- `历史总数据` 与 `最新总数据` 不得混写成同一个 successRate 口径。
- `失败分析` 在没有 failed run 时应明确写“当前没有 failed run，因此无法给出失败模式结论”。
- `当前评估` 负责总结当前状态和主要不足。
- `下一步建议` 只写基于现有证据能支撑的下一步建议。

### `report.md` 最小示例

```md
# AI 域测试报告

## 总览

### 分析范围

- raw logs 范围: 当前仓库内 `tests/logs/ai/**`
- 已分析 scope: `ai/backend/tools/terminal`、`ai/e2e/workbench`

### 总体结论

- 历史总数据: `2` 次 raw runs，其中 `2` 次 passed、`0` 次 failed，historicalSuccessRate=`100.0%`
- 最新总数据: `2 / 2` 个 case 的最新一轮 run 为 passed，latestSuccessRate=`100.0%`
- 当前结论: 当前 backend sample 与 e2e smoke 已跑通，但失败路径覆盖仍不足。

### 下一阶段建议

- 先补 `backend/tools/terminal` 的失败路径
- 再补 `e2e/workbench` 的阻塞分支

## backend

### tools

#### terminal

##### 证据

- `terminal-basic-command` | run=`20260315-101530-112` | status=`passed`

##### 通过率

- 历史总数据:
  - totalRuns: 1
  - passedRuns: 1
  - failedRuns: 0
  - historicalSuccessRate: 100.0%
- 最新总数据:
  - latestCaseCount: 1
  - latestPassedCases: 1
  - latestFailedCases: 0
  - latestSuccessRate: 100.0%

##### 失败分析

- 当前没有 failed run，因此无法给出失败模式结论。

##### 当前评估

- terminal happy path 已稳定产出 raw logs。
- 当前不足是还没有正式纳入失败/阻塞样例。

##### 下一步建议

- 增加 `workspace-boundary-rejected`
- 增加 `approval-denied`

## e2e

### workbench

##### 证据

- `workbench-plan-artifact-smoke` | run=`20260315-103002-008` | status=`passed`
- 关键附件: playwright trace

##### 通过率

- 历史总数据:
  - totalRuns: 1
  - passedRuns: 1
  - failedRuns: 0
  - historicalSuccessRate: 100.0%
- 最新总数据:
  - latestCaseCount: 1
  - latestPassedCases: 1
  - latestFailedCases: 0
  - latestSuccessRate: 100.0%

##### 失败分析

- 当前没有 failed run，因此无法给出失败模式结论。

##### 当前评估

- workbench smoke 主链路已可用。
- 当前不足是 approval、workspace required、review 等真实路径尚未纳入。

##### 下一步建议

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
