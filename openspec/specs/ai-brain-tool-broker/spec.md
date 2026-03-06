# ai-brain-tool-broker Specification

## Purpose
TBD - created by archiving change main-human-brain-architecture. Update Purpose after archive.
## Requirements
### Requirement: Expose lightweight skill cards to brain
系统 MUST 向 human brain 常驻暴露轻量 `SkillCard` 目录，而不是直接暴露全量工具集合。

#### Scenario: Brain reviews available skills before deciding
- **WHEN** human 进入新的一步决策
- **THEN** brain 收到可用 `SkillCard` 列表，并基于当前状态自行决定是否 `load_skill`

### Requirement: Materialize active tools only from loaded skills
运行时 MUST 仅根据当前 `activeSkillIds` 生成 `activeTools`，并在 `load_skill` 后把对应 skill 内容与工具加入运行态。

#### Scenario: Load skill to activate tools
- **WHEN** brain 输出 `load_skill`
- **THEN** runtime 读取该 skill 的内容、资源索引与工具定义，并更新 `loadedSkills`、`activeSkillIds`、`activeTools`

### Requirement: Keep active skill set bounded
运行时 MUST 对 `activeSkillIds` 设置数量上限，默认最多保留 2 个 active skills，避免再次退化为全量工具暴露。

#### Scenario: Activate a new skill after two skills are already active
- **WHEN** brain 加载第 3 个无关 skill
- **THEN** runtime 按既定替换策略裁剪旧的 active skill，并只保留上限数量的 `activeSkillIds`

### Requirement: Keep ToolNode execution scoped to active tools
每一步中 `ToolNode` 执行的工具集合 MUST 与当前 `activeTools` 保持一致，brain 不得调用未激活的工具。

#### Scenario: Brain invokes a tool outside the active skill set
- **WHEN** brain 输出不在 `activeTools` 内的 `toolName`
- **THEN** runtime MUST 拒绝执行并返回结构化步骤错误

### Requirement: Expose skill activation reasoning for observability
系统 MUST 记录并可观测每一步的公开 narrative 与内部诊断信息，至少包含 action、active skills、active tools 以及 rationale。

#### Scenario: Skill activation trace
- **WHEN** brain 完成一步决策或 runtime 完成一次 skill 加载
- **THEN** 运行时记录 `human_step` 与内部诊断信息用于回放与调试
