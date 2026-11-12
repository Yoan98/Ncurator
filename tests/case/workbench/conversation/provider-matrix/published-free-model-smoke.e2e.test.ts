import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  createPartnerThroughWorkbenchUi,
  getWorkbenchLocator,
  navigateToWorkbench,
  sendWorkbenchMessage,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'published-free-model-smoke'

describe('published client free model', () => {
  it(
    CASE_ID,
    async () => {
      if (process.env.NCURATOR_E2E_APP_TARGET !== 'package') {
        throw new Error('Run this case against the published domestic package')
      }
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['provider-matrix'],
        description: '在国内正式包刷新免费目录并发送一条合成消息。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'background',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await page.waitForFunction(() => typeof window.api?.freeModelsRefresh === 'function')
          const catalog = await page.evaluate(async () => {
            const result = await window.api.freeModelsRefresh()
            if (!result.success) {
              return {
                ok: false as const,
                message:
                  String(result.error).match(/HTTP \d+/)?.[0] || 'Free directory refresh failed'
              }
            }
            const { models } = result.snapshot
            return {
              ok: true as const,
              models: models.map(({ id, modelName }) => ({ id, modelName }))
            }
          })
          if (!catalog.ok) throw new Error(catalog.message)
          const preferred = ['glm-4-flash', 'qwen3.5-flash', 'grok-4.1-fast']
          const model =
            preferred
              .map((name) => catalog.models.find((entry) => entry.modelName === name))
              .find(Boolean) || catalog.models[0]
          if (!model) throw new Error('Published free model directory is empty')

          await navigateToWorkbench(page, { waitForSessionListText: false })
          await createPartnerThroughWorkbenchUi(page, '免费链路验收')
          await getWorkbenchLocator(page, workbenchSelectors.modelSelect).click()
          await page
            .getByTestId(`${workbenchSelectors.modelSelectFreeOptionPrefix}-${model.id}`)
            .click()
          const startedAt = Date.now()
          await sendWorkbenchMessage(page, '只回复 READY。')
          const result = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAt,
            model.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page }
          )
          return {
            catalogEntries: catalog.models.length,
            modelName: model.modelName,
            runCompleted: result.events.some((event) => event.type === 'run_completed'),
            answerPresent: result.finalAnswerText.trim().length > 0
          }
        },
        assert: async (result, runtime) =>
          runtime.assertThat(
            result.catalogEntries > 0 && result.runCompleted && result.answerPresent,
            {
              name: 'published-free-model-completed',
              message: '正式国内包通过免费链路完成一次合成调用',
              data: result
            }
          )
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS * 2
  )
})
