import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { MarkdownLinkAccessEntry } from '../../../shared/types'
import {
  normalizeRefMarkdownLinks,
  repairInlineCodeWrappedNcuratorLinks,
  renderReferenceIcon,
  resolveMarkdownLinkForRender,
  transformAssistantMarkdownUrl,
  type OpenableMarkdownReference
} from './markdownReference'

interface MarkdownRendererProps {
  content: string
  className?: string
  variant?: 'default' | 'thought'
  linkAccess?: MarkdownLinkAccessEntry[]
  onOpenReference?: (reference: OpenableMarkdownReference) => void
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className,
  variant = 'default',
  linkAccess,
  onOpenReference
}) => {
  const normalizedContent = React.useMemo(
    () => normalizeRefMarkdownLinks(repairInlineCodeWrappedNcuratorLinks(content)),
    [content]
  )

  return (
    <div
      className={`markdown-body ${variant === 'thought' ? 'markdown-body--thought' : ''} ${className || ''}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={transformAssistantMarkdownUrl}
        components={{
          code({
            inline,
            className,
            children,
            ...props
          }: {
            inline?: boolean
            className?: string
            children?: React.ReactNode
          } & React.HTMLAttributes<HTMLElement>) {
            const match = /language-(\w+)/.exec(className || '')
            return !inline && match ? (
              <SyntaxHighlighter
                {...props}
                style={oneLight}
                language={match[1]}
                PreTag="div"
                className="markdown-code-block !my-0"
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            ) : (
              <code {...props} className={`markdown-inline-code ${className || ''}`}>
                {children}
              </code>
            )
          },
          p: ({ children }) => <p>{children}</p>,
          h1: ({ children }) => <h1>{children}</h1>,
          h2: ({ children }) => <h2>{children}</h2>,
          h3: ({ children }) => <h3>{children}</h3>,
          ul: ({ children }) => <ul>{children}</ul>,
          ol: ({ children }) => <ol>{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          a: ({ href, children }) => {
            const label = String(children)
            const resolved = resolveMarkdownLinkForRender({ href, linkAccess, label })

            if (resolved.mode === 'unavailable') {
              return (
                <span
                  className="markdown-reference-unavailable"
                  title="链接无法访问"
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
                    if (!onOpenReference) return
                    event.preventDefault()
                    onOpenReference(reference)
                  }}
                >
                  <span className="markdown-reference-icon">
                    {renderReferenceIcon(reference.resourceType)}
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
          blockquote: ({ children }) => <blockquote>{children}</blockquote>,
          table: ({ children }) => (
            <div className="markdown-table-wrap">
              <table>{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead>{children}</thead>,
          th: ({ children }) => <th>{children}</th>,
          td: ({ children }) => <td>{children}</td>
        }}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  )
}

export default React.memo(MarkdownRenderer)
