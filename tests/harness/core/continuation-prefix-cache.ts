import type { AiLlmIoRecord } from '../../../src/shared/types'
import { diffChatToolsRequestWire } from '../../../src/main/services/ai/utils/llmRequestWire'

/**
 * 跨 run 续接时，下一 run 首次 brain 的 cachedInputTokens
 * 相对上一 run 末次 brain inputTokens 的最低比例。
 * 连续 brain 与跨 run live 共用；调低/调高只改这一处，避免各 case 阈值漂移。
 */
export const CROSS_RUN_PREFIX_CACHE_MIN_RATIO = 0.85

const lastBrainRecord = (records: readonly AiLlmIoRecord[]): AiLlmIoRecord | undefined =>
  [...records].reverse().find((record) => record.caller === 'human.brain')

const lastBrainRecordWithUsage = (records: readonly AiLlmIoRecord[]): AiLlmIoRecord | undefined =>
  [...records]
    .reverse()
    .find(
      (record) =>
        record.caller === 'human.brain' &&
        typeof record.usage?.inputTokens === 'number' &&
        record.usage.inputTokens > 0
    )

const firstBrainRecord = (records: readonly AiLlmIoRecord[]): AiLlmIoRecord | undefined =>
  records.find((record) => record.caller === 'human.brain')

export type ContinuationPrefixCacheReuse = {
  previousLastBrain: AiLlmIoRecord | undefined
  nextFirstBrain: AiLlmIoRecord | undefined
  previousLastInputTokens: number | undefined
  nextFirstCachedInputTokens: number | undefined
  nextFirstInputTokens: number | undefined
  nextFirstCacheHitRate: number | null | undefined
  reuseRatio: number | undefined
  requestWireDiff: ReturnType<typeof diffChatToolsRequestWire>
  prefixPreserved: boolean
  minRatio: number
  satisfied: boolean
}

/**
 * 衡量跨 run 前缀缓存：next 首次 brain 的 cachedInputTokens / previous 末次 brain inputTokens。
 * previous 优先取带有效 usage 的末次 brain（中断 resume 场景下失败调用可能无 usage）。
 */
export const collectContinuationPrefixCacheReuse = (input: {
  previousRunId: string
  nextRunId: string
  previousLlmIo: readonly AiLlmIoRecord[]
  nextLlmIo: readonly AiLlmIoRecord[]
  minRatio?: number
}): ContinuationPrefixCacheReuse => {
  const minRatio = input.minRatio ?? CROSS_RUN_PREFIX_CACHE_MIN_RATIO
  if (input.previousRunId === input.nextRunId) {
    throw new Error('Cross-run cache comparison requires two distinct run IDs.')
  }
  const previousRecords = input.previousLlmIo.filter(
    (record) => record.runId === input.previousRunId
  )
  const nextRecords = input.nextLlmIo.filter((record) => record.runId === input.nextRunId)
  const previousLastBrain =
    lastBrainRecordWithUsage(previousRecords) || lastBrainRecord(previousRecords)
  const nextFirstBrain = firstBrainRecord(nextRecords)
  return collectBrainPrefixCacheReuse({ previousLastBrain, nextFirstBrain, minRatio })
}

/** Same projection invariant for adjacent brain calls within a run or across runs. */
export const collectBrainPrefixCacheReuse = (input: {
  previousLastBrain: AiLlmIoRecord | undefined
  nextFirstBrain: AiLlmIoRecord | undefined
  minRatio?: number
}): ContinuationPrefixCacheReuse => {
  const { previousLastBrain, nextFirstBrain } = input
  const minRatio = input.minRatio ?? CROSS_RUN_PREFIX_CACHE_MIN_RATIO
  const previousWire = previousLastBrain?.requestWire
  const nextWire = nextFirstBrain?.requestWire
  const prefixPreserved = Boolean(
    previousWire &&
    nextWire &&
    JSON.stringify(previousWire.tools) === JSON.stringify(nextWire.tools) &&
    previousWire.messages.length <= nextWire.messages.length &&
    JSON.stringify(previousWire.messages) ===
      JSON.stringify(nextWire.messages.slice(0, previousWire.messages.length))
  )
  const previousLastInputTokens = previousLastBrain?.usage?.inputTokens
  const nextFirstCachedInputTokens = nextFirstBrain?.usage?.cachedInputTokens
  const nextFirstInputTokens = nextFirstBrain?.usage?.inputTokens
  const hasUsageSignal =
    typeof previousLastInputTokens === 'number' &&
    previousLastInputTokens > 0 &&
    typeof nextFirstCachedInputTokens === 'number' &&
    typeof nextFirstInputTokens === 'number' &&
    nextFirstInputTokens > 0
  const reuseRatio =
    hasUsageSignal && previousLastInputTokens
      ? nextFirstCachedInputTokens! / previousLastInputTokens
      : undefined
  return {
    previousLastBrain,
    nextFirstBrain,
    previousLastInputTokens,
    nextFirstCachedInputTokens,
    nextFirstInputTokens,
    nextFirstCacheHitRate: nextFirstBrain?.usage?.cacheHitRate,
    reuseRatio,
    requestWireDiff: diffChatToolsRequestWire(
      previousLastBrain?.requestWire,
      nextFirstBrain?.requestWire
    ),
    prefixPreserved,
    minRatio,
    satisfied:
      prefixPreserved && hasUsageSignal && typeof reuseRatio === 'number' && reuseRatio >= minRatio
  }
}

export const continuationPrefixCacheAssertionData = (
  reuse: ContinuationPrefixCacheReuse
): Record<string, unknown> => ({
  minRatio: reuse.minRatio,
  previousRunId: reuse.previousLastBrain?.runId,
  nextRunId: reuse.nextFirstBrain?.runId,
  previousCallId: reuse.previousLastBrain?.callId,
  nextCallId: reuse.nextFirstBrain?.callId,
  prefixPreserved: reuse.prefixPreserved,
  previousLastInputTokens: reuse.previousLastInputTokens,
  nextFirstCachedInputTokens: reuse.nextFirstCachedInputTokens,
  nextFirstInputTokens: reuse.nextFirstInputTokens,
  nextFirstCacheHitRate: reuse.nextFirstCacheHitRate,
  reuseRatio: reuse.reuseRatio,
  previousLastBrainUsage: reuse.previousLastBrain?.usage,
  nextFirstBrainUsage: reuse.nextFirstBrain?.usage,
  requestWireDiff: reuse.requestWireDiff,
  previousToolsHash: reuse.previousLastBrain?.requestWire?.toolsHash,
  nextToolsHash: reuse.nextFirstBrain?.requestWire?.toolsHash,
  previousMessagesHash: reuse.previousLastBrain?.requestWire?.messagesHash,
  nextMessagesHash: reuse.nextFirstBrain?.requestWire?.messagesHash
})
