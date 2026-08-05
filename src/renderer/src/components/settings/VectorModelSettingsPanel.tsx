import React, { useCallback, useEffect, useState } from 'react'
import { Button, List, Popconfirm, Progress, Tag, message } from 'antd'
import { HiCheckCircle, HiExclamationCircle, HiTrash } from 'react-icons/hi2'
import type {
  ModelInfo,
  DownloadProgressPayload,
  ActiveDownloadSnapshot,
  DownloadStatus
} from './types'
import { vectorSelectors } from '../../testing/selectors'

const TEXT = {
  catalogError: '获取模型列表失败',
  downloadCompleted: '模型下载完成',
  activeTaskWarning: '已有任务正在下载中',
  startDownloadFailed: '启动下载失败',
  downloadFailedPrefix: '下载失败',
  unknownError: '未知错误',
  deleteFailed: '删除模型失败',
  deleteFailedPrefix: '删除失败',
  deleteCompleted: '模型已删除',
  deleteConfirmTitle: '确认删除此模型吗？',
  deleteConfirmDescription: '删除后需重新下载才能再次使用。',
  deleteDuringDownloadDescription: '删除将取消当前下载并移除已下载文件。',
  confirmDelete: '确认删除',
  cancelDelete: '取消',
  installed: '已安装',
  delete: '删除',
  downloading: '下载中',
  downloadingLabel: '正在下载...',
  download: '下载',
  fileUnit: '文件'
} as const

const toErrorMessage = (error: Error | string): string =>
  error instanceof Error ? error.message : String(error)

