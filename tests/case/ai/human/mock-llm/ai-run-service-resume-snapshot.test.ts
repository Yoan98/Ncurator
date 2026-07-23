import { describe, it } from 'vitest'
import { AiRunService } from '../../../../../src/main/services/ai/AiRunService'
import type { BackendTestRuntime } from '../../../../harness/backend/test-types'
import { createScriptedStructuredOutputDriver } from '../../../../harness/backend/scriptedStructuredOutputDriver'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision, buildLearnSkillsDecision } from '../testUtils'

const SESSION_ID = 'resume-snapshot-session'

const buildDeps = async (
  runtime: BackendTestRuntime,
  driver: ReturnType<typeof createScriptedStructuredOutputDriver>
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
      llmDriver: driver
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
                user.includes('上一次运行因 timeout 中断') &&
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
            input: '继续',
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

        return {
          timeoutResult,
          timeoutSnapshot,
          skillsAfterTimeout,
          resumedResult,
          skillsAfterResume,
          restoredSkillSeen,
          restoredRoundSeen,
          resumeHintSeen,
          clearedSnapshot,
          networkResult,
          networkSnapshot,
          ordinaryResult,
          ordinarySnapshot
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
            result.networkResult.status === 'failed' &&
            result.networkResult.failureCode === 'network_error' &&
            result.networkResult.resumeSnapshotSaved === true &&
            result.networkSnapshot?.reason === 'network_error' &&
            result.restoredSkillSeen &&
            result.restoredRoundSeen &&
            result.ordinaryResult.status === 'failed' &&
            result.ordinaryResult.failureCode === 'error' &&
            result.ordinaryResult.resumeSnapshotSaved === false &&
            result.ordinarySnapshot === null,
          {
            name: 'ai-run-service-saves-and-restores-session-resume-snapshot',
            message:
              'timeout/network_error 应保存恢复快照并在下一轮同 session 自动恢复；普通 error 不应保留恢复快照。',
            data: result
          }
        )
      }
    })
  })
})
