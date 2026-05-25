import type { JsonObject, JsonValue } from '../../../../../shared/types'
import { renderInlineList } from '../../utils/render'
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
    executedToolNames.length > 0 ? executedToolNames : execution.calls.map((call) => call.toolName)
  const toolAttempts = execution.toolResults
    .map((result, index) =>
      buildBrainToolAttemptText({
        call: execution.calls[index],
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
        '- 动作：组织最终交付'
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
