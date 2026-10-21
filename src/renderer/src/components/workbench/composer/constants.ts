import { t, getProductName } from '../../../i18n'
import type { ReferenceKind } from '../../../../../shared/types'

export const resolvePartnerDisplayName = (partnerName?: string | null): string =>
  partnerName?.trim() || getProductName()

export const buildComposerPlaceholder = (partnerName?: string | null): string =>
  t(($) => $.workbench.tellWhatToDoOrAFile, { value1: resolvePartnerDisplayName(partnerName) })

export const buildPartnerGuidePlaceholder = (partnerName?: string | null): string =>
  t(($) => $.workbench.tellHowToProceed, {
    value1: partnerName?.trim() || t(($) => $.common.partner)
  })

export const COMPOSER_REFERENCE_KINDS: ReferenceKind[] = ['directory', 'file', 'web']
