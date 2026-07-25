import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getAntMessageText,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  navigateToWorkbench,
  pasteWorkbenchText,
  selectWorkbenchAttachmentThroughNativeDialog,
  selectWorkbenchWorkspace,
  setupWorkbenchWorkspaceOnly,
  waitForAntMessageText,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'composer-attachments-context'
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
  'base64'
)

const createAttachmentFixtures = async (): Promise<{
  rootPath: string
  imagePath: string
  markdownPath: string
  legacyDocPath: string
  pptxPath: string
  largePath: string
  cleanup: () => Promise<void>
}> => {
  const createdRootPath = await mkdtemp(path.join(os.tmpdir(), 'ncurator-composer-attachments-'))
  const rootPath = await realpath(createdRootPath)
  const imagePath = path.join(rootPath, 'qa-image.png')
  const markdownPath = path.join(rootPath, 'workbench-preview.md')
  const legacyDocPath = path.join(rootPath, 'legacy-reference.doc')
  const pptxPath = path.join(rootPath, 'slides-reference.pptx')
  const largePath = path.join(rootPath, 'qa-large.json')
  await Promise.all([
    writeFile(imagePath, ONE_PIXEL_PNG),
    writeFile(markdownPath, '# Preview\n\nAttachment markdown body.'),
    writeFile(legacyDocPath, 'legacy doc attachment fixture'),
    writeFile(pptxPath, 'pptx attachment fixture'),
    writeFile(largePath, Buffer.alloc(11 * 1024 * 1024, 65))
  ])
  return {
    rootPath,
    imagePath,
    markdownPath,
    legacyDocPath,
    pptxPath,
    largePath,
    cleanup: async () => {
      await rm(rootPath, { recursive: true, force: true })
    }
  }
}

const pastePlainText = async (page: import('playwright').Page, text: string): Promise<void> => {
  await getWorkbenchLocator(page, workbenchSelectors.input).click()
  await pasteWorkbenchText(page, text)
}

const waitForAttachmentCardByName = async (
  page: import('playwright').Page,
  name: string
): Promise<void> => {
  await getWorkbenchPrefixLocator(page, workbenchSelectors.attachmentCardPrefix)
    .filter({ hasText: name })
    .first()
    .waitFor({ state: 'visible' })
}

const getImageAttachmentCardByName = (page: import('playwright').Page, name: string) =>
  page.locator(`[data-testid^="${workbenchSelectors.attachmentCardPrefix}-"][title="${name}"]`)

const resolveWorkspaceBinding = async (
  page: import('playwright').Page
): Promise<{
  workspaceId: string
  workspaceRootPath: string
}> =>
  await page.evaluate(async (workspaceName) => {
    const workspaces = await window.api.workspaceList()
    const workspace = workspaces.items.find((item) => item.name === workspaceName)
    if (!workspace?.id || !workspace.root_path) {
      throw new Error('workspace root path unavailable')
    }
    return {
      workspaceId: workspace.id,
      workspaceRootPath: workspace.root_path
    }
  }, 'Workbench Composer Attachments Workspace')

