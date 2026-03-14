# document-draft-review Specification

## Purpose
TBD - created by archiving change refactor-conversation-workbench. Update Purpose after archive.
## Requirements
### Requirement: 审阅阶段只在整次编辑运行完成后创建
系统 MUST 在一次 AI 运行中所有可编辑任务都完成后，才创建待审阅草稿集合；在运行尚未完成时，系统 MUST NOT 因单个编辑块而打断当前运行并请求用户逐块确认。

#### Scenario: 多次编辑后统一进入审阅
- **WHEN** 一次运行连续完成多个文档块或多个文档的编辑
- **THEN** 系统 MUST 在全部编辑任务结束后一次性生成待审阅草稿集合，而不是在每次小改动后弹出确认

#### Scenario: 没有编辑结果时不创建审阅集合
- **WHEN** 一次运行没有产生任何可提交的文档修改
- **THEN** 系统 MUST 不进入草稿审阅阶段，也 MUST NOT 展示空的提交确认流程

### Requirement: 草稿审阅状态 MUST 可持久化恢复
系统 MUST 持久化待审阅草稿、变更单元、用户接受/拒绝决策、源文件版本信息和关联运行标识，使用户在切换会话、刷新页面或重启应用后仍可继续审阅未提交结果。

#### Scenario: 应用重启后恢复待审阅草稿
- **WHEN** 用户在存在未提交草稿的情况下关闭并重新打开应用
- **THEN** 系统 MUST 恢复对应的待审阅文档、每块决策状态和提交入口

### Requirement: 最终提交前 MUST 支持逐块接受或拒绝
系统 MUST 支持用户按变更单元逐块接受或拒绝修改，并 MUST 在所有变更单元都得到明确决策前阻止最终提交；最终提交时 MUST 仅应用被接受的变更单元。

#### Scenario: 存在未决变更时阻止提交
- **WHEN** 用户尚未对某些变更单元执行接受或拒绝
- **THEN** 系统 MUST 禁用或阻止最终提交，并提示仍有待决修改

#### Scenario: 部分接受后生成最终提交内容
- **WHEN** 用户接受部分变更并拒绝其余变更，且所有变更单元都已完成决策
- **THEN** 系统 MUST 仅基于已接受变更生成最终提交版本

### Requirement: 最终提交前 MUST 校验源文件新鲜度
系统 MUST 在最终提交前校验源文件是否仍与草稿创建时一致；若源文件已被外部修改，系统 MUST 阻止提交，并向用户明确提示需要重新生成草稿或手动处理冲突。

#### Scenario: 审阅期间源文件被外部修改
- **WHEN** 用户开始审阅后，源文件被外部程序或用户手动修改
- **THEN** 系统 MUST 在提交时阻止写回，并展示源文件已变化的冲突提示

### Requirement: 草稿审阅 MUST 提供格式感知的差异载荷
系统 MUST 为每个待审阅文档提供格式标识、变更单元类型、before/after 摘要、定位信息与可选预览引用，以支持 docx 与后续 pdf、xlsx、pptx、md、txt 等格式复用统一审阅框架。

#### Scenario: docx 草稿返回块级差异信息
- **WHEN** 系统生成一个 docx 草稿文档的审阅结果
- **THEN** 每个变更单元 MUST 提供可用于块级对比的 before/after 内容、块标识和文档格式信息
