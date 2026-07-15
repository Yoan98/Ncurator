import { diffArrays } from 'diff'
import type { TextFileDiffArtifact, TextFileDiffLine } from '../../../../../../shared/types'

const DIFF_CONTEXT_LINES = 3

type PositionedDiffLine = {
  line: TextFileDiffLine
  oldCursor: number
  newCursor: number
}

const splitTextLines = (content: string): string[] =>
  content.length === 0 ? [] : content.split('\n')

const buildPositionedLines = (before: string, after: string): PositionedDiffLine[] => {
  const changes = diffArrays(splitTextLines(before), splitTextLines(after))
  const lines: PositionedDiffLine[] = []
  let oldLine = 1
  let newLine = 1

  for (const change of changes) {
    for (const text of change.value) {
      const oldCursor = oldLine
      const newCursor = newLine
      if (change.removed) {
        lines.push({
          line: { type: 'remove', oldLine, text },
          oldCursor,
          newCursor
        })
        oldLine += 1
        continue
      }
      if (change.added) {
        lines.push({
          line: { type: 'add', newLine, text },
          oldCursor,
          newCursor
        })
        newLine += 1
        continue
      }
      lines.push({
        line: { type: 'context', oldLine, newLine, text },
        oldCursor,
        newCursor
      })
      oldLine += 1
      newLine += 1
    }
  }

  return lines
}

const buildHunkRanges = (lines: readonly PositionedDiffLine[]): Array<[number, number]> => {
  const ranges: Array<[number, number]> = []
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.line.type === 'context') continue
    const start = Math.max(0, index - DIFF_CONTEXT_LINES)
    const end = Math.min(lines.length - 1, index + DIFF_CONTEXT_LINES)
    const previous = ranges[ranges.length - 1]
    if (previous && start <= previous[1] + 1) {
      previous[1] = Math.max(previous[1], end)
    } else {
      ranges.push([start, end])
    }
  }
  return ranges
}

export const createTextFileDiffArtifact = (input: {
  before: string
  after: string
}): TextFileDiffArtifact => {
  const positionedLines = buildPositionedLines(input.before, input.after)
  const hunks = buildHunkRanges(positionedLines).map(([start, end]) => {
    const first = positionedLines[start]
    return {
      oldStart: first?.oldCursor || 1,
      newStart: first?.newCursor || 1,
      lines: positionedLines.slice(start, end + 1).map((item) => item.line)
    }
  })

  return {
    version: 1,
    oldLineCount: splitTextLines(input.before).length,
    newLineCount: splitTextLines(input.after).length,
    afterLines: splitTextLines(input.after),
    hunks
  }
}

export const countTextFileDiffLines = (
  artifact: TextFileDiffArtifact
): { insertCount: number; deleteCount: number } => {
  let insertCount = 0
  let deleteCount = 0
  for (const hunk of artifact.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') insertCount += 1
      if (line.type === 'remove') deleteCount += 1
    }
  }
  return { insertCount, deleteCount }
}
