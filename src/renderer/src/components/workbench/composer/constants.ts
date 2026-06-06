import type { ReferenceKind } from '../../../../../shared/types'

export const COMPOSER_PLACEHOLDER = '输入问题，或 @ 资料'

export const COMPOSER_REFERENCE_KINDS: ReferenceKind[] = ['directory', 'file', 'web']

export const TOKEN_TONE_CLASSNAME: Record<ReferenceKind, string> = {
  directory: 'border-[#CBC7BD] bg-[#F0EFEB] text-[#3F3F3D]',
  file: 'border-[#CBC7BD] bg-[#F0EFEB] text-[#3F3F3D]',
  web: 'border-[#CBC7BD] bg-[#F0EFEB] text-[#3F3F3D]'
}

export const TOKEN_BADGE_CLASSNAME: Record<ReferenceKind, string> = {
  directory: 'bg-[#181818] text-[#FFFDF8]',
  file: 'bg-[#3F3F3D] text-[#FFFDF8]',
  web: 'bg-[#6E6D69] text-[#FFFDF8]'
}
