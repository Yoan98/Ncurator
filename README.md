# NCurator-Desktop（AI 项目规则）

## 1. 文档引用

### 1.1 架构相关

- `doc/architecture.md`：涉及项目整体架构、AI 架构、Docx 架构、模块关系或主流程时阅读。
- `doc/database.md`：涉及 SQLite、LanceDB、索引、持久化关系或数据库结构时阅读。

### 1.2 项目整体相关

- `doc/release.md`：涉及桌面端打包、发布仓库、自动更新或发版流程时阅读。
- `doc/ui-style.md`：涉及全前端视觉系统、主题或通用交互规范时阅读。

### 1.3 测试相关

- `doc/test-plan/ai-test.md`：涉及 AI 回归测试范围、live case 设计或 suite 覆盖维护时阅读。
- `doc/test-plan/settings-test.md`：涉及 Settings 测试范围或测试边界时阅读。
- `doc/test-plan/workbench-test.md`：涉及 Workbench 回归测试范围、真实 e2e case 设计、发送前置条件验证或 suite 覆盖维护时阅读。
- `doc/test.md`：涉及测试体系、UI E2E 回归规则、runner 或回归测试流程时阅读。

### 1.4 prd产品文档相关

- `doc/prd/workbench.md`：涉及 Workbench 产品需求、发送前置条件、消息流/过程层交互或 composer 偏好验收标准时阅读。
- `doc/prd/settings.md`：涉及 Settings 产品需求、工作区目录绑定提示、具名工作空间资料/索引交互或验收标准时阅读。

## 2. 项目目录结构

```text
.
├── README.md                         # 根规则、文档入口、目录结构和协作规范
├── doc/                              # 项目文档
│   ├── architecture.md               # 项目总架构，包含 AI 架构和 Docx 架构
│   ├── database.md                   # SQLite 与 LanceDB 存储说明
│   ├── release.md                    # 打包、发布和更新
│   ├── test.md                       # 测试体系和执行规则
│   ├── ui-style.md                   # UI 风格和交互规范
│   ├── prd/                          # 产品需求
│   │   ├── settings.md               # Settings 产品需求
│   │   └── workbench.md              # Workbench 产品需求
│   └── test-plan/                    # 专项测试计划
│       ├── ai-test.md                # AI 回归测试计划
│       ├── settings-test.md          # Settings 测试计划
│       └── workbench-test.md         # Workbench 测试计划
├── src/                              # 应用源码
│   ├── main/                         # Electron Main 进程
│   │   ├── ipc/                      # IPC handler 和通道入口
│   │   ├── services/                 # 主进程业务服务
│   │   ├── testing/                  # 主进程测试辅助能力
│   │   ├── types/                    # Main 侧通用类型
│   │   └── utils/                    # Main 侧通用工具
│   ├── preload/                      # Electron preload 桥接层
│   ├── renderer/                     # Renderer 工程
│   │   └── src/                      # React 页面、组件、状态和前端服务
│   └── shared/                       # Main / Renderer 共享类型与契约
├── tests/                            # 自动化测试
│   ├── case/                         # 测试用例
│   │   ├── ai/                       # AI 测试用例
│   │   ├── settings/                 # Settings 测试用例
│   │   ├── unit/                     # unit / helper / schema 类测试
│   │   └── workbench/                # Workbench 测试用例
│   ├── fixtures/                     # 长期复用测试输入
│   │   └── workspace/                # 工作区语义测试共享输入目录
│   ├── harness/                      # 测试基础设施
│   │   ├── backend/                  # 后端测试基础设施
│   │   ├── core/                     # 通用测试基础设施
│   │   └── e2e/                      # UI E2E 测试基础设施
│   └── logs/                         # 测试日志
├── resources/                        # 运行期资源
│   └── web_crawler_sidecar/          # 网页抓取 sidecar 资源
├── scripts/                          # 工程脚本
│   └── tmp/                          # 脚本临时产物
├── build/                            # 构建相关资源
├── logo/                             # logo 资源
│   └── png/                          # png 格式 logo
├── .codex/                           # Codex 项目配置
│   └── skills/                       # Codex 技能定义
├── .agent/                           # Agent 本地配置
├── .claude/                          # Claude 本地配置
├── .vscode/                          # VS Code 配置
├── .codex-tmp/                       # Codex 临时产物，不承载长期代码和文档
├── .pip-cache/                       # Python 依赖缓存，不承载长期代码和文档
├── .pyinstaller/                     # PyInstaller 构建缓存，不承载长期代码和文档
└── .runvenv/                         # 本地运行虚拟环境，不承载长期代码和文档
```

