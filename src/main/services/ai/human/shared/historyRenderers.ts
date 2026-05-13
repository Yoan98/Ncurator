import type { JsonObject, JsonValue } from '../../../../../shared/types'
import { renderInlineList, renderLineList } from '../../utils/render'
import { summarizeWatchHint } from '../prompts/watchHints'
import type {
  HumanHistoryToolResult,
  HumanCompactBlock,
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
      'bodyIndex',
      'text',
      'preview',
      'summary'
    ])

    if (Array.isArray(item.cells)) {
      reduced.cells = item.cells.map((cell) => {
        if (!isJsonObject(cell)) return cell
        const reducedCell = pickObjectFields(cell, ['blockId', 'row', 'col'])
        if (Array.isArray(cell.paragraphs)) {
          reducedCell.paragraphs = cell.paragraphs.map((paragraph) => {
            if (!isJsonObject(paragraph)) return paragraph
            return pickObjectFields(paragraph, ['blockId', 'type', 'bodyIndex', 'text', 'preview'])
          })
        }
        return reducedCell
      })
    }

    if (Array.isArray(item.paragraphs)) {
      reduced.paragraphs = item.paragraphs.map((paragraph) => {
        if (!isJsonObject(paragraph)) return paragraph
        return pickObjectFields(paragraph, ['blockId', 'type', 'bodyIndex', 'text', 'preview'])
      })
    }

    return reduced
  })
}

const reduceDocxSearchMatches = (value: JsonValue | undefined): JsonValue | undefined => {
  if (!Array.isArray(value)) return undefined
  return value.map((item) => {
    if (!isJsonObject(item)) return item
    return pickObjectFields(item, ['blockId', 'blockType', 'bodyIndex', 'text'])
  })
}

