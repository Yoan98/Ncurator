# NCurator-Desktop（AI 项目规则）

## 1. 文档引用
### 1.1 AI相关
- 当涉及 AI 架构、主流程或 human-only runtime 时，必须阅读 `doc/ai-design/architecture.md`
- 当涉及 AI 实现、运行入口、跨层边界、LLM 执行入口、流式传输、runtime settings、运行数据、`execution.watchHint` / `toolUsePlan` / `execution.lastLearningOutcome` / `memory.history.roundHistory` / `HumanHistoryToolResult.data` 原始结果存储 / history 实时渲染 / `memory.stable.currentUnderstanding` / `memory.stable.keyEvidence` / `memory.stable.checklist` / `history_search` / `history_list` / `mouth` 统一 `history` prompt 输入契约、`draft_review` / confirm-copy artifact 链路或工作区 KB 范围时，必须阅读 `doc/ai-design/implementation-spec.md` 与 `doc/ai-design/data-definition-and-flow.md`
- 当涉及 AI 最小运行样例、默认链路或想快速理解 human 各环节如何衔接时，必须阅读 `doc/ai-design/example.md`
- 当涉及 human 的 skill 分类、拆分边界、builtin/external 区分或当前 skill 基线时，必须阅读 `doc/ai-design/human-skill-design.md`
- 当涉及 prompt 的通用结构、输入组织、输出规则、约束表达、工具结果语义暴露、运行事实渲染、自主性边界或 human 的 AI-facing 文案设计时，必须阅读 `doc/ai-design/prompt-design.md`
- 当涉及 tool schema 自动导出为 prompt、brain 输出 shape 自动导出、tool spec examples、或 `diagnostic.message` 这类工具契约变更时，必须阅读 `doc/ai-design/implementation-spec.md`、`doc/ai-design/data-definition-and-flow.md` 与 `doc/ai-design/prompt-design.md`
- 当涉及 AI 后续重构与迭代规划时，必须阅读 `doc/ai-design/refactor-plan.md`

### 1.2 项目整体相关
- 当涉及项目整体架构与技术栈时，必须阅读 `doc/architecture.md`
- 当涉及数据库、工程结构、目录归位、工作区化网页资料存储，或 document/chunk 列表查询参数与 LanceDB where helper 命名时，必须阅读 `doc/database.md` 与 `doc/project-structure.md`
- 当涉及 UI 风格与通用交互规范时，必须阅读 `doc/ui-style.md`

### 1.3 测试相关
- 当涉及 AI 测试，必须阅读 `doc/test-plan/ai-test.md`
- 当涉及 human live 的 docx / KB 混合场景测试设计时，必须阅读 `doc/test-plan/ai-test.md`
- 当涉及 Workbench 测试时，必须阅读 `doc/test-plan/workbench-test.md`
- 当涉及 Settings 测试时，必须阅读 `doc/test-plan/settings-test.md`
- 当涉及测试用例编写、runner、raw logs 或日志分析时，必须阅读 `doc/test.md`

### 1.4 prd产品文档相关
- 当涉及 Workbench 的产品需求、交互、工作区资料范围或验收标准时，必须阅读 `doc/prd/workbench.md`
- 当涉及 Settings 的产品需求、交互、工作区内网页资料管理或验收标准时，必须阅读 `doc/prd/settings.md`

## 2. 必须遵守的规则

### 代码相关

- 禁止使用 `Modal.confirm`、`Modal.info` 等静态方法

### 代码实现准则

1. 存在重复逻辑、重复类型，且适合抽象后提高阅读性、简单性、后期维护性的，要进行抽象封装，视情况看是否拆分文件
2. 代码逻辑实现过于复杂，有更简单的实现，且有助提高阅读性、简单性、后期维护性的，要进行简单实现
3. 文件拆得太碎，且拆后的小文件并不会继续在该文件扩展，那这些文件需要进行整合，有助提高阅读性、简单性、后期维护性
4. 代码逻辑为了抽象封装而封装，导致一些逻辑太零散太少，那这些代码也需要进行整合

#### 代码类型，常量，通用逻辑抽象规则

- 类型禁止使用 `any` 与 `unknown`
- 类型应抽到types文件中统一管理，常量应抽入constants统一管理，通用逻辑应按职责设计为单一的文件并放入utils中管理
- types、constants、utils 统一按目录就近归位，比如main目录下的通用type就放到main目录下的types文件中；
- 只有 main 与 renderer 共享的内容放 src/shared/\*\*，其余按 ai、main、human 或更细分领域各自收口。
- 默认每个目录只有一个 types.ts、一个 constants.ts，utils/\*\* 按需创建；

### 文档相关

- 文档入口或文档变更时，需同步更新`AGENTS.md`
- 编写文档引用相关时，只需要描述什么时候需要读该文档就足够，不要添加很多细节
- 只有当功能代码发生变动、对应测试用例文档明确要求对齐 `doc/prd/**`，或者 `doc/prd/**` 本身发生变更时，才需要对齐代码实现与 `doc/prd/**` 是否一致
- 仅修改测试用例实现、断言方式、runner 使用、日志读取方式或其他不改变功能行为的内容时，不要求对齐 `doc/prd/**`

### 你的回复相关
- 当对应测试用例文档明确要求引用 PRD 编号时，写正式测试或验收结论应按该文档要求执行
- 最终回复涉及功能实现时，应说明已验证和未验证项；只有在对应测试用例文档明确要求或 `doc/prd/**` 发生变更时，才需要说明 PRD 对齐情况
