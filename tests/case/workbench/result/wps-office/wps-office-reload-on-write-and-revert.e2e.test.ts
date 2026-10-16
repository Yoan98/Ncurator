import fs from 'node:fs/promises'
import { clickExcelCell } from '../../../../harness/e2e/excel'
import ExcelJS from 'exceljs'
import { toExcelWorkbookData } from '../../../../../src/shared/excelWorkbook'
import { isWpsApplication } from '../../../../../src/shared/fileReview'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase, type E2ETestRuntime } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  insertWorkbenchReferenceToken,
  readOfficePlainText,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  selectWorkbenchExecutionPermission,
  setupWorkbenchWithTempWorkspace,
  waitForApplyEntryByFileName,
  waitForWorkbenchApplyRecordStatus,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'
import {
  WPS_OFFICE_COVERAGE_TARGETS,
  countWpsDispatchesForPath,
  isWpsAddonHostEnabled,
  openDocumentInWpsBackground,
  prepareWpsOfficeFixtures,
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
  navigationConfirmed: boolean
}

type TargetOutcome =
  | { kind: string; fileName: string; status: 'covered'; file: ReloadedFile }
  | { kind: string; fileName: string; status: 'skipped' | 'failed'; reason: string }

const isCovered = (
  outcome: TargetOutcome
): outcome is Extract<TargetOutcome, { status: 'covered' }> => outcome.status === 'covered'

const markerRoundTripped = (file: ReloadedFile): boolean =>
  file.navigationConfirmed &&
  !file.beforeText.includes(file.marker) &&
  file.afterApplyText.includes(file.marker) &&
  file.afterRevertText === file.beforeText &&
  file.applyExcerpt.includes(file.marker) &&
  !file.revertExcerpt.includes(file.marker)

