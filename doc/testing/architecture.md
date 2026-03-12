# NCurator-Desktop 测试架构规范（Script-first）

入口说明：
- 默认先读 `doc/testing/README.md`
- 当前文档负责测试架构总规范

## 1. 目标

- 测试必须优先覆盖生产链路，避免“复制一套逻辑再测试自己”。
- 测试运行器统一使用 `vitest`。
- 测试目录优先按运行边界分层，而不是按“测试方法学名词”平铺：
  - `main`：直接打 Main 进程/服务入口。
  - `renderer`：直接打 React 页面/组件入口，不走完整 Electron 链路。
  - `e2e`：从用户入口打完整应用链路，覆盖 `renderer -> preload -> main -> renderer`。
- 输出结构化报告，便于 AI 二次分析并给出优化建议。

## 2. 套件分层与边界

### 2.1 顶层测试分层

- `tests/main/**`
  - 用于 Main 进程侧测试。
  - 适合 AI runtime、workspace、storage、migration、web-source 等业务域。
  - 特点是启动快、定位准，不依赖 DOM 或窗口。
- `tests/renderer/**`
  - 用于 renderer 页面的状态机、交互和 preload 契约测试。
  - 不要求完整 Electron 启动。
  - 适合验证审批 UI、工作区阻塞 UI、面板切换、错误提示等页面行为。
- `tests/e2e/**`
  - 用于完整应用链路测试。
  - 必须从真实用户入口发起交互，并走完整的 `renderer -> preload -> main -> renderer` 流程。
  - 适合关键主链路验收与 AI 驱动的探索式 UI 诊断。

### 2.2 `main` 分层建议

推荐按业务域继续细分，而不是长期使用 `integration` 作为主目录名：

- `tests/main/ai/capability/**`
  - 按 AI 已配置能力/tool 粒度验证能力正确性。
  - 直连生产能力入口，如 `src/main/services/ai/tools/**`。
- `tests/main/ai/runtime/**`
  - 验证 AI runtime、prompt contract、scope contract、阻塞语义等。
  - 原先容易被归到 `integration` 的 AI 侧测试，优先落到这里。
- `tests/main/ai/human/**`
  - 在真实模型下验证 human 子图完成任务的效果。
  - 必须只调 human 子图 runner，不经过 main graph。
- `tests/main/<domain>/service/**`
  - 真实后端业务服务测试，例如 workspace、web-source、storage。
- `tests/main/<domain>/migration/**`
  - 迁移与清理边界测试。
- `tests/main/<domain>/runtime/**`
  - 特定业务域的运行时契约测试。

说明：
- `integration` 可以作为“测试性质”来描述，但不建议继续作为长期主目录名。
- 目录名优先回答“从哪一层入口打进去”和“测哪个业务域”。

### 2.3 `renderer` 分层建议

- `tests/renderer/<page>/contract/**`
  - 使用受控 `DesktopApi` stub 和事件脚本验证页面状态机与 IPC 交互。
  - 适合 `ChatPage`、`ImportPage`、`SearchPage` 等状态密集页面。
- selector 与挂载工具建议放在：
  - `tests/harness/renderer/**`
  - 或 `tests/renderer/harness/**`

### 2.4 `e2e` 分层建议

- `tests/e2e/<page>/deterministic/**`
  - 真实 Electron 主链路回归。
  - 适合 Chat 的 `plan/artifact`、`approval_required`、`workspace_required` 等关键路径。
- `tests/e2e/<page>/ai-live/**`
  - AI 探索式 UI 测试。
  - 默认非阻塞，主要用于诊断与修复闭环，不作为主门禁。

## 3. 推荐技术方案

### 3.1 `main`

- 继续使用 `Vitest`
- 默认运行在 `node` 环境
- 复用现有 main harness、事件采集和结构化报告写盘

### 3.2 `renderer`

- 推荐方案：`Vitest + jsdom + React Testing Library + @testing-library/user-event`
- 适用范围：
  - 页面状态机
  - 审批/工作区阻塞 UI
  - 面板切换
  - preload API 调用参数验证
- 选择原因：
  - 与现有 `Vitest` 体系一致，接入成本最低
  - `jsdom` 足够覆盖当前 React 页面交互测试
  - React Testing Library 更适合测用户可见行为，而不是组件内部实现
