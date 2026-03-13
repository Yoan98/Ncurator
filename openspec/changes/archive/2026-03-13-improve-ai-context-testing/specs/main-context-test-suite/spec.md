## ADDED Requirements

### Requirement: Main context 测试套件 MUST 支持 deterministic graph-level roundtrip 验证
系统 MUST 为 `main context` 阶段提供 deterministic graph-level 测试能力，能够在不依赖真实模型输出的前提下驱动完整 main graph，验证 `need_context -> main_context_human -> contextEvidence 回写 -> 再决策` 的主链路；该能力 MUST 支持脚本化 intent 决策序列与 context human 输出，以便稳定复现多轮 context 收敛。

#### Scenario: Context 解开歧义后转入直接执行
- **WHEN** deterministic case 首轮 intent 判定为 `need_context`，且 scripted context human 返回足以唯一消解指代的证据
- **THEN** main graph MUST 在回写 `contextEvidence` 后重新进入 intent，并在下一轮转入 `direct_human` 或等价非 context 路径

#### Scenario: Context 轮次达到上限后降级
- **WHEN** deterministic case 连续命中 `need_context` 且 `contextRounds` 达到上限
- **THEN** main graph MUST 停止继续进入 `main_context_human`，并按当前契约降级到 `main_plan`

### Requirement: Main context 用例 MUST 保护 context 证据收敛与边界语义
`main context` 的受治理用例 MUST 显式覆盖 context 证据的增量价值、重复/空证据处理、不确定性保留与范围边界保持，避免把“轮次增加”误当作“上下文已解决”。

#### Scenario: 空或重复证据不放大状态
- **WHEN** context human 返回空摘要、空交付或与既有 `contextEvidence` 重复的内容
- **THEN** 测试 MUST 验证 `contextEvidence` 不会因无效输入异常膨胀，且运行仍能按有限轮次收敛

#### Scenario: 证据不足时保留不确定性
- **WHEN** context human 无法确认关键指代、对象或事实
- **THEN** 测试 MUST 验证后续状态继续保留“不足/待确认”语义，而不会伪造已澄清的事实

#### Scenario: Scope 与 local-first 在 context 往返中保持稳定
- **WHEN** 用户输入带有选中资料范围且不允许非本地信息
- **THEN** 测试 MUST 验证 context 往返后 scope 约束和 local-first 语义继续保留，而不会被中间 evidence 漂移或放宽

### Requirement: Main context 测试套件 MUST 支持 batch-only live runtime 样本
系统 MUST 为 `main context` 阶段提供有限的 live runtime 样本，直接通过生产 `AiRunService` 运行真实模型配置，并用受控的 history / scope / store fixture 验证 context 质量；这类样本 MUST 默认为 `batch_only` 或等价非 gating 运行策略，且在未启用 live 测试环境时 MUST 可被稳定跳过。

#### Scenario: 指代型 live 样本触发 context 并完成收敛
- **WHEN** live runtime 样本输入“继续刚才第二步”“把它保存成正式版”等依赖历史指代的信息
- **THEN** 测试 MUST 能观测该运行是否进入 context、使用了多少轮次，以及最终是否正确转入可执行路径

#### Scenario: 本地证据不足型 live 样本不伪造澄清结果
- **WHEN** live runtime 样本要求只依赖当前本地资料回答超出证据范围的问题
- **THEN** 测试 MUST 验证该运行在 context 往返后仍保持证据不足语义，而不会伪造已解决的事实

#### Scenario: Live 环境未启用
- **WHEN** 运行 live runtime context 样本但缺少 `AI_LIVE_ENABLE` 或必需模型配置
- **THEN** 测试 MUST 以稳定的 skip 或等价隔离方式退出，而不会污染 gating 结论
