import React, { useEffect, useState } from 'react'
import { Card, Button, Typography } from 'antd'
import { HiCloudArrowDown, HiOutlineCog6Tooth } from 'react-icons/hi2'
import { useNavigate, useLocation } from 'react-router-dom'
import { getActiveConfig } from '../services/llmService'

const { Text } = Typography

export interface NotificationItem {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  action: {
    label: string
    onClick: () => void
  }
}

const NotificationCenter: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [checkingModel, setCheckingModel] = useState(false)
  const [workbenchMode, setWorkbenchMode] = useState<'ai' | 'search'>('search')

  const isSettingsPage = location.pathname.startsWith('/settings')
  const isDownloadPage = location.pathname === '/model-download'
  const isWorkbenchPage = location.pathname === '/'

  // Helper to update notifications
  const updateNotification = (id: string, item: NotificationItem | null) => {
    setNotifications((prev) => {
      const exists = prev.some((n) => n.id === id)
      if (item) {
        return exists ? prev.map((n) => (n.id === id ? item : n)) : [...prev, item]
      } else {
        return prev.filter((n) => n.id !== id)
      }
    })
  }

  // 1. Check Model Status
  useEffect(() => {
    if (isDownloadPage) {
      updateNotification('model-missing', null)
      return
    }

    const checkModelStatus = async () => {
      if (checkingModel) return
      setCheckingModel(true)
      try {
        const status = await window.api.getEmbeddingStatus()
        if (status === 'error' || status === 'uninitialized') {
          const models = await window.api.getModels()
          const isDownloaded = models.some((m) => m.isDownloaded)
          if (!isDownloaded) {
            updateNotification('model-missing', {
              id: 'model-missing',
              title: '缺少向量模型',
              description: '搜索和对话功能依赖本地向量模型，请先下载模型文件。',
              icon: <HiCloudArrowDown className="text-xl" />,
              action: {
                label: '去下载',
                onClick: () => navigate('/model-download')
              }
            })
          } else {
            updateNotification('model-missing', null)
          }
        } else {
          updateNotification('model-missing', null)
        }
      } catch (e) {
        console.error('Failed to check model status', e)
      } finally {
        setCheckingModel(false)
      }
    }

    checkModelStatus()
  }, [location.pathname, isDownloadPage])

  // 2. Check LLM Config
  useEffect(() => {
    const handleWorkbenchMode = (event: Event) => {
      const detail =
        event instanceof CustomEvent && event.detail && typeof event.detail === 'object'
          ? event.detail
          : null
      const mode = detail && 'mode' in detail ? String(detail.mode || '').trim() : ''
      setWorkbenchMode(mode === 'ai' ? 'ai' : 'search')
    }

    window.addEventListener('workbench-mode-change', handleWorkbenchMode)
    return () => {
      window.removeEventListener('workbench-mode-change', handleWorkbenchMode)
    }
  }, [])

  useEffect(() => {
    if (isSettingsPage) {
      updateNotification('llm-config-missing', null)
      return
    }

    const checkLLMConfig = async () => {
      const config = await getActiveConfig()
      if (!config) {
        if (isWorkbenchPage && workbenchMode === 'ai') {
          updateNotification('llm-config-missing', {
            id: 'llm-config-missing',
            title: '未配置大模型 API',
            description: '智能回答和对话功能需要配置 LLM API，请先完成配置。',
            icon: <HiOutlineCog6Tooth className="text-xl" />,
            action: {
              label: '去配置',
              onClick: () => navigate('/settings/model')
            }
          })
        } else {
          updateNotification('llm-config-missing', null)
        }
      } else {
        updateNotification('llm-config-missing', null)
      }
    }

    checkLLMConfig()

    const handleCheckEvent = async () => {
      const config = await getActiveConfig()
      if (!config) {
        updateNotification('llm-config-missing', {
          id: 'llm-config-missing',
          title: '未配置大模型 API',
            description: '智能回答和对话功能需要配置 LLM API，请先完成配置。',
            icon: <HiOutlineCog6Tooth className="text-xl" />,
            action: {
              label: '去配置',
              onClick: () => navigate('/settings/model')
            }
          })
        }
    }

    window.addEventListener('check-llm-config', handleCheckEvent)
    return () => {
      window.removeEventListener('check-llm-config', handleCheckEvent)
    }
  }, [location.pathname, isSettingsPage, isWorkbenchPage, workbenchMode])

  if (notifications.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-4 items-end pointer-events-none">
      {notifications.map((item) => (
        <Card
          key={item.id}
          className="w-80 shadow-none border-[#37352F]/20 !bg-white/95 backdrop-blur-md pointer-events-auto animate-slide-in-right"
          size="small"
          actions={[
            <Button
              key="later"
              type="text"
              size="small"
              onClick={() => updateNotification(item.id, null)}
              className="text-[#9B9A97]"
            >
              稍后
            </Button>,
            <Button
              key="action"
              type="primary"
              size="small"
              icon={item.id === 'model-missing' ? <HiCloudArrowDown /> : <HiOutlineCog6Tooth />}
              onClick={() => {
                updateNotification(item.id, null)
                item.action.onClick()
              }}
              className="!bg-[#37352F] hover:!bg-[#2F3437]"
            >
              {item.action.label}
            </Button>
          ]}
        >
          <Card.Meta
            avatar={
              <div className="w-10 h-10 rounded-[8px] bg-[#F4F4F2] flex items-center justify-center text-[#37352F]">
                {item.icon}
              </div>
            }
            title={<span className="text-[#37352F]">{item.title}</span>}
            description={<Text className="text-[#787774] text-xs">{item.description}</Text>}
          />
        </Card>
      ))}
    </div>
  )
}

export default NotificationCenter
