# NCurator-Desktop Human Skill 设计

本文只定义 `human` 的 skill 设计边界、分类方式与当前基线，只描述当前正式设计，不展开 runtime 细节、目录归位或历史迁移说明。

## 1. 文档定位

- 当需要判断什么能力应该被建模为 `skill` 时，阅读本文。
- 当需要判断 `brain / learning / hand` 各自负责什么时，阅读 `implementation-spec.md`。
- 当需要确认 `learnedSkillIds`、`skill_catalog`、`lastLearningOutcome` 等字段契约时，阅读 `data-definition-and-flow.md`。

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
- tool 应优先说明“作用、输入方式、返回语义、默认行为与限制”，而不是把调用顺序写成操作手册。
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
- 会直接出现在 `brain` 可见的 `skill_catalog` 中。

### 5.2 external skill

- 需要 `learning` 显式加载后才进入当前有效能力集合。
- 会写入 `learnedSkillIds`。
- 受 active tool budget 约束。
- 对 `brain` 来说，生效后它和 builtin skill 一样，都会出现在 `skill_catalog` 中。

## 6. 当前基线 Skill 集合

### `history-recall`

- 类型：builtin
- 职责：主动回看之前几轮已经做过的正式判断、执行动作和结果。
- 工具列表：
  - `history_search`
  - `history_list`
- 适用场景：当最近一轮和历史摘要还不足以定位失败模式，或需要回看更早细节时使用。

### `workspace-cli`

- 类型：external
- 职责：在当前 workspace 内执行单条 CLI 命令，让 AI 自主通过命令行完成浏览、搜索、读取、验证和生成中间结果。
- 工具列表：
  - `workspace_run_command`
- 适用场景：当任务需要直接使用命令行处理工作区文件、检查环境状态、读取源码或执行单条命令时使用。

### `docx-read`

- 类型：external
- 职责：查看 docx 结构、搜索定位相关 block、连续精读区间与查看版本历史。
- 工具列表：
  - `docx_outline`
  - `docx_search`
  - `docx_read_blocks`
  - `docx_history`
- 适用场景：当任务需要理解 docx 结构、换词搜索、定位段落或表格、连续精读区间，或决定回滚版本时使用。

### `docx-write`

- 类型：external
- 职责：创建或编辑 docx，包括段落、标题、表格、文本、样式调整与版本回滚。
- 工具列表：
  - `docx_create`
  - `docx_paragraph_edit`
  - `docx_heading_edit`
  - `docx_table_edit`
  - `docx_text_edit`
  - `docx_text_style_edit`
  - `docx_rollback`
- 适用场景：当任务需要先生成一份新的 Word 文件，或已经明确知道要改哪里、改成什么，或需要撤销当前草稿修改时使用。

### `kb-retrieval`

- 类型：external
- 职责：工作区知识库检索技能；可查询当前工作区知识库中已建立索引的文档列表，也可按查询词或语句检索相关内容片段，并返回命中证据及其来源文档。背后是通过对文档进行分块建立的 fts 和向量索引来实现的，因此检索的基本单位是内容块，而不是整个文档。
- 工具列表：
  - `kb_list_documents`
  - `kb_search`
- 适用场景：当需要查看工作区知识库中有哪些文档能够被检索，或需要按关键词、查询词或语义语句查找相关内容片段时使用。

## 7. 与状态和 prompt 的关系

- `learnedSkillIds` 只记录 external 且已经成功学习过的 skill。
- `brain` 真正可见、可用的能力集合，是 builtin + learned external，也就是 effective skills。
- `skill_catalog` 应渲染 effective skills，而不是原始文件列表或实现目录。
- `learning` 的结果会进入 `lastLearningOutcome` 与 `roundHistory`，但 skill 的完整说明不应长期持久化进 `HumanState`。

## 8. 维护规则

- 当 `brain` 的决策边界发生变化时，应重新检查 skill 是否需要合并、拆分或重命名。
- 当 skill 的类型、职责边界或工具列表发生变化时，应同步更新本文档与相关实现。
- 已经落地并确认的 skill 设计，不应继续停留在 `refactor-plan.md` 中。
