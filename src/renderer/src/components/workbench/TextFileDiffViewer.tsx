import { useEffect, useMemo, useRef, useState } from 'react'
import { diffWordsWithSpace } from 'diff'
import { Empty, Spin } from 'antd'
import type { TextFileDiffArtifact, TextFileDiffLine } from '../../../../shared/types'
import { workbenchSelectors } from '../../testing/selectors'

const ROW_HEIGHT = 28
const OVERSCAN_ROWS = 24

type DiffRow =
  | { kind: 'separator'; key: string; count: number }
  | {
      kind: 'line'
      key: string
      hunkIndex: number
      lineIndex: number
      line: TextFileDiffLine
    }

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; artifact: TextFileDiffArtifact }

const isValidDiffLine = (value: unknown): value is TextFileDiffLine => {
  if (!value || typeof value !== 'object') return false
  const line = value as Record<string, unknown>
  if (typeof line.text !== 'string') return false
  if (line.type === 'context') {
    return typeof line.oldLine === 'number' && typeof line.newLine === 'number'
  }
  if (line.type === 'remove') return typeof line.oldLine === 'number'
  if (line.type === 'add') return typeof line.newLine === 'number'
  return false
}

const parseDiffArtifact = (value: unknown): TextFileDiffArtifact => {
  if (!value || typeof value !== 'object') throw new Error('文本 diff 数据格式无效')
  const artifact = value as Record<string, unknown>
  if (
    artifact.version !== 1 ||
    typeof artifact.oldLineCount !== 'number' ||
    typeof artifact.newLineCount !== 'number' ||
    !Array.isArray(artifact.hunks)
  ) {
    throw new Error('文本 diff 数据格式无效')
  }
  for (const valueHunk of artifact.hunks) {
    if (!valueHunk || typeof valueHunk !== 'object') throw new Error('文本 diff 数据格式无效')
    const hunk = valueHunk as Record<string, unknown>
    if (
      typeof hunk.oldStart !== 'number' ||
      typeof hunk.newStart !== 'number' ||
      !Array.isArray(hunk.lines) ||
      !hunk.lines.every(isValidDiffLine)
    ) {
      throw new Error('文本 diff 数据格式无效')
    }
  }
  return value as TextFileDiffArtifact
}

const flattenDiffRows = (artifact: TextFileDiffArtifact): DiffRow[] => {
  const rows: DiffRow[] = []
  let previousOldEnd = 1
  let previousNewEnd = 1
  artifact.hunks.forEach((hunk, hunkIndex) => {
    const oldGap = Math.max(0, hunk.oldStart - previousOldEnd)
    const newGap = Math.max(0, hunk.newStart - previousNewEnd)
    const omittedCount = Math.min(oldGap, newGap)
    if (omittedCount > 0) {
      rows.push({
        kind: 'separator',
        key: `separator-${hunkIndex}`,
        count: omittedCount
      })
    }
    hunk.lines.forEach((line, lineIndex) => {
      rows.push({
        kind: 'line',
        key: `${hunkIndex}-${lineIndex}`,
        hunkIndex,
        lineIndex,
        line
      })
    })
    previousOldEnd = hunk.oldStart + hunk.lines.filter((line) => line.type !== 'add').length
    previousNewEnd = hunk.newStart + hunk.lines.filter((line) => line.type !== 'remove').length
  })
  const trailingOldGap = Math.max(0, artifact.oldLineCount - previousOldEnd + 1)
  const trailingNewGap = Math.max(0, artifact.newLineCount - previousNewEnd + 1)
  const trailingCount = Math.min(trailingOldGap, trailingNewGap)
  if (trailingCount > 0) {
    rows.push({ kind: 'separator', key: 'separator-trailing', count: trailingCount })
  }
  return rows
}

const findPairedLine = (
  lines: readonly TextFileDiffLine[],
  lineIndex: number
): TextFileDiffLine | undefined => {
  const current = lines[lineIndex]
  if (!current || current.type === 'context') return undefined
  let start = lineIndex
  let end = lineIndex
  while (start > 0 && lines[start - 1]?.type !== 'context') start -= 1
  while (end + 1 < lines.length && lines[end + 1]?.type !== 'context') end += 1
  const group = lines.slice(start, end + 1)
  const removes = group.filter((line) => line.type === 'remove')
  const adds = group.filter((line) => line.type === 'add')
  if (current.type === 'remove') return adds[removes.indexOf(current)]
  return removes[adds.indexOf(current)]
}

