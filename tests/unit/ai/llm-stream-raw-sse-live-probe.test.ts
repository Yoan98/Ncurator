import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import fs from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { createChatModel } from '../../../src/main/services/llm/chatModel'
import { normalizeOpenAIBaseUrl } from '../../../src/shared/llmBaseUrl'
import { extractTextContent } from '../../../src/main/services/ai/structuredOutput'
import { humanThoughtDecisionSchema } from '../../../src/main/services/ai/human/schema'
import type { LlmRuntimeConfig } from '../../../src/shared/types'
import {
  hasLiveLlmConfigInEnv,
  loadLiveLlmConfigFromEnv
} from '../../harness/backend/llmConfig'

type StreamStats = {
  chunkCount: number
  nonBlankChunkCount: number
  blankChunkCount: number
  maxConsecutiveBlankChunks: number
  stoppedAfterBlankStall: boolean
  totalTextLength: number
  trimmedTextLength: number
  firstSamples: string[]
  reasoningChunkCount: number
  nonBlankReasoningChunkCount: number
  blankReasoningChunkCount: number
  totalReasoningLength: number
  firstReasoningSamples: string[]
  observedChunkKeys: string[]
  observedAdditionalKwargKeys: string[]
  finishReasons: string[]
}

type ReplayPrompt = {
  callId?: string
  schemaName: string
  system: string
  user: string
}

const schema = z.object({
  answer: z.string()
})

const systemPrompt =
  'You are a structured streaming transport probe. Return only valid JSON matching the schema.'
const userPrompt = 'Return a JSON object where answer is exactly "ok".'

const emptyStats = (): StreamStats => ({
  chunkCount: 0,
  nonBlankChunkCount: 0,
  blankChunkCount: 0,
  maxConsecutiveBlankChunks: 0,
  stoppedAfterBlankStall: false,
  totalTextLength: 0,
  trimmedTextLength: 0,
  firstSamples: [],
  reasoningChunkCount: 0,
  nonBlankReasoningChunkCount: 0,
  blankReasoningChunkCount: 0,
  totalReasoningLength: 0,
  firstReasoningSamples: [],
  observedChunkKeys: [],
  observedAdditionalKwargKeys: [],
  finishReasons: []
})

const addUnique = (target: string[], values: string[]): void => {
  for (const value of values) {
    if (!target.includes(value)) target.push(value)
  }
}

const addTextToStats = (stats: StreamStats, text: string, blankStreak: number): number => {
  stats.chunkCount += 1
  stats.totalTextLength += text.length
  stats.trimmedTextLength += text.trim().length
  if (stats.firstSamples.length < 8) {
    stats.firstSamples.push(text.slice(0, 80))
  }

  if (text.trim()) {
    stats.nonBlankChunkCount += 1
    return 0
  }

  const nextBlankStreak = blankStreak + 1
  stats.blankChunkCount += 1
  stats.maxConsecutiveBlankChunks = Math.max(
    stats.maxConsecutiveBlankChunks,
    nextBlankStreak
  )
  return nextBlankStreak
}

const addReasoningToStats = (stats: StreamStats, text: string): void => {
  stats.reasoningChunkCount += 1
  stats.totalReasoningLength += text.length
  if (text.trim()) {
    stats.nonBlankReasoningChunkCount += 1
  } else {
    stats.blankReasoningChunkCount += 1
  }
  if (stats.firstReasoningSamples.length < 8) {
    stats.firstReasoningSamples.push(text.slice(0, 80))
  }
}

const buildCompletionsUrl = (baseUrl: string): string => {
  const normalized = normalizeOpenAIBaseUrl(baseUrl).replace(/\/$/, '')
  return `${normalized}/chat/completions`
}

const resolveProbeSchema = (schemaName: string): z.ZodType<Record<string, unknown>> =>
  schemaName === 'human_brain_decision' ? humanThoughtDecisionSchema : schema

const loadReplayPromptFromEnv = async (): Promise<ReplayPrompt | undefined> => {
  const llmIoPath = String(process.env.AI_LIVE_STREAM_PROBE_LLM_IO_PATH || '').trim()
  if (!llmIoPath) return undefined

  const targetCallId = String(process.env.AI_LIVE_STREAM_PROBE_CALL_ID || '').trim()
  const lines = (await fs.readFile(llmIoPath, 'utf8')).split(/\r?\n/).filter(Boolean)
  const records = lines
    .map((line) => JSON.parse(line) as Partial<ReplayPrompt> & { caller?: string })
    .filter(
      (record): record is ReplayPrompt & { caller?: string } =>
        typeof record.schemaName === 'string' &&
        typeof record.system === 'string' &&
        typeof record.user === 'string'
    )
  const record = targetCallId
    ? records.find((item) => item.callId === targetCallId)
    : records
        .slice()
        .reverse()
        .find((item) => item.schemaName === 'human_brain_decision' || item.caller === 'human.brain')

  if (!record) {
    throw new Error(`llm_io_replay_record_not_found:${llmIoPath}`)
  }

  return {
    callId: record.callId,
    schemaName: record.schemaName,
    system: record.system,
    user: record.user
  }
}

