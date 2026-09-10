import { copyFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  clampWorkbenchPartnerName,
  configureLiveModelThroughSettingsUi,
  createPartnerThroughWorkbenchUi,
  createTemporaryWorkbenchWorkspace,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  insertWorkbenchReferenceToken,
  loadWorkbenchLiveModelEnv,
  navigateToWorkbench,
  prepareWorkbenchWorkspaceThroughUi,
  readDocxPlainText,
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
  sendWorkbenchMessage,
  waitForWorkbenchApplyPanelReady,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'multi-file-apply-tabs'
const FIRST_FILE = 'multi-apply-first.docx'
const SECOND_FILE = 'multi-apply-second.docx'
const THIRD_FILE = 'multi-apply-third.docx'
const FOURTH_FILE = 'multi-apply-fourth.docx'
const FIRST_MARKER = 'cedar-multi-apply-prd-141'
const SECOND_MARKER = 'cedar-multi-apply-case-242'
const THIRD_MARKER = 'cedar-multi-apply-spec-343'
const FOURTH_MARKER = 'cedar-multi-apply-qa-444'
const SOURCE_FILE = 'sample-edit.docx'

const waitForApplyPanelFile = async (
  page: Parameters<typeof getWorkbenchLocator>[0],
  fileName: string
): Promise<void> => {
  await waitForWorkbenchApplyPanelReady(page)
  await page.waitForFunction(
    ({ panelTestId, expectedFileName }) => {
      const panel = document.querySelector(`[data-testid="${panelTestId}"]`)
      return panel instanceof HTMLElement && panel.innerText.includes(expectedFileName)
    },
    {
      panelTestId: workbenchSelectors.applyPanel,
      expectedFileName: fileName
    },
    { timeout: 30_000 }
  )
}

const setupMultiFileApplyWorkspace = async (
  page: Page
): Promise<{
  env: ReturnType<typeof loadWorkbenchLiveModelEnv>
  workspace: Awaited<ReturnType<typeof createTemporaryWorkbenchWorkspace>>
  workspaceName: string
}> => {
  const env = loadWorkbenchLiveModelEnv()
  const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
  const workspaceName = clampWorkbenchPartnerName(`Workbench ${CASE_ID}`)
  const sourcePath = path.join(workspace.rootPath, SOURCE_FILE)
  await Promise.all([
    copyFile(sourcePath, path.join(workspace.rootPath, FIRST_FILE)),
    copyFile(sourcePath, path.join(workspace.rootPath, SECOND_FILE)),
    copyFile(sourcePath, path.join(workspace.rootPath, THIRD_FILE)),
    copyFile(sourcePath, path.join(workspace.rootPath, FOURTH_FILE))
  ])

  await configureLiveModelThroughSettingsUi(page, env)
  await prepareWorkbenchWorkspaceThroughUi(page, {
    workspaceName,
    rootPath: workspace.rootPath
  })
  await navigateToWorkbench(page)
  await createPartnerThroughWorkbenchUi(page, workspaceName)
  await selectWorkbenchModel(page, env.modelName)

  return {
    env,
    workspace,
    workspaceName
  }
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
          '真实 AI 同一轮修改四个 docx 后，验证 assistant 多入口、超过 3 个入口的折叠展开、右侧仅展示当前点击文件并切换对应记录。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupMultiFileApplyWorkspace(page)
          const firstPath = path.join(setup.workspace.rootPath, FIRST_FILE)
          const secondPath = path.join(setup.workspace.rootPath, SECOND_FILE)
          const thirdPath = path.join(setup.workspace.rootPath, THIRD_FILE)
          const fourthPath = path.join(setup.workspace.rootPath, FOURTH_FILE)
          const firstBeforeText = await readDocxPlainText(firstPath)
          const secondBeforeText = await readDocxPlainText(secondPath)
          const thirdBeforeText = await readDocxPlainText(thirdPath)
          const fourthBeforeText = await readDocxPlainText(fourthPath)
          await insertWorkbenchReferenceToken(page, FIRST_FILE)
          await insertWorkbenchReferenceToken(page, SECOND_FILE)
          await insertWorkbenchReferenceToken(page, THIRD_FILE)
          await insertWorkbenchReferenceToken(page, FOURTH_FILE)
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请只完成这四个写回动作：1. 修改我刚选中的 ${FIRST_FILE}，只在文末新增一段“${FIRST_MARKER}”；2. 修改我刚选中的 ${SECOND_FILE}，只在文末新增一段“${SECOND_MARKER}”；3. 修改我刚选中的 ${THIRD_FILE}，只在文末新增一段“${THIRD_MARKER}”；4. 修改我刚选中的 ${FOURTH_FILE}，只在文末新增一段“${FOURTH_MARKER}”。请分别写回原文件，不要新建文件。四个文件都写回后，立即回复“已写回”，不要继续读取、复核、解释或追加其他操作。`
          )
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)
          const firstAfterText = await readDocxPlainText(firstPath)
          const secondAfterText = await readDocxPlainText(secondPath)
          const thirdAfterText = await readDocxPlainText(thirdPath)
          const fourthAfterText = await readDocxPlainText(fourthPath)
          await getWorkbenchPrefixLocator(page, workbenchSelectors.assistantTurnApplyPrefix)
            .first()
            .waitFor({ state: 'visible' })
          await page.waitForFunction((countPrefix) => {
            const header = document.querySelector(`[data-testid^="${countPrefix}"]`)
            if (!(header instanceof HTMLElement)) return false
            const match = header.innerText.trim().match(/^(\d+) 个$/u)
            return Boolean(match && Number.parseInt(match[1], 10) >= 4)
          }, workbenchSelectors.assistantTurnApplyCountPrefix)
          const applyCountHeader = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantTurnApplyCountPrefix
          )
          const applyEntryCount = Number.parseInt(
            ((await applyCountHeader.first().textContent()) || '0').trim(),
            10
          )
          const collapseToggle = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantTurnApplyCollapsePrefix
          )
          await collapseToggle.first().waitFor({ state: 'visible' })
          const applyEntryCountWhenCollapsed = await getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantTurnApplyPrefix
          ).count()
          const collapseToggleTextCollapsed = (
            (await collapseToggle.first().textContent()) || ''
          ).trim()
          const applyCountHeaderTextCollapsed = (
            (await applyCountHeader.first().textContent()) || ''
          ).trim()
          await collapseToggle.first().click()
          const applyEntryCountWhenExpanded = await getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantTurnApplyPrefix
          ).count()
          const collapseToggleTextExpanded = (
            (await collapseToggle.first().textContent()) || ''
          ).trim()
          const applyCountHeaderTextExpanded = (
            (await applyCountHeader.first().textContent()) || ''
          ).trim()
          await collapseToggle.first().click()
          const applyEntryCountAfterReCollapse = await getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantTurnApplyPrefix
          ).count()
          await collapseToggle.first().click()
          const firstEntry = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantTurnApplyPrefix
          )
            .filter({ hasText: FIRST_FILE })
            .first()
          const secondEntry = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantTurnApplyPrefix
          )
            .filter({ hasText: SECOND_FILE })
            .first()
          const firstEntryText = ((await firstEntry.textContent()) || '').trim()
          const secondEntryText = ((await secondEntry.textContent()) || '').trim()
          await firstEntry.click()
          await waitForApplyPanelFile(page, FIRST_FILE)
          const afterFirstEntryText = (
            (await getWorkbenchLocator(page, workbenchSelectors.applyPanel).textContent()) || ''
          ).trim()
          const firstModeTagCount = await getWorkbenchLocator(
            page,
            workbenchSelectors.documentModeTag
          ).count()
          await secondEntry.click()
          await waitForApplyPanelFile(page, SECOND_FILE)
          const afterSecondEntryText = (
            (await getWorkbenchLocator(page, workbenchSelectors.applyPanel).textContent()) || ''
          ).trim()
          const resourceTabs = getWorkbenchPrefixLocator(page, workbenchSelectors.resourceTabPrefix)
          const resourceTabCount = await resourceTabs.count()
          await resourceTabs.filter({ hasText: FIRST_FILE }).first().click()
          await waitForApplyPanelFile(page, FIRST_FILE)
          const afterFirstEntryAgainText = (
            (await getWorkbenchLocator(page, workbenchSelectors.applyPanel).textContent()) || ''
          ).trim()
          const applyPanelCount = await getWorkbenchLocator(
            page,
            workbenchSelectors.applyPanel
          ).count()

          return {
            firstBeforeText,
            secondBeforeText,
            thirdBeforeText,
            fourthBeforeText,
            firstAfterText,
            secondAfterText,
            thirdAfterText,
            fourthAfterText,
            applyEntryCount,
            applyEntryCountWhenCollapsed,
            applyEntryCountWhenExpanded,
            applyEntryCountAfterReCollapse,
            collapseToggleTextCollapsed,
            collapseToggleTextExpanded,
            applyCountHeaderTextCollapsed,
            applyCountHeaderTextExpanded,
            firstEntryText,
            secondEntryText,
            afterFirstEntryText,
            afterSecondEntryText,
            afterFirstEntryAgainText,
            firstModeTagCount,
            applyPanelCount,
            resourceTabCount,
            fileArtifactCount: evidence.events.filter((event) => event.type === 'file_artifact')
              .length
          }
        },
        assert: async (result, runtime) => {
          const remainingCount = result.applyEntryCount - 3
          await runtime.assertThat(
            !result.firstBeforeText.includes(FIRST_MARKER) &&
              !result.secondBeforeText.includes(SECOND_MARKER) &&
              !result.thirdBeforeText.includes(THIRD_MARKER) &&
              !result.fourthBeforeText.includes(FOURTH_MARKER) &&
              result.firstAfterText.includes(FIRST_MARKER) &&
              result.secondAfterText.includes(SECOND_MARKER) &&
              result.thirdAfterText.includes(THIRD_MARKER) &&
              result.fourthAfterText.includes(FOURTH_MARKER) &&
              result.applyEntryCount >= 4 &&
              result.fileArtifactCount >= 4 &&
              result.applyEntryCountWhenCollapsed === 3 &&
              result.applyEntryCountWhenExpanded === result.applyEntryCount &&
              result.applyEntryCountAfterReCollapse === 3 &&
              result.collapseToggleTextCollapsed === `显示剩余 ${remainingCount} 个文件` &&
              result.collapseToggleTextExpanded === '收起文件' &&
              result.applyCountHeaderTextCollapsed === `${result.applyEntryCount} 个` &&
              result.applyCountHeaderTextExpanded === `${result.applyEntryCount} 个` &&
              result.firstEntryText.includes(FIRST_FILE) &&
              result.secondEntryText.includes(SECOND_FILE) &&
              result.firstEntryText.includes('Workbench multi-file-apply-tabs') &&
              result.secondEntryText.includes('Workbench multi-file-apply-tabs') &&
              result.afterFirstEntryText.includes(FIRST_FILE) &&
              !result.afterFirstEntryText.includes(SECOND_FILE) &&
              result.afterSecondEntryText.includes(SECOND_FILE) &&
              !result.afterSecondEntryText.includes(FIRST_FILE) &&
              result.afterFirstEntryAgainText.includes(FIRST_FILE) &&
              !result.afterFirstEntryAgainText.includes(SECOND_FILE) &&
              result.firstModeTagCount === 1 &&
              result.applyPanelCount === 1 &&
              result.resourceTabCount === 2,
            {
              name: 'workbench-multi-file-apply-single-preview-real',
              message:
                '同一轮 AI 修改多个文件时，入口超过 3 个默认折叠且可展开收起，头部总数不变；右侧应为每个文件保留一个 tab，并能直接切换回已打开文件。',
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
