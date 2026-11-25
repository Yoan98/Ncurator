import { t } from '../../i18n'
import { useCallback, useEffect, useRef, useState, type WheelEvent } from 'react'
import { Tooltip, message } from 'antd'
import { HiXMark } from 'react-icons/hi2'
import { LuPlus } from 'react-icons/lu'
import FileIcon from '../FileIcon'
import { getFileIconKind, getFileVisualSpec } from '../../utils/fileIcons'
import type { WorkbenchResourceTab } from './types'
import { workbenchSelectors } from '../../testing/selectors'
import SidebarPanelIcon from '../SidebarPanelIcon'

type WorkbenchTabBarProps = {
  tabs: WorkbenchResourceTab[]
  activeTabId: string | null
  onActivateTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onAddFileTab: () => void
  onAddBrowserTab: () => void
  onCollapse: () => void
}

const getTabIcon = (tab: WorkbenchResourceTab) => {
  const kind =
    tab.kind === 'browser' ? 'web' : tab.filePath ? getFileIconKind(tab.filePath) : 'directory'
  return (
    <FileIcon kind={kind} className={`h-4 w-4 shrink-0 ${getFileVisualSpec(kind).iconClassName}`} />
  )
}

const WorkbenchTabBar = ({
  tabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
  onAddFileTab,
  onAddBrowserTab,
  onCollapse
}: WorkbenchTabBarProps) => {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const tabRefs = useRef(new Map<string, HTMLDivElement>())
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false })
  const [addMenuOpen, setAddMenuOpen] = useState(false)

  const updateScrollEdges = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth)
    setScrollEdges({
      left: element.scrollLeft > 1,
      right: element.scrollLeft < maxScrollLeft - 1
    })
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    updateScrollEdges()
    const observer = new ResizeObserver(updateScrollEdges)
    observer.observe(element)
    return () => observer.disconnect()
  }, [tabs, updateScrollEdges])

  useEffect(() => {
    if (!activeTabId) return
    tabRefs.current.get(activeTabId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest'
    })
    requestAnimationFrame(updateScrollEdges)
  }, [activeTabId, updateScrollEdges])

  const handleWheel = (event: WheelEvent<HTMLDivElement>): void => {
    const element = event.currentTarget
    if (element.scrollWidth <= element.clientWidth) return
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    if (!delta) return
    element.scrollLeft += delta
    updateScrollEdges()
  }

  useEffect(
    () =>
      window.api.onBrowserResourceMenuAction((action) => {
        if (action === 'file') onAddFileTab()
        if (action === 'browser') onAddBrowserTab()
      }),
    [onAddBrowserTab, onAddFileTab]
  )

  const openAddMenu = async (button: HTMLButtonElement): Promise<void> => {
    const rect = button.getBoundingClientRect()
    setAddMenuOpen(true)
    try {
      const response = await window.api.browserResourceMenuOpen({
        x: Math.max(0, rect.right - 158),
        y: rect.bottom + 4
      })
      if (!response.success)
        void message.error(response.error || t(($) => $.workbench.couldNotOpenTheNewTabMenu))
    } catch {
      void message.error(t(($) => $.workbench.couldNotOpenTheNewTabMenu))
    } finally {
      setAddMenuOpen(false)
    }
  }

  return (
    <div
      className="nc-resource-tabbar workbench-no-drag flex h-11 shrink-0 items-center bg-[var(--notion-page)] px-2"
      data-testid={workbenchSelectors.resourceTabBar}
    >
      <div className="relative min-w-0 flex-1 self-stretch">
        <div
          ref={scrollRef}
          className="h-full min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          data-testid={workbenchSelectors.resourceTabScroller}
          onScroll={updateScrollEdges}
          onWheel={handleWheel}
        >
          <div className="flex h-full min-w-full items-center gap-1">
            {tabs.map((tab) => {
              const active = tab.id === activeTabId
              const tabNode = (
                <div
                  ref={(element) => {
                    if (element) tabRefs.current.set(tab.id, element)
                    else tabRefs.current.delete(tab.id)
                  }}
                  className={`group flex h-8 min-w-[60px] max-w-[200px] flex-1 basis-0 items-center gap-1.5 overflow-hidden rounded-[8px] px-2 text-left text-[13px] transition-colors ${
                    active
                      ? 'bg-[var(--notion-surface)] font-medium text-[var(--notion-text)]'
                      : 'text-[var(--notion-text-soft)] hover:bg-[var(--notion-surface-sunken)] hover:text-[var(--notion-text)]'
                  }`}
                  data-testid={`${workbenchSelectors.resourceTabPrefix}-${tab.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                  onClick={() => onActivateTab(tab.id)}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    aria-current={active ? 'page' : undefined}
                  >
                    {getTabIcon(tab)}
                    <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={t(($) => $.workbench.close2, { value1: tab.title })}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] hover:bg-[var(--notion-line)] ${
                      active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onCloseTab(tab.id)
                    }}
                  >
                    <HiXMark className="h-4 w-4" />
                  </button>
                </div>
              )
              return (
                <Tooltip
                  key={tab.id}
                  title={tab.kind === 'browser' ? tab.title : tab.filePath || tab.title}
                  placement="bottom"
                  mouseEnterDelay={0.4}
                  align={{ offset: [0, 2] }}
                  autoAdjustOverflow={false}
                  overlayClassName="nc-tab-tooltip"
                >
                  {tabNode}
                </Tooltip>
              )
            })}
            <div
              className="nc-resource-tabbar-drag-region"
              data-testid={workbenchSelectors.resourceTabDragRegion}
              aria-hidden="true"
            />
          </div>
        </div>
        {scrollEdges.left ? (
          <div className="pointer-events-none absolute inset-y-0 left-0 w-5 bg-gradient-to-r from-white to-transparent" />
        ) : null}
        {scrollEdges.right ? (
          <div className="pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-white to-transparent" />
        ) : null}
      </div>
      <button
        type="button"
        className="nc-resource-tabbar-action ml-1"
        aria-label={t(($) => $.workbench.newTab)}
        aria-expanded={addMenuOpen}
        data-testid={workbenchSelectors.resourceTabAddButton}
        onClick={(event) => void openAddMenu(event.currentTarget)}
      >
        <LuPlus className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="nc-resource-tabbar-action ml-1"
        aria-label={t(($) => $.workbench.collapseRightSidebar)}
        title={t(($) => $.workbench.collapseRightSidebar)}
        data-testid={workbenchSelectors.contentPanelToggle}
        onClick={onCollapse}
      >
        <SidebarPanelIcon variant="collapse" />
      </button>
    </div>
  )
}

export default WorkbenchTabBar
