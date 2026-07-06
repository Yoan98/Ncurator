import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getAntMessageText,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  navigateToWorkbench,
  waitForAntMessageText,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'composer-attachments-context'

const pasteImageAttachment = async (page: import('playwright').Page): Promise<void> => {
  await getWorkbenchLocator(page, workbenchSelectors.input).evaluate(async (element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error('workbench input is not an HTMLElement')
    }
    element.focus()
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas context not available')
    context.fillStyle = '#f97316'
    context.fillRect(0, 0, 64, 64)
    context.fillStyle = '#111827'
    context.font = 'bold 20px sans-serif'
    context.fillText('QA', 14, 38)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) {
          resolve(value)
          return
        }
        reject(new Error('failed to create png blob'))
      }, 'image/png')
    })
    const file = new File([blob], 'qa-image.png', { type: 'image/png' })
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer
      })
    )
  })
}

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
          '对齐附件上下文 PRD：验证输入框加号菜单、图片/文件粘贴、图片预览、文件默认打开、删除、普通文本粘贴、格式和大文件提示。',
        fixtures: ['tests/fixtures/workspace'],
        launchMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page)

          await getWorkbenchLocator(page, workbenchSelectors.attachmentAddButton).click()
          const menuItems = await page
            .locator('.ant-dropdown-menu-item')
            .evaluateAll((nodes) => nodes.map((node) => String(node.textContent || '').trim()))
          await page.keyboard.press('Escape')

          await pasteImageAttachment(page)
          await waitForAttachmentCardByName(page, 'qa-image.png')
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
          const imageCard = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.attachmentCardPrefix
          ).filter({ hasText: 'qa-image.png' })
          await runtime.captureScreenshot({
            name: 'attachment-image-card',
            message: '图片附件应显示在输入框顶部，并展示真实缩略图。'
          })

          await imageCard.first().click()
          await page.locator('.ant-modal').filter({ hasText: 'qa-image.png' }).waitFor({
            state: 'visible'
          })
          const previewVisible = await page
            .locator('.ant-modal img[alt="qa-image.png"]')
            .first()
            .isVisible()
            .catch(() => false)
          await runtime.captureScreenshot({
            name: 'attachment-image-preview',
            message: '点击图片附件后应打开图片预览弹窗。'
          })
          await page.locator('.ant-modal-close').first().click()
          await page.waitForSelector('.ant-modal', { state: 'hidden' })

          await imageCard.first().hover()
          await getWorkbenchPrefixLocator(page, workbenchSelectors.attachmentRemoveButtonPrefix)
            .first()
            .click({ force: true })
          const imageRemoved =
            (await getWorkbenchPrefixLocator(page, workbenchSelectors.attachmentCardPrefix)
              .filter({ hasText: 'qa-image.png' })
              .count()) === 0

          await pasteFileAttachment(page, {
            name: 'qa-notes.md',
            mimeType: 'text/markdown',
            text: '# QA Notes\nhello'
          })
          await waitForAttachmentCardByName(page, 'qa-notes.md')
          await getWorkbenchPrefixLocator(page, workbenchSelectors.attachmentCardPrefix)
            .filter({ hasText: 'qa-notes.md' })
            .first()
            .click()
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
            name: 'qa-large.txt',
            mimeType: 'text/plain',
            sizeBytes: 11 * 1024 * 1024
          })
          await waitForAttachmentCardByName(page, 'qa-large.txt')
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
            menuItems,
            previewVisible,
            imageRemoved,
            unsupportedMessage,
            unsupportedRejected,
            largeFileMessage,
            inputText,
            openPathCallCount: openPathCalls.length,
            latestAntMessage: await getAntMessageText(page)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.menuItems.length === 2 &&
              result.menuItems[0] === '图片' &&
              result.menuItems[1] === '文件' &&
              result.previewVisible &&
              result.imageRemoved &&
              result.unsupportedMessage.includes('暂不支持该文件格式') &&
              result.unsupportedRejected &&
              result.largeFileMessage.includes('文件过大，建议放到工作空间索引里使用') &&
              result.inputText.includes('plain paste ok') &&
              result.openPathCallCount >= 1,
            {
              name: 'workbench-composer-attachments-prd-flow',
              message:
                '附件输入应满足 PRD：加号只展示图片/文件，图片可粘贴和预览，文件可粘贴并触发默认打开，不支持格式只提示且不加入，超过 10MB 只提示不拦截，普通文本粘贴仍正常。',
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