- 补充说明：
  - `Vitest Browser Mode` 可作为少数真实浏览器能力 case 的补充，不作为默认路线

### 3.3 `e2e`

- 推荐方案：`Playwright` 的 Electron 自动化能力
- 适用范围：
  - 真实 `renderer -> preload -> main -> renderer` 链路
  - Chat 关键主流程
  - Import/Search 主链路
  - AI live 探索式 UI 测试
- 选择原因：
  - 可以直接启动真实 Electron 应用并驱动窗口
  - 原生支持 trace、screenshot 等取证能力，便于 AI 基于失败结果修复
- 执行约束：
  - deterministic Electron e2e 必须串行运行，避免多个 Electron 实例并发争抢窗口与用户数据目录导致假失败
  - `vitest.e2e.config.mts` 需要保持 `fileParallelism: false`

### 3.4 不作为默认路线的方案

- 不默认使用 `Playwright component testing` 代替 renderer contract
  - 对当前项目过重，反馈慢
- 不默认使用 `Cypress` 作为 Electron 主 e2e
  - 对 Electron + preload + main 这类链路不如 Playwright 直接
- 不默认只做 e2e、不做 renderer contract
  - 会导致大量页面状态逻辑只能靠慢测试兜底

## 4. 目录与文件约定

```text
tests/
  fixtures/
    main/                       # Main 侧输入（docx、workspace、事件脚本等）
    renderer/                   # Renderer 页面状态、IPC 脚本、页面样例
    e2e/                        # 端到端工作区、初始应用状态、运行场景
  harness/
    main/                       # Main 侧运行器、上下文工厂、报告写入、env 加载
    renderer/                   # 页面挂载、DesktopApi stub、selector、事件回放
    e2e/                        # Electron 启动器、trace/screenshot、AI live 驱动
  main/
    ai/
      capability/
      runtime/
      human/
    workspace/
      service/
      migration/
  renderer/
    chat/
      contract/
    import/
      contract/
    search/
      contract/
  e2e/
    chat/
      deterministic/
      ai-live/
    import/
      deterministic/
    search/
      deterministic/
tests/report/                   # 每次执行的结构化报告
.env                            # 本地 live 配置（不入库）
.env-example                    # live 配置模板（入库）
```

当前状态：
- Main/AI 测试已经迁移到 `tests/main/**`。
- Main 共享 harness 已迁移到 `tests/harness/main/**`。
- Main fixture 已迁移到 `tests/fixtures/main/**`。
- 后续新增 Main 测试不再使用 `tests/ai/**` 路径。

命名建议：
- main capability: `<capability>.<case>.test.ts`
- main runtime/service/migration: `<domain>.<case>.test.ts`
- main human: `human.<case>.live.test.ts`
- renderer contract: `<page>.<flow>.test.ts`
- e2e deterministic: `<page>.<flow>.e2e.test.ts`
- e2e ai-live: `<page>.<goal>.live.test.ts`

## 5. 环境变量约定（根目录）

human 使用根目录 `.env` 配置：

- `AI_LIVE_ENABLE`
- `AI_LIVE_BASE_URL`
- `AI_LIVE_MODEL_NAME`
- `AI_LIVE_API_KEY`

规则：
- `.env-example` 作为模板入库。
- `.env` 用于本机配置，不入库。
- 测试运行器会优先读取当前 shell 环境；若缺失，再从根目录 `.env` 补充。

## 6. Fixture 规则

- fixture 缺失必须 fail-fast，并在报告中输出缺失清单。
- Main 侧 docx/workspace 输入优先放在 `tests/fixtures/main/**`。
- renderer contract 输入优先放在 `tests/fixtures/renderer/**`。
- e2e 工作区和链路样例优先放在 `tests/fixtures/e2e/**`。
- 用例里必须显式声明：
  - `requiredFixtures`
  - `fixtureCopies`

## 7. 报告契约（AI 分析输入）

每个 case 都输出到：

`tests/report/<suite>/<case>/<timestamp>/`

`timestamp` 格式：`YYYY-MM-DD_HH:mm:ss`（本地时间，便于人工阅读）

