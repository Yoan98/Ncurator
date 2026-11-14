import { t, getProductName } from '../../i18n'
import React from 'react'
import { Tooltip } from 'antd'
import { HiOutlineArrowDown, HiOutlineArrowDownTray, HiOutlineArrowPath } from 'react-icons/hi2'

import { useAppUpdate } from '../../contexts/AppUpdateContext'
import { workbenchSelectors } from '../../testing/selectors'

const SidebarUpdateControl: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { snapshot, actionPending, downloadUpdate, retryUpdate, installUpdate } = useAppUpdate()
  if (!snapshot) {
    if (compact) return null
    return (
      <span className="nc-sidebar-version" data-testid={workbenchSelectors.appVersion}>
        v...
      </span>
    )
  }

  const rawProgress = snapshot.progressPercent
  const progressPercent =
    typeof rawProgress === 'number' &&
    Number.isFinite(rawProgress) &&
    rawProgress >= 0 &&
    rawProgress <= 100
      ? Math.round(rawProgress)
      : undefined
  const retryable = snapshot.status === 'error' && Boolean(snapshot.availableVersion)
  const updateVisible =
    snapshot.updateSupported &&
    (['available', 'downloading', 'downloaded'].includes(snapshot.status) || retryable)

  if (!updateVisible) {
    if (compact) return null
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
      ? progressPercent === undefined
        ? t(($) => $.account.updateDownloading)
        : t(($) => $.common.updating, { value1: progressPercent })
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

  if (compact) {
    const downloading = snapshot.status === 'downloading'
    const ready = snapshot.status === 'downloaded'
    const shortLabel = downloading
      ? progressPercent === undefined
        ? t(($) => $.account.updateDownloading)
        : `${progressPercent}%`
      : ready
        ? t(($) => $.account.updateRestart)
        : label
    return (
      <Tooltip title={tooltip} placement="top">
        <button
          type="button"
          className={`nc-account-update ${ready ? 'is-ready' : ''} ${retryable ? 'is-error' : ''}`}
          onClick={handleClick}
          disabled={actionPending || downloading}
          aria-label={label}
          data-testid={workbenchSelectors.updateButton}
        >
          <span className={`nc-account-update-orb ${downloading ? 'is-progress' : ''}`}>
            {downloading ? (
              <>
                <svg
                  className={`nc-account-update-ring ${progressPercent === undefined ? 'is-unknown' : ''}`}
                  viewBox="0 0 32 32"
                  role="progressbar"
                  aria-label={label}
                  aria-valuemin={progressPercent === undefined ? undefined : 0}
                  aria-valuemax={progressPercent === undefined ? undefined : 100}
                  aria-valuenow={progressPercent}
                >
                  <circle className="nc-account-update-track" cx="16" cy="16" r="13" />
                  <circle
                    className="nc-account-update-value"
                    cx="16"
                    cy="16"
                    r="13"
                    pathLength="100"
                    strokeDasharray={`${progressPercent ?? 28} 100`}
                  />
                </svg>
                <HiOutlineArrowDown aria-hidden="true" />
              </>
            ) : ready || retryable ? (
              <HiOutlineArrowPath aria-hidden="true" />
            ) : (
              <HiOutlineArrowDownTray aria-hidden="true" />
            )}
          </span>
          <span
            className="nc-account-update-label"
            data-testid={workbenchSelectors.updateButtonLabel}
          >
            {shortLabel}
          </span>
        </button>
      </Tooltip>
    )
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
        {snapshot.status === 'downloading' && progressPercent !== undefined ? (
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
