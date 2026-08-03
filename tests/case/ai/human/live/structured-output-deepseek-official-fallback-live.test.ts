import { describe, it } from 'vitest'
import { z } from 'zod/v4'
import {
  loadLiveLlmConfigFromEnv,
  loadStructuredFallbackLlmConfigFromEnv
} from '../../../../harness/backend/llmConfig'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const SCHEMA = z.object({ answer: z.string() })

describe('ai human live backend', () => {
  it('structured-output-deepseek-official-fallback-live', async () => {
    await runBackendCase({
      caseId: 'structured-output-deepseek-official-fallback-live',
      harnessMode: 'live',
      domain: 'ai',
      suite: 'human',
      groups: ['live'],
      description:
        '使用 DeepSeek 官方接口验证 json_schema 失败后降级到 json_object，并在新的 run 中复用已保存策略。',
      fixtures: [],
      runMode: 'single',
      runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
      execute: async (runtime) => {
        const config = loadStructuredFallbackLlmConfigFromEnv()
        const preferenceStore = runtime.storageService.llmStrategyPreference
        await runtime.seedLlmConfig(config)
        await preferenceStore.save({
          configId: config.id,
          modelName: config.model_name,
          strategy: { transport: 'completions', mode: 'json_schema' }
        })

        const request = {
          caller: 'human.brain',
          schemaName: 'structured_output_deepseek_fallback',
          schema: SCHEMA,
          system: 'Return a JSON object with answer equal to ok.',
          user: 'Return the requested JSON object.',
          streamingMode: 'force_non_stream' as const
        }
        const firstContext = runtime.createAiRunContext({
          modelName: config.model_name,
          sessionId: 'structured-output-deepseek-fallback-first'
        })
        const firstResult = await firstContext.chatStructured(request)
        const savedPreference = await preferenceStore.get({
          configId: config.id,
          modelName: config.model_name
        })

        const secondContext = runtime.createAiRunContext({
          modelName: config.model_name,
          sessionId: 'structured-output-deepseek-fallback-second'
        })
        const secondResult = await secondContext.chatStructured(request)
        const records = runtime.eventCollector
          .snapshot()
          .filter(
            (event) =>
              event.type === 'activity' &&
              event.actionType === 'llm_structured_output' &&
              event.status === 'completed' &&
              event.details.schemaName === request.schemaName
          )
          .map((event) => event.details)

        return {
          firstOutput: firstResult.output,
          secondOutput: secondResult.output,
          savedPreference,
          records: records.map((record) => ({
            strategy: record.strategy,
            fallbackStrategies: record.fallbackStrategies
          }))
        }
      },
      assert: async (result, runtime) => {
        const firstRecord = result.records[0]
        const secondRecord = result.records[1]
        runtime.assertThat(
          JSON.stringify(result.firstOutput) === JSON.stringify({ answer: 'ok' }) &&
            JSON.stringify(result.secondOutput) === JSON.stringify({ answer: 'ok' }),
          {
            name: 'deepseek-fallback-outputs-valid',
            message: 'DeepSeek 降级调用和新 run 复用调用都应返回符合 Schema 的 JSON。',
            data: { firstOutput: result.firstOutput, secondOutput: result.secondOutput }
          }
        )
        runtime.assertThat(
          JSON.stringify(firstRecord?.fallbackStrategies) ===
            JSON.stringify([
              { transport: 'completions', mode: 'json_schema' },
              { transport: 'completions', mode: 'json_object' }
            ]),
          {
            name: 'deepseek-schema-falls-back-to-json-object',
            message: 'DeepSeek 官方接口的 json_schema 失败后必须实际降级到 json_object。',
            data: { firstRecord }
          }
        )
        runtime.assertThat(
          result.savedPreference?.configId === 'ai-live-config' &&
            result.savedPreference.modelName ===
              loadStructuredFallbackLlmConfigFromEnv().model_name &&
            result.savedPreference.preferredTransport === 'completions' &&
            result.savedPreference.preferredStructuredOutputMode === 'json_object' &&
            typeof result.savedPreference.updatedAt === 'number' &&
            secondRecord?.fallbackStrategies?.length === 1 &&
            secondRecord.fallbackStrategies[0]?.transport === 'completions' &&
            secondRecord.fallbackStrategies[0]?.mode === 'json_object',
          {
            name: 'deepseek-json-object-preference-reused',
            message: '降级成功后应保存 json_object，新 run 的首个策略必须直接使用它。',
            data: { savedPreference: result.savedPreference, secondRecord }
          }
        )
      }
    })
  })
})