推荐的 suite 分组命名：
- `main-ai-capability`
- `main-ai-runtime`
- `main-ai-human`
- `main-workspace-service`
- `main-workspace-migration`
- `renderer-chat-contract`
- `renderer-import-contract`
- `renderer-search-contract`
- `e2e-chat`
- `e2e-import`
- `e2e-search`
- `e2e-chat-ai-live`

固定文件：
- `events.jsonl`
- `assertions.json`
- `metrics.json`
- `signals.json`
- `summary.md`

human 批次评估附加产物：
- `tests/report/main-ai-human/batches/<batchId>/batch-summary.json`
- `tests/report/main-ai-human/batches/<batchId>/batch-summary.md`
- `tests/report/main-ai-human/batches/<batchId>/cases/<caseId>/run-XX/**`

human 升级对比附加产物：
- `tests/report/main-ai-human/compare/<before>-vs-<after>.json`
- `tests/report/main-ai-human/compare/<before>-vs-<after>.md`

消费原则：
- `events.jsonl`：原始事件流，作为可回放证据。
- `assertions.json`：结构化断言结果，包含 `caseStatus`、失败断言 ID 与断言明细。
- `metrics.json`：统一标量指标，至少包含 `caseStatus`、`caseErrorCode`、`executionStatus`、`executionResultCode` 及步骤、审批、产物计数。
  - `main-ai-human` 额外要求：`toolErrorCount`、`recoveryAfterErrorCount`、`repeatedToolCallCount`、`stepBudgetUsage`、`qualityGrade`。
- `signals.json`：结构化信号，至少包含 `toolSequence`、`toolCounts`、`toolResultCodeCounts`、`stepActionSequence`、`skillActivationSequence`、`failedAssertionIds`，并在适用时补充 `expectedOutcome`、`scenarioTags`、`taskGoal`、`finalHumanAction`。
  - `main-ai-human` 额外要求：`maxSteps`、`approvalPolicy`、`modelName`、`resultDataKeys`、`firstFailureStage`。
- `summary.md`：事实性摘要，只转写上述结构化数据，不包含固定根因或优化建议。

renderer / e2e 可选附加证据：
- `artifacts.json`
- `screenshots/*.png`
- `trace/trace.zip`
- `console.jsonl`
- `dom/*.html`

推荐的 renderer/e2e 附加信号：
- `routeSequence`
- `userActionSequence`
- `ipcInvokeSequence`
- `selectorFailures`
- `consoleErrorCount`
- `screenshotRefs`

`artifacts.json` 建议作为 UI 证据索引，至少列出：
- `screenshots`
- `trace`
- `dom`
- `console`

AI 消费 renderer / e2e 报告时，最小输入集合建议为：
1. `assertions.json`
2. `metrics.json`
3. `signals.json`
4. `summary.md`
5. `artifacts.json`

推荐修复顺序：
1. 先看 `assertions.json` 确认失败断言 ID 与失败面。
2. 再看 `metrics.json` 判断是运行时异常、阻塞还是纯断言失败。
3. 再看 `signals.json` 中的 `routeSequence`、`userActionSequence`、`ipcInvokeSequence`、`selectorFailures`、`taskGoal`。
4. 最后按 `artifacts.json` 打开 DOM、console、截图、trace 做精确定位。
5. 修复后优先回归同一 case，再回归同 suite 的相邻关键流。

## 8. AI阶段化测试顺序（能力先行）

该部分已独立到计划文档，避免与架构规范混写：

- 阶段顺序与门禁规则：`doc/testing/phased-plan.md`
- 当前阶段结论与边界：`doc/testing/upgrade-journal.md`
- 每轮测试完成后的持续汇总：`doc/testing/upgrade-journal.md`

补充原则：
- 架构规则只放本文件。
- 阶段计划只放 `ai-phased-plan.md`。
- 阶段执行结果与阶段专题结论统一放 `ai-upgrade-journal.md`。

## 9. 扩展规则（目标目录口径）

新增 main AI capability 用例时：
1. 新建 `tests/main/ai/capability/*.test.ts`
2. 复用 `runCapabilityCase`
3. 调用生产 tool 入口并断言结果

