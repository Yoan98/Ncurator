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

const CASE_ID = 'image-generation-update-preview-and-revert'
const FILE_NAME = 'workbench-existing-image.png'
// 64x64 solid PNG — providers reject sub-10px images when read_image feeds vision LLMs.
const ORIGINAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAl0lEQVR4nO3QMREAIAzAwPpX1hlDIOMHMvyey+ye+7PRAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA+RPhMrsUmhwAAAAABJRU5ErkJggg=='

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['apply'],
        description: '真实 AI 更新已有 PNG 后，验证图片预览和回退恢复原始 bytes。',
        fixtures: [],
        knowledge: 'cached',
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
          const originalBytes = Buffer.from(ORIGINAL_PNG_BASE64, 'base64')
          await fs.writeFile(filePath, originalBytes)

          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请直接调用图片生成工具更新工作区已有图片“${FILE_NAME}”：改成白色背景，中央是一个蓝色正方形。不要使用 terminal，不要删除、重命名或移走原文件，也不要创建其他图片文件；必须直接覆写这个路径并只交付这个文件。完成后告诉我文件名。`
          )
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)

          const updatedBytes = await fs.readFile(filePath)
          const imageToolEvents = evidence.events.filter(
            (event) => event.type === 'tool_call_started' && event.toolName === 'image_generate'
          )
          const imageArtifacts = evidence.events.filter(
            (event) => event.type === 'file_artifact' && event.capability === 'image'
          )
          const listDeliveredImages = async (directory: string): Promise<string[]> => {
            const entries = await fs.readdir(directory, { withFileTypes: true })
            const files: string[] = []
            for (const entry of entries) {
              if (entry.name === '.ncurator') continue
              const entryPath = path.join(directory, entry.name)
              if (entry.isDirectory()) files.push(...(await listDeliveredImages(entryPath)))
              else if (/\.(?:png|jpe?g|webp)$/iu.test(entry.name)) files.push(entryPath)
            }
            return files
          }
          const deliveredImagePaths = await listDeliveredImages(setup.workspace.rootPath)

          const applyEntry = await waitForApplyEntry(page)
          const applyEntryText = ((await applyEntry.textContent()) || '').trim()
          await applyEntry.click()
          const applyPanel = getWorkbenchLocator(page, workbenchSelectors.applyPanel)
          const imagePreview = applyPanel.locator(`img[alt="${FILE_NAME}"]`)
          await imagePreview.waitFor({ state: 'visible', timeout: 30_000 })
          const documentModeToggleCount = await getWorkbenchLocator(
            page,
            workbenchSelectors.documentModeToggle
          ).count()

          await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
          await page.getByText('回退这次修改？').waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
          await waitForWorkbenchApplyRecordStatus(page, 'reverted')
          const revertedBytes = await fs.readFile(filePath)

          return {
            updatedFromOriginal: !updatedBytes.equals(originalBytes),
            updatedPngSignature: updatedBytes.subarray(0, 8).toString('hex'),
            revertedToOriginal: revertedBytes.equals(originalBytes),
            imageToolCallCount: imageToolEvents.length,
            imageArtifactCount: imageArtifacts.length,
            imageArtifactFileNames: imageArtifacts.map((event) => event.fileName),
            deliveredImagePaths,
            applyEntryText,
            documentModeToggleCount
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.updatedFromOriginal &&
              result.updatedPngSignature === '89504e470d0a1a0a' &&
              result.revertedToOriginal &&
              result.imageToolCallCount >= 1 &&
              result.imageArtifactCount >= 1 &&
              result.imageArtifactFileNames.includes(FILE_NAME) &&
              result.deliveredImagePaths.length === 1 &&
              path.basename(result.deliveredImagePaths[0]) === FILE_NAME &&
              result.applyEntryText.includes(FILE_NAME) &&
              result.documentModeToggleCount === 0,
            {
              name: 'workbench-image-generation-update-revert-real',
              message:
                '真实图片更新应直接预览最终图片、不显示图片 Diff，并在回退后恢复首次写入前 bytes，对齐 WB-APPLY-002-AC7 和 WB-APPLY-003-AC7。',
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
