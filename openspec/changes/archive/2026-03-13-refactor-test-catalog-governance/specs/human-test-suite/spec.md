## ADDED Requirements

### Requirement: Human 用例 MUST 声明统一治理 metadata 与评估角色
每个 human test case 在已有 `objective`、`expectedOutcome`、`scenarioTags`、`maxSteps` 与前置输入之外，MUST 额外声明统一治理 metadata，并明确其在评估体系中的角色，例如长期保留回归、批次基线、升级对比或一次性诊断；这些字段 MUST 进入 catalog，并作为 human suite 当前 case 集和批次分析边界的真相源。

#### Scenario: 新增 P2/P3 基线 human case
- **WHEN** 开发者将某个 human case 纳入正式评估基线或 compare 集
- **THEN** 该 case MUST 显式声明其长期保留属性与批次运行策略，而不是仅依赖脚本 profile 或历史 batch 命名约定

#### Scenario: 新增一次性 human 诊断 case
- **WHEN** 开发者新增一个只用于当前模型异常排查的 human case
- **THEN** 该 case MUST 显式标记为诊断或非主门禁 case，避免混入长期回归与升级对比集合

### Requirement: Human 批次与分析脚本 MUST 通过 catalog 识别当前受治理 case
human suite 的 assessment、batch runner 与 compare 脚本 MUST 通过 catalog 识别当前受治理的 human case，并依据 lifecycle 与 runPolicy 过滤不应进入当前批次的 case。

#### Scenario: 生成默认 P2 批次
- **WHEN** 系统运行默认 human 批次
- **THEN** 默认 case 集 MUST 来自 catalog 中当前标记为对应运行策略的 case，而不是硬编码在脚本中或从历史报告目录反推

#### Scenario: 历史 human 报告仍然存在
- **WHEN** 报告目录中保留已归档或已降级的 human case 运行结果
- **THEN** assessment 与 compare MUST 不得将其当作当前有效基线输入
