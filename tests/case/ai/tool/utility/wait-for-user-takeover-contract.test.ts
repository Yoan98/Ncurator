import { describe, it } from 'vitest'
import { createUtilityToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType } from '../../human/testUtils'

type WaitForUserTakeoverResult = {
  confirmed: true
  message: string
}

describe('ai tool utility backend', () => {
  it('wait-for-user-takeover-contract', async () => {
    await runBackendCase({
      caseId: 'wait-for-user-takeover-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['utility'],
      description: '验证 wait_for_user_takeover 会发出接手事件，并在用户确认后恢复任务。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createUtilityToolHarness(runtime)
        const result = await harness.invoke<WaitForUserTakeoverResult>('wait_for_user_takeover', {
          message: '请在右侧浏览器完成登录'
        })
        const { WAIT_FOR_USER_TAKEOVER_SCHEMA } =
          await import('../../../../../src/main/services/ai/human/tools/utility/toolSpecs')
        return {
          result,
          rejectsOverlongMessage: !WAIT_FOR_USER_TAKEOVER_SCHEMA.safeParse({
            message: '用'.repeat(31)
          }).success,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (output, runtime) => {
        const required = filterAiRunEventsByType(output.events, 'user_takeover_required')
        const confirmed = filterAiRunEventsByType(output.events, 'user_takeover_confirmed')
        runtime.assertThat(output.result.confirmed === true, {
          name: 'takeover-tool-resumes-after-confirmation',
          message: '用户确认后工具应返回 confirmed=true。',
          data: output.result
        })
        runtime.assertThat(output.rejectsOverlongMessage, {
          name: 'takeover-message-schema-limit',
          message: '接手提示超过 30 个字符时应被工具 schema 拒绝。'
        })
        runtime.assertThat(
          required.length === 1 &&
            required[0]?.message === '请在右侧浏览器完成登录' &&
            confirmed.length === 1 &&
            confirmed[0]?.requestId === required[0]?.requestId,
          {
            name: 'takeover-events-match-request',
            message: '接手请求和确认事件应使用同一个 requestId，并保留 30 字内提示。',
            data: { required, confirmed }
          }
        )
      }
    })
  })
})
