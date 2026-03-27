import { describe, it } from 'vitest'
import { importSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  getSettingsLocator,
  getSettingsPrefixLocator,
  navigateToSettingsSection,
  seedWebSources
} from '../../harness/e2e/settings'

describe('settings web e2e', () => {
  it('web-detail-and-delete', async () => {
    await runE2ECase({
      caseId: 'web-detail-and-delete',
      domain: 'settings',
      suite: 'web',
      description: '网页资料详情区展示无错误空态，并在删除成功后刷新列表。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'seed-web-source',
          message: '预置一条网页资料并进入网页资料页。',
          run: async () => {
            await seedWebSources(page, ['https://example.com/detail-delete'])
            await navigateToSettingsSection(page, 'web-sources')
            await getSettingsLocator(page, `${importSelectors.webSourceDeleteButtonPrefix}-e2e-web-source-1`).waitFor({
              state: 'visible'
            })
          }
        })

        const noErrorVisible = await page.getByText('暂无抓取错误').isVisible()

        await runtime.step({
          name: 'delete-web-source',
          message: '删除当前网页资料并等待列表刷新为空。',
          run: async () => {
            await getSettingsLocator(
              page,
              `${importSelectors.webSourceDeleteButtonPrefix}-e2e-web-source-1`
            ).click()
            await getSettingsLocator(page, importSelectors.webSourceDeleteConfirmButton).click()
            await page.getByText('暂无网页资料').waitFor({ state: 'visible' })
          }
        })

        return {
          noErrorVisible,
          emptyStateVisible: await page.getByText('暂无网页资料').isVisible(),
          remainingCards: await getSettingsPrefixLocator(page, importSelectors.webSourceCardPrefix).count()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.noErrorVisible, {
          name: 'detail-shows-no-error-state',
          message: '没有抓取错误时，详情区应明确显示“暂无抓取错误”，对齐 SET-WEB-005-AC1。',
          data: result
        })

        await runtime.assertThat(result.emptyStateVisible && result.remainingCards === 0, {
          name: 'delete-removes-web-source-from-list',
          message: '删除成功后，该网页资料应从列表中消失，对齐 SET-WEB-005-AC3。',
          data: result
        })
      }
    })
  })
})
