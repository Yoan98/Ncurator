## ADDED Requirements

### Requirement: Capability 用例 MUST 声明统一治理 metadata 并进入 catalog
每个 capability test case 除已有的执行输入与断言信息外，MUST 显式声明统一治理 metadata，包括但不限于 `description`、`scenarioTags`、`expectedOutcome`、`requiredFixtures`、`retentionTier`、`lifecycle`、`runPolicy` 与 `capabilityArea`；这些字段 MUST 进入 catalog，作为 capability suite 当前 case 集的真相源。

#### Scenario: 新增长期保留 capability 回归 case
- **WHEN** 开发者为某个 tool 新增长期回归 case
- **THEN** 该 case MUST 在定义时声明其治理 metadata，并在 catalog 中被识别为长期保留 case

#### Scenario: 新增显式缺口或临时诊断 case
- **WHEN** 开发者新增一个用于显式缺口验证或一次性定位的 capability case
- **THEN** 该 case MUST 显式标记为非长期保留层级，而不是默认进入主回归集
