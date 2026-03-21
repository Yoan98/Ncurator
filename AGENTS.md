# NCurator-Desktop（AI 项目规则）

## 1. 文档引用

- 当涉及技术栈、整体架构、进程边界、本地优先约束或混合检索链路时，请阅读 `doc/architecture.md`
- 当涉及 AI 总体架构、Main/Human 分工、复杂度路由、`human` 新节点设计或 human 目录分层时，请阅读 `doc/ai-design/architecture.md`
- 当涉及 `main`/`human` 状态字段、数据契约、`deliveryMarkdown` 交接结构、`contextEvidence` 提取规则、Main/Human 流转关系或流转图时，请阅读 `doc/ai-design/data-definition-and-flow.md`
- 当涉及 AI 新架构重构范围、阶段划分、目录重构方向、当前完成度、`mouth` / `deliveryMode` / `deliveryMarkdown` 的已收口项或后续推进时，请阅读 `doc/ai-design/refactor-plan.md`
- 当涉及 `human` 的 skill 集合、skill 命名、skill 拆分边界、`skillCatalog` / `skillRegistry` 或 skill 与 tools 实现边界时，请阅读 `doc/ai-design/human-skill-design.md`
- 当涉及 AI 提示词设计准则、prompt 结构、标签组织、哪些字段允许保留结构化载荷、structured output 或提示词编排原则时，请阅读 `doc/ai-design/prompt-design.md`
- 当涉及 AI workbench 测试方案、阶段划分、阶段目标、各阶段 `basic / boundary / scenario / live` 用例规划、`watchHint`/并行边界、模型使用或 backend / e2e 测试边界时，请先阅读 `doc/ai-workbench-test/plan.md`；
- 当涉及 AI workbench 当前阶段推进、完成度、证据、覆盖缺口、四节点 `human` 测试契约迁移或下一阶段准入时，请阅读 `doc/ai-workbench-test/` 下当前阶段 todo 文档；如果阶段 todo 尚未重新建立，则以 `doc/ai-workbench-test/plan.md` 为准
- 当涉及数据库、LanceDB、表职责、存储分层或检索存储实现时，请阅读 `doc/database.md`
- 当涉及目录规范、文件归位、human 子目录归位、tools 按实现域归位、模块边界或工程结构时，请阅读 `doc/project-structure.md`
- 当涉及 UI 风格、布局规范或组件交互约束时，请阅读 `doc/ui-style.md`
- 当涉及测试相关内容，包括测试目录、raw log、report 规则、证据展示方式或历史总数据 / 最新总数据口径时，请阅读 `doc/test.md`；

## 2. 必须遵守的规则
### 代码相关
- 代码的实现必须要简洁，可维护性，良好的可读性，合理的注释
- 禁止使用 `Modal.confirm`、`Modal.info` 等静态方法

#### 类型，常量，通用逻辑抽象规则
- 类型禁止使用 `any` 与 `unknown`
- 类型应抽到types文件中统一管理，常量应抽入constants统一管理，通用逻辑应按职责设计为单一的文件并放入utils中管理
- types、constants、utils 统一按目录就近归位，比如main目录下的通用type就放到main目录下的types文件中；
- 只有 main 与 renderer 共享的内容放 src/shared/**，其余按 ai、main、human 或更细分领域各自收口。
- 默认每个目录只有一个 types.ts、一个 constants.ts，utils/** 按需创建；


### 文档相关
- 文档入口或文档变更时，需同步更新`AGENTS.md`
- 编写文档引用相关时，只需要描述什么时候需要读该文档就足够，不要添加很多细节
