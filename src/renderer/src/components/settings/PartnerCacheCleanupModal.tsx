import { normalizeUserFacingError } from '../../utils/userFacingError'
import { t } from '../../i18n'
import { useEffect, useMemo, useState } from 'react'
import { App, Checkbox, DatePicker, Modal, Select, Spin, Tooltip } from 'antd'
import FileIcon from '../FileIcon'
import PartnerAvatar from '../workbench/PartnerAvatar'
import { HiOutlineUserGroup } from 'react-icons/hi2'
import dayjs from 'dayjs'
import {
  PARTNER_CACHE_CATEGORIES,
  type PartnerCacheCategory,
  type PartnerCachePreview,
  type PartnerCacheRequest
} from '../../../../shared/partnerCache'
import type { PartnerListItem } from '../../../../shared/types'
import { settingsSelectors } from '../../testing/selectors'
import { NativeConfirmDialog } from '../NativeConfirmDialog'

const descriptions: Record<PartnerCacheCategory, { title: string; description: string }> = {
  scripts: {
    title: t(($) => $.settings.temporaryScripts),
    description: t(($) => $.settings.temporaryScriptsWrittenByAiWhilePerformingTasks)
  },
  toolresult: {
    title: t(($) => $.settings.toolResults),
    description: t(($) => $.settings.fullTextSavedWhenToolOutputIsTooLong)
  },
  assets: {
    title: t(($) => $.settings.attachmentsAndTemporaryAssets),
    description: t(
      ($) => $.settings.pastedAttachmentsImageCachesDocumentRenderingsAndWebpageScreenshots
    )
  },
  'file-changes': {
    title: t(($) => $.settings.fileChangeHistory),
    description: t(($) => $.settings.originalBackupsAndDiffPreviewsRevertingIsUnavailableAfter)
  }
}

