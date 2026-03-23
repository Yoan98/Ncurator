import type { AiPlanTask } from '../../../../../shared/types'
import { normalizeRenderText, renderLineList, renderNamedSections } from '../../utils/render'

const renderContextEvidence = (contextEvidence: string[]): string => {
  return renderLineList(contextEvidence, {
    fallback: '无',
    style: 'numbered'
  })
}

const renderDeliveries = (tasks: AiPlanTask[]): string => {
  if (tasks.length === 0) return '无'
  return tasks
    .map((task, index) =>
      [
        `### 任务 ${index + 1}: ${normalizeRenderText(task.title, task.id)}`,
        `- taskId: ${task.id}`,
        `- 状态: ${task.status}`,
        `- 正式交付:\n${normalizeRenderText(task.deliveryMarkdown || '', '无')}`
      ].join('\n')
    )
    .join('\n\n')
}

export const buildContextHumanObjective = (input: {
  userInput: string
  contextObjective: string
  contextEvidence: string[]
}): string => {
  return [
    '# 上下文补充任务',
    '',
    '请围绕当前缺失信息补充上下文，为后续 intent / planning 提供可复用证据。',
    '不要面向最终用户写答复；重点是确认事实、边界和仍待澄清项。',
    '',
    renderNamedSections(
      [
        { label: '原始用户请求', value: input.userInput },
        { label: '当前上下文目标', value: input.contextObjective },
        { label: '已有上下文证据', value: renderContextEvidence(input.contextEvidence) }
      ],
      {
        fallback: '无',
        style: 'markdown',
        headingLevel: '##'
      }
    )
  ].join('\n')
}

export const buildDirectHumanObjective = (input: {
  userInput: string
  contextEvidence: string[]
}): string => {
  return [
    '# 直接执行任务',
    '',
    '请直接完成用户请求，并输出最终可交付答复。',
    '如果证据不足，必须明确写出未完成或待确认项。',
    '',
    renderNamedSections(
      [
        { label: '用户请求', value: input.userInput },
        { label: '上下文证据', value: renderContextEvidence(input.contextEvidence) }
      ],
      {
        fallback: '无',
        style: 'markdown',
        headingLevel: '##'
      }
    )
  ].join('\n')
}

export const buildPlanTaskObjective = (input: {
  userInput: string
  task: AiPlanTask
  contextEvidence: string[]
  priorDeliveries: AiPlanTask[]
  selectedScopeSummary: string
}): string => {
  return [
    '# 计划子任务',
    '',
    '请完成当前子任务，并输出供后续任务继续执行的正式交接文档。',
    '不要直接给最终用户写总结性答复；你的交付应帮助下一个 human 或 synthesis human 继续工作。',
    '',
    renderNamedSections(
      [
        { label: '总体目标', value: input.userInput },
        { label: '当前子任务', value: `${input.task.title}\n${input.task.userInput}` },
        { label: '已选资料范围', value: input.selectedScopeSummary },
        { label: '上下文证据', value: renderContextEvidence(input.contextEvidence) },
        { label: '前序任务交付', value: renderDeliveries(input.priorDeliveries) }
      ],
      {
        fallback: '无',
        style: 'markdown',
        headingLevel: '##'
      }
    )
  ].join('\n')
}

export const buildSynthesisHumanObjective = (input: {
  userInput: string
  contextEvidence: string[]
  plan: AiPlanTask[]
  selectedScopeSummary: string
}): string => {
  return [
    '# 汇总交付任务',
    '',
    '请基于全部业务任务交付，完成原始用户请求并直接输出最终答复。',
    '如果某些业务任务阻塞或证据不足，必须明确说明当前完成度、阻塞点和建议下一步。',
    '',
    renderNamedSections(
      [
        { label: '原始用户请求', value: input.userInput },
        { label: '已选资料范围', value: input.selectedScopeSummary },
        { label: '上下文证据', value: renderContextEvidence(input.contextEvidence) },
        { label: '全部任务交付', value: renderDeliveries(input.plan) }
      ],
      {
        fallback: '无',
        style: 'markdown',
        headingLevel: '##'
      }
    )
  ].join('\n')
}
