# NCurator-Desktop Human Skill 设计

本文定义 `human` 的 skill 集合、skill 拆分边界，以及 skill 和 tools 的关系，只描述当前基线，不保留历史迁移说明。

## 1. 设计目标

- `skill` 是 `human` 统一使用的能力说明单元，分为 builtin 与 external 两类。
- `skill` 的命名要让 `brain` 能清楚判断“现在缺不缺这类说明”。
- `skill` 的拆分要减少 prompt 噪音，让 `brain`、`learning` 和 `hand` 都能围绕同一套能力边界稳定推进。

## 2. 设计原则

- `skill` 是 `human` 内部统一使用的设计概念。
- builtin skill 始终可用，直接出现在 `your_capabilities`；external skill 才进入 `learning`。
- skill 拆分按 `brain` 的决策边界来定，不按历史命名习惯强行延续。
- skill 不能过大，否则 learning 的说明噪音太高。
- skill 也不能过碎，否则 `brain` 会反复学习过多小 skill。
- `skillCatalog` 只保留摘要信息；完整 skill 说明在 `brain` prompt 拼装时按“builtin + learned external”动态展开。
- skill 是决策与学习边界，不等于文件系统边界。
- tools 的代码实现按实现域归位即可，一个实现域可以同时服务多个 skill。
- `src/main/services/ai/human/skills.ts` 是 skill 的单一事实源，直接维护 `skill -> familyId / source / availability / toolNames / whenToUse / detail` 的映射。
- tool spec 由各 family 自己维护在 `tools/<family>/toolSpecs.ts`，不再通过独立 `catalog` 二次派生。
- `tools/registry.ts` 只做聚合与查询，不再额外建立一层并行 tool contract 模型。

## 3. 类型划分

### 3.1 builtin skill

- 始终可用。
- 不需要 learning。
- 不写入 `learnedSkillIds`。
- 不计入 active tool budget。
- 直接通过 `your_capabilities` 暴露给 `brain`。

### 3.2 external skill

- 需要 `learning` 显式加载。
- 会写入 `learnedSkillIds`。
- 是否继续保留受 active tool budget 约束。
- 对 `brain` 来说，它和 builtin skill 一样都会出现在有效能力集合中。

## 4. 当前目标 Skill 集合

### `history-recall`

- 类型：builtin
- 对应工具：`history_recall`
- 用途：主动回看之前几轮已经做过的正式判断、执行动作和结果。

### `workspace-cli`

- 类型：external
- 对应工具：`terminal_run_command`
- 用途：读取 workspace 文件、检查环境、执行单条 CLI 命令。

### `docx-read`

- 类型：external
- 对应工具：`docx_open`、`docx_outline`、`docx_get_block`、`docx_search`、`docx_get_history`
- 用途：打开 docx、定位结构、查找内容、查看历史。

### `docx-write`

- 类型：external
- 对应工具：`docx_apply_ops`、`docx_rollback`
- 用途：修改 docx 内容，或基于历史快照回滚。

### `docx-delivery`

- 类型：external
- 对应工具：`docx_validate`、`docx_render_preview`、`docx_save`
- 用途：做文档校验、生成预览、按需落盘。

### `kb-document-discovery`

- 类型：external
- 对应工具：`kb_list_documents`
- 用途：在当前工作区知识库内缩小候选文档范围。

### `kb-evidence-query`

- 类型：external
- 对应工具：`kb_hybrid_search_chunks`、`kb_vector_search_chunks`、`kb_fts_search_chunks`
- 用途：在当前工作区知识库中直接查询 chunk 证据并收敛事实依据；已选资料足够明确时可先缩圈，不足时可扩大回当前工作区范围。

## 5. 与状态设计的关系

- `skillCatalog` 存的是以上 skill 的摘要信息。
- `learnedSkillIds` 只存 external 且已经学习过的 skill id；builtin skill 不写入这里。
- `brain` 真正可见、可用的能力集合是 builtin + learned external，也就是 effective skills。
- `learning` 只负责 external skill，不负责 builtin skill。
- tool 的选择、过滤和装配由 `skillLoader + tools/registry.ts` 完成，不要求放进 skill 同名目录。
