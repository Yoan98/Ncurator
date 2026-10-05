import { useEffect, useMemo, useRef, useState } from 'react'
import { diffWordsWithSpace } from 'diff'
import { Empty, Spin } from 'antd'
import type { TextFileDiffArtifact, TextFileDiffLine } from '../../../../shared/types'
import { workbenchSelectors } from '../../testing/selectors'
import { normalizeUserFacingError } from '../../utils/userFacingError'

const ROW_HEIGHT = 28
const OVERSCAN_ROWS = 24

type DiffRow =
  | { kind: 'separator'; key: string; count: number; newStart: number }
  | {
      kind: 'line'
      key: string
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
    artifact.version !== 3 ||
    typeof artifact.oldLineCount !== 'number' ||
    typeof artifact.newLineCount !== 'number' ||
    !Array.isArray(artifact.lines) ||
    !artifact.lines.every(isValidDiffLine)
  ) {
    throw new Error('文本 diff 数据格式无效')
  }
  return value as TextFileDiffArtifact
}

const flattenDiffRows = (
  artifact: TextFileDiffArtifact,
  expanded: ReadonlySet<string>
): DiffRow[] => {
  const rows: DiffRow[] = []
  const visible = new Set<number>()
  artifact.lines.forEach((line, index) => {
    if (line.type === 'context') return
    for (
      let cursor = Math.max(0, index - 3);
      cursor <= Math.min(artifact.lines.length - 1, index + 3);
      cursor++
    )
      visible.add(cursor)
  })
  let index = 0
  while (index < artifact.lines.length) {
    if (visible.has(index)) {
      rows.push({
        kind: 'line',
        key: `line-${index}`,
        lineIndex: index,
        line: artifact.lines[index++]
      })
      continue
    }
    const start = index
    while (index < artifact.lines.length && !visible.has(index)) index++
    const key = `separator-${start}`
    if (expanded.has(key)) {
      for (let cursor = start; cursor < index; cursor++)
        rows.push({
          kind: 'line',
          key: `line-${cursor}`,
          lineIndex: cursor,
          line: artifact.lines[cursor]
        })
    } else {
      const first = artifact.lines[start]
      rows.push({
        kind: 'separator',
        key,
        count: index - start,
        newStart: first.type === 'remove' ? 0 : first.newLine
      })
    }
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
  const pairedLine = findPairedLine(artifact.lines, row.lineIndex)
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
      className={`flex h-7 w-full min-w-max border-b border-l-4 border-[#F3F2F0] font-mono text-[12px] leading-7 ${backgroundClass} ${railClass}`}
      data-diff-line-type={line.type}
      data-old-line={oldLine}
      data-new-line={newLine}
    >
      <span className="w-14 shrink-0 select-none border-r border-[#E9E8E5] px-2 text-right text-[#9B9A97]">
        {displayLine}
      </span>
      <span className="w-7 shrink-0 select-none text-center">{marker}</span>
      <span className="min-w-max flex-1 whitespace-pre pr-6 [tab-size:2]">
        {renderLineText(line, pairedLine)}
      </span>
    </div>
  )
}

export const TextFileDiffViewer = ({ previewPath }: { previewPath: string }) => {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const [expandedSeparators, setExpandedSeparators] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    setExpandedSeparators(new Set())
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
            message: normalizeUserFacingError(
              error instanceof Error ? error.message : error,
              '审核内容加载失败'
            )
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
    () => (state.status === 'ready' ? flattenDiffRows(state.artifact, expandedSeparators) : []),
    [expandedSeparators, state]
  )

  const expandSeparator = (key: string): void => {
    setExpandedSeparators((current) => new Set(current).add(key))
  }

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
      <div className="relative w-max min-w-full" style={{ height: rows.length * ROW_HEIGHT }}>
        <div
          className="absolute inset-x-0 w-full min-w-full"
          style={{ transform: `translateY(${String(startIndex * ROW_HEIGHT)}px)` }}
        >
          {visibleRows.map((row) =>
            row.kind === 'separator' ? (
              <button
                type="button"
                key={row.key}
                className="block h-7 w-full border-y border-[#E9E8E5] bg-[#F7F7F5] px-4 text-left font-mono text-[12px] leading-7 text-[#787774] transition-colors hover:bg-[#EFEFEC] hover:text-[#37352F] disabled:cursor-default"
                data-diff-omitted-count={row.count}
                title="点击展开未修改内容"
                onClick={() => void expandSeparator(row.key)}
              >
                › {row.count} 行未修改
              </button>
            ) : (
              <DiffLineRow key={row.key} row={row} artifact={state.artifact} />
            )
          )}
        </div>
      </div>
    </div>
  )
}
