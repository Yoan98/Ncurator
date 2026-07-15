# NCurator-Desktop 架构

本文是项目唯一架构入口，只描述长期稳定的系统结构、模块职责和主流程。具体字段、工具 schema、底层实现细节以代码和测试为准。

## 技术栈

### 核心环境

- Runtime: Electron v39
- Language: TypeScript v5
- Build: Electron-Vite v5
- Package Manager: pnpm

### Renderer

- React v19
- React Router DOM v7
- Ant Design v5
- Tailwind CSS v4 + Less

### Main

- LangChain JS
- LangGraph JS
- @huggingface/transformers v3
- SQLite + better-sqlite3
- LanceDB v0.23
- pdf-parse
- mammoth
- @node-rs/jieba

## 整体架构

NCurator-Desktop 是本地优先的 Electron 桌面应用。文档解析、嵌入、索引、检索、AI 编排和持久化都优先在本地完成。

系统按进程和能力分层：

- Renderer 负责 UI 展示、用户交互和状态呈现。
- Main 负责 AI 编排、数据库访问、文档处理、资料索引和写回流程。
- Preload 负责 Renderer 与 Main 之间的安全桥接。
- Shared 负责 IPC 契约、事件类型和跨进程共享类型。

存储按职责分层：

- SQLite 是业务真相，保存会话、消息、AI run、审批、文件修改记录、文档元数据、网页源、工作区状态和配置。
- LanceDB 只保存可重建的 `vector_chunk` 向量索引。
- SQLite schema 通过 migration 向前演进，LanceDB 索引可按文档 generation 重建。

检索采用混合召回：

- 向量搜索负责语义召回。
- LanceDB FTS 负责关键词召回。
- RRF 负责融合结果。

## 核心模块

### AI Runtime

AI Runtime 负责一次用户请求的 run 生命周期、事件流、审批、工具调用和最终答复。它不直接承担所有任务逻辑，而是把具体能力交给 human graph、工具和领域服务。

### Storage

Storage 负责本地持久化：

- `SqliteCore` 负责 SQLite 连接、PRAGMA 和 migration。
- `LanceDbCore` 只负责 `vector_chunk` 表初始化、搜索和维护。
- 各领域 Store 负责对应业务数据读写。

### Retrieval

Retrieval 负责文档索引、向量检索、全文检索和结果融合。检索前会先从 SQLite 读取当前有效的 `document.active_generation_id`，再到 LanceDB 搜索有效 generation。

### Docx Runtime

Docx Runtime 负责 Word 文档读取、搜索、编辑、任务内回滚、写回和用户回退。它通过 AI 工具暴露能力，但底层由 runtime、worker 和 OOXML adapter 分层完成。

### Text File Runtime

Text File Runtime 通过 builtin `text-file` skill 提供 `file_read` 和 `file_write`。它负责 UTF-8 普通文本读取、创建、完整改写、唯一文本编辑和全部精确匹配替换。写入先完成全部校验，再通过同目录临时文件原子替换；写入前保存 bytes checkpoint，写入后根据真实 before/after 生成结构化行级 diff。

### Apply Review

Apply Review 负责 AI 修改文件后的统一记录、预览和回退入口。Docx、Text File Runtime 和 terminal 识别出的 UTF-8 文件修改都写入统一文件修改记录。Renderer 根据记录 capability 路由：docx 使用文档预览，`text_file` 使用独立文本 diff，普通文件预览仍使用文件渲染器。用户回退依赖完整 checkpoint，不依赖 diff 反向计算。

### Workbench Resource Workspace

Workbench 右侧由资源 Tab 和内容渲染两层组成。Tab 状态按会话保存在 Renderer 内存中，目前只承载文件和内置浏览器；文件按标准化路径去重，普通预览与修改 diff 共用同一个文件 Tab，浏览器固定为单例 Tab。搜索结果是临时面板状态，不占用资源 Tab。切换文件 Tab 会重新选择对应渲染状态；切换离开浏览器只隐藏 `WebContentsView`，不会销毁页面。

## AI 架构

AI 架构围绕一次 `run` 展开。每次用户请求都会创建一个 run，run 内由 `human` 推进任务。

```mermaid
flowchart TD
    U["用户输入"]
    S["会话上下文\nrecent messages + conversation summary"]
    R["AI Run"]
    B["context_budget\n检查上下文预算"]
    C["brain\n决定下一步"]
    L["learning\n加载 external skill"]
    H["hand\n执行工具"]
    M["mouth\n组织最终答复"]
    P["context_compaction\n压缩 run 内较早历史"]
    O["最终答复"]
    N["更新 conversation summary"]

    U --> R
    S --> R
    R --> B
    B -->|预算正常| C
    B -->|需要压缩| P
    P --> B
    C -->|需要能力| L
    C -->|需要工具| H
    C -->|可以答复| M
    L --> B
    H --> B
    M --> O
    O --> N
    N --> S
```

### 主要职责

- `human` 是当前 AI run 的执行核心。
- `brain` 负责判断下一步，不直接执行工具。
- `learning` 负责按需加载 external skill。
- `hand` 负责执行工具，并把结果交回 run。
- `mouth` 负责组织最终答复和交付内容。
- `context_budget` 负责在每一步前检查上下文预算。
- `context_compaction` 只压缩当前 run 内较早过程，服务本次 run 继续推进。

### Skill 与 Tool

AI 能力通过 skill 和 tool 两层表达：

