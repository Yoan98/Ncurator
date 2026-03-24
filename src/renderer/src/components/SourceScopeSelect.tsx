import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Select, Spin, Tag } from 'antd'
import type { SourceScopeSelection } from '../../../shared/types'
import {
  HiFolder,
  HiDocumentText,
  HiGlobeAlt,
  HiRectangleStack
} from 'react-icons/hi2'

type SourceScopeSelectProps = {
  mode: 'chat' | 'search'
  value: SourceScopeSelection[]
  onChange: (nextValue: SourceScopeSelection[]) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

const getScopeKey = (scope: SourceScopeSelection): string =>
  [scope.sourceType, scope.sourceId, scope.scopeType, scope.nodeId || 'root'].join(':')

const getScopeIcon = (scope: SourceScopeSelection): React.ReactNode => {
  if (scope.scopeType === 'workspace') return <HiRectangleStack className="w-4 h-4 text-[#D97757]" />
  if (scope.scopeType === 'directory') return <HiFolder className="w-4 h-4 text-[#D97757]" />
  if (scope.scopeType === 'file') return <HiDocumentText className="w-4 h-4 text-[#666666]" />
  return <HiGlobeAlt className="w-4 h-4 text-[#D97757]" />
}

const getScopeTypeLabel = (scope: SourceScopeSelection): string => {
  if (scope.scopeType === 'workspace') return '工作空间'
  if (scope.scopeType === 'directory') return '目录'
  if (scope.scopeType === 'file') return '文件'
  return '网页'
}

const SourceScopeSelect: React.FC<SourceScopeSelectProps> = ({
  mode,
  value,
  onChange,
  placeholder,
  disabled,
  className
}) => {
  const [options, setOptions] = useState<SourceScopeSelection[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')

  const loadOptions = useCallback(
    async (nextQuery?: string) => {
      setLoading(true)
      try {
        const response = await window.api.sourceScopeList({
          mode,
          query: String(nextQuery || '').trim() || undefined
        })
        setOptions(response.items)
      } finally {
        setLoading(false)
      }
    },
    [mode]
  )

  useEffect(() => {
    void loadOptions(query)
  }, [loadOptions, query])

  const mergedScopes = useMemo(() => {
    const scopeMap = new Map<string, SourceScopeSelection>()
    value.forEach((scope) => scopeMap.set(getScopeKey(scope), scope))
    options.forEach((scope) => scopeMap.set(getScopeKey(scope), scope))
    return Array.from(scopeMap.values())
  }, [options, value])

  const scopeMap = useMemo(
    () => new Map(mergedScopes.map((scope) => [getScopeKey(scope), scope] as const)),
    [mergedScopes]
  )

  return (
    <Select
      mode="multiple"
      size="large"
      value={value.map(getScopeKey)}
      disabled={disabled}
      loading={loading}
      showSearch
      filterOption={false}
      allowClear
      maxTagCount="responsive"
      className={className}
      placeholder={placeholder}
      notFoundContent={loading ? <Spin size="small" /> : '没有匹配的资料范围'}
      onSearch={(nextQuery) => setQuery(nextQuery)}
      onFocus={() => {
        void loadOptions(query)
      }}
      onChange={(nextKeys) => {
        const nextScopes = nextKeys
          .map((key) => scopeMap.get(String(key)))
          .filter((scope): scope is SourceScopeSelection => Boolean(scope))
        onChange(nextScopes)
      }}
      options={mergedScopes.map((scope) => ({
        value: getScopeKey(scope),
        label: (
          <div className="flex min-w-0 items-center gap-2 py-1">
            {getScopeIcon(scope)}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] text-[#1F1F1F]">{scope.label}</div>
              <div className="truncate text-[12px] text-[#999999]">
                {scope.relativePath || scope.absolutePath || getScopeTypeLabel(scope)}
              </div>
            </div>
            <Tag className="!mr-0 rounded-full border-[#F4E5DF] bg-[#FBF5F2] text-[#D97757]">
              {getScopeTypeLabel(scope)}
            </Tag>
            {scope.sourceType === 'workspace' && (
              <Tag
                className={`!mr-0 rounded-full ${
                  scope.hasUnpreparedFiles
                    ? 'border-[#FDE2D8] bg-[#FFF3EE] text-[#C66A4A]'
                    : 'border-[#E5E5E4] bg-[#F8F8F7] text-[#666666]'
                }`}
              >
                {scope.hasUnpreparedFiles
                  ? `未准备 ${scope.unpreparedFileCount || 0}`
                  : `已准备 ${scope.preparedDocumentCount || 0}`}
              </Tag>
            )}
          </div>
        )
      }))}
    />
  )
}

export default SourceScopeSelect
