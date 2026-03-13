# NCurator-Desktop 测试文档入口

`doc/testing/**` 只负责测试规则、治理规则、阶段推进与历史记录，不再手工维护当前有效测试清单。

当前测试真相链：

1. `tests/**`
2. `tests/catalog/current-cases.json`
3. `tests/report/**`

说明：

- `tests/**` 是可运行 case 与 metadata 的唯一源码真相源。
- `tests/catalog/current-cases.json` 是 AI、脚本与开发者读取当前 active case 集的统一入口。
- `tests/catalog/current-cases.md` 是面向人工浏览的投影文件。
- `tests/report/**` 只保存历史执行证据，不再定义当前 case inventory。

## 1. 什么时候读这里

- 调整测试架构、test harness、分析脚本或报告契约
- 新增、晋升、降级、归档测试用例
- 推进 AI 阶段测试、更新门禁或补充历史结论

## 2. 阅读顺序

1. [architecture.md](/Users/test/work-space/NCurator-Desktop/doc/testing/architecture.md)
2. [case-governance.md](/Users/test/work-space/NCurator-Desktop/doc/testing/case-governance.md)
3. 当前 case 清单：
   - [current-cases.md](/Users/test/work-space/NCurator-Desktop/tests/catalog/current-cases.md)
   - [current-cases.json](/Users/test/work-space/NCurator-Desktop/tests/catalog/current-cases.json)
4. [phased-plan.md](/Users/test/work-space/NCurator-Desktop/doc/testing/phased-plan.md)
5. [upgrade-journal.md](/Users/test/work-space/NCurator-Desktop/doc/testing/upgrade-journal.md)

## 3. 文档分工

- `architecture.md`
  - 测试分层、目录放置、catalog 生成、报告消费顺序与执行入口。
- `case-governance.md`
  - metadata 契约、保留层级、生命周期、运行策略、准入/降级/归档规则。
- `phased-plan.md`
  - AI 测试阶段顺序、门禁、阶段产物与推进条件。
- `upgrade-journal.md`
  - 每轮测试执行历史、风险、阶段结论与推进决策。

## 4. 维护规则

- 任何需要确认“当前有哪些测试 case”的场景，都先读 `tests/catalog/current-cases.json` 或 `tests/catalog/current-cases.md`。
- 不把 `tests/report/**` 目录结构当成当前 case 集，也不在 `doc/testing/**` 手工抄写 case 列表。
- 若调整测试文档入口、catalog 路径或治理规则，必须同步更新：
  - [doc/README.md](/Users/test/work-space/NCurator-Desktop/doc/README.md)
  - [doc/reference/source-of-truth.md](/Users/test/work-space/NCurator-Desktop/doc/reference/source-of-truth.md)
  - [doc/reference/change-checklist.md](/Users/test/work-space/NCurator-Desktop/doc/reference/change-checklist.md)
  - [AGENTS.md](/Users/test/work-space/NCurator-Desktop/AGENTS.md)
  - [.codex/skills/testing/SKILL.md](/Users/test/work-space/NCurator-Desktop/.codex/skills/testing/SKILL.md)
