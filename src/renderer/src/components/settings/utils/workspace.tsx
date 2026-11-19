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
  if (entry.index_stale && entry.index_status !== 'indexing' && entry.index_status !== 'failed') {
    return {
      label: t(($) => $.settings.embedding.stale),
      className: 'border-transparent bg-[var(--notion-yellow-bg)] text-[var(--notion-yellow)]'
    }
  }
  switch (entry.index_status) {
    case 'indexing':
      return {
        label: t(($) => $.settings.indexing),
        className: 'border-[var(--notion-line)] bg-[var(--notion-surface)] text-[var(--notion-text)]'
      }
    case 'indexed':
      return {
        label: t(($) => $.common.indexed),
        className: 'border-[var(--notion-line-strong)] bg-[var(--notion-surface-sunken)] text-[var(--notion-text-soft)]'
      }
    case 'failed':
      return {
        label: t(($) => $.common.failed),
        className: 'border-[var(--notion-red)] bg-[var(--notion-red-bg)] text-[var(--notion-red)]'
      }
    default:
      return {
        label: t(($) => $.settings.indexable),
        className: 'border-[var(--notion-line)] bg-[var(--notion-surface-sunken)] text-[var(--notion-text-soft)]'
      }
  }
}

export const getWebStatusBadge = (
  source: Pick<WebSourceRecord, 'index_status' | 'last_indexed_at' | 'last_error' | 'index_stale'>,
  isRefreshing: boolean
): StatusBadgeVisual => {
  if (isRefreshing || source.index_status === 'crawling') {
    return {
      label: t(($) => $.settings.fetching),
      className: 'border-[var(--notion-line)] bg-[var(--notion-surface)] text-[var(--notion-text)]',
      tooltip: t(($) => $.settings.fetchingTheWebpageContent),
      icon: <HiArrowPath className={STATUS_SPIN_ICON_CLASSNAME} />
    }
  }

  if (source.index_status === 'indexing') {
    return {
      label: t(($) => $.settings.indexing),
      className: 'border-[var(--notion-line)] bg-[var(--notion-surface)] text-[var(--notion-text)]',
      tooltip: t(($) => $.settings.buildingTheWebpageIndex),
      icon: <HiArrowPath className={STATUS_SPIN_ICON_CLASSNAME} />
    }
  }

  if (source.index_stale && source.index_status === 'indexed') {
    return {
      label: t(($) => $.settings.embedding.stale),
      className: 'border-transparent bg-[var(--notion-yellow-bg)] text-[var(--notion-yellow)]',
      tooltip: t(($) => $.settings.embedding.staleTitle),
      icon: <HiOutlineClock className={STATUS_ICON_CLASSNAME} />
    }
  }

  if (source.index_status === 'indexed') {
    return {
      label: t(($) => $.common.indexed),
      className: 'border-[var(--notion-line-strong)] bg-[var(--notion-surface-sunken)] text-[var(--notion-text-soft)]',
      tooltip: t(($) => $.settings.lastIndexed, { value1: formatDateTime(source.last_indexed_at) }),
      icon: <HiCheckCircle className={STATUS_ICON_CLASSNAME} />
    }
  }

  if (source.index_status === 'crawl_failed') {
    return {
      label: t(($) => $.settings.fetchFailed),
      className: 'border-[var(--notion-red)] bg-[var(--notion-red-bg)] text-[var(--notion-red)]',
      tooltip: source.last_error || t(($) => $.settings.theMostRecentWebpageFetchFailed),
      icon: <HiOutlineExclamationCircle className={STATUS_ICON_CLASSNAME} />
    }
  }

  if (source.index_status === 'index_failed') {
    return {
      label: t(($) => $.settings.indexingFailed),
      className: 'border-[var(--notion-red)] bg-[var(--notion-red-bg)] text-[var(--notion-red)]',
      tooltip: source.last_error || t(($) => $.settings.theMostRecentWebpageIndexingFailed),
      icon: <HiOutlineExclamationCircle className={STATUS_ICON_CLASSNAME} />
    }
  }

  return {
    label: t(($) => $.settings.indexable),
    className: 'border-[var(--notion-line)] bg-[var(--notion-surface-sunken)] text-[var(--notion-text-soft)]',
    tooltip: t(($) => $.settings.thisWebpageNeedsToBeIndexedOrUpdated),
    icon: <HiOutlineClock className={STATUS_ICON_CLASSNAME} />
  }
}
