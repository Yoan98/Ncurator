# Tool Design

> 工具契约与结果投递设计约束。涉及 `src/main/services/ai/human/tools/**` 的 schema、modelResult、投递逻辑时必读。  
> 活例子见 `doc/ai-tool-prompt-audit.md`（自动生成）；测试约束见 `doc/test-plan/ai-test.md`。

---

## 1. 设计原则

<!-- TODO：从 architecture.md 迁出九条原则 -->

---

## 2. 描述分层

<!-- TODO：skill.description / tool promptSpec / inputSchema.describe / outputTypes 分工表 -->

---

## 3. HumanToolSpec 结构

<!-- TODO：inputSchema / outputTypes / promptSpec / modelResult 四层职责 -->
<!-- registry compile-time 完整性（29 工具均需 renderSuccess） -->

---

## 4. 参数规范化

<!-- TODO：normalizeToolCallArgs — brain schema 校验前统一展开 JSON 字符串 -->
<!-- learn_skill / update_plan 由节点自有校验，brain 侧跳过 schema -->

---

## 5. 统一结果投递

<!-- TODO：三档阈值（51200 UTF-8 bytes / 2000 lines / 32000 chars） -->
<!-- 搜索类默认 10 条；text_file_read 分页属于生产者有界读取 -->

---

## 6. 渲染格式族

<!-- TODO：A–E 表格 + 每族一句；领域工具复用规则 -->

---

## 7. 与测试 / 生成文档的关系

| 文档 | 职责 |
|------|------|
| 本文 | 设计原则与管道约束 |
| `doc/ai-tool-prompt-audit.md` | 各工具 input/output/渲染活例子 |
| `doc/test-plan/ai-test.md` | tool / human 回归范围与 Oracle |
| `tests/case/unit/ai/*-tool-contract.test.ts` | family 轻量契约 |
