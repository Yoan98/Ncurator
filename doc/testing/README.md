# NCurator-Desktop 测试文档入口

本目录负责测试体系当前真相源。`README.md` 只承担导航与阅读顺序，不重复承载测试架构细节；具体规则分别落在下列 canonical 文档中。

## 1. 什么时候读这里

- 调整测试架构、测试脚本、test harness、报告契约
- 推进 AI 阶段化测试或更新阶段门禁
- 追加测试结论、风险边界或回归记录

## 2. 阅读顺序

1. [architecture.md](/Users/test/work-space/NCurator-Desktop/doc/testing/architecture.md)
2. 按任务继续进入：
   - [phased-plan.md](/Users/test/work-space/NCurator-Desktop/doc/testing/phased-plan.md)
   - [upgrade-journal.md](/Users/test/work-space/NCurator-Desktop/doc/testing/upgrade-journal.md)

## 3. 文档分工

- `architecture.md`
  - 测试分层、生产入口直连原则、harness 与报告契约。
- `phased-plan.md`
  - AI 测试阶段顺序、门禁条件、阶段产物与推进规则。
- `upgrade-journal.md`
  - 每轮测试执行结果、能力边界、风险与推进决策的持续汇总。

## 4. 代码真相源

文档不足或与实现冲突时，按以下顺序核对：

1. `tests/**`
2. 测试配置文件（如 `vitest*.config.mts`）
3. `tests/report/**` 实际输出结构

## 5. 维护规则

- 若调整 `doc/testing/**` 的默认入口或 canonical 文档，必须同步更新 `doc/README.md`、`doc/reference/source-of-truth.md`、`AGENTS.md` 与 `.codex/skills/testing/SKILL.md`。
- 不把一次性测试结论写回 `README.md`；持续记录统一追加到 `upgrade-journal.md`。
