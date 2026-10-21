import { t } from '../i18n'
import React, { useEffect, useState } from 'react'
import { Card, Button, Typography } from 'antd'
import { HiOutlineCog6Tooth } from 'react-icons/hi2'
import { useNavigate, useLocation } from 'react-router-dom'
import { getActiveConfig } from '../services/llmService'
import { workbenchSelectors } from '../testing/selectors'

const { Text } = Typography

const LLM_CONFIG_MISSING_SHOWN_STORAGE_KEY = 'workbench.llm-config-missing.shown'

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

const hasShownLlmConfigMissing = (): boolean => {
  try {
    return window.localStorage.getItem(LLM_CONFIG_MISSING_SHOWN_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const markLlmConfigMissingShown = (): void => {
  try {
    window.localStorage.setItem(LLM_CONFIG_MISSING_SHOWN_STORAGE_KEY, '1')
  } catch {
    // ignore quota / private-mode failures; in-memory dismiss still applies
  }
}

const NotificationCenter: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const isSettingsPage = location.pathname.startsWith('/settings')
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

  useEffect(() => {
    if (isSettingsPage) {
      updateNotification('llm-config-missing', null)
      return
    }

    let disposed = false
    const checkLLMConfig = async () => {
      const config = await getActiveConfig()
      if (disposed) return
      if (!config) {
        if (isWorkbenchPage && !hasShownLlmConfigMissing()) {
          markLlmConfigMissingShown()
          updateNotification('llm-config-missing', {
            id: 'llm-config-missing',
            title: t(($) => $.common.noLanguageModelApiConfigured),
            description: t(($) => $.common.aiConversationsRequireALanguageModelApiConfigureOne),
            icon: <HiOutlineCog6Tooth className="text-xl" />,
            action: {
              label: t(($) => $.common.configure),
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

    void checkLLMConfig()
    return () => {
      disposed = true
    }
  }, [location.pathname, isSettingsPage, isWorkbenchPage, navigate])

  if (notifications.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-4 items-end pointer-events-none">
      {notifications.map((item) => (
        <Card
          key={item.id}
          data-testid={
            item.id === 'llm-config-missing'
              ? workbenchSelectors.llmConfigMissingNotification
              : undefined
          }
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
              {t(($) => $.common.later)}
            </Button>,
            <Button
              key="action"
              type="primary"
              size="small"
              icon={<HiOutlineCog6Tooth />}
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
            title={
              <span className="block whitespace-normal break-words text-[#37352F]">
                {item.title}
              </span>
            }
            description={<Text className="text-[#787774] text-xs">{item.description}</Text>}
          />
        </Card>
      ))}
    </div>
  )
}

export default NotificationCenter
