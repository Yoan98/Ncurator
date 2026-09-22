import type { FreeModelPublicEntry } from './freeModels'
import { isFreeModelConfigId } from './freeModels'
import type { ChatMessageLogRecord, WorkbenchSelectedModel } from './types'

/**
 * 与 Main `resolveHistoryFloor` 对齐：取伙伴 log 中最新
 * `compaction_checkpoint.throughSeq` 作为有效上下文下界。
 */
export const resolveMessageLogHistoryFloorSeq = (
  records: readonly Pick<ChatMessageLogRecord, 'seq' | 'entry'>[]
): number => {
  const ordered = [...records].sort((left, right) => left.seq - right.seq)
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const entry = ordered[index]!.entry
    if (entry.kind === 'annotation' && entry.eventType === 'compaction_checkpoint') {
      return entry.payload.throughSeq
    }
  }
  return -1
}

/** 压缩后仍会进入下次 brain 请求的上下文里是否含图片（tool.images）。 */
export const hasEffectiveImageContextInMessageLog = (
  records: readonly Pick<ChatMessageLogRecord, 'seq' | 'entry'>[]
): boolean => {
  const historyFloorSeq = resolveMessageLogHistoryFloorSeq(records)
  return records.some((record) => {
    if (record.seq <= historyFloorSeq) return false
    if (record.entry.kind !== 'tool') return false
    return Array.isArray(record.entry.images) && record.entry.images.length > 0
  })
}

/**
 * 免费且无 vision 的模型：有效上下文含图时 Composer 应拦截发送。
 * 目录尚未加载到该条目时不拦截，避免误伤。
 */
export const shouldBlockFreeModelWithoutVision = (input: {
  mainModel: WorkbenchSelectedModel | null | undefined
  freeModels: readonly FreeModelPublicEntry[]
  messageLogRecords?: readonly Pick<ChatMessageLogRecord, 'seq' | 'entry'>[]
  /** 已按压缩下界算过时直接传入，避免把整段 log 再送到 Renderer。 */
  hasEffectiveImageContext?: boolean
}): boolean => {
  const mainModel = input.mainModel
  if (!mainModel?.configId || !isFreeModelConfigId(mainModel.configId)) return false
  const entry = input.freeModels.find((item) => item.configId === mainModel.configId)
  if (!entry || entry.capabilities.includes('vision')) return false
  if (typeof input.hasEffectiveImageContext === 'boolean') return input.hasEffectiveImageContext
  return hasEffectiveImageContextInMessageLog(input.messageLogRecords || [])
}

export const FREE_MODEL_NO_VISION_WITH_IMAGE_HISTORY_REASON =
  '当前免费模型不支持视觉理解，请更换其他模型或清空历史消息'
