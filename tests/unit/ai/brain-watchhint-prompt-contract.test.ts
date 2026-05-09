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

describe('ai unit brain watchhint prompt contract', () => {
  it('renders current watch hint only in correction_hint, not latest_attempt', () => {
    const state = createInitialHumanState({
      taskId: 'task-1',
      userInput: '继续处理 docx'
    })

    state.execution.currentDecision = {
      decision: {
        summary: '继续处理 docx 批量写',
        reason: '上一轮已经执行到一半，需要基于最新安全修订继续决策。',
        expectedOutcome: '根据当前停机现状决定后续动作。'
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

    state.memory.history.roundHistory = [
      {
        roundId: 1,
        createdAt: 1,
        decision: state.execution.currentDecision,
        execution: {
          kind: 'hand',
          toolUsePlan: state.execution.currentDecision.nextAction.action === 'hand'
            ? state.execution.currentDecision.nextAction.toolUsePlan
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
          watchHint: {
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

    state.execution.watchHint = {
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

    const prompt = buildBrainPrompt({
      state,
      ctx: createFakeCtx()
    }).user

    const latestAttemptSection = prompt.match(/<latest_attempt>([\s\S]*?)<\/latest_attempt>/)?.[1] || ''
    const correctionHintSection = prompt.match(/<correction_hint>([\s\S]*?)<\/correction_hint>/)?.[1] || ''

    expect(latestAttemptSection).not.toContain('上一轮 docx 批量写在中途安全停止。')
    expect(correctionHintSection).toContain('上一轮 docx 批量写在中途安全停止。')
    expect(correctionHintSection).toContain('lastSafeRevisionRef=v2')
  })
})
