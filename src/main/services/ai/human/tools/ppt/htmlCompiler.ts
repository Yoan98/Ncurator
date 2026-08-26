import { load } from 'cheerio'
import type { PptBounds, PptCompiledElement, PptCompiledSlide, PptElementStyle } from './types'

export const PPT_CANVAS_WIDTH = 1920
export const PPT_CANVAS_HEIGHT = 1080

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

const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li'])
const ELEMENT_TYPES = new Set([
  'text',
  'shape',
  'image',
  'svg',
  'table',
  'chart',
  'formula',
  'line'
])

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

const assertRestrictedCss = (html: string): void => {
  const unsupported =
    /(?:^|[;{])\s*(filter|backdrop-filter|mask(?:-image)?|mix-blend-mode|animation(?:-name|-duration|-timing-function|-iteration-count)?|transition(?:-property|-duration|-timing-function|-delay)?)\s*:/i
  const match = unsupported.exec(html)
  if (match) throw new Error(`不支持的 CSS 属性：${match[1]}`)
}

const assertCanvasSize = (styleText: string | undefined): void => {
  const style = parseStyleText(styleText)
  const width = style.width && toNumber(style.width)
  const height = style.height && toNumber(style.height)
  if (width !== undefined && width !== PPT_CANVAS_WIDTH) {
    throw new Error('幻灯片根元素尺寸必须为 1920x1080。')
  }
  if (height !== undefined && height !== PPT_CANVAS_HEIGHT) {
    throw new Error('幻灯片根元素尺寸必须为 1920x1080。')
  }
}

/** Converts browser/CSS colors to the six digit format accepted by pptx-kit. */
export const normalizePptColor = (
  value: string | undefined,
  fallback?: string
): string | undefined => {
  const raw = String(value || '').trim()
  if (!raw || raw === 'transparent' || /^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/i.test(raw)) {
    return fallback
  }
  const short = /^#([0-9a-f]{3})$/i.exec(raw)
  if (short)
    return `#${short[1]!
      .split('')
      .map((part) => `${part}${part}`)
      .join('')}`.toUpperCase()
  const hex = /^#([0-9a-f]{6})$/i.exec(raw)
  if (hex) return `#${hex[1]!.toUpperCase()}`
  const rgb =
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(
      raw
    )
  if (rgb) {
    const alpha = rgb[4]
      ? rgb[4].endsWith('%')
        ? Number(rgb[4].slice(0, -1)) / 100
        : Number(rgb[4])
      : 1
    if (alpha <= 0) return fallback
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
    grey: '#808080',
    transparent: '#FFFFFF'
  }
  return names[raw.toLowerCase()] || fallback
}

const mergeRootStyle = (styleText: string | undefined): string => {
  const style = parseStyleText(styleText)
  style.position ||= 'relative'
  style.width ||= `${PPT_CANVAS_WIDTH}px`
  style.height ||= `${PPT_CANVAS_HEIGHT}px`
  style.overflow ||= 'hidden'
  style['box-sizing'] ||= 'border-box'
  return Object.entries(style)
    .map(([key, value]) => `${key}:${value}`)
    .join(';')
}

const sanitizeHtml = (html: string): string => {
  const source = String(html || '').trim()
  if (!source) throw new Error('PPT 幻灯片 HTML 不能为空。')
  const $ = load(source)
  const forbidden = [...FORBIDDEN_TAGS].filter((tag) => $(tag).length > 0)
  if (forbidden.length > 0) throw new Error(`不支持的 HTML 标签：${forbidden.join(', ')}`)
  const roots = $('[data-ppt-slide]')
  if (roots.length !== 1) throw new Error('HTML 必须且只能包含一个 data-ppt-slide 根元素。')
  const root = roots.first()
  assertCanvasSize(root.attr('style'))
  assertRestrictedCss(source)
  root.attr('style', mergeRootStyle(root.attr('style')))
  $('*').each((_index, element) => {
    if (!('attribs' in element)) return
    const node = $(element)
    const style = parseStyleText(node.attr('style'))
    const tagName = 'tagName' in element ? element.tagName.toLowerCase() : ''
    if (TEXT_TAGS.has(tagName) && !style.margin) style.margin = '0'
    if (Object.keys(style).length > 0 && !style['box-sizing']) {
      style['box-sizing'] = 'border-box'
      node.attr(
        'style',
        Object.entries(style)
          .map(([key, value]) => `${key}:${value}`)
          .join(';')
      )
    }
    for (const name of Object.keys(element.attribs || {})) {
      if (name.toLowerCase().startsWith('on')) node.removeAttr(name)
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
      width: PPT_CANVAS_WIDTH,
      height: PPT_CANVAS_HEIGHT,
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
      return (await window.webContents.executeJavaScript(`(async () => {
        await document.fonts.ready;
        const root = document.querySelector('[data-ppt-slide]');
        if (!root) throw new Error('缺少 data-ppt-slide 根元素。');
        const rootRect = root.getBoundingClientRect();
        const cleanText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const color = (value) => {
          if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)') return undefined;
          const match = /^rgba?\\(\\s*(\\d+)\\s*[, ]\\s*(\\d+)\\s*[, ]\\s*(\\d+)(?:\\s*[,/]\\s*([\\d.]+%?))?\\s*\\)$/i.exec(value);
          if (match && match[4] && Number(match[4].replace('%', '')) === 0) return undefined;
          if (!match) return value;
          return '#' + [match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, '0')).join('').toUpperCase();
        };
        const px = (value) => { const n = Number.parseFloat(value || ''); return Number.isFinite(n) ? n : undefined; };
        const sameBorder = (borders) => {
          const values = Object.values(borders).filter(Boolean);
          return values.length === 4 && values.every((item) => item.color === values[0].color && item.width === values[0].width);
        };
        const styleOf = (element) => {
          const style = getComputedStyle(element);
          const borders = {
            top: { color: color(style.borderTopColor), width: px(style.borderTopWidth) || 0 },
            right: { color: color(style.borderRightColor), width: px(style.borderRightWidth) || 0 },
            bottom: { color: color(style.borderBottomColor), width: px(style.borderBottomWidth) || 0 },
            left: { color: color(style.borderLeftColor), width: px(style.borderLeftWidth) || 0 }
          };
          const activeBorders = Object.fromEntries(Object.entries(borders).filter(([, item]) => item.width > 0));
          const uniform = sameBorder(borders);
          return {
            fill: color(style.backgroundColor),
            stroke: uniform ? borders.top.color : undefined,
            strokeWidth: uniform ? borders.top.width : undefined,
            borders: uniform ? undefined : activeBorders,
            radius: px(style.borderTopLeftRadius) || undefined,
            opacity: Number(style.opacity) || 1,
            rotation: (() => { const match = /rotate\\(([-\\d.]+)deg\\)/i.exec(style.transform); return match ? Number(match[1]) : undefined; })(),
            color: color(style.color),
            fontFamily: style.fontFamily.split(',')[0]?.replace(/["']/g, '').trim(),
            fontSize: px(style.fontSize) || undefined,
            fontWeight: Number.parseInt(style.fontWeight, 10) || undefined,
            italic: style.fontStyle === 'italic',
            textAlign: ['left','center','right'].includes(style.textAlign) ? style.textAlign : 'left',
            verticalAlign: style.alignItems === 'center' ? 'middle' : undefined,
            shadow: style.boxShadow !== 'none' ? style.boxShadow : undefined
          };
        };
        const explicitType = (element) => {
          const value = element.getAttribute('data-ppt-element');
          return value && ${JSON.stringify([...ELEMENT_TYPES])}.includes(value) ? value : undefined;
        };
        const hasExplicitAncestor = (element) => Boolean(element.parentElement?.closest('[data-ppt-element]'));
        const semanticText = (element) => ['H1','H2','H3','H4','H5','H6','P','LI'].includes(element.tagName) ? cleanText(element.textContent) : '';
        const directText = (element) => cleanText(Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(' '));
        const elements = [];
        const candidates = Array.from(root.querySelectorAll('[data-ppt-element], [data-pptx-latex], [data-pptx-chart], img, svg, table, h1, h2, h3, h4, h5, h6, p, li, div'));
        candidates.forEach((element, index) => {
          if (element === root || element.closest('[data-ppt-slide]') !== root) return;
          const type = explicitType(element) || (element.hasAttribute('data-pptx-latex') ? 'formula' : element.hasAttribute('data-pptx-chart') ? 'chart' : element.tagName === 'IMG' ? 'image' : element.tagName === 'SVG' ? 'svg' : element.tagName === 'TABLE' ? 'table' : ${JSON.stringify([...TEXT_TAGS]).toUpperCase()}.includes(element.tagName) && !hasExplicitAncestor(element) ? 'text' : undefined);
          const style = getComputedStyle(element);
          const hasVisualBox = Boolean(color(style.backgroundColor)) || Number.parseFloat(style.borderTopWidth) > 0 || Boolean(element.getAttribute('data-ppt-element') === 'shape');
          const inferredText = !hasExplicitAncestor(element) ? (semanticText(element) || directText(element)) : '';
          const inferredType = type || (inferredText ? 'text' : hasVisualBox && !hasExplicitAncestor(element) ? 'shape' : undefined);
          if (!inferredType) return;
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
          const bounds = { x: rect.left - rootRect.left, y: rect.top - rootRect.top, width: rect.width, height: rect.height };
          const common = styleOf(element);
          const sourceId = element.id || element.getAttribute('data-ppt-id') || ('html-' + (index + 1));
          const zIndex = Number(style.zIndex);
          const z = Number.isFinite(zIndex) ? zIndex : index;
          if (inferredType === 'formula') {
            elements.push({ sourceId, type: 'formula', bounds, style: common, latex: element.getAttribute('data-pptx-latex') || '', zIndex: z });
            return;
          }
          if (inferredType === 'chart') {
            let categories = []; let series = [];
            try { categories = JSON.parse(element.getAttribute('data-pptx-categories') || '[]'); series = JSON.parse(element.getAttribute('data-pptx-series') || '[]'); } catch { throw new Error('图表数据无效：' + sourceId); }
            const rows = [['', ...series.map((item) => String(item.name || 'Data'))], ...categories.map((category, rowIndex) => [String(category), ...series.map((item) => String(item.values?.[rowIndex] ?? 0))])];
            elements.push({ sourceId, type: 'chart', bounds, style: common, chartType: element.getAttribute('data-pptx-chart') || 'column', rows, zIndex: z });
            return;
          }
          if (inferredType === 'image') {
            elements.push({ sourceId, type: 'image', bounds, style: common, src: element.getAttribute('src') || '', imageFit: style.objectFit === 'contain' ? 'contain' : style.objectFit === 'cover' ? 'cover' : 'fill', zIndex: z });
            return;
          }
          if (inferredType === 'svg') {
            elements.push({ sourceId, type: 'svg', bounds, style: common, svg: element.outerHTML, zIndex: z });
            return;
          }
          if (inferredType === 'table') {
            const rows = Array.from(element.querySelectorAll('tr')).map((row) => Array.from(row.querySelectorAll('th,td')).map((cell) => cleanText(cell.textContent)));
            elements.push({ sourceId, type: 'table', bounds, style: common, rows, zIndex: z });
            return;
          }
          if (inferredType === 'line') {
            const from = { x: 0, y: 0 }; const to = { x: bounds.width, y: bounds.height };
            elements.push({ sourceId, type: 'line', bounds, style: common, line: { from, to }, zIndex: z });
            return;
          }
          if (inferredType === 'text') {
            const text = semanticText(element) || directText(element) || cleanText(element.textContent);
            if (text) elements.push({ sourceId, type: 'text', bounds, style: common, text, zIndex: z });
            return;
          }
          elements.push({ sourceId, type: 'shape', bounds, style: common, zIndex: z });
        });
        const rootStyle = getComputedStyle(root);
        const issues = [];
        if (Math.abs(rootRect.width - ${PPT_CANVAS_WIDTH}) > 0.5 || Math.abs(rootRect.height - ${PPT_CANVAS_HEIGHT}) > 0.5) issues.push('幻灯片根元素尺寸必须为 1920x1080。');
        candidates.forEach((element) => { const style = getComputedStyle(element); if (style.filter !== 'none' || style.mixBlendMode !== 'normal' || style.animationName !== 'none') issues.push('存在不支持的 CSS：' + (element.id || element.tagName) + '。'); });
        return { width: ${PPT_CANVAS_WIDTH}, height: ${PPT_CANVAS_HEIGHT}, background: color(rootStyle.backgroundColor) || '#FFFFFF', notes: document.querySelector('[data-ppt-notes]')?.textContent?.trim(), elements, issues };
      })()`)) as PptCompiledSlide
    } finally {
      window.destroy()
    }
  } catch (error) {
    if (error instanceof Error && /不支持的 CSS|图表|1920x1080/.test(error.message))
      throw error
    return null
  }
}

const layoutWithPlaywright = async (html: string): Promise<PptCompiledSlide | null> => {
  if (process.versions.electron) return null
  let browser: Awaited<ReturnType<(typeof import('playwright'))['chromium']['launch']>> | undefined
  try {
    const { chromium } = await import('playwright')
    const channels = process.platform === 'win32' ? ['msedge', 'chrome'] : ['chrome', 'msedge']
    for (const channel of channels) {
      try {
        browser = await chromium.launch({ channel, headless: true })
        break
      } catch {
        browser = undefined
      }
    }
    if (!browser) return null
    const page = await browser.newPage({
      viewport: { width: PPT_CANVAS_WIDTH, height: PPT_CANVAS_HEIGHT }
    })
    await page.setContent(html, { waitUntil: 'load' })
    const positionedHtml = await page.evaluate(
      async ({ elementTypes, textTags }) => {
        await document.fonts.ready
        const root = document.querySelector<HTMLElement>('[data-ppt-slide]')
        if (!root) throw new Error('Missing data-ppt-slide root.')
        const rootRect = root.getBoundingClientRect()
        const cleanText = (value: string | null | undefined) =>
          String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
        const candidates = Array.from(
          root.querySelectorAll<HTMLElement>(
            '[data-ppt-element], [data-pptx-latex], [data-pptx-chart], img, svg, table, h1, h2, h3, h4, h5, h6, p, li, div'
          )
        )
        const records = candidates.flatMap((element, index) => {
          if (element.closest('[data-ppt-slide]') !== root) return []
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          if (
            rect.width <= 0 ||
            rect.height <= 0 ||
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            Number(style.opacity) === 0
          )
            return []
          const explicit = element.getAttribute('data-ppt-element')
          const hasExplicitAncestor = Boolean(element.parentElement?.closest('[data-ppt-element]'))
          const directText = cleanText(
            Array.from(element.childNodes)
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.textContent)
              .join(' ')
          )
          const semanticText = textTags.includes(element.tagName)
            ? cleanText(element.textContent)
            : ''
          const hasVisualBox =
            style.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
            Number.parseFloat(style.borderTopWidth) > 0 ||
            explicit === 'shape'
          const inferred =
            explicit && elementTypes.includes(explicit)
              ? explicit
              : element.hasAttribute('data-pptx-latex')
                ? 'formula'
                : element.hasAttribute('data-pptx-chart')
                  ? 'chart'
                  : element.tagName === 'IMG'
                    ? 'image'
                    : element.tagName === 'SVG'
                      ? 'svg'
                      : element.tagName === 'TABLE'
                        ? 'table'
                        : !hasExplicitAncestor && (semanticText || directText)
                          ? 'text'
                          : !hasExplicitAncestor && hasVisualBox
                            ? 'shape'
                            : undefined
          if (!inferred) return []
          const propertyNames = [
            'background-color',
            'border-top-color',
            'border-top-width',
            'border-right-color',
            'border-right-width',
            'border-bottom-color',
            'border-bottom-width',
            'border-left-color',
            'border-left-width',
            'border-radius',
            'opacity',
            'transform',
            'box-shadow',
            'color',
            'font-family',
            'font-size',
            'font-weight',
            'font-style',
            'text-align',
            'object-fit'
          ]
          const declarations = [
            'position:absolute',
            `left:${rect.left - rootRect.left}px`,
            `top:${rect.top - rootRect.top}px`,
            `width:${rect.width}px`,
            `height:${rect.height}px`,
            `z-index:${Number.isFinite(Number(style.zIndex)) ? style.zIndex : index}`,
            ...propertyNames.map((name) => `${name}:${style.getPropertyValue(name)}`)
          ]
          return [{ element, declarations }]
        })
        records.forEach(({ element, declarations }) =>
          element.setAttribute('style', declarations.join(';'))
        )
        return document.documentElement.outerHTML
      },
      { elementTypes: [...ELEMENT_TYPES], textTags: [...TEXT_TAGS].map((tag) => tag.toUpperCase()) }
    )
    const compiled = layoutFallback(positionedHtml)
    return {
      ...compiled,
      issues: compiled.issues.filter(
        (warning) =>
          warning !== 'Chromium layout was unavailable; explicit element bounds were used.'
      )
    }
  } catch {
    return null
  } finally {
    await browser?.close().catch(() => undefined)
  }
}

const fallbackBounds = (
  style: Record<string, string>,
  parent: PptBounds,
  index: number,
  siblingCount: number
): PptBounds => ({
  x: parent.x + (toNumber(style.left, parent.width) ?? parent.width * 0.08),
  y: parent.y + (toNumber(style.top, parent.height) ?? parent.height * 0.08 + index * 24),
  width: toNumber(style.width, parent.width) ?? parent.width * 0.8,
  height:
    toNumber(style.height, parent.height) ??
    Math.max(48, parent.height / Math.max(2, siblingCount + 1))
})

const fallbackStyle = (style: Record<string, string>): PptElementStyle => {
  const borderSpec = (side: 'top' | 'right' | 'bottom' | 'left') => {
    const shorthand = style[`border-${side}`] || style.border
    const width =
      style[`border-${side}-width`] ||
      style['border-width'] ||
      shorthand?.match(/(?:^|\s)(\d+(?:\.\d+)?)(?:px|pt)?(?:\s|$)/i)?.[1]
    const color =
      style[`border-${side}-color`] ||
      style['border-color'] ||
      shorthand?.match(/(#[0-9a-f]{3,8}|rgba?\([^)]*\)|[a-z]+)\s*$/i)?.[1]
    return { color: normalizePptColor(color), width: toNumber(width) || 0 }
  }
  const sides = (['top', 'right', 'bottom', 'left'] as const).map((side) => ({
    side,
    ...borderSpec(side)
  }))
  const activeSides = sides.filter((item) => item.width > 0 && item.color)
  const uniform =
    activeSides.length === 4 &&
    activeSides.every(
      (item) => item.color === activeSides[0]!.color && item.width === activeSides[0]!.width
    )
  return {
    fill: normalizePptColor(style['background-color'] || style.background),
    stroke: uniform ? activeSides[0]!.color : undefined,
    strokeWidth: uniform ? activeSides[0]!.width : undefined,
    borders: uniform
      ? undefined
      : (Object.fromEntries(
          activeSides.map((item) => [item.side, { color: item.color!, width: item.width }])
        ) as PptElementStyle['borders']),
    radius: toNumber(style['border-radius']),
    opacity: toNumber(style.opacity) ?? 1,
    rotation: style.transform?.includes('rotate')
      ? toNumber(/rotate\(([-\d.]+)/.exec(style.transform)?.[1])
      : undefined,
    shadow: style['box-shadow'] && style['box-shadow'] !== 'none' ? style['box-shadow'] : undefined,
    color: normalizePptColor(style.color, '#222222'),
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
  }
}

const layoutFallback = (html: string): PptCompiledSlide => {
  const $ = load(html)
  const root = $('[data-ppt-slide]').first()
  const rootStyle = parseStyleText(root.attr('style'))
  const width = toNumber(rootStyle.width) ?? PPT_CANVAS_WIDTH
  const height = toNumber(rootStyle.height) ?? PPT_CANVAS_HEIGHT
  const elements: PptCompiledElement[] = []
  const candidates = root.find(
    '[data-ppt-element], [data-pptx-latex], [data-pptx-chart], img, svg, table, h1, h2, h3, h4, h5, h6, p, li, div'
  )
  candidates.each((index, element) => {
    const node = $(element)
    const tag = element.tagName.toLowerCase()
    const explicit = node.attr('data-ppt-element')
    const hasExplicitAncestor = Boolean(
      element.parent && $(element.parent).closest('[data-ppt-element]').length > 0
    )
    const directText = node
      .contents()
      .filter((_childIndex, child) => child.type === 'text')
      .text()
      .replace(/\s+/g, ' ')
      .trim()
    const style = parseStyleText(node.attr('style'))
    const hasVisualBox = Boolean(
      style['background-color'] ||
      style.background ||
      toNumber(style['border-width']) ||
      toNumber(style['border-top-width']) ||
      style.border ||
      style['border-top']
    )
    const type =
      explicit && ELEMENT_TYPES.has(explicit)
        ? explicit
        : node.attr('data-pptx-latex')
          ? 'formula'
          : node.attr('data-pptx-chart')
            ? 'chart'
            : tag === 'img'
              ? 'image'
              : tag === 'svg'
                ? 'svg'
                : tag === 'table'
                  ? 'table'
                  : TEXT_TAGS.has(tag) && !hasExplicitAncestor
                    ? 'text'
                    : directText && !hasExplicitAncestor
                      ? 'text'
                      : hasVisualBox && !hasExplicitAncestor
                        ? 'shape'
                        : undefined
    if (!type) return
    const bounds = fallbackBounds(style, { x: 0, y: 0, width, height }, index, candidates.length)
    const elementStyle = fallbackStyle(style)
    const sourceId = node.attr('id') || node.attr('data-ppt-id') || `html-${index + 1}`
    if (type === 'formula')
      elements.push({
        sourceId,
        type: 'formula',
        bounds,
        style: elementStyle,
        latex: node.attr('data-pptx-latex'),
        zIndex: index
      })
    else if (type === 'chart') {
      const categories = JSON.parse(node.attr('data-pptx-categories') || '[]') as unknown[]
      const series = JSON.parse(node.attr('data-pptx-series') || '[]') as Array<{
        name?: unknown
        values?: unknown[]
      }>
      const rows = [
        ['', ...series.map((item) => String(item.name || 'Data'))],
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
        chartType: node.attr('data-pptx-chart') as PptCompiledElement['chartType'],
        rows,
        zIndex: index
      })
    } else if (type === 'image')
      elements.push({
        sourceId,
        type: 'image',
        bounds,
        style: elementStyle,
        src: node.attr('src') || '',
        imageFit:
          style['object-fit'] === 'contain'
            ? 'contain'
            : style['object-fit'] === 'cover'
              ? 'cover'
              : 'fill',
        zIndex: index
      })
    else if (type === 'svg')
      elements.push({
        sourceId,
        type: 'svg',
        bounds,
        style: elementStyle,
        svg: $.html(node),
        zIndex: index
      })
    else if (type === 'table')
      elements.push({
        sourceId,
        type: 'table',
        bounds,
        style: elementStyle,
        rows: node
          .find('tr')
          .toArray()
          .map((row) =>
            $(row)
              .find('th,td')
              .toArray()
              .map((cell) => $(cell).text().trim())
          ),
        zIndex: index
      })
    else if (type === 'text')
      elements.push({
        sourceId,
        type: 'text',
        bounds,
        style: elementStyle,
        text: node.text().replace(/\s+/g, ' ').trim(),
        zIndex: index
      })
    else elements.push({ sourceId, type: 'shape', bounds, style: elementStyle, zIndex: index })
  })
  return {
    width: PPT_CANVAS_WIDTH,
    height: PPT_CANVAS_HEIGHT,
    background:
      normalizePptColor(rootStyle['background-color'] || rootStyle.background, '#FFFFFF') ||
      '#FFFFFF',
    elements,
    issues: ['Chromium layout was unavailable; explicit element bounds were used.']
  }
}

export const compilePptSlideHtml = async (html: string): Promise<PptCompiledSlide> => {
  const sanitized = sanitizeHtml(html)
  const restrictedHtml = load(sanitized)
  const unsupportedBackgrounds = restrictedHtml('[style]')
    .toArray()
    .flatMap((node) => {
      const style = parseStyleText(restrictedHtml(node).attr('style') || '')
      const background = `${style.background || ''} ${style['background-image'] || ''}`
      return /(?:gradient|url\s*\()/i.test(background)
        ? [restrictedHtml(node).attr('id') || node.tagName.toLowerCase()]
        : []
    })
  if (unsupportedBackgrounds.length > 0) {
    throw new Error(
      `元素 ${unsupportedBackgrounds.slice(0, 6).join(', ')} 使用了不支持的 CSS 背景，请改用纯 background-color 或 <img> 元素。`
    )
  }
  const compiled =
    (await layoutWithElectron(sanitized)) ||
    (await layoutWithPlaywright(sanitized)) ||
    layoutFallback(sanitized)
  compiled.width = PPT_CANVAS_WIDTH
  compiled.height = PPT_CANVAS_HEIGHT
  const invalidChart = compiled.elements.find(
    (element) => element.type === 'chart' && (!element.chartType || (element.rows?.length || 0) < 2)
  )
  if (invalidChart) throw new Error(`图表配置无效：${invalidChart.sourceId}`)
  const outside = compiled.elements.filter(
    (element) =>
      element.bounds.x < -1 ||
      element.bounds.y < -1 ||
      element.bounds.x + element.bounds.width > PPT_CANVAS_WIDTH + 1 ||
      element.bounds.y + element.bounds.height > PPT_CANVAS_HEIGHT + 1
  )
  if (outside.length > 0) {
    const details = outside
      .slice(0, 6)
      .map((element) => {
        const { x, y, width, height } = element.bounds
        return `${element.sourceId} (x=${Math.round(x)}, y=${Math.round(y)}, width=${Math.round(width)}, height=${Math.round(height)}, right=${Math.round(x + width)}, bottom=${Math.round(y + height)})`
      })
      .join('; ')
    throw new Error(
      `${outside.length} 个 PPT 元素超出 1920x1080 幻灯片边界：${details}。请保证 right <= 1920 且 bottom <= 1080。`
    )
  }
  const blockingIssues = compiled.issues.filter((issue) =>
    /不支持的 CSS|1920x1080/.test(issue)
  )
  if (blockingIssues.length > 0) throw new Error(blockingIssues.join(' '))
  if (compiled.elements.length === 0)
    throw new Error('PPT 幻灯片中没有任何受支持的视觉元素。')
  return compiled
}
