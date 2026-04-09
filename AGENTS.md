# NCurator-Desktop（AI 项目规则）

## 1. 文档引用
### 1.1 AI相关
- 当涉及 AI 架构、主流程或 human-only runtime 时，必须阅读 `doc/ai-design/architecture.md`
- 当涉及 AI 实现、运行入口、跨层边界、LLM 执行入口、流式传输、runtime settings、运行数据、`execution.watchHint` / `toolUsePlan` / `execution.lastLearningOutcome` / `memory.history.roundHistory` / `history_recall` / `recent_progress` / `earlier_attempts` / `recalled_history` 契约或工作区 KB 范围时，必须阅读 `doc/ai-design/implementation-spec.md` 与 `doc/ai-design/data-definition-and-flow.md`
- 当涉及 AI 最小运行样例、默认链路或想快速理解 human 各环节如何衔接时，必须阅读 `doc/ai-design/example.md`
- 当涉及 human 的 skill 分类、拆分边界、builtin/external 区分或当前 skill 基线时，必须阅读 `doc/ai-design/human-skill-design.md`
- 当涉及 prompt 的通用结构、输入组织、输出规则、约束表达或风格一致性时，必须阅读 `doc/ai-design/prompt-design.md`
- 当涉及 AI 后续重构与迭代规划时，必须阅读 `doc/ai-design/refactor-plan.md`

### 1.2 项目整体相关
- 当涉及项目整体架构与技术栈时，必须阅读 `doc/architecture.md`
- 当涉及数据库、工程结构、目录归位或工作区化网页资料存储时，必须阅读 `doc/database.md` 与 `doc/project-structure.md`
- 当涉及 UI 风格与通用交互规范时，必须阅读 `doc/ui-style.md`

### 1.3 测试相关
- 当涉及 AI 测试，必须阅读 `doc/test-plan/ai-test.md`
- 当涉及 Workbench 测试时，必须阅读 `doc/test-plan/workbench-test.md`
- 当涉及 Settings 测试时，必须阅读 `doc/test-plan/settings-test.md`
- 当涉及测试用例编写，测试规范时，必须阅读 `doc/test.md`

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
- 用户可见功能改动前，必须先对齐对应 `doc/prd/**`；如果当前 PRD 缺项或与目标行为不一致，要先补 PRD 或同步改 PRD
- 实现如果改变了功能入口、交互流程、状态反馈、边界情况或验收口径，必须同步更新对应 `doc/prd/**`

### 你的回复相关
- 写正式测试或验收结论时，应优先引用对应 PRD 的需求编号与验收编号
- 最终回复涉及功能实现时，应说明本次对齐的 PRD 编号，以及已验证和未验证项
