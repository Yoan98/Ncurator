# NCurator-Desktop 测试架构

## 0. 适用范围

- 本文用于规定 NCurator-Desktop 的测试架构设计。
- 本文统一定义测试目录、测试准入、runner 职责、raw log 契约、report 契约，以及从正式 case 规划到 report 更新的标准流程。
- 本文不定义具体业务域的正式 case 内容；正式 case 的 `用例名称 / 实现状态 / What / Why / How / Oracle / Not` 统一以 `doc/test-plan/**` 为准。
- 当需要判断正式 case 是否可以进入 `tests/**`、日志应如何落盘、report 应如何生成与引用证据时，以本文为准。

## 1. 目标

- 测试体系收敛为两层产物：
  - 原始日志：`tests/logs/**`
  - 正式分析文档：`tests/report/<domain>/report.md`
- 原始日志统一由四类文件组成：
  - `meta.json`
  - `timeline.jsonl`
  - `runtime-events.jsonl`
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
  workspace/
    backend/
      source-service/
        basic/
        boundary/
        scenario/
      ipc/
        basic/
        boundary/
        scenario/
    e2e/
      settings/
        basic/
        boundary/
        scenario/
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
    workspace/
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
- 除 `tests/temp/**` 外，`tests/**` 中的正式测试目录只允许放已在 `doc/test-plan/**` 登记的 case，否则需要主动讨论。

## 3. 测试准入与用例编写规范

- 正式 case 与临时 case 的准入路径不同，必须先判断类型，再决定放置位置。
- 正式长期维护 case 的标准顺序固定为：先补 `doc/test-plan/**`，再写测试代码，再执行 runner，再分析 raw logs，再更新 report。

### 3.0 正式 test-plan 共享约束

- `doc/test-plan/**` 下每个领域文档，都是该领域正式测试用例定义的唯一规格来源。
- 新增、修改或补齐正式 case 时，必须严格对齐对应文档中的 `用例名称 / 实现状态 / What / Why / How / Oracle / Not`。
- `How` 用于定义 fixture、前置条件、输入、执行路径与运行方式；`Oracle` 用于定义必须成立的可断言结果；`Not` 用于定义禁止扩张的范围。
- 如果实现行为变更导致正式 case 预期变化，必须先更新对应 `doc/test-plan/**`，再修改测试代码。
- 如果 `tests/**` 非 `temp` 目录里缺少对应正式 case，必须先补 `doc/test-plan/**` 定义，再补测试代码。
- 每个 `用例名称` 都必须稳定映射到唯一 `caseId`、唯一测试文件和唯一日志目录。

### 3.0.1 实现状态取值约定

- `待检查`
  - 已在计划中定义，但还未核对代码是否已经实现或与文档一致。
- `未实现`
  - 代码中还没有对应测试用例实现。
- `部分实现`
  - 已有部分实现，但与文档定义不完全一致，或缺少关键断言 / fixture / 分支覆盖。
- `已实现`
  - 代码中的测试用例已与文档定义对齐。
- `待调整`
  - 当前代码已有实现，但文档定义或代码实现需要进一步调整后才能对齐。
- `已废弃`
  - 该 case 不再作为正式测试目标保留，但保留历史记录。

### 3.0.2 用例字段定义

- `用例名称`
  - 稳定 `caseId`，用于映射测试文件、日志目录和报告归属。
- `实现状态`
  - 用于标记当前代码实现与文档定义的匹配状态；新增 case 默认先写 `待检查`。
- `What`
  - 这条 case 到底要验证什么。
- `Why`
  - 这条 case 为什么长期存在，解决什么真实风险。
- `How`
  - 这条 case 的输入、前置条件、fixture、运行方式和关键执行链路。
- `Oracle`
  - 这条 case 必须成立的明确断言集合。
