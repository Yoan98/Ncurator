import type { BaseMessage } from '@langchain/core/messages'

// 压缩后只保留最后一条 AI（assistant）消息，其余（含大工具结果）全部纳入压缩摘要。
// 这样压缩重建后的上下文只含 system + brainUser(compacted) + 最后一条 AI 消息，
// 能真正把上下文压回触发线以下，避免"压缩后仍超阈值、每轮都压缩"的抖动。
const isAssistantMessage = (message: BaseMessage): boolean => message.getType() === 'ai'

export const splitMessagesByLastAi = (
  messages: BaseMessage[]
): { compressible: BaseMessage[]; tail: BaseMessage[] } => {
  let lastAiIndex = -1
  for (let index = 0; index < messages.length; index += 1) {
    if (isAssistantMessage(messages[index])) {
      lastAiIndex = index
    }
  }
  if (lastAiIndex < 0) {
    return { compressible: messages, tail: [] }
  }
  return {
    compressible: messages.slice(0, lastAiIndex),
    tail: messages.slice(lastAiIndex)
  }
}
