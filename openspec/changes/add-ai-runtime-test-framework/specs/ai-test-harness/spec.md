## ADDED Requirements

### Requirement: 提供统一的 AI 测试运行框架
系统 MUST 提供统一的 AI 测试运行框架，用于在 Main 进程侧执行 AI 架构测试并输出稳定结果。

#### Scenario: 运行指定测试套件
- **WHEN** 开发者执行 AI 测试命令并指定某个 suite
- **THEN** 框架 MUST 只运行该 suite 的用例并输出通过/失败统计与退出码

#### Scenario: 运行完整 AI 测试集合
- **WHEN** 开发者执行完整 AI 测试命令
- **THEN** 框架 MUST 按统一入口执行 tool、human、context、plan 全部 suite

### Requirement: 用例输入 MUST 使用结构化 DSL 契约
系统 MUST 为 AI 测试定义结构化用例 DSL，并在执行前完成 schema 校验，拒绝非法测试输入。

#### Scenario: 合法 DSL 用例执行
- **WHEN** 用例文件满足 DSL 契约
- **THEN** 框架 MUST 加载并执行该用例

#### Scenario: 非法 DSL 用例拦截
- **WHEN** 用例缺失必填字段或字段类型不合法
- **THEN** 框架 MUST 在执行前失败并返回结构化校验错误

### Requirement: 框架 MUST 支持夹具与依赖替身注入
系统 MUST 支持测试夹具与运行时依赖替身注入，以保证 AI 测试可复现且不依赖真实外部环境。

#### Scenario: 使用模型替身执行 human 测试
- **WHEN** human 测试配置了模型替身输出
- **THEN** 框架 MUST 使用替身结果驱动步骤循环而非真实模型调用

#### Scenario: 使用工具替身执行 tool 测试
- **WHEN** tool 测试配置了工具返回替身
- **THEN** 框架 MUST 使用替身返回并继续完成事件与结果断言

### Requirement: 框架 MUST 输出标准化测试报告与失败分类
系统 MUST 输出机器可读与人可读两类测试报告，并对失败进行稳定分类，供自动修复建议消费。

#### Scenario: 生成结构化结果
- **WHEN** 一次 AI 测试运行结束
- **THEN** 框架 MUST 生成包含 suite 统计、失败分类、关键断言结果的 JSON 报告

#### Scenario: 生成可读摘要
- **WHEN** 一次 AI 测试运行结束
- **THEN** 框架 MUST 生成 Markdown 摘要，说明失败用例与建议修复锚点

### Requirement: 测试规范文档与 Skill 触发约束 MUST 同步建立
系统 MUST 在实现该能力时同步建立测试规范文档与对应 Skill 触发约束，确保 AI 测试任务执行前读取规范。

#### Scenario: 测试规范文档落地
- **WHEN** 测试框架能力进入实现阶段
- **THEN** 系统 MUST 在 `doc/` 下提供 AI 测试规范文档，覆盖分层测试、用例契约与结果输出规则

#### Scenario: Skill 约束触发
- **WHEN** Codex 处理 AI 测试框架、测试用例或测试报告相关任务
- **THEN** 对应测试 Skill MUST 要求先读取 AI 测试规范文档
