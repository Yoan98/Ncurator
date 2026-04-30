import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Empty, Input, Modal, Tooltip, message } from 'antd'
import type { WebSourceRecord } from '../../../../shared/types'
import { HiArrowPath, HiGlobeAlt, HiOutlineClock, HiOutlineTrash } from 'react-icons/hi2'
import { importSelectors } from '../../testing/selectors'
import StatusTag from './StatusTag'
import { formatDateTime, getWebStatusBadge } from './utils/workspace'

type WebSourcesSettingsPanelProps = {
  workspaceId: string | null
  workspaceName?: string
  embedded?: boolean
}

const WebSourcesSettingsPanel: React.FC<WebSourcesSettingsPanelProps> = ({
  workspaceId,
  workspaceName,
  embedded = false
}) => {
  const [webSources, setWebSources] = useState<WebSourceRecord[]>([])
  const [webLoading, setWebLoading] = useState(false)
  const [webKeyword, setWebKeyword] = useState('')
  const [webModalVisible, setWebModalVisible] = useState(false)
  const [webUrlsText, setWebUrlsText] = useState('')
  const [webUrlsError, setWebUrlsError] = useState('')
  const [webSubmitting, setWebSubmitting] = useState(false)
  const [webRefreshingAll, setWebRefreshingAll] = useState(false)
  const [webRefreshingIds, setWebRefreshingIds] = useState<Record<string, boolean>>({})
  const [webActionFeedback, setWebActionFeedback] = useState<{
    tone: 'success' | 'warning' | 'error'
    text: string
  } | null>(null)
  const [deleteWebSource, setDeleteWebSource] = useState<WebSourceRecord | null>(null)
  const [selectedWebSourceId, setSelectedWebSourceId] = useState<string | null>(null)

  const loadWebSources = useCallback(async (): Promise<void> => {
    if (!workspaceId) {
      setWebSources([])
      return
    }
    setWebLoading(true)
    try {
      const response = await window.api.webSourceList({ workspaceId })
      const keyword = webKeyword.trim().toLowerCase()
      const items = keyword
        ? response.items.filter((item) =>
            [item.title, item.url, item.normalized_url]
              .map((value) => String(value || '').toLowerCase())
              .some((value) => value.includes(keyword))
          )
        : response.items
      setWebSources(items)
    } catch (error) {
      console.error(error)
      message.error('加载网页资料失败')
    } finally {
      setWebLoading(false)
    }
  }, [webKeyword, workspaceId])

  useEffect(() => {
    void loadWebSources()
  }, [loadWebSources])

  useEffect(() => {
    window.api.sourceListRefresh(() => {
      void loadWebSources()
    })
    return () => {
      window.api.removeSourceListRefreshListeners()
    }
  }, [loadWebSources])

  useEffect(() => {
    if (webSources.length === 0) {
      setSelectedWebSourceId(null)
      return
    }

    if (!selectedWebSourceId || !webSources.some((source) => source.id === selectedWebSourceId)) {
      setSelectedWebSourceId(webSources[0].id)
    }
  }, [selectedWebSourceId, webSources])

  const selectedWebSource = useMemo(
    () => webSources.find((item) => item.id === selectedWebSourceId) || null,
    [selectedWebSourceId, webSources]
  )

  const selectedWebStatusBadge = useMemo(() => {
    if (!selectedWebSource) return null
    return getWebStatusBadge(selectedWebSource, Boolean(webRefreshingIds[selectedWebSource.id]))
  }, [selectedWebSource, webRefreshingIds])

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
      const scopedPayload = urls.map((url) => ({ workspaceId, url }))
      const response = await window.api.ingestWebs(scopedPayload)
      if (!response.success) {
        message.error(response.error || '提交网页资料失败')
        return
      }
      message.success('网页资料已加入队列')
      setWebModalVisible(false)
      setWebUrlsText('')
      await loadWebSources()
    } catch (error) {
      console.error(error)
      message.error('提交网页资料失败')
    } finally {
      setWebSubmitting(false)
    }
  }

  const handleRefreshWebSource = async (source: WebSourceRecord): Promise<void> => {
    if (!workspaceId) {
      message.warning('请先选择工作空间')
      return
    }
    setWebRefreshingIds((previous) => ({ ...previous, [source.id]: true }))
    try {
      const response = await window.api.webSourceRefresh({ workspaceId, webSourceId: source.id })
      if (!response.success) {
        message.error(response.error || '重新抓取网页资料失败')
        return
      }
      message.success('网页资料已重新抓取')
      await loadWebSources()
    } catch (error) {
      console.error(error)
      message.error('重新抓取网页资料失败')
    } finally {
      setWebRefreshingIds((previous) => ({ ...previous, [source.id]: false }))
    }
  }

  const handleRefreshAllWebSources = async (): Promise<void> => {
    if (!workspaceId) {
      message.warning('请先选择工作空间')
      return
    }
    if (webSources.length === 0) {
      setWebActionFeedback({
        tone: 'warning',
        text: '暂无可抓取的网页资料'
      })
      message.warning('暂无可抓取的网页资料')
      return
    }

    setWebRefreshingAll(true)
    setWebRefreshingIds(Object.fromEntries(webSources.map((source) => [source.id, true] as const)))
    try {
      const results = await Promise.allSettled(
        webSources.map((source) =>
          window.api.webSourceRefresh({ workspaceId, webSourceId: source.id })
        )
      )
      const successCount = results.filter(
        (result) => result.status === 'fulfilled' && result.value.success
      ).length
      const failedCount = results.length - successCount

      if (successCount > 0) {
        const feedbackText =
          failedCount > 0
            ? `已触发 ${successCount} 条网页重新抓取，${failedCount} 条失败`
            : `已触发 ${successCount} 条网页重新抓取`
        setWebActionFeedback({
          tone: failedCount > 0 ? 'warning' : 'success',
          text: feedbackText
        })
        message.success(feedbackText)
      } else {
        setWebActionFeedback({
          tone: 'error',
          text: '全部抓取失败'
        })
        message.error('全部抓取失败')
      }

      await loadWebSources()
    } catch (error) {
      console.error(error)
      message.error('全部抓取失败')
    } finally {
      setWebRefreshingAll(false)
      setWebRefreshingIds({})
    }
  }

  const handleDeleteWebSource = async (): Promise<void> => {
    if (!deleteWebSource) return
    try {
      if (!workspaceId) {
        message.warning('请先选择工作空间')
        return
      }
      const response = await window.api.webSourceDelete({
        workspaceId,
        webSourceId: deleteWebSource.id
      })
      if (!response.success) {
        message.error(response.error || '删除网页资料失败')
        return
      }
      message.success('网页资料已删除')
      setDeleteWebSource(null)
      await loadWebSources()
    } catch (error) {
      console.error(error)
      message.error('删除网页资料失败')
    }
  }

  return (
    <div
      className={`flex min-h-0 flex-col gap-4 overflow-hidden ${embedded ? '' : 'h-full'}`}
      data-testid={importSelectors.webSourceSection}
    >
      <section className="ui-panel-ghost shrink-0 px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold tracking-tight text-[#1F1F1F]">网页资料</h2>
            <div className="pt-1 text-[12px] text-[#666666]">
              {workspaceName ? `${workspaceName} · ` : ''}
              共 {webSources.length} 条
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Tooltip
              title={
                webRefreshingAll
                  ? '正在刷新当前列表里的网页资料。'
                  : '重新抓取当前列表里的网页资料。'
              }
            >
              <Button
                icon={<HiArrowPath className="h-4 w-4" />}
                className="border-[#E5E5E4] bg-white text-[#1F1F1F]"
                onClick={() => void handleRefreshAllWebSources()}
                loading={webRefreshingAll}
              >
                全部抓取
              </Button>
            </Tooltip>
            <Button
              type="primary"
              onClick={() => {
                setWebUrlsError('')
                setWebModalVisible(true)
              }}
              data-testid={importSelectors.webSourceOpenModalButton}
            >
              添加网页
            </Button>
          </div>
        </div>
      </section>

      {webActionFeedback ? (
        <div
          className={`rounded-[18px] border px-4 py-3 text-[12px] ${
            webActionFeedback.tone === 'success'
              ? 'border-[#DCEBD7] bg-[#F3FAF0] text-[#4F7A46]'
              : webActionFeedback.tone === 'warning'
                ? 'border-[#FDECC8] bg-[#FFF9ED] text-[#AD7B18]'
                : 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]'
          }`}
        >
          {webActionFeedback.text}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden pr-1 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="ui-panel flex min-h-0 flex-col">
          <div className="border-b border-[#E5E5E4] px-4 py-4">
            <div className="text-[15px] font-semibold text-[#1F1F1F]">来源列表</div>
            <div className="mt-3" data-testid={importSelectors.webSourceSearchInput}>
              <Input.Search
                placeholder="按标题或 URL 过滤网页资料"
                value={webKeyword}
                onChange={(event) => setWebKeyword(event.target.value)}
                onSearch={() => void loadWebSources()}
                allowClear
                loading={webLoading}
              />
            </div>
          </div>

          <div
            className="flex-1 overflow-y-auto px-3 py-3 pr-2"
            data-testid={importSelectors.webSourceList}
          >
            {webSources.length === 0 ? (
              <div className="flex min-h-full items-center justify-center">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <span className="text-[#666666]">
                      {workspaceId ? '当前工作区暂无网页资料' : '请先选择工作空间'}
                    </span>
                  }
                />
              </div>
            ) : (
              <div className="space-y-2">
                {webSources.map((item) => {
                  const isSelected = item.id === selectedWebSourceId
                  const statusBadge = getWebStatusBadge(item, Boolean(webRefreshingIds[item.id]))

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedWebSourceId(item.id)}
                      data-testid={`${importSelectors.webSourceCardPrefix}-${item.id}`}
                      className={`ui-hover-lift w-full rounded-[14px] border px-4 py-4 text-left ${
                        isSelected
                          ? 'border-[#D97757] bg-[#FCFBF8] shadow-[0_0_0_1px_rgba(244,229,223,0.9)]'
                          : 'border-[#E5E5E4] bg-white hover:border-[#D4D4D3] hover:bg-[#FCFBF8]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="ui-icon-well ui-icon-well-brand flex h-8 w-8 shrink-0">
                            <HiGlobeAlt className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-[14px] font-semibold text-[#1F1F1F]">
                              {item.title || item.url}
                            </div>
                            <div className="mt-1 truncate text-[12px] text-[#666666]">
                              {item.url}
                            </div>
                          </div>
                        </div>
                        <StatusTag
                          label={statusBadge.label}
                          className={statusBadge.className}
                          tooltip={statusBadge.tooltip}
                          icon={statusBadge.icon}
                        />
                      </div>
                      <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-[#999999]">
                        <HiOutlineClock className="h-3.5 w-3.5" />
                        {formatDateTime(item.fetched_at)}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        <section className="ui-panel flex min-h-0 flex-col overflow-hidden">
          {selectedWebSource ? (
            <>
              <div className="border-b border-[#E5E5E4] px-5 py-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[16px] font-semibold text-[#1F1F1F]">
                        {selectedWebSource.title || selectedWebSource.url}
                      </h3>
                      {selectedWebStatusBadge ? (
                        <StatusTag
                          label={selectedWebStatusBadge.label}
                          className={selectedWebStatusBadge.className}
                          tooltip={selectedWebStatusBadge.tooltip}
                          icon={selectedWebStatusBadge.icon}
                        />
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="mt-3 inline-flex max-w-full items-center gap-2 break-all rounded-full bg-[#FBF5F2] px-3 py-1.5 text-left text-[12px] text-[#D97757] transition-colors hover:text-[#C66A4A]"
                      onClick={async () => {
                        const response = await window.api.openExternal(selectedWebSource.url)
                        if (!response.success) {
                          message.error(response.error || '打开链接失败')
                        }
                      }}
                      data-testid={importSelectors.webSourceUrlLinkButton}
                    >
                      <HiGlobeAlt className="h-3.5 w-3.5 shrink-0" />
                      {selectedWebSource.url}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Tooltip
                      title={
                        webRefreshingIds[selectedWebSource.id]
                          ? '正在重新抓取这条网页资料。'
                          : '重新抓取当前网页资料。'
                      }
                    >
                      <Button
                        icon={<HiArrowPath className="h-4 w-4" />}
                        className="border-[#E5E5E4] bg-white text-[#1F1F1F]"
                        onClick={() => void handleRefreshWebSource(selectedWebSource)}
                        loading={Boolean(webRefreshingIds[selectedWebSource.id])}
                        data-testid={`${importSelectors.webSourceRefreshButtonPrefix}-${selectedWebSource.id}`}
                      >
                        重新抓取
                      </Button>
                    </Tooltip>
                    <Button
                      danger
                      icon={<HiOutlineTrash className="h-4 w-4" />}
                      onClick={() => setDeleteWebSource(selectedWebSource)}
                      data-testid={`${importSelectors.webSourceDeleteButtonPrefix}-${selectedWebSource.id}`}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 pr-4">
                <div className="grid min-h-full gap-4">
                  <section className="ui-panel p-4">
                    <div className="text-[14px] font-semibold text-[#1F1F1F]">状态与异常</div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="ui-inset px-3 py-3 text-[12px] text-[#666666]">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-[#999999]">
                          状态
                        </div>
                        <div className="mt-1 text-[14px] font-semibold text-[#1F1F1F]">
                          {selectedWebStatusBadge?.label || '处理中'}
                        </div>
                      </div>
                      <div className="ui-inset px-3 py-3 text-[12px] text-[#666666]">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-[#999999]">
                          最近抓取
                        </div>
                        <div className="mt-1 text-[14px] font-semibold text-[#1F1F1F]">
                          {formatDateTime(selectedWebSource.fetched_at)}
                        </div>
                      </div>
                    </div>
                    {selectedWebSource.last_error ? (
                      <div className="mt-3 rounded-[14px] border border-[#F7D5D9] bg-[#FFF2F4] px-3 py-3 text-[12px] leading-6 text-[#B5455D]">
                        {selectedWebSource.last_error}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-[14px] border border-[#DCEBD7] bg-[#F3FAF0] px-3 py-3 text-[12px] text-[#4F7A46]">
                        暂无抓取错误
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<span className="text-[#666666]">选择一条网页资料</span>}
              />
            </div>
          )}
        </section>
      </div>

      <Modal
        title="添加网页资料"
        open={webModalVisible}
        confirmLoading={webSubmitting}
        onCancel={() => setWebModalVisible(false)}
        onOk={() => void handleWebImport()}
        okText="提交"
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
                if (webUrlsError) {
                  setWebUrlsError('')
                }
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
        title="删除网页资料"
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
            ? `将删除网页资料「${deleteWebSource?.title || deleteWebSource?.url}」。`
            : '将删除该网页资料。'}
        </p>
      </Modal>
    </div>
  )
}

export default WebSourcesSettingsPanel
