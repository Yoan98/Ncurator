# NCurator-Desktop 测试架构规范

入口说明：

- 默认先读 [README.md](/Users/test/work-space/NCurator-Desktop/doc/testing/README.md)
- 当前文档只负责测试结构、执行入口与真相源关系

## 1. 目标

- 测试优先覆盖真实生产入口，不复制一套平行实现来验证自己。
- 当前有效测试清单必须可被 AI 与脚本稳定枚举。
- 报告目录只承担历史执行证据，不再承担当前 case inventory。

## 2. 真相源链路

```text
tests/**                           # 可运行 case 与 metadata 源码
  -> tests/catalog/current-cases.json
  -> tests/catalog/current-cases.md
  -> tests/report/**               # latest report / batch / compare 等历史证据
```

规则：

- `tests/**` 是 case 定义与 metadata 的唯一真相源。
- `tests/catalog/current-cases.json` 是 machine-readable 的当前 case catalog。
- `tests/catalog/current-cases.md` 必须和 JSON 表达同一套 case 集。
- `tests/catalog/archived-cases.json` 与 `tests/catalog/archived-cases.md` 只记录已归档 case，不混入 current case 集。
- `tests/report/**` 中存在目录，不代表该 case 仍然 active。

## 3. 目录分层

```text
tests/
  fixtures/                        # 共享输入样本
  harness/                         # suite 运行器、报告写入与辅助工具
  main/                            # managed Main case
    ai/
      capability/
      runtime/
      human/
    workspace/
      service/
      migration/
  renderer/                        # managed React renderer contract case
  e2e/                             # managed Electron 端到端 case
  unit/                            # 非 catalog 的普通单测
  catalog/                         # 当前 / 归档 case 目录与归档记录
  report/                          # 历史执行证据
```

说明：

- `tests/main/**`、`tests/renderer/**`、`tests/e2e/**` 只放 managed case，参与 current catalog 生成。
- `tests/unit/**` 只放普通单测，不进入 current catalog，也不写治理报告。
- `tests/main/**` 覆盖 Main 服务入口、AI capability/runtime/human 与 workspace 逻辑。
- `tests/renderer/**` 覆盖页面 contract，不要求启动完整 Electron。
- `tests/e2e/**` 覆盖真实 `renderer -> preload -> main -> renderer` 链路。
- `tests/catalog/case-governance.mjs` 只保留归档 case 和 stale report 清理记录，不再为 current case 提供默认 metadata。

## 4. suite 边界

### 4.1 Main

- `tests/main/ai/capability/**`
  - tool / capability 级回归与边界 case。
- `tests/main/ai/runtime/**`
  - runtime contract、scope contract、draft review runtime 等。
- `tests/main/ai/human/**`
  - human 子图真实模型测试与批次评估样本。
- `tests/main/workspace/service/**`
  - workspace 主服务测试。
- `tests/main/workspace/migration/**`
  - 迁移与清理边界测试。

### 4.2 Renderer

- `tests/renderer/chat/contract/**`
- `tests/renderer/import/contract/**`
- `tests/renderer/search/contract/**`

Renderer contract 通过 `tests/harness/renderer/**` 统一挂载页面、注入 `DesktopApi` mock、写入结构化报告。

### 4.3 E2E

- `tests/e2e/**/deterministic/**`
  - 长期 deterministic 回归与关键门禁链路。
- `tests/e2e/**/ai-live/**`
  - AI live 诊断样本，默认不做主门禁。

## 5. metadata 与 catalog

每个受治理 case 都必须显式声明 metadata，并且只能放在 managed roots（`tests/main/**`、`tests/renderer/**`、`tests/e2e/**`）。当前最小治理字段包括：

- `description`
- `scenarioTags`
- `expectedOutcome`
- `requiredFixtures`
- `retentionTier`
- `lifecycle`
- `runPolicy`
- `capabilityArea`

补充字段：

- `taskGoal`
- `profiles`
- `sourceFile` 由 catalog 生成阶段自动回填

catalog 生成命令：

- `pnpm test:catalog:generate`

catalog 清理命令：

- `pnpm test:catalog:clean-reports`

drift 检查命令：

- `pnpm test:cases:drift`

生成失败即视为治理失败，常见原因包括：

- 缺少 metadata 字段
- 非法枚举值
- 重复 `caseId`
- 报告目录存在未归档的 stale case
- managed roots 中混入未进入 current catalog 的测试文件
- `tests/unit/**` 中误放 managed metadata

## 6. 报告契约

每个 case 仍然输出到：

`tests/report/<suite>/<caseId>/<timestamp>/`

固定结构包括：

- `events.jsonl`
- `assertions.json`
- `metrics.json`
- `signals.json`
- `summary.md`

可选附加证据：

- `artifacts.json`
- `screenshots/*.png`
- `trace/trace.zip`
- `console.jsonl`
- `dom/*.html`

消费顺序必须是：

1. 读取 `tests/catalog/current-cases.json`
2. 按 `suite / caseId / lifecycle / runPolicy` 确认该 case 当前身份
3. 再跳转 `latestReport`、`latestStatus`、`latestRunAt`

禁止直接扫描 `tests/report/**` 推断当前 case 集。

## 7. 分析脚本与批次脚本

以下脚本必须以 catalog 作为当前 case 集输入：

- `scripts/human-report-analyzer.mjs`
- `scripts/human-batch-runner.mjs`
- `scripts/tool-capability-report-analyzer.mjs`

要求：

- human 批次默认 case 集来自 catalog 中当前 `runPolicy` 与 `profiles` 过滤结果。
- capability / human analyzer 只能把报告目录当作历史 evidence。
- 遇到 catalog 中不存在的旧报告目录，先归档，再清理。

## 8. 新增 case 的最小流程

1. 在对应 suite 源码中声明 case 与完整 metadata。
   - 若只是普通内部逻辑验证，改放 `tests/unit/**`，不要进入 managed roots。
2. 选择正确的 `retentionTier / lifecycle / runPolicy / capabilityArea`。
3. 补齐 fixtures、断言和报告信号。
4. 运行 `pnpm test:catalog:generate`。
5. 运行 `pnpm test:cases:drift`。
6. 运行对应 suite 命令与相关 analyzer。
6. 若影响阶段门禁或阶段结论，再更新：
   - [phased-plan.md](/Users/test/work-space/NCurator-Desktop/doc/testing/phased-plan.md)
   - [upgrade-journal.md](/Users/test/work-space/NCurator-Desktop/doc/testing/upgrade-journal.md)

## 9. 旧结构清理

- current case 不再从 report 目录反推。
- stale report 目录必须先进入 archived catalog，再执行清理脚本。
- 允许删除旧 caseId、旧目录与失效入口，不保留兼容层。
