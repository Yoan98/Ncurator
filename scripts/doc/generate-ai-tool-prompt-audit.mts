/**
 * 生成 doc/ai-tool-prompt-audit.md
 * 运行：pnpm dlx tsx scripts/doc/generate-ai-tool-prompt-audit.mts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toJSONSchema } from 'zod/v4'
import type { z } from 'zod/v4'
import { RUNTIME_SKILL_IDS } from '../../src/main/services/ai/human/constants'
import { RUNTIME_SKILL_CATALOG, listRuntimeToolNamesForSkill } from '../../src/main/services/ai/human/skills'
import { getToolSpec } from '../../src/main/services/ai/human/tools/registry'
import {
  renderGenericModelError,
  renderModelResultWith
} from '../../src/main/services/ai/human/shared/modelToolResultRenderers'
import type { JsonObject, JsonValue } from '../../src/shared/types'
import type { HumanToolSpec } from '../../src/main/services/ai/human/tools/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const OUT_PATH = path.join(ROOT, 'doc/ai-tool-prompt-audit.md')

type JsonSchemaNode = Record<string, unknown>
type FieldRow = { path: string; type: string; required: boolean; description: string }
type OutField = { path: string; description: string }
type OutputCase = { label: string; ok: boolean; args?: JsonObject; data?: JsonValue }
type ExampleCase = { label: string; ok: boolean; input: JsonObject; data?: JsonValue }

const isJsonObject = (value: unknown): value is JsonSchemaNode =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asNodeArray = (value: unknown): JsonSchemaNode[] =>
  Array.isArray(value) ? value.filter(isJsonObject) : []

const resolveRef = (node: JsonSchemaNode, root: JsonSchemaNode): JsonSchemaNode => {
  const ref = node.$ref
  if (typeof ref !== 'string' || !ref.startsWith('#/$defs/')) return node
  const name = ref.slice('#/$defs/'.length)
  const defs = isJsonObject(root.$defs) ? (root.$defs as Record<string, JsonSchemaNode>) : {}
  return defs[name] || node
}

const unwrapNode = (node: JsonSchemaNode, root: JsonSchemaNode): JsonSchemaNode => {
  let current = resolveRef(node, root)
  const anyOf = asNodeArray(current.anyOf)
  if (anyOf.length === 1) current = unwrapNode(anyOf[0]!, root)
  const oneOf = asNodeArray(current.oneOf)
  if (oneOf.length === 1) current = unwrapNode(oneOf[0]!, root)
  return current
}

const schemaTypeLabel = (node: JsonSchemaNode, root: JsonSchemaNode): string => {
  const display = node['x-display-type']
  if (typeof display === 'string') return display
  if (Object.prototype.hasOwnProperty.call(node, 'const')) return JSON.stringify(node.const)
  const enumValues = node.enum
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    return enumValues.map((v) => JSON.stringify(v)).join(' | ')
  }
  const anyOf = asNodeArray(node.anyOf)
  if (anyOf.length > 0) {
    return anyOf.map((item) => schemaTypeLabel(unwrapNode(item, root), root)).join(' | ')
  }
  const oneOf = asNodeArray(node.oneOf)
  if (oneOf.length > 0) {
    return oneOf.map((item) => schemaTypeLabel(unwrapNode(item, root), root)).join(' | ')
  }
  if (node.type === 'array') {
    const items = node.items
    if (Array.isArray(items)) {
      return `[${items.map((i) => schemaTypeLabel(unwrapNode(i as JsonSchemaNode, root), root)).join(', ')}]`
    }
    if (isJsonObject(items)) return `${schemaTypeLabel(unwrapNode(items, root), root)}[]`
    return 'array'
  }
  if (node.type === 'object' || isJsonObject(node.properties)) return 'object'
  if (typeof node.type === 'string') return node.type === 'integer' ? 'number' : node.type
  if (Array.isArray(node.type)) return node.type.join(' | ')
  return 'unknown'
}

const collectFieldRows = (
  node: JsonSchemaNode,
  root: JsonSchemaNode,
  prefix: string,
  requiredSet: Set<string>,
  rows: FieldRow[]
): void => {
  const current = unwrapNode(node, root)
  const properties = isJsonObject(current.properties) ? current.properties : {}
  const required = new Set(
    Array.isArray(current.required) ? current.required.map(String) : [...requiredSet]
  )
  for (const [key, rawChild] of Object.entries(properties)) {
    if (!isJsonObject(rawChild)) continue
    const child = unwrapNode(rawChild, root)
    const fieldPath = prefix ? `${prefix}.${key}` : key
    const desc =
      typeof child.description === 'string'
        ? child.description.trim()
        : typeof rawChild.description === 'string'
          ? rawChild.description.trim()
          : ''
    const constraint =
      typeof child['x-constraint'] === 'string' ? String(child['x-constraint']).trim() : ''
    const fullDesc = [desc, constraint ? `(约束: ${constraint})` : ''].filter(Boolean).join(' ')
    const isRequired = required.has(key)
    const typeLabel = schemaTypeLabel(child, root)
    const oneOf = asNodeArray(child.oneOf)
    const anyOf = asNodeArray(child.anyOf)
    const isUnion = oneOf.length > 1 || anyOf.length > 1
    if (isUnion) {
      rows.push({
        path: fieldPath,
        type: typeLabel,
        required: isRequired,
        description: fullDesc || '联合类型'
      })
      const branches = oneOf.length > 1 ? oneOf : anyOf
      branches.forEach((branch, index) => {
        const branchNode = unwrapNode(branch, root)
        const branchLabel =
          typeof branchNode.title === 'string'
            ? branchNode.title
            : Object.prototype.hasOwnProperty.call(branchNode, 'const')
              ? String(branchNode.const)
              : `branch_${index + 1}`
        collectFieldRows(branchNode, root, `${fieldPath}[${branchLabel}]`, new Set(), rows)
      })
    } else if (child.type === 'object' || isJsonObject(child.properties)) {
      rows.push({ path: fieldPath, type: 'object', required: isRequired, description: fullDesc })
      collectFieldRows(child, root, fieldPath, new Set(), rows)
    } else {
      rows.push({ path: fieldPath, type: typeLabel, required: isRequired, description: fullDesc })
    }
  }
}

const extractFieldRows = (schema: z.ZodType): FieldRow[] => {
  const root = toJSONSchema(schema) as JsonSchemaNode
  const rows: FieldRow[] = []
  collectFieldRows(root, root, '', new Set(), rows)
  return rows
}

const collectRootUnionFieldRows = (schema: z.ZodType): FieldRow[] | null => {
  const root = toJSONSchema(schema) as JsonSchemaNode
  const top = unwrapNode(root, root)
  const branches = asNodeArray(top.oneOf).length > 0 ? asNodeArray(top.oneOf) : asNodeArray(top.anyOf)
  if (branches.length <= 1) return null
  const rows: FieldRow[] = []
  branches.forEach((branch, index) => {
    const branchNode = unwrapNode(branch, root)
    const label =
      Object.prototype.hasOwnProperty.call(branchNode, 'const')
        ? String(branchNode.const)
        : typeof branchNode.properties === 'object' &&
            isJsonObject(branchNode.properties) &&
            isJsonObject(branchNode.properties.type) &&
            Object.prototype.hasOwnProperty.call(branchNode.properties.type, 'const')
          ? String((branchNode.properties.type as JsonSchemaNode).const)
          : `branch_${index + 1}`
    collectFieldRows(branchNode, root, `[${label}]`, new Set(), rows)
  })
  return rows
}

const minimalFromSchema = (node: JsonSchemaNode, root: JsonSchemaNode): JsonValue => {
  const current = unwrapNode(node, root)
  if (Object.prototype.hasOwnProperty.call(current, 'const')) return current.const as JsonValue
  const enumValues = current.enum
  if (Array.isArray(enumValues) && enumValues.length > 0) return enumValues[0] as JsonValue
  const anyOf = asNodeArray(current.anyOf)
  if (anyOf.length > 0) return minimalFromSchema(anyOf[0]!, root)
  const oneOf = asNodeArray(current.oneOf)
  if (oneOf.length > 0) return minimalFromSchema(oneOf[0]!, root)
  if (current.type === 'object' || isJsonObject(current.properties)) {
    const properties = isJsonObject(current.properties) ? current.properties : {}
    const required = new Set(
      Array.isArray(current.required) ? current.required.map(String) : Object.keys(properties)
    )
    const output: JsonObject = {}
    for (const key of required) {
      const child = properties[key]
      if (isJsonObject(child)) output[key] = minimalFromSchema(child, root) as JsonValue
    }
    return output
  }
  if (current.type === 'array') {
    const minItems = typeof current.minItems === 'number' ? current.minItems : 1
    const items = current.items
    const itemNode = Array.isArray(items) ? items[0] : items
    if (!isJsonObject(itemNode)) return []
    return Array.from({ length: Math.max(1, minItems) }, () => minimalFromSchema(itemNode, root))
  }
  if (current.type === 'boolean') return true
  if (current.type === 'number' || current.type === 'integer') return 1
  if (current.type === 'null') return null
  return 'example'
}

const branchLabelFromInput = (input: JsonObject, index: number): string => {
  if (typeof input.type === 'string') return input.type
  if (typeof input.action === 'string') return input.action
  return `branch_${index + 1}`
}

const extractUnionExamples = (schema: z.ZodType): Array<{ label: string; input: JsonObject }> => {
  const root = toJSONSchema(schema) as JsonSchemaNode
  const top = unwrapNode(root, root)
  const branches = asNodeArray(top.oneOf).length > 0 ? asNodeArray(top.oneOf) : asNodeArray(top.anyOf)
  if (branches.length > 1) {
    return branches.map((branch, index) => {
      const input = minimalFromSchema(branch, root) as JsonObject
      return { label: branchLabelFromInput(input, index), input }
    })
  }
  if (top.type === 'object' || isJsonObject(top.properties)) {
    const properties = isJsonObject(top.properties) ? top.properties : {}
    for (const [key, rawChild] of Object.entries(properties)) {
      if (!isJsonObject(rawChild)) continue
      const child = unwrapNode(rawChild, root)
      const nested = asNodeArray(child.oneOf).length > 0 ? asNodeArray(child.oneOf) : asNodeArray(child.anyOf)
      if (nested.length > 1) {
        const base = minimalFromSchema(top, root) as JsonObject
        return nested.map((branch, index) => {
          const branchInput = minimalFromSchema(branch, root) as JsonObject
          const input = { ...base, [key]: branchInput }
          const label =
            typeof branchInput.type === 'string'
              ? `${key}:${branchInput.type}`
              : `${key}:${branchLabelFromInput(branchInput, index)}`
          return { label, input }
        })
      }
    }
  }
  const input = minimalFromSchema(top, root)
  return [
    {
      label: 'default',
      input: (typeof input === 'object' && input && !Array.isArray(input) ? input : {}) as JsonObject
    }
  ]
}

const INPUT_EXAMPLES_OVERRIDE: Record<string, Array<{ label: string; input: JsonObject }>> = {
  web_search: [
    { label: 'query', input: { query: 'typescript tutorial' } },
    { label: 'url', input: { url: 'https://example.com/page' } }
  ],
  terminal_run: [
    {
      label: 'default',
      input: { command: 'python -c "print(1+1)"', commandExplanation: '计算 1+1' }
    }
  ],
  text_file_read: [
    { label: 'from_start', input: { sourcePath: '/workspace/readme.md' } },
    {
      label: 'paginated',
      input: { sourcePath: '/workspace/readme.md', startLine: 10, lineCount: 100 }
    }
  ],
  text_file_search: [
    {
      label: 'literal',
      input: { sourcePath: '/workspace/app.ts', query: 'TODO', mode: 'literal' }
    },
    {
      label: 'regex',
      input: { sourcePath: '/workspace/app.ts', query: 'function\\s+\\w+', mode: 'regex' }
    }
  ],
  kb_search: [
    { label: 'minimal', input: { queryText: '项目架构' } },
    {
      label: 'full_options',
      input: {
        queryText: '项目架构',
        strategy: 'semantic',
        limit: 5,
        sourceType: 'file',
        documentIds: ['doc-1']
      }
    }
  ],
  update_plan: [
    {
      label: 'default',
      input: {
        plan: [
          { title: '分析需求', status: 'done' },
          { title: '实施修改', status: 'todo' }
        ],
        progress: '已完成分析，正在修改文件'
      }
    }
  ]
}

/** renderer 实际读取的字段 */
const OUTPUT_FIELDS: Record<string, OutField[]> = {
  terminal_run: [
    { path: 'status', description: "'running' | 'succeeded' | 'failed' | 'cancelled'" },
    { path: 'terminalId', description: '终端会话 ID' },
    { path: 'readEndPosition', description: '读取结束位置' },
    { path: 'hasMoreOutput', description: '是否还有更多输出' },
    { path: 'output', description: '增量输出文本' }
  ],
  terminal_read: [
    { path: 'status', description: '同上' },
    { path: 'readEndPosition', description: '读取结束位置' },
    { path: 'hasMoreOutput', description: '是否还有更多输出' },
    { path: 'output', description: '增量输出文本' }
  ],
  text_file_read: [
    { path: 'content', description: '读取文本' },
    { path: 'startLine / endLine', description: '行范围' },
    { path: 'totalLines', description: '总行数' },
    { path: 'nextStartLine?', description: '续读行号' }
  ],
  text_file_search: [
    { path: 'totalMatchCount', description: '总命中数' },
    { path: 'matches[].line', description: '行号' },
    { path: 'matches[].matchText', description: '命中文本' },
    { path: 'matches[].truncated', description: '上下文是否截断' },
    { path: 'matches[].textContext', description: '上下文' }
  ],
  text_file_edit: [{ path: '—', description: '固定文案，不读 data' }],
  kb_search: [
    { path: 'items[].documentId?', description: '文档 ID' },
    { path: 'items[].documentName', description: '文档名' },
    { path: 'items[].sourceType?', description: '来源类型' },
    { path: 'items[].filePath? / sourceUrl?', description: '路径或 URL' },
    { path: 'items[].text', description: '片段正文' }
  ],
  kb_list_documents: [
    { path: 'total', description: '文档总数' },
    { path: 'items[].id', description: '文档 ID' },
    { path: 'items[].name', description: '文档名' },
    { path: 'items[].sourceType', description: '来源类型' },
    { path: 'items[].filePath? / sourceUrl?', description: '路径或 URL' }
  ],
  web_search: [
    { path: 'args.query? / args.url?', description: '决定标题文案' },
    { path: 'items[].title? / requestedUrl', description: '标题与 URL' },
    { path: 'items[].markdown?', description: 'url 模式正文' },
    { path: 'items[].error?', description: '单条失败' }
  ],
  browser_use: [
    { path: 'error?', description: '失败文案' },
    { path: 'action', description: 'navigate | extract | observe | act' },
    { path: 'page.url / page.title?', description: '当前页' },
    { path: 'content', description: 'extract 正文' },
    { path: 'actions[].description', description: 'observe 候选动作' },
    { path: 'success / message / actionDescription', description: 'act 结果' }
  ],
  docx_read_outline: [
    { path: 'fromPercent / toPercent', description: '比例区间' },
    { path: 'fromNodeIndex / toNodeIndex', description: '根节点区间' },
    { path: 'totalRootCount', description: '根节点总数' },
    { path: 'segments[].story', description: '故事区域' },
    { path: 'segments[].fromNodeIndex / toNodeIndex', description: '段内索引' },
    { path: 'segments[].textMap', description: '结构缩略文本' }
  ],
  docx_search: [
    { path: 'totalMatchCount / returnedMatchCount', description: '命中计数' },
    { path: 'matches[].nodeId / nodeIndex / type / story', description: '节点定位' },
    { path: 'matches[].tableNodeId?', description: '表格命中' },
    { path: 'matches[].matchText / textContext', description: '命中与上下文' },
    { path: 'matches[].before[] / after[]', description: '邻节点 preview' }
  ],
  docx_read_nodes: [{ path: 'nodes[]', description: '语义节点树（style、children、标量字段）' }],
  docx_content_edit: [
    { path: 'args.sourcePath', description: '文件名' },
    { path: 'createdIds?', description: '新建节点 ID' }
  ],
  docx_format: [
    { path: 'args.sourcePath', description: '文件名' },
    { path: 'createdIds?', description: '新建节点 ID' }
  ],
  docx_table_edit: [
    { path: 'args.sourcePath', description: '文件名' },
    { path: 'createdIds?', description: '新建节点 ID' }
  ],
  docx_comments_revisions: [
    { path: 'args.sourcePath', description: '文件名' },
    { path: 'createdIds?', description: '新建节点 ID' }
  ],
  pdf_outline: [
    { path: 'pageCount', description: '页数' },
    { path: 'metadata.title? / author?', description: '元数据' },
    { path: 'outline[].title / pageNumber? / depth', description: '大纲项' }
  ],
  pdf_search: [
    { path: 'totalMatchCount / returnedMatchCount', description: '命中计数' },
    { path: 'matches[].pageNumber / matchedText / snippet', description: '命中详情' }
  ],
  pdf_read_pages: [
    { path: 'pages[].pageNumber', description: '页码' },
    { path: 'pages[].textStatus', description: 'available | empty | suspicious' },
    { path: 'pages[].imageCount', description: '页内图片数' },
    { path: 'pages[].pageImagePath', description: '页渲染图路径' },
    { path: 'pages[].text', description: '页文本' }
  ],
  ppt_read_outline: [
    { path: 'slideCount', description: '页数' },
    { path: 'slides[].slideIndex / slideId / title?', description: '提纲项' }
  ],
  ppt_read_slides: [
    { path: 'slides[].slideIndex / slideId', description: '页定位' },
    { path: 'slides[].slideImagePath', description: '页渲染图' },
    { path: 'slides[].elements[].type / elementId', description: '元素摘要' }
  ],
  ppt_search: [
    { path: 'totalMatchCount / returnedMatchCount / truncated', description: '命中计数' },
    { path: 'matches[].slideIndex / slideId / source / matchedText / text', description: '命中详情' }
  ],
  ppt_edit: [
    { path: 'slideId?', description: '页面 ID' },
    { path: 'createdElementIds?', description: '新建元素 ID' }
  ],
  excel_read: [
    { path: 'args.type', description: 'workbook | range | style | search' },
    { path: 'sheets[]', description: 'workbook：name / range / rowCount / columnCount' },
    { path: 'sheetName / range / rows', description: 'range|style 网格' },
    { path: 'totalMatchCount / matches[]', description: 'search 命中' }
  ],
  excel_edit: [{ path: 'args.type', description: '决定文案，不读 data' }],
  image_generate: [
    { path: 'error?', description: '失败文案' },
    { path: 'outputPath?', description: '保存路径' }
  ],
  learn_skill: [{ path: 'args.skillIds', description: '加载的技能 ID' }],
  update_plan: [{ path: '—', description: '固定文案，不读 data' }],
  read_image: [
    { path: 'images[].path', description: '图片路径' },
    { path: 'images[].width / height', description: '尺寸' },
    { path: 'images[].mimeType', description: 'MIME' }
  ]
}

