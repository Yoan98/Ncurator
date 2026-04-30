# NCurator-Desktop 测试架构

## 1. 文档定位

- 本文是 NCurator-Desktop 的唯一测试总规范。
- 本文负责定义测试体系总览、正式 case 准入、正式测试闭环、runner 与 raw logs 契约。
- 各业务域的 suite 列表、正式 case 定义与领域特有规则，只在对应 `doc/test-plan/**` 中维护，本文不重复登记 case 清单。
- 只有当功能代码发生变动、对应 `doc/test-plan/**` 明确要求对齐 `doc/prd/**`，或者 `doc/prd/**` 本身发生变更时，才需要校验实现与 `doc/prd/**` 的一致性。
- 如果只记一件事：写测试前先判断这是正式长期回归 case，还是一次性临时排查 case。

正式测试体系只沉淀一层长期产物：

- 原始日志：`tests/logs/**`

正式测试样例只记录事实，不直接写失败原因分析、优化建议或能力判断。

## 2. 测试体系总览

### 2.1 正式 case 与临时 case

- 正式长期回归 case
  - 用于长期维护、参与 gating。
  - 必须进入正式测试闭环。
- 临时排查 case
  - 只用于一次性排查、验证猜想、临时复现或补上下文。
  - 固定放在 `tests/temp/**`。
- 默认策略
  - 用户没有明确要求“补正式长期 case”时，默认先写 `tests/temp/**`。
  - 只要还在排查、验证猜想、试运行 fixture 或尚未确定要长期维护，一律先放 `tests/temp/**`。
  - 只有确认要长期维护、参与 gating 的 case，才进入正式测试目录。

