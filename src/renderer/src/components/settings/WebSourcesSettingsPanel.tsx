import React, { useCallback, useEffect, useState } from 'react'
import { Button, Empty, Input, Modal, Popover, Tooltip, message } from 'antd'
import type {
  WorkspaceIndexJobRecord,
  WebSourceListResponse,
  WebSourceRecord
} from '../../../../shared/types'
import {
  HiArrowTopRightOnSquare,
  HiArrowPath,
  HiCircleStack,
  HiGlobeAlt,
  HiOutlineQuestionMarkCircle,
  HiOutlineTrash
} from 'react-icons/hi2'
import { importSelectors } from '../../testing/selectors'
import { normalizeUserFacingError } from '../../utils/userFacingError'
import StatusTag from './StatusTag'
import WorkspaceIndexJobProgress from './WorkspaceIndexJobProgress'
import { KnowledgeIndexSpeedControl } from './KnowledgeIndexSpeedControl'
import IndexPrepareCancelModal from './IndexPrepareCancelModal'
import { formatDateTime, getWebStatusBadge } from './utils/workspace'

type WebSourcesSettingsPanelProps = {
  embedded?: boolean
  hasVectorModel: boolean | null
  onVectorModelSettingsOpen: () => void
  onSummaryChange?: (summary: WebSourceListResponse['summary']) => void
}

