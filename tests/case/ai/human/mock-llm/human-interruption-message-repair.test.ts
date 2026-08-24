import { describe, it } from 'vitest'
import type { BaseMessage, ToolMessage } from '@langchain/core/messages'
import { AiRunService } from '../../../../../src/main/services/ai/AiRunService'
import { AiFileChangeService } from '../../../../../src/main/services/ai/fileChanges/AiFileChangeService'
import type { BackendTestRuntime } from '../../../../harness/backend/test-types'
import { createScriptedStructuredOutputDriver } from '../../../../harness/backend/scriptedStructuredOutputDriver'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { AiRunDeps } from '../../../../../src/main/services/ai/types'
import { buildCompleteTaskDecision, buildLearnSkillsDecision } from '../testUtils'

const ORDER_SESSION_ID = 'interruption-repair-order-session'
const DANGLING_SESSION_ID = 'interruption-repair-dangling-session'

const buildDeps = async (input: {
  runtime: BackendTestRuntime
  driver: ReturnType<typeof createScriptedStructuredOutputDriver>
  controller: AbortController
  chatToolsWrapper?: AiRunDeps['chatToolsWrapper']
}): Promise<AiRunDeps> => {
  const runtimeSettings = await input.runtime.storageService.aiRuntimeSettings.get()
  const aiFileChangeService = new AiFileChangeService(input.runtime.storageService.aiFileChange)
  return {
    runtimeSettings,
    llmStore: input.runtime.llmStore,
    chatStore: input.runtime.chatStore,
    chatMessageLogStore: input.runtime.storageService.chatMessageLog,
    documentsStore: input.runtime.documentsStore,
    embeddingService: input.runtime.embeddingService,
    ensureEmbeddingReady: async () => {
      await input.runtime.ensureEmbeddingReady()
    },
    docxApplyService: input.runtime.docxApplyService,
    saveFileChangeRecord: async (record) => {
      await aiFileChangeService.saveRecord(record, input.runtime.workspaceRoot)
    },
    listFileChangeRecords: async (request) =>
      (await aiFileChangeService.listRecords(request)).items,
    beginTerminalCommandTracking: async (tracking) => {
      await aiFileChangeService.beginTerminalCommandTracking(tracking)
    },
    finishTerminalCommandTracking: async (commandId) =>
      aiFileChangeService.finishTerminalCommandTracking(commandId),
    discardTerminalCommandTracking: (commandId) => {
      aiFileChangeService.discardTerminalCommandTracking(commandId)
    },
    isCancelled: () => input.controller.signal.aborted,
    abortSignal: input.controller.signal,
    sendEvent: (event) => input.runtime.eventCollector.add(event),
    recordLlmIo: (record) => input.runtime.eventCollector.addLlmIo(record),
    requestApprovalBatch: async () => ({ accepted: true, decisions: [] as never[] }),
    llmDriver: input.driver,
    chatToolsWrapper: input.chatToolsWrapper
  }
}

const workspacePayload = (runtime: BackendTestRuntime) => ({
  workspaceId: 'test-workspace',
  workspaceName: 'test-workspace',
  rootPath: runtime.workspaceRoot
})

const lastMessage = (messages: BaseMessage[]): BaseMessage => messages[messages.length - 1]

