import { load } from 'cheerio'
import type { PptBounds, PptCompiledElement, PptCompiledSlide, PptElementStyle } from './types'

const FORBIDDEN_TAGS = new Set([
  'script',
  'style',
  'link',
  'base',
  'meta',
  'iframe',
  'object',
  'embed',
  'video',
  'audio',
  'canvas'
])
const DEFAULT_WIDTH = 1920
const DEFAULT_HEIGHT = 1080

const toNumber = (value: string | undefined, base = 0): number | undefined => {
  const raw = String(value || '').trim()
  if (!raw) return undefined
  if (raw.endsWith('%')) {
    const percent = Number(raw.slice(0, -1))
    return Number.isFinite(percent) ? (percent / 100) * base : undefined
  }
  const number = Number.parseFloat(raw)
  return Number.isFinite(number) ? number : undefined
}

const parseStyleText = (styleText: string | undefined): Record<string, string> => {
  const out: Record<string, string> = {}
  String(styleText || '')
    .split(';')
    .forEach((entry) => {
      const separator = entry.indexOf(':')
      if (separator <= 0) return
      const key = entry.slice(0, separator).trim().toLowerCase()
      const value = entry.slice(separator + 1).trim()
      if (key && value) out[key] = value
    })
  return out
}

const normalizeColor = (value: string | undefined, fallback?: string): string | undefined => {
  const raw = String(value || '').trim()
  if (!raw || raw === 'transparent' || raw === 'rgba(0, 0, 0, 0)') return fallback
  const short = /^#([0-9a-f]{3})$/i.exec(raw)
  if (short) {
    return `#${short[1]!
      .split('')
      .map((part) => `${part}${part}`)
      .join('')}`.toUpperCase()
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(raw)
  if (hex) return `#${hex[1]!.toUpperCase()}`
  const rgb = /^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/i.exec(raw)
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]]
      .map((part) =>
        Math.max(0, Math.min(255, Number(part)))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')}`.toUpperCase()
  }
  const names: Record<string, string> = {
    white: '#FFFFFF',
    black: '#000000',
    red: '#FF0000',
    blue: '#0000FF',
    green: '#008000',
    gray: '#808080',
    grey: '#808080'
  }
  return names[raw.toLowerCase()] || fallback
}

