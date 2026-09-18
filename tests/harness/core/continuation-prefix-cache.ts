import type { AiLlmIoRecord } from '../../../src/shared/types'
import { diffChatToolsRequestWire } from '../../../src/main/services/ai/utils/llmRequestWire'

/**
 * 跨 run 续接时，下一 run 首次 brain 的 cachedInputTokens
 * 相对上一 run 末次 brain inputTokens 的最低比例。
 * 全 live 跨 run case 共用；调低/调高只改这一处，避免各 case 阈值漂移。
 */
export const CROSS_RUN_PREFIX_CACHE_MIN_RATIO = 0.85

const lastBrainRecord = (records: readonly AiLlmIoRecord[]): AiLlmIoRecord | undefined =>
  [...records].reverse().find((record) => record.caller === 'human.brain')

const lastBrainRecordWithUsage = (
  records: readonly AiLlmIoRecord[]
): AiLlmIoRecord | undefined =>
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
  minRatio: number
  satisfied: boolean
}

/**
 * 衡量跨 run 前缀缓存：next 首次 brain 的 cachedInputTokens / previous 末次 brain inputTokens。
 * previous 优先取带有效 usage 的末次 brain（中断 resume 场景下失败调用可能无 usage）。
 */
export const collectContinuationPrefixCacheReuse = (input: {
  previousLlmIo: readonly AiLlmIoRecord[]
  nextLlmIo: readonly AiLlmIoRecord[]
  minRatio?: number
}): ContinuationPrefixCacheReuse => {
  const minRatio = input.minRatio ?? CROSS_RUN_PREFIX_CACHE_MIN_RATIO
  const previousLastBrain =
    lastBrainRecordWithUsage(input.previousLlmIo) || lastBrainRecord(input.previousLlmIo)
  const nextFirstBrain = firstBrainRecord(input.nextLlmIo)
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
    minRatio,
    satisfied:
      hasUsageSignal && typeof reuseRatio === 'number' && reuseRatio >= minRatio
  }
}

export const continuationPrefixCacheAssertionData = (
  reuse: ContinuationPrefixCacheReuse
): Record<string, unknown> => ({
  minRatio: reuse.minRatio,
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
