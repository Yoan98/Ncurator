import React from 'react'
import { Tooltip } from 'antd'
import { PRODUCT_NAME_ZH } from '../../../../shared/constants'
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
      <Tooltip title={`当前版本 ${version}`} placement="top">
        <span className="nc-sidebar-version" data-testid={workbenchSelectors.appVersion}>
          {version}
        </span>
      </Tooltip>
    )
  }

  const label =
    snapshot.status === 'downloading'
      ? `更新 ${progressPercent}%`
      : snapshot.status === 'downloaded'
        ? '重启更新'
        : retryable
          ? '重试'
          : '更新'
  const tooltip =
    snapshot.status === 'downloading'
      ? `正在下载 ${PRODUCT_NAME_ZH} ${snapshot.availableVersion || ''}`
      : snapshot.status === 'downloaded'
        ? '更新已下载，点击重启安装'
        : retryable
          ? snapshot.error || '下载失败，点击重试'
          : `发现新版本 ${snapshot.availableVersion || ''}`
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