新增 main runtime/service/migration 用例时：
1. 按业务域落到 `tests/main/<domain>/<kind>/*.test.ts`
2. 复用现有 main harness，或在 `tests/harness/main/**` 中补充最小扩展
3. 直接调用生产运行时/存储/迁移/范围装配入口，验证跨模块行为

新增 main human 用例时：
1. 新建 `tests/main/ai/human/*.live.test.ts`
2. 复用 `runHumanCase`
3. 明确 `objective`、审批策略和成功/阻塞断言
4. 同时补充 `resultData`、步数预算、质量分级输入所需断言

main human 评估分层：
1. 回归层：每个 case 单次运行，目标是快速发现明显退化。
2. 评估层：关键 case 执行多轮批次，目标是统计 `hard_pass / soft_pass / expected_block / unexpected_block / harness_fail`、稳定性与效率波动。
3. 聚合层：执行 `pnpm test:main:ai:human:analyze`，生成 `tests/report/main-ai-human/human-assessment.md`。
4. 批次层：执行 `pnpm test:main:ai:human:p2 -- --runs 5`，把固定 case 集合复制到独立 batch 目录，避免不同轮次历史互相污染。
5. 对比层：执行 `pnpm test:main:ai:human:p3:compare -- --before <batchId> --after <batchId>`，对固定 batch 做升级前后对比。

新增 renderer contract 用例时：
1. 新建 `tests/renderer/<page>/contract/*.test.ts`
2. 复用 renderer mount/stub harness
3. 使用受控 `DesktopApi` stub 与事件脚本验证页面状态和 IPC 调用参数

新增 e2e deterministic 用例时：
1. 新建 `tests/e2e/<page>/deterministic/*.e2e.test.ts`
2. 启动真实 Electron 应用
3. 从用户入口触发完整 `renderer -> preload -> main -> renderer` 链路并断言最终界面

新增 e2e ai-live 用例时：
1. 新建 `tests/e2e/<page>/ai-live/*.live.test.ts`
2. 复用真实 Electron harness
3. 明确 `taskGoal`、`expectedOutcome`、`scenarioTags`
4. 缺少 `AI_LIVE_ENABLE=1` 时默认 skip，不污染主门禁
5. 让 AI 在带目标约束的真实 UI 上探索，并输出可修复证据

## 10. 执行命令（目标口径）

- 当前仓库已实现的命令：
  - `pnpm test:main`
  - `pnpm test:main:ai:capability`
  - `pnpm test:main:ai:capability:analyze`
  - `pnpm test:main:ai:runtime`
  - `pnpm test:main:ai:human`
  - `pnpm test:main:ai:human:analyze`
  - `pnpm test:main:ai:human:p2`
  - `pnpm test:main:ai:human:p3:compare`
  - `pnpm test:main:workspace:service`
  - `pnpm test:main:workspace:migration`
  - `pnpm test:renderer`
  - `pnpm test:e2e`
  - `pnpm test:e2e:ai-live`
  - `pnpm test:ai`
  - `pnpm test:ai:capability`
  - `pnpm test:ai:integration`
  - `pnpm test:ai:human`
  - 指定单文件：`pnpm test:main -- <path-to-test-file>`
- 当前仓库已实现的命令仍以 `package.json` 中现有脚本为准。

补充说明：
- 未配置 live 环境变量时，`human` 用例会按既定策略跳过；这不影响 capability suite 的通过判定。
- `e2e ai-live` 默认应作为非阻塞套件，不直接成为主 CI gate；缺少 `AI_LIVE_ENABLE=1` 时应 skip。
- `pnpm test:ai*` 当前仅作为兼容别名保留，底层已指向 `tests/main/**`。
- 当前 `tests/main/**` 的已知覆盖包括：
  - `tests/main/ai/capability/**`：`docx` 编辑与审批拒绝链路、local KB retrieval 范围约束
  - `tests/main/ai/runtime/**`：runtime/source-scope/prompt contract 与 fail-fast 路径
  - `tests/main/workspace/service/**`：workspace scan/diff/scope selection
  - `tests/main/workspace/migration/**`：legacy local import cleanup
  - `tests/main/ai/human/**`：human 子图真实模型任务与阻塞路径
