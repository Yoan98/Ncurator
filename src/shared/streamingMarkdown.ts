/**
 * Streaming markdown split for incremental rendering.
 *
 * The renderer parses the whole document on every delta today, which costs
 * 8–38ms per token at 1k–12k characters. Instead we split the text at the last
 * *closed* top-level block boundary: everything before it is stable (parsed once,
 * memoized) and only the growing tail is re-parsed while streaming.
 *
 * Splitting rules:
 * - Only blank lines outside fenced code blocks are candidates, so a fence, a
 *   GFM table or a `$$` block is never cut in half.
 * - A list that continues after a blank line is kept together with its earlier
 *   items, otherwise ordered lists would restart numbering every time the tail
 *   stabilizes.
 * - Indented code blocks are not modelled; they are rare in assistant output and
 *   a wrong split only affects transient streaming presentation.
 */

export type StreamingMarkdownSplit = {
  stable: string
  tail: string
}

const FENCE_LINE_RE = /^ {0,3}(`{3,}|~{3,})/u
const LIST_ITEM_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s+/u

const isBlankLine = (line: string): boolean => line.trim().length === 0

const lastBlockLines = (lines: readonly string[]): string[] => {
  let end = lines.length - 1
  while (end >= 0 && lines[end].trim().length === 0) end -= 1
  if (end < 0) return []
  let start = 0
  for (let index = end; index >= 0; index -= 1) {
    if (lines[index].trim().length > 0) continue
    start = index + 1
    break
  }
  return lines.slice(start, end + 1)
}

const continuesList = (before: readonly string[], after: readonly string[]): boolean => {
  const firstTailLine = after.find((line) => line.trim().length > 0)
  if (!firstTailLine || !LIST_ITEM_RE.test(firstTailLine)) return false
  return lastBlockLines(before).some((line) => LIST_ITEM_RE.test(line))
}

export const splitStableMarkdown = (markdown: string): StreamingMarkdownSplit => {
  if (!markdown) return { stable: '', tail: '' }

  const lines: string[] = []
  const offsets: number[] = []
  const candidates: number[] = []
  let offset = 0
  let fenceChar: string | null = null
  let fenceSize = 0

  for (const line of markdown.split('\n')) {
    lines.push(line)
    offsets.push(offset)
    offset += line.length + 1
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fenceMatch = FENCE_LINE_RE.exec(line)
    const inFence = fenceChar !== null

    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!inFence) {
        fenceChar = marker[0]
        fenceSize = marker.length
        continue
      }
      if (marker[0] === fenceChar && marker.length >= fenceSize) {
        fenceChar = null
        continue
      }
    }

    if (!inFence && fenceChar === null && isBlankLine(line)) {
      const nextLineOffset = offsets[index] + line.length + 1
      if (nextLineOffset <= markdown.length) candidates.push(nextLineOffset)
    }
  }

  if (candidates.length === 0) return { stable: '', tail: markdown }

  let candidateIndex = candidates.length - 1
  let cut = candidates[candidateIndex]

  while (candidateIndex > 0) {
    if (!continuesList(markdown.slice(0, cut).split('\n'), markdown.slice(cut).split('\n'))) break
    candidateIndex -= 1
    cut = candidates[candidateIndex]
  }

  // The tail continues the very first list: nothing is stable yet.
  if (continuesList(markdown.slice(0, cut).split('\n'), markdown.slice(cut).split('\n'))) {
    cut = 0
  }

  if (cut <= 0 || cut >= markdown.length) return { stable: '', tail: markdown }
  return { stable: markdown.slice(0, cut), tail: markdown.slice(cut) }
}
