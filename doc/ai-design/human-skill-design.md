# NCurator-Desktop Human Skill 设计

## 1. 适用范围

- 当涉及 `human` 的 skill 集合、skill 命名或 skill 拆分边界时，阅读本文档。
- 当涉及 `skillCatalog`、`learnedSkillIds`、learning 节点学习什么 skill 时，阅读本文档。
- 当需要判断某个旧名称应该如何迁移到新的 skill 命名时，阅读本文档。

## 2. 设计目标

- `skill` 是 `human` 可学习的说明单元。
- `skill` 的命名要让 `brain` 能清楚判断“现在缺不缺这类说明”。
- `skill` 的拆分要减少 prompt 噪音，让 `learning` 学到的是一组清晰、可用、可收敛的工具说明。

## 3. 设计原则

- `skill` 是 `human` 内部的设计概念，统一替代旧 `capability` 叫法。
- skill 拆分按 `brain` 的决策边界来定，不按历史旧名称强行延续。
- skill 不能过大，否则 learning 的说明噪音太高。
- skill 也不能过碎，否则 `brain` 会反复学习过多小 skill。
- `skillCatalog` 只保留摘要信息；完整 skill 说明在 `brain` prompt 拼装时按 `learnedSkillIds` 动态展开。

## 4. 当前目标 Skill 集合

### `workspace-cli`

- 对应工具：`terminal_run_command`
- 用途：读取 workspace 文件、检查环境、执行单条 CLI 命令。

### `docx-read`

- 对应工具：`docx_open`、`docx_outline`、`docx_get_block`、`docx_search`、`docx_get_history`
- 用途：打开 docx、定位结构、查找内容、查看历史。

### `docx-write`

- 对应工具：`docx_apply_ops`、`docx_rollback`
- 用途：修改 docx 内容，或基于历史快照回滚。

### `docx-delivery`

- 对应工具：`docx_validate`、`docx_render_preview`、`docx_save`
- 用途：做文档校验、生成预览、按需落盘。

### `kb-document-discovery`

- 对应工具：`kb_list_documents`
- 用途：先确定应该查哪份知识文档。

### `kb-evidence-query`

- 对应工具：`kb_hybrid_search_chunks`、`kb_vector_search_chunks`、`kb_fts_search_chunks`
- 用途：直接查询 chunk 证据并收敛事实依据。

## 5. 旧名称迁移

- `workspace-shell` 改为 `workspace-cli`
- `docx-editing` 拆为：
  - `docx-read`
  - `docx-write`
  - `docx-delivery`
- `local-kb-retrieval` 拆为：
  - `kb-document-discovery`
  - `kb-evidence-query`

## 6. 与状态设计的关系

- `skillCatalog` 存的是以上 skill 的摘要信息。
- `learnedSkillIds` 存的是当前已经学习过的 skill id。
- `learning` 只负责把 skill 标记为已学习，不负责额外引入旧 `activate_capability` 语义。
