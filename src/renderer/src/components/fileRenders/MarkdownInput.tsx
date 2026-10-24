import { useEffect, useLayoutEffect, useRef } from 'react'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import './markdownEditor.css'
import { getRendererRuntime, t } from '../../i18n'
import { vditorI18n } from './vditorI18n'

/** Markdown editing only. The owner controls whether and when content is saved. */
export default function MarkdownInput(props: {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  authoring?: boolean
  placeholder?: string
  testId?: string
  onRoot?: (root: HTMLDivElement | null) => void
  onReady?: () => void
  onImage?: (element: HTMLImageElement) => void
  onLink?: (element: Element) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const editor = useRef<Vditor | null>(null)
  const ready = useRef(false)
  const baseline = useRef('')
  const current = useRef(props)
  useLayoutEffect(() => {
    current.current = props
  })
  useEffect(() => {
    if (!root.current) return
    // Vditor loads Lute asynchronously and can finish after effect cleanup. Each
    // instance owns a separate node so a stale init/destroy cannot erase its successor.
    const host = document.createElement('div')
    host.className = `h-full w-full ${props.authoring ? 'nc-markdown-author' : 'nc-markdown-reader'}`
    root.current.appendChild(host)
    let active = true
    let initialized = false
    current.current.onRoot?.(root.current)
    const instance = new Vditor(host, {
      mode: 'ir',
      lang: getRendererRuntime().locale === 'zh-CN' ? 'zh_CN' : 'en_US',
      i18n: vditorI18n,
      toolbar: props.authoring
        ? [
            'headings',
            'bold',
            'italic',
            '|',
            'list',
            'check',
            'quote',
            'code',
            'link',
            'table',
            '|',
            'undo',
            'redo'
          ]
        : [],
      // Icons are loaded once by index.html; Vditor's synchronous inline loader violates CSP.
      icon: undefined,
      cache: { enable: false },
      value: current.current.value,
      cdn: new URL('vditor', document.baseURI).href,
      placeholder: props.placeholder ?? t(($) => $.editors.startTyping),
      hint: props.authoring
        ? {
            delay: 80,
            parse: true,
            extend: [
              {
                key: '/',
                hint: (query) => {
                  const blocks = [
                    { label: vditorI18n.heading1, markdown: '# ' },
                    { label: vditorI18n.heading2, markdown: '## ' },
                    { label: vditorI18n.heading3, markdown: '### ' },
                    { label: vditorI18n.list, markdown: '- ' },
                    { label: vditorI18n.check, markdown: '- [ ] ' },
                    { label: vditorI18n.quote, markdown: '> ' },
                    { label: vditorI18n.code, markdown: '```\n\n```' }
                  ]
                  return blocks
                    .filter((block) => block.label.toLowerCase().includes(query.toLowerCase()))
                    .map((block) => ({
                      html: block.label,
                      value: instance.vditor.lute.Md2VditorIRDOM(block.markdown)
                    }))
                }
              }
            ]
          }
        : {},
      link: { click: (element) => current.current.onLink?.(element) },
      image: { preview: (element) => current.current.onImage?.(element as HTMLImageElement) },
      preview: {
        delay: 80,
        hljs: { enable: true, lineNumber: false, style: 'a11y-light' },
        math: { engine: 'KaTeX' },
        markdown: { gfmAutoLink: true, footnotes: true }
      },
      input: (value) => {
        if (active && ready.current && value !== baseline.current) {
          baseline.current = value
          current.current.onChange(value)
        }
      },
      after: () => {
        initialized = true
        if (!active) {
          instance.destroy()
          return
        }
        if (instance.getValue() !== current.current.value) instance.setValue(current.current.value)
        baseline.current = instance.getValue()
        ready.current = true
        if (current.current.readOnly) instance.disabled()
        current.current.onReady?.()
      }
    })
    editor.current = instance
    return () => {
      active = false
      ready.current = false
      editor.current = null
      current.current.onRoot?.(null)
      host.remove()
      try {
        if (initialized) instance.destroy()
      } catch (error) {
        console.error('[APP-ERROR] markdown editor disposal failed', error)
      }
    }
  }, [props.authoring, props.placeholder])
  useEffect(() => {
    if (ready.current && editor.current && editor.current.getValue() !== props.value) {
      ready.current = false
      editor.current.setValue(props.value)
      baseline.current = editor.current.getValue()
      ready.current = true
    }
  }, [props.value])
  useEffect(() => {
    if (!ready.current || !editor.current) return
    if (props.readOnly) editor.current.disabled()
    else editor.current.enable()
  }, [props.readOnly])
  const emitCurrent = (): void => {
    if (!ready.current || !editor.current || current.current.readOnly) return
    const value = editor.current.getValue()
    if (value !== baseline.current) {
      baseline.current = value
      current.current.onChange(value)
    }
  }
  return (
    <div
      ref={root}
      data-testid={props.testId}
      className="h-full w-full overflow-hidden bg-white"
      onInputCapture={(event) => {
        if ((event.nativeEvent as InputEvent).isComposing) return
        // Read after Vditor normalizes the DOM, without waiting for its undo debounce.
        queueMicrotask(emitCurrent)
      }}
      onCompositionEnd={() => queueMicrotask(emitCurrent)}
      onBlurCapture={emitCurrent}
    />
  )
}
