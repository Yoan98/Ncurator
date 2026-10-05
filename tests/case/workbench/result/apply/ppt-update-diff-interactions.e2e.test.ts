import fs from 'node:fs/promises'
import path from 'node:path'
import {
  getSlides,
  getSlideText,
  loadPresentation,
  createPresentation,
  addBlankSlide,
  addSlideTextBox,
  getSlideSize,
  emu,
  setShapeTextFormat,
  setShapeText,
  getSlideShapes,
  getShapeText,
  setSlideBackground,
  savePresentation
} from 'pptx-kit'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForApplyEntry,
  waitForWorkbenchAiRunCompletion,
  waitForWorkbenchApplyRecordStatus,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'ppt-update-diff-interactions'
const FILE_NAME = 'existing-quarterly-review.pptx'
const EXTERNAL_APPLICATION_NOTICE = '如果外部应用仍显示旧内容，请关闭该文档后重新打开。'

const slideSpec = (title: string, body: string, accent: string) => ({
  type: 'insert_slide' as const,
  background: '#F7F8FA',
  elements: [
    {
      type: 'shape' as const,
      shape: 'rect' as const,
      bounds: { x: 72, y: 64, width: 20, height: 120 },
      style: { fill: accent }
    },
    {
      type: 'text' as const,
      text: title,
      bounds: { x: 112, y: 72, width: 760, height: 72 },
      style: { color: '#17324D', fontFamily: 'Microsoft YaHei', fontSize: 36, bold: true }
    },
    {
      type: 'text' as const,
      text: body,
      bounds: { x: 112, y: 180, width: 760, height: 120 },
      style: { color: '#334155', fontFamily: 'Microsoft YaHei', fontSize: 18 }
    },
    {
      type: 'line' as const,
      from: { x: 112, y: 468 },
      to: { x: 872, y: 468 },
      color: accent,
      width: 2
    }
  ]
})