## 3. 目录规范

### 3.1 总体原则

- 文件位置要可预测，减少跨层耦合和逻辑散落。
- Main、Renderer、Shared 边界必须清晰。
- 业务逻辑优先放领域目录，不放到无语义的公共目录。
- 共享类型只在确实跨进程共享时放入 `src/shared/**`。
- 临时产物目录不承载长期源码、长期文档或长期测试样本。

### 3.2 Main 目录

- `src/main/services/**` 放业务编排、领域服务和适配层。
- `src/main/services/storage/**` 放 SQLite、LanceDB 和领域 Store。
- AI 运行入口与基础设施放在 `src/main/services/ai/**`。
- AI human graph、node、prompt、skill、tool 按 human 领域收口。
- Tool 实现按实现域归位，例如 docx、textFile、kb、terminal；builtin `text-file` skill 通过 `text_file_read/text_file_edit` 提供 UTF-8 普通文本和代码文件读写。
- Docx replay、apply、checkpoint 和 revert 能力放在 AI human tools 的 docx 领域下；普通文本写入使用结构化 diff 和统一文件修改记录，不把 unified diff 返回给 AI。
- `src/main/utils/**` 只放 Main 侧通用工具，不放强业务流程。
- `src/main/types/**` 只放 Main 侧通用类型。

### 3.3 Renderer 目录

- 页面级内容放 `pages/**`。
- 通用组件放 `components/**`。
- 前端服务与请求封装放 `services/**`。
- 仅 Renderer 使用的展示态类型放 Renderer 内部 `types/**`。
- 通用前端工具放 `utils/**`。

### 3.4 Shared 目录

- IPC request/response 放 `src/shared/**`。
- 运行事件放 `src/shared/**`。
- Main 与 Renderer 都会消费的数据结构放 `src/shared/**`。
- 只给 Main、AI、human 或 Renderer 单侧使用的类型与常量，不要放进 `src/shared/**`。

### 3.5 测试目录

- `tests/harness/**` 只放可复用的测试基础设施。
- `tests/harness/e2e/**` 只封装 UI 自动化、原生目录选择自动化、真实临时文件、本地 HTTP 服务、截图、raw log 读取和 IPC observer。
- `tests/harness/e2e/**` 不提供 preload override、直接创建业务状态、假模型、假搜索结果、假下载进度、假 AI 事件或假附件选择结果。
- `tests/fixtures/**` 只放长期复用的输入样本，不混入运行产物。
- `tests/fixtures/workspace/` 是共享工作区输入目录。
- `tests/case/ai/**` 放 AI formal tests。
- `tests/case/unit/**` 放长期保留、但不进入 formal test-plan 的 unit / helper / schema / prompt 类测试。

## 4. 必须遵守的规则

### 代码相关

- 禁止使用 `Modal.confirm`、`Modal.info` 等静态方法
- 禁止未经允许就私自创建任何文档

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

- 文档入口或文档变更时，需同步更新本文档的“文档引用”部分；本文档承担根文档索引职责。
- 代码变更必须要看是否要同步更新prd和test文档

### 测试相关

- 涉及工作区语义的测试时，统一使用 `tests/fixtures/workspace` 作为共享输入目录，不再把共享 workspace 放在 `tests/fixtures/ai/**` 下维护

### 你的回复相关

- 当对应测试用例文档明确要求引用 PRD 编号时，写回归测试或验收结论应按该文档要求执行
- 最终回复涉及功能实现时，应说明已验证和未验证项；只有在对应测试用例文档明确要求或 `doc/prd/**` 发生变更时，才需要说明 PRD 对齐情况
