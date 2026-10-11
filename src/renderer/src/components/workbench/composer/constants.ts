import type { ReferenceKind } from '../../../../../shared/types'
import { PRODUCT_NAME_ZH } from '../../../../../shared/constants'

export const resolvePartnerDisplayName = (partnerName?: string | null): string =>
  partnerName?.trim() || PRODUCT_NAME_ZH

export const buildComposerPlaceholder = (partnerName?: string | null): string =>
  `输入你想让${resolvePartnerDisplayName(partnerName)}做的事情或者@文件`

export const buildPartnerGuidePlaceholder = (partnerName?: string | null): string =>
  `告诉${partnerName?.trim() || '伙伴'}该怎么做`

export const COMPOSER_REFERENCE_KINDS: ReferenceKind[] = ['directory', 'file', 'web']
