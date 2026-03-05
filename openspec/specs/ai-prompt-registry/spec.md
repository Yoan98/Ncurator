# ai-prompt-registry Specification

## Purpose
TBD - created by archiving change refactor-ai-prompts-human-execution. Update Purpose after archive.
## Requirements
### Requirement: 提供统一的 AI Prompt 注册目录
系统 MUST 在 Main 进程 AI 域内提供统一的 prompt 注册目录，用于集中维护 main、human、memory 三类提示词，并保持与运行时分层边界一致。

#### Scenario: 新增或调整提示词
- **WHEN** 开发者需要新增或优化 AI 提示词
- **THEN** 提示词内容 MUST 落在统一注册目录下按职责分层维护，而不是散落在节点实现文件内联字符串中

#### Scenario: 运行时读取提示词
- **WHEN** main/human/memory 节点发起模型调用
- **THEN** 节点 MUST 通过 prompt registry 获取对应提示词内容

### Requirement: Prompt 构建 MUST 使用结构化输入与稳定输出契约
Prompt registry MUST 提供结构化构建接口，输入参数 MUST 明确字段边界，输出 MUST 明确 system/user（或等价消息段）与 JSON 契约约束文本。

#### Scenario: 构建 main intent 提示词
- **WHEN** intent 节点请求 prompt
- **THEN** registry MUST 基于结构化输入生成稳定的 system/user 文本，并包含对应输出格式约束

#### Scenario: 构建 human brain 提示词
- **WHEN** human brain 节点请求 prompt
- **THEN** registry MUST 输出包含工具调用约束、收敛策略与执行规则的提示词文本，且不依赖任务模式字段

### Requirement: Prompt 优化过程 MUST 可审计且可回放
系统 MUST 使提示词优化具备可追踪性，确保同一运行上下文下提示词来源可定位，并支持行为回归比较。

#### Scenario: 定位一次行为回归
- **WHEN** 升级提示词后出现执行行为变化
- **THEN** 开发者 MUST 能定位到对应 registry 文件与构建入口，并基于同类输入进行回放对比

#### Scenario: 节点实现审计
- **WHEN** 对 AI 运行时进行代码审计
- **THEN** 核心提示词 MUST 在 registry 集中可见，节点实现文件不再承担主要提示词文本定义职责

