# NCurator-Desktop 架构

NCurator-Desktop 是支持 macOS 和 Windows 的本地优先 Electron 应用。文档解析、嵌入、索引、检索、AI 编排和持久化优先在本地完成。

## 技术栈

- Runtime：Electron v39；Language：TypeScript v5；Build：Electron-Vite v5；Package Manager：pnpm。
- Renderer：React v19、React Router DOM v7、Ant Design v5、Tailwind CSS v4、Less。
- Main：LangChain JS、LangGraph JS、@huggingface/transformers v3、better-sqlite3、LanceDB；文档解析使用 pdf-parse、mammoth，中文分词使用 @node-rs/jieba。

## 系统分层

| 层       | 职责与边界                                                                       |
| -------- | -------------------------------------------------------------------------------- |
| Renderer | UI、用户交互与展示态；未发送的文档选区、关联想法和定位状态保留在伙伴级内存       |
| Preload  | Renderer 与 Main 之间的安全桥接                                                  |
| Main     | AI 编排、数据库、文档处理、资料索引、文件写回与系统通知                          |
| Shared   | IPC、运行事件及跨进程共享类型                                                    |
| SQLite   | 业务与元数据真相，包含伙伴、消息、运行、文件修改、资料、定时任务、界面状态与配置 |
| LanceDB  | 可重建的向量与全文索引，不承担业务状态                                           |

伙伴界面和浏览器标签的可持久化状态由 Main 写入 SQLite。数据库 schema 向前演进，索引按文档版本更新；布局与生命周期见 [存储设计](storage/design.md)。

## 核心模块

| 模块                | 职责                                                          |
| ------------------- | ------------------------------------------------------------- |
| Application Shell   | 进程协作、窗口与页面、伙伴界面和资源面板                      |
| AI Runtime          | 请求的运行生命周期、human graph、事件、审批、子会话与最终交付 |
| Storage             | SQLite、LanceDB 及领域 Store                                  |
| Retrieval           | 文档索引、混合召回与结果融合                                  |
| Tool Runtime        | 文件、终端、网页和浏览器等能力的执行、权限与资源范围          |
| File Change Records | 受控文件写回、历史审核与回退；终端只执行，不扫描文件变化记账  |

## 主要数据流

### 请求与执行

```mermaid
flowchart TB
  subgraph renderer [Renderer]
    WB[Workbench UI]
    Composer[Composer]
  end
  subgraph bridge [Preload]
    IPC[IPC 契约]
  end
  subgraph main [Main]
    Run[ChatRunService]
    Graph[human graph]
    Retrieval[Retrieval]
    Tools[Tool Runtime]
  end
  subgraph storage [存储层]
    SQLite[(SQLite 业务真相)]
    Lance[(LanceDB 可重建索引)]
  end
  Composer --> WB
  WB --> IPC --> Run --> Graph
  Run --> SQLite
  Graph --> Retrieval
  Retrieval --> SQLite
  Retrieval --> Lance
  Graph --> Tools
  Tools --> SQLite
  Graph --> IPC --> WB
```

Main 创建运行并读取伙伴上下文。human graph 决定检索、工具执行、用户交互和交付；结果通过事件及 IPC 回到 Renderer。运行完成后由 Main 收尾文件修改记录、保存终态并触发通知。

### AI 数据源与消费方

```mermaid
flowchart LR
  User[Composer 用户发送] --> Submit[ChatRunService]
  Submit --> Log[(chat_session_message_log)]
  Submit --> Graph[human graph]
  Graph --> Log
  Tools[Tool Runtime 写文件] --> FC[(ai_file_change)]
  Graph --> Run[(ai_run)]
  Log --> Brain[brain 上下文]
  Log --> Conv[UI 对话轮次]
  Log --> Proc[UI 过程层]
  Run --> RunUI[运行态 / 审批 / 流式草稿]
  FC --> WB[Workbench 改动 / 回退]
```

消息记录承担任务历史；运行记录承担编排状态；文件修改记录承担审核与回退。三个数据源各有消费方，流式草稿不替代持久化任务历史。

## 关键架构设计

### 免费模型调用

免费模型目录由官网服务端常量和环境变量生成，桌面只缓存模型元数据与短时凭证。所有免费型号经官网 `/api/v1/free/chat/completions` 按精确型号转发，真实上游地址与 Key 不进入桌面。Main 统一负责请求签名与凭证续期；Renderer 仅消费不含凭证的目录投影。图片、工具消息和流式响应复用现有 AI 调用链路。

免费目录缓存具有协议版本；版本不匹配时重建缓存。已移除或型号不匹配的免费选择失效，不隐式映射到其他型号。

### AI 上下文与协作

主任务与子会话共用 human graph、消息投影和压缩机制，但历史按会话隔离。子任务的交付进入父任务，文件修改归本次主运行；未完成子会话可续接，完成后清理。

运行中追加消息由 Main 接收，在当前执行的安全边界交接；中断恢复重建上下文，不自动重放操作。具体流转与不变量见 [Human Harness](ai-harness/human-harness.md)。Skill 管理可用能力，Tool 提供共用契约与执行管道，见 [Tool Design](ai-harness/tool-design.md)。

### 资料索引与检索

SQLite 管理文档来源及有效状态，LanceDB 管理可重建 chunk。检索结合向量语义搜索、全文关键词搜索和 RRF 融合，再补齐 SQLite 中的来源元数据。文件地址和全局网页共享该检索链路。

### 文档处理

| 领域  | 架构思路                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------- |
| DOCX  | 结构化内容树与稳定锚点读写；审核使用原始与最终文档的净比较                                              |
| PDF   | 页级读取、检索与图像；解析由 Worker 隔离                                                                |
| PPT   | 页与元素结构化编辑；普通预览和历史审核使用 SVG，历史资源独立保存                                        |
| Excel | 工作表及区域读写；普通预览与审核共用工作簿转换和公式引擎，历史审核使用固定结果                          |
| 文本  | 普通编辑保留现有编辑器，审核使用按需加载的 Monaco 双栏，左侧为 run 基线、右侧编辑实际文件，共用保存协调 |
| 图片  | 外部 skill 提供文件生成与更新，结果接入文件预览和修改记录                                               |

格式选区通过各自适配器接入共用资料引用，提交时 Main 校验引用；页面交互见 [Workbench PRD](prd/workbench.md)。具体工具契约由源码及按需生成的工具审计提供。

### 文件写盘与审核

受控工具写回正式文件后，后续操作即可读取。Main 管理文件会话、记录归属及收尾，Renderer 读取审核产物进行展示，不负责生成历史比较。

原始修改记录固定本次 A 到最终确认 B；Office 审核保持此历史，点击区域通过语义索引定位实际文件 C。文本审核以所选 run 的 A 对比可编辑的 C，原始 A/B 产物与计数仍固定。馆长默认打开应用由 Main 统一按扩展名解析，WPS 导航使用独立命令及结果回报，不进入写回刷新流程。运行中断时可从持久化输入补生成审核，无需继续执行 AI 或改写正式文件。资源版本、备份和清理规则见 [存储设计](storage/design.md#5-生命周期与一致性)。

### 浏览器与定时任务

浏览器网页运行态由 Main 管理，Renderer 负责面板呈现。网页运行与面板显隐分开，用户及 AI 操作同一应用内标签；工具资源范围由 Tool Runtime 控制。

定时任务保存配置并绑定伙伴，到点向该伙伴提交任务描述，执行读取伙伴当前 Composer 配置。任务记录的持久化由 Storage 负责，运行仍进入同一 AI 主链路。
