import React, { useEffect, useRef } from 'react'
import { Button, Tooltip } from 'antd'
import { HiArrowTopRightOnSquare, HiArrowPath, HiGlobeAlt } from 'react-icons/hi2'
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

  useEffect(() => {
    const element = viewportRef.current
    notifyBounds(element)
    void window.api.browserPanelShow()

    const observer = new ResizeObserver(() => notifyBounds(element))
    if (element) observer.observe(element)
    const handleWindowChange = (): void => notifyBounds(element)
    window.addEventListener('resize', handleWindowChange)
    window.addEventListener('scroll', handleWindowChange, true)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', handleWindowChange)
      window.removeEventListener('scroll', handleWindowChange, true)
      void window.api.browserPanelHide()
    }
  }, [])

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-[#F7F7F5]"
      data-testid={workbenchSelectors.browserPanel}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#E6E4DF] px-3">
        <div className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-[#37352F]">
          <HiGlobeAlt className="h-4 w-4 shrink-0 text-[#5F5E59]" />
          <span className="truncate">内置浏览器</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
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
