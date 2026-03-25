import { test } from 'vitest'
import { validatePlannerTasks } from '../../../../../src/main/services/ai/director/node/helpers'

test('director-plan-validation', () => {
  const emptyValidation = validatePlannerTasks([])
  if (emptyValidation !== 'tasks: at least one task is required') {
    throw new Error(`expected empty planner result to fail: ${String(emptyValidation)}`)
  }

  const textOnlyTasks = [
    {
      title: '最终总结',
      userInput: '总结结果'
    },
    {
      title: '继续优化',
      userInput: '继续优化文档'
    }
  ]
  const textValidation = validatePlannerTasks(textOnlyTasks)
  if (textValidation !== undefined) {
    throw new Error(
      `expected planner validation to avoid text matching rejections: ${String(textValidation)}`
    )
  }
})
