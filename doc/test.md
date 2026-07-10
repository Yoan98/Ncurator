# NCurator-Desktop 测试架构

## 1. 文档定位

- 本文是 NCurator-Desktop 的唯一测试总规范。
- 本文负责定义测试分类、回归测试准入、测试执行闭环、UI E2E 真实性、真实 AI / live 断言、runner 与 raw logs 契约。
- 各业务域的 suite 列表、回归 case 定义与领域特有规则，只在对应 `doc/test-plan/**` 中维护，本文不重复登记 case 清单。
- 只有当功能代码发生变动、对应 `doc/test-plan/**` 明确要求对齐 `doc/prd/**`，或者 `doc/prd/**` 本身发生变更时，才需要校验实现与 `doc/prd/**` 的一致性。
- 新增任何测试文件前，必须先与用户确认目标分类：回归测试，或 `unit / 辅助测试`。

测试体系只沉淀一层长期执行产物：

- 原始日志：`tests/logs/**`

测试样例只记录事实，不直接写失败原因分析、优化建议或能力判断。

## 2. 测试体系总览

### 2.1 测试分类

- 回归测试
  - 列入 `doc/test-plan/**`，放在 `tests/case/<domain>/<suite>/**`。
  - 用于长期维护、批量执行和执行摘要统计。
- `unit / 辅助测试`
  - 放在 `tests/case/unit/**`。
  - 不进入 `doc/test-plan/**`，不计入领域回归执行摘要。
- 不落测试文件的排查不作为测试文档治理对象；一旦要新增测试文件，必须先与用户确认归入回归测试还是 `unit / 辅助测试`。

### 2.2 目录结构

```text
tests/
  harness/
  fixtures/
  case/
    ai/
    unit/
    settings/
    workbench/
    kb-search/
  logs/
```

规则：

- 目录统一使用 kebab-case。
- 测试发现目录使用通用树形结构：`tests/case/<domain>/<suite>/<groups...>/<case>.test.ts`。
- e2e 测试文件使用 `tests/case/<domain>/<suite>/<groups...>/<case>.e2e.test.ts`。
- `suite` 是第一层稳定分类；`groups...` 是 suite 下可选的任意深度子目录。
- 各 domain 的 `suite` 列表与归属，只在对应 `doc/test-plan/**` 中定义。
- 当某个 `suite` 不需要继续细分时，回归 case 可以直接放在该 `suite` 目录下。
- `tests/case/**` 中除 `unit/**` 外，只允许放已在 `doc/test-plan/**` 登记的回归 case。
- `tests/fixtures/workspace/` 是共享工作区 fixture 根目录；凡是依赖“工作区里有什么文件”的测试，优先复用该目录。
- 当 case 直接传入 `tests/fixtures/workspace` 目录时，runner 应把该目录下的子内容原样复制到临时 workspace 根目录，而不是保留 `tests/fixtures/**` 中间层路径。

### 2.3 稳定映射模型

- `domain`
  - 稳定业务域，例如 `ai`、`settings`、`workbench`、`kb-search`。
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

## 3. 回归 case 规则

### 3.1 准入规则

- 新增任何测试文件前，必须先与用户确认目标分类。
- `doc/test-plan/**` 是回归 case 的唯一规格来源；新增、修改或补齐回归 case 时，必须先更新对应测试计划，再修改测试代码。
- `tests/case/<domain>/**` 只能放已登记的回归 case；`tests/case/unit/**` 不进入回归计划和领域执行摘要。
- 每个回归 `caseId` 都必须稳定映射到唯一测试文件与唯一日志目录。

### 3.2 回归 case 共享字段

回归 case 在 `doc/test-plan/**` 中统一使用以下字段：

- `测试类型`
  - `backend` 或 `e2e`。
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

对应 `doc/test-plan/**` 文档顶部应单独维护一块“执行摘要”区域，统一记录批量执行事实：

- `通过率`
  - 使用 `通过数 / 总数` 表示；按该领域定义的 suite 或稳定分类汇总。
- `检测时间`
  - 记录该 suite 或分类最近一次完整执行完成时间，建议使用 `YYYY-MM-DD HH:mm:ss ±HH:mm`。

- 执行摘要只保留当前有效结论，不记录迁移历史、排查过程或旧实现解释。
- 每次回归 case 执行完成后，如果该次结果要作为当前有效测试结论，必须主动更新对应 `doc/test-plan/**` 顶部“执行摘要”中的通过率、检测时间、以及该领域明确要求维护的附加摘要信息。
- `mock-llm` 回归 case 只允许替换 LLM 输出；不得 fake tool、store、docx apply service、runner 或节点执行结果。

### 3.3 UI E2E 回归规则

