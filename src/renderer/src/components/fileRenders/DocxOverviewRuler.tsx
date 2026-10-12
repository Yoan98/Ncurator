import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { workbenchSelectors } from '../../testing/selectors'
import type { SelectionRect } from './selection/floatingLayout'
import type { SelectionTarget } from './selection/types'

type MarkerKind = 'reference' | 'inserted' | 'deleted' | 'formatted'
type Target = {
  id: string
  kind: MarkerKind
  label: string
  rects: () => SelectionRect[]
}
type Marker = { key: string; top: number; bottom: number; targets: Target[] }
const colors = {
  reference: '#A480C5',
  inserted: '#2F6F4E',
  deleted: '#B3261E',
  formatted: '#2F6F4E'
}
const changeLabels = { inserted: '新增', deleted: '删除', formatted: '格式修改' }

function reviewTargets(container: HTMLElement): Target[] {
  return [...container.querySelectorAll<HTMLElement>('[data-docx-change]')].flatMap(
    (element, index) => {
      const kind = element.dataset.docxChange
      if (kind !== 'inserted' && kind !== 'deleted' && kind !== 'formatted') return []
      // A marked paragraph/table already includes same-kind children; keep other kinds.
      if (element.parentElement?.closest(`[data-docx-change="${kind}"]`)) return []
      return [
        {
          id: `change-${index}`,
          kind,
          label: changeLabels[kind],
          rects: () => [...element.getClientRects()]
        }
      ]
    }
  )
}

function measureMarkers(targets: Target[], container: HTMLElement, height: number): Marker[] {
  const origin = container.getBoundingClientRect().top + container.clientTop
  const scale = height / Math.max(1, container.scrollHeight)
  const items = targets
    .flatMap((target) => {
      const rects = target.rects().filter((rect) => rect.width > 0 && rect.height > 0)
      if (!rects.length) return []
      const start = Math.min(...rects.map((r) => r.top)) - origin + container.scrollTop
      const end = Math.max(...rects.map((r) => r.bottom)) - origin + container.scrollTop
      const top = Math.max(0, Math.min(Math.max(0, height - 4), start * scale))
      return [
        {
          key: target.id,
          top,
          bottom: Math.min(height, Math.max(top + 4, end * scale)),
          targets: [target]
        }
      ]
    })
    .sort((a, b) => a.top - b.top)
  const result: Marker[] = []
  for (const lane of ['reference', 'deleted', 'positive']) {
    let previous: Marker | undefined
    for (const item of items.filter(({ targets: [target] }) =>
      lane === 'positive'
        ? target.kind === 'inserted' || target.kind === 'formatted'
        : target.kind === lane
    )) {
      if (previous && item.top <= previous.bottom) {
        previous.bottom = Math.max(previous.bottom, item.bottom)
        previous.targets.push(...item.targets)
        previous.key += `:${item.key}`
      } else {
        previous = { ...item, targets: [...item.targets] }
        result.push(previous)
      }
    }
  }
  return result.sort((a, b) => a.top - b.top)
}

