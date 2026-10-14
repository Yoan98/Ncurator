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
  if (!value) return '暂无记录'
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false
  })
}

export const getTreeEntryStatusMeta = (
  entry: WorkspaceTreeEntry
): { label: string; className: string } | null => {
  if (entry.kind !== 'file' || !entry.supported_for_index) return null
  switch (entry.index_status) {
    case 'indexing':
      return { label: '索引中', className: 'border-[#EEEEEC] bg-[#F4F4F2] text-[#2F3437]' }
    case 'indexed':
      return { label: '已索引', className: 'border-[#E0DFDC] bg-[#F7F7F5] text-[#787774]' }
    case 'failed':
      return { label: '失败', className: 'border-[#E7CAC6] bg-[#F8EBE9] text-[#B3261E]' }
    default:
      return { label: '可索引', className: 'border-[#EEEEEC] bg-[#F7F7F5] text-[#787774]' }
  }
}

export const getWebStatusBadge = (
  source: Pick<WebSourceRecord, 'index_status' | 'last_indexed_at' | 'last_error'>,
  isRefreshing: boolean
): StatusBadgeVisual => {
  if (isRefreshing || source.index_status === 'crawling') {
    return {
      label: '爬取中',
      className: 'border-[#EEEEEC] bg-[#F4F4F2] text-[#2F3437]',
      tooltip: '正在爬取网页正文。',
      icon: <HiArrowPath className={STATUS_SPIN_ICON_CLASSNAME} />
    }
  }

  if (source.index_status === 'indexing') {
    return {
      label: '索引中',
      className: 'border-[#EEEEEC] bg-[#F4F4F2] text-[#2F3437]',
      tooltip: '正在建立网页索引。',
      icon: <HiArrowPath className={STATUS_SPIN_ICON_CLASSNAME} />
    }
  }

  if (source.index_status === 'indexed') {
    return {
      label: '已索引',
      className: 'border-[#E0DFDC] bg-[#F7F7F5] text-[#787774]',
      tooltip: `最近索引：${formatDateTime(source.last_indexed_at)}`,
      icon: <HiCheckCircle className={STATUS_ICON_CLASSNAME} />
    }
  }

  if (source.index_status === 'crawl_failed') {
    return {
      label: '爬取失败',
      className: 'border-[#E7CAC6] bg-[#F8EBE9] text-[#B3261E]',
      tooltip: source.last_error || '最近一次网页爬取失败。',
      icon: <HiOutlineExclamationCircle className={STATUS_ICON_CLASSNAME} />
    }
  }

  if (source.index_status === 'index_failed') {
    return {
      label: '索引失败',
      className: 'border-[#E7CAC6] bg-[#F8EBE9] text-[#B3261E]',
      tooltip: source.last_error || '最近一次网页索引失败。',
      icon: <HiOutlineExclamationCircle className={STATUS_ICON_CLASSNAME} />
    }
  }

  return {
    label: '可索引',
    className: 'border-[#EEEEEC] bg-[#F7F7F5] text-[#787774]',
    tooltip: '网页需要建立或更新索引。',
    icon: <HiOutlineClock className={STATUS_ICON_CLASSNAME} />
  }
}