const sizeText = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export default function PartnerCacheCleanupModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const { message } = App.useApp()
  const [partners, setPartners] = useState<PartnerListItem[]>([])
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null)
  const [categories, setCategories] = useState<PartnerCacheCategory[]>([
    ...PARTNER_CACHE_CATEGORIES
  ])
  const [date, setDate] = useState(() => dayjs().startOf('day'))
  const [preview, setPreview] = useState<PartnerCachePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingPartners, setLoadingPartners] = useState(false)
  const [partnerError, setPartnerError] = useState<string | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [revision, setRevision] = useState(0)
  const [confirmation, setConfirmation] = useState<{
    message: string
    request: PartnerCacheRequest
  } | null>(null)

  useEffect(() => {
    if (!open) {
      setConfirmation(null)
      return
    }
    let cancelled = false
    setDate(dayjs().startOf('day'))
    setCategories([...PARTNER_CACHE_CATEGORIES])
    setPreview(null)
    setPartnerError(null)
    setLoadingPartners(true)
    void Promise.all([window.api.partnerList(), window.api.workbenchUiStateGet()])
      .then(([items, ui]) => {
        if (cancelled) return
        setPartners(items)
        setSelectedPartner((previous) =>
          previous === 'all' || items.some((item) => item.id === previous)
            ? previous
            : items.find((item) => item.id === ui.state.activeViewKey)?.id || items[0]?.id || null
        )
      })
      .catch((error) => {
        if (!cancelled) {
          setPartners([])
          setPartnerError(
            normalizeUserFacingError(
              error instanceof Error ? error.message : error,
              t(($) => $.settings.couldNotLoadPartners)
            )
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPartners(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const partnerIds = useMemo(
    () =>
      selectedPartner === 'all'
        ? partners.map((item) => item.id)
        : selectedPartner
          ? [selectedPartner]
          : [],
    [selectedPartner, partners]
  )
  const before = date.startOf('day').valueOf()
  useEffect(() => {
    if (!open || !partnerIds.length) {
      setPreview(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setPreview(null)
    void window.api
      .partnerCachePreview({ partnerIds, categories: [...PARTNER_CACHE_CATEGORIES], before })
      .then((result) => {
        if (!cancelled) setPreview(result)
      })
      .catch((error) => {
        if (!cancelled)
          setPreview({
            success: false,
            totals: [],
            rows: [],
            error:
              error instanceof Error
                ? normalizeUserFacingError(error.message)
                : t(($) => $.settings.couldNotLoadCacheData)
          })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, partnerIds, before, revision])

  const rows = (preview?.rows || []).filter((row) => categories.includes(row.category))
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0)
  const totalCount = rows.reduce((sum, row) => sum + row.count, 0)
  const busy = partners.some((item) => partnerIds.includes(item.id) && item.isRunning)
  const isLoading =
    loadingPartners || loading || (partnerIds.length > 0 && preview === null && !partnerError)
  const canClean = totalCount > 0 && !busy && !isLoading && !cleaning && preview?.success
  const errorText =
    partnerError ||
    (preview?.success === false
      ? normalizeUserFacingError(
          preview.error,
          t(($) => $.settings.couldNotLoadCacheData)
        )
      : null)
  const selectedTotals = (preview?.totals || []).filter((item) =>
    categories.includes(item.category)
  )
  const skippedCount = selectedTotals.reduce((sum, item) => sum + item.skippedCount, 0)
  const hasCache = selectedTotals.some((item) => item.count > 0 || item.bytes > 0)
  const emptyText = isLoading
    ? t(($) => $.settings.cacheCalculating)
    : errorText ||
      (!partners.length
        ? t(($) => $.common.noPartnersYet)
        : !categories.length
          ? t(($) => $.settings.cacheNothingSelected)
          : hasCache
            ? skippedCount
              ? t(($) => $.settings.cacheProtectedOnly)
              : t(($) => $.settings.cacheNoMatchingData)
            : t(($) => $.settings.cacheNoData))
  const selectDate = (value: dayjs.Dayjs): void => {
    const next = value.startOf('day')
    if (next.valueOf() === before) return
    setPreview(null)
    setDate(next)
  }
  const renderPartner = (value: string): React.JSX.Element => {
    const partner = partners.find((item) => item.id === value)
    return (
      <div className="flex min-w-0 items-center gap-2">
        {partner ? (
          <PartnerAvatar
            shape={partner.avatar_shape}
            color={partner.avatar_color}
            size={24}
            animationSeed={partner.id}
            animated
            title={partner.name}
          />
        ) : (
          <HiOutlineUserGroup className="h-6 w-6 shrink-0 text-[#787774]" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {partner?.name || t(($) => $.settings.allPartners)}
        </span>
        {partner?.isRunning && (
          <span className="shrink-0 text-[12px] opacity-70">{t(($) => $.settings.running)}</span>
        )}
      </div>
    )
  }

  const openDirectory = async (category: PartnerCacheCategory): Promise<void> => {
    if (!selectedPartner || selectedPartner === 'all') return
    try {
      const result = await window.api.partnerCacheOpenDirectory({
        partnerId: selectedPartner,
        category
      })
      if (!result.success)
        void message.error(
          normalizeUserFacingError(result.error, '') ||
            t(($) => $.settings.couldNotOpenTheDirectory)
        )
    } catch (error) {
      void message.error(
        error instanceof Error
          ? normalizeUserFacingError(error.message)
          : t(($) => $.settings.couldNotOpenTheDirectory)
      )
    }
  }

  const confirmCleanup = (): void => {
    if (!canClean) return
    const name =
      selectedPartner === 'all'
        ? t(($) => $.settings.allPartners)
        : partners.find((item) => item.id === selectedPartner)?.name || t(($) => $.common.partner)
    setConfirmation({
      message: t(($) => $.settings.permanentlyDeleteSelectedDataForBeforeFreeingAboutThis, {
        value1: name,
        value2: date.format('YYYY-MM-DD 00:00'),
        value3: sizeText(totalBytes)
      }),
      request: { partnerIds: [...partnerIds], categories: [...categories], before }
    })
  }

  const cleanup = async (): Promise<string | void> => {
    if (!confirmation) return
    setCleaning(true)
    try {
      const result = await window.api.partnerCacheCleanup(confirmation.request)
      if (!result.success)
        return (
          (normalizeUserFacingError(result.error, '') || t(($) => $.settings.cleanupFailed)) +
          (result.freedBytes
            ? t(($) => $.settings.freed, { value1: sizeText(result.freedBytes) })
            : '')
        )
      setConfirmation(null)
      void message.success(
        t(($) => $.settings.cleanedUpItemsAndFreed, {
          value1: result.deletedCount,
          value2: sizeText(result.freedBytes)
        })
      )
    } catch (error) {
      return error instanceof Error
        ? normalizeUserFacingError(error.message)
        : t(($) => $.settings.cleanupFailed)
    } finally {
      setCleaning(false)
      setRevision((value) => value + 1)
      void window.api.partnerList().then(setPartners)
    }
  }

  return (
    <>
      <Modal
        open={open}
        title={t(($) => $.settings.cleanUpPartnerCache)}
        width={680}
        centered
        className="nc-cache-cleanup-modal"
        modalRender={(node) => <div data-testid={settingsSelectors.cacheCleanupModal}>{node}</div>}
        onCancel={() => {
          if (!cleaning) onClose()
        }}
        maskClosable={false}
        closable={!cleaning}
        keyboard={!cleaning}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EEEEEC] pt-3 text-left text-[13px] text-[#37352F]">
            <div className="min-w-0" data-testid={settingsSelectors.cacheCleanupSummary}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span>{t(($) => $.settings.estimatedSpaceToFree)}</span>
                <span className="font-medium tabular-nums">
                  {isLoading
                    ? t(($) => $.settings.cacheCalculating)
                    : errorText
                      ? '—'
                      : sizeText(totalBytes)}
                </span>
              </div>
              <div className="mt-0.5 text-[12px] text-[#787774]">
                {isLoading || errorText
                  ? t(($) => $.settings.cacheCutoffBefore, { value1: date.format('YYYY-MM-DD') })
                  : t(($) => $.settings.cacheCutoffSummary, {
                      value1: date.format('YYYY-MM-DD'),
                      count: totalCount
                    })}
              </div>
            </div>
            <button
              type="button"
              disabled={!canClean}
              onClick={confirmCleanup}
              data-testid={settingsSelectors.cacheCleanupConfirm}
              className="shrink-0 rounded bg-[#F8EBE9] px-4 py-2 text-[13px] text-[#B3261E] hover:bg-[#F3DDD9] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {cleaning
                ? t(($) => $.settings.cleaningUp)
                : t(($) => $.settings.cleanUpSelectedData)}
            </button>
          </div>
        }
        destroyOnClose
      >
        <div className="nc-cache-cleanup-content text-[13px] text-[#37352F]">
          <div className="shrink-0">
            <label className="mb-1.5 block font-medium">{t(($) => $.common.partner)}</label>
            <Select
              value={selectedPartner}
              onChange={(value) => {
                setPreview(null)
                setSelectedPartner(value)
              }}
              className="w-full"
              disabled={cleaning || loadingPartners}
              loading={loadingPartners}
              placeholder={t(($) => $.common.selectPartner)}
              data-testid={settingsSelectors.cachePartnerSelect}
              optionRender={(option) => renderPartner(String(option.value))}
              labelRender={({ value }) => renderPartner(String(value))}
              options={[
                ...partners.map((item) => ({ value: item.id, label: item.name })),
                ...(partners.length > 1
                  ? [{ value: 'all', label: t(($) => $.settings.allPartners) }]
                  : [])
              ]}
            />
            <div className="mb-0.5 mt-3 flex items-center justify-between gap-3">
              <span className="font-medium">{t(($) => $.settings.contentToCleanUp)}</span>
              <span className="pr-10 text-[12px] text-[#787774]">
                {t(($) => $.settings.cacheTotalUsage)}
              </span>
            </div>
            {PARTNER_CACHE_CATEGORIES.map((category) => {
              const info = descriptions[category]
              const bytes = preview?.totals.find((item) => item.category === category)?.bytes || 0
              return (
                <div
                  key={category}
                  className="flex items-center gap-2 border-b border-[#EEEEEC] py-2"
                >
                  <Checkbox
                    className="min-w-0 flex-1"
                    checked={categories.includes(category)}
                    disabled={cleaning}
                    data-testid={`${settingsSelectors.cacheCategoryPrefix}-${category}`}
                    onChange={(event) =>
                      setCategories((previous) =>
                        event.target.checked
                          ? [...previous, category]
                          : previous.filter((value) => value !== category)
                      )
                    }
                  >
                    <div className="font-medium leading-5">
                      {info.title}
                      <span className="ml-2 font-mono text-[11px] font-normal text-[#787774]">
                        {category}
                      </span>
                    </div>
                    <div className="text-[12px] font-normal leading-[18px] text-[#787774]">
                      {info.description}
                    </div>
                  </Checkbox>
                  <span
                    className="shrink-0 text-[12px] tabular-nums text-[#787774]"
                    data-testid={`${settingsSelectors.cacheCategorySizePrefix}-${category}`}
                  >
                    {isLoading
                      ? t(($) => $.settings.cacheCalculating)
                      : errorText || !selectedPartner
                        ? '—'
                        : sizeText(bytes)}
                  </span>
                  <Tooltip
                    title={
                      selectedPartner === 'all'
                        ? t(($) => $.settings.selectAPartnerBeforeOpeningItsDirectory)
                        : t(($) => $.settings.openFolder, { value1: info.title })
                    }
                  >
                    <button
                      type="button"
                      aria-label={t(($) => $.settings.openFolder, { value1: info.title })}
                      disabled={!selectedPartner || selectedPartner === 'all' || cleaning}
                      data-testid={`${settingsSelectors.cacheOpenPrefix}-${category}`}
                      onClick={() => void openDirectory(category)}
                      className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-[#787774] hover:bg-[#F4F4F2] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <FileIcon kind="directory" expanded className="h-4 w-4" />
                    </button>
                  </Tooltip>
                </div>
              )
            })}
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[180px] flex-1">
                <label className="mb-1.5 block font-medium">
                  {t(($) => $.settings.cleanUpDataBeforeThisDate)}
                </label>
                <DatePicker
                  value={date}
                  allowClear={false}
                  onChange={(value) => {
                    if (value) selectDate(value)
                  }}
                  disabled={cleaning}
                  disabledDate={(value) =>
                    value.isAfter(dayjs().add(1, 'day').startOf('day'), 'day')
                  }
                  className="w-full"
                  data-testid={settingsSelectors.cacheCutoffDate}
                />
              </div>
              {[7, 30].map((days) => (
                <button
                  key={days}
                  type="button"
                  disabled={cleaning}
                  data-testid={`${settingsSelectors.cacheQuickDatePrefix}-${days}`}
                  onClick={() => selectDate(dayjs().subtract(days, 'day'))}
                  className="h-[34px] rounded border border-[#E6E6E3] px-3 text-[12px] hover:bg-[#F4F4F2] disabled:opacity-40"
                >
                  {t(($) => $.settings.cacheDaysAgo, { count: days })}
                </button>
              ))}
            </div>
            <div className="mb-2 mt-4 flex justify-between gap-3">
              <span className="font-medium">{t(($) => $.settings.dataToCleanUp)}</span>
              <span className="text-[12px] text-[#787774]">
                {t(($) => $.settings.byDateOldestFirst)}
              </span>
            </div>
          </div>
          <div
            className="nc-cache-cleanup-list"
            data-testid={settingsSelectors.cachePreviewList}
            aria-busy={isLoading}
          >
            <Spin spinning={isLoading}>
              <table
                className="w-full text-[12px]"
                data-testid={settingsSelectors.cachePreviewTable}
              >
                <thead className="text-[#787774]">
                  <tr>
                    {[
                      t(($) => $.settings.date),
                      t(($) => $.settings.content),
                      t(($) => $.settings.count),
                      t(($) => $.settings.size)
                    ].map((label, index) => (
                      <th
                        key={label}
                        className={`sticky top-0 z-10 bg-[#F4F4F2] px-2 py-2 font-normal ${index < 2 ? 'text-left' : 'text-right'}`}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.day}-${row.category}`} className="border-b border-[#EEEEEC]">
                      <td className="whitespace-nowrap px-2 py-2">
                        {dayjs(row.day).format('YYYY-MM-DD')}
                      </td>
                      <td className="px-2 py-2">{descriptions[row.category].title}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {t(($) => $.settings.cacheItemCount, { count: row.count })}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                        {sizeText(row.bytes)}
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td
                        colSpan={4}
                        className={`px-3 py-5 text-center ${errorText ? 'text-[#B3261E]' : 'text-[#787774]'}`}
                        role={errorText ? 'alert' : undefined}
                      >
                        {emptyText}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Spin>
          </div>
          <div className="shrink-0">
            <p className="mb-0 mt-2 text-[12px] leading-[18px] text-[#787774]">
              {t(($) => $.settings.cleanUpSelectedDirectoriesBeforeTheCutoffDatePartners)}
            </p>
            {busy && (
              <p className="mb-0 mt-1 text-[12px] text-[#B3261E]">
                {t(($) => $.settings.theSelectedPartnerIsRunningWaitForItTo)}
              </p>
            )}
            {!!skippedCount && (
              <p className="mb-0 mt-1 text-[12px] text-[#787774]">
                {t(($) => $.settings.cacheSkippedItems, { count: skippedCount })}
              </p>
            )}
          </div>
        </div>
      </Modal>
      <NativeConfirmDialog
        open={open && Boolean(confirmation)}
        title={t(($) => $.settings.cleanUpThisCachedData)}
        message={confirmation?.message || ''}
        confirmText={t(($) => $.settings.cleanUp)}
        danger
        onConfirm={cleanup}
        onCancel={() => setConfirmation(null)}
        onError={(error) => void message.error(error)}
      />
    </>
  )
}
