# Conversation Memory

## 目标

Conversation memory 将会话上下文分为互斥且完整的两部分：

- `summary`：已由模型总结、并由覆盖边界确认的历史对话。
- `recent turns`：覆盖边界之后仍以原文提供给模型的消息。

任意时刻都必须满足：summary 与 recent turns 不重复，并且两者合起来不遗漏信息。

## 配置

配置位于 `src/main/services/ai/memory/index.ts`：

```ts
CONVERSATION_MEMORY_RECENT_TURNS = 5
CONVERSATION_MEMORY_SUMMARY_TRIGGER_TURNS = 10
```

`SUMMARY_TRIGGER_TURNS` 必须大于 `RECENT_TURNS`。

## 触发与收敛

系统只统计当前 summary 覆盖边界之后的完整对话轮次。一轮完整对话由 `user` 消息开始，并且在下一个 `user` 消息前至少包含一条 `assistant` 消息；未完成的当前轮不参与触发和总结。

- 未总结完整轮次少于 10：不生成 summary，所有消息保留在 recent turns。
- 未总结完整轮次达到或超过 10：总结除最新 5 轮之外的所有旧消息。
- summary 成功提交后：覆盖边界推进到被总结消息的末尾，recent turns 收敛到最新 5 轮。
- 后续只有未总结完整轮次再次积累到 10，才会触发下一次 summary。

例如 10 轮 `a-j` 会总结 `a-e`，保留 `f-j`。随后新增 `k-n` 时共有 9 个未总结轮次，不触发；新增 `o` 后达到 10 轮，总结 `f-j`，保留 `k-o`。

## 异步一致性

Summary 调用期间不提前修改覆盖边界。因此，被送去总结但尚未成功提交的消息仍存在于 recent turns，recent turns 此时允许临时超过配置数量。

Summary 返回后通过 revision、原覆盖消息和原更新时间执行条件写入：

1. 条件一致时，在事务中同时写入新 summary 和新覆盖边界。
2. 条件不一致时丢弃陈旧结果，重新读取最新状态。
3. Summary 调用期间新增的消息不属于旧快照，提交后仍留在 recent turns。
4. Summary 失败或返回空内容时不移动覆盖边界。

Runtime 通过 `getConversationMemoryContext` 一次性读取同一快照中的 summary 和 recent messages，禁止分别读取后再拼接，以免在 summary 提交瞬间产生重复或遗漏。

## 测试契约

后端契约测试必须覆盖：

- 9 轮不触发 summary。
- 第 10 轮触发，并只总结前 5 轮。
- 提交后 recent turns 为最新 5 轮。
- Summary 等待期间全部未覆盖消息仍在 recent turns。
- Summary 等待期间新增的轮次在提交后不会丢失。
- Summary 失败时覆盖边界保持不变。
- 陈旧 summary 结果不能覆盖较新的 conversation memory。
- 同一 session 同时只能运行一个 summary job。
