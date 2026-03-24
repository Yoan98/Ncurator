import React, { useEffect, useMemo, useState } from 'react'
import { Button, Spin } from 'antd'
import {
  CheckOutlined,
  CloseOutlined,
  FileSyncOutlined,
  FolderOpenOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import type {
  DraftChangeResolution,
  DraftReviewDetail,
  ValidateDraftCommitResponse
} from '../../../../shared/types'
import EmbeddedFileViewer from '../fileRenders/EmbeddedFileViewer'
import { getDraftDiffRenderer } from '../draft-review/renderers'
import { REVIEW_STATUS_META } from './constants'
import { formatLocatorSummary } from './utils'
import type { AssistantTurnViewModel, WorkbenchFileRef } from './types'
import { workbenchSelectors } from '../../testing/selectors'

type ReviewTab = 'diff' | 'preview' | 'source'

type WorkbenchReviewPanelProps = {
  review: DraftReviewDetail | null
  loading: boolean
  validation: ValidateDraftCommitResponse | null
  validating: boolean
  busyChangeIds: string[]
  bulkApplying: boolean
  committing: boolean
  turn?: AssistantTurnViewModel
  onSetDecision: (changeId: string, decision: DraftChangeResolution) => void
  onSetAllPending: (decision: DraftChangeResolution) => void
  onRefreshValidation: () => void
  onCommit: () => void
  onOpenFile: (file: WorkbenchFileRef) => void
  onOpenPath: (filePath: string) => Promise<void>
  onRevealPath: (filePath: string) => Promise<void>
}

const WorkbenchReviewPanel: React.FC<WorkbenchReviewPanelProps> = ({
  review,
  loading,
  validation,
  validating,
  busyChangeIds,
  bulkApplying,
  committing,
  turn,
  onSetDecision,
  onSetAllPending,
  onRefreshValidation,
  onCommit,
  onOpenFile,
  onOpenPath,
  onRevealPath
}) => {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ReviewTab>('diff')

  useEffect(() => {
    if (!review) {
      setSelectedDocumentId(null)
      setSelectedChangeId(null)
      return
    }
    const nextDocumentId =
      review.documents.find((item) => item.id === selectedDocumentId)?.id ||
      review.documents[0]?.id ||
      null
    setSelectedDocumentId(nextDocumentId)
  }, [review, selectedDocumentId])

  const selectedDocument = review?.documents.find((item) => item.id === selectedDocumentId) || null

  const documentChanges = useMemo(() => {
    if (!review || !selectedDocumentId) return []
    return review.changes
      .filter((item) => item.document_id === selectedDocumentId)
      .sort((left, right) => left.order_index - right.order_index)
  }, [review, selectedDocumentId])

  useEffect(() => {
    const nextChangeId =
      documentChanges.find((item) => item.id === selectedChangeId)?.id ||
      documentChanges[0]?.id ||
      null
    setSelectedChangeId(nextChangeId)
  }, [documentChanges, selectedChangeId])

  const selectedChange = documentChanges.find((item) => item.id === selectedChangeId) || null
  const selectedIndex = documentChanges.findIndex((item) => item.id === selectedChangeId)
  const previousChange = selectedIndex > 0 ? documentChanges[selectedIndex - 1] : null
  const nextChange = selectedIndex >= 0 ? documentChanges[selectedIndex + 1] || null : null
  const latestCommitJob =
    review?.commit_jobs
      .slice()
      .sort((left, right) => left.started_at - right.started_at)
      .at(-1) || null
  const commitDisabled =
    !review ||
    committing ||
    validating ||
    !validation?.ready ||
    review.review.status === 'committed' ||
    review.review.status === 'committing'

  const reviewStatusMeta = review ? REVIEW_STATUS_META[review.review.status] : null
  const rendererRegistration = selectedDocument
    ? getDraftDiffRenderer(selectedDocument.format)
    : null
  const RendererComponent = rendererRegistration?.component

  const renderBody = (): React.ReactNode => {
    if (!review || !selectedDocument) {
      return (
        <div className="flex h-full items-center justify-center rounded-[18px] border border-dashed border-[#E5E5E4] bg-[#FAFAF9] text-sm text-[#999999]">
          当前没有可审阅的文档。
        </div>
      )
    }

    if (activeTab === 'preview') {
      const previewPath =
        selectedChange?.preview_artifact_path || selectedDocument.preview_artifact_path
      return (
        <div className="h-full">
          <EmbeddedFileViewer
            filePath={previewPath || selectedDocument.source_path}
            fileName={
              previewPath ? `${selectedDocument.source_name}（预览）` : selectedDocument.source_name
            }
            emptyText="当前文档还没有可用预览。"
          />
        </div>
      )
    }

    if (activeTab === 'source') {
      return (
        <div className="space-y-4 overflow-auto pr-1">
          <section className="rounded-[18px] border border-[#E5E5E4] bg-[#FCFBF8] px-4 py-4">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">
              来源说明
            </div>
            <div className="mt-3 text-sm leading-relaxed text-[#666666]">
              当前修改只在草稿层生效。点击底部确认提交前，真实文件不会被改动。
            </div>
          </section>

          <section className="rounded-[18px] border border-[#E5E5E4] bg-[#FCFBF8] px-4 py-4">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">
              目标文件
            </div>
            <button
              type="button"
              onClick={() =>
                onOpenFile({
                  path: selectedDocument.source_path,
                  fileName: selectedDocument.source_name,
                  origin: 'edited_draft',
                  reviewId: review.review.id,
                  draftDocumentId: selectedDocument.id,
                  format: selectedDocument.format
                })
              }
              className="mt-3 rounded-xl border border-[#E5E5E4] bg-white px-3 py-3 text-left text-sm text-[#1F1F1F] transition-all duration-200 hover:border-[#D97757]"
            >
              <div>{selectedDocument.source_name}</div>
              <div className="mt-1 text-xs break-all text-[#666666]">
                {selectedDocument.source_path}
              </div>
            </button>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="small"
                icon={<FolderOpenOutlined />}
                onClick={() => void onRevealPath(selectedDocument.source_path)}
              >
                定位
              </Button>
              <Button size="small" onClick={() => void onOpenPath(selectedDocument.source_path)}>
                打开
              </Button>
            </div>
          </section>

          {turn?.steps.length ? (
            <section className="rounded-[18px] border border-[#E5E5E4] bg-[#FCFBF8] px-4 py-4">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">
                相关步骤
              </div>
              <div className="mt-3 space-y-2">
                {turn.steps.map((step) => (
                  <div
                    key={step.id}
                    className="rounded-xl border border-[#E5E5E4] bg-white px-3 py-3"
                  >
                    <div className="text-[13px] font-medium text-[#1F1F1F]">{step.summary}</div>
                    <div className="mt-1 text-xs text-[#666666]">{step.tool}</div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {turn?.readFiles.length ? (
            <section className="rounded-[18px] border border-[#E5E5E4] bg-[#FCFBF8] px-4 py-4">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">
                读取的文件
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {turn.readFiles.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => onOpenFile(file)}
                    className="rounded-full border border-[#E5E5E4] bg-white px-3 py-1.5 text-xs text-[#666666] transition-all duration-200 hover:border-[#D97757] hover:text-[#D97757]"
                  >
                    {file.fileName}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )
    }

    if (!RendererComponent) {
      return (
        <div className="rounded-[18px] border border-dashed border-[#E5E5E4] bg-[#FAFAF9] px-4 py-8 text-sm text-[#999999]">
          当前格式暂未提供细化差异渲染器。
        </div>
      )
    }

    return (
      <div className="space-y-4 overflow-auto pr-1">
        <div className="rounded-[18px] border border-[#E5E5E4] bg-[#FCFBF8] px-4 py-4">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">
            影响位置
          </div>
          <div className="mt-3 text-sm text-[#1F1F1F]">
            {selectedChange ? formatLocatorSummary(selectedChange) : '未选中变更'}
          </div>
        </div>
        <RendererComponent
          document={selectedDocument}
          change={selectedChange}
          onOpenPreview={(filePath, fileName) =>
            onOpenFile({
              path: filePath,
              fileName,
              origin: 'preview'
            })
          }
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div
        className="flex h-full items-center justify-center"
        data-testid={workbenchSelectors.reviewPanel}
      >
        <Spin />
      </div>
    )
  }

  if (!review) {
    return (
      <div
        className="flex h-full items-center justify-center rounded-[18px] border border-dashed border-[#E5E5E4] bg-[#FAFAF9] text-sm text-[#999999]"
        data-testid={workbenchSelectors.reviewPanel}
      >
        当前没有可审阅的修改。
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" data-testid={workbenchSelectors.reviewPanel}>
      <div className="space-y-4 border-b border-[#E5E5E4] pb-4">
        <div className="rounded-[18px] border border-[#E5E5E4] bg-[#FCFBF8] px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-[#1F1F1F]">{review.review.title}</div>
              <div className="mt-2 text-xs text-[#666666]">
                {selectedDocument?.source_name || '未选择文档'} ·{' '}
                {selectedDocument?.source_path || review.review.id}
              </div>
              {selectedChange ? (
                <div className="mt-3 text-sm leading-relaxed text-[#666666]">
                  {selectedChange.summary}
                </div>
              ) : null}
            </div>
            {reviewStatusMeta ? (
              <span
                className={`rounded-full border px-3 py-1 text-[11px] ${reviewStatusMeta.className}`}
              >
                {reviewStatusMeta.label}
              </span>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {review.documents.map((document) => (
              <button
                key={document.id}
                type="button"
                onClick={() => setSelectedDocumentId(document.id)}
                className={`rounded-full border px-3 py-1.5 text-xs transition-all duration-200 ${
                  document.id === selectedDocumentId
                    ? 'border-[#D97757] bg-white text-[#D97757]'
                    : 'border-[#E5E5E4] bg-[#F8F8F7] text-[#666666] hover:border-[#D97757] hover:text-[#D97757]'
                }`}
              >
                {document.source_name}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[18px] border border-[#E5E5E4] bg-white px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">
                变更导航
              </div>
              <div className="mt-2 text-sm text-[#1F1F1F]">
                {selectedIndex >= 0
                  ? `第 ${selectedIndex + 1} / ${documentChanges.length} 处变更`
                  : '暂无变更'}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="small"
                disabled={!previousChange}
                onClick={() => setSelectedChangeId(previousChange?.id || null)}
              >
                上一个
              </Button>
              <Button
                size="small"
                disabled={!nextChange}
                onClick={() => setSelectedChangeId(nextChange?.id || null)}
              >
                下一个
              </Button>
            </div>
          </div>
          <div className="mt-3 max-h-[180px] space-y-2 overflow-auto pr-1">
            {documentChanges.map((change) => (
              <button
                key={change.id}
                type="button"
                onClick={() => setSelectedChangeId(change.id)}
                className={`w-full rounded-2xl border px-3 py-3 text-left transition-all duration-200 ${
                  change.id === selectedChangeId
                    ? 'border-[#D97757] bg-[#FCFBF8]'
                    : 'border-[#E5E5E4] bg-[#FAFAF9] hover:border-[#D97757]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-medium text-[#1F1F1F]">{change.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#666666]">
                      {change.summary}
                    </div>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] text-[#666666]">
                    {change.decision}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2" data-testid={workbenchSelectors.reviewTabs}>
          {[
            { key: 'diff', label: '差异' },
            { key: 'preview', label: '预览' },
            { key: 'source', label: '来源' }
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key as ReviewTab)}
              className={`rounded-full border px-3 py-1.5 text-sm transition-all duration-200 ${
                activeTab === tab.key
                  ? 'border-[#D97757] bg-[#FCFBF8] text-[#D97757]'
                  : 'border-[#E5E5E4] bg-white text-[#666666] hover:border-[#D97757] hover:text-[#D97757]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 py-4">{renderBody()}</div>

      <div className="space-y-4 border-t border-[#E5E5E4] bg-white pt-4">
        <div className="rounded-[18px] border border-[#E5E5E4] bg-[#FCFBF8] px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-semibold text-[#1F1F1F]">提交前校验</div>
              <div className="mt-1 text-xs text-[#666666]">
                所有变更都明确决策后，才允许写回真实文件。
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={onRefreshValidation}
                loading={validating}
              >
                重新校验
              </Button>
              <Button
                type="primary"
                size="large"
                icon={<FileSyncOutlined />}
                onClick={onCommit}
                loading={committing}
                disabled={commitDisabled}
              >
                确认提交到源文件
              </Button>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {validation?.issues.length ? (
              validation.issues.map((issue, index) => (
                <div
                  key={`${issue.code}-${index}`}
                  className="rounded-xl border border-[#FDECC8] bg-[#FFF9ED] px-3 py-3 text-sm text-[#8A6510]"
                >
                  <div>{issue.message}</div>
                  {issue.sourcePath ? (
                    <div className="mt-1 break-all text-xs text-[#999999]">{issue.sourcePath}</div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-[#DCEBD7] bg-[#F3FAF0] px-3 py-3 text-sm text-[#4F7A46]">
                校验通过，可以提交接受的修改。
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => selectedChange && onSetDecision(selectedChange.id, 'accepted')}
            disabled={
              !selectedChange ||
              busyChangeIds.includes(selectedChange.id) ||
              review.review.status === 'committed'
            }
            icon={<CheckOutlined />}
          >
            接受当前
          </Button>
          <Button
            onClick={() => selectedChange && onSetDecision(selectedChange.id, 'rejected')}
            disabled={
              !selectedChange ||
              busyChangeIds.includes(selectedChange.id) ||
              review.review.status === 'committed'
            }
            icon={<CloseOutlined />}
          >
            拒绝当前
          </Button>
          <Button onClick={() => onSetAllPending('accepted')} loading={bulkApplying}>
            接受全部待决
          </Button>
          <Button onClick={() => onSetAllPending('rejected')} loading={bulkApplying}>
            拒绝全部待决
          </Button>
        </div>

        {latestCommitJob ? (
          <div className="rounded-[18px] border border-[#E5E5E4] bg-[#FCFBF8] px-4 py-4">
            <div className="text-[13px] font-semibold text-[#1F1F1F]">最近一次提交结果</div>
            <div className="mt-3 space-y-2">
              {latestCommitJob.results.map((result) => (
                <div
                  key={`${result.draft_document_id}-${result.output_path}`}
                  className="rounded-xl border border-[#E5E5E4] bg-white px-3 py-3"
                >
                  <div className="break-all text-sm text-[#1F1F1F]">{result.output_path}</div>
                  <div className="mt-1 text-xs text-[#666666]">
                    {result.operation} ·{' '}
                    {result.byte_size ? `${result.byte_size} bytes` : 'size unknown'}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="small"
                      icon={<FolderOpenOutlined />}
                      onClick={() => void onRevealPath(result.output_path)}
                    >
                      定位
                    </Button>
                    <Button size="small" onClick={() => void onOpenPath(result.output_path)}>
                      打开
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default WorkbenchReviewPanel
