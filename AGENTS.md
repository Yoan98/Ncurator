# NCurator-Desktop（AI 项目规则）

## 1. 文档引用

### 1.1 AI相关

- `doc/ai-design/architecture.md`：涉及 AI 整体架构、模块关系或主流程时阅读。
- `doc/ai-design/design-detail.md`：涉及 AI 设计边界、职责划分、核心数据、关键 contract、过程事件或关键流程时阅读。
- `doc/ai-design/human-skill-design.md`：涉及 human skill 体系、能力边界、builtin/external skill 或工具使用范围时阅读。
- `doc/ai-design/prompt-design.md`：涉及 prompt 设计、AI-facing 文案或工具描述方式时阅读。

### 1.2 docx相关

- `doc/docx-design/architecture.md`：涉及 docx 整体架构、模块关系或主流程时阅读。
- `doc/docx-design/design-detail.md`：涉及 docx 设计边界、核心对象、关键流程、三视图关系或数据结构时阅读。

### 1.3 项目整体相关

- `doc/architecture.md`：涉及项目整体架构或技术栈时阅读。
- `doc/database.md`：涉及数据库结构、具名工作空间/网页索引状态存储或持久化关系时阅读。
- `doc/project-structure.md`：涉及工程结构或目录归位时阅读。
- `doc/release.md`：涉及桌面端打包、发布仓库、自动更新或发版流程时阅读。
- `doc/ui-style.md`：涉及全前端 Notion-like UI 风格、主题或通用交互规范时阅读。

### 1.4 测试相关

- `doc/test-plan/ai-test.md`：涉及 AI 测试范围、正式或 live case 设计、执行摘要或 suite 覆盖维护时阅读。
- `doc/test-plan/settings-test.md`：涉及 Settings 测试范围或测试边界时阅读。
- `doc/test-plan/workbench-test.md`：涉及 Workbench 测试范围、真实 e2e case 设计、发送前置条件验证、执行摘要或 suite 覆盖维护时阅读。
- `doc/test.md`：涉及测试体系、formal e2e 规则、runner 或正式测试流程时阅读。

### 1.5 prd产品文档相关

- `doc/prd/workbench.md`：涉及 Workbench 产品需求、发送前置条件、消息流/过程层交互或 composer 偏好验收标准时阅读。
- `doc/prd/settings.md`：涉及 Settings 产品需求、工作区目录绑定提示、具名工作空间资料/索引交互或验收标准时阅读。

## 2. 必须遵守的规则

### 代码相关

- 禁止使用 `Modal.confirm`、`Modal.info` 等静态方法

### 代码实现准则

0. 允许重构且不兼容旧逻辑
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
- `AGENTS.md` 的“文档引用”部分仅作为文档索引使用，每个文档只能出现一次，且每条只用一句话说明什么时候需要读，新增内容必须合并到已有条目，不得重复追加同一文档
- 编写文档引用相关时，只需要描述什么时候需要读该文档就足够，不要添加很多细节
- 只有当功能代码发生变动、对应测试用例文档明确要求对齐 `doc/prd/**`，或者 `doc/prd/**` 本身发生变更时，才需要对齐代码实现与 `doc/prd/**` 是否一致
- 仅修改测试用例实现、断言方式、runner 使用、日志读取方式或其他不改变功能行为的内容时，不要求对齐 `doc/prd/**`

### 测试相关

- 涉及工作区语义的测试时，统一使用 `tests/fixtures/workspace` 作为共享输入目录，不再把共享 workspace 放在 `tests/fixtures/ai/**` 下维护

### 你的回复相关

- 当对应测试用例文档明确要求引用 PRD 编号时，写正式测试或验收结论应按该文档要求执行
- 最终回复涉及功能实现时，应说明已验证和未验证项；只有在对应测试用例文档明确要求或 `doc/prd/**` 发生变更时，才需要说明 PRD 对齐情况
