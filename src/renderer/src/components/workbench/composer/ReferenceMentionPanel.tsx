import React from 'react'
import { Empty, Spin } from 'antd'
import type { SelectedReference } from '../../../../../shared/types'
import { workbenchSelectors } from '../../../testing/selectors'
import { getKbAvailabilityLabel } from '../../../utils/reference'
import ReferenceIcon from './ReferenceIcon'
import { getScopeKey } from './utils'

type ReferenceMentionPanelProps = {
  loading: boolean
  options: SelectedReference[]
  activeIndex: number
  hasWorkspace: boolean
  onSelect: (reference: SelectedReference) => void
}

type ReferenceMentionGroup = {
  title: '文件' | '网页'
  items: SelectedReference[]
}

const getReferenceParentDisplayPath = (reference: SelectedReference): string => {
  if (reference.kind === 'web') return reference.url
  const pathParts = reference.relativePath.split('/').filter(Boolean)
  pathParts.pop()
  return pathParts.join('/')
}

const ReferenceMentionPanel: React.FC<ReferenceMentionPanelProps> = ({
  loading,
  options,
  activeIndex,
  hasWorkspace,
  onSelect
}) => {
  const groups = [
    {
      title: '文件',
      items: options.filter((reference) => reference.kind !== 'web')
    },
    {
      title: '网页',
      items: options.filter((reference) => reference.kind === 'web')
    }
  ] satisfies ReferenceMentionGroup[]
  const visibleGroups = groups.filter((group) => group.items.length > 0)

  return (
    <div
      className="absolute inset-x-0 bottom-full mb-2 overflow-hidden rounded-[14px] border border-[#E5E4E0] bg-white px-2 py-2 shadow-[0_16px_36px_rgba(15,15,15,0.1)]"
      data-testid={workbenchSelectors.mentionPanel}
    >
      <div className="max-h-[180px] overflow-y-auto pr-1">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-[#9B9A97]">
            <Spin size="small" />
          </div>
        ) : options.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={hasWorkspace ? '当前工作区中没有匹配项' : '请先选择工作区'}
          />
        ) : (
          <div className="space-y-2">
            {visibleGroups.map((group) => (
              <div key={group.title}>
                <div className="px-2.5 pb-0.5 text-[11px] font-medium leading-5 text-[#9B9A97]">
                  {group.title}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((reference) => {
                    const optionIndex = options.findIndex(
                      (option) => getScopeKey(option) === getScopeKey(reference)
                    )
                    const active = activeIndex === optionIndex
                    const parentPath = getReferenceParentDisplayPath(reference)
                    return (
                      <button
                        key={getScopeKey(reference)}
                        type="button"
                        className={`flex h-7 w-full items-center gap-1.5 rounded-[8px] px-2.5 text-left transition-colors ${
                          active ? 'bg-[#F1F1F0]' : 'hover:bg-[#F7F7F5]'
                        }`}
                        data-reference-kind={reference.kind}
                        data-mention-active={active ? 'true' : undefined}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          onSelect(reference)
                        }}
                      >
                        <ReferenceIcon reference={reference} size="sm" />
                        <span className="min-w-0 flex flex-1 items-center gap-2">
                          <span className="truncate text-[13px] font-normal leading-5 text-[#2F3437]">
                            {reference.name}
                          </span>
                          {parentPath ? (
                            <span className="truncate text-[11px] font-normal leading-4 text-[#B1B0AD]">
                              {parentPath}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-[11px] font-medium leading-4 text-[#9B9A97]">
                          {getKbAvailabilityLabel(reference.kbAvailability)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ReferenceMentionPanel
