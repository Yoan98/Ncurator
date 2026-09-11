import { escapeXmlAttribute, wrapModelTextLines } from './shared'

export const renderFileEnvelope = (input: {
  path: string
  type: string
  bodyLines: string[]
  footer?: string
}): string => {
  const lines = [
    `<file path="${escapeXmlAttribute(input.path)}">`,
    `<type>${input.type}</type>`,
    ...input.bodyLines,
    ...(input.footer ? [input.footer] : []),
    '</file>'
  ]
  return wrapModelTextLines(lines.join('\n'))
}

export const renderNumberedFileLines = (input: {
  content: string
  startLine: number
}): string[] => {
  const lines = input.content.split(/\r\n|\r|\n/u)
  return lines.map((line, index) => `${input.startLine + index}: ${line}`)
}

export const formatReadRangeFooter = (input: {
  startLine: number
  endLine: number
  totalLines: number
  nextStartLine?: number
}): string => {
  if (input.nextStartLine !== undefined) {
    return `(Showing lines ${input.startLine}-${input.endLine} of ${input.totalLines}. Use startLine=${input.nextStartLine} to continue.)`
  }
  return `(Showing lines ${input.startLine}-${input.endLine} of ${input.totalLines}.)`
}
