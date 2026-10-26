import { t } from '../../i18n'
import React, { useEffect, useMemo, useState } from 'react'
import { HiCheck } from 'react-icons/hi2'
import { AiOutlineLoading3Quarters } from 'react-icons/ai'
import type { ChatMessageLogPlanItem } from '../../../../shared/types'

type WorkbenchPlanProgressProps = {
  plan: ChatMessageLogPlanItem[]
  running: boolean
}

const WorkbenchPlanProgress: React.FC<WorkbenchPlanProgressProps> = ({ plan, running }) => {
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
    <div className="group/plan absolute left-1/2 top-0 z-30 -translate-x-1/2 -translate-y-[calc(100%+8px)]">
      <div
        aria-label={t(($) => $.workbench.planProgress, {
          value1: done,
          value2: visiblePlan.length
        })}
        className={`flex h-7 w-7 items-center justify-center rounded-full border border-[#E5E4E0] bg-white shadow-[0_2px_8px_rgba(15,15,15,0.08)] transition duration-200 group-hover/plan:border-[#D8D7D3] ${
          finishing ? 'scale-105 border-[#D8D7D3]' : ''
        }`}
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5 -rotate-90" aria-hidden="true">
          <circle cx="10" cy="10" r={radius} fill="none" stroke="#EEEDE9" strokeWidth="2" />
          <circle
            cx="10"
            cy="10"
            r={radius}
            fill="none"
            stroke="#787774"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            className="transition-[stroke-dashoffset] duration-300"
          />
        </svg>
      </div>

      <div className="invisible absolute bottom-[36px] left-1/2 w-[300px] -translate-x-1/2 translate-y-1 rounded-[10px] border border-[#E5E4E0] bg-white p-2.5 opacity-0 shadow-[0_12px_32px_rgba(15,15,15,0.12)] transition duration-150 group-hover/plan:visible group-hover/plan:translate-y-0 group-hover/plan:opacity-100">
        <div className="space-y-1">
          {visiblePlan.map((item, index) => {
            const completed = item.status === 'done'
            const doing = item.status === 'doing'
            return (
              <div
                key={`${item.title}-${index}`}
                className="flex min-w-0 items-start gap-2 rounded-[6px] px-1.5 py-1.5 text-[13px] leading-5 text-[#37352F]"
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                    completed
                      ? 'border border-[#37352F] bg-[#37352F] text-white'
                      : doing
                        ? 'text-[#37352F]'
                        : 'border border-[#C9C8C3] bg-white'
                  }`}
                  aria-hidden="true"
                >
                  {completed ? (
                    <HiCheck className="h-3 w-3" />
                  ) : doing ? (
                    <AiOutlineLoading3Quarters
                      className="h-4 w-4 animate-spin motion-reduce:animate-none"
                      style={{ animationPlayState: running ? 'running' : 'paused' }}
                    />
                  ) : null}
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
