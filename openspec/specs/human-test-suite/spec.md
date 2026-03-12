# human-test-suite Specification

## Purpose
TBD - created by archiving change add-script-first-ai-testing-harness. Update Purpose after archive.
## Requirements
### Requirement: Human 测试 MUST 支持分阶段评估套件与批次执行
human 测试套件 MUST 以分阶段评估方式组织 `P0`、`P1`、`P2`、`P3` 四类工作，其中 `P0` 用于基线诊断，`P1` 用于能力覆盖扩展，`P2` 用于多轮评估与稳定性分析，`P3` 用于升级前后对比验证；测试运行与文档记录 MUST 能明确区分单次回归执行与关键 case 多轮评估批次。

#### Scenario: 执行 P0 基线诊断套件
- **WHEN** 开发者运行 human 基线诊断用例
- **THEN** 套件 MUST 覆盖至少一个成功路径、一个预期阻塞路径、一个 fail-fast 路径与一个步数预算边界路径

#### Scenario: 执行关键 case 多轮评估批次
- **WHEN** 开发者对关键 human case 发起多轮执行
- **THEN** 套件 MUST 保留每轮运行结果并支持后续按 case 聚合稳定性、软成功比例与阻塞语义正确率

### Requirement: Human 测试 MUST 仅针对 human 子图执行并使用真实模型配置
human 测试框架 MUST 直接运行 human 子图执行器，且 MUST 使用真实 LLM 配置（`base_url`、`model_name`、`api_key`）完成任务验证；该套件 MUST NOT 以 main graph 作为必经入口。

#### Scenario: 运行 human 基线用例
- **WHEN** 开发者执行 human 测试
- **THEN** 系统 MUST 启动 human 子图执行流程并使用已激活的真实模型配置完成推理

#### Scenario: 缺失模型配置
- **WHEN** human 测试启动时缺少可用 LLM 配置
- **THEN** 测试运行器 MUST fail-fast 并输出缺失字段与配置指引

### Requirement: Human 测试 MUST 支持真实任务目标验证与可复用用例扩展
human 用例 MUST 以真实任务目标作为输入（例如读取 workspace 文件信息、编辑 docx、基于本地证据收敛阻塞），并 MUST 支持通过新增脚本持续扩展任务集合；每个用例同时 MUST 显式声明 `objective`、`expectedOutcome`、`scenarioTags`、`maxSteps` 与前置输入，以便同一任务在单次回归与多轮评估批次中复用。

#### Scenario: 新增读取并写入 docx 任务
- **WHEN** 开发者新增“读取文件信息并生成简单 docx”的测试脚本
- **THEN** 新用例 MUST 可在不修改框架核心代码的前提下被发现并执行

#### Scenario: 执行编辑指定 docx 任务
- **WHEN** 用例目标为“编辑 workspace 下指定 docx 并保存”
- **THEN** 测试 MUST 断言任务输出状态、关键结果字段与目标文件变更

#### Scenario: 新增 P0 基线成功用例
- **WHEN** 开发者新增“读取 workspace 文件第一行并返回结构化结果”的 human 测试脚本
- **THEN** 新用例 MUST 可在不修改测试框架核心代码的前提下被发现、执行并输出结构化任务结果断言

#### Scenario: 为关键任务配置多轮评估
- **WHEN** 开发者将现有 human 任务标记为关键评估 case
- **THEN** 相同用例定义 MUST 可复用于多轮运行，且无需复制测试逻辑即可比较跨轮次结果

### Requirement: Human 测试 MUST 评估渐进式解决问题能力
human 用例结果 MUST 通过结构化报告信号评估“渐进式解决问题”行为，至少覆盖失败恢复、策略切换、重复调用控制、步数预算占用、完成收敛与阻塞收敛等维度；结果判定 MUST 支持区分 `hard_pass`、`soft_pass`、`expected_block`、`unexpected_block`、`harness_fail`，固定分析文案 MUST NOT 作为唯一评估依据。

#### Scenario: 遇到可恢复失败后继续推进
- **WHEN** human 步骤中出现可恢复失败
- **THEN** 结果评估 MUST 通过事件流与结构化信号验证后续步骤存在调整策略并继续执行的证据

