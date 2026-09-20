import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRealAiDepsFactory } from '../../../../tests/harness/backend/realAiDepsFactory'
import { EventCollector } from '../../../../tests/harness/core/eventCollector'

describe('tool-real harness env', () => {
  it('does not load LANGSMITH_TRACING from dotenv', async () => {
    const original = process.env.LANGSMITH_TRACING
    delete process.env.LANGSMITH_TRACING
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ncurator-tool-real-env-'))
    const factory = await createRealAiDepsFactory({
      mode: 'tool-real',
      runId: 'tool-real-env',
      workspaceRoot,
      eventCollector: new EventCollector({
        retainRuntimeEvents: false,
        retainLlmIoRecords: false
      })
    })
    try {
      factory.createAiRunContext()
      expect(process.env.LANGSMITH_TRACING).toBeUndefined()
    } finally {
      await factory.close()
      await rm(workspaceRoot, { recursive: true, force: true })
      if (original === undefined) delete process.env.LANGSMITH_TRACING
      else process.env.LANGSMITH_TRACING = original
    }
  })
})