- builtin skill 默认可用，不需要 learning 加载。
- external skill 需要 learning 显式加载后才进入当前有效能力集合。
- skill 描述能力边界和适用场景。
- tool 是具体执行入口，输入输出和限制以代码中的 schema 为准。

skill 不按目录强行拆分，也不等同于工具数量。一个 skill 可以对应多个 tool，多个 skill 也可以共享同一实现域。

`text-file` 是 builtin skill，默认提供普通文本读写能力。AI-facing 的写入结果只返回简短成功文本；结构化 diff、快照路径和 checksum 只进入内部修改记录，不进入模型工具结果。

### 会话连续性

run 完成后，系统会基于本轮用户输入、最终答复和产物更新 conversation summary。下一次 run 会读取最近消息和 summary，形成跨轮连续性。

## Docx 架构

Docx 架构负责让 AI 可以读取、连续编辑并安全写回 Word 文档。它的目标不是维护一份独立审阅稿，而是让 AI 在任务内持续基于最新文档状态工作，最终直接写回源文件，并提供可回退记录。

```mermaid
flowchart TD
    A["Tool API\ndocx tools"] --> B["Read / Write Tools"]
    B --> C["Runtime / Session"]
    C --> D["Worker"]
    D --> E["OOXML Adapter"]
    C --> F["Apply / Checkpoint / Revert"]
```

### 主要分层

- Tool API 层负责对 AI 暴露 docx 读取和写入能力。
- Read / Write Tools 层负责 AI-facing 的读取、搜索、编辑和任务内回滚。
- Runtime / Session 层负责 sourcePath、read session、replay session、revision 和 open target 管理。
- Worker 层负责实际打开、解析、搜索、编辑执行和校验。
- OOXML Adapter 层负责 docx 结构解析、block 建模和底层操作。
- Apply / Checkpoint / Revert 层负责最终写回、写回前 checkpoint 和用户回退。

### 主流程

1. 读取阶段先基于源文件建立 read session。
2. 只有需要创建、编辑、历史或回滚时，才升级到 replay session。
3. AI 每轮读取当前 working view，不反复回到源文件重算。
4. 编辑成功后，replay session 更新，并投影出新的 working view。
5. run 结束时，从 committed view 写回源文件。
6. 写回前保存 checkpoint，写回后记录统一文件修改记录。
7. 用户回退时根据修改记录恢复 checkpoint 或删除新建文件。

### 关键原则

- source 只负责初始化基线和最终写回目标。
- read session 只负责读取，不提前承担持续编辑职责。
- replay session 是任务内持续编辑的运行时真相。
- AI 永远基于当前 working view 继续工作。
- 写回永远从 committed view 落盘。
- checkpoint 是用户回退真相，revision 是 AI 任务内编辑历史，二者不能互相替代。

## 普通文本文件架构

普通文本文件链路不使用 unified diff 作为 AI 输入或输出：

1. `file_read` 解码 UTF-8 文本，并返回指定行范围和总行数。
2. `file_write` 按 action 校验完整输入；`edit` 的每个 `oldText` 必须唯一且互不重叠，`replaceAll` 对一个非空 `oldText` 执行全部非重叠精确替换。
3. 后端保留原始 BOM、换行风格和文件权限，写入前再次检查文件未发生变化。
4. 写入成功后保存完整 before snapshot，并通过 `diff` 库把真实 before/after 转为带行号的结构化 hunks。
5. Workbench 的 `TextFileDiffViewer` 读取结构化 diff，使用单行号列展示新增、删除、上下文和词级变化，hunk 间用“N 行未修改”收起；大 diff 使用虚拟列表。
6. 回退更新文件时恢复原始 bytes；回退新建文件时删除目标，历史 diff 保留用于查看。
7. terminal 执行前后若识别到 UTF-8 文件发生变化，复用同一结构化 diff 与修改记录链路；无法严格解码的产物保持 `terminal_exec`。

普通文件预览先保留 PDF、DOCX 和 Markdown 的专用渲染；其他文件严格 UTF-8 解码成功后统一进入纯文本渲染，因此 `.log`、代码、JSON、HTML 等普通文本无需逐个维护扩展名白名单。解码失败时不进入纯文本渲染，避免误展示二进制内容。

## 存储架构

存储架构遵循一个原则：业务状态只有一个真相。

- SQLite 保存业务状态和元数据。
- LanceDB 保存可重建索引。
- 业务查询先经过 SQLite 确认有效范围，再进入 LanceDB 检索。
- 详细数据库设计见 `doc/database.md`。

## 索引一致性

文件和网页索引使用 `generation_id` 保证一致性：

1. SQLite 将 document 标记为 indexing。
2. 生成新的 generation。
3. 写入新 generation 的 LanceDB chunks。
4. 写入成功后切换 SQLite `active_generation_id`。
5. 后台删除旧 generation。
6. 失败时不切换 active generation，旧索引继续可用。

检索时只搜索当前 active generation，避免读到过期索引。

## 主链路

1. Renderer 发起用户请求。
2. Main 创建 run，并读取会话上下文和工作区状态。
3. AI Runtime 通过 human graph 推进 brain、learning、hand、mouth。
4. 需要资料时进入 Retrieval，读取 SQLite 元数据并检索 LanceDB。
5. 需要 docx 能力时进入 Docx Runtime；需要普通文本能力时进入 Text File Runtime。
6. 文件写回后记录统一修改记录和对应预览，供 UI 展示和回退。
7. 最终答复和事件流通过 IPC 回到 Renderer 展示。
