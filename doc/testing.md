# NCurator-Desktop 测试架构规范（Script-first）

## 1. 目标

- 测试必须优先覆盖生产链路，避免“复制一套逻辑再测试自己”。
- 支持两类核心验证：
  - capability：按 tool 粒度验证能力正确性。
  - human-live：在真实模型下验证 human 子图完成任务的效果。
- 输出结构化报告，便于 AI 二次分析并给出优化建议。

## 2. 套件分层与边界

### 2.1 capability suite

- 用例目录：`tests/ai/suites/capability/*.test.ts`
- 入口：`runCapabilityCase(...)`
- 必须直连生产能力入口（如 `src/main/services/ai/tools/**`），禁止在测试中重写业务实现。
- 每个 tool 或一组明确操作链路对应一个独立用例。

### 2.2 human-live suite

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
    capability/                 # tool 级用例
    human-live/                 # human live 用例
artifacts/ai-test-results/      # 每次执行的结构化报告
.env                            # 本地 live 配置（不入库）
.env-example                    # live 配置模板（入库）
```

命名建议：
- capability: `<capability>.<case>.test.ts`
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

`artifacts/ai-test-results/<suite>/<case>/<timestamp>/`

固定文件：
- `events.jsonl`
- `assertions.json`
- `metrics.json`
- `summary.md`

`metrics.json`/`summary.md` 必须包含：
- `failure_category`
- `suspected_root_cause`
- `optimization_hints`

## 7. 扩展规则

新增 capability 用例时：
1. 新建 `tests/ai/suites/capability/*.test.ts`
2. 复用 `runCapabilityCase`
3. 调用生产 tool 入口并断言结果

新增 human-live 用例时：
1. 新建 `tests/ai/suites/human-live/*.live.test.ts`
2. 复用 `runHumanLiveCase`
3. 明确 `objective`、审批策略和成功/阻塞断言

## 8. 执行命令

- `pnpm test:ai`
- `pnpm test:ai:capability`
- `pnpm test:ai:human-live`
