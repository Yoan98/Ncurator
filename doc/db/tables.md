# 数据表目录

当前最终 schema。职责与 migration 规则见 [`design.md`](design.md)。

## SQLite

### `schema_migrations`

记录已执行的 schema 版本。

| 字段         | 类型       | 说明             |
| ------------ | ---------- | ---------------- |
| `version`    | INTEGER PK | migration 版本号 |
| `name`       | TEXT       | migration 名称   |
| `applied_at` | INTEGER    | 应用时间         |

### `schema_migration_hooks`

版本声明提交后的副作用状态（如 v10 清理 LanceDB）。

| 字段           | 类型       | 说明                |
| -------------- | ---------- | ------------------- |
| `version`      | INTEGER PK | 对应 migration 版本 |
| `name`         | TEXT       | migration 名称      |
| `status`       | TEXT       | `pending` / `done`  |
| `completed_at` | INTEGER    | 完成时间，可空      |

### `app_settings`

全局偏好单例（`id = singleton`）。

| 字段                           | 类型    | 说明                                  |
| ------------------------------ | ------- | ------------------------------------- |
| `id`                           | TEXT PK | 固定 `singleton`                      |
| `system_notifications_enabled` | INTEGER | AI 终态系统通知，默认 `1`             |
| `knowledge_index_speed`        | TEXT    | 索引速度 `slow` / `fast`，默认 `slow` |

### `partner`

Workbench 伙伴。

| 字段             | 类型    | 说明           |
| ---------------- | ------- | -------------- |
| `id`             | TEXT PK | 伙伴 id        |
| `name`           | TEXT    | 显示名         |
| `avatar_shape`   | TEXT    | 头像外形       |
| `avatar_color`   | TEXT    | 头像颜色       |
| `pinned`         | INTEGER | 是否置顶       |
| `pinned_at`      | INTEGER | 置顶时间，可空 |
| `created_at`     | INTEGER | 创建时间       |
| `updated_at`     | INTEGER | 更新时间       |
| `last_viewed_at` | INTEGER | 最近查看时间   |

### `partner_ui_state`

伙伴 UI 快照。

| 字段         | 类型    | 说明              |
| ------------ | ------- | ----------------- |
| `partner_id` | TEXT PK | 伙伴 id，级联删除 |
| `state_json` | TEXT    | 版本化 UI 状态；不含未发送的文档选区及关联想法 |
| `updated_at` | INTEGER | 更新时间          |

### `workbench_ui_state`

Workbench 单例 UI。

| 字段              | 类型       | 说明        |
| ----------------- | ---------- | ----------- |
| `id`              | INTEGER PK | 固定 `1`    |
| `active_view_key` | TEXT       | 当前伙伴 id |
| `updated_at`      | INTEGER    | 更新时间    |

### `browser_tab_state`

内置浏览器标签。

| 字段           | 类型    | 说明     |
| -------------- | ------- | -------- |
| `id`           | TEXT PK | 标签 id  |
| `owner_key`    | TEXT    | 伙伴 id  |
| `title`        | TEXT    | 标题     |
| `url`          | TEXT    | 当前 URL |
| `zoom_factor`  | REAL    | 缩放     |
| `history_json` | TEXT    | 导航历史 |
| `position`     | INTEGER | 排序     |
| `created_at`   | INTEGER | 创建时间 |
| `updated_at`   | INTEGER | 更新时间 |

### `chat_session_message_log`

伙伴消息转录。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | 条目 id |
| `partner_id` | TEXT | 伙伴 id，级联删除 |
| `run_id` | TEXT | 所属 run |
| `seq` | INTEGER | 伙伴内顺序 |
| `entry_json` | TEXT | 消息正文、引用与附件快照，工具消息及 annotation |
| `created_at` | INTEGER | 创建时间 |

### `ai_run`

一次 AI 运行。

