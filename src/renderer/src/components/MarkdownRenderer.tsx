import { t } from '../i18n'
import React, { useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { MarkdownLinkAccessEntry } from '../../../shared/types'
import { splitStableMarkdown } from '../../../shared/streamingMarkdown'
import {
  findMarkdownLinkAccess,
  normalizeRefMarkdownLinks,
  repairInlineCodeWrappedNcuratorLinks,
  repairMarkdownLinkDestinations,
  renderReferenceIcon,
  resolveMarkdownLinkForRender,
  transformAssistantMarkdownUrl,
  type OpenableMarkdownReference
} from './markdownReference'
import MarkdownImage, { type MarkdownPreviewImage } from './markdownImage'
import remarkGfmNoAutolink from './remarkGfmNoAutolink'
import { useStreamingMarkdownAnimation } from '../utils/renderPreferences'
import { useAppearance } from '../contexts/AppearanceContext'
import { useTypewriterText } from '../utils/streamingTypewriter'

interface MarkdownRendererProps {
  content: string
  className?: string
  variant?: 'default' | 'thought'
  linkAccess?: MarkdownLinkAccessEntry[]
  /** Path of the Markdown file being rendered; enables relative image sources. */
  sourceFilePath?: string
  /** Text is still arriving: render closed blocks once, type out the tail. */
  streaming?: boolean
  /** This block is the live tail of a running turn: paint the breathing dot after it. */
  liveTail?: boolean
  onOpenReference?: (reference: OpenableMarkdownReference) => void
  onOpenImage?: (image: MarkdownPreviewImage) => void
}

const LANGUAGE_CLASS_RE = /language-([\w-]+)/

type ComponentOptions = {
  linkAccess?: MarkdownLinkAccessEntry[]
  sourceFilePath?: string
  onOpenReference?: (reference: OpenableMarkdownReference) => void
  onOpenImage?: (image: MarkdownPreviewImage) => void
  /** Streaming tail: skip syntax highlighting and image loading until closed. */
  deferHeavy?: boolean
  /** 代码块高亮主题需跟页面明暗同步，否则暗色下会出现亮底代码块。 */
  codeTheme?: 'light' | 'dark'
}

const createMarkdownComponents = (options: ComponentOptions): Components => ({
  code(props) {
    const language = LANGUAGE_CLASS_RE.exec(props.className || '')?.[1]
    const text = String(props.children).replace(/\n$/, '')
    if (!language || options.deferHeavy) {
      // Block code keeps the <pre> shell from react-markdown; the stylesheet
      // strips the inline-code chrome for `pre > code` (see base.css).
      return <code className="markdown-inline-code">{text}</code>
    }
    return (
      <SyntaxHighlighter
        style={options.codeTheme === 'dark' ? oneDark : oneLight}
        language={language}
        PreTag="div"
        className="markdown-code-block !my-0"
      >
        {text}
      </SyntaxHighlighter>
    )
  },
  a({ href, children }) {
    const label = String(children)
    const resolved = resolveMarkdownLinkForRender({
      href,
      linkAccess: options.linkAccess,
      label
    })

    if (resolved.mode === 'unavailable') {
      return (
        <span
          className="markdown-reference-unavailable"
          title={t(($) => $.common.linkUnavailable)}
          data-ref-access-status="unavailable"
        >
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{children}</span>
        </span>
      )
    }

    if (resolved.mode === 'openable') {
      const { reference } = resolved
      return (
        <a
          href={href}
          className="markdown-reference-link"
          data-ref-path={reference.path}
          data-ref-resource-type={reference.resourceType}
          onClick={(event) => {
            // 即使回调缺失也要拦住默认导航，避免 Electron 整页闪白
            event.preventDefault()
            if (!options.onOpenReference) return
            options.onOpenReference(reference)
          }}
        >
          <span className="markdown-reference-icon">
            {renderReferenceIcon({
              resourceType: reference.resourceType,
              path: reference.path
            })}
          </span>
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{children}</span>
        </a>
      )
    }

    return (
      <a
        href={resolved.href}
        className="markdown-normal-link"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    )
  },
  img({ src, alt, title }) {
    if (options.deferHeavy) {
      // The destination may still be half-typed; never probe the disk for it.
      return (
        <span className="markdown-image-pending" title={title}>
          {alt || t(($) => $.editors.image)}
        </span>
      )
    }
    const access = findMarkdownLinkAccess(options.linkAccess, src || '')
    return (
      <MarkdownImage
        src={src}
        alt={alt}
        title={title}
        sourceFilePath={options.sourceFilePath}
        unavailable={access?.accessStatus === 'unavailable'}
        onOpen={options.onOpenImage}
      />
    )
  },
  table({ children }) {
    return (
      <div className="markdown-table-wrap">
        <table>{children}</table>
      </div>
    )
  }
})

const MarkdownSegment: React.FC<{ text: string; components: Components }> = ({
  text,
  components
}) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfmNoAutolink, [remarkMath, { singleDollarTextMath: false }] as const]}
    rehypePlugins={[rehypeKatex]}
    urlTransform={transformAssistantMarkdownUrl}
    components={components}
  >
    {text}
  </ReactMarkdown>
)

/** Closed blocks are parsed once; re-renders only happen when they grow. */
const StableMarkdownSegment = React.memo(MarkdownSegment)

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className,
  variant = 'default',
  linkAccess,
  sourceFilePath,
  streaming = false,
  liveTail = false,
  onOpenReference,
  onOpenImage
}) => {
  const normalizedContent = useMemo(
    () =>
      repairMarkdownLinkDestinations(
        normalizeRefMarkdownLinks(repairInlineCodeWrappedNcuratorLinks(content))
      ),
    [content]
  )

  const animateStream = useStreamingMarkdownAnimation()
  const codeTheme = useAppearance().resolved
  const split = useMemo(
    () =>
      streaming ? splitStableMarkdown(normalizedContent) : { stable: normalizedContent, tail: '' },
    [normalizedContent, streaming]
  )
  const displayedTail = useTypewriterText(split.tail, streaming && animateStream)

  // Component identity must stay stable across renders: react-markdown turns this
  // map into element types, so a new map remounts the whole subtree (and re-reads
  // images) on every streamed token.
  const { full, light } = useMemo(
    () => ({
      full: createMarkdownComponents({
        linkAccess,
        sourceFilePath,
        onOpenReference,
        onOpenImage,
        codeTheme
      }),
      light: createMarkdownComponents({
        linkAccess: undefined,
        sourceFilePath,
        onOpenReference,
        onOpenImage,
        deferHeavy: true,
        codeTheme
      })
    }),
    [linkAccess, sourceFilePath, onOpenReference, onOpenImage, codeTheme]
  )

  return (
    <div
      className={`markdown-body ${variant === 'thought' ? 'markdown-body--thought' : ''} ${className || ''}`}
      data-live-tail={liveTail ? 'true' : undefined}
    >
      {split.stable ? <StableMarkdownSegment text={split.stable} components={full} /> : null}
      {displayedTail ? (
        <div className="markdown-stream-tail">
          <MarkdownSegment text={displayedTail} components={light} />
        </div>
      ) : null}
    </div>
  )
}

export default React.memo(MarkdownRenderer)
