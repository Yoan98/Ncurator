import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createTemporaryWorkbenchWorkspace,
  getWorkbenchPrefixLocator,
  loadWorkbenchLiveModelEnv,
  navigateToWorkbench,
  recordWorkbenchAiEvidence,
  selectWorkbenchWorkspace,
  sendWorkbenchMessage,
  waitForLatestAssistantFinalAnswerText,
  waitForLatestAssistantProcess,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'
import {
  createRealWorkspaceWithRoot,
  navigateToSettingsSection,
  seedActiveModelConfig,
  waitForFileIndexJobIdle
} from '../../../../harness/e2e/settings'

const CASE_ID = 'run-navigation-snapshot-replay'
const PROMPT =
  '请只依据当前工作区里的资料，用 keyword 检索 Alice 和 Bob 相关内容，整理对外同步结论，并用 5 条以内项目符号回答。'
const WORKSPACE_NAME = 'Workbench Run Persistence Workspace'
const MODEL_CONFIG_ID = 'workbench-run-persistence-live-model'
const REQUIRED_INDEXED_FILES = [
  '工作/对外口径确认.txt',
  '工作/财务与付款材料跟进.txt',
  '工作/本周排期更新.txt'
]

describe('workbench run persistence e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['persistence'],
        description:
          '真实 AI 输出过程中切到 Settings，完成后回到 Workbench，通过 session snapshot replay 恢复过程流和最终回答。',
        fixtures: ['tests/fixtures/workspace'],
        launchMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const env = loadWorkbenchLiveModelEnv()
          const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
          try {
            runtime.signal({
              name: 'workbench-run-persistence-workspace-setup-start',
              message: '通过 IPC 创建并索引真实工作区，避免把原生目录选择纳入本用例目标。'
            })
            const workspaceResponse = await createRealWorkspaceWithRoot(page, {
              name: WORKSPACE_NAME,
              rootPath: workspace.rootPath
            })
            const workspaceId = workspaceResponse.workspace!.id
            const prepareFilesResponse = await page.evaluate(async (selectedWorkspaceId) => {
              return await window.api.workspacePrepare({ workspaceId: selectedWorkspaceId })
            }, workspaceId)
            if (!prepareFilesResponse.success) {
              throw new Error(prepareFilesResponse.error || 'failed to prepare workspace files')
            }
            const prepared = await waitForFileIndexJobIdle(
              page,
              workspaceId,
              WORKBENCH_RESULT_E2E_TIMEOUT_MS
            )
            const indexedFileStatuses = prepared.tree.items
              .filter((item) => REQUIRED_INDEXED_FILES.includes(item.relative_path))
              .map((item) => ({
                relativePath: item.relative_path,
                status: item.index_status,
                documentId: item.document_id,
                lastError: item.last_error
              }))
            if (
              indexedFileStatuses.length !== REQUIRED_INDEXED_FILES.length ||
              indexedFileStatuses.some((item) => item.status !== 'indexed' || !item.documentId)
            ) {
              throw new Error(
                `workspace fixture indexing failed: ${JSON.stringify(indexedFileStatuses)}`
              )
            }
            runtime.signal({
              name: 'workbench-run-persistence-workspace-setup-complete',
              message: '真实工作区已创建并完成索引。',
              data: {
                workspaceId,
                indexedFileStatuses
              }
            })

            await seedActiveModelConfig(page, {
              id: MODEL_CONFIG_ID,
              providerKind: 'openai-compatible',
              base_url: env.baseUrl,
              api_key: env.apiKey,
              is_active: true,
              default_model: env.modelName
            })
            runtime.signal({
              name: 'workbench-run-persistence-model-config-seeded',
              message: '真实模型配置已通过 IPC 写入并设为当前配置。',
              data: {
                configId: MODEL_CONFIG_ID,
                modelName: env.modelName
              }
            })

            await navigateToWorkbench(page)
            await selectWorkbenchWorkspace(page, WORKSPACE_NAME)
            const startedAtMs = Date.now()
            await sendWorkbenchMessage(page, PROMPT)
            const processLocator = await waitForLatestAssistantProcess(page)
            const processTextBeforeNavigation = ((await processLocator.textContent()) || '').trim()

            await navigateToSettingsSection(page, 'workspace')
            const evidence = await waitForWorkbenchAiRunCompletion(
              runtime,
              startedAtMs,
              env.modelName
            )
            await navigateToWorkbench(page)

            const finalAnswerText = await waitForLatestAssistantFinalAnswerText(page)
            const processItemCount = await getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.assistantProcessItemPrefix
            ).count()
            recordWorkbenchAiEvidence(runtime, evidence, 0.85)

            return {
              processTextBeforeNavigation,
              processItemCount,
              finalAnswerText,
              eventTypes: evidence.events.map((event) => event.type)
            }
          } finally {
            await workspace.cleanup()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.processTextBeforeNavigation.length > 0 &&
              result.processItemCount > 0 &&
              result.eventTypes.includes('answer_completed') &&
              result.eventTypes.includes('run_completed') &&
              /Alice|合规负责人/u.test(result.finalAnswerText) &&
              /Bob|财务接口人/u.test(result.finalAnswerText),
            {
              name: 'workbench-run-navigation-snapshot-replay',
              message:
                'AI 输出中离开 Workbench 再返回时，应通过持久化 snapshot replay 恢复过程流和最终回答，对齐 WB-SESSION-002-AC3、WB-COMPOSER-003-AC7。',
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
