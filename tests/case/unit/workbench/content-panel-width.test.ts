import { describe, expect, it } from 'vitest'
import {
  WORKBENCH_CONTENT_PANEL_DEFAULT_RATIO,
  WORKBENCH_CONTENT_PANEL_MAX_RATIO,
  WORKBENCH_CONTENT_PANEL_MIDDLE_MIN_WIDTH,
  WORKBENCH_CONTENT_PANEL_MIN_WIDTH,
  clampWorkbenchContentPanelRatio,
  resolveWorkbenchContentPanelWidth
} from '../../../../src/renderer/src/components/workbench/constants'

describe('workbench content panel width', () => {
  it('clamps invalid ratios to the default range', () => {
    expect(clampWorkbenchContentPanelRatio(Number.NaN)).toBe(WORKBENCH_CONTENT_PANEL_DEFAULT_RATIO)
    expect(clampWorkbenchContentPanelRatio(0)).toBe(0.15)
    expect(clampWorkbenchContentPanelRatio(1)).toBe(WORKBENCH_CONTENT_PANEL_MAX_RATIO)
  })

  it('resolves width from the main-split available width, not the full viewport', () => {
    const available = 1000
    const width = resolveWorkbenchContentPanelWidth(available, 0.48)
    expect(width).toBe(480)
    expect(width).toBeLessThanOrEqual(available - WORKBENCH_CONTENT_PANEL_MIDDLE_MIN_WIDTH)
  })

  it('keeps a usable minimum while preserving middle min width', () => {
    const available = 800
    const width = resolveWorkbenchContentPanelWidth(available, 0.1)
    expect(width).toBe(WORKBENCH_CONTENT_PANEL_MIN_WIDTH)
    expect(available - width).toBeGreaterThanOrEqual(WORKBENCH_CONTENT_PANEL_MIDDLE_MIN_WIDTH)
  })

  it('scales proportionally when the available width changes', () => {
    const ratio = 0.4
    const narrow = resolveWorkbenchContentPanelWidth(900, ratio)
    const wide = resolveWorkbenchContentPanelWidth(1200, ratio)
    expect(narrow / 900).toBeCloseTo(ratio, 5)
    expect(wide / 1200).toBeCloseTo(ratio, 5)
    expect(wide).toBeGreaterThan(narrow)
  })
})
