import React from 'react'
import { Button } from 'antd'
import { HiOutlineExclamationCircle } from 'react-icons/hi2'
import type { EmbeddingIndexSnapshot } from '../../../../shared/embeddingModels'
import { vectorSelectors } from '../../testing/selectors'
import { t } from '../../i18n'

const EmbeddingIndexNotice: React.FC<{
  index: EmbeddingIndexSnapshot
  onNavigate?: () => void
  restoreName?: string
  onRestore?: () => void
  filesComplete?: boolean
  disabled?: boolean
}> = ({ index, onNavigate, restoreName, onRestore, filesComplete = false, disabled }) => {
  if (index.staleFileCount + index.staleWebCount === 0) return null
  return (
    <div
      role="status"
      className="mt-4 flex shrink-0 gap-2.5 rounded-[8px] bg-[#FBF3DB] p-4 text-[#37352F]"
      data-testid={vectorSelectors.staleNotice}
    >
      <HiOutlineExclamationCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#8B6521]" />
      <div className="min-w-0">
        <div className="text-[13px] font-medium">
          {index.running
            ? t(($) => $.settings.embedding.runningTitle)
            : filesComplete
              ? t(($) => $.settings.embedding.filesComplete)
              : t(($) => $.settings.embedding.staleTitle)}
        </div>
        <div className="mt-1 text-[12px] text-[#787774]">
          {index.running
            ? t(($) => $.settings.embedding.runningDescription)
            : t(($) => $.settings.embedding.staleDescription, index)}
        </div>
        {onNavigate || onRestore ? (
          <div className="mt-3 flex flex-wrap gap-3">
            {onNavigate ? (
              <Button
                size="small"
                type={filesComplete ? 'default' : 'primary'}
                onClick={onNavigate}
                disabled={disabled}
                data-testid={vectorSelectors.goIndex}
              >
                {filesComplete
                  ? t(($) => $.settings.embedding.goWebIndex)
                  : t(($) => $.settings.embedding.goIndex)}
              </Button>
            ) : null}
            {onRestore && restoreName && !index.running ? (
              <Button
                size="small"
                type="link"
                className="!p-0 !text-[#37352F]"
                disabled={disabled}
                onClick={onRestore}
                data-testid={vectorSelectors.restoreModel}
              >
                {t(($) => $.settings.embedding.restoreModel, { name: restoreName })}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default EmbeddingIndexNotice