const OUTPUT_CASES: Record<string, OutputCase[]> = {
  terminal_run: [
    {
      label: '命令执行中',
      ok: true,
      data: {
        terminalId: 'term-001',
        status: 'running',
        output: 'Installing...\n',
        readEndPosition: 14,
        hasMoreOutput: true
      }
    },
    {
      label: '命令成功完成',
      ok: true,
      data: {
        terminalId: 'term-001',
        status: 'succeeded',
        output: 'done\n',
        readEndPosition: 5,
        hasMoreOutput: false
      }
    },
    {
      label: '命令失败',
      ok: true,
      data: {
        terminalId: 'term-001',
        status: 'failed',
        output: 'error: not found\n',
        readEndPosition: 18,
        hasMoreOutput: false
      }
    },
    { label: '执行失败', ok: false, data: { error: 'Command blocked by policy' } }
  ],
  terminal_read: [
    {
      label: '增量读取',
      ok: true,
      args: { terminalId: 'term-001', readEndPosition: 14 },
      data: {
        status: 'running',
        output: '...more output\n',
        readEndPosition: 30,
        hasMoreOutput: true
      }
    },
    { label: '读取失败', ok: false, data: { error: 'Unknown terminalId' } }
  ],
  text_file_read: [
    {
      label: '首次读取',
      ok: true,
      args: { sourcePath: '/workspace/readme.md' },
      data: { content: '# Title\n', startLine: 1, endLine: 1, totalLines: 10, nextStartLine: 2 }
    },
    {
      label: '分页续读',
      ok: true,
      args: { sourcePath: '/workspace/readme.md', startLine: 2, lineCount: 5 },
      data: { content: 'body\n', startLine: 2, endLine: 6, totalLines: 10 }
    },
    { label: '读取失败', ok: false, data: { error: 'File not found' } }
  ],
  text_file_search: [
    {
      label: '有命中',
      ok: true,
      data: {
        totalMatchCount: 2,
        returnedMatchCount: 1,
        matches: [{ line: 5, matchText: 'TODO', textContext: '// TODO: fix', truncated: false }]
      }
    },
    { label: '无命中', ok: true, data: { totalMatchCount: 0, returnedMatchCount: 0, matches: [] } },
    { label: '搜索失败', ok: false, data: { error: 'Invalid regex' } }
  ],
  text_file_edit: [
    { label: '编辑成功', ok: true, args: { action: 'edit' }, data: {} },
    { label: '编辑失败', ok: false, data: { error: 'oldText not found' } }
  ],
  kb_search: [
    {
      label: '有结果',
      ok: true,
      data: {
        total: 1,
        items: [
          {
            id: 'chunk-1',
            text: '知识库片段内容',
            documentName: 'notes.md',
            documentId: 'doc-1',
            sourceType: 'file',
            filePath: '/workspace/notes.md'
          }
        ]
      }
    },
    { label: '无结果', ok: true, data: { total: 0, items: [] } },
    { label: '检索失败', ok: false, data: { error: 'Index unavailable' } }
  ],
  kb_list_documents: [
    {
      label: '有文档',
      ok: true,
      data: {
        total: 1,
        items: [
          {
            id: 'doc-1',
            name: 'notes.md',
            sourceType: 'file',
            filePath: '/workspace/notes.md',
            createdAt: 1,
            importStatus: 1
          }
        ]
      }
    },
    { label: '空列表', ok: true, data: { total: 0, items: [] } }
  ],
  web_search: [
    {
      label: '关键词搜索',
      ok: true,
      args: { query: 'typescript tutorial' },
      data: { items: [{ requestedUrl: 'https://example.com/a', title: 'Tutorial A' }] }
    },
    {
      label: 'URL 直读',
      ok: true,
      args: { url: 'https://example.com/page' },
      data: {
        items: [
          {
            requestedUrl: 'https://example.com/page',
            title: 'Page',
            markdown: '# Heading\nBody text'
          }
        ]
      }
    },
    {
      label: '单条抓取失败',
      ok: true,
      args: { query: 'test' },
      data: { items: [{ requestedUrl: 'https://bad.example', title: 'bad', error: 'HTTP 403' }] }
    },
    { label: '工具失败', ok: false, data: { error: 'Search service unavailable' } }
  ],
  browser_use: [
    {
      label: 'navigate',
      ok: true,
      args: { action: 'navigate', url: 'https://example.com' },
      data: { action: 'navigate', page: { url: 'https://example.com', title: 'Example' } }
    },
    {
      label: 'extract',
      ok: true,
      args: { action: 'extract', instruction: '提取正文' },
      data: {
        action: 'extract',
        page: { url: 'https://example.com', title: 'Example' },
        content: 'Page body text'
      }
    },
    {
      label: 'observe',
      ok: true,
      args: { action: 'observe', instruction: '列出按钮' },
      data: {
        action: 'observe',
        page: { url: 'https://example.com' },
        actions: [{ description: 'Click Submit button' }]
      }
    },
    {
      label: 'act 成功',
      ok: true,
      args: { action: 'act', instruction: '点击提交' },
      data: {
        action: 'act',
        page: { url: 'https://example.com' },
        success: true,
        message: 'Clicked',
        actionDescription: 'Click Submit'
      }
    },
    {
      label: 'act 失败',
      ok: true,
      args: { action: 'act', instruction: '点击缺失元素' },
      data: {
        action: 'act',
        page: { url: 'https://example.com' },
        success: false,
        message: 'Element not found',
        actionDescription: 'Click Missing'
      }
    },
    { label: '浏览器错误', ok: true, data: { error: 'Browser service unavailable' } }
  ],
  docx_read_outline: [
    {
      label: '成功',
      ok: true,
      data: {
        fromPercent: 0,
        toPercent: 50,
        fromNodeIndex: 0,
        toNodeIndex: 4,
        totalRootCount: 12,
        segments: [
          { story: 'body', fromNodeIndex: 0, toNodeIndex: 4, textMap: '结构：3 段\n关键词：摘要' }
        ]
      }
    }
  ],
  docx_search: [
    {
      label: '有命中',
      ok: true,
      data: {
        totalMatchCount: 1,
        returnedMatchCount: 1,
        matches: [
          {
            nodeId: 'node_3',
            nodeIndex: 3,
            type: 'paragraph',
            story: 'body',
            matchText: '关键词',
            textContext: '包含关键词的句子。',
            before: [{ nodeId: 'node_2', nodeIndex: 2, type: 'paragraph', textPreview: '上文' }],
            after: [{ nodeId: 'node_4', nodeIndex: 4, type: 'paragraph', textPreview: '下文' }]
          }
        ]
      }
    },
    { label: '无命中', ok: true, data: { totalMatchCount: 0, returnedMatchCount: 0, matches: [] } }
  ],
  docx_read_nodes: [
    {
      label: '成功',
      ok: true,
      data: {
        nodes: [
          {
            nodeId: 'node_1',
            type: 'paragraph',
            children: [
              {
                type: 'run',
                nodeId: 'n:1',
                style: { bold: true },
                children: [{ type: 'text', text: 'Hello' }]
              }
            ]
          }
        ]
      }
    }
  ],
  docx_content_edit: [
    {
      label: '成功',
      ok: true,
      args: { sourcePath: '/workspace/doc.docx', type: 'insert_nodes' },
      data: { createdIds: ['node_new_1'] }
    },
    { label: '失败', ok: false, data: { error: 'Node not found' } }
  ],
  docx_format: [
    {
      label: '成功',
      ok: true,
      args: { sourcePath: '/workspace/doc.docx', type: 'format_text' },
      data: {}
    }
  ],
  docx_table_edit: [
    {
      label: '成功',
      ok: true,
      args: { sourcePath: '/workspace/doc.docx', type: 'insert_row' },
      data: {}
    }
  ],
  docx_comments_revisions: [
    {
      label: '成功',
      ok: true,
      args: { sourcePath: '/workspace/doc.docx', type: 'add_comment' },
      data: {}
    }
  ],
  pdf_outline: [
    {
      label: '成功',
      ok: true,
      data: {
        pageCount: 10,
        metadata: { title: 'Sample PDF', author: 'Author' },
        outline: [{ title: 'Chapter 1', pageNumber: 1, depth: 1 }]
      }
    }
  ],
  pdf_search: [
    {
      label: '有命中',
      ok: true,
      data: {
        totalMatchCount: 1,
        returnedMatchCount: 1,
        matches: [{ pageNumber: 2, matchedText: 'term', snippet: '...matching term...' }]
      }
    }
  ],
  pdf_read_pages: [
    {
      label: '有文本层',
      ok: true,
      data: {
        pages: [
          {
            pageNumber: 1,
            text: 'Page one text',
            textStatus: 'available',
            imageCount: 0,
            pageImagePath: '/runtime/page-1.png'
          }
        ]
      }
    },
    {
      label: '无文本层',
      ok: true,
      data: {
        pages: [
          {
            pageNumber: 2,
            text: '',
            textStatus: 'empty',
            imageCount: 1,
            pageImagePath: '/runtime/page-2.png'
          }
        ]
      }
    }
  ],
  ppt_read_outline: [
    {
      label: '成功',
      ok: true,
      data: {
        slideCount: 2,
        slides: [
          { slideId: 's1', slideIndex: 1, title: 'Intro' },
          { slideId: 's2', slideIndex: 2, title: 'Body' }
        ]
      }
    }
  ],
  ppt_read_slides: [
    {
      label: '成功',
      ok: true,
      data: {
        slides: [
          {
            slideId: 's1',
            slideIndex: 1,
            slideImagePath: '/runtime/slide-1.png',
            elements: [{ type: 'text', elementId: 'e1' }]
          }
        ]
      }
    }
  ],
  ppt_search: [
    {
      label: '有命中',
      ok: true,
      data: {
        totalMatchCount: 1,
        returnedMatchCount: 1,
        truncated: false,
        matches: [
          {
            slideIndex: 1,
            slideId: 's1',
            source: 'slide',
            matchedText: '关键词',
            text: '幻灯片含关键词'
          }
        ]
      }
    }
  ],
  ppt_edit: [
    { label: '成功', ok: true, data: { slideId: 's_new', createdElementIds: ['e_new_1'] } }
  ],
  excel_read: [
    {
      label: 'workbook',
      ok: true,
      args: { type: 'workbook', sourcePath: '/workspace/book.xlsx' },
      data: { sheets: [{ name: 'Sheet1', range: 'A1:D10', rowCount: 10, columnCount: 4 }] }
    },
    {
      label: 'range',
      ok: true,
      args: { type: 'range', sourcePath: '/workspace/book.xlsx', sheetName: 'Sheet1', range: 'A1:B2' },
      data: { sheetName: 'Sheet1', range: 'A1:B2', rows: [['Name', 'Score'], ['Alice', 90]] }
    },
    {
      label: 'style',
      ok: true,
      args: { type: 'style', sourcePath: '/workspace/book.xlsx', sheetName: 'Sheet1', range: 'A1' },
      data: {
        sheetName: 'Sheet1',
        range: 'A1',
        rows: [[{ bold: true, fontColor: 'FF0000', fillColor: null, numberFormat: null }]]
      }
    },
    {
      label: 'search',
      ok: true,
      args: { type: 'search', sourcePath: '/workspace/book.xlsx', query: 'Alice' },
      data: {
        totalMatchCount: 1,
        returnedMatchCount: 1,
        matches: [{ sheetName: 'Sheet1', address: 'B2', value: 'Alice' }]
      }
    }
  ],
  excel_edit: [
    {
      label: '编辑成功',
      ok: true,
      args: { type: 'set_range', sourcePath: '/workspace/book.xlsx' },
      data: {}
    },
    { label: '编辑失败', ok: false, data: { error: 'Sheet not found' } }
  ],
  image_generate: [
    { label: '成功', ok: true, data: { outputPath: '/workspace/assets/chart.png' } },
    { label: '失败', ok: true, data: { error: 'Invalid SVG' } }
  ],
  learn_skill: [
    { label: '成功', ok: true, args: { skillIds: ['docx-read'] }, data: {} }
  ],
  update_plan: [{ label: '成功', ok: true, data: {} }],
  read_image: [
    {
      label: '加载成功',
      ok: true,
      data: {
        images: [
          {
            path: '/workspace/screenshot.png',
            mimeType: 'image/png',
            sizeBytes: 1024,
            width: 800,
            height: 600
          }
        ]
      }
    },
    { label: '无图片', ok: true, data: { images: [] } }
  ]
}