const sanitizeHtml = (html: string): string => {
  const source = String(html || '').trim()
  if (!source) throw new Error('html 不能为空')
  const $ = load(source)
  const forbidden = [...FORBIDDEN_TAGS].filter((tag) => $(tag).length > 0)
  if (forbidden.length > 0) {
    throw new Error(`html 包含不支持的标签: ${forbidden.join(', ')}`)
  }
  if ($('[data-ppt-slide]').length !== 1) {
    throw new Error('html 必须且只能包含一个 data-ppt-slide 页面根节点')
  }
  const remoteAsset = $('[src]')
    .toArray()
    .find((element) => /^https?:\/\//i.test($(element).attr('src') || ''))
  if (remoteAsset || /url\(\s*['"]?https?:\/\//i.test(source)) {
    throw new Error('html 图片只支持工作区内已存在的本地文件。')
  }
  $('*').each((_index, element) => {
    if (!('attribs' in element)) return
    for (const name of Object.keys(element.attribs || {})) {
      if (name.toLowerCase().startsWith('on')) $(element).removeAttr(name)
    }
  })
  return $.html()
}

const layoutWithElectron = async (html: string): Promise<PptCompiledSlide | null> => {
  if (!process.versions.electron) return null
  try {
    const electron = await import('electron')
    if (!electron.BrowserWindow || !electron.app?.isReady()) return null
    const window = new electron.BrowserWindow({
      show: false,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      useContentSize: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: `ppt-layout-${Date.now()}-${Math.random()}`
      }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    try {
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      const result = (await window.webContents.executeJavaScript(`(() => {
        const root = document.querySelector('[data-ppt-slide]') || document.body.firstElementChild || document.body;
        const rootRect = root.getBoundingClientRect();
        const cleanText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const color = (value) => value && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent' ? value : undefined;
        const elements = [];
        const candidates = Array.from(root.querySelectorAll('*'));
        candidates.forEach((element, index) => {
          if (['STYLE','META','LINK','TITLE','HEAD'].includes(element.tagName)) return;
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          const style = getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
          const bounds = { x: rect.left - rootRect.left, y: rect.top - rootRect.top, width: rect.width, height: rect.height };
          const commonStyle = {
            fill: color(style.backgroundColor),
            stroke: color(style.borderTopColor),
            strokeWidth: parseFloat(style.borderTopWidth) || undefined,
            radius: parseFloat(style.borderTopLeftRadius) || undefined,
            opacity: Number(style.opacity) || 1,
            color: color(style.color),
            fontFamily: style.fontFamily.split(',')[0]?.replace(/["']/g, '').trim(),
            fontSize: parseFloat(style.fontSize) || undefined,
            fontWeight: parseInt(style.fontWeight, 10) || undefined,
            italic: style.fontStyle === 'italic',
            textAlign: ['left','center','right'].includes(style.textAlign) ? style.textAlign : 'left',
            shadow: style.boxShadow !== 'none' ? style.boxShadow : undefined
          };
          const sourceId = element.id || element.getAttribute('data-ppt-id') || 'html-' + (index + 1);
          if (element.hasAttribute('data-pptx-latex')) {
            elements.push({ sourceId, type: 'formula', bounds, style: commonStyle, latex: element.getAttribute('data-pptx-latex') || '', zIndex: Number(style.zIndex) || index });
            return;
          }
          if (element.hasAttribute('data-pptx-chart')) {
            const chartType = element.getAttribute('data-pptx-chart') || 'column';
            const categories = JSON.parse(element.getAttribute('data-pptx-categories') || '[]');
            const series = JSON.parse(element.getAttribute('data-pptx-series') || '[]');
            const rows = [['', ...series.map(item => String(item.name || '数据'))], ...categories.map((category, rowIndex) => [String(category), ...series.map(item => String(item.values?.[rowIndex] ?? 0))])];
            elements.push({ sourceId, type: 'chart', bounds, style: commonStyle, chartType, rows, zIndex: Number(style.zIndex) || index });
            return;
          }
          if (element.tagName === 'IMG') {
            elements.push({ sourceId, type: 'image', bounds, style: commonStyle, src: element.getAttribute('src') || '', zIndex: Number(style.zIndex) || index });
            return;
          }
          if (element.tagName === 'SVG') {
            elements.push({ sourceId, type: 'svg', bounds, style: commonStyle, svg: element.outerHTML, zIndex: Number(style.zIndex) || index });
            return;
          }
          if (element.tagName === 'TABLE') {
            const rows = Array.from(element.querySelectorAll('tr')).map(row => Array.from(row.querySelectorAll('th,td')).map(cell => cleanText(cell.textContent)));
            elements.push({ sourceId, type: 'table', bounds, style: commonStyle, rows, zIndex: Number(style.zIndex) || index });
            return;
          }
          const directText = cleanText(Array.from(element.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(' '));
          const semanticText = ['H1','H2','H3','H4','H5','H6','P','SPAN','LI'].includes(element.tagName) ? cleanText(element.textContent) : directText;
          const hasVisualBox = color(style.backgroundColor) || parseFloat(style.borderTopWidth) > 0;
          if (hasVisualBox) elements.push({ sourceId: sourceId + '-box', type: 'shape', bounds, style: commonStyle, zIndex: Number(style.zIndex) || index });
          if (semanticText) elements.push({ sourceId: sourceId + '-text', type: 'text', bounds, style: commonStyle, text: semanticText, zIndex: (Number(style.zIndex) || index) + 0.1 });
        });
        const rootStyle = getComputedStyle(root);
        const notes = document.querySelector('[data-ppt-notes]')?.textContent?.trim();
        return { width: rootRect.width || ${DEFAULT_WIDTH}, height: rootRect.height || ${DEFAULT_HEIGHT}, background: color(rootStyle.backgroundColor) || '#FFFFFF', notes, elements, warnings: [] };
      })()`)) as PptCompiledSlide
      return result
    } finally {
      window.destroy()
    }
  } catch {
    return null
  }
}

const fallbackBounds = (
  style: Record<string, string>,
  parent: PptBounds,
  index: number,
  siblingCount: number
): PptBounds => {
  const width = toNumber(style.width, parent.width) ?? parent.width * 0.8
  const height =
    toNumber(style.height, parent.height) ??
    Math.max(48, parent.height / Math.max(2, siblingCount + 1))
  const x =
    parent.x +
    (toNumber(style.left, parent.width) ??
      toNumber(style['margin-left'], parent.width) ??
      parent.width * 0.1)
  const y =
    parent.y + (toNumber(style.top, parent.height) ?? parent.height * 0.08 + index * (height + 18))
  return { x, y, width, height }
}

const fallbackStyle = (style: Record<string, string>): PptElementStyle => ({
  fill: normalizeColor(style['background-color'] || style.background),
  stroke: normalizeColor(style['border-color']),
  strokeWidth: toNumber(style['border-width']),
  radius: toNumber(style['border-radius']),
  opacity: toNumber(style.opacity) ?? 1,
  rotation: style.transform?.includes('rotate')
    ? toNumber(/rotate\(([-\d.]+)/.exec(style.transform)?.[1])
    : undefined,
  shadow: style['box-shadow'],
  color: normalizeColor(style.color, '#222222'),
  fontFamily: style['font-family']?.split(',')[0]?.replace(/["']/g, '').trim() || 'Arial',
  fontSize: toNumber(style['font-size']) ?? 32,
  fontWeight:
    Number.parseInt(style['font-weight'] || '400', 10) ||
    (style['font-weight'] === 'bold' ? 700 : 400),
  italic: style['font-style'] === 'italic',
  textAlign:
    style['text-align'] === 'center' || style['text-align'] === 'right'
      ? style['text-align']
      : 'left'
})

const layoutFallback = (html: string): PptCompiledSlide => {
  const $ = load(html)
  const root = $('[data-ppt-slide]').first().length
    ? $('[data-ppt-slide]').first()
    : $('body').children().not('style,meta,link').first()
  const rootStyle = parseStyleText(root.attr('style'))
  const width = toNumber(rootStyle.width) ?? DEFAULT_WIDTH
  const height = toNumber(rootStyle.height) ?? DEFAULT_HEIGHT
  const elements: PptCompiledElement[] = []
  const children = root
    .find('*')
    .filter((_index, element) => !['style', 'meta', 'link'].includes(element.tagName))
  children.each((index, element) => {
    const node = $(element)
    const style = parseStyleText(node.attr('style'))
    const bounds = fallbackBounds(style, { x: 0, y: 0, width, height }, index, children.length)
    const elementStyle = fallbackStyle(style)
    const sourceId = node.attr('id') || node.attr('data-ppt-id') || `html-${index + 1}`
    const tag = element.tagName.toLowerCase()
    if (node.attr('data-pptx-latex')) {
      elements.push({
        sourceId,
        type: 'formula',
        bounds,
        style: elementStyle,
        latex: node.attr('data-pptx-latex'),
        zIndex: index
      })
      return
    }
    if (node.attr('data-pptx-chart')) {
      const chartType = node.attr('data-pptx-chart') || 'column'
      const categories = JSON.parse(node.attr('data-pptx-categories') || '[]') as unknown[]
      const series = JSON.parse(node.attr('data-pptx-series') || '[]') as Array<{
        name?: unknown
        values?: unknown[]
      }>
      const rows = [
        ['', ...series.map((item) => String(item.name || '数据'))],
        ...categories.map((category, rowIndex) => [
          String(category),
          ...series.map((item) => String(item.values?.[rowIndex] ?? 0))
        ])
      ]
      elements.push({
        sourceId,
        type: 'chart',
        bounds,
        style: elementStyle,
        chartType: chartType as PptCompiledElement['chartType'],
        rows,
        zIndex: index
      })
      return
    }
    if (tag === 'img') {
      elements.push({
        sourceId,
        type: 'image',
        bounds,
        style: elementStyle,
        src: node.attr('src') || '',
        zIndex: index
      })
      return
    }
    if (tag === 'svg') {
      elements.push({
        sourceId,
        type: 'svg',
        bounds,
        style: elementStyle,
        svg: $.html(node),
        zIndex: index
      })
      return
    }
    if (tag === 'table') {
      const rows = node
        .find('tr')
        .toArray()
        .map((row) =>
          $(row)
            .find('th,td')
            .toArray()
            .map((cell) => $(cell).text().trim())
        )
      elements.push({ sourceId, type: 'table', bounds, style: elementStyle, rows, zIndex: index })
      return
    }
    const directText = node
      .contents()
      .filter((_childIndex, child) => child.type === 'text')
      .text()
      .replace(/\s+/g, ' ')
      .trim()
    const semanticText = /^h[1-6]$|p|span|li/.test(tag)
      ? node.text().replace(/\s+/g, ' ').trim()
      : directText
    if (elementStyle.fill || elementStyle.stroke) {
      elements.push({
        sourceId: `${sourceId}-box`,
        type: 'shape',
        bounds,
        style: elementStyle,
        zIndex: index
      })
    }
    if (semanticText) {
      elements.push({
        sourceId: `${sourceId}-text`,
        type: 'text',
        bounds,
        style: elementStyle,
        text: semanticText,
        zIndex: index + 0.1
      })
    }
  })
  return {
    width,
    height,
    background:
      normalizeColor(rootStyle['background-color'] || rootStyle.background, '#FFFFFF') || '#FFFFFF',
    notes: $('[data-ppt-notes]').first().text().trim() || undefined,
    elements,
    warnings: ['当前环境使用确定性 HTML 布局回退；实际应用会使用 Chromium 计算布局。']
  }
}

export const compilePptSlideHtml = async (html: string): Promise<PptCompiledSlide> => {
  const sanitized = sanitizeHtml(html)
  const compiled = (await layoutWithElectron(sanitized)) || layoutFallback(sanitized)
  if (compiled.width <= 0 || compiled.height <= 0) throw new Error('页面尺寸无效')
  const chartTypes = new Set(['bar', 'column', 'line', 'pie', 'doughnut', 'area'])
  const invalidChart = compiled.elements.find(
    (element) =>
      element.type === 'chart' &&
      (!element.chartType || !chartTypes.has(element.chartType) || (element.rows?.length || 0) < 2)
  )
  if (invalidChart) throw new Error(`图表配置无效: ${invalidChart.sourceId}`)
  const outside = compiled.elements.filter(
    (element) =>
      element.bounds.x < 0 ||
      element.bounds.y < 0 ||
      element.bounds.x + element.bounds.width > compiled.width + 1 ||
      element.bounds.y + element.bounds.height > compiled.height + 1
  )
  if (outside.length > 0) {
    compiled.warnings.push(`有 ${outside.length} 个元素超出页面范围。`)
  }
  return compiled
}
