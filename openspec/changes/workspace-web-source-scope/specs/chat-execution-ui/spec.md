## MODIFIED Requirements

### Requirement: Provide imported-document `@` targeting in chat
聊天 UI MUST 将 `@` 选择从“已导入文档”扩展为统一资料范围选择，并在发送运行请求时同时传递已准备文档标识与结构化范围信息，而不再仅发送文档 ID 列表。

#### Scenario: 输入 `@` 查看范围候选
- **WHEN** 用户在聊天输入框中输入 `@`
- **THEN** 候选列表 MUST 来自已配置的工作空间、目录、文件与网页资料，并支持用户选择多个范围项

### Requirement: Require workspace selection for executable runs
聊天 UI MUST 通过已配置工作空间的选择结果收集工作空间上下文，用于文件读取或终端执行类能力；当运行需要工作空间边界而当前没有可用工作空间上下文时，UI MUST 提示用户先选择或配置工作空间，而不是要求用户手动输入根路径。

#### Scenario: 范围内存在本地文件但没有工作空间上下文
- **WHEN** 用户发送的问题需要访问本地文件，且当前没有任何已配置或已选定的工作空间可以作为访问边界
- **THEN** UI MUST 提示用户先配置或选择工作空间后再继续运行

## ADDED Requirements

### Requirement: 在聊天输入区展示未准备资料提示
聊天 UI MUST 在已选范围中明确区分未准备的本地文件或目录，并在合适位置提示这些范围可能导致 AI 直接读取原文件、耗时更长或增加 token 消耗。

#### Scenario: 已选范围包含未准备文件
- **WHEN** 用户已经在聊天输入区选择了一个未准备文件作为范围
- **THEN** UI MUST 在输入区附近展示该文件未准备的状态提示，并告知其可能增加处理成本
