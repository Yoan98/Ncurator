## Context

当前 `human` 测试已经具备基础运行能力：通过 [tests/harness/main/humanCase.ts](/Users/test/work-space/NCurator-Desktop/tests/harness/main/humanCase.ts) 直接驱动 `human` 子图，写入 `events.jsonl`、`assertions.json`、`metrics.json`、`signals.json` 与 `summary.md`，并在 [tests/main/ai/human](/Users/test/work-space/NCurator-Desktop/tests/main/ai/human) 下维护少量 live case。现有体系能完成 smoke 回归，但还存在几个明显缺口：

- 用例覆盖面不足，尚未形成按成功、阻塞、恢复、预算、证据不足分层的评估矩阵。
- 报告信号偏“回放友好”，但不够“评估友好”，缺少质量分级与稳定性分析所需字段。
- 缺少 human 专用 analyzer，无法像 capability suite 一样产出统一 assessment。
- harness 对 `local-kb`、workspace 缺失、一次性工具故障等场景支持不足，限制了关键评估 case 的可控性。

这次变更会跨越测试用例、测试 harness、报告契约、分析脚本与测试文档，属于典型的跨模块测试架构升级，适合先用 design 固定边界与实施顺序。

## Goals / Non-Goals

**Goals:**
- 将 `human` 测试从 smoke 回归升级为 `P0-P3` 分阶段评估体系。
- 明确 `P0` 基线诊断、`P1` 能力覆盖扩展、`P2` 多轮评估与 `P3` 升级前后对比的落地顺序。
- 为 `main-ai-human` 报告补充支持质量分级、恢复分析、重复调用分析与预算占用分析的字段。
- 新增 `human` assessment 聚合分析能力，输出跨 case、跨轮次的统一结论。
- 保持现有 “真实模型 + 直接驱动 human 子图” 的测试边界不变，不回退到 mock-only 测试。

**Non-Goals:**
- 本次不修改 `human` graph、prompt 或 tool 的业务行为，只为后续优化提供评估基础。
- 本次不新增新的 AI capability 或 renderer/e2e 测试体系。
- 本次不追求一次性补齐全部 `P0-P3` 实现，更强调顺序化落地与可阶段验收。
- 本次不重写现有报告目录结构，仍沿用 `tests/report/<suite>/<case>/<timestamp>/` 口径。

## Decisions

### 1. 采用“分阶段评估体系”而不是继续堆零散用例

**Decision**

将 `human` 测试按 `P0-P3` 分成四层：

- `P0`：基线诊断。先补齐成功、阻塞、fail-fast、步数预算边界等核心 case。
- `P1`：能力覆盖扩展。补齐 `local-kb`、多 skill、workspace 缺失、受控恢复场景。
- `P2`：多轮评估。对关键 case 跑 5 到 10 轮，输出稳定性与质量结论。
- `P3`：升级前后对比。固定 case 集和评估批次，验证 prompt/skill/tool/model 优化是否真实提升效果。

**Why**

当前最大问题不是“某个单测缺了”，而是没有统一的评估面板。继续按工具或文件类型零散补 case，会让数据仍然不可比较。分阶段体系能明确当前做到哪一层、下一层的门槛是什么，并能与 `doc/testing/phased-plan.md` 的 AI 阶段推进口径对齐。

**Alternatives considered**

- 只继续新增 human live case
  - 优点：改动小
  - 缺点：仍然没有质量分级和阶段门禁，不足以支撑升级决策
- 直接做 analyzer，不补 case
  - 优点：能更快看到汇总
  - 缺点：输入面太窄，结论不稳

### 2. 保留现有 humanCase/reporter 主干，采用“扩展而不是重写”

**Decision**

继续以 [tests/harness/main/humanCase.ts](/Users/test/work-space/NCurator-Desktop/tests/harness/main/humanCase.ts) 为统一运行入口、以 [tests/harness/main/reporter.ts](/Users/test/work-space/NCurator-Desktop/tests/harness/main/reporter.ts) 为统一落盘入口，在此基础上增量补充：

