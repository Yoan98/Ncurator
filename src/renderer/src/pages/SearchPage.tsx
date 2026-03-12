import React, { useState, useEffect, useMemo } from 'react'
import { App, Input, List, Card, Empty, Typography, Button, Switch, Segmented } from 'antd'
import { HiArrowUp, HiOutlineDocumentText } from 'react-icons/hi2'
import type { SearchResult, SearchSourceFilter, SourceScopeSelection } from '../../../shared/types'
import TextHighlighter from '../components/TextHighlighter'
import { parseIpcResult } from '../utils/serialization'
import FileRender, { FileRenderDocument } from '../components/fileRenders'
import { getActiveConfig, streamCompletion, ChatMessage } from '../services/llmService'
import MarkdownRenderer from '../components/MarkdownRenderer'
import SourceScopeSelect from '../components/SourceScopeSelect'
import { searchSelectors } from '../testing/selectors'

const { TextArea } = Input
const isJsdomTestEnv =
  typeof navigator !== 'undefined' && /jsdom/i.test(String(navigator.userAgent || ''))
const getMetadataPageNumber = (metadata: SearchResult['metadata']): number => {
  if (!metadata) return 1
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata) as { page?: unknown }
      return typeof parsed.page === 'number' ? parsed.page : 1
    } catch (e) {
      void e
      return 1
    }
  }
  return typeof metadata.page === 'number' ? metadata.page : 1
}

