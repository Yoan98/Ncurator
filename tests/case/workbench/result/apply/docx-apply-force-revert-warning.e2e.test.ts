import path from 'node:path'
import fs from 'node:fs/promises'
import JSZip from 'jszip'
import { XMLSerializer } from '@xmldom/xmldom'
import { readReviewPart } from '../../../../harness/backend/docxReviewAssertions'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  getAntMessageText,
  insertWorkbenchReferenceToken,
  readDocxPlainText,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForApplyEntry,
  waitForWorkbenchApplyPanelReady,
  waitForWorkbenchApplyRecordStatus,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'docx-apply-force-revert-warning'
const MARKER = 'cedar-force-revert-918'

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['apply'],
        description: 'AI 写回后测试进程真实外部改 docx，验证首次回退风险提示和确认后强制回退。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const targetPath = path.join(setup.workspace.rootPath, 'sample-edit.docx')
          const beforeText = await readDocxPlainText(targetPath)
          await insertWorkbenchReferenceToken(page, 'sample-edit.docx')
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请直接修改我刚选中的 sample-edit.docx，在文末新增一段：“Workbench force revert marker ${MARKER}”。完成后告诉我已写回。`
          )
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)
          const afterApplyText = await readDocxPlainText(targetPath)
          const applyEntry = await waitForApplyEntry(page)
          await applyEntry.click()
          await waitForWorkbenchApplyPanelReady(page)

          const externalBytes = await fs.readFile(targetPath)
          const externalZip = await JSZip.loadAsync(externalBytes),
            externalDoc = await readReviewPart(externalBytes)
          const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
          const body = externalDoc.getElementsByTagNameNS(namespace, 'body')[0]
          const paragraph = externalDoc.createElementNS(namespace, 'w:p'),
            run = externalDoc.createElementNS(namespace, 'w:r'),
            text = externalDoc.createElementNS(namespace, 'w:t')
          text.textContent = `external-${MARKER}`
          run.appendChild(text)
          paragraph.appendChild(run)
          body.insertBefore(
            paragraph,
            Array.from(body.childNodes).find(
              (node) => node.nodeType === 1 && (node as Element).localName === 'sectPr'
            ) || null
          )
          externalZip.file('word/document.xml', new XMLSerializer().serializeToString(externalDoc))
          await fs.writeFile(targetPath, await externalZip.generateAsync({ type: 'nodebuffer' }))
          await page.waitForTimeout(800)
          const reviewExternalRefreshNoticeCount = await page
            .getByText('检测到当前文件被外部修改，已自动刷新', { exact: true })
            .count()
          const signalsAfterExternalMutation = await runtime.collectSignals()
          const reviewWatchStartCalls = signalsAfterExternalMutation.ipcInvokeEntries.filter(
            (entry) => entry.name === 'fileWatchStart'
          ).length
          const modeToggle = getWorkbenchLocator(page, workbenchSelectors.documentModeToggle)
          await modeToggle.click()
          await getWorkbenchLocator(page, workbenchSelectors.docxViewer)
            .getByText(`external-${MARKER}`, { exact: false })
            .waitFor({ state: 'visible', timeout: 30_000 })
          const previewContainsExternalC = true
          await modeToggle.click()
          await getWorkbenchLocator(page, workbenchSelectors.docxViewer)
            .getByText(`Workbench force revert marker ${MARKER}`, { exact: false })
            .waitFor({ state: 'visible', timeout: 30_000 })
          const reviewText =
            (await getWorkbenchLocator(page, workbenchSelectors.docxViewer).textContent()) || ''
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
          await page.getByText('回退这次修改？').waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
          await page.getByText('仍然回退这次修改？').waitFor({ state: 'visible' })
          const warningText = ((await page.locator('.ant-modal').last().textContent()) || '').trim()
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
          await waitForWorkbenchApplyRecordStatus(page, 'reverted')
          const afterForceRevertText = await readDocxPlainText(targetPath)
          const antMessageText = await getAntMessageText(page)
          const panelText = (
            (await getWorkbenchLocator(page, workbenchSelectors.applyPanel).textContent()) || ''
          ).trim()
          const modeTagText = (
            (await getWorkbenchLocator(page, workbenchSelectors.documentModeTag).textContent()) ||
            ''
          ).trim()
          const revertButtonCount = await getWorkbenchLocator(
            page,
            workbenchSelectors.applyRevertButton
          ).count()

          return {
            previewContainsExternalC,
            reviewText,
            beforeText,
            afterApplyText,
            warningText,
            afterForceRevertText,
            antMessageText,
            panelText,
            modeTagText,
            revertButtonCount,
            reviewExternalRefreshNoticeCount,
            reviewWatchStartCalls
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.previewContainsExternalC &&
              !result.reviewText.includes(`external-${MARKER}`) &&
              !result.beforeText.includes(MARKER) &&
              result.afterApplyText.includes(MARKER) &&
              /又发生了变化|丢失之后的修改|恢复到这次修改前/u.test(result.warningText) &&
              result.afterForceRevertText === result.beforeText &&
              result.modeTagText === '预览' &&
              result.revertButtonCount === 0 &&
              result.reviewExternalRefreshNoticeCount === 0 &&
              result.reviewWatchStartCalls === 0 &&
              !result.panelText.includes('已回退') &&
              !result.panelText.includes('已删除'),
            {
              name: 'workbench-docx-force-revert-warning-real',
              message:
                'AI 写回后若文件被外部真实修改，首次回退应展示风险提示；确认后才强制恢复并刷新状态，对齐 WB-APPLY-004-AC1 至 WB-APPLY-004-AC3。',
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