const renderLineText = (
  line: TextFileDiffLine,
  pairedLine: TextFileDiffLine | undefined
): React.ReactNode => {
  if (!pairedLine || line.type === 'context' || pairedLine.type === 'context') return line.text
  const before = line.type === 'remove' ? line.text : pairedLine.text
  const after = line.type === 'add' ? line.text : pairedLine.text
  return diffWordsWithSpace(before, after).map((part, index) => {
    if (line.type === 'remove' && part.added) return null
    if (line.type === 'add' && part.removed) return null
    const emphasized = line.type === 'remove' ? part.removed : part.added
    return (
      <span
        key={`${String(index)}-${part.value}`}
        className={
          emphasized
            ? line.type === 'remove'
              ? 'rounded-sm bg-[#F2C9C5]'
              : 'rounded-sm bg-[#BFE3C8]'
            : undefined
        }
      >
        {part.value}
      </span>
    )
  })
}

const DiffLineRow = ({
  row,
  artifact
}: {
  row: Extract<DiffRow, { kind: 'line' }>
  artifact: TextFileDiffArtifact
}) => {
  const { line } = row
  const pairedLine = findPairedLine(artifact.hunks[row.hunkIndex]?.lines || [], row.lineIndex)
  const backgroundClass =
    line.type === 'remove'
      ? 'bg-[#FFF1F0] text-[#7D2520]'
      : line.type === 'add'
        ? 'bg-[#EEFAF1] text-[#205C31]'
        : 'bg-white text-[#37352F]'
  const marker = line.type === 'remove' ? '−' : line.type === 'add' ? '+' : ' '
  const oldLine = line.type === 'add' ? '' : String(line.oldLine)
  const newLine = line.type === 'remove' ? '' : String(line.newLine)
  const displayLine = line.type === 'remove' ? oldLine : newLine
  const railClass =
    line.type === 'remove'
      ? 'border-l-[#D92D20]'
      : line.type === 'add'
        ? 'border-l-[#12A150]'
        : 'border-l-transparent'

  return (
    <div
      className={`grid h-7 min-w-max grid-cols-[56px_28px_1fr] border-b border-l-4 border-[#F3F2F0] font-mono text-[12px] leading-7 ${backgroundClass} ${railClass}`}
      data-diff-line-type={line.type}
      data-old-line={oldLine}
      data-new-line={newLine}
    >
      <span className="select-none border-r border-[#E9E8E5] px-2 text-right text-[#9B9A97]">
        {displayLine}
      </span>
      <span className="select-none text-center">{marker}</span>
      <span className="whitespace-pre pr-6 [tab-size:2]">{renderLineText(line, pairedLine)}</span>
    </div>
  )
}

export const TextFileDiffViewer = ({ previewPath }: { previewPath: string }) => {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    void window.api
      .readFile(previewPath)
      .then((bytes) => {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        const artifact = parseDiffArtifact(JSON.parse(text))
        if (!cancelled) setState({ status: 'ready', artifact })
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error)
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [previewPath])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const updateHeight = (): void => setViewportHeight(viewport.clientHeight || 600)
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [state.status])

  const rows = useMemo(
    () => (state.status === 'ready' ? flattenDiffRows(state.artifact) : []),
    [state]
  )

  if (state.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <Spin />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-[#B3261E]">
        {state.message}
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center"
        data-testid={workbenchSelectors.textDiffViewer}
      >
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="创建了空文件" />
      </div>
    )
  }

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS)
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN_ROWS * 2
  const endIndex = Math.min(rows.length, startIndex + visibleCount)
  const visibleRows = rows.slice(startIndex, endIndex)

  return (
    <div
      ref={viewportRef}
      className="h-full overflow-auto bg-white"
      data-testid={workbenchSelectors.textDiffViewer}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="relative min-w-max" style={{ height: rows.length * ROW_HEIGHT }}>
        <div
          className="absolute right-0 left-0"
          style={{ transform: `translateY(${String(startIndex * ROW_HEIGHT)}px)` }}
        >
          {visibleRows.map((row) =>
            row.kind === 'separator' ? (
              <div
                key={row.key}
                className="h-7 border-y border-[#E9E8E5] bg-[#F7F7F5] px-4 font-mono text-[12px] leading-7 text-[#787774]"
                data-diff-omitted-count={row.count}
              >
                {row.count} 行未修改
              </div>
            ) : (
              <DiffLineRow key={row.key} row={row} artifact={state.artifact} />
            )
          )}
        </div>
      </div>
    </div>
  )
}
