import fs from 'node:fs/promises'
import path from 'node:path'
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

const CASE_ID = 'image-generation-preview-and-revert'
const FILE_NAME = 'workbench-image-generation.png'

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['apply'],
        description: '真实 AI 生成 PNG 后，验证图片预览、工具输入契约和新建文件回退。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID
          })
          const filePath = path.join(setup.workspace.rootPath, FILE_NAME)
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请直接在工作区生成图片“${FILE_NAME}”：白色背景，中央是一个红色圆形。生成完成后告诉我文件名。`
          )
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)

          const imageBytes = await fs.readFile(filePath)
          const imageToolEvents = evidence.events.filter(
            (event) => event.type === 'tool_call_started' && event.toolName === 'image_generate'
          )
          const imageToolInputKeys = imageToolEvents.flatMap((event) =>
            event.input && typeof event.input === 'object' && !Array.isArray(event.input)
              ? [Object.keys(event.input).sort()]
              : []
          )
          const imageArtifacts = evidence.events.filter(
            (event) => event.type === 'file_artifact' && event.capability === 'image'
          )

          const applyEntry = await waitForApplyEntry(page)
          const applyEntryText = ((await applyEntry.textContent()) || '').trim()
          await applyEntry.click()
          const applyPanel = getWorkbenchLocator(page, workbenchSelectors.applyPanel)
          const imagePreview = applyPanel.locator(`img[alt="${FILE_NAME}"]`)
          await imagePreview.waitFor({ state: 'visible', timeout: 30_000 })
          const imagePreviewVisible = await imagePreview.isVisible()
          const documentModeToggleCount = await getWorkbenchLocator(
            page,
            workbenchSelectors.documentModeToggle
          ).count()

          await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
          await page.getByText('回退这次修改？').waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
          await waitForWorkbenchApplyRecordStatus(page, 'reverted')
          const existsAfterRevert = await fs
            .access(filePath)
            .then(() => true)
            .catch(() => false)

          return {
            pngSignature: imageBytes.subarray(0, 8).toString('hex'),
            imageToolCallCount: imageToolEvents.length,
            imageToolInputKeys,
            imageArtifactCount: imageArtifacts.length,
            applyEntryText,
            imagePreviewVisible,
            documentModeToggleCount,
            existsAfterRevert
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.pngSignature === '89504e470d0a1a0a' &&
              result.imageToolCallCount >= 1 &&
              result.imageToolInputKeys.length === result.imageToolCallCount &&
              result.imageToolInputKeys.every(
                (keys) => keys.length === 2 && keys[0] === 'outputPath' && keys[1] === 'svg'
              ) &&
              result.imageArtifactCount === 1 &&
              result.applyEntryText.includes(FILE_NAME) &&
              result.imagePreviewVisible &&
              result.documentModeToggleCount === 0 &&
              result.existsAfterRevert === false,
            {
              name: 'workbench-image-generation-preview-revert-real',
              message:
                '真实图片生成应遵守最小输入契约，直接预览最终图片，并可回退删除新建文件，对齐 WB-IMAGE-001 和 WB-APPLY-003-AC7。',
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
