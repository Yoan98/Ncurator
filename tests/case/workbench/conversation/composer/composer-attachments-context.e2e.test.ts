import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { setSettingsE2EApiOverrides } from '../../../../harness/e2e/settings'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getAntMessageText,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  navigateToWorkbench,
  selectWorkbenchWorkspace,
  setupWorkbenchWorkspaceOnly,
  waitForAntMessageText,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'composer-attachments-context'

const pasteFileAttachment = async (
  page: import('playwright').Page,
  input: {
    name: string
    mimeType: string
    text?: string
    sizeBytes?: number
  }
): Promise<void> => {
  await getWorkbenchLocator(page, workbenchSelectors.input).evaluate((element, payload) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error('workbench input is not an HTMLElement')
    }
    element.focus()
    const content = payload.sizeBytes
      ? new Uint8Array(payload.sizeBytes).fill(65)
      : payload.text || ''
    const file = new File([content], payload.name, { type: payload.mimeType })
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer
      })
    )
  }, input)
}

const pastePlainText = async (page: import('playwright').Page, text: string): Promise<void> => {
  await getWorkbenchLocator(page, workbenchSelectors.input).evaluate((element, value) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error('workbench input is not an HTMLElement')
    }
    element.focus()
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/plain', value)
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer
      })
    )
  }, text)
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

const resolveLatestSessionId = async (
  page: import('playwright').Page,
  workspaceId: string
): Promise<string> => {
  const deadline = Date.now() + 10000
  for (;;) {
    const sessionId = await page.evaluate(async (input) => {
      const sessions = await window.api.chatSessionList()
      return sessions.find((item) => item.workspace_id === input.workspaceId)?.id || null
    }, { workspaceId })
    if (sessionId) return sessionId
    if (Date.now() >= deadline) {
      throw new Error('attachment draft session unavailable')
    }
    await page.waitForTimeout(200)
  }
}

