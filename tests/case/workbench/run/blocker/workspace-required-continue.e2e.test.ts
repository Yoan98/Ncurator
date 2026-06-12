import { describe, it } from 'vitest'
import { chatSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LONG_E2E_TIMEOUT_MS,
  createWorkbenchWorkspace,
  getWorkspaceRequiredCard,
  seedWorkbenchModelConfig,
  sendWorkbenchMessage,
  waitForLatestAssistantFinalAnswer
} from '../../../../harness/e2e/workbench'
import { getSettingsLocator } from '../../../../harness/e2e/settings'

describe('workbench run e2e', () => {
  it('workspace-required-continue', async () => {
    await runE2ECase({
      caseId: 'workspace-required-continue',
      domain: 'workbench',
      suite: 'run',
      groups: ['blocker'],
      description: '运行中缺少工作区 root 时，用户补充工作区后继续处理上一条请求。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        await runtime.step({
          name: 'seed-workspace-without-root',
          message: '预置模型配置和无 rootPath 的工作区，触发运行中补工作区提示。',
          run: async () => {
            await seedWorkbenchModelConfig(page)
            await createWorkbenchWorkspace(page, {
              name: 'Workbench E2E 待补工作区',
              rootPath: ''
            })
          }
        })

        await runtime.step({
          name: 'trigger-workspace-required',
          message: '发送需要工作区 root 的 fixture 请求。',
          run: async () => {
            await sendWorkbenchMessage(page, '[e2e:chat-workspace] 需要补工作区后继续')
            await getWorkspaceRequiredCard(page).waitFor({ state: 'visible' })
          }
        })
        const blockerText = (await getWorkspaceRequiredCard(page).textContent()) || ''

        await runtime.step({
          name: 'fill-workspace-root-and-continue',
          message: '补充 rootPath 后点击继续运行。',
          run: async () => {
            await page.evaluate(async () => {
              const list = await window.api.workspaceList()
              const workspaceId = list.items[0]?.id || ''
              await window.api.workspaceSetRootPath({
                workspaceId,
                rootPath: '/tmp/ncurator-workbench-e2e-workspace-restored'
              })
            })
            await getSettingsLocator(page, chatSelectors.workspaceContinueButton).click()
            await waitForLatestAssistantFinalAnswer(page)
          }
        })
        const bodyText = (await page.locator('body').textContent()) || ''

        return {
          blockerText,
          bodyText
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.blockerText.includes('需要补充工作区范围'), {
          name: 'workspace-required-card-renders',
          message:
            '运行时检测到工作区缺失或不可用时，应提示用户先补工作区，对齐 WB-BLOCKER-002-AC1。',
          data: result
        })

        await runtime.assertThat(
          result.bodyText.includes('已补充工作区上下文，请继续处理上一条请求。') &&
            result.bodyText.includes('工作区已补充，E2E fixture 已继续执行。'),
          {
            name: 'continue-restarts-from-original-request',
            message:
              '补工作区后继续运行，应插入补充上下文用户消息并基于原请求重新启动运行，对齐 WB-BLOCKER-002-AC2。',
            data: result
          }
        )
      }
    })
  }, WORKBENCH_LONG_E2E_TIMEOUT_MS)
})
