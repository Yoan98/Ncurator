import { describe, it } from 'vitest'
import { importSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_WEB_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  getSettingsPrefixLocator,
  navigateToSettingsSection,
  seedWebSources,
  workspaceCardLocator
} from '../../../harness/e2e/settings'

describe('settings workspace web e2e', () => {
  it('web-detail-and-delete', async () => {
    await runE2ECase({
      caseId: 'web-detail-and-delete',
      domain: 'settings',
      suite: 'workspace',
      groups: ['web'],
      description: '网页列表项展示关键信息，并在删除成功后刷新列表。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'seed-web-source',
          message: '预置工作区与一条网页资料并进入网页 tab。',
          run: async () => {
            const workspace = await createFixtureWorkspace(page, {
              rootPath: '/tmp/settings-web-detail-delete-workspace',
              name: '网页资料工作区'
            })
            await seedWebSources(page, workspace.workspace!.id, ['https://example.com/detail-delete'])
            await navigateToSettingsSection(page, 'workspace')
            await workspaceCardLocator(page, workspace.workspace!.id).click()
            await page.getByRole('tab', { name: '网页 1' }).click()
            await getSettingsLocator(
              page,
              `${importSelectors.webSourceDeleteButtonPrefix}-e2e-web-source-1`
            ).waitFor({
              state: 'visible'
            })
          }
        })

        const webCardText =
          (await getSettingsLocator(page, `${importSelectors.webSourceCardPrefix}-e2e-web-source-1`).textContent()) ||
          ''

        await runtime.step({
          name: 'delete-web-source',
          message: '删除当前网页资料并等待列表刷新为空。',
          run: async () => {
            await getSettingsLocator(
              page,
              `${importSelectors.webSourceDeleteButtonPrefix}-e2e-web-source-1`
            ).click()
            await getSettingsLocator(page, importSelectors.webSourceDeleteConfirmButton).click()
            await page.getByText('暂无网页').waitFor({ state: 'visible' })
          }
        })

        return {
          webCardText,
          emptyStateVisible: await page.getByText('暂无网页').isVisible(),
          remainingCards: await getSettingsPrefixLocator(page, importSelectors.webSourceCardPrefix).count()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.webCardText.includes('Fixture') &&
            result.webCardText.includes('https://example.com/detail-delete') &&
            result.webCardText.includes('已索引') &&
            result.webCardText.includes('抓取'),
          {
            name: 'web-list-item-shows-required-fields',
            message:
              '网页列表项应展示标题、URL、状态和抓取时间，对齐 SET-WEB-005-AC1。',
            data: result
          }
        )

        await runtime.assertThat(result.emptyStateVisible && result.remainingCards === 0, {
          name: 'delete-removes-web-source-from-list',
          message: '删除成功后，该网页资料应从列表中消失，对齐 SET-WEB-005-AC3。',
          data: result
        })
      }
    })
  }, SETTINGS_WEB_E2E_TIMEOUT_MS)
})
