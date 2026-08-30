import { wrapModelTextLines } from './shared'

export const renderGroupedHeader = (message: string): string => message

export const renderGroupedFooter = (message: string): string => message

export const joinGroupedSections = (sections: string[]): string =>
  wrapModelTextLines(sections.filter(Boolean).join('\n'))

export const renderNoMatches = (scope: string): string =>
  wrapModelTextLines(`No matches found${scope ? ` in ${scope}` : ''}.`)