#### Scenario: 命中不可恢复阻塞后收敛
- **WHEN** human 步骤命中不可恢复条件（如审批拒绝或工作区缺失）
- **THEN** 结果评估 MUST 通过 `executionStatus`、`executionResultCode`、最终 human 动作与相关事件证据验证任务以阻塞终态明确收敛

#### Scenario: 可恢复失败后完成任务但判定为 soft_pass
- **WHEN** human 在工具调用中出现可恢复失败并在后续步骤调整策略后完成目标
- **THEN** 结果评估 MUST 同时保留成功终态与恢复证据，并将该运行标记为低于无绕路完成的质量等级

#### Scenario: 简单任务无绕路完成并判定为 hard_pass
- **WHEN** human 在有限步数内完成简单单任务，且未出现无效重试或可恢复错误
- **THEN** 结果评估 MUST 将该运行判定为 `hard_pass`

#### Scenario: 本应成功的任务意外阻塞
- **WHEN** 预期成功的 human 任务最终以阻塞终态收敛
- **THEN** 结果评估 MUST 将该运行判定为 `unexpected_block`，而不是与预期阻塞路径混同

### Requirement: Human 测试 MUST 显式声明前置输入并支持审批策略注入
每个 human 用例 MUST 声明所需 workspace 与输入文件前置条件，且测试运行器 MUST 支持按用例注入审批策略（如自动通过或风险拒绝）。

#### Scenario: workspace 输入缺失
- **WHEN** 用例声明的 workspace 文件不存在
- **THEN** 测试运行器 MUST 在执行前终止并输出缺失输入清单

#### Scenario: 使用拒绝审批策略
- **WHEN** 用例配置为拒绝中高风险审批
- **THEN** 测试结果 MUST 呈现阻塞路径并包含审批相关证据

### Requirement: Human 报告 MUST 分离 case verdict 与 execution outcome
human 测试报告 MUST 将测试 case 自身是否通过与 human 实际执行结果分离表达，避免预期阻塞路径或前置环境失败被误读为同一种结果。

#### Scenario: 审批拒绝是预期结果
- **WHEN** human 用例以“审批拒绝后阻塞收敛”为目标，且断言符合预期
- **THEN** 报告 MUST 将 `caseStatus` 记录为 `passed`，并将 `executionStatus` 记录为 `blocked`、`executionResultCode` 记录为 `approval_denied`

#### Scenario: 缺失 live 配置导致未执行
- **WHEN** human 用例在启动前缺少必需模型配置
- **THEN** 报告 MUST 将 `caseStatus` 记录为 `failed`、`caseErrorCode` 记录为 `live_config_missing`，并将 `executionStatus` 记录为 `not_run`

### Requirement: Human 报告 MUST 输出结构化步骤信号供后续分析
human 测试结果 MUST 输出适合后续分析器消费的结构化步骤信号，至少包含 `toolSequence`、`stepActionSequence`、`skillActivationSequence`、失败断言 ID、最终 human 动作，以及与完成或阻塞结果相关的关键执行信号；当用例进入评估模式时，报告同时 MUST 支持表达任务目标、预算配置、结果质量与恢复行为所需的分析输入。

#### Scenario: 任务完成并调用 complete_task
- **WHEN** human 用例通过若干工具步骤完成目标
- **THEN** `signals.json` MUST 包含工具调用顺序、最终 human 动作 `complete_task` 与完成结果码

#### Scenario: 任务阻塞并调用 block_task
- **WHEN** human 用例在审批、工作区或其他不可恢复条件下阻塞
- **THEN** `signals.json` MUST 包含最终 human 动作 `block_task` 以及与阻塞结果相关的步骤信号

#### Scenario: 任务完成并保留评估输入
- **WHEN** human 用例通过若干工具步骤完成目标
- **THEN** 报告 MUST 同时保留完成终态、关键步骤序列与用于后续质量分级的任务目标、步数预算和恢复相关结构化输入

#### Scenario: 任务阻塞并保留阻塞评估输入
- **WHEN** human 用例在审批、工作区、步数预算或本地证据不足等不可恢复条件下阻塞
- **THEN** 报告 MUST 包含最终 human 动作、阻塞结果码、相关事件证据以及支持判断该阻塞是否符合预期的结构化输入
