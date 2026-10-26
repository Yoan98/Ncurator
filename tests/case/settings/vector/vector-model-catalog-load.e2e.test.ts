import { describe, expect, it } from 'vitest'
import { LOCAL_EMBEDDING_MODEL_ID } from '../../../../src/shared/embeddingModels'
import { createWorkspaceWithFiles } from '../workspace/files/realWorkspaceHelpers'
import { importSelectors, vectorSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS,
  createRealWorkspaceWithRoot,
  waitForFileIndexJobIdle,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'

describe('settings vector e2e', () => {
  it(
    'vector-model-catalog-load',
    async () => {
      await runE2ECase({
        caseId: 'vector-model-catalog-load',
        domain: 'settings',
        suite: 'vector',
        description: '向量模型同页分类，并通过真实 UI 新增、编辑、选择远程配置与删除非当前配置。',
        fixtures: [],
        serviceMode: 'real',
        knowledge: 'cached',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime

          const rootPath = await createWorkspaceWithFiles('vector-model-catalog-load', [
            { relativePath: 'embedding-switch.txt', content: '向量模型切换后的手动索引入口测试。' }
          ])
          const created = await createRealWorkspaceWithRoot(page, {
            name: '模型切换资料',
            rootPath
          })
          await navigateToSettingsSection(page, 'workspace')
          await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
          const indexed = await waitForFileIndexJobIdle(page, created.workspace!.id)
          expect(
            indexed.tree.items
              .filter((item) => item.kind === 'file')
              .map((item) => item.index_status)
          ).toEqual(['indexed'])
          await navigateToSettingsSection(page, 'vector')
          await page.locator(`[data-testid^="${vectorSelectors.cardPrefix}-"]`).first().waitFor({
            state: 'visible'
          })
          const cardCount = await page
            .locator(`[data-testid^="${vectorSelectors.cardPrefix}-"]`)
            .count()
          const downloadButtonCount = await page
            .locator(`[data-testid^="${vectorSelectors.downloadButtonPrefix}-"]`)
            .count()
          const installedBadgeCount = await page
            .locator(`[data-testid^="${vectorSelectors.installedBadgePrefix}-"]`)
            .count()
          const catalogErrorVisible = await getSettingsLocator(page, vectorSelectors.catalogError)
            .isVisible()
            .catch(() => false)

          const localList = getSettingsLocator(page, vectorSelectors.list)
          const remoteList = getSettingsLocator(page, vectorSelectors.remoteList)
          await remoteList.waitFor({ state: 'visible' })
          expect(await localList.isVisible()).toBe(true)
          const vectorPage = getSettingsLocator(page, vectorSelectors.page)
          expect(
            await vectorPage.getByRole('heading', { name: /^(本地模型|Local models)$/ }).isVisible()
          ).toBe(true)
          expect(
            await vectorPage
              .getByRole('heading', { name: /^(远程模型|Remote models)$/ })
              .isVisible()
          ).toBe(true)
          await expect
            .poll(() => getSettingsLocator(page, vectorSelectors.remoteAddButton).isEnabled(), {
              timeout: 10_000
            })
            .toBe(true)
          const addConfigButton = getSettingsLocator(page, vectorSelectors.remoteAddButton)
          expect(await addConfigButton.innerText()).toMatch(/^(新增配置|Add configuration)$/)
          expect(await addConfigButton.locator('svg').count()).toBe(1)
          for (const name of [/^(本地模型|Local models)$/, /^(远程模型|Remote models)$/]) {
            const heading = vectorPage.getByRole('heading', { name })
            expect(
              await heading.evaluate((element) =>
                Boolean(
                  element.closest('.nc-settings-panel-toolbar')?.closest('.nc-settings-panel')
                )
              )
            ).toBe(true)
          }
          const readSnapshot = () => page.evaluate(() => window.api.embeddingModelsGet())
          const initial = await readSnapshot()
          expect(initial.index).toMatchObject({ staleFileCount: 0, staleWebCount: 0 })
          expect(initial.remoteModels).toHaveLength(0)
          const activeModel = getSettingsLocator(page, vectorSelectors.activeModel)
          const initialActiveLabel = await activeModel.innerText()
          const selectedLocalCard = getSettingsLocator(
            page,
            `${vectorSelectors.cardPrefix}-${initial.activeModelId.replace(/^local:/, '')}`
          )
          expect(
            await selectedLocalCard
              .locator(`[data-testid="${vectorSelectors.activeModel}"]`)
              .count()
          ).toBe(1)
          const installedBadge = selectedLocalCard.locator(
            `[data-testid^="${vectorSelectors.installedBadgePrefix}-"]`
          )
          const localDelete = selectedLocalCard.locator(
            `[data-testid^="${vectorSelectors.deleteButtonPrefix}-"]`
          )
          expect(await localDelete.innerText()).toMatch(/^(删除|Delete)$/)
          expect(await vectorPage.getByRole('button', { name: /更多|More/ }).count()).toBe(0)
          const nameBox = await activeModel.boundingBox()
          const installedBox = await installedBadge.boundingBox()
          const deleteBox = await localDelete.boundingBox()
          expect(installedBox!.y).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height)
          expect(deleteBox!.x).toBeGreaterThan(installedBox!.x + installedBox!.width)
          await runtime.captureScreenshot({
            name: 'vector-row-installed',
            message: '模型名称旁标记当前选择，安装状态放在辅助信息行，右侧直接显示删除。'
          })
          const originalViewport =
            page.viewportSize() ||
            (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
          try {
            await page.setViewportSize({ width: 720, height: 850 })
            await expect
              .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
              .toBe(true)
            const narrowCard = await selectedLocalCard.boundingBox()
            const narrowDelete = await localDelete.boundingBox()
            expect(narrowDelete!.x + narrowDelete!.width).toBeLessThanOrEqual(
              narrowCard!.x + narrowCard!.width
            )
            await runtime.captureScreenshot({
              name: 'vector-row-narrow',
              message: '窄窗口模型信息与直接操作完整显示，不横向溢出。'
            })
          } finally {
            await page.setViewportSize(originalViewport)
          }
          const modal = page.getByRole('dialog').filter({
            has: getSettingsLocator(page, vectorSelectors.remoteNameInput)
          })
          const apiKeyInput = getSettingsLocator(page, vectorSelectors.remoteApiKeyInput)
          const maxInputTokensInput = getSettingsLocator(
            page,
            vectorSelectors.remoteMaxInputTokensInput
          )
          const maxInputHelp = getSettingsLocator(page, vectorSelectors.remoteMaxInputTokensHelp)
          const readLengthHelp = async (): Promise<string> => {
            await maxInputHelp.hover()
            const tooltip = page.getByRole('tooltip')
            await tooltip.waitFor({ state: 'visible' })
            const text = await tooltip.innerText()
            await maxInputTokensInput.hover()
            await tooltip.waitFor({ state: 'hidden' })
            return text
          }
          const remoteCard = (id: string) =>
            getSettingsLocator(page, `${vectorSelectors.remoteCardPrefix}-${id}`)

          // 固定的保留域名与假密钥只用于配置 UI；不点击连接测试，空库选择不会发起嵌入请求。
          //
          // Reserved domains and fake keys exercise configuration UI only. Never test the
          // connection; selecting a model in the empty knowledge base sends no embedding request.
          const addRemote = async (name: string, host: string, maxInputTokens?: number) => {
            await getSettingsLocator(page, vectorSelectors.remoteAddButton).click()
            await modal.waitFor({ state: 'visible' })
            await modal.evaluate(async (element) => {
              await Promise.all(
                element
                  .getAnimations({ subtree: true })
                  .map((animation) => animation.finished.catch(() => undefined))
              )
            })
            expect(await modal.getByText(/^(新增配置|Add configuration)$/).count()).toBe(1)
            expect(await modal.locator('label span[aria-hidden="true"]').count()).toBe(4)
            expect(await modal.locator('input[aria-required="true"]').count()).toBe(4)
            expect(await modal.getByRole('button', { name: /说明|About/ }).count()).toBe(1)
            const namePlaceholder = await getSettingsLocator(
              page,
              vectorSelectors.remoteNameInput
            ).getAttribute('placeholder')
            expect(namePlaceholder).toMatch(/^(百炼向量|Knowledge base embeddings)$/)
            expect(
              await getSettingsLocator(page, vectorSelectors.remoteBaseUrlInput).getAttribute(
                'placeholder'
              )
            ).toBe('https://api.example.com/v1')
            expect(
              await getSettingsLocator(page, vectorSelectors.remoteModelNameInput).getAttribute(
                'placeholder'
              )
            ).toBe('text-embedding-v4')
            expect(await apiKeyInput.getAttribute('placeholder')).toMatch(
              /请输入 API 密钥|Enter an API key/
            )
            await runtime.captureScreenshot({
              name: 'remote-config-required-fields',
              message: '统一新增配置标题、直接示例 placeholder 和必填红星，仅长度字段保留问号。'
            })
            await getSettingsLocator(page, vectorSelectors.remoteSaveButton).click()
            expect(await modal.isVisible()).toBe(true)
            await getSettingsLocator(page, vectorSelectors.remoteNameInput).fill(name)
            await getSettingsLocator(page, vectorSelectors.remoteBaseUrlInput).fill(
              `https://${host}.invalid/v1`
            )
            await getSettingsLocator(page, vectorSelectors.remoteModelNameInput).fill(
              'catalog-test-embedding'
            )
            await apiKeyInput.fill('catalog-test-fake-key')
            expect(await modal.locator('p').count()).toBe(0)
            expect(await maxInputTokensInput.inputValue()).toBe('512')
            const lengthHelp = await readLengthHelp()
            expect(lengthHelp).toMatch(/自动分段|split automatically/)
            expect(lengthHelp).not.toMatch(/预留|正文可用|reserved|content budget|496|7987/i)
            await maxInputHelp.focus()
            const lengthTooltip = page.getByRole('tooltip')
            await lengthTooltip.waitFor({ state: 'visible' })
            await maxInputHelp.hover()
            await lengthTooltip.evaluate(async (element) => {
              const popup = element.closest('.ant-tooltip') || element
              await Promise.all(
                popup
                  .getAnimations({ subtree: true })
                  .map((animation) => animation.finished.catch(() => undefined))
              )
            })
            await runtime.captureScreenshot({
              name: 'remote-config-length-help',
              message: '问号仅解释向量化分段长度及模型上限，不展示内部计算。'
            })
            await maxInputTokensInput.hover()
            await maxInputTokensInput.focus()
            await lengthTooltip.waitFor({ state: 'hidden' })
            if (maxInputTokens !== undefined) {
              await maxInputTokensInput.fill('0')
              await getSettingsLocator(page, vectorSelectors.remoteSaveButton).click()
              expect(await modal.isVisible()).toBe(true)
              expect((await readSnapshot()).remoteModels.some((model) => model.name === name)).toBe(
                false
              )
              await maxInputTokensInput.fill(String(maxInputTokens))
              expect(await readLengthHelp()).toBe(lengthHelp)
            }
            await getSettingsLocator(page, vectorSelectors.remoteSaveButton).click()
            await modal.waitFor({ state: 'hidden' })
            const card = remoteList
              .locator(`[data-testid^="${vectorSelectors.remoteCardPrefix}-"]`)
              .filter({ hasText: name })
            await card.waitFor({ state: 'visible' })
            const testId = await card.getAttribute('data-testid')
            expect(testId).toBeTruthy()
            return testId!.slice(`${vectorSelectors.remoteCardPrefix}-`.length)
          }

          const firstId = await addRemote('Catalogue remote A', 'catalogue-remote-a', 8192)
          expect(
            (await readSnapshot()).remoteModels.find((model) => model.id === firstId)
              ?.maxInputTokens
          ).toBe(8192)
          expect((await readSnapshot()).activeModelId).toBe(initial.activeModelId)
          expect(await activeModel.innerText()).toBe(initialActiveLabel)
          expect(
            await getSettingsLocator(
              page,
              `${vectorSelectors.selectButtonPrefix}-${firstId}`
            ).isVisible()
          ).toBe(true)

          await getSettingsLocator(
            page,
            `${vectorSelectors.remoteEditButtonPrefix}-${firstId}`
          ).click()
          await modal.waitFor({ state: 'visible' })
          expect(await apiKeyInput.inputValue()).toBe('')
          expect(await apiKeyInput.getAttribute('aria-required')).toBe('false')
          expect(await apiKeyInput.getAttribute('placeholder')).toMatch(
            /留空保留原密钥|Leave blank to keep the saved key/
          )
          expect(await modal.locator('label span[aria-hidden="true"]').count()).toBe(3)
          expect(await maxInputTokensInput.inputValue()).toBe('8192')
          await maxInputTokensInput.fill('')
          expect(await maxInputTokensInput.getAttribute('placeholder')).toContain('512')
          expect(
            await getSettingsLocator(page, vectorSelectors.remoteBaseUrlInput).inputValue()
          ).toBe('https://catalogue-remote-a.invalid/v1')
          expect(
            await getSettingsLocator(page, vectorSelectors.remoteModelNameInput).inputValue()
          ).toBe('catalog-test-embedding')
          await getSettingsLocator(page, vectorSelectors.remoteNameInput).fill(
            'Catalogue remote A edited'
          )
          await getSettingsLocator(page, vectorSelectors.remoteSaveButton).click()
          await modal.waitFor({ state: 'hidden' })
          await expect
            .poll(() => remoteCard(firstId).innerText(), { timeout: 10_000 })
            .toContain('Catalogue remote A edited')
          const edited = await readSnapshot()
          const editedModel = edited.remoteModels.find((model) => model.id === firstId)
          expect(editedModel?.hasApiKey).toBe(true)
          expect(editedModel?.maxInputTokens).toBe(512)
          expect(Object.prototype.hasOwnProperty.call(editedModel, 'apiKey')).toBe(false)
          expect(edited.activeModelId).toBe(initial.activeModelId)
          expect(edited.remoteModels).toHaveLength(1)
          await getSettingsLocator(
            page,
            `${vectorSelectors.remoteEditButtonPrefix}-${firstId}`
          ).click()
          await modal.waitFor({ state: 'visible' })
          expect(await apiKeyInput.inputValue()).toBe('')
          expect(await apiKeyInput.getAttribute('aria-required')).toBe('false')
          expect(await apiKeyInput.getAttribute('placeholder')).toMatch(
            /留空保留原密钥|Leave blank to keep the saved key/
          )
          expect(await modal.locator('label span[aria-hidden="true"]').count()).toBe(3)
          expect(await maxInputTokensInput.inputValue()).toBe('512')
          expect(await getSettingsLocator(page, vectorSelectors.remoteNameInput).inputValue()).toBe(
            'Catalogue remote A edited'
          )
          await getSettingsLocator(page, vectorSelectors.remoteCancelButton).click()
          await modal.waitFor({ state: 'hidden' })

          await getSettingsLocator(page, `${vectorSelectors.selectButtonPrefix}-${firstId}`).click()
          await expect
            .poll(() => activeModel.innerText(), { timeout: 10_000 })
            .toContain('Catalogue remote A edited')
          expect((await readSnapshot()).activeModelId).toBe(firstId)
          expect(
            await getSettingsLocator(
              page,
              `${vectorSelectors.remoteDeleteButtonPrefix}-${firstId}`
            ).isDisabled()
          ).toBe(true)

          const staleNotice = getSettingsLocator(page, vectorSelectors.staleNotice)
          await staleNotice.waitFor({ state: 'visible' })
          expect(await staleNotice.innerText()).toMatch(/索引|index/i)
          expect(await vectorPage.innerText()).not.toContain(
            '切换模型后，已有索引需要由你手动更新。'
          )
          expect((await readSnapshot()).index).toMatchObject({
            staleFileCount: 1,
            staleWebCount: 0,
            running: false
          })
          await getSettingsLocator(page, vectorSelectors.goIndex).click()
          const rebuild = getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton)
          await rebuild.waitFor({ state: 'visible' })
          await expect.poll(() => rebuild.isEnabled()).toBe(true)
          expect(await rebuild.innerText()).toMatch(/重新建立索引|Rebuild index/)
          await rebuild.hover()
          await expect.poll(() => page.getByRole('tooltip').count()).toBe(0)
          await page.mouse.move(0, 0)
          expect((await readSnapshot()).index.running).toBe(false)
          await runtime.captureScreenshot({
            name: 'vector-stale-workspace-action',
            message: '失效索引展示需重建，主按钮保持可点击；导航没有启动任务。'
          })
          await navigateToSettingsSection(page, 'vector')
          await getSettingsLocator(page, vectorSelectors.restoreModel).click()
          await expect
            .poll(async () => (await readSnapshot()).activeModelId)
            .toBe(LOCAL_EMBEDDING_MODEL_ID)
          await staleNotice.waitFor({ state: 'hidden' })
          expect((await readSnapshot()).index).toMatchObject({
            staleFileCount: 0,
            staleWebCount: 0
          })
          await getSettingsLocator(page, `${vectorSelectors.selectButtonPrefix}-${firstId}`).click()
          await staleNotice.waitFor({ state: 'visible' })
          const secondId = await addRemote('Catalogue remote B', 'catalogue-remote-b')
          expect((await readSnapshot()).activeModelId).toBe(firstId)
          expect(await activeModel.innerText()).toContain('Catalogue remote A edited')
          await getSettingsLocator(
            page,
            `${vectorSelectors.selectButtonPrefix}-${secondId}`
          ).click()
          await expect
            .poll(() => activeModel.innerText(), { timeout: 10_000 })
            .toContain('Catalogue remote B')
          expect((await readSnapshot()).activeModelId).toBe(secondId)
          expect(
            await getSettingsLocator(
              page,
              `${vectorSelectors.remoteDeleteButtonPrefix}-${secondId}`
            ).isDisabled()
          ).toBe(true)
          await getSettingsLocator(
            page,
            `${vectorSelectors.remoteDeleteButtonPrefix}-${firstId}`
          ).click()
          await getSettingsLocator(
            page,
            `${vectorSelectors.remoteDeleteConfirmButtonPrefix}-${firstId}`
          ).click()
          await remoteCard(firstId).waitFor({ state: 'detached' })
          const finalSnapshot = await readSnapshot()
          expect(finalSnapshot.remoteModels.map((model) => model.id)).toEqual([secondId])
          expect(finalSnapshot.activeModelId).toBe(secondId)
          expect(finalSnapshot.index).toMatchObject({
            staleFileCount: 1,
            staleWebCount: 0,
            running: false
          })
          expect(await getSettingsLocator(page, vectorSelectors.modelError).isVisible()).toBe(false)
          await runtime.captureScreenshot({
            name: 'vector-local-and-remote-catalogue',
            message: '同页本地与远程分组；手动选择第二个远程模型后，首个非当前配置已删除。'
          })

          return {
            cardCount,
            downloadButtonCount,
            installedBadgeCount,
            catalogErrorVisible,
            remoteConfigurationFlowCompleted: true
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.cardCount > 0 &&
              result.downloadButtonCount + result.installedBadgeCount === result.cardCount &&
              !result.catalogErrorVisible,
            {
              name: 'vector-catalog-renders-real-models',
              message:
                '向量模型页应通过真实模型目录渲染模型卡片，并为每个模型展示下载或已安装状态，对齐 SET-VECTOR-001-AC1。',
              data: result
            }
          )
          await runtime.assertThat(result.remoteConfigurationFlowCompleted, {
            name: 'vector-remote-config-ui-flow',
            message:
              '本地与远程同页；新增保存不切换、编辑密钥不回显且留空保持已配置状态、显式选择后禁删当前模型，切至另一远程配置后可删除原配置。覆盖 SET-VECTOR-001-AC3、SET-VECTOR-005-AC1/AC3/AC4 与 SET-VECTOR-006-AC1 的配置 UI 部分；未验证真实远程请求。'
          })
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS * 2
  )
})