const createBaselineDeck = async (workspaceRootPath: string) => {
  const presentation = createPresentation()
  const size = getSlideSize(presentation)
  const sourcePath = path.join(workspaceRootPath, FILE_NAME)
  for (const spec of [
    slideSpec('市场信号', '核心客户需求持续增加，市场窗口已经明确。', '#2563EB'),
    slideSpec('产品进展', '关键能力已经进入稳定交付阶段。', '#7C3AED'),
    slideSpec('交付质量', '本季度交付准时率保持在目标区间。', '#16A34A'),
    slideSpec('附录数据', '本页必须保持完全不变，用于验证未修改页面。', '#64748B')
  ]) {
    const slide = addBlankSlide(presentation)
    setSlideBackground(slide, 'F7F8FA')
    for (const element of spec.elements) {
      if (element.type !== 'text') continue
      const bounds = element.bounds
      const shape = addSlideTextBox(slide, {
        x: emu(Math.round((bounds.x * size.width) / 960)),
        y: emu(Math.round((bounds.y * size.height) / 540)),
        w: emu(Math.round((bounds.width * size.width) / 960)),
        h: emu(Math.round((bounds.height * size.height) / 540)),
        text: element.text
      })
      setShapeTextFormat(shape, {
        font: 'Microsoft YaHei',
        fontEastAsian: 'Microsoft YaHei',
        size: element.style.fontSize,
        color: element.style.color?.replace('#', ''),
        bold: 'bold' in element.style && element.style.bold
      })
    }
  }
  await fs.writeFile(sourcePath, await savePresentation(presentation))
}

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['apply'],
        description:
          '真实 AI 更新已有 PPT 后，验证页面增删改移动标记、左右同步缩放拖拽、筛选和文件回撤。',
        fixtures: [],
        serviceMode: 'real',
        extraEnv: {
          NCURATOR_E2E_OPEN_WITH_NOOP: '1'
        },
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID
          })
          await createBaselineDeck(setup.workspace.rootPath)
          const filePath = path.join(setup.workspace.rootPath, FILE_NAME)
          const baselineBytes = await fs.readFile(filePath)
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请直接修改工作区已有的“${FILE_NAME}”。必须先读取页面提纲，再完成这些操作：把“交付质量”页移动到第一页；把“市场信号”页标题改成“市场信号已确认”；删除“产品进展”页；在“附录数据”页之前新增一页“风险与应对”；“附录数据”页必须保持完全不变。只使用 PPT 工具，完成后用 ppt_read_slides 读取全部变化页面并检查，确认文件已经写回。`
          )
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)

          const updatedPresentation = await loadPresentation(
            new Uint8Array(await fs.readFile(filePath))
          )
          const updatedSlideTexts = getSlides(updatedPresentation).map((slide) =>
            getSlideText(slide).trim()
          )
          const updatedText = updatedSlideTexts.join('\n')
          const applyEntry = await waitForApplyEntry(page)
          await applyEntry.click()
          const viewer = getWorkbenchLocator(page, workbenchSelectors.pptDiffViewer)
          await viewer.waitFor({ state: 'visible', timeout: 30_000 })
          await getWorkbenchLocator(page, workbenchSelectors.applyOpenSystemButton).click()
          const pptxOpenWithApplication = page
            .locator(`[data-testid^="${workbenchSelectors.openWithApplicationPrefix}-"]`)
            .first()
          await pptxOpenWithApplication.waitFor({ state: 'visible', timeout: 10_000 })
          await pptxOpenWithApplication.click()
          const externalApplicationHintVisible = await page
            .getByText(EXTERNAL_APPLICATION_NOTICE, { exact: true })
            .waitFor({ state: 'visible', timeout: 10_000 })
            .then(() => true)
            .catch(() => false)
          const documentToolbar = getWorkbenchLocator(page, workbenchSelectors.documentToolbar)
          const reviewToolbarText = ((await documentToolbar.textContent()) || '').trim()
          const documentModeToggle = getWorkbenchLocator(
            page,
            workbenchSelectors.documentModeToggle
          )
          const documentModeTag = getWorkbenchLocator(page, workbenchSelectors.documentModeTag)
          const initialModeTag = ((await documentModeTag.textContent()) || '').trim()
          const beforeSurface = getWorkbenchLocator(page, workbenchSelectors.pptDiffBefore)
          const afterSurface = getWorkbenchLocator(page, workbenchSelectors.pptDiffAfter)
          const beforeVisible = await beforeSurface.isVisible()
          const afterVisible = await afterSurface.isVisible()
          const changedThumbnails = getWorkbenchLocator(
            page,
            workbenchSelectors.pptDiffThumbnails
          ).locator('button')
          const changedThumbnailCount = await changedThumbnails.count()
          const greenMarkerCount = await viewer
            .locator(
              '[aria-label="新增页"], [aria-label="内容已修改"], [aria-label="位置已移动"], [aria-label="内容已修改，位置已移动"]'
            )
            .count()
          const redMarkerCount = await viewer.locator('[aria-label="已删除"]').count()
          const inactiveThumbnailClass =
            (await changedThumbnails.nth(1).getAttribute('class')) || ''

          const beforeTransform = beforeSurface.locator(':scope > div[style*="transform"]').first()
          const afterTransform = afterSurface.locator(':scope > div[style*="transform"]').first()
          await afterSurface.hover()
          await page.mouse.wheel(0, -420)
          await page.waitForFunction(() => {
            const button = document.querySelector('[aria-label="适应窗口"]')
            return button?.textContent !== '100%'
          })
          const beforeZoomTransform = (await beforeTransform.getAttribute('style')) || ''
          const afterZoomTransform = (await afterTransform.getAttribute('style')) || ''
          const box = await afterSurface.boundingBox()
          if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
            await page.mouse.down()
            await page.mouse.move(box.x + box.width / 2 + 48, box.y + box.height / 2 + 28)
            await page.mouse.up()
          }
          const beforeDragTransform = (await beforeTransform.getAttribute('style')) || ''
          const afterDragTransform = (await afterTransform.getAttribute('style')) || ''

          await viewer.getByRole('button', { name: '查看全部页' }).click()
          const allThumbnailCount = await getWorkbenchLocator(
            page,
            workbenchSelectors.pptDiffThumbnails
          )
            .locator('button')
            .count()
          const allGreenMarkerCount = await viewer
            .locator(
              '[aria-label="新增页"], [aria-label="内容已修改"], [aria-label="位置已移动"], [aria-label="内容已修改，位置已移动"]'
            )
            .count()

          const firstShape = getSlideShapes(getSlides(updatedPresentation)[0]).find((shape) =>
            Boolean(getShapeText(shape))
          )!
          setShapeText(firstShape, 'EXTERNAL_PPT_C')
          await fs.writeFile(filePath, await savePresentation(updatedPresentation))
          await documentModeToggle.click()
          await page
            .getByTestId('ppt-preview-viewer')
            .waitFor({ state: 'visible', timeout: 30_000 })
          await page.getByTestId('ppt-preview-after').locator('img').waitFor({ state: 'visible' })
          const previewSvg = await page
            .getByTestId('ppt-preview-after')
            .locator('img')
            .evaluate(async (image) => await (await fetch(image.getAttribute('src')!)).text())
          const previewModeTag = ((await documentModeTag.textContent()) || '').trim()
          const reviewViewerHiddenInPreview = !(await viewer.isVisible().catch(() => false))
          await documentModeToggle.click()
          await viewer.waitFor({ state: 'visible', timeout: 30_000 })
          const restoredModeTag = ((await documentModeTag.textContent()) || '').trim()
          const reviewSvg = (
            await viewer
              .locator('img')
              .evaluateAll(
                async (images) =>
                  await Promise.all(
                    images.map(
                      async (image) => await (await fetch(image.getAttribute('src')!)).text()
                    )
                  )
              )
          ).join('\n')

          await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
          await page.getByText('回退这次修改？').waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
          await page.getByText('仍然回退这次修改？').waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
          await waitForWorkbenchApplyRecordStatus(page, 'reverted')
          const revertedBytes = await fs.readFile(filePath)
          const revertedPresentation = await loadPresentation(new Uint8Array(revertedBytes))
          const revertedText = getSlides(revertedPresentation)
            .map((slide) => getSlideText(slide))
            .join('\n')

          return {
            previewSvg,
            reviewSvg,
            updatedText,
            updatedSlideTexts,
            externalApplicationHintVisible,
            reviewToolbarText,
            initialModeTag,
            previewModeTag,
            restoredModeTag,
            reviewViewerHiddenInPreview,
            beforeVisible,
            afterVisible,
            changedThumbnailCount,
            allThumbnailCount,
            greenMarkerCount,
            allGreenMarkerCount,
            redMarkerCount,
            inactiveThumbnailClass,
            beforeZoomTransform,
            afterZoomTransform,
            beforeDragTransform,
            afterDragTransform,
            revertedToBaseline: revertedBytes.equals(baselineBytes),
            revertedText,
            toolNames: evidence.events
              .filter((event) => event.type === 'tool_call_started')
              .map((event) => event.toolName)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.updatedText.includes('市场信号已确认') &&
              result.updatedText.includes('风险与应对') &&
              !result.updatedText.includes('产品进展') &&
              result.updatedSlideTexts.length === 4 &&
              result.updatedSlideTexts[0]?.includes('交付质量') &&
              result.updatedSlideTexts[1]?.includes('市场信号已确认') &&
              result.updatedSlideTexts[2]?.includes('风险与应对') &&
              result.updatedSlideTexts[3]?.includes('附录数据') &&
              result.externalApplicationHintVisible &&
              result.reviewToolbarText.includes('+3') &&
              result.reviewToolbarText.includes('-1') &&
              result.initialModeTag === '审核' &&
              result.previewSvg.includes('EXTERNAL_PPT_C') &&
              !result.reviewSvg.includes('EXTERNAL_PPT_C') &&
              result.reviewSvg.includes('市场信号已确认') &&
              result.previewModeTag === '预览' &&
              result.restoredModeTag === '审核' &&
              result.reviewViewerHiddenInPreview &&
              result.beforeVisible &&
              result.afterVisible &&
              result.changedThumbnailCount === 4 &&
              result.allThumbnailCount === 5 &&
              result.greenMarkerCount === 3 &&
              result.allGreenMarkerCount === 3 &&
              result.redMarkerCount === 1 &&
              result.inactiveThumbnailClass.includes('border-transparent') &&
              result.beforeZoomTransform === result.afterZoomTransform &&
              result.beforeDragTransform === result.afterDragTransform &&
              result.beforeDragTransform !== result.beforeZoomTransform &&
              result.revertedToBaseline &&
              result.revertedText.includes('产品进展') &&
              !result.revertedText.includes('风险与应对') &&
              result.toolNames.includes('ppt_edit') &&
              result.toolNames.includes('ppt_read_slides'),
            {
              name: 'workbench-ppt-update-diff-interactions-real',
              message: '真实 AI 更新 PPT 后应正确展示页面增删改移动、同步缩放拖拽、筛选和回撤。',
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
