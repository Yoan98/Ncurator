import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Dropdown, Input, InputNumber, Modal, Select, Tooltip, message } from 'antd'
import {
  PiArrowCounterClockwise,
  PiArrowClockwise,
  PiTextB,
  PiTextItalic,
  PiTextUnderline,
  PiTextStrikethrough,
  PiTextAlignLeft,
  PiTextAlignCenter,
  PiTextAlignRight,
  PiTextAlignJustify,
  PiTextAUnderline,
  PiHighlighter,
  PiEraser,
  PiPaintBrush,
  PiListBullets,
  PiListNumbers,
  PiTextIndent,
  PiTextOutdent,
  PiTextT,
  PiCaretDown,
  PiMagnifyingGlass,
  PiArrowsClockwise,
  PiImage,
  PiLinkSimple,
  PiTable,
  PiHash,
  PiList,
  PiRows,
  PiColumns,
  PiArrowsMerge,
  PiArrowsSplit,
  PiTrash,
  PiPlus,
  PiMinus,
  PiArrowsOutLineHorizontal,
  PiArrowsDownUp
} from 'react-icons/pi'
import type { SuperDoc } from 'superdoc'
import type { BuiltInCommandId, SelectionTarget } from 'superdoc/ui'
import DocxColorPicker from './DocxColorPicker'
import DocxSearch from './DocxSearch'
import { getRendererRuntime, t } from '../../i18n'
import './docxToolbar.css'

type Labels = ReturnType<typeof labels>
const labels = () => t(($) => $.editors.wordToolbar, { returnObjects: true })
const sizes = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 48, 72]
const chineseSizes: Record<number, string> = {
  9: '小五',
  10.5: '五号',
  12: '小四',
  14: '四号',
  15: '小三',
  16: '三号',
  18: '小二',
  22: '二号',
  24: '小一',
  26: '一号',
  36: '小初',
  42: '初号'
}

