import fs from 'node:fs/promises'
import path from 'node:path'
import dayjs from 'dayjs'
import { describe, it } from 'vitest'
import { settingsSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase, type E2ETestRuntime } from '../../../harness/e2e/run-e2e-case'
import { navigateToSettingsSection } from '../../../harness/e2e/settings'
import {
  createPartnerThroughWorkbenchUi,
  selectWorkbenchModel,
  selectWorkbenchExecutionPermission,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiRunCompletion,
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
} from '../../../harness/e2e/workbench'

const exists = async (file: string): Promise<boolean> =>
  fs
    .access(file)
    .then(() => true)
    .catch(() => false)
const generateCache = async (
  runtime: E2ETestRuntime,
  name: string,
  model: string,
  source?: string
): Promise<{ partnerId: string; file: string; completed: boolean }> => {
  await createPartnerThroughWorkbenchUi(runtime.page, name)
  await selectWorkbenchModel(runtime.page, model)
  await selectWorkbenchExecutionPermission(runtime.page, '完全访问')
  const partnerId = await runtime.page.evaluate(
    async (name) => (await window.api.partnerList()).find((item) => item.name === name)!.id,
    name
  )
  const file = path.join(
    runtime.userDataDir,
    'partners',
    partnerId,
    'runtime',
    'assets',
    'cleanup-case',
    'cache.txt'
  )
  const started = Date.now()
  await sendWorkbenchMessage(
    runtime.page,
    `请使用 text_file 工具创建 ${file}，内容为 cache-data。` +
      (source ? `再使用 text_file 工具将 ${source} 的全文替换为 updated formal file。` : '') +
      '请实际完成文件写入，最后只回复完成。'
  )
  const evidence = await waitForWorkbenchAiRunCompletion(runtime, started, model)
  if (!(await exists(file))) throw new Error('真实工具没有生成目标运行资源')
  return {
    partnerId,
    file,
    completed: evidence.events.some((event) => event.type === 'run_completed')
  }
}

