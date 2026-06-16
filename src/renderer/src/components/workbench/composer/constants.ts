import type { ReferenceKind } from '../../../../../shared/types'

export const COMPOSER_PLACEHOLDER = '输入问题，或 @ 资料'

export const COMPOSER_REFERENCE_KINDS: ReferenceKind[] = ['directory', 'file', 'web']

export const TOKEN_TONE_CLASSNAME: Record<ReferenceKind, string> = {
  directory: 'border-[#E0DFDC] bg-[#F4F4F2] text-[#2F3437]',
  file: 'border-[#E0DFDC] bg-[#F4F4F2] text-[#2F3437]',
  web: 'border-[#E0DFDC] bg-[#F4F4F2] text-[#2F3437]'
}

export const TOKEN_BADGE_CLASSNAME: Record<ReferenceKind, string> = {
  directory: 'bg-[#37352F] text-white',
  file: 'bg-[#2F3437] text-white',
  web: 'bg-[#787774] text-white'
}