export default function DocxOverviewRuler({
  container,
  mode,
  revision,
  references
}: {
  container: HTMLDivElement | null
  mode: 'references' | 'changes'
  revision: number
  references: SelectionTarget[]
}) {
  const rail = useRef<HTMLDivElement>(null)
  const cycles = useRef(new Map<string, number>())
  const [markers, setMarkers] = useState<Marker[]>([])
  const [active, setActive] = useState<Target | null>(null)
  const [focusRects, setFocusRects] = useState<SelectionRect[]>([])

  useEffect(() => {
    setActive(null)
    cycles.current.clear()
    if (!container || !rail.current || !revision) {
      setMarkers([])
      return
    }
    let targets =
      mode === 'changes'
        ? reviewTargets(container)
        : [...references]
            .sort((a, b) => {
              const first = a.geometry.ranges?.[0],
                second = b.geometry.ranges?.[0]
              return first && second ? first.compareBoundaryPoints(Range.START_TO_START, second) : 0
            })
            .map(({ node, geometry }) => ({
              id: node.id,
              kind: 'reference' as const,
              label: `引用 #${node.number}`,
              rects: geometry.rects
            }))
    let frame = 0
    let cancelled = false
    const measure = () => {
      if (!cancelled && rail.current)
        setMarkers(measureMarkers(targets, container, rail.current.clientHeight))
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const resize = new ResizeObserver(schedule)
    resize.observe(container)
    resize.observe(rail.current)
    const observeContent = () => {
      container
        .querySelectorAll('.docx-wrapper, section.docx, img, table')
        .forEach((element) => resize.observe(element))
    }
    observeContent()
    const mutations = new MutationObserver(() => {
      if (mode === 'changes') targets = reviewTargets(container)
      observeContent()
      schedule()
    })
    mutations.observe(container, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true
    })
    container.addEventListener('load', schedule, true)
    document.fonts.addEventListener('loadingdone', schedule)
    void document.fonts.ready.then(() => {
      if (!cancelled) schedule()
    })
    measure()
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      container.removeEventListener('load', schedule, true)
      document.fonts.removeEventListener('loadingdone', schedule)
    }
  }, [container, mode, revision, references])

  useEffect(() => {
    if (!active || !container) {
      setFocusRects([])
      return
    }
    const update = () => {
      const viewport = container.getBoundingClientRect()
      setFocusRects(
        active
          .rects()
          .map((rect) => {
            const top = Math.max(rect.top, viewport.top),
              bottom = Math.min(rect.bottom, viewport.bottom)
            const left = Math.max(rect.left, viewport.left),
              right = Math.min(rect.right, viewport.right)
            return { top, bottom, left, right, width: right - left, height: bottom - top }
          })
          .filter((rect) => rect.width > 0 && rect.height > 0)
      )
    }
    update()
    const timeout = window.setTimeout(() => setActive(null), 700)
    container.addEventListener('scroll', update)
    return () => {
      clearTimeout(timeout)
      container.removeEventListener('scroll', update)
    }
  }, [active, container])

  const activate = (marker: Marker) => {
    if (!container) return
    const index = cycles.current.get(marker.key) || 0
    const target = marker.targets[index % marker.targets.length]
    cycles.current.set(marker.key, index + 1)
    const rects = target.rects().filter((rect) => rect.width > 0 && rect.height > 0)
    if (!rects.length) return
    const top = Math.min(...rects.map((r) => r.top))
    const bottom = Math.max(...rects.map((r) => r.bottom))
    const offset =
      bottom - top >= container.clientHeight ? 0 : (container.clientHeight - (bottom - top)) / 2
    container.scrollTo({
      top:
        container.scrollTop +
        top -
        container.getBoundingClientRect().top -
        container.clientTop -
        offset,
      behavior: 'instant'
    })
    // A fresh object restarts the emphasis even when clicking the same target again.
    setActive({ ...target })
  }

  return (
    <div
      ref={rail}
      className="relative h-full w-[16px] shrink-0 border-l border-[#EEEEEC] bg-[#FBFBFA]"
      data-testid={workbenchSelectors.docxOverview}
      data-mode={mode}
      role="navigation"
      aria-label="文档位置标记"
    >
      {markers.map((marker) => {
        const kind = marker.targets[0].kind
        const label =
          [...new Set(marker.targets.map((t) => t.label))].join('、') +
          (marker.targets.length > 1 ? `，共 ${marker.targets.length} 处，连续点击依次定位` : '')
        return (
          <button
            key={marker.key}
            type="button"
            title={label}
            aria-label={label}
            data-testid={workbenchSelectors.docxOverviewMarker}
            data-kinds={[...new Set(marker.targets.map((t) => t.kind))].join(' ')}
            className="absolute cursor-pointer rounded-[1px] border-0 p-0 hover:brightness-90 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0B6BCB]"
            style={{
              top: marker.top,
              height: marker.bottom - marker.top,
              left: kind === 'reference' || kind === 'deleted' ? 1 : 8,
              width: kind === 'reference' ? 13 : 6,
              backgroundColor: colors[kind]
            }}
            onClick={() => activate(marker)}
          />
        )
      })}
      {active &&
        createPortal(
          focusRects.map((rect, index) => (
            <div
              key={index}
              aria-hidden="true"
              data-testid={workbenchSelectors.docxOverviewFocus}
              className="pointer-events-none fixed z-40 rounded-[1px]"
              style={{
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
                boxShadow: `inset 0 0 0 2px ${colors[active.kind]}`
              }}
            />
          )),
          document.body
        )}
    </div>
  )
}
