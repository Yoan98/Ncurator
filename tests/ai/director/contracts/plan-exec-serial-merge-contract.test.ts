import { describe, it } from 'vitest'
import { createPlanExecNode } from '../../../../src/main/services/ai/director/node/planExecNode'
import { createSynthesisHumanNode } from '../../../../src/main/services/ai/director/node/humanSubtasks'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  applyDirectorPatch,
  createQueuedDirectorHumanTaskRunner,
  createTestDirectorState,
  createTestFileArtifact,
  filterDirectorEventsByType,
  summarizeDirectorEvents
} from '../testUtils'

describe('ai director contracts backend', () => {
  it('plan-exec-serial-merge-contract', async () => {
    await runBackendCase({
      caseId: 'plan-exec-serial-merge-contract',
      domain: 'ai',
      suite: 'director',
      groups: ['contracts'],
      description: '验证 director_plan_exec 的串行派发、当前任务回写与 synthesis artifacts 合并。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const taskArtifact = createTestFileArtifact({
          path: `${runtime.workspaceRoot}/artifacts/serial-task-preview.docx`,
          summary: 'task-2 产出 docx preview。',
          artifactRole: 'preview'
        })
        const synthesisArtifact = createTestFileArtifact({
          path: `${runtime.workspaceRoot}/artifacts/serial-final-answer.md`,
          capability: 'terminal_exec',
          summary: 'synthesis 产出最终答复。'
        })
        const humanRunner = createQueuedDirectorHumanTaskRunner([
          {
            summary: 'task-1 已完成规则整理。',
            deliveryMarkdown: '# 子任务交付\n\n## 本任务结论\ntask-1 已完成规则整理。\n'
          },
          {
            summary: 'task-2 已完成文档修改。',
            deliveryMarkdown: '# 子任务交付\n\n## 本任务结论\ntask-2 已完成文档修改。\n',
            artifacts: [taskArtifact],
            assertTask: ({ taskInput }) => {
              if (!taskInput.userInput.includes('task-1 已完成规则整理。')) {
                throw new Error('task-2 objective 应包含前序任务交付。')
              }
            }
          },
          {
            summary: '已基于全部计划任务完成综合交付。',
            deliveryMarkdown: '# 处理结果\n\n已完成综合交付。',
            artifacts: [synthesisArtifact]
          }
        ])
        const ctx = runtime.createAiRunContext()
        const planExecNode = createPlanExecNode({
          ctx,
          runHumanTask: humanRunner.runner
        })
        const synthesisNode = createSynthesisHumanNode({
          ctx,
          runHumanTask: humanRunner.runner
        })

        const initialState = createTestDirectorState({
          runId: runtime.runId,
          input: '请先整理规则，再修改文档，最后输出综合结果。',
          contextEvidence: ['已确认当前资料范围。'],
          plan: [
            {
              id: 'task-1',
              title: '整理规则',
              userInput: '整理规则并输出交付。',
              status: 'ready'
            },
            {
              id: 'task-2',
              title: '修改文档',
              userInput: '基于规则修改文档并输出预览。',
              status: 'ready'
            }
          ],
          dispatchCursor: 0,
          directorStage: 'director_plan_exec'
        })

        const patch1 = await planExecNode(initialState)
        const state1 = applyDirectorPatch(initialState, patch1)
        const patch2 = await planExecNode(state1)
        const state2 = applyDirectorPatch(state1, patch2)
        const patch3 = await planExecNode(state2)
        const state3 = applyDirectorPatch(state2, patch3)

        const patch4 = await planExecNode(state3)
        const state4 = applyDirectorPatch(state3, patch4)
        const patch5 = await planExecNode(state4)
        const state5 = applyDirectorPatch(state4, patch5)
        const patch6 = await planExecNode(state5)
        const state6 = applyDirectorPatch(state5, patch6)

        const synthesisPatch = await synthesisNode(state6)
        const finalState = applyDirectorPatch(state6, synthesisPatch)

        return {
          patch1,
          patch3,
          patch6,
          finalState,
          calls: humanRunner.getCalls(),
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const startedEvents = filterDirectorEventsByType(result.events, 'task_started')
        const completedEvents = filterDirectorEventsByType(result.events, 'task_completed')

        runtime.assertThat(
          result.patch1.plan?.[0]?.status === 'running' &&
            result.patch1.plan?.[1]?.status === 'ready' &&
            result.patch3.plan?.[0]?.status === 'completed' &&
            result.patch3.plan?.[1]?.status === 'ready' &&
            result.patch6.plan?.[0]?.status === 'completed' &&
            result.patch6.plan?.[1]?.status === 'completed' &&
            result.patch6.directorStage === 'director_synthesis_human',
          {
            name: 'plan-exec-updates-only-current-task-serially',
            message:
              'plan-exec-serial-merge-contract 应按 cursor 串行推进，只更新当前任务状态，并在所有任务完成后进入 synthesis。',
            data: {
              patch1: result.patch1,
              patch3: result.patch3,
              patch6: result.patch6
            }
          }
        )

        runtime.assertThat(
          result.calls.length === 3 &&
            startedEvents.map((event) => event.taskId).join(',') === 'task-1,task-2,synthesis-human' &&
            completedEvents.map((event) => event.taskId).join(',') ===
              'task-1,task-2,synthesis-human' &&
            result.finalState.finalArtifacts.length === 2 &&
            result.finalState.finalDeliveryMarkdown === '# 处理结果\n\n已完成综合交付。',
          {
            name: 'plan-exec-merges-plan-and-synthesis-artifacts',
            message:
              'plan-exec-serial-merge-contract 应把 plan 阶段与 synthesis 阶段的 artifacts 合并到 finalArtifacts，并保持事件顺序稳定。',
            data: {
              finalArtifacts: result.finalState.finalArtifacts,
              events: summarizeDirectorEvents(result.events)
            }
          }
        )
      }
    })
  })
})
