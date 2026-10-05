import { diffArrays } from 'diff'
import type { TextFileDiffArtifact, TextFileDiffLine } from '../../../../../../shared/types'

const splitTextLines = (content: string): string[] =>
  content.length === 0 ? [] : content.split('\n')

const buildPositionedLines = (before: string, after: string): TextFileDiffLine[] => {
  const changes = diffArrays(splitTextLines(before), splitTextLines(after))
  const lines: TextFileDiffLine[] = []
  let oldLine = 1
  let newLine = 1

  for (const change of changes) {
    for (const text of change.value) {
      if (change.removed) {
        lines.push({ type: 'remove', oldLine, text })
        oldLine += 1
        continue
      }
      if (change.added) {
        lines.push({ type: 'add', newLine, text })
        newLine += 1
        continue
      }
      lines.push({ type: 'context', oldLine, newLine, text })
      oldLine += 1
      newLine += 1
    }
  }

  return lines
}

export const createTextFileDiffArtifact = (input: {
  before: string
  after: string
}): TextFileDiffArtifact => ({
  version: 3,
  oldLineCount: splitTextLines(input.before).length,
  newLineCount: splitTextLines(input.after).length,
  lines: buildPositionedLines(input.before, input.after)
})
export const countTextFileDiffLines = (
  artifact: TextFileDiffArtifact
): { insertCount: number; deleteCount: number } => ({
  insertCount: artifact.lines.filter((line) => line.type === 'add').length,
  deleteCount: artifact.lines.filter((line) => line.type === 'remove').length
})
