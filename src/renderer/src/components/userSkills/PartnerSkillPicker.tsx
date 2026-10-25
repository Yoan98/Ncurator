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
    (option) => draft.ids.includes(option.id) && option.bodyBytes === null
  )
  const visible = useMemo(
    () =>
      draft.options.filter((option) =>
        `${option.name} ${option.description}`.toLowerCase().includes(search.trim().toLowerCase())
      ),
    [draft.options, search]
  )
  return (
    <section className="space-y-2 border-t border-[#EEEEEC] pt-4" data-testid={selectors.partner}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[13px] text-[#37352F]">
          <ConfigurationFieldLabel>{t(($) => $.userSkills.title)}</ConfigurationFieldLabel>
          <Tooltip title={t(($) => $.userSkills.selectionHelp)} trigger={['hover', 'focus']}>
            <button
              type="button"
              className="text-[#91918E]"
              aria-label={t(($) => $.userSkills.selectionHelp)}
            >
              <HiOutlineQuestionMarkCircle className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </span>
        <span
          className="flex items-center gap-2 text-[12px] text-[#787774]"
          data-testid={selectors.budget}
        >
          <span>{t(($) => $.userSkills.selectionSummary, { count: draft.ids.length })}</span>
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
                  <div className="font-medium text-[#37352F]">
                    {t(($) => $.userSkills.budgetTitle)}
                  </div>
                  <div className="text-[#787774]">
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
            <p role="status" className="text-xs text-[#787774]">
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
              <p className="px-3 py-4 text-[13px] text-[#787774]">
                {t(($) =>
                  draft.options.length ? $.userSkills.noSearchResults : $.userSkills.noOptions
                )}
              </p>
            ) : (
              visible.map((option) => {
                const checked = draft.ids.includes(option.id)
                return (
                  <label
                    key={option.id}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-[4px] border-b border-[#EEEEEC] px-2 py-3 hover:bg-[#F4F4F2] ${checked ? 'bg-[#EDF3F8]' : ''}`}
                    data-testid={`${selectors.togglePrefix}-${option.id}`}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled || (option.bodyBytes === null && !checked)}
                      onChange={(event) =>
                        draft.setIds(
                          event.target.checked
                            ? [...draft.ids, option.id]
                            : draft.ids.filter((id) => id !== option.id)
                        )
                      }
                    />
                    <span className="min-w-0 flex-1 text-[13px]">
                      <span className="block break-words text-[#37352F]">{option.name}</span>
                      <span className="mt-0.5 block break-words text-[12px] text-[#787774]">
                        {option.description}
                      </span>
                      {option.bodyBytes === null && (
                        <span className="text-[12px] text-[#B3261E]">
                          {t(($) => $.userSkills.unavailableOption)}
                        </span>
                      )}
                    </span>
                    <span
                      className="shrink-0 pt-0.5 text-[12px] tabular-nums text-[#787774]"
                      data-testid={`${selectors.percentPrefix}-${option.id}`}
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
            <p role="alert" className="text-[12px] text-[#B3261E]">
              {t(($) => $.userSkills.overBudget)}
            </p>
          )}
          {!draft.overBudget && draft.bytes >= MAX_USER_SKILL_BODY_BYTES * 0.8 && (
            <p
              role="status"
              className="rounded-[6px] bg-[#FFF8EB] px-3 py-2 text-[12px] text-[#936022]"
            >
              {t(($) => $.userSkills.nearBudget)}
            </p>
          )}
          {unavailable && (
            <p role="alert" className="text-[12px] text-[#B3261E]">
              {t(($) => $.userSkills.incompleteUsage)}
            </p>
          )}
        </>
      )}
    </section>
  )
}