const createSessionBackedAttachments = async (
  page: import('playwright').Page,
  input: {
    sessionId: string
    workspaceRootPath: string
  }
): Promise<{
  sessionId: string
  imageAttachment: import('../../../../../../src/shared/types').ChatAttachment
  fileAttachment: import('../../../../../../src/shared/types').ChatAttachment
}> =>
  await page.evaluate(async ({ sessionId, workspaceRootPath }) => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('canvas context not available')
    }
    context.fillStyle = '#2563EB'
    context.fillRect(0, 0, 64, 64)
    context.fillStyle = '#FFFFFF'
    context.font = 'bold 22px sans-serif'
    context.fillText('QA', 12, 40)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) {
          resolve(value)
          return
        }
        reject(new Error('failed to create png blob'))
      }, 'image/png')
    })

    const imageSaved = await window.api.attachmentSaveFile({
      workspaceRootPath,
      sessionId,
      name: 'qa-image.png',
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mimeType: 'image/png',
      kind: 'image'
    })
    if (!imageSaved.attachment) {
      throw new Error(imageSaved.error || 'failed to save image attachment')
    }

    const fileSaved = await window.api.attachmentSaveFile({
      workspaceRootPath,
      sessionId,
      name: 'workbench-preview.md',
      bytes: new TextEncoder().encode('# Preview\n\nAttachment markdown body.'),
      mimeType: 'text/markdown',
      kind: 'file'
    })
    if (!fileSaved.attachment) {
      throw new Error(fileSaved.error || 'failed to save markdown attachment')
    }

    return {
      sessionId,
      imageAttachment: imageSaved.attachment,
      fileAttachment: fileSaved.attachment
    }
  }, input)

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
          '对齐附件上下文 PRD：验证统一附件选择、图片预览、文件默认打开、删除、普通文本粘贴、格式和大文件提示。',
        fixtures: ['tests/fixtures/workspace'],
        launchMode: 'fixture',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWorkspaceOnly(page, {
            caseId: CASE_ID,
            workspaceName: 'Workbench Composer Attachments Workspace'
          })
          try {
            const workspaceBinding = await resolveWorkspaceBinding(page)
            await navigateToWorkbench(page)
            await selectWorkbenchWorkspace(page, setup.workspaceName)
            await setSettingsE2EApiOverrides(page, {
              attachmentPickResponse: {
                canceled: true,
                items: []
              }
            })
            await getWorkbenchLocator(page, workbenchSelectors.attachmentAddButton).click()
            const sessionId = await resolveLatestSessionId(page, workspaceBinding.workspaceId)
            const created = await createSessionBackedAttachments(page, {
              sessionId,
              workspaceRootPath: workspaceBinding.workspaceRootPath
            })
            await setSettingsE2EApiOverrides(page, {
              attachmentPickResponse: {
                canceled: false,
                items: [created.imageAttachment, created.fileAttachment]
              }
            })
            await getWorkbenchLocator(page, workbenchSelectors.attachmentAddButton).click()
            const imageCard = getImageAttachmentCardByName(page, 'qa-image.png')
            await imageCard.first().waitFor({ state: 'visible' })
            await page.waitForFunction(
              (attachmentName) => {
                const image = Array.from(document.images).find((item) => item.alt === attachmentName)
                return Boolean(
                  image &&
                    image.complete &&
                    image.naturalWidth === 64 &&
                    image.src.startsWith('blob:')
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
            const previewImageBox = await previewModal.locator('img[alt="qa-image.png"]').boundingBox()
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

            await imageCard.first().hover()
            await getWorkbenchPrefixLocator(page, workbenchSelectors.attachmentRemoveButtonPrefix)
              .first()
              .click({ force: true })
            const imageRemoved =
              (await getImageAttachmentCardByName(page, 'qa-image.png').count()) === 0

            const fileCard = getWorkbenchPrefixLocator(page, workbenchSelectors.attachmentCardPrefix)
              .filter({ hasText: 'workbench-preview.md' })
              .first()
            await fileCard.waitFor({ state: 'visible' })
            const fileCardText = (await fileCard.textContent()) || ''
            await fileCard.click()
            await page.waitForTimeout(500)

            await pasteFileAttachment(page, {
              name: 'qa-bad.exe',
              mimeType: 'application/octet-stream',
              text: 'bad'
            })
            const unsupportedMessage = await waitForAntMessageText(page, '暂不支持该文件格式')
            const unsupportedRejected =
              (await getWorkbenchPrefixLocator(page, workbenchSelectors.attachmentCardPrefix)
                .filter({ hasText: 'qa-bad.exe' })
                .count()) === 0

            await pasteFileAttachment(page, {
              name: 'qa-large.json',
              mimeType: 'application/json',
              sizeBytes: 11 * 1024 * 1024
            })
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

            const signals = await runtime.collectSignals()
            const openPathCalls = signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'openPath'
            )

            return {
              sessionId: created.sessionId,
              imageAttachmentPath: created.imageAttachment.path,
              fileAttachmentPath: created.fileAttachment.path,
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
              unsupportedMessage,
              unsupportedRejected,
              largeFileMessage,
              inputText,
              openPathCallCount: openPathCalls.length,
              latestAntMessage: await getAntMessageText(page)
            }
          } finally {
            await setup.workspace.cleanup()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.previewVisible &&
              result.imageRemoved &&
              result.downloadButtonVisible &&
              result.closeButtonVisible &&
              result.imageAttachmentPath.includes(`/.ncurator/assets/${result.sessionId}/`) &&
              result.fileAttachmentPath.includes(`/.ncurator/assets/${result.sessionId}/`) &&
              result.zoomControlBelowImage &&
              result.topActionsAboveImage &&
              result.fileCardText.includes('MD') &&
              result.unsupportedMessage.includes('暂不支持该文件格式') &&
              result.unsupportedRejected &&
              result.largeFileMessage.includes('文件过大，建议放到工作空间索引里使用') &&
              result.inputText.includes('plain paste ok') &&
              result.openPathCallCount >= 1,
            {
              name: 'workbench-composer-attachments-prd-flow',
              message:
                '附件输入应满足 PRD：附件保存到工作区 .ncurator/assets/<sessionId>/，图片可预览且控件不压图，文件副标题显示扩展名，文件可默认打开，不支持格式只提示且不加入，超过 10MB 只提示不拦截，普通文本粘贴仍正常。',
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