export default function DocxToolbar({
  editor,
  writable,
  container
}: {
  editor?: SuperDoc
  writable: boolean
  container: HTMLElement | null
}) {
  const root = useRef<HTMLDivElement>(null)
  const [, update] = useState(0)
  const [pending, setPending] = useState(false)
  const working = useRef(false)
  const [tab, setTab] = useState<'home' | 'insert' | 'table'>('home')
  const [search, setSearch] = useState<'find' | 'replace' | null>(null)
  const [dialog, setDialog] = useState<'link' | 'table' | null>(null)
  const [url, setUrl] = useState('')
  const [rows, setRows] = useState(3),
    [columns, setColumns] = useState(3)
  const selection = useRef<SelectionTarget | null>(null)
  const image = useRef<HTMLInputElement>(null)
  const text = labels()
  const ribbon = t(($) => $.editors.wordRibbon, { returnObjects: true })
  const styleLabels = t(($) => $.editors.wordStyles, { returnObjects: true })
  const styleName = (style: { name: string; builtin: boolean; custom: boolean }) => {
    if (!style.builtin || style.custom) return style.name
    const name = style.name.toLowerCase().replace(/\s/g, '')
    const heading = /^heading([1-9])$/.exec(name)
    if (heading) return t(($) => $.editors.wordStyles.heading, { value1: heading[1] })
    return styleLabels[name as keyof typeof styleLabels] || style.name
  }
  const alignment = t(($) => $.editors.wordAlignment, { returnObjects: true })
  const capture = () => {
    selection.current = editor?.ui.selection.getSnapshot().selectionTarget ?? null
  }
  const openSearch = (mode: 'find' | 'replace') => {
    capture()
    setSearch(mode)
  }
  const closeSearch = () => {
    setSearch(null)
    if (selection.current) void editor?.ui.selection.applyAndWait(selection.current)
  }
  useEffect(() => {
    selection.current = null
    setSearch(null)
    setDialog(null)
    if (!editor) return
    let frame = 0
    const refresh = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => update((n) => n + 1))
    }
    const off = [
      editor.ui.toolbar.observe(refresh),
      editor.ui.fonts.observe(refresh),
      editor.ui.styles.observe(refresh)
    ]
    return () => {
      off.forEach((stop) => stop())
      cancelAnimationFrame(frame)
    }
  }, [editor])
  useEffect(() => {
    if (!editor || !container) return
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return
      const key = event.key.toLowerCase()
      if (key !== 'f' && !(key === 'h' && writable && !event.metaKey)) return
      if (!container.getClientRects().length) return
      const target = event.target
      if (
        target instanceof Node &&
        target !== document.body &&
        !root.current?.contains(target) &&
        !container.contains(target)
      )
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      selection.current = editor.ui.selection.getSnapshot().selectionTarget
      setSearch(key === 'h' ? 'replace' : 'find')
      // A repeated shortcut must refocus the same strip, too.
      requestAnimationFrame(() =>
        root.current?.querySelector<HTMLInputElement>('[role="search"] input')?.focus()
      )
    }
    window.addEventListener('keydown', shortcut, true)
    return () => window.removeEventListener('keydown', shortcut, true)
  }, [editor, container, writable])
  useEffect(() => {
    if (!editor || !container || !writable) return
    const painter = editor.ui.formatPainter
    let active = false,
      dragging = false
    const withinCanvas = (target: EventTarget | null) =>
      target instanceof Node && container.contains(target)
    // The SDK's built-in toolbar owns these notifications. A custom toolbar
    // must connect pointer/keyboard selection to the same public controller.
    const stop = painter.onModeChange((mode) => {
      active = mode !== 'idle'
      container.toggleAttribute('data-format-painter', active)
    })
    const down = (event: PointerEvent) => {
      if (!active || event.button !== 0 || !withinCanvas(event.target)) return
      dragging = true
      painter.setPointerSelecting(true)
    }
    const up = () => {
      if (!dragging) return
      dragging = false
      void painter.notifyPointerUp()
    }
    const keydown = (event: KeyboardEvent) => {
      if (!active) return
      if (event.key === 'Escape') painter.cancel()
      else if (
        withinCanvas(event.target) &&
        (event.shiftKey || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a'))
      )
        painter.setKeyboardSelecting(true)
    }
    const keyup = (event: KeyboardEvent) => {
      if (active && withinCanvas(event.target)) void painter.notifyKeyUp()
    }
    const cancel = () => {
      dragging = false
      painter.cancel()
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', keydown, true)
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', cancel)
    return () => {
      stop()
      cancel()
      container.removeAttribute('data-format-painter')
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', keydown, true)
      window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', cancel)
    }
  }, [editor, container, writable])
  const state = (id: BuiltInCommandId) => editor?.ui.commands.get(id).getState()
  const run = async (
    id: BuiltInCommandId,
    value?: object | string | number | null
  ): Promise<boolean> => {
    if (!editor || working.current || !writable) return false
    working.current = true
    setPending(true)
    try {
      if (selection.current && id !== 'undo' && id !== 'redo') {
        const restored = await editor.ui.selection.applyAndWait(selection.current)
        if (!restored.ok) {
          message.info(t(($) => $.editors.operationFailed))
          return false
        }
      }
      const result = await editor.ui.commands.executeAsync(id, value)
      if (result === false || (typeof result === 'object' && !result.success)) {
        message.info(t(($) => $.editors.operationFailed))
        return false
      }
      return true
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      working.current = false
      setPending(false)
      update((n) => n + 1)
    }
  }
  const button = (
    id: BuiltInCommandId,
    key: keyof Labels,
    icon: ReactNode,
    value?: string | number,
    name: string = text[key]
  ) => (
    <Tooltip title={name} key={id + String(value ?? '')}>
      <button
        type="button"
        data-item={`btn-${id}${value !== undefined ? '-' + value : ''}`}
        aria-label={name}
        aria-pressed={value === undefined ? Boolean(state(id)?.active) : state(id)?.value === value}
        disabled={!state(id)?.enabled || pending}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void run(id, value)}
      >
        {icon}
      </button>
    </Tooltip>
  )
  const menuItem = (id: BuiltInCommandId, key: keyof Labels) => ({
    key: id,
    label: text[key],
    disabled: !state(id)?.enabled || pending,
    onClick: () => void run(id)
  })
  const fonts = editor?.ui.fonts.getSnapshot()
  const fontOptions = [
    ...new Map([
      ...(fonts?.options || []).map(
        (font) => [font.value, { value: font.value, label: font.label }] as const
      ),
      ...['宋体', '黑体', '仿宋', '楷体', '微软雅黑', '苹方-简'].map(
        (value) => [value, { value, label: value }] as const
      )
    ]).values()
  ]
  // Catalogue reads are deferred by the SDK until explicitly requested. Merely
  // observing the quick gallery can leave a reopened document's styles empty.
  const catalog = writable ? editor?.ui.styles.getCatalog({ includePreview: true }) : null
  const quickStyles = editor?.ui.styles.getQuickGallery() || []
  const styles = (catalog?.styles || quickStyles).filter(
    (style) => style.type === 'paragraph' || style.type === 'linked'
  )
  const preferredStyles = ['normal', 'heading1', 'heading2'].flatMap((name) => {
    const style = styles.find(
      (s) => s.builtin && !s.custom && s.name.toLowerCase().replace(/\s/g, '') === name
    )
    return style ? [style] : []
  })
  const gallery = [
    ...new Map([...preferredStyles, ...quickStyles, ...styles].map((s) => [s.id, s])).values()
  ]
  const styleState = editor?.ui.styles.getSnapshot()
  const inTable = Boolean(editor?.ui.tables.isInTable())
  const activeTab = tab === 'table' && !inTable ? 'home' : tab
  const fontSize = Number.parseFloat(String(state('font-size')?.value ?? ''))
  const fontSizes = [
    ...new Set([
      ...sizes,
      ...Object.keys(chineseSizes).map(Number),
      ...(Number.isFinite(fontSize) ? [fontSize] : [])
    ])
  ].sort((a, b) => a - b)
  const color = (id: 'text-color' | 'highlight-color') => {
    const value = state(id)?.value
    return typeof value === 'string' && /^#?[\da-f]{6}$/i.test(value)
      ? '#' + value.replace(/^#/, '')
      : undefined
  }
  const changeSize = (grow: boolean) => {
    const current = Number.isFinite(fontSize) ? fontSize : 12
    const next = grow
      ? fontSizes.find((n) => n > current)
      : [...fontSizes].reverse().find((n) => n < current)
    if (next) void run('font-size', next)
  }
  return (
    <div ref={root} className="nc-docx-ribbon">
      <div
        role="toolbar"
        aria-label={ribbon.toolbar}
        onPointerDownCapture={(event) => {
          // React portals bubble here too. Freeze only when entering our toolbar,
          // not when typing in a dialog or choosing a color after focus has moved.
          if (event.target instanceof Node && event.currentTarget.contains(event.target)) capture()
        }}
      >
        <div className="nc-docx-ribbon-tabs">
          {writable && (
            <>
              {button('undo', 'undo', <PiArrowCounterClockwise />)}
              {button('redo', 'redo', <PiArrowClockwise />)}
              <span className="nc-docx-divider" />
              {(['home', 'insert', ...(inTable ? (['table'] as const) : [])] as const).map(
                (value) => (
                  <button
                    key={value}
                    type="button"
                    className="nc-docx-ribbon-tab"
                    aria-pressed={activeTab === value}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setTab(value)}
                  >
                    {ribbon[value]}
                  </button>
                )
              )}
            </>
          )}
          <span className="nc-docx-spacer" />
          <button type="button" disabled={!editor} onClick={() => openSearch('find')}>
            <PiMagnifyingGlass />
            <span>{text.search}</span>
          </button>
          {writable && (
            <button type="button" disabled={!editor} onClick={() => openSearch('replace')}>
              <PiArrowsClockwise />
              <span>{t(($) => $.editors.wordSearch.replace)}</span>
            </button>
          )}
        </div>
        {writable && activeTab === 'home' && (
          <div className="nc-docx-ribbon-home">
            <section className="nc-docx-font-group" aria-label={ribbon.font}>
              <div className="nc-docx-control-row">
                <Select
                  size="small"
                  showSearch
                  optionFilterProp="label"
                  popupMatchSelectWidth={260}
                  popupClassName="nc-docx-select-dropdown"
                  className="nc-docx-family"
                  aria-label={text['font-family']}
                  placeholder={t(($) => $.editors.mixed)}
                  value={String(state('font-family')?.value || '') || undefined}
                  disabled={!state('font-family')?.enabled || pending}
                  options={fontOptions}
                  onChange={(value) => void run('font-family', value)}
                />
                <Select
                  size="small"
                  showSearch
                  optionFilterProp="label"
                  popupMatchSelectWidth={160}
                  popupClassName="nc-docx-select-dropdown"
                  className="nc-docx-size"
                  aria-label={text['font-size']}
                  placeholder="—"
                  value={Number.isFinite(fontSize) ? fontSize : undefined}
                  disabled={!state('font-size')?.enabled || pending}
                  options={fontSizes.map((value) => ({
                    value,
                    label:
                      getRendererRuntime().locale === 'zh-CN' && chineseSizes[value]
                        ? `${chineseSizes[value]} (${value})`
                        : String(value)
                  }))}
                  labelRender={({ value }) =>
                    getRendererRuntime().locale === 'zh-CN' && chineseSizes[Number(value)]
                      ? chineseSizes[Number(value)]
                      : String(value)
                  }
                  onChange={(value) => void run('font-size', value)}
                  onInputKeyDown={(event) => {
                    if (
                      event.key !== 'Enter' ||
                      event.nativeEvent.isComposing ||
                      !(event.target instanceof HTMLInputElement)
                    )
                      return
                    const raw = event.target.value.trim()
                    const value =
                      Number(raw) ||
                      Number(Object.entries(chineseSizes).find(([, name]) => name === raw)?.[0])
                    if (value >= 1 && value <= 1638) {
                      event.preventDefault()
                      void run('font-size', value)
                    }
                  }}
                />
                <Tooltip title={ribbon.growFont}>
                  <button
                    type="button"
                    aria-label={ribbon.growFont}
                    disabled={!state('font-size')?.enabled || pending}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => changeSize(true)}
                  >
                    <PiTextT />
                    <sup>+</sup>
                  </button>
                </Tooltip>
                <Tooltip title={ribbon.shrinkFont}>
                  <button
                    type="button"
                    aria-label={ribbon.shrinkFont}
                    disabled={!state('font-size')?.enabled || pending}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => changeSize(false)}
                  >
                    <PiTextT />
                    <sup>−</sup>
                  </button>
                </Tooltip>
              </div>
              <div className="nc-docx-control-row">
                {button('bold', 'bold', <PiTextB />)}
                {button('italic', 'italic', <PiTextItalic />)}
                {button('underline', 'underline', <PiTextUnderline />)}
                {button('strikethrough', 'strikethrough', <PiTextStrikethrough />)}
                <span className="nc-docx-divider" />
                <DocxColorPicker
                  label={text['text-color']}
                  icon={<PiTextAUnderline />}
                  value={color('text-color')}
                  initialColor="#B3261E"
                  disabled={!state('text-color')?.enabled || pending}
                  capture={capture}
                  apply={(value) => run('text-color', value)}
                />
                <DocxColorPicker
                  label={text['highlight-color']}
                  icon={<PiHighlighter />}
                  value={color('highlight-color')}
                  initialColor="#FFFF00"
                  disabled={!state('highlight-color')?.enabled || pending}
                  capture={capture}
                  apply={(value) => run('highlight-color', value)}
                />
                <span className="nc-docx-divider" />
                {button('clear-formatting', 'clear-formatting', <PiEraser />)}
                {button('copy-format', 'copy-format', <PiPaintBrush />)}
              </div>
              <div className="nc-docx-group-label">{ribbon.font}</div>
            </section>
            <section className="nc-docx-paragraph-group" aria-label={t(($) => $.editors.paragraph)}>
              <div className="nc-docx-control-row">
                {button('bullet-list', 'bullet-list', <PiListBullets />)}
                {button('numbered-list', 'numbered-list', <PiListNumbers />)}
                {button('indent-decrease', 'indent-decrease', <PiTextOutdent />)}
                {button('indent-increase', 'indent-increase', <PiTextIndent />)}
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [1, 1.15, 1.5, 2].map((value) => ({
                      key: String(value),
                      label: `${text['line-height']} ${value}`,
                      disabled: !state('line-height')?.enabled || pending,
                      onClick: () => void run('line-height', value)
                    }))
                  }}
                >
                  <Tooltip title={text['line-height']}>
                    <button
                      type="button"
                      aria-label={text['line-height']}
                      disabled={!state('line-height')?.enabled || pending}
                    >
                      <PiArrowsDownUp />
                      <PiCaretDown className="nc-docx-caret" />
                    </button>
                  </Tooltip>
                </Dropdown>
              </div>
              <div className="nc-docx-control-row">
                {button('text-align', 'text-align', <PiTextAlignLeft />, 'left', alignment.left)}
                {button(
                  'text-align',
                  'text-align',
                  <PiTextAlignCenter />,
                  'center',
                  alignment.center
                )}
                {button('text-align', 'text-align', <PiTextAlignRight />, 'right', alignment.right)}
                {button(
                  'text-align',
                  'text-align',
                  <PiTextAlignJustify />,
                  'justify',
                  alignment.justify
                )}
              </div>
              <div className="nc-docx-group-label">{t(($) => $.editors.paragraph)}</div>
            </section>
            <section className="nc-docx-style-group" aria-label={text['linked-style']}>
              <div className="nc-docx-style-controls">
                <div className="nc-docx-style-gallery">
                  {gallery.slice(0, 3).map((style) => (
                    <Tooltip key={style.id} title={styleName(style)}>
                      <button
                        type="button"
                        aria-label={styleName(style)}
                        data-style-preview={
                          /^heading\s*1$/i.test(style.name)
                            ? 'heading1'
                            : /^heading\s*2$/i.test(style.name)
                              ? 'heading2'
                              : 'normal'
                        }
                        aria-pressed={styleState?.activeParagraphStyleId === style.id}
                        disabled={!state('linked-style')?.enabled || pending}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void run('linked-style', style.id)}
                      >
                        {styleName(style)}
                      </button>
                    </Tooltip>
                  ))}
                </div>
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: styles.map((style) => ({ key: style.id, label: styleName(style) })),
                    selectable: true,
                    selectedKeys: styleState?.activeParagraphStyleId
                      ? [styleState.activeParagraphStyleId]
                      : [],
                    style: { maxHeight: 280, overflowY: 'auto', minWidth: 180 },
                    onClick: ({ key }) => void run('linked-style', key)
                  }}
                >
                  <button
                    type="button"
                    className="nc-docx-style-more"
                    aria-label={ribbon.allStyles}
                    disabled={!state('linked-style')?.enabled || pending}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <PiCaretDown />
                  </button>
                </Dropdown>
                <Select
                  size="small"
                  showSearch
                  optionFilterProp="label"
                  popupMatchSelectWidth={220}
                  popupClassName="nc-docx-select-dropdown"
                  className="nc-docx-style-select"
                  aria-label={text['linked-style']}
                  placeholder={
                    styleState?.mixedSelection ? t(($) => $.editors.mixed) : text['linked-style']
                  }
                  value={styleState?.activeParagraphStyleId || undefined}
                  disabled={!state('linked-style')?.enabled || pending}
                  options={styles.map((style) => ({ value: style.id, label: styleName(style) }))}
                  onChange={(value) => void run('linked-style', value)}
                />
              </div>
              <div className="nc-docx-group-label">{text['linked-style-label']}</div>
            </section>
          </div>
        )}
        {writable && activeTab === 'insert' && (
          <div className="nc-docx-ribbon-insert">
            <button
              type="button"
              disabled={!state('table-insert')?.enabled || pending}
              onClick={() => setDialog('table')}
            >
              <PiTable />
              {text.table}
            </button>
            <button
              type="button"
              disabled={!state('image')?.enabled || pending}
              onClick={() => image.current?.click()}
            >
              <PiImage />
              {text.image}
            </button>
            <button
              type="button"
              disabled={!state('link')?.enabled || pending}
              onClick={() => setDialog('link')}
            >
              <PiLinkSimple />
              {text.link}
            </button>
            <button
              type="button"
              disabled={!state('page-numbers-apply')?.enabled || pending}
              aria-label={text['page-number']}
              onClick={() =>
                void run('page-numbers-apply', { kind: 'footer', alignment: 'center' })
              }
            >
              <PiHash />
              {text['page-number']}
            </button>
            {button(
              'table-of-contents-insert',
              'table-of-contents',
              <>
                <PiList />
                {text['table-of-contents']}
              </>
            )}
          </div>
        )}
        {writable && activeTab === 'table' && (
          <div className="nc-docx-ribbon-insert">
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  menuItem('table-add-row-before', 'insert-row-before'),
                  menuItem('table-add-row-after', 'insert-row-after')
                ]
              }}
            >
              <button type="button" disabled={pending}>
                <PiRows />
                {ribbon.insertRow}
                <PiCaretDown />
              </button>
            </Dropdown>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  menuItem('table-add-column-before', 'insert-column-before'),
                  menuItem('table-add-column-after', 'insert-column-after')
                ]
              }}
            >
              <button type="button" disabled={pending}>
                <PiColumns />
                {ribbon.insertColumn}
                <PiCaretDown />
              </button>
            </Dropdown>
            {button(
              'table-merge-cells',
              'merge-cells',
              <>
                <PiArrowsMerge />
                {text['merge-cells']}
              </>
            )}
            {button(
              'table-split-cell',
              'split-cell',
              <>
                <PiArrowsSplit />
                {text['split-cell']}
              </>
            )}
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  menuItem('table-delete-row', 'delete-row'),
                  menuItem('table-delete-column', 'delete-column'),
                  menuItem('table-delete', 'delete-table')
                ]
              }}
            >
              <button type="button" disabled={pending}>
                <PiTrash />
                {t(($) => $.common.delete)}
                <PiCaretDown />
              </button>
            </Dropdown>
          </div>
        )}
      </div>
      {editor && search && (
        <DocxSearch
          editor={editor}
          replaceVisible={writable && search === 'replace'}
          close={closeSearch}
        />
      )}
      <input
        hidden
        ref={image}
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) {
            const reader = new FileReader()
            reader.onload = () => void run('image', { src: String(reader.result) })
            reader.onerror = () => message.error(t(($) => $.editors.wordImageLoadFailed))
            reader.readAsDataURL(file)
          }
          event.target.value = ''
        }}
      />
      <Modal
        open={dialog !== null}
        title={dialog === 'link' ? text.link : text.table}
        onCancel={() => setDialog(null)}
        okText={t(($) => $.editors.apply)}
        confirmLoading={pending}
        onOk={async () => {
          if (
            await run(
              dialog === 'link' ? 'link' : 'table-insert',
              dialog === 'link' ? { href: url } : { rows, columns }
            )
          )
            setDialog(null)
        }}
      >
        {dialog === 'link' ? (
          <Input
            aria-label={t(($) => $.editors.linkUrl)}
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        ) : (
          <div className="flex gap-3">
            <label>
              {t(($) => $.editors.rows)}
              <InputNumber
                min={1}
                max={100}
                value={rows}
                onChange={(value) => setRows(value || 1)}
              />
            </label>
            <label>
              {t(($) => $.editors.columns)}
              <InputNumber
                min={1}
                max={20}
                value={columns}
                onChange={(value) => setColumns(value || 1)}
              />
            </label>
          </div>
        )}
      </Modal>
    </div>
  )
}

