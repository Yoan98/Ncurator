import { describe, expect, it } from 'vitest'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import {
  createHumanTaskContext,
  restoreHumanStateFromResumeSnapshot,
  serializeHumanResumeSnapshot
} from '../../../../src/main/services/ai/utils/resumeSnapshot'
import {
  classifyInterruptionReason,
  isGraphRuntimeLimitError
} from '../../../../src/main/services/ai/utils/runFailure'

describe('ai unit resume task context', () => {
  it('renders every interruption and continuation into one task goal', () => {
    const originalState = createInitialHumanState({
      taskId: 'run-1',
      userInput: '整理资料并生成报告',
      taskContext: createHumanTaskContext('整理资料并生成报告')
    })
    const firstSnapshot = serializeHumanResumeSnapshot(originalState, 'network_error')
    const firstResume = restoreHumanStateFromResumeSnapshot({
      runId: 'run-2',
      userInput: '继续，并重点分析成本',
      reason: 'network_error',
      snapshot: firstSnapshot
    })
    const secondSnapshot = serializeHumanResumeSnapshot(firstResume, 'runtime_limit')
    const secondResume = restoreHumanStateFromResumeSnapshot({
      runId: 'run-3',
      userInput: '继续，把结论整理成表格',
      reason: 'runtime_limit',
      snapshot: secondSnapshot
    })

    expect(secondResume.task.taskContext).toEqual({
      originalGoal: '整理资料并生成报告',
      recoveryHistory: [
        {
          interruptionReason: 'network_error',
          userInput: '继续，并重点分析成本'
        },
        {
          interruptionReason: 'runtime_limit',
          userInput: '继续，把结论整理成表格'
        }
      ]
    })
    expect(secondResume.task.userInput).toContain('原始任务：整理资料并生成报告')
    expect(secondResume.task.userInput).toContain(
      '1. 任务因网络错误而中断；用户随后要求：“继续，并重点分析成本”'
    )
    expect(secondResume.task.userInput).toContain(
      '2. 任务因达到运行上限而中断；用户随后要求：“继续，把结论整理成表格”'
    )
  })

  it('classifies graph and unknown failures as recoverable interruption reasons', () => {
    const graphError = Object.assign(new Error('limit'), {
      name: 'GraphRecursionError',
      lc_error_code: 'GRAPH_RECURSION_LIMIT'
    })

    expect(isGraphRuntimeLimitError(graphError)).toBe(true)
    expect(classifyInterruptionReason(graphError)).toBe('runtime_limit')
    expect(classifyInterruptionReason(new Error('unexpected'))).toBe('unexpected_error')
  })
})
