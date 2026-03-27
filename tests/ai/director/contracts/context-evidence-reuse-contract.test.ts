import { describe, it } from 'vitest'
import { createContextEnrichNode } from '../../../../src/main/services/ai/director/node/humanSubtasks'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  createQueuedDirectorHumanTaskRunner,
  createTestDirectorState,
  filterDirectorEventsByType
} from '../testUtils'

describe('ai director contracts backend', () => {
  it('context-evidence-reuse-contract', async () => {
    await runBackendCase({
      caseId: 'context-evidence-reuse-contract',
      domain: 'ai',
      suite: 'director',
      groups: ['contracts'],
      description: '验证 context note 只提取可复用证据，不原样回写整段上下文说明。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const humanRunner = createQueuedDirectorHumanTaskRunner([
          {
            summary: '这里是一大段解释性总结，不应整体写入 contextEvidence。',
            deliveryMarkdown: [
              '# 上下文补充结果',
              '',
              '## 本轮结论',
              '已识别到关键合规约束。',
              '',
              '## 可复用证据',
              '- 已存在证据',
              '- 新增的合规检查窗口是周三下午',
              '',
              '## 当前边界',
              '- 这段边界说明不能进入 contextEvidence',
              '',
              '## 未决项',
              '无',
              '',
              '## 建议补充方向',
              '- 如需继续可补充排期窗口。'
            ].join('\n'),
            assertTask: ({ taskInput, options }) => {
              if (taskInput.taskId !== 'context-1') {
                throw new Error(`unexpected context taskId: ${taskInput.taskId}`)
              }
              if (options?.deliveryMode !== 'context_note' || options?.internalDelivery !== true) {
                throw new Error('context evidence contract 必须以 context_note/internalDelivery 运行。')
              }
            }
          }
        ])
        const ctx = runtime.createAiRunContext()
        const node = createContextEnrichNode({
          ctx,
          runHumanTask: humanRunner.runner
        })

        const patch = await node(
          createTestDirectorState({
            runId: runtime.runId,
            contextRounds: 0,
            contextObjective: '补充发布检查窗口',
            contextEvidence: ['已存在证据'],
            input: '请继续补齐发布前的上下文。'
          })
        )

        return {
          patch,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const startedEvents = filterDirectorEventsByType(result.events, 'task_started')
        const completedEvents = filterDirectorEventsByType(result.events, 'task_completed')

        runtime.assertThat(
          result.patch.contextRounds === 1 &&
            result.patch.contextObjective === undefined &&
            result.patch.directorStage === 'director_intent' &&
            result.patch.contextEvidence?.length === 2 &&
            result.patch.contextEvidence?.[0] === '已存在证据' &&
            result.patch.contextEvidence?.[1] === '新增的合规检查窗口是周三下午' &&
            !result.patch.contextEvidence?.includes('这段边界说明不能进入 contextEvidence') &&
            !result.patch.contextEvidence?.includes('这里是一大段解释性总结，不应整体写入 contextEvidence。'),
          {
            name: 'context-note-reuses-only-evidence-section',
            message:
              'context-evidence-reuse-contract 应只从“可复用证据”区块提取高价值 evidence，并按去重逻辑合并。',
            data: {
              patch: result.patch
            }
          }
        )

        runtime.assertThat(
          startedEvents.length === 1 &&
            completedEvents.length === 1 &&
            startedEvents[0]?.taskId === 'context-1' &&
            startedEvents[0]?.stage === 'director_context_human',
          {
            name: 'context-note-contract-emits-stable-subtask-events',
            message:
              'context-evidence-reuse-contract 应为 context human 发出稳定的 task_started/task_completed 事件。',
            data: {
              startedEvents,
              completedEvents
            }
          }
        )
      }
    })
  })
})
