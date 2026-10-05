import { diffArrays } from 'diff'

type SequenceChunk = { value: string[]; count: number; added?: boolean; removed?: boolean }

/** LCS prefix lengths with a bitset row, avoiding a quadratic matrix or edit trace. */
const prefixLengths = (before: string[], after: string[]): Uint32Array => {
  const masks = new Map<string, bigint>()
  after.forEach((key, index) => masks.set(key, (masks.get(key) || 0n) | (1n << BigInt(index))))
  let row = 0n
  for (const key of before) {
    const match = masks.get(key)
    if (!match) continue
    const candidates = row | match
    row = candidates & ~(candidates - ((row << 1n) | 1n))
  }
  const bits = row.toString(2).padStart(after.length, '0')
  const lengths = new Uint32Array(after.length + 1)
  for (let index = 0; index < after.length; index++)
    lengths[index + 1] = lengths[index]! + Number(bits[bits.length - index - 1] === '1')
  return lengths
}

/** Exact, deterministic alignment for large edits; Hirschberg keeps only two bitset rows. */
const largeEditMatches = (before: string[], after: string[]): Array<[number, number]> => {
  const matches: Array<[number, number]> = []
  const align = (oldStart: number, oldEnd: number, newStart: number, newEnd: number): void => {
    while (oldStart < oldEnd && newStart < newEnd && before[oldStart] === after[newStart])
      matches.push([oldStart++, newStart++])
    let suffix = 0
    while (oldStart < oldEnd && newStart < newEnd && before[oldEnd - 1] === after[newEnd - 1]) {
      oldEnd--
      newEnd--
      suffix++
    }
    if (oldEnd - oldStart === 1) {
      const index = after.indexOf(before[oldStart]!, newStart)
      if (index >= newStart && index < newEnd) matches.push([oldStart, index])
    } else if (oldStart < oldEnd && newStart < newEnd) {
      const middle = Math.floor((oldStart + oldEnd) / 2)
      const forward = prefixLengths(before.slice(oldStart, middle), after.slice(newStart, newEnd))
      const backward = prefixLengths(
        before.slice(middle, oldEnd).reverse(),
        after.slice(newStart, newEnd).reverse()
      )
      let split = 0,
        best = 0
      for (let index = 0; index <= newEnd - newStart; index++) {
        const score = forward[index]! + backward[newEnd - newStart - index]!
        if (score > best) {
          best = score
          split = index
        }
      }
      if (best) {
        align(oldStart, middle, newStart, newStart + split)
        align(middle, oldEnd, newStart + split, newEnd)
      }
    }
    for (let index = 0; index < suffix; index++) matches.push([oldEnd + index, newEnd + index])
  }
  align(0, before.length, 0, after.length)
  return matches
}

export const sequenceDiff = (before: string[], after: string[]): SequenceChunk[] => {
  const quick = diffArrays(before, after, { maxEditLength: 2048 })
  if (quick) return quick
  const chunks: SequenceChunk[] = []
  const append = (value: string[], kind?: 'added' | 'removed'): void => {
    if (!value.length) return
    const previous = chunks.at(-1)
    if (
      previous &&
      !!previous.added === (kind === 'added') &&
      !!previous.removed === (kind === 'removed')
    ) {
      for (const key of value) previous.value.push(key)
      previous.count += value.length
    } else chunks.push({ value, count: value.length, ...(kind ? { [kind]: true } : {}) })
  }
  let oldIndex = 0,
    newIndex = 0
  for (const [old, next] of largeEditMatches(before, after)) {
    append(before.slice(oldIndex, old), 'removed')
    append(after.slice(newIndex, next), 'added')
    append([before[old]!])
    oldIndex = old + 1
    newIndex = next + 1
  }
  append(before.slice(oldIndex), 'removed')
  append(after.slice(newIndex), 'added')
  return chunks
}
