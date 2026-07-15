import { Dropdown, Tooltip, type MenuProps } from 'antd'
import { HiDocumentText, HiGlobeAlt, HiPlus, HiXMark } from 'react-icons/hi2'
import type { WorkbenchResourceTab } from './types'
import { workbenchSelectors } from '../../testing/selectors'

type WorkbenchTabBarProps = {
  tabs: WorkbenchResourceTab[]
  activeTabId: string | null
  onActivateTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onAddFileTab: () => void
  onAddBrowserTab: () => void
}

const getTabIcon = (tab: WorkbenchResourceTab) =>
  tab.kind === 'browser' ? (
    <HiGlobeAlt className="h-4 w-4 shrink-0" />
  ) : (
    <HiDocumentText className="h-4 w-4 shrink-0" />
  )

const WorkbenchTabBar = ({
  tabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
  onAddFileTab,
  onAddBrowserTab
}: WorkbenchTabBarProps) => {
  const menuItems: MenuProps['items'] = [
    {
      key: 'file',
      icon: <HiDocumentText className="h-4 w-4" />,
      label: '打开文件',
      onClick: onAddFileTab
    },
    {
      key: 'browser',
      icon: <HiGlobeAlt className="h-4 w-4" />,
      label: '浏览器',
      onClick: onAddBrowserTab
    }
  ]

  return (
    <div
      className="flex h-12 shrink-0 items-center border-b border-[#EEEEEC] bg-white px-2"
      data-testid={workbenchSelectors.resourceTabBar}
    >
      <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max items-center gap-1">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId
            return (
              <Tooltip key={tab.id} title={tab.filePath || tab.title} mouseEnterDelay={0.5}>
                <div
                  className={`group flex h-9 min-w-[116px] max-w-[220px] items-center gap-2 rounded-[10px] px-3 text-left text-[13px] transition-colors ${
                    active
                      ? 'bg-[#F2F2F0] font-medium text-[#37352F]'
                      : 'text-[#787774] hover:bg-[#F7F7F5] hover:text-[#37352F]'
                  }`}
                  data-testid={`${workbenchSelectors.resourceTabPrefix}-${tab.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                  onClick={() => onActivateTab(tab.id)}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    aria-current={active ? 'page' : undefined}
                  >
                    {getTabIcon(tab)}
                    <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`关闭 ${tab.title}`}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] hover:bg-[#E6E6E3] ${
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
              </Tooltip>
            )
          })}
        </div>
      </div>
      <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
        <button
          type="button"
          className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] text-[#787774] hover:bg-[#F4F4F2] hover:text-[#37352F]"
          aria-label="新增标签页"
          data-testid={workbenchSelectors.resourceTabAddButton}
        >
          <HiPlus className="h-5 w-5" />
        </button>
      </Dropdown>
    </div>
  )
}

export default WorkbenchTabBar
