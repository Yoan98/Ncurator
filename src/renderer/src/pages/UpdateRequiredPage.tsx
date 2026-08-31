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
      ? '正在检查更新'
      : status === 'available'
        ? '下载最新版'
        : status === 'downloading'
          ? `正在下载 ${progress}%`
          : status === 'downloaded'
            ? '重启并安装'
            : status === 'error'
              ? '重试'
              : status === 'not-available'
                ? '重新检查'
                : '检查更新'
  const primaryDisabled = actionPending || status === 'checking' || status === 'downloading'
  const handlePrimaryAction = (): void => {
    if (status === 'available') void downloadUpdate()
    else if (status === 'downloaded') void installUpdate()
    else void retryUpdate()
  }

  return (
    <main
      className="relative flex h-full min-h-0 items-center justify-center overflow-hidden bg-white px-8 py-16 text-[#37352F]"
      data-testid={workbenchSelectors.updateRequiredPage}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[#EEEEEC]" />
      <section className="w-full max-w-[560px]" aria-labelledby="update-required-title">
        <div className="mb-10 flex items-center gap-3 text-[13px] font-medium tracking-[0.08em] text-[#787774]">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#F4F4F2] text-[#37352F]">
            馆
          </span>
          馆长
        </div>

        <div className="mb-7 flex h-11 w-11 items-center justify-center rounded-full bg-[#EDF3F8] text-[#2F5F8F]">
          <RiDownloadCloud2Line className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 id="update-required-title" className="m-0 text-[30px] font-semibold tracking-[-0.03em]">
          需要升级馆长
        </h1>
        <p className="mt-3 max-w-[500px] text-[14px] leading-7 text-[#787774]">
          当前应用版本早于本机数据版本。为保护数据，升级完成前不能进入工作台。
        </p>

        <dl className="my-8 grid grid-cols-2 border-y border-[#EEEEEC] py-4 text-[13px]">
          <div>
            <dt className="text-[#91918E]">本机数据版本</dt>
            <dd className="mt-1 font-medium text-[#37352F]">v{startupStatus.databaseVersion}</dd>
          </div>
          <div>
            <dt className="text-[#91918E]">当前应用支持</dt>
            <dd className="mt-1 font-medium text-[#37352F]">
              v{startupStatus.supportedDatabaseVersion}
            </dd>
          </div>
        </dl>

        {status === 'downloading' ? (
          <div
            className="mb-4 h-1 overflow-hidden rounded-full bg-[#EEEEEC]"
            aria-label={`下载 ${progress}%`}
          >
            <div
              className="h-full rounded-full bg-[#2F3437] transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        ) : null}

        {snapshot?.error ? (
          <p className="mb-4 text-[13px] leading-6 text-[#B3261E]" role="alert">
            {snapshot.error}
          </p>
        ) : null}

        <button
          type="button"
          className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-[#2F3437] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#1F2325] disabled:cursor-not-allowed disabled:bg-[#D8D8D5]"
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
            className="inline-flex cursor-pointer items-center gap-1 text-[#0B6BCB] hover:text-[#0958A5]"
            href={startupStatus.manualDownloadUrl}
            target="_blank"
            rel="noreferrer"
            data-testid={workbenchSelectors.updateRequiredManualDownload}
          >
            手动下载最新版
            <RiArrowRightUpLine className="h-4 w-4" aria-hidden="true" />
          </a>
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-[#787774] hover:text-[#37352F]"
            onClick={() => void window.api.appQuit()}
            data-testid={workbenchSelectors.updateRequiredQuitButton}
          >
            退出应用
          </button>
        </div>
      </section>
    </main>
  )
}

export default UpdateRequiredPage
