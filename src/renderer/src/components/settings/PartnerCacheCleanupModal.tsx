import { normalizeUserFacingError } from '../../utils/userFacingError'
import { t } from '../../i18n'
import { useEffect, useMemo, useState } from 'react'
import { App, Checkbox, DatePicker, Modal, Select, Spin, Tooltip } from 'antd'
import FileIcon from '../FileIcon'
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
  const [date, setDate] = useState(() => dayjs().subtract(30, 'day').startOf('day'))
  const [preview, setPreview] = useState<PartnerCachePreview | null>(null)
  const [loading, setLoading] = useState(false)
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
    setPreview(null)
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
        if (!cancelled)
          void message.error(
            error instanceof Error
              ? normalizeUserFacingError(error.message)
              : t(($) => $.settings.couldNotLoadPartners)
          )
      })
    return () => {
      cancelled = true
    }
  }, [open, message])

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
            rows: [],
            skippedCount: 0,
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
  const canClean = totalCount > 0 && !busy && !loading && !cleaning && preview?.success

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
        value2: date.format('YYYY-MM-DD'),
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
        styles={{ body: { maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' } }}
        modalRender={(node) => <div data-testid={settingsSelectors.cacheCleanupModal}>{node}</div>}
        onCancel={() => {
          if (!cleaning) onClose()
        }}
        maskClosable={false}
        closable={!cleaning}
        keyboard={!cleaning}
        footer={
          <div className="flex items-center justify-between gap-4 border-t border-[#EEEEEC] pt-4 text-left text-[14px] text-[#37352F]">
            <div>
              {t(($) => $.settings.estimatedSpaceToFree)}
              <span className="tabular-nums">{sizeText(totalBytes)}</span>
              <div className="mt-0.5 text-[12px] text-[#787774]">
                {date.format('YYYY-MM-DD')}
                {t(($) => $.settings.before0000)}
                {totalCount}
                {t(($) => $.settings.items)}
              </div>
            </div>
            <button
              type="button"
              disabled={!canClean}
              onClick={confirmCleanup}
              data-testid={settingsSelectors.cacheCleanupConfirm}
              className="rounded bg-[#F8EBE9] px-4 py-2 text-[13px] text-[#B3261E] hover:bg-[#F3DDD9] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {cleaning
                ? t(($) => $.settings.cleaningUp)
                : t(($) => $.settings.cleanUpSelectedData)}
            </button>
          </div>
        }
        destroyOnClose
      >
        <div className="pt-2 text-[14px] text-[#37352F]">
          <label className="mb-2 block font-medium">{t(($) => $.common.partner)}</label>
          <Select
            value={selectedPartner}
            onChange={setSelectedPartner}
            className="w-full"
            disabled={cleaning}
            placeholder={t(($) => $.common.selectPartner)}
            data-testid={settingsSelectors.cachePartnerSelect}
            options={[
              ...partners.map((item) => ({
                value: item.id,
                label: item.name + (item.isRunning ? t(($) => $.settings.running) : '')
              })),
              ...(partners.length > 1
                ? [{ value: 'all', label: t(($) => $.settings.allPartners) }]
                : [])
            ]}
          />
          <div className="mb-1 mt-5 font-medium">{t(($) => $.settings.contentToCleanUp)}</div>
          {PARTNER_CACHE_CATEGORIES.map((category) => {
            const info = descriptions[category]
            const bytes = (preview?.rows || [])
              .filter((row) => row.category === category)
              .reduce((sum, row) => sum + row.bytes, 0)
            return (
              <div
                key={category}
                className="flex items-center gap-3 border-b border-[#EEEEEC] py-3"
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
                  <div className="font-medium">
                    {info.title}
                    <span className="ml-2 font-mono text-[12px] font-normal text-[#787774]">
                      {category}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[12px] font-normal leading-5 text-[#787774]">
                    {info.description}
                  </div>
                </Checkbox>
                <span className="shrink-0 text-[12px] tabular-nums text-[#787774]">
                  {sizeText(bytes)}
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
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label className="mb-2 block font-medium">
                {t(($) => $.settings.cleanUpDataBeforeThisDate)}
              </label>
              <DatePicker
                value={date}
                allowClear={false}
                onChange={(value) => {
                  if (value) setDate(value)
                }}
                disabled={cleaning}
                disabledDate={(value) => value.isAfter(dayjs().add(1, 'day').startOf('day'), 'day')}
                className="w-full"
                data-testid={settingsSelectors.cacheCutoffDate}
              />
            </div>
            {[30, 90].map((days) => (
              <button
                key={days}
                type="button"
                disabled={cleaning}
                onClick={() => setDate(dayjs().subtract(days, 'day').startOf('day'))}
                className="h-8 rounded border border-[#E6E6E3] px-3 text-[12px] hover:bg-[#F4F4F2] disabled:opacity-40"
              >
                {days}
                {t(($) => $.settings.daysAgo)}
              </button>
            ))}
          </div>
          <div className="mb-2 mt-6 flex justify-between">
            <span className="font-medium">{t(($) => $.settings.dataToCleanUp)}</span>
            <span className="text-[12px] text-[#787774]">
              {t(($) => $.settings.byDateOldestFirst)}
            </span>
          </div>
          <Spin spinning={loading}>
            <table className="w-full text-[12px]" data-testid={settingsSelectors.cachePreviewTable}>
              <thead className="bg-[#F4F4F2] text-[#787774]">
                <tr>
                  <th className="px-2 py-2 text-left font-normal">{t(($) => $.settings.date)}</th>
                  <th className="px-2 py-2 text-left font-normal">
                    {t(($) => $.settings.content)}
                  </th>
                  <th className="px-2 py-2 text-right font-normal">{t(($) => $.settings.count)}</th>
                  <th className="px-2 py-2 text-right font-normal">{t(($) => $.settings.size)}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.day}-${row.category}`} className="border-b border-[#EEEEEC]">
                    <td className="px-2 py-2">{dayjs(row.day).format('YYYY-MM-DD')}</td>
                    <td className="px-2 py-2">{descriptions[row.category].title}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {row.count}
                      {t(($) => $.settings.items)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{sizeText(row.bytes)}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-[#787774]">
                      {!partners.length
                        ? t(($) => $.common.noPartnersYet)
                        : normalizeUserFacingError(preview?.error, '') ||
                          t(($) => $.settings.noDataToCleanUpWithTheseFilters)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Spin>
          <p className="mt-3 text-[12px] leading-5 text-[#787774]">
            {t(($) => $.settings.cleanUpSelectedDirectoriesBeforeTheCutoffDatePartners)}
          </p>
          {busy && (
            <p className="mt-2 text-[12px] text-[#B3261E]">
              {t(($) => $.settings.theSelectedPartnerIsRunningWaitForItTo)}
            </p>
          )}
          {!!preview?.skippedCount && (
            <p className="mt-2 text-[12px] text-[#787774]">
              {t(($) => $.settings.skipped)}
              {preview.skippedCount}
              {t(($) => $.settings.itemsCurrentlyInUse)}
            </p>
          )}
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
