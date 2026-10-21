import { t } from '../../i18n'
import { getRendererRuntime } from '../../i18n'
import { useOfficeReviewNavigation } from '../workbench/OfficeReviewContext'
import DocumentSelectionLayer from './selection/DocumentSelectionLayer'
import { excelAdapter } from './selection/excelAdapter'
import type { SelectionAdapter } from './selection/types'
import type { LoadedFileRenderDocument } from './types'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DocRendererProps } from 'react-doc-viewer'
import ExcelJS from 'exceljs'
import { LocaleType, type IWorkbookData } from '@univerjs/core'
import {
  excelColor as color,
  excelSheetId as sheetPreviewId,
  hasExcelFormulas,
  toExcelWorkbookData
} from '../../../../shared/excelWorkbook'
import '@univerjs/preset-sheets-core/lib/index.css'
import { workbenchSelectors } from '../../testing/selectors'

type XlsxDocument = Omit<LoadedFileRenderDocument, 'fileData'> & {
  file?: File | Blob
  fileData?: string | ArrayBuffer | Uint8Array | Blob | File
  fileName?: string
}

const readBytes = async (document: XlsxDocument): Promise<ArrayBuffer> => {
  if (document.file instanceof Blob) return document.file.arrayBuffer()
  if (document.fileData instanceof Blob) return document.fileData.arrayBuffer()
  if (document.fileData instanceof ArrayBuffer) return document.fileData
  if (document.fileData instanceof Uint8Array) return document.fileData.slice().buffer
  if (document.uri) {
    const response = await fetch(document.uri)
    if (!response.ok)
      throw new Error(t(($) => $.editors.couldNotReadExcel, { value1: response.status }))
    return response.arrayBuffer()
  }
  throw new Error(t(($) => $.editors.excelPreviewDataIsMissing))
}

const DIFF_MARKER_RGB = new Set(['#22A06B', '#D14343'])

const isDiffMarkerColor = (input?: Partial<ExcelJS.Color>): boolean => {
  const rgb = color(input)?.rgb
  return Boolean(rgb && DIFF_MARKER_RGB.has(rgb.toUpperCase()))
}

const cellHasDiffMarkerBorder = (cell: ExcelJS.Cell): boolean => {
  const border = cell.border
  if (!border) return false
  return [border.top, border.right, border.bottom, border.left].some(
    (side) => side?.style === 'medium' && isDiffMarkerColor(side.color)
  )
}

const sheetHasDiffMarker = (sheet: ExcelJS.Worksheet): boolean => {
  if (isDiffMarkerColor(sheet.properties.tabColor)) return true
  let found = false
  sheet.eachRow({ includeEmpty: true }, (row) => {
    if (found) return
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (!found && cellHasDiffMarkerBorder(cell)) found = true
    })
  })
  return found
}

const escapeCssIdent = (value: string): string => {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/([^\w-])/g, '\\$1')
}

const changedSheetDotStyle = (sheetIds: string[]): string => {
  if (sheetIds.length === 0) return ''
  return sheetIds
    .map((id) => {
      const selector = `[data-testid="${workbenchSelectors.excelViewer}"] [data-u-comp="slide-tab-item"][data-id="${escapeCssIdent(id)}"]`
      return `${selector}{position:relative;overflow:visible;}
${selector}::after{content:"";position:absolute;top:2px;right:2px;width:6px;height:6px;border-radius:50%;background:#22A06B;box-shadow:0 0 0 1px #fff;pointer-events:none;}`
    })
    .join('')
}

type ExcelPreviewWorkbook = {
  data: IWorkbookData
  changedSheetIds: string[]
  changedSheetNames: string[]
}

const toWorkbookData = async (bytes: ArrayBuffer, name: string): Promise<ExcelPreviewWorkbook> => {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes as never)
  const changedSheets = workbook.worksheets.filter(sheetHasDiffMarker)
  return {
    data: toExcelWorkbookData(workbook, name),
    changedSheetIds: changedSheets.map(sheetPreviewId),
    changedSheetNames: changedSheets.map((sheet) => sheet.name)
  }
}

