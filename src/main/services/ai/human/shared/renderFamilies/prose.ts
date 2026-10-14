import { wrapModelTextLines } from './shared'

export const renderProse = (lines: string[]): string =>
  wrapModelTextLines(lines.filter(Boolean).join('\n'))

export const renderFileMutationProse = (input: {
  path: string
  verb?: 'updated' | 'created'
  suffix?: string
}): string => {
  const verb = input.verb === 'created' ? 'created' : 'updated'
  const base = `The file ${input.path} has been ${verb} successfully.`
  return renderProse([base, input.suffix || ''])
}

export const renderPlainConfirmation = (message: string): string => renderProse([message])