const WebSourcesSettingsPanel: React.FC<WebSourcesSettingsPanelProps> = ({
  hasVectorModel,
  onVectorModelSettingsOpen,
  onSummaryChange
}) => {
  const [webSources, setWebSources] = useState<WebSourceRecord[]>([])
  const [webLoading, setWebLoading] = useState(false)
  const [webModalVisible, setWebModalVisible] = useState(false)
  const [webUrlsText, setWebUrlsText] = useState('')
  const [webUrlsError, setWebUrlsError] = useState('')
  const [webSubmitting, setWebSubmitting] = useState(false)
  const [webIndexJob, setWebIndexJob] = useState<WorkspaceIndexJobRecord | undefined>(undefined)
  const [deleteWebSource, setDeleteWebSource] = useState<WebSourceRecord | null>(null)
  const [webPrepareCancelling, setWebPrepareCancelling] = useState(false)
  const [webCancelModalOpen, setWebCancelModalOpen] = useState(false)
  const [webSummary, setWebSummary] = useState<WebSourceListResponse['summary']>({
    web_count: 0,
    needs_index_count: 0,
    failed_count: 0
  })
  const actionableWebIndexCount = webSummary.needs_index_count + webSummary.failed_count

  const loadWebSources = useCallback(async (): Promise<void> => {
    setWebLoading(true)
    try {
      const response = await window.api.webSourceList({})
      setWebSources(response.items)
      setWebSummary(response.summary)
      onSummaryChange?.(response.summary)
    } catch (error) {
      console.error(error)
      message.error('加载网页资料失败')
    } finally {
      setWebLoading(false)
    }
  }, [onSummaryChange])

  useEffect(() => {
    void loadWebSources()
  }, [loadWebSources])

  useEffect(() => {
    const unsubscribe = window.api.sourceListRefresh(() => {
      void loadWebSources()
    })
    return () => {
      unsubscribe()
    }
  }, [loadWebSources])

  useEffect(() => {
    void window.api
      .workspaceIndexJobGet({ workspaceId: '', sourceKind: 'web' })
      .then((response) => {
        if (!response.success) return
        setWebIndexJob(response.job?.status === 'running' ? response.job : undefined)
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    const handleProgress = (job: WorkspaceIndexJobRecord): void => {
      if (job.source_kind !== 'web') return
      setWebIndexJob(job.status === 'running' ? job : undefined)
      void loadWebSources()
    }
    return window.api.onWorkspaceIndexJobProgress(handleProgress)
  }, [loadWebSources])

  useEffect(() => {
    if (webIndexJob?.action === 'prepare') return
    setWebPrepareCancelling(false)
    setWebCancelModalOpen(false)
  }, [webIndexJob])

  const handleWebImport = async (): Promise<void> => {
    const urls = webUrlsText
      .split('\n')
      .map((url) => url.trim())
      .filter(Boolean)
    if (urls.length === 0) {
      setWebUrlsError('请至少输入一个 URL')
      message.warning('请至少输入一个 URL')
      return
    }

    setWebUrlsError('')
    setWebSubmitting(true)
    try {
      const response = await window.api.ingestWebs(urls.map((url) => ({ url })))
      if (!response.success) {
        message.error(normalizeUserFacingError(response.error, '添加网页失败'))
        return
      }
      message.success('网页已添加，等待索引')
      setWebModalVisible(false)
      setWebUrlsText('')
      await loadWebSources()
    } catch (error) {
      console.error(error)
      message.error('添加网页失败')
    } finally {
      setWebSubmitting(false)
    }
  }

  const handleScanWebSources = async (): Promise<void> => {
    try {
      const response = await window.api.webSourcesScan({})
      if (!response.success) {
        message.error(normalizeUserFacingError(response.error, '检查网页更新失败'))
        return
      }
      setWebIndexJob(response.job)
      await loadWebSources()
    } catch (error) {
      console.error(error)
      message.error('检查网页更新失败')
    }
  }

  const handlePrepareWebSources = async (): Promise<void> => {
    if (hasVectorModel !== true) {
      message.warning('请先安装向量模型后再更新索引')
      return
    }

    try {
      const response = await window.api.webSourcesPrepare({})
      if (!response.success) {
        message.error(normalizeUserFacingError(response.error, '更新网页索引失败'))
        return
      }
      setWebIndexJob(response.job)
      await loadWebSources()
    } catch (error) {
      console.error(error)
      message.error('更新网页索引失败')
    }
  }

  const handleWebPrepareButtonClick = (): void => {
    if (webPrepareCancelling) return
    if (webIndexJob?.action === 'prepare') {
      setWebCancelModalOpen(true)
      return
    }
    void handlePrepareWebSources()
  }

  const handleConfirmWebPrepareCancel = async (): Promise<void> => {
    setWebCancelModalOpen(false)
    const hasRunningPrepare = webIndexJob?.action === 'prepare'
    if (hasRunningPrepare) setWebPrepareCancelling(true)
    try {
      const response = await window.api.workspaceIndexCancel({ sourceKind: 'web' })
      if (!response.success) {
        setWebPrepareCancelling(false)
        message.error(normalizeUserFacingError(response.error, '停止更新索引失败'))
      }
    } catch (error) {
      setWebPrepareCancelling(false)
      console.error(error)
      message.error('停止更新索引失败')
    }
  }

  const handleDeleteWebSource = async (): Promise<void> => {
    if (!deleteWebSource) return
    try {
      const response = await window.api.webSourceDelete({
        webSourceId: deleteWebSource.id
      })
      if (!response.success) {
        message.error(normalizeUserFacingError(response.error, '删除网页失败'))
        return
      }
      message.success('网页已删除')
      setDeleteWebSource(null)
      await loadWebSources()
    } catch (error) {
      console.error(error)
      message.error('删除网页失败')
    }
  }

  const vectorModelMissing = hasVectorModel === false
  const hasWebList = webSources.length > 0
  const webScanDisabled = !hasWebList
  const webPrepareRunning = webIndexJob?.action === 'prepare'
  const webPrepareDisabled = webPrepareCancelling
    ? true
    : webPrepareRunning
      ? false
      : hasVectorModel !== true || actionableWebIndexCount === 0
  const webPrepareLabel = webPrepareCancelling ? '停止中' : webPrepareRunning ? '取消' : '更新索引'
  const webPrepareTooltip =
    hasVectorModel === null
      ? '正在检查向量模型状态'
      : vectorModelMissing
        ? ''
        : webPrepareRunning
          ? '停止本次更新索引，已完成的会保留。'
          : actionableWebIndexCount === 0
            ? '当前没有需要更新的索引'
            : '检查网页变化并更新索引。'
  const vectorModelRequirementContent = (
    <div className="w-[220px]">
      <div className="text-[13px] font-medium text-[#37352F]">先安装向量模型</div>
      <div className="mt-1 text-[12px] leading-5 text-[#787774]">
        安装后才能为工作空间更新索引。
      </div>
      <Button
        type="link"
        size="small"
        className="mt-2 !h-auto !p-0 !text-[#2F3437]"
        onClick={onVectorModelSettingsOpen}
      >
        去安装
      </Button>
    </div>
  )

  return (
    <div
      className="grid h-full min-h-0 gap-4 xl:grid-cols-[260px_minmax(0,1fr)]"
      data-testid={importSelectors.webSourceSection}
    >
      <div className="space-y-5">
        <section className="nc-settings-side-section pb-4">
          <div className="text-[14px] font-semibold text-[#37352F]">网页来源</div>
          <Button
            type="primary"
            className="mt-4 w-full"
            icon={<HiGlobeAlt className="h-4 w-4" />}
            onClick={() => {
              setWebUrlsError('')
              setWebModalVisible(true)
            }}
            data-testid={importSelectors.webSourceOpenModalButton}
          >
            添加网页
          </Button>
        </section>

        <section className="nc-settings-side-section pb-4">
          <div className="flex items-center gap-1.5">
            <div className="text-[14px] font-semibold text-[#37352F]">索引状态</div>
            <Tooltip title="网页索引会先爬取正文，再写入本地检索库。">
              <HiOutlineQuestionMarkCircle className="h-4 w-4 cursor-help text-[#9B9A97] transition-colors hover:text-[#37352F]" />
            </Tooltip>
          </div>

          <div className="mt-3 text-[12px] text-[#787774]">
            <div className="ui-inset px-3 py-3">
              <div className="inline-flex items-center gap-1.5">
                <HiArrowPath className="h-4 w-4 text-[#787774]" />
                <span>可索引</span>
              </div>
              <div
                className="mt-1 text-[16px] font-semibold text-[#37352F]"
                data-testid={importSelectors.webSourceActionableIndexCount}
              >
                {actionableWebIndexCount}
              </div>
              {webSummary.failed_count > 0 ? (
                <div
                  className="mt-1 text-[11px] text-[#B3261E]"
                  data-testid={importSelectors.webSourceActionableFailedHint}
                >
                  含失败 {webSummary.failed_count} 个
                </div>
              ) : null}
            </div>
          </div>

          <KnowledgeIndexSpeedControl />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              icon={<HiArrowPath className="h-4 w-4" />}
              onClick={() => void handleScanWebSources()}
              loading={webIndexJob?.action === 'scan'}
              disabled={webScanDisabled}
              className="border-[#EEEEEC] bg-white text-[#37352F]"
            >
              检查更新
            </Button>
            <div className="relative min-w-0">
              <Tooltip title={webPrepareTooltip}>
                <Button
                  type="primary"
                  icon={<HiCircleStack className="h-4 w-4" />}
                  onClick={handleWebPrepareButtonClick}
                  disabled={webPrepareDisabled}
                  className={`w-full min-w-0 ${vectorModelMissing ? '!pr-9' : ''}`}
                >
                  {webPrepareLabel}
                </Button>
              </Tooltip>
              {vectorModelMissing ? (
                <Popover
                  trigger={['hover', 'click']}
                  placement="topRight"
                  content={vectorModelRequirementContent}
                >
                  <button
                    type="button"
                    className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[6px] border border-[#EEEEEC] bg-white text-[#9B9A97] transition hover:border-[#DAD8D2] hover:text-[#37352F]"
                    aria-label="为什么不能更新索引"
                  >
                    <HiOutlineQuestionMarkCircle className="h-4 w-4" />
                  </button>
                </Popover>
              ) : null}
            </div>
          </div>
          <WorkspaceIndexJobProgress
            job={webIndexJob}
            testId={importSelectors.webSourceIndexJobProgress}
          />
        </section>
      </div>

      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="mb-3 text-[14px] font-semibold text-[#37352F]">网页列表</div>
        <div
          className="nc-list-shell-borderless flex min-h-0 flex-1"
          data-testid={importSelectors.webSourceList}
        >
          {webSources.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span className="text-[#787774]">{webLoading ? '正在加载网页' : '暂无网页'}</span>
                }
              />
            </div>
          ) : (
            <div className="w-full">
              {webSources.map((source) => {
                const statusBadge = getWebStatusBadge(source, false)
                const lastUpdatedAt = source.last_crawled_at || source.fetched_at
                return (
                  <div
                    key={source.id}
                    className="nc-list-row px-3 py-4"
                    data-testid={`${importSelectors.webSourceCardPrefix}-${source.id}`}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-semibold text-[#37352F]">
                          {source.title || source.url}
                        </div>
                        <div className="mt-1 break-all text-[12px] text-[#787774]">
                          {source.url}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[#9B9A97]">
                          <StatusTag
                            label={statusBadge.label}
                            className={statusBadge.className}
                            tooltip={statusBadge.tooltip}
                            icon={statusBadge.icon}
                          />
                          <span>
                            最近更新时间: {lastUpdatedAt ? formatDateTime(lastUpdatedAt) : '无'}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button
                          size="small"
                          icon={<HiArrowTopRightOnSquare className="h-4 w-4" />}
                          onClick={async () => {
                            const response = await window.api.openExternal(source.url)
                            if (!response.success) {
                              message.error(
                                normalizeUserFacingError(response.error, '打开链接失败')
                              )
                            }
                          }}
                          data-testid={`${importSelectors.webSourceUrlLinkButtonPrefix}-${source.id}`}
                        >
                          打开
                        </Button>
                        <Button
                          danger
                          size="small"
                          icon={<HiOutlineTrash className="h-4 w-4" />}
                          onClick={() => setDeleteWebSource(source)}
                          data-testid={`${importSelectors.webSourceDeleteButtonPrefix}-${source.id}`}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <Modal
        title="添加网页"
        open={webModalVisible}
        maskClosable={false}
        confirmLoading={webSubmitting}
        onCancel={() => setWebModalVisible(false)}
        onOk={() => void handleWebImport()}
        okText="添加"
        cancelText="取消"
        okButtonProps={{ 'data-testid': importSelectors.webSourceConfirmButton }}
        cancelButtonProps={{ 'data-testid': importSelectors.webSourceCancelButton }}
        data-testid={importSelectors.webSourceModal}
        className="[&_.ant-modal-content]:!rounded-[8px]"
      >
        <div className="space-y-4 pt-2">
          <div>
            <div className="mb-2 text-sm font-medium text-[#37352F]">URL</div>
            <Input.TextArea
              value={webUrlsText}
              onChange={(event) => {
                setWebUrlsText(event.target.value)
                if (webUrlsError) setWebUrlsError('')
              }}
              placeholder="每行一个 URL"
              autoSize={{ minRows: 4, maxRows: 8 }}
              data-testid={importSelectors.webSourceUrlInput}
            />
            {webUrlsError ? (
              <div className="mt-2 text-[12px] text-[#B3261E]">{webUrlsError}</div>
            ) : null}
          </div>
        </div>
      </Modal>

      <Modal
        title="删除网页"
        open={Boolean(deleteWebSource)}
        maskClosable={false}
        onCancel={() => setDeleteWebSource(null)}
        onOk={() => void handleDeleteWebSource()}
        okText="删除"
        okButtonProps={{
          danger: true,
          'data-testid': importSelectors.webSourceDeleteConfirmButton
        }}
        cancelText="取消"
        cancelButtonProps={{ 'data-testid': importSelectors.webSourceDeleteCancelButton }}
        className="[&_.ant-modal-content]:!rounded-[8px]"
      >
        <p className="mb-0 text-[#787774]">
          {deleteWebSource?.title || deleteWebSource?.url
            ? `将删除网页「${deleteWebSource?.title || deleteWebSource?.url}」。`
            : '将删除该网页。'}
        </p>
      </Modal>
      <IndexPrepareCancelModal
        open={webCancelModalOpen}
        confirmTestId={importSelectors.webSourceIndexCancelConfirmButton}
        continueTestId={importSelectors.webSourceIndexCancelContinueButton}
        onStop={() => void handleConfirmWebPrepareCancel()}
        onContinue={() => setWebCancelModalOpen(false)}
      />
    </div>
  )
}

export default WebSourcesSettingsPanel
