# NCurator-Desktop（AI 项目规则）

## 1. 文档引用

- 当涉及技术栈、整体架构、进程边界、本地优先或混合检索时，请阅读 `doc/architecture.md`
- 当涉及 AI 总体架构、Director/Human 分工或主流程时，请阅读 `doc/ai-design/architecture.md`
- 当涉及 AI 节点实现、状态转移、`deliveryMode`、`watchHint`、`task_handoff`、`context_note`、`artifacts` 或 `LangGraph` 运行约束时，请阅读 `doc/ai-design/implementation-spec.md`
- 当涉及 AI 状态字段、任务契约、`deliveryMarkdown`、`contextEvidence`、`fact/evidence` 约束或数据流转时，请阅读 `doc/ai-design/data-definition-and-flow.md`
- 当想看 AI 完整跑一遍的真实样例，或想确认 plan 原始 `userInput` 与实际派发给 human 的输入、前序任务交接如何传递时，请阅读 `doc/ai-design/example.md`
- 当涉及 `human` 的 skill 集合、skill 命名、skill 边界或 skill 与 tools 的映射时，请阅读 `doc/ai-design/human-skill-design.md`
- 当涉及 AI prompt 设计、prompt 结构、标签组织或 structured output 编排时，请阅读 `doc/ai-design/prompt-design.md`
- 当涉及 AI 后续重构方向、迭代规划或未决方案时，请阅读 `doc/ai-design/refactor-plan.md`
- 当涉及 Core AI 测试方案、阶段划分、用例规划、`human` skill 覆盖、`watchHint`/并行边界、正式 case 与文档对齐或排查时何时继续查看 `runtime-events.jsonl` 时，请先阅读 `doc/test-plan/ai-test.md`
- 当涉及 Workspace 测试方案、工作空间扫描/准备、网页资料、`Settings -> Workspace` 空态/错误态、source scope 提示联动或正式 workspace case 规划时，请先阅读 `doc/test-plan/workspace-test.md`
- 当涉及数据库、LanceDB、表职责或检索存储实现时，请阅读 `doc/database.md`
- 当涉及目录规范、模块边界、文件归位或工程结构时，请阅读 `doc/project-structure.md`
- 当涉及 UI 风格、workbench / composer 布局、组件交互约束或 `Settings -> Workspace` 资料配置入口时，请阅读 `doc/ui-style.md`
- 当涉及测试架构设计、正式 test-plan 共享约束、实现状态约定、测试目录、正式/临时 case 准入、raw log、`runtime-events.jsonl`、`timeline` 值域规则、report 生成流程、证据展示方式、`workspace` 直连 shell 测试命令面或测试代码准入约束时，请阅读 `doc/test.md`

## 2. 必须遵守的规则

### 代码相关

- 代码的实现必须要简洁，可维护性，良好的可读性，合理的注释
- 禁止使用 `Modal.confirm`、`Modal.info` 等静态方法

#### 类型，常量，通用逻辑抽象规则

- 类型禁止使用 `any` 与 `unknown`
- 类型应抽到types文件中统一管理，常量应抽入constants统一管理，通用逻辑应按职责设计为单一的文件并放入utils中管理
- types、constants、utils 统一按目录就近归位，比如main目录下的通用type就放到main目录下的types文件中；
- 只有 main 与 renderer 共享的内容放 src/shared/\*\*，其余按 ai、main、human 或更细分领域各自收口。
- 默认每个目录只有一个 types.ts、一个 constants.ts，utils/\*\* 按需创建；

### 文档相关

- 文档入口或文档变更时，需同步更新`AGENTS.md`
- 编写文档引用相关时，只需要描述什么时候需要读该文档就足够，不要添加很多细节
