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

export type ReferenceIconTone = {
  containerClassName: string
  iconClassName: string
}

export const REFERENCE_ICON_TONES = {
  directory: {
    containerClassName: 'bg-[#F4F1E8] text-[#8A6F2A]',
    iconClassName: 'text-[#8A6F2A]'
  },
  docx: {
    containerClassName: 'bg-[#EAF2FB] text-[#2F6FBC]',
    iconClassName: 'text-[#2F6FBC]'
  },
  pdf: {
    containerClassName: 'bg-[#FBEDEC] text-[#B3261E]',
    iconClassName: 'text-[#B3261E]'
  },
  web: {
    containerClassName: 'bg-[#EAF4EF] text-[#2F6F4E]',
    iconClassName: 'text-[#2F6F4E]'
  },
  file: {
    containerClassName: 'bg-[#F1F1EF] text-[#6B6A67]',
    iconClassName: 'text-[#6B6A67]'
  }
} as const
