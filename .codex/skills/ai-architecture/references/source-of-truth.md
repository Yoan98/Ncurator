# AI Architecture Truth Sources

- 默认文档入口：
  - `doc/architecture/ai/README.md`
- 当前运行真相：
  - `doc/architecture/ai/runtime.md`
- 事件与共享契约：
  - `doc/architecture/ai/event-contracts.md`

文档不足或与实现冲突时，按以下顺序核对代码：

1. `src/main/services/ai/graph/*`
2. `src/main/services/ai/node/*`
3. `src/main/services/ai/state/stateSchemas.ts`
4. `src/main/services/ai/tools/*`
5. `src/shared/types.ts`

`openspec/` 仅用于查看变更设计与历史，不作为默认入口。
