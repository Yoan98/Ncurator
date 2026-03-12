# Local Database Change Checklist

- 是否新增或删除表
- 是否修改索引、where 构造或 SQL 转义规则
- 是否新增或重构 `*Store`
- 是否影响 `StorageService` 组合根
- 是否需要同步 `doc/architecture/database.md`
- 是否需要同步 `doc/reference/source-of-truth.md`
- 是否需要同步 `AGENTS.md` 或 `Doc-Governance`
