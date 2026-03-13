import type { AiPlanTask } from '../../../../../shared/types'

const normalizeText = (value: string, fallback = '无'): string => {
  const text = String(value || '').trim()
  return text || fallback
}

const renderSections = (sections: Array<{ label: string; value: string }>): string => {
  return sections
    .map((section) => `## ${section.label}\n${normalizeText(section.value)}`)
    .join('\n\n')
}

const renderContextEvidence = (contextEvidence: string[]): string => {
  const lines = contextEvidence.map((item) => String(item || '').trim()).filter(Boolean)
  if (lines.length === 0) return '无'
  return lines.map((line, index) => `${index + 1}. ${line}`).join('\n')
}

const renderDeliveries = (tasks: AiPlanTask[]): string => {
  if (tasks.length === 0) return '无'
  return tasks
    .map((task, index) =>
      [
        `### 任务 ${index + 1}: ${normalizeText(task.title, task.id)}`,
        `- taskId: ${task.id}`,
        `- 状态: ${task.status}`,
        `- 摘要: ${normalizeText(task.resultMessage || task.error || '', '无')}`,
        `- 正式交付:\n${normalizeText(task.deliveryMarkdown || '', '无')}`
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
    renderSections([
      { label: '原始用户请求', value: input.userInput },
      { label: '当前上下文目标', value: input.contextObjective },
      { label: '已有上下文证据', value: renderContextEvidence(input.contextEvidence) }
    ])
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
    renderSections([
      { label: '用户请求', value: input.userInput },
      { label: '上下文证据', value: renderContextEvidence(input.contextEvidence) }
    ])
  ].join('\n')
}

export const buildPlanTaskObjective = (input: {
  userInput: string
  task: AiPlanTask
  contextEvidence: string[]
  priorDeliveries: AiPlanTask[]
}): string => {
  return [
    '# 计划子任务',
    '',
    '请完成当前子任务，并输出供后续任务继续执行的正式交接文档。',
    '不要直接给最终用户写总结性答复；你的交付应帮助下一个 human 或 synthesis human 继续工作。',
    '',
    renderSections([
      { label: '总体目标', value: input.userInput },
      { label: '当前子任务', value: `${input.task.title}\n${input.task.objective}` },
      { label: '上下文证据', value: renderContextEvidence(input.contextEvidence) },
      { label: '前序任务交付', value: renderDeliveries(input.priorDeliveries) }
    ])
  ].join('\n')
}

export const buildSynthesisHumanObjective = (input: {
  userInput: string
  contextEvidence: string[]
  plan: AiPlanTask[]
}): string => {
  return [
    '# 汇总交付任务',
    '',
    '请基于全部业务任务交付，完成原始用户请求并直接输出最终答复。',
    '如果某些业务任务阻塞或证据不足，必须明确说明当前完成度、阻塞点和建议下一步。',
    '',
    renderSections([
      { label: '原始用户请求', value: input.userInput },
      { label: '上下文证据', value: renderContextEvidence(input.contextEvidence) },
      { label: '全部任务交付', value: renderDeliveries(input.plan) }
    ])
  ].join('\n')
}
