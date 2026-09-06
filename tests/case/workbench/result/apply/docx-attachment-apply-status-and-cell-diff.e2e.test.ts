import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { writeRichTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  readDocxPlainText,
  recordWorkbenchAiEvidence,
  selectWorkbenchAttachmentThroughNativeDialog,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForApplyEntry,
  waitForWorkbenchAiRunCompletion,
  waitForWorkbenchApplyPanelReady,
  waitForWorkbenchApplyRecordStatus,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'docx-attachment-apply-status-and-cell-diff'
const EXTERNAL_CHANGE_NOTICE = '检测到当前文件被外部修改，已自动刷新'

const replaceDocxFromExternalApplication = async (
  targetPath: string,
  replacementName: string,
  marker: string
): Promise<void> => {
  const directoryPath = path.dirname(targetPath)
  const replacementPath = await writeRichTestDocxFile(directoryPath, replacementName, [
    { type: 'paragraph', paragraph: { runs: [{ text: marker }] } }
  ])
  const previousPath = path.join(directoryPath, `${replacementName}.previous`)
  await fs.rename(targetPath, previousPath)
  await fs.rename(replacementPath, targetPath)
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
          '真实 AI 修改工作区内 DOCX 附件中的已有表格单元格后，验证审核 Diff 固定快照和预览模式监听真实资产文件。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const fixturePath = await writeRichTestDocxFile(
            setup.workspace.rootPath,
            'cell-diff.docx',
            [
              {
                type: 'paragraph',
                paragraph: { runs: [{ text: '表格修改测试' }] }
              },
              {
                type: 'table',
                rows: [
                  [
                    { paragraphs: [{ runs: [{ text: 'Field' }] }] },
                    { paragraphs: [{ runs: [{ text: 'Value' }] }] }
                  ],
                  [
                    { paragraphs: [{ runs: [{ text: 'Owner' }] }] },
                    { paragraphs: [{ runs: [{ text: 'Alice' }] }] }
                  ]
                ]
              }
            ]
          )
          await selectWorkbenchAttachmentThroughNativeDialog(page, fixturePath)
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            '请直接修改附件 cell-diff.docx：把已有表格单元格中的 Alice 替换为 Bob，并把 Field 文字设为红色。必须使用 DOCX 工具写回这个附件，完成后说明结果。'
          )
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)

          const record = await page.evaluate(async () => {
            const partners = [...(await window.api.partnerList())].sort(
              (left, right) => right.created_at - left.created_at
            )
            if (!partners[0]) return null
            const response = await window.api.aiFileChangeList({ partnerId: partners[0].id })
            return response.items.find(
              (item) => item.capability === 'docx' && item.fileName === 'cell-diff.docx'
            )
          })
          if (!record) throw new Error('DOCX attachment change record was not created')
          const diskText = await readDocxPlainText(record.path)
          const applyEntry = await waitForApplyEntry(page)
          await applyEntry.click()
          const panel = await waitForWorkbenchApplyPanelReady(page)
          await waitForWorkbenchApplyRecordStatus(page, 'applied')
          await getWorkbenchLocator(page, workbenchSelectors.docxViewer).waitFor({
            state: 'visible',
            timeout: 30_000
          })
          await panel.getByText('Alice', { exact: true }).waitFor({
            state: 'visible',
            timeout: 30_000
          })
          await panel.getByText('Bob', { exact: true }).waitFor({
            state: 'visible',
            timeout: 30_000
          })
          const panelText = ((await panel.textContent()) || '').trim()
          await page.waitForTimeout(1_600)
          await page.evaluate((noticeText) => {
            const target = window as unknown as {
              __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number
              __NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__?: MutationObserver
            }
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ = 0
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__?.disconnect()
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__ = new MutationObserver(
              (mutations) => {
                if (
                  mutations.some((mutation) =>
                    [...mutation.addedNodes].some((node) => node.textContent?.includes(noticeText))
                  )
                ) {
                  target.__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ =
                    (target.__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ || 0) + 1
                }
              }
            )
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__.observe(document.body, {
              childList: true,
              subtree: true
            })
          }, EXTERNAL_CHANGE_NOTICE)
          const documentModeToggle = getWorkbenchLocator(
            page,
            workbenchSelectors.documentModeToggle
          )
          await documentModeToggle.click()
          await page.waitForFunction(() =>
            Boolean(
              (
                window as unknown as {
                  __NCURATOR_E2E_OBSERVER__?: { ipcInvokeEntries?: Array<{ name: string }> }
                }
              ).__NCURATOR_E2E_OBSERVER__?.ipcInvokeEntries?.some(
                (entry) => entry.name === 'fileWatchStart'
              )
            )
          )
          await replaceDocxFromExternalApplication(
            record.path,
            'cell-diff-external-preview.docx',
            'external asset preview content'
          )
          const assetPreviewRefreshed = await getWorkbenchLocator(page, workbenchSelectors.docxViewer)
            .getByText('external asset preview content', { exact: true })
            .waitFor({ state: 'visible', timeout: 30_000 })
            .then(() => true)
            .catch(() => false)
          const externalRefreshNoticeCount = await page.evaluate(
            () =>
              (window as unknown as { __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number })
                .__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ || 0
          )
          await documentModeToggle.click()
          await panel.getByText('Alice', { exact: true }).waitFor({
            state: 'visible',
            timeout: 30_000
          })
          await panel.getByText('Bob', { exact: true }).waitFor({
            state: 'visible',
            timeout: 30_000
          })
          await page.waitForFunction(() =>
            Boolean(
              (
                window as unknown as {
                  __NCURATOR_E2E_OBSERVER__?: { ipcInvokeEntries?: Array<{ name: string }> }
                }
              ).__NCURATOR_E2E_OBSERVER__?.ipcInvokeEntries?.some(
                (entry) => entry.name === 'fileWatchStop'
              )
            )
          )
          await replaceDocxFromExternalApplication(
            record.path,
            'cell-diff-external-review.docx',
            'external review write must not replace diff'
          )
          await page.waitForTimeout(1_000)
          const reviewRemainedSnapshot =
            (await panel.getByText('Alice', { exact: true }).count()) > 0 &&
            (await panel.getByText('Bob', { exact: true }).count()) > 0
          const signals = await runtime.collectSignals()

          return {
            status: record.status,
            error: record.error,
            path: record.path,
            expectedPath: fixturePath,
            changeCount: record.changeCount,
            insertCount: record.insertCount,
            deleteCount: record.deleteCount,
            diskText,
            panelText,
            assetPreviewRefreshed,
            externalRefreshNoticeCount,
            reviewRemainedSnapshot,
            watchStartCalls: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'fileWatchStart'
            ).length,
            watchStopCalls: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'fileWatchStop'
            ).length,
            fileArtifactCount: evidence.events.filter((event) => event.type === 'file_artifact')
              .length
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.status === 'applied' &&
              !result.error &&
              result.path === result.expectedPath &&
              result.changeCount === 2 &&
              result.insertCount === 1 &&
              result.deleteCount === 1 &&
              result.diskText.includes('Bob') &&
              !result.diskText.includes('Alice') &&
              result.panelText.includes('Alice') &&
              result.panelText.includes('Bob') &&
              result.assetPreviewRefreshed &&
              result.externalRefreshNoticeCount === 1 &&
              result.reviewRemainedSnapshot &&
              result.watchStartCalls >= 1 &&
              result.watchStopCalls >= 1 &&
              !result.panelText.includes('Run completed without an effective workspace change.') &&
              !result.panelText.includes('本次未检测到文件内容变化') &&
              result.fileArtifactCount >= 1,
            {
              name: 'docx-attachment-change-remains-applied-with-cell-diff',
              message:
                '工作区内 DOCX 附件保留源文件绝对路径时，真实单元格修改仍应保持 applied；预览模式监听真实资产文件，审核模式保持单元格 Diff 快照。',
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
