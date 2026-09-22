import React, { useMemo, useRef, useState } from 'react'
import { HiCheck } from 'react-icons/hi2'
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

const HumanInteractionCard: React.FC<Props> = ({
  interaction,
  partnerName,
  cancelling,
  onSubmit,
  onCancel
}) => {
  const [index, setIndex] = useState(0)
  const [selectedOptionIds, setSelectedOptionIds] = useState<Record<string, string[]>>({})
  const [otherSelected, setOtherSelected] = useState<Record<string, boolean>>({})
  const [userText, setUserText] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const userTextInputRef = useRef<HTMLInputElement>(null)
  const questions = useMemo(
    () => (Array.isArray(interaction.questions) ? interaction.questions : []),
    [interaction.questions]
  )
  const question = questions[index] || { id: '', question: '', options: [], multiSelect: false }
  const currentSelectedOptionIds = selectedOptionIds[question.id] || []
  const isOtherSelected = otherSelected[question.id] === true
  const canSubmit = useMemo(
    () =>
      questions.every((item) => {
        const hasSelectedOption = (selectedOptionIds[item.id] || []).length > 0
        const hasOtherAnswer = otherSelected[item.id] === true
        return (
          (hasSelectedOption || hasOtherAnswer) &&
          (!hasOtherAnswer || Boolean(userText[item.id]?.trim()))
        )
      }),
    [otherSelected, questions, selectedOptionIds, userText]
  )
  const toggleOption = (optionId: string): void => {
    setSelectedOptionIds((previous) => {
      const values = previous[question.id] || []
      if (!question.multiSelect) {
        return { ...previous, [question.id]: [optionId] }
      }
      return {
        ...previous,
        [question.id]: values.includes(optionId)
          ? values.filter((value) => value !== optionId)
          : [...values, optionId]
      }
    })
    if (!question.multiSelect) {
      setOtherSelected((previous) => ({ ...previous, [question.id]: false }))
      if (index < questions.length - 1) setIndex(index + 1)
    }
  }
  const toggleOther = (): void => {
    const nextSelected = !isOtherSelected
    setOtherSelected((previous) => ({ ...previous, [question.id]: nextSelected }))
    if (!question.multiSelect && nextSelected) {
      setSelectedOptionIds((previous) => ({ ...previous, [question.id]: [] }))
    }
    if (!nextSelected) setUserText((previous) => ({ ...previous, [question.id]: '' }))
    if (nextSelected) window.requestAnimationFrame(() => userTextInputRef.current?.focus())
  }
  const updateUserText = (value: string): void => {
    setUserText((previous) => ({ ...previous, [question.id]: value }))
    if (!value.trim()) {
      setOtherSelected((previous) => ({ ...previous, [question.id]: false }))
      return
    }
    if (question.multiSelect || currentSelectedOptionIds.length === 0) {
      setOtherSelected((previous) => ({ ...previous, [question.id]: true }))
    }
  }
  const submit = async (): Promise<void> => {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    try {
      await onSubmit({
        answers: questions.map((item) => {
          const text = userText[item.id]?.trim()
          return {
            questionId: item.id,
            selectedOptionIds: selectedOptionIds[item.id] || [],
            userText: text || undefined
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
          inputRef={userTextInputRef}
          value={userText[question.id] || ''}
          placeholder={buildPartnerGuidePlaceholder(partnerName)}
          submitting={submitting}
          inputDisabled={cancelling}
          disabled={!canSubmit || cancelling}
          onChange={updateUserText}
          onSubmit={() => void submit()}
          inputTestId={`workbench-human-question-user-text-${question.id}`}
          submitTestId="workbench-human-question-submit"
        />
      }
    >
      <div className="flex items-start gap-2 px-5 pt-3">
        <div className="min-w-0 flex-1 text-[14px] leading-6 text-[#37352F]">
          {question.question}
        </div>
        <span className="mt-0.5 shrink-0 rounded-[4px] border border-[#E0DFDC] bg-[#F8F8F7] px-1.5 py-0.5 text-[11px] leading-4 text-[#787774]">
          {question.multiSelect ? '可多选' : '单选'}
        </span>
      </div>
      <div className="mx-2 mt-3 space-y-1">
        {question.options.map((option, optionIndex) => {
          const active = currentSelectedOptionIds.includes(option.id)
          return (
            <button
              key={option.id}
              data-testid={`workbench-human-question-option-${question.id}-${option.id}`}
              type="button"
              aria-pressed={active}
              className={`grid min-h-11 w-full grid-cols-[16px_auto_1fr] items-start gap-2 rounded-[6px] px-3 py-2 text-left text-[13px] transition-colors ${active ? 'bg-[#F4F4F2]' : 'hover:bg-[#F8F8F7]'}`}
              onClick={() => toggleOption(option.id)}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 items-center justify-center border ${question.multiSelect ? 'rounded-[4px]' : 'rounded-full'} ${active ? 'border-[#37352F] bg-[#37352F]' : 'border-[#C8C7C4] bg-white'}`}
              >
                {active ? (
                  question.multiSelect ? (
                    <HiCheck className="h-3 w-3 text-white" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  )
                ) : null}
              </span>
              <span className="font-medium">{String.fromCharCode(65 + optionIndex)}.</span>
              <span>
                <span>
                  {option.label}
                  {option.recommended ? (
                    <span className="ml-2 inline-flex rounded-[4px] border border-[#D8DDD6] bg-[#F2F5F1] px-1.5 py-px text-[11px] leading-4 text-[#52604F]">
                      推荐
                    </span>
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
          data-testid={`workbench-human-question-option-${question.id}-other`}
          aria-pressed={isOtherSelected}
          className={`grid min-h-11 w-full grid-cols-[16px_auto_1fr] items-start gap-2 rounded-[6px] px-3 py-2 text-left text-[13px] transition-colors ${isOtherSelected ? 'bg-[#F4F4F2]' : 'hover:bg-[#F8F8F7]'}`}
          onClick={toggleOther}
        >
          <span
            className={`mt-0.5 flex h-4 w-4 items-center justify-center border ${question.multiSelect ? 'rounded-[4px]' : 'rounded-full'} ${isOtherSelected ? 'border-[#37352F] bg-[#37352F]' : 'border-[#C8C7C4] bg-white'}`}
          >
            {isOtherSelected ? (
              question.multiSelect ? (
                <HiCheck className="h-3 w-3 text-white" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
              )
            ) : null}
          </span>
          <span className="font-medium">{String.fromCharCode(65 + question.options.length)}.</span>
          <span>其他，请填写</span>
        </button>
      </div>
    </WorkbenchInteractionCard>
  )
}

export default HumanInteractionCard
