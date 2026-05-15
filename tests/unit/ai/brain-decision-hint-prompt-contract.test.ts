import { describe, expect, it } from 'vitest'
import { buildBrainPrompt } from '../../../src/main/services/ai/human/prompts/brain'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import type { AiRunContext } from '../../../src/main/services/ai/types'

const createFakeCtx = (): AiRunContext =>
  ({
    platform: 'darwin',
    runId: 'run-1',
    workspace: {
      id: 'ws-1',
      rootPath: '/tmp/workspace'
    },
    referenceScope: {
      workspace: {
        id: 'ws-1',
        rootPath: '/tmp/workspace'
      },
      selectedReferences: []
    }
  }) as AiRunContext

describe('ai unit brain decision-hint prompt contract', () => {
  it('renders current decision hint in decision_hint and keeps latest execution in task_progress', () => {
    const state = createInitialHumanState({
      taskId: 'task-1',
      userInput: '继续处理 docx'
    })

    state.execution.currentThought = {
      thought: {
        next: '继续处理 docx 批量写',
      },
      nextAction: {
        action: 'hand',
        toolUsePlan: {
          mode: 'serial',
          calls: [
            {
              toolName: 'docx_paragraph_edit',
              args: {
                sourcePath: 'report.docx',
                action: 'insert_after',
                anchorBlockId: 'b:1',
                text: '补充内容'
              }
            }
          ]
        }
      }
    }

    state.memory.taskRun.rounds = [
      {
        roundId: 1,
        createdAt: 1,
        thought: state.execution.currentThought,
        execution: {
          kind: 'hand',
          toolUsePlan: state.execution.currentThought.nextAction.action === 'hand'
            ? state.execution.currentThought.nextAction.toolUsePlan
            : { mode: 'serial', calls: [] },
          toolResults: [
            {
              toolName: 'docx_paragraph_edit',
              ok: false,
              code: 'invalid_input',
              summary: 'tool call failed',
              data: {
                ok: false,
                code: 'invalid_input',
                error: 'cannot safely resolve target after earlier mutations'
              },
              diagnosticText: 'cannot safely resolve target after earlier mutations'
            }
          ],
          decisionHint: {
            code: 'hand_docx_batch_write_halted',
            detail: {
              sourcePath: 'report.docx',
              lastSafeRevisionRef: 'v2',
              haltedAtCallIndex: 0,
              completedCallCount: 1,
              totalCallCount: 2,
              haltReason: 'locator_confidence_too_low',
              haltSummary: 'cannot safely resolve target after earlier mutations',
              completedItems: ['docx_paragraph_edit#1'],
              pendingItems: ['docx_paragraph_edit#2'],
              failedItem: 'docx_paragraph_edit#2',
              recoveryContext: '当前工作稿已停在 v2；已完成写入保留，未完成写入未执行。'
            }
          }
        }
      }
    ]

    state.execution.pendingDecisionHint = {
      code: 'hand_docx_batch_write_halted',
      detail: {
        sourcePath: 'report.docx',
        lastSafeRevisionRef: 'v2',
        haltedAtCallIndex: 0,
        completedCallCount: 1,
        totalCallCount: 2,
        haltReason: 'locator_confidence_too_low',
        haltSummary: 'cannot safely resolve target after earlier mutations',
        completedItems: ['docx_paragraph_edit#1'],
        pendingItems: ['docx_paragraph_edit#2'],
        failedItem: 'docx_paragraph_edit#2',
        recoveryContext: '当前工作稿已停在 v2；已完成写入保留，未完成写入未执行。'
      }
    }

    state.memory.thought = {
      next: '这段不应直接出现在 task_progress 的判断段落',
      todolist: [
        {
          item: '修正文档写入',
          status: 'todo'
        }
      ],
      progressionSummary: '已发现批量写在中途安全停止，需要按最新执行结果重新判断。'
    }

    const prompt = buildBrainPrompt({
      state,
      ctx: createFakeCtx()
    }).user

    const taskProgressSection = prompt.match(/<task_progress>([\s\S]*?)<\/task_progress>/)?.[1] || ''
    const correctionHintSection = prompt.match(/<decision_hint>([\s\S]*?)<\/decision_hint>/)?.[1] || ''

    expect(prompt).not.toContain('<latest_round>')
    expect(taskProgressSection).toContain('最新一轮决策如下')
    expect(taskProgressSection).toContain('判断：')
    expect(taskProgressSection).toContain('继续处理 docx 批量写')
    expect(taskProgressSection).toContain('执行：')
    expect(taskProgressSection).toContain('类型：hand')
    expect(taskProgressSection).toContain('cannot safely resolve target after earlier mutations')
    expect(taskProgressSection).not.toContain('上一轮 docx 批量写在中途安全停止。')
    expect(correctionHintSection).toContain('上一轮 docx 批量写在中途安全停止。')
    expect(correctionHintSection).toContain('lastSafeRevisionRef=v2')
  })

  it('requires references disclosure when nextAction is mouth', () => {
    const state = createInitialHumanState({
      taskId: 'task-2',
      userInput: '总结依据'
    })

    const prompt = buildBrainPrompt({
      state,
      ctx: createFakeCtx()
    }).system

    expect(prompt).toContain('nextAction为mouth时：')
    expect(prompt).toContain('nextAction.references')
    expect(prompt).toContain('usedFor')
    expect(prompt).toContain('支撑了最终交付的哪些地方')
  })

  it('renders conversation_history, round_history, and task_progress under the new contract', () => {
    const state = createInitialHumanState({
      taskId: 'task-3',
      userInput: '继续处理资料'
    })

    state.memory.thought = {
      next: '这段不应作为 thought 区块正文出现',
      todolist: [
        {
          item: '核对资料范围',
          status: 'todo'
        }
      ],
      progressionSummary: '已建立初始推进基线。'
    }

    const prompt = buildBrainPrompt({
      state,
      ctx: createFakeCtx()
    })

    expect(prompt.system).toContain('conversation_history：当前会话历史视图。')
    expect(prompt.system).toContain('round_history：当前任务的历史证据视图。')
    expect(prompt.system).toContain('task_progress：当前任务的全局进度信息。')
    expect(prompt.user).toContain('<task_progress>')
    expect(prompt.user).toContain('</task_progress>')
    expect(prompt.user).toContain('<conversation_history>')
    expect(prompt.user).toContain('<summary>')
    expect(prompt.user).toContain('<recent_turns>')
    expect(prompt.user).toContain('<round_history>')
    expect(prompt.user).toContain('<compactions>')
    expect(prompt.user).toContain('<rounds>')
    expect(prompt.user).not.toContain('<conversation_context>')
    expect(prompt.user).not.toContain('<task_run_context>')
    expect(prompt.user).not.toContain('<latest_round>')
    expect(prompt.user).not.toContain('<prior_rounds>')
    expect(prompt.user).toContain('待办路径：')
    expect(prompt.user).toContain('推进摘要：')
    expect(prompt.user).toContain('核对资料范围')
    expect(prompt.user).toContain('已建立初始推进基线。')
    expect(prompt.user).not.toContain('<thought>')
    expect(prompt.user).not.toContain('当前与下一步：')
    expect(prompt.user).not.toContain('这段不应作为 thought 区块正文出现')
  })
})
