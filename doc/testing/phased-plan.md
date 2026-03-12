# AI 阶段化测试计划

本文件只定义 AI 测试推进顺序、门禁条件和阶段产物，不承载测试架构细节。  
阶段结果与能力边界统一沉淀到 `doc/testing/upgrade-journal.md`。

关联文档：
- 测试架构规则见 [architecture.md](/Users/test/work-space/NCurator-Desktop/doc/testing/architecture.md)
- 阶段执行结果与专题结论见 [upgrade-journal.md](/Users/test/work-space/NCurator-Desktop/doc/testing/upgrade-journal.md)

## 1. 阶段顺序（能力先行）

1. `tool capability`
2. `human 单任务`
3. `main context`
4. `plan 质量`
5. `ai 架构验收`

推进原则：
- 必须先在当前阶段收敛主要不稳定项，再进入下一阶段。
- `explicit_gap` 属于能力边界标注，不等同于 harness 故障。

## 2. 阶段门禁与产物

### 2.1 `tool capability`

- 目标：
  - 工具正确性、边界、安全、显式缺口可观测。
- 主要用例目录：
  - `tests/main/ai/capability/**`
- 主要命令：
  - `pnpm test:main:ai:capability`
  - `pnpm test:main:ai:capability:analyze`
- 阶段产物：
  - `tests/report/main-ai-capability/**`
  - `doc/testing/upgrade-journal.md`（追加 `tool capability` 阶段记录与专题结论）

### 2.2 `human 单任务`

- 目标：
  - human 子图在真实模型下完成单任务并正确收敛阻塞。
  - 产出可比较的质量分级、稳定性与效率数据，为 prompt/skill/tool/model 优化提供输入。
- 主要用例目录：
  - `tests/main/ai/human/**`
- 主要命令：
  - `pnpm test:main:ai:human`
  - `pnpm test:main:ai:human:analyze`
- 阶段产物：
  - `tests/report/main-ai-human/**`
  - `tests/report/main-ai-human/human-assessment.md`
  - `doc/testing/upgrade-journal.md` 追加记录

评估分层：
- `P0` 基线回归：单次执行成功路径、阻塞路径与 fail-fast 门禁。
- `P1` 覆盖扩展：补齐 local-kb、多 skill、workspace 缺失与恢复能力。
- `P2` 评估批次：关键 case 执行 `5-10` 轮，检查通过率、软成功比例、工具错误恢复与重复调用。
- `P3` 升级验证：固定用例集后，对 prompt/skill/tool/model 改动做前后对比。

推进门槛：
- 成功路径通过率至少 `80%`。
- 阻塞路径语义正确率至少 `95%`。
- `unexpected_block` 不应多于 `soft_pass`。
- assessment 中不得存在未隔离的 `harness_fail` 结论污染。

### 2.3 `main context`

- 目标：
  - main graph 上下文收集、scope 语义、阻塞契约稳定。
- 主要用例目录：
  - `tests/main/ai/runtime/**`
- 主要命令：
  - `pnpm test:main:ai:runtime`
- 阶段产物：
  - `tests/report/main-ai-runtime/**`
  - `doc/testing/upgrade-journal.md` 追加记录

### 2.4 `plan 质量`

- 目标：
  - 计划拆解合理、任务粒度稳定、收敛路径可解释。
- 主要输入：
  - `tests/main/ai/runtime/**` + 定向补充计划质量用例
  - 必要时用 `tests/e2e/**` 验证计划对 UI 链路的影响
- 阶段产物：
  - 对应 suite 报告目录
  - `doc/testing/upgrade-journal.md` 追加记录

### 2.5 `ai 架构验收`

- 目标：
  - 给定真实用户需求，验证当前 AI 架构端到端效果是否达标。
- 主要输入：
  - `tests/main/**` 主干能力
  - `tests/e2e/**` 关键链路
- 阶段产物：
  - 对应 suite 报告目录
  - `doc/testing/upgrade-journal.md` 追加记录

## 3. 当前阶段判定来源

- 当前阶段、推进决策、下一阶段目标，以 [upgrade-journal.md](/Users/test/work-space/NCurator-Desktop/doc/testing/upgrade-journal.md) 最新记录为准。
- 本文件不维护按日期的阶段快照，避免与持续汇总文档发生漂移。

## 4. 每轮测试结束后的固定动作

1. 产出并检查 `tests/report/**` 结构化报告。
2. 追加更新 [upgrade-journal.md](/Users/test/work-space/NCurator-Desktop/doc/testing/upgrade-journal.md)：
   - 写明阶段、结果、风险、是否推进、下一轮优先级。
   - 在需要时补充该阶段专题结论（能力边界、显式缺口、门槛判定）。
3. 仅当“允许推进”明确成立时，开始下一阶段测试。
4. 仅当阶段顺序或门禁发生变化时，更新本文件。
