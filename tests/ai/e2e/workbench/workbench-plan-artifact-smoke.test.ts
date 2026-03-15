import { describe, it } from 'vitest'
import { workbenchSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase, type E2ETestRuntime } from '../../../harness/e2e/run-e2e-case'

const waitForAiEvent = async (runtime: E2ETestRuntime, eventType: string): Promise<void> => {
  const timeoutAt = Date.now() + 30_000

  while (Date.now() < timeoutAt) {
    const signals = await runtime.collectSignals()
    if (signals.aiRunEventEntries.some((entry) => entry.event.type === eventType)) {
      return
    }
    await runtime.page.waitForTimeout(200)
  }

  throw new Error(`timed out waiting for ai event: ${eventType}`)
}

describe('workbench plan artifact smoke', () => {
  it('runs the e2e fixture workflow and writes v3 logs', async () => {
    await runE2ECase({
      caseId: 'workbench-plan-artifact-smoke',
      caseType: 'basic',
      domain: 'ai',
      layer: 'e2e',
      suite: 'workbench',
      description: '验证 workbench e2e fixture 能稳定触发计划与文件产物路径',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await runtime.step({
          name: 'wait-workbench-page',
          message: '等待工作台页面加载',
          run: async () => {
            await runtime.page.getByTestId(workbenchSelectors.page).waitFor({ state: 'visible' })
          }
        })

        await runtime.step({
          name: 'fill-input',
          message: '输入 e2e fixture 指令',
          data: {
            scenario: 'chat-plan-artifact'
          },
          run: async () => {
            await runtime.page
              .getByTestId(workbenchSelectors.input)
              .fill('[e2e:chat-plan-artifact] 生成测试文档')
          }
        })

        await runtime.step({
          name: 'submit-input',
          message: '通过回车发送 e2e fixture 指令',
          run: async () => {
            await runtime.page.getByTestId(workbenchSelectors.input).press('Enter')
          }
        })

        await runtime.step({
          name: 'wait-run-complete',
          message: '等待 e2e fixture run 完成',
          run: async () => {
            await waitForAiEvent(runtime, 'run_completed')
          }
        })

        return null
      },
      assert: async (_result, runtime) => {
        const signals = await runtime.collectSignals()
        const timelineItems = await runtime.page
          .locator(`[data-testid^="${workbenchSelectors.timelineItemPrefix}-"]`)
          .count()

        await runtime.assertThat(timelineItems > 0, {
          name: 'timeline-rendered',
          message: '工作台时间线已渲染事件项',
          data: {
            timelineItems
          }
        })

        await runtime.assertThat(
          signals.aiRunEventEntries.some((entry) => entry.event.type === 'plan_created'),
          {
            name: 'plan-created-event',
            message: '收到 plan_created 事件'
          }
        )

        await runtime.assertThat(
          signals.aiRunEventEntries.some((entry) => entry.event.type === 'file_artifact'),
          {
            name: 'file-artifact-event',
            message: '收到 file_artifact 事件'
          }
        )

        await runtime.assertThat(
          signals.aiRunEventEntries.some((entry) => entry.event.type === 'run_completed'),
          {
            name: 'run-completed-event',
            message: '收到 run_completed 事件'
          }
        )
      }
    })
  })
})
