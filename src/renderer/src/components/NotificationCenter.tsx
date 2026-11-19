import { useEffect, useRef, useState } from 'react'
import { Button, Card, Typography } from 'antd'
import { HiOutlineCog6Tooth } from 'react-icons/hi2'
import { useLocation, useNavigate } from 'react-router-dom'
import { useDesktopAccount } from '../contexts/DesktopAccountProvider'
import { t } from '../i18n'
import { workbenchSelectors } from '../testing/selectors'

const LLM_CONFIG_MISSING_SHOWN_STORAGE_KEY = 'workbench.llm-config-missing.shown'

const NotificationCenter = () => {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { snapshot } = useDesktopAccount()
  const canShow =
    pathname === '/' && (snapshot.status === 'signed_out' || snapshot.status === 'unsupported')
  const shownThisMount = useRef(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!canShow) {
      setOpen(false)
      return
    }
    if (shownThisMount.current) return
    try {
      if (window.localStorage.getItem(LLM_CONFIG_MISSING_SHOWN_STORAGE_KEY) === '1') return
    } catch {
      // The in-memory flag still prevents repeats while this window is open.
    }

    let disposed = false
    void window.api.llmConfigList().then(
      (configs) => {
        if (disposed || configs.length > 0) return
        shownThisMount.current = true
        try {
          window.localStorage.setItem(LLM_CONFIG_MISSING_SHOWN_STORAGE_KEY, '1')
        } catch {
          // Keep the in-memory flag if storage is unavailable.
        }
        setOpen(true)
      },
      (error) => console.error('Failed to load LLM configs', error)
    )
    return () => {
      disposed = true
    }
  }, [canShow])

  if (!canShow || !open) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 pointer-events-none">
      <Card
        data-testid={workbenchSelectors.llmConfigMissingNotification}
        className="w-80 shadow-none border-[var(--notion-accent)]/20 !bg-[var(--notion-page)]/95 backdrop-blur-md pointer-events-auto animate-slide-in-right"
        size="small"
        actions={[
          <Button
            key="later"
            type="text"
            size="small"
            onClick={() => setOpen(false)}
            className="text-[var(--notion-text-faint)]"
          >
            {t(($) => $.common.later)}
          </Button>,
          <Button
            key="configure"
            type="primary"
            size="small"
            icon={<HiOutlineCog6Tooth />}
            onClick={() => {
              setOpen(false)
              navigate('/settings/model')
            }}
            className="!bg-[var(--notion-accent)] hover:!bg-[var(--notion-accent)]"
          >
            {t(($) => $.common.configure)}
          </Button>
        ]}
      >
        <Card.Meta
          avatar={
            <div className="w-10 h-10 rounded-[8px] bg-[var(--notion-surface)] flex items-center justify-center text-[var(--notion-text)]">
              <HiOutlineCog6Tooth className="text-xl" />
            </div>
          }
          title={
            <span className="block whitespace-normal break-words text-[var(--notion-text)]">
              {t(($) => $.common.noCustomModelConfigured)}
            </span>
          }
          description={
            <Typography.Text className="text-[var(--notion-text-soft)] text-xs">
              {t(($) => $.common.customModelConfigOptional)}
            </Typography.Text>
          }
        />
      </Card>
    </div>
  )
}

export default NotificationCenter
