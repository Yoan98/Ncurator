import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Typography } from 'antd'
import { parseRefHref, renderReferenceIcon } from './markdownReference'

interface MarkdownRendererProps {
  content: string
  className?: string
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className }) => {
  return (
    <div className={`markdown-body ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
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
                style={vscDarkPlus}
                language={match[1]}
                PreTag="div"
                className="!my-0 rounded-md"
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            ) : (
              <code
                {...props}
                className={`${className} bg-gray-100 text-red-500 px-1 py-0.5 rounded text-sm font-mono`}
              >
                {children}
              </code>
            )
          },
          // Custom styling for other elements
          p: ({ children }) => (
            <Typography.Paragraph className="!mb-2 leading-relaxed text-[#1F1F1F]">
              {children}
            </Typography.Paragraph>
          ),
          h1: ({ children }) => (
            <Typography.Title level={3} className="!mt-4 !mb-2">
              {children}
            </Typography.Title>
          ),
          h2: ({ children }) => (
            <Typography.Title level={4} className="!mt-3 !mb-2">
              {children}
            </Typography.Title>
          ),
          h3: ({ children }) => (
            <Typography.Title level={5} className="!mt-2 !mb-1">
              {children}
            </Typography.Title>
          ),
          ul: ({ children }) => <ul className="list-disc pl-5 mb-2">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2">{children}</ol>,
          li: ({ children }) => <li className="mb-1 text-[#1F1F1F]">{children}</li>,
          a: ({ href, children }) => {
            const parsed = parseRefHref(href)
            if (parsed.type === 'reference') {
              const label = parsed.label || String(children)
              return (
                <a
                  href={href}
                  className="inline-flex items-center gap-1 rounded-full border border-[#E8C8BD] bg-[#FFF7F2] px-2 py-0.5 text-[#B85C38] hover:bg-[#FDEADB]"
                  data-ref-path={parsed.path}
                >
                  {renderReferenceIcon(label, parsed.path)}
                  <span>{children}</span>
                </a>
              )
            }

            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#D97757] hover:underline"
              >
                {children}
              </a>
            )
          },
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-[#D97757] pl-4 italic text-gray-500 my-2">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="min-w-full divide-y divide-gray-200 border">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
          th: ({ children }) => (
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 whitespace-nowrap text-sm border-b">{children}</td>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownRenderer
