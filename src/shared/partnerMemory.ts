export const PARTNER_MEMORY_CATEGORIES = ['cooperation_preferences', 'project_background'] as const
export type PartnerMemoryCategory = (typeof PARTNER_MEMORY_CATEGORIES)[number]

export const PARTNER_MEMORY_LIMITS: Record<PartnerMemoryCategory, number> = {
  cooperation_preferences: 2000,
  project_background: 4000
}

export interface PartnerMemory {
  category: PartnerMemoryCategory
  enabled: boolean
  confirmed: string
  draft: string | null
  revision: number
}

export interface PartnerMemorySnapshot {
  partnerId: string
  memories: PartnerMemory[]
}

export interface PartnerMemoryUpdateRequest {
  partnerId: string
  category: PartnerMemoryCategory
  revision: number
  action: 'write' | 'accept' | 'reject'
  content?: string
}

export type PartnerMemoryUpdateResult =
  | { status: 'saved'; snapshot: PartnerMemorySnapshot }
  | { status: 'conflict'; snapshot: PartnerMemorySnapshot }
