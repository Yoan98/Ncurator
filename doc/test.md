# NCurator-Desktop 测试架构

## 1. 文档定位

- 本文是 NCurator-Desktop 的唯一测试总规范。
- 各业务域的 suite、case 和领域规则只在对应 `doc/test-plan/**` 中维护，本文不重复登记 case。
- `ai-test` 专门覆盖 AI 架构及其工具，全部是 backend；`knowledge-test` 专门覆盖知识库基础设施（嵌入、索引调度、存储与检索基建），当前以 unit 为主；`settings-test` 和 `workbench-test` 专门覆盖对应 PRD 功能点，全部是 E2E；Unit 只补足前述范围未覆盖的 backend 函数、类和底层逻辑；`showcase` 是独立官网样例采集，不进入领域测试计划。

测试体系只沉淀一层长期执行产物：

- 原始日志：`tests/logs/**`

测试样例只记录事实，不直接写失败原因分析、优化建议或能力判断。

## 2. 测试体系总览

### 2.1 测试分类

- 测试用例
  - 列入 `doc/test-plan/**`，放在 `tests/case/<domain>/<suite>/**`。
  - 用于长期维护、批量执行和生成可追溯运行产物。
- `unit`
  - 放在 `tests/case/unit/**`。
  - 全部是 backend 单元测试，不允许导入 Renderer、React、jsdom 或 Electron UI。
  - 默认不进入 `doc/test-plan/**`，由 unit runner 独立发现和执行。
  - `knowledge-test` 是例外：知识库 unit 登记在该计划中，代码仍放 `tests/case/unit/knowledge/**`。
- `showcase`
  - 放在 `tests/case/showcase/**`，文件后缀 `.showcase.test.ts`。
  - 独立官网样例采集，走真实 E2E 链路，用 `pnpm test:showcase` 单独执行。
  - 这个是大概率不维护的，需要用也只会单独执行，基本忽略即可。
- 不落测试文件的排查不属于测试文档治理对象；新增测试文件前必须先确认归入 AI、Knowledge、Settings、Workbench、Showcase 或 Unit。

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
    showcase/
  logs/
