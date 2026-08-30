import { z } from 'zod/v4'
import { jsonObjectSchema } from '../../toolSchemas'

export const KB_SEARCH_SCHEMA = z.object({
  queryText: z.string().min(1).describe('检索查询词或语义语句'),
  strategy: z
    .enum(['auto', 'semantic', 'keyword'])
    .optional()
    .describe('检索策略；默认 auto'),
  limit: z.number().int().min(1).max(50).optional().describe('最多返回条数；默认 10'),
  sourceType: z
    .enum(['all', 'file', 'web'])
    .optional()
    .describe('按来源类型过滤；默认 all'),
  documentIds: z.array(z.string()).optional().describe('限定文档 ID 范围')
})

export const KB_LIST_DOCUMENTS_SCHEMA = z.object({
  sourceNameQuery: z.string().optional().describe('按文档名模糊过滤'),
  page: z.number().int().min(1).optional().describe('页码；默认 1'),
  pageSize: z.number().int().min(1).max(50).optional().describe('每页条数；默认 20'),
  documentIds: z.array(z.string()).optional().describe('限定文档 ID 范围')
})

const kbSearchResultItemSchema = z
  .object({
    id: z.string().describe('内容块 ID'),
    text: z.string().describe('命中文本片段'),
    documentName: z.string().describe('来源文档名'),
    documentId: z.string().optional().describe('来源文档 ID'),
    sourceType: z.string().optional().describe('来源类型：file 或 web'),
    filePath: z.string().optional().describe('本地文件路径（file 来源）'),
    sourceUrl: z.string().optional().describe('网页 URL（web 来源）'),
    metadata: z.union([z.string(), jsonObjectSchema]).optional().describe('附加元数据'),
    createdAt: z.number().optional().describe('索引时间戳')
  })
  .strict()

const kbListDocumentItemSchema = z
  .object({
    id: z.string().describe('文档 ID'),
    name: z.string().describe('文档名'),
    sourceType: z.string().describe('来源类型：file 或 web'),
    workspaceId: z.string().optional().describe('所属工作区 ID'),
    filePath: z.string().optional().describe('本地文件路径（file 来源）'),
    createdAt: z.number().describe('创建时间戳'),
    importStatus: z.number().describe('导入状态码'),
    sourceId: z.string().optional().describe('外部来源 ID'),
    sourceUrl: z.string().optional().describe('网页 URL（web 来源）'),
    sourceTitle: z.string().optional().describe('网页标题（web 来源）'),
    normalizedSourceUrl: z.string().optional().describe('规范化网页 URL'),
    fetchedAt: z.number().optional().describe('抓取时间戳'),
    updatedAt: z.number().optional().describe('更新时间戳'),
    lastError: z.string().optional().describe('最近一次导入错误')
  })
  .strict()

export const KB_SEARCH_OUTPUT_SCHEMA = z
  .object({
    items: z.array(kbSearchResultItemSchema).describe('命中内容块列表'),
    total: z.number().describe('命中总数'),
    error: z.string().optional().describe('检索错误信息')
  })
  .strict()

export const KB_LIST_DOCUMENTS_OUTPUT_SCHEMA = z
  .object({
    items: z.array(kbListDocumentItemSchema).describe('文档列表'),
    total: z.number().describe('匹配文档总数'),
    error: z.string().optional().describe('查询错误信息')
  })
  .strict()
