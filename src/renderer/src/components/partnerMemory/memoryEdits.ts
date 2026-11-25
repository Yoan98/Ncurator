interface Change {
  start: number
  end: number
  text: string
}

/** Each bit records where a row's prefix LCS length increases. BigInt evaluates a
 * complete row at once, including when two long texts have almost nothing in common.
 * Keep the rows for exact traceback; use code points so emoji remain intact.
 */
function alignment(
  before: string[],
  after: string[]
): Array<{ value: string; kind: 'same' | 'add' | 'remove' }> {
  const matches = new Map<string, bigint>()
  after.forEach((char, index) =>
    matches.set(char, (matches.get(char) ?? 0n) | (1n << BigInt(index)))
  )
  const rows = [0n]
  for (const char of before) {
    const previous = rows[rows.length - 1]
    const candidates = previous | (matches.get(char) ?? 0n)
    rows.push(candidates & ~(candidates - ((previous << 1n) | 1n)))
  }
  const parts: Array<{ value: string; kind: 'same' | 'add' | 'remove' }> = []
  let i = before.length,
    j = after.length
  while (i || j) {
    if (i && j && before[i - 1] === after[j - 1]) {
      parts.push({ value: before[--i], kind: 'same' })
      j--
    } else if (j && (!i || (rows[i] & (1n << BigInt(j - 1))) === 0n)) {
      parts.push({ value: after[--j], kind: 'add' })
    } else parts.push({ value: before[--i], kind: 'remove' })
  }
  return parts.reverse()
}

function changes(before: string, after: string): Change[] {
  const oldChars = Array.from(before),
    newChars = Array.from(after)
  let start = 0,
    oldEnd = oldChars.length,
    newEnd = newChars.length
  while (start < oldEnd && start < newEnd && oldChars[start] === newChars[start]) start++
  while (oldEnd > start && newEnd > start && oldChars[oldEnd - 1] === newChars[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  const result: Change[] = []
  let offset = oldChars.slice(0, start).join('').length
  let current: Change | null = null
  for (const part of alignment(oldChars.slice(start, oldEnd), newChars.slice(start, newEnd))) {
    if (part.kind === 'same') {
      if (current) result.push(current)
      current = null
      offset += part.value.length
    } else {
      current ??= { start: offset, end: offset, text: '' }
      if (part.kind === 'remove') {
        offset += part.value.length
        current.end = offset
      } else current.text += part.value
    }
  }
  if (current) result.push(current)
  return result
}

/** Preserve disjoint remote changes. The user's latest edit wins on intersecting ranges. */
export function mergeMemoryEdits(base: string, local: string, remote: string): string {
  if (local === base) return remote
  if (remote === base || local === remote) return local
  const localChanges = changes(base, local)
  const remoteChanges = changes(base, remote).filter(
    (incoming) =>
      !localChanges.some((edit) => {
        if (incoming.start === incoming.end || edit.start === edit.end)
          return incoming.start <= edit.end && edit.start <= incoming.end
        return incoming.start < edit.end && edit.start < incoming.end
      })
  )
  let merged = base
  for (const edit of [...localChanges, ...remoteChanges].sort((a, b) => b.start - a.start))
    merged = merged.slice(0, edit.start) + edit.text + merged.slice(edit.end)
  return merged
}