- `Not`
  - 这条 case 明确不验证什么，防止实现时擅自扩张范围。

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
- 实现正式测试代码时，必须先对齐对应 case 的 `实现状态 / What / Why / How / Oracle / Not`，不能只按目录名、`caseId` 或相邻样例自行脑补。
- 不允许绕过 `test-plan` 直接新增正式测试用例代码；如果测试计划中还没有对应 case，必须先补文档，再落测试实现。
- 正式测试代码中的 `caseId`、目录归属、分组层级、核心验收口径，必须与 `test-plan` 中对应 case 保持一致。

### 3.6 临时case
- 一次性排查、临时验证或待定样例统一放在 `tests/temp/**`。
- 不要把临时用例混入正式 domain 目录。
- 临时 case 不参与正式 report，也不作为阶段完成依据。
- 未在 `test-plan` 定义的验证，不得直接进入正式测试目录；需要先排查时只能放在 `tests/temp/**`。
- 如果某条临时 case 需要转为长期维护 case，必须先补齐 `doc/test-plan/**` 中的正式用例定义，再迁入正式测试目录。

## 4. 正式测试闭环流程

### 4.1 判断测试类型

- 正式长期回归 case：用于长期维护、参与 gating、进入正式 report，必须走 `doc/test-plan/**` -> `tests/**` -> `tests/logs/**` -> `tests/report/**` 的完整链路。
- 临时排查 case：只用于一次性排查、验证猜想或临时复现，固定放在 `tests/temp/**`，不参与 gating，也不进入正式 report。

### 4.2 定义或更新正式 case 规格

- 新增、补齐或调整正式 case 时，必须先更新 `doc/test-plan/**` 中对应测试计划。
- 正式 case 规格至少要明确 `用例名称 / 实现状态 / What / Why / How / Oracle / Not`，测试代码必须按这些字段落地，不得自行脑补。
- `用例名称` 需要稳定映射到唯一 `caseId`、唯一测试文件和唯一日志目录。

### 4.3 放入测试目录

- 正式 case 固定放在 `tests/<domain>/<layer>/<suite>/<groups...>/<case>.test.ts`。
- 临时 case 固定放在 `tests/temp/**`。
- 未在 `doc/test-plan/**` 登记的验证，不得进入正式测试目录。
- 当临时 case 需要转为正式长期 case 时，顺序必须是：先补 `doc/test-plan/**`，再迁入正式目录。

### 4.4 执行与产生日志

- 正式测试统一通过 `scripts/test-workflow.mjs` 执行。
- runner 只负责收集测试文件、执行测试并落 `tests/logs/**`。
- e2e 请求下 runner 先执行同域 backend；除此之外不负责失败分析、建议整理或 report 更新。

### 4.5 读取与分析 raw logs

- 默认先读取目标 run 的 `timeline.jsonl`，理解语义步骤、断言事实和失败位置。
- 如果 `timeline.jsonl` 仍不足以解释结果，再继续读取 `runtime-events.jsonl` 与关键附件。
- 必要时回看 `meta.json` 与 `artifacts.json`，确认 run 摘要、统计值和附件索引。
- 所有分析结论都必须可回溯到 raw logs 与 artifacts，不得脱离证据做推断。

### 4.6 更新正式 report

- 正式 report 固定更新 `tests/report/<domain>/report.md`。
- report 只能基于 `tests/logs/<domain>/**` 及其附件生成；`tests/temp/**` 不进入正式 report。
- report 负责沉淀当前现状分析、失败模式和下一步建议，但不能替代 raw logs 本身。

### 4.7 结论回流

- 如果问题出在 case 定义、验收口径或阶段边界，必须先改 `doc/test-plan/**`，再改测试代码。
- 如果只是实现缺陷或回归问题，可在保持 case 规格不变的前提下修实现并重跑。
- report 中已有结论若被新 run 推翻，应以最新 raw logs 重新分析并更新，不保留无证据的旧判断。

## 5. runner 与命令

统一入口是 `scripts/test-workflow.mjs`。

当前命令面：