const VectorModelSettingsPanel: React.FC = () => {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [errorRepoId, setErrorRepoId] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [currentFile, setCurrentFile] = useState('')
  const [fileProgress, setFileProgress] = useState({ completed: 0, total: 0 })
  const [errorMsg, setErrorMsg] = useState('')

  const fetchModels = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const list = await window.api.getModels()
      setModels(list)
      setCatalogError('')
    } catch (error) {
      console.error(error)
      setModels([])
      setCatalogError(TEXT.catalogError)
      message.error(TEXT.catalogError)
    } finally {
      setLoading(false)
    }
  }, [])

  const applyDownloadState = useCallback(
    (
      data: DownloadProgressPayload | ActiveDownloadSnapshot,
      status: DownloadStatus = 'downloading'
    ): void => {
      if (status === 'downloading') {
        setDownloadingId(data.repoId)
        setErrorRepoId(null)
        setErrorMsg('')
        setDownloadProgress(data.progress)
        setCurrentFile('currentFile' in data ? data.currentFile : data.file || '')
        setFileProgress({
          completed: data.completedFiles || 0,
          total: data.totalFiles || 0
        })
        return
      }

      if (status === 'completed') {
        setDownloadingId(null)
        setErrorRepoId(null)
        setErrorMsg('')
        setDownloadProgress(100)
        void fetchModels()
        message.success(TEXT.downloadCompleted)
        return
      }

      if (status === 'cancelled') {
        setDownloadingId(null)
        setErrorRepoId(null)
        setErrorMsg('')
        setDownloadProgress(0)
        setCurrentFile('')
        setFileProgress({ completed: 0, total: 0 })
        void fetchModels()
        return
      }

      const nextError = 'error' in data ? data.error || TEXT.unknownError : TEXT.unknownError
      setDownloadingId(null)
      setErrorRepoId(data.repoId)
      setErrorMsg(nextError)
      if ('file' in data && data.file) {
        setCurrentFile(data.file)
      }
      message.error(`${TEXT.downloadFailedPrefix}: ${nextError}`)
    },
    [fetchModels]
  )

  useEffect(() => {
    let disposed = false

    const handleProgress = (data: DownloadProgressPayload) => {
      if (disposed) return
      applyDownloadState(data, data.status)
    }

    window.api.onDownloadProgress(handleProgress)

    void (async () => {
      await fetchModels()
      const activeDownload = await window.api.getActiveDownload()
      if (!disposed && activeDownload) {
        applyDownloadState(activeDownload)
      }
    })()

    return () => {
      disposed = true
      window.api.removeDownloadProgressListeners()
    }
  }, [applyDownloadState, fetchModels])

  const handleDownload = async (repoId: string): Promise<void> => {
    if (downloadingId) {
      message.warning(TEXT.activeTaskWarning)
      return
    }

    setDownloadingId(repoId)
    setErrorRepoId(null)
    setDownloadProgress(0)
    setCurrentFile('')
    setFileProgress({ completed: 0, total: 0 })
    setErrorMsg('')

    try {
      const response = await window.api.downloadModel(repoId)
      if (!response.success) {
        const messageText = response.error || TEXT.startDownloadFailed
        setDownloadingId(null)
        setErrorRepoId(repoId)
        setErrorMsg(messageText)
        message.error(`${TEXT.downloadFailedPrefix}: ${messageText}`)
      }
    } catch (error) {
      const messageText = toErrorMessage(error instanceof Error ? error : String(error))
      setDownloadingId(null)
      setErrorRepoId(repoId)
      setErrorMsg(messageText)
      message.error(`${TEXT.downloadFailedPrefix}: ${messageText}`)
    }
  }

  const handleDelete = async (repoId: string): Promise<void> => {
    const response = await window.api.deleteModel(repoId)
    if (!response.success) {
      const messageText = response.error || TEXT.deleteFailed
      setErrorRepoId(repoId)
      setErrorMsg(messageText)
      message.error(`${TEXT.deleteFailedPrefix}: ${messageText}`)
      return
    }

    if (errorRepoId === repoId) {
      setErrorRepoId(null)
      setErrorMsg('')
    }
    message.success(TEXT.deleteCompleted)
    await fetchModels()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5" data-testid={vectorSelectors.page}>
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
        <div className="min-h-0 flex-1 overflow-auto [&_.ant-list-item]:!border-[#EEEEEC] [&_.ant-list-item]:transition-colors [&_.ant-list-item:hover]:!bg-[#F7F7F5]">
          {catalogError ? (
            <div
              className="nc-notice nc-notice-danger my-3"
              data-testid={vectorSelectors.catalogError}
            >
              {catalogError}
            </div>
          ) : null}

          <List
            loading={loading}
            itemLayout="horizontal"
            dataSource={models}
            data-testid={vectorSelectors.list}
            renderItem={(item) => (
              <List.Item
                data-testid={`${vectorSelectors.cardPrefix}-${item.id}`}
                actions={
                  item.isDownloaded
                    ? [
                        <div
                          key={`installed-${item.id}`}
                          className="flex items-center gap-2 font-medium text-[#2F6F4E]"
                          data-testid={`${vectorSelectors.installedBadgePrefix}-${item.id}`}
                        >
                          <HiCheckCircle className="text-lg" />
                          <span>{TEXT.installed}</span>
                        </div>,
                        <Popconfirm
                          key={`delete-confirm-${item.id}`}
                          title={TEXT.deleteConfirmTitle}
                          description={TEXT.deleteConfirmDescription}
                          okText={TEXT.confirmDelete}
                          cancelText={TEXT.cancelDelete}
                          onConfirm={() => void handleDelete(item.id)}
                          okButtonProps={{
                            'data-testid': `${vectorSelectors.deleteConfirmButtonPrefix}-${item.id}`
                          }}
                          cancelButtonProps={{
                            'data-testid': `${vectorSelectors.deleteCancelButtonPrefix}-${item.id}`
                          }}
                        >
                          <Button
                            type="text"
                            danger
                            icon={<HiTrash className="h-4 w-4" />}
                            aria-label={TEXT.delete}
                            data-testid={`${vectorSelectors.deleteButtonPrefix}-${item.id}`}
                          />
                        </Popconfirm>
                      ]
                    : downloadingId === item.id
                      ? [
                          <Button key={`downloading-${item.id}`} disabled loading>
                            {TEXT.downloading}
                          </Button>,
                          <Popconfirm
                            key={`delete-confirm-${item.id}`}
                            title={TEXT.deleteConfirmTitle}
                            description={TEXT.deleteDuringDownloadDescription}
                            okText={TEXT.confirmDelete}
                            cancelText={TEXT.cancelDelete}
                            onConfirm={() => void handleDelete(item.id)}
                            okButtonProps={{
                              'data-testid': `${vectorSelectors.deleteConfirmButtonPrefix}-${item.id}`
                            }}
                            cancelButtonProps={{
                              'data-testid': `${vectorSelectors.deleteCancelButtonPrefix}-${item.id}`
                            }}
                          >
                            <Button
                              type="text"
                              danger
                              icon={<HiTrash className="h-4 w-4" />}
                              aria-label={TEXT.delete}
                              data-testid={`${vectorSelectors.deleteButtonPrefix}-${item.id}`}
                            />
                          </Popconfirm>
                        ]
                      : [
                          <Button
                            key={`download-${item.id}`}
                            type="primary"
                            onClick={() => void handleDownload(item.id)}
                            className="!border-none !bg-[#37352F] shadow-none hover:!bg-[#2F3437]"
                            disabled={Boolean(downloadingId)}
                            data-testid={`${vectorSelectors.downloadButtonPrefix}-${item.id}`}
                          >
                            {TEXT.download}
                          </Button>
                        ]
                }
                className="!px-3 !py-4"
              >
                <List.Item.Meta
                  title={
                    <div className="mb-2 flex items-center gap-3">
                      <span className="text-[16px] font-semibold text-[#37352F]">{item.name}</span>
                      {item.tags.map((tag) => (
                        <Tag key={tag} className="mr-0 text-xs">
                          {tag}
                        </Tag>
                      ))}
                    </div>
                  }
                  description={
                    <div className="space-y-4">
                      <p className="text-[#787774]">{item.description}</p>

                      {downloadingId === item.id ? (
                        <div
                          className="rounded-[8px] border border-[#EEEEEC] bg-[#FFFFFF] p-4"
                          data-testid={`${vectorSelectors.progressPrefix}-${item.id}`}
                        >
                          <div className="mb-2 flex justify-between text-sm">
                            <span className="font-medium text-[#37352F]">
                              {TEXT.downloadingLabel}
                            </span>
                            <span className="font-medium text-[#37352F]">{downloadProgress}%</span>
                          </div>
                          <Progress
                            percent={downloadProgress}
                            strokeColor="#37352F"
                            showInfo={false}
                            className="!mb-2"
                          />
                          <div className="flex justify-between text-xs text-[#9B9A97]">
                            <span
                              className="max-w-[200px] truncate"
                              data-testid={`${vectorSelectors.currentFilePrefix}-${item.id}`}
                            >
                              {currentFile}
                            </span>
                            <span>
                              {fileProgress.completed}/{fileProgress.total} {TEXT.fileUnit}
                            </span>
                          </div>
                        </div>
                      ) : null}

                      {errorMsg && errorRepoId === item.id ? (
                        <div
                          className="flex items-center gap-1 text-sm text-[#B3261E]"
                          data-testid={`${vectorSelectors.errorPrefix}-${item.id}`}
                        >
                          <HiExclamationCircle />
                          {errorMsg}
                        </div>
                      ) : null}
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        </div>
      </section>
    </div>
  )
}

export default VectorModelSettingsPanel
