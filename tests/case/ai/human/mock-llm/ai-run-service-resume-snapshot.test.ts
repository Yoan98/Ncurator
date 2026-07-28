import { describe, it } from 'vitest'
import { AiRunService } from '../../../../../src/main/services/ai/AiRunService'
import type { BackendTestRuntime } from '../../../../harness/backend/test-types'
import { createScriptedStructuredOutputDriver } from '../../../../harness/backend/scriptedStructuredOutputDriver'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision, buildLearnSkillsDecision } from '../testUtils'

const SESSION_ID = 'resume-snapshot-session'

const buildDeps = async (
  runtime: BackendTestRuntime,
  driver: ReturnType<typeof createScriptedStructuredOutputDriver>,
  humanRuntimeOverrides?: {
    graphRecursionLimit?: number
  }
) => {
  const runtimeSettings = await runtime.storageService.aiRuntimeSettings.get()
  const controller = new AbortController()
  return {
    controller,
    deps: {
      runtimeSettings,
      llmStrategyPreferenceStore: runtime.storageService.llmStrategyPreference,
      llmStore: runtime.llmStore,
      chatStore: runtime.chatStore,
      documentsStore: runtime.documentsStore,
      embeddingService: runtime.embeddingService,
      ensureEmbeddingReady: async () => {
        await runtime.ensureEmbeddingReady()
      },
      docxApplyService: runtime.docxApplyService,
      saveFileChangeRecord: async (record) => {
        await runtime.storageService.aiFileChange.saveRecord(record)
      },
      listFileChangeRecords: async (request) =>
        (await runtime.storageService.aiFileChange.listRecords(request)).items,
      isCancelled: () => controller.signal.aborted,
      abortSignal: controller.signal,
      sendEvent: (event) => runtime.eventCollector.add(event),
      recordLlmIo: (record) => runtime.eventCollector.addLlmIo(record),
      requestApprovalBatch: async () => ({ accepted: true, decisions: [] as never[] }),
      llmDriver: driver,
      humanRuntimeOverrides
    }
  }
}

