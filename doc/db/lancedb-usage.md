# LanceDB 使用规则

## 基本边界

- SQLite 是业务真相。
- LanceDB 只是可重建的向量索引。
- LanceDB 只保存 `vector_chunk`。
- 不再用 LanceDB 保存会话、消息、run、审批、文档元数据、网页源、工作区状态或配置。
- 旧 LanceDB 业务表不兼容，也不迁移。

## `vector_chunk` 表

字段：

- `id`
- `document_id`
- `workspace_id`
- `source_type`
- `generation_id`
- `chunk_index`
- `text`
- `document_name`
- `metadata`
- `created_at`
- `vector`

允许操作：

- 批量写入 chunks。
- 搜索 chunks。
- 按 `document_id / workspace_id / generation_id` 删除 chunks。
- 对向量表执行 `optimize()`。

禁止操作：

- 高频业务 update。
- 业务状态 `mergeInsert`。
- 用 LanceDB 做分页消息、run 状态、审批状态或配置查询。

## 写入批次

- 默认按 `128 chunks / batch` 写入。
- 单批文本总量默认不超过约 `4MB`。
- 不允许一条 chunk 一个 batch 这种写法，避免产生过多 fragment。

## Generation 规则

文档索引用 `generation_id` 保证一致性。

流程：

1. SQLite 把 document 标记为 `indexing`。
2. 生成新的 `generation_id`。
3. LanceDB 批量写入新 generation 的 chunks。
4. 写入成功后，SQLite transaction 切换 `document.active_generation_id`。
5. 后台删除旧 generation chunks。
6. 失败时不切换 active generation，旧索引继续可用。

搜索规则：

- 先从 SQLite 查当前 document 的 `active_generation_id`。
- 再到 LanceDB 搜索 `workspace_id + source_type + generation_id`。
- 搜索结果不能返回非 active generation 的 chunks。

## Fragment 和 Optimize

LanceDB 的 fragment 可以理解为一次或多次写入形成的数据片段，不等于“一行数据”。

如果每次只写很少数据，fragment 会变多。fragment 多了以后，查询和维护成本会上升。

维护规则：

- chunk 必须批量写入。
- 大量写入或删除后可以执行 `optimize()`。
- `optimize()` 只用于整理向量索引文件，不承担业务 migration。
- 不允许启动时自动删表重建。

## 排查慢查询

如果向量搜索慢，优先检查：

- 是否只查 active generation。
- 是否过滤了 `workspace_id` 和 `source_type`。
- 是否存在过多小 batch 写入造成的 fragment。
- 是否在大量删除后没有执行 `optimize()`。

不要用缓存掩盖错误的数据边界。先确认 SQLite 元数据和 LanceDB generation 过滤正确。