| 字段                       | 类型    | 说明                                                         |
| -------------------------- | ------- | ------------------------------------------------------------ |
| `id`                       | TEXT PK | run id                                                       |
| `partner_id`               | TEXT    | 伙伴 id，级联删除                                            |
| `user_message_id`          | TEXT    | 用户消息 id                                                  |
| `assistant_message_id`     | TEXT    | 助手消息 id                                                  |
| `status`                   | TEXT    | 运行状态                                                     |
| `input`                    | TEXT    | 用户输入                                                     |
| `selected_references_json` | TEXT    | 选中资料                                                     |
| `attachments_json`         | TEXT    | 附件                                                         |
| `model_name`               | TEXT    | 模型名                                                       |
| `main_model_json`          | TEXT    | 主模型选择                                                   |
| `execution_permission`     | TEXT    | 执行权限，默认 `review`                                      |
| `partial_answer`           | TEXT    | 流式草稿                                                     |
| `partial_answer_role`      | TEXT    | 草稿角色                                                     |
| `final_answer`             | TEXT    | 最终回答                                                     |
| `error`                    | TEXT    | 短错误标题                                                   |
| `failure_code`             | TEXT    | 失败码                                                       |
| `failure_raw_message`      | TEXT    | 失败原文                                                     |
| `pending_approval_json`    | TEXT    | 当前可操作审批批次，含可选子来源 `source` |
| `pending_interaction_json` | TEXT    | 当前提问或审批；审批包含批次及可选子来源 |
| `pending_messages_json`    | TEXT    | 按 FIFO 暂存的追加用户消息快照，含结构化正文与引用、附件；续接或终态归档后清空 |
| `artifacts_json`           | TEXT    | 产物                                                         |
| `created_at`               | INTEGER | 创建时间                                                     |
| `updated_at`               | INTEGER | 更新时间                                                     |
| `finished_at`              | INTEGER | 结束时间                                                     |

### `ai_file_change`

工作地址内文件修改记录。

| 字段                    | 类型    | 说明              |
| ----------------------- | ------- | ----------------- |
| `id`                    | TEXT PK | 记录 id           |
| `partner_id`            | TEXT    | 伙伴 id，级联删除 |
| `run_id`                | TEXT    | 归属主 run，含子任务修改 |
| `status`                | TEXT    | 状态              |
| `capability`            | TEXT    | 能力类型          |
| `path`                  | TEXT    | 文件路径          |
| `file_name`             | TEXT    | 文件名            |
| `operation`             | TEXT    | 操作              |
| `source`                | TEXT    | 来源              |
| `before_path`           | TEXT    | 改前路径          |
| `after_path`            | TEXT    | 改后路径          |
| `change_count`          | INTEGER | 改动计数          |
| `insert_count`          | INTEGER | 插入计数          |
| `delete_count`          | INTEGER | 删除计数          |
| `before_snapshot_path`  | TEXT    | 改前快照          |
| `after_snapshot_path`   | TEXT    | 改后快照          |
| `before_object_hash`    | TEXT    | 改前对象哈希      |
| `after_object_hash`     | TEXT    | 改后对象哈希      |
| `preview_artifact_hash` | TEXT    | 预览产物哈希      |
| `before_checksum`       | TEXT    | 改前校验          |
| `after_checksum`        | TEXT    | 改后校验          |
| `preview_path`          | TEXT    | 预览路径          |
| `run_summary`           | TEXT    | 摘要              |
| `created_at`            | INTEGER | 创建时间          |
| `updated_at`            | INTEGER | 更新时间          |
| `reverted_at`           | INTEGER | 回退时间          |
| `last_error`            | TEXT    | 最近错误          |

### `docx_apply`

DOCX 应用记录表；当前应用/回退接口投影 `ai_file_change`，不再写入独立记录。

