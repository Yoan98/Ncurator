import React, { useEffect, useMemo, useState } from 'react'
import { HiCheck } from 'react-icons/hi2'
import type { ChatMessageLogPlanItem } from '../../../../shared/types'

type WorkbenchPlanProgressProps = {
  plan: ChatMessageLogPlanItem[]
}

const WorkbenchPlanProgress: React.FC<WorkbenchPlanProgressProps> = ({ plan }) => {
  const [pinned, setPinned] = useState(false)
  const [visiblePlan, setVisiblePlan] = useState(plan)
  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    if (plan.length > 0) {
      setVisiblePlan(plan)
      setFinishing(plan.every((item) => item.status === 'done'))
      return
    }
    if (visiblePlan.length === 0) return
    setFinishing(true)
    const timer = window.setTimeout(() => {
      setVisiblePlan([])
      setFinishing(false)
      setPinned(false)
    }, 520)
    return () => window.clearTimeout(timer)
  }, [plan, visiblePlan.length])

  const done = useMemo(
    () => visiblePlan.filter((item) => item.status === 'done').length,
    [visiblePlan]
  )
  if (visiblePlan.length === 0) return null

  const radius = 8
  const circumference = 2 * Math.PI * radius
  const progress = done / visiblePlan.length

  return (
    <div
      className="group/plan absolute left-1/2 top-0 z-30 -translate-x-1/2 -translate-y-[calc(100%+8px)]"
      onMouseLeave={() => {
        if (!pinned) setPinned(false)
      }}
    >
      <button
        type="button"
        aria-label={`计划进度 ${done}/${visiblePlan.length}`}
        aria-expanded={pinned}
        onClick={() => setPinned((value) => !value)}
        className={`flex h-7 w-7 items-center justify-center rounded-full border border-[#E5E4E0] bg-white shadow-[0_2px_8px_rgba(15,15,15,0.08)] outline-none transition duration-200 hover:border-[#D8D7D3] focus-visible:ring-2 focus-visible:ring-[#D9E2E8] ${
          finishing ? 'scale-105 border-[#AFC8B5]' : ''
        }`}
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5 -rotate-90" aria-hidden="true">
          <circle cx="10" cy="10" r={radius} fill="none" stroke="#EEEDE9" strokeWidth="2" />
          <circle
            cx="10"
            cy="10"
            r={radius}
            fill="none"
            stroke="#54745D"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            className="transition-[stroke-dashoffset] duration-300"
          />
        </svg>
      </button>

      <div
        className={`absolute bottom-[36px] left-1/2 w-[300px] -translate-x-1/2 rounded-[10px] border border-[#E5E4E0] bg-white p-2.5 shadow-[0_12px_32px_rgba(15,15,15,0.12)] transition duration-150 group-hover/plan:visible group-hover/plan:translate-y-0 group-hover/plan:opacity-100 group-focus-within/plan:visible group-focus-within/plan:translate-y-0 group-focus-within/plan:opacity-100 ${
          pinned
            ? 'visible translate-y-0 opacity-100'
            : 'invisible translate-y-1 opacity-0'
        }`}
      >
        <div className="space-y-1">
          {visiblePlan.map((item, index) => {
            const completed = item.status === 'done'
            return (
              <div
                key={`${item.title}-${index}`}
                className="flex min-w-0 items-start gap-2 rounded-[6px] px-1.5 py-1.5 text-[13px] leading-5 text-[#37352F]"
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    completed
                      ? 'border-[#54745D] bg-[#54745D] text-white'
                      : 'border-[#C9C8C3] bg-white'
                  }`}
                  aria-hidden="true"
                >
                  {completed ? <HiCheck className="h-3 w-3" /> : null}
                </span>
                <span className={completed ? 'text-[#787774]' : undefined}>{item.title}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default React.memo(WorkbenchPlanProgress)
