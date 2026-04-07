import type { HumanDeliveryMode, HumanState } from '../types'
import { renderLineList } from '../../utils/render'
import {
  renderHumanEvidenceLines,
  renderHumanFactLines,
  renderHumanOpenQuestionLines
} from './memoryRenderers'
import { renderHumanArtifactLines } from './runtimeRenderers'

type DeliverySection = {
  heading: string
  body: string
}

type StructuredDeliveryMode = Extract<HumanDeliveryMode, 'task_handoff' | 'context_note'>

type StructuredDeliveryContract = {
  mode: StructuredDeliveryMode
  title: string
  headings: readonly string[]
  exampleSummary: string
  exampleDeliveryMarkdown: string
  buildFallbackSections: (input: { state: HumanState; summary: string }) => DeliverySection[]
  extractReusableEvidence?: (deliveryMarkdown: string | undefined) => string[]
}

export type DeliveryModeContract = {
  mode: HumanDeliveryMode
  buildPromptRules: () => string
  buildPromptExample: () => string
  buildFallbackMarkdown: (input: { state: HumanState; summary: string }) => string
  extractReusableEvidence?: (deliveryMarkdown: string | undefined) => string[]
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

const buildStructuredDeliveryPromptRulesInternal = (
  contract: StructuredDeliveryContract
): string => {
  return [
    `当前 deliveryMode=${contract.mode}。`,
    '最终输出必须使用以下固定 markdown 章节，且章节名必须完全一致：',
    contract.title,
    ...contract.headings,
    '空章节写“无”。'
  ].join('\n')
}

const buildStructuredDeliveryPromptExampleInternal = (
  contract: StructuredDeliveryContract
): string => contract.exampleDeliveryMarkdown

const buildStructuredDeliveryFallbackMarkdownInternal = (input: {
  contract: StructuredDeliveryContract
  state: HumanState
  summary: string
}): string => {
  return buildMarkdownDocument({
    title: input.contract.title,
    sections: input.contract.buildFallbackSections({
      state: input.state,
      summary: input.summary
    })
  })
}

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
        body: renderHumanArtifactLines(state, 'fallback_markdown')
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
  ],
  extractReusableEvidence: (deliveryMarkdown) =>
    extractSectionListItems({
      deliveryMarkdown,
      sectionHeading: CONTEXT_NOTE_CONTRACT.headings[1]
    })
}

const USER_ANSWER_CONTRACT: DeliveryModeContract = {
  mode: 'user_answer',
  buildPromptRules: () =>
    [
      '当前 deliveryMode=user_answer。',
      '最终输出面向最终用户，可自然组织为完整 markdown 结果，不要求固定章节。'
    ].join('\n'),
  buildPromptExample: () =>
    '# 处理结果\n\n已完成本次任务。\n\n## 关键依据\n- 依据一\n- 依据二',
  buildFallbackMarkdown: ({ state, summary }) =>
    [
      '# 处理结果',
      '',
      summary,
      '',
      '## 已确认事实',
      renderHumanFactLines(state, 'fallback_markdown'),
      '',
      '## 关键证据',
      renderHumanEvidenceLines(state, 'fallback_markdown'),
      '',
      '## 产物与引用',
      renderHumanArtifactLines(state, 'fallback_markdown'),
      '',
      '## 限制与未决项',
      renderHumanOpenQuestionLines(state, 'fallback_markdown')
    ].join('\n')
}

const toDeliveryModeContract = (
  contract: StructuredDeliveryContract
): DeliveryModeContract => ({
  mode: contract.mode,
  buildPromptRules: () => buildStructuredDeliveryPromptRulesInternal(contract),
  buildPromptExample: () => buildStructuredDeliveryPromptExampleInternal(contract),
  buildFallbackMarkdown: ({ state, summary }) =>
    buildStructuredDeliveryFallbackMarkdownInternal({
      contract,
      state,
      summary
    }),
  extractReusableEvidence: contract.extractReusableEvidence
})

const DELIVERY_MODE_CONTRACTS: Record<HumanDeliveryMode, DeliveryModeContract> = {
  user_answer: USER_ANSWER_CONTRACT,
  task_handoff: toDeliveryModeContract(TASK_HANDOFF_CONTRACT),
  context_note: toDeliveryModeContract(CONTEXT_NOTE_CONTRACT)
}

export const getDeliveryModeContract = (mode: HumanDeliveryMode): DeliveryModeContract =>
  DELIVERY_MODE_CONTRACTS[mode]

export const buildDeliveryModePromptRules = (mode: HumanDeliveryMode): string =>
  getDeliveryModeContract(mode).buildPromptRules()

export const buildDeliveryModePromptExample = (mode: HumanDeliveryMode): string =>
  getDeliveryModeContract(mode).buildPromptExample()

export const buildDeliveryModeFallbackMarkdown = (input: {
  state: HumanState
  mode: HumanDeliveryMode
  summary: string
}): string => getDeliveryModeContract(input.mode).buildFallbackMarkdown(input)

export const extractContextNoteReusableEvidence = (
  deliveryMarkdown: string | undefined
): string[] =>
  getDeliveryModeContract('context_note').extractReusableEvidence?.(deliveryMarkdown) || []
