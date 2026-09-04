import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Tooltip } from 'antd'
import {
  HiArrowLeft,
  HiArrowPath,
  HiArrowRight,
  HiArrowTopRightOnSquare,
  HiEllipsisVertical,
  HiGlobeAlt,
  HiXMark
} from 'react-icons/hi2'
import type { BrowserTabState } from '../../../../shared/types'
import { workbenchSelectors } from '../../testing/selectors'

type WorkbenchBrowserPanelProps = {
  tabId: string
  presentationEnabled: boolean
  transitionImage?: string | null
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
  transitionImage,
  onStateChange
}) => {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const boundsFrameRef = useRef<number | null>(null)
  const [state, setState] = useState<BrowserTabState>(() => createEmptyState(tabId))
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

    const flushBounds = (): void => {
      if (activePresentationId === null) return
      notifyBounds(tabId, activePresentationId, element)
    }

    const scheduleBounds = (): void => {
      if (boundsFrameRef.current !== null) return
      boundsFrameRef.current = window.requestAnimationFrame(() => {
        boundsFrameRef.current = null
        flushBounds()
      })
    }

    void window.api.browserPanelShow({ tabId }).then((response) => {
      if (!response.success || response.presentationId === undefined) return
      activePresentationId = response.presentationId
      if (cancelled) {
        void window.api.browserPanelHide({ presentationId: activePresentationId })
        return
      }
      flushBounds()
      observer = new ResizeObserver(scheduleBounds)
      if (element) observer.observe(element)
      window.addEventListener('scroll', scheduleBounds, true)
    })

    return () => {
      cancelled = true
      observer?.disconnect()
      window.removeEventListener('scroll', scheduleBounds, true)
      if (boundsFrameRef.current !== null) {
        window.cancelAnimationFrame(boundsFrameRef.current)
        boundsFrameRef.current = null
      }
      if (activePresentationId !== null) {
        void window.api.browserPanelHide({ presentationId: activePresentationId })
      }
    }
  }, [presentationEnabled, tabId])

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

  const openMenu = async (button: HTMLButtonElement): Promise<void> => {
    const rect = button.getBoundingClientRect()
    setMenuOpen(true)
    const response = await window.api.browserPanelOpenMenu({
      tabId,
      x: Math.max(0, rect.right - 278),
      y: rect.bottom + 4
    })
    setMenuOpen(false)
    if (!response.success) setError(response.error || '浏览器菜单打开失败')
  }

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
        <Tooltip title="将打开外部浏览器">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#787774] hover:bg-[#F4F4F2] disabled:text-[#C9C7C2]"
            aria-label="将打开外部浏览器"
            data-testid={workbenchSelectors.browserOpenExternal}
            disabled={!state.url && !address.trim()}
            onClick={() => {
              setError('')
              const open = async (): Promise<void> => {
                if (state.url) {
                  const response = await window.api.browserPanelOpenExternal({ tabId })
                  if (!response.success) setError(response.error || '打开外部浏览器失败')
                  return
                }
                const raw = address.trim()
                if (!raw) return
                const withProtocol = /^[a-z][a-z\d+.-]*:/iu.test(raw) ? raw : `https://${raw}`
                const response = await window.api.openExternal(withProtocol)
                if (!response.success) setError(response.error || '打开外部浏览器失败')
              }
              void open()
            }}
          >
            <HiArrowTopRightOnSquare className="h-4 w-4" />
          </button>
        </Tooltip>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#787774] hover:bg-[#F4F4F2]"
          aria-label="更多浏览器操作"
          aria-expanded={menuOpen}
          data-testid={workbenchSelectors.browserMenu}
          onClick={(event) => void openMenu(event.currentTarget)}
        >
          <HiEllipsisVertical className="h-4 w-4" />
        </button>
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
        {!presentationEnabled && transitionImage ? (
          <img
            src={transitionImage}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
        ) : !state.url ? (
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
