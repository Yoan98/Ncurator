import type { StructuredToolInterface } from '@langchain/core/tools'
import type { SkillCard } from '../../types'
import type { CapabilityToolBuildInput } from '../../tools/types'

export type HumanSkillGuide = {
  summary: string
  workflow: string[]
  decisionHints: string[]
}

export type HumanSkillDefinition = {
  card: SkillCard
  guide: HumanSkillGuide
  buildTools: (input: CapabilityToolBuildInput) => StructuredToolInterface[]
}
