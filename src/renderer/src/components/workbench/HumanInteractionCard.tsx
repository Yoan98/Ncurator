import React, { useMemo, useState } from 'react'
import { Button, Input } from 'antd'
import { HiArrowUp, HiChevronLeft, HiChevronRight } from 'react-icons/hi2'
import type { PendingHumanInteraction, AskUserQuestionAnswer } from '../../../../shared/types'

type Props = {
  interaction: Extract<PendingHumanInteraction, { kind: 'question' }>
  onSubmit: (answers: { answers: AskUserQuestionAnswer[] }) => Promise<void>
  onCancel: () => void
}

const OTHER_ID = '__custom__'

const HumanInteractionCard: React.FC<Props> = ({ interaction, onSubmit, onCancel }) => {
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const question = interaction.questions[index]
  const currentSelected = selected[question.id] || []
  const isCustom = currentSelected.includes(OTHER_ID)
  const canSubmit = useMemo(
    () => interaction.questions.every((item) => {
      const values = selected[item.id] || []
      return values.length > 0 && (!values.includes(OTHER_ID) || Boolean(custom[item.id]?.trim()))
    }),
    [custom, interaction.questions, selected]
  )
  const toggle = (id: string): void => {
    setSelected((previous) => {
      const values = previous[question.id] || []
      if (id === OTHER_ID) return { ...previous, [question.id]: values.includes(id) ? values.filter((value) => value !== id) : question.multiSelect ? [...values, id] : [id] }
      if (!question.multiSelect) return { ...previous, [question.id]: [id] }
      return { ...previous, [question.id]: values.includes(id) ? values.filter((value) => value !== id) : [...values.filter((value) => value !== OTHER_ID), id] }
    })
  }
  const submit = async (): Promise<void> => {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    try {
      await onSubmit({
        answers: interaction.questions.map((item) => {
          const values = selected[item.id] || []
          return { id: item.id, selected: values.filter((value) => value !== OTHER_ID), custom: custom[item.id]?.trim() || undefined }
        })
      })
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <div className="nc-timeline-layout-anchor min-w-0 overflow-hidden rounded-[12px] border border-[#E0DFDC] bg-white shadow-[0_8px_24px_rgba(15,15,15,0.08)]" data-testid="workbench-human-question-card">
      <div className="flex items-center justify-between px-5 pt-4">
        <div className="text-[15px] font-semibold text-[#37352F]">需要补充一点信息</div>
        <div className="flex items-center gap-1 text-xs text-[#9B9A97]">
          <button type="button" aria-label="上一个问题" disabled={index === 0 || submitting} onClick={() => setIndex((value) => Math.max(0, value - 1))}><HiChevronLeft /></button>
          <span>{index + 1} / {interaction.questions.length}</span>
          <button type="button" aria-label="下一个问题" disabled={index === interaction.questions.length - 1 || submitting} onClick={() => setIndex((value) => Math.min(interaction.questions.length - 1, value + 1))}><HiChevronRight /></button>
        </div>
      </div>
      <div className="px-5 pt-3 text-[14px] leading-6 text-[#37352F]">{question.question}</div>
      <div className="mx-2 mt-3 space-y-1">
        {question.options.map((option, optionIndex) => {
          const active = currentSelected.includes(option.id)
          return <button key={option.id} type="button" className={`grid min-h-11 w-full grid-cols-[auto_1fr] gap-2 rounded-[6px] px-3 text-left text-[13px] ${active ? 'bg-[#F4F4F2] shadow-[inset_3px_0_0_#37352F]' : 'hover:bg-[#F8F8F7]'}`} onClick={() => toggle(option.id)}><span className="font-medium">{String.fromCharCode(65 + optionIndex)}.</span><span><span>{option.label}{option.recommended ? <span className="ml-2 text-xs text-[#9B9A97]">推荐</span> : null}</span>{option.description ? <span className="block text-xs text-[#9B9A97]">{option.description}</span> : null}</span></button>
        })}
        <button type="button" className={`grid min-h-11 w-full grid-cols-[auto_1fr] gap-2 rounded-[6px] px-3 text-left text-[13px] ${isCustom ? 'bg-[#F4F4F2] shadow-[inset_3px_0_0_#37352F]' : 'hover:bg-[#F8F8F7]'}`} onClick={() => toggle(OTHER_ID)}><span className="font-medium">{String.fromCharCode(65 + question.options.length)}.</span><span>其他，请填写</span></button>
      </div>
      {isCustom ? <div className="px-4 pt-3"><Input value={custom[question.id] || ''} onChange={(event) => setCustom((previous) => ({ ...previous, [question.id]: event.target.value }))} placeholder="请填写你的要求" /></div> : null}
      <div className="flex justify-end gap-2 border-t border-[#EEEEEC] px-4 py-4"><Button type="text" onClick={onCancel}>停止</Button><Button type="primary" icon={<HiArrowUp />} loading={submitting} disabled={!canSubmit} onClick={() => void submit()}>提交</Button></div>
    </div>
  )
}

export default HumanInteractionCard
