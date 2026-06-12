import { describe, it } from 'vitest'
import { workbenchSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LONG_E2E_TIMEOUT_MS,
  appendWorkbenchInputText,
  createWorkbenchWorkspace,
  getWorkbenchLocator,
  seedWorkbenchReadyState
} from '../../../../harness/e2e/workbench'

describe('workbench conversation e2e', () => {
  it('reference-token-lifecycle', async () => {
    await runE2ECase({
      caseId: 'reference-token-lifecycle',
      domain: 'workbench',
      suite: 'conversation',
      groups: ['scope'],
      description: '验证 @ 参考资料候选、插入、共存、删除、去重和切工作区清理。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        await runtime.step({
          name: 'seed-indexed-workspace',
          message: '预置包含可检索本地文件的工作区。',
          run: async () => {
            await seedWorkbenchReadyState(page, { prepareWorkspace: true })
          }
        })

        await runtime.step({
          name: 'open-mention-panel',
          message: '输入 @ 打开候选面板。',
          run: async () => {
            await appendWorkbenchInputText(page, '@')
            await getWorkbenchLocator(page, workbenchSelectors.mentionPanel).waitFor({
              state: 'visible'
            })
            await getWorkbenchLocator(page, workbenchSelectors.mentionPanel)
              .getByRole('button', { name: /brief\.txt/ })
              .waitFor({ state: 'visible' })
          }
        })
        const firstPanelText =
          (await getWorkbenchLocator(page, workbenchSelectors.mentionPanel).textContent()) || ''

        await runtime.step({
          name: 'insert-file-token',
          message: '选择本地文件候选，插入为 inline token。',
          run: async () => {
            await getWorkbenchLocator(page, workbenchSelectors.mentionPanel)
              .getByRole('button', { name: /brief\.txt/ })
              .click()
            await page.waitForFunction(() =>
              document.body.innerText.includes('brief.txt')
            )
          }
        })
        const afterFileInsertText =
          (await getWorkbenchLocator(page, workbenchSelectors.referenceField).textContent()) || ''

        await runtime.step({
          name: 'insert-web-token',
          message: '为同一工作区添加网页资料并插入第二个 token。',
          run: async () => {
            await page.evaluate(async () => {
              const workspaces = await window.api.workspaceList()
              const workspaceId = workspaces.items[0]?.id || ''
              await window.api.ingestWeb({
                workspaceId,
                url: 'https://example.com/workbench-reference-token'
              })
            })
            await appendWorkbenchInputText(page, ' @')
            await getWorkbenchLocator(page, workbenchSelectors.mentionPanel).waitFor({
              state: 'visible'
            })
            await getWorkbenchLocator(page, workbenchSelectors.mentionPanel)
              .getByRole('button', { name: /Fixture · example\.com\/workbench-reference-token/ })
              .click()
            await page.waitForFunction(
              () => document.body.innerText.includes('Fixture · example.com/workbench-reference-token'),
              undefined,
              { timeout: 1000 }
            )
          }
        })
        const afterTwoTokenText =
          (await getWorkbenchLocator(page, workbenchSelectors.referenceField).textContent()) || ''

        await runtime.step({
          name: 'try-duplicate-candidate',
          message: '再次打开候选面板，确认已插入范围不会重复出现。',
          run: async () => {
            await appendWorkbenchInputText(page, ' @')
            await getWorkbenchLocator(page, workbenchSelectors.mentionPanel).waitFor({
              state: 'visible'
            })
          }
        })
        const duplicatePanelText =
          (await getWorkbenchLocator(page, workbenchSelectors.mentionPanel).textContent()) || ''

        await runtime.step({
          name: 'clear-by-workspace-change',
          message: '切换工作区后旧工作区 token 应自动清理。',
          run: async () => {
            await page.keyboard.press('Escape')
            await createWorkbenchWorkspace(page, {
              name: 'Workbench E2E 第二工作区',
              rootPath: '/tmp/ncurator-workbench-e2e-workspace-second'
            })
            await getWorkbenchLocator(page, workbenchSelectors.workspaceSelect).click()
            const secondWorkspaceOption = page
              .locator('.workbench-composer-select-dropdown:not(.ant-select-dropdown-hidden)')
              .getByText('Workbench E2E 第二工作区')
            await secondWorkspaceOption.waitFor({ state: 'visible' })
            await secondWorkspaceOption.evaluate((element) => {
              if (element instanceof HTMLElement) element.click()
            })
            await getWorkbenchLocator(page, workbenchSelectors.workspaceSelect)
              .getByText('Workbench E2E 第二工作区')
              .waitFor({ state: 'visible' })
            await page.waitForTimeout(250)
          }
        })
        const afterWorkspaceChangeText =
          (await getWorkbenchLocator(page, workbenchSelectors.referenceField).textContent()) || ''

        return {
          firstPanelText,
          afterFileInsertText,
          afterTwoTokenText,
          duplicatePanelText,
          afterWorkspaceChangeText
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.firstPanelText.includes('brief.txt'), {
          name: 'mention-candidates-come-from-current-workspace',
          message:
            '@ 候选应基于当前工作区返回本地目录、文件或网页资料，对齐 WB-SCOPE-001-AC2。',
          data: result
        })

        await runtime.assertThat(
          result.afterFileInsertText.includes('brief.txt') &&
            result.afterTwoTokenText.includes('brief.txt') &&
            result.afterTwoTokenText.includes('Fixture · example.com/workbench-reference-token'),
          {
            name: 'reference-tokens-can-coexist',
            message:
              '目录、文件或网页资料插入后应以 token 保留，且多个 token 可共存，对齐 WB-SCOPE-002-AC1、WB-SCOPE-002-AC2。',
            data: result
          }
        )

        await runtime.assertThat(!result.duplicatePanelText.includes('brief.txt'), {
          name: 'inserted-reference-is-deduped-from-candidates',
          message: '同一范围不应被连续重复插入，对齐 WB-SCOPE-003-AC1。',
          data: result
        })

        await runtime.assertThat(!result.afterWorkspaceChangeText.includes('brief.txt'), {
          name: 'workspace-change-clears-old-reference-tokens',
          message:
            '切换工作区后，旧工作区的目录、文件和网页资料 token 都不应继续保留，对齐 WB-SCOPE-003-AC2。',
          data: result
        })
      }
    })
  }, WORKBENCH_LONG_E2E_TIMEOUT_MS)
})
