import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createDocxFile } from '../../../../src/main/services/ai/human/tools/docx/utils/createDocxFile'
import { handleDocxWorkerRequest } from '../../../../src/main/services/ai/human/tools/docx/worker/docxWorker'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true }))
  )
})

describe('DOCX search worker', () => {
  it('counts every match while materializing only the public result limit', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-search-worker-'))
    temporaryDirectories.push(tempDir)
    const sourcePath = path.join(tempDir, 'many-matches.docx')
    const runId = randomUUID()
    await createDocxFile({
      filePath: sourcePath,
      nodes: [
        {
          type: 'paragraph',
          children: [{ type: 'run', children: [{ type: 'text', text: 'x'.repeat(50_000) }] }]
        }
      ]
    })

    const opened = await handleDocxWorkerRequest({
      requestId: randomUUID(),
      runId,
      action: 'open',
      payload: { sourcePath }
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok || opened.payload.action !== 'open') return

    try {
      const searched = await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'search',
        payload: {
          docId: opened.payload.docId,
          query: 'x',
          mode: 'literal',
          scopeNodeIds: [],
          includeContext: false
        }
      })
      expect(searched.ok).toBe(true)
      if (!searched.ok || searched.payload.action !== 'search') return
      expect(searched.payload.totalMatchCount).toBe(50_000)
      expect(searched.payload.matches).toHaveLength(10)

      const invalidScope = await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'search',
        payload: {
          docId: opened.payload.docId,
          query: 'x',
          mode: 'literal',
          scopeNodeIds: ['missing-node-id'],
          includeContext: false
        }
      })
      expect(invalidScope.ok).toBe(false)
      if (invalidScope.ok) return
      expect(invalidScope.code).toBe('invalid_input')
      expect(invalidScope.error).toContain('missing-node-id')
    } finally {
      await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'release_run',
        payload: {}
      })
    }
  })
})
