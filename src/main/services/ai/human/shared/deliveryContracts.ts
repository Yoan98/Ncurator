import type { HumanState } from '../types'
import { renderLineList } from '../../utils/render'
import {
  renderHumanEvidenceLines,
  renderHumanFactLines,
  renderHumanOpenQuestionLines
} from './memoryRenderers'

type StructuredDeliveryMode = 'task_handoff' | 'context_note'

type DeliverySection = {
  heading: string
  body: string
}

type StructuredDeliveryContract = {
  mode: StructuredDeliveryMode
  title: string
  headings: readonly string[]
  exampleSummary: string
  exampleDeliveryMarkdown: string
  buildFallbackSections: (input: { state: HumanState; summary: string }) => DeliverySection[]
}

const buildMarkdownDocument = (input: {
  title: string
  sections: DeliverySection[]
}): string =>
  [
    input.title,
    '',
    ...input.sections.flatMap((section) => [section.heading, section.body, ''])
  ]
    .join('\n')
    .trim()

const renderBulletLines = (lines: Array<string | undefined>): string =>
  renderLineList(lines, {
    fallback: '无',
    style: 'bullet'
  })

const TASK_HANDOFF_CONTRACT: StructuredDeliveryContract = {
  mode: 'task_handoff',
  title: '# 子任务交付',
  headings: [
    '## 本任务结论',
    '## 已完成',
    '## 关键事实',
    '## 关键证据',
    '## 产物与引用',
    '## 未决与风险',
    '## 对后续任务的影响',
    '## 建议下一步'
  ],
  exampleSummary: '已完成本子任务，并整理出可供后续任务承接的关键事实。',
  exampleDeliveryMarkdown:
    '# 子任务交付\n\n## 本任务结论\n已完成本子任务。\n\n## 已完成\n- 已完成关键核对。\n\n## 关键事实\n- 事实一\n\n## 关键证据\n- 证据一\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n- 后续任务可直接继承以上结论。\n\n## 建议下一步\n- 继续执行下一个任务。',
  buildFallbackSections: ({ state, summary }) => {
    const defaultNextStep =
      state.lastBrainDecision?.decision.expectedOutcome || '可基于以上结论继续后续任务。'
    return [
      {
        heading: '## 本任务结论',
        body: summary
      },
      {
        heading: '## 已完成',
        body: renderBulletLines([state.lastBrainDecision?.decision.summary || summary])
      },
      {
        heading: '## 关键事实',
        body: renderHumanFactLines(state, 'fallback_markdown')
      },
      {
        heading: '## 关键证据',
        body: renderHumanEvidenceLines(state, 'fallback_markdown')
      },
      {
        heading: '## 产物与引用',
        body: '无'
      },
      {
        heading: '## 未决与风险',
        body: renderHumanOpenQuestionLines(state, 'fallback_markdown')
      },
      {
        heading: '## 对后续任务的影响',
        body: renderBulletLines(['后续任务应结合以上已确认事实、证据和限制继续推进。'])
      },
      {
        heading: '## 建议下一步',
        body: renderBulletLines([defaultNextStep])
      }
    ]
  }
}

const CONTEXT_NOTE_CONTRACT: StructuredDeliveryContract = {
  mode: 'context_note',
  title: '# 上下文补充结果',
  headings: [
    '## 本轮结论',
    '## 可复用证据',
    '## 当前边界',
    '## 未决项',
    '## 建议补充方向'
  ],
  exampleSummary: '已补充当前上下文，并整理出可复用证据。',
  exampleDeliveryMarkdown:
    '# 上下文补充结果\n\n## 本轮结论\n已补充当前上下文。\n\n## 可复用证据\n- 证据一\n\n## 当前边界\n- 当前确认范围\n\n## 未决项\n无\n\n## 建议补充方向\n- 如需继续，可补充更多材料。',
  buildFallbackSections: ({ state, summary }) => [
    {
      heading: '## 本轮结论',
      body: summary
    },
    {
      heading: '## 可复用证据',
      body: renderHumanEvidenceLines(state, 'fallback_markdown')
    },
    {
      heading: '## 当前边界',
      body: renderBulletLines([
        state.lastBrainDecision?.decision.summary || summary,
        state.lastBrainDecision?.decision.reason || '当前边界以已确认事实和证据为准。'
      ])
    },
    {
      heading: '## 未决项',
      body: renderHumanOpenQuestionLines(state, 'fallback_markdown')
    },
    {
      heading: '## 建议补充方向',
      body: renderBulletLines([state.lastBrainDecision?.decision.expectedOutcome || '无'])
    }
  ]
}

const STRUCTURED_DELIVERY_CONTRACTS: Record<StructuredDeliveryMode, StructuredDeliveryContract> = {
  task_handoff: TASK_HANDOFF_CONTRACT,
  context_note: CONTEXT_NOTE_CONTRACT
}

const normalizeDeliveryMarkdown = (deliveryMarkdown: string | undefined): string[] =>
  String(deliveryMarkdown || '')
    .replace(/\r\n/g, '\n')
    .split('\n')

const extractSectionListItems = (input: {
  deliveryMarkdown: string | undefined
  sectionHeading: string
}): string[] => {
  const lines = normalizeDeliveryMarkdown(input.deliveryMarkdown)
  const startIndex = lines.findIndex((line) => line.trim() === input.sectionHeading)
  if (startIndex < 0) return []

  const collected: string[] = []
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    if (/^##\s+/.test(line)) break

    const bulletMatch = line.match(/^[-*]\s+(.+)$/)
    const numberedMatch = line.match(/^\d+\.\s+(.+)$/)
    const value = bulletMatch?.[1] || numberedMatch?.[1]
    if (!value) continue

    const normalized = value.replace(/\s+/g, ' ').trim()
    if (!normalized || normalized === '无' || collected.includes(normalized)) continue
    collected.push(normalized)
  }

  return collected
}

export const getStructuredDeliveryContract = (
  mode: StructuredDeliveryMode
): StructuredDeliveryContract => STRUCTURED_DELIVERY_CONTRACTS[mode]

export const buildStructuredDeliveryPromptRules = (mode: StructuredDeliveryMode): string => {
  const contract = getStructuredDeliveryContract(mode)
  return [
    `当前 deliveryMode=${mode}。`,
    'deliveryMarkdown 必须使用以下固定 markdown 章节，且章节名必须完全一致：',
    contract.title,
    ...contract.headings,
    '空章节写“无”。'
  ].join('\n')
}

export const buildStructuredDeliveryPromptExample = (mode: StructuredDeliveryMode): string => {
  const contract = getStructuredDeliveryContract(mode)
  return `{
  "summary": "${contract.exampleSummary}",
  "deliveryMarkdown": "${contract.exampleDeliveryMarkdown.replace(/\n/g, '\\n')}"
}`
}

export const buildStructuredDeliveryFallbackMarkdown = (input: {
  state: HumanState
  mode: StructuredDeliveryMode
  summary: string
}): string => {
  const contract = getStructuredDeliveryContract(input.mode)
  return buildMarkdownDocument({
    title: contract.title,
    sections: contract.buildFallbackSections({
      state: input.state,
      summary: input.summary
    })
  })
}

export const extractContextNoteReusableEvidence = (
  deliveryMarkdown: string | undefined
): string[] =>
  extractSectionListItems({
    deliveryMarkdown,
    sectionHeading: getStructuredDeliveryContract('context_note').headings[1]
  })
