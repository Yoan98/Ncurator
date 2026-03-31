# NCurator-Desktop（AI 项目规则）

## 1. 文档引用
### 1.1 AI相关
- 当涉及 AI 总体架构、Director/Human 分工或主流程时，请阅读 `doc/ai-design/architecture.md`
- 当涉及 AI 节点实现，请阅读 `doc/ai-design/implementation-spec.md`
- 当涉及 AI 状态字段、数据流转、`ToolCallResult.diagnostic`、`selectedContextText` 或 `human` 的运行约束投影时，请阅读 `doc/ai-design/data-definition-and-flow.md`
- 当想看 AI 完整跑一遍的真实样例，请阅读 `doc/ai-design/example.md`
- 当涉及 `human` 的 skill设计、`skills.ts`、family `toolSpecs.ts` 或 tools registry 时，请阅读 `doc/ai-design/human-skill-design.md`
- 当涉及 AI prompt 设计，请阅读 `doc/ai-design/prompt-design.md`
- 当涉及 AI 后续重构方向、迭代规划或未决方案时，请阅读 `doc/ai-design/refactor-plan.md`

### 1.2 项目整体相关
- 当涉及技术栈、整体架构、请阅读 `doc/architecture.md`
- 当涉及数据库、LanceDB、表职责或检索存储实现时，请阅读 `doc/database.md`
- 当涉及目录规范、模块边界、文件归位或工程结构时，请阅读 `doc/project-structure.md`
- 当涉及 UI 整体风格、配色、字级、圆角、阴影、图标、cursor 或通用交互 affordance 时，请阅读 `doc/ui-style.md`

### 1.3 测试相关
- 当涉及AI的测试计划、阶段划分、suite/group归属、tool/docx 或 human/director 正式 case 边界、`human/scenarios/live` 用例实现状态、AI live 用例设计、live 节流与开关、正式 case 登记 / 裁剪、raw logs / report 更新、report 判因或 live / 非 live 测试边界时，请阅读 `doc/test-plan/ai-test.md`
- 当涉及Workbench的测试计划、suite划分、标准任务闭环 smoke、`@` 多 token / 多类型插入、右侧持续工作区、review 导航 / anchor、文件级确认或与 `doc/prd/workbench.md` 的测试对齐时，请阅读 `doc/test-plan/workbench-test.md`
- 当涉及Settings的测试计划、suite划分、正式 case 登记 / 裁剪、raw logs / report 更新或与 `doc/prd/settings.md` 的测试对齐时，请阅读 `doc/test-plan/settings-test.md`
- 当涉及测试架构、目录分层、正式 case 字段填写或 case 登记规则时，必须阅读 `doc/test.md`

### 1.4 prd产品文档相关
- 当涉及 workbench 的会话管理、composer 输入、标准任务闭环、工作区绑定、`@` 参考资料 token 与多 token 插入、AI 运行阻塞、搜索结果、右侧持续工作区、文档预览、确认修改文件 tab 或同文件多轮累计差异的产品需求、操作逻辑、状态反馈或验收标准时，请阅读 `doc/prd/workbench.md`
- 当涉及 `Settings -> 大模型 / 工作空间 / 网页资料 / 向量模型` 的产品需求、功能入口、交互流程、操作逻辑、状态反馈或验收标准时，请阅读 `doc/prd/settings.md`

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
