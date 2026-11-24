import type { PreviewText } from './textIndex'

/** Index painted text in Word story order. Pagination repeats bands and splits blocks. */
export function readSuperDocText(container: Element): PreviewText {
  let text = ''
  const runs: PreviewText['runs'] = []
  const repeated = new Map<HTMLElement, HTMLElement[]>()
  const stories = new Map<string, Map<string, HTMLElement[]>>()
  for (const block of container.querySelectorAll<HTMLElement>('.superdoc-page [data-para-id]')) {
    if (!block.querySelector('[data-run-id]') || block.closest('.ts-table-origins')) continue
    const story = block.dataset.layoutStory || 'body'
    const blocks = stories.get(story) ?? new Map<string, HTMLElement[]>()
    stories.set(story, blocks)
    const fragments = blocks.get(block.dataset.paraId!) ?? []
    const original =
      story !== 'body' &&
      fragments.find((f) => f.dataset.layoutFragmentId === block.dataset.layoutFragmentId)
    if (original) {
      const copies = repeated.get(original) ?? []
      copies.push(block)
      repeated.set(original, copies)
      continue
    }
    fragments.push(block)
    blocks.set(block.dataset.paraId!, fragments)
  }

  const repeatedRuns: NonNullable<PreviewText['repeatedRuns']> = new Map()
  const append = (fragments: HTMLElement[]) => {
    for (const fragment of fragments) {
      const copies = repeated.get(fragment) ?? []
      for (const span of fragment.querySelectorAll<HTMLElement>('[data-run-id]')) {
        const peers = copies.flatMap((copy) => {
          const peer = copy.querySelector('[data-run-id="' + CSS.escape(span.dataset.runId!) + '"]')
          return peer ? [document.createTreeWalker(peer, NodeFilter.SHOW_TEXT)] : []
        })
        if (span.hasAttribute('data-ts-manual-break')) {
          text += '\n'
          continue
        }
        const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) {
          const node = walker.currentNode as Text
          const run = { node, start: text.length, end: text.length + node.length }
          runs.push(run)
          for (const peer of peers) {
            const equivalent = peer.nextNode()
            if (equivalent instanceof Text && equivalent.data === node.data)
              repeatedRuns.set(equivalent, run)
          }
          text += node.data
        }
      }
    }
  }
  for (const blocks of stories.values()) {
    let lastTable: HTMLElement | null = null
    let lastRow = 0,
      lastColumn = 0
    for (const fragments of blocks.values()) {
      const block = fragments[0]!
      const cell = block.closest<HTMLElement>('[data-sd-cell-id]')
      const table = cell?.closest<HTMLElement>('[data-table-boundaries]') ?? null
      if (cell && table) {
        const columns = (
          JSON.parse(table.dataset.tableBoundaries!) as { columns: Array<{ x: number }> }
        ).columns
        const column = Math.max(
          0,
          columns.findIndex((c) => Math.abs(c.x - parseFloat(cell.style.left)) < 1)
        )
        const row = Number(cell.dataset.rowIndex)
        if (lastTable !== table) text += (text ? '\n' : '') + '\t'.repeat(column)
        else if (row !== lastRow)
          text +=
            '\t'.repeat(Math.max(0, columns.length - 1 - lastColumn)) + '\n\n' + '\t'.repeat(column)
        else text += column === lastColumn ? '\n' : '\t'.repeat(Math.max(0, column - lastColumn))
        lastRow = row
        lastColumn = column
      } else if (text) text += '\n'
      lastTable = table
      append(fragments)
    }
  }
  return { text, runs, repeatedRuns }
}
