import type { BrowserUseResult, BrowserUseRunRequest } from '../ai/types'
import type { BrowserPanelState } from '../../../shared/types'

export type BrowserPanelBoundsState = {
  x: number
  y: number
  width: number
  height: number
}

export type BrowserUseRunInput = BrowserUseRunRequest

export type BrowserUseRunResult = BrowserUseResult

export type { BrowserPanelState }
