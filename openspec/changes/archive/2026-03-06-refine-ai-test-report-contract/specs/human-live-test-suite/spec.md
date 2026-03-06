## MODIFIED Requirements

### Requirement: Human live 测试 MUST 评估渐进式解决问题能力
human live 用例结果 MUST 通过结构化报告信号评估“渐进式解决问题”行为，至少覆盖失败恢复、策略切换、完成收敛三个维度；固定分析文案 MUST NOT 作为唯一评估依据。

#### Scenario: 遇到可恢复失败后继续推进
- **WHEN** human 步骤中出现可恢复失败
- **THEN** 结果评估 MUST 通过事件流与结构化信号验证后续步骤存在调整策略并继续执行的证据

#### Scenario: 命中不可恢复阻塞后收敛
- **WHEN** human 步骤命中不可恢复条件（如审批拒绝或工作区缺失）
- **THEN** 结果评估 MUST 通过 `executionStatus`、`executionResultCode`、最终 human 动作与相关事件证据验证任务以阻塞终态明确收敛

## ADDED Requirements

### Requirement: Human live 报告 MUST 分离 case verdict 与 execution outcome
human live 测试报告 MUST 将测试 case 自身是否通过与 human 实际执行结果分离表达，避免预期阻塞路径或前置环境失败被误读为同一种结果。

#### Scenario: 审批拒绝是预期结果
- **WHEN** human live 用例以“审批拒绝后阻塞收敛”为目标，且断言符合预期
- **THEN** 报告 MUST 将 `caseStatus` 记录为 `passed`，并将 `executionStatus` 记录为 `blocked`、`executionResultCode` 记录为 `approval_denied`

#### Scenario: 缺失 live 配置导致未执行
- **WHEN** human live 用例在启动前缺少必需模型配置
- **THEN** 报告 MUST 将 `caseStatus` 记录为 `failed`、`caseErrorCode` 记录为 `live_config_missing`，并将 `executionStatus` 记录为 `not_run`

### Requirement: Human live 报告 MUST 输出结构化步骤信号供后续分析
human live 测试结果 MUST 输出适合后续分析器消费的结构化步骤信号，至少包含 `toolSequence`、失败断言 ID、最终 human 动作，以及与完成或阻塞结果相关的关键执行信号。

#### Scenario: 任务完成并调用 complete_task
- **WHEN** human live 用例通过若干工具步骤完成目标
- **THEN** `signals.json` MUST 包含工具调用顺序、最终 human 动作 `complete_task` 与完成结果码

#### Scenario: 任务阻塞并调用 block_task
- **WHEN** human live 用例在审批、工作区或其他不可恢复条件下阻塞
- **THEN** `signals.json` MUST 包含最终 human 动作 `block_task` 以及与阻塞结果相关的步骤信号
