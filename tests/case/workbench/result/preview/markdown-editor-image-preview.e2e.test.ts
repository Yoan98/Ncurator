import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createTemporaryWorkbenchWorkspace,
  getWorkbenchLocator,
  navigateToWorkbench,
  prepareWorkbenchWorkspaceThroughUi,
  selectWorkbenchResourceMenuItem,
  selectWorkbenchWorkspace,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'markdown-editor-image-preview'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const openWorkspaceFile = async (
  page: import('playwright').Page,
  fileFilter: import('playwright').Locator,
  fileName: string
): Promise<void> => {
  if (!(await fileFilter.isVisible().catch(() => false))) {
    await getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerToggle).click()
    await fileFilter.waitFor({ state: 'visible' })
  }
  await fileFilter.fill(fileName)
  await page.getByTitle(fileName, { exact: true }).click()
  await getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerToggle).click()
  await fileFilter.waitFor({ state: 'hidden' })
}

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['preview'],
        description:
          'Markdown 相对路径本地图可显示并双击进入 ImageLightbox；失效图双击 toast 且不打开 Vditor 白底预览；磁盘源路径不被改写。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
          const mediaDir = path.join(workspace.rootPath, 'media')
          await fs.mkdir(mediaDir, { recursive: true })
          await fs.writeFile(path.join(mediaDir, 'preview-ok.png'), PNG_1X1)
          const mdPath = path.join(workspace.rootPath, 'image-preview.md')
          const mdSource = [
            '# Image Preview',
            '',
            'good image below',
            '',
            '![ok](./media/preview-ok.png)',
            '',
            'broken image below',
            '',
            '![gone](./media/missing-gone.png)',
            '',
            '![remote-gone](https://127.0.0.1:1/ncurator-missing-image.png)',
            ''
          ].join('\n')
          await fs.writeFile(mdPath, mdSource)

          const workspaceName = `Workbench ${CASE_ID}`
          await prepareWorkbenchWorkspaceThroughUi(page, {
            workspaceName,
            rootPath: workspace.rootPath
          })
          await navigateToWorkbench(page)
          await selectWorkbenchWorkspace(page, workspaceName)
          const panelToggle = getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle)
          if ((await panelToggle.getAttribute('aria-label')) === '展开右侧栏') {
            await panelToggle.click()
          }
          await selectWorkbenchResourceMenuItem(runtime, 'file')

          const fileFilter = page.getByPlaceholder('筛选文件…')
          await openWorkspaceFile(page, fileFilter, 'image-preview.md')
          const editor = getWorkbenchLocator(page, workbenchSelectors.markdownEditor)
          await editor.waitFor({ state: 'visible', timeout: 30_000 })

          const goodImage = editor.locator('img[alt="ok"]')
          await goodImage.waitFor({ state: 'attached', timeout: 30_000 })
          await page.waitForFunction(
            () => {
              const img = document.querySelector(
                '[data-testid="workbench-markdown-editor"] img[alt="ok"]'
              ) as HTMLImageElement | null
              return Boolean(img && img.complete && img.naturalWidth > 0 && img.src.startsWith('blob:'))
            },
            undefined,
            { timeout: 20_000 }
          )

          const goodImageState = await goodImage.evaluate((el) => {
            const img = el as HTMLImageElement
            return {
              naturalWidth: img.naturalWidth,
              srcIsBlob: img.src.startsWith('blob:')
            }
          })

          await goodImage.dblclick()
          const lightbox = getWorkbenchLocator(page, workbenchSelectors.attachmentPreviewModal)
          await lightbox.waitFor({ state: 'visible', timeout: 10_000 })
          const lightboxVisible = await lightbox.isVisible()
          const vditorOverlayCount = await page.locator('.vditor-img').count()
          await page.getByRole('button', { name: '关闭图片预览', exact: true }).click()
          await lightbox.waitFor({ state: 'hidden', timeout: 10_000 })

          const brokenImage = editor.locator('img[alt="remote-gone"]')
          await brokenImage.waitFor({ state: 'attached', timeout: 15_000 })
          await page.waitForFunction(
            () => {
              const img = document.querySelector(
                '[data-testid="workbench-markdown-editor"] img[alt="remote-gone"]'
              ) as HTMLImageElement | null
              return Boolean(img && img.complete && img.naturalWidth === 0)
            },
            undefined,
            { timeout: 15_000 }
          )
          await brokenImage.scrollIntoViewIfNeeded()
          await brokenImage.evaluate((el) => {
            el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
          })
          const toast = page.locator('.ant-message-notice').filter({ hasText: '图片无法加载' })
          const toastVisible = await toast
            .waitFor({ state: 'visible', timeout: 5_000 })
            .then(() => true)
            .catch(() => false)
          const lightboxAfterBroken = await lightbox.isVisible().catch(() => false)
          const vditorOverlayAfterBroken = await page.locator('.vditor-img').count()

          const diskSource = await fs.readFile(mdPath, 'utf8')
          const diskKeepsRelativePath = diskSource.includes('./media/preview-ok.png')

          return {
            goodImageNaturalWidth: goodImageState.naturalWidth,
            goodImageSrcIsBlob: goodImageState.srcIsBlob,
            lightboxVisible,
            vditorOverlayCount,
            lightboxAfterBroken,
            vditorOverlayAfterBroken,
            toastVisible,
            diskKeepsRelativePath
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.goodImageNaturalWidth > 0 &&
              result.goodImageSrcIsBlob &&
              result.lightboxVisible &&
              result.vditorOverlayCount === 0 &&
              !result.lightboxAfterBroken &&
              result.vditorOverlayAfterBroken === 0 &&
              result.toastVisible &&
              result.diskKeepsRelativePath,
            {
              name: 'workbench-markdown-editor-image-preview-real',
              message:
                '相对路径本地图应显示为 blob 并双击进入 ImageLightbox；失效图双击 toast 且不出现 Vditor 预览层；磁盘源路径保持相对路径。\n' +
                JSON.stringify(result),
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_RESULT_E2E_TIMEOUT_MS
  )
})
