import { t } from '../../i18n'
import { OfficeReviewContext } from './OfficeReviewContext'
import { useCallback, useEffect, useRef, useState } from 'react'
import { message, Spin } from 'antd'
import type { AiFileChangeRecord } from '../../../../shared/types'
import {
  isWpsApplication,
  openWithExtension,
  type OfficeReviewIndex
} from '../../../../shared/fileReview'
import { FileRenderViewer } from '../fileRenders'
import PptDiffViewer from './PptDiffViewer'
import { resetWpsIntegrationFeedback, useWpsIntegrationFeedback } from './wpsIntegrationFeedback'

export function OfficeFileReview({ record }: { record: AiFileChangeRecord }) {
  const showIntegrationIssue = useWpsIntegrationFeedback()
  const [content, setContent] = useState<{ previewPath: string; index: OfficeReviewIndex } | null>(
    null
  )
  const [error, setError] = useState('')
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
      if (!enabled) return
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
          } else if (result.status === 'failed')
            message.error(result.reason || t(($) => $.workbench.couldNotLocateTheContent))
          else message.info(result.reason || t(($) => $.workbench.fileOpened))
        })
        .catch((reason) => {
          if (requestSequence === sequence.current) message.error(String(reason))
        })
        .finally(() => {
          if (requestSequence === sequence.current) setNavigating(false)
        })
    },
    [enabled, record.id, record.capability, showIntegrationIssue]
  )
  if (error) return <div className="p-6 text-sm text-[#B3261E]">{error}</div>
  if (!content)
    return (
      <div className="flex h-full items-center justify-center">
        <Spin />
      </div>
    )
  return (
    <OfficeReviewContext.Provider value={{ index: content.index, enabled, navigate }}>
      <div className={`relative h-full min-h-0 ${enabled ? 'office-review-navigable' : ''}`}>
        {navigationError && (
          <div
            role="status"
            className="absolute left-3 top-2 z-20 max-w-[90%] rounded bg-white/95 px-3 py-1 text-xs text-[#787774] shadow"
          >
            {navigationError}
          </div>
        )}
        {navigating && (
          <div
            role="status"
            className="pointer-events-none absolute right-4 top-2 z-20 rounded bg-white/95 px-3 py-1 text-xs text-[#787774] shadow"
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