- UI e2e 回归测试的目标是验证真实用户路径：通过可见 UI、Electron、IPC、文件系统、网络与后端服务完成操作。
- 测试准备只允许创建真实输入数据，例如真实文件、真实 docx、真实 PDF、真实工作区目录、真实本地 HTTP 页面或真实网页 URL；不得用 fixture 直接替代产品运行结果。
- `tests/fixtures/**` 只能作为真实输入数据来源，不得作为搜索结果、AI 事件、artifact、docx 修改记录、模型返回或 renderer 状态的替身。
- UI e2e 回归测试禁止使用 fake / mock / stub 替代被测产品结果，包括 fake model、fake search、fake docx、脚本化 AI 事件、脚本化 artifact、直接写 renderer 状态、直接写业务 store 或直接调用内部 IPC 来绕过用户可见操作。
- 正式 UI e2e 禁止使用 `setE2EApiOverrides`、preload override、直接 `window.api.*` 创建业务状态、直接写 store、假下载进度、假搜索结果、假 AI 事件或假附件选择结果。
- 测试 helper 可以做用户同等可见的点击、输入、选择、等待、截图、读取 raw logs 和读取输出文件；不得在被测行为上替代 UI、Electron 或后端真实实现。
- 测试 helper 可以创建真实输入，例如临时目录、真实文件、本地 HTTP 服务、剪贴板文件、原生目录选择自动化；这些输入必须再通过 UI 或产品真实处理链路进入系统。
- 涉及真实 AI 调用的 UI e2e 必须使用测试计划声明的 live 环境变量或真实应用配置；缺少配置时必须 preflight fail，不得静默跳过，也不得回落到 mock LLM。
- 如果某个 UI e2e 回归测试需要生产代码或 testability 入口才能继续，测试实现不得改用模拟路径绕过；应把缺口记录到对应 `doc/test-plan/**` 的执行摘要和最终结论，交给产品 / 生产实现决策。
- 依赖上述禁止路径的旧 case，不能继续作为有效回归通过结论；必须改为真实用户路径，或在执行摘要中明确不计入有效通过。

### 3.4 真实 AI / live 断言规则

- 涉及真实 AI 调用的回归测试，硬断言只验证最低工程契约：完成态、关键事实、关键工具或事件、关键 artifact、用户诉求是否真实落地。
- 不对最终文案做逐字断言，不断言固定工具顺序，不断言固定 prompt 原文，不因表达差异判失败。
- 如果用户诉求已经落地但硬断言过严导致失败，应优先调整 `Oracle` 和测试代码，再基于 raw logs 更新执行摘要与完成度评分。
- 完成度评分由执行者或 agent 基于 raw logs 回流到测试计划；测试代码不得在执行过程中隐式修改文档。

## 4. 测试执行闭环

### 4.1 固定顺序

1. 先与用户确认是否新增或调整测试，以及目标分类。
2. 如果是回归测试，先更新对应 `doc/test-plan/**`，再修改 `tests/case/<domain>/**`。
3. 如果是 `unit / 辅助测试`，放入 `tests/case/unit/**`，不更新 `doc/test-plan/**`。
4. 通过 `scripts/test-workflow.mjs` 执行并产生日志。
5. 先看 `timeline.jsonl`，不足时再看 `runtime-events.jsonl`、`meta.json` 与 `artifacts.json`。
6. 最后基于 raw logs 回流结论，决定是否需要更新 `doc/test-plan/**` 或实现代码。

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

当前常用命令按域收口如下。

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
- Workbench
  - `pnpm test:workbench`
  - `pnpm test:workbench:backend`
  - `pnpm test:workbench:e2e`
  - `node scripts/test-workflow.mjs --domain workbench`
  - `node scripts/test-workflow.mjs --domain workbench --type backend`
  - `node scripts/test-workflow.mjs --domain workbench --type e2e`

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
- E2E case 通过 runner 按文件串行执行，每个文件独立启动并关闭一个 Electron app；runner 会在相邻 E2E 文件之间默认等待 1 秒，也可通过 `--run-delay-ms` 覆盖，且任一 E2E 文件失败后立即停止后续文件，避免连续原生启动过快导致不稳定。
- E2E runner 直接调用本地 Vitest binary，不经 `pnpm exec`；启动 Vitest 子进程和 harness 启动 Electron 时都会过滤 `npm_*` 环境变量，只保留系统环境与 `NCURATOR_E2E_*` 等项目测试变量，避免 npm lifecycle 变量影响 macOS Electron 原生注册。
- 如果需要继续收窄到某个 `suite`、`group` 或单条 `case`，统一通过 runner 参数过滤。
- `--group` 只在目标 `suite` 确实存在额外子目录时使用；如果 case 直接位于 `suite` 根目录，则不需要 `--group`。
- `better-sqlite3` native 模块需要区分 Node ABI 和 Electron ABI。backend / unit 测试前使用 `pnpm rebuild better-sqlite3`；Electron e2e 前使用 `NCURATOR_REBUILD_NATIVE=1 node scripts/postinstall.mjs`。两个步骤会覆盖同一个 native 文件，完整回归必须按顺序切换。

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
