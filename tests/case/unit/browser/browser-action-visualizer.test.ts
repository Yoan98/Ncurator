import { describe, expect, it, vi } from 'vitest'
import {
  BrowserActionVisualizer,
  type BrowserActionVisualLocator,
  type BrowserActionVisualPage
} from '../../../../src/main/services/browser/BrowserActionVisualizer'

const createPage = () => {
  const locator: BrowserActionVisualLocator = {
    centroid: vi.fn().mockResolvedValue({ x: 120, y: 80 }),
    highlight: vi.fn().mockResolvedValue(undefined)
  }
  const page: BrowserActionVisualPage = {
    enableCursorOverlay: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    deepLocator: vi.fn().mockReturnValue(locator)
  }
  return { page, locator }
}

describe('BrowserActionVisualizer', () => {
  it('prepares the built-in Stagehand cursor without throwing', async () => {
    const { page } = createPage()
    const visualizer = new BrowserActionVisualizer()

    await visualizer.prepare(page)

    expect(page.enableCursorOverlay).toHaveBeenCalledOnce()
    expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('__v3_cursor_overlay__'))
    expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('transition'))
  })

  it.each(['UnderstudyClickEvent', 'UnderstudyFillEvent', 'UnderstudySelectOptionEvent'])(
    'moves to and highlights the target for %s',
    async (eventType) => {
      const { page, locator } = createPage()
      const visualizer = new BrowserActionVisualizer()

      visualizer.handleFlowEvent(page, {
        eventType,
        data: { target: 'xpath=/html/body/button[1]' }
      })
      await visualizer.flush()

      expect(page.deepLocator).toHaveBeenCalledWith('xpath=/html/body/button[1]')
      expect(locator.centroid).toHaveBeenCalledOnce()
      expect(locator.highlight).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 240 }))
      expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('api.move(120, 80)'))
    }
  )

  it('uses CDP mouse coordinates and shows a click pulse', async () => {
    const { page } = createPage()
    const visualizer = new BrowserActionVisualizer()

    visualizer.handleFlowEvent(page, {
      eventType: 'CdpCallEvent',
      data: {
        method: 'Input.dispatchMouseEvent',
        params: { type: 'mouseMoved', x: 42.4, y: 61.6 }
      }
    })
    visualizer.handleFlowEvent(page, {
      eventType: 'CdpCallEvent',
      data: {
        method: 'Input.dispatchMouseEvent',
        params: { type: 'mousePressed', x: 42.4, y: 61.6 }
      }
    })
    await visualizer.flush()

    expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('api.move(42, 62)'))
    expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('scale(0.78)'))
  })

  it('ignores completed, error, malformed and unrelated events', async () => {
    const { page, locator } = createPage()
    const visualizer = new BrowserActionVisualizer()

    for (const event of [
      { eventType: 'UnderstudyClickCompletedEvent', data: { target: 'xpath=/button' } },
      { eventType: 'UnderstudyClickErrorEvent', data: { target: 'xpath=/button' } },
      { eventType: 'LlmRequestEvent', data: { target: 'xpath=/button' } },
      { eventType: 'UnderstudyClickEvent', data: {} },
      { eventType: 'CdpCallEvent', data: { method: 'Runtime.evaluate', params: {} } },
      null
    ]) {
      visualizer.handleFlowEvent(page, event)
    }
    await visualizer.flush()

    expect(page.deepLocator).not.toHaveBeenCalled()
    expect(locator.highlight).not.toHaveBeenCalled()
    expect(page.evaluate).not.toHaveBeenCalled()
  })

  it('does not expose failures from any visual-only page API', async () => {
    const { page, locator } = createPage()
    vi.mocked(page.enableCursorOverlay).mockRejectedValueOnce(new Error('cursor unavailable'))
    vi.mocked(locator.centroid).mockRejectedValueOnce(new Error('target disappeared'))
    vi.mocked(locator.highlight).mockRejectedValueOnce(new Error('overlay unavailable'))
    vi.mocked(page.evaluate).mockRejectedValue(new Error('page navigated'))
    const visualizer = new BrowserActionVisualizer()

    await expect(visualizer.prepare(page)).resolves.toBeUndefined()
    visualizer.handleFlowEvent(page, {
      eventType: 'UnderstudyClickEvent',
      data: { target: 'xpath=/html/body/button[1]' }
    })
    visualizer.handleFlowEvent(page, {
      eventType: 'CdpCallEvent',
      data: {
        method: 'Input.dispatchMouseEvent',
        params: { type: 'mouseMoved', x: 20, y: 30 }
      }
    })

    await expect(visualizer.flush()).resolves.toBeUndefined()
    await expect(visualizer.hide(page)).resolves.toBeUndefined()
  })

  it('stops waiting when a visual-only page API hangs', async () => {
    vi.useFakeTimers()
    try {
      const { page } = createPage()
      vi.mocked(page.enableCursorOverlay).mockReturnValueOnce(new Promise(() => undefined))
      const visualizer = new BrowserActionVisualizer()

      const prepare = visualizer.prepare(page)
      await vi.advanceTimersByTimeAsync(500)

      await expect(prepare).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
