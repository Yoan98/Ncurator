import React, { useState, useEffect } from 'react'
import { Button, Progress, Typography, message, Tag, List } from 'antd'
import { HiCloudArrowDown, HiCheckCircle, HiExclamationCircle } from 'react-icons/hi2'
import AppPageHeader from '../components/app/AppPageHeader'
import SettingsMenuButton from '../components/settings/SettingsMenuButton'

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
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
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
        setDownloadProgress(100)
        message.success('模型下载完成！')
        fetchModels() // Refresh status
      } else if (data.status === 'error') {
        setDownloadingId(null)
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
    } catch (e) {
      console.error(e)
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
    setDownloadProgress(0)
    setErrorMsg('')
    try {
      const res = await window.api.downloadModel(repoId)
      if (!res.success) {
        setDownloadingId(null)
        setErrorMsg(res.error || '启动下载失败')
      }
    } catch (e: unknown) {
      setDownloadingId(null)
      setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(251,245,242,0.95),_rgba(245,245,244,0.92)_42%,_#F5F5F4_72%)]">
      <div className="mx-auto max-w-5xl px-5 py-5 lg:px-6">
        <AppPageHeader
          icon={<HiCloudArrowDown className="h-5 w-5" />}
          title="向量模型"
          description="下载本地检索模型，为搜索和知识库能力提供向量基础。"
          actions={<SettingsMenuButton label="Setting" />}
        />

        <div className="rounded-[20px] border border-[#E5E5E4] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="border-b border-[#E5E5E4] px-5 py-4">
            <Title level={4} className="!mb-0 !text-[#1F1F1F]">
              模型列表
            </Title>
            <p className="mt-1 text-[13px] text-[#666666]">保持页面像工具页，而不是宣传块。</p>
          </div>
          <div className="px-5 py-2">
            <List
              loading={loading}
              itemLayout="horizontal"
              dataSource={models}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    item.isDownloaded ? (
                      <div className="flex items-center gap-2 text-green-600 font-medium">
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
                        className="!bg-[#D97757] hover:!bg-[#C66A4A] border-none shadow-sm"
                        disabled={!!downloadingId}
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
                        <span className="text-[16px] font-semibold text-[#1F1F1F]">{item.name}</span>
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
                          <div className="rounded-[18px] border border-[#E5E5E4] bg-[#F5F5F4] p-4">
                            <div className="mb-2 flex justify-between text-sm">
                              <span className="text-[#1F1F1F] font-medium">正在下载...</span>
                              <span className="text-[#D97757] font-medium">{downloadProgress}%</span>
                            </div>
                            <Progress
                              percent={downloadProgress}
                              strokeColor="#D97757"
                              showInfo={false}
                              className="!mb-2"
                            />
                            <div className="flex justify-between text-xs text-[#999999]">
                              <span className="truncate max-w-[200px]">{currentFile}</span>
                              <span>
                                {fileProgress.completed}/{fileProgress.total} 文件
                              </span>
                            </div>
                          </div>
                        ) : null}

                        {errorMsg && downloadingId === item.id ? (
                          <div className="flex items-center gap-1 text-sm text-red-500">
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
  )
}

export default ModelDownloadPage
