import { wrapModelTextLines } from './shared'

export const renderGroupedHeader = (message: string): string => message

export const joinGroupedSections = (sections: string[]): string =>
  wrapModelTextLines(sections.filter(Boolean).join('\n'))
