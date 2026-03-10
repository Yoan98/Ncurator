# NCurator-Desktop 测试架构规范（Script-first）

## 1. 目标

- 测试必须优先覆盖生产链路，避免“复制一套逻辑再测试自己”。
- 测试运行器统一使用 `vitest`。
- 支持两类核心验证：
  - capability：按 AI 已配置能力/tool 粒度验证能力正确性。
  - integration：验证跨模块运行时契约、范围语义、迁移与产品级验收链路。
  - human-live：在真实模型下验证 human 子图完成任务的效果。
- 输出结构化报告，便于 AI 二次分析并给出优化建议。

## 2. 套件分层与边界

### 2.1 capability suite

- 用例目录：`tests/ai/suites/capability/*.test.ts`
- 入口：`runCapabilityCase(...)`
- 必须直连生产能力入口（如 `src/main/services/ai/tools/**`），禁止在测试中重写业务实现。
- 每个 tool 或一组明确操作链路对应一个独立用例。
- 当前已覆盖：
  - `docx` 编辑与审批拒绝链路
  - local KB retrieval 的范围约束

### 2.2 integration suite

- 用例目录：`tests/ai/suites/integration/*.test.ts`
- 入口：`runIntegrationCase(...)`
- 用于验证不属于单一 capability 的产品级链路，包括 workspace/source-scope/runtime/migration/prompt contract 等跨模块行为。
- 当前已覆盖：
  - 工作空间扫描 / diff / 范围装配
  - 运行时 scope 校验与结构化 `runtime_issue`
  - 旧本地导入迁移清理边界
  - local-first prompt / finalize 契约
  - 父子范围显式保留与底层 document id 去重
  - fixture 缺失时的 suite 级 fail-fast

### 2.3 human-live suite

- 用例目录：`tests/ai/suites/human-live/*.live.test.ts`
- 入口：`runHumanLiveCase(...)`
- 必须只调 human 子图 runner，不经过 main graph。
- 使用真实 LLM 调用，验证“渐进式完成任务”是否成立。

## 3. 目录与文件约定

```text
tests/ai/
  fixtures/                     # 测试输入（docx、workspace 文件）
  harness/                      # 运行器、上下文工厂、报告写入、env 加载
  suites/
    capability/                 # AI 能力/tool 级用例
    integration/                # 跨模块集成与产品语义验收
    human-live/                 # human live 用例
tests/report/                   # 每次执行的结构化报告
.env                            # 本地 live 配置（不入库）
.env-example                    # live 配置模板（入库）
```

命名建议：
- capability: `<capability>.<case>.test.ts`
- integration: `<domain>.<case>.test.ts`
- human-live: `human.<case>.live.test.ts`

## 4. 环境变量约定（根目录）

human-live 使用根目录 `.env` 配置：

- `AI_LIVE_ENABLE`
- `AI_LIVE_BASE_URL`
- `AI_LIVE_MODEL_NAME`
- `AI_LIVE_API_KEY`

规则：
- `.env-example` 作为模板入库。
- `.env` 用于本机配置，不入库。
- 测试运行器会优先读取当前 shell 环境；若缺失，再从根目录 `.env` 补充。

## 5. Fixture 规则

- fixture 缺失必须 fail-fast，并在报告中输出缺失清单。
- docx 测试输入默认放在 `tests/ai/fixtures/docx/`。
- workspace 输入默认放在 `tests/ai/fixtures/workspace/`。
- 用例里必须显式声明：
  - `requiredFixtures`
  - `fixtureCopies`

## 6. 报告契约（AI 分析输入）

每个 case 都输出到：

`tests/report/<suite>/<case>/<timestamp>/`

`timestamp` 格式：`YYYY-MM-DD_HH:mm:ss`（本地时间，便于人工阅读）

固定文件：
- `events.jsonl`
- `assertions.json`
- `metrics.json`
- `signals.json`
- `summary.md`

消费原则：
- `events.jsonl`：原始事件流，作为可回放证据。
- `assertions.json`：结构化断言结果，包含 `caseStatus`、失败断言 ID 与断言明细。
- `metrics.json`：统一标量指标，至少包含 `caseStatus`、`caseErrorCode`、`executionStatus`、`executionResultCode` 及步骤、审批、产物计数。
- `signals.json`：结构化信号，至少包含 `toolSequence`、`toolCounts`、`toolResultCodeCounts`、`stepActionSequence`、`skillActivationSequence`、`failedAssertionIds`，并在适用时补充 `expectedOutcome`、`scenarioTags`、`finalHumanAction`。
- `summary.md`：事实性摘要，只转写上述结构化数据，不包含固定根因或优化建议。

## 7. 扩展规则

新增 capability 用例时：
1. 新建 `tests/ai/suites/capability/*.test.ts`
2. 复用 `runCapabilityCase`
3. 调用生产 tool 入口并断言结果

新增 integration 用例时：
1. 新建 `tests/ai/suites/integration/*.test.ts`
2. 复用 `runIntegrationCase`
3. 直接调用生产运行时/存储/迁移/范围装配入口，验证跨模块行为

新增 human-live 用例时：
1. 新建 `tests/ai/suites/human-live/*.live.test.ts`
2. 复用 `runHumanLiveCase`
3. 明确 `objective`、审批策略和成功/阻塞断言

## 8. 执行命令

- `pnpm test:ai`
- `pnpm test:ai:capability`
- `pnpm test:ai:integration`
- `pnpm test:ai:human-live`

补充说明：
- 未配置 live 环境变量时，`human-live` 用例会按既定策略跳过；这不影响 capability suite 的通过判定。
- 当前仓库已把 `workspace-web-source-scope` 相关的核心验收面沉淀进 integration suite；GUI 级端到端回归仍需单独执行人工检查或独立 e2e harness。