```

规则：

- 目录使用 kebab-case。
- 正式测试发现目录使用通用树形结构：`tests/case/<domain>/<suite>/<groups...>/<case>.test.ts`。
- 正式 E2E 测试文件使用 `tests/case/<domain>/<suite>/<groups...>/<case>.e2e.test.ts`。
- `suite` 是第一层稳定分类；`groups...` 是 suite 下可选的子目录。
- 各测试 domain 的 `suite` 列表与归属，只在对应 `doc/test-plan/**` 中定义。
- 当某个 `suite` 不需要继续细分时，测试 case 可以直接放在该 `suite` 目录下。
- `tests/case/{ai,settings,unit,workbench,showcase}/**` 只允许放已在 `doc/test-plan/**` 登记的正式测试 case。`showcase` 不进入测试计划；`unit` 除 `knowledge/` 外不进入测试计划，`knowledge-test` 登记 `tests/case/unit/knowledge/**`。
- `tests/fixtures/workspace/` 是共享工作区 fixture 根目录；凡是依赖“工作区里有什么文件”的测试，以及 backend/unit 直接引用的固定文件输入，统一复用该目录。
- `tests/fixtures/sqlite/` 放数据库迁移 fixture。
- `tests/fixtures/**` 全部是只读测试输入：测试禁止对其中任何文件原地写入、覆盖或修改；需要写入时，必须通过 `fixtures: []` 声明由 runner/harness 复制到隔离临时 workspace（或按 E2E 规则复制到临时目录），测完删除。fixture 需要更新时直接提交新二进制，禁止引入任何 fixture 生成器脚本（生成器不得以 `.test.ts` 形态进入 `tests/case/**` 自动发现）。
- 当 case 直接传入 `tests/fixtures/workspace` 目录时，runner 应把该目录下的子内容原样复制到临时 workspace 根目录，而不是保留 `tests/fixtures/**` 中间层路径。

### 2.3 稳定映射模型

测试按 `domain / suite / groups... / caseId` 映射到目录和日志；普通 `.test.ts` 为 backend，`.e2e.test.ts` 为 E2E，`.showcase.test.ts` 为独立样例采集。固定边界为：`ai`、`unit` 只能是 backend，`settings`、`workbench` 只能是 E2E。

## 3. 测试用例规则

### 3.1 准入规则

- 新增任何测试文件前，必须先与用户确认目标分类。
- `doc/test-plan/**` 是测试 case 的唯一规格来源；新增、修改或补齐测试 case 时，必须先更新对应测试计划，再修改测试代码。
- `tests/case/<domain>/**` 只能放已登记的测试 case；`tests/case/unit/**` 默认不进入领域测试计划，但仍必须满足 Unit backend 边界。`tests/case/unit/knowledge/**` 由 `knowledge-test` 登记。
- 每个测试 `caseId` 都必须稳定映射到唯一测试定义与唯一日志目录。一个测试文件可以承载多个紧密相关的 case，但 `--case <caseId>` 必须能只执行目标 case。

### 3.2 测试 case 共享字段

测试 case 在 `doc/test-plan/**` 中统一使用以下字段：

- `测试类型`
  - `backend` 或 `e2e`；需要时以 ` / ` 追加执行方式，如 `backend / live`、`e2e / live`、`e2e / exclusive`。
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

### 3.3 UI E2E 测试规则

- UI E2E 必须通过真实 UI 和产品链路完成被测行为；禁止 fake、mock、stub、直接写状态或内部写 IPC 绕过。
- fixture 和 helper 只能准备真实输入、执行用户可见操作、等待结果和收集证据，不能替代产品输出。
- Settings / Workbench E2E 默认使用 `serviceMode: real`；仅自动更新、数据库版本恢复等受控状态的 case 可使用 `fixture`，并在对应 `doc/test-plan/**` 说明原因。
- 允许的模拟、种子或受控注入只写在对应 `doc/test-plan/**` case 的 How / Not；新增假数据或模拟路径须先说明必要性、取得用户确认，并写入该 case 所在测试计划。
- observer、只读 IPC 和截图只能收集证据，不能触发被测行为或改变运行结果。
- 产品缺少必要 testability 入口时，应记录缺口，不能改用模拟路径绕过。不为 E2E 增加生产环境变量、故障开关、全局探针或其他生产代码入口；确需修改生产代码时，必须先取得用户确认。

### 3.4 真实 AI / live 断言规则

- live 模型配置（backend `ai/human/live` 与 Workbench AI E2E 共用）与 opt-in 命令只在对应 `doc/test-plan/**` 维护，本文不重复。
- 涉及真实 AI 调用的测试，硬断言只验证完成态、关键事实、关键工具或事件、关键 artifact，以及用户诉求是否落地；最终自然语言回答不得作为主要正确性证据。
- 不对最终文案做逐字断言，不断言固定工具顺序，不断言固定 prompt 原文，不因表达差异判失败。
- 如果用户诉求已落地但断言过严，应先调整 `Oracle` 和测试代码，再根据 raw logs 记录完成度评分。
- 完成度评分由执行者或 agent 写入运行结论；测试代码不得在执行过程中修改文档。

## 4. 测试执行闭环

### 4.1 固定顺序

1. 先确认是否新增或调整测试，以及目标分类。
2. 如果是测试用例，先更新对应 `doc/test-plan/**`，再修改 `tests/case/<domain>/**`。
3. 如果是 Unit，放入 `tests/case/unit/**`，保持 backend-only，不更新测试计划。
4. 通过 `scripts/test/workflow.mjs` 执行并产出日志。
5. 先看 `timeline.jsonl`；不足时再看 `runtime-events.jsonl`、`meta.json` 和 `artifacts.json`。
6. 最后基于 raw logs 回流结论，决定是否需要更新测试计划或实现代码。

### 4.2 runner 与常用命令

统一入口默认是 `scripts/test/workflow.mjs`。

runner 的职责：

1. 找到目标测试文件并执行。
2. 落原始日志到 `tests/logs/**`。
3. 在不带 `--type` 时按“普通测试 -> 源码 E2E”顺序执行。
4. E2E 执行前清理 `tests/.tmp/e2e` 中超过 24 小时未活动的残留 `ncurator-*` 目录，避免异常终止的 run 遗留临时数据。
5. 按 `--target` 准备源码应用，或构建、审计并安装正式包。

runner 不负责：

- 写事实汇总稿。
- 写失败原因分析。
- 写优化建议。

当前常用命令按域收口如下。

- AI
  - `pnpm test:ai:backend`
  - `pnpm test:ai:non-live`
  - `pnpm test:ai:tool`
  - `pnpm test:ai:human:mock-llm`
  - `pnpm test:ai:human:live`
- Unit
  - `pnpm test:unit`
  - `pnpm test:unit:ai`
  - `pnpm test:terminal`：直接 `vitest` 运行终端相关 unit 文件。
- E2E（源码 / 正式包）
  - `pnpm test:e2e:source`：构建当前源码并运行 `tests/case/**` 中的全部 E2E。
  - `pnpm test:e2e:package -- --bundle <release-bundle.json>`：校验并安装已经构建的正式包，再对安装后的可执行程序运行所选正式 E2E。安装落在本机 `NCurator-E2E` 目录；Windows 可能覆盖本机已安装的正式包。测完删除 E2E 安装目录及指向它的入口。
- Settings
  - `pnpm test:settings:e2e`
- Workbench
  - `pnpm test:workbench:e2e`
- Showcase
  - `pnpm test:showcase`：独立执行官网样例采集。
- 更新
  - `pnpm test:update:backend`、`pnpm test:update:e2e`
  - `pnpm test:update:real:win`：Windows 真实覆盖升级测试，独立脚本，不属于 runner。

runner 支持的过滤参数：

- `--domain`
- `--type`
- `--suite`
- `--group`，可重复传入
- `--exclude-group`，可重复传入
- `--case`
- `--runs`
- `--target`，取值为 `source` 或 `package`，默认 `source`。
- `--bundle`，正式包 E2E 必填，指向已构建候选包的 `release-bundle-*.json`。
- `--fresh-knowledge-cache`，删除本次构建对应的知识库缓存，强制从零验证完整索引。
- `--reuse-knowledge-cache`，人工调试时跨构建复用同一类缓存；不能和 `--fresh-knowledge-cache` 同时使用。
- `--showcase`，执行 showcase 采集类别。
- `--result`，showcase/发布流程用的结果输出路径。
- `--help`（或 `-h`），打印 runner 用法后直接退出；传入未识别的参数会立即报错并退出（退出码 2），防止未知参数被静默忽略而误触发全量执行。

补充规则：

- runner 强制执行固定 domain/type 边界。backend 普通测试并发为 6；Source E2E 与正式包 E2E 在多 case 时都先串行执行全仓唯一的 `warmup` 用例（先冷启动索引共享 fixture，后续 case 复用缓存）。Source 的所有 case 直接共享按构建指纹保存的 split/vector 内容缓存，各 case 只隔离统计文件；正式包 E2E 则把缓存种子复制到后续 case 的隔离缓存目录。随后开放总并发 3、live 并发 3，`exclusive` 用例串行独占；某个 case 失败后不自动重跑，继续收集剩余 case；warm-up 失败则不启动后续并发。
- E2E（source 与正式包）即使通过 `--domain`/`--suite`/`--case` 过滤范围，只要本次实际执行的测试文件数超过 1，runner 也会自动把全仓唯一的 `warmup` 用例纳入执行并先串行预热，避免过滤后漏掉 warmup 导致全部 case 冷启动重复索引；`--case` 过滤时 `warmup` 用例不受 `--testNamePattern` 影响。
- E2E 默认执行类型为 `normal`；真实 AI/服务调用声明 `execution: 'live'`，原生对话框、鼠标和桌面焦点用例声明 `execution: 'exclusive'`，唯一的向量冷启动用例声明 `execution: 'warmup'`。
- `source` 是源码目标，直接复用内容缓存；`package` 只接受既有 release bundle，安装后运行所选 E2E，不负责构建。
- native binding、知识库缓存和临时 Electron app 由 runner 自动准备；普通测试不手工修改 `node_modules` 或复用正式包缓存。

### 4.3 读取与分析 raw logs

- 默认先读取目标 run 的 `timeline.jsonl`，理解语义步骤、断言事实和失败位置。
- 如果 `timeline.jsonl` 仍不足以解释结果，再继续读取 `runtime-events.jsonl` 与关键附件。
- 压缩切点先看 `runtime-events.jsonl` 的 `context_compaction_*` 字段；prompt 原文看 `llm-io.jsonl`；伙伴 bookmark 看可选 `artifacts/message-log-annotations.json`。
- 必要时回看 `meta.json` 与 `artifacts.json`，确认 run 摘要、统计值和附件索引。
- 所有分析结论都必须可回溯到 raw logs 与 artifacts，不得脱离证据做推断。

## 5. runner 与原始产物契约

### 5.1 run 目录

每个 run 固定目录：

```text
tests/logs/<domain>/<suite>/<groups...>/<caseId>/<runId>/
  meta.json
  timeline.jsonl
  runtime-events.jsonl
  llm-io.jsonl            # backend
  artifacts.json
  cache-summary.json
  seed-manifest.json
  artifacts/
```

固定原始文件：

- `meta.json`
  - 单次 run 的摘要索引。
  - 用来回答“本次 run 是谁、结果是什么、统计值是什么”。
- `timeline.jsonl`
  - 单次 run 的事实事件流。
  - 用来回答“本次 run 按顺序发生了什么”。
  - `data` 只放按需原始观测值；压缩等长文本回看 `llm-io.jsonl`，不要把整段 prompt 再拷进 assertion `data`。
- `runtime-events.jsonl`
  - 单次 run 的完整运行时原始事件流。
  - 用来回答“底层 runtime 真实发出了哪些事件”。
  - 压缩切点以 `context_compaction_started` / `completed` 上的 `throughSeq`、`firstKeptSeq`、`historyFloorSeq`、`historyFloorKind`、`isSplitTurn`、`foldedCount`、`tailCount` 为准。
- `llm-io.jsonl`
  - backend 额外文件，e2e 不要求。
  - 用来回答“发给模型的 conversation / system 实际是什么”。
- `artifacts.json`
  - 单次 run 的附件索引。
  - 用来回答“本次 run 产生了哪些可回看的附件”。
- `artifacts/`
  - 可选目录。
  - 只有确实生成 trace、截图、HTML 诊断页、可选 human bookmark 快照等实体附件时才创建。
- `cache-summary.json`
  - 本次 run 的知识库/向量缓存摘要。
- `seed-manifest.json`
  - 本次 run 的 fixture seed 清单。

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

- `schemaVersion` 固定值为 `5`。
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
  - `fileName`（可选）
  - `capability`（可选）

关键约束：

- `schemaVersion` 固定值为 `5`。
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
- human live 可按 case 选择写出 `artifacts/message-log-annotations.json`（`kind=other`）：只含 `compaction_checkpoint` 的 seq、`throughSeq`、`compactBlockId` 与摘要长度，不含摘要全文。默认关闭。

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
