import type { HumanStableMemory, HumanStableMemoryPatch } from '../types'

const normalizeStableMemoryText = (value: string): string =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()

export const applyStableMemoryPatch = (input: {
  stable: HumanStableMemory
  patch?: HumanStableMemoryPatch
}): HumanStableMemory => {
  if (!input.patch) {
    return input.stable
  }

  return {
    confirmedFacts:
      typeof input.patch.confirmedFacts === 'string'
        ? normalizeStableMemoryText(input.patch.confirmedFacts)
        : input.stable.confirmedFacts,
    keyEvidence:
      typeof input.patch.keyEvidence === 'string'
        ? normalizeStableMemoryText(input.patch.keyEvidence)
        : input.stable.keyEvidence,
    openQuestions:
      typeof input.patch.openQuestions === 'string'
        ? normalizeStableMemoryText(input.patch.openQuestions)
        : input.stable.openQuestions
  }
}