- `taskGoal`、`maxSteps`、`approvalPolicy`、`modelName`
- `toolErrorCount`
- `recoveryAfterErrorCount`
- `repeatedToolCallCount`
- `stepBudgetUsage`
- `resultDataKeys`
- `firstFailureStage`
- `qualityGrade`

**Why**

现有 harness 已满足“真实模型、直接驱动 human 子图、结构化落盘”的主要求。完全重写不仅成本高，也会破坏已有 `human-test-suite` 与 `ai-test-reporting-contract` 形成的稳定目录契约。增量扩展更符合本次变更的目标。

**Alternatives considered**

- 新建一套独立 human evaluation harness
  - 优点：可单独设计最优模型
  - 缺点：会造成两套入口并存、文档和报告口径漂移
- 只在 analyzer 里从原始事件反推所有字段
  - 优点：不改 reporter
  - 缺点：很多关键上下文如 `maxSteps`、`approvalPolicy`、`modelName` 无法稳定反推

### 3. 质量分级放在 analyzer 主导，report 保留原始证据与基础派生字段

**Decision**

report 层负责产出“足够稳定、足够通用”的原始信号与基础派生指标；`hard_pass / soft_pass / expected_block / unexpected_block / harness_fail` 的最终判定以 analyzer 为主。report 只在必要时预存少量可复用派生值，避免把过多策略硬编码进测试落盘逻辑。

**Why**

质量分级属于评估策略，后续大概率还会调整阈值。把所有判定硬写进 reporter，会让每次改评估口径都要回写历史数据模型。report 保持“证据中心”，analyzer 负责“结论中心”，职责更清晰。

**Alternatives considered**

- 在 reporter 中直接固化最终质量等级
  - 优点：单次报告可立即读出 grade
  - 缺点：阈值调整成本高，历史兼容复杂
- 只保留原始 events，不做任何派生指标
  - 优点：最灵活
  - 缺点：analyzer 复杂度过高，单次调试也不方便

### 4. Assessment 以“当前 case 集 + 历史 runs”为主视角，并显式识别 stale 报告

**Decision**

新增 human analyzer 时，先从当前 `tests/main/ai/human/**/*.test.ts` 解析出“当前 case 集”，再到 `tests/report/main-ai-human/**` 中读取对应最新 run 与历史 run；对源码中已不存在的旧 case 报告标记为 stale，不纳入当前覆盖率与质量统计。

**Why**

仓库中已经存在旧 human 报告残留。如果直接全量扫 `tests/report/main-ai-human/**`，历史实验会污染当前评估结论。以“当前 case 集”为主视角，可以保证 assessment 反映当前测试基线，而 stale 目录仍保留为历史参考。

**Alternatives considered**

- 全量读取报告目录，不区分当前与历史
  - 优点：实现简单
  - 缺点：结论失真
- 只看最新 run，不看历史 run
  - 优点：更快
  - 缺点：无法支撑稳定性分析

### 5. Harness 扩展优先服务 P1，而不是在 P0 阶段过早复杂化

**Decision**

将 harness 扩展拆成两批：

- `P0` 不改或只小改：复用现有 workspace 绑定、live 配置加载、event collector 与 reporter。
- `P1` 再补：
  - 可注入 `documentsStore` fixture，用于 `local-kb` 正向路径
  - 可关闭 workspace 绑定，用于 `workspace_required`
  - 可注入一次性 tool failure，用于恢复能力评估

**Why**

P0 的目标是尽快得到第一版评估面板。如果一开始就做所有 harness 扩展，交付会被基础设施拖住。先用现有能力把成功/阻塞/边界几类核心路径跑起来，更符合阶段推进逻辑。

**Alternatives considered**

- 先补全所有 harness 能力，再开始 P0
  - 优点：一次到位
  - 缺点：周期长，无法快速得到基线
