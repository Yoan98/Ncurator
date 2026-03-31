import { describe, it } from 'vitest'
import { z } from 'zod/v4'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('ai director contracts backend', () => {
  it('structured-chat-activity-contract', async () => {
    await runBackendCase({
      caseId: 'structured-chat-activity-contract',
      domain: 'ai',
      suite: 'director',
      groups: ['contracts'],
      description: '验证 chatStructured 在成功与失败时都会产出统一的 llm_structured_output activity 事件。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const responseSchema = z.object({
          ok: z.literal(true)
        })
        const liveModelConfig = {
          id: 'test-live-model',
          name: 'Test Live Model',
          base_url: 'https://example.test/v1',
          model_name: 'gpt-5',
          api_key: 'test-key',
          is_active: true as const
        }

        const successCtx = runtime.createAiRunContext({
          liveModelConfig,
          chatStructuredOverride: async () => ({
            ok: true as const
          })
        })

        const failureCtx = runtime.createAiRunContext({
          liveModelConfig,
          chatStructuredOverride: async () => {
            throw new Error('simulated structured output failure')
          }
        })

        await successCtx.chatStructured({
          caller: 'contract.success',
          system: 'system',
          user: 'user',
          schema: responseSchema,
          schemaName: 'contract_success_schema'
        })

        let failureMessage = ''
        try {
          await failureCtx.chatStructured({
            caller: 'contract.failure',
            system: 'system',
            user: 'user',
            schema: responseSchema,
            schemaName: 'contract_failure_schema'
          })
        } catch (error) {
          failureMessage = error instanceof Error ? error.message : String(error || '')
        }

        return {
          activities: runtime.eventCollector
            .snapshot()
            .filter((event) => event.type === 'activity' && event.actionType === 'llm_structured_output'),
          failureMessage
        }
      },
      assert: async (result, runtime) => {
        const statuses = result.activities.map((event) => event.status)
        const summaries = result.activities.map((event) => event.summary)
        const details = result.activities.map((event) => event.details)

        runtime.assertThat(
          result.activities.length === 4 &&
            statuses[0] === 'started' &&
            statuses[1] === 'completed' &&
            statuses[2] === 'started' &&
            statuses[3] === 'failed' &&
            details.every((item) => item?.model === 'gpt-5' && item?.baseUrlHost === 'example.test') &&
            summaries.some((summary) => summary.includes('contract.success')) &&
            summaries.some((summary) => summary.includes('contract.failure')) &&
            result.failureMessage.includes('simulated structured output failure'),
          {
            name: 'chat-structured-emits-start-complete-and-failed-activities',
            message:
              'chatStructured 应为成功与失败调用都产出统一的 llm_structured_output activity，并保留 caller/model/baseUrlHost 等排障信息。',
            data: {
              activities: result.activities,
              failureMessage: result.failureMessage
            }
          }
        )
      }
    })
  })
})
