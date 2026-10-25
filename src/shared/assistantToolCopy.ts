import type { IpcJsonObject, IpcJsonValue, RuntimeToolsetId, JsonValue, JsonObject } from './types'
import { getRuntimeToolsetDisplayName, type RuntimeToolName } from './runtimeCapabilities'
import type {
  AssistantExecutionStatus,
  AssistantExecutionTextSegment,
  AssistantExecutionIconKind
} from './assistantExecutionSummary'

const text = (
  value: string,
  emphasis = false,
  iconKind?: AssistantExecutionIconKind
): AssistantExecutionTextSegment => ({
  text: value,
  emphasis,
  iconKind
})

const param = (value: string): AssistantExecutionTextSegment => ({
  text: value,
  param: true
})

const sentence = (...segments: AssistantExecutionTextSegment[]): AssistantExecutionTextSegment[] =>
  segments

const readStringValue = (value: IpcJsonObject, key: string): string | undefined => {
  const candidate = value[key]
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined
}

const readFirstStringValue = (value: IpcJsonObject, keys: string[]): string | undefined => {
  for (const key of keys) {
    const candidate = readStringValue(value, key)
    if (candidate) return candidate
  }
  return undefined
}

const truncateMiddle = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value
  const keep = Math.max(8, Math.floor((maxLength - 1) / 2))
  return `${value.slice(0, keep)}…${value.slice(-keep)}`
}

export const readToolFileLabel = (input?: IpcJsonObject): string => {
  if (!input) return '目标文件'
  return (
    readFirstStringValue(input, [
      'fileName',
      'file_name',
      'sourceName',
      'source_name',
      'sourcePath',
      'source_path',
      'outputPath',
      'path',
      'filePath',
      'file_path'
    ]) || '目标文件'
  )
}

const readToolQueryLabel = (input?: IpcJsonObject): string => {
  if (!input) return '相关内容'
  return (
    readFirstStringValue(input, ['queryText', 'query', 'keyword', 'sourceNameQuery']) || '相关内容'
  )
}

const readCommandLabel = (input?: IpcJsonObject): string => {
  if (!input) return '一条本地命令'
  const command = readStringValue(input, 'command')
  return command ? truncateMiddle(command, 96) : '一条本地命令'
}

const readWebUrlLabel = (input?: IpcJsonObject): string => {
  if (!input) return '网页'
  const url = readStringValue(input, 'url')
  return url ? truncateMiddle(url, 96) : '网页'
}

const readInstructionLabel = (input?: IpcJsonObject): string => {
  if (!input) return '当前页面'
  const instruction = readStringValue(input, 'instruction')
  return instruction ? truncateMiddle(instruction.replace(/：/gu, ' '), 96) : '当前页面'
}

const readDocxRangeLabel = (input?: IpcJsonObject): string => {
  if (!input) return '内容'
  const candidate = (input as Record<string, IpcJsonValue>)['range']
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return '内容'
  const range = candidate as Record<string, IpcJsonValue>
  if (
    range.type === 'node_index' &&
    typeof range.fromNodeIndex === 'number' &&
    typeof range.toNodeIndex === 'number'
  ) {
    return `${String(range.fromNodeIndex)}-${String(range.toNodeIndex)} 区间`
  }
  if (range.type === 'node_ids') return '指定节点'
  return '内容'
}

const readLoadToolsetNames = (input?: IpcJsonObject): string => {
  if (!input) return '新能力'
  const raw = (input as Record<string, IpcJsonValue>).toolsetNames
  if (!Array.isArray(raw)) return '新能力'
  const names = raw
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((toolsetId) => getRuntimeToolsetDisplayName(toolsetId as RuntimeToolsetId) || toolsetId)
  return names.length > 0 ? names.join('、') : '新能力'
}

type ToolItemCopy = {
  headerShort: string
  detail: AssistantExecutionTextSegment[]
}

type ToolItemRenderer = (
  input: IpcJsonObject | undefined,
  status: AssistantExecutionStatus
) => ToolItemCopy

const toolCopy = (headerShort: string, detail: AssistantExecutionTextSegment[]): ToolItemCopy => ({
  headerShort,
  detail
})

/** UI-only projection input; never changes model arguments or includes document bodies. */
export const getToolDisplayInput = (
  toolName: string,
  args: IpcJsonObject,
  data?: JsonValue
): JsonObject | undefined => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  if (toolName === 'skill_edit' && typeof data.name === 'string')
    return { ...args, displayName: data.name }
  if (toolName === 'load_skill' && Array.isArray(data.requestedSkillNames))
    return {
      ...args,
      skillNames: data.requestedSkillNames,
      loadingFailures: data.unavailableSkills || [],
      loadingSuccessfulNames: [
        ...(Array.isArray(data.loadedSkillNames) ? data.loadedSkillNames : []),
        ...(Array.isArray(data.skippedDuplicateSkillNames) ? data.skippedDuplicateSkillNames : [])
      ]
    }
  if (toolName === 'load_toolset' && Array.isArray(data.toolsetNames))
    return {
      ...args,
      toolsetNames: data.toolsetNames,
      loadingFailures: data.loadingFailures || [],
      loadingSuccessfulNames: data.loadingSuccessfulNames || []
    }
  return undefined
}