describe('ai human mock-llm backend', () => {
  it('human-interruption-message-repair', async () => {
    await runBackendCase({
      caseId: 'human-interruption-message-repair',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description:
        '验证续接时消息数组 = system + 历史(含 mouth 交付 user 消息) + 尾部 buildBrainUserMessage user 消息；末条 assistant 悬空 tool_calls 时补 interrupted ToolMessage。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const RUN1_INPUT = '请整理过拟合概念。'
        const RUN2_INPUT = '保留刚才的过拟合信息，再补充反走样。'

        await runtime.chatStore.saveChatSession({
          id: ORDER_SESSION_ID,
          title: 'order session',
          created_at: Date.now(),
          workspace_id: 'test-workspace'
        })
        const run1Driver = createScriptedStructuredOutputDriver({
          'human.brain': [
            {
              output: buildLearnSkillsDecision({
                skillIds: ['docx-read'],
                summary: '先学习 docx-read 技能。'
              })
            },
            { output: buildCompleteTaskDecision({ summary: '已完成过拟合整理。' }) }
          ],
          'human.mouth': [{ text: '已整理过拟合：概念、原因、处理方式。' }]
        })
        const run1Controller = new AbortController()
        const run1Result = await AiRunService.getInstance().run(
          {
            runId: `${runtime.runId}-order-run-1`,
            sessionId: ORDER_SESSION_ID,
            input: RUN1_INPUT,
            mainModel: { configId: 'mock-llm-scripted', modelName: 'scripted-llm' },
            workspace: workspacePayload(runtime)
          },
          await buildDeps({ runtime, driver: run1Driver, controller: run1Controller })
        )

        let run2BrainMessages: BaseMessage[] | null = null
        const captureWrapper: AiRunDeps['chatToolsWrapper'] = (realChatTools) => async (request) => {
          if (request.caller === 'human.brain' && !run2BrainMessages) {
            run2BrainMessages = [...request.messages]
          }
          return await realChatTools(request)
        }
        const run2Driver = createScriptedStructuredOutputDriver({
          'human.brain': [{ output: buildCompleteTaskDecision({ summary: '补充反走样完成。' }) }],
          'human.mouth': [{ text: '已补充反走样对比。' }]
        })
        const run2Controller = new AbortController()
        const run2Result = await AiRunService.getInstance().run(
          {
            runId: `${runtime.runId}-order-run-2`,
            sessionId: ORDER_SESSION_ID,
            input: RUN2_INPUT,
            mainModel: { configId: 'mock-llm-scripted', modelName: 'scripted-llm' },
            workspace: workspacePayload(runtime)
          },
          await buildDeps({
            runtime,
            driver: run2Driver,
            controller: run2Controller,
            chatToolsWrapper: captureWrapper
          })
        )

        await runtime.chatStore.saveChatSession({
          id: DANGLING_SESSION_ID,
          title: 'dangling session',
          created_at: Date.now(),
          workspace_id: 'test-workspace'
        })
        let aborted = false
        const danglingController = new AbortController()
        const abortWrapper: AiRunDeps['chatToolsWrapper'] = (realChatTools) => async (request) => {
          const result = await realChatTools(request)
          if (request.caller === 'human.brain' && !aborted) {
            aborted = true
            danglingController.abort()
          }
          return result
        }
        const danglingRun1Driver = createScriptedStructuredOutputDriver({
          'human.brain': [
            {
              output: buildLearnSkillsDecision({
                skillIds: ['docx-read'],
                summary: '先学习 docx-read 技能再继续。'
              })
            }
          ]
        })
        const danglingRun1Result = await AiRunService.getInstance().run(
          {
            runId: `${runtime.runId}-dangling-run-1`,
            sessionId: DANGLING_SESSION_ID,
            input: '先学习技能再继续处理。',
            mainModel: { configId: 'mock-llm-scripted', modelName: 'scripted-llm' },
            workspace: workspacePayload(runtime)
          },
          await buildDeps({
            runtime,
            driver: danglingRun1Driver,
            controller: danglingController,
            chatToolsWrapper: abortWrapper
          })
        )
        const danglingSnapshot = await runtime.chatStore.getSessionResumeSnapshot(DANGLING_SESSION_ID)

        let danglingRun2Messages: BaseMessage[] | null = null
        const danglingCaptureWrapper: AiRunDeps['chatToolsWrapper'] = (realChatTools) => async (
          request
        ) => {
          if (request.caller === 'human.brain' && !danglingRun2Messages) {
            danglingRun2Messages = [...request.messages]
          }
          return await realChatTools(request)
        }
        const danglingRun2Driver = createScriptedStructuredOutputDriver({
          'human.brain': [{ output: buildCompleteTaskDecision({ summary: '从中断恢复完成。' }) }],
          'human.mouth': [{ text: '已从中断恢复继续完成。' }]
        })
        const danglingRun2Controller = new AbortController()
        const danglingRun2Result = await AiRunService.getInstance().run(
          {
            runId: `${runtime.runId}-dangling-run-2`,
            sessionId: DANGLING_SESSION_ID,
            input: '继续完成刚才的任务。',
            mainModel: { configId: 'mock-llm-scripted', modelName: 'scripted-llm' },
            workspace: workspacePayload(runtime)
          },
          await buildDeps({
            runtime,
            driver: danglingRun2Driver,
            controller: danglingRun2Controller,
            chatToolsWrapper: danglingCaptureWrapper
          })
        )

        const orderLast = run2BrainMessages ? lastMessage(run2BrainMessages) : null
        const orderTypes = (run2BrainMessages || []).map((message) => message.getType())
        const orderHasMouthDelivery = (run2BrainMessages || []).some(
          (message) =>
            message.getType() === 'human' &&
            typeof message.content === 'string' &&
            message.content.includes('现在面向用户交付结果')
        )
        const orderHasRun1Final = (run2BrainMessages || []).some(
          (message) =>
            message.getType() === 'ai' &&
            typeof message.content === 'string' &&
            message.content.includes('已整理过拟合')
        )
        const orderHasRun1User = (run2BrainMessages || []).some(
          (message) =>
            message.getType() === 'human' &&
            typeof message.content === 'string' &&
            message.content === RUN1_INPUT
        )

        const danglingLast = danglingRun2Messages ? lastMessage(danglingRun2Messages) : null
        const danglingToolMessages = (danglingRun2Messages || []).filter(
          (message) => message.getType() === 'tool'
        ) as ToolMessage[]
        const danglingInterrupted = danglingToolMessages.some((message) => {
          const content = String(message.content || '')
          return content.includes('"status":"fail"') && content.includes('interrupted')
        })
        const danglingHasAssistantToolCalls = (danglingRun2Messages || []).some(
          (message) => message.getType() === 'ai' && (message.tool_calls?.length || 0) > 0
        )

        return {
          run1Result,
          run2Result,
          orderTypes,
          orderLastType: orderLast?.getType() || '',
          orderLastContent: typeof orderLast?.content === 'string' ? orderLast.content : '',
          orderHasMouthDelivery,
          orderHasRun1Final,
          orderHasRun1User,
          danglingRun1Result,
          danglingSnapshotReason: danglingSnapshot?.reason || '',
          danglingRun2Result,
          danglingLastType: danglingLast?.getType() || '',
          danglingLastContent: typeof danglingLast?.content === 'string' ? danglingLast.content : '',
          danglingInterrupted,
          danglingHasAssistantToolCalls,
          danglingToolMessageCount: danglingToolMessages.length
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.run1Result.status === 'completed' &&
            result.run2Result.status === 'completed' &&
            result.orderTypes[0] === 'system' &&
            result.orderLastType === 'human' &&
            result.orderLastContent.includes('<task_goal>') &&
            result.orderLastContent.includes('保留刚才的过拟合信息，再补充反走样') &&
            result.orderHasMouthDelivery &&
            result.orderHasRun1Final &&
            result.orderHasRun1User &&
            result.danglingRun1Result.status === 'cancelled' &&
            result.danglingRun1Result.resumeSnapshotSaved === true &&
            result.danglingSnapshotReason === 'user_cancelled' &&
            result.danglingRun2Result.status === 'completed' &&
            result.danglingLastType === 'human' &&
            result.danglingLastContent.includes('<task_goal>') &&
            result.danglingHasAssistantToolCalls &&
            result.danglingInterrupted,
          {
            name: 'human-interruption-message-repair-continues-with-ordered-message-array',
            message:
              '续接消息数组应为 system + 历史(mouth 交付 user 消息与最终答复) + 尾部 buildBrainUserMessage user 消息；悬空 tool_calls 应补 interrupted ToolMessage。',
            data: result
          }
        )
      }
    })
  })
})
