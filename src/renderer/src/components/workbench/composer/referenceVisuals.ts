import type { SelectedReference } from '../../../../../shared/types'
import { REFERENCE_ICON_TONES } from './constants'

export type ReferenceVisualKind = keyof typeof REFERENCE_ICON_TONES

export const getReferenceVisualKind = (reference: SelectedReference): ReferenceVisualKind => {
  if (reference.kind === 'directory') return 'directory'
  if (reference.kind === 'web') return 'web'
  return 'file'
}

export const getReferenceVisualTone = (
  reference: SelectedReference
): (typeof REFERENCE_ICON_TONES)[ReferenceVisualKind] =>
  REFERENCE_ICON_TONES[getReferenceVisualKind(reference)]
