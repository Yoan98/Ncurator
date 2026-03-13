# 测试用例治理规则

本文件定义测试用例如何进入 current catalog、如何长期保留、何时降级以及何时归档。

## 1. 统一 metadata

每个受治理 case 都必须在测试源码里显式声明 metadata。

必填字段：

- `description`
- `scenarioTags`
- `expectedOutcome`
- `requiredFixtures`
- `retentionTier`
- `lifecycle`
- `runPolicy`
- `capabilityArea`

建议补充：

- `taskGoal`
- `profiles`

当前 catalog 输出字段见：

- [current-cases.json](/Users/test/work-space/NCurator-Desktop/tests/catalog/current-cases.json)
- [archived-cases.json](/Users/test/work-space/NCurator-Desktop/tests/catalog/archived-cases.json)

## 2. retentionTier

### `canonical`

- 长期保留的稳定回归 case。
- 保护明确用户契约或高频回归风险。
- 优先进入主门禁。

### `coverage`

- 有价值，但不一定是主门禁。
- 用于补覆盖、边界回归、显式缺口观测。
- 可以是 gating，也可以是 non-gating。

### `diagnostic`

- 临时定位问题或缩小根因的 case。
- 默认不长期保留。
- 如果连续多轮仍然有价值，再考虑晋升。

### `live-eval`

- 模型敏感、波动较大的 live 评估样本。
- 用于 batch、baseline、compare 或非阻塞诊断。
- 不应默认混入 deterministic 主回归门禁。

### `archived`

- 已退出 current case 集。
- 只能出现在 archived catalog，不再出现在 current catalog。

## 3. lifecycle

### `active`

- 当前受治理 case。
- 允许出现在 current catalog。

### `quarantined`

- 仍然保留，但暂不作为正常输入。
- 用于已知不稳定、待修复或需要隔离的 case。

### `deprecated`

- 即将淘汰，不建议继续新增依赖。
- 可以短期保留历史记录，但不应继续当主样本。

### `archived`

- 已归档。
- 不再属于 current case 集，只保留历史证据和归档记录。

## 4. runPolicy

### `gating`

- 主门禁 case。
- 回归后需要优先处理。

### `non_gating`

- 仍然值得运行，但不阻塞主门禁。
- 常用于显式缺口、覆盖扩展或诊断投影。

### `manual`

- 只在手动触发或局部排查时运行。
- 典型例子是环境缺失 fail-fast、一次性验证样本。

### `batch_only`

- 主要通过 batch、baseline 或 compare 运行。
- human live 评估样本优先使用这一层级。

## 5. capabilityArea

当前已使用的能力归属包括：

- `docx-tooling`
- `local-retrieval`
- `terminal-exec`
- `tool-registry`
- `ai-runtime`
- `human-live`
- `workspace`
- `chat-ui`
- `search-ui`
- `import-ui`

规则：

- `capabilityArea` 回答“这个 case 在保护哪个能力边界”，而不是“它在哪个目录里”。
- 新增字段值时，要保证它能稳定代表一个可长期讨论的能力面。

## 6. 准入规则

一个新 case 只有同时满足下面条件，才应进入 current catalog：

1. 它保护的是用户契约、关键边界或真实回归风险。
2. 它的 metadata 已完整声明。
3. 它能通过现有 harness / fixture / analyzer 被稳定运行和分析。
4. 它的长期价值已经明确，不是纯一次性实验。

如果只是临时定位问题：

- 先标成 `diagnostic` 或 `live-eval`
- 不要默认升成 `canonical`

## 7. 晋升与降级

### 晋升到 `canonical`

至少满足其一：

- 复现过真实线上或主干回归
- 保护高价值用户契约
- 是阶段门禁的关键样本

### 从 `canonical` 降级

至少满足其一：

- 已被更稳定、更高信噪比的 case 覆盖
- 维护成本过高且收益变低
- 长期只用于诊断，不再适合作为主回归

### 归档

当 case 已被替代、失去源码对应实现，或不再值得继续维护时：

1. 从 current case 源码中删除或移出 active 集
2. 在 archived catalog 中记录原因与替代 case
3. 清理 stale report 目录

## 8. current / archived / report 的关系

### current

- 入口：`tests/catalog/current-cases.json`
- 只包含当前 active case

### archived

- 入口：`tests/catalog/archived-cases.json`
- 只包含已归档 case 和归档原因

### report

- 入口：`tests/report/**`
- 只表示“曾经执行过”
- 不能代表“当前仍有效”

## 9. AI 与脚本的读取顺序

需要确认当前测试集时，统一按下面顺序：

1. [current-cases.json](/Users/test/work-space/NCurator-Desktop/tests/catalog/current-cases.json)
2. [current-cases.md](/Users/test/work-space/NCurator-Desktop/tests/catalog/current-cases.md)
3. `latestReport / latestStatus / latestRunAt`
4. [upgrade-journal.md](/Users/test/work-space/NCurator-Desktop/doc/testing/upgrade-journal.md)

不要直接从 `tests/report/**` 目录树、旧批次目录名或历史汇总文件推断 current case 集。

## 10. stale report 清理

清理前提：

- 该 case 已不在 current catalog
- 已在 archived catalog 中登记

清理命令：

- `pnpm test:catalog:clean-reports`

清理目标：

- stale case 报告目录
- 已废弃 suite 目录
- 不再需要保留的旧路径兼容层
