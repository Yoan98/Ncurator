import type { ReferenceKind } from '../../../../../shared/types'

export const COMPOSER_PLACEHOLDER = '输入问题，或 @ 资料'

export const COMPOSER_REFERENCE_KINDS: ReferenceKind[] = ['directory', 'file', 'web']

export const TOKEN_TONE_CLASSNAME: Record<ReferenceKind, string> = {
  directory: 'border-[#E9E1D7] bg-[#F8F3EC] text-[#8A5A2B]',
  file: 'border-[#DDE7F5] bg-[#EEF4FF] text-[#3B82F6]',
  web: 'border-[#D7E6E3] bg-[#EDF7F5] text-[#2F7D6B]'
}

export const TOKEN_BADGE_CLASSNAME: Record<ReferenceKind, string> = {
  directory: 'bg-[#B9895B] text-white',
  file: 'bg-[#4A90E2] text-white',
  web: 'bg-[#4E8F80] text-white'
}