const mdCode = (lang: string, content: string): string =>
  `\`\`\`${lang}\n${content.trimEnd()}\n\`\`\``

const buildExamples = (toolName: string, spec: HumanToolSpec): ExampleCase[] => {
  const inputExamples = INPUT_EXAMPLES_OVERRIDE[toolName] || extractUnionExamples(spec.inputSchema)
  const outputCases = OUTPUT_CASES[toolName] || []

  if (outputCases.length === 0) {
    return inputExamples.map(({ label, input }) => ({ label, ok: true, input, data: {} }))
  }

  return outputCases.map((c) => {
    const matched =
      inputExamples.find((ex) => {
        if (c.args?.type && ex.input.type === c.args.type) return true
        if (c.args?.action && ex.input.action === c.args.action) return true
        if (c.args?.query && 'query' in ex.input && !('url' in ex.input)) return true
        if (c.args?.url && 'url' in ex.input) return true
        return false
      }) || inputExamples[0]
    return {
      label: c.label,
      ok: c.ok,
      input: { ...(matched?.input || {}), ...(c.args || {}) },
      data: c.data
    }
  })
}

const formatInputFields = (rows: FieldRow[]): string => {
  if (rows.length === 0) return '_（无）_'
  return rows
    .map(
      (row) =>
        `- \`${row.path}\` · ${row.type} · ${row.required ? '必填' : '可选'} · ${row.description || '—'}`
    )
    .join('\n')
}

