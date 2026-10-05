import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import type { AiLlmIoRecord, AiRunEvent } from '../../../src/shared/types'
import { serializeChatToolsRequestWire } from '../../../src/main/services/ai/utils/llmRequestWire'
import { EventCollector } from '../../harness/core/eventCollector'
import { collectContinuationPrefixCacheReuse } from '../../harness/core/continuation-prefix-cache'
import { createStreamingRunLogWriter, resolveRunLogDir } from '../../harness/backend/write-run-log'
import type { TestLogEvent, TestRunMeta } from '../../harness/core/run-log-contract'

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
  it('selects actual cross-run requests even when next records include a late previous request', () => {
    const record = (
      runId: string,
      callId: string,
      inputTokens: number,
      cachedInputTokens: number
    ): AiLlmIoRecord => ({
      runId,
      callId,
      caller: 'human.brain',
      schemaName: 'brain',
      model: 'test',
      baseUrlHost: 'example.com',
      system: '',
      user: '',
      streamed: false,
      chunkCount: 0,
      streamingMode: 'force_non_stream',
      startedAt: 1,
      completedAt: 2,
      durationMs: 1,
      status: 'completed',
      requestWire: serializeChatToolsRequestWire({
        messages: [new HumanMessage('previous context')],
        tools: []
      }),
      usage: {
        inputTokens,
        outputTokens: 1,
        totalTokens: inputTokens + 1,
        cachedInputTokens,
        cacheHitRate: cachedInputTokens / inputTokens,
        source: 'usage_metadata'
      }
    })
    const early = record('run-1', 'early', 21300, 21000)
    const late = record('run-1', 'late', 21599, 21376)
    const next = record('run-2', 'next', 20874, 8704)
    next.requestWire = serializeChatToolsRequestWire({
      messages: [new HumanMessage('previous context'), new HumanMessage('next task')],
      tools: []
    })
    const result = collectContinuationPrefixCacheReuse({
      previousRunId: 'run-1',
      nextRunId: 'run-2',
      previousLlmIo: [early, late],
      nextLlmIo: [late, next]
    })
    expect(result.previousLastBrain?.callId).toBe('late')
    expect(result.nextFirstBrain?.callId).toBe('next')
    expect(result.reuseRatio).toBeCloseTo(8704 / 21599)
    expect(result.prefixPreserved).toBe(true)
    expect(result.satisfied).toBe(false)
    const highHit = record('run-2', 'high-hit', 22000, 21376)
    highHit.requestWire = next.requestWire
    const compare = (nextRecord: AiLlmIoRecord) =>
      collectContinuationPrefixCacheReuse({
        previousRunId: 'run-1',
        nextRunId: 'run-2',
        previousLlmIo: [early, late],
        nextLlmIo: [late, nextRecord]
      })
    expect(compare(highHit).satisfied).toBe(true)
    highHit.requestWire = serializeChatToolsRequestWire({
      messages: [new HumanMessage('rewritten context'), new HumanMessage('next task')],
      tools: []
    })
    expect(compare(highHit).prefixPreserved).toBe(false)
    expect(compare(highHit).satisfied).toBe(false)
    expect(() =>
      collectContinuationPrefixCacheReuse({
        previousRunId: 'run-1',
        nextRunId: 'run-1',
        previousLlmIo: [early],
        nextLlmIo: [late]
      })
    ).toThrow('distinct run IDs')
  })
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
        schemaVersion: 5,
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
        partnerId: 'test-partner',
        createdAt: Date.now(),
        input: 'test input'
      } satisfies AiRunEvent)
      writer.appendLlmIoRecord({
        callId: 'call-1',
        runId,
        caller: 'human.brain',
        schemaName: 'human_brain_decision',
        providerKind: 'deepseek',
        model: 'test-model',
        baseUrlHost: 'example.com',
        system: 'sys',
        user: 'user',
        stablePrefixHash: 'stable-a',
        usage: {
          inputTokens: 100,
          outputTokens: 10,
          cachedInputTokens: 60,
          cacheMissInputTokens: 40,
          cacheHitRate: 0.6,
          source: 'response_metadata'
        },
        contextBudgetSnapshot: {
          evaluationId: 'budget-1',
          basis: 'usage_plus_delta',
          budgetTokens: 1234,
          contextWindowTokens: 204800,
          hasCompressibleHistory: true,
          usageAvailable: true,
          lastBrainInputTokens: 1000,
          deltaTokenEstimate: 234
        },
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

      const meta = JSON.parse(
        await fs.readFile(path.join(logDir, 'meta.json'), 'utf8')
      ) as TestRunMeta
      expect(meta.status).toBe('running')

      const timelineEvents = await readJsonLines(path.join(logDir, 'timeline.jsonl'))
      const runtimeEvents = await readJsonLines(path.join(logDir, 'runtime-events.jsonl'))
      const llmIoRecords = await readJsonLines(path.join(logDir, 'llm-io.jsonl'))
      expect(timelineEvents).toHaveLength(1)
      expect(runtimeEvents).toHaveLength(1)
      expect(llmIoRecords).toHaveLength(1)
      expect(llmIoRecords[0]).toMatchObject({
        contextBudgetSnapshot: {
          evaluationId: 'budget-1',
          basis: 'usage_plus_delta',
          budgetTokens: 1234,
          contextWindowTokens: 204800,
          hasCompressibleHistory: true,
          usageAvailable: true,
          lastBrainInputTokens: 1000,
          deltaTokenEstimate: 234
        }
      })

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
      const cacheSummary = JSON.parse(
        await fs.readFile(path.join(logDir, 'cache-summary.json'), 'utf8')
      )
      expect(finalizedMeta.status).toBe('passed')
      expect(cacheSummary).toMatchObject({
        calls: 1,
        inputTokens: 100,
        cachedInputTokens: 60,
        cacheHitRate: 0.6,
        providerKinds: ['deepseek'],
        byCaller: {
          'human.brain': {
            calls: 1,
            cachedInputTokens: 60
          }
        },
        byStablePrefixHash: {
          'stable-a': {
            calls: 1,
            cachedInputTokens: 60
          }
        }
      })
    } finally {
      process.chdir(previousCwd)
    }
  })

  it('can read streamed events from disk without retaining in memory', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-streaming-collector-'))
    createdDirs.push(tempRoot)
    const previousCwd = process.cwd()
    process.chdir(tempRoot)

    try {
      const scope = 'temp/unit'
      const caseId = 'streaming-event-collector'
      const runId = '20260427-160000-000'
      const writer = createStreamingRunLogWriter({
        scope,
        caseId,
        runId
      })
      writer.init({
        meta: {
          schemaVersion: 5,
          runId,
          caseId,
          scope,
          status: 'running',
          startedAt: '2026-04-27T08:00:00.000Z',
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
      })

      const collector = new EventCollector({
        sink: {
          flush: writer.flush,
          onRuntimeEvent: (event) => {
            writer.appendRuntimeEvent(event)
          },
          onLlmIo: (record) => {
            writer.appendLlmIoRecord(record)
          }
        },
        retainRuntimeEvents: false,
        retainLlmIoRecords: false,
        runtimeEventsPath: writer.paths.runtimeEventsPath,
        llmIoPath: writer.paths.llmIoPath
      })

      collector.add({
        type: 'run_started',
        runId,
        partnerId: 'disk-partner',
        createdAt: Date.now(),
        input: 'from-disk'
      } satisfies AiRunEvent)
      collector.addLlmIo({
        callId: 'call-2',
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

      const records = await collector.snapshotLlmIo()
      expect(collector.snapshot()).toHaveLength(1)
      expect(records).toHaveLength(1)
    } finally {
      process.chdir(previousCwd)
    }
  })
})
