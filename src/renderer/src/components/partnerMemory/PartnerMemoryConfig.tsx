import type { usePartnerMemoryConfig } from './usePartnerMemoryConfig'
import { Checkbox, Spin, Tooltip } from 'antd'
import { HiOutlineQuestionMarkCircle } from 'react-icons/hi2'
import { PARTNER_MEMORY_CATEGORIES } from '../../../../shared/partnerMemory'
import { t } from '../../i18n'
import ConfigurationFieldLabel from '../workbench/ConfigurationFieldLabel'
import { partnerMemorySelectors as selectors } from '../../testing/selectors'

export default function PartnerMemoryConfig({
  draft,
  disabled
}: {
  draft: ReturnType<typeof usePartnerMemoryConfig>
  disabled: boolean
}) {
  return (
    <section
      className="space-y-3 border-t border-[var(--notion-line)] pt-4"
      data-testid={selectors.config}
    >
      <ConfigurationFieldLabel>{t(($) => $.partnerMemory.title)}</ConfigurationFieldLabel>
      {draft.loading ? (
        <Spin size="small" />
      ) : draft.error ? (
        <p role="alert">{draft.error}</p>
      ) : (
        <div className="flex flex-wrap gap-5">
          {PARTNER_MEMORY_CATEGORIES.map((category) => (
            <span key={category} className="flex items-center gap-1.5 text-[13px]">
              <Checkbox
                checked={draft.enabled[category]}
                disabled={disabled}
                data-testid={`${selectors.configTogglePrefix}-${category}`}
                onChange={(event) =>
                  draft.setEnabled((previous) => ({
                    ...previous,
                    [category]: event.target.checked
                  }))
                }
              >
                {category === 'cooperation_preferences'
                  ? t(($) => $.partnerMemory.preferences)
                  : t(($) => $.partnerMemory.background)}
              </Checkbox>
              <Tooltip
                title={
                  category === 'cooperation_preferences'
                    ? t(($) => $.partnerMemory.preferencesHelp)
                    : t(($) => $.partnerMemory.backgroundHelp)
                }
                trigger={['hover', 'focus']}
              >
                <button
                  type="button"
                  aria-label={t(($) => $.partnerMemory.help)}
                  className="text-[var(--notion-text-faint)]"
                >
                  <HiOutlineQuestionMarkCircle className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
