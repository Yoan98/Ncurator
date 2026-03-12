# Local Database Truth Sources

- 默认文档入口：
  - `doc/architecture/database.md`

代码真相源：

1. `src/main/services/storage/core/LanceDbCore.ts`
2. `src/main/services/storage/StorageService.ts`
3. `src/main/services/storage/domains/*.ts`

核对重点：

- `LANCE_TABLES`
- `getTableConfigs()`
- 各 `*Store` 暴露的领域方法

文档未覆盖当前实现时，以以上代码为准，并把文档同步纳入当前变更。