describe('ai human mock-llm backend', () => {
  it('ai-run-service-resume-snapshot', async () => {
    await runBackendCase({
      caseId: 'ai-run-service-resume-snapshot',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description:
        '验证首轮 timeout/network_error 会保存 session 恢复快照，下一轮同 session 会自动恢复语义上下文并继续完成。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const waitForCondition = async (
          check: () => Promise<boolean> | boolean,
          timeoutMs = 5000
        ): Promise<void> => {
          const deadline = Date.now() + timeoutMs
          for (;;) {
            if (await check()) return
            if (Date.now() >= deadline) throw new Error('condition timed out')
            await new Promise<void>((resolve) => setTimeout(resolve, 20))
          }
        }
        const timeoutDriver = createScriptedStructuredOutputDriver({
          'human.brain': [
            {
              output: buildLearnSkillsDecision({
                skillIds: ['docx-read'],
                summary: '先学习一个 skill 再继续。'
              })
            },
            {
              error: 'llm_call_timeout'
            },
            {
              error: 'llm_call_timeout'
            },
            {
              error: 'llm_call_timeout'
            },
            {
              error: 'llm_call_timeout'
            },
            {
              error: 'llm_call_timeout'
            }
          ]
        })
        await runtime.chatStore.saveChatSession({
          id: SESSION_ID,
          title: 'timeout resume snapshot test',
          created_at: Date.now(),
          workspace_id: 'test-workspace'
        })
        const { deps: timeoutDeps } = await buildDeps(runtime, timeoutDriver)
        const timeoutResult = await AiRunService.getInstance().run(
          {
            runId: `${runtime.runId}-timeout`,
            sessionId: SESSION_ID,
            input: '先学一个 skill，然后继续处理任务。',
            mainModel: {
              configId: 'mock-llm-scripted',
              modelName: 'scripted-llm'
            },
            selectedReferences: [
              {
                kind: 'file',
                workspaceId: 'test-workspace',
                nodeId: 'node-1',
                name: 'seed.txt',
                relativePath: 'seed.txt',
                absolutePath: `${runtime.workspaceRoot}/seed.txt`,
                kbDocumentIds: [],
                kbAvailability: 'not_indexed'
              }
            ],
            workspace: {
              workspaceId: 'test-workspace',
              workspaceName: 'test-workspace',
              rootPath: runtime.workspaceRoot
            }
          },
          timeoutDeps
        )
        const timeoutSnapshot = await runtime.chatStore.getSessionResumeSnapshot(SESSION_ID)
        const skillsAfterTimeout = await runtime.chatStore.getSessionSkillState(SESSION_ID)
        await runtime.chatStore.saveSessionSkillStateIfCurrent({
          sessionId: SESSION_ID,
          expectedRevision: skillsAfterTimeout.revision,
          learnedSkillIds: ['pdf-read'],
          runId: `${runtime.runId}-newer-session-skills`
        })

        let restoredSkillSeen = false
        let restoredRoundSeen = false
        let resumeHintSeen = false
        const secondDriver = createScriptedStructuredOutputDriver({
          'human.brain': [
            ({ user }) => {
              restoredSkillSeen =
                user.includes('工具 pdf_inspect') && !user.includes('工具 docx_read_outline')
              restoredRoundSeen = user.includes('先学习一个 skill 再继续。')
              resumeHintSeen =
                user.includes('上一次运行因请求超时而中断') &&
                user.includes('已恢复最近一次上下文信息')
              return buildCompleteTaskDecision({
                summary: '已从恢复快照继续完成任务。'
              })
            }
          ],
          'human.mouth': [
            {
              text: '已从恢复快照继续完成任务。'
            }
          ]
        })
        const { deps: secondDeps } = await buildDeps(runtime, secondDriver)
        const resumedResult = await AiRunService.getInstance().run(
          {
            runId: `${runtime.runId}-resume`,
            sessionId: SESSION_ID,
            input: '另外补充一个要求：把上次任务继续收尾。',
            mainModel: {
              configId: 'mock-llm-scripted',
              modelName: 'scripted-llm'
            },
            workspace: {
              workspaceId: 'test-workspace',
              workspaceName: 'test-workspace',
              rootPath: runtime.workspaceRoot
            }
          },
          secondDeps
        )
        const skillsAfterResume = await runtime.chatStore.getSessionSkillState(SESSION_ID)
        const clearedSnapshot = await runtime.chatStore.getSessionResumeSnapshot(SESSION_ID)
        const resumeDecisionHintEventSeen = runtime.eventCollector
          .snapshot()
          .some(
            (event) =>
              event.type === 'decision_hint' &&
              event.runId === `${runtime.runId}-resume` &&
              event.code === 'run_resumed_after_interruption' &&
              event.detail?.reason === 'timeout'
          )

        const networkDriver = createScriptedStructuredOutputDriver({
          'human.brain': [
            {
              waitMs: 1,
              thenError: 'fetch failed'
            }
          ]
        })
        await runtime.chatStore.saveChatSession({
          id: `${SESSION_ID}-network`,
          title: 'network resume snapshot test',
          created_at: Date.now(),
          workspace_id: 'test-workspace'
        })
        const { deps: networkDeps } = await buildDeps(runtime, networkDriver)
        const networkResult = await AiRunService.getInstance().run(
          {
            runId: `${runtime.runId}-network`,
            sessionId: `${SESSION_ID}-network`,
            input: '触发网络错误恢复',
            mainModel: {
              configId: 'mock-llm-scripted',
              modelName: 'scripted-llm'
            },
            workspace: {
              workspaceId: 'test-workspace',
              workspaceName: 'test-workspace',
              rootPath: runtime.workspaceRoot
            }
          },
          networkDeps
        )
        const networkSnapshot = await runtime.chatStore.getSessionResumeSnapshot(
          `${SESSION_ID}-network`
        )

        const cancelDriver = createScriptedStructuredOutputDriver({
          'human.brain': [
            {
              output: buildLearnSkillsDecision({
                skillIds: ['docx-read'],
                summary: '取消前已经建立了部分任务进度。'
              })
            },
            async () => await new Promise<never>(() => {})
          ]
        })
        await runtime.chatStore.saveChatSession({
          id: `${SESSION_ID}-cancel`,
          title: 'cancel resume snapshot test',
          created_at: Date.now(),
          workspace_id: 'test-workspace'
        })
        const { controller: cancelController, deps: cancelDeps } = await buildDeps(
          runtime,
          cancelDriver
        )
        const cancelPromise = AiRunService.getInstance().run(
          {
            runId: `${runtime.runId}-cancel`,
            sessionId: `${SESSION_ID}-cancel`,
            input: '触发用户取消恢复',
            mainModel: {
              configId: 'mock-llm-scripted',
              modelName: 'scripted-llm'
            },
            workspace: {
              workspaceId: 'test-workspace',
              workspaceName: 'test-workspace',
              rootPath: runtime.workspaceRoot
            }
          },
          cancelDeps
        )
        await waitForCondition(async () => {
          const snapshot = await runtime.chatStore.getSessionResumeSnapshot(`${SESSION_ID}-cancel`)
          return snapshot?.reason === 'process_interrupted'
        })
        cancelController.abort()
        const cancelResult = await cancelPromise
        const cancelSnapshot = await runtime.chatStore.getSessionResumeSnapshot(
          `${SESSION_ID}-cancel`
        )

        const earlyCancelDriver = createScriptedStructuredOutputDriver({})
        await runtime.chatStore.saveChatSession({
          id: `${SESSION_ID}-early-cancel`,
          title: 'early cancel resume snapshot test',
          created_at: Date.now(),
          workspace_id: 'test-workspace'
        })
        const { controller: earlyCancelController, deps: earlyCancelDeps } = await buildDeps(
          runtime,
          earlyCancelDriver
        )
        earlyCancelController.abort()
        const earlyCancelResult = await AiRunService.getInstance().run(
          {
            runId: `${runtime.runId}-early-cancel`,
            sessionId: `${SESSION_ID}-early-cancel`,
            input: '刚开始就取消也要保存恢复',
            mainModel: {
              configId: 'mock-llm-scripted',
              modelName: 'scripted-llm'
            },
            workspace: {
              workspaceId: 'test-workspace',
              workspaceName: 'test-workspace',
              rootPath: runtime.workspaceRoot
            }
          },
          earlyCancelDeps
        )
        const earlyCancelSnapshot = await runtime.chatStore.getSessionResumeSnapshot(
          `${SESSION_ID}-early-cancel`
        )

        const contentSafetyDriver = createScriptedStructuredOutputDriver({
          'human.brain': [
            {
              error:
                'reason=400 Input data may contain inappropriate content; code=inappropriate-content'
            }
          ],
          'human.mouth': [
            {
              text: '本次处理受到内容安全限制，已完成说明。'
            }
          ]
        })
        await runtime.chatStore.saveChatSession({
          id: `${SESSION_ID}-content-safety`,
          title: 'content safety clears snapshot test',
          created_at: Date.now(),
          workspace_id: 'test-workspace'
        })
        await runtime.chatStore.saveSessionResumeSnapshot(`${SESSION_ID}-content-safety`, {
          reason: 'process_interrupted',
          runId: `${runtime.runId}-content-safety-old`,
          userInput: '旧快照',
          selectedReferences: [],
          humanState: {},
          errorMessage: '旧快照',
          updatedAt: Date.now()
        })
        const { deps: contentSafetyDeps } = await buildDeps(runtime, contentSafetyDriver)
        const contentSafetyResult = await AiRunService.getInstance().run(
          {
            runId: `${runtime.runId}-content-safety`,
            sessionId: `${SESSION_ID}-content-safety`,
            input: '触发内容安全收口',
            mainModel: {
              configId: 'mock-llm-scripted',
              modelName: 'scripted-llm'
            },
            workspace: {
              workspaceId: 'test-workspace',
              workspaceName: 'test-workspace',
              rootPath: runtime.workspaceRoot
            }
          },
          contentSafetyDeps
        )
        const contentSafetySnapshot = await runtime.chatStore.getSessionResumeSnapshot(
          `${SESSION_ID}-content-safety`
        )

        const ordinaryDriver = createScriptedStructuredOutputDriver({
          'human.brain': [
            {
              error: 'structured_output_failed'
            }
          ]
        })
        await runtime.chatStore.saveChatSession({
          id: `${SESSION_ID}-error`,
          title: 'ordinary error snapshot test',
          created_at: Date.now(),
          workspace_id: 'test-workspace'
        })
        const { deps: ordinaryDeps } = await buildDeps(runtime, ordinaryDriver)
        const ordinaryResult = await AiRunService.getInstance().run(
          {
            runId: `${runtime.runId}-error`,
            sessionId: `${SESSION_ID}-error`,
            input: '触发普通错误',
            mainModel: {
              configId: 'mock-llm-scripted',
              modelName: 'scripted-llm'
            },
            workspace: {
              workspaceId: 'test-workspace',
              workspaceName: 'test-workspace',
              rootPath: runtime.workspaceRoot
            }
          },
          ordinaryDeps
        )
        const ordinarySnapshot = await runtime.chatStore.getSessionResumeSnapshot(
          `${SESSION_ID}-error`
        )

        const runtimeLimitSessionId = `${SESSION_ID}-runtime-limit`
        await runtime.chatStore.saveChatSession({
          id: runtimeLimitSessionId,
          title: 'runtime limit resume snapshot test',
          created_at: Date.now(),
          workspace_id: 'test-workspace'
        })
        const runtimeLimitDriver = createScriptedStructuredOutputDriver({
          'human.brain': [
            {
              output: buildLearnSkillsDecision({
                skillIds: ['docx-read'],
                summary: '在低 Graph 上限测试中建立任务进度。'
              })
            }
          ]
        })
        const { deps: runtimeLimitDeps } = await buildDeps(runtime, runtimeLimitDriver, {
          graphRecursionLimit: 4
        })
        const runtimeLimitResult = await AiRunService.getInstance().run(
          {
            runId: `${runtime.runId}-runtime-limit`,
            sessionId: runtimeLimitSessionId,
            input: '验证达到运行上限后恢复原始任务',
            mainModel: {
              configId: 'mock-llm-scripted',
              modelName: 'scripted-llm'
            },
            workspace: {
              workspaceId: 'test-workspace',
              workspaceName: 'test-workspace',
              rootPath: runtime.workspaceRoot
            }
          },
          runtimeLimitDeps
        )
        const runtimeLimitSnapshot =
          await runtime.chatStore.getSessionResumeSnapshot(runtimeLimitSessionId)
        let runtimeLimitTaskGoalSeen = false
        const runtimeLimitResumeDriver = createScriptedStructuredOutputDriver({
          'human.brain': [
            ({ user }) => {
              runtimeLimitTaskGoalSeen =
                user.includes('原始任务：验证达到运行上限后恢复原始任务') &&
                user.includes('任务因达到运行上限而中断') &&
                user.includes('用户随后要求：“继续完成运行上限测试”')
              return buildCompleteTaskDecision({ summary: '运行上限恢复完成。' })
            }
          ],
          'human.mouth': [{ text: '运行上限恢复完成。' }]
        })
        const { deps: runtimeLimitResumeDeps } = await buildDeps(runtime, runtimeLimitResumeDriver)
        const runtimeLimitResumeResult = await AiRunService.getInstance().run(
          {
            runId: `${runtime.runId}-runtime-limit-resume`,
            sessionId: runtimeLimitSessionId,
            input: '继续完成运行上限测试',
            mainModel: {
              configId: 'mock-llm-scripted',
              modelName: 'scripted-llm'
            },
            workspace: {
              workspaceId: 'test-workspace',
              workspaceName: 'test-workspace',
              rootPath: runtime.workspaceRoot
            }
          },
          runtimeLimitResumeDeps
        )

        return {
          timeoutResult,
          timeoutSnapshot,
          skillsAfterTimeout,
          resumedResult,
          skillsAfterResume,
          restoredSkillSeen,
          restoredRoundSeen,
          resumeHintSeen,
          resumeDecisionHintEventSeen,
          clearedSnapshot,
          networkResult,
          networkSnapshot,
          cancelResult,
          cancelSnapshot,
          earlyCancelResult,
          earlyCancelSnapshot,
          contentSafetyResult,
          contentSafetySnapshot,
          ordinaryResult,
          ordinarySnapshot,
          runtimeLimitResult,
          runtimeLimitSnapshot,
          runtimeLimitResumeResult,
          runtimeLimitTaskGoalSeen
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.timeoutResult.status === 'failed' &&
            result.timeoutResult.failureCode === 'timeout' &&
            result.timeoutResult.resumeSnapshotSaved === true &&
            result.timeoutSnapshot?.reason === 'timeout' &&
            result.timeoutSnapshot.selectedReferences.length === 1 &&
            result.timeoutSnapshot.workspace?.rootPath === runtime.workspaceRoot &&
            result.timeoutSnapshot.humanState.skills?.learnedSkillIds?.includes('docx-read') ===
              true &&
            result.skillsAfterTimeout.learnedSkillIds.includes('docx-read') &&
            result.resumedResult.status === 'completed' &&
            result.resumedResult.finalDeliveryMarkdown?.includes('恢复快照') === true &&
            result.skillsAfterResume.learnedSkillIds.join(',') === 'pdf-read' &&
            result.clearedSnapshot === null &&
            result.resumeHintSeen &&
            result.resumeDecisionHintEventSeen &&
            result.networkResult.status === 'failed' &&
            result.networkResult.failureCode === 'network_error' &&
            result.networkResult.resumeSnapshotSaved === true &&
            result.networkSnapshot?.reason === 'network_error' &&
            result.cancelResult.status === 'cancelled' &&
            result.cancelResult.failureCode === 'user_cancelled' &&
            result.cancelResult.resumeSnapshotSaved === true &&
            result.cancelSnapshot?.reason === 'user_cancelled' &&
            JSON.stringify(result.cancelSnapshot).includes('取消前已经建立了部分任务进度') &&
            result.earlyCancelResult.status === 'cancelled' &&
            result.earlyCancelResult.resumeSnapshotSaved === true &&
            result.earlyCancelSnapshot?.reason === 'user_cancelled' &&
            JSON.stringify(result.earlyCancelSnapshot?.humanState).includes('"rounds":[]') &&
            result.contentSafetyResult.status === 'completed' &&
            result.contentSafetySnapshot === null &&
            result.restoredSkillSeen &&
            result.restoredRoundSeen &&
            result.ordinaryResult.status === 'failed' &&
            result.ordinaryResult.failureCode === 'unexpected_error' &&
            result.ordinaryResult.resumeSnapshotSaved === true &&
            result.ordinarySnapshot?.reason === 'unexpected_error' &&
            result.runtimeLimitResult.status === 'failed' &&
            result.runtimeLimitResult.failureCode === 'runtime_limit' &&
            result.runtimeLimitResult.error === '已达到运行上限，可继续对话推进' &&
            result.runtimeLimitSnapshot?.reason === 'runtime_limit' &&
            result.runtimeLimitResumeResult.status === 'completed' &&
            result.runtimeLimitTaskGoalSeen,
          {
            name: 'ai-run-service-saves-and-restores-session-resume-snapshot',
            message:
              'timeout/network_error 和未知异常都应保存恢复快照，并在下一轮同 session 自动恢复。',
            data: result
          }
        )
      }
    })
  })
})