const countWorkspaceSessions = async (
  page: import('playwright').Page,
  workspaceId: string
): Promise<number> =>
  await page.evaluate(
    async (input) => {
      const sessions = await window.api.chatSessionList()
      return sessions.filter((item) => item.workspace_id === input.workspaceId).length
    },
    { workspaceId }
  )

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer'],
        description:
          '对齐附件上下文 PRD：验证统一附件选择、doc/pptx 格式放行、图片预览、文件默认打开、删除、普通文本粘贴和大文件提示。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const attachments = await createAttachmentFixtures()
          runtime.registerResource({
            name: `composer-attachments:${attachments.rootPath}`,
            phase: 'after-app-close',
            dispose: attachments.cleanup
          })
          await navigateToWorkbench(page)
          await getWorkbenchLocator(page, workbenchSelectors.attachmentAddButton).click()
          const missingWorkspaceMessage = await waitForAntMessageText(
            page,
            '请先选择工作区后再添加附件'
          )
          const attachmentCountWithoutWorkspace = await getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.attachmentCardPrefix
          ).count()
          const setup = await setupWorkbenchWorkspaceOnly(page, {
            caseId: CASE_ID,
            workspaceName: 'Workbench Composer Attachments Workspace'
          })
          const workspaceBinding = await resolveWorkspaceBinding(page)
          await navigateToWorkbench(page)
          await selectWorkbenchWorkspace(page, setup.workspaceName)
          const sessionCountBeforePaste = await countWorkspaceSessions(
            page,
            workspaceBinding.workspaceId
          )
          await selectWorkbenchAttachmentThroughNativeDialog(page, attachments.imagePath)
          await getImageAttachmentCardByName(page, 'qa-image.png')
            .first()
            .waitFor({ state: 'visible' })
          await selectWorkbenchAttachmentThroughNativeDialog(page, attachments.markdownPath)
          await waitForAttachmentCardByName(page, 'workbench-preview.md')
          await selectWorkbenchAttachmentThroughNativeDialog(page, attachments.legacyDocPath)
          await waitForAttachmentCardByName(page, 'legacy-reference.doc')
          await selectWorkbenchAttachmentThroughNativeDialog(page, attachments.pptxPath)
          await waitForAttachmentCardByName(page, 'slides-reference.pptx')
          const sessionCountAfterPaste = await countWorkspaceSessions(
            page,
            workspaceBinding.workspaceId
          )
          const imageCard = getImageAttachmentCardByName(page, 'qa-image.png')
          await imageCard.first().waitFor({ state: 'visible' })
          await page.waitForFunction(
            (attachmentName) => {
              const image = Array.from(document.images).find((item) => item.alt === attachmentName)
              return Boolean(
                image && image.complete && image.naturalWidth > 0 && image.src.startsWith('blob:')
              )
            },
            'qa-image.png',
            { timeout: 5000 }
          )
          await runtime.captureScreenshot({
            name: 'attachment-image-card',
            message: '图片附件应显示在输入框顶部，并展示真实缩略图。'
          })

          await imageCard.first().click()
          const previewModal = getWorkbenchLocator(page, workbenchSelectors.attachmentPreviewModal)
          await previewModal.waitFor({ state: 'visible' })
          await page.waitForFunction(
            ({ modalTestId, attachmentName }) => {
              const image = document.querySelector<HTMLImageElement>(
                `[data-testid="${modalTestId}"] img[alt="${attachmentName}"]`
              )
              if (!image || !image.complete || image.naturalWidth <= 0) return false
              const rect = image.getBoundingClientRect()
              return rect.width > 0 && rect.height > 0
            },
            {
              modalTestId: workbenchSelectors.attachmentPreviewModal,
              attachmentName: 'qa-image.png'
            },
            { timeout: 5000 }
          )
          const downloadButton = page.getByRole('button', { name: '下载图片', exact: true })
          const closeButton = page.getByRole('button', { name: '关闭图片预览', exact: true })
          const zoomButton = page.getByRole('button', { name: '放大', exact: true })
          const previewImageBox = await previewModal
            .locator('img[alt="qa-image.png"]')
            .boundingBox()
          const downloadButtonBox = await downloadButton.boundingBox()
          const closeButtonBox = await closeButton.boundingBox()
          const zoomButtonBox = await zoomButton.boundingBox()
          const previewVisible = true
          await runtime.captureScreenshot({
            name: 'attachment-image-preview',
            message: '点击图片附件后应打开图片预览弹窗。'
          })
          await closeButton.click()
          await previewModal.waitFor({ state: 'hidden' })

          const imageAttachmentCard = imageCard.first()
          await imageAttachmentCard.hover()
          const imageRemoveButton = imageAttachmentCard.locator(
            `[data-testid^="${workbenchSelectors.attachmentRemoveButtonPrefix}-"]`
          )
          await imageRemoveButton.waitFor({ state: 'visible' })
          await imageRemoveButton.click()
          const imageRemoved =
            (await getImageAttachmentCardByName(page, 'qa-image.png').count()) === 0

          const fileCard = getWorkbenchPrefixLocator(page, workbenchSelectors.attachmentCardPrefix)
            .filter({ hasText: 'workbench-preview.md' })
            .first()
          await fileCard.waitFor({ state: 'visible' })
          const fileCardText = (await fileCard.textContent()) || ''
          const legacyDocCardText =
            (await getWorkbenchPrefixLocator(page, workbenchSelectors.attachmentCardPrefix)
              .filter({ hasText: 'legacy-reference.doc' })
              .first()
              .textContent()) || ''
          const pptxCardText =
            (await getWorkbenchPrefixLocator(page, workbenchSelectors.attachmentCardPrefix)
              .filter({ hasText: 'slides-reference.pptx' })
              .first()
              .textContent()) || ''

          await selectWorkbenchAttachmentThroughNativeDialog(page, attachments.largePath)
          await waitForAttachmentCardByName(page, 'qa-large.json')
          const largeFileMessage = await waitForAntMessageText(
            page,
            '文件过大，建议放到工作空间索引里使用'
          )

          await pastePlainText(page, 'plain paste ok')
          const inputText = (
            (await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || ''
          ).trim()
          await runtime.captureScreenshot({
            name: 'attachment-final-state',
            message: '文件附件、大文件提示和普通文本粘贴后的最终输入框状态。'
          })
          await fileCard.click()
          await page.waitForTimeout(500)

          const signals = await runtime.collectSignals()
          const openPathCalls = signals.ipcInvokeEntries.filter(
            (entry) => entry.name === 'openPath'
          )

          return {
            missingWorkspaceMessage,
            attachmentCountWithoutWorkspace,
            sessionCountBeforePaste,
            sessionCountAfterPaste,
            previewVisible,
            imageRemoved,
            downloadButtonVisible: Boolean(downloadButtonBox),
            closeButtonVisible: Boolean(closeButtonBox),
            zoomControlBelowImage: Boolean(
              previewImageBox &&
              zoomButtonBox &&
              zoomButtonBox.y >= previewImageBox.y + previewImageBox.height
            ),
            topActionsAboveImage: Boolean(
              previewImageBox &&
              downloadButtonBox &&
              closeButtonBox &&
              downloadButtonBox.y + downloadButtonBox.height <= previewImageBox.y &&
              closeButtonBox.y + closeButtonBox.height <= previewImageBox.y
            ),
            fileCardText,
            legacyDocCardText,
            pptxCardText,
            largeFileMessage,
            inputText,
            openPathCallCount: openPathCalls.length,
            attachmentPickCallCount: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'attachmentPick'
            ).length,
            latestAntMessage: await getAntMessageText(page)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.missingWorkspaceMessage.includes('请先选择工作区后再添加附件') &&
              result.attachmentCountWithoutWorkspace === 0 &&
              result.previewVisible &&
              result.imageRemoved &&
              result.downloadButtonVisible &&
              result.closeButtonVisible &&
              result.sessionCountAfterPaste === result.sessionCountBeforePaste &&
              result.attachmentPickCallCount >= 2 &&
              result.zoomControlBelowImage &&
              result.topActionsAboveImage &&
              result.fileCardText.includes('MD') &&
              result.legacyDocCardText.includes('DOC') &&
              result.pptxCardText.includes('PPTX') &&
              result.largeFileMessage.includes('文件过大，建议放到工作空间索引里使用') &&
              result.inputText.includes('plain paste ok') &&
              result.openPathCallCount >= 1,
            {
              name: 'workbench-composer-attachments-prd-flow',
              message:
                '附件输入应满足 PRD：真实选择附件会走系统选择和附件导入，doc/pptx 可以添加并显示正确类型，添加附件不创建新会话，图片可预览且控件不压图，文件可默认打开，超过 10MB 只提示不拦截，普通文本粘贴仍正常。',
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
