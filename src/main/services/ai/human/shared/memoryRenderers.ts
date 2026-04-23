import type { HumanChecklistItem, HumanStableMemory, HumanState } from '../types'

export type HumanMemoryRenderMode = 'brain_prompt' | 'mouth_prompt' | 'fallback_markdown'
export type HumanStableMemoryField = keyof HumanStableMemory

const getRenderFallback = (mode: HumanMemoryRenderMode): string =>
  mode === 'fallback_markdown' ? '无' : 'none'

const normalizeMemoryText = (value: string): string =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .trim()

const renderStableMemoryValue = (value: string, mode: HumanMemoryRenderMode): string => {
  const normalized = normalizeMemoryText(value)
  return normalized || getRenderFallback(mode)
}

const renderChecklistItem = (item: HumanChecklistItem): string =>
  `- [${item.status}] ${item.item}`

const renderChecklistValue = (
  checklist: HumanState['memory']['stable']['checklist'],
  mode: HumanMemoryRenderMode
): string =>
  checklist.length > 0 ? checklist.map(renderChecklistItem).join('\n') : getRenderFallback(mode)

export const renderHumanStableMemoryField = (input: {
  state: HumanState
  field: HumanStableMemoryField
  mode: HumanMemoryRenderMode
}): string =>
  input.field === 'checklist'
    ? renderChecklistValue(input.state.memory.stable.checklist, input.mode)
    : renderStableMemoryValue(input.state.memory.stable[input.field], input.mode)

export const renderHumanStableNotes = (
  state: HumanState,
  mode: HumanMemoryRenderMode
): string =>
  [
    '当前理解：',
    renderHumanStableMemoryField({
      state,
      field: 'currentUnderstanding',
      mode
    }),
    '',
    '关键依据：',
    renderHumanStableMemoryField({
      state,
      field: 'keyEvidence',
      mode
    }),
    '',
    '检查清单：',
    renderHumanStableMemoryField({
      state,
      field: 'checklist',
      mode
    })
  ].join('\n')
