import React, { useMemo } from 'react'
import { Button, Card, Progress } from 'antd'
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  LoadingOutlined
} from '@ant-design/icons'
import type { AiPlanTask, AiRunEvent } from '../../../../shared/types'

type HumanStepEvent = Extract<AiRunEvent, { type: 'human_step' }>
type TaskDeliveryEvent = Extract<AiRunEvent, { type: 'task_delivery_ready' }>
type BlockedEvent = Extract<
  AiRunEvent,
  { type: 'approval_required' | 'workspace_required' | 'runtime_issue' }
>
type AnswerCompletedEvent = Extract<AiRunEvent, { type: 'answer_completed' }>

type AssistantRunCardProps = {
  runId: string | null
  plan: AiPlanTask[]
  events: AiRunEvent[]
  answerPreview?: string
  onOpenReview?: (reviewId: string) => void
}

const getRunState = (events: AiRunEvent[]): {
  label: string
  tone: string
  icon: React.ReactNode
} => {
  const latestEvent = [...events].reverse().find((event) => !event.internal)
  if (!latestEvent) {
    return {
      label: '准备中',
      tone: 'bg-[#F8F8F7] text-[#666666]',
      icon: <ClockCircleOutlined />
    }
  }
  if (latestEvent.type === 'run_failed') {
    return {
      label: '执行失败',
      tone: 'bg-[#FFF1F0] text-[#C2413B]',
      icon: <ExclamationCircleOutlined />
    }
  }
  if (latestEvent.type === 'run_cancelled') {
    return {
      label: '已取消',
      tone: 'bg-[#F5F5F4] text-[#666666]',
      icon: <ClockCircleOutlined />
    }
  }
  if (events.some((event) => event.type === 'draft_review_ready' && !event.internal)) {
    return {
      label: '待审阅',
      tone: 'bg-[#FBF5F2] text-[#D97757]',
      icon: <FileTextOutlined />
    }
  }
  if (events.some((event) => event.type === 'answer_completed' && !event.internal)) {
    return {
      label: '已完成',
      tone: 'bg-[#F3FAF0] text-[#4F7A46]',
      icon: <CheckCircleOutlined />
    }
  }
  return {
    label: '执行中',
    tone: 'bg-[#FBF5F2] text-[#D97757]',
    icon: <LoadingOutlined />
  }
}

const getBlockedCopy = (event: BlockedEvent | null): string | null => {
  if (!event) return null
  if (event.type === 'approval_required') return `${event.reason}。命令：${event.command}`
  if (event.type === 'workspace_required') return event.reason
  return event.message
}

const getAnswerPreview = (
  answerPreview: string | undefined,
  answerEvent: AnswerCompletedEvent | null
): string | null => {
  const content = (answerPreview || answerEvent?.text || '').trim()
  if (!content) return null
  return content.length > 220 ? `${content.slice(0, 220)}...` : content
}

