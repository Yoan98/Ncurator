import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
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

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['apply'],
        description: '真实 AI 修改 DOCX 附件中的已有表格单元格后，验证成功状态和单元格 Diff。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'ncurator-docx-cell-e2e-'))
          try {
            const fixturePath = await writeRichTestDocxFile(fixtureRoot, 'cell-diff.docx', [
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
            ])
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

            const record = await page.evaluate(async (workspaceRootPath) => {
              const workspace = (await window.api.workspaceList()).items.find(
                (item) => item.root_path === workspaceRootPath
              )
              if (!workspace) return null
              const sessions = (await window.api.chatSessionList())
                .filter((session) => session.workspace_id === workspace.id)
                .sort((left, right) => right.created_at - left.created_at)
              if (!sessions[0]) return null
              const response = await window.api.aiFileChangeList({ sessionId: sessions[0].id })
              return response.items.find(
                (item) => item.capability === 'docx' && item.fileName === 'cell-diff.docx'
              )
            }, setup.workspace.rootPath)
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

            return {
              status: record.status,
              error: record.error,
              path: record.path,
              changeCount: record.changeCount,
              insertCount: record.insertCount,
              deleteCount: record.deleteCount,
              diskText,
              panelText,
              fileArtifactCount: evidence.events.filter((event) => event.type === 'file_artifact')
                .length
            }
          } finally {
            await rm(fixtureRoot, { recursive: true, force: true })
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.status === 'applied' &&
              !result.error &&
              result.path.includes(path.join('.ncurator', 'runtime', 'assets')) &&
              result.changeCount === 2 &&
              result.insertCount === 1 &&
              result.deleteCount === 1 &&
              result.diskText.includes('Bob') &&
              !result.diskText.includes('Alice') &&
              result.panelText.includes('Alice') &&
              result.panelText.includes('Bob') &&
              !result.panelText.includes('Run completed without an effective workspace change.') &&
              !result.panelText.includes('本次未检测到文件内容变化') &&
              result.fileArtifactCount >= 1,
            {
              name: 'docx-attachment-change-remains-applied-with-cell-diff',
              message:
                'DOCX 附件位于 .ncurator/runtime/assets 时，真实单元格修改仍应保持 applied，并在审核模式展示单元格净变化。',
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
