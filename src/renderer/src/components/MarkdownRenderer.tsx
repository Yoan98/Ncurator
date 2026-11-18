import { t } from '../i18n'
import React, { useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { MarkdownLinkAccessEntry } from '../../../shared/types'
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

interface MarkdownRendererProps {
  content: string
  className?: string
  variant?: 'default' | 'thought'
  linkAccess?: MarkdownLinkAccessEntry[]
  /** Path of the Markdown file being rendered; enables relative image sources. */
  sourceFilePath?: string
  onOpenReference?: (reference: OpenableMarkdownReference) => void
  onOpenImage?: (image: MarkdownPreviewImage) => void
}

const LANGUAGE_CLASS_RE = /language-([\w-]+)/

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className,
  variant = 'default',
  linkAccess,
  sourceFilePath,
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

  // Component identity must stay stable across renders: react-markdown turns this
  // map into element types, so a new map remounts the whole subtree (and re-reads
  // images) on every streamed token.
  const components = useMemo<Components>(
    () => ({
      code(props) {
        const language = LANGUAGE_CLASS_RE.exec(props.className || '')?.[1]
        const text = String(props.children).replace(/\n$/, '')
        if (!language) {
          // Block code keeps the <pre> shell from react-markdown; the stylesheet
          // strips the inline-code chrome for `pre > code` (see base.css).
          return <code className="markdown-inline-code">{text}</code>
        }
        return (
          <SyntaxHighlighter
            style={oneLight}
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
        const resolved = resolveMarkdownLinkForRender({ href, linkAccess, label })

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
                if (!onOpenReference) return
                onOpenReference(reference)
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
        const access = findMarkdownLinkAccess(linkAccess, src || '')
        return (
          <MarkdownImage
            src={src}
            alt={alt}
            title={title}
            sourceFilePath={sourceFilePath}
            unavailable={access?.accessStatus === 'unavailable'}
            onOpen={onOpenImage}
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
    }),
    [linkAccess, sourceFilePath, onOpenReference, onOpenImage]
  )

  return (
    <div
      className={`markdown-body ${variant === 'thought' ? 'markdown-body--thought' : ''} ${className || ''}`}
    >
      <ReactMarkdown
        remarkPlugins={[
          remarkGfmNoAutolink,
          [remarkMath, { singleDollarTextMath: false }] as const
        ]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={transformAssistantMarkdownUrl}
        components={components}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  )
}

export default React.memo(MarkdownRenderer)
