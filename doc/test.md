# NCurator-Desktop 测试架构

## 0. 适用范围

- 本文用于规定 NCurator-Desktop 的测试架构设计。


## 1. 写测试前先判断

- 如果只记一件事：写测试前先判断这是正式长期回归 case，还是一次性临时排查 case。
- 默认策略：
  - 只要还在排查、验证猜想、补上下文、试运行 fixture，或尚未确定要长期维护，一律先放 `tests/temp/**`。
  - 只有确认要长期维护、参与 gating 或进入正式 report 的 case，才进入正式测试目录。
  - 只要要进入正式测试目录，必须先补对应 `doc/test-plan/**`；未登记的 case 不得直接写进 `tests/**` 非 `temp` 目录。
- 测试体系最终只沉淀两层正式产物：
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
  unit/
  workbench/
  settings/
  kb-search/
  temp/
  logs/
  report/
    ai/
      report.md
    workbench/
      report.md
    settings/
      report.md
```

规则：

- 目录统一使用 kebab-case。
- 测试发现目录使用通用树形结构：`tests/<domain>/<suite>/<groups...>/<case>.test.ts`。
- `suite` 是第一层稳定分类；`groups...` 是 suite 下可选的任意深度子目录。
- 各 domain 的 `suite` 列表与归属，只在对应 `doc/test-plan/**` 中定义，本文不重复展开。
- 当某个 `suite` 不需要继续细分时，正式 case 可以直接放在该 `suite` 目录下。
- 普通测试文件使用 `<case>.test.ts` 命名。
- e2e 测试文件使用 `<case>.e2e.test.ts` 命名。
- `temp/` 默认不参与 gating，也不参与正式 report 汇总。
- 除 `tests/temp/**` 外，`tests/**` 中的正式测试目录只允许放已在 `doc/test-plan/**` 登记的 case，否则需要主动讨论。

## 3. 用例准入与编写规则

### 3.1 快速判断

- 正式长期回归 case：用于长期维护、参与 gating、进入正式 report，必须进入正式测试闭环。
- 临时排查 case：只用于一次性排查、验证猜想、临时复现或补充上下文，固定放在 `tests/temp/**`。
- 用户没有明确要求“补正式长期 case”时，默认先写 `tests/temp/**`，不要直接进入正式目录。
- 当临时 case 需要转为正式长期 case 时，顺序必须是：先补 `doc/test-plan/**`，再迁入正式目录。

### 3.2 正式 case 共享约束

- `doc/test-plan/**` 下每个领域文档，都是该领域正式测试用例定义的唯一规格来源。
- 新增、修改或补齐正式 case 时，必须严格对齐对应文档中的 `用例名称 / 实现状态 / What / Why / How / Oracle / Not`。
- 如果 case 覆盖的是用户可见功能，`How / Oracle` 还必须映射到对应 `doc/prd/**` 的需求编号与验收编号。
- `How` 用于定义 fixture、前置条件、输入、执行路径与运行方式；`Oracle` 用于定义必须成立的可断言结果；`Not` 用于定义禁止扩张的范围。
- 正式 live case 的 `How` 不得把待验证的内部实现路径、内部工具顺序、固定 plan 条数或分步剧本直接写进用户输入；这类固定路径验证应放到 `mock-llm` case，由 scripted LLM 输出驱动而不是 fake runtime 节点。
- 正式 `mock-llm` case 只允许替换 LLM 输出；不得 fake tool、store、review、`human` runner 或节点执行结果。
- `tests/unit/**` 用于长期保留、但不进入 `doc/test-plan/**` 正式治理的 unit / helper / schema / prompt 类测试。
- `tests/temp/**` 只用于一次性排查、验证猜想或临时复现；按需创建，不要求常驻。
- 基于 raw logs 更新 report 时，结论顺序必须先区分环境阻塞，再区分 case 设计问题，最后才判断实现问题。
- 如果 PRD 中的功能入口、交互流程、状态反馈或验收口径发生变化，必须先更新对应 `doc/prd/**`，再更新 `doc/test-plan/**` 与测试代码。
- 如果实现行为变更导致正式 case 预期变化，必须先更新对应 `doc/test-plan/**`，再修改测试代码。
- 如果 `tests/**` 非 `temp` 目录里缺少对应正式 case，必须先补 `doc/test-plan/**` 定义，再补测试代码。
- 每个 `用例名称` 都必须稳定映射到唯一 `caseId`、唯一测试文件和唯一日志目录。

### 3.3 实现状态取值约定

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

### 3.4 用例字段定义

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

### 3.5 正式目录层级口径

- `suite`
  - 第一层稳定分类，按领域内最长期稳定的阶段、模块或能力边界划分。
  - 具体取值与归属，只看对应 `doc/test-plan/**`。
- `group`
  - `suite` 下的可选子目录。
  - 只有在同一 `suite` 内确实需要继续分层时才创建，命名必须直接表达业务语义，不再默认使用固定四分组。
- `case`
  - 最终测试文件，对应唯一 `caseId`、唯一日志目录和唯一 report 归属。
- `type`
  - 测试类型只通过文件名体现。
  - 普通测试默认视为 `backend`；文件名包含 `.e2e.test.ts` 时视为 `e2e`。

### 3.6 长期价值与 temp 规则

- 进入正式 domain 目录的 case 默认都应具备长期回归价值。
- `tests/unit/**` 默认具备长期维护价值，但不属于 formal test-plan case。
- 一次性排查、临时验证、待定样例统一放在 `tests/temp/**`。
- `tests/temp/**` 默认不参与 gating，也不进入正式 report。

### 3.7 常见正反例

- 反例：为了排查某个猜想，直接在 `tests/ai/**`、`tests/workbench/**` 或 `tests/settings/**` 新增正式 case。
  - 这类需求如果还没有进入长期维护范围，应先写进 `tests/temp/**`。
- 正例：为了确认某个上下文拼接问题是否真实存在，先写 `tests/temp/**` 做一次性验证。
- 正例：某条真实用户场景已经确定要长期回归，先补对应 `doc/test-plan/**`，再补正式测试代码。
- 正例：某个 helper / schema / prompt 需要长期回归，但不属于 formal 业务 case，放进 `tests/unit/**`。

## 4. 正式测试闭环流程

### 4.1 固定顺序

1. 先判断这是正式长期回归 case，还是临时排查 case。
2. 如果只是临时排查，直接写入 `tests/temp/**`，不进入正式闭环。
3. 如果要进入正式目录，先更新对应 `doc/test-plan/**`。
4. 再写或调整 `tests/**` 中的正式测试代码。
5. 通过 `scripts/test-workflow.mjs` 执行并产生日志。
6. 先看 `timeline.jsonl`，不足时再看 `runtime-events.jsonl`、`meta.json` 与 `artifacts.json`。
7. 最后基于 `tests/logs/<domain>/**` 更新 `tests/report/<domain>/report.md`。

### 4.2 放入测试目录

- 正式 case 固定放在 `tests/<domain>/<suite>/<groups...>/<case>.test.ts`。
- e2e case 固定放在 `tests/<domain>/<suite>/<groups...>/<case>.e2e.test.ts`。
- 长期非 formal 的 unit 测试固定放在 `tests/unit/**`。
- 临时 case 固定放在 `tests/temp/**`。
- 未在 `doc/test-plan/**` 登记的验证，不得进入正式测试目录。
- 临时 case 转正式 case 时，先补 `doc/test-plan/**`，再迁入正式目录。

### 4.3 执行与产生日志

- 测试统一通过 `scripts/test-workflow.mjs` 执行。
- runner 只负责收集测试文件、执行测试并落 `tests/logs/**`。
- 不带 `--type` 时，runner 会先执行普通测试，再执行 `.e2e.test.ts`；带 `--type backend` 或 `--type e2e` 时，只执行对应类型；除此之外不负责失败分析、建议整理或 report 更新。

### 4.4 读取与分析 raw logs

- 默认先读取目标 run 的 `timeline.jsonl`，理解语义步骤、断言事实和失败位置。
- 如果 `timeline.jsonl` 仍不足以解释结果，再继续读取 `runtime-events.jsonl` 与关键附件。
- 必要时回看 `meta.json` 与 `artifacts.json`，确认 run 摘要、统计值和附件索引。
- 所有分析结论都必须可回溯到 raw logs 与 artifacts，不得脱离证据做推断。

### 4.5 更新正式 report

- 正式 report 固定更新 `tests/report/<domain>/report.md`。
- report 只能基于 `tests/logs/<domain>/**` 及其附件生成；`tests/temp/**` 不进入正式 report。
- report 负责沉淀当前现状分析、失败模式和下一步建议，但不能替代 raw logs 本身。

### 4.6 结论回流

- 如果问题出在 case 定义、验收口径或阶段边界，必须先改 `doc/test-plan/**`，再改测试代码。
- 如果只是实现缺陷或回归问题，可在保持 case 规格不变的前提下修实现并重跑。
- report 中已有结论若被新 run 推翻，应以最新 raw logs 重新分析并更新，不保留无证据的旧判断。

## 5. runner 与命令

统一入口默认是 `scripts/test-workflow.mjs`。

当前命令面：

- `pnpm test:ai`
- `pnpm test:ai:backend`
- `pnpm test:ai:tool`
- `pnpm test:ai:human:mock-llm`
- `pnpm test:ai:human:live`
- `pnpm test:ai:director:mock-llm`
- `pnpm test:ai:director:live`
- `pnpm test:unit`
- `pnpm test:unit:ai`
- `pnpm test:workbench`
- `pnpm test:workbench:backend`
- `pnpm test:workbench:e2e`
- `pnpm test:settings`
- `pnpm test:settings:backend`
- `pnpm test:settings:e2e`

runner 支持的过滤参数：

- `--domain`
- `--type`
- `--suite`
- `--group`，可重复传入
- `--case`
- `--runs`

补充规则：

- 不带 `--type` 时，runner 会先收集普通测试，再收集 `.e2e.test.ts`。
- `--type` 取值为 `backend` 或 `e2e`。
- 如果需要继续收窄到某个 `suite`、`group` 或单条 `case`，统一通过 runner 参数过滤，不额外在本文展开具体模块命令。
- `--group` 只在目标 `suite` 确实存在额外子目录时使用；如果 case 直接位于 `suite` 根目录，则不需要 `--group`。

runner 的职责只有三件事：

1. 找到目标测试文件并执行。
2. 落原始日志到 `tests/logs/**`。
3. 在不带 `--type` 时按“普通测试 -> e2e”顺序执行。

runner 不负责：

- 写事实汇总稿
- 写失败原因分析
- 写优化建议
- 更新正式 `report.md`

## 6. 原始日志契约

每个 run 固定目录：

```text
tests/logs/<domain>/<suite>/<groups...>/<caseId>/<runId>/
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

- `<domain>/<suite>/<groups...>`
  - 目录层级体现业务域与 suite 树。
  - 当前 runner 通过目录过滤测试范围。
- `<caseId>`
  - 对应用例稳定标识。
  - 通常与测试文件名去掉 `.test.ts` 后一致；e2e case 通常以 `.e2e` 结尾。
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
  - 格式为 `<domain>/<suite>/<groups...>`，不包含 `caseId`。
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
- 普通测试与 e2e 的采集路径可以不同，但最终落盘契约必须一致。
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

### 不同测试类型的统一约束

- 普通测试与 e2e 共用同一份 `meta.json` / `timeline.jsonl` / `runtime-events.jsonl` / `artifacts.json` 基础契约。
- 两类测试的差异只体现在：
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
- 按 suite / groups 展开
- 每个 suite / groups 节点按需要继续下钻
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
- `总览` 之后按 domain 下实际存在的 suite 展开。
- suite 之下按目录树继续展开：
  - suite 使用 `##`
  - suite 下第一层 group 使用 `###`
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
# Workbench 域测试报告

## 总览

### 分析范围

- raw logs 范围: 当前仓库内 `tests/logs/workbench/**`
- 已分析 scope: `workbench/<suite-a>`、`workbench/<suite-b>`

### 总体结论

- 历史总数据: `2` 次 raw runs，其中 `2` 次 passed、`0` 次 failed，historicalSuccessRate=`100.0%`
- 最新总数据: `2 / 2` 个 case 的最新一轮 run 为 passed，latestSuccessRate=`100.0%`
- 当前结论: 当前已覆盖一个普通样例和一个 e2e smoke，但剩余 suite 仍待补齐。

### 下一阶段建议

- 先补 `suite-a` 的边界收敛
- 再补 `suite-b` 的主线闭环

## <suite-a>

### 证据

- `workbench-suite-a-basic` | type=`backend` | run=`20260315-101530-112` | status=`passed`

### 通过率

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

### 失败分析

- 当前没有 failed run，因此无法给出失败模式结论。

### 当前评估

- suite-a 的基础路径已稳定产出 raw logs。
- 当前不足是边界场景覆盖仍不足。

### 下一步建议

- 增加 `workbench-suite-a-edge-1`
- 增加 `workbench-suite-a-edge-2`

## <suite-b>

### 证据

- `workbench-suite-b-smoke.e2e` | type=`e2e` | run=`20260315-103002-008` | status=`passed`
- 关键附件: playwright trace

### 通过率

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

### 失败分析

- 当前没有 failed run，因此无法给出失败模式结论。

### 当前评估

- suite-b 的 e2e smoke 主链路已可用。
- 当前不足是剩余验收分支仍未纳入。

### 下一步建议

- 补充 `suite-b` 的验收分支 1
- 补充 `suite-b` 的验收分支 2
```

约束：

- report 只引用 raw logs 与 artifacts 作为证据来源。
- report 可以做分析与建议，但不得写入没有日志依据的推断。

## 8. 明确禁止

- 测试样例直接输出失败原因分析。
- runner 自动调用测试所用 AI 模型生成 report。
- report 写入没有日志依据的推断。
- 为单个 runner 或单种工具单独再设计一套平行 raw log 契约。
