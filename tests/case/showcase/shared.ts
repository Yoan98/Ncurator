import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import type { AiLlmUsage, AiRunEvent } from '../../../../src/shared/types'
import {
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  workbenchSelectors
} from '../../harness/e2e/workbench'

export const USD_CNY = 7.2

export const SHOWCASE_FIXTURE_DIR = path.resolve('tests/fixtures/showcase')

export const showcaseFixturePath = (fileName: string): string =>
  path.join(SHOWCASE_FIXTURE_DIR, fileName)

export const hasShowcaseFixture = async (fileName: string): Promise<boolean> => {
  try {
    await fs.access(showcaseFixturePath(fileName))
    return true
  } catch {
    return false
  }
}

export const requireShowcaseFixture = async (fileName: string): Promise<void> => {
  if (await hasShowcaseFixture(fileName)) return
  throw new Error(`缺少过关 fixture：${fileName}，禁止再新建一份凑审核图。`)
}

export const copyShowcaseFixture = async (sourcePath: string, fileName: string): Promise<void> => {
  await fs.mkdir(SHOWCASE_FIXTURE_DIR, { recursive: true })
  await fs.copyFile(sourcePath, showcaseFixturePath(fileName))
}

export const seedWorkspaceWithFixture = async (
  prefix: string,
  fileName: string
): Promise<string> => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  await fs.copyFile(showcaseFixturePath(fileName), path.join(rootPath, fileName))
  return rootPath
}

export const seedEmptyShowcaseWorkspace = async (prefix: string): Promise<string> => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  await fs.writeFile(path.join(rootPath, '工作区说明.txt'), '空工作区，可直接新建文件。\n', 'utf8')
  return rootPath
}

export const isDeepseekPeak = (date: Date): boolean => {
  const utcDay = date.getUTCDay()
  if (utcDay === 0 || utcDay === 6) return false
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes()
  return (minutes >= 60 && minutes < 240) || (minutes >= 360 && minutes < 600)
}

export const collectUsage = (events: readonly AiRunEvent[]) => {
  let calls = 0
  let unavailableCalls = 0
  let inputTokens = 0
  let outputTokens = 0
  let cachedInputTokens = 0
  let cacheMissInputTokens = 0

  for (const event of events) {
    if (event.type !== 'activity' || event.status !== 'completed') continue
    const usage = event.details?.usage as AiLlmUsage | undefined
    if (!usage) continue
    calls += 1
    if (usage.source === 'unavailable') {
      unavailableCalls += 1
      continue
    }
    const input = usage.inputTokens || 0
    const cached = usage.cachedInputTokens || 0
    inputTokens += input
    outputTokens += usage.outputTokens || 0
    cachedInputTokens += cached
    cacheMissInputTokens += usage.cacheMissInputTokens || Math.max(0, input - cached)
  }

  return {
    calls,
    unavailableCalls,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheMissInputTokens
  }
}

export const priceUsdPerMillion = (peak: boolean) =>
  peak ? { hit: 0.006, miss: 0.3, output: 1.2 } : { hit: 0.003, miss: 0.15, output: 0.6 }

export const roundCny = (value: number): number => Math.round(value * 100) / 100

export const computeShowcaseCost = (
  events: readonly AiRunEvent[],
  extra: Record<string, unknown>
) => {
  const usage = collectUsage(events)
  const peak = isDeepseekPeak(new Date())
  const rates = priceUsdPerMillion(peak)
  const usd =
    (usage.cachedInputTokens / 1_000_000) * rates.hit +
    (usage.cacheMissInputTokens / 1_000_000) * rates.miss +
    (usage.outputTokens / 1_000_000) * rates.output
  return {
    modelName: extra.modelName,
    modelLabel: 'DeepSeek V4.1 Flash',
    peak,
    usdCny: USD_CNY,
    usage,
    usd: roundCny(usd),
    cny: roundCny(usd * USD_CNY),
    ...extra
  }
}

export const readApplyChangeCounts = async (
  page: Page
): Promise<{ insertCount: number; deleteCount: number }> => {
  const panel = getWorkbenchLocator(page, workbenchSelectors.applyPanel)
  const text = ((await panel.textContent()) || '').replace(/\s+/g, ' ')
  const insertMatch = text.match(/\+(\d+)/)
  const deleteMatch = text.match(/-(\d+)/)
  return {
    insertCount: insertMatch ? Number(insertMatch[1]) : 0,
    deleteCount: deleteMatch ? Number(deleteMatch[1]) : 0
  }
}

