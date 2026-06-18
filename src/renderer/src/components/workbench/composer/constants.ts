import type { ReferenceKind } from '../../../../../shared/types'

export const COMPOSER_PLACEHOLDER = '输入问题，或 @ 资料'

export const COMPOSER_REFERENCE_KINDS: ReferenceKind[] = ['directory', 'file', 'web']

export type ReferenceIconTone = {
  containerClassName: string
  iconClassName: string
  fillClassName: string
  textClassName: string
}

export const REFERENCE_ICON_PATHS = {
  directory:
    'M2.25 6.75A2.25 2.25 0 014.5 4.5h3.879c.596 0 1.168.237 1.59.659l.872.872c.14.14.331.219.53.219H19.5a2.25 2.25 0 012.25 2.25v7.5a2.25 2.25 0 01-2.25 2.25h-15A2.25 2.25 0 012.25 16.5V6.75z',
  web: 'M12 2.25a9.75 9.75 0 100 19.5 9.75 9.75 0 000-19.5zm0 0c2.25 2.25 3.375 5.25 3.375 9.75S14.25 19.5 12 21.75m0-19.5C9.75 4.5 8.625 7.5 8.625 12S9.75 19.5 12 21.75m-8.25-9.75h16.5',
  docx: 'M19.5 14.25v-5.4a2.25 2.25 0 00-.659-1.591l-4.1-4.1a2.25 2.25 0 00-1.591-.659H6.75A2.25 2.25 0 004.5 4.75v14.5a2.25 2.25 0 002.25 2.25h10.5a2.25 2.25 0 002.25-2.25v-5zM13.5 2.5V8a1 1 0 001 1h5',
  pdf: 'M19.5 14.25v-5.4a2.25 2.25 0 00-.659-1.591l-4.1-4.1a2.25 2.25 0 00-1.591-.659H6.75A2.25 2.25 0 004.5 4.75v14.5a2.25 2.25 0 002.25 2.25h10.5a2.25 2.25 0 002.25-2.25v-5zM8 15.5h8M8 18h5',
  file: 'M19.5 14.25v-5.4a2.25 2.25 0 00-.659-1.591l-4.1-4.1a2.25 2.25 0 00-1.591-.659H6.75A2.25 2.25 0 004.5 4.75v14.5a2.25 2.25 0 002.25 2.25h10.5a2.25 2.25 0 002.25-2.25v-5zM13.5 2.5V8a1 1 0 001 1h5'
} as const

export const REFERENCE_ICON_TONES = {
  directory: {
    containerClassName: 'bg-[#F4F1E8] text-[#8A6F2A]',
    iconClassName: 'text-[#8A6F2A]',
    fillClassName: 'fill-none',
    textClassName: 'fill-[#8A6F2A]'
  },
  docx: {
    containerClassName: 'bg-[#EAF2FB] text-[#2F6FBC]',
    iconClassName: 'text-[#2F6FBC]',
    fillClassName: 'fill-[#2F6FBC]',
    textClassName: 'fill-white'
  },
  pdf: {
    containerClassName: 'bg-[#FBEDEC] text-[#B3261E]',
    iconClassName: 'text-[#B3261E]',
    fillClassName: 'fill-[#F0524D]',
    textClassName: 'fill-white'
  },
  web: {
    containerClassName: 'bg-[#EAF4EF] text-[#2F6F4E]',
    iconClassName: 'text-[#2F6F4E]',
    fillClassName: 'fill-none',
    textClassName: 'fill-[#2F6F4E]'
  },
  file: {
    containerClassName: 'bg-[#F1F1EF] text-[#6B6A67]',
    iconClassName: 'text-[#6B6A67]',
    fillClassName: 'fill-[#F7F7F5]',
    textClassName: 'fill-[#6B6A67]'
  }
} as const
