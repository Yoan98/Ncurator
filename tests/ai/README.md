# AI 测试说明（Script-first）

本目录用于运行两类测试：
- `capability`：按 tool 粒度验证生产能力（一个 tool 一个用例）。
- `human-live`：仅验证 human 子图在真实模型下完成任务的效果（不经 main graph）。

## 执行命令

- 全量：`pnpm test:ai`
- 仅 capability：`pnpm test:ai:capability`
- 仅 human-live：`pnpm test:ai:human-live`
- 指定单文件：`pnpm test:ai -- tests/ai/suites/capability/<case>.test.ts`

## 执行前你需要准备什么

### 1) capability/docx 用例前置文件

- 默认已内置示例文件：`tests/ai/fixtures/docx/sample-edit.docx`
- 你也可以替换该文件；内容中至少包含文本 `Hello`（当前首个用例会执行 `replace_text: Hello -> Hi`）。

### 2) human-live 模型配置（环境变量）

- `AI_LIVE_ENABLE=1`
- `AI_LIVE_BASE_URL=<你的模型网关地址>`
- `AI_LIVE_MODEL_NAME=<模型名>`
- `AI_LIVE_API_KEY=<你的 key>`

可复制模板：项目根目录 `.env-example`，并保存为根目录 `.env`

测试运行器会自动读取根目录 `.env`；未设置时，human-live 用例会跳过；若启用但缺字段，会 fail-fast 并输出缺失项。

## 报告输出

每个用例都会落盘到：

`tests/report/<suite>/<case>/<timestamp>/`

`timestamp` 格式为：`YYYY-MM-DD_HH:mm:ss`（本地时间，可直接读出时分秒）

包含：
- `events.jsonl`
- `assertions.json`
- `metrics.json`
- `signals.json`
- `summary.md`

推荐消费方式：
- `events.jsonl`：读取原始执行事件，适合回放与定位。
- `assertions.json`：读取 `caseStatus`、断言总数、失败断言 ID 与断言明细。
- `metrics.json`：读取统一标量指标，重点关注 `caseErrorCode`、`executionStatus`、`executionResultCode`。
- `signals.json`：读取 `toolSequence`、`toolCounts`、`toolResultCodeCounts`、`expectedOutcome`、`scenarioTags`、`finalHumanAction` 等结构化信号。
- `summary.md`：仅用于人工快速浏览，不承担根因分析或优化建议输出。

## 如何新增一个 tool 测试用例（最小步骤）

1. 在 `tests/ai/suites/capability/` 新增一个 `*.test.ts` 文件。
2. 复用 `runCapabilityCase(...)`，填写：
- `caseId`
- `requiredFixtures`
- `fixtureCopies`
- `execute`
- `assert`
3. 运行 `pnpm test:ai:capability -- <new-file-path>` 验证。

## 如何新增一个 human-live 用例（最小步骤）

1. 在 `tests/ai/suites/human-live/` 新增一个 `*.live.test.ts` 文件。
2. 复用 `runHumanLiveCase(...)`，填写：
- `objective`
- `requiredFixtures`
- `fixtureCopies`
- `approvalPolicy`
- `assert`
3. 设置 live 环境变量后运行 `pnpm test:ai:human-live -- <new-file-path>`。
