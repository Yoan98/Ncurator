import React from 'react'
import { Card } from 'antd'
import { workbenchSelectors } from '../../testing/selectors'
import type { WorkbenchTimelineItem } from '../../types/workbench'

type WorkbenchTimelineProps = {
  items: WorkbenchTimelineItem[]
  selectedId: string | null
  mode: 'ai' | 'search'
  onSelect: (timelineId: string) => void
}

const WorkbenchTimeline: React.FC<WorkbenchTimelineProps> = ({
  items,
  selectedId,
  mode,
  onSelect
}) => {
  return (
    <Card
      className="rounded-xl border border-[#E5E5E4] bg-white shadow-sm"
      styles={{ body: { padding: 0 } }}
    >
      <div className="border-b border-[#E5E5E4] px-4 py-3">
        <div className="text-sm font-medium text-[#1F1F1F]">时间线</div>
        <div className="mt-1 text-xs text-[#999999]">
          {items.length > 0 ? `共 ${items.length} 个步骤` : mode === 'search' ? '等待本地搜索' : '等待 AI 运行'}
        </div>
      </div>
      <div className="max-h-[260px] overflow-auto p-3" data-testid={workbenchSelectors.timeline}>
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#E5E5E4] bg-[#F8F8F7] px-4 py-6 text-center text-sm text-[#999999]">
            暂无步骤
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const active = item.id === selectedId
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-pressed={active}
                  data-testid={`${workbenchSelectors.timelineItemPrefix}-${item.id}`}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition-all duration-200 ${
                    active
                      ? 'border-[#D97757] bg-[#FBF5F2] shadow-sm'
                      : 'border-[#E5E5E4] bg-white hover:-translate-y-0.5 hover:border-[#D4D4D3]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 text-sm font-medium text-[#1F1F1F]">{item.title}</div>
                    <span className="rounded-full bg-[#F5F5F4] px-2 py-1 text-[11px] text-[#666666]">
                      {item.badge || item.kind}
                    </span>
                  </div>
                  <div className="mt-2 text-xs leading-relaxed text-[#666666] line-clamp-2">
                    {item.description}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}

export default WorkbenchTimeline
