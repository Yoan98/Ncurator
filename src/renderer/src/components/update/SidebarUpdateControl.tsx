import { t, getProductName } from '../../i18n'
import React from 'react'
import { Tooltip } from 'antd'

import { useAppUpdate } from '../../contexts/AppUpdateContext'
import { workbenchSelectors } from '../../testing/selectors'

const SidebarUpdateControl: React.FC = () => {
  const { snapshot, actionPending, downloadUpdate, retryUpdate, installUpdate } = useAppUpdate()
  if (!snapshot) {
    return (
      <span className="nc-sidebar-version" data-testid={workbenchSelectors.appVersion}>
        v...
      </span>
    )
  }

  const progressPercent = Math.max(0, Math.min(100, Math.round(snapshot.progressPercent || 0)))
  const retryable = snapshot.status === 'error' && Boolean(snapshot.availableVersion)
  const updateVisible =
    snapshot.updateSupported &&
    (['available', 'downloading', 'downloaded'].includes(snapshot.status) || retryable)

  if (!updateVisible) {
    const version = `v${snapshot.currentVersion}`
    return (
      <Tooltip title={t(($) => $.common.currentVersion, { value1: version })} placement="top">
        <span className="nc-sidebar-version" data-testid={workbenchSelectors.appVersion}>
          {version}
        </span>
      </Tooltip>
    )
  }

  const label =
    snapshot.status === 'downloading'
      ? t(($) => $.common.updating, { value1: progressPercent })
      : snapshot.status === 'downloaded'
        ? t(($) => $.common.restartToUpdate)
        : retryable
          ? t(($) => $.common.retry)
          : t(($) => $.common.update)
  const tooltip =
    snapshot.status === 'downloading'
      ? t(($) => $.common.downloading3, {
          value1: getProductName(),
          value2: snapshot.availableVersion || ''
        })
      : snapshot.status === 'downloaded'
        ? t(($) => $.common.updateDownloadedClickToRestartAndInstall)
        : retryable
          ? snapshot.error || t(($) => $.common.downloadFailedClickToRetry)
          : t(($) => $.common.versionAvailable, { value1: snapshot.availableVersion || '' })
  const handleClick = (): void => {
    if (snapshot.status === 'downloaded') {
      void installUpdate()
    } else if (retryable) {
      void retryUpdate()
    } else if (snapshot.status === 'available') {
      void downloadUpdate()
    }
  }

  return (
    <Tooltip title={tooltip} placement="top">
      <button
        type="button"
        className={`nc-sidebar-update-button ${
          snapshot.status === 'downloaded' ? 'nc-sidebar-update-button-ready' : ''
        } ${retryable ? 'nc-sidebar-update-button-error' : ''}`}
        onClick={handleClick}
        disabled={actionPending || snapshot.status === 'downloading'}
        aria-label={label}
        data-testid={workbenchSelectors.updateButton}
      >
        {snapshot.status === 'downloading' ? (
          <span
            className="nc-sidebar-update-progress"
            style={{ width: `${String(progressPercent)}%` }}
            aria-hidden="true"
          />
        ) : null}
        <span className="relative z-[1]" data-testid={workbenchSelectors.updateButtonLabel}>
          {label}
        </span>
      </button>
    </Tooltip>
  )
}

export default SidebarUpdateControl
