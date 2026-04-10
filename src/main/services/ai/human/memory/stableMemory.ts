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
    currentUnderstanding:
      typeof input.patch.currentUnderstanding === 'string'
        ? normalizeStableMemoryText(input.patch.currentUnderstanding)
        : input.stable.currentUnderstanding,
    keyEvidence:
      typeof input.patch.keyEvidence === 'string'
        ? normalizeStableMemoryText(input.patch.keyEvidence)
        : input.stable.keyEvidence,
    checklist:
      typeof input.patch.checklist === 'string'
        ? normalizeStableMemoryText(input.patch.checklist)
        : input.stable.checklist
  }
}