- 完全不扩展 harness
  - 优点：最省事
  - 缺点：`local-kb`、workspace 缺失和受控恢复无法形成可靠 case

### 6. 新增 human assessment 脚本，而不是把结论直接写进 upgrade-journal

**Decision**

新增独立的 human assessment 生成脚本，输出到 `tests/report/main-ai-human/human-assessment.md` 或等价汇总文件；`doc/testing/upgrade-journal.md` 只引用这一轮 assessment 的事实结论与推进决策，不在 journal 内直接承担全部分析逻辑。

**Why**

`upgrade-journal` 是持续汇总入口，但不适合作为原始分析器。assessment 需要多次重跑、覆盖矩阵、质量分级、stale 报告识别等逻辑，独立脚本更利于回归和复用。

**Alternatives considered**

- 直接人工写 journal，不做 analyzer
  - 优点：短期快
  - 缺点：不可重复、不可比较、容易失真
- 把 analyzer 输出直接塞进 `summary.md`
  - 优点：报告看起来集中
  - 缺点：违反 `summary.md` 只转写事实信号的契约

## Risks / Trade-offs

- [Risk] 质量分级阈值过早固化，后面难以调优
  → Mitigation：将最终 grade 计算集中在 analyzer，report 只保留原始证据与基础指标。

- [Risk] P0 先落地后，P1 harness 能力不足导致部分 spec 暂时无法完全验证
  → Mitigation：在 tasks 中明确把 `local-kb` fixture 注入、workspace 缺失模式、一次性 tool 故障注入列为后续独立任务。

- [Risk] 多轮 live 评估批次耗时长、成本高，日常开发反馈变慢
  → Mitigation：保留“单次回归层”和“多轮评估层”分离的执行口径，只对关键 case 跑多轮。

- [Risk] 旧报告目录混入当前统计，导致 assessment 结论失真
  → Mitigation：analyzer 先解析当前 case 集，再识别并单列 stale 报告。

- [Risk] 现有 reporter 字段扩展过多，导致兼容性和阅读成本上升
  → Mitigation：保持标准文件集合不变，仅为 `main-ai-human` 增量补充必需字段，并优先放入 `signals.json`/`metrics.json`，不污染 `summary.md` 的事实性定位。

## Migration Plan

1. 先扩展 OpenSpec 规格与设计，固定 `P0-P3`、报告字段与 assessment 责任边界。
2. 实现 `P0` 所需的最小代码改动：
   - 升级现有 human case 断言
   - 新增 `nonexistent-file`、`local-evidence-insufficient`、`step-budget-exhausted` 等 P0 用例
   - 为 reporter/humanCase 增补最小评估输入字段
3. 新增 human assessment 脚本与命令，先支持读取当前 `P0` case 的 latest run 与历史 run。
4. 产出第一轮 `human-assessment`，并将结论写入 `doc/testing/upgrade-journal.md` 的 `human 单任务` 记录。
5. 再推进 `P1` harness 扩展与新增 case，补齐 `local-kb`、workspace 缺失、多 skill、受控恢复等覆盖面。
6. 当 `P1` 完成后，进入 `P2/P3` 的多轮评估与升级前后对比。

回滚策略：

- 若 reporter 字段扩展影响现有消费方，可先保留旧字段不删，仅回退新增字段消费逻辑。
- 若 analyzer 结论不稳定，可保留原始报告产物，暂时停用 quality grade 的自动汇总，不影响单 case 报告。

## Open Questions

- `qualityGrade` 的最终阈值是否需要在首版就完全固化，还是先以 analyzer 内部规则实现并在几轮报告后再沉淀到文档？
- `modelName` 是仅记录逻辑模型名，还是需要记录完整 `base_url + model_name` 组合以支持多提供商对比？
- `local-evidence-insufficient` 的阻塞结果码是否维持 `failed`，还是后续引入更细的显式结果码更合适？
- human assessment 汇总文件是否应固定命名为 `human-assessment.md`，还是与 capability analyzer 一样允许按时间追加历史快照？
