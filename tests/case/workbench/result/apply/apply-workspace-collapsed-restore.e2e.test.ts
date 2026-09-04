import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
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
const SESSION_B_ID = 'collapsed-restore-session-b'
const SESSION_B_TITLE = '折叠恢复会话 B'

const waitForActiveSession = async (
  page: Parameters<typeof getWorkbenchLocator>[0],
  sessionId: string
): Promise<void> => {
  await page.waitForFunction(
    (testId) =>
      document
        .querySelector(`[data-testid="${testId}"]`)
        ?.classList.contains('nc-sidebar-item-active') ?? false,
    `${workbenchSelectors.sessionItemPrefix}-${sessionId}`,
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
          '真实 AI 修改文件后，审核模式展开状态下折叠面板，切换会话再切回时面板必须保持折叠，异步记录刷新不得重新展开。',
        fixtures: ['tests/fixtures/workspace'],
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

          const workspaceList = await page.evaluate(() => window.api.workspaceList())
          const targetWorkspace =
            workspaceList.items.find((workspace) => workspace.name === setup.workspaceName) ||
            workspaceList.items[0]
          if (!targetWorkspace) throw new Error('未找到测试工作区')
          await page.evaluate(
            async ({ sessionB }) => {
              const response = await window.api.chatSessionSave(sessionB)
              if (!response.success) throw new Error(response.error || 'chatSessionSave failed')
            },
            {
              sessionB: {
                id: SESSION_B_ID,
                title: SESSION_B_TITLE,
                created_at: Math.floor(Date.now() / 1000) - 60,
                workspace_id: targetWorkspace.id,
              pinned: false,
              pinned_at: null
              }
            }
          )

          await insertWorkbenchReferenceToken(page, TARGET_FILE)
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请只完成这一个写回动作：修改我刚选中的 ${TARGET_FILE}，只在文件末尾新增一行“${MARKER}”，写回原文件，不要新建文件。写回后立即回复“已写回”，不要继续读取、复核或追加其他操作。`
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
          const sessionList = await page.evaluate(() => window.api.chatSessionList())
          const sessionA = [...sessionList].sort((a, b) => b.created_at - a.created_at)[0]
          if (!sessionA) throw new Error('AI run 未创建真实会话')
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.sessionItemPrefix}-${SESSION_B_ID}`
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
            `${workbenchSelectors.sessionItemPrefix}-${SESSION_B_ID}`
          ).click()
          await waitForActiveSession(page, SESSION_B_ID)
          const shellCountInSessionB = await getWorkbenchLocator(
            page,
            workbenchSelectors.contentPanelShell
          ).count()

          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.sessionItemPrefix}-${sessionA.id}`
          ).click()
          await waitForActiveSession(page, sessionA.id)
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
            shellCountInSessionB,
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
              result.shellCountInSessionB === 0 &&
              result.shellCountAfterRestore === 0 &&
              result.expandToggleVisibleAfterRestore &&
              result.panelShowsTargetFile &&
              result.applyTabCount === 1,
            {
              name: 'workbench-apply-workspace-collapsed-restore-real',
              message:
                '审核模式展开态折叠后切换会话再切回，面板必须保持折叠，异步修改记录刷新不得重新展开；展开后应展示最新审核内容且文件 Tab 保留。',
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