- `pnpm test:ai`
- `pnpm test:ai:backend`
- `pnpm test:ai:backend:tools`
- `pnpm test:ai:e2e`
- `pnpm test:ai:sample`
- `pnpm test:workspace`
- `pnpm test:workspace:backend`

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

## 6. 原始日志契约

每个 run 固定目录：

```text
tests/logs/<domain>/<layer>/<suite>/<groups...>/<caseId>/<runId>/
  meta.json
  timeline.jsonl
  runtime-events.jsonl
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
- `runtime-events.jsonl`
  - 单次 run 的完整运行时原始事件流。
  - 用来回答“底层 runtime 真实发出了哪些 `sendEvent` 事件”。
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
  - 固定值为 `4`。
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
      - 只用于单次 case 的运行生命周期。
    - `step`
      - 只用于测试作者显式定义的语义步骤，不用于底层工具噪音。
    - `assertion`
      - 只用于 `Oracle` 或核心验收断言。
    - `artifact`
      - 只用于登记一个已经写出的附件。
    - `signal`
      - 只用于外部可观察信号，例如路由变化、IPC 调用、真实 runtime event、console。
    - `error`
      - 只用于 runner 或测试执行层面的未恢复错误。
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
- `run` 之外的业务状态不要塞进 `status`。
  - 例如 `blocked`、`completed`、`cancelled` 应保留在 `runtime-events.jsonl` 或写进 `data`，不要扩充 `timeline.status`。

### `runtime-events.jsonl`

- 文件内容是逐行 `AiRunEvent` JSON，不包额外 wrapper，不做 schema 投影。
- 范围固定为完整 `sendEvent` 原始事件流。
  - 包括 tool、guard、scope 校验、审批、产物、runtime issue、AI 运行等所有通过 `sendEvent` 发出的事件。
  - 不包含本地 harness 自己维护但未经过 `sendEvent` 的临时数组，例如某些工具测试里的 `activities[]`。
- `runtime-events.jsonl` 始终写出；如果本次 run 没有 runtime 事件，则写空文件。
- backend 与 e2e 的采集路径可以不同，但最终落盘契约必须一致。
- 当 `Oracle`、断言 `data`、`timeline.jsonl` 或 report 仍不足以解释失败原因时，必须继续回看 `runtime-events.jsonl`。

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
  - 固定值为 `4`。
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

### backend 与 e2e 的统一约束

- backend 和 e2e 共用同一份 `meta.json` / `timeline.jsonl` / `runtime-events.jsonl` / `artifacts.json` 基础契约。
- backend 与 e2e 的差异只体现在：
  - `meta.runtime.driver`
  - `meta.runtime.target`
  - `artifacts.json.items[].kind`
  - `runtime-events.jsonl` 的采集路径
  - `timeline.jsonl` 中出现的语义事件名与信号类型

#### e2e 默认附件策略

- 成功 run：
  - 始终保留 Playwright trace。
  - 只有测试或 runtime 显式要求保留的关键截图才写入。
  - 默认不生成 Playwright HTML 诊断页。
- 失败 run：
  - 始终保留 Playwright trace。
  - 始终生成失败截图，并通过 `refs.assertionId` 或 `refs.stepId` 绑定。
  - 生成位于 `artifacts/playwright/report/index.html` 的 HTML 诊断页。
- 默认不保留 video。

## 7. 正式 report 契约

- `report` 是正式测试闭环中的最终分析产物；前提是对应 domain 已先生成可回看的 raw logs。

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
- 不要在 report 正文里机械展开 `meta.json`、`timeline.jsonl`、`runtime-events.jsonl`、`artifacts.json` 这些文件名。
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

## 8. 明确禁止

- 测试样例直接输出失败原因分析。
- runner 自动调用测试所用 AI 模型生成 report。
- report 写入没有日志依据的推断。
- 为单个 runner 或单种工具单独再设计一套平行 raw log 契约。