export const getToolDisplayStatus = (
  input: IpcJsonObject | undefined,
  fallback: AssistantExecutionStatus
): AssistantExecutionStatus => {
  const failures = input && 'loadingFailures' in input ? input.loadingFailures : undefined
  const success =
    input && 'loadingSuccessfulNames' in input ? input.loadingSuccessfulNames : undefined
  return fallback !== 'running' && Array.isArray(failures) && failures.length
    ? Array.isArray(success) && success.length
      ? 'partial_failed'
      : 'failed'
    : fallback
}

const loadingCopy = (name: string, input?: IpcJsonObject): ToolItemCopy => {
  const failures = input && 'loadingFailures' in input ? input.loadingFailures : undefined
  const detail = sentence(text(`加载 ${name}`))
  if (Array.isArray(failures))
    for (const failure of failures) {
      if (failure && typeof failure === 'object' && !Array.isArray(failure))
        detail.push(text(`\n${String(failure.name || '')}：${String(failure.error || '加载失败')}`))
    }
  return toolCopy(`加载 ${name}`, detail)
}

const TOOL_ITEM_RENDERERS: Record<RuntimeToolName, ToolItemRenderer> = {
  terminal_run: (input) =>
    toolCopy('执行命令', sentence(text('执行命令 '), param(readCommandLabel(input)))),
  terminal_read: (input) =>
    toolCopy(
      '读取终端',
      sentence(text('读取终端 '), param(readStringValue(input || {}, 'terminalId') || '运行结果'))
    ),
  text_file_read: (input) =>
    toolCopy('读取文件', sentence(text('读取文件 '), param(readToolFileLabel(input)))),
  text_file_search: (input) =>
    toolCopy('搜索文件', sentence(text('搜索文件 '), param(readToolQueryLabel(input)))),
  text_file_edit: (input) =>
    toolCopy('编辑文件', sentence(text('编辑文件 '), param(readToolFileLabel(input)))),
  kb_search: (input) =>
    toolCopy('在知识库中搜索', sentence(text('在知识库中搜索 '), param(readToolQueryLabel(input)))),
  kb_list_documents: () => toolCopy('查看工作空间文档列表', sentence(text('查看工作空间文档列表'))),
  docx_read_outline: (input) =>
    toolCopy(
      '查看 Word 文档结构',
      sentence(text('查看 Word 文档 '), param(readToolFileLabel(input)), text(' 的结构'))
    ),
  docx_search: (input) =>
    toolCopy(
      '在 Word 文档中搜索',
      sentence(text('在 Word 文档中搜索 '), param(readToolQueryLabel(input)))
    ),
  docx_read_nodes: (input) =>
    toolCopy(
      '读取 Word 文档',
      sentence(
        text('读取 Word 文档 '),
        param(readToolFileLabel(input)),
        param(` ${readDocxRangeLabel(input)}`)
      )
    ),
  docx_content_edit: (input) =>
    toolCopy(
      '编辑 Word 文档内容',
      sentence(text('编辑 Word 文档内容 '), param(readToolFileLabel(input)))
    ),
  docx_format: (input) =>
    toolCopy(
      '设置 Word 文档格式',
      sentence(text('设置 Word 文档格式 '), param(readToolFileLabel(input)))
    ),
  docx_table_edit: (input) =>
    toolCopy(
      '编辑 Word 文档表格',
      sentence(text('编辑 Word 文档表格 '), param(readToolFileLabel(input)))
    ),
  docx_comments_revisions: (input) =>
    toolCopy(
      '处理 Word 文档批注或修订',
      sentence(text('处理 Word 文档批注或修订 '), param(readToolFileLabel(input)))
    ),
  pdf_outline: (input) =>
    toolCopy('查看 PDF 提纲', sentence(text('查看 PDF 提纲 '), param(readToolFileLabel(input)))),
  pdf_search: (input) =>
    toolCopy('在文档中搜索', sentence(text('在文档中搜索 '), param(readToolQueryLabel(input)))),
  pdf_read_pages: (input) =>
    toolCopy('读取 PDF 页面', sentence(text('读取 PDF 页面 '), param(readToolFileLabel(input)))),
  ppt_read_outline: (input) =>
    toolCopy('阅读 PPT 结构', sentence(text('阅读 PPT 结构 '), param(readToolFileLabel(input)))),
  ppt_read_slides: (input) =>
    toolCopy('读取 PPT 页面', sentence(text('读取 PPT 页面 '), param(readToolFileLabel(input)))),
  ppt_search: (input) =>
    toolCopy('搜索 PPT', sentence(text('搜索 PPT '), param(readToolQueryLabel(input)))),
  ppt_edit: (input) =>
    toolCopy('编辑 PPT', sentence(text('编辑 PPT '), param(readToolFileLabel(input)))),
  excel_read: (input) => {
    const type = readStringValue(input || {}, 'type') || ''
    if (type === 'search') {
      return toolCopy('搜索 Excel', sentence(text('搜索 Excel '), param(readToolQueryLabel(input))))
    }
    if (type === 'style') {
      return toolCopy(
        '读取 Excel 样式',
        sentence(text('读取 Excel 样式 '), param(readToolFileLabel(input)))
      )
    }
    if (type === 'range') {
      return toolCopy(
        '读取 Excel 范围',
        sentence(text('读取 Excel 范围 '), param(readToolFileLabel(input)))
      )
    }
    return toolCopy(
      '查看 Excel 结构',
      sentence(text('查看 Excel 结构 '), param(readToolFileLabel(input)))
    )
  },
  excel_edit: (input) =>
    toolCopy('编辑 Excel', sentence(text('编辑 Excel '), param(readToolFileLabel(input)))),
  web_search: (input) => {
    const type = readStringValue(input || {}, 'type')
    if (type === 'fetch') {
      const url = readStringValue(input || {}, 'url')
      return url
        ? toolCopy('抓取网页', sentence(text('抓取网页 '), param(truncateMiddle(url, 96))))
        : toolCopy('抓取网页', sentence(text('抓取网页')))
    }
    return toolCopy('搜索网页', sentence(text('搜索网页 '), param(readToolQueryLabel(input))))
  },
  browser_use: (input) => {
    const action = input ? readStringValue(input, 'action') || '' : ''
    const urlLabel = readWebUrlLabel(input)
    const instructionLabel = readInstructionLabel(input)
    const actionIdLabel = input ? readStringValue(input, 'actionId') || '' : ''
    const tabIdLabel = input ? readStringValue(input, 'tabId') || '' : ''
    if (action === 'navigate') {
      return toolCopy('打开网页', sentence(text('打开网页 '), param(urlLabel)))
    }
    if (action === 'list_tabs') {
      return toolCopy('列出标签', sentence(text('列出浏览器标签')))
    }
    if (action === 'observe') {
      return toolCopy('查看页面', sentence(text('查看页面并'), param(instructionLabel)))
    }
    if (action === 'extract') {
      return toolCopy('提取内容', sentence(text('从页面中'), param(instructionLabel)))
    }
    if (action === 'act') {
      return toolCopy(
        '操作页面',
        sentence(text('在页面上执行 '), param(actionIdLabel || instructionLabel || '动作'))
      )
    }
    if (action === 'act_instruction') {
      return toolCopy(
        '操作页面',
        sentence(text('在页面上执行 '), param(instructionLabel || '动作'))
      )
    }
    if (action === 'screenshot') {
      return toolCopy('截取页面', sentence(text('截取页面 '), param(tabIdLabel || '当前标签')))
    }
    if (action === 'scroll') {
      return toolCopy('滚动页面', sentence(text('滚动页面 '), param(tabIdLabel || '当前标签')))
    }
    return toolCopy('操作浏览器', sentence(text('操作浏览器 '), param(instructionLabel)))
  },
  read_image: () => toolCopy('读取图片', sentence(text('读取图片'))),
  ask_user_question: () => toolCopy('询问用户', sentence(text('等待用户确认关键信息'))),
  image_generate: (input) =>
    toolCopy('生成图片', sentence(text('生成图片 '), param(readToolFileLabel(input)))),
  load_skill: (input) => {
    const names = input && 'skillNames' in input ? input.skillNames : undefined
    const label = Array.isArray(names)
      ? names.filter((name): name is string => typeof name === 'string').join('、')
      : ''
    return loadingCopy(label || 'skill', input)
  },
  load_toolset: (input) => loadingCopy(readLoadToolsetNames(input), input),
  skill_read: () => toolCopy('读取 skill', sentence(text('读取 skill'))),
  skill_edit: (input) => {
    const data = input as Record<string, IpcJsonValue> | undefined
    const action = data?.sourcePath
      ? data.id
        ? '更新'
        : '创建'
      : data?.enabled === false
        ? '停用'
        : '启用'
    const name = typeof data?.displayName === 'string' ? data.displayName : 'skill'
    return toolCopy(`${action} ${name}`, sentence(text(`${action} ${name}`)))
  },
  list_agent: () => toolCopy('查看子任务', sentence(text('查看子任务'))),
  delegate_to_subagent: () => toolCopy('分头处理', sentence(text('分头处理'))),
  update_plan: () => toolCopy('更新任务计划', sentence(text('更新任务计划'))),
  scheduled_task_list: () => toolCopy('查看定时任务', sentence(text('查看当前伙伴的定时任务'))),
  scheduled_task_action: () => toolCopy('操作定时任务', sentence(text('操作定时任务')))
}

export const getAssistantToolItemCopy = (
  toolName: RuntimeToolName | 'unnamed',
  status: AssistantExecutionStatus,
  input?: IpcJsonObject
): ToolItemCopy =>
  toolName === 'unnamed'
    ? toolCopy('处理任务中的一步', sentence(text('处理任务中的一步')))
    : TOOL_ITEM_RENDERERS[toolName](input, status)
