import { describe, it } from 'vitest'
import { importSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  getSettingsLocator,
  getSettingsPrefixLocator,
  navigateToSettingsSection
} from '../../harness/e2e/settings'

describe('settings web e2e', () => {
  it('web-add-sources-dialog', async () => {
    await runE2ECase({
      caseId: 'web-add-sources-dialog',
      domain: 'settings',
      suite: 'web',
      description: '网页资料添加弹窗支持空输入校验、多行 URL 提交和成功后的清空收尾。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const urlTextarea = page.getByPlaceholder('每行一个 URL')
        let emptyWarningShown = false

        await runtime.step({
          name: 'open-add-dialog',
          message: '进入网页资料页并打开添加弹窗。',
          run: async () => {
            await navigateToSettingsSection(page, 'web-sources')
            await getSettingsLocator(page, importSelectors.webSourceOpenModalButton).click()
            await urlTextarea.waitFor({ state: 'visible' })
          }
        })

        await runtime.step({
          name: 'validate-empty-submit',
          message: '空输入直接提交，确认页面给出至少输入一个 URL 的提示。',
          run: async () => {
            await getSettingsLocator(page, importSelectors.webSourceConfirmButton).click()
            await page.getByText('请至少输入一个 URL').waitFor({ state: 'visible' })
            emptyWarningShown = true
          }
        })

        await runtime.step({
          name: 'submit-multi-line-urls',
          message: '输入两行 URL 并提交，确认列表刷新。',
          run: async () => {
            await urlTextarea.fill('https://example.com/one\nhttps://example.com/two')
            await getSettingsLocator(page, importSelectors.webSourceConfirmButton).click()
            await page.waitForFunction(
              (selector) => document.querySelectorAll(selector).length === 2,
              `[data-testid^="${importSelectors.webSourceCardPrefix}-"]`
            )
          }
        })

        await runtime.step({
          name: 'reopen-dialog',
          message: '重新打开弹窗，检查输入内容是否已经清空。',
          run: async () => {
            await getSettingsLocator(page, importSelectors.webSourceOpenModalButton).click()
            await urlTextarea.waitFor({ state: 'visible' })
          }
        })

        return {
          emptyWarningShown,
          cardCount: await getSettingsPrefixLocator(page, importSelectors.webSourceCardPrefix).count(),
          reopenedTextareaValue: await urlTextarea.inputValue()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.emptyWarningShown, {
          name: 'empty-submit-is-blocked',
          message: '输入为空时，提交应被拦截，并提示至少输入一个 URL，对齐 SET-WEB-002-AC1。',
          data: result
        })

        await runtime.assertThat(result.cardCount === 2, {
          name: 'multi-line-submit-adds-sources',
          message:
            '多行 URL 提交成功后，应把对应网页资料加入列表，满足入队入口的成功反馈，对齐 SET-WEB-002-AC2。',
          data: result
        })

        await runtime.assertThat(result.reopenedTextareaValue === '', {
          name: 'dialog-clears-input-after-success',
          message:
            '提交成功后，再次打开添加弹窗时输入内容应已清空，说明成功收尾完成，对齐 SET-WEB-002-AC2。',
          data: result
        })
      }
    })
  })
})
