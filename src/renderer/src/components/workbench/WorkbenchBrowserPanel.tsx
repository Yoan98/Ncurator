import React, { useEffect, useRef, useState } from 'react'
import { Button, Tooltip } from 'antd'
import {
  HiArrowPath,
  HiArrowTopRightOnSquare,
  HiArrowUturnLeft,
  HiGlobeAlt,
  HiMinus,
  HiPlus
} from 'react-icons/hi2'
import type { BrowserPanelState } from '../../../../shared/types'
import { workbenchSelectors } from '../../testing/selectors'

const notifyBounds = (element: HTMLDivElement | null): void => {
  if (!element) return
  const rect = element.getBoundingClientRect()
  void window.api.browserPanelSetBounds({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    visible: rect.width > 0 && rect.height > 0
  })
}

const WorkbenchBrowserPanel: React.FC = () => {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [browserState, setBrowserState] = useState<BrowserPanelState>({
    url: '',
    zoomPercent: 100
  })

  useEffect(() => {
    const element = viewportRef.current
    notifyBounds(element)
    void window.api.browserPanelShow()
    void window.api.browserPanelStateGet().then((response) => {
      if (response.success && response.state) {
        setBrowserState(response.state)
      }
    })
    const unsubscribeState = window.api.onBrowserPanelStateChange((state) => {
      setBrowserState(state)
    })

    const observer = new ResizeObserver(() => notifyBounds(element))
    if (element) observer.observe(element)
    const handleWindowChange = (): void => notifyBounds(element)
    window.addEventListener('resize', handleWindowChange)
    window.addEventListener('scroll', handleWindowChange, true)

    return () => {
      observer.disconnect()
      unsubscribeState()
      window.removeEventListener('resize', handleWindowChange)
      window.removeEventListener('scroll', handleWindowChange, true)
      void window.api.browserPanelHide()
    }
  }, [])

  const applyStateResponse = async (
    action: () => Promise<{ success: boolean; state?: BrowserPanelState; error?: string }>
  ): Promise<void> => {
    const response = await action()
    if (response.success && response.state) {
      setBrowserState(response.state)
    }
  }

  const displayUrl = browserState.url.trim() || '等待打开网页'

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-white"
      data-testid={workbenchSelectors.browserPanel}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#EEEEEC] px-3">
        <div className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-[#37352F]">
          <HiGlobeAlt className="h-4 w-4 shrink-0 text-[#787774]" />
          <span className="truncate" title={browserState.url || undefined}>
            {displayUrl}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip title="缩小">
            <Button
              type="text"
              size="small"
              aria-label="缩小"
              icon={<HiMinus className="h-4 w-4" />}
              onClick={() => void applyStateResponse(() => window.api.browserPanelZoomOut())}
            />
          </Tooltip>
          <Tooltip title="重置缩放">
            <Button
              type="text"
              size="small"
              aria-label="重置缩放"
              className="min-w-12 px-1 text-xs"
              icon={<HiArrowUturnLeft className="h-3.5 w-3.5" />}
              onClick={() => void applyStateResponse(() => window.api.browserPanelZoomReset())}
            >
              {browserState.zoomPercent}%
            </Button>
          </Tooltip>
          <Tooltip title="放大">
            <Button
              type="text"
              size="small"
              aria-label="放大"
              icon={<HiPlus className="h-4 w-4" />}
              onClick={() => void applyStateResponse(() => window.api.browserPanelZoomIn())}
            />
          </Tooltip>
          <Tooltip title="刷新">
            <Button
              type="text"
              size="small"
              aria-label="刷新"
              icon={<HiArrowPath className="h-4 w-4" />}
              onClick={() => void window.api.browserPanelReload()}
            />
          </Tooltip>
          <Tooltip title="系统浏览器打开">
            <Button
              type="text"
              size="small"
              aria-label="系统浏览器打开"
              icon={<HiArrowTopRightOnSquare className="h-4 w-4" />}
              onClick={() => void window.api.browserPanelOpenExternal()}
            />
          </Tooltip>
        </div>
      </div>
      <div
        ref={viewportRef}
        className="min-h-0 flex-1 bg-white"
        data-testid={workbenchSelectors.browserViewport}
      />
    </div>
  )
}

export default WorkbenchBrowserPanel
