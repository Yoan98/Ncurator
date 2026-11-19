import { t, getProductName } from '../i18n'
import React, { useEffect, useRef } from 'react'
import { RiArrowRightUpLine, RiDownloadCloud2Line, RiRefreshLine } from 'react-icons/ri'

import type { AppStartupStatus } from '../../../shared/types'
import { useAppUpdate } from '../contexts/AppUpdateContext'
import { workbenchSelectors } from '../testing/selectors'

type UpdateRequiredStatus = Extract<AppStartupStatus, { mode: 'update_required' }>

const UpdateRequiredPage: React.FC<{ startupStatus: UpdateRequiredStatus }> = ({
  startupStatus
}) => {
  const { snapshot, actionPending, downloadUpdate, retryUpdate, installUpdate } = useAppUpdate()
  const requestedInitialCheck = useRef(false)

  useEffect(() => {
    if (requestedInitialCheck.current || !snapshot) return
    requestedInitialCheck.current = true
    if (snapshot.status === 'idle') void retryUpdate()
  }, [retryUpdate, snapshot])

  const progress = Math.max(0, Math.min(100, Math.round(snapshot?.progressPercent || 0)))
  const status = snapshot?.status || 'idle'
  const primaryLabel =
    status === 'checking'
      ? t(($) => $.common.checkingForUpdates)
      : status === 'available'
        ? t(($) => $.common.downloadLatestVersion)
        : status === 'downloading'
          ? t(($) => $.common.downloading4, { value1: progress })
          : status === 'downloaded'
            ? t(($) => $.common.restartAndInstall)
            : status === 'error'
              ? t(($) => $.common.retry)
              : status === 'not-available'
                ? t(($) => $.common.checkAgain)
                : t(($) => $.common.checkForUpdates)
  const primaryDisabled = actionPending || status === 'checking' || status === 'downloading'
  const handlePrimaryAction = (): void => {
    if (status === 'available') void downloadUpdate()
    else if (status === 'downloaded') void installUpdate()
    else void retryUpdate()
  }

  return (
    <main
      className="nc-update-required-page relative flex h-full min-h-0 items-center justify-center overflow-hidden bg-[var(--notion-page)] px-8 py-16 text-[var(--notion-text)]"
      data-testid={workbenchSelectors.updateRequiredPage}
    >
      <div
        className="nc-update-required-titlebar-drag"
        data-testid={workbenchSelectors.updateRequiredDragRegion}
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--notion-line)]" />
      <section className="w-full max-w-[560px]" aria-labelledby="update-required-title">
        <h1 id="update-required-title" className="m-0 text-[30px] font-semibold tracking-normal">
          {t(($) => $.common.updateRequired)}
          {getProductName()}
        </h1>
        <p className="mt-3 max-w-[500px] text-[14px] leading-7 text-[var(--notion-text-soft)]">
          {t(($) => $.common.thisAppVersionDoesNotSupportTheLocalDatabase)}
        </p>

        <dl className="my-8 grid grid-cols-2 border-y border-[var(--notion-line)] py-4 text-[13px]">
          <div>
            <dt className="text-[var(--notion-text-faint)]">{t(($) => $.common.localDatabaseVersion)}</dt>
            <dd className="mt-1 font-medium text-[var(--notion-text)]">v{startupStatus.databaseVersion}</dd>
          </div>
          <div>
            <dt className="text-[var(--notion-text-faint)]">
              {t(($) => $.common.databaseVersionSupportedByThisApp)}
            </dt>
            <dd className="mt-1 font-medium text-[var(--notion-text)]">
              v{startupStatus.supportedDatabaseVersion}
            </dd>
          </div>
        </dl>

        {status === 'downloading' ? (
          <div
            className="mb-4 h-1 overflow-hidden rounded-full bg-[var(--notion-line)]"
            aria-label={t(($) => $.common.download2, { value1: progress })}
          >
            <div
              className="h-full rounded-full bg-[var(--notion-accent)] transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        ) : null}

        {status === 'error' || status === 'not-available' ? (
          <p className="mb-4 text-[13px] leading-6 text-[var(--notion-red)]" role="alert">
            {status === 'error'
              ? t(($) => $.common.couldNotCheckForUpdatesCheckYourNetworkConnection)
              : t(($) => $.common.noCompatibleVersionWasFoundInThisUpdateChannel)}
          </p>
        ) : null}

        <button
          type="button"
          className="workbench-no-drag flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-[var(--notion-accent)] px-4 text-[14px] font-medium text-[var(--notion-accent-contrast)] transition-colors hover:bg-[var(--notion-accent)] disabled:cursor-not-allowed disabled:bg-[var(--notion-line-strong)]"
          disabled={primaryDisabled}
          onClick={handlePrimaryAction}
          data-testid={workbenchSelectors.updateRequiredPrimaryButton}
        >
          {status === 'error' || status === 'not-available' ? (
            <RiRefreshLine className="h-4 w-4" aria-hidden="true" />
          ) : (
            <RiDownloadCloud2Line className="h-4 w-4" aria-hidden="true" />
          )}
          {primaryLabel}
        </button>

        <div className="mt-5 flex items-center justify-between text-[13px]">
          <a
            className="workbench-no-drag inline-flex cursor-pointer items-center gap-1 text-[var(--notion-accent-blue)] hover:text-[var(--notion-accent-blue-hover)]"
            href={startupStatus.downloadPageUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault()
              void window.api.openExternal(startupStatus.downloadPageUrl)
            }}
            data-testid={workbenchSelectors.updateRequiredDownloadPage}
          >
            {t(($) => $.common.downloadFromWebsite)}
            <RiArrowRightUpLine className="h-4 w-4" aria-hidden="true" />
          </a>
          <button
            type="button"
            className="workbench-no-drag cursor-pointer border-0 bg-transparent p-0 text-[var(--notion-text-soft)] hover:text-[var(--notion-text)]"
            onClick={() => void window.api.appQuit()}
            data-testid={workbenchSelectors.updateRequiredQuitButton}
          >
            {t(($) => $.common.quitApp)}
          </button>
        </div>
      </section>
    </main>
  )
}

export default UpdateRequiredPage
