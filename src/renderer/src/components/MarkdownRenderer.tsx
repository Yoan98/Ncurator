import React from 'react'
import { message } from 'antd'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  parseRefHref,
  normalizeRefMarkdownLinks,
  renderReferenceIcon,
  type ParsedNcuratorRefKind,
  type ParsedNcuratorRefResourceType
} from './markdownReference'

interface MarkdownRendererProps {
  content: string
  className?: string
  onOpenReference?: (reference: {
    kind: ParsedNcuratorRefKind
    resourceType: ParsedNcuratorRefResourceType
    label: string
    path: string
  }) => void
}

const transformMarkdownUrl = (url: string): string => {
  if (url.startsWith('ncurator://ref?')) {
    return url
  }
  return defaultUrlTransform(url)
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className,
  onOpenReference
}) => {
  const normalizedContent = React.useMemo(() => normalizeRefMarkdownLinks(content), [content])

  return (
    <div className={`markdown-body ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={transformMarkdownUrl}
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
            const parsed = parseRefHref(href)
            if (parsed.type === 'reference') {
              const label = parsed.label || String(children)
              if (parsed.kind === 'reference' && parsed.accessStatus === 'unavailable') {
                return (
                  <span
                    className="markdown-reference-unavailable"
                    data-ref-path={parsed.path}
                    data-ref-kind={parsed.kind}
                    data-ref-resource-type={parsed.resourceType}
                    data-ref-access-status={parsed.accessStatus}
                  >
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{children}</span>
                  </span>
                )
              }
              return (
                <a
                  href={href}
                  className="markdown-reference-link"
                  data-ref-path={parsed.path}
                  data-ref-kind={parsed.kind}
                  data-ref-resource-type={parsed.resourceType}
                  data-ref-access-status={
                    parsed.kind === 'reference' ? parsed.accessStatus : undefined
                  }
                  onClick={(event) => {
                    if (!onOpenReference) return
                    event.preventDefault()
                    onOpenReference({
                      kind: parsed.kind,
                      resourceType: parsed.resourceType,
                      label,
                      path: parsed.path
                    })
                  }}
                >
                  <span className="markdown-reference-icon">
                    {renderReferenceIcon({
                      kind: parsed.kind,
                      resourceType: parsed.resourceType
                    })}
                  </span>
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">{children}</span>
                </a>
              )
            }

            if (parsed.type === 'invalid') {
              return (
                <a
                  href={href}
                  className="markdown-reference-link markdown-reference-link-invalid"
                  title="引用链接格式无效，无法打开"
                  data-ref-invalid-reason={parsed.reason}
                  onClick={(event) => {
                    event.preventDefault()
                    void message.warning('引用链接格式无效，无法打开')
                  }}
                >
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">{children}</span>
                </a>
              )
            }

            return (
              <a
                href={href}
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
