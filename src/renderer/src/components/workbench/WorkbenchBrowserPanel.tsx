import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Dropdown, Tooltip, type MenuProps } from 'antd'
import {
  HiArrowLeft,
  HiArrowPath,
  HiArrowRight,
  HiArrowTopRightOnSquare,
  HiEllipsisVertical,
  HiGlobeAlt,
  HiMinus,
  HiPlus,
  HiXMark
} from 'react-icons/hi2'
import type { BrowserTabState } from '../../../../shared/types'
import { workbenchSelectors } from '../../testing/selectors'

type WorkbenchBrowserPanelProps = {
  tabId: string
  onStateChange?: (state: BrowserTabState) => void
}

const createEmptyState = (tabId: string): BrowserTabState => ({
  id: tabId,
  ownerId: '',
  url: '',
  zoomPercent: 100,
  canGoBack: false,
  canGoForward: false,
  isLoading: false
})

const notifyBounds = (tabId: string, element: HTMLDivElement | null): void => {
  if (!element) return
  const rect = element.getBoundingClientRect()
  void window.api.browserPanelSetBounds({
    tabId,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    visible: rect.width > 0 && rect.height > 0
  })
}

const WorkbenchBrowserPanel: React.FC<WorkbenchBrowserPanelProps> = ({ tabId, onStateChange }) => {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<BrowserTabState>(() => createEmptyState(tabId))
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')

  const applyState = useCallback(
    (next: BrowserTabState): void => {
      if (next.id !== tabId) return
      setState(next)
      setAddress(next.url)
      onStateChange?.(next)
    },
    [onStateChange, tabId]
  )

  useEffect(() => {
    const element = viewportRef.current
    notifyBounds(tabId, element)
    void window.api.browserTabActivate({ tabId })
    void window.api.browserPanelShow({ tabId })
    void window.api.browserPanelStateGet({ tabId }).then((response) => {
      if (response.success && response.state) applyState(response.state)
    })
    const unsubscribe = window.api.onBrowserPanelStateChange(applyState)
    const observer = new ResizeObserver(() => notifyBounds(tabId, element))
    if (element) observer.observe(element)
    const handleWindowChange = (): void => notifyBounds(tabId, element)
    window.addEventListener('resize', handleWindowChange)
    window.addEventListener('scroll', handleWindowChange, true)
    return () => {
      observer.disconnect()
      unsubscribe()
      window.removeEventListener('resize', handleWindowChange)
      window.removeEventListener('scroll', handleWindowChange, true)
      void window.api.browserPanelHide()
    }
  }, [applyState, tabId])

  const runStateAction = async (
    action: () => Promise<{ success: boolean; state?: BrowserTabState; error?: string }>
  ): Promise<void> => {
    const response = await action()
    if (response.success && response.state) applyState(response.state)
    if (!response.success) setError(response.error || '浏览器操作失败')
  }

  const navigate = async (): Promise<void> => {
    const url = address.trim()
    if (!url) return
    setError('')
    await runStateAction(() => window.api.browserTabNavigate({ tabId, url }))
  }

  const menuItems: MenuProps['items'] = [
    {
      key: 'zoom-out',
      icon: <HiMinus className="h-4 w-4" />,
      label: `缩小（${state.zoomPercent}%）`,
      onClick: () => void runStateAction(() => window.api.browserPanelZoomOut({ tabId }))
    },
    {
      key: 'zoom-reset',
      label: '恢复 100%',
      onClick: () => void runStateAction(() => window.api.browserPanelZoomReset({ tabId }))
    },
    {
      key: 'zoom-in',
      icon: <HiPlus className="h-4 w-4" />,
      label: '放大',
      onClick: () => void runStateAction(() => window.api.browserPanelZoomIn({ tabId }))
    },
    { type: 'divider' },
    {
      key: 'external',
      icon: <HiArrowTopRightOnSquare className="h-4 w-4" />,
      label: '在系统浏览器中打开',
      disabled: !state.url,
      onClick: () => void window.api.browserPanelOpenExternal({ tabId })
    }
  ]

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-white"
      data-testid={workbenchSelectors.browserPanel}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[#EEEEEC] px-2">
        <Tooltip title="后退">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#787774] hover:bg-[#F4F4F2] disabled:text-[#C9C7C2]"
            disabled={!state.canGoBack}
            aria-label="后退"
            onClick={() => void runStateAction(() => window.api.browserTabBack({ tabId }))}
          >
            <HiArrowLeft className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip title="前进">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#787774] hover:bg-[#F4F4F2] disabled:text-[#C9C7C2]"
            disabled={!state.canGoForward}
            aria-label="前进"
            onClick={() => void runStateAction(() => window.api.browserTabForward({ tabId }))}
          >
            <HiArrowRight className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip title={state.isLoading ? '停止' : '刷新'}>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#787774] hover:bg-[#F4F4F2] disabled:text-[#C9C7C2]"
            disabled={!state.url}
            aria-label={state.isLoading ? '停止加载' : '刷新'}
            onClick={() =>
              void (state.isLoading
                ? window.api.browserPanelStop({ tabId })
                : window.api.browserPanelReload({ tabId }))
            }
          >
            {state.isLoading ? (
              <HiXMark className="h-4 w-4" />
            ) : (
              <HiArrowPath className="h-4 w-4" />
            )}
          </button>
        </Tooltip>
        <form
          className="mx-1 min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            void navigate()
          }}
        >
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            placeholder="输入 URL"
            aria-label="浏览器地址"
            autoFocus={!state.url}
            className="h-7 w-full rounded-[7px] border border-transparent bg-[#F7F7F5] px-3 text-center text-[13px] text-[#37352F] outline-none placeholder:text-[#9B9A97] focus:border-[#E0DFDC] focus:bg-white focus:text-left"
          />
        </form>
        <Dropdown
          menu={{ items: menuItems }}
          trigger={['click']}
          placement="bottomRight"
          onOpenChange={(open) => void window.api.browserPanelSetOccluded(open)}
        >
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#787774] hover:bg-[#F4F4F2]"
            aria-label="更多浏览器操作"
          >
            <HiEllipsisVertical className="h-4 w-4" />
          </button>
        </Dropdown>
      </div>
      {error ? (
        <div className="shrink-0 border-b border-[#E7CAC6] px-3 py-1.5 text-xs text-[#B3261E]">
          {error}
        </div>
      ) : null}
      <div
        ref={viewportRef}
        className="relative min-h-0 flex-1 bg-white"
        data-testid={workbenchSelectors.browserViewport}
      >
        {!state.url ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <HiGlobeAlt className="mx-auto h-10 w-10 text-[#91918E]" />
              <div className="mt-4 text-[18px] font-semibold text-[#37352F]">开始浏览</div>
              <div className="mt-2 text-sm text-[#91918E]">在上方输入 URL 打开页面</div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default WorkbenchBrowserPanel
