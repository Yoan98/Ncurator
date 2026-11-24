import { t } from '../../i18n'
import { OfficeReviewContext } from './OfficeReviewContext'
import { useCallback, useEffect, useRef, useState } from 'react'
import { message, Spin } from 'antd'
import type { AiFileChangeRecord } from '../../../../shared/types'
import {
  isWpsApplication,
  openWithExtension,
  type ReviewLocation,
  type OfficeReviewIndex
} from '../../../../shared/fileReview'
import { FileRenderViewer } from '../fileRenders'
import PptDiffViewer from './PptDiffViewer'
import { resetWpsIntegrationFeedback, useWpsIntegrationFeedback } from './wpsIntegrationFeedback'

export function OfficeFileReview({
  record,
  viewKey,
  onInternalNavigate
}: {
  record: AiFileChangeRecord
  viewKey: string
  onInternalNavigate: (target: ReviewLocation) => void
}) {
  const showIntegrationIssue = useWpsIntegrationFeedback()
  const [content, setContent] = useState<{ previewPath: string; index: OfficeReviewIndex } | null>(
    null
  )
  const [error, setError] = useState('')
  const [useWps, setUseWps] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [navigationError, setNavigationError] = useState('')
  const sequence = useRef(0)
  const [navigating, setNavigating] = useState(false)
  useEffect(() => {
    let cancelled = false
    setContent(null)
    setError('')
    void window.api
      .getFileReview({ changeRecordId: record.id })
      .then((result) => {
        if (cancelled) return
        if (!result.success) setError(result.error)
        else if (result.content.kind === 'office') setContent(result.content)
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [record.id, record.previewPath])
  useEffect(() => {
    let cancelled = false
    const load = () => {
      void window.api
        .appSettingsGet()
        .then((settings) => setUseWps(settings.openOfficeDiffInWps))
        .catch(() => undefined)
      void window.api
        .listOpenWithApplications({ filePath: record.path })
        .then((result) => {
          if (!cancelled) {
            setNavigationError(
              result.success
                ? ''
                : result.error ||
                    t(($) => $.workbench.couldNotConfirmTheDefaultApplicationChangeNavigationIs)
            )
            setEnabled(
              result.success &&
                result.applications.some(
                  (a) => a.id === result.defaultApplicationId && isWpsApplication(a)
                )
            )
          }
        })
        .catch(() => {
          if (!cancelled) {
            setEnabled(false)
            setNavigationError(
              t(($) => $.workbench.couldNotConfirmTheDefaultApplicationChangeNavigationIs)
            )
          }
        })
    }
    load()
    const unsubscribe = window.api.onOpenWithPreferenceChanged((extension) => {
      if (extension === openWithExtension(record.path)) load()
    })
    window.addEventListener('focus', load)
    return () => {
      cancelled = true
      unsubscribe()
      window.removeEventListener('focus', load)
    }
  }, [record.path])
  const navigate = useCallback(
    (regionId: string) => {
      if (record.capability !== 'ppt' && !useWps) {
        const target = content?.index.regions.find((region) => region.id === regionId)?.target
        if (target) onInternalNavigate(target)
        else message.info(t(($) => $.editors.changeNotFound))
        return
      }
      if (!enabled && record.capability === 'ppt') return
      const requestSequence = ++sequence.current
      setNavigating(true)
      void window.api
        .openFileReviewLocation({ changeRecordId: record.id, regionId })
        .then((result) => {
          if (requestSequence !== sequence.current) return
          if (result.issue) showIntegrationIssue(result.issue, true)
          else if (result.status === 'located' || result.status === 'container') {
            resetWpsIntegrationFeedback(
              record.capability === 'docx' ? 'wps' : record.capability === 'ppt' ? 'wpp' : 'et'
            )
            if (result.status === 'container')
              message.info(result.reason || t(($) => $.workbench.locatedTheRelevantContent))
          } else if (result.status === 'failed') {
            message.error(result.reason || t(($) => $.workbench.couldNotLocateTheContent))
          } else message.info(result.reason || t(($) => $.workbench.fileOpened))
          if (
            result.status !== 'located' &&
            result.status !== 'container' &&
            record.capability !== 'ppt'
          ) {
            const target = content?.index.regions.find((region) => region.id === regionId)?.target
            if (target)
              message.info(
                <button onClick={() => onInternalNavigate(target)}>
                  {t(($) => $.editors.internalLocation)}
                </button>,
                8
              )
          }
        })
        .catch((reason) => {
          if (requestSequence === sequence.current) message.error(String(reason))
        })
        .finally(() => {
          if (requestSequence === sequence.current) setNavigating(false)
        })
    },
    [
      enabled,
      record.id,
      record.capability,
      showIntegrationIssue,
      useWps,
      content,
      onInternalNavigate
    ]
  )
  if (error) return <div className="p-6 text-sm text-[var(--notion-red)]">{error}</div>
  if (!content)
    return (
      <div className="flex h-full items-center justify-center">
        <Spin />
      </div>
    )
  return (
    <OfficeReviewContext.Provider
      value={{ index: content.index, enabled: record.capability !== 'ppt' || enabled, navigate }}
    >
      <div
        className={`relative h-full min-h-0 ${record.capability !== 'ppt' || enabled ? 'office-review-navigable' : ''}`}
      >
        {navigationError && (useWps || record.capability === 'ppt') && (
          <div
            role="status"
            className="absolute left-3 top-2 z-20 max-w-[90%] rounded bg-[var(--notion-page)]/95 px-3 py-1 text-xs text-[var(--notion-text-soft)] shadow"
          >
            {navigationError}
          </div>
        )}
        {navigating && (
          <div
            role="status"
            className="pointer-events-none absolute right-4 top-2 z-20 rounded bg-[var(--notion-page)]/95 px-3 py-1 text-xs text-[var(--notion-text-soft)] shadow"
          >
            {t(($) => $.workbench.openingWpsAndLocatingContent)}
          </div>
        )}
        {record.capability === 'ppt' ? (
          <PptDiffViewer record={record} />
        ) : (
          <FileRenderViewer
            documents={[
              {
                filePath: content.previewPath,
                fileName: record.fileName,
                metadata: {
                  viewKey,
                  docxOverview: record.capability === 'docx' ? 'changes' : undefined,
                  excelReview: record.capability === 'excel'
                }
              }
            ]}
          />
        )}
      </div>
    </OfficeReviewContext.Provider>
  )
}
