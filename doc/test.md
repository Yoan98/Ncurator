# NCurator-Desktop 测试架构

## 1. 文档定位

- 本文是 NCurator-Desktop 的唯一测试总规范。
- 本文定义测试分类、回归准入、执行闭环、UI E2E 真实性、真实 AI / live 断言，以及 runner 和 raw logs 契约。
- 各业务域的 suite、case 和领域规则只在对应 `doc/test-plan/**` 中维护，本文不重复登记 case。
- 只有当功能代码发生变动、对应 `doc/test-plan/**` 明确要求对齐 `doc/prd/**`，或者 `doc/prd/**` 本身发生变更时，才需要校验实现与 `doc/prd/**` 的一致性。
- 新增任何测试文件前，必须先与用户确认目标分类：AI、Settings、Workbench 或 Unit。

测试体系只沉淀一层长期执行产物：

- 原始日志：`tests/logs/**`

测试样例只记录事实，不直接写失败原因分析、优化建议或能力判断。

## 2. 测试体系总览

### 2.1 测试分类

- 回归测试
  - 列入 `doc/test-plan/**`，放在 `tests/case/<domain>/<suite>/**`。
  - 用于长期维护、批量执行和生成可追溯运行产物。
- `unit`
  - 放在 `tests/case/unit/**`。
  - 全部是 backend 单元测试，不允许导入 Renderer、React、jsdom 或 Electron UI。
  - 不进入 `doc/test-plan/**`，由 unit runner 独立发现和执行。
- 不落测试文件的排查不属于测试文档治理对象；新增测试文件前必须先确认归入 AI、Settings、Workbench 或 Unit。

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
  logs/