describe('settings partner cache e2e', () => {
  it(
    'partner-cache-cleanup',
    async () => {
      await runE2ECase({
        caseId: 'partner-cache-cleanup',
        domain: 'settings',
        suite: 'general',
        description:
          '真实 AI 产生的资源和修改历史按伙伴、目录和日期清理，聊天、实际文件及其他伙伴保留。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        runMode: 'single',
        windowMode: 'visible',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: 'partner-cache-cleanup',
            createPartner: false,
            workspaceContents: 'empty'
          })
          const source = path.join(setup.workspace.rootPath, 'keep.md')
          await fs.writeFile(source, 'retain formal file')
          const first = await generateCache(runtime, '缓存清理伙伴 A', setup.env.modelName, source)
          const second = await generateCache(runtime, '缓存清理伙伴 B', setup.env.modelName)
          const sourceAfter = await fs.readFile(source, 'utf8')
          if (sourceAfter.trim() !== 'updated formal file')
            throw new Error('真实工具没有修改正式文件')
          await navigateToSettingsSection(page, 'general')
          await page.getByTestId(settingsSelectors.cacheCleanupOpen).click()
          const dialog = page.getByTestId(settingsSelectors.cacheCleanupModal)
          await dialog.waitFor({ state: 'visible' })
          await page.getByTestId(settingsSelectors.cachePartnerSelect).click()
          await page.locator('.ant-select-dropdown').getByText('全部伙伴', { exact: true }).click()
          const allPartnerOpenDisabled = await page
            .getByTestId(`${settingsSelectors.cacheOpenPrefix}-assets`)
            .isDisabled()
          await page.getByTestId(settingsSelectors.cachePartnerSelect).click()
          await page
            .locator('.ant-select-dropdown')
            .getByText('缓存清理伙伴 A', { exact: true })
            .click()
          for (const category of ['scripts', 'toolresult'])
            await page.getByTestId(`${settingsSelectors.cacheCategoryPrefix}-${category}`).click()
          const dateInput = page.getByTestId(settingsSelectors.cacheCutoffDate)
          await dateInput.fill(dayjs().format('YYYY-MM-DD'))
          await dateInput.press('Enter')
          await dialog.getByText('清理内容', { exact: true }).click()
          const clean = page.getByTestId(settingsSelectors.cacheCleanupConfirm)
          await page.waitForFunction(
            (selector) =>
              Boolean(
                (document.querySelector(`[data-testid="${selector}"]`) as HTMLButtonElement)
                  ?.disabled
              ),
            settingsSelectors.cacheCleanupConfirm
          )
          const excludesToday = await clean.isDisabled()
          await dateInput.fill(dayjs().add(1, 'day').format('YYYY-MM-DD'))
          await dateInput.press('Enter')
          await dialog.getByText('清理内容', { exact: true }).click()
          await clean.waitFor({ state: 'visible' })
          await page.waitForFunction(
            (selector) =>
              !(document.querySelector(`[data-testid="${selector}"]`) as HTMLButtonElement)
                ?.disabled,
            settingsSelectors.cacheCleanupConfirm
          )
          const previewText = await page
            .getByTestId(settingsSelectors.cachePreviewTable)
            .innerText()
          const description = await dialog.innerText()
          await page.getByTestId(`${settingsSelectors.cacheOpenPrefix}-assets`).click()
          const signals = await runtime.collectSignals()
          await clean.click()
          await page.locator('.ant-modal-confirm-btns .ant-btn-default').click()
          await page.locator('.ant-modal-confirm').waitFor({ state: 'hidden' })
          const retainedAfterCancel = await exists(first.file)
          await runtime.captureScreenshot({
            name: 'partner-cache-cleanup',
            message: '伙伴缓存管理展示目录入口、日期汇总和清理范围。'
          })
          await clean.click()
          await page.locator('.ant-modal-confirm-btns .ant-btn-dangerous').click()
          await page.locator('.ant-modal-confirm').waitFor({ state: 'hidden' })
          await page.waitForFunction(
            (selector) =>
              Boolean(
                (document.querySelector(`[data-testid="${selector}"]`) as HTMLButtonElement)
                  ?.disabled
              ),
            settingsSelectors.cacheCleanupConfirm
          )
          const opened = await page.evaluate(
            async (id) => window.api.partnerOpen({ partnerId: id, limit: 50 }),
            first.partnerId
          )
          return {
            description,
            previewText,
            excludesToday,
            retainedAfterCancel,
            removed: !(await exists(first.file)),
            otherRetained: await exists(second.file),
            sourceRetained: (await fs.readFile(source, 'utf8')) === sourceAfter,
            messagesRetained: opened.messages.length > 0,
            partnerRetained: Boolean(opened.partner),
            allPartnerOpenDisabled,
            historyDeleted:
              (
                await page.evaluate(
                  async (id) => window.api.aiFileChangeList({ partnerId: id }),
                  first.partnerId
                )
              ).items.length === 0,
            openedDirectory: signals.ipcInvokeEntries.some(
              (entry) => entry.name === 'partnerCacheOpenDirectory'
            ),
            completed: first.completed && second.completed
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.description.includes('清理伙伴的缓存数据') &&
              result.description.includes('工作目录文件等不会被删除') &&
              ['scripts', 'toolresult', 'assets', 'file-changes'].every((text) =>
                result.description.includes(text)
              ) &&
              !result.description.includes('查看修改前版本') &&
              result.previewText.includes('附件与临时资源') &&
              result.excludesToday &&
              result.allPartnerOpenDisabled &&
              result.openedDirectory,
            {
              name: 'partner-cache-ui-and-cutoff',
              message:
                '缓存入口、目录说明、打开目录及日期汇总符合 SET-GENERAL-004-AC1/AC2/AC3/AC4/AC5。',
              data: result
            }
          )
          await runtime.assertThat(
            result.retainedAfterCancel &&
              result.removed &&
              result.otherRetained &&
              result.sourceRetained &&
              result.messagesRetained &&
              result.partnerRetained &&
              result.historyDeleted &&
              result.completed,
            {
              name: 'partner-cache-cleanup-preserves-chat-and-other-partners',
              message:
                '取消不删，确认后只清理目标附件，聊天/伙伴/其他伙伴/工作目录保留，符合 SET-GENERAL-004-AC6/AC7。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
