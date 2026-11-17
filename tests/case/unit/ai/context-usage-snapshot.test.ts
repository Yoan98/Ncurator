import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteCore } from '../../../../src/main/services/storage/sqlite/SqliteCore'
import { PartnerStore } from '../../../../src/main/services/storage/domains/PartnerStore'
import { ChatMessageLogStore } from '../../../../src/main/services/storage/domains/ChatMessageLogStore'
import { WorkbenchUiStore } from '../../../../src/main/services/storage/domains/WorkbenchUiStore'
import { getAiContextUsage } from '../../../../src/main/services/ai/contextUsage'
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

  it('reports the budget snapshot the compaction decision used', async () => {
    const snapshot: BrainContextBudgetSnapshot = {
      evaluationId: 'eval',
      basis: 'usage_plus_delta',
      budgetTokens: 251_000,
      contextWindowTokens: 256_000,
      hasCompressibleHistory: true,
      usageAvailable: true,
      lastBrainInputTokens: 240_000,
      deltaTokenEstimate: 11_000
    }
    const usage = await getAiContextUsage({
      partnerId: PARTNER_ID,
      chatMessageLogStore: logs,
      workbenchUiStore: ui,
      contextBudget: snapshot
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
      contextBudget: {
        evaluationId: 'eval-after',
        basis: 'post_compaction',
        budgetTokens: 21_000,
        contextWindowTokens: 256_000,
        hasCompressibleHistory: false,
        usageAvailable: true
      }
    })
    expect(usage.basis).toBe('post_compaction')
    expect(usage.usedContextTokens).toBe(21_000)
  })
})
