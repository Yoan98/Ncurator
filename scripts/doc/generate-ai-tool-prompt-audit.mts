/**
 * 生成 doc/ai-tool-prompt-audit.md（按需生成，不入库）
 * 运行：pnpm doc:ai-tool-prompt-audit
 */
import {
  buildBrainSystemPrompt,
  buildBrainUserMessageForInput
} from '../../src/main/services/ai/human/prompts/brain'
import { parseSkillMarkdown } from '../../src/main/services/skills/UserSkillService'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toJSONSchema } from 'zod/v4'
import type { z } from 'zod/v4'
import { RUNTIME_TOOLSET_IDS } from '../../src/main/services/ai/human/constants'
import {
  RUNTIME_TOOLSET_CATALOG,
  listRuntimeToolNamesForToolset
} from '../../src/main/services/ai/human/toolsets'
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
type OutputCase = {
  label: string
  ok: boolean
  input?: JsonObject
  args?: JsonObject
  data?: JsonValue
}
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
  const branches =
    asNodeArray(top.oneOf).length > 0 ? asNodeArray(top.oneOf) : asNodeArray(top.anyOf)
  if (branches.length <= 1) return null
  const rows: FieldRow[] = []
  branches.forEach((branch, index) => {
    const branchNode = unwrapNode(branch, root)
    const label = Object.prototype.hasOwnProperty.call(branchNode, 'const')
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
  const branches =
    asNodeArray(top.oneOf).length > 0 ? asNodeArray(top.oneOf) : asNodeArray(top.anyOf)
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
      const nested =
        asNodeArray(child.oneOf).length > 0 ? asNodeArray(child.oneOf) : asNodeArray(child.anyOf)
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
      input: (typeof input === 'object' && input && !Array.isArray(input)
        ? input
        : {}) as JsonObject
    }
  ]
}

