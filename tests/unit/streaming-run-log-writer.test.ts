import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AiLlmIoRecord, AiRunEvent } from '../../src/shared/types'
import {
  createStreamingRunLogWriter,
  resolveRunLogDir
} from '../harness/backend/write-run-log'
import type { TestLogEvent, TestRunMeta } from '../harness/core/run-log-contract'

const createdDirs: string[] = []

const readJsonLines = async (filePath: string): Promise<unknown[]> => {
  const raw = await fs.readFile(filePath, 'utf8')
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

describe('streaming run log writer', () => {
  afterEach(async () => {
    await Promise.all(
      createdDirs.map(async (dirPath) => {
        await fs.rm(dirPath, { recursive: true, force: true })
      })
    )
    createdDirs.length = 0
  })

  it('creates run dir and appends events before finalize', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-streaming-log-'))
    createdDirs.push(tempRoot)
    const previousCwd = process.cwd()
    process.chdir(tempRoot)

    try {
      const scope = 'temp/unit'
      const caseId = 'streaming-run-log-writer'
      const runId = '20260427-150000-000'
      const writer = createStreamingRunLogWriter({
        scope,
        caseId,
        runId
      })
      const runningMeta: TestRunMeta = {
        schemaVersion: 4,
        runId,
        caseId,
        scope,
        status: 'running',
        startedAt: '2026-04-27T07:00:00.000Z',
        finishedAt: '',
        stats: {
          durationMs: 0,
          steps: 0,
          assertions: 0,
          errors: 0,
          artifacts: 0
        },
        runtime: {
          driver: 'backend',
          target: 'node',
          modelName: null
        }
      }

      writer.init({ meta: runningMeta })
      writer.appendTimelineEvent({
        ts: '2026-04-27T07:00:00.001Z',
        type: 'run',
        name: 'start',
        status: 'info',
        message: 'started'
      } satisfies TestLogEvent)
      writer.appendRuntimeEvent({
        type: 'run_started',
        runId,
        sessionId: 'test-session',
        createdAt: Date.now(),
        input: 'test input'
      } satisfies AiRunEvent)
      writer.appendLlmIoRecord({
        callId: 'call-1',
        runId,
        caller: 'human.brain',
        schemaName: 'human_brain_decision',
        model: 'test-model',
        baseUrlHost: 'example.com',
        system: 'sys',
        user: 'user',
        streamingMode: 'force_non_stream',
        streamed: false,
        chunkCount: 0,
        startedAt: Date.now(),
        completedAt: Date.now(),
        durationMs: 1,
        status: 'completed'
      } satisfies AiLlmIoRecord)

      await writer.flush()

      const logDir = resolveRunLogDir({ scope, caseId, runId })
      expect(await fs.stat(logDir)).toBeTruthy()

      const meta = JSON.parse(await fs.readFile(path.join(logDir, 'meta.json'), 'utf8')) as TestRunMeta
      expect(meta.status).toBe('running')

      const timelineEvents = await readJsonLines(path.join(logDir, 'timeline.jsonl'))
      const runtimeEvents = await readJsonLines(path.join(logDir, 'runtime-events.jsonl'))
      const llmIoRecords = await readJsonLines(path.join(logDir, 'llm-io.jsonl'))
      expect(timelineEvents).toHaveLength(1)
      expect(runtimeEvents).toHaveLength(1)
      expect(llmIoRecords).toHaveLength(1)

      await writer.finalize({
        meta: {
          ...runningMeta,
          status: 'passed',
          finishedAt: '2026-04-27T07:00:01.000Z',
          stats: {
            durationMs: 1000,
            steps: 0,
            assertions: 0,
            errors: 0,
            artifacts: 0
          }
        },
        artifacts: []
      })

      const finalizedMeta = JSON.parse(
        await fs.readFile(path.join(logDir, 'meta.json'), 'utf8')
      ) as TestRunMeta
      expect(finalizedMeta.status).toBe('passed')
    } finally {
      process.chdir(previousCwd)
    }
  })
})
