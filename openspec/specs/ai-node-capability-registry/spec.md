# ai-node-capability-registry Specification

## Purpose
TBD - created by archiving change langgraph-chat-ai-architecture. Update Purpose after archive.
## Requirements
### Requirement: Provide registry-based capability dispatch
运行时 MUST 通过 registry 同时管理 capability 执行器与其工具元数据，并支持 human skill loader/工具执行两类路由场景。

#### Scenario: Main dispatches task and human resolves capability by registry
- **WHEN** main 将任务派发到 human
- **THEN** human 在步骤执行时通过 registry 解析 capability 并路由到对应执行器

#### Scenario: Human skill loader resolves tools through capability metadata
- **WHEN** runtime 根据已激活的 skill materialize `activeTools`
- **THEN** skill loader 使用 registry 中的 capability builder 生成对应工具集合

### Requirement: Keep registry open for future node families
registry 扩展 MUST 支持后续新增 capability 或工具族，而无需重写 main/human 执行主循环。

#### Scenario: New capability family registered
- **WHEN** 新增 capability（例如 `excel`）及其工具元数据
- **THEN** 系统可在保持主循环不变的前提下被 skill catalog 与执行器共同使用

### Requirement: Fail fast on unknown capabilities
未注册 capability 或工具 MUST 快速失败并返回结构化错误，禁止静默降级为成功。

#### Scenario: Unregistered capability kind
- **WHEN** 任务或动作引用了未注册 capability
- **THEN** runtime 立即返回 unknown-capability 错误并终止该路由

#### Scenario: Unregistered tool name
- **WHEN** brain 调用了未在当前 registry/active tools 中注册的工具
- **THEN** runtime 返回 unknown-tool 错误并拒绝执行
