import React, { useEffect, useState } from 'react'
import type { SearchResult, DocumentRecord, ChunkListItem } from '../../../shared/types'
import {
  Alert,
  Input,
  Button,
  message,
  List,
  Card,
  Typography,
  Segmented,
  Table,
  Modal,
  Tag
} from 'antd'
import { HiMagnifyingGlass, HiDocumentText, HiCube } from 'react-icons/hi2'
import { parseIpcResult } from '../utils/serialization'
import AppPageHeader from '../components/app/AppPageHeader'
import SettingsFloatingMenu from '../components/settings/SettingsFloatingMenu'

const { Paragraph } = Typography

function TestPage(): React.JSX.Element {
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'ftsSearch' | 'vectorSearch' | 'hybridSearch'>('hybridSearch')

  const [view, setView] = useState<'search' | 'docs' | 'chunks'>('search')

  // Documents State
  const [docItems, setDocItems] = useState<DocumentRecord[]>([])
  const [docTotal, setDocTotal] = useState<number>(0)
  const [docLoading, setDocLoading] = useState<boolean>(false)
  const [docPage, setDocPage] = useState<number>(1)
  const [docPageSize, setDocPageSize] = useState<number>(10)
  const [docKeyword, setDocKeyword] = useState<string>('')

  // Chunks State
  const [chunkItems, setChunkItems] = useState<ChunkListItem[]>([])
  const [chunkTotal, setChunkTotal] = useState<number>(0)
  const [chunkLoading, setChunkLoading] = useState<boolean>(false)
  const [chunkPage, setChunkPage] = useState<number>(1)
  const [chunkPageSize, setChunkPageSize] = useState<number>(10)
  const [chunkQuery, setChunkQuery] = useState<string>('')

  const [detailOpen, setDetailOpen] = useState<boolean>(false)
  const [detailText, setDetailText] = useState<string>('')
  const [detailTitle, setDetailTitle] = useState<string>('')

  const [dropOpen, setDropOpen] = useState<boolean>(false)
  const [dropLoading, setDropLoading] = useState<boolean>(false)

  const handleConfirmDrop = async () => {
    setDropLoading(true)
    try {
      const res = await window.api.dropDocumentsTable()
      if (res.success) {
        message.success('已删除 document 表')
        setSearchResults([])
        setDocItems([])
        setChunkItems([])
        setDocTotal(0)
        setChunkTotal(0)
        setDropOpen(false)
      } else {
        message.error(res.error || '删除失败')
      }
    } catch (error) {
      console.error(error)
      message.error('删除出错')
    } finally {
      setDropLoading(false)
    }
  }

  const openTextModal = (text: string, title?: string) => {
    setDetailText(text || '')
    setDetailTitle(title || '全文')
    setDetailOpen(true)
  }

  const handleSearch = async (value: string) => {
    if (!value.trim()) return
    setLoading(true)
    try {
      let results: SearchResult[] = []
      if (mode === 'ftsSearch') {
        results = await window.api.ftsSearch(value)
      } else if (mode === 'vectorSearch') {
        results = await window.api.vectorSearch(value)
      } else {
        results = await window.api.hybridSearch(value)
      }
      console.log('🔎 [SEARCH] RESULTS APP:', results)
      setSearchResults(results.map(parseIpcResult))
    } catch (error) {
      console.error(error)
      message.error('Search failed')
    } finally {
      setLoading(false)
    }
  }

  const loadDocuments = async (page = docPage, pageSize = docPageSize, query = docKeyword) => {
    setDocLoading(true)
    try {
      const res = await window.api.listDocuments({ sourceNameQuery: query, page, pageSize })
      setDocItems(res.items)
      setDocTotal(res.total)
      setDocPage(page)
      setDocPageSize(pageSize)
    } catch (error) {
      console.error(error)
      message.error('Load documents failed')
    } finally {
      setDocLoading(false)
    }
  }

  const loadChunks = async (page = chunkPage, pageSize = chunkPageSize, query = chunkQuery) => {
    setChunkLoading(true)
    try {
      const res = await window.api.listChunks({ query, page, pageSize })
      setChunkItems(res.items.map(parseIpcResult))
      setChunkTotal(res.total)
      setChunkPage(page)
      setChunkPageSize(pageSize)
    } catch (error) {
      console.error(error)
      message.error('Load chunks failed')
    } finally {
      setChunkLoading(false)
    }
  }

  useEffect(() => {
    if (view === 'docs') {
      loadDocuments(1, docPageSize, docKeyword)
    } else if (view === 'chunks') {
      loadChunks(1, chunkPageSize, chunkQuery)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  return (
    <div className="h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(255,253,248,0.86),_rgba(240,239,235,0.74)_42%,_#F6F5F1_72%)]">
      <div className="mx-auto flex h-full w-full max-w-[1360px] flex-col gap-5 px-5 py-5 font-sans lg:px-6">
        <AppPageHeader
          icon={<HiCube className="h-5 w-5" />}
          title="实验室"
          description="保留检索、文档和 chunk 调试能力，页面 chrome 与正式设置页保持同一套气质。"
        />

        <div className="min-h-0 flex-1 overflow-y-auto pb-5">
          <Alert
            className="mb-6 rounded-xl border-[#E1DED6] bg-[#F0EFEB]"
            message="本地文件导入已迁移"
            description="本地资料现在通过“设置 > 工作空间 / 网页资料”管理。实验室仅保留检索、文档和 chunk 调试能力。"
            type="info"
            showIcon
          />

          <div className="mb-6 flex flex-wrap gap-4">
            <Segmented
              options={[
                { label: 'Search', value: 'search', icon: <HiMagnifyingGlass className="mr-1" /> },
                { label: 'Documents', value: 'docs', icon: <HiDocumentText className="mr-1" /> },
                { label: 'Chunks', value: 'chunks', icon: <HiCube className="mr-1" /> }
              ]}
              value={view}
              onChange={(val) => setView(val as typeof view)}
              className="bg-[#F6F5F1]"
            />

            {view === 'search' ? (
              <Segmented
                options={[
                  { label: 'Hybrid', value: 'hybridSearch' },
                  { label: 'FTS', value: 'ftsSearch' },
                  { label: 'Vector', value: 'vectorSearch' }
                ]}
                value={mode}
                onChange={(val) => setMode(val as typeof mode)}
                className="bg-[#F6F5F1]"
              />
            ) : null}

            <div className="flex-1" />

            <Button danger onClick={() => setDropOpen(true)}>
              Reset DB
            </Button>
          </div>

          {view === 'search' ? (
            <div className="mb-4 flex gap-2">
              <Input.Search
                placeholder="Search knowledge base..."
                enterButton="Search"
                size="large"
                onSearch={handleSearch}
                loading={loading}
              />
            </div>
          ) : null}

          {view === 'docs' ? (
            <div className="mb-4 flex gap-2">
              <Input.Search
                placeholder="Filter documents by name..."
                enterButton="Filter"
                onSearch={(v) => {
                  setDocKeyword(v)
                  loadDocuments(1, docPageSize, v)
                }}
                loading={docLoading}
              />
            </div>
          ) : null}
          {view === 'chunks' ? (
            <div className="mb-4 flex gap-2">
              <Input.Search
                placeholder="Filter chunks by content..."
                enterButton="Filter"
                onSearch={(v) => {
                  setChunkQuery(v)
                  loadChunks(1, chunkPageSize, v)
                }}
                loading={chunkLoading}
              />
            </div>
          ) : null}

          <div className="flex-1 overflow-hidden rounded-lg border border-[#E1DED6] bg-white">
            {view === 'search' ? (
              <div className="h-full overflow-auto p-4">
                <List
                  dataSource={searchResults}
                  rowKey="id"
                  renderItem={(item) => (
                    <List.Item>
                      <Card
                        title={<span className="text-sm text-[#181818]">{item.document_name}</span>}
                        className="w-full shadow-sm hover:shadow-md transition-shadow"
                        size="small"
                      >
                        <Paragraph
                          ellipsis={{ rows: 3, expandable: true, symbol: 'more' }}
                          onClick={() => openTextModal(item.text, item.document_name)}
                          style={{ cursor: 'pointer' }}
                        >
                          {item.text}
                        </Paragraph>
                        <div className="mt-2 flex flex-wrap gap-4 text-xs text-[#9C9A94]">
                          <span>ID: {item.id}</span>
                          {mode !== 'vectorSearch' ? (
                            <Tag color="blue">Score: {item._score?.toFixed(4)}</Tag>
                          ) : null}
                          {mode === 'hybridSearch' ? (
                            <Tag color="green">RRF: {item._relevance_score?.toFixed(4)}</Tag>
                          ) : null}
                          {mode === 'vectorSearch' ? (
                            <Tag color="orange">Dist: {item._distance?.toFixed(4)}</Tag>
                          ) : null}
                        </div>
                      </Card>
                    </List.Item>
                  )}
                />
              </div>
            ) : null}

            {view === 'docs' ? (
              <Table<DocumentRecord>
                dataSource={docItems}
                rowKey="id"
                loading={docLoading}
                scroll={{ y: 'calc(100vh - 300px)' }}
                pagination={{
                  current: docPage,
                  pageSize: docPageSize,
                  total: docTotal,
                  onChange: (page, pageSize) => loadDocuments(page, pageSize, docKeyword),
                  showTotal: (total) => `Total ${total} docs`
                }}
                className="[&_.ant-table-thead_th]:!bg-[#F6F5F1] [&_.ant-table-thead_th]:!text-[#6E6D69] [&_.ant-table-thead_th]:!font-medium"
                columns={[
                  {
                    title: 'ID',
                    dataIndex: 'id',
                    width: 100,
                    ellipsis: true,
                    render: (text) => (
                      <Typography.Text copyable={{ text }}>
                        {text.substring(0, 8)}...
                      </Typography.Text>
                    )
                  },
                  {
                    title: 'Name',
                    dataIndex: 'name',
                    ellipsis: true
                  },
                  {
                    title: 'Source',
                    dataIndex: 'source_type',
                    width: 100
                  },
                  {
                    title: 'Created',
                    dataIndex: 'created_at',
                    width: 180,
                    render: (v) => new Date(v).toLocaleString()
                  }
                ]}
              />
            ) : null}

            {view === 'chunks' ? (
              <Table<ChunkListItem>
                dataSource={chunkItems}
                rowKey="id"
                loading={chunkLoading}
                scroll={{ y: 'calc(100vh - 300px)' }}
                pagination={{
                  current: chunkPage,
                  pageSize: chunkPageSize,
                  total: chunkTotal,
                  onChange: (page, pageSize) => loadChunks(page, pageSize, chunkQuery),
                  showTotal: (total) => `Total ${total} chunks`
                }}
                className="[&_.ant-table-thead_th]:!bg-[#F6F5F1] [&_.ant-table-thead_th]:!text-[#6E6D69] [&_.ant-table-thead_th]:!font-medium"
                columns={[
                  {
                    title: 'ID',
                    dataIndex: 'id',
                    width: 100,
                    ellipsis: true,
                    render: (text) => (
                      <Typography.Text copyable={{ text }}>
                        {text.substring(0, 8)}...
                      </Typography.Text>
                    )
                  },
                  {
                    title: 'Doc Name',
                    dataIndex: 'document_name',
                    width: 150,
                    ellipsis: true
                  },
                  {
                    title: 'Text',
                    dataIndex: 'text',
                    render: (text, record) => (
                      <Paragraph
                        ellipsis={{ rows: 2, expandable: true, symbol: 'more' }}
                        onClick={() => openTextModal(text, record.document_name)}
                        style={{ cursor: 'pointer', marginBottom: 0 }}
                      >
                        {text}
                      </Paragraph>
                    )
                  },
                  {
                    title: 'Metadata',
                    dataIndex: 'metadata',
                    width: 100,
                    render: (meta) => JSON.stringify(meta)
                  },
                  {
                    title: 'Vector',
                    dataIndex: 'vector',
                    width: 80,
                    render: (vec) => (
                      <Typography.Text copyable={{ text: JSON.stringify(vec) }}>
                        [{vec?.length}]
                      </Typography.Text>
                    )
                  }
                ]}
              />
            ) : null}
          </div>

          <Modal
            open={dropOpen}
            title="确认重置数据库"
            onOk={handleConfirmDrop}
            okText="确认重置"
            cancelText="取消"
            okButtonProps={{ danger: true, loading: dropLoading }}
            onCancel={() => setDropOpen(false)}
          >
            <p>该操作将清空所有已索引的文档和切片数据，且不可恢复。</p>
          </Modal>

          <Modal
            open={detailOpen}
            title={detailTitle}
            onCancel={() => setDetailOpen(false)}
            footer={null}
            width={800}
            bodyStyle={{ maxHeight: '70vh', overflow: 'auto' }}
          >
            <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{detailText}</Paragraph>
          </Modal>
        </div>
      </div>
      <SettingsFloatingMenu />
    </div>
  )
}

export default TestPage
