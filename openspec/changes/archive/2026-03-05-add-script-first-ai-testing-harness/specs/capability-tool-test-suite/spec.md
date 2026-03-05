## ADDED Requirements

### Requirement: Capability 测试框架 MUST 采用脚本优先并支持按 tool 粒度扩展
系统 MUST 提供脚本式测试框架用于 capability 测试，且测试组织方式 MUST 支持“一个 tool 一个测试用例”，并可通过新增脚本文件持续扩展而无需重建框架。

#### Scenario: 新增一个 docx 工具测试
- **WHEN** 开发者希望为 `docx_search` 增加新测试
- **THEN** 开发者 MUST 仅通过新增一个测试脚本文件完成接入，且无需修改测试框架核心流程

#### Scenario: 执行 tool 粒度回归
- **WHEN** 运行 capability 测试套件
- **THEN** 测试结果 MUST 能按 tool 与 case 维度独立报告通过/失败状态

### Requirement: Capability 测试 MUST 直接调用生产工具入口而非复刻业务逻辑
capability 测试执行路径 MUST 直接调用生产代码中的 tool 入口与运行逻辑，测试代码 MUST NOT 复制或重写业务实现。

#### Scenario: 执行 docx 替换测试
- **WHEN** 测试运行 `docx_apply_ops` 的替换场景
- **THEN** 执行链路 MUST 使用生产实现中的工具构建与执行入口，而不是测试专用替代实现

#### Scenario: 执行 terminal 边界测试
- **WHEN** 测试运行 `terminal_run_command` 的 workspace 边界场景
- **THEN** 边界校验与风险审批逻辑 MUST 来自生产实现而非测试内 mock 规则

### Requirement: Capability 测试 MUST 显式校验并声明 fixture 与 workspace 前置条件
每个 capability 用例 MUST 声明执行所需输入（例如 docx 文件、workspace 目录），测试运行器 MUST 在执行前校验前置条件并在缺失时 fail-fast 输出缺失清单。

#### Scenario: docx fixture 缺失
- **WHEN** `docx_replace_text` 用例声明的源 docx 文件不存在
- **THEN** 测试运行器 MUST 终止该用例执行并输出明确的缺失文件路径与修复提示

#### Scenario: 前置条件满足后执行
- **WHEN** 用例声明的 fixture 与 workspace 均可用
- **THEN** 测试运行器 MUST 进入 `setup -> run -> assert` 流程并产生完整测试结果

### Requirement: Capability 测试 MUST 覆盖单工具与组合编辑流程两类验证
测试套件 MUST 同时支持单工具行为验证（如搜索、替换）与多工具组合流程验证（如打开-搜索-编辑-保存-校验）。

#### Scenario: 单工具有效性验证
- **WHEN** 用例仅验证 `docx_search`
- **THEN** 测试 MUST 断言匹配结果、返回码与关键输出字段满足预期

#### Scenario: 组合编辑流程验证
- **WHEN** 用例执行 `docx_open -> docx_search -> docx_apply_ops -> docx_save -> docx_validate`
- **THEN** 测试 MUST 断言流程成功收敛且输出产物符合预期
