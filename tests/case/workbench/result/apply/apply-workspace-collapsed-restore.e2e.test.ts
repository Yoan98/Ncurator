import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createPartnerThroughWorkbenchUi,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  insertWorkbenchReferenceToken,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForApplyEntry,
  waitForWorkbenchAiRunCompletion,
  waitForWorkbenchApplyPanelReady,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'apply-workspace-collapsed-restore'
const TARGET_FILE = 'workbench-preview.md'
const MARKER = 'cedar-apply-collapsed-restore-771'
const PARTNER_B_NAME = '折叠恢复伙伴 B'

const waitForActivePartner = async (
  page: Parameters<typeof getWorkbenchLocator>[0],
  partnerId: string
): Promise<void> => {
  await page.waitForFunction(
    (testId) =>
      document
        .querySelector(`[data-testid="${testId}"]`)
        ?.classList.contains('nc-sidebar-item-active') ?? false,
    `${workbenchSelectors.partnerItemPrefix}-${partnerId}`,
    { timeout: 15_000 }
  )
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
          '真实 AI 修改文件后，审核模式展开状态下折叠面板，切换伙伴再切回时面板必须保持折叠，异步记录刷新不得重新展开。',
        fixtures: ['tests/fixtures/workspace'],
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
          const targetPath = path.join(setup.workspace.rootPath, TARGET_FILE)
          const beforeText = await fs.readFile(targetPath, 'utf-8')

          const [partnerA] = await page.evaluate(() => window.api.partnerList())
          if (!partnerA) throw new Error('未找到当前伙伴')
          await insertWorkbenchReferenceToken(page, TARGET_FILE)
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请使用应用里的文本编辑能力修改我刚选中的 ${TARGET_FILE}，不要通过命令行或脚本修改文件。只在文件末尾新增一行“${MARKER}”，保存到原文件，不要新建文件，然后简短回复。`
          )
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)
          const afterText = await fs.readFile(targetPath, 'utf-8')
          await createPartnerThroughWorkbenchUi(page, PARTNER_B_NAME)
          const partnerB = (await page.evaluate(() => window.api.partnerList())).find(
            (partner) => partner.name === PARTNER_B_NAME
          )
          if (!partnerB) throw new Error('未找到新建伙伴')
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partnerA.id}`
          ).click()
          await waitForActivePartner(page, partnerA.id)
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partnerB.id}`
          ).waitFor({ state: 'visible', timeout: 15_000 })

          await waitForApplyEntry(page)
          const applyEntry = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantTurnApplyPrefix
          )
            .filter({ hasText: TARGET_FILE })
            .first()
          await applyEntry.click()
          await waitForWorkbenchApplyPanelReady(page)
          const reviewModeTagCount = await getWorkbenchLocator(
            page,
            workbenchSelectors.documentModeTag
          ).count()

          const collapseToggle = page.getByRole('button', { name: '收起右侧栏' })
          await collapseToggle.click()
          await page.waitForFunction(
            (testId) => document.querySelector(`[data-testid="${testId}"]`) === null,
            workbenchSelectors.contentPanelShell,
            { timeout: 10_000 }
          )
          const shellCountAfterCollapse = await getWorkbenchLocator(
            page,
            workbenchSelectors.contentPanelShell
          ).count()

          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partnerB.id}`
          ).click()
          await waitForActivePartner(page, partnerB.id)
          const shellCountInPartnerB = await getWorkbenchLocator(
            page,
            workbenchSelectors.contentPanelShell
          ).count()

          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partnerA.id}`
          ).click()
          await waitForActivePartner(page, partnerA.id)
          await page.waitForTimeout(3000)
          const shellCountAfterRestore = await getWorkbenchLocator(
            page,
            workbenchSelectors.contentPanelShell
          ).count()
          const expandToggleVisibleAfterRestore = await page
            .getByRole('button', { name: '展开右侧栏' })
            .isVisible()
            .catch(() => false)

          await page.getByRole('button', { name: '展开右侧栏' }).click()
          await waitForWorkbenchApplyPanelReady(page)
          const panelTextAfterRestore = (
            (await getWorkbenchLocator(page, workbenchSelectors.applyPanel).textContent()) || ''
          ).trim()
          const applyTabCount = await getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.resourceTabPrefix
          )
            .filter({ hasText: TARGET_FILE })
            .count()

          return {
            beforeHasMarker: beforeText.includes(MARKER),
            afterHasMarker: afterText.includes(MARKER),
            reviewModeTagCount,
            shellCountAfterCollapse,
            shellCountInPartnerB,
            shellCountAfterRestore,
            expandToggleVisibleAfterRestore,
            panelShowsTargetFile: panelTextAfterRestore.includes(TARGET_FILE),
            applyTabCount,
            fileArtifactCount: evidence.events.filter((event) => event.type === 'file_artifact')
              .length
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            !result.beforeHasMarker &&
              result.afterHasMarker &&
              result.fileArtifactCount >= 1 &&
              result.reviewModeTagCount === 1 &&
              result.shellCountAfterCollapse === 0 &&
              result.shellCountInPartnerB === 0 &&
              result.shellCountAfterRestore === 0 &&
              result.expandToggleVisibleAfterRestore &&
              result.panelShowsTargetFile &&
              result.applyTabCount === 1,
            {
              name: 'workbench-apply-workspace-collapsed-restore-real',
              message:
                '审核模式展开态折叠后切换伙伴再切回，面板必须保持折叠，异步修改记录刷新不得重新展开；展开后应展示最新审核内容且文件 Tab 保留。',
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
