# NCurator-Desktop 系统总览

## 1. 目标

- 本地优先处理资料，不依赖云端文档处理链路。
- 用统一工作台承载 `AI 对话` 与 `纯搜索` 两种模式。
- 通过 Main/Renderer/Shared 边界控制复杂度，避免跨层耦合。

## 2. 系统边界

- `Renderer`
  - 负责页面、时间线、检查器、审阅中心与交互状态。
- `Main`
  - 负责资料准备、数据库访问、AI graph、审批和草稿提交流程。
- `Shared`
  - 负责 IPC 契约、事件和跨进程共享实体。
- `Storage`
  - 通过 `StorageService`、`LanceDbCore` 与各 `*Store` 管理 LanceDB。
- `AI Runtime`
  - 由 Main 侧的 graph、prompt、tool registry、state schema 与审阅流程组成。

## 3. 核心数据流

### 3.1 资料准备与检索

1. 资料导入或准备后写入 LanceDB。
2. 检索同时使用向量搜索与 LanceDB FTS。
3. 结果通过 RRF 融合，供纯搜索或 AI runtime 消费。

### 3.2 AI 运行

1. Renderer 发起 run 或纯搜索请求。
2. Main graph 决定上下文补充、计划和任务执行。
3. Human subgraph 通过 skill cards 和 active tools 执行单任务。
4. 结果通过事件流与审阅 IPC 投影回 Renderer。

### 3.3 草稿审阅与提交

1. AI 编辑运行只生成草稿与审阅数据。
2. 审阅阶段由独立 draft review store 和 IPC 承载。
3. 最终提交前校验源文件新鲜度，避免过期写回。

## 4. 默认阅读路径

- AI 架构：`doc/architecture/ai/*`
- 存储与数据库：`doc/architecture/database.md`
- 目录规范：`doc/architecture/project-structure.md`
- 类型治理：`doc/conventions/type-governance.md`
