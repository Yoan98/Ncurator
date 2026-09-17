import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  insertWorkbenchReferenceToken,
  readOfficePlainText,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForApplyEntryByFileName,
  waitForWorkbenchApplyRecordStatus,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'
import {
  WPS_OFFICE_COVERAGE_TARGETS,
  isWpsAddonHostEnabled,
  openDocumentInWpsBackground,
  resolveWpsOfficeAppPath,
  waitForWpsAddonReady,
  waitForWpsReloadResult,
  waitForWpsSyncStatus
} from '../../../../harness/e2e/wpsSync'
import { WPS_PREFERRED_SYNC_PORT } from '../../../../../src/main/services/wps/constants'

const CASE_ID = 'wps-office-reload-on-write-and-revert'
const MARKER = 'wps-reload-e2e-914'
const CASE_TIMEOUT_MS = WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS * WPS_OFFICE_COVERAGE_TARGETS.length

type ReloadedFile = {
  kind: string
  fileName: string
  marker: string
  beforeText: string
  afterApplyText: string
  afterRevertText: string
  applyExcerpt: string
  revertExcerpt: string
}

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['wps-office'],
        description:
          'opt-in：本机已授权的 WPS 打开目标 docx / xlsx / pptx 后，AI 写回/回退应先 close 再写盘再 open，窗口正文出现标记并在回退后恢复。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'exclusive',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          if (!resolveWpsOfficeAppPath()) {
            return {
              skipped: true as const,
              reason: '本机未找到 WPS Office',
              files: [] as ReloadedFile[]
            }
          }
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const sync = await waitForWpsSyncStatus({ timeoutMs: 20_000 })
          if (sync.port !== WPS_PREFERRED_SYNC_PORT) {
            return {
              skipped: true as const,
              reason: `WPS 窗口刷新需要独占 ${WPS_PREFERRED_SYNC_PORT}，当前回环在 ${sync.port}`,
              files: [] as ReloadedFile[]
            }
          }
          const files: ReloadedFile[] = []
          const skippedHosts: string[] = []
          for (const target of WPS_OFFICE_COVERAGE_TARGETS) {
            const targetPath = path.join(setup.workspace.rootPath, target.fileName)
            if (!isWpsAddonHostEnabled(target.component)) {
              skippedHosts.push(`${target.kind}:${target.component}`)
              continue
            }
            await openDocumentInWpsBackground(targetPath)
            let ready: Awaited<ReturnType<typeof waitForWpsAddonReady>>
            try {
              ready = await waitForWpsAddonReady({
                filePath: targetPath,
                component: target.component,
                timeoutMs: 90_000
              })
            } catch (error) {
              throw new Error(
                `${target.fileName} 已授权 ${target.component} 但加载项未连上：${
                  error instanceof Error ? error.message : String(error)
                }`
              )
            }
            const marker = `${MARKER}-${target.kind}`
            const beforeText = await readOfficePlainText(targetPath)
            await insertWorkbenchReferenceToken(page, target.fileName)
            const startedAtMs = Date.now()
            await sendWorkbenchMessage(page, target.prompt(marker))
            const evidence = await waitForWorkbenchAiRunCompletion(
              runtime,
              startedAtMs,
              setup.env.modelName,
              WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
              { page, blockerPolicy: 'auto_approve' }
            )
            recordWorkbenchAiEvidence(runtime, evidence, 0.8)
            const afterApplyText = await readOfficePlainText(targetPath)
            const applyReload = await waitForWpsReloadResult({
              port: ready.port,
              filePath: targetPath,
              afterAt: startedAtMs,
              excerptIncludes: marker
            })
            const applyEntry = await waitForApplyEntryByFileName(page, target.fileName)
            await applyEntry.click()
            await getWorkbenchLocator(page, workbenchSelectors.applyPanel).waitFor({
              state: 'visible'
            })
            await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
            await page.getByText('回退这次修改？').waitFor({ state: 'visible' })
            await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
            await waitForWorkbenchApplyRecordStatus(page, 'reverted')
            const afterRevertText = await readOfficePlainText(targetPath)
            const revertReload = await waitForWpsReloadResult({
              port: ready.port,
              filePath: targetPath,
              afterAt: applyReload.at + 1,
              excerptExcludes: marker
            })
            files.push({
              kind: target.kind,
              fileName: target.fileName,
              marker,
              beforeText,
              afterApplyText,
              afterRevertText,
              applyExcerpt: applyReload.excerpt,
              revertExcerpt: revertReload.excerpt
            })
          }
          if (files.length === 0) {
            return {
              skipped: true as const,
              reason:
                skippedHosts.length > 0
                  ? `本机 WPS 加载项未授权：${skippedHosts.join(', ')}`
                  : '本机 WPS 加载项未连接',
              files
            }
          }
          return {
            skipped: false as const,
            reason: skippedHosts.length > 0 ? `部分组件未授权：${skippedHosts.join(', ')}` : '',
            files
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped) {
            await runtime.assertThat(true, {
              name: 'workbench-wps-reload-environment-skip',
              message: `本机 WPS 加载项未连接，跳过窗口刷新断言：${result.reason}`,
              data: { reason: result.reason }
            })
            return
          }
          await runtime.assertThat(
            result.files.length >= 1 &&
              result.files.every(
                (file) =>
                  !file.beforeText.includes(file.marker) &&
                  file.afterApplyText.includes(file.marker) &&
                  file.afterRevertText === file.beforeText &&
                  file.applyExcerpt.includes(file.marker) &&
                  !file.revertExcerpt.includes(file.marker)
              ),
            {
              name: 'workbench-wps-reload-on-write-and-revert',
              message:
                '真实 WPS 打开已授权的 docx / xlsx / pptx 后，写回应让对应窗口正文出现标记，回退后窗口正文恢复原文，对齐 WB-WPS-001-AC2、WB-WPS-001-AC3。',
              data: {
                reason: result.reason,
                files: result.files.map((file) => ({
                  kind: file.kind,
                  fileName: file.fileName,
                  markerApplied: file.afterApplyText.includes(file.marker),
                  reverted: file.afterRevertText === file.beforeText,
                  applyExcerptHasMarker: file.applyExcerpt.includes(file.marker),
                  revertExcerptHasMarker: file.revertExcerpt.includes(file.marker)
                }))
              }
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    CASE_TIMEOUT_MS
  )
})