async function navigateReviewRegion(
  runtime: E2ETestRuntime,
  targetPath: string,
  kind: string,
  marker: string
): Promise<boolean> {
  const { page } = runtime
  await page.bringToFront()
  await page.getByRole('button', { name: '选择打开应用' }).last().click()
  await page.getByRole('menuitem', { name: '默认打开应用…' }).click()
  const menuApplications = page.locator(
    `[data-testid^="${workbenchSelectors.openWithApplicationPrefix}-"]`
  )
  await menuApplications.first().waitFor({ state: 'visible', timeout: 15000 })
  let selectedWps = false
  for (const item of await menuApplications.all()) {
    if (
      isWpsApplication({
        id: (await item.getAttribute('data-testid')) || '',
        name: await item.innerText()
      })
    ) {
      await item.click()
      await page.getByRole('button', { name: '返回打开应用列表' }).waitFor({ state: 'hidden' })
      selectedWps = true
      break
    }
  }
  if (!selectedWps) throw new Error('WPS 未注册为可用的文件关联应用')
  await page.keyboard.press('Escape')
  const review = await page.evaluate(async (filePath) => {
    const records = await window.api.aiFileChangeList()
    const record = records.items
      .filter((r) => r.path === filePath && r.status === 'applied')
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    return record ? window.api.getFileReview({ changeRecordId: record.id }) : null
  }, targetPath)
  if (!review?.success || review.content.kind !== 'office')
    throw new Error('无法读取实际审核定位索引')
  const candidates = review.content.index.regions.filter(
    (r) =>
      r.target &&
      (r.target.kind === 'docx' || r.target.kind === 'ppt'
        ? r.target.text.includes(marker)
        : r.target.value.includes(marker))
  )
  const region =
    candidates.find((candidate) => {
      const target = candidate.target
      return target?.kind === 'docx'
        ? !target.container && target.quote?.includes(marker)
        : target?.kind === 'ppt'
          ? Boolean(target.shapeId)
          : target?.kind === 'excel'
    }) || candidates[0]
  if (!region) throw new Error('审核索引缺少标记对应的位置')
  const { status: previousStatus } = await waitForWpsSyncStatus()
  const previousRequests = new Set(previousStatus.lastNavigationResults.map((r) => r.requestId))
  await page.locator('.office-review-navigable').waitFor({ state: 'visible' })
  if (kind === 'docx') await page.locator(`[data-review-region="${region.id}"]`).first().click()
  else if (kind === 'pptx')
    await getWorkbenchLocator(page, workbenchSelectors.pptDiffAfter)
      .locator(`[data-nc-shape-id="${region.key}"]`)
      .first()
      .click()
  else {
    const splitter = await getWorkbenchLocator(
      page,
      workbenchSelectors.contentPanelResizer
    ).boundingBox()
    if (!splitter) throw new Error('审核面板分隔条不可见')
    await page.mouse.move(splitter.x + splitter.width / 2, splitter.y + splitter.height / 2)
    await page.mouse.down()
    await page.mouse.move(Math.max(300, splitter.x - 350), splitter.y + splitter.height / 2, {
      steps: 10
    })
    await page.mouse.up()
    await page
      .locator(`[data-testid="${workbenchSelectors.excelViewer}"][data-excel-ready="true"]`)
      .waitFor({ state: 'visible' })
    const book = new ExcelJS.Workbook()
    await book.xlsx.readFile(review.content.previewPath)
    const data = toExcelWorkbookData(book, 'review'),
      sheet = Object.values(data.sheets).find((sheet) => sheet.name === region.surface)
    if (!sheet) throw new Error('审核目标工作表不存在')
    await clickExcelCell(page, region.key, sheet)
  }
  let navigationConfirmed = false
  const navigationDeadline = Date.now() + 60000
  while (Date.now() < navigationDeadline) {
    const { status } = await waitForWpsSyncStatus()
    const result = status.lastNavigationResults.find(
      (r) =>
        !previousRequests.has(r.requestId) &&
        path.resolve(r.fullName).toLowerCase() === path.resolve(targetPath).toLowerCase()
    )
    if (result) {
      navigationConfirmed =
        (result.status === 'located' || result.status === 'container') && Boolean(result.selection)
      const target = region.target,
        selection = result.selection
      if (target?.kind === 'docx' && !target.container && target.quote)
        navigationConfirmed =
          result.status === 'located' &&
          selection?.kind === 'docx' &&
          selection.end - selection.start === target.quote.length
      else if (target?.kind === 'ppt' && target.shapeId)
        navigationConfirmed =
          result.status === 'located' &&
          selection?.kind === 'ppt' &&
          selection.slideId === target.slideId &&
          selection.shapeId === target.shapeId
      else if (target?.kind === 'excel')
        navigationConfirmed =
          selection?.kind === 'excel' &&
          selection.sheet === target.sheet &&
          selection.address.replace(/\$/g, '') === target.address.replace(/\$/g, '')
      await runtime.assertThat(navigationConfirmed, {
        name: 'wps-review-actual-selection',
        message: '实际活动文件和选区与审核定位目标一致。',
        data: result
      })
      if (!navigationConfirmed) throw new Error(result.reason || 'WPS 未确认实际选区')
      break
    }
    await page.waitForTimeout(100)
  }
  if (!navigationConfirmed) throw new Error('点击审核区域后未收到 WPS 定位回报')
  await page.bringToFront()
  return navigationConfirmed
}

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      // 上一轮残留的 WPS 实例会连上本轮回环并冒充本轮客户端，进用例前必须归零。
      await resetWpsEnvironment()
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
          let targets = WPS_OFFICE_COVERAGE_TARGETS
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            prepareWorkspace: async (rootPath) => {
              targets = await prepareWpsOfficeFixtures(rootPath)
            }
          })
          await selectWorkbenchExecutionPermission(page, '完全访问')
          // 工作区在 after-app-close 阶段删除，这里后注册就会先执行，unlink 才不会撞上 WPS 的文件锁。
          runtime.registerResource({
            name: `wps-office-reset:${CASE_ID}`,
            phase: 'after-app-close',
            dispose: async () => {
              await resetWpsEnvironment()
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
          const requestedHosts = (process.env.WPS_E2E_HOSTS || 'wps,et,wpp').split(',')
          if (requestedHosts.some((host) => !['wps', 'et', 'wpp'].includes(host)))
            throw new Error('WPS_E2E_HOSTS 只能包含 wps,et,wpp')
          // 成功时保留其他组件的真实窗口，下一种格式须向自己的文档客户端投递。
          for (const target of targets) {
            const identity = { kind: target.kind, fileName: target.fileName }
            if (!requestedHosts.includes(target.component)) {
              outcomes.push({ ...identity, status: 'skipped', reason: '本轮未选择此组件' })
              continue
            }
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
              await page.bringToFront()
              await page.keyboard.press('Escape')
              const marker = `${MARKER}-${target.kind}`
              const beforeText = await readOfficePlainText(targetPath)
              await insertWorkbenchReferenceToken(page, target.fileName)
              const startedAtMs = Date.now()
              await sendWorkbenchMessage(page, target.prompt(marker, target.fileName))
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
              const navigationConfirmed = await navigateReviewRegion(
                runtime,
                targetPath,
                target.kind,
                marker
              )
              const revertStartedAt = Date.now()
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
              const afterRevertStatus = (await waitForWpsSyncStatus()).status
              if (
                countWpsDispatchesForPath(
                  afterRevertStatus.lastDispatches,
                  targetPath,
                  revertStartedAt
                ) !== 1
              )
                throw new Error('同一路径的整次回退重复触发了 WPS 重开')
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
                  revertExcerpt: revertReload.excerpt,
                  navigationConfirmed
                }
              })
            } catch (error) {
              // 一种格式失败不能吃掉后面的格式，否则 pptx 永远验不到。
              outcomes.push({
                ...identity,
                status: 'failed',
                reason: error instanceof Error ? error.message : String(error)
              })
              await resetWpsEnvironment()
            }
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
                '真实 WPS 打开本轮选择且已授权的 Office 文件后，写回应让对应窗口正文出现标记，回退后窗口正文恢复原文，对齐 WB-WPS-001-AC2、WB-WPS-001-AC3。',
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

