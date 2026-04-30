import { describe, it } from 'vitest'
import { importSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_WEB_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  getSettingsPrefixLocator,
  navigateToSettingsSection,
  workspaceCardLocator
} from '../../../harness/e2e/settings'

describe('settings workspace web e2e', () => {
  it('web-add-sources-dialog', async () => {
    await runE2ECase({
      caseId: 'web-add-sources-dialog',
      domain: 'settings',
      suite: 'workspace',
      groups: ['web'],
      description: '网页资料添加弹窗支持空输入校验、多行 URL 提交和成功后的清空收尾。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const urlTextarea = page.getByPlaceholder('每行一个 URL')
        let emptyWarningShown = false
        let modalClosedAfterSubmit = false

        await runtime.step({
          name: 'open-add-dialog',
          message: '创建工作区，进入工作区详情并打开添加网页弹窗。',
          run: async () => {
            const workspace = await createFixtureWorkspace(page, {
              rootPath: '/tmp/settings-web-add-dialog-workspace',
              name: '网页资料工作区'
            })
            await navigateToSettingsSection(page, 'workspace')
            await workspaceCardLocator(page, workspace.workspace!.id).click()
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
          message: '输入两行 URL 并提交，确认弹窗关闭且列表刷新。',
          run: async () => {
            await urlTextarea.fill('https://example.com/one\nhttps://example.com/two')
            await getSettingsLocator(page, importSelectors.webSourceConfirmButton).click()
            await getSettingsLocator(page, importSelectors.webSourceModal).waitFor({ state: 'hidden' })
            modalClosedAfterSubmit = true
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
          modalClosedAfterSubmit,
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

        await runtime.assertThat(result.modalClosedAfterSubmit && result.reopenedTextareaValue === '', {
          name: 'dialog-closes-and-clears-after-success',
          message:
            '提交成功后，添加弹窗应关闭，再次打开时输入内容应已清空，且当前工作区网页资料列表已刷新，对齐 SET-WEB-002-AC3。',
          data: result
        })
      }
    })
  }, SETTINGS_WEB_E2E_TIMEOUT_MS)
})
