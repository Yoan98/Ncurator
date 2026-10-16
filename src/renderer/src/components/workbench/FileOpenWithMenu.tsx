import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Menu, Popover, type MenuProps } from 'antd'
import {
  HiArrowLeft,
  HiArrowTopRightOnSquare,
  HiCheck,
  HiChevronRight,
  HiComputerDesktop
} from 'react-icons/hi2'
import type { OpenWithApplication } from '../../../../shared/types'
import { workbenchSelectors } from '../../testing/selectors'

type Props = {
  children: ReactElement
  applications: OpenWithApplication[]
  preferredApplicationId?: string
  loading: boolean
  error: string | null
  onLoad: () => void
  onOpen: (application: OpenWithApplication) => void
  onSetPreferred: (id: string | null) => Promise<boolean>
  onReveal: () => void
}

export default function FileOpenWithMenu({
  children,
  applications,
  preferredApplicationId,
  loading,
  error,
  onLoad,
  onOpen,
  onSetPreferred,
  onReveal
}: Props): ReactElement {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState(false)
  const [saving, setSaving] = useState(false)
  const popup = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) popup.current?.querySelector<HTMLElement>('[role="menu"]')?.focus()
  }, [open, settings])
  const applicationItems: MenuProps['items'] = applications.map((application) => ({
    key: application.id,
    disabled: saving,
    icon: application.iconDataUrl ? (
      <img src={application.iconDataUrl} alt="" className="h-4 w-4 shrink-0 object-contain" />
    ) : (
      <HiArrowTopRightOnSquare className="h-4 w-4" />
    ),
    label: (
      <span
        className="flex min-w-0 items-center gap-3"
        data-testid={`${workbenchSelectors.openWithApplicationPrefix}-${application.id}`}
      >
        <span className="min-w-0 flex-1 truncate">{application.name}</span>
        {settings
          ? preferredApplicationId === application.id && (
              <HiCheck aria-label="已选择" className="h-4 w-4 shrink-0 text-[#787774]" />
            )
          : application.isDefault && (
              <span className="shrink-0 text-[11px] text-[#91918E]">默认</span>
            )}
      </span>
    )
  }))
  const applicationGroup: MenuProps['items'] = [
    {
      type: 'group',
      className: 'open-with-applications',
      children: applications.length
        ? applicationItems
        : [
            {
              key: 'empty',
              disabled: true,
              label: loading ? '正在获取可用应用…' : error || '没有可用的应用'
            }
          ]
    }
  ]
  const items: MenuProps['items'] = settings
    ? [
        {
          key: 'system',
          disabled: saving,
          icon: <HiComputerDesktop className="h-4 w-4" />,
          label: (
            <span className="flex items-center justify-between gap-3">
              使用系统设置
              {!preferredApplicationId && (
                <HiCheck aria-label="已选择" className="h-4 w-4 text-[#787774]" />
              )}
            </span>
          )
        },
        { type: 'divider' },
        ...applicationGroup
      ]
    : [
        ...applicationGroup,
        { type: 'divider' },
        {
          key: 'settings',
          disabled: !applications.length,
          label: (
            <span className="flex items-center justify-between gap-3">
              默认打开应用…
              <HiChevronRight className="h-3.5 w-3.5 text-[#91918E]" />
            </span>
          )
        },
        { key: 'reveal', label: '打开所在文件夹' }
      ]
  const choose: MenuProps['onClick'] = async ({ key }) => {
    if (saving) return
    if (settings) {
      setSaving(true)
      try {
        if (await onSetPreferred(key === 'system' ? null : key)) setSettings(false)
      } finally {
        setSaving(false)
      }
    } else if (key === 'settings') setSettings(true)
    else {
      setOpen(false)
      if (key === 'reveal') onReveal()
      else {
        const application = applications.find((item) => item.id === key)
        if (application) onOpen(application)
      }
    }
  }
  return (
    <Popover
      open={open}
      trigger={['click']}
      placement="bottomRight"
      rootClassName="workbench-open-with-menu"
      arrow={false}
      overlayInnerStyle={{ padding: 0, boxShadow: 'none', background: 'transparent' }}
      afterOpenChange={(visible) => {
        if (visible) popup.current?.querySelector<HTMLElement>('[role="menu"]')?.focus()
      }}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setSettings(false)
          if (!applications.length && !loading) onLoad()
        }
      }}
      content={
        <div
          ref={popup}
          className="open-with-popup"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              event.preventDefault()
              if (settings) setSettings(false)
              else setOpen(false)
            }
          }}
        >
          {settings && (
            <button
              type="button"
              className="open-with-back"
              onClick={() => setSettings(false)}
              aria-label="返回打开应用列表"
            >
              <HiArrowLeft className="h-4 w-4" />
              默认打开应用
            </button>
          )}
          <Menu
            key={settings ? 'settings' : 'open'}
            mode="vertical"
            selectable={false}
            defaultActiveFirst
            items={items}
            onClick={choose}
          />
        </div>
      }
    >
      {children}
    </Popover>
  )
}
