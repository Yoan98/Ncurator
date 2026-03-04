# ai-brain-tool-broker Specification

## Purpose
TBD - created by archiving change main-human-brain-architecture. Update Purpose after archive.
## Requirements
### Requirement: Build step-scoped active tools from full registry
系统 MUST 维护全量工具注册表，并在 human 的每一步基于当前任务状态生成步骤级 `activeTools` 子集供 brain 使用。

#### Scenario: Step-level toolset generation
- **WHEN** human 进入新的一步决策
- **THEN** Tool Broker 从全量 registry 计算并返回该步骤的 `activeTools`

### Requirement: Apply deterministic broker filtering rules
Tool Broker MUST 采用确定性规则进行筛选，至少包含 capability 白名单、前置条件门禁、slot 可用性校验、策略约束与目标匹配。

#### Scenario: Filter out unavailable tools
- **WHEN** 某工具前置条件不满足（如缺 workspace、缺输入 slot）
- **THEN** Broker 将该工具从 `activeTools` 中剔除

### Requirement: Constrain active toolset size
Broker 输出的 `activeTools` MUST 受数量上限约束，默认目标范围为 3~6；当候选不足时 MUST 触发定义好的兜底策略。

#### Scenario: Too many candidate tools
- **WHEN** Broker 得到超过上限的候选工具
- **THEN** 按排序规则截断为上限数量并输出

#### Scenario: Too few candidate tools
- **WHEN** Broker 过滤后候选数量低于下限
- **THEN** 触发兜底放宽规则或返回显式不可继续信号

### Requirement: Keep bindTools and ToolNode sets consistent per step
每一步中用于 `bindTools` 的工具集合与用于 `ToolNode` 执行的工具集合 MUST 保持一致，并 SHOULD 通过 `activeToolSetId` 进行关联。

#### Scenario: Step toolset consistency
- **WHEN** brain 生成了工具调用
- **THEN** 执行器使用与该步骤相同的 `activeTools` 集合执行该调用

### Requirement: Expose broker reasoning for observability
系统 MUST 记录并可观测 Broker 的筛选结果与理由，至少包含候选集合、最终 active 集合、被拒绝原因。

#### Scenario: Broker decision trace
- **WHEN** 一步工具筛选完成
- **THEN** 运行时记录该步筛选快照与关键决策理由用于回放与调试

