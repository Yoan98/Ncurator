export type WebSearchLinkItem = {
  href: string
  text?: string
  title?: string
}

export type WebSearchItem = {
  requestedUrl: string
  finalUrl?: string
  title?: string
  markdown?: string
  links?: {
    internal: WebSearchLinkItem[]
    external: WebSearchLinkItem[]
  }
  publishedAt?: string
  error?: string
  statusCode?: number
}

export type WebSearchOutput = {
  items: WebSearchItem[]
}

export type BrowserUsePage = {
  url: string
  title?: string
}

export type BrowserActionCandidate = {
  description: string
  method?: string
  arguments?: string[]
}

export type BrowserUseNavigateOutput = {
  action: 'navigate'
  page: BrowserUsePage
}

export type BrowserUseExtractOutput = {
  action: 'extract'
  page: BrowserUsePage
  content: string
}

export type BrowserUseObserveOutput = {
  action: 'observe'
  page: BrowserUsePage
  actions: BrowserActionCandidate[]
}

export type BrowserUseActOutput = {
  action: 'act'
  page: BrowserUsePage
  success: boolean
  message: string
  actionDescription: string
  actions?: BrowserActionCandidate[]
}

export type BrowserUseErrorOutput = {
  action?: 'navigate' | 'extract' | 'observe' | 'act'
  page?: BrowserUsePage
  error: string
}

export type BrowserUseOutput =
  | BrowserUseNavigateOutput
  | BrowserUseExtractOutput
  | BrowserUseObserveOutput
  | BrowserUseActOutput
  | BrowserUseErrorOutput
