import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SqliteCore } from '../../../../src/main/services/storage/sqlite/SqliteCore'
import { PartnerStore } from '../../../../src/main/services/storage/domains/PartnerStore'
import { ChatMessageLogStore } from '../../../../src/main/services/storage/domains/ChatMessageLogStore'
import type { ChatMessageLogEntry } from '../../../../src/shared/types'

const PARTNER_ID = 'partner-log-queries'
const OTHER_PARTNER_ID = 'partner-log-queries-other'

const userEntry = (text: string): ChatMessageLogEntry => ({
  kind: 'user',
  content: text,
  input: text,
  context: { selectedReferences: [], attachments: [] }
})

const startOfLocalDay = (timestamp: number): number => {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

describe('chat message log queries', () => {
  let root: string
  let sqlite: SqliteCore
  let logs: ChatMessageLogStore

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-log-queries-'))
    sqlite = new SqliteCore(path.join(root, 'app.sqlite'))
    sqlite.initialize()
    const partners = new PartnerStore(sqlite)
    for (const id of [PARTNER_ID, OTHER_PARTNER_ID]) {
      await partners.savePartner({
        id,
        name: id,
        avatar_shape: 'circle',
        avatar_color: 'blue',
        pinned: false,
        created_at: Date.now(),
        updated_at: Date.now()
      } as never)
    }
    logs = new ChatMessageLogStore(sqlite)
  })

  afterEach(async () => {
    sqlite.close()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('lists day starts from the log without loading message contents', async () => {
    const today = startOfLocalDay(Date.now()) + 10 * 60 * 60 * 1000
    const yesterday = today - 24 * 60 * 60 * 1000
    await logs.appendBatch({
      partnerId: PARTNER_ID,
      runId: 'run-1',
      entries: [userEntry('a')],
      createdAt: yesterday
    })
    await logs.appendBatch({
      partnerId: PARTNER_ID,
      runId: 'run-2',
      entries: [userEntry('b')],
      createdAt: today
    })
    await logs.appendBatch({
      partnerId: PARTNER_ID,
      runId: 'run-3',
      entries: [userEntry('c')],
      createdAt: today + 60_000
    })

    expect(await logs.listDayStarts(PARTNER_ID)).toEqual([
      startOfLocalDay(yesterday),
      startOfLocalDay(today)
    ])
    expect(await logs.listDayStarts(OTHER_PARTNER_ID)).toEqual([])
  })

  it('returns records for the requested runs only', async () => {
    await logs.appendBatch({
      partnerId: PARTNER_ID,
      runId: 'run-old',
      entries: [userEntry('old')],
      createdAt: 1
    })
    await logs.appendBatch({
      partnerId: PARTNER_ID,
      runId: 'run-new',
      entries: [userEntry('new-1'), userEntry('new-2')],
      createdAt: 2
    })
    await logs.appendBatch({
      partnerId: OTHER_PARTNER_ID,
      runId: 'run-other',
      entries: [userEntry('other')],
      createdAt: 3
    })

    const records = await logs.listByPartnerRunIds(PARTNER_ID, ['run-new'])
    expect(records).toHaveLength(2)
    expect(records.every((record) => record.runId === 'run-new')).toBe(true)
    expect(await logs.listByPartnerRunIds(PARTNER_ID, [])).toEqual([])
  })
})
