import { t, getRendererRuntime } from '../../../i18n'
import {
  HiArrowPath,
  HiCheckCircle,
  HiOutlineClock,
  HiOutlineExclamationCircle
} from 'react-icons/hi2'
import type { WebSourceRecord, WorkspaceTreeEntry } from '../../../../../shared/types'
import type { StatusBadgeVisual } from '../types'

const STATUS_SPIN_ICON_CLASSNAME = 'h-3.5 w-3.5 animate-spin'
const STATUS_ICON_CLASSNAME = 'h-3.5 w-3.5'

export const formatDateTime = (value?: number): string => {
  if (!value) return t(($) => $.settings.noRecordsYet)
  return new Date(value).toLocaleString(getRendererRuntime().locale, {
    hour12: false
  })
}

export const getTreeEntryStatusMeta = (
  entry: WorkspaceTreeEntry
): { label: string; className: string } | null => {
  if (entry.kind !== 'file' || !entry.supported_for_index) return null
  switch (entry.index_status) {
    case 'indexing':
      return {
        label: t(($) => $.settings.indexing),
        className: 'border-[#EEEEEC] bg-[#F4F4F2] text-[#2F3437]'
      }
    case 'indexed':
      return {
        label: t(($) => $.common.indexed),
        className: 'border-[#E0DFDC] bg-[#F7F7F5] text-[#787774]'
      }
    case 'failed':
      return {
        label: t(($) => $.common.failed),
        className: 'border-[#E7CAC6] bg-[#F8EBE9] text-[#B3261E]'
      }
    default:
      return {
        label: t(($) => $.settings.indexable),
        className: 'border-[#EEEEEC] bg-[#F7F7F5] text-[#787774]'
      }
  }
}

export const getWebStatusBadge = (
  source: Pick<WebSourceRecord, 'index_status' | 'last_indexed_at' | 'last_error'>,
  isRefreshing: boolean
): StatusBadgeVisual => {
  if (isRefreshing || source.index_status === 'crawling') {
    return {
      label: t(($) => $.settings.fetching),
      className: 'border-[#EEEEEC] bg-[#F4F4F2] text-[#2F3437]',
      tooltip: t(($) => $.settings.fetchingTheWebpageContent),
      icon: <HiArrowPath className={STATUS_SPIN_ICON_CLASSNAME} />
    }
  }

  if (source.index_status === 'indexing') {
    return {
      label: t(($) => $.settings.indexing),
      className: 'border-[#EEEEEC] bg-[#F4F4F2] text-[#2F3437]',
      tooltip: t(($) => $.settings.buildingTheWebpageIndex),
      icon: <HiArrowPath className={STATUS_SPIN_ICON_CLASSNAME} />
    }
  }

  if (source.index_status === 'indexed') {
    return {
      label: t(($) => $.common.indexed),
      className: 'border-[#E0DFDC] bg-[#F7F7F5] text-[#787774]',
      tooltip: t(($) => $.settings.lastIndexed, { value1: formatDateTime(source.last_indexed_at) }),
      icon: <HiCheckCircle className={STATUS_ICON_CLASSNAME} />
    }
  }

  if (source.index_status === 'crawl_failed') {
    return {
      label: t(($) => $.settings.fetchFailed),
      className: 'border-[#E7CAC6] bg-[#F8EBE9] text-[#B3261E]',
      tooltip: source.last_error || t(($) => $.settings.theMostRecentWebpageFetchFailed),
      icon: <HiOutlineExclamationCircle className={STATUS_ICON_CLASSNAME} />
    }
  }

  if (source.index_status === 'index_failed') {
    return {
      label: t(($) => $.settings.indexingFailed),
      className: 'border-[#E7CAC6] bg-[#F8EBE9] text-[#B3261E]',
      tooltip: source.last_error || t(($) => $.settings.theMostRecentWebpageIndexingFailed),
      icon: <HiOutlineExclamationCircle className={STATUS_ICON_CLASSNAME} />
    }
  }

  return {
    label: t(($) => $.settings.indexable),
    className: 'border-[#EEEEEC] bg-[#F7F7F5] text-[#787774]',
    tooltip: t(($) => $.settings.thisWebpageNeedsToBeIndexedOrUpdated),
    icon: <HiOutlineClock className={STATUS_ICON_CLASSNAME} />
  }
}
