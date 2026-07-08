# NCurator-Desktop Human Skill 设计

本文只定义 `human` 的 skill 设计边界、分类方式与当前基线，只描述当前正式设计，不展开 runtime 细节、目录归位或历史迁移说明。

## 1. 文档定位

- 当需要判断什么能力应该被建模为 `skill` 时，阅读本文。
- 当需要判断 `brain / learning / hand` 各自负责什么，或确认相关字段契约时，阅读 `design-detail.md`。

## 2. 设计目标

- 让 `brain` 能稳定判断“当前缺不缺这类能力说明”。
- 让 `learning` 能按最小必要范围加载 external skill，减少 prompt 噪音。
- 让 `hand` 能基于已经生效的 skill 集合使用正确工具。
- 让 skill 设计长期保持清晰，不被具体工具实现方式反向绑死。

## 3. 设计原则

- `skill` 是 `human` 内部统一使用的能力说明单元，不是目录划分单元。
- skill 的拆分边界按 `brain` 的决策边界确定，不按工具数量或文件数量强行切分。
- skill 不能过大，否则 learning 时会一次引入过多无关说明。
- skill 也不能过碎，否则 `brain` 会频繁学习很多只差一点点的小 skill。
- skill 应优先说明“什么时候用、用来解决什么问题”，而不是把执行步骤写成另一套长 prompt。
- skill 应优先说明“这类能力是什么、什么时候用”，不把实现细节、执行顺序或固定边界话术塞进同一层描述。
- tool 应优先按“能力、结果、边界”说明工具事实，并通过 `inputSchema / outputSchema` 暴露输入与输出结构；不要把调用顺序写成操作手册。
- skill 描述的是能力边界；tool 描述的是具体执行入口；两者有关联，但不是一一等价。

## 4. `skill` 与 `tool` 的关系

- `brain` 判断当前是否缺少某类 skill。
- `learning` 负责把 external skill 加入当前有效能力集合。
- `hand` 只调用当前有效能力集合允许使用的工具。
- 一个 skill 可以对应多个 tools，因为同一类能力往往需要多个执行入口配合。
- 多个 skill 也可以共享同一个实现域，只要它们面向 `brain` 的决策边界不同。
- 本文只定义 skill 该怎么设计，不展开 tool registry、runtime cache 或文件组织方式。
- skill 文案建议收敛为单一主描述字段，不拆成多段重复描述；类型区分只保留 `source` 即可。

## 5. 类型划分

### 5.1 builtin skill

- 始终可用。
- 不需要经过 `learning`。
- 不写入 `learnedSkillIds`。
- 不计入 active tool budget。
- 这里的“不计入 active tool budget”只表示不占 `learning` 阶段的 active tools 容量名额，不表示不计入真实工具调用次数限制。
- 会直接出现在 `brain` 可见的 `skill_catalog` 中。

### 5.2 external skill

- 需要 `learning` 显式加载后才进入当前有效能力集合。
- 会写入 `learnedSkillIds`。
- 受 active tool budget 约束。
- 对 `brain` 来说，生效后它和 builtin skill 一样，都会出现在 `skill_catalog` 中。

## 6. 当前基线 Skill 集合

### `terminal`

- 类型：builtin
- 职责：提供当前 workspace 边界内的 terminal 能力，可按当前平台执行单条终端命令，并返回命令输出、退出状态与可识别的工作区文件产物。
- 工具列表：
  - `terminal_run`
- 适用场景：适用于需要使用当前 workspace 终端能力的任务。`terminal_run` 是单一平台化工具，Windows 使用 PowerShell 语法，macOS 使用 zsh 语法；命令是否直接执行与是否需要审批由当前平台安全指令集决定。

### `docx-read`

- 类型：external
- 职责：读取 sourcePath 对应 docx 的结构、内容块、检索结果和任务内修订历史。
- 工具列表：
  - `docx_outline`
  - `docx_search`
  - `docx_read_blocks`
  - `docx_history`
- 适用场景：适用于需要读取或理解 docx 内容与修订状态的任务。

### `docx-write`

- 类型：external
- 职责：创建新的 Word 文档，或修改已有 Word 文档中的段落、标题、表格、文本和样式。
- 工具列表：
  - `docx_edit`
  - `docx_rollback`
- 适用场景：适用于用户要求生成、补充、改写、删除或格式化 docx 内容的任务；写入后会返回相邻区域的详细回读信息，继续编辑时只能使用读取工具或写后回读返回的真实 blockId，不要推算 blockId。

### `kb-retrieval`

- 类型：builtin
- 职责：查询当前工作区知识库中已建立索引的文档列表，或按查询词、语义语句检索相关内容片段，并返回命中证据、来源文档与内容块信息。检索基本单位是内容块，不是整份文档。
- 工具列表：
  - `kb_list_documents`
  - `kb_search`
- 适用场景：适用于需要使用工作区知识库检索能力的任务。

### `web-browsing`

- 类型：builtin
- 职责：提供网页访问与内置浏览器网页操作能力；`web_crawl` 固定返回 `requestedUrl / finalUrl / markdown / grouped links`，其中 `markdown` 内容来源于 crawl4ai 的 `fit_markdown`，links 保留 internal / external 分组与评分字段，内置浏览器工具在 Workbench 右侧浏览器面板中读取、观察或执行页面动作。
- 工具列表：
  - `web_search`
  - `web_crawl`
  - `browser_use`
- 适用场景：适用于需要读取公开网页内容、基于网页线索继续判断下一步要抓取哪个链接，或需要在网页界面中完成观察、提取、点击、输入等操作的任务；`web_crawl` 的 `topic` 用于 links 评分，不用于正文裁剪；`browser_use` 首次使用需要用户审核。

### `image-recognition`

- 类型：external
- 职责：读取工作区内图片路径，并按当前任务给定的 `instruction` 调用大模型做图像理解。
- 工具列表：
  - `llm_recognize`
- 适用场景：适用于用户已经通过附件或工作区提供了图片，human 需要自己决定怎么提问模型来理解图片内容的任务；工具直接返回普通文本，不要求 JSON。

### `utility`

- 类型：builtin
- 职责：提供任务执行中的通用辅助能力。
- 工具列表：
  - `wait_time`
- 适用场景：适用于需要等待页面加载、异步状态变化或其他短时延迟的任务。

## 7. 与状态和 prompt 的关系

- `learnedSkillIds` 只记录 external 且已经成功学习过的 skill。
- 如果 `learnedSkillIds` 中出现 builtin skill，说明状态已经不符合当前运行时语义，应直接按状态错误处理，而不是兼容清洗。
- `brain` 真正可见、可用的能力集合，是 builtin + learned external，也就是 effective skills。
- `skill_catalog` 应渲染 effective skills，而不是原始文件列表或实现目录。
- `learning` 的结果会进入 `lastLearningOutcome` 与 `rounds`，但 skill 的完整说明不应长期持久化进 `HumanState`。

## 8. 维护规则

- 当 `brain` 的决策边界发生变化时，应重新检查 skill 是否需要合并、拆分或重命名。
- 当 skill 的类型、职责边界或工具列表发生变化时，应同步更新本文档与相关实现。
- 已经落地并确认的 skill 设计，不应继续停留在 `refactor-plan.md` 中。
