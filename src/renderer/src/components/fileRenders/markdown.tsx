import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'

const CustomMarkdownRenderer = ({ mainState }) => {
  const { currentDocument } = mainState
  const [markdownText, setMarkdownText] = useState('')

  useEffect(() => {
    if (!currentDocument) return

    const initMarkdownText = async () => {
      try {
        let text = ''
        if (currentDocument.file) {
          text = await currentDocument.file.text()
        } else if (currentDocument.uri) {
          const res = await fetch(currentDocument.uri)
          text = await res.text()
        }
        setMarkdownText(text)
      } catch (error) {
        console.error('Failed to load markdown', error)
        setMarkdownText('# Error loading document')
      }
    }

    initMarkdownText()
  }, [currentDocument])

  if (!currentDocument) return null

  return (
    <div
      id="my-markdown-renderer"
      className="markdown-body h-full w-full overflow-auto bg-[#FFFDF8] p-8"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            return match ? (
              <SyntaxHighlighter
                language={match[1]}
                PreTag="div"
                style={oneLight}
                className="markdown-code-block !my-0"
                {...props}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            ) : (
              <code
                className={`markdown-inline-code ${className || ''}`}
                {...props}
              >
                {children}
              </code>
            )
          }
        }}
      >
        {markdownText}
      </ReactMarkdown>
    </div>
  )
}

CustomMarkdownRenderer.fileTypes = ['md', 'markdown', 'txt', 'text/plain']
CustomMarkdownRenderer.weight = 1

export default CustomMarkdownRenderer