const reduceDocxRevisions = (value: JsonValue | undefined): JsonValue | undefined => {
  if (!Array.isArray(value)) return undefined
  return value.map((item) => {
    if (!isJsonObject(item)) return item
    return pickObjectFields(item, ['revisionRef', 'parentRevisionRef', 'summary', 'isCurrent'])
  })
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
      return {
        ...base,
        ...pickObjectFields(result.data, ['sourcePath', 'currentRevisionRef', 'created', 'summary'])
      }
    case 'docx_read_blocks':
      return {
        ...base,
        ...pickObjectFields(result.data, ['fromBlockId', 'toBlockId', 'returnedBlockCount']),
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
        ...pickObjectFields(result.data, ['returnedBlockCount', 'totalBlockCount', 'truncated']),
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
          'truncated',
          'returnedBlockCount',
          'returnedMatchCount',
          'totalMatchCount',
          'fromBlockId',
          'toBlockId',
          'changedBlocks',
          'createdBlocks',
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

const renderDecisionNextAction = (record: HumanRoundRecord): string => {
  switch (record.thought.nextAction.action) {
    case 'learning':
      return `- 你准备下一步做：准备学习 ${renderQuotedNames(
        record.thought.nextAction.wantLearnSkillIds
      )}。`
    case 'hand':
      return `- 你准备下一步做：准备进入 hand，${
        record.thought.nextAction.toolUsePlan.mode === 'parallel'
          ? `以 parallel 模式并行执行 ${renderQuotedNames(
              record.thought.nextAction.toolUsePlan.calls.map((call) => call.toolName)
            )}。`
          : `以 serial 模式按顺序执行 ${renderQuotedNames(
              record.thought.nextAction.toolUsePlan.calls.map((call) => call.toolName)
            )}。`
      }`
    case 'mouth':
      return '- 你准备下一步做：准备进入 mouth 组织最终交付。'
  }
}

const renderBrainRoundDecision = (record: HumanRoundRecord): string =>
  `
- 你的判断：${record.thought.thought.summary}
${renderDecisionNextAction(record)}
`.trim()

const renderBrainRoundExecution = (record: HumanRoundRecord): string => {
  switch (record.execution.kind) {
    case 'pre_execution_blocked':
      return '- 没有进入真实执行，系统在执行前阻断了这轮动作。'
    case 'learning':
      return '- 进入 learning，按请求尝试补齐外置技能。'
    case 'hand': {
      const executedToolNames = record.execution.toolResults.map((result) => result.toolName)
      const actualToolNames =
        executedToolNames.length > 0
          ? executedToolNames
          : record.execution.toolUsePlan.calls.map((call) => call.toolName)
      return `
- 进入 hand，执行模式是 ${record.execution.toolUsePlan.mode}。
- ${
        record.execution.toolUsePlan.mode === 'parallel'
          ? `实际并行执行了 ${renderQuotedNames(actualToolNames)}。`
          : `实际按顺序执行了 ${renderQuotedNames(actualToolNames)}。`
      }
- 本轮实际执行了 ${String(record.execution.toolResults.length)} 个工具调用。
`
        .trim()
        .replace(/\n\n+/g, '\n')
    }
    case 'mouth':
      return '- 进入 mouth，组织最终说明。'
  }
}

const renderBrainRoundResult = (record: HumanRoundRecord): string => {
  switch (record.execution.kind) {
    case 'pre_execution_blocked':
      return '- 本轮在执行前被系统阻断，未进入真实 tool 执行。'
    case 'learning':
      return `
- 已加载的技能：${renderQuotedNames(record.execution.learningOutcome.loadedSkillIds)}
- 已跳过的重复技能：${renderQuotedNames(record.execution.learningOutcome.skippedDuplicateSkillIds)}
- 未识别的技能：${renderQuotedNames(record.execution.learningOutcome.skippedUnknownSkillIds)}
- 当前 active tool 数：${String(record.execution.learningOutcome.activeToolCount)}
`
        .trim()
        .replace(/\n\n+/g, '\n')
    case 'hand': {
      const execution = record.execution
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
          : ''

      return [toolAttempts, artifactLine].filter(Boolean).join('\n')
    }
    case 'mouth':
      return record.execution.completed ? '- 任务已完成。' : '- 任务未完成。'
  }
}

const renderBrainRoundRecord = (record: HumanRoundRecord): string =>
  `
- 第 ${record.roundId} 轮

决策了什么：
${renderBrainRoundDecision(record)}

做了什么：
${renderBrainRoundExecution(record)}

结果是什么：
${renderBrainRoundResult(record)}
`.trim()

export const renderBrainRoundSection = (records: HumanRoundRecord[]): string =>
  records.length > 0 ? records.map(renderBrainRoundRecord).join('\n\n') : 'none'

const renderCompactBlock = (block: HumanCompactBlock): string =>
  `
- compact block ${block.id}
  - kind：${block.kind}
  - source.roundIds：${block.source.roundIds.join(', ')}
  - summary：
${block.summary}
`.trim()

export const renderBrainCompactBlocks = (blocks: HumanCompactBlock[]): string =>
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
      const count = readNumberField(result.data, 'returnedBlockCount') || texts.length
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
      const blocks = summarizeArrayTexts(result.data.blocks, 'preview')
      const count = readNumberField(result.data, 'returnedBlockCount') || blocks.length
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
        content: typeof call?.args.text === 'string' ? call.args.text : undefined
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
      return [`执行前被阻断：${summarizeWatchHint(record.execution.watchHint)}`]
    case 'learning': {
      const loaded = record.execution.learningOutcome.loadedSkillIds
      const facts = loaded.length > 0 ? [`已补齐技能：${loaded.join('、')}`] : []
      if (record.execution.watchHint) {
        facts.push(`收敛提示：${summarizeWatchHint(record.execution.watchHint)}`)
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
      if (execution.watchHint) {
        facts.push(`收敛提示：${summarizeWatchHint(execution.watchHint)}`)
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
  roundHistory: HumanRoundRecord[]
  compactBlocks: HumanCompactBlock[]
}): string =>
  `
已压缩的过程历史：
${renderLineList(
  input.compactBlocks.map((block) => `- ${block.summary}`),
  {
    fallback: 'none',
    style: 'plain'
  }
)}

已发生的关键结果：
${renderMouthFactsSection(input.roundHistory)}
`
    .trim()
    .replace(/\n{3,}/g, '\n\n')
