import type { BrowserUseAction, BrowserUseResult } from '../ai/types'
import type { LlmRuntimeConfig } from '../../../shared/types'
import type { BrowserPanelState } from '../../../shared/types'

export type BrowserPanelBoundsState = {
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}

export type BrowserUseRunInput = {
  tabId: string
  action: BrowserUseAction
  instruction: string
  url?: string
  llmConfig: LlmRuntimeConfig
}

export type BrowserUseRunResult = BrowserUseResult

export type { BrowserPanelState }
