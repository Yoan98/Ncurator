import React, { useEffect, useState } from 'react'
import { Button, List, Popconfirm, Progress, Tag, Typography, message } from 'antd'
import { HiCheckCircle, HiCloudArrowDown, HiExclamationCircle } from 'react-icons/hi2'
import AppPageHeader from '../components/app/AppPageHeader'
import SettingsFloatingMenu from '../components/settings/SettingsFloatingMenu'
import { vectorSelectors } from '../testing/selectors'

const { Title } = Typography

interface ModelInfo {
  id: string
  name: string
  description: string
  tags: string[]
  isDownloaded: boolean
}

type DownloadStatus = 'downloading' | 'completed' | 'error'

type DownloadProgressPayload = {
  repoId: string
  file?: string
  status: DownloadStatus
  progress: number
  totalFiles?: number
  completedFiles?: number
  error?: string
}

type ActiveDownloadSnapshot = {
  repoId: string
  status: 'downloading'
  progress: number
  currentFile: string
  totalFiles: number
  completedFiles: number
  updatedAt: number
}

const TEXT = {
  pageTitle: '\u5411\u91cf\u6a21\u578b',
  pageDescription:
    '\u4e0b\u8f7d\u672c\u5730\u68c0\u7d22\u6a21\u578b\uff0c\u4e3a\u641c\u7d22\u548c\u77e5\u8bc6\u5e93\u80fd\u529b\u63d0\u4f9b\u5411\u91cf\u57fa\u7840\u3002',
  listTitle: '\u6a21\u578b\u5217\u8868',
  catalogError: '\u83b7\u53d6\u6a21\u578b\u5217\u8868\u5931\u8d25',
  downloadCompleted: '\u6a21\u578b\u4e0b\u8f7d\u5b8c\u6210',
  activeTaskWarning: '\u5df2\u6709\u4efb\u52a1\u6b63\u5728\u4e0b\u8f7d\u4e2d',
  startDownloadFailed: '\u542f\u52a8\u4e0b\u8f7d\u5931\u8d25',
  downloadFailedPrefix: '\u4e0b\u8f7d\u5931\u8d25',
  unknownError: '\u672a\u77e5\u9519\u8bef',
  deleteFailed: '\u5220\u9664\u6a21\u578b\u5931\u8d25',
  deleteFailedPrefix: '\u5220\u9664\u5931\u8d25',
  deleteCompleted: '\u6a21\u578b\u5df2\u5220\u9664',
  deleteConfirmTitle: '\u786e\u8ba4\u5220\u9664\u6b64\u6a21\u578b\u5417\uff1f',
  deleteConfirmDescription:
    '\u5220\u9664\u540e\u9700\u91cd\u65b0\u4e0b\u8f7d\u624d\u80fd\u518d\u6b21\u4f7f\u7528\u3002',
  confirmDelete: '\u786e\u8ba4\u5220\u9664',
  cancelDelete: '\u53d6\u6d88',
  installed: '\u5df2\u5b89\u88c5',
  delete: '\u5220\u9664',
  downloading: '\u4e0b\u8f7d\u4e2d',
  downloadingLabel: '\u6b63\u5728\u4e0b\u8f7d...',
  download: '\u4e0b\u8f7d',
  fileUnit: '\u6587\u4ef6'
} as const

const toErrorMessage = (error: Error | string): string =>
  error instanceof Error ? error.message : String(error)

const ModelDownloadPage: React.FC = () => {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [errorRepoId, setErrorRepoId] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [currentFile, setCurrentFile] = useState('')
  const [fileProgress, setFileProgress] = useState({ completed: 0, total: 0 })
  const [errorMsg, setErrorMsg] = useState('')

  const fetchModels = async (): Promise<void> => {
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
  }

  const applyDownloadState = (
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

    const nextError = 'error' in data ? data.error || TEXT.unknownError : TEXT.unknownError
    setDownloadingId(null)
    setErrorRepoId(data.repoId)
    setErrorMsg(nextError)
    if ('file' in data && data.file) {
      setCurrentFile(data.file)
    }
    message.error(`${TEXT.downloadFailedPrefix}: ${nextError}`)
  }

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
  }, [])

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
    <div className="nc-page" data-testid={vectorSelectors.page}>
      <div className="nc-page-inner gap-5">
        <AppPageHeader
          icon={<HiCloudArrowDown className="h-5 w-5" />}
          title={TEXT.pageTitle}
          description={TEXT.pageDescription}
          navigationMode="back"
          backTo="/"
        />

        <div className="nc-page-body">
          <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
            <div className="border-b border-[#EEEEEC] px-1 py-4">
              <Title level={4} className="!mb-0 !text-[#37352F]">
                {TEXT.listTitle}
              </Title>
            </div>
            <div className="nc-list-shell flex-1 [&_.ant-list-item]:!border-[#EEEEEC] [&_.ant-list-item]:transition-colors [&_.ant-list-item:hover]:!bg-[#F7F7F5]">
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
                                danger
                                data-testid={`${vectorSelectors.deleteButtonPrefix}-${item.id}`}
                              >
                                {TEXT.delete}
                              </Button>
                            </Popconfirm>,
                            <div
                              key={`installed-${item.id}`}
                              className="flex items-center gap-2 font-medium text-[#2F6F4E]"
                              data-testid={`${vectorSelectors.installedBadgePrefix}-${item.id}`}
                            >
                              <HiCheckCircle className="text-lg" />
                              <span>{TEXT.installed}</span>
                            </div>
                          ]
                        : downloadingId === item.id
                          ? [
                              <Button key={`downloading-${item.id}`} disabled loading>
                                {TEXT.downloading}
                              </Button>
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
                          <span className="text-[16px] font-semibold text-[#37352F]">
                            {item.name}
                          </span>
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
                                <span className="font-medium text-[#37352F]">
                                  {downloadProgress}%
                                </span>
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
          </div>
        </div>
      </div>
      <SettingsFloatingMenu />
    </div>
  )
}

export default ModelDownloadPage
