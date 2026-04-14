import { describe, it } from 'vitest'
import { AiRunService } from '../../../../src/main/services/ai/AiRunService'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { createScriptedStructuredOutputDriver } from '../../../harness/backend/scriptedStructuredOutputDriver'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import type { DocxOpenResult, DocxSearchResult } from '../../tool/docx/testUtils'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType,
  readLatestToolResultDataFromEvents
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('ai-run-service-embedding-preflight', async () => {
    await runBackendCase({
      caseId: 'ai-run-service-embedding-preflight',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 AiRunService 会在进入 human 前完成 embedding preflight，并支撑 semantic docx search。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'semantic-docx.docx', [
          {
            type: 'paragraph',
            text: '反走样是在采样不足时出现的锯齿现象。'
          }
        ])

        let ensureReadyCalls = 0
        const initialEmbeddingStatus = runtime.embeddingService.getStatus()
        const runtimeSettings = await runtime.storageService.aiRuntimeSettings.get()
        const result = await AiRunService.getInstance().run(
          {
            runId: runtime.runId,
            sessionId: 'embedding-preflight-session',
            input: '请读取 docx，并用 semantic search 找到反走样相关内容。',
            workspace: {
              workspaceId: 'test-workspace',
              workspaceName: 'test-workspace',
              rootPath: runtime.workspaceRoot
            }
          },
          {
            runtimeSettings,
            llmStore: runtime.llmStore,
            chatStore: runtime.chatStore,
            documentsStore: runtime.documentsStore,
            embeddingService: runtime.embeddingService,
            ensureEmbeddingReady: async () => {
              ensureReadyCalls += 1
              await runtime.ensureEmbeddingReady()
            },
            draftReviewService: runtime.draftReviewService,
            isCancelled: () => false,
            sendEvent: (event) => runtime.eventCollector.add(event),
            recordLlmIo: (record) => runtime.eventCollector.addLlmIo(record),
            requestApproval: async () => ({ approved: true }),
            llmDriver: createScriptedStructuredOutputDriver({
              'human.brain': [
                {
                  output: buildLearnSkillsDecision({
                    skillIds: ['docx-read'],
                    summary: '先学习 docx-read',
                    reason: '需要读取当前工作区 docx。',
                    expectedOutcome: '获得 docx 读取工具。'
                  })
                },
                {
                  output: buildToolDecision({
                  toolName: 'docx_open',
                  args: {
                    sourcePath: 'semantic-docx.docx'
                  },
                  summary: '打开文档',
                  reason: '语义搜索前必须先初始化文档会话。',
                  expectedOutcome: '获得可继续搜索的当前版本。'
                })
              },
                () => {
                  const openResult = readLatestToolResultDataFromEvents<DocxOpenResult>(
                    runtime.eventCollector.snapshot(),
                    'docx_open'
                  )
                  return buildToolDecision({
                    toolName: 'docx_search',
                    args: {
                      sourcePath: openResult.sourcePath,
                      query: '反走样',
                      mode: 'semantic'
                    },
                    summary: '执行语义检索',
                    reason: '验证 semantic docx search 在 run 前置 preflight 后可用。',
                    expectedOutcome: '命中相关 block。'
                  })
                },
                {
                  output: buildCompleteTaskDecision({
                    summary: 'embedding preflight 已验证。',
                    reason: 'semantic search 已返回真实结果。',
                    expectedOutcome: '输出最终答复。'
                  })
                }
              ],
              'human.mouth': [
                {
                  output: {
                    summary: 'embedding preflight 已验证。',
                    deliveryMarkdown: '# Embedding Preflight\n\nsemantic docx search 已可用。'
                  }
                }
              ]
            })
          }
        )

        return {
          result,
          ensureReadyCalls,
          initialEmbeddingStatus,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const semanticSearchResult = readLatestToolResultDataFromEvents<DocxSearchResult>(
          result.events,
          'docx_search'
        )

        runtime.assertThat(
          result.initialEmbeddingStatus === 'uninitialized' &&
            result.ensureReadyCalls === 1 &&
            result.result.status === 'completed' &&
            semanticSearchResult.matches.length >= 1,
          {
            name: 'ai-run-service-preflights-embedding-before-human',
            message: 'AiRunService 应在进入 human 前完成 embedding preflight，并让 semantic docx search 直接可用。',
            data: {
              initialEmbeddingStatus: result.initialEmbeddingStatus,
              ensureReadyCalls: result.ensureReadyCalls,
              semanticSearchResult,
              finalStatus: result.result.status
            }
          }
        )
      }
    })
  })

  it('ai-run-service-embedding-preflight-failure', async () => {
    await runBackendCase({
      caseId: 'ai-run-service-embedding-preflight-failure',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 embedding preflight 失败时，AiRunService 会在进入 human 前直接失败收口。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runtimeSettings = await runtime.storageService.aiRuntimeSettings.get()
        const result = await AiRunService.getInstance().run(
          {
            runId: runtime.runId,
            sessionId: 'embedding-preflight-failure-session',
            input: '这轮不应该进入 human。',
            workspace: {
              workspaceId: 'test-workspace',
              workspaceName: 'test-workspace',
              rootPath: runtime.workspaceRoot
            }
          },
          {
            runtimeSettings,
            llmStore: runtime.llmStore,
            chatStore: runtime.chatStore,
            documentsStore: runtime.documentsStore,
            embeddingService: runtime.embeddingService,
            ensureEmbeddingReady: async () => {
              throw new Error('embedding preflight failed for test')
            },
            draftReviewService: runtime.draftReviewService,
            isCancelled: () => false,
            sendEvent: (event) => runtime.eventCollector.add(event),
            recordLlmIo: (record) => runtime.eventCollector.addLlmIo(record),
            requestApproval: async () => ({ approved: true }),
            llmDriver: createScriptedStructuredOutputDriver({})
          }
        )

        return {
          result,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const humanSteps = filterAiRunEventsByType(result.events, 'human_step')

        runtime.assertThat(
          result.result.status === 'failed' &&
            result.result.error?.includes('embedding preflight failed for test') === true &&
            humanSteps.length === 0,
          {
            name: 'ai-run-service-aborts-before-human-on-preflight-failure',
            message: 'embedding preflight 失败时，run 应直接失败，且不进入任何 human stage。',
            data: {
              status: result.result.status,
              error: result.result.error,
              humanStepCount: humanSteps.length
            }
          }
        )
      }
    })
  })
})
