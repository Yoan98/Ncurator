import React, { useMemo, useRef, useState } from 'react'
import type { PendingHumanInteraction, AskUserQuestionAnswer } from '../../../../shared/types'
import { buildPartnerGuidePlaceholder } from './composer/constants'
import { WorkbenchInteractionCard, WorkbenchInteractionFooter } from './WorkbenchInteractionCard'

type Props = {
  interaction: Extract<PendingHumanInteraction, { kind: 'question' }>
  partnerName?: string | null
  cancelling: boolean
  onSubmit: (answers: { answers: AskUserQuestionAnswer[] }) => Promise<void>
  onCancel: () => void
}

const OTHER_ID = '__custom__'

const HumanInteractionCard: React.FC<Props> = ({
  interaction,
  partnerName,
  cancelling,
  onSubmit,
  onCancel
}) => {
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const customInputRef = useRef<HTMLInputElement>(null)
  const questions = useMemo(
    () => (Array.isArray(interaction.questions) ? interaction.questions : []),
    [interaction.questions]
  )
  const question = questions[index] || { id: '', question: '', options: [], multiSelect: false }
  const currentSelected = selected[question.id] || []
  const isCustom = currentSelected.includes(OTHER_ID)
  const canSubmit = useMemo(
    () =>
      questions.every((item) => {
        const values = selected[item.id] || []
        return values.length > 0 && (!values.includes(OTHER_ID) || Boolean(custom[item.id]?.trim()))
      }),
    [custom, questions, selected]
  )
  const toggle = (id: string): void => {
    const deselectingCustom = id === OTHER_ID && currentSelected.includes(OTHER_ID)
    if (deselectingCustom) {
      setCustom((current) => ({ ...current, [question.id]: '' }))
    }
    setSelected((previous) => {
      const values = previous[question.id] || []
      if (id === OTHER_ID)
        return {
          ...previous,
          [question.id]: values.includes(id)
            ? values.filter((value) => value !== id)
            : question.multiSelect
              ? [...values, id]
              : [id]
        }
      if (!question.multiSelect) {
        setCustom((current) => ({ ...current, [question.id]: '' }))
        return { ...previous, [question.id]: [id] }
      }
      return {
        ...previous,
        [question.id]: values.includes(id)
          ? values.filter((value) => value !== id)
          : [...values, id]
      }
    })
    if (id === OTHER_ID && !deselectingCustom) {
      window.requestAnimationFrame(() => customInputRef.current?.focus())
    }
  }
  const updateCustom = (value: string): void => {
    setCustom((previous) => ({ ...previous, [question.id]: value }))
    if (!value.trim()) return
    setSelected((previous) => {
      const values = previous[question.id] || []
      if (values.includes(OTHER_ID)) return previous
      return {
        ...previous,
        [question.id]: question.multiSelect ? [...values, OTHER_ID] : [OTHER_ID]
      }
    })
  }
  const submit = async (): Promise<void> => {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    try {
      await onSubmit({
        answers: questions.map((item) => {
          const values = selected[item.id] || []
          return {
            id: item.id,
            selected: values.filter((value) => value !== OTHER_ID),
            custom: values.includes(OTHER_ID) ? custom[item.id]?.trim() || undefined : undefined
          }
        })
      })
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <WorkbenchInteractionCard
      title="需要补充一点信息"
      itemLabel="问题"
      currentIndex={index}
      total={questions.length}
      busy={submitting}
      cancelling={cancelling}
      onPrevious={() => setIndex((value) => Math.max(0, value - 1))}
      onNext={() => setIndex((value) => Math.min(questions.length - 1, value + 1))}
      onCancel={onCancel}
      cardTestId="workbench-human-question-card"
      previousTestId="workbench-human-question-prev"
      nextTestId="workbench-human-question-next"
      cancelTestId="workbench-human-question-cancel"
      footer={
        <WorkbenchInteractionFooter
          inputRef={customInputRef}
          value={custom[question.id] || ''}
          placeholder={buildPartnerGuidePlaceholder(partnerName)}
          submitting={submitting}
          inputDisabled={cancelling}
          disabled={!canSubmit || cancelling}
          onChange={updateCustom}
          onSubmit={() => void submit()}
          inputTestId={`workbench-human-question-custom-input-${question.id}`}
          submitTestId="workbench-human-question-submit"
        />
      }
    >
      <div className="px-5 pt-3 text-[14px] leading-6 text-[#37352F]">{question.question}</div>
      <div className="mx-2 mt-3 space-y-1">
        {question.options.map((option, optionIndex) => {
          const active = currentSelected.includes(option.id)
          return (
            <button
              key={option.id}
              data-testid={`workbench-human-question-option-${question.id}-${option.id}`}
              type="button"
              className={`grid min-h-11 w-full grid-cols-[auto_1fr] gap-2 rounded-[6px] px-3 text-left text-[13px] ${active ? 'bg-[#F4F4F2] shadow-[inset_3px_0_0_#37352F]' : 'hover:bg-[#F8F8F7]'}`}
              onClick={() => toggle(option.id)}
            >
              <span className="font-medium">{String.fromCharCode(65 + optionIndex)}.</span>
              <span>
                <span>
                  {option.label}
                  {option.recommended ? (
                    <span className="ml-2 text-xs text-[#9B9A97]">推荐</span>
                  ) : null}
                </span>
                {option.description ? (
                  <span className="block text-xs text-[#9B9A97]">{option.description}</span>
                ) : null}
              </span>
            </button>
          )
        })}
        <button
          type="button"
          data-testid={`workbench-human-question-option-${question.id}-custom`}
          className={`grid min-h-11 w-full grid-cols-[auto_1fr] gap-2 rounded-[6px] px-3 text-left text-[13px] ${isCustom ? 'bg-[#F4F4F2] shadow-[inset_3px_0_0_#37352F]' : 'hover:bg-[#F8F8F7]'}`}
          onClick={() => toggle(OTHER_ID)}
        >
          <span className="font-medium">{String.fromCharCode(65 + question.options.length)}.</span>
          <span>其他，请填写</span>
        </button>
      </div>
    </WorkbenchInteractionCard>
  )
}

export default HumanInteractionCard
