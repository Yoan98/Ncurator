import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Popover, Tooltip } from 'antd'
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
  presentationEnabled: boolean
  externallyOccluded?: boolean
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

const notifyBounds = (
  tabId: string,
  presentationId: number,
  element: HTMLDivElement | null
): void => {
  if (!element) return
  const rect = element.getBoundingClientRect()
  void window.api.browserPanelSetBounds({
    tabId,
    presentationId,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  })
}

const WorkbenchBrowserPanel: React.FC<WorkbenchBrowserPanelProps> = ({
  tabId,
  presentationEnabled,
  externallyOccluded = false,
  onStateChange
}) => {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<BrowserTabState>(() => createEmptyState(tabId))
  const [presentationId, setPresentationId] = useState<number | null>(null)
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

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
    void window.api.browserTabActivate({ tabId })
    void window.api.browserPanelStateGet({ tabId }).then((response) => {
      if (response.success && response.state) applyState(response.state)
    })
    const unsubscribe = window.api.onBrowserPanelStateChange(applyState)
    return () => {
      unsubscribe()
    }
  }, [applyState, tabId])

  useEffect(() => {
    if (!presentationEnabled) return
    const element = viewportRef.current
    let cancelled = false
    let activePresentationId: number | null = null
    let observer: ResizeObserver | null = null
    const handleWindowChange = (): void => {
      if (activePresentationId !== null) {
        notifyBounds(tabId, activePresentationId, element)
      }
    }

    void window.api.browserPanelShow({ tabId }).then((response) => {
      if (!response.success || response.presentationId === undefined) return
      activePresentationId = response.presentationId
      if (cancelled) {
        void window.api.browserPanelHide({ presentationId: activePresentationId })
        return
      }
      setPresentationId(activePresentationId)
      notifyBounds(tabId, activePresentationId, element)
      observer = new ResizeObserver(handleWindowChange)
      if (element) observer.observe(element)
      window.addEventListener('resize', handleWindowChange)
      window.addEventListener('scroll', handleWindowChange, true)
    })

    return () => {
      cancelled = true
      observer?.disconnect()
      window.removeEventListener('resize', handleWindowChange)
      window.removeEventListener('scroll', handleWindowChange, true)
      if (activePresentationId !== null) {
        void window.api.browserPanelHide({ presentationId: activePresentationId })
      }
      setPresentationId(null)
    }
  }, [presentationEnabled, tabId])

  useEffect(() => {
    if (presentationId === null) return
    void window.api.browserPanelSetOccluded({
      tabId,
      presentationId,
      occluded: externallyOccluded || menuOpen
    })
  }, [externallyOccluded, menuOpen, presentationId, tabId])

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

  const menuContent = (
    <div
      className="w-[260px] rounded-[10px] border border-[#E6E5E1] bg-white p-1.5 shadow-[0_10px_30px_rgba(15,15,15,0.12)]"
      data-testid={workbenchSelectors.browserMenu}
    >
      <div className="flex h-10 items-center justify-between gap-3 px-2">
        <span className="text-[13px] text-[#57554F]">页面缩放</span>
        <div
          className="flex h-7 items-center overflow-hidden rounded-[7px] border border-[#E0DFDC] bg-white"
          data-testid={workbenchSelectors.browserZoomControls}
        >
          <button
            type="button"
            className="flex h-full w-7 items-center justify-center text-[#787774] hover:bg-[#F4F4F2] hover:text-[#37352F]"
            aria-label="缩小页面"
            onClick={() => void runStateAction(() => window.api.browserPanelZoomOut({ tabId }))}
          >
            <HiMinus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="h-full min-w-[52px] border-x border-[#E0DFDC] px-2 text-[12px] font-medium tabular-nums text-[#57554F] hover:bg-[#F4F4F2]"
            aria-label="恢复页面缩放为 100%"
            onClick={() => void runStateAction(() => window.api.browserPanelZoomReset({ tabId }))}
          >
            {state.zoomPercent}%
          </button>
          <button
            type="button"
            className="flex h-full w-7 items-center justify-center text-[#787774] hover:bg-[#F4F4F2] hover:text-[#37352F]"
            aria-label="放大页面"
            onClick={() => void runStateAction(() => window.api.browserPanelZoomIn({ tabId }))}
          >
            <HiPlus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="my-1 h-px bg-[#EEEEEC]" />
      <button
        type="button"
        className="flex h-9 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13px] text-[#57554F] hover:bg-[#F4F4F2] disabled:text-[#C9C7C2]"
        disabled={!state.url}
        onClick={() => {
          setMenuOpen(false)
          void window.api.browserPanelOpenExternal({ tabId })
        }}
      >
        <HiArrowTopRightOnSquare className="h-4 w-4" />
        在系统浏览器中打开
      </button>
    </div>
  )

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-white"
      data-testid={workbenchSelectors.browserPanel}
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-[#EEEEEC] px-2">
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
          className="relative mx-1 min-w-0 flex-1"
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
            className="h-7 w-full rounded-[7px] border border-transparent bg-[#F7F7F5] pr-8 pl-3 text-left text-[13px] text-[#37352F] outline-none placeholder:text-[#9B9A97] focus:border-[#E0DFDC] focus:bg-white"
          />
          <Tooltip title="前往">
            <button
              type="submit"
              className="absolute top-0 right-0 flex h-7 w-7 items-center justify-center rounded-[6px] text-[#787774] hover:bg-[#ECECE9] hover:text-[#37352F] disabled:text-[#C9C7C2]"
              aria-label="前往"
              disabled={!address.trim()}
            >
              <HiArrowRight className="h-4 w-4" />
            </button>
          </Tooltip>
        </form>
        <Popover
          content={menuContent}
          trigger={['click']}
          placement="bottomRight"
          open={menuOpen}
          arrow={false}
          overlayInnerStyle={{ padding: 0, background: 'transparent', boxShadow: 'none' }}
          onOpenChange={(open) => {
            setMenuOpen(open)
          }}
        >
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#787774] hover:bg-[#F4F4F2]"
            aria-label="更多浏览器操作"
          >
            <HiEllipsisVertical className="h-4 w-4" />
          </button>
        </Popover>
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