| 字段                         | 类型    | 说明              |
| ---------------------------- | ------- | ----------------- |
| `id`                         | TEXT PK | 记录 id           |
| `partner_id`                 | TEXT    | 伙伴 id，级联删除 |
| `run_id`                     | TEXT    | 所属 run          |
| `status`                     | TEXT    | 状态              |
| `source_path`                | TEXT    | 源路径            |
| `source_name`                | TEXT    | 源文件名          |
| `operation`                  | TEXT    | 操作              |
| `final_revision_ref`         | TEXT    | 最终修订引用      |
| `change_count`               | INTEGER | 改动计数          |
| `insert_count`               | INTEGER | 插入计数          |
| `delete_count`               | INTEGER | 删除计数          |
| `before_exists`              | INTEGER | 改前是否存在      |
| `before_snapshot_path`       | TEXT    | 改前快照          |
| `before_checksum`            | TEXT    | 改前校验          |
| `before_byte_size`           | INTEGER | 改前字节          |
| `before_modified_at`         | INTEGER | 改前修改时间      |
| `preview_diff_artifact_path` | TEXT    | 预览 diff 路径    |
| `preview_diff_checksum`      | TEXT    | 预览 diff 校验    |
| `preview_diff_byte_size`     | INTEGER | 预览 diff 大小    |
| `after_checksum`             | TEXT    | 改后校验          |
| `after_byte_size`            | INTEGER | 改后字节          |
| `after_modified_at`          | INTEGER | 改后修改时间      |
| `created_at`                 | INTEGER | 创建时间          |
| `updated_at`                 | INTEGER | 更新时间          |
| `reverted_at`                | INTEGER | 回退时间          |
| `last_error`                 | TEXT    | 最近错误          |

### `scheduled_task`

定时任务。

| 字段                       | 类型    | 说明                                  |
| -------------------------- | ------- | ------------------------------------- |
| `id`                       | TEXT PK | 任务 id                               |
| `name`                     | TEXT    | 名称                                  |
| `description`              | TEXT    | 任务描述                              |
| `enabled`                  | INTEGER | 是否启用                              |
| `schedule_type`            | TEXT    | 周期类型                              |
| `time_of_day`              | TEXT    | 每日时刻                              |
| `weekday`                  | INTEGER | 星期，可空                            |
| `content_nodes_json`       | TEXT    | 描述内容节点 JSON                     |
| `selected_references_json` | TEXT    | 描述引用 JSON                         |
| `partner_id`               | TEXT    | 真实伙伴 id；空值表示未绑定且任务停用 |
| `next_run_at`              | INTEGER | 下次执行时间                          |
| `busy_cancel_notice_at`    | INTEGER | 占用取消提示时间                      |
| `created_at`               | INTEGER | 创建时间                              |
| `updated_at`               | INTEGER | 更新时间                              |

### `workspace_source`

文件地址根路径。

| 字段         | 类型    | 说明           |
| ------------ | ------- | -------------- |
| `id`         | TEXT PK | 地址 id        |
| `root_path`  | TEXT    | 根路径，UNIQUE |
| `created_at` | INTEGER | 创建时间       |
| `updated_at` | INTEGER | 更新时间       |

### `workspace_file_index`

逐文件索引状态。

| 字段              | 类型    | 说明         |
| ----------------- | ------- | ------------ |
| `id`              | TEXT PK | 记录 id      |
| `workspace_id`    | TEXT    | 文件地址 id  |
| `relative_path`   | TEXT    | 相对路径     |
| `absolute_path`   | TEXT    | 绝对路径     |
| `name`            | TEXT    | 文件名       |
| `file_ext`        | TEXT    | 扩展名       |
| `size`            | INTEGER | 大小         |
| `mtime_ms`        | INTEGER | 修改时间     |
| `content_hash`    | TEXT    | 内容哈希     |
| `index_status`    | TEXT    | 索引状态     |
| `document_id`     | TEXT    | 文档 id      |
| `indexed_at`      | INTEGER | 索引时间     |
| `last_checked_at` | INTEGER | 最近检查时间 |
| `last_error`      | TEXT    | 最近错误     |
| `created_at`      | INTEGER | 创建时间     |
| `updated_at`      | INTEGER | 更新时间     |

### `workspace_index_job`

检查更新 / 更新索引任务。

| 字段              | 类型    | 说明                                             |
| ----------------- | ------- | ------------------------------------------------ |
| `id`              | TEXT PK | 任务 id                                          |
| `workspace_id`    | TEXT    | 文件地址 id；网页任务可为空串                    |
| `source_kind`     | TEXT    | `file` / `web`                                   |
| `action`          | TEXT    | `scan` / `prepare`                               |
| `status`          | TEXT    | `running` / `succeeded` / `failed` / `cancelled` |
| `phase`           | TEXT    | 当前阶段                                         |
| `step_index`      | INTEGER | 当前步骤                                         |
| `step_total`      | INTEGER | 总步骤                                           |
| `total_count`     | INTEGER | 目标总数                                         |
| `processed_count` | INTEGER | 已处理                                           |
| `failed_count`    | INTEGER | 失败数                                           |
| `target_ids_json` | TEXT    | 目标 id 列表                                     |
| `message`         | TEXT    | 进度文案                                         |
| `last_error`      | TEXT    | 最近错误                                         |
| `started_at`      | INTEGER | 开始时间                                         |
| `updated_at`      | INTEGER | 更新时间                                         |
| `finished_at`     | INTEGER | 结束时间                                         |

