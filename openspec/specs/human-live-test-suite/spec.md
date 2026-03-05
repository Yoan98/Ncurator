# human-live-test-suite Specification

## Purpose
TBD - created by archiving change add-script-first-ai-testing-harness. Update Purpose after archive.
## Requirements
### Requirement: Human live 测试 MUST 仅针对 human 子图执行并使用真实模型配置
human live 测试框架 MUST 直接运行 human 子图执行器，且 MUST 使用真实 LLM 配置（`base_url`、`model_name`、`api_key`）完成任务验证；该套件 MUST NOT 以 main graph 作为必经入口。

#### Scenario: 运行 human live 基线用例
- **WHEN** 开发者执行 human live 测试
- **THEN** 系统 MUST 启动 human 子图执行流程并使用已激活的真实模型配置完成推理

#### Scenario: 缺失模型配置
- **WHEN** human live 测试启动时缺少可用 LLM 配置
- **THEN** 测试运行器 MUST fail-fast 并输出缺失字段与配置指引

### Requirement: Human live 测试 MUST 支持真实任务目标验证与可复用用例扩展
human live 用例 MUST 以真实任务目标作为输入（例如读取 workspace 文件信息、写入/编辑 docx），并 MUST 支持通过新增脚本持续扩展任务集合。

#### Scenario: 新增读取并写入 docx 任务
- **WHEN** 开发者新增“读取文件信息并生成简单 docx”的测试脚本
- **THEN** 新用例 MUST 可在不修改框架核心代码的前提下被发现并执行

#### Scenario: 执行编辑指定 docx 任务
- **WHEN** 用例目标为“编辑 workspace 下指定 docx 并保存”
- **THEN** 测试 MUST 断言任务输出状态、关键结果字段与目标文件变更

### Requirement: Human live 测试 MUST 评估渐进式解决问题能力
human live 用例结果 MUST 包含对“渐进式解决问题”行为的评估，至少覆盖失败恢复、策略切换、完成收敛三个维度。

#### Scenario: 遇到可恢复失败后继续推进
- **WHEN** human 步骤中出现可恢复失败
- **THEN** 结果评估 MUST 验证后续步骤存在调整策略并继续执行的证据

#### Scenario: 命中不可恢复阻塞后收敛
- **WHEN** human 步骤命中不可恢复条件（如审批拒绝或工作区缺失）
- **THEN** 结果评估 MUST 验证任务以阻塞终态明确收敛并给出阻塞原因

### Requirement: Human live 测试 MUST 显式声明前置输入并支持审批策略注入
每个 human live 用例 MUST 声明所需 workspace 与输入文件前置条件，且测试运行器 MUST 支持按用例注入审批策略（如自动通过或风险拒绝）。

#### Scenario: workspace 输入缺失
- **WHEN** 用例声明的 workspace 文件不存在
- **THEN** 测试运行器 MUST 在执行前终止并输出缺失输入清单

#### Scenario: 使用拒绝审批策略
- **WHEN** 用例配置为拒绝中高风险审批
- **THEN** 测试结果 MUST 呈现阻塞路径并包含审批相关证据