export const ensureDocumentMode = async (page: Page, mode: '审核' | '预览'): Promise<void> => {
  const modeTag = getWorkbenchLocator(page, workbenchSelectors.documentModeTag)
  await modeTag.waitFor({ state: 'visible', timeout: 30_000 })
  const modeText = ((await modeTag.textContent()) || '').trim()
  if (!modeText.includes(mode)) {
    await getWorkbenchLocator(page, workbenchSelectors.documentModeToggle).click()
    await modeTag.filter({ hasText: mode }).waitFor({ state: 'visible', timeout: 10_000 })
  }
}

export const screenshotExcelUsedRange = async (
  target: ReturnType<Page['locator']>,
  outputPath: string
): Promise<void> => {
  const box = await target.boundingBox()
  if (!box) {
    await target.screenshot({ path: outputPath, type: 'png' })
    return
  }
  await target.screenshot({
    path: outputPath,
    type: 'png',
    clip: {
      x: 0,
      y: 0,
      width: Math.max(1, Math.floor(box.width)),
      height: Math.max(1, Math.min(520, Math.floor(box.height)))
    }
  })
}

export const inspectExcelEditResult = async (
  filePath: string
): Promise<{
  sheetNames: string[]
  hasOccurredColumn: boolean
  adAmount: number | null
}> => {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load((await fs.readFile(filePath)) as never)
  const sheetNames = workbook.worksheets.map((sheet) => sheet.name)
  const detail = workbook.worksheets[0]
  let hasOccurredColumn = false
  let adAmount: number | null = null
  if (!detail) return { sheetNames, hasOccurredColumn, adAmount }
  detail.eachRow((row) => {
    const texts: string[] = []
    const numbers: number[] = []
    row.eachCell((cell) => {
      const text = String(cell.value ?? '')
      texts.push(text)
      if (/(已发生|已花|花费|实际)/u.test(text)) hasOccurredColumn = true
      const raw = cell.value
      const numeric =
        typeof raw === 'number'
          ? raw
          : typeof raw === 'object' && raw && 'result' in raw
            ? Number((raw as { result?: unknown }).result)
            : Number(String(raw).replace(/,/g, ''))
      if (Number.isFinite(numeric) && numeric >= 1000) numbers.push(numeric)
    })
    if (texts.some((text) => /广告|投放|品牌推广/u.test(text))) {
      adAmount = numbers[0] ?? adAmount
    }
  })
  return { sheetNames, hasOccurredColumn, adAmount }
}

export const screenshotScrollerPages = async (
  scroller: ReturnType<Page['locator']>,
  outputDir: string,
  prefix: string,
  maxPages = 4
): Promise<string[]> => {
  await fs.mkdir(outputDir, { recursive: true })
  const metrics = await scroller.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight
  }))
  const screenshotNames: string[] = []
  const step = Math.max(160, metrics.clientHeight - 32)
  let offset = 0
  for (let index = 0; index < maxPages; index += 1) {
    await scroller.evaluate((element, top) => {
      element.scrollTop = top
    }, offset)
    await scroller.page().waitForTimeout(250)
    const fileName = `${prefix}-${index + 1}.png`
    await scroller.screenshot({
      path: path.join(outputDir, fileName),
      type: 'png'
    })
    screenshotNames.push(fileName)
    if (offset + metrics.clientHeight >= metrics.scrollHeight - 8) break
    offset += step
  }
  return screenshotNames
}

export const rasterizePdfPages = async (
  pdfPath: string,
  outputDir: string,
  prefix = 'page'
): Promise<string[]> => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createCanvas } = await import('@napi-rs/canvas')
  await fs.mkdir(outputDir, { recursive: true })
  const data = new Uint8Array(await fs.readFile(pdfPath))
  const document = await pdfjs.getDocument({ data }).promise
  const names: string[] = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const canvasContext = canvas.getContext('2d')
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: canvasContext as unknown as CanvasRenderingContext2D,
      viewport
    }).promise
    const fileName = `${prefix}-${pageNumber}.png`
    await fs.writeFile(path.join(outputDir, fileName), canvas.toBuffer('image/png'))
    names.push(fileName)
  }
  await document.destroy()
  return names
}

