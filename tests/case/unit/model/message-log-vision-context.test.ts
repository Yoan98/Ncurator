import { describe, expect, it } from 'vitest'
import type { FreeModelPublicEntry } from '../../../../src/shared/freeModels'
import {
  FREE_MODEL_NO_VISION_WITH_IMAGE_HISTORY_REASON,
  hasEffectiveImageContextInMessageLog,
  isFreeModelWithoutVision,
  resolveMessageLogHistoryFloorSeq,
  shouldBlockFreeModelWithoutVision
} from '../../../../src/shared/messageLogVisionContext'
import type { ChatMessageLogRecord } from '../../../../src/shared/types'

const imageRef = {
  path: '/tmp/a.webp',
  mimeType: 'image/webp',
  sizeBytes: 12,
  width: 10,
  height: 10
}

const toolWithImages = (seq: number): ChatMessageLogRecord => ({
  id: `tool-${seq}`,
  partnerId: 'p1',
  runId: 'r1',
  seq,
  createdAt: seq,
  entry: {
    kind: 'tool',
    toolCallId: `call-${seq}`,
    toolName: 'read_image',
    ok: true,
    content: 'ok',
    images: [imageRef]
  }
})

const toolPlain = (seq: number): ChatMessageLogRecord => ({
  id: `tool-${seq}`,
  partnerId: 'p1',
  runId: 'r1',
  seq,
  createdAt: seq,
  entry: {
    kind: 'tool',
    toolCallId: `call-${seq}`,
    toolName: 'read_file',
    ok: true,
    content: 'ok'
  }
})

const compaction = (seq: number, throughSeq: number): ChatMessageLogRecord => ({
  id: `compact-${seq}`,
  partnerId: 'p1',
  runId: 'r1',
  seq,
  createdAt: seq,
  entry: {
    kind: 'annotation',
    eventType: 'compaction_checkpoint',
    payload: {
      compactBlockId: `block-${seq}`,
      throughSeq,
      sourceMessageCount: throughSeq,
      summary: 'summary'
    }
  }
})

const freeTextOnly: FreeModelPublicEntry = {
  id: 'free-glm-4.7-flash',
  configId: 'free:free-glm-4.7-flash',
  providerKind: 'openai-compatible',
  modelName: 'glm-4.7-flash',
  label: 'GLM-4.7 Flash',
  description: 'free',
  capabilities: ['text'],
  iconUrl: ''
}

const freeWithVision: FreeModelPublicEntry = {
  ...freeTextOnly,
  id: 'free-vision',
  configId: 'free:free-vision',
  modelName: 'vision-model',
  label: 'Vision Free',
  capabilities: ['text', 'vision']
}

describe('messageLogVisionContext', () => {
  it('resolves history floor from latest compaction checkpoint', () => {
    expect(resolveMessageLogHistoryFloorSeq([toolWithImages(1), compaction(2, 1)])).toBe(1)
    expect(resolveMessageLogHistoryFloorSeq([toolWithImages(1)])).toBe(-1)
  })

  it('detects images only in post-compaction effective context', () => {
    expect(hasEffectiveImageContextInMessageLog([toolWithImages(1), toolPlain(2)])).toBe(true)
    expect(
      hasEffectiveImageContextInMessageLog([toolWithImages(1), compaction(2, 1), toolPlain(3)])
    ).toBe(false)
    expect(
      hasEffectiveImageContextInMessageLog([toolWithImages(1), compaction(2, 1), toolWithImages(3)])
    ).toBe(true)
  })

  it('blocks only free models without vision when effective images exist', () => {
    const records = [toolWithImages(1)]
    expect(
      shouldBlockFreeModelWithoutVision({
        mainModel: { configId: freeTextOnly.configId, modelName: freeTextOnly.modelName },
        freeModels: [freeTextOnly, freeWithVision],
        messageLogRecords: records
      })
    ).toBe(true)
    expect(
      shouldBlockFreeModelWithoutVision({
        mainModel: { configId: freeWithVision.configId, modelName: freeWithVision.modelName },
        freeModels: [freeTextOnly, freeWithVision],
        messageLogRecords: records
      })
    ).toBe(false)
    expect(
      shouldBlockFreeModelWithoutVision({
        mainModel: { configId: 'cfg-paid', modelName: 'gpt' },
        freeModels: [freeTextOnly],
        messageLogRecords: records
      })
    ).toBe(false)
    expect(
      shouldBlockFreeModelWithoutVision({
        mainModel: { configId: freeTextOnly.configId, modelName: freeTextOnly.modelName },
        freeModels: [freeTextOnly],
        messageLogRecords: [toolWithImages(1), compaction(2, 1), toolPlain(3)]
      })
    ).toBe(false)
    expect(
      shouldBlockFreeModelWithoutVision({
        mainModel: { configId: freeTextOnly.configId, modelName: freeTextOnly.modelName },
        freeModels: [],
        messageLogRecords: records
      })
    ).toBe(false)
  })

  it('accepts precomputed hasEffectiveImageContext for composer gating', () => {
    expect(
      isFreeModelWithoutVision({
        mainModel: { configId: freeTextOnly.configId, modelName: freeTextOnly.modelName },
        freeModels: [freeTextOnly]
      })
    ).toBe(true)
    expect(
      shouldBlockFreeModelWithoutVision({
        mainModel: { configId: freeTextOnly.configId, modelName: freeTextOnly.modelName },
        freeModels: [freeTextOnly],
        hasEffectiveImageContext: true
      })
    ).toBe(true)
    expect(
      shouldBlockFreeModelWithoutVision({
        mainModel: { configId: freeTextOnly.configId, modelName: freeTextOnly.modelName },
        freeModels: [freeTextOnly],
        hasEffectiveImageContext: false
      })
    ).toBe(false)
  })

  it('exports stable composer reason copy', () => {
    expect(FREE_MODEL_NO_VISION_WITH_IMAGE_HISTORY_REASON).toContain('不支持视觉理解')
  })
})
