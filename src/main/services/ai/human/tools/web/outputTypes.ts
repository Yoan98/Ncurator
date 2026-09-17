export type WebSearchLinkItem = {
  href: string
  text?: string
  title?: string
}

export type WebSearchResultItem = {
  rank: number
  title: string
  url: string
  snippet?: string
}

export type WebSearchSearchOutput = {
  query: string
  results: WebSearchResultItem[]
}

export type WebSearchFetchOutput = {
  requestedUrl: string
  finalUrl: string
  title?: string
  markdown: string
  links: {
    internal: WebSearchLinkItem[]
    external: WebSearchLinkItem[]
  }
  publishedAt?: string
}

export type WebSearchFetchFailureOutput = {
  error: string
  requestedUrl: string
  finalUrl?: string
  statusCode?: number
}

export type BrowserUsePage = {
  url: string
  title?: string
}

export type BrowserActionCandidate = {
  actionId: string
  description: string
  method: string
  arguments: string[]
  selector: string
}

export type BrowserUseTabItem = {
  tabId: string
  title: string
  url: string
  active: boolean
}

export type BrowserUseNavigateOutput = {
  action: 'navigate'
  tabId: string
  page: BrowserUsePage
}

export type BrowserUseListTabsOutput = {
  action: 'list_tabs'
  tabs: BrowserUseTabItem[]
}

export type BrowserUseExtractOutput = {
  action: 'extract'
  tabId: string
  page: BrowserUsePage
  content: string
}

export type BrowserUseObserveOutput = {
  action: 'observe'
  tabId: string
  page: BrowserUsePage
  actions: BrowserActionCandidate[]
}

export type BrowserUseActOutput = {
  action: 'act'
  tabId: string
  page: BrowserUsePage
  message: string
  actionDescription: string
  executed: BrowserActionCandidate
}

export type BrowserUseActInstructionOutput = {
  action: 'act_instruction'
  tabId: string
  page: BrowserUsePage
  message: string
  actionDescription: string
}

export type BrowserUseScreenshotOutput = {
  action: 'screenshot'
  tabId: string
  page: BrowserUsePage
  path: string
}

export type BrowserUseScrollOutput = {
  action: 'scroll'
  tabId: string
  page: BrowserUsePage
  message: string
  scrolledPixels: number
}

export type BrowserUseErrorOutput = {
  action?: 'navigate' | 'list_tabs' | 'extract' | 'observe' | 'act' | 'act_instruction' | 'screenshot' | 'scroll'
  tabId?: string
  page?: BrowserUsePage
  error: string
  message?: string
  actionDescription?: string
}

export type BrowserUseOutput =
  | BrowserUseNavigateOutput
  | BrowserUseListTabsOutput
  | BrowserUseExtractOutput
  | BrowserUseObserveOutput
  | BrowserUseActOutput
  | BrowserUseActInstructionOutput
  | BrowserUseScreenshotOutput
  | BrowserUseScrollOutput
  | BrowserUseErrorOutput
