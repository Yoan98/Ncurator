import type { JsonObject, JsonValue } from '../../../../../shared/types'
import { renderInlineList, renderLineList } from '../../utils/render'
import { summarizeDecisionHint } from '../prompts/decisionHints'
import type {
  HumanHistoryToolResult,
  HumanCompactionBlock,
  HumanRoundRecord,
  ToolCallParam
} from '../types'

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const renderQuotedNames = (items: readonly string[]): string =>
  renderInlineList(
    items.map((item) => `\`${item}\``),
    {
      separator: '、',
      fallback: 'none'
    }
  )

const renderJsonValue = (value: JsonValue | JsonObject | undefined): string =>
  value === undefined ? 'none' : JSON.stringify(value, null, 2)

const readStringField = (obj: JsonObject, key: string): string | undefined => {
  const value = obj[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

const readNumberField = (obj: JsonObject, key: string): number | undefined => {
  const value = obj[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const setJsonFieldIfDefined = (obj: JsonObject, key: string, value: JsonValue | undefined): void => {
  if (value !== undefined) obj[key] = value
}

const pickObjectFields = (
  obj: JsonObject,
  keys: string[]
): JsonObject =>
  keys.reduce<JsonObject>((acc, key) => {
    const value = obj[key]
    if (value !== undefined) acc[key] = value
    return acc
  }, {})

const reduceDocxBlocks = (value: JsonValue | undefined): JsonValue | undefined => {
  if (!Array.isArray(value)) return undefined
  return value.map((item) => {
    if (!isJsonObject(item)) return item
    const reduced = pickObjectFields(item, [
      'blockId',
      'type',
      'blockIndex',
      'text',
      'summary'
    ])

    if (Array.isArray(item.cells)) {
      reduced.cells = item.cells.map((cell) => {
        if (!isJsonObject(cell)) return cell
        const reducedCell = pickObjectFields(cell, ['blockId', 'row', 'col'])
        if (Array.isArray(cell.paragraphs)) {
          reducedCell.paragraphs = cell.paragraphs.map((paragraph) => {
            if (!isJsonObject(paragraph)) return paragraph
            return pickObjectFields(paragraph, ['blockId', 'type', 'blockIndex', 'text'])
          })
        }
        return reducedCell
      })
    }

    if (Array.isArray(item.paragraphs)) {
      reduced.paragraphs = item.paragraphs.map((paragraph) => {
        if (!isJsonObject(paragraph)) return paragraph
        return pickObjectFields(paragraph, ['blockId', 'type', 'blockIndex', 'text'])
      })
    }

    return reduced
  })
}

const reduceDocxSearchMatches = (value: JsonValue | undefined): JsonValue | undefined => {
  if (!Array.isArray(value)) return undefined
  return value.map((item) => {
    if (!isJsonObject(item)) return item
    return pickObjectFields(item, ['blockId', 'type', 'blockIndex', 'matchedText', 'text'])
  })
}

const reduceDocxRevisions = (value: JsonValue | undefined): JsonValue | undefined => {
  if (!Array.isArray(value)) return undefined
  return value.map((item) => {
    if (!isJsonObject(item)) return item
    return pickObjectFields(item, ['revisionRef', 'parentRevisionRef', 'summary', 'isCurrent'])
  })
}

const reduceDocxPostWriteReadback = (value: JsonValue | undefined): JsonValue | undefined => {
  if (!isJsonObject(value)) return undefined
  const reducedRegions = Array.isArray(value.regions)
    ? value.regions.flatMap((region) => {
        if (!isJsonObject(region)) return region
        const fromBlockIndex = readNumberField(region, 'fromBlockIndex')
        const toBlockIndex = readNumberField(region, 'toBlockIndex')
        if (fromBlockIndex === undefined || toBlockIndex === undefined) return []
        return {
          fromBlockIndex,
          toBlockIndex,
          ...(reduceDocxBlocks(region.blocks) ? { blocks: reduceDocxBlocks(region.blocks) } : {})
        }
      })
    : undefined
  return {
    ...(reducedRegions ? { regions: reducedRegions } : {})
  }
}

const buildBrainToolReturnValue = (result: HumanHistoryToolResult): JsonValue => {
  const base: JsonObject = {
    ok: result.ok,
    code: result.code
  }

  if (!isJsonObject(result.data)) {
    if (result.data !== undefined) base.data = result.data
    return base
  }

  switch (result.toolName) {
    case 'docx_create':
    case 'docx_paragraph_edit':
    case 'docx_heading_edit':
    case 'docx_table_edit':
    case 'docx_text_edit':
    case 'docx_text_style_edit':
    case 'docx_delete':
      return {
        ...base,
        ...pickObjectFields(result.data, ['sourcePath', 'previousRevisionRef', 'currentRevisionRef', 'summary', 'created']),
        ...(reduceDocxPostWriteReadback(result.data.postWriteReadback)
          ? { postWriteReadback: reduceDocxPostWriteReadback(result.data.postWriteReadback) }
          : {})
      }
    case 'docx_read_blocks':
      return {
        ...base,
        ...pickObjectFields(result.data, ['fromBlockIndex', 'toBlockIndex']),
        ...(reduceDocxBlocks(result.data.blocks) ? { blocks: reduceDocxBlocks(result.data.blocks) } : {})
      }
    case 'docx_search':
      return {
        ...base,
        ...pickObjectFields(result.data, [
          'mode',
          'effectiveQuery',
          'returnedMatchCount',
          'totalMatchCount'
        ]),
        ...(reduceDocxSearchMatches(result.data.matches)
          ? { matches: reduceDocxSearchMatches(result.data.matches) }
          : {})
      }
    case 'docx_outline':
      return {
        ...base,
        ...pickObjectFields(result.data, ['blocks']),
        ...(reduceDocxBlocks(result.data.blocks) ? { blocks: reduceDocxBlocks(result.data.blocks) } : {})
      }
    case 'docx_history':
      return {
        ...base,
        ...(reduceDocxRevisions(result.data.revisions)
          ? { revisions: reduceDocxRevisions(result.data.revisions) }
          : {})
      }
    default:
      return {
        ...base,
        ...pickObjectFields(result.data, [
          'summary',
          'message',
          'error',
          'sourcePath',
          'currentRevisionRef',
          'created',
          'outputPreview',
          'stdoutPreview',
          'stderrPreview',
          'cwd',
          'command',
          'exitCode',
          'timedOut',
          'returnedMatchCount',
          'totalMatchCount',
          'fromBlockIndex',
          'toBlockIndex',
          'items',
          'total',
          'hits',
          'rounds'
        ])
      }
  }
}

const buildBrainToolAttemptText = (input: {
  call: ToolCallParam | undefined
  result: HumanHistoryToolResult
}): string =>
  [
    `- \`${input.result.toolName}\``,
    '  调用参数：',
    renderJsonValue(input.call?.args),
    '  返回：',
    renderJsonValue(buildBrainToolReturnValue(input.result)),
    input.result.diagnosticText ? `  诊断：\n${input.result.diagnosticText}` : undefined
  ]
    .filter(Boolean)
    .join('\n')

const renderBrainRoundDecision = (record: HumanRoundRecord): string =>
  `- ${record.thought.thought.next}`

const renderLearningExecution = (
  record: HumanRoundRecord & {
    execution: Extract<HumanRoundRecord['execution'], { kind: 'learning' }>
  }
): string =>
  [
    '- 类型：learning',
    `- 学习：${renderQuotedNames(record.execution.learningOutcome.requestedSkillIds)}`,
    `- 学习成功：${renderQuotedNames(record.execution.learningOutcome.loadedSkillIds)}`,
    `- 已跳过重复：${renderQuotedNames(record.execution.learningOutcome.skippedDuplicateSkillIds)}`,
    `- 未识别：${renderQuotedNames(record.execution.learningOutcome.skippedUnknownSkillIds)}`,
    `- 当前 active tool 数：${String(record.execution.learningOutcome.activeToolCount)}`
  ].join('\n')

const renderHandExecution = (
  record: HumanRoundRecord & {
    execution: Extract<HumanRoundRecord['execution'], { kind: 'hand' }>
  }
): string => {
  const execution = record.execution
  const executedToolNames = execution.toolResults.map((result) => result.toolName)
  const actualToolNames =
    executedToolNames.length > 0
      ? executedToolNames
      : execution.toolUsePlan.calls.map((call) => call.toolName)
  const toolAttempts = execution.toolResults
    .map((result, index) =>
      buildBrainToolAttemptText({
        call: execution.toolUsePlan.calls[index],
        result
      })
    )
    .join('\n')
  const artifactLine =
    execution.artifactRefs && execution.artifactRefs.length > 0
      ? `- 产物：${renderInlineList(
          execution.artifactRefs.map((artifact) =>
            artifact.kind === 'file'
              ? `\`${artifact.fileName}\``
              : `draft review ${artifact.review.reviewId}`
          ),
          {
            separator: '、',
            fallback: 'none'
          }
        )}`
      : undefined

  return [
    '- 类型：hand',
    `- 模式：${execution.toolUsePlan.mode}`,
    `- 调用：${renderQuotedNames(actualToolNames)}`,
    toolAttempts,
    artifactLine
  ]
    .filter(Boolean)
    .join('\n')
}

const renderBrainRoundExecution = (record: HumanRoundRecord): string => {
  switch (record.execution.kind) {
    case 'pre_execution_blocked':
      return ['- 类型：blocked', '- 结果：系统在执行前阻断，本轮未进入真实执行。'].join('\n')
    case 'learning':
      return renderLearningExecution(record as HumanRoundRecord & {
        execution: Extract<HumanRoundRecord['execution'], { kind: 'learning' }>
      })
    case 'hand':
      return renderHandExecution(record as HumanRoundRecord & {
        execution: Extract<HumanRoundRecord['execution'], { kind: 'hand' }>
      })
    case 'mouth':
      return [
        '- 类型：mouth',
        '- 动作：组织最终交付',
        `- 结果：${record.execution.completed ? 'completed' : 'incomplete'}`
      ].join('\n')
  }
}

export const renderBrainRoundExecutionOnly = (record: HumanRoundRecord | undefined): string =>
  record ? renderBrainRoundExecution(record) : 'none'

const renderBrainRoundRecord = (record: HumanRoundRecord): string =>
  `
- 第 ${record.roundId} 轮

判断：
${renderBrainRoundDecision(record)}

执行：
${renderBrainRoundExecution(record)}
`.trim()

export const renderBrainRoundSection = (records: HumanRoundRecord[]): string =>
  records.length > 0 ? records.map(renderBrainRoundRecord).join('\n\n') : 'none'

const renderCompactBlock = (block: HumanCompactionBlock): string =>
  `
- compaction block ${block.id}
  - kind：${block.kind}
  - source.roundIds：${block.source.roundIds.join(', ')}
  - summary：
${block.summary}
`.trim()

export const renderBrainCompactBlocks = (blocks: HumanCompactionBlock[]): string =>
  blocks.length > 0 ? blocks.map(renderCompactBlock).join('\n\n') : 'none'

const summarizeArrayTexts = (value: JsonValue | undefined, key: string): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!isJsonObject(item)) return undefined
      return readStringField(item, key) || readStringField(item, 'preview') || readStringField(item, 'summary')
    })
    .filter((item): item is string => Boolean(item && item.length > 0))
}

const MOUTH_DOCX_TEXT_LIMIT = 420
const MOUTH_DOCX_TABLE_MAX_ROWS = 4

const clipText = (value: string, maxChars: number): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars - 1).trim()}…`
}

const renderMouthToolArgValue = (value: JsonValue | undefined): string => {
  if (value === undefined) return 'none'
  return JSON.stringify(value, null, 2)
}

const buildDocxWriteFact = (input: {
  toolName: HumanHistoryToolResult['toolName']
  action?: string
  target?: string
  contentLabel: string
  content: JsonValue | undefined
  extraLines?: string[]
}): string => {
  const header = [`\`${input.toolName}\` 已完成实际写入。`]
  if (input.action) header.push(`action=${input.action}`)
  if (input.target) header.push(`target=${input.target}`)
  const contentText =
    typeof input.content === 'string'
      ? clipText(input.content, MOUTH_DOCX_TEXT_LIMIT)
      : renderMouthToolArgValue(input.content)
  return [
    header.join('；'),
    `  - ${input.contentLabel}：`,
    contentText
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n'),
    ...(input.extraLines || []).map((line) => `  - ${line}`)
  ].join('\n')
}

const buildTableRowsPreview = (rows: JsonValue | undefined): JsonValue | undefined => {
  if (!Array.isArray(rows)) return rows
  if (rows.length <= MOUTH_DOCX_TABLE_MAX_ROWS) return rows
  return [...rows.slice(0, MOUTH_DOCX_TABLE_MAX_ROWS), `... 其余 ${String(rows.length - MOUTH_DOCX_TABLE_MAX_ROWS)} 行省略`]
}

const summarizeToolResultForMouth = (input: {
  result: HumanHistoryToolResult
  call?: ToolCallParam
}): string => {
  const { result, call } = input
  if (result.diagnosticText) {
    return `\`${result.toolName}\` 未完成：${result.diagnosticText}`
  }

  if (!isJsonObject(result.data)) {
    return `\`${result.toolName}\`：${result.summary}`
  }

  switch (result.toolName) {
    case 'docx_read_blocks': {
      const texts = summarizeArrayTexts(result.data.blocks, 'text')
      const count = texts.length
      return texts.length > 0
        ? `\`${result.toolName}\` 读取到 ${String(count)} 个块：${texts.join(' / ')}`
        : `\`${result.toolName}\` 读取到 ${String(count)} 个块。`
    }
    case 'docx_search': {
      const matches = summarizeArrayTexts(result.data.matches, 'text')
      const count = readNumberField(result.data, 'returnedMatchCount') || matches.length
      return matches.length > 0
        ? `\`${result.toolName}\` 命中 ${String(count)} 处：${matches.join(' / ')}`
        : `\`${result.toolName}\` 命中 ${String(count)} 处。`
    }
    case 'docx_outline': {
      const blocks = summarizeArrayTexts(result.data.blocks, 'text')
      const count = blocks.length
      return blocks.length > 0
        ? `\`${result.toolName}\` 概览到 ${String(count)} 个块：${blocks.join(' / ')}`
        : `\`${result.toolName}\` 概览到 ${String(count)} 个块。`
    }
    case 'docx_paragraph_edit':
    case 'docx_heading_edit': {
      return buildDocxWriteFact({
        toolName: result.toolName,
        action: typeof call?.args.action === 'string' ? call.args.action : undefined,
        target:
          typeof call?.args.blockId === 'string'
            ? `blockId=${call.args.blockId}`
            : typeof call?.args.anchorBlockId === 'string'
              ? `anchorBlockId=${call.args.anchorBlockId}`
              : undefined,
        contentLabel: '实际写入文本',
        content: Array.isArray(call?.args.paragraphs)
          ? call.args.paragraphs
          : Array.isArray(call?.args.headings)
            ? call.args.headings
            : undefined
      })
    }
    case 'docx_table_edit': {
      const rawRows = Array.isArray(call?.args.rows) ? call.args.rows : undefined
      const rows = buildTableRowsPreview(rawRows)
      return buildDocxWriteFact({
        toolName: result.toolName,
        action: typeof call?.args.action === 'string' ? call.args.action : undefined,
        target:
          typeof call?.args.blockId === 'string'
            ? `blockId=${call.args.blockId}`
            : typeof call?.args.anchorBlockId === 'string'
              ? `anchorBlockId=${call.args.anchorBlockId}`
              : undefined,
        contentLabel: '实际写入 rows',
        content: rows,
        extraLines: Array.isArray(rawRows) && rawRows.length > MOUTH_DOCX_TABLE_MAX_ROWS
          ? [`原始表格总行数=${String(rawRows.length)}`]
          : undefined
      })
    }
    case 'docx_text_edit': {
      const content: JsonObject = {}
      setJsonFieldIfDefined(
        content,
        'query',
        typeof call?.args.query === 'string' ? call.args.query : undefined
      )
      setJsonFieldIfDefined(
        content,
        'replace',
        typeof call?.args.replace === 'string' ? call.args.replace : undefined
      )
      return buildDocxWriteFact({
        toolName: result.toolName,
        target:
          Array.isArray(call?.args.blockIds) && call.args.blockIds.length > 0
            ? `blockIds=${renderMouthToolArgValue(call.args.blockIds)}`
            : undefined,
        contentLabel: '实际替换参数',
        content
      })
    }
    case 'docx_delete': {
      return buildDocxWriteFact({
        toolName: result.toolName,
        action: 'delete_block',
        target:
          Array.isArray(call?.args.blockIds) && call.args.blockIds.length > 0
            ? `blockIds=${call.args.blockIds.join(',')}`
            : undefined,
        contentLabel: '实际删除 block',
        content:
          Array.isArray(call?.args.blockIds) && call.args.blockIds.length > 0
            ? call.args.blockIds
            : undefined
      })
    }
    case 'docx_text_style_edit': {
      const content: JsonObject = {}
      setJsonFieldIfDefined(
        content,
        'query',
        typeof call?.args.query === 'string' ? call.args.query : undefined
      )
      setJsonFieldIfDefined(
        content,
        'style',
        isJsonObject(call?.args.style) ? call.args.style : undefined
      )
      return buildDocxWriteFact({
        toolName: result.toolName,
        target:
          typeof call?.args.blockId === 'string'
            ? `blockId=${call.args.blockId}`
            : undefined,
        contentLabel: '实际样式参数',
        content
      })
    }
    default: {
      const summary =
        readStringField(result.data, 'summary') ||
        readStringField(result.data, 'message') ||
        readStringField(result.data, 'outputPreview') ||
        readStringField(result.data, 'stdoutPreview')
      if (summary) return `\`${result.toolName}\`：${summary}`
      const items = summarizeArrayTexts(result.data.items, 'text')
      if (items.length > 0) return `\`${result.toolName}\` 返回：${items.join(' / ')}`
      return `\`${result.toolName}\`：${result.summary}`
    }
  }
}

const renderMouthRoundFacts = (record: HumanRoundRecord): string[] => {
  switch (record.execution.kind) {
    case 'pre_execution_blocked':
      return [`执行前被阻断：${summarizeDecisionHint(record.execution.decisionHint)}`]
    case 'learning': {
      const loaded = record.execution.learningOutcome.loadedSkillIds
      const facts = loaded.length > 0 ? [`已补齐技能：${loaded.join('、')}`] : []
      if (record.execution.decisionHint) {
        facts.push(`决策提示：${summarizeDecisionHint(record.execution.decisionHint)}`)
      }
      return facts
    }
    case 'hand': {
      const execution = record.execution
      const facts = execution.toolResults.map((result, index) =>
        summarizeToolResultForMouth({
          result,
          call: execution.toolUsePlan.calls[index]
        })
      )
      if (execution.decisionHint) {
        facts.push(`决策提示：${summarizeDecisionHint(execution.decisionHint)}`)
      }
      if (execution.artifactRefs && execution.artifactRefs.length > 0) {
        facts.push(
          `形成产物：${renderInlineList(
            execution.artifactRefs.map((artifact) =>
              artifact.kind === 'file'
                ? `\`${artifact.fileName}\``
                : `draft review ${artifact.review.reviewId}`
            ),
            {
              separator: '、',
              fallback: 'none'
            }
          )}`
        )
      }
      return facts
    }
    case 'mouth':
      return record.execution.completed ? ['已形成最终答复。'] : []
  }
}

const renderMouthFactsSection = (records: HumanRoundRecord[]): string =>
  renderLineList(
    records.flatMap(renderMouthRoundFacts).map((line) => `- ${line}`),
    {
      fallback: 'none',
      style: 'plain'
    }
  )

export const renderMouthHistoryText = (input: {
  rounds: HumanRoundRecord[]
  compactions: HumanCompactionBlock[]
}): string =>
  `
已压缩的过程历史：
${renderLineList(
  input.compactions.map((block) => `- ${block.summary}`),
  {
    fallback: 'none',
    style: 'plain'
  }
)}

已发生的关键结果：
${renderMouthFactsSection(input.rounds)}
`
    .trim()
    .replace(/\n{3,}/g, '\n\n')