export function DocxStatusBar({
  editor,
  container
}: {
  editor?: SuperDoc
  container: HTMLElement | null
}) {
  const [zoom, setZoom] = useState(100)
  const [pages, setPages] = useState({ current: 0, total: 0 })
  useEffect(() => {
    if (!editor || !container) return
    const measure = () => {
      const nodes = [...container.querySelectorAll('.superdoc-page')]
      const top = container.getBoundingClientRect().top
      const index = nodes.findIndex((node) => node.getBoundingClientRect().bottom > top + 1)
      setPages({
        current:
          index < 0 ? 0 : Number((nodes[index] as HTMLElement).dataset.pageIndex || index) + 1,
        total: editor.activeEditor?.pageMetrics?.getSnapshot().pages.length || nodes.length
      })
    }
    const stopZoom = editor.ui.zoom.observe((value) => setZoom(value.value))
    const stopViewport = editor.ui.viewport.observe(measure)
    const stopMetrics = editor.activeEditor?.pageMetrics?.subscribe(measure)
    setZoom(editor.ui.zoom.getSnapshot().value)
    measure()
    return () => {
      stopZoom()
      stopViewport()
      stopMetrics?.()
    }
  }, [editor, container])
  return (
    <div className="nc-docx-statusbar">
      <span>
        {pages.total > 0
          ? t(($) => $.editors.wordRibbon.pageCount, { value1: pages.current, value2: pages.total })
          : ''}
      </span>
      <span className="nc-docx-spacer" />
      <Tooltip title={t(($) => $.editors.fitToWindow)}>
        <button
          type="button"
          aria-label={t(($) => $.editors.fitToWindow)}
          disabled={!editor}
          onClick={() => editor?.ui.zoom.setMode('fit-width')}
        >
          <PiArrowsOutLineHorizontal />
        </button>
      </Tooltip>
      <button
        type="button"
        aria-label={t(($) => $.editors.wordRibbon.zoomOut)}
        disabled={!editor}
        onClick={() => editor?.ui.zoom.set(Math.max(10, zoom - 10))}
      >
        <PiMinus />
      </button>
      <Select
        size="small"
        aria-label={labels().zoom}
        disabled={!editor}
        value={zoom}
        options={[...new Set([50, 75, 100, 125, 150, 200, zoom])]
          .sort((a, b) => a - b)
          .map((value) => ({ value, label: `${Math.round(value)}%` }))}
        onChange={(value) => editor?.ui.zoom.set(value)}
      />
      <button
        type="button"
        aria-label={t(($) => $.editors.wordRibbon.zoomIn)}
        disabled={!editor}
        onClick={() => editor?.ui.zoom.set(Math.min(500, zoom + 10))}
      >
        <PiPlus />
      </button>
    </div>
  )
}