const runRawSseProbe = async (input: {
  cfg: LlmRuntimeConfig
  schemaName: string
  system: string
  user: string
}): Promise<StreamStats> => {
  const stats = emptyStats()
  const schemaForRequest = resolveProbeSchema(input.schemaName)
  const response = await fetch(buildCompletionsUrl(input.cfg.base_url), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.cfg.api_key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: input.cfg.model_name,
      temperature: 0,
      stream: true,
      messages: [
        {
          role: 'system',
          content: input.system
        },
        {
          role: 'user',
          content: input.user
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: input.schemaName,
          schema: z.toJSONSchema(schemaForRequest),
          strict: true
        }
      }
    })
  })

  if (!response.ok || !response.body) {
    throw new Error(`raw_sse_probe_failed:${response.status}:${await response.text()}`)
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let blankStreak = 0

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice('data:'.length).trim()
      if (!data || data === '[DONE]') continue

      const parsed = JSON.parse(data) as {
        choices?: Array<{
          delta?: {
            content?: string
            reasoning_content?: string
          }
          finish_reason?: string | null
        }>
      }
      const choice = parsed.choices?.[0]
      const finishReason = choice?.finish_reason
      if (finishReason) {
        stats.finishReasons.push(finishReason)
      }
      const text = choice?.delta?.content
      if (typeof text === 'string') {
        blankStreak = addTextToStats(stats, text, blankStreak)
        if (blankStreak > 512) {
          stats.stoppedAfterBlankStall = true
          return stats
        }
      }
      const reasoningText = choice?.delta?.reasoning_content
      if (typeof reasoningText === 'string') {
        addReasoningToStats(stats, reasoningText)
      }
    }
  }

  return stats
}

const runLangChainStreamProbe = async (input: {
  cfg: LlmRuntimeConfig
  schemaName: string
  system: string
  user: string
}): Promise<StreamStats> => {
  const stats = emptyStats()
  const schemaForRequest = resolveProbeSchema(input.schemaName)
  const runnable = createChatModel(input.cfg, {
    temperature: 0,
    transport: 'completions',
    streaming: true
  }).withConfig({
    outputVersion: 'v0',
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: input.schemaName,
        schema: z.toJSONSchema(schemaForRequest),
        strict: true
      }
    }
  }) as {
    stream: (input: Array<SystemMessage | HumanMessage>) => Promise<AsyncIterable<unknown>>
  }

  const stream = await runnable.stream([
    new SystemMessage(input.system),
    new HumanMessage(input.user)
  ])
  let blankStreak = 0

  for await (const chunk of stream) {
    if (chunk && typeof chunk === 'object') {
      addUnique(stats.observedChunkKeys, Object.keys(chunk))
    }
    const text = extractTextContent(
      chunk && typeof chunk === 'object' && 'content' in chunk
        ? (chunk as { content?: unknown }).content
        : ''
    )
    if (!text) continue
    blankStreak = addTextToStats(stats, text, blankStreak)
    if (blankStreak > 512) {
      stats.stoppedAfterBlankStall = true
      return stats
    }

    const responseMetadata =
      chunk && typeof chunk === 'object' && 'response_metadata' in chunk
        ? (chunk as { response_metadata?: { finish_reason?: string } }).response_metadata
        : undefined
    if (responseMetadata?.finish_reason) {
      stats.finishReasons.push(responseMetadata.finish_reason)
    }

    const additionalKwargs =
      chunk && typeof chunk === 'object' && 'additional_kwargs' in chunk
        ? (chunk as { additional_kwargs?: Record<string, unknown> }).additional_kwargs
        : undefined
    if (additionalKwargs) {
      addUnique(stats.observedAdditionalKwargKeys, Object.keys(additionalKwargs))
      const reasoningText = additionalKwargs.reasoning_content
      if (typeof reasoningText === 'string') {
        addReasoningToStats(stats, reasoningText)
      }
    }
  }

  return stats
}

describe('ai unit raw SSE stream live probe', () => {
  it(
    'compares raw provider SSE with LangChain stream chunks',
    async () => {
      if (!hasLiveLlmConfigInEnv()) {
        expect(true).toBe(true)
        return
      }

      const cfg = loadLiveLlmConfigFromEnv() as LlmRuntimeConfig
      const rawSse = await runRawSseProbe({
        cfg,
        schemaName: 'live_probe_answer',
        system: systemPrompt,
        user: userPrompt
      })
      const langChain = await runLangChainStreamProbe({
        cfg,
        schemaName: 'live_probe_answer',
        system: systemPrompt,
        user: userPrompt
      })

      process.stdout.write(
        `${JSON.stringify(
          {
            baseUrl: cfg.base_url,
            model: cfg.model_name,
            rawSse,
            langChain
          },
          null,
          2
        )}\n`
      )

      expect(rawSse.chunkCount).toBeGreaterThan(0)
      expect(langChain.chunkCount).toBeGreaterThan(0)
    },
    180_000
  )

  it(
    'replays an llm-io prompt when AI_LIVE_STREAM_PROBE_LLM_IO_PATH is provided',
    async () => {
      if (!hasLiveLlmConfigInEnv()) {
        expect(true).toBe(true)
        return
      }

      const replayPrompt = await loadReplayPromptFromEnv()
      if (!replayPrompt) {
        expect(true).toBe(true)
        return
      }

      const cfg = loadLiveLlmConfigFromEnv() as LlmRuntimeConfig
      const rawSse = await runRawSseProbe({
        cfg,
        schemaName: replayPrompt.schemaName,
        system: replayPrompt.system,
        user: replayPrompt.user
      })
      const langChain = await runLangChainStreamProbe({
        cfg,
        schemaName: replayPrompt.schemaName,
        system: replayPrompt.system,
        user: replayPrompt.user
      })

      process.stdout.write(
        `${JSON.stringify(
          {
            baseUrl: cfg.base_url,
            model: cfg.model_name,
            replay: {
              callId: replayPrompt.callId,
              schemaName: replayPrompt.schemaName,
              systemLength: replayPrompt.system.length,
              userLength: replayPrompt.user.length
            },
            rawSse,
            langChain
          },
          null,
          2
        )}\n`
      )

      expect(rawSse.chunkCount).toBeGreaterThan(0)
      expect(langChain.chunkCount).toBeGreaterThan(0)
    },
    240_000
  )
})
