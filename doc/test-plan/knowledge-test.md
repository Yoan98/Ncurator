# NCurator-Desktop 知识库测试计划

## 1. 总体目标

- 本计划定义知识库专项回归，对标 `ai-test`：召回、检索、索引质量与后续专项优化。
- 通用测试、runner 与断言规则遵循 `doc/test.md`。
- 正式 case 放在 `tests/case/knowledge/**`，全部是 backend。

当前没有登记 case。专项 suite 与 case 在后续做召回、检索或索引优化时再设计。

边界：

- 不替代 Settings「更新索引」产品 E2E。
- 不替代 `ai-test` 中的 kb tool / live。
- 不登记 unit。函数级契约仍在 `tests/case/unit/**`（含 `tests/case/unit/knowledge/**`）。

## 2. Suite 设计

暂不定义。

## 3. 回归清单

无。
