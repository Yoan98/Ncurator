# NCurator-Desktop（AI 项目规则）

## 1. 文档引用
### 1.1 AI相关
- `doc/ai-design/architecture.md`：涉及 AI 总体架构、主流程或模块职责时阅读。
- `doc/ai-design/implementation-spec.md`：涉及 AI 实现方式、运行入口、跨层边界、运行时组织，或 context budget / memory compaction、hand 的批次保护/readback 约束、mouth markdown 交付与 references 引用收口时阅读。
- `doc/ai-design/data-definition-and-flow.md`：涉及 AI 数据结构、状态流转、session memory、compact blocks、历史渲染、产物关系，或 thought / references / watch hint / 非法 plan 枚举契约时阅读。
- `doc/ai-design/human-skill-design.md`：涉及 human skill 分类、能力边界、skill 基线、builtin/external 区分，或 active tool budget、工具调用次数边界、docx-write 使用边界时阅读。
- `doc/ai-design/prompt-design.md`：涉及 prompt 结构、工具 schema、工具结果渲染、references 披露策略、检索策略提示或 AI-facing 文案时阅读。

### 1.2 docx相关
- `doc/docx-design/architecture.md`：涉及 docx 总体架构、session/replay 主线或 baseline 机制时阅读。
- `doc/docx-design/implementation-spec.md`：涉及 docx 实现约束、review/commit 链路、serializer 或写入规则时阅读。
- `doc/docx-design/data-definition-and-flow.md`：涉及 docx 数据结构、revision/replay node、artifact 关系或状态流转时阅读。

### 1.3 项目整体相关
- `doc/architecture.md`：涉及项目整体架构与技术栈时阅读。
- `doc/database.md`：涉及数据库模型、持久化结构或文件/记录关系时阅读。
- `doc/project-structure.md`：涉及工程结构、目录归位或模块放置位置时阅读。
- `doc/ui-style.md`：涉及 UI 风格与通用交互规范时阅读。

### 1.4 测试相关
- `doc/test-plan/ai-test.md`：涉及 AI、human live、formal harness、FileReview、KB tool contract，或 docx 串行批写上限/readback/schema 合同/安全停机回归测试设计，或需要维护 AI 正式测试执行摘要/通过率时阅读。
- `doc/test-plan/settings-test.md`：涉及 Settings 测试，或需要区分 workspace 容器、files 子区域、web 子区域测试边界时阅读。
- `doc/test.md`：涉及测试用例编写、runner、日志或测试运行机制时阅读。

### 1.5 prd产品文档相关
- `doc/prd/workbench.md`：涉及 Workbench 产品需求、交互、上下文用量/压缩状态提示或验收标准时阅读。
- `doc/prd/settings.md`：涉及 Settings 产品需求、交互、验收标准，或需要区分 workspace 容器与其 files/web 子区域设计时阅读。

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

### 测试相关

- 涉及工作区语义的测试时，统一使用 `tests/fixtures/workspace` 作为共享输入目录，不再把共享 workspace 放在 `tests/fixtures/ai/**` 下维护

### 你的回复相关
- 当对应测试用例文档明确要求引用 PRD 编号时，写正式测试或验收结论应按该文档要求执行
- 最终回复涉及功能实现时，应说明已验证和未验证项；只有在对应测试用例文档明确要求或 `doc/prd/**` 发生变更时，才需要说明 PRD 对齐情况
