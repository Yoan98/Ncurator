export const PARTNER_CACHE_CATEGORIES = ['scripts', 'toolresult', 'assets', 'file-changes'] as const

export type PartnerCacheCategory = (typeof PARTNER_CACHE_CATEGORIES)[number]

export type PartnerCacheRequest = {
  partnerIds: string[]
  categories: PartnerCacheCategory[]
  before: number
}

export type PartnerCacheRow = {
  category: PartnerCacheCategory
  day: number
  count: number
  bytes: number
}

export type PartnerCacheTotal = Omit<PartnerCacheRow, 'day'> & { skippedCount: number }

export type PartnerCachePreview = {
  success: boolean
  totals: PartnerCacheTotal[]
  rows: PartnerCacheRow[]
  error?: string
}

export type PartnerCacheCleanupResult = {
  success: boolean
  deletedCount: number
  freedBytes: number
  skippedCount: number
  error?: string
}

export type PartnerCacheOpenRequest = {
  partnerId: string
  category: PartnerCacheCategory
}