const waitForRenderedCanvas = async (
  container: HTMLDivElement,
  isCancelled: () => boolean
): Promise<HTMLCanvasElement | null> => {
  for (let attempt = 0; attempt < 300 && !isCancelled(); attempt += 1) {
    // Univer also mounts zero-sized document-editor canvases before the sheet canvas.
    const canvas = container.querySelector<HTMLCanvasElement>(
      'canvas[id^="univer-sheet-main-canvas_"]'
    )
    if (canvas && canvas.getBoundingClientRect().width > 0) return canvas
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
  return null
}

const CustomXlsxRenderer = ({ mainState }: DocRendererProps) => {
  const document = mainState.currentDocument as XlsxDocument | undefined
  const navigation = useOfficeReviewNavigation()
  const navigationRef = useRef(navigation)
  navigationRef.current = navigation
  const regionIds = useMemo(
    () =>
      new Map(
        navigation?.index.regions.map((region) => [`${region.surface}\0${region.key}`, region.id])
      ),
    [navigation?.index]
  )
  const regionIdsRef = useRef(regionIds)
  regionIdsRef.current = regionIds
  const containerRef = useRef<HTMLDivElement>(null)
  const selectionContainerRef = useRef<HTMLDivElement>(null)
  const [selectionAdapter, setSelectionAdapter] = useState<SelectionAdapter | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [changedSheetIds, setChangedSheetIds] = useState<string[]>([])
  const [changedSheetNames, setChangedSheetNames] = useState<string[]>([])

  useEffect(() => {
    if (!document || !containerRef.current || !selectionContainerRef.current) return
    const container = containerRef.current
    let cancelled = false
    let dispose: (() => void) | undefined
    let detachNavigation: (() => void) | undefined
    setReady(false)
    setSelectionAdapter(null)
    setError(null)
    setChangedSheetIds([])
    setChangedSheetNames([])
    void Promise.all([
      readBytes(document).then((bytes) => toWorkbookData(bytes, document.fileName || 'Excel')),
      import('@univerjs/core'),
      import('@univerjs/core/facade'),
      import('@univerjs/preset-sheets-core'),
      getRendererRuntime().locale === 'zh-CN'
        ? import('@univerjs/preset-sheets-core/locales/zh-CN')
        : import('@univerjs/preset-sheets-core/locales/en-US')
    ])
      .then(
        async ([
          preview,
          { Univer, LogLevel },
          { FUniver },
          { UniverSheetsCorePreset, CalculationMode },
          localeModule
        ]) => {
          if (cancelled) return
          const univer = new Univer({
            logLevel: LogLevel.WARN,
            locale: getRendererRuntime().locale === 'zh-CN' ? LocaleType.ZH_CN : LocaleType.EN_US,
            locales: {
              [getRendererRuntime().locale === 'zh-CN' ? LocaleType.ZH_CN : LocaleType.EN_US]:
                localeModule.default
            }
          })
          dispose = () => univer.dispose()
          const sheetPreviewOptions: Record<string, unknown> = {
            protectedRangeShadow: 'none',
            disableForceStringAlert: true
          }
          const preset = UniverSheetsCorePreset({
            container,
            header: false,
            toolbar: false,
            formulaBar: true,
            formula: {
              initialFormulaComputing: document.metadata?.excelReview
                ? CalculationMode.NO_CALCULATION
                : CalculationMode.FORCED
            },
            footer: {
              sheetBar: true,
              zoomSlider: true,
              addSheetButtonConfig: { show: false }
            },
            contextMenu: false,
            disableAutoFocus: true,
            sheets: sheetPreviewOptions
          })
          for (const entry of preset.plugins) {
            const [plugin, options] = Array.isArray(entry) ? entry : [entry, undefined]
            univer.registerPlugin(plugin, options)
          }
          const univerAPI = FUniver.newAPI(univer)
          // Keep Univer's navigation and copy behavior while blocking workbook edits.
          const workbook = univerAPI.createWorkbook(preview.data)
          let down: { x: number; y: number } | null = null
          const startNavigation = (event: PointerEvent) => {
            down =
              event.button === 0 && event.target instanceof HTMLCanvasElement
                ? { x: event.clientX, y: event.clientY }
                : null
          }
          const endNavigation = (event: PointerEvent) => {
            const origin = down
            down = null
            if (
              !origin ||
              !navigationRef.current?.enabled ||
              Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 5
            )
              return
            const sheet = workbook.getActiveSheet(),
              ranges = sheet?.getSelection()?.getActiveRangeList() || []
            if (!sheet || ranges.length !== 1) return
            const range = ranges[0].getRange()
            let column = range.startColumn + 1,
              letters = ''
            while (column > 0) {
              letters = String.fromCharCode(65 + ((column - 1) % 26)) + letters
              column = Math.floor((column - 1) / 26)
            }
            const key = `${letters}${range.startRow + 1}`
            const regionId = regionIdsRef.current.get(`${sheet.getSheetName()}\0${key}`)
            if (regionId) navigationRef.current.navigate(regionId)
          }
          const hover = univerAPI.addEvent(
            univerAPI.Event.CellPointerMove,
            ({ worksheet, row, column }) => {
              let value = column + 1,
                letters = ''
              while (value > 0) {
                letters = String.fromCharCode(65 + ((value - 1) % 26)) + letters
                value = Math.floor((value - 1) / 26)
              }
              const region =
                navigationRef.current?.enabled &&
                regionIdsRef.current.has(`${worksheet.getSheetName()}\0${letters}${row + 1}`)
              const canvas = container.querySelector<HTMLCanvasElement>(
                'canvas[id^="univer-sheet-main-canvas_"]'
              )
              if (canvas) canvas.style.cursor = region ? 'pointer' : ''
            }
          )
          container.addEventListener('pointerdown', startNavigation)
          container.addEventListener('pointerup', endNavigation)
          detachNavigation = () => {
            hover.dispose()
            container.removeEventListener('pointerdown', startNavigation)
            container.removeEventListener('pointerup', endNavigation)
          }

          if (cancelled) {
            dispose()
            return
          }
          if (!document.metadata?.excelReview && hasExcelFormulas(preview.data))
            await univerAPI.getFormula().onCalculationResultApplied(30_000)
          if (cancelled) return
          const canvas = await waitForRenderedCanvas(container, () => cancelled)
          if (!cancelled && !canvas) throw new Error(t(($) => $.editors.excelPreviewCanvasTimedOut))
          if (!cancelled) {
            // Apply after UI permission initialization so its defaults cannot overwrite read-only.
            await workbook
              .getWorkbookPermission()
              .setPoint(univerAPI.Enum.WorkbookPermissionPoint.Edit, false)
            univerAPI.setPermissionDialogVisible(false)
            if (cancelled) return
            setChangedSheetIds(preview.changedSheetIds)
            setChangedSheetNames(preview.changedSheetNames)
            setReady(true)
            if (document.metadata?.allowDocumentSelection && document.filePath && canvas)
              setSelectionAdapter(excelAdapter(univerAPI, document.filePath, canvas))
          }
        }
      )
      .catch((reason) => {
        if (!cancelled) {
          console.error(
            t(($) => $.editors.excelPreviewFailed),
            reason
          )
          detachNavigation?.()
          dispose?.()
          dispose = undefined
          setReady(false)
          setChangedSheetIds([])
          setChangedSheetNames([])
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })
    return () => {
      cancelled = true
      detachNavigation?.()
      dispose?.()
    }
  }, [document])

  if (!document) return null
  const sheetDotCss = changedSheetDotStyle(changedSheetIds)
  return (
    <div
      className="relative h-full w-full bg-white"
      data-testid={workbenchSelectors.excelViewer}
      data-excel-ready={ready ? 'true' : 'false'}
      data-excel-file-name={document.fileName || ''}
      data-excel-uri={document.uri || ''}
      data-excel-changed-sheets={JSON.stringify(changedSheetNames)}
    >
      {sheetDotCss ? <style>{sheetDotCss}</style> : null}
      {error ? (
        <div className="flex h-full items-center justify-center text-sm text-[#787774]">
          {t(($) => $.editors.excelPreviewFailed2)}
          {error}
        </div>
      ) : null}
      {selectionAdapter && document.filePath && (
        <DocumentSelectionLayer
          container={selectionContainerRef.current}
          filePath={document.filePath}
          revision={ready ? 1 : 0}
          adapter={selectionAdapter}
          testPrefix="excel"
        />
      )}
      <div
        ref={selectionContainerRef}
        className="relative h-full w-full"
        data-testid={workbenchSelectors.excelGrid}
      >
        {/* Univer owns the inner DOM; selection portals belong to the outer React container. */}
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  )
}

CustomXlsxRenderer.fileTypes = [
  'xlsx',
  'xlsm',
  'xltx',
  'xltm',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  'application/vnd.ms-excel.template.macroEnabled.12'
]
CustomXlsxRenderer.weight = 1

export default CustomXlsxRenderer
