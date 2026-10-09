import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createAiServiceTestRunner } from '../../../../harness/backend/aiServiceHarness'
import {
  withIsolatedModels,
  writeCorruptEmbeddingModel
} from '../../../../harness/backend/modelFixture'
import { writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  readLatestToolResultDataFromEvents
} from '../testUtils'
import type { ScriptedLlmStep } from '../../../../harness/backend/test-types'
import { EMBEDDING_MODEL_NOT_INSTALLED_ERROR } from '../../../../../src/main/services/vector/ensureEmbeddingReady'

describe('AI runs independent of knowledge configuration', () => {
  it('ai-run-service-without-knowledge', async () => {
    await withIsolatedModels(async (modelsPath) => {
      await runBackendCase({
        caseId: 'ai-run-service-without-knowledge',
        domain: 'ai',
        suite: 'human',
        groups: ['mock-llm'],
        harnessMode: 'mock-llm',
        fixtures: [],
        runMode: 'single',
        description: '模型缺失或损坏、无工作地址仍能读取真实文件、派发子任务及续接。',
        assert: async () => {},
        execute: async (runtime) => {
          const sourcePath = path.join(runtime.workspaceRoot, 'local.txt')
          await fs.writeFile(sourcePath, 'LOCAL_READ_EVIDENCE')
          await writeTestDocxFile(runtime.workspaceRoot, 'literal.docx', [
            { type: 'paragraph', text: '反走样减少锯齿现象。' }
          ])
          let parentCalls = 0
          let childCalls = 0
          let childReadConfirmed = false
          const script: ScriptedLlmStep[] = Array.from({ length: 10 }, () => (call) => {
            if (/用户诉求：\nCHILD_LOCAL_READ/.test(call.user)) {
              childCalls += 1
              if (childCalls > 1) childReadConfirmed = call.user.includes('LOCAL_READ_EVIDENCE')
              return childCalls === 1
                ? buildToolDecision({
                    toolName: 'text_file_read',
                    args: { sourcePath },
                    summary: '读取明确指定的文件'
                  })
                : buildCompleteTaskDecision({ summary: '子任务已读到真实文件' })
            }
            parentCalls += 1
            if (parentCalls === 1)
              return buildLearnSkillsDecision({
                skillIds: ['docx-read'],
                summary: '学习原文读取能力'
              })
            if (parentCalls === 2)
              return buildToolDecision({
                toolName: 'docx_search',
                args: {
                  sourcePath: path.join(runtime.workspaceRoot, 'literal.docx'),
                  query: '锯齿现象',
                  mode: 'literal'
                },
                summary: '读取 DOCX 原文'
              })
            if (parentCalls === 3)
              return buildToolDecision({
                toolName: 'delegate_to_subagent',
                args: { tasks: [{ name: '读取', task: 'CHILD_LOCAL_READ 读取指定本地文本' }] },
                summary: '派发文件读取子任务'
              })
            return buildCompleteTaskDecision({ summary: '读取完成' })
          })
          const runner = await createAiServiceTestRunner(runtime, {
            bindWorkspace: false,
            partnerId: 'knowledge-independent',
            llmScript: { 'human.brain': script }
          })
          const output = await runner.run()
          expect(output.status).toBe('completed')
          expect(
            readLatestToolResultDataFromEvents<{ totalMatchCount: number }>(
              runner.events,
              'docx_search'
            ).totalMatchCount
          ).toBeGreaterThan(0)
          expect(childReadConfirmed).toBe(true)
          expect(
            runner.events.some(
              (e) => e.type === 'subagent_updated' && e.update.status === 'completed'
            )
          ).toBe(true)
          expect(childCalls).toBeGreaterThan(0)
          expect(runtime.embeddingService.getStatus()).toBe('uninitialized')
          expect(await fs.readdir(modelsPath)).toEqual([])

          await writeCorruptEmbeddingModel(modelsPath)
          const before = await fs.readdir(modelsPath, { recursive: true })
          const resumed = await createAiServiceTestRunner(runtime, {
            bindWorkspace: false,
            partnerId: 'knowledge-independent',
            runId: `${runtime.runId}-continue`,
            userInput: '继续确认刚才的结果',
            llmScript: {
              'human.brain': [{ output: buildCompleteTaskDecision({ summary: '续接完成' }) }]
            }
          })
          expect((await resumed.run()).status).toBe('completed')
          expect(runtime.embeddingService.getStatus()).toBe('uninitialized')
          expect(await fs.readdir(modelsPath, { recursive: true })).toEqual(before)
          runtime.assertThat(true, {
            name: 'runs-without-embedding',
            message: '主运行、子任务与续接无需 embedding，真实文件读取成功且模型目录不变。'
          })
        }
      })
    })
  })

  it('ai-run-service-kb-error-continues', async () => {
    await withIsolatedModels(async (modelsPath) => {
      await runBackendCase({
        caseId: 'ai-run-service-kb-error-continues',
        domain: 'ai',
        suite: 'human',
        groups: ['mock-llm'],
        harnessMode: 'mock-llm',
        fixtures: [],
        runMode: 'single',
        description: '真实 KB 模型缺失错误进入模型上下文，后续真实文件读取与交付继续。',
        assert: async () => {},
        execute: async (runtime) => {
          const sourcePath = path.join(runtime.workspaceRoot, 'source.txt')
          await fs.writeFile(sourcePath, 'KB_FAILURE_CONTINUED')
          const runner = await createAiServiceTestRunner(runtime, {
            bindWorkspace: false,
            llmScript: {
              'human.brain': [
                {
                  output: buildToolDecision({
                    toolName: 'kb_search',
                    args: { queryText: '资料' },
                    summary: '查询资料'
                  })
                },
                (call) => {
                  expect(call.user).toContain(EMBEDDING_MODEL_NOT_INSTALLED_ERROR)
                  expect(call.user).toContain('不要继续调用 KB')
                  return buildToolDecision({
                    toolName: 'text_file_read',
                    args: { sourcePath },
                    summary: '读取明确指定的文件'
                  })
                },
                { output: buildCompleteTaskDecision({ summary: '已读取文件，知识库暂不可用' }) }
              ]
            }
          })
          expect((await runner.run()).status).toBe('completed')
          expect(
            runner.events.some(
              (e) =>
                e.type === 'tool_call_result' &&
                e.toolName === 'kb_search' &&
                e.result?.ok === false
            )
          ).toBe(true)
          expect(
            readLatestToolResultDataFromEvents<{ content: string }>(runner.events, 'text_file_read')
              .content
          ).toContain('KB_FAILURE_CONTINUED')
          expect(runner.events.some((e) => e.type === 'run_failed')).toBe(false)
          expect(runtime.embeddingService.getStatus()).toBe('uninitialized')
          expect(await fs.readdir(modelsPath)).toEqual([])
          runtime.assertThat(true, {
            name: 'kb-error-does-not-fail-run',
            message: 'KB 错误已反馈给模型，文件读取与 run 完成，无隐式下载。'
          })
        }
      })
    })
  })
})
