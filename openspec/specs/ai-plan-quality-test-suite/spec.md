# ai-plan-quality-test-suite Specification

## Purpose
TBD - created by archiving change add-ai-plan-quality-tests. Update Purpose after archive.
## Requirements
### Requirement: Plan quality 测试 MUST 覆盖 planner contract 的结构性约束
系统 MUST 提供一组受治理的 plan quality 测试用例，用于验证 planner 输出满足当前 AI runtime 的结构性边界；这些用例 MUST 至少覆盖“业务计划中不得混入 summary/synthesis 任务”“每个 objective 必须可执行且包含动作、对象、完成判据”“selected scope 约束不得在 planner 输出中丢失”“非法 planner 输出必须 fail-fast 收敛”。

#### Scenario: Planner 输出混入总结任务
- **WHEN** planner 为一个需要多步任务的请求生成业务计划
- **THEN** 计划测试 MUST 能识别并拒绝把“最终总结/最终答复/汇总”作为业务 task 写入 plan 的结果

#### Scenario: Planner objective 缺少完成判据
- **WHEN** planner 生成了空泛或不可验证的 task objective
- **THEN** 计划测试 MUST 将该结果判定为不满足 planner contract，而不是与正常业务拆解混同

#### Scenario: Planner 输出越过已选资料范围
- **WHEN** 运行输入提供了明确的 selected scope 约束
- **THEN** 计划测试 MUST 验证 planner 输出仍围绕这些已选范围组织任务，而不是默认扩大到未选资料

#### Scenario: Planner 返回非法结构
- **WHEN** planner 返回不满足 schema 的 JSON 或缺失必填任务字段
- **THEN** 计划测试 MUST 验证 runtime 以确定性的 `plan_generation_failed` 类失败收敛

### Requirement: Plan quality 测试 MUST 覆盖 handoff 与 synthesis 的关键运行路径
系统 MUST 为 plan 路径提供受治理的 runtime 质量用例，验证业务任务交付、长 handoff 链、阻塞后 stop-dispatch 与 synthesis 收口在真实 plan 运行语义下保持稳定；这些用例 MUST 能区分 planner 输出问题与 runtime/handoff 编译问题。

#### Scenario: 三步 handoff 链保持前序交付
- **WHEN** 一次计划运行包含至少三个顺序依赖的业务任务
- **THEN** 计划测试 MUST 验证后续 task objective 持续携带前序交付，而不是只保留串行顺序却丢失 handoff 内容

#### Scenario: 中途阻塞后仍进入 synthesis
- **WHEN** 计划中的中间业务任务以不可恢复阻塞终态结束
- **THEN** 计划测试 MUST 验证 runtime 停止后续业务任务派发，但仍进入 synthesis human，对已完成内容和阻塞原因做统一收口

#### Scenario: Mixed-scope 计划在 runtime 中保持范围语义
- **WHEN** 一次计划运行同时携带多类已选资料范围
- **THEN** 计划测试 MUST 验证任务 objective、交付与最终 synthesis 没有丢失原始范围边界

### Requirement: Plan quality 用例 MUST 进入现有 catalog/report 治理链路
所有纳入 plan quality 阶段的 managed case MUST 继续声明统一治理 metadata，并通过现有 case catalog 与标准报告目录暴露结果；计划质量评估 MUST 复用现有 `main-ai-runtime` 报告信号优先完成首轮落地，不得绕开现有测试治理入口构建平行结果体系。

#### Scenario: 新增 plan quality managed case
- **WHEN** 开发者新增一个 plan quality 回归用例
- **THEN** 该用例 MUST 放在受治理测试目录中，声明完整 metadata，并被当前 case catalog 识别为有效 case

#### Scenario: 读取 plan quality 最新结果
- **WHEN** AI 或开发者需要判断当前 `plan 质量` 阶段是否可以推进
- **THEN** 读取流程 MUST 先通过 catalog 定位当前有效 case，再读取其标准 report，而不是扫描报告目录或临时摘要文件自行推断

#### Scenario: 首轮 plan quality 复用现有报告信号
- **WHEN** plan quality 用例输出多个 task delivery、进入 synthesis 或暴露工具/步骤轨迹
- **THEN** 报告消费方 MUST 优先通过现有结构化字段读取这些信号，而不是要求首轮实现依赖新的专用报告体系

### Requirement: Plan quality 测试结果 MUST 支持阶段化归因与推进决策
计划质量测试的结果组织方式 MUST 支持把失败模式归因到 planner contract、runtime handoff/synthesis 或 live 模型波动中的至少一个层级，并能作为 `phased-plan` 与 `upgrade-journal` 的输入，用于判断是否继续停留在当前阶段或进入下一阶段。

#### Scenario: Deterministic contract case 失败
- **WHEN** planner contract 或 runtime handoff 的 deterministic case 失败
- **THEN** 阶段结论 MUST 将该结果视为结构性问题，并阻止把失败简单归因于 live 模型波动

#### Scenario: Live quality case 波动但 deterministic case 稳定
- **WHEN** deterministic plan quality case 持续通过，但 live quality case 出现明显波动
- **THEN** 阶段结论 MUST 能将该风险记录为质量波动，而不是误判为 runtime 契约回退

