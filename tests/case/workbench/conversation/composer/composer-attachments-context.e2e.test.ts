import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getAntMessageText,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  pasteWorkbenchText,
  selectWorkbenchAttachmentThroughNativeDialog,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiRunCompletion,
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
  xlsxPath: string
  xlsmPath: string
  xltxPath: string
  xltmPath: string
  zipPath: string
  largePath: string
  cleanup: () => Promise<void>
}> => {
  const createdRootPath = await mkdtemp(path.join(os.tmpdir(), 'ncurator-composer-attachments-'))
  const rootPath = await realpath(createdRootPath)
  const imagePath = path.join(rootPath, 'qa-image.png')
  const markdownPath = path.join(rootPath, 'workbench-preview.md')
  const legacyDocPath = path.join(rootPath, 'legacy-reference.doc')
  const pptxPath = path.join(rootPath, 'slides-reference.pptx')
  const xlsxPath = path.join(rootPath, 'sheet-reference.xlsx')
  const xlsmPath = path.join(rootPath, 'macro-reference.xlsm')
  const xltxPath = path.join(rootPath, 'template-reference.xltx')
  const xltmPath = path.join(rootPath, 'macro-template-reference.xltm')
  const zipPath = path.join(rootPath, 'unknown-bundle.zip')
  const largePath = path.join(rootPath, 'qa-large.json')
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('Data').getCell('A1').value = 'attachment fixture'
  const workbookBytes = Buffer.from(await workbook.xlsx.writeBuffer())
  await Promise.all([
    writeFile(imagePath, ONE_PIXEL_PNG),
    writeFile(markdownPath, '# Preview\n\nAttachment markdown body.'),
    writeFile(legacyDocPath, 'legacy doc attachment fixture'),
    writeFile(pptxPath, 'pptx attachment fixture'),
    writeFile(xlsxPath, workbookBytes),
    writeFile(xlsmPath, workbookBytes),
    writeFile(xltxPath, workbookBytes),
    writeFile(xltmPath, workbookBytes),
    writeFile(zipPath, 'unknown extension attachment fixture'),
    writeFile(largePath, Buffer.alloc(11 * 1024 * 1024, 65))
  ])
  return {
    rootPath,
    imagePath,
    markdownPath,
    legacyDocPath,
    pptxPath,
    xlsxPath,
    xlsmPath,
    xltxPath,
    xltmPath,
    zipPath,
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

const countPartners = async (page: import('playwright').Page): Promise<number> =>
  await page.evaluate(async () => (await window.api.partnerList()).length)

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
          '对齐附件上下文 PRD：验证统一附件选择、任意扩展名放行（含非白名单 zip）、图片预览、文件默认打开、删除、普通文本粘贴和大文件提示。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'exclusive',
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
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceName: 'Workbench Composer Attachments Workspace'
          })
          const partnerCountBeforeAttachments = await countPartners(page)
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
          for (const spreadsheetPath of [
            attachments.xlsxPath,
            attachments.xlsmPath,
            attachments.xltxPath,
            attachments.xltmPath
          ]) {
            await selectWorkbenchAttachmentThroughNativeDialog(page, spreadsheetPath)
            await waitForAttachmentCardByName(page, path.basename(spreadsheetPath))
          }
          await selectWorkbenchAttachmentThroughNativeDialog(page, attachments.zipPath)
          await waitForAttachmentCardByName(page, 'unknown-bundle.zip')
          const droppedFileData = (await readFile(attachments.markdownPath)).toString('base64')
          await page.evaluate(
            ({ targetTestId, fileData }) => {
              const target = document.querySelector<HTMLElement>(
                `[data-testid="${targetTestId}"]`
              )
              if (!target) throw new Error('attachment drop target unavailable')
              const bytes = Uint8Array.from(atob(fileData), (character) => character.charCodeAt(0))
              const file = new File([bytes], 'dropped-context.md', { type: 'text/markdown' })
              const transfer = new DataTransfer()
              transfer.items.add(file)
              target.dispatchEvent(
                new DragEvent('dragenter', {
                  bubbles: true,
                  cancelable: true,
                  dataTransfer: transfer
                })
              )
            },
            { targetTestId: workbenchSelectors.attachmentDropTarget, fileData: droppedFileData }
          )
          const attachmentDropOverlay = getWorkbenchLocator(
            page,
            workbenchSelectors.attachmentDropOverlay
          )
          await attachmentDropOverlay.waitFor({ state: 'visible' })
          const attachmentDropOverlayVisible = await attachmentDropOverlay.isVisible()
          await page.evaluate(
            ({ targetTestId, fileData }) => {
              const target = document.querySelector<HTMLElement>(
                `[data-testid="${targetTestId}"]`
              )
              if (!target) throw new Error('attachment drop target unavailable')
              const bytes = Uint8Array.from(atob(fileData), (character) => character.charCodeAt(0))
              const file = new File([bytes], 'dropped-context.md', { type: 'text/markdown' })
              const transfer = new DataTransfer()
              transfer.items.add(file)
              target.dispatchEvent(
                new DragEvent('drop', {
                  bubbles: true,
                  cancelable: true,
                  dataTransfer: transfer
                })
              )
            },
            { targetTestId: workbenchSelectors.attachmentDropTarget, fileData: droppedFileData }
          )
          await attachmentDropOverlay.waitFor({ state: 'hidden' })
          const attachmentDropOverlayHidden = (await attachmentDropOverlay.count()) === 0
          const partnerCountAfterAttachments = await countPartners(page)
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
          await selectWorkbenchAttachmentThroughNativeDialog(page, attachments.imagePath)
          await getImageAttachmentCardByName(page, 'qa-image.png')
            .first()
            .waitFor({ state: 'visible' })

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
          const spreadsheetCardTexts = await Promise.all(
            [
              'sheet-reference.xlsx',
              'macro-reference.xlsm',
              'template-reference.xltx',
              'macro-template-reference.xltm'
            ].map(
              async (fileName) =>
                (await getWorkbenchPrefixLocator(page, workbenchSelectors.attachmentCardPrefix)
                  .filter({ hasText: fileName })
                  .first()
                  .textContent()) || ''
            )
          )
          const zipCardText =
            (await getWorkbenchPrefixLocator(page, workbenchSelectors.attachmentCardPrefix)
              .filter({ hasText: 'unknown-bundle.zip' })
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

          const submitStartedAtMs = Date.now()
          await sendWorkbenchMessage(page, '请只确认已经收到这些附件，不要修改任何文件。')
          await waitForWorkbenchAiRunCompletion(
            runtime,
            submitStartedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page }
          )
          const submittedMessages = await page.evaluate(async () => {
            const partners = [...(await window.api.partnerList())].sort(
              (left, right) => right.last_viewed_at - left.last_viewed_at
            )
            return partners[0] ? await window.api.partnerMessageList(partners[0].id) : []
          })
          const submittedUserMessage = [...submittedMessages]
            .reverse()
            .find((message) => message.role === 'user')
          const submittedAttachments = submittedUserMessage?.attachments || []
          const persistedMessagesJson = JSON.stringify(submittedMessages)

          const signals = await runtime.collectSignals()
          const openPathCalls = signals.ipcInvokeEntries.filter(
            (entry) => entry.name === 'openPath'
          )

          return {
            partnerCountBeforeAttachments,
            partnerCountAfterAttachments,
            previewVisible,
            attachmentDropOverlayVisible,
            attachmentDropOverlayHidden,
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
            spreadsheetCardTexts,
            zipCardText,
            submittedAttachmentNames: submittedAttachments.map((attachment) => attachment.name),
            submittedAttachmentPaths: submittedAttachments.map((attachment) => attachment.path),
            persistedMessagesContainBase64: persistedMessagesJson.includes(';base64,'),
            largeFileMessage,
            inputText,
            openPathCallCount: openPathCalls.length,
            attachmentPickCallCount: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'attachmentPick'
            ).length,
            attachmentSaveFileCallCount: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'attachmentSaveFile'
            ).length,
            latestAntMessage: await getAntMessageText(page)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.previewVisible &&
              result.attachmentDropOverlayVisible &&
              result.attachmentDropOverlayHidden &&
              result.imageRemoved &&
              result.downloadButtonVisible &&
              result.closeButtonVisible &&
              result.partnerCountAfterAttachments === result.partnerCountBeforeAttachments &&
              result.attachmentPickCallCount >= 2 &&
              result.zoomControlBelowImage &&
              result.topActionsAboveImage &&
              result.fileCardText.includes('MD') &&
              result.legacyDocCardText.includes('DOC') &&
              result.pptxCardText.includes('PPTX') &&
              ['XLSX', 'XLSM', 'XLTX', 'XLTM'].every((label, index) =>
                result.spreadsheetCardTexts[index]?.includes(label)
              ) &&
              result.zipCardText.includes('ZIP') &&
              [
                'workbench-preview.md',
                'qa-image.png',
                'legacy-reference.doc',
                'slides-reference.pptx',
                'sheet-reference.xlsx',
                'macro-reference.xlsm',
                'template-reference.xltx',
                'macro-template-reference.xltm',
                'unknown-bundle.zip',
                'qa-large.json'
              ].every((name) => result.submittedAttachmentNames.includes(name)) &&
              result.submittedAttachmentPaths.length === 10 &&
              result.submittedAttachmentPaths.every((attachmentPath) => {
                const normalized = attachmentPath.replace(/\\/g, '/')
                const isSourceFixture = normalized.includes('/ncurator-composer-attachments-')
                const isPartnerRuntimeAsset =
                  /\/partners\/[^/]+\/runtime\/assets\//u.test(normalized)
                return (
                  (isSourceFixture || isPartnerRuntimeAsset) &&
                  !normalized.includes('/.ncurator/')
                )
              }) &&
              !result.persistedMessagesContainBase64 &&
              result.largeFileMessage.includes('文件过大，建议放到工作空间索引里使用') &&
              result.inputText.includes('plain paste ok') &&
              result.openPathCallCount >= 1 &&
              result.attachmentSaveFileCallCount === 0,
            {
              name: 'workbench-composer-attachments-prd-flow',
              message:
                '附件输入应满足 PRD：拖放覆盖层可用；+/拖放保留源绝对路径，粘贴才写入 userData/partners/{id}/runtime/assets；任意扩展名可添加并显示类型；不新建伙伴；图片可预览；超过 10MB 只提示；普通文本粘贴仍正常，对齐 WB-COMPOSER-010。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
