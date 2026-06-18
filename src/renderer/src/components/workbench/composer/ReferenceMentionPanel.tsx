import React from 'react'
import { Empty, Spin } from 'antd'
import type { SelectedReference } from '../../../../../shared/types'
import { workbenchSelectors } from '../../../testing/selectors'
import { getKbAvailabilityLabel, getReferenceDisplayPath } from '../../../utils/reference'
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
      className="absolute inset-x-0 bottom-full mb-3 overflow-hidden rounded-[18px] border border-[#E5E4E0] bg-white px-2 py-3 shadow-[0_18px_48px_rgba(15,15,15,0.11)]"
      data-testid={workbenchSelectors.mentionPanel}
    >
      <div className="max-h-[360px] overflow-y-auto pr-1">
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
          <div className="space-y-3">
            {visibleGroups.map((group) => (
              <div key={group.title}>
                <div className="px-3 pb-1 text-[13px] font-medium leading-6 text-[#9B9A97]">
                  {group.title}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((reference) => {
                    const optionIndex = options.findIndex(
                      (option) => getScopeKey(option) === getScopeKey(reference)
                    )
                    const active = activeIndex === optionIndex
                    return (
                      <button
                        key={getScopeKey(reference)}
                        type="button"
                        className={`flex h-9 w-full items-center gap-3 rounded-[10px] px-3 text-left transition-colors ${
                          active ? 'bg-[#F1F1F0]' : 'hover:bg-[#F7F7F5]'
                        }`}
                        data-reference-kind={reference.kind}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          onSelect(reference)
                        }}
                      >
                        <ReferenceIcon reference={reference} size="sm" />
                        <span className="min-w-0 flex flex-1 items-center gap-2">
                          <span className="truncate text-[15px] font-normal leading-6 text-[#2F3437]">
                            {reference.name}
                          </span>
                          <span className="truncate text-[13px] font-normal leading-5 text-[#B1B0AD]">
                            {getReferenceDisplayPath(reference)}
                          </span>
                        </span>
                        <span className="shrink-0 text-[12px] font-medium leading-5 text-[#9B9A97]">
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