### `document`

索引文档元数据。

| 字段                    | 类型    | 说明                  |
| ----------------------- | ------- | --------------------- |
| `id`                    | TEXT PK | 文档 id               |
| `workspace_id`          | TEXT    | 文件地址 id；网页可空 |
| `name`                  | TEXT    | 文档名                |
| `source_type`           | TEXT    | `file` / `web`        |
| `file_path`             | TEXT    | 文件路径              |
| `import_status`         | INTEGER | 导入状态              |
| `content_hash`          | TEXT    | 内容哈希              |
| `active_generation_id`  | TEXT    | 当前有效 generation   |
| `created_at`            | INTEGER | 创建时间              |
| `updated_at`            | INTEGER | 更新时间              |
| `last_error`            | TEXT    | 最近错误              |
| `source_id`             | TEXT    | 来源 id               |
| `source_url`            | TEXT    | 来源 URL              |
| `source_title`          | TEXT    | 来源标题              |
| `normalized_source_url` | TEXT    | 规范化 URL            |
| `fetched_at`            | INTEGER | 抓取时间              |

### `web_source`

全局网页资料。

| 字段                     | 类型    | 说明               |
| ------------------------ | ------- | ------------------ |
| `id`                     | TEXT PK | 网页 id            |
| `identity_kind`          | TEXT    | 身份类型           |
| `normalized_url`         | TEXT    | 规范化 URL，UNIQUE |
| `url`                    | TEXT    | 原始 URL           |
| `title`                  | TEXT    | 标题               |
| `document_id`            | TEXT    | 文档 id            |
| `index_status`           | TEXT    | 索引状态           |
| `include_selectors_json` | TEXT    | 包含选择器         |
| `exclude_selectors_json` | TEXT    | 排除选择器         |
| `fetched_at`             | INTEGER | 抓取时间           |
| `last_checked_at`        | INTEGER | 最近检查           |
| `last_crawled_at`        | INTEGER | 最近爬取           |
| `last_indexed_at`        | INTEGER | 最近索引           |
| `etag`                   | TEXT    | HTTP ETag          |
| `last_modified`          | TEXT    | HTTP Last-Modified |
| `content_length`         | INTEGER | 内容长度           |
| `content_hash`           | TEXT    | 内容哈希           |
| `last_error`             | TEXT    | 最近错误           |
| `created_at`             | INTEGER | 创建时间           |
| `updated_at`             | INTEGER | 更新时间           |

### `llm_config`

大模型可用服务配置。

| 字段           | 类型    | 说明       |
| -------------- | ------- | ---------- |
| `id`           | TEXT PK | 配置 id    |
| `name`         | TEXT    | 名称       |
| `providerKind` | TEXT    | 服务商类型 |
| `base_url`     | TEXT    | 接口地址   |
| `api_key`      | TEXT    | API Key    |

## LanceDB

### `vector_chunk`

可重建的知识库向量块。检索时库内只留最新 generation。

| 字段            | 类型                        | 说明                    |
| --------------- | --------------------------- | ----------------------- |
| `id`            | Utf8                        | chunk id                |
| `document_id`   | Utf8                        | 文档 id                 |
| `workspace_id`  | Utf8                        | 文件地址 id；网页可空串 |
| `generation_id` | Utf8                        | 写入世代，只用于清理    |
| `chunk_index`   | Int32                       | 文档内顺序              |
| `document_name` | Utf8                        | 文档名                  |
| `source_type`   | Utf8                        | `file` / `web`          |
| `text`          | Utf8                        | 正文，FTS 索引列        |
| `vector`        | FixedSizeList(768, Float32) | 嵌入向量                |
| `metadata`      | Struct `{ page: Int32 }`    | 页码等元数据            |
| `created_at`    | Int64                       | 创建时间                |
