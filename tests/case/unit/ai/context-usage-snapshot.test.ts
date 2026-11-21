import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteCore } from '../../../../src/main/services/storage/sqlite/SqliteCore'
import { PartnerStore } from '../../../../src/main/services/storage/domains/PartnerStore'
import { ChatMessageLogStore } from '../../../../src/main/services/storage/domains/ChatMessageLogStore'
import { WorkbenchUiStore } from '../../../../src/main/services/storage/domains/WorkbenchUiStore'
import {
  getAiContextUsage,
  selectContextUsageSample
} from '../../../../src/main/services/ai/contextUsage'
import { projectMessageLogRecords } from '../../../../src/main/services/ai/human/memory/transcript'
import { estimateMessagesForContext } from '../../../../src/main/services/ai/human/memory/multimodal'
import { resolveEffectiveContextWindowTokens } from '../../../../src/main/services/ai/human/constants'
import type {
  BrainContextBudgetSnapshot,
  ChatMessageLogEntry,
  ChatMessageLogRecord
} from '../../../../src/shared/types'

const PARTNER_ID = 'partner-usage'

describe('ai unit context usage basis', () => {
  let root: string
  let sqlite: SqliteCore
  let logs: ChatMessageLogStore
  let ui: WorkbenchUiStore

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'context-usage-'))
    sqlite = new SqliteCore(path.join(root, 'app.sqlite'))
    sqlite.initialize()
    await new PartnerStore(sqlite).savePartner({
      id: PARTNER_ID,
      name: 'partner',
      avatar_shape: 'circle',
      avatar_color: 'blue',
      pinned: false,
      created_at: 0
    } as never)
    logs = new ChatMessageLogStore(sqlite)
    ui = new WorkbenchUiStore(sqlite)
    await logs.appendBatch({
      partnerId: PARTNER_ID,
      runId: 'run-1',
      entries: [
        {
          kind: 'user',
          content: '请帮我检查这段中文说明，逐条对照参考实现。',
          input: '请帮我检查这段中文说明，逐条对照参考实现。',
          context: { selectedReferences: [], attachments: [] }
        },
        { kind: 'assistant', content: '我先读一下文件。', toolCalls: [] },
        {
          kind: 'tool',
          toolCallId: 'call-1',
          toolName: 'read_file',
          ok: true,
          content: 'export const value = 1'
        }
      ] satisfies ChatMessageLogEntry[]
    })
  })

  afterEach(async () => {
    sqlite.close()
    await fs.rm(root, { recursive: true, force: true })
  })

  const readRecords = async (): Promise<ChatMessageLogRecord[]> => logs.list(PARTNER_ID)

  const estimatedTokens = async (includeUserEntries: boolean): Promise<number> =>
    estimateMessagesForContext(
      projectMessageLogRecords(await readRecords(), { includeUserEntries }).messages
    )

  it('falls back to the message estimate and counts user entries', async () => {
    const usage = await getAiContextUsage({
      partnerId: PARTNER_ID,
      chatMessageLogStore: logs,
      workbenchUiStore: ui
    })
    expect(usage.basis).toBe('estimate')
    expect(usage.contextWindowTokens).toBe(resolveEffectiveContextWindowTokens())
    expect(usage.usedContextTokens).toBe(await estimatedTokens(true))
    expect(usage.usedContextTokens).toBeGreaterThan(await estimatedTokens(false))
    expect(usage.ratio).toBeCloseTo(usage.usedContextTokens / usage.contextWindowTokens, 10)
  })

  it('reports a measured sample for the same model and context window', async () => {
    const snapshot: BrainContextBudgetSnapshot = {
      evaluationId: 'eval',
      basis: 'usage_plus_delta',
      budgetTokens: 251_000,
      contextWindowTokens: resolveEffectiveContextWindowTokens(),
      hasCompressibleHistory: true,
      usageAvailable: true,
      lastBrainInputTokens: 240_000,
      deltaTokenEstimate: 11_000
    }
    const usage = await getAiContextUsage({
      partnerId: PARTNER_ID,
      chatMessageLogStore: logs,
      workbenchUiStore: ui,
      sample: { model: null, snapshot }
    })
    expect(usage.basis).toBe('usage_plus_delta')
    expect(usage.usedContextTokens).toBe(snapshot.budgetTokens)
    expect(usage.contextWindowTokens).toBe(resolveEffectiveContextWindowTokens())
    expect(usage.ratio).toBeCloseTo(
      snapshot.budgetTokens / resolveEffectiveContextWindowTokens(),
      10
    )
  })

  it('keeps the post-compaction basis when the budget was re-evaluated after folding', async () => {
    const usage = await getAiContextUsage({
      partnerId: PARTNER_ID,
      chatMessageLogStore: logs,
      workbenchUiStore: ui,
      sample: {
        model: null,
        snapshot: {
          evaluationId: 'eval-after',
          basis: 'post_compaction',
          budgetTokens: 21_000,
          contextWindowTokens: resolveEffectiveContextWindowTokens(),
          hasCompressibleHistory: false,
          usageAvailable: true
        }
      }
    })
    expect(usage.basis).toBe('post_compaction')
    expect(usage.usedContextTokens).toBe(21_000)
  })

  it('holds a reliable same-scope sample over estimates, but accepts real decreases', () => {
    const model = { configId: 'provider-a', modelName: 'model-a' }
    const makeSample = (
      basis: BrainContextBudgetSnapshot['basis'],
      budgetTokens: number,
      contextWindowTokens = 100_000
    ) => ({
      model,
      snapshot: {
        evaluationId: basis,
        basis,
        budgetTokens,
        contextWindowTokens,
        hasCompressibleHistory: true,
        usageAvailable: true
      }
    })
    const measured = makeSample('usage_plus_delta', 24_000)
    const initial = makeSample('initial', 17_000)
    const unavailable = makeSample('usage_unavailable', 18_000)
    expect(selectContextUsageSample(measured, initial)).toBe(measured)
    expect(selectContextUsageSample(measured, unavailable)).toBe(measured)

    const compacted = makeSample('post_compaction', 6_000)
    expect(selectContextUsageSample(measured, compacted)).toBe(compacted)
    expect(selectContextUsageSample(compacted, unavailable)).toBe(compacted)
    const nextMeasured = makeSample('usage_plus_delta', 22_000)
    expect(selectContextUsageSample(measured, nextMeasured)).toBe(nextMeasured)

    const differentProvider = { ...initial, model: { ...model, configId: 'provider-b' } }
    expect(selectContextUsageSample(measured, differentProvider)).toBe(differentProvider)
    const changedWindow = makeSample('initial', 17_000, 120_000)
    expect(selectContextUsageSample(measured, changedWindow)).toBe(changedWindow)
  })

  it('does not expose a stale sample for a different selected model or window', async () => {
    const base = {
      evaluationId: 'old',
      basis: 'usage_plus_delta' as const,
      budgetTokens: 24_000,
      contextWindowTokens: resolveEffectiveContextWindowTokens(),
      hasCompressibleHistory: true,
      usageAvailable: true
    }
    const read = (sample: Parameters<typeof getAiContextUsage>[0]['sample']) =>
      getAiContextUsage({
        partnerId: PARTNER_ID,
        chatMessageLogStore: logs,
        workbenchUiStore: ui,
        sample
      })
    expect(
      (await read({ model: { configId: 'old', modelName: 'old' }, snapshot: base })).basis
    ).toBe('estimate')
    expect(
      (await read({ model: null, snapshot: { ...base, contextWindowTokens: 100_000 } })).basis
    ).toBe('estimate')
  })
})
