import type { ReferenceKind } from '../../../../../shared/types'

export const COMPOSER_PLACEHOLDER = '输入问题，或 @ 资料'

export const COMPOSER_REFERENCE_KINDS: ReferenceKind[] = ['directory', 'file', 'web']

export type ReferenceIconTone = {
  iconClassName: string
  fillClassName: string
  textClassName: string
}

export const REFERENCE_ICON_PATHS = {
  directory:
    'M2.25 6.75A2.25 2.25 0 014.5 4.5h3.879c.596 0 1.168.237 1.59.659l.872.872c.14.14.331.219.53.219H19.5a2.25 2.25 0 012.25 2.25v7.5a2.25 2.25 0 01-2.25 2.25h-15A2.25 2.25 0 012.25 16.5V6.75z',
  web: 'M12 2.25a9.75 9.75 0 100 19.5 9.75 9.75 0 000-19.5zm0 0c2.25 2.25 3.375 5.25 3.375 9.75S14.25 19.5 12 21.75m0-19.5C9.75 4.5 8.625 7.5 8.625 12S9.75 19.5 12 21.75m-8.25-9.75h16.5',
  file: 'M19.5 14.25v-5.4a2.25 2.25 0 00-.659-1.591l-4.1-4.1a2.25 2.25 0 00-1.591-.659H6.75A2.25 2.25 0 004.5 4.75v14.5a2.25 2.25 0 002.25 2.25h10.5a2.25 2.25 0 002.25-2.25v-5zM13.5 2.5V8a1 1 0 001 1h5'
} as const

export const REFERENCE_ICON_TONES = {
  directory: {
    iconClassName: 'text-[#787774]',
    fillClassName: 'fill-none',
    textClassName: 'fill-[#787774]'
  },
  web: {
    iconClassName: 'text-[#2F6F4E]',
    fillClassName: 'fill-none',
    textClassName: 'fill-[#2F6F4E]'
  },
  file: {
    iconClassName: 'text-[#787774]',
    fillClassName: 'fill-[#787774]',
    textClassName: 'fill-[#787774]'
  }
} as const
