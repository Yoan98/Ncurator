import { useMemo, useState } from 'react'
import { Checkbox, Input, Spin, Tooltip } from 'antd'
import { HiOutlineQuestionMarkCircle } from 'react-icons/hi2'
import { MAX_USER_SKILL_BODY_BYTES } from '../../../../shared/userSkills'
import { t } from '../../i18n'
import { userSkillsSelectors as selectors } from '../../testing/selectors'
import type { usePartnerSkillDraft } from './usePartnerSkillDraft'
import UsageRing from '../UsageRing'
import ConfigurationFieldLabel from '../workbench/ConfigurationFieldLabel'

export default function PartnerSkillPicker({
  draft,
  disabled
}: {
  draft: ReturnType<typeof usePartnerSkillDraft>
  disabled: boolean
}) {
  const [search, setSearch] = useState('')
  const percent = (bytes: number): string => {
    const value = (bytes / MAX_USER_SKILL_BODY_BYTES) * 100
    return value > 0 && value < 0.1 ? '<0.1' : String(Math.round(value * 10) / 10)
  }
  const unavailable = draft.options.some(
    (option) => draft.names.includes(option.name) && option.bodyBytes === null
  )
  const visible = useMemo(
    () =>
      draft.options.filter((option) =>
        `${option.name} ${option.description}`.toLowerCase().includes(search.trim().toLowerCase())
      ),
    [draft.options, search]
  )
  return (
    <section className="space-y-2 border-t border-[var(--notion-line)] pt-4" data-testid={selectors.partner}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[13px] text-[var(--notion-text)]">
          <ConfigurationFieldLabel>{t(($) => $.userSkills.title)}</ConfigurationFieldLabel>
          <Tooltip title={t(($) => $.userSkills.selectionHelp)} trigger={['hover', 'focus']}>
            <button
              type="button"
              className="text-[var(--notion-text-faint)]"
              aria-label={t(($) => $.userSkills.selectionHelp)}
            >
              <HiOutlineQuestionMarkCircle className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </span>
        <span
          className="flex items-center gap-2 text-[12px] text-[var(--notion-text-soft)]"
          data-testid={selectors.budget}
        >
          <span>{t(($) => $.userSkills.selectionSummary, { count: draft.names.length })}</span>
          <UsageRing
            ratio={unavailable ? null : draft.bytes / MAX_USER_SKILL_BODY_BYTES}
            label={
              unavailable
                ? t(($) => $.userSkills.incompleteUsage)
                : t(($) => $.userSkills.totalPercent, { percent: percent(draft.bytes) })
            }
            testId={selectors.budgetRing}
            tooltip={
              unavailable ? (
                t(($) => $.userSkills.incompleteUsage)
              ) : (
                <div className="space-y-1 text-xs leading-5">
                  <div className="font-medium text-[var(--notion-text)]">
                    {t(($) => $.userSkills.budgetTitle)}
                  </div>
                  <div className="text-[var(--notion-text-soft)]">
                    {t(($) => $.userSkills.budgetHelp, { used: (draft.bytes / 1024).toFixed(1) })}
                  </div>
                </div>
              )
            }
          />
        </span>
      </div>
      {draft.loading ? (
        <Spin size="small" />
      ) : draft.error ? (
        <div role="alert">{draft.error}</div>
      ) : (
        <>
          {draft.externalChanged && (
            <p role="status" className="text-xs text-[var(--notion-text-soft)]">
              {t(($) => $.userSkills.selectionChanged)}
            </p>
          )}
          {draft.options.length > 5 && (
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t(($) => $.userSkills.search)}
              aria-label={t(($) => $.userSkills.search)}
            />
          )}
          <div className="max-h-[288px] overflow-y-auto">
            {visible.length === 0 ? (
              <p className="px-3 py-4 text-[13px] text-[var(--notion-text-soft)]">
                {t(($) =>
                  draft.options.length ? $.userSkills.noSearchResults : $.userSkills.noOptions
                )}
              </p>
            ) : (
              visible.map((option) => {
                const checked = draft.names.includes(option.name)
                return (
                  <label
                    key={option.name}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-[4px] border-b border-[var(--notion-line)] px-2 py-3 hover:bg-[var(--notion-surface)] ${checked ? 'bg-[var(--notion-blue-bg)]' : ''}`}
                    data-testid={`${selectors.togglePrefix}-${option.name}`}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled || (option.bodyBytes === null && !checked)}
                      onChange={(event) =>
                        draft.setNames(
                          event.target.checked
                            ? [...draft.names, option.name]
                            : draft.names.filter((id) => id !== option.name)
                        )
                      }
                    />
                    <span className="min-w-0 flex-1 text-[13px]">
                      <span
                        className="line-clamp-2 break-words text-[var(--notion-text)] [overflow-wrap:anywhere]"
                        title={option.name}
                      >
                        {option.name}
                      </span>
                      <span
                        className="mt-0.5 line-clamp-2 break-words text-[12px] text-[var(--notion-text-soft)] [overflow-wrap:anywhere]"
                        title={option.description}
                      >
                        {option.description}
                      </span>
                      {option.bodyBytes === null && (
                        <span className="text-[12px] text-[var(--notion-red)]">
                          {t(($) => $.userSkills.unavailableOption)}
                        </span>
                      )}
                    </span>
                    <span
                      className="shrink-0 pt-0.5 text-[12px] tabular-nums text-[var(--notion-text-soft)]"
                      data-testid={`${selectors.percentPrefix}-${option.name}`}
                      aria-label={
                        option.bodyBytes === null
                          ? t(($) => $.userSkills.unavailableOption)
                          : t(($) => $.userSkills.itemPercent, {
                              percent: percent(option.bodyBytes)
                            })
                      }
                    >
                      {option.bodyBytes === null ? '—' : `${percent(option.bodyBytes)}%`}
                    </span>
                  </label>
                )
              })
            )}
          </div>
          {draft.overBudget && (
            <p role="alert" className="text-[12px] text-[var(--notion-red)]">
              {t(($) => $.userSkills.overBudget)}
            </p>
          )}
          {!draft.overBudget && draft.bytes >= MAX_USER_SKILL_BODY_BYTES * 0.8 && (
            <p
              role="status"
              className="rounded-[6px] bg-[var(--notion-warning-bg-soft)] px-3 py-2 text-[12px] text-[var(--notion-warning-text-soft)]"
            >
              {t(($) => $.userSkills.nearBudget)}
            </p>
          )}
          {unavailable && (
            <p role="alert" className="text-[12px] text-[var(--notion-red)]">
              {t(($) => $.userSkills.incompleteUsage)}
            </p>
          )}
        </>
      )}
    </section>
  )
}
