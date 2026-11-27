import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  setupWorkbenchWithTempWorkspace,
  openWorkbenchWorkspaceFile,
  workbenchSelectors,
  waitForWorkbenchAiRunCompletion,
  recordWorkbenchAiEvidence,
  collectWorkbenchLlmIoRecords,
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'video-feedback-workbench'
describe('video feedback workbench', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['preview'],
        description: '真实播放器、缩略图、可调整标注与截图意见发送恢复。',
        fixtures: ['tests/fixtures/workspace/media'],
        knowledge: 'none',
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceContents: 'empty',
            prepareWorkspace: async (root) =>
              fs.copyFile(
                path.resolve('tests/fixtures/workspace/media/source-a.mp4'),
                path.join(root, 'source-a.mp4')
              )
          })
          await openWorkbenchWorkspaceFile(runtime, 'source-a.mp4')
          if (await page.getByPlaceholder('筛选文件…').isVisible())
            await page.getByTestId(workbenchSelectors.workspaceExplorerToggle).click()
          await page
            .getByTestId('workbench-video-preview')
            .locator('[data-video-state="ready"]')
            .waitFor({ timeout: 30000 })
          await page
            .getByTestId('workbench-video-preview')
            .getByRole('button', { name: '编辑', exact: true })
            .click()
          const editor = page.getByTestId('video-workbench'),
            stage = editor.locator('.nc-video-stage')
          await editor.locator('video').waitFor()
          const frameOpinion = editor.getByRole('textbox', { name: '画面文字意见', exact: true })
          await frameOpinion.fill('开头文字说明。')
          await editor
            .locator('.nc-video-text-opinion')
            .getByRole('button', { name: '加入输入框', exact: true })
            .click()
          const initialComposer = page.getByTestId(workbenchSelectors.input)
          await initialComposer.locator('[data-role="video-feedback-token"]').waitFor()
          await initialComposer.fill('')
          await frameOpinion.fill('')
          await expect
            .poll(
              () =>
                editor
                  .locator('.nc-video-filmstrip img')
                  .evaluateAll(
                    (images) =>
                      images.filter(
                        (image) =>
                          (image as HTMLImageElement).complete &&
                          (image as HTMLImageElement).naturalWidth > 0
                      ).length
                  ),
              { timeout: 30000 }
            )
            .toBe(12)
          await editor.getByRole('button', { name: '下一帧', exact: true }).click()
          const stepped = await editor
            .locator('video')
            .evaluate((video: HTMLVideoElement) => video.currentTime)
          await editor.getByLabel('播放速度').selectOption('1.5')
          await editor.getByRole('button', { name: '播放', exact: true }).click()
          await page.waitForFunction(
            () =>
              document.querySelector<HTMLVideoElement>('[data-testid="video-workbench"] video')!
                .currentTime > 0.3
          )
          await editor.getByRole('button', { name: '暂停', exact: true }).click()
          await editor.getByRole('button', { name: '框选', exact: true }).click()
          const bounds = (await stage.boundingBox())!
          await page.mouse.move(bounds.x + bounds.width * 0.18, bounds.y + bounds.height * 0.24)
          await page.mouse.down()
          await page.mouse.move(bounds.x + bounds.width * 0.48, bounds.y + bounds.height * 0.63, {
            steps: 8
          })
          await page.mouse.up()
          const first = editor.getByRole('textbox', { name: '修改意见 1', exact: true })
          await first.waitFor()
          const empty = (await editor.locator('.empty-opinion').count()) === 1
          await first.fill('这个区域稍微提亮。')
          const filled = (await editor.locator('.has-opinion').count()) === 1
          await editor
            .locator('.nc-video-opinion-popover')
            .getByRole('button', { name: '加入输入框', exact: true })
            .click()
          await page
            .getByTestId(workbenchSelectors.input)
            .locator('[data-role="video-feedback-token"] img')
            .waitFor()
          await first.fill('这个区域稍微提亮，颜色保持。')
          await editor.getByRole('button', { name: '意见 1', exact: true }).click()
          await first.waitFor({ state: 'hidden' })
          const rectangle = editor.locator('.nc-video-marks rect').first(),
            beforeX = Number(await rectangle.getAttribute('x'))
          const box = (await rectangle.boundingBox())!
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
          await page.mouse.down()
          await page.mouse.move(box.x + box.width / 2 + 18, box.y + box.height / 2 + 6, {
            steps: 6
          })
          await page.mouse.up()
          const moved = Number(await rectangle.getAttribute('x')) > beforeX
          const oldWidth = Number(await rectangle.getAttribute('width')),
            handle = (await editor.locator('.nc-video-handle').nth(1).boundingBox())!
          await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
          await page.mouse.down()
          await page.mouse.move(handle.x + 12, handle.y - 8, { steps: 5 })
          await page.mouse.up()
          const resized = Number(await rectangle.getAttribute('width')) > oldWidth
          await editor.getByRole('button', { name: '意见 1', exact: true }).click()
          await editor.getByRole('button', { name: '箭头', exact: true }).click()
          await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.18)
          await page.mouse.down()
          await page.mouse.move(bounds.x + bounds.width * 0.79, bounds.y + bounds.height * 0.63, {
            steps: 8
          })
          await page.mouse.up()
          await editor
            .getByRole('textbox', { name: '修改意见 2', exact: true })
            .fill('这个方向保持不变。')
          const arrowEnd = editor.locator('.nc-video-handle').last(),
            arrowLine = editor.locator('line[marker-end]').last(),
            oldEnd = Number(await arrowLine.getAttribute('x2')),
            endBounds = (await arrowEnd.boundingBox())!
          await page.mouse.move(
            endBounds.x + endBounds.width / 2,
            endBounds.y + endBounds.height / 2
          )
          await page.mouse.down()
          await page.mouse.move(endBounds.x + 14, endBounds.y - 6, { steps: 5 })
          await page.mouse.up()
          const arrowAdjusted = Number(await arrowLine.getAttribute('x2')) > oldEnd
          await editor
            .locator('.nc-video-opinion-popover')
            .getByRole('button', { name: '已加入输入框', exact: true })
            .click()
          await editor
            .getByRole('textbox', { name: '画面文字意见', exact: true })
            .fill('整帧不要裁切。')
          await editor
            .locator('.nc-video-text-opinion')
            .getByRole('button', { name: '已加入输入框', exact: true })
            .click()
          await editor.getByRole('button', { name: /画面意见/ }).click()
          await editor.getByRole('textbox', { name: '画面文字意见' }).waitFor({ state: 'hidden' })
          const anchorTime = await editor
            .locator('video')
            .evaluate((video: HTMLVideoElement) => video.currentTime)
          const strip = (await editor.locator('.nc-video-filmstrip').boundingBox())!
          const nearX = strip.x + (anchorTime / 4) * strip.width + 4
          await page.mouse.click(nearX, strip.y + strip.height / 2)
          const snapped =
            Math.abs(
              Number(await editor.getByRole('slider').getAttribute('aria-valuenow')) - anchorTime
            ) < 0.001
          await page.keyboard.down('Alt')
          await page.mouse.click(nearX, strip.y + strip.height / 2)
          await page.keyboard.up('Alt')
          const bypassed =
            Math.abs(
              Number(await editor.getByRole('slider').getAttribute('aria-valuenow')) - anchorTime
            ) > 0.001
          await page.mouse.click(
            strip.x + (anchorTime / 4) * strip.width,
            strip.y + strip.height / 2
          )
          await editor.getByRole('button', { name: /画面意见/ }).click()
          await editor
            .getByRole('textbox', { name: '画面文字意见', exact: true })
            .fill('整帧不要裁切，保留原构图。')
          // Send after immediately leaving the edited frame: the pending screenshot must still refresh.
          await page.mouse.click(strip.x + strip.width * 0.9, strip.y + strip.height / 2)
          const composer = page.getByTestId(workbenchSelectors.input)
          await composer.click()
          await page.keyboard.press('ControlOrMeta+End')
          await page.keyboard.insertText(' 这次先不要改文件，只根据截图简述画面和我的三条意见。')
          await runtime.captureScreenshot({
            name: 'video-feedback-editing',
            message: '视频标注、缩略图与 Composer 的实际界面。'
          })
          const started = Date.now()
          await composer.press('Enter')
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            started,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)
          const history = page.locator('[data-role="video-feedback"]').last()
          await history.waitFor()
          const historyText = await history.innerText()
          const io = await collectWorkbenchLlmIoRecords(runtime)
          const multimodal = JSON.stringify(io).includes('image_url')
          await history.getByRole('button').first().click()
          await editor.waitFor()
          await runtime.captureScreenshot({
            name: 'video-feedback-history',
            message: '已发送意见及历史视频定位。'
          })
          return {
            stepped,
            empty,
            filled,
            moved,
            resized,
            arrowAdjusted,
            snapped,
            bypassed,
            historyText,
            multimodal
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.stepped > 0 &&
              result.empty &&
              result.filled &&
              result.moved &&
              result.resized &&
              result.arrowAdjusted &&
              result.snapped &&
              result.bypassed,
            {
              name: 'video-annotation-interactions',
              message: '逐帧与框选的空实状态、拖动和输入框操作正确。',
              data: result
            }
          )
          await runtime.assertThat(
            result.multimodal &&
              result.historyText.includes('颜色保持') &&
              result.historyText.includes('保留原构图'),
            {
              name: 'video-feedback-message',
              message: '发送保留最新意见，并实际输入多模态图片。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS + 180000
  )
})
