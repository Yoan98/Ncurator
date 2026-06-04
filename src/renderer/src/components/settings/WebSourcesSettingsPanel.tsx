import React, { useCallback, useEffect, useState } from 'react'
import { Button, Empty, Input, Modal, Tooltip, message } from 'antd'
import type {
  WorkspaceIndexJobRecord,
  WebSourceListResponse,
  WebSourceRecord
} from '../../../../shared/types'
import {
  HiArrowTopRightOnSquare,
  HiArrowPath,
  HiGlobeAlt,
  HiOutlineQuestionMarkCircle,
  HiOutlineTrash,
  HiSparkles
} from 'react-icons/hi2'
import { importSelectors } from '../../testing/selectors'
import StatusTag from './StatusTag'
import WorkspaceIndexJobProgress from './WorkspaceIndexJobProgress'
import { formatDateTime, getWebStatusBadge } from './utils/workspace'

type WebSourcesSettingsPanelProps = {
  workspaceId: string | null
  workspaceName?: string
  embedded?: boolean
}

const WebSourcesSettingsPanel: React.FC<WebSourcesSettingsPanelProps> = ({ workspaceId }) => {
  const [webSources, setWebSources] = useState<WebSourceRecord[]>([])
  const [webLoading, setWebLoading] = useState(false)
  const [webModalVisible, setWebModalVisible] = useState(false)
  const [webUrlsText, setWebUrlsText] = useState('')
  const [webUrlsError, setWebUrlsError] = useState('')
  const [webSubmitting, setWebSubmitting] = useState(false)
  const [webIndexJob, setWebIndexJob] = useState<WorkspaceIndexJobRecord | undefined>(undefined)
  const [deleteWebSource, setDeleteWebSource] = useState<WebSourceRecord | null>(null)
  const [webSummary, setWebSummary] = useState<WebSourceListResponse['summary']>({
    web_count: 0,
    needs_index_count: 0,
    failed_count: 0
  })
  const actionableWebIndexCount = webSummary.needs_index_count + webSummary.failed_count

  const loadWebSources = useCallback(async (): Promise<void> => {
    if (!workspaceId) {
      setWebSources([])
      setWebSummary({
        web_count: 0,
        needs_index_count: 0,
        failed_count: 0
      })
      return
    }
    setWebLoading(true)
    try {
      const response = await window.api.webSourceList({ workspaceId })
      setWebSources(response.items)
      setWebSummary(response.summary)
    } catch (error) {
      console.error(error)
      message.error('加载网页资料失败')
    } finally {
      setWebLoading(false)
    }
  }, [workspaceId])

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
    if (!workspaceId) {
      setWebIndexJob(undefined)
      return
    }
    void window.api
      .workspaceIndexJobGet({ workspaceId, sourceKind: 'web' })
      .then((response) => {
        if (!response.success) return
        setWebIndexJob(response.job?.status === 'running' ? response.job : undefined)
      })
      .catch(console.error)
  }, [workspaceId])

  useEffect(() => {
    const handleProgress = (job: WorkspaceIndexJobRecord): void => {
      if (job.source_kind !== 'web' || job.workspace_id !== workspaceId) return
      setWebIndexJob(job.status === 'running' ? job : undefined)
      void loadWebSources()
    }
    return window.api.onWorkspaceIndexJobProgress(handleProgress)
  }, [loadWebSources, workspaceId])

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
      if (!workspaceId) {
        message.warning('请先选择工作空间')
        return
      }
      const response = await window.api.ingestWebs(urls.map((url) => ({ workspaceId, url })))
      if (!response.success) {
        message.error(response.error || '添加网页失败')
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
    if (!workspaceId) return
    try {
      const response = await window.api.webSourcesScan({ workspaceId })
      if (!response.success) {
        message.error(response.error || '检查网页更新失败')
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
    if (!workspaceId) return
    try {
      const response = await window.api.webSourcesPrepare({ workspaceId })
      if (!response.success) {
        message.error(response.error || '更新网页索引失败')
        return
      }
      setWebIndexJob(response.job)
      await loadWebSources()
    } catch (error) {
      console.error(error)
      message.error('更新网页索引失败')
    }
  }

  const handleDeleteWebSource = async (): Promise<void> => {
    if (!deleteWebSource || !workspaceId) return
    try {
      const response = await window.api.webSourceDelete({
        workspaceId,
        webSourceId: deleteWebSource.id
      })
      if (!response.success) {
        message.error(response.error || '删除网页失败')
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

  return (
    <div
      className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]"
      data-testid={importSelectors.webSourceSection}
    >
      <div className="space-y-4">
        <section className="ui-panel-soft p-4">
          <div className="text-[14px] font-semibold text-[#1F1F1F]">网页来源</div>
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

        <section className="ui-panel-soft p-4">
          <div className="flex items-center gap-1.5">
            <div className="text-[14px] font-semibold text-[#1F1F1F]">索引状态</div>
            <Tooltip title="网页索引会先爬取正文，再写入本地检索库。">
              <HiOutlineQuestionMarkCircle className="h-4 w-4 cursor-help text-[#999999] transition-colors hover:text-[#D97757]" />
            </Tooltip>
          </div>

          <div className="mt-3 text-[12px] text-[#666666]">
            <div className="ui-inset px-3 py-3">
              <div className="inline-flex items-center gap-1.5">
                <HiArrowPath className="h-4 w-4 text-[#AD7B18]" />
                <span>可索引</span>
              </div>
              <div
                className="mt-1 text-[16px] font-semibold text-[#1F1F1F]"
                data-testid={importSelectors.webSourceActionableIndexCount}
              >
                {actionableWebIndexCount}
              </div>
              {webSummary.failed_count > 0 ? (
                <div
                  className="mt-1 text-[11px] text-[#B5455D]"
                  data-testid={importSelectors.webSourceActionableFailedHint}
                >
                  含失败 {webSummary.failed_count} 个
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              icon={<HiArrowPath className="h-4 w-4" />}
              onClick={() => void handleScanWebSources()}
              disabled={Boolean(webIndexJob)}
              loading={webIndexJob?.action === 'scan'}
              className="border-[#E5E5E4] bg-white text-[#1F1F1F]"
            >
              检查更新
            </Button>
            <Button
              type="primary"
              icon={<HiSparkles className="h-4 w-4" />}
              onClick={() => void handlePrepareWebSources()}
              disabled={Boolean(webIndexJob)}
              loading={webIndexJob?.action === 'prepare'}
            >
              更新索引
            </Button>
          </div>
          <WorkspaceIndexJobProgress
            job={webIndexJob}
            testId={importSelectors.webSourceIndexJobProgress}
          />
        </section>
      </div>

      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="mb-3 text-[14px] font-semibold text-[#1F1F1F]">网页列表</div>
        <div
          className="ui-inset flex min-h-0 flex-1 overflow-auto p-3"
          data-testid={importSelectors.webSourceList}
        >
          {webSources.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span className="text-[#666666]">{webLoading ? '正在加载网页' : '暂无网页'}</span>
                }
              />
            </div>
          ) : (
            <div className="w-full space-y-2">
              {webSources.map((source) => {
                const statusBadge = getWebStatusBadge(source, false)
                const lastUpdatedAt = source.last_crawled_at || source.fetched_at
                return (
                  <div
                    key={source.id}
                    className="rounded-[14px] border border-[#E5E5E4] bg-white px-4 py-4"
                    data-testid={`${importSelectors.webSourceCardPrefix}-${source.id}`}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-semibold text-[#1F1F1F]">
                          {source.title || source.url}
                        </div>
                        <div className="mt-1 break-all text-[12px] text-[#666666]">
                          {source.url}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[#999999]">
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
                              message.error(response.error || '打开链接失败')
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
        confirmLoading={webSubmitting}
        onCancel={() => setWebModalVisible(false)}
        onOk={() => void handleWebImport()}
        okText="添加"
        cancelText="取消"
        okButtonProps={{ 'data-testid': importSelectors.webSourceConfirmButton }}
        cancelButtonProps={{ 'data-testid': importSelectors.webSourceCancelButton }}
        data-testid={importSelectors.webSourceModal}
        className="[&_.ant-modal-content]:!rounded-[24px]"
      >
        <div className="space-y-4 pt-2">
          <div>
            <div className="mb-2 text-sm font-medium text-[#1F1F1F]">URL</div>
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
              <div className="mt-2 text-[12px] text-[#B5455D]">{webUrlsError}</div>
            ) : null}
          </div>
        </div>
      </Modal>

      <Modal
        title="删除网页"
        open={Boolean(deleteWebSource)}
        onCancel={() => setDeleteWebSource(null)}
        onOk={() => void handleDeleteWebSource()}
        okText="删除"
        okButtonProps={{
          danger: true,
          'data-testid': importSelectors.webSourceDeleteConfirmButton
        }}
        cancelText="取消"
        cancelButtonProps={{ 'data-testid': importSelectors.webSourceDeleteCancelButton }}
        className="[&_.ant-modal-content]:!rounded-[24px]"
      >
        <p className="mb-0 text-[#666666]">
          {deleteWebSource?.title || deleteWebSource?.url
            ? `将删除网页「${deleteWebSource?.title || deleteWebSource?.url}」。`
            : '将删除该网页。'}
        </p>
      </Modal>
    </div>
  )
}

export default WebSourcesSettingsPanel