const AssistantRunCard: React.FC<AssistantRunCardProps> = ({
  runId,
  plan,
  events,
  answerPreview,
  onOpenReview
}) => {
  const visibleEvents = useMemo(() => events.filter((event) => !event.internal), [events])
  const recentHumanSteps = visibleEvents.filter((event) => event.type === 'human_step').slice(-5) as HumanStepEvent[]
  const blockedEvent =
    [...visibleEvents].reverse().find(
      (event) =>
        event.type === 'approval_required' ||
        event.type === 'workspace_required' ||
        event.type === 'runtime_issue'
    ) || null
  const reviewReadyEvent =
    [...visibleEvents].reverse().find((event) => event.type === 'draft_review_ready') || null
  const answerEvent =
    [...visibleEvents].reverse().find((event) => event.type === 'answer_completed') || null
  const latestDelivery =
    [...visibleEvents].reverse().find((event) => event.type === 'task_delivery_ready') || null
  const currentTask = plan.find((item) => item.status === 'running') || null
  const completedCount = plan.filter((item) => item.status === 'completed').length
  const progressPercent = plan.length > 0 ? Math.round((completedCount / plan.length) * 100) : 0
  const runState = getRunState(visibleEvents)
  const blockedCopy = getBlockedCopy(blockedEvent as BlockedEvent | null)
  const answerSummary = getAnswerPreview(answerPreview, answerEvent as AnswerCompletedEvent | null)
  const deliveryStageLabel =
    latestDelivery && latestDelivery.type === 'task_delivery_ready'
      ? latestDelivery.taskId === 'synthesis-human'
        ? '当前阶段：最终汇总交付'
        : latestDelivery.taskId === 'direct-human'
          ? '当前阶段：Direct Human 最终交付'
          : `最近交付：${latestDelivery.taskId}`
      : null

  if (!runId && plan.length === 0 && visibleEvents.length === 0) return null

  return (
    <div className="px-6 pt-4">
      <Card className="rounded-2xl border border-[#E5E5E4] bg-white shadow-sm">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[#1F1F1F]">Assistant Run</div>
              <div className="mt-1 text-xs text-[#666666]">
                {currentTask
                  ? `当前阶段：${currentTask.title}`
                  : deliveryStageLabel || '按统一工作台流程执行与回放'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${runState.tone}`}
              >
                {runState.icon}
                <span>{runState.label}</span>
              </span>
              <span className="rounded-full bg-[#F5F5F4] px-3 py-1 text-xs text-[#666666]">
                {runId ? runId.slice(0, 8) : 'pending'}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-[#E5E5E4] bg-[#F8F8F7] p-4">
            <div className="flex items-center justify-between gap-3 text-xs text-[#666666]">
              <span>{plan.length > 0 ? '执行计划' : '轻量计划'}</span>
              <span>{plan.length > 0 ? `${completedCount}/${plan.length} 已完成` : '单步处理或等待计划返回'}</span>
            </div>
            <div className="mt-3">
              <Progress
                percent={plan.length > 0 ? progressPercent : visibleEvents.length > 0 ? 100 : 0}
                showInfo={false}
                size="small"
                strokeColor="#D97757"
                trailColor="#E5E5E4"
              />
            </div>
            {plan.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {plan.map((item) => (
                  <span
                    key={item.id}
                    className={`rounded-full px-3 py-1 text-xs ${
                      item.status === 'completed'
                        ? 'bg-[#F3FAF0] text-[#4F7A46]'
                        : item.status === 'running'
                          ? 'bg-[#FBF5F2] text-[#D97757]'
                          : item.status === 'blocked'
                            ? 'bg-[#FFF1F0] text-[#C2413B]'
                            : 'bg-white text-[#666666]'
                    }`}
                  >
                    {item.title}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-xs text-[#666666]">
                这次运行没有展开多步计划，系统会直接返回结果并保留关键执行节点。
              </div>
            )}
          </div>

          {recentHumanSteps.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">
                执行叙事
              </div>
              {recentHumanSteps.map((step) => (
                <div
                  key={`${step.taskId}-${step.stepIndex}`}
                  className="rounded-2xl border border-[#E5E5E4] bg-white px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-[#1F1F1F]">
                      Step {step.stepIndex} · {step.toolName || step.summary}
                    </div>
                    <span className="rounded-full bg-[#F5F5F4] px-2 py-1 text-[11px] text-[#666666]">
                      {step.resultStatus || 'running'}
                    </span>
                  </div>
                  <div className="mt-2 text-sm leading-relaxed text-[#666666]">{step.publicNarrative}</div>
                </div>
              ))}
            </div>
          ) : null}

          {blockedCopy ? (
            <div className="rounded-2xl border border-[#FDECC8] bg-[#FFF9ED] px-4 py-3 text-sm text-[#8A6510]">
              {blockedCopy}
            </div>
          ) : null}

          {reviewReadyEvent ? (
            <div className="rounded-2xl border border-[#F4E5DF] bg-[#FBF5F2] px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[#1F1F1F]">草稿审阅已准备完成</div>
                  <div className="mt-1 text-xs text-[#666666]">
                    {reviewReadyEvent.review.documentCount} 个文档，{reviewReadyEvent.review.changeCount} 处修改等待统一确认。
                  </div>
                </div>
                {onOpenReview ? (
                  <Button
                    size="large"
                    type="primary"
                    onClick={() => onOpenReview(reviewReadyEvent.review.reviewId)}
                  >
                    打开审阅中心
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {answerSummary ? (
            <div className="rounded-2xl border border-[#E5E5E4] bg-[#F8F8F7] px-4 py-4">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">
                最终回答摘要
              </div>
              <div className="mt-2 text-sm leading-relaxed text-[#1F1F1F]">{answerSummary}</div>
            </div>
          ) : null}

          {latestDelivery && latestDelivery.type === 'task_delivery_ready' && !answerSummary ? (
            <div className="rounded-2xl border border-[#E5E5E4] bg-[#F8F8F7] px-4 py-4">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">
                最近任务交付
              </div>
              <div className="mt-2 text-sm leading-relaxed text-[#1F1F1F]">
                {(latestDelivery as TaskDeliveryEvent).summary}
              </div>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  )
}

export default AssistantRunCard
