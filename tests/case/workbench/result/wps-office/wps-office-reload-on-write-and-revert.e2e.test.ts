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
  resetWpsEnvironment,
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

type TargetOutcome =
  | { kind: string; fileName: string; status: 'covered'; file: ReloadedFile }
  | { kind: string; fileName: string; status: 'skipped' | 'failed'; reason: string }

const isCovered = (
  outcome: TargetOutcome
): outcome is Extract<TargetOutcome, { status: 'covered' }> => outcome.status === 'covered'

const markerRoundTripped = (file: ReloadedFile): boolean =>
  !file.beforeText.includes(file.marker) &&
  file.afterApplyText.includes(file.marker) &&
  file.afterRevertText === file.beforeText &&
  file.applyExcerpt.includes(file.marker) &&
  !file.revertExcerpt.includes(file.marker)

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      // 上一轮残留的 WPS 实例会连上本轮回环并冒充本轮客户端，进用例前必须归零。
      await resetWpsEnvironment({ removeWorkspaces: true })
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
              outcomes: [] as TargetOutcome[]
            }
          }
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          // 工作区在 after-app-close 阶段删除，这里后注册就会先执行，unlink 才不会撞上 WPS 的文件锁。
          runtime.registerResource({
            name: `wps-office-reset:${CASE_ID}`,
            phase: 'after-app-close',
            dispose: async () => {
              await resetWpsEnvironment({ removeWorkspaces: true })
            }
          })
          const sync = await waitForWpsSyncStatus({ timeoutMs: 20_000 })
          if (sync.port !== WPS_PREFERRED_SYNC_PORT) {
            return {
              skipped: true as const,
              reason: `WPS 窗口刷新需要独占 ${WPS_PREFERRED_SYNC_PORT}，当前回环在 ${sync.port}`,
              outcomes: [] as TargetOutcome[]
            }
          }
          const outcomes: TargetOutcome[] = []
          for (const target of WPS_OFFICE_COVERAGE_TARGETS) {
            const identity = { kind: target.kind, fileName: target.fileName }
            if (!isWpsAddonHostEnabled(target.component)) {
              outcomes.push({
                ...identity,
                status: 'skipped',
                reason: `本机未授权 ${target.component} 加载项`
              })
              continue
            }
            const targetPath = path.join(setup.workspace.rootPath, target.fileName)
            try {
              await openDocumentInWpsBackground(targetPath)
              const ready = await waitForWpsAddonReady({
                filePath: targetPath,
                component: target.component,
                timeoutMs: 90_000
              })
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
              outcomes.push({
                ...identity,
                status: 'covered',
                file: {
                  ...identity,
                  marker,
                  beforeText,
                  afterApplyText,
                  afterRevertText,
                  applyExcerpt: applyReload.excerpt,
                  revertExcerpt: revertReload.excerpt
                }
              })
            } catch (error) {
              // 一种格式失败不能吃掉后面的格式，否则 pptx 永远验不到。
              outcomes.push({
                ...identity,
                status: 'failed',
                reason: error instanceof Error ? error.message : String(error)
              })
            }
            // 每种格式跑完就把组件关干净，下一种格式从空环境开始。
            await resetWpsEnvironment()
          }
          const covered = outcomes.filter(isCovered)
          if (covered.length === 0 && outcomes.every((item) => item.status === 'skipped')) {
            return {
              skipped: true as const,
              reason: outcomes.map((item) => `${item.kind}:${item.reason}`).join(', '),
              outcomes
            }
          }
          return { skipped: false as const, reason: '', outcomes }
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
          const authorized = result.outcomes.filter((item) => item.status !== 'skipped')
          await runtime.assertThat(
            authorized.length > 0 &&
              authorized.every((item) => isCovered(item) && markerRoundTripped(item.file)),
            {
              name: 'workbench-wps-reload-on-write-and-revert',
              message:
                '真实 WPS 打开已授权的 docx / xlsx / pptx 后，写回应让对应窗口正文出现标记，回退后窗口正文恢复原文，对齐 WB-WPS-001-AC2、WB-WPS-001-AC3。',
              data: {
                outcomes: result.outcomes.map((item) =>
                  isCovered(item)
                    ? {
                        kind: item.kind,
                        fileName: item.fileName,
                        status: item.status,
                        markerApplied: item.file.afterApplyText.includes(item.file.marker),
                        reverted: item.file.afterRevertText === item.file.beforeText,
                        applyExcerptHasMarker: item.file.applyExcerpt.includes(item.file.marker),
                        revertExcerptHasMarker: item.file.revertExcerpt.includes(item.file.marker)
                      }
                    : {
                        kind: item.kind,
                        fileName: item.fileName,
                        status: item.status,
                        reason: item.reason
                      }
                )
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