export const screenshotAssistantAnswer = async (page: Page, outputPath: string): Promise<void> => {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const answer = getWorkbenchPrefixLocator(
    page,
    workbenchSelectors.assistantFinalAnswerPrefix
  ).last()
  await answer.waitFor({ state: 'visible', timeout: 30_000 })
  await answer.evaluate((node) => {
    if (!(node instanceof HTMLElement)) return
    node.scrollIntoView({ block: 'start', inline: 'nearest' })
    let parent: HTMLElement | null = node
    while (parent) {
      if (parent.scrollHeight > parent.clientHeight + 8) parent.scrollTop = 0
      parent = parent.parentElement
    }
  })
  await page.waitForTimeout(400)
  const box = await answer.boundingBox()
  if (!box) {
    await answer.screenshot({ path: outputPath, type: 'png' })
    return
  }
  const composer = getWorkbenchLocator(page, workbenchSelectors.composerShell)
  const composerBox = await composer.boundingBox().catch(() => null)
  const width = Math.max(1, Math.ceil(box.width))
  const visibleAboveComposer = composerBox ? Math.ceil(composerBox.y - box.y - 12) : 0
  const height = Math.min(
    Math.max(visibleAboveComposer >= 80 ? visibleAboveComposer : Math.ceil(box.height), 1),
    1100
  )
  if (visibleAboveComposer >= 80) {
    await page.screenshot({
      path: outputPath,
      type: 'png',
      clip: {
        x: Math.max(0, Math.floor(box.x)),
        y: Math.max(0, Math.floor(box.y)),
        width,
        height
      }
    })
    return
  }
  await answer.screenshot({
    path: outputPath,
    type: 'png',
    clip: { x: 0, y: 0, width, height }
  })
}

export const rasterizeNotePage = async (
  title: string,
  body: string,
  outputPath: string
): Promise<{ width: number; height: number }> => {
  const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas')
  const fontPath = '/Library/Fonts/Arial Unicode.ttf'
  if (!GlobalFonts.has('NoteBody')) {
    GlobalFonts.registerFromPath(fontPath, 'NoteBody')
  }
  const width = 1191
  const height = 1684
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#FBFAF7'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#37352F'
  ctx.font = 'bold 28px NoteBody'
  const titleX = 72
  let y = 88
  ctx.fillText(title, titleX, y)
  y += 36
  ctx.strokeStyle = '#E8E5DF'
  ctx.beginPath()
  ctx.moveTo(titleX, y)
  ctx.lineTo(width - 72, y)
  ctx.stroke()
  y += 42
  ctx.font = '22px NoteBody'
  ctx.fillStyle = '#37352F'
  const maxWidth = width - 144
  const lineHeight = 36
  for (const paragraph of body.replace(/\r\n/g, '\n').split('\n')) {
    const text = paragraph.replace(/^#+\s+/, '').trimEnd()
    if (!text) {
      y += lineHeight * 0.45
      continue
    }
    let line = ''
    for (const char of text) {
      const next = `${line}${char}`
      if (ctx.measureText(next).width > maxWidth) {
        ctx.fillText(line, titleX, y)
        y += lineHeight
        line = char
      } else {
        line = next
      }
    }
    if (line) {
      ctx.fillText(line, titleX, y)
      y += lineHeight
    }
  }
  const cropHeight = Math.min(height, Math.max(Math.round(y + 72), 980))
  const output = cropHeight < height ? createCanvas(width, cropHeight) : canvas
  if (output !== canvas) {
    output.getContext('2d').drawImage(canvas, 0, 0)
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, output.toBuffer('image/png'))
  return { width, height: cropHeight }
}

export type EmbeddedBrowserSnapshot = {
  url: string
  title: string
  inputValues: string[]
  bodyText: string
}

export const inspectEmbeddedBrowser = async (
  electronApp: ElectronApplication,
  hostIncludes: string
): Promise<EmbeddedBrowserSnapshot | null> => {
  return await electronApp.evaluate(async ({ webContents }, host) => {
    const contents = webContents
      .getAllWebContents()
      .find((candidate) => !candidate.isDestroyed() && candidate.getURL().includes(host))
    if (!contents) return null
    const snapshot = (await contents.executeJavaScript(`({
      url: location.href,
      title: document.title,
      inputValues: Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]')).map((el) => {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value || ''
        return (el.textContent || '').trim()
      }),
      bodyText: ((document.body && document.body.innerText) || '').slice(0, 4000)
    })`)) as EmbeddedBrowserSnapshot
    return snapshot
  }, hostIncludes)
}

export const captureEmbeddedBrowserPng = async (
  electronApp: ElectronApplication,
  hostIncludes: string,
  outputPath: string
): Promise<boolean> => {
  const pngBase64 = await electronApp.evaluate(async ({ webContents }, host) => {
    const contents = webContents
      .getAllWebContents()
      .find((candidate) => !candidate.isDestroyed() && candidate.getURL().includes(host))
    if (!contents) return null
    const image = await contents.capturePage()
    if (image.isEmpty()) return null
    return image.toPNG().toString('base64')
  }, hostIncludes)
  if (!pngBase64) return false
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, Buffer.from(pngBase64, 'base64'))
  return true
}
