import { useEffect, useRef, useState } from 'react'
import { Dropdown, Input, InputNumber, Modal, Select, Tooltip, message } from 'antd'
import {
  PiArrowCounterClockwise,
  PiArrowClockwise,
  PiTextB,
  PiTextItalic,
  PiTextUnderline,
  PiTextAlignLeft,
  PiDotsThree,
  PiPlus,
  PiMagnifyingGlass
} from 'react-icons/pi'
import type { SuperDoc } from 'superdoc'
import type { BuiltInCommandId, SelectionTarget } from 'superdoc/ui'
import { t } from '../../i18n'

type Labels = ReturnType<typeof labels>
const labels = () => t(($) => $.editors.wordToolbar, { returnObjects: true })
export default function DocxToolbar({
  editor,
  writable
}: {
  editor?: SuperDoc
  writable: boolean
}) {
  const [, update] = useState(0)
  const [pending, setPending] = useState(false)
  const [dialog, setDialog] = useState<'link' | 'table' | null>(null)
  const [url, setUrl] = useState('')
  const [rows, setRows] = useState(3),
    [columns, setColumns] = useState(3)
  const selection = useRef<SelectionTarget | null>(null)
  const image = useRef<HTMLInputElement>(null)
  const text = labels()
  useEffect(() => {
    if (!editor) return
    let frame = 0
    const refresh = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => update((n) => n + 1))
    }
    const off = [
      editor.ui.toolbar.observe(refresh),
      editor.ui.fonts.observe(refresh),
      editor.ui.zoom.observe(refresh),
      editor.ui.styles.observe(refresh)
    ]
    return () => {
      off.forEach((stop) => stop())
      cancelAnimationFrame(frame)
    }
  }, [editor])
  const state = (id: BuiltInCommandId) => editor?.ui.commands.get(id).getState()
  const run = async (id: BuiltInCommandId, value?: object | string | number) => {
    if (!editor || pending) return
    setPending(true)
    try {
      if (selection.current && id !== 'undo' && id !== 'redo')
        await editor.ui.selection.applyAndWait(selection.current)
      const result = await editor.ui.commands.executeAsync(id, value)
      if (result === false || (typeof result === 'object' && !result.success))
        message.info(t(($) => $.editors.operationFailed))
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(false)
      update((n) => n + 1)
    }
  }
  const button = (id: BuiltInCommandId, key: keyof Labels, icon: React.ReactNode) => (
    <Tooltip title={text[key]} key={id}>
      <button
        type="button"
        data-item={`btn-${id}`}
        className={id === 'italic' || id === 'underline' ? 'nc-docx-toolbar-wide' : undefined}
        aria-label={text[key]}
        aria-pressed={Boolean(state(id)?.active)}
        disabled={!state(id)?.enabled || pending}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void run(id)}
      >
        {icon}
      </button>
    </Tooltip>
  )
  const menuItem = (id: BuiltInCommandId, key: keyof Labels, value?: object | string | number) => ({
    key: id + JSON.stringify(value ?? ''),
    label: text[key],
    disabled: !state(id)?.enabled || pending,
    onClick: () => void run(id, value)
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
  const styles = editor?.ui.styles.getQuickGallery() || []
  const inTable = editor?.ui.tables.isInTable()
  const paragraphItems = [
    menuItem('bullet-list', 'bullet-list'),
    menuItem('numbered-list', 'numbered-list'),
    menuItem('indent-decrease', 'indent-decrease'),
    menuItem('indent-increase', 'indent-increase'),
    ...[1, 1.15, 1.5, 2].map((value) => ({
      ...menuItem('line-height', 'line-height', value),
      label: `${text['line-height']} ${value}`
    }))
  ]
  const insertItems = [
    { key: 'link', label: text.link, onClick: () => setDialog('link') },
    { key: 'image', label: text.image, onClick: () => image.current?.click() },
    { key: 'table', label: text.table, onClick: () => setDialog('table') },
    menuItem('page-numbers-apply', 'page-number', {
      kind: 'footer',
      alignment: 'center'
    }),
    menuItem('table-of-contents-insert', 'table-of-contents')
  ]
  const fontSize = Number.parseFloat(String(state('font-size')?.value ?? ''))
  const zoom = editor?.ui.zoom.getSnapshot().value || 100

  return (
    <div
      role="toolbar"
      aria-label={text['linked-style']}
      className="nc-docx-toolbar"
      onPointerDownCapture={(event) => {
        if (event.target instanceof Node && event.currentTarget.contains(event.target))
          selection.current = editor?.ui.selection.getSnapshot().selectionTarget || null
      }}
    >
      {writable && (
        <>
          <span className="nc-docx-toolbar-group">
            {button('undo', 'undo', <PiArrowCounterClockwise />)}
            {button('redo', 'redo', <PiArrowClockwise />)}
          </span>
          <span className="nc-docx-toolbar-group nc-docx-toolbar-pickers">
            <Select
              size="small"
              className="nc-docx-toolbar-wide"
              aria-label={text['linked-style']}
              placeholder={text['linked-style']}
              value={String(state('linked-style')?.value || '') || undefined}
              disabled={!state('linked-style')?.enabled || pending}
              options={styles.map((style) => ({ value: style.id, label: style.name }))}
              onChange={(value) => void run('linked-style', value)}
            />
            <Select
              size="small"
              showSearch
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
              aria-label={text['font-size']}
              placeholder="—"
              value={Number.isFinite(fontSize) ? fontSize : undefined}
              disabled={!state('font-size')?.enabled || pending}
              options={[
                ...new Set([
                  ...(Number.isFinite(fontSize) ? [fontSize] : []),
                  8,
                  9,
                  10,
                  10.5,
                  11,
                  12,
                  14,
                  16,
                  18,
                  20,
                  22,
                  24,
                  26,
                  28,
                  32,
                  36,
                  48,
                  72
                ])
              ]
                .sort((a, b) => a - b)
                .map((value) => ({ value, label: String(value) }))}
              onChange={(value) => void run('font-size', value)}
            />
          </span>
          <span className="nc-docx-toolbar-group">
            {button('bold', 'bold', <PiTextB />)}
            {button('italic', 'italic', <PiTextItalic />)}
            {button('underline', 'underline', <PiTextUnderline />)}
            <Dropdown
              trigger={['click']}
              menu={{
                items: ['left', 'center', 'right', 'justify'].map((value) => ({
                  key: value,
                  label: (
                    <span data-item="btn-textAlign-option" aria-label={`Align ${value}`}>
                      {
                        t(($) => $.editors.wordAlignment, { returnObjects: true })[
                          value as 'left' | 'center' | 'right' | 'justify'
                        ]
                      }
                    </span>
                  ),
                  onClick: () => void run('text-align', value)
                }))
              }}
            >
              <Tooltip title={text['text-align']}>
                <button
                  type="button"
                  data-item="btn-textAlign"
                  aria-label={text['text-align']}
                  disabled={!state('text-align')?.enabled || pending}
                >
                  <PiTextAlignLeft />
                </button>
              </Tooltip>
            </Dropdown>
          </span>
          <Dropdown
            trigger={['click']}
            menu={{
              items: paragraphItems
            }}
          >
            <button type="button" className="nc-docx-toolbar-wide">
              {t(($) => $.editors.paragraph)}
            </button>
          </Dropdown>
          <Dropdown
            trigger={['click']}
            menu={{
              items: insertItems
            }}
          >
            <button type="button" className="nc-docx-toolbar-wide">
              <PiPlus />
              {t(($) => $.editors.insert)}
            </button>
          </Dropdown>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                {
                  key: 'paragraph',
                  label: t(($) => $.editors.paragraph),
                  children: paragraphItems
                },
                { key: 'insert', label: t(($) => $.editors.insert), children: insertItems },
                {
                  key: 'styles',
                  label: text['linked-style'],
                  children: styles.map((style) => ({
                    key: style.id,
                    label: style.name,
                    disabled: !state('linked-style')?.enabled,
                    onClick: () => void run('linked-style', style.id)
                  }))
                },
                menuItem('italic', 'italic'),
                menuItem('underline', 'underline'),
                menuItem('strikethrough', 'strikethrough'),
                menuItem('clear-formatting', 'clear-formatting'),
                menuItem('copy-format', 'copy-format'),
                {
                  key: 'colors',
                  label: (
                    <label>
                      {text['text-color']}
                      <input
                        type="color"
                        aria-label={text['text-color']}
                        onChange={(event) => void run('text-color', event.target.value)}
                      />
                    </label>
                  )
                },
                {
                  key: 'highlight-color',
                  label: (
                    <label>
                      {text['highlight-color']}
                      <input
                        type="color"
                        defaultValue="#fff2a8"
                        aria-label={text['highlight-color']}
                        onChange={(event) => void run('highlight-color', event.target.value)}
                      />
                    </label>
                  )
                },
                ...(inTable
                  ? [
                      menuItem('table-add-row-before', 'insert-row-before'),
                      menuItem('table-add-row-after', 'insert-row-after'),
                      menuItem('table-add-column-before', 'insert-column-before'),
                      menuItem('table-add-column-after', 'insert-column-after'),
                      menuItem('table-delete-row', 'delete-row'),
                      menuItem('table-delete-column', 'delete-column'),
                      menuItem('table-merge-cells', 'merge-cells'),
                      menuItem('table-split-cell', 'split-cell'),
                      menuItem('table-delete', 'delete-table')
                    ]
                  : [])
              ]
            }}
          >
            <Tooltip title={t(($) => $.editors.more)}>
              <button type="button" aria-label={t(($) => $.editors.more)}>
                <PiDotsThree />
              </button>
            </Tooltip>
          </Dropdown>
        </>
      )}
      <span className="nc-docx-toolbar-group ml-auto">
        <Tooltip title={text.search}>
          <button
            type="button"
            aria-label={text.search}
            disabled={!editor}
            onClick={() => editor?.ui.search.open()}
          >
            <PiMagnifyingGlass />
          </button>
        </Tooltip>
        <Select
          size="small"
          aria-label={text.zoom}
          disabled={!editor}
          value={zoom}
          options={[...new Set([50, 75, 100, 125, 150, 200, zoom])]
            .sort((a, b) => a - b)
            .map((value) => ({ value, label: `${Math.round(value)}%` }))}
          onChange={(value) => editor?.ui.zoom.set(value)}
        />
      </span>
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
        onOk={() => {
          void run(
            dialog === 'link' ? 'link' : 'table-insert',
            dialog === 'link' ? { href: url } : { rows, columns }
          )
          setDialog(null)
        }}
      >
        {dialog === 'link' ? (
          <Input
            aria-label={t(($) => $.editors.linkUrl)}
            placeholder="https://"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
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
