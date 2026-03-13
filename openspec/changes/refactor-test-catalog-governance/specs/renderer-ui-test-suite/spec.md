## ADDED Requirements

### Requirement: Renderer 与 E2E 用例 MUST 声明统一治理 metadata 与门禁角色
`tests/renderer/**`、`tests/e2e/**/deterministic/**` 与 `tests/e2e/**/ai-live/**` 下的 UI 相关 case MUST 声明统一治理 metadata，并明确其门禁角色、保留层级和运行策略；这些字段 MUST 进入 catalog，以区分长期 deterministic 回归与非阻塞 live 诊断。

#### Scenario: 新增 deterministic UI 回归 case
- **WHEN** 开发者新增一个需要进入稳定回归门禁的 renderer contract 或 deterministic e2e case
- **THEN** 该 case MUST 显式声明其 gating 角色与长期保留属性

#### Scenario: 新增 ai-live UI 诊断 case
- **WHEN** 开发者新增一个 AI 驱动的 live UI 诊断 case
- **THEN** 该 case MUST 显式标记为非主门禁运行策略，而不是仅通过目录名隐式表达

### Requirement: UI suite 的当前 case 集 MUST 由 catalog 而不是报告目录定义
renderer 与 e2e suite 的聚合、摘要与后续 AI 读取流程 MUST 以 catalog 作为当前 case 集的真相源，不得通过扫描 `tests/report/e2e-*` 或 `tests/report/renderer-*` 目录判断哪些 UI case 仍然有效。

#### Scenario: 读取当前 Chat UI 测试集
- **WHEN** AI 或开发者需要了解当前 Chat 相关 UI 测试有哪些
- **THEN** 系统 MUST 从 catalog 返回当前有效 case，并允许基于门禁角色和保留层级进行筛选

#### Scenario: 历史 UI 报告目录未清理
- **WHEN** 报告目录中仍保留旧 UI case 的截图、trace 或 summary
- **THEN** 系统 MUST 将其视为历史证据，而不是自动推断该 case 仍属于当前 UI 测试集
