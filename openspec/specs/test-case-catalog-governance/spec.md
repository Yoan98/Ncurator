# test-case-catalog-governance Specification

## Purpose
TBD - created by archiving change refactor-test-catalog-governance. Update Purpose after archive.
## Requirements
### Requirement: 测试系统 MUST 从测试源码生成统一的当前 case catalog
测试系统 MUST 以 `tests/**` 中的测试用例定义作为当前 case 的唯一真相源，并生成 machine-readable 的当前 case catalog；catalog MUST 至少包含 `suite`、`caseId`、`description`、`scenarioTags`、`taskGoal`、`expectedOutcome`、`requiredFixtures`、`retentionTier`、`lifecycle`、`runPolicy`、`capabilityArea`、`sourceFile` 与 latest report 关联信息，供 AI、分析脚本与开发者统一读取。

#### Scenario: 生成当前 case catalog
- **WHEN** 系统扫描仓库中的测试源码并构建 catalog
- **THEN** 系统 MUST 只根据当前源码中的 case 定义生成 catalog，而不是根据 `tests/report/**` 目录推断当前 case 集

#### Scenario: 输出 machine-readable 与 human-readable 目录
- **WHEN** 系统完成 case catalog 生成
- **THEN** 系统 MUST 同时输出 machine-readable catalog 与供人工浏览的投影文件，并保证两者表达的是同一套 case 集

### Requirement: 每个受治理的测试用例 MUST 显式声明统一 metadata 与生命周期
每个纳入当前测试体系治理的 case MUST 显式声明统一 metadata，并且 MUST 明确其保留层级、生命周期状态和运行策略；缺失必填 metadata 的 case MUST 被视为不合规 case，catalog 生成与 drift 检查 MUST fail-fast。

#### Scenario: 新增长期保留回归 case
- **WHEN** 开发者新增一个要长期保留的 regression case
- **THEN** 该 case MUST 声明完整 metadata，并明确标记其 `retentionTier`、`lifecycle` 与 `runPolicy`

#### Scenario: 新增一次性诊断 case
- **WHEN** 开发者新增一个只用于问题定位或模型评估的临时 case
- **THEN** 该 case MUST 显式声明其非长期保留属性，而不是默认混入长期回归集

#### Scenario: case 缺失治理字段
- **WHEN** catalog 生成或 drift 检查发现 case 缺少必填 metadata
- **THEN** 系统 MUST 以确定性错误终止，并指出缺失字段与对应源码位置

### Requirement: 测试文档与 catalog MUST 明确分层并保持同步
`doc/test.md` 当前作为测试主题入口占位文件，不得手工维护当前 case 清单；当前 case 清单 MUST 来自 catalog 生成结果。若测试文档入口或治理规则发生变化，系统 MUST 在同一 change set 中同步更新测试文档入口与 agent 规则。

#### Scenario: 阅读当前有哪些测试 case
- **WHEN** AI 或开发者需要确认当前有效测试用例
- **THEN** 其读取入口 MUST 指向生成后的 catalog，而不是 `doc/test.md` 中的手工列表或 `tests/report/**` 的目录结构

#### Scenario: 调整测试文档 canonical 入口
- **WHEN** 测试治理文档新增、重命名或改变默认阅读入口
- **THEN** 系统 MUST 同步更新 `doc/README.md`、`AGENTS.md` 与相关测试入口说明
