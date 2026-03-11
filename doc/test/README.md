# 测试文档索引

本目录用于统一承载测试相关文档，避免测试规范、阶段结论和扩展说明散落在 `doc/` 根目录。

推荐阅读顺序：

1. 先读 [architecture.md](/Users/test/work-space/NCurator-Desktop/doc/test/architecture.md)
2. 再按当前阶段读对应专题文档

## 1. 分类设计

当前采用“入口索引 + 按主题拆分”的结构：

- [README.md](/Users/test/work-space/NCurator-Desktop/doc/test/README.md)
  - 测试文档总入口
  - 说明当前有哪些测试文档、分别解决什么问题
- [architecture.md](/Users/test/work-space/NCurator-Desktop/doc/test/architecture.md)
  - 测试架构总规范
  - 覆盖分层、目录约定、harness、报告契约、命令、阶段化测试顺序
- [tool-capability.md](/Users/test/work-space/NCurator-Desktop/doc/test/tool-capability.md)
  - 当前 `tool capability` 阶段的能力结论
  - 覆盖面、边界、显式缺口、是否建议进入下一阶段

后续建议继续按主题扩展，而不是把所有内容堆回一篇总文档：

- `human-*.md`
  - human 单任务验证
- `main-*.md`
  - main graph 的 context / plan / runtime 相关验证
- `renderer-*.md`
  - renderer contract 与确认交互测试
- `e2e-*.md`
  - 端到端链路验证

## 2. AI 阅读规则

为了降低 AI 理解成本，建议按下面的入口读取：

### 2.1 当任务涉及测试架构

先读：

- [architecture.md](/Users/test/work-space/NCurator-Desktop/doc/test/architecture.md)

适用任务：

- 新增测试套件
- 调整目录分层
- 修改 harness
- 修改报告契约
- 增加测试命令

### 2.2 当任务涉及当前 tool 阶段结论

再读：

- [tool-capability.md](/Users/test/work-space/NCurator-Desktop/doc/test/tool-capability.md)

适用任务：

- 判断 tool 是否已经可交给 AI 调用
- 判断当前 docx / terminal / retrieval 是否需要继续优化
- 决定是否进入 human / main / plan / e2e 阶段

## 3. 当前建议

涉及测试任务时，默认入口改为：

- `doc/test/README.md`
