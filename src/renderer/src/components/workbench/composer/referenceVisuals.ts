import type { SelectedReference } from '../../../../../shared/types'
import { REFERENCE_ICON_TONES } from './constants'

export type ReferenceVisualKind = keyof typeof REFERENCE_ICON_TONES

export const getReferenceFileExt = (reference: SelectedReference): string => {
  if (reference.kind !== 'file') return ''
  return (reference.fileExt || reference.relativePath.split('.').pop() || '').trim().toLowerCase()
}

export const getReferenceVisualKind = (reference: SelectedReference): ReferenceVisualKind => {
  if (reference.kind === 'directory') return 'directory'
  if (reference.kind === 'web') return 'web'
  const fileExt = getReferenceFileExt(reference)
  if (fileExt === 'docx') return 'docx'
  if (fileExt === 'pdf') return 'pdf'
  return 'file'
}

export const getReferenceVisualTone = (
  reference: SelectedReference
): (typeof REFERENCE_ICON_TONES)[ReferenceVisualKind] =>
  REFERENCE_ICON_TONES[getReferenceVisualKind(reference)]
