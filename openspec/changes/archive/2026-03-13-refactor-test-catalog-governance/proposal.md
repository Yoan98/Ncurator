## Why

当前测试体系已经具备按 `main / renderer / e2e` 分层的代码结构、统一报告契约与阶段化执行文档，但“当前有效测试用例是什么”仍然没有单一真相源。现状是测试规则主要分散在 `doc/testing/**`，执行结果主要堆积在 `tests/report/**`，而真实可运行用例又只存在于 `tests/**` 源码里，导致 AI 和开发者都需要跨三套信息源人工拼装上下文。

这个问题已经开始产生实际漂移。当前源码中可提取到 `60` 个 active `caseId`，但 `tests/report/**` 下存在 `75` 个 case 目录，其中至少 `16` 个已经是历史残留或被重命名后的 stale 目录。继续在这个基础上追加测试，只会让“哪些测试值得长期保留、哪些是临时诊断、哪些已经废弃”越来越难判断，因此需要现在就把测试目录、文档结构和报告真相源一起重构。

## What Changes

- 新增“测试用例目录治理”能力，建立从测试源码提取 metadata 的单一真相源，并生成当前有效测试目录供 AI 与开发者消费。
- **BREAKING** 重构测试信息架构，明确分离三类内容：
  - `tests/**`：测试源码与 case metadata 真相源；
  - `tests/catalog/**`：从源码与最新报告投影出的当前测试目录；
  - `doc/testing/**`：只保留架构规则、治理规则、阶段计划与历史记录，不再手工维护当前 case 清单。
- **BREAKING** 统一所有 suite 的 case metadata 最小契约，至少覆盖 `caseId`、`description`、`scenarioTags`、`taskGoal/objective`、`requiredFixtures`、`expectedOutcome`，并新增长期治理所需字段，例如保留层级、运行策略、能力归属与生命周期状态。
- **BREAKING** 将“当前有效测试全集”从 `tests/report/**` 中剥离；报告目录只表达历史执行产物，不再被视为当前 case inventory。所有 stale 报告目录、过时 case 名与旧汇总文件允许被删除、迁移或归档，不保留兼容读取路径。
- 重构测试文档入口与职责边界，使测试文档更清晰地拆分为：
  - 测试架构与分层；
  - 测试用例治理与保留规则；
  - AI 阶段推进与门禁；
  - 持续追加的执行历史与阶段结论。
- 重写测试追加与收敛流程，使后续新增 case 必须先声明价值归属，再决定是进入长期保留集、覆盖集、诊断集还是 live 评估集。
- 为报告分析器与批次脚本补充目录联动规则，使它们基于 catalog 而不是零散扫描目录推断当前 case 集。

## Capabilities

### New Capabilities

- `test-case-catalog-governance`: 定义测试用例 metadata、当前有效 case catalog、生命周期状态、保留层级、文档同步规则，以及源码、catalog、报告三者之间的真相源关系。

### Modified Capabilities

- `ai-test-reporting-contract`: 调整报告契约的消费方式，使报告目录不再承担“当前测试全集”职责，并要求报告可与 catalog 进行稳定关联。
- `capability-tool-test-suite`: 要求 capability 用例声明统一 metadata，并纳入 catalog 与保留层级治理。
- `human-test-suite`: 要求 human 用例声明统一 metadata、评估分层角色与长期保留属性，并与批次分析结果对齐。
- `renderer-ui-test-suite`: 要求 renderer / e2e / ai-live 用例同样纳入统一 metadata 与 catalog 治理，而不是仅依赖目录扫描和历史报告。

## Impact

- 影响目录与代码范围：
  - `tests/main/**`
  - `tests/renderer/**`
  - `tests/e2e/**`
  - `tests/harness/**`
  - `tests/report/**`
  - `tests/catalog/**`（新增）
  - `scripts/*test*`
  - `vitest*.config.mts`
- 影响文档与规则范围：
  - `doc/testing/**`
  - `doc/reference/source-of-truth.md`
  - `doc/reference/change-checklist.md`
  - `doc/README.md`
  - `AGENTS.md`
  - `.codex/skills/testing/SKILL.md`
- 影响协作方式：
  - AI 与开发者后续必须先读取 catalog，再读取 suite 报告与历史 journal，不能再直接把 `tests/report/**` 当作当前 case 清单。
  - 新增测试时必须先声明其长期价值和归属，再决定是否进入长期保留集。
- 破坏性影响：
  - 允许删除旧报告目录、废弃旧 caseId、移除旧文档段落与旧入口，不对旧路径、旧命名和旧汇总格式提供兼容保证。
