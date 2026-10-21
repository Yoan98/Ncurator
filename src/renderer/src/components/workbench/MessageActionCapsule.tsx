import { t } from '../../i18n'
import React from 'react'
import { Tooltip } from 'antd'
import { HiXMark } from 'react-icons/hi2'

export type MessageActionCapsuleProps = {
  icon: React.ReactNode
  label: string
  tooltip: string
  onAction: () => void
  dismissible?: boolean
  onDismiss?: () => void
  dismissTooltip?: string
  actionTestId?: string
  dismissTestId?: string
  labelClassName?: string
}

/** Composer 上方消息区操作胶囊：主操作 + 可选关闭。 */
const MessageActionCapsule: React.FC<MessageActionCapsuleProps> = ({
  icon,
  label,
  tooltip,
  onAction,
  dismissible = false,
  onDismiss,
  dismissTooltip = t(($) => $.workbench.dismiss),
  actionTestId,
  dismissTestId,
  labelClassName
}) => {
  return (
    <div className="nc-message-action-capsule">
      <Tooltip title={tooltip}>
        <button
          type="button"
          className="nc-message-action-capsule-action"
          data-testid={actionTestId}
          onClick={onAction}
        >
          <span className="nc-message-action-capsule-icon">{icon}</span>
          <span className={`nc-message-action-capsule-label ${labelClassName || ''}`.trim()}>
            {label}
          </span>
        </button>
      </Tooltip>
      {dismissible ? (
        <Tooltip title={dismissTooltip}>
          <button
            type="button"
            className="nc-message-action-capsule-dismiss"
            data-testid={dismissTestId}
            aria-label={dismissTooltip}
            onClick={(event) => {
              event.stopPropagation()
              onDismiss?.()
            }}
          >
            <HiXMark className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  )
}

export default MessageActionCapsule
