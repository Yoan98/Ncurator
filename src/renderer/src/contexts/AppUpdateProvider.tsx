import { t, getProductName } from '../i18n'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { App as AntdApp, Modal } from 'antd'

import type { AppUpdateSnapshot } from '../../../shared/types'
import { workbenchSelectors } from '../testing/selectors'
import { normalizeUserFacingError } from '../utils/userFacingError'
import { AppUpdateContext } from './AppUpdateContext'

const promptedVersionKey = (version: string): string => `ncurator.update.prompted.${version}`

export const AppUpdateProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { message } = AntdApp.useApp()
  const [snapshot, setSnapshot] = useState<AppUpdateSnapshot | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const [restartPromptOpen, setRestartPromptOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    window.api
      .appUpdateGetSnapshot()
      .then((nextSnapshot) => {
        if (mounted) setSnapshot(nextSnapshot)
      })
      .catch((error) => console.error('Failed to read app update snapshot', error))

    const removeListener = window.api.onAppUpdateStatus((nextSnapshot) => {
      setSnapshot(nextSnapshot)
    })
    return () => {
      mounted = false
      removeListener()
    }
  }, [])

  useEffect(() => {
    if (snapshot?.status !== 'downloaded' || !snapshot.availableVersion) return
    const storageKey = promptedVersionKey(snapshot.availableVersion)
    if (window.sessionStorage.getItem(storageKey) === '1') return
    window.sessionStorage.setItem(storageKey, '1')
    setRestartPromptOpen(true)
  }, [snapshot])

  const downloadUpdate = useCallback(async (): Promise<void> => {
    setActionPending(true)
    try {
      const response = await window.api.appUpdateDownload()
      setSnapshot(response.snapshot)
      if (!response.success) {
        message.error(
          normalizeUserFacingError(
            response.error,
            t(($) => $.common.couldNotDownloadTheUpdate)
          )
        )
      }
    } catch (error) {
      console.error('Failed to download update', error)
      message.error(t(($) => $.common.couldNotDownloadTheUpdate))
    } finally {
      setActionPending(false)
    }
  }, [message])

  const retryUpdate = useCallback(async (): Promise<void> => {
    if (snapshot?.availableVersion) {
      await downloadUpdate()
      return
    }
    setActionPending(true)
    try {
      const response = await window.api.appUpdateCheck()
      setSnapshot(response.snapshot)
      if (!response.success) {
        message.error(
          normalizeUserFacingError(
            response.error,
            t(($) => $.common.couldNotCheckForUpdates)
          )
        )
      }
    } catch (error) {
      console.error('Failed to retry update check', error)
      message.error(t(($) => $.common.couldNotCheckForUpdates))
    } finally {
      setActionPending(false)
    }
  }, [downloadUpdate, message, snapshot?.availableVersion])

  const installUpdate = useCallback(async (): Promise<void> => {
    setActionPending(true)
    try {
      const response = await window.api.appUpdateInstall()
      setSnapshot(response.snapshot)
      if (!response.success) {
        message.error(
          normalizeUserFacingError(
            response.error,
            t(($) => $.common.couldNotInstallTheUpdate)
          )
        )
      }
    } catch (error) {
      console.error('Failed to install update', error)
      message.error(t(($) => $.common.couldNotInstallTheUpdate))
    } finally {
      setActionPending(false)
    }
  }, [message])

  const value = useMemo(
    () => ({ snapshot, actionPending, downloadUpdate, retryUpdate, installUpdate }),
    [actionPending, downloadUpdate, installUpdate, retryUpdate, snapshot]
  )

  return (
    <AppUpdateContext.Provider value={value}>
      {children}
      <Modal
        open={restartPromptOpen}
        title={t(($) => $.common.updateReady)}
        okText={t(($) => $.common.restartNow)}
        cancelText={t(($) => $.common.later)}
        centered
        closable={false}
        maskClosable={false}
        confirmLoading={actionPending}
        okButtonProps={{ 'data-testid': workbenchSelectors.updateRestartNowButton }}
        cancelButtonProps={{ 'data-testid': workbenchSelectors.updateRestartLaterButton }}
        onOk={() => void installUpdate()}
        onCancel={() => setRestartPromptOpen(false)}
        data-testid={workbenchSelectors.updateRestartModal}
      >
        <p className="m-0 text-[13px] leading-6 text-[#5F5E5B]">
          {t(($) => $.common.hasBeenDownloadedRestartTheAppToFinishUpdating, {
            value1: getProductName(),
            value2: snapshot?.availableVersion || ''
          })}
        </p>
      </Modal>
    </AppUpdateContext.Provider>
  )
}
