export interface TextEdit {
  oldText: string
  newText: string
}

/** All matches refer to the same input; a failed edit never partially applies. */
export function applyUniqueTextEdits(
  content: string,
  edits: readonly TextEdit[],
  label = 'text'
): string {
  if (!edits.length) throw new Error('edits must not be empty')
  const replacements = edits
    .map((edit, index) => {
      const oldText = edit.oldText.replace(/\r\n?/g, '\n')
      const newText = edit.newText.replace(/\r\n?/g, '\n')
      if (!oldText) throw new Error(`edits[${index}].oldText must not be empty`)
      const start = content.indexOf(oldText)
      if (start < 0) throw new Error(`edits[${index}].oldText was not found in ${label}`)
      let matches = 1
      let offset = start + 1
      while ((offset = content.indexOf(oldText, offset)) >= 0) {
        matches++
        offset++
      }
      if (matches > 1)
        throw new Error(
          `edits[${index}].oldText matches ${matches} locations in ${label}. Include more surrounding text so it matches exactly once.`
        )
      return { start, end: start + oldText.length, newText }
    })
    .sort((a, b) => a.start - b.start)
  for (let i = 1; i < replacements.length; i++) {
    if (replacements[i].start < replacements[i - 1].end) throw new Error('edits must not overlap')
  }
  let next = content
  for (const edit of replacements.reverse())
    next = next.slice(0, edit.start) + edit.newText + next.slice(edit.end)
  if (next === content) throw new Error('The edits make no changes')
  return next
}
