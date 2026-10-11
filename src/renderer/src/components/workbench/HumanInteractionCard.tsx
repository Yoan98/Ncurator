import React, { useState } from 'react'
import type { PendingHumanInteraction, AskUserQuestionResult } from '../../../../shared/types'
import {
  WorkbenchInteractionCard,
  WorkbenchInteractionChoice,
  WorkbenchInteractionFooter
} from './WorkbenchInteractionCard'
import { useInteractionSubmission } from './useInteractionSubmission'

type Props = {
  interaction: Extract<PendingHumanInteraction, { kind: 'question' }>
  cancelling: boolean
  onSubmit: (answers: AskUserQuestionResult) => Promise<void>
  onCancel: () => void
}

type AnswerDraft = { selectedOptionIds: string[]; userText: string }
const emptyAnswer: AnswerDraft = { selectedOptionIds: [], userText: '' }

const HumanInteractionCard: React.FC<Props> = ({ interaction, cancelling, onSubmit, onCancel }) => {
  const [index, setIndex] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({})
  const { submitting, error, submit } = useInteractionSubmission(onSubmit)
  const questions = interaction.questions
  const question = questions[index]
  if (!question) return null
  const options = question.options ?? []
  const draft = drafts[question.id] ?? emptyAnswer
  const answered = (id: string): boolean =>
    Boolean(drafts[id]?.selectedOptionIds.length || drafts[id]?.userText.trim())
  const missing = questions.filter((item) => !answered(item.id)).length
  const next = index < questions.length - 1
  const blocked = submitting || cancelling
  const disabled = next ? !answered(question.id) : missing > 0
  const updateDraft = (answer: AnswerDraft): void =>
    setDrafts((previous) => ({ ...previous, [question.id]: answer }))
  const advance = (): void => {
    if (blocked || disabled) return
    if (next) {
      setIndex(index + 1)
      return
    }
    void submit({
      answers: questions.map((item) => ({
        questionId: item.id,
        selectedOptionIds: drafts[item.id]?.selectedOptionIds ?? [],
        userText: drafts[item.id]?.userText.trim() || undefined
      }))
    })
  }
  return (
    <WorkbenchInteractionCard
      title={question.question}
      itemLabel="问题"
      currentIndex={index}
      total={questions.length}
      busy={submitting}
      cancelling={cancelling}
      onPrevious={() => setIndex(index - 1)}
      onNext={() => setIndex(index + 1)}
      onCancel={onCancel}
      cardTestId="workbench-human-question-card"
      previousTestId="workbench-human-question-prev"
      nextTestId="workbench-human-question-next"
      cancelTestId="workbench-human-question-cancel"
      footer={
        <WorkbenchInteractionFooter
          value={draft.userText}
          onChange={(userText) => updateDraft({ ...draft, userText })}
          placeholder={
            !options.length
              ? '回复…'
              : draft.selectedOptionIds.length
                ? '补充说明（可选）…'
                : '或直接输入回复…'
          }
          expanded={!options.length}
          submitting={submitting}
          inputDisabled={cancelling}
          disabled={disabled}
          next={next}
          label={next ? '下一步' : '发送回复'}
          hint={
            !next && missing > 0
              ? `还有 ${missing} 个问题未回答`
              : options.length && question.multiSelect
                ? `可多选${draft.selectedOptionIds.length ? ` · 已选 ${draft.selectedOptionIds.length} 项` : ''}`
                : undefined
          }
          error={error}
          onSubmit={advance}
          inputTestId={`workbench-human-question-user-text-${question.id}`}
          submitTestId="workbench-human-question-submit"
        />
      }
    >
      {options.length > 0 && (
        <div
          className="mx-2.5 space-y-1"
          role="group"
          aria-label={question.multiSelect ? '可以选择多个答案' : '选择一个答案'}
        >
          {options.map((option, optionIndex) => (
            <WorkbenchInteractionChoice
              key={option.id}
              index={optionIndex}
              label={option.label}
              description={option.description}
              recommended={option.recommended}
              multiple={question.multiSelect}
              selected={draft.selectedOptionIds.includes(option.id)}
              disabled={blocked}
              testId={`workbench-human-question-option-${question.id}-${option.id}`}
              onClick={() => {
                const selected = draft.selectedOptionIds.includes(option.id)
                updateDraft({
                  ...draft,
                  selectedOptionIds: question.multiSelect
                    ? selected
                      ? draft.selectedOptionIds.filter((id) => id !== option.id)
                      : [...draft.selectedOptionIds, option.id]
                    : selected
                      ? []
                      : [option.id]
                })
              }}
            />
          ))}
        </div>
      )}
    </WorkbenchInteractionCard>
  )
}

export default HumanInteractionCard
