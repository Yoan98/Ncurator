import type { ChatMessageLogRecord } from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import type { HumanRuntimeCache } from '../types'

/** 每个 user 行之后、下一条 user 之前，最后一次发给模型的 build user 原文。 */
export const resolveHistoricalBrainUserTextsByUserSeq = (
  records: ChatMessageLogRecord[]
): Map<number, string> => {
  const ordered = [...records].sort((a, b) => a.seq - b.seq)
  const byUserSeq = new Map<number, string>()
  let currentUserSeq: number | null = null
  for (const record of ordered) {
    const entry = record.entry
    if (entry.kind === 'user') {
      currentUserSeq = record.seq
      continue
    }
    if (
      entry.kind === 'annotation' &&
      entry.eventType === 'brain_user_snapshot' &&
      currentUserSeq !== null
    ) {
      const text = entry.payload.text
      if (!text.trim()) {
        throw new Error(`brain_user_snapshot(seq=${record.seq}) 的 text 不能为空。`)
      }
      byUserSeq.set(currentUserSeq, text)
    }
  }
  return byUserSeq
}

export const persistCurrentBrainUserSnapshot = async (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  text: string
}): Promise<void> => {
  const text = input.text
  if (!text.trim()) {
    throw new Error('当前 build user 文本为空，无法写入 brain_user_snapshot。')
  }
  if (input.cache.lastPersistedBrainUserText === text) return
  await input.ctx.appendMessageLog([
    {
      kind: 'annotation',
      eventType: 'brain_user_snapshot',
      payload: { text }
    }
  ])
  input.cache.lastPersistedBrainUserText = text
}