const SearchPage: React.FC = () => {
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [tokens, setTokens] = useState<string[]>([])
  const [previewVisible, setPreviewVisible] = useState(false)
  const [currentDoc, setCurrentDoc] = useState<SearchResult | null>(null)
  const [searchValue, setSearchValue] = useState('')
  const [aiAnswerEnabled, setAiAnswerEnabled] = useState(false)
  const [aiAnswer, setAiAnswer] = useState<string>('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<SearchSourceFilter>('all')
  const [selectedScopes, setSelectedScopes] = useState<SourceScopeSelection[]>([])

  const selectedDocumentIds = useMemo(
    () =>
      Array.from(
        new Set(
          selectedScopes.flatMap((scope) =>
            Array.isArray(scope.documentIds) ? scope.documentIds.map((item) => String(item)) : []
          )
        )
      ).filter(Boolean),
    [selectedScopes]
  )

  useEffect(() => {
    // Check if model is ready when component mounts
  }, [])

  const generateAiAnswer = async (query: string, docs: SearchResult[]) => {
    const config = await getActiveConfig()
    if (!config) {
      setAiAnswer('请先在设置页配置 AI 模型参数')
      return
    }

    if (docs.length === 0) {
      setAiAnswer('未找到相关文档，无法生成回答。')
      return
    }

    setAiGenerating(true)
    setAiAnswer('')

    const contextText = docs
      .slice(0, 5)
      .map((c, i) => `[${i + 1}] 文档: ${c.document_name}\n内容: ${c.text}`)
      .join('\n\n')

    const systemPrompt = `你是一个智能助手。请严格基于以下提供的上下文信息回答用户的问题。如果上下文中没有答案，请诚实告知“未找到相关信息”。
请使用中文回答。
请使用 Markdown 格式回答。

上下文信息：
${contextText}`

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: systemPrompt,
        id: 'system',
        session_id: 'search',
        timestamp: Date.now()
      },
      {
        role: 'user',
        content: query,
        id: 'user',
        session_id: 'search',
        timestamp: Date.now()
      }
    ]

    await streamCompletion(
      messages,
      config,
      (chunk) => {
        setAiAnswer((prev) => prev + chunk)
      },
      (error) => {
        console.error('AI generation error:', error)
        setAiAnswer('AI 回答生成失败: ' + error.message)
        setAiGenerating(false)
      },
      () => {
        setAiGenerating(false)
      }
    )
  }

  const handleSearch = async (value: string) => {
    if (!value.trim()) return
    setLoading(true)
    // Clear previous AI answer if new search
    setAiAnswer('')

    try {
      const response = await window.api.search(
        value,
        sourceFilter,
        selectedDocumentIds.length > 0 ? selectedDocumentIds : undefined
      )
      const parsedResults = response.results.map(parseIpcResult)
      setResults(parsedResults)
      setTokens(response.tokens)

      if (aiAnswerEnabled) {
        generateAiAnswer(value, parsedResults)
      }
    } catch (error) {
      console.error('Search error:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAiSwitchChange = async (checked: boolean) => {
    if (checked) {
      const config = await getActiveConfig()
      if (!config) {
        window.dispatchEvent(new Event('check-llm-config'))
        return
      }
    }
    setAiAnswerEnabled(checked)
    if (checked && results.length > 0 && searchValue.trim()) {
      generateAiAnswer(searchValue, results)
    }
  }

  const openPreview = async (item: SearchResult) => {
    if (item.source_type === 'web') {
      const url = item.document?.file_path
      if (!url) {
        message.warning('未找到网页链接')
        return
      }
      const res = await window.api.openExternal(url)
      if (!res.success) {
        message.error(res.error || '打开链接失败')
      }
      return
    }
    setCurrentDoc(item)
    setPreviewVisible(true)
  }

  const previewDocuments: FileRenderDocument[] =
    currentDoc && currentDoc.source_type === 'file' && currentDoc.document?.file_path
      ? [
          {
            uri: '', // Will be generated from filePath
            filePath: currentDoc.document.file_path,
            fileName: currentDoc.document_name,
            metadata: {
              pageNumber: getMetadataPageNumber(currentDoc.metadata)
            }
          }
        ]
      : []

  return (
    <div className="min-h-full p-6 font-sans max-w-4xl mx-auto" data-testid={searchSelectors.page}>
      <div className="pt-8">
        {/* Search Box */}
        <div className="bg-white border border-[#E5E5E4] rounded-2xl p-3 shadow-sm mb-6 focus-within:ring-4 focus-within:ring-[#F4E5DF] focus-within:border-[#D97757] transition-all duration-300 relative group">
          <TextArea
            placeholder="基于您的资源搜索..."
            autoSize={isJsdomTestEnv ? undefined : { minRows: 2, maxRows: 6 }}
            variant="borderless"
            className="text-lg bg-transparent mb-2 placeholder:text-[#999999] !px-1 text-[#1F1F1F] min-h-[60px]"
            style={{ resize: 'none' }}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            data-testid={searchSelectors.input}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSearch(searchValue)
              }
            }}
          />
          <div className="flex justify-between items-center px-1">
            <div className="flex items-center gap-3">
              <div className="text-xs text-[#999999] font-medium">
                Enter 发送，Shift + Enter 换行
              </div>
              <Segmented
                value={sourceFilter}
                onChange={(val) => setSourceFilter(val as SearchSourceFilter)}
                options={[
                  { label: '全部', value: 'all' },
                  { label: '文件', value: 'file' },
                  { label: '网页', value: 'web' }
                ]}
                className="bg-[#F5F5F4] p-1 rounded-lg"
              />
            </div>
            <Button
              type="primary"
              shape="circle"
              size="large"
              icon={<HiArrowUp className="w-5 h-5" />}
              className={`border-none shadow-none flex items-center justify-center transition-all duration-300 ${
                searchValue.trim()
                  ? '!bg-[#D97757] hover:!bg-[#C66A4A] scale-100'
                  : '!bg-[#E5E5E4] !text-white scale-95'
              }`}
              onClick={() => handleSearch(searchValue)}
              loading={loading}
              disabled={!searchValue.trim()}
              data-testid={searchSelectors.submitButton}
            />
          </div>
        </div>

        <div
          className="mb-6 rounded-2xl border border-[#E5E5E4] bg-white p-4 shadow-sm"
          data-testid={searchSelectors.sourceScopeField}
        >
          <div className="mb-2 text-sm font-medium text-[#1F1F1F]">搜索范围</div>
          <SourceScopeSelect
            mode="search"
            value={selectedScopes}
            onChange={setSelectedScopes}
            placeholder="可选：仅搜索已准备的工作空间、目录、文件或网页资料"
            className="w-full"
          />
          <div className="mt-2 text-xs text-[#999999]">
            搜索模式仅允许已准备范围；未准备的本地资料不会进入候选列表。
            {selectedScopes.length > 0 ? ` 当前已锁定 ${selectedScopes.length} 个范围。` : ''}
          </div>
        </div>

        {/* AI Answer Section */}
        <div
          className={`bg-white border border-[#E5E5E4] rounded-2xl shadow-sm mb-8 p-6 transition-all duration-500 ${aiAnswerEnabled ? 'opacity-100 translate-y-0' : 'opacity-80'}`}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-[#D97757] flex items-center justify-center">
                <span className="text-white text-xs font-bold">AI</span>
              </div>
              <span className="font-bold text-base text-[#1F1F1F]">智能回答</span>
            </div>
            <Switch
              checked={aiAnswerEnabled}
              onChange={handleAiSwitchChange}
              className="bg-[#E5E5E4] hover:bg-[#D4D4D3] [&.ant-switch-checked]:!bg-[#D97757]"
            />
          </div>

          {aiAnswerEnabled && (
            <div className="pt-2">
              {aiGenerating ? (
                <div className="flex items-center gap-2 text-[#D97757]">
                  <span className="loading loading-dots loading-sm"></span>
                  <span>AI 思考中...</span>
                </div>
              ) : aiAnswer ? (
                <MarkdownRenderer content={aiAnswer} />
              ) : (
                <span className="text-[#999999] italic">等待提问...</span>
              )}
            </div>
          )}
        </div>

        {/* Results */}
        <div>
          <div className="min-h-[200px]" data-testid={searchSelectors.resultsList}>
            {results.length > 0 ? (
              <List
                grid={{ gutter: 16, column: 1 }}
                dataSource={results}
                loading={loading}
                split={false}
                renderItem={(item) => (
                  <List.Item className="!mb-4">
                    <Card
                      hoverable
                      data-testid={`${searchSelectors.resultCardPrefix}-${item.id}`}
                      className="group bg-white border border-[#E5E5E4] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-xl overflow-hidden"
                      bodyStyle={{ padding: '20px' }}
                      onClick={() => openPreview(item)}
                    >
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5 overflow-hidden">
                            <div className="p-1.5 rounded-lg bg-[#FBF5F2] border border-[#F4E5DF] group-hover:bg-[#F4E5DF] transition-colors">
                              <HiOutlineDocumentText className="w-4 h-4 text-[#D97757]" />
                            </div>
                            <span className="font-semibold text-[#1F1F1F] truncate text-[15px] group-hover:text-[#D97757] transition-colors">
                              {item.document_name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-[#999999]">
                            {item.source_type === 'file' ? (
                              <span className="bg-[#F5F5F4] px-1.5 py-0.5 rounded text-[#666666] font-medium">
                                FILE
                              </span>
                            ) : (
                              <span className="bg-[#FBF5F2] px-1.5 py-0.5 rounded text-[#D97757] font-medium">
                                WEB
                              </span>
                            )}
                            <span>•</span>
                            <span>ID: {item.document_id?.substring(0, 6)}</span>
                            {item.source_type === 'web' && item.document?.file_path && (
                              <>
                                <span>•</span>
                                <Button
                                  type="link"
                                  size="small"
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    const res = await window.api.openExternal(
                                      item.document!.file_path!
                                    )
                                    if (!res.success) {
                                      message.error(res.error || '打开链接失败')
                                    }
                                  }}
                                  className="!p-0 !h-auto !text-[#D97757]"
                                >
                                  打开链接
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                        <Typography.Paragraph
                          ellipsis={{ rows: 3, expandable: false }}
                          className="!mb-0 text-[#666666] !text-[14px] leading-relaxed"
                        >
                          <TextHighlighter
                            text={item.text}
                            keywords={tokens}
                            className="text-[#666666]"
                          />
                        </Typography.Paragraph>
                      </div>
                    </Card>
                  </List.Item>
                )}
              />
            ) : (
              !loading && (
                <div className="flex items-center justify-center py-20">
                  <Empty description="暂无数据" />
                </div>
              )
            )}
            {loading && <div className="text-center py-10 text-[#999999]">Searching...</div>}
          </div>
        </div>

        <FileRender
          open={previewVisible}
          documents={previewDocuments}
          onCancel={() => setPreviewVisible(false)}
        />
      </div>
    </div>
  )
}

export default SearchPage
