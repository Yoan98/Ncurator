# NCurator-Desktop（AI 项目规则）

## 1. 文档引用

### 1.1 架构相关

- `doc/architecture.md`：项目整体架构、模块关系、领域能力概要。
- `doc/ai-harness/human-harness.md`：human graph 消息、投影、范围判定、compaction、resume、brain 上下文。
- `doc/ai-harness/tool-design.md`：工具 schema、modelResult、统一投递管道。
- `doc/database.md`：涉及 SQLite、LanceDB、索引、持久化关系或数据库结构时阅读。

### 1.2 项目整体相关

- `doc/release.md`：涉及桌面端打包、发布仓库、自动更新或发版流程时阅读。
- `doc/brand.md`：涉及产品显示名、下载文件名、缓存/技术标识分层或中英品牌口径时阅读。
- `doc/tencent-cdn-billing.md`：涉及腾讯云 COS/CDN 国内下载通道的资费、采购、封顶与余额策略时阅读。
- `doc/ui-style.md`：涉及全前端视觉系统、主题或通用交互规范时阅读。

### 1.3 测试相关

- `doc/test-plan/ai-test.md`：涉及 AI 回归测试范围、live case 设计或 suite 覆盖维护时阅读。
- `doc/test-plan/settings-test.md`：涉及 Settings 测试范围或测试边界时阅读。
- `doc/test-plan/workbench-test.md`：涉及 Workbench 回归测试范围、真实 e2e case 设计、发送前置条件验证或 suite 覆盖维护时阅读。
- `doc/test.md`：涉及测试体系、UI E2E 回归规则、runner 或回归测试流程时阅读。
- `doc/tidy.md`：需要按周期整理文档、PRD、测试计划、测试用例或清理代码整洁度（死代码、兼容残留、无用代码、简洁性）时，先按其中流程审计并等待决策。

### 1.4 prd产品文档相关

- `doc/prd/workbench.md`：涉及 Workbench 产品需求、发送前置条件、消息流/过程层交互、定时任务或 composer 偏好验收标准时阅读。
- `doc/prd/settings.md`：涉及 Settings 产品需求、文件地址森林、全局网页资料、索引/模型/通知或验收标准时阅读。
- `doc/ai-tool-prompt-audit.md`：Skill / Tool 契约活例子，**按需生成、不入库**（`pnpm doc:ai-tool-prompt-audit`）；改工具契约时本地生成对照，不替代 `tool-design.md`。

## 2. 项目目录结构

