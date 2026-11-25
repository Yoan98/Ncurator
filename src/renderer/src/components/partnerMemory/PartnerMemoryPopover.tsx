import { lazy, Suspense, useState } from 'react'
import { Popover, Spin, Tooltip } from 'antd'
import { LuBrain, LuCheck, LuX, LuRotateCw, LuMessageSquare, LuEraser } from 'react-icons/lu'
import { HiOutlineQuestionMarkCircle } from 'react-icons/hi2'
import { PARTNER_MEMORY_LIMITS, type PartnerMemoryCategory } from '../../../../shared/partnerMemory'
import { t } from '../../i18n'
import { partnerMemorySelectors as selectors } from '../../testing/selectors'
import { usePartnerMemory } from './usePartnerMemory'
import './partnerMemory.css'

const MemoryTextEditor = lazy(() => import('./MemoryTextEditor'))

export function ClearChatIcon() {
  return (
    <span className="relative inline-flex h-5 w-5" aria-hidden="true">
      <LuMessageSquare className="h-[18px] w-[18px]" />
      <LuEraser className="absolute -bottom-0.5 -right-0.5 h-3 w-3 bg-[var(--notion-page)]" />
    </span>
  )
}

export default function PartnerMemoryPopover({ partnerId }: { partnerId: string }) {
  const memory = usePartnerMemory(partnerId)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<PartnerMemoryCategory>('cooperation_preferences')
  const pending = memory.entries.some((entry) => entry.memory.draft !== null)
  const openChanged = (next: boolean): void => {
    if (next)
      setTab(memory.entries.find((entry) => entry.memory.draft !== null)?.memory.category ?? tab)
    else memory.flush()
    setOpen(next)
  }
  const content = (
    <div
      className="nc-memory-panel"
      data-testid={selectors.panel}
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          openChanged(false)
        }
      }}
    >
      <div className="nc-memory-tabs" role="tablist" aria-label={t(($) => $.partnerMemory.title)}>
        {memory.entries.map(({ memory: item }) => (
          <div key={item.category} className="nc-memory-tab-wrap">
            <button
              type="button"
              role="tab"
              id={`memory-tab-${item.category}`}
              aria-controls={`memory-pane-${item.category}`}
              aria-selected={tab === item.category}
              className="nc-memory-tab"
              onClick={() => setTab(item.category)}
              data-testid={`${selectors.tabPrefix}-${item.category}`}
            >
              {item.category === 'cooperation_preferences'
                ? t(($) => $.partnerMemory.preferences)
                : t(($) => $.partnerMemory.background)}
              {item.draft !== null && (
                <span
                  className="nc-memory-dot tab"
                  data-testid={`${selectors.tabDotPrefix}-${item.category}`}
                />
              )}
            </button>
            <Tooltip
              title={
                item.category === 'cooperation_preferences'
                  ? t(($) => $.partnerMemory.preferencesHelp)
                  : t(($) => $.partnerMemory.backgroundHelp)
              }
              trigger={['hover', 'focus']}
            >
              <button
                type="button"
                className="nc-memory-help"
                aria-label={t(($) => $.partnerMemory.help)}
              >
                <HiOutlineQuestionMarkCircle />
              </button>
            </Tooltip>
          </div>
        ))}
      </div>
      {memory.error && (
        <div role="alert" className="nc-memory-status error">
          {memory.error}
          <button type="button" onClick={memory.retry} aria-label={t(($) => $.partnerMemory.retry)}>
            <LuRotateCw />
          </button>
        </div>
      )}
      {!memory.entries.length && !memory.error && (
        <div className="p-6">
          <Spin size="small" />
        </div>
      )}
      {memory.entries.map((entry) => {
        const item = entry.memory
        const label =
          item.category === 'cooperation_preferences'
            ? t(($) => $.partnerMemory.preferences)
            : t(($) => $.partnerMemory.background)
        return (
          <div
            key={item.category}
            role="tabpanel"
            id={`memory-pane-${item.category}`}
            aria-labelledby={`memory-tab-${item.category}`}
            hidden={tab !== item.category}
            data-testid={`${selectors.panePrefix}-${item.category}`}
          >
            {item.draft !== null && (
              <div className="nc-memory-review" data-testid={selectors.review}>
                <button
                  type="button"
                  disabled={entry.dirty || entry.saving}
                  onClick={() => void memory.review(item.category, 'reject', item.revision)}
                  data-testid={selectors.reject}
                >
                  <LuX />
                  {t(($) => $.partnerMemory.reject)}
                </button>
                <button
                  type="button"
                  disabled={entry.dirty || entry.saving}
                  onClick={() => void memory.review(item.category, 'accept', item.revision)}
                  data-testid={selectors.accept}
                >
                  <LuCheck />
                  {t(($) => $.partnerMemory.accept)}
                </button>
              </div>
            )}
            {!item.enabled && (
              <p className="nc-memory-status">{t(($) => $.partnerMemory.disabled)}</p>
            )}
            <Suspense
              fallback={
                <div className="p-6">
                  <Spin size="small" />
                </div>
              }
            >
              <MemoryTextEditor
                text={entry.text}
                confirmed={item.confirmed}
                pending={item.draft !== null}
                active={open && tab === item.category}
                label={label}
                onChange={(text, previous) => memory.edit(item.category, text, previous)}
              />
            </Suspense>
            <div className={`nc-memory-status ${entry.error ? 'error' : ''}`}>
              <span role="status">
                {entry.error ||
                  (entry.saving || entry.dirty ? t(($) => $.partnerMemory.saving) : '')}
              </span>
              {entry.error && (
                <button
                  type="button"
                  onClick={memory.retry}
                  aria-label={t(($) => $.partnerMemory.retry)}
                >
                  <LuRotateCw />
                </button>
              )}
              <span className="ml-auto tabular-nums">
                {[...entry.text].length} / {PARTNER_MEMORY_LIMITS[item.category]}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
  return (
    <Popover
      open={open}
      onOpenChange={openChanged}
      content={content}
      trigger="click"
      placement="bottomRight"
      overlayClassName="nc-memory-popover"
      destroyTooltipOnHide={false}
    >
      <Tooltip title={open ? undefined : t(($) => $.partnerMemory.title)} placement="bottom">
        <button
          type="button"
          className="nc-topbar-action workbench-no-drag relative"
          aria-label={t(($) => $.partnerMemory.title)}
          aria-expanded={open}
          data-testid={selectors.trigger}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <LuBrain className="h-[18px] w-[18px]" />
          {pending && <span className="nc-memory-dot" data-testid={selectors.dot} />}
        </button>
      </Tooltip>
    </Popover>
  )
}