describe('WPS audit navigation e2e', () => {
  it(
    'wps-office-review-navigation',
    async () => {
      await resetWpsEnvironment()
      await runE2ECase({
        caseId: 'wps-office-review-navigation',
        domain: 'workbench',
        suite: 'result',
        groups: ['wps-office'],
        description: '真实审核区域点击冷启动和再次激活 WPS，并核对实际选区及不写盘边界。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'exclusive',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const outcomes: Array<{
            kind: string
            status: 'covered' | 'failed' | 'skipped'
            reason?: string
          }> = []
          if (!resolveWpsOfficeAppPath())
            return { outcomes: [{ kind: 'all', status: 'skipped' as const, reason: '未安装 WPS' }] }
          let targets = WPS_OFFICE_COVERAGE_TARGETS
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: 'wps-office-review-navigation',
            prepareWorkspace: async (rootPath) => {
              targets = await prepareWpsOfficeFixtures(rootPath)
            }
          })
          await selectWorkbenchExecutionPermission(page, '完全访问')
          runtime.registerResource({
            name: 'wps-review-cleanup',
            phase: 'after-app-close',
            dispose: async () => {
              await resetWpsEnvironment()
            }
          })
          for (const target of targets) {
            if (!isWpsAddonHostEnabled(target.component)) {
              outcomes.push({ kind: target.kind, status: 'skipped', reason: '组件未授权' })
              continue
            }
            try {
              const targetPath = path.join(setup.workspace.rootPath, target.fileName),
                marker = `wps-nav-e2e-${target.kind}`
              await page.bringToFront()
              await page.keyboard.press('Escape')
              await insertWorkbenchReferenceToken(page, target.fileName)
              const started = Date.now()
              await sendWorkbenchMessage(page, target.prompt(marker, target.fileName))
              const evidence = await waitForWorkbenchAiRunCompletion(
                runtime,
                started,
                setup.env.modelName,
                WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
                { page, blockerPolicy: 'auto_approve' }
              )
              recordWorkbenchAiEvidence(runtime, evidence, 0.8)
              const bytes = await fs.readFile(targetPath)
              if (!(await readOfficePlainText(targetPath)).includes(marker))
                throw new Error('正式文件缺少实际修改')
              await (await waitForApplyEntryByFileName(page, target.fileName)).click()
              const before = (await waitForWpsSyncStatus()).status
              await navigateReviewRegion(runtime, targetPath, target.kind, marker)
              await navigateReviewRegion(runtime, targetPath, target.kind, marker)
              const after = (await waitForWpsSyncStatus()).status
              if (!bytes.equals(await fs.readFile(targetPath))) throw new Error('导航改写了文件')
              if (
                before.lastCloseResults.length !== after.lastCloseResults.length ||
                before.lastDispatches.length !== after.lastDispatches.length
              )
                throw new Error('导航错误进入了写回刷新流程')
              outcomes.push({ kind: target.kind, status: 'covered' })
            } catch (error) {
              outcomes.push({
                kind: target.kind,
                status: 'failed',
                reason: error instanceof Error ? error.message : String(error)
              })
            }
            await resetWpsEnvironment()
          }
          return { outcomes }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.outcomes.every((item) => item.status !== 'failed'),
            {
              name: 'office-review-real-navigation',
              message: '已授权组件必须通过冷启动及已打开定位，并保留源文件；未授权明确跳过。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    CASE_TIMEOUT_MS
  )
})
