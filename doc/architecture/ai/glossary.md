# NCurator-Desktop AI 术语表

- `Main Graph`
  - 系统编排层，负责上下文、计划、调度与最终收敛。
- `Human Subgraph`
  - 单任务执行层，负责 skill 加载与 tool 调用循环。
- `Skill Card`
  - 暴露给 human 的轻量能力卡片，不等于完整 skill 内容。
- `Capability`
  - 一组同类工具实现的目录与能力边界。
- `Tool`
  - 供 human 原子调用的具体执行单元。
- `Draft Review`
  - AI 编辑后生成的待审阅结果集合，不直接等于真实文件写回。
- `Pure Search`
  - 不进入 AI graph 的本地检索模式。
- `Canonical Doc`
  - 当前默认真相源文档；不是历史记录，也不是临时设计稿。
- `Code Truth Source`
  - 文档缺失或漂移时应核对的最终代码入口。