### 2.2 目录结构

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
```

规则：

- 目录统一使用 kebab-case。
- 测试发现目录使用通用树形结构：`tests/<domain>/<suite>/<groups...>/<case>.test.ts`。
- e2e 测试文件使用 `tests/<domain>/<suite>/<groups...>/<case>.e2e.test.ts`。
- `suite` 是第一层稳定分类；`groups...` 是 suite 下可选的任意深度子目录。
- 各 domain 的 `suite` 列表与归属，只在对应 `doc/test-plan/**` 中定义。
- 当某个 `suite` 不需要继续细分时，正式 case 可以直接放在该 `suite` 目录下。
- `tests/unit/**` 用于长期保留、但不进入 `doc/test-plan/**` 正式治理的 unit / helper / schema / prompt 类测试。
- `tests/temp/**` 默认不参与 gating，也不沉淀正式长期产物。
- 除 `tests/temp/**` 外，`tests/**` 中的正式测试目录只允许放已在 `doc/test-plan/**` 登记的 case。
- `tests/fixtures/workspace/` 是共享工作区 fixture 根目录；凡是依赖“工作区里有什么文件”的测试，优先复用该目录。
- 当 case 直接传入 `tests/fixtures/workspace` 目录时，runner 应把该目录下的子内容原样复制到临时 workspace 根目录，而不是保留 `tests/fixtures/**` 中间层路径。

### 2.3 稳定映射模型

- `domain`
  - 稳定业务域，例如 `ai`、`workbench`、`settings`。
- `suite`
  - 领域内第一层稳定分类。
  - 具体取值与归属只看对应 `doc/test-plan/**`。
- `group`
  - `suite` 下可选子目录。
  - 只有同一 `suite` 内确实需要继续分层时才创建。
- `case`
  - 最终测试文件，对应唯一 `caseId` 与唯一日志目录。
- `type`
  - 测试类型只通过文件名体现。
  - 普通测试默认视为 `backend`；文件名包含 `.e2e.test.ts` 时视为 `e2e`。

## 3. 正式 case 规则

### 3.1 准入规则

- `doc/test-plan/**` 下每个领域文档，都是该领域正式测试用例定义的唯一规格来源。
- 新增、修改或补齐正式 case 时，必须先更新对应 `doc/test-plan/**`，再修改测试代码。
- 未登记的 case 不得直接写进 `tests/**` 非 `temp` 目录。
- 当临时 case 需要转为正式长期 case 时，顺序必须是：先补 `doc/test-plan/**`，再迁入正式目录。
- 如果实现行为变更导致正式 case 预期变化，必须先更新对应 `doc/test-plan/**`，再修改测试代码。
- 每个正式 `caseId` 都必须稳定映射到唯一测试文件与唯一日志目录。

### 3.2 正式 case 共享字段

正式 case 在 `doc/test-plan/**` 中统一使用以下字段：

- `测试类型`
  - `backend` 或 `e2e`。
- `实现状态`
  - 标记当前代码实现与文档定义的匹配状态。
- `What`
  - 这条 case 到底要验证什么。
- `Why`
  - 这条 case 为什么长期存在，解决什么真实风险。
- `How`
  - 输入、前置条件、fixture、运行方式与关键执行链路。
- `Oracle`
  - 必须成立的明确断言集合。
- `Not`
  - 明确不验证什么，防止实现时擅自扩张范围。
- `Last Run`
  - 记录最近一次实际执行完成时间，建议使用 `YYYY-MM-DD HH:mm:ss ±HH:mm`。
- `Last Result`
  - 只写 `通过` 或 `未通过`；如是批量执行，可在括号内补充覆盖范围。

- 如存在 suite 级批量执行记录
  - 可在对应 suite 小节额外保留汇总通过情况。

补充约束：

- 正式 live case 的 `How` 不得把待验证的内部实现路径、内部工具顺序、固定 plan 条数或分步剧本直接写进用户输入。
- 这类固定路径验证应放到 `mock-llm` case，由 scripted LLM 输出驱动，而不是 fake runtime 节点。
- 正式 `mock-llm` case 只允许替换 LLM 输出；不得 fake tool、store、review、runner 或节点执行结果。

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

### 3.4 长期价值与常见误区

- 进入正式 domain 目录的 case 默认都应具备长期回归价值。
- `tests/unit/**` 默认具备长期维护价值，但不属于 formal test-plan case。
- 一次性排查、临时验证、待定样例统一放在 `tests/temp/**`。

常见反例：

- 为了排查某个猜想，直接在 `tests/ai/**` 或 `tests/settings/**` 新增正式 case。
- 还没补 `doc/test-plan/**`，就先写正式测试代码。
- 正式 case 的 `How` 开始直接描述内部 route、内部工具顺序或固定 plan 条数。

常见正例：

- 为了确认某个上下文拼接问题是否真实存在，先写 `tests/temp/**` 做一次性验证。
- 某条真实用户场景已经确定要长期回归，先补对应 `doc/test-plan/**`，再补正式测试代码。
- 某个 helper / schema / prompt 需要长期回归，但不属于 formal 业务 case，放进 `tests/unit/**`。

## 4. 正式测试闭环

### 4.1 固定顺序

1. 先判断这是正式长期回归 case，还是临时排查 case。
2. 如果只是临时排查，直接写入 `tests/temp/**`，不进入正式闭环。
3. 如果要进入正式目录，先更新对应 `doc/test-plan/**`。
4. 再写或调整 `tests/**` 中的正式测试代码。
5. 通过 `scripts/test-workflow.mjs` 执行并产生日志。
6. 先看 `timeline.jsonl`，不足时再看 `runtime-events.jsonl`、`meta.json` 与 `artifacts.json`。
7. 最后基于 raw logs 回流结论，决定是否需要更新 `doc/test-plan/**` 或实现代码。

### 4.2 runner 与常用命令

统一入口默认是 `scripts/test-workflow.mjs`。

runner 的职责只有三件事：

1. 找到目标测试文件并执行。
2. 落原始日志到 `tests/logs/**`。
3. 在不带 `--type` 时按“普通测试 -> e2e”顺序执行。

runner 不负责：

- 写事实汇总稿。
- 写失败原因分析。
- 写优化建议。

当前常用命令按域收口如下。`workbench` 不再维护 formal test-plan，对应验证改走 hand-test，不再提供 `test:workbench*` runner。

- AI
  - `pnpm test:ai`
  - `pnpm test:ai:backend`
  - `pnpm test:ai:tool`
  - `pnpm test:ai:human:mock-llm`
  - `pnpm test:ai:human:live`
- Unit
  - `pnpm test:unit`
  - `pnpm test:unit:ai`
- Settings
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
- 如果需要继续收窄到某个 `suite`、`group` 或单条 `case`，统一通过 runner 参数过滤。
- `--group` 只在目标 `suite` 确实存在额外子目录时使用；如果 case 直接位于 `suite` 根目录，则不需要 `--group`。

### 4.3 读取与分析 raw logs

- 默认先读取目标 run 的 `timeline.jsonl`，理解语义步骤、断言事实和失败位置。
- 如果 `timeline.jsonl` 仍不足以解释结果，再继续读取 `runtime-events.jsonl` 与关键附件。
- 必要时回看 `meta.json` 与 `artifacts.json`，确认 run 摘要、统计值和附件索引。
- 所有分析结论都必须可回溯到 raw logs 与 artifacts，不得脱离证据做推断。

### 4.4 结论回流

- 如果问题出在 case 定义、验收口径或阶段边界，必须先改 `doc/test-plan/**`，再改测试代码。
- 如果只是实现缺陷或回归问题，可在保持 case 规格不变的前提下修实现并重跑。
- 任何分析结论若被新 run 推翻，都应以最新 raw logs 重新分析，不保留无证据的旧判断。

## 5. runner 与原始产物契约

### 5.1 run 目录

每个 run 固定目录：

```text
tests/logs/<domain>/<suite>/<groups...>/<caseId>/<runId>/
  meta.json
  timeline.jsonl
  runtime-events.jsonl
  artifacts.json
  artifacts/
```

固定原始文件：

- `meta.json`
  - 单次 run 的摘要索引。
  - 用来回答“本次 run 是谁、结果是什么、统计值是什么”。
- `timeline.jsonl`
  - 单次 run 的事实事件流。
  - 用来回答“本次 run 按顺序发生了什么”。
- `runtime-events.jsonl`
  - 单次 run 的完整运行时原始事件流。
  - 用来回答“底层 runtime 真实发出了哪些事件”。
- `artifacts.json`
  - 单次 run 的附件索引。
  - 用来回答“本次 run 产生了哪些可回看的附件”。
- `artifacts/`
  - 可选目录。
  - 只有确实生成 trace、截图、HTML 诊断页等实体附件时才创建。

目录与命名规则：

- `<domain>/<suite>/<groups...>`
  - 目录层级体现业务域与 suite 树。
  - runner 通过目录过滤测试范围。
- `<caseId>`
  - 对应用例稳定标识。
  - 通常与测试文件名去掉 `.test.ts` 后一致；e2e case 通常以 `.e2e` 结尾。
- `<runId>`
  - 单次执行唯一标识。
  - 当前格式：`YYYYMMDD-HHmmss-SSS`。
- backend 正式 case 运行开始后，runner 应尽快创建对应 run 目录，并对 `timeline.jsonl / runtime-events.jsonl / llm-io.jsonl` 采用渐进式落盘；不得要求等到 run 结束后才首次出现日志目录。
- backend raw logs 的完整记录以磁盘上的 JSONL 文件为唯一真相源；测试进程内允许不再长期保留这些日志的全量副本。

### 5.2 `meta.json`

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

关键约束：

- `schemaVersion` 固定值为 `4`。
- `scope` 格式为 `<domain>/<suite>/<groups...>`，不包含 `caseId`。
- `status` 当前值域是 `passed` / `failed`。
- backend run 在执行中允许临时写出 `running`；正式结束后必须收口为 `passed` 或 `failed`。
- `stats` 当前固定字段：
  - `durationMs`
  - `steps`
  - `assertions`
  - `errors`
  - `artifacts`
- `runtime` 当前固定字段：
  - `driver`
  - `target`
  - `modelName`
- `meta.json` 顶层只保留上述固定字段。
- 如果测试需要保留 fixture 依赖信息，应写在 `timeline.jsonl` 的 `run/start` 事件 `data` 中。
- 为降低长 live run 的内存压力，`stats` 可以来自运行中计数器或基于磁盘日志的回读统计；不要求依赖内存里的全量 timeline 副本。

### 5.3 `timeline.jsonl`

固定字段：

- `ts`
- `type`
- `name`
- `status`
- `id`
- `message`
- `data`

字段规则：

- `type` 当前值域：
  - `run`
  - `step`
  - `assertion`
  - `artifact`
  - `signal`
  - `error`
- `status` 当前值域：
  - `info`
  - `ok`
  - `failed`
  - `skipped`
- `message` 只写“发生了什么”，不写失败原因、优化建议或能力判断。
- `data` 只放按需原始观测值，不要求统一业务 schema。

约束：

- `timeline.jsonl` 只记录高价值语义事件，不记录底层噪音。
- `signal` 用于记录可观察到的外部信号，例如路由变化、IPC 调用、AI 事件。
- 当失败事件存在明确证据时，优先把证据放进 `data` 或 artifact，不要在 `message` 中写大段解释。
- e2e 下不把所有 Playwright 底层调用逐条倾倒进 timeline；底层重放依赖 `trace.zip`，timeline 只保留语义 step / assertion / signal。
- `run` 之外的业务状态不要塞进 `timeline.status`。
  - 例如 `blocked`、`completed`、`cancelled` 应保留在 `runtime-events.jsonl` 或写进 `data`。

### 5.4 `runtime-events.jsonl`

- 文件内容是逐行原始运行时事件 JSON，不包额外 wrapper，不做 schema 投影。
- 范围固定为完整 runtime 原始事件流。
- 普通测试与 e2e 的采集路径可以不同，但最终落盘契约必须一致。
- `runtime-events.jsonl` 始终写出；如果本次 run 没有 runtime 事件，则写空文件。
- 当 `Oracle`、断言 `data` 或 `timeline.jsonl` 仍不足以解释失败原因时，必须继续回看 `runtime-events.jsonl`。

### 5.5 `artifacts.json`

固定字段：

- 顶层：
  - `schemaVersion`
  - `items`
- `items` 每项固定字段：
  - `id`
  - `kind`
  - `path`
  - `refs`

关键约束：

- `schemaVersion` 固定值为 `4`。
- `kind` 当前值域：
  - `trace`
  - `screenshot`
  - `video`
  - `playwright-report`
  - `jsonl`
  - `other`
- `path` 是相对当前 run 根目录的稳定路径。
- `refs` 当前支持：
  - `stepId`
  - `assertionId`
- `artifacts.json` 必须始终写出，即使 `items` 为空数组。
- `artifacts/` 目录只有在确实存在实体附件文件时才创建。

### 5.6 不同测试类型的统一约束

- 普通测试与 e2e 共用同一份 `meta.json` / `timeline.jsonl` / `runtime-events.jsonl` / `artifacts.json` 基础契约。
- 两类测试的差异只体现在：
  - `meta.runtime.driver`
  - `meta.runtime.target`
  - `artifacts.json.items[].kind`
  - `runtime-events.jsonl` 的采集路径
  - `timeline.jsonl` 中出现的语义事件名与信号类型

### 5.7 e2e 默认附件策略

- 成功 run：
  - 始终保留 Playwright trace。
  - 只有测试或 runtime 显式要求保留的关键截图才写入。
  - 默认不生成 Playwright HTML 诊断页。
- 失败 run：
  - 始终保留 Playwright trace。
  - 始终生成失败截图，并通过 `refs.assertionId` 或 `refs.stepId` 绑定。
  - 生成位于 `artifacts/playwright/report/index.html` 的 HTML 诊断页。
- 默认不保留 video。

## 6. 明确禁止与常见误区

明确禁止：

- 测试样例直接输出失败原因分析。
- 脱离 raw logs 与 artifacts 写入没有证据依据的分析结论。
- 为单个 runner 或单种工具单独再设计一套平行 raw log 契约。

常见误区：

- 把 `tests/unit/**` 当成 formal domain case 管理。
- 把 `tests/temp/**` 的结果直接当成正式长期结论。
- 在 `timeline.jsonl` 中倾倒底层噪音，而不是保留高价值语义事件。
- 在没有更新 `doc/test-plan/**` 的情况下直接修改正式 case 预期。
