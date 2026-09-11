export interface BrowserActionVisualLocator {
  centroid(): Promise<{ x: number; y: number }>
  highlight(options?: {
    durationMs?: number
    borderColor?: { r: number; g: number; b: number; a?: number }
    contentColor?: { r: number; g: number; b: number; a?: number }
  }): Promise<void>
}

export interface BrowserActionVisualPage {
  enableCursorOverlay(): Promise<void>
  evaluate<R = unknown>(expression: string): Promise<R>
  deepLocator(selector: string): BrowserActionVisualLocator
}

interface FlowEventLike {
  eventType: string
  data: Record<string, unknown>
}

export const BROWSER_CURSOR_OVERLAY_ID = '__v3_cursor_overlay__'
const PREPARE_TIMEOUT_MS = 500
const FLUSH_TIMEOUT_MS = 500
const HIDE_TIMEOUT_MS = 250
const CURSOR_TRANSITION =
  'left 180ms cubic-bezier(0.22, 1, 0.36, 1), top 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 100ms ease, transform 90ms ease'

export const createHideCursorScript = (): string => `(() => {
  const cursor = document.getElementById('${BROWSER_CURSOR_OVERLAY_ID}')
  if (!cursor) return
  cursor.style.transition = 'opacity 200ms ease'
  cursor.style.opacity = '0'
  cursor.dataset.ncuratorPositioned = '0'
  setTimeout(() => {
    if (cursor.style.opacity === '0') {
      cursor.style.display = 'none'
    }
  }, 220)
})()`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toFlowEvent = (value: unknown): FlowEventLike | null => {
  if (!isRecord(value) || typeof value.eventType !== 'string' || !isRecord(value.data)) return null
  return {
    eventType: value.eventType,
    data: value.data
  }
}

const isFiniteCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const settleWithin = async (promise: Promise<unknown>, timeoutMs: number): Promise<void> => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise.then(
        () => undefined,
        () => undefined
      ),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs)
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export class BrowserActionVisualizer {
  private readonly pending = new Set<Promise<void>>()
  private lastMove: { x: number; y: number; at: number } | null = null

  public async prepare(page: BrowserActionVisualPage): Promise<void> {
    await settleWithin(
      (async () => {
        await page.enableCursorOverlay()
        await page.evaluate(`(() => {
        const cursor = document.getElementById('${BROWSER_CURSOR_OVERLAY_ID}')
        if (!cursor) return
        cursor.style.pointerEvents = 'none'
        cursor.style.transform = 'scale(1)'
        cursor.style.transformOrigin = '2px 2px'
        cursor.style.filter = 'drop-shadow(0 2px 3px rgba(0, 0, 0, 0.35))'
        cursor.style.transition = '${CURSOR_TRANSITION}'
        if (cursor.dataset.ncuratorPositioned !== '1') {
          cursor.style.opacity = '0'
        }
      })()`)
      })(),
      PREPARE_TIMEOUT_MS
    )
  }

  public handleFlowEvent(page: BrowserActionVisualPage, rawEvent: unknown): void {
    const event = toFlowEvent(rawEvent)
    if (!event) return

    if (event.eventType === 'CdpCallEvent') {
      this.handleCdpCall(page, event.data)
      return
    }

    if (!event.eventType.startsWith('Understudy')) return
    if (event.eventType.endsWith('CompletedEvent') || event.eventType.endsWith('ErrorEvent')) return

    const selector = event.data.target
    if (typeof selector !== 'string' || !selector.trim()) return
    this.schedule(async () => {
      const locator = page.deepLocator(selector)
      await Promise.allSettled([
        this.moveToLocator(page, locator),
        locator.highlight({
          durationMs: 240,
          borderColor: { r: 55, g: 125, b: 255, a: 0.95 },
          contentColor: { r: 55, g: 125, b: 255, a: 0.16 }
        })
      ])
    })
  }

  public async flush(): Promise<void> {
    await settleWithin(Promise.allSettled([...this.pending]), FLUSH_TIMEOUT_MS)
  }

  public async hide(page: BrowserActionVisualPage): Promise<void> {
    await settleWithin(page.evaluate(createHideCursorScript()), HIDE_TIMEOUT_MS)
  }

  private handleCdpCall(page: BrowserActionVisualPage, data: Record<string, unknown>): void {
    if (data.method !== 'Input.dispatchMouseEvent' || !isRecord(data.params)) return
    const { type, x, y } = data.params
    if (type === 'mouseMoved' && isFiniteCoordinate(x) && isFiniteCoordinate(y)) {
      this.schedule(() => this.moveCursor(page, x, y))
      return
    }
    if (type === 'mousePressed') {
      this.schedule(() => this.pulseCursor(page))
    }
  }

  private async moveToLocator(
    page: BrowserActionVisualPage,
    locator: BrowserActionVisualLocator
  ): Promise<void> {
    const { x, y } = await locator.centroid()
    await this.moveCursor(page, x, y)
  }

  private async moveCursor(page: BrowserActionVisualPage, x: number, y: number): Promise<void> {
    const now = Date.now()
    if (
      this.lastMove &&
      this.lastMove.x === x &&
      this.lastMove.y === y &&
      now - this.lastMove.at < 250
    ) {
      return
    }
    this.lastMove = { x, y, at: now }

    await page.evaluate(`(() => {
      const cursor = document.getElementById('${BROWSER_CURSOR_OVERLAY_ID}')
      const api = window.__v3Cursor
      if (!cursor || !api) return
      const firstMove = cursor.dataset.ncuratorPositioned !== '1'
      if (firstMove) cursor.style.transition = 'opacity 100ms ease'
      cursor.style.display = 'block'
      cursor.style.opacity = '1'
      api.move(${String(Math.round(x))}, ${String(Math.round(y))})
      cursor.dataset.ncuratorPositioned = '1'
      if (firstMove) requestAnimationFrame(() => {
        cursor.style.transition = '${CURSOR_TRANSITION}'
      })
    })()`)
  }

  private async pulseCursor(page: BrowserActionVisualPage): Promise<void> {
    await page.evaluate(`(() => {
      const cursor = document.getElementById('${BROWSER_CURSOR_OVERLAY_ID}')
      if (!cursor) return
      cursor.style.transform = 'scale(0.78)'
      setTimeout(() => { cursor.style.transform = 'scale(1)' }, 90)
    })()`)
  }

  private schedule(task: () => Promise<void>): void {
    let pending: Promise<void>
    try {
      pending = task().catch(() => {
        // Ignore visual-only failures so Stagehand can continue the real action.
      })
    } catch {
      return
    }
    this.pending.add(pending)
    void pending.finally(() => this.pending.delete(pending))
  }
}
