import React, { useState } from 'react'
import { HiCommandLine } from 'react-icons/hi2'
import type {
  AiApprovalBatchDecision,
  AiApprovalBatchItem,
  AiApprovalSource
} from '../../../../shared/types'
import { chatSelectors, workbenchSelectors } from '../../testing/selectors'
import { buildPartnerGuidePlaceholder } from './composer/constants'
import PartnerAvatar from './PartnerAvatar'
import { getSubagentAvatar } from './utils'
import {
  WorkbenchInteractionCard,
  WorkbenchInteractionChoice,
  WorkbenchInteractionFooter
} from './WorkbenchInteractionCard'
import { useInteractionSubmission } from './useInteractionSubmission'

type Props = {
  items: AiApprovalBatchItem[]
  source?: AiApprovalSource
  partnerName?: string | null
  cancelling: boolean
  onSubmit: (decisions: AiApprovalBatchDecision[]) => Promise<void>
  onCancel: () => void
}
type Draft = { action?: 'approve' | 'reject'; message: string }
const emptyDraft: Draft = { message: '' }

const ApprovalInteractionCard: React.FC<Props> = ({
  items,
  source,
  partnerName,
  cancelling,
  onSubmit,
  onCancel
}) => {
  const [index, setIndex] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const { submitting, error, submit } = useInteractionSubmission(onSubmit)
  const item = items[index]
  if (!item) return null
  const draft = drafts[item.itemId] ?? emptyDraft
  const guiding = Boolean(draft.message.trim())
  const decisions = items.flatMap((entry): AiApprovalBatchDecision[] => {
    const answer = drafts[entry.itemId]
    if (answer?.message.trim())
      return [{ itemId: entry.itemId, action: 'guide', message: answer.message.trim() }]
    return answer?.action ? [{ itemId: entry.itemId, action: answer.action }] : []
  })
  const missing = items.length - decisions.length
  const next = index < items.length - 1
  const hasGuide = decisions.some((decision) => decision.action === 'guide')
  const hasRejection = decisions.some((decision) => decision.action === 'reject')
  const blocked = submitting || cancelling
  const disabled = next ? !guiding && !draft.action : missing > 0
  const name = source?.name.trim() || partnerName?.trim() || '伙伴'
  const update = (value: Draft): void =>
    setDrafts((previous) => ({ ...previous, [item.itemId]: value }))
  const advance = (): void => {
    if (blocked || disabled) return
    if (next) {
      setIndex(index + 1)
      return
    }
    void submit(decisions)
  }
  const label = next
    ? '下一步'
    : hasGuide
      ? '发送指导'
      : hasRejection
        ? '确认拒绝'
        : items.length > 1
          ? `允许执行 ${items.length} 项`
          : '允许执行'
  const hint =
    !next && missing > 0
      ? `还有 ${missing} 项未决定`
      : guiding
        ? '发送指导后，本批操作不执行'
        : hasGuide || hasRejection
          ? '本批含拒绝或指导，不会执行'
          : items.length > 1
            ? '全部确认后才执行'
            : undefined
  return (
    <WorkbenchInteractionCard
      title={item.commandExplanation}
      itemLabel="操作确认"
      currentIndex={index}
      total={items.length}
      source={
        source && (
          <>
            <PartnerAvatar {...getSubagentAvatar(source.agentId || source.childRunId)} size={24} />
            <span className="min-w-0 break-words" data-testid={chatSelectors.approvalBatchSource}>
              {name}
            </span>
          </>
        )
      }
      busy={submitting}
      cancelling={cancelling}
      onPrevious={() => setIndex(index - 1)}
      onNext={() => setIndex(index + 1)}
      onCancel={onCancel}
      cardTestId={chatSelectors.approvalBatchCard}
      previousTestId={chatSelectors.approvalBatchPrevButton}
      nextTestId={chatSelectors.approvalBatchNextButton}
      cancelTestId={workbenchSelectors.sendButton}
      footer={
        <WorkbenchInteractionFooter
          value={draft.message}
          placeholder={buildPartnerGuidePlaceholder(name)}
          onChange={(message) =>
            update({ message, action: message.trim() ? undefined : draft.action })
          }
          submitting={submitting}
          inputDisabled={cancelling}
          disabled={disabled}
          label={label}
          next={next}
          hint={hint}
          error={error}
          onSubmit={advance}
          inputTestId={chatSelectors.approvalBatchGuideInput}
          submitTestId={chatSelectors.approvalBatchSubmitButton}
        />
      }
    >
      <div className="mx-5 mb-4 rounded-[8px] border border-[#EEEEEC] bg-[#F4F4F2] px-3 py-2.5">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-[#787774]">
          <HiCommandLine className="h-[13px] w-[13px]" />
          终端命令
        </div>
        <code className="block max-h-[min(25vh,240px)] overflow-auto font-mono text-[13px] leading-[22px] whitespace-pre-wrap [overflow-wrap:anywhere]">
          {item.command}
        </code>
      </div>
      <div className="mx-2.5 space-y-1" role="group" aria-label="选择本次操作的处理方式">
        {(['approve', 'reject'] as const).map((action, optionIndex) => (
          <WorkbenchInteractionChoice
            key={action}
            index={optionIndex}
            label={action === 'approve' ? '允许本次操作' : '拒绝本次操作'}
            selected={!guiding && draft.action === action}
            disabled={blocked || guiding}
            rejection={action === 'reject'}
            onClick={() =>
              update({ message: '', action: draft.action === action ? undefined : action })
            }
            testId={
              action === 'approve'
                ? chatSelectors.approvalBatchApproveButton
                : chatSelectors.approvalBatchDenyButton
            }
          />
        ))}
      </div>
    </WorkbenchInteractionCard>
  )
}
export default ApprovalInteractionCard
