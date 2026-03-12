## ADDED Requirements

### Requirement: Human 测试 MUST 支持分阶段评估套件与批次执行
human 测试套件 MUST 以分阶段评估方式组织 `P0`、`P1`、`P2`、`P3` 四类工作，其中 `P0` 用于基线诊断，`P1` 用于能力覆盖扩展，`P2` 用于多轮评估与稳定性分析，`P3` 用于升级前后对比验证；测试运行与文档记录 MUST 能明确区分单次回归执行与关键 case 多轮评估批次。

#### Scenario: 执行 P0 基线诊断套件
- **WHEN** 开发者运行 human 基线诊断用例
- **THEN** 套件 MUST 覆盖至少一个成功路径、一个预期阻塞路径、一个 fail-fast 路径与一个步数预算边界路径

#### Scenario: 执行关键 case 多轮评估批次
- **WHEN** 开发者对关键 human case 发起多轮执行
- **THEN** 套件 MUST 保留每轮运行结果并支持后续按 case 聚合稳定性、软成功比例与阻塞语义正确率

## MODIFIED Requirements

### Requirement: Human 测试 MUST 支持真实任务目标验证与可复用用例扩展
human 用例 MUST 以真实任务目标作为输入（例如读取 workspace 文件信息、编辑 docx、基于本地证据收敛阻塞），并 MUST 支持通过新增脚本持续扩展任务集合；每个用例同时 MUST 显式声明 `objective`、`expectedOutcome`、`scenarioTags`、`maxSteps` 与前置输入，以便同一任务在单次回归与多轮评估批次中复用。

#### Scenario: 新增 P0 基线成功用例
- **WHEN** 开发者新增“读取 workspace 文件第一行并返回结构化结果”的 human 测试脚本
- **THEN** 新用例 MUST 可在不修改测试框架核心代码的前提下被发现、执行并输出结构化任务结果断言

#### Scenario: 为关键任务配置多轮评估
- **WHEN** 开发者将现有 human 任务标记为关键评估 case
- **THEN** 相同用例定义 MUST 可复用于多轮运行，且无需复制测试逻辑即可比较跨轮次结果

### Requirement: Human 测试 MUST 评估渐进式解决问题能力
human 用例结果 MUST 通过结构化报告信号评估“渐进式解决问题”行为，至少覆盖失败恢复、策略切换、重复调用控制、步数预算占用、完成收敛与阻塞收敛等维度；结果判定 MUST 支持区分 `hard_pass`、`soft_pass`、`expected_block`、`unexpected_block`、`harness_fail`，固定分析文案 MUST NOT 作为唯一评估依据。

#### Scenario: 可恢复失败后完成任务但判定为 soft_pass
- **WHEN** human 在工具调用中出现可恢复失败并在后续步骤调整策略后完成目标
- **THEN** 结果评估 MUST 同时保留成功终态与恢复证据，并将该运行标记为低于无绕路完成的质量等级

#### Scenario: 简单任务无绕路完成并判定为 hard_pass
- **WHEN** human 在有限步数内完成简单单任务，且未出现无效重试或可恢复错误
- **THEN** 结果评估 MUST 将该运行判定为 `hard_pass`

#### Scenario: 本应成功的任务意外阻塞
- **WHEN** 预期成功的 human 任务最终以阻塞终态收敛
- **THEN** 结果评估 MUST 将该运行判定为 `unexpected_block`，而不是与预期阻塞路径混同

### Requirement: Human 报告 MUST 输出结构化步骤信号供后续分析
human 测试结果 MUST 输出适合后续分析器消费的结构化步骤信号，至少包含 `toolSequence`、`stepActionSequence`、`skillActivationSequence`、失败断言 ID、最终 human 动作，以及与完成或阻塞结果相关的关键执行信号；当用例进入评估模式时，报告同时 MUST 支持表达任务目标、预算配置、结果质量与恢复行为所需的分析输入。

#### Scenario: 任务完成并保留评估输入
- **WHEN** human 用例通过若干工具步骤完成目标
- **THEN** 报告 MUST 同时保留完成终态、关键步骤序列与用于后续质量分级的任务目标、步数预算和恢复相关结构化输入

#### Scenario: 任务阻塞并保留阻塞评估输入
- **WHEN** human 用例在审批、工作区、步数预算或本地证据不足等不可恢复条件下阻塞
- **THEN** 报告 MUST 包含最终 human 动作、阻塞结果码、相关事件证据以及支持判断该阻塞是否符合预期的结构化输入