const formatOutputFields = (toolName: string): string => {
  const fields = OUTPUT_FIELDS[toolName]
  if (!fields || fields.length === 0) return '_（无）_'
  return fields.map((f) => `- \`${f.path}\` · ${f.description}`).join('\n')
}

const renderToolSection = (toolName: string): string => {
  const spec = getToolSpec(toolName)
  if (!spec) return `## ${toolName}\n\n_未找到_\n`

  const fieldRows = collectRootUnionFieldRows(spec.inputSchema) || extractFieldRows(spec.inputSchema)
  const examples = buildExamples(toolName, spec)

  const lines: string[] = []
  lines.push(`## ${toolName}`)
  lines.push(`> ${spec.promptSpec.description}`)
  lines.push('')
  lines.push('### 输入')
  lines.push(formatInputFields(fieldRows))
  lines.push('')
  lines.push('### 输出')
  lines.push(formatOutputFields(toolName))
  lines.push('')
  lines.push('### 示例')

  examples.forEach((ex) => {
    const renderer = ex.ok
      ? spec.modelResult.renderSuccess
      : spec.modelResult.renderError || renderGenericModelError
    const rendered = renderModelResultWith(renderer, {
      toolName,
      args: ex.input,
      data: ex.data
    })
    lines.push(`#### ${ex.label}`)
    lines.push('输入：')
    lines.push(mdCode('json', JSON.stringify(ex.input, null, 2)))
    lines.push('输出：')
    lines.push(mdCode('json', JSON.stringify(ex.data ?? null, null, 2)))
    lines.push('渲染结果：')
    lines.push(mdCode('text', rendered))
    lines.push('')
  })

  return lines.join('\n')
}

const buildDocument = (): string => {
  const lines: string[] = []
  lines.push('# Skill / Tool 契约审计')
  lines.push('')
  lines.push(`> \`pnpm dlx tsx scripts/doc/generate-ai-tool-prompt-audit.mts\` · ${new Date().toISOString()}`)
  lines.push('')

  for (const skillId of RUNTIME_SKILL_IDS) {
    const skill = RUNTIME_SKILL_CATALOG[skillId]
    const toolNames = listRuntimeToolNamesForSkill(skillId)
    lines.push(`# Skill: ${skillId}`)
    lines.push(`> ${skill.description}`)
    lines.push('')
    for (const toolName of toolNames) {
      lines.push(renderToolSection(toolName))
    }
  }

  return lines.join('\n')
}

const markdown = buildDocument()
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
fs.writeFileSync(OUT_PATH, markdown, 'utf8')
console.log(`Wrote ${OUT_PATH} (${markdown.length.toLocaleString()} chars)`)
