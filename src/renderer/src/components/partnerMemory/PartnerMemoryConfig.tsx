import type { usePartnerMemoryConfig } from './usePartnerMemoryConfig'
import { Switch, Tooltip } from 'antd'
import { HiOutlineQuestionMarkCircle } from 'react-icons/hi2'
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
    <section className="border-t border-[var(--notion-line)] pt-4" data-testid={selectors.config}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <ConfigurationFieldLabel>{t(($) => $.partnerMemory.title)}</ConfigurationFieldLabel>
          <Tooltip title={t(($) => $.partnerMemory.configHelp)} trigger={['hover', 'focus']}>
            <button
              type="button"
              aria-label={t(($) => $.partnerMemory.help)}
              className="text-[var(--notion-text-faint)]"
            >
              <HiOutlineQuestionMarkCircle className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
        <Switch
          checked={draft.enabled}
          onChange={draft.setEnabled}
          loading={draft.loading}
          disabled={disabled || Boolean(draft.error)}
          aria-label={t(($) => $.partnerMemory.title)}
          data-testid={selectors.configToggle}
        />
      </div>
      {draft.error && <p role="alert">{draft.error}</p>}
    </section>
  )
}