const INPUT_EXAMPLES_OVERRIDE: Record<string, Array<{ label: string; input: JsonObject }>> = {
  web_search: [
    { label: 'search', input: { type: 'search', query: 'typescript tutorial' } },
    { label: 'fetch', input: { type: 'fetch', url: 'https://example.com/page' } }
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
      input: { sourcePath: '/workspace/src/app.ts', query: 'TODO', mode: 'literal' }
    },
    {
      label: 'regex',
      input: {
        sourcePath: '/workspace/src/app.ts',
        query: 'function\\s+\\w+',
        mode: 'regex'
      }
    }
  ],
  text_file_edit: [
    {
      label: 'edit',
      input: {
        sourcePath: '/workspace/src/config.ts',
        action: 'edit',
        edits: [{ oldText: 'debug: true', newText: 'debug: false' }]
      }
    },
    {
      label: 'create',
      input: {
        sourcePath: '/workspace/notes/todo.md',
        action: 'create',
        content: '# TODO\n\n- [ ] 补全测试\n'
      }
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
    { path: 'args.type', description: 'search | fetch' },
    { path: 'query / results[]', description: 'search：关键词与 SERP 列表' },
    { path: 'results[].rank / title / url / snippet?', description: 'search 候选' },
    {
      path: 'requestedUrl / finalUrl / title? / markdown / links / publishedAt?',
      description: 'fetch 单页正文'
    },
    { path: 'error?', description: '失败文案' }
  ],
  browser_use: [
    { path: 'error?', description: '失败文案（含 act 执行失败）' },
    { path: 'action', description: 'navigate | extract | observe | act' },
    { path: 'page.url / page.title?', description: '当前页' },
    { path: 'content', description: 'extract 正文' },
    { path: 'actions[].description', description: 'observe 候选动作' },
    {
      path: 'message / actionDescription',
      description: 'act 执行说明（成败由 ToolCallResult.ok 表达）'
    }
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
    {
      path: 'matches[].slideIndex / slideId / source / matchedText / text',
      description: '命中详情'
    }
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
  load_toolset: [{ path: 'args.toolsetNames', description: '加载的工具包名称' }],
  load_skill: [
    {
      path: 'loadedSkillNames / skippedDuplicateSkillNames',
      description: '新加载与已加载技能名称'
    },
    {
      path: 'unavailableSkills[]',
      description: 'name / error：不可用技能及原因；正文不写入历史反馈'
    }
  ],
  update_plan: [{ path: '—', description: '固定文案，不读 data' }],
  read_image: [
    { path: 'error?', description: '失败原因；免费目录明确无视觉能力时说明模型限制' },
    { path: 'images[].path', description: '图片路径' },
    { path: 'images[].width / height', description: '尺寸' },
    { path: 'images[].mimeType', description: 'MIME' }
  ]
}

const OUTPUT_CASES: Record<string, OutputCase[]> = {
  terminal_run: [
    {
      label: '命令执行中（长命令让出控制权）',
      input: {
        command: 'pnpm install',
        commandExplanation: '安装项目依赖，命令可能持续输出数秒'
      },
      ok: true,
      data: {
        terminalId: 'term-a1b2c3',
        status: 'running',
        output: [
          'Lockfile is up to date, resolution step is skipped',
          'Progress: resolved 1, reused 0, downloaded 0, added 0',
          'Packages: +128',
          '++++++++++++++++++++++++++++++++++++++++',
          'Downloading @esbuild/win32-x64@0.25.9: 5.12 MB/5.12 MB, done',
          'Progress: resolved 128, reused 96, downloaded 12, added 48'
        ].join('\n'),
        readEndPosition: 312,
        hasMoreOutput: true
      }
    },
    {
      label: '命令成功完成（测试通过）',
      input: {
        command: 'pnpm exec vitest run tests/case/unit/ai/terminal-tool-contract.test.ts',
        commandExplanation: '运行 terminal 契约单元测试，确认四态 status 与 payload 字段'
      },
      ok: true,
      data: {
        terminalId: 'term-a1b2c3',
        status: 'succeeded',
        output: [
          '',
          ' RUN  v4.0.18 D:/1-work-space/Ncurator-Desktop',
          '',
          ' ✓ tests/case/unit/ai/terminal-tool-contract.test.ts (5 tests) 6ms',
          '',
          ' Test Files  1 passed (1)',
          '      Tests  5 passed (5)',
          '   Start at  18:18:34',
          '   Duration  701ms',
          ''
        ].join('\n'),
        readEndPosition: 248,
        hasMoreOutput: false
      }
    },
    {
      label: '命令失败（非零退出码）',
      input: {
        command: 'pnpm exec vitest run tests/case/unit/app.test.ts',
        commandExplanation: '运行 app 单元测试，预期因断言失败而返回 failed'
      },
      ok: true,
      data: {
        terminalId: 'term-a1b2c3',
        status: 'failed',
        output: [
          '',
          ' FAIL  tests/case/unit/app.test.ts > compile > should pass typecheck',
          'AssertionError: expected true to be false',
          ' ❯ tests/case/unit/app.test.ts:42:5',
          "     40|   it('should pass typecheck', () => {",
          '     41|     const ok = validateProject()',
          '     42|     expect(ok).toBe(false)',
          '       |     ^',
          '',
          ' Test Files  1 failed (1)',
          '      Tests  1 failed | 2 passed (3)',
          ''
        ].join('\n'),
        readEndPosition: 386,
        hasMoreOutput: false
      }
    },
    {
      label: '命令执行失败（非零退出）',
      input: {
        command: 'node -e "process.exit(2)"',
        commandExplanation: '故意以非零退出码结束，验证 failed 状态回流'
      },
      ok: true,
      data: {
        terminalId: 'term-fail-exit',
        status: 'failed',
        output: '',
        readEndPosition: 0,
        hasMoreOutput: false
      }
    }
  ],
  terminal_read: [
    {
      label: '增量读取（命令仍在运行）',
      input: { terminalId: 'term-a1b2c3', readEndPosition: 312 },
      ok: true,
      data: {
        status: 'running',
        output: [
          'Progress: resolved 128, reused 96, downloaded 24, added 96',
          'Progress: resolved 128, reused 96, downloaded 31, added 118',
          'Progress: resolved 128, reused 96, downloaded 32, added 128, done',
          'node_modules/.pnpm postinstall$ node scripts/postinstall.mjs',
          'node_modules/.pnpm postinstall: Done'
        ].join('\n'),
        readEndPosition: 548,
        hasMoreOutput: true
      }
    },
    {
      label: '读取完成（命令已结束）',
      input: { terminalId: 'term-a1b2c3', readEndPosition: 548 },
      ok: true,
      data: {
        status: 'succeeded',
        output: [
          '',
          'dependencies:',
          '+ typescript 5.9.2',
          '+ vitest 4.0.18',
          '',
          'Done in 8.4s using pnpm v10.15.0',
          ''
        ].join('\n'),
        readEndPosition: 642,
        hasMoreOutput: false
      }
    },
    {
      label: '读取失败',
      input: { terminalId: 'term-expired' },
      ok: false,
      data: { error: 'Unknown terminalId: term-expired' }
    }
  ],
  text_file_read: [
    {
      label: '首次读取（含续读提示）',
      input: { sourcePath: '/workspace/docs/architecture.md' },
      ok: true,
      data: {
        content: [
          '# NCurator Architecture',
          '',
          '## AI Runtime',
          '',
          'Tools return structured data, then modelResult renders compact text.',
          '',
          '## Storage',
          '',
          'SQLite stores runs; LanceDB stores embeddings.'
        ].join('\n'),
        startLine: 1,
        endLine: 9,
        totalLines: 48,
        nextStartLine: 10
      }
    },
    {
      label: '分页续读',
      input: {
        sourcePath: '/workspace/docs/architecture.md',
        startLine: 10,
        lineCount: 6
      },
      ok: true,
      data: {
        content: [
          '## Terminal',
          '',
          'Persistent sessions support incremental reads via terminal_read.',
          '',
          'Status uses running | succeeded | failed | cancelled.',
          ''
        ].join('\n'),
        startLine: 10,
        endLine: 15,
        totalLines: 48
      }
    },
    { label: '读取失败', ok: false, data: { error: 'ENOENT: no such file or directory' } }
  ],
  text_file_search: [
    {
      label: '有命中',
      input: {
        sourcePath: '/workspace/src/main/services/ai/human/shared/modelToolResultRenderers.ts',
        query: 'renderTerminalStream',
        mode: 'literal'
      },
      ok: true,
      data: {
        totalMatchCount: 3,
        returnedMatchCount: 2,
        matches: [
          {
            line: 18,
            matchText: 'renderTerminalStream',
            textContext:
              "import {\n  formatTerminalMarker,\n  renderTerminalStream\n} from './renderFamilies/terminal'",
            truncated: false
          },
          {
            line: 52,
            matchText: 'renderTerminalStream',
            textContext:
              "  return renderTerminalStream({\n    output: readString(obj.output) || '',\n    markers: buildTerminalMarkers([",
            truncated: true
          }
        ]
      }
    },
    { label: '无命中', ok: true, data: { totalMatchCount: 0, returnedMatchCount: 0, matches: [] } },
    {
      label: '搜索失败',
      ok: false,
      data: { error: 'Invalid regular expression: Unterminated group' }
    }
  ],
  text_file_edit: [
    {
      label: '批量替换成功',
      input: {
        sourcePath: '/workspace/src/config.ts',
        action: 'edit',
        edits: [{ oldText: 'debug: true', newText: 'debug: false' }]
      },
      ok: true,
      data: {}
    },
    { label: '编辑失败', ok: false, data: { error: 'oldText not found in file (0 matches)' } }
  ],
  kb_search: [
    {
      label: '有结果（多文档命中）',
      input: { queryText: 'terminal 四态 status 契约', strategy: 'semantic', limit: 5 },
      ok: true,
      data: {
        total: 2,
        items: [
          {
            id: 'chunk-17',
            text: 'Terminal 工具输出 status 为 running | succeeded | failed | cancelled；terminal_run 返回 terminalId，terminal_read 不回传。',
            documentName: 'architecture.md',
            documentId: 'doc-arch',
            sourceType: 'file',
            filePath: '/workspace/docs/architecture.md'
          },
          {
            id: 'chunk-42',
            text: 'modelResult 对 terminal 使用 C 类渲染：正文输出后追加 [status: …]、[terminalId: …] 等方括号 marker。',
            documentName: 'ai-tool-prompt-audit.md',
            documentId: 'doc-audit',
            sourceType: 'file',
            filePath: '/workspace/doc/ai-tool-prompt-audit.md'
          }
        ]
      }
    },
    { label: '无结果', ok: true, data: { total: 0, items: [] } },
    { label: '检索失败', ok: false, data: { error: 'Embedding index unavailable for workspace' } }
  ],
  kb_list_documents: [
    {
      label: '有文档',
      ok: true,
      data: {
        total: 3,
        items: [
          {
            id: 'doc-arch',
            name: 'architecture.md',
            sourceType: 'file',
            filePath: '/workspace/docs/architecture.md',
            createdAt: 1725000000000,
            importStatus: 1
          },
          {
            id: 'doc-prd',
            name: 'workbench.md',
            sourceType: 'file',
            filePath: '/workspace/docs/prd/workbench.md',
            createdAt: 1725003600000,
            importStatus: 1
          },
          {
            id: 'doc-web',
            name: 'Release Notes',
            sourceType: 'url',
            sourceUrl: 'https://example.com/releases/v1.2',
            createdAt: 1725007200000,
            importStatus: 1
          }
        ]
      }
    },
    { label: '空列表', ok: true, data: { total: 0, items: [] } }
  ],
  web_search: [
    {
      label: 'search',
      input: { type: 'search', query: 'DeepSeek 最近融资' },
      ok: true,
      data: {
        query: 'DeepSeek 最近融资',
        results: [
          {
            rank: 1,
            title: 'DeepSeek 510亿A轮融资全解析',
            url: 'https://example.com/deepseek-funding',
            snippet: 'DeepSeek 完成首轮外部融资 510 亿元。'
          },
          {
            rank: 2,
            title: 'DeepSeek 融资详情',
            url: 'https://example.com/deepseek-details',
            snippet: '融资细节与投资方名单。'
          }
        ]
      }
    },
    {
      label: 'fetch',
      input: { type: 'fetch', url: 'https://example.com/deepseek-funding' },
      ok: true,
      data: {
        requestedUrl: 'https://example.com/deepseek-funding',
        finalUrl: 'https://example.com/deepseek-funding',
        title: 'DeepSeek 510亿A轮融资全解析',
        markdown: [
          '# DeepSeek 510亿A轮融资全解析',
          '',
          'DeepSeek 完成首轮外部融资 510 亿元，资金将用于算力与研发扩张。'
        ].join('\n'),
        links: { internal: [], external: [] },
        publishedAt: '2026-03-01'
      }
    },
    {
      label: 'fetch 失败',
      input: { type: 'fetch', url: 'https://private.example/internal' },
      ok: false,
      data: {
        error: 'HTTP 403 Forbidden',
        requestedUrl: 'https://private.example/internal',
        finalUrl: 'https://private.example/internal',
        statusCode: 403
      }
    },
    {
      label: 'search 无结果',
      input: { type: 'search', query: 'xyz-no-results-query' },
      ok: false,
      data: { error: 'web_search 没有找到相关结果' }
    }
  ],
  browser_use: [
    {
      label: 'navigate',
      ok: true,
      input: { action: 'navigate', url: 'https://example.com/docs' },
      data: {
        action: 'navigate',
        page: { url: 'https://example.com/docs', title: 'Example Docs — Getting Started' }
      }
    },
    {
      label: 'extract',
      ok: true,
      input: { action: 'extract', instruction: '提取安装步骤与注意事项' },
      data: {
        action: 'extract',
        page: { url: 'https://example.com/docs/install', title: 'Install Guide' },
        content: [
          '## Prerequisites',
          '',
          '- Node.js 20+',
          '- pnpm 10+',
          '',
          '## Steps',
          '',
          '1. Clone the repository',
          '2. Run `pnpm install`',
          '3. Run `pnpm dev` to start the desktop app',
          '',
          'Note: first launch may download embedding models (~400 MB).'
        ].join('\n')
      }
    },
    {
      label: 'observe',
      ok: true,
      input: { action: 'observe', instruction: '列出可点击的提交与取消按钮' },
      data: {
        action: 'observe',
        page: { url: 'https://example.com/form', title: 'Contact Form' },
        actions: [
          { description: 'Click primary button "Submit"' },
          { description: 'Click secondary button "Cancel"' },
          { description: 'Focus text field "Email address"' }
        ]
      }
    },
    {
      label: 'act 成功',
      ok: true,
      input: { action: 'act', instruction: '在 Email 输入框填入 test@example.com 并点击 Submit' },
      data: {
        action: 'act',
        page: { url: 'https://example.com/form', title: 'Contact Form' },
        message: 'Filled email and clicked Submit',
        actionDescription: 'Type test@example.com into Email field, then click Submit'
      }
    },
    {
      label: 'act 失败',
      ok: false,
      input: { action: 'act', instruction: '点击不存在的 Confirm 按钮' },
      data: {
        action: 'act',
        page: { url: 'https://example.com/form', title: 'Contact Form' },
        message: 'Element not found: button[name="Confirm"]',
        actionDescription: 'Click button[name="Confirm"]',
        error: 'Element not found: button[name="Confirm"]'
      }
    },
    { label: '浏览器错误', ok: false, data: { error: 'Browser service unavailable' } }
  ],
  docx_read_outline: [
    {
      label: '成功',
      input: {
        sourcePath: '/workspace/reports/q3-summary.docx',
        fromPercent: 0,
        toPercent: 40
      },
      ok: true,
      data: {
        fromPercent: 0,
        toPercent: 40,
        fromNodeIndex: 0,
        toNodeIndex: 6,
        totalRootCount: 18,
        segments: [
          {
            story: 'body',
            fromNodeIndex: 0,
            toNodeIndex: 2,
            textMap:
              '结构：标题 + 摘要段\n关键词：Q3、营收、同比\n代表句：[1] 第三季度业务回顾\n代表句：[2] 核心指标如下表'
          },
          {
            story: 'body',
            fromNodeIndex: 3,
            toNodeIndex: 6,
            textMap: '结构：表格 4x3 KPI 表\n关键词：GMV、转化率、留存\n代表句：[5] 华东区增长最快'
          }
        ]
      }
    }
  ],
  docx_search: [
    {
      label: '有命中',
      input: {
        sourcePath: '/workspace/reports/q3-summary.docx',
        query: '同比增长',
        mode: 'literal',
        includeContext: true
      },
      ok: true,
      data: {
        totalMatchCount: 2,
        returnedMatchCount: 1,
        matches: [
          {
            nodeId: 'node_14',
            nodeIndex: 14,
            type: 'paragraph',
            story: 'body',
            matchText: '同比增长',
            textContext: '本季度 GMV 达到 1.2 亿元，同比增长 18%，主要由新客转化驱动。',
            before: [
              {
                nodeId: 'node_13',
                nodeIndex: 13,
                type: 'paragraph',
                textPreview: '## 经营结果'
              }
            ],
            after: [
              {
                nodeId: 'node_15',
                nodeIndex: 15,
                type: 'table',
                textPreview: '区域 | GMV | 同比'
              }
            ]
          }
        ]
      }
    },
    { label: '无命中', ok: true, data: { totalMatchCount: 0, returnedMatchCount: 0, matches: [] } }
  ],
  docx_read_nodes: [
    {
      label: '段落与表格',
      input: {
        sourcePath: '/workspace/reports/q3-summary.docx',
        range: { type: 'node_index', fromNodeIndex: 12, toNodeIndex: 13 }
      },
      ok: true,
      data: {
        nodes: [
          {
            nodeId: 'node_12',
            type: 'paragraph',
            story: { storyId: 'body', type: 'body' },
            children: [
              {
                type: 'run',
                nodeId: 'n:12:1',
                style: { bold: true, color: '1F3864' },
                children: [{ type: 'text', text: '核心 KPI' }]
              }
            ]
          },
          {
            nodeId: 'node_13',
            type: 'table',
            story: { storyId: 'body', type: 'body' },
            children: [
              {
                type: 'table_row',
                nodeId: 'row:1',
                children: [
                  {
                    nodeId: 'cell:1:1',
                    type: 'table_cell',
                    row: 0,
                    col: 0,
                    children: [
                      {
                        type: 'paragraph',
                        children: [{ type: 'run', children: [{ type: 'text', text: 'GMV' }] }]
                      }
                    ]
                  },
                  {
                    nodeId: 'cell:1:2',
                    type: 'table_cell',
                    row: 0,
                    col: 1,
                    children: [
                      {
                        type: 'paragraph',
                        children: [{ type: 'run', children: [{ type: 'text', text: '1.2 亿' }] }]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    }
  ],
  docx_content_edit: [
    {
      label: '插入段落成功',
      input: {
        sourcePath: '/workspace/reports/q3-summary.docx',
        type: 'insert_nodes',
        anchorNodeId: 'node_10',
        position: 'after',
        nodes: [
          {
            type: 'paragraph',
            kind: 'paragraph',
            runs: [{ text: '本段为模型新增的执行摘要补充。', bold: true }]
          }
        ]
      },
      ok: true,
      data: { createdIds: ['node_27', 'n:27:1'] }
    },
    { label: '失败', ok: false, data: { error: 'anchorNodeId node_999 not found' } }
  ],
  docx_format: [
    {
      label: '局部加粗成功',
      input: {
        sourcePath: '/workspace/reports/q3-summary.docx',
        type: 'format_text',
        nodeId: 'n:14:1',
        bold: true,
        color: 'C00000'
      },
      ok: true,
      data: {}
    }
  ],
  docx_table_edit: [
    {
      label: '插入表格行成功',
      input: {
        sourcePath: '/workspace/reports/q3-summary.docx',
        type: 'insert_row',
        tableNodeId: 'node_15',
        rowIndex: 2,
        cells: [{ paragraphs: [{ kind: 'paragraph', runs: [{ text: '华南' }] }] }]
      },
      ok: true,
      data: { createdIds: ['row:4'] }
    }
  ],
  docx_comments_revisions: [
    {
      label: '添加批注成功',
      input: {
        sourcePath: '/workspace/reports/q3-summary.docx',
        type: 'add_comment',
        nodeId: 'node_14',
        text: '请核对 GMV 口径是否与 BI 一致'
      },
      ok: true,
      data: { createdIds: ['comment-8'] }
    }
  ],
  pdf_outline: [
    {
      label: '成功',
      input: { sourcePath: '/workspace/papers/deep-learning.pdf' },
      ok: true,
      data: {
        pageCount: 42,
        metadata: { title: 'Deep Learning (draft)', author: 'A. Researcher' },
        outline: [
          { title: '1 Introduction', pageNumber: 1, depth: 1 },
          { title: '1.1 Motivation', pageNumber: 2, depth: 2 },
          { title: '2 Architecture', pageNumber: 8, depth: 1 },
          { title: '2.1 CNN', pageNumber: 9, depth: 2 }
        ]
      }
    }
  ],
  pdf_search: [
    {
      label: '有命中',
      input: {
        sourcePath: '/workspace/papers/deep-learning.pdf',
        query: 'overfitting',
        mode: 'literal'
      },
      ok: true,
      data: {
        totalMatchCount: 3,
        returnedMatchCount: 2,
        matches: [
          {
            pageNumber: 9,
            matchedText: 'overfitting',
            snippet: '…training too long may cause overfitting on the validation set…'
          },
          {
            pageNumber: 31,
            matchedText: 'overfitting',
            snippet: '…regularization reduces overfitting by penalizing large weights…'
          }
        ]
      }
    }
  ],
  pdf_read_pages: [
    {
      label: '有文本层',
      input: { sourcePath: '/workspace/papers/deep-learning.pdf', pageNumbers: [1, 2] },
      ok: true,
      data: {
        sourcePath: '/workspace/papers/deep-learning.pdf',
        pageCount: 42,
        pages: [
          {
            pageNumber: 1,
            text: [
              'Deep Learning Overview',
              '',
              'Inputs → parameters → architecture → predictions → labels → loss → update'
            ].join('\n'),
            textStatus: 'available',
            charCount: 92,
            imageCount: 1,
            pageImagePath: '/runtime/deep-learning/page-1.png'
          },
          {
            pageNumber: 2,
            text: 'We study neural networks with multiple hidden layers and backpropagation.',
            textStatus: 'available',
            charCount: 68,
            imageCount: 0,
            pageImagePath: '/runtime/deep-learning/page-2.png'
          }
        ]
      }
    },
    {
      label: '无文本层（扫描页）',
      input: { sourcePath: '/workspace/scans/invoice-scan.pdf', pageNumbers: [1] },
      ok: true,
      data: {
        sourcePath: '/workspace/scans/invoice-scan.pdf',
        pages: [
          {
            pageNumber: 1,
            text: '',
            textStatus: 'empty',
            imageCount: 1,
            pageImagePath: '/runtime/invoice-scan/page-1.png'
          }
        ]
      }
    }
  ],
  ppt_read_outline: [
    {
      label: '成功',
      input: { sourcePath: '/workspace/decks/q3-review.pptx' },
      ok: true,
      data: {
        slideCount: 5,
        slides: [
          { slideId: 's1', slideIndex: 1, title: 'Q3 Business Review' },
          { slideId: 's2', slideIndex: 2, title: 'Executive Summary' },
          { slideId: 's3', slideIndex: 3, title: 'KPI Dashboard' },
          { slideId: 's4', slideIndex: 4, title: 'Regional Breakdown' },
          { slideId: 's5', slideIndex: 5, title: 'Next Steps' }
        ]
      }
    }
  ],
  ppt_read_slides: [
    {
      label: '成功',
      input: {
        sourcePath: '/workspace/decks/q3-review.pptx',
        slideIds: ['s3'],
        detail: 'full'
      },
      ok: true,
      data: {
        slides: [
          {
            slideId: 's3',
            slideIndex: 3,
            slideImagePath: '/runtime/q3-review/slide-3.png',
            elements: [
              { type: 'title', elementId: 'e-title', text: 'KPI Dashboard' },
              { type: 'chart', elementId: 'e-chart-gmv' },
              { type: 'table', elementId: 'e-table-region' },
              { type: 'text', elementId: 'e-footnote', text: 'Source: internal BI' }
            ]
          }
        ]
      }
    }
  ],
  ppt_search: [
    {
      label: '有命中',
      input: {
        sourcePath: '/workspace/decks/q3-review.pptx',
        query: 'GMV',
        mode: 'literal'
      },
      ok: true,
      data: {
        totalMatchCount: 2,
        returnedMatchCount: 2,
        truncated: false,
        matches: [
          {
            slideIndex: 3,
            slideId: 's3',
            source: 'table_cell',
            matchedText: 'GMV',
            text: 'GMV | 1.2B | +18% YoY'
          },
          {
            slideIndex: 4,
            slideId: 's4',
            source: 'text_box',
            matchedText: 'GMV',
            text: 'East China led GMV growth this quarter.'
          }
        ]
      }
    }
  ],
  ppt_edit: [
    {
      label: '成功',
      input: {
        sourcePath: '/workspace/decks/q3-review.pptx',
        type: 'add_text_box',
        slideId: 's5',
        text: 'Contact: ops@example.com'
      },
      ok: true,
      data: { slideId: 's5', createdElementIds: ['e-contact-1'] }
    }
  ],
  excel_read: [
    {
      label: 'workbook',
      ok: true,
      input: { type: 'workbook', sourcePath: '/workspace/data/q3-kpi.xlsx' },
      data: {
        sheets: [
          { name: 'Summary', range: 'A1:F20', rowCount: 20, columnCount: 6 },
          { name: 'Regions', range: 'A1:D50', rowCount: 50, columnCount: 4 },
          { name: 'Raw', range: 'A1:Z500', rowCount: 500, columnCount: 26 }
        ]
      }
    },
    {
      label: 'range',
      ok: true,
      input: {
        type: 'range',
        sourcePath: '/workspace/data/q3-kpi.xlsx',
        sheetName: 'Summary',
        range: 'A1:C4'
      },
      data: {
        sheetName: 'Summary',
        range: 'A1:C4',
        rows: [
          ['Metric', 'Value', 'YoY'],
          ['GMV', 1200000000, 0.18],
          ['Orders', 842000, 0.11],
          ['Conversion', 0.034, 0.006]
        ]
      }
    },
    {
      label: 'style',
      ok: true,
      input: {
        type: 'style',
        sourcePath: '/workspace/data/q3-kpi.xlsx',
        sheetName: 'Summary',
        range: 'A1:C1'
      },
      data: {
        sheetName: 'Summary',
        range: 'A1:C1',
        rows: [
          [
            { bold: true, fontColor: 'FFFFFF', fillColor: '1F3864', numberFormat: null },
            { bold: true, fontColor: 'FFFFFF', fillColor: '1F3864', numberFormat: null },
            { bold: true, fontColor: 'FFFFFF', fillColor: '1F3864', numberFormat: '0.0%' }
          ]
        ]
      }
    },
    {
      label: 'search',
      ok: true,
      input: {
        type: 'search',
        sourcePath: '/workspace/data/q3-kpi.xlsx',
        query: 'GMV',
        mode: 'literal'
      },
      data: {
        totalMatchCount: 2,
        returnedMatchCount: 2,
        matches: [
          { sheetName: 'Summary', address: 'A2', value: 'GMV' },
          { sheetName: 'Regions', address: 'B12', value: 'East GMV' }
        ]
      }
    }
  ],
  excel_edit: [
    {
      label: '编辑成功',
      ok: true,
      input: {
        type: 'set_range',
        sourcePath: '/workspace/data/q3-kpi.xlsx',
        sheetName: 'Summary',
        range: 'B4',
        values: [[0.036]]
      },
      data: {}
    },
    { label: '编辑失败', ok: false, data: { error: 'Sheet "Missing" not found' } }
  ],
  image_generate: [
    {
      label: '成功',
      input: {
        outputPath: '/workspace/assets/q3-gmv-chart.png',
        format: 'png',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">…</svg>'
      },
      ok: true,
      data: { outputPath: '/workspace/assets/q3-gmv-chart.png', width: 640, height: 360 }
    },
    { label: '失败', ok: true, data: { error: 'Invalid SVG: unclosed tag <rect>' } }
  ],
  load_toolset: [
    {
      label: '成功',
      input: { toolsetNames: ['docx-read', 'docx-write'] },
      ok: true,
      data: {}
    }
  ],
  load_skill: [
    {
      label: '说明加载',
      input: { skillNames: ['weekly-report'] },
      ok: true,
      data: {
        loadedSkillNames: ['weekly-report'],
        skippedDuplicateSkillNames: [],
        unavailableSkills: []
      }
    }
  ],
  update_plan: [{ label: '成功', ok: true, data: {} }],
  read_image: [
    {
      label: '加载成功',
      input: {
        images: [
          { path: '/workspace/screenshots/workbench-run.png' },
          { path: '/workspace/screenshots/terminal-output.png' }
        ]
      },
      ok: true,
      data: {
        images: [
          {
            path: '/workspace/screenshots/workbench-run.png',
            mimeType: 'image/png',
            sizeBytes: 248_320,
            width: 1440,
            height: 900
          },
          {
            path: '/workspace/screenshots/terminal-output.png',
            mimeType: 'image/png',
            sizeBytes: 96_512,
            width: 960,
            height: 540
          }
        ]
      }
    },
    { label: '无图片', ok: true, data: { images: [] } },
    {
      label: '当前免费模型不支持图片',
      ok: false,
      data: {
        error:
          'The current model does not support image input. No image content was loaded. Do not retry read_image with this model or infer image contents. Explain this limitation to the user and continue with available text. If image contents are needed, suggest switching to a model with vision support.'
      }
    }
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
      input: c.input ?? { ...(matched?.input || {}), ...(c.args || {}) },
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

  const fieldRows =
    collectRootUnionFieldRows(spec.inputSchema) || extractFieldRows(spec.inputSchema)
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

const renderSkillPromptExample = (): string => {
  const directory = path.join(ROOT, 'tests/fixtures/workspace/skills/weekly-report')
  const parsed = parseSkillMarkdown(fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf8'))
  const skill = {
    id: 'user:example',
    name: parsed.name,
    description: parsed.description,
    directoryName: parsed.name,
    createdAt: 0
  }
  const loaded = { skill, body: parsed.body, resourceBase: directory }
  const ctx = {
    partnerId: 'prompt-example',
    partnerName: '周报助手',
    platform: 'macos' as const,
    userSkillService: { listEnabled: () => [skill], loadEnabled: () => loaded }
  }
  const user = buildBrainUserMessageForInput({
    userInput: '按周报规范整理本周进展。事实：完成客户访谈；外部联调延期；下周提交方案。',
    preference: 'default',
    referenceScope: { selectedReferences: [], attachments: [] },
    workspaceRoots: ['/workspace/project'],
    runStartedAt: Date.parse('2026-10-23T01:00:00Z')
  })
  const before = buildBrainSystemPrompt({ ctx })
  const after = buildBrainSystemPrompt({ ctx, loadedSkills: [loaded] })
  const messages = [
    { role: 'system', content: after },
    { role: 'user', content: user },
    {
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: 'call-skill',
          name: 'load_skill',
          arguments: JSON.stringify({ skillNames: [skill.name] })
        }
      ]
    },
    { role: 'tool', toolCallId: 'call-skill', content: `Loaded: ${skill.name}.` }
  ]
  const exampleRoot = path.join(ROOT, '.codex-tmp/skill-prompt-example')
  fs.mkdirSync(exampleRoot, { recursive: true })
  fs.writeFileSync(
    path.join(exampleRoot, 'example-notes.txt'),
    '示例通过当前生产提示词组装函数与周报 fixture 生成，未调用模型。actual-model-* 文件来自真实 AI live 请求（如已执行）。\n'
  )
  fs.writeFileSync(
    path.join(exampleRoot, 'loader-descriptions.json'),
    JSON.stringify(
      ['load_toolset', 'load_skill'].map((name) => getToolSpec(name)?.promptSpec),
      null,
      2
    )
  )
  fs.writeFileSync(path.join(exampleRoot, 'system-before-load.txt'), before)
  fs.writeFileSync(path.join(exampleRoot, 'system-after-load.txt'), after)
  fs.writeFileSync(
    path.join(exampleRoot, 'messages-after-load.json'),
    JSON.stringify(messages, null, 2)
  )
  fs.writeFileSync(
    path.join(exampleRoot, 'messages-before-load.json'),
    JSON.stringify(
      messages
        .slice(0, 2)
        .map((message, index) => (index === 0 ? { ...message, content: before } : message)),
      null,
      2
    )
  )
  return [
    '# Skill 加载后的完整提示词示例',
    '示例通过生产提示词组装函数生成；技能来自周报 fixture。正文只投递在首条 System，历史工具结果仅记录名称和加载状态。',
    mdCode('text', after),
    '## 消息数组',
    mdCode('json', JSON.stringify(messages, null, 2))
  ].join('\n\n')
}

const buildDocument = (): string => {
  const lines: string[] = []
  lines.push('# Toolset / Tool 契约审计')
  lines.push('')
  lines.push(`> \`pnpm doc:ai-tool-prompt-audit\` · ${new Date().toISOString()}`)
  lines.push('')

  for (const toolsetId of RUNTIME_TOOLSET_IDS) {
    const toolset = RUNTIME_TOOLSET_CATALOG[toolsetId]
    const toolNames = listRuntimeToolNamesForToolset(toolsetId)
    lines.push(`# Toolset: ${toolsetId}`)
    lines.push(`> ${toolset.description}`)
    lines.push('')
    for (const toolName of toolNames) {
      lines.push(renderToolSection(toolName))
    }
  }

  lines.push(renderSkillPromptExample())
  return lines.join('\n')
}

const markdown = buildDocument()
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
fs.writeFileSync(OUT_PATH, markdown, 'utf8')
console.log(`Wrote ${OUT_PATH} (${markdown.length.toLocaleString()} chars)`)