```text
.
├── AGENTS.md                         # 根规则、文档入口、目录结构和协作规范
├── doc/                              # 项目文档
│   ├── architecture.md               # 项目总架构
│   ├── ai-harness/                   # AI human harness 与工具契约
│   │   ├── human-harness.md          # 消息、投影、范围判定、compaction、resume
│   │   └── tool-design.md            # 工具 schema 与结果投递
│   ├── database.md                   # SQLite 与 LanceDB 存储说明
│   ├── release.md                    # 打包、发布和更新
│   ├── brand.md                      # 产品命名与技术标识分层
│   ├── tencent-cdn-billing.md        # 腾讯云 COS/CDN 资费与采购定稿
│   ├── test.md                       # 测试体系和执行规则
│   ├── ui-style.md                   # UI 风格和交互规范
│   ├── prd/                          # 产品需求
│   │   ├── settings.md               # Settings 产品需求
│   │   └── workbench.md              # Workbench 产品需求（含定时任务）
│   ├── test-plan/                    # 专项测试计划
│   │   ├── ai-test.md                # AI 回归测试计划
│   │   ├── settings-test.md          # Settings 测试计划
│   │   └── workbench-test.md         # Workbench 测试计划
│   └── tidy.md                       # 周期性文档、测试与代码整理流程
├── src/                              # 应用源码
│   ├── main/                         # Electron Main 进程
│   │   ├── ipc/                      # IPC handler 和通道入口
│   │   ├── services/                 # 主进程业务服务
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
│   │   ├── unit/                     # backend 单元测试
│   │   └── workbench/                # Workbench 测试用例
│   ├── fixtures/                     # 长期复用测试输入
│   │   ├── workspace/                # 工作区语义测试共享输入目录
│   │   └── sqlite/                   # SQLite 升级与版本门禁 fixture
│   ├── harness/                      # 测试基础设施
│   │   ├── backend/                  # 后端测试基础设施
│   │   ├── core/                     # 通用测试基础设施
│   │   └── e2e/                      # UI E2E 测试基础设施
│   └── logs/                         # 测试日志
├── resources/                        # 运行期资源
│   ├── native/                       # 原生模块预编译产物
│   ├── open-with/                    # 系统打开方式相关资源
│   └── web_crawler_sidecar/          # 网页抓取 sidecar 资源
├── scripts/                          # 工程脚本
│   ├── postinstall.mjs               # 安装后的唯一根级入口
│   ├── doc/                          # 文档生成（如 ai-tool-prompt-audit）
│   ├── dev/                          # 本地开发辅助脚本
│   ├── build/                        # 构建、运行时追踪、原生模块和打包审计
│   │   ├── native/                   # Node/Electron 原生模块准备
│   │   ├── package/                  # staging、main 混淆和安装包审计
│   │   ├── runtime/                  # bundle 边界、递归依赖追踪和暂存验证
│   │   └── sidecar/                  # 网页抓取 sidecar 构建
│   ├── release/                      # 本地发布、对象存储和发布共享能力
│   │   ├── storage/                  # 发布存储抽象（默认 COS，可切 R2）
│   │   ├── cos/                      # 腾讯云 COS 上传与策略
│   │   ├── r2/                       # Cloudflare R2 上传
│   │   └── shared/                   # 发布流程共享能力
│   └── test/                         # 源码/正式包 E2E 编排和真实更新测试
├── build/                            # 构建相关资源
├── logo/                             # logo 资源
│   └── png/                          # png 格式 logo
├── .vscode/                          # VS Code 配置
├── .codex-tmp/                       # Codex 临时产物，不承载长期代码和文档
├── .pip-cache/                       # Python 依赖缓存，不承载长期代码和文档
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
- `src/main/utils/**` 只放 Main 侧通用工具，不放强业务流程。
- `src/main/types/**` 只放 Main 侧 ambient / 适配声明；跨进程类型放 `src/shared/**`。

### 3.3 Renderer 目录

- 页面级内容放 `pages/**`。
- 通用组件放 `components/**`。
- 前端服务与请求封装放 `services/**`。
- 仅 Renderer 使用的展示态类型放 Renderer 内部 `types/**`。
- 通用前端工具放 `utils/**`。
- 跨页状态放 `contexts/**`；测试 selector 放 `testing/**`。

### 3.4 Shared 目录

- IPC request/response 放 `src/shared/**`。
- 运行事件放 `src/shared/**`。
- Main 与 Renderer 都会消费的数据结构放 `src/shared/**`。
- 只给 Main、AI、human 或 Renderer 单侧使用的类型与常量，不要放进 `src/shared/**`。

## 4. 你必须遵守的规则

### 代码实现

1. 允许破坏性重构
   不需要兼容旧逻辑，优先以代码质量、可读性、简单性和长期维护性为目标。
2. 消除重复与合理抽象
   重复逻辑、重复类型应进行抽象封装；但避免过度抽象，不要为了封装导致代码零散、复杂。
3. 简化复杂实现
   对于过度复杂的代码逻辑，如果存在更简单、更清晰、更易维护的实现，应直接重构替换。
4. 优化文件与代码组织
   合理拆分或合并文件，避免文件过碎或职责混乱；保持代码结构清晰、直观，降低理解和维护成本。
5. 类型禁止使用非必要的 `any` 与 `unknown`
6. 字段遵循最小必要原则

### 文档相关

- 代码变更必须要看是否要同步更新prd和test文档