```

规则：

- 目录使用 kebab-case。
- 测试发现目录使用通用树形结构：`tests/case/<domain>/<suite>/<groups...>/<case>.test.ts`。
- e2e 测试文件使用 `tests/case/<domain>/<suite>/<groups...>/<case>.e2e.test.ts`。
- `suite` 是第一层稳定分类；`groups...` 是 suite 下可选的子目录。
- 各 domain 的 `suite` 列表与归属，只在对应 `doc/test-plan/**` 中定义。
- 当某个 `suite` 不需要继续细分时，回归 case 可以直接放在该 `suite` 目录下。
- `tests/case/**` 中除 `unit/**` 外，只允许放已在 `doc/test-plan/**` 登记的回归 case。
- `tests/fixtures/workspace/` 是共享工作区 fixture 根目录；凡是依赖“工作区里有什么文件”的测试，优先复用该目录。
- 当 case 直接传入 `tests/fixtures/workspace` 目录时，runner 应把该目录下的子内容原样复制到临时 workspace 根目录，而不是保留 `tests/fixtures/**` 中间层路径。

### 2.3 稳定映射模型

测试按 `domain / suite / groups... / caseId` 映射到目录和日志；`suite` 与可选 `group` 只在对应测试计划定义。普通 `.test.ts` 为 backend，`.e2e.test.ts` 为 E2E。固定边界为：`ai`、`unit` 只能是 backend，`settings`、`workbench` 只能是 E2E。

## 3. 回归 case 规则

### 3.1 准入规则

- 新增任何测试文件前，必须先与用户确认目标分类。
- `doc/test-plan/**` 是回归 case 的唯一规格来源；新增、修改或补齐回归 case 时，必须先更新对应测试计划，再修改测试代码。
- `tests/case/<domain>/**` 只能放已登记的回归 case；`tests/case/unit/**` 不进入领域回归计划，但仍必须满足 Unit backend 边界。
- 每个回归 `caseId` 都必须稳定映射到唯一测试定义与唯一日志目录。一个测试文件可以承载多个紧密相关的 case，但 `--case <caseId>` 必须能只执行目标 case。

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

- `doc/test-plan/**` 只保存稳定的 case 规格、执行规则和 Oracle；`ai-test.md` 顶部“最新 Live 评估”是唯一允许覆盖回写的运行摘要，其余单次结果和环境故障记录不写入计划。
- 每次运行的模型、耗时、通过情况、失败归因和原始证据统一保存在对应 run 的 `meta.json`、`timeline.jsonl`、`runtime-events.jsonl` 与 artifacts 中；人工完成度评分以最新 Live 评估快照为准。
- 测试数量和 case 清单以测试源码及 runner 实时发现结果为准，不在文档中维护容易失真的计数副本。
- `mock-llm` 回归 case 只允许替换 LLM 输出；不得 fake tool、store、docx apply service、runner 或节点执行结果。
- DOCX 回归必须覆盖递归语义树、递归创建树、统一 `style`、全文/限定范围 `replace_text`、visual 防误删和 `docx_read_visuals`。旧简化 block payload、旧 history shape 与 `style_text` 应直接判定为无效，不保留兼容层。
- `灵感测试.docx` 的固定基线为 18 个 image visual 和 22 个真实空段落；视觉节点不得再被当成空段落。大型 VML fixture 继续验证 599/1034 张图片时的性能与输出体积。
- Human 工具 Input Schema 回归覆盖全部已注册工具：不得出现匿名重复定义，公共定义只展开一次，长度/数量/正则/数值和跨字段语义约束不得丢失，并记录各工具 schema 长度快照。
- DOCX/PPT 定位回归统一验证可选 `location`；DOCX positioned 写保护只由 DOCX 写入路径判断，terminal 继续走独立审批机制，两者不得通过跨工具命令白名单耦合。
- `ai-test` 专门覆盖 AI 架构及其工具，全部是 backend；`settings-test` 和 `workbench-test` 专门覆盖对应 PRD 功能点，全部是 E2E；Unit 只补足前述范围未覆盖的 backend 函数、类和底层逻辑。
- `scripts/test/validate-test-architecture.mjs` 在 runner 执行前校验域边界、Unit 禁止项、计划必填字段、PRD 引用、case/runner 包装和目录映射。
- `scripts/test/workflow.mjs` 会自动读取仓库根目录的 `.env.local`、`.env`（已存在的 shell 环境变量优先）；可用 `AI_TEST_DISABLE_DOTENV=1` 禁用自动加载。
- LangSmith tracing 默认关闭；仅在排查时将 `LANGSMITH_TRACING=true`，结束后恢复为 `false`。

### 3.3 UI E2E 回归规则

- UI E2E 必须通过真实 UI 和产品链路完成被测行为，不得用 fake、mock、stub、直接写状态或内部 IPC 绕过。
- fixture 和 helper 只能准备真实输入、执行用户可见操作、等待结果和收集证据，不能替代产品输出。
- Settings / Workbench E2E 固定使用 `serviceMode: real`；自动更新模拟是当前唯一已批准例外。
- Workbench 和需要真实文件的 Settings case 将 `tests/fixtures/workspace` 复制到临时目录，case 结束并关闭应用后删除临时副本。
- fixture 只能准备用户实际可拥有的文件、目录和配置输入；不得直接写应用状态、调用内部写 IPC 或替换产品服务。
- observer、只读 IPC 和截图只能收集证据，不能触发被测行为或改变运行结果。
- `ai/human/live` 必须使用 env 真实模型且不得跳过、模拟或替换模型决策、工具结果或业务产物，允许仅为触发真实机制的可测性 override，case 不设评分门槛，运行后由人工依据 raw logs 与 artifact 将最新 0-100 评估回写至 ai-test 顶部快照。
- 产品缺少必要 testability 入口时，应记录缺口，不能改用模拟路径绕过。
- 除自动更新外，任何假数据或模拟路径都必须先说明必要性、取得用户确认，并在本文简短记录例外及边界。
- 不得为了 E2E 增加生产环境变量、故障开关、全局探针或其他生产代码入口；确需修改生产代码时，必须先取得用户确认。
- 向量模型下载 E2E 使用产品现有模型清单和下载逻辑，不替换下载源；执行前必须关闭代理软件的 TUN 模式。网络异常按测试失败处理，并通过 raw logs 定位原因。

### 3.4 真实 AI / live 断言规则

- Workbench 真实 AI E2E 必须通过应用 UI 同时选择主模型和视觉模型；视觉模型不得静默跟随主模型。
- backend 视觉模型测试统一读取 `AI_LIVE_VISUAL_MODEL_NAME`；视觉模型专用地址、密钥和 provider 仍可通过 `AI_LIVE_VISION_BASE_URL`、`AI_LIVE_VISION_API_KEY`、`AI_LIVE_VISION_PROVIDER_KIND` 覆盖。
- 涉及真实 AI 调用的回归测试，硬断言只验证完成态、关键事实、关键工具或事件、关键 artifact，以及用户诉求是否落地；最终自然语言回答不得作为主要正确性证据。
- 不对最终文案做逐字断言，不断言固定工具顺序，不断言固定 prompt 原文，不因表达差异判失败。
- 如果用户诉求已落地但断言过严，应先调整 `Oracle` 和测试代码，再根据 raw logs 记录完成度评分。
- 完成度评分由执行者或 agent 写入运行结论；测试代码不得在执行过程中修改文档。

## 4. 测试执行闭环

### 4.1 固定顺序

1. 先确认是否新增或调整测试，以及目标分类。
2. 如果是回归测试，先更新对应 `doc/test-plan/**`，再修改 `tests/case/<domain>/**`。
3. 如果是 Unit，放入 `tests/case/unit/**`，保持 backend-only，不更新 `doc/test-plan/**`。
4. 通过 `scripts/test/workflow.mjs` 执行并产出日志。
5. 先看 `timeline.jsonl`；不足时再看 `runtime-events.jsonl`、`meta.json` 和 `artifacts.json`。
6. 最后基于 raw logs 回流结论，决定是否需要更新 `doc/test-plan/**` 或实现代码。

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
  - `pnpm test:ai`
  - `pnpm test:ai:backend`
  - `pnpm test:ai:non-live`
  - `pnpm test:ai:tool`
  - `pnpm test:ai:human:mock-llm`
  - `pnpm test:ai:human:live`
- Unit
  - `pnpm test:unit`
  - `pnpm test:unit:ai`
- 全量 E2E
  - `pnpm test:e2e:source`：构建当前源码并运行全部 E2E。
  - `pnpm test:e2e:package -- --bundle <release-bundle.json>`：校验并安装已经构建的正式包，再对安装后的可执行程序运行全部 E2E。
- Settings
  - `pnpm test:settings`
  - `pnpm test:settings:e2e`
- Workbench
  - `pnpm test:workbench`
  - `pnpm test:workbench:e2e`
  - `node scripts/test/workflow.mjs --domain workbench`
  - `node scripts/test/workflow.mjs --domain workbench --type e2e`

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

补充规则：

- runner 强制执行固定 domain/type 边界。backend 普通测试并发为 6；Source E2E 的所有 case 直接共享按构建指纹保存的 split/vector 内容缓存，各 case 只隔离统计文件，`warmup` 用例按普通并发用例执行。正式包 E2E 才先串行执行全仓唯一的 `warmup` 用例，并把缓存种子复制到后续 case 的隔离缓存目录。随后开放总并发 3、live 并发 2，`exclusive` 用例串行独占；普通失败继续收集剩余 case，正式包 warm-up 失败则不启动后续并发。
- 正式包 E2E 即使通过 `--domain`/`--suite`/`--case` 过滤范围，只要本次实际执行的 case 数超过 1，runner 也会自动把全仓唯一的 `warmup` 用例纳入执行并先串行预热，避免过滤后漏掉 warmup 导致全部 case 冷启动重复索引；`--case` 过滤时 `warmup` 用例不受 `--testNamePattern` 影响。
- 真实模型 backend live 用例失败后最多重试 1 次，避免模型异常时重复等待过久。
- E2E 默认执行类型为 `normal`；真实 AI/服务调用声明 `execution: 'live'`，原生对话框、鼠标和桌面焦点用例声明 `execution: 'exclusive'`，唯一的向量冷启动用例声明 `execution: 'warmup'`。
- `source` 是日常目标，直接复用内容缓存，不额外预热；`package` 只接受既有 release bundle，安装后通过 warm-up 验证冷启动并运行同一批 E2E，不负责构建。
- native binding、知识库缓存和临时 Electron app 由 runner 自动准备；普通回归不手工修改 `node_modules` 或复用正式包缓存。
- 正式包测试、发布门禁、Tag 前 Unit/非 live AI 以及发布后日志清理只在 `doc/release.md` 定义，本文不重复发布流程。

### 4.3 自动更新模拟测试

自动更新是当前唯一允许在测试侧注入受控状态的 E2E 特例：可提供更新可用、下载进度、完成和失败快照，但不得修改生产代码来支持模拟。

自动更新测试运行后端契约测试和模拟页面 E2E：

```bash
pnpm test:update
```

也可以分开运行：

```bash
pnpm test:update:backend
pnpm test:update:e2e
```

后端测试验证主进程更新状态、发布配置、R2 元数据和 release fragment。模拟 E2E 验证页面按钮、进度、错误提示和 IPC。自动化测试不下载或安装真实更新包。

### 4.4 读取与分析 raw logs

- 默认先读取目标 run 的 `timeline.jsonl`，理解语义步骤、断言事实和失败位置。
- 如果 `timeline.jsonl` 仍不足以解释结果，再继续读取 `runtime-events.jsonl` 与关键附件。
- 必要时回看 `meta.json` 与 `artifacts.json`，确认 run 摘要、统计值和附件索引。
- 所有分析结论都必须可回溯到 raw logs 与 artifacts，不得脱离证据做推断。

### 4.5 结论回流

- 如果问题出在 case 定义、验收口径或阶段边界，必须先改 `doc/test-plan/**`，再改测试代码。
- 如果只是实现缺陷或回归问题，可在保持 case 规格不变的前提下修实现并重跑。
- 测试结论以目标 run 的 raw logs 和 artifacts 为准，不将单次结论回写为长期文档事实。

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
