import React, { useState, useEffect } from 'react'
import { Button, Progress, Typography, message, Tag, List } from 'antd'
import { HiCloudArrowDown, HiCheckCircle, HiExclamationCircle } from 'react-icons/hi2'
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

  useEffect(() => {
    fetchModels()

    const handleProgress = (data: {
      repoId: string
      file?: string
      status: string
      progress: number
      totalFiles?: number
      completedFiles?: number
      error?: string
    }) => {
      if (data.status === 'downloading') {
        setDownloadingId(data.repoId)
        setErrorRepoId(null)
        // Use file count for progress calculation if totalFiles is available
        // because individual file progress might be too fast or granular.
        if (data.totalFiles && data.totalFiles > 0) {
          const percent = Math.round(((data.completedFiles || 0) / data.totalFiles) * 100)
          setDownloadProgress(percent)
          setFileProgress({
            completed: data.completedFiles || 0,
            total: data.totalFiles
          })
        } else {
          setDownloadProgress(data.progress)
        }

        if (data.file) setCurrentFile(data.file)
      } else if (data.status === 'completed') {
        setDownloadingId(null)
        setErrorRepoId(null)
        setDownloadProgress(100)
        message.success('模型下载完成！')
        fetchModels() // Refresh status
      } else if (data.status === 'error') {
        setDownloadingId(null)
        setErrorRepoId(data.repoId)
        setErrorMsg(data.error || '未知错误')
        message.error('下载失败: ' + data.error)
      }
    }

    window.api.onDownloadProgress(handleProgress)

    return () => {
      window.api.removeDownloadProgressListeners()
    }
  }, [])

  const fetchModels = async () => {
    setLoading(true)
    try {
      const list = await window.api.getModels()
      setModels(list)
      setCatalogError('')
    } catch (e) {
      console.error(e)
      setModels([])
      setCatalogError('获取模型列表失败')
      message.error('获取模型列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async (repoId: string) => {
    if (downloadingId) {
      message.warning('已有任务正在下载中')
      return
    }
    setDownloadingId(repoId)
    setErrorRepoId(null)
    setDownloadProgress(0)
    setCurrentFile('')
    setFileProgress({ completed: 0, total: 0 })
    setErrorMsg('')
    try {
      const res = await window.api.downloadModel(repoId)
      if (!res.success) {
        setDownloadingId(null)
        setErrorRepoId(repoId)
        setErrorMsg(res.error || '启动下载失败')
        message.error('下载失败: ' + (res.error || '启动下载失败'))
      }
    } catch (e: unknown) {
      setDownloadingId(null)
      setErrorRepoId(repoId)
      const messageText = e instanceof Error ? e.message : String(e)
      setErrorMsg(messageText)
      message.error('下载失败: ' + messageText)
    }
  }

  return (
    <div
      className="h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(251,245,242,0.95),_rgba(245,245,244,0.92)_42%,_#F5F5F4_72%)]"
      data-testid={vectorSelectors.page}
    >
      <div className="mx-auto flex h-full w-full max-w-[1360px] flex-col gap-5 px-5 py-5 lg:px-6">
        <AppPageHeader
          icon={<HiCloudArrowDown className="h-5 w-5" />}
          title="向量模型"
          description="下载本地检索模型，为搜索和知识库能力提供向量基础。"
          navigationMode="back"
          backTo="/"
        />

        <div className="min-h-0 flex-1 overflow-hidden pb-4 pr-1">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[20px] border border-[#E5E5E4] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <div className="border-b border-[#E5E5E4] px-5 py-4">
              <Title level={4} className="!mb-0 !text-[#1F1F1F]">
                模型列表
              </Title>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-5 py-2 pr-4">
              {catalogError ? (
                <div
                  className="mb-4 rounded-[18px] border border-[#F3D1C6] bg-[#FFF7F4] px-4 py-3 text-sm text-[#B5451B]"
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
                    actions={[
                      item.isDownloaded ? (
                        <div
                          className="flex items-center gap-2 font-medium text-green-600"
                          data-testid={`${vectorSelectors.installedBadgePrefix}-${item.id}`}
                        >
                          <HiCheckCircle className="text-lg" />
                          <span>已安装</span>
                        </div>
                      ) : downloadingId === item.id ? (
                        <Button disabled loading>
                          下载中
                        </Button>
                      ) : (
                        <Button
                          type="primary"
                          onClick={() => handleDownload(item.id)}
                          className="!border-none !bg-[#D97757] shadow-sm hover:!bg-[#C66A4A]"
                          disabled={!!downloadingId}
                          data-testid={`${vectorSelectors.downloadButtonPrefix}-${item.id}`}
                        >
                          下载
                        </Button>
                      )
                    ]}
                    className="!px-0 !py-5"
                  >
                    <List.Item.Meta
                      title={
                        <div className="mb-2 flex items-center gap-3">
                          <span className="text-[16px] font-semibold text-[#1F1F1F]">
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
                          <p className="text-[#666666]">{item.description}</p>

                          {downloadingId === item.id ? (
                            <div
                              className="rounded-[18px] border border-[#E5E5E4] bg-[#F5F5F4] p-4"
                              data-testid={`${vectorSelectors.progressPrefix}-${item.id}`}
                            >
                              <div className="mb-2 flex justify-between text-sm">
                                <span className="font-medium text-[#1F1F1F]">正在下载...</span>
                                <span className="font-medium text-[#D97757]">
                                  {downloadProgress}%
                                </span>
                              </div>
                              <Progress
                                percent={downloadProgress}
                                strokeColor="#D97757"
                                showInfo={false}
                                className="!mb-2"
                              />
                              <div className="flex justify-between text-xs text-[#999999]">
                                <span
                                  className="max-w-[200px] truncate"
                                  data-testid={`${vectorSelectors.currentFilePrefix}-${item.id}`}
                                >
                                  {currentFile}
                                </span>
                                <span>
                                  {fileProgress.completed}/{fileProgress.total} 文件
                                </span>
                              </div>
                            </div>
                          ) : null}

                          {errorMsg && errorRepoId === item.id ? (
                            <div
                              className="flex items-center gap-1 text-sm text-red-500"
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
