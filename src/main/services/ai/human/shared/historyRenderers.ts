import type { JsonObject, JsonValue } from '../../../../../shared/types'
import { renderInlineList } from '../../utils/render'
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

type NestedWhitelistConfig = {
  [key: string]: true | NestedWhitelistConfig
}

const DOCX_BLOCK_WHITELIST: NestedWhitelistConfig = {
  blockId: true,
  type: true,
  blockIndex: true,
  text: true
}

const DOCX_WRITE_RESULT_WHITELIST: NestedWhitelistConfig = {
  sourcePath: true,
  previousRevisionRef: true,
  currentRevisionRef: true,
  created: true,
  postWriteReadback: {
    regions: {
      fromBlockIndex: true,
      toBlockIndex: true,
      blocks: DOCX_BLOCK_WHITELIST
    }
  }
}

const FALLBACK_TOOL_HISTORY_WHITELIST: NestedWhitelistConfig = {
  message: true,
  error: true
}

const TOOL_HISTORY_WHITELIST_BY_NAME: Record<string, NestedWhitelistConfig> = {
  terminal_run: {
    stdout: true,
    stderr: true,
    exitCode: true,
    timedOut: true,
    estimatedTokens: true,
    limit: true,
    error: true
  },
  kb_search: {
    items: {
      document_name: true,
      text: true
    }
  },
  kb_list_documents: {
    items: {
      name: true
    },
    total: true
  },
  docx_outline: {
    sourcePath: true,
    currentRevisionRef: true,
    totalBlockCount: true,
    blocks: DOCX_BLOCK_WHITELIST
  },
  docx_search: {
    sourcePath: true,
    currentRevisionRef: true,
    mode: true,
    effectiveQuery: true,
    returnedMatchCount: true,
    totalMatchCount: true,
    matches: {
      blockId: true,
      type: true,
      blockIndex: true,
      matchedText: true,
      text: true
    }
  },
  docx_read_blocks: {
    sourcePath: true,
    currentRevisionRef: true,
    fromBlockIndex: true,
    toBlockIndex: true,
    blocks: DOCX_BLOCK_WHITELIST
  },
  docx_history: {
    sourcePath: true,
    currentRevisionRef: true,
    revisions: {
      revisionRef: true,
      parentRevisionRef: true,
      summary: true,
      isCurrent: true
    }
  },
  docx_create: DOCX_WRITE_RESULT_WHITELIST,
  docx_paragraph_edit: DOCX_WRITE_RESULT_WHITELIST,
  docx_heading_edit: DOCX_WRITE_RESULT_WHITELIST,
  docx_table_edit: DOCX_WRITE_RESULT_WHITELIST,
  docx_text_edit: DOCX_WRITE_RESULT_WHITELIST,
  docx_text_style_edit: DOCX_WRITE_RESULT_WHITELIST,
  docx_delete: DOCX_WRITE_RESULT_WHITELIST,
  docx_rollback: {
    sourcePath: true,
    previousRevisionRef: true,
    currentRevisionRef: true,
  }
}

const renderJsonValue = (value: JsonValue | JsonObject | undefined): string =>
  value === undefined ? 'none' : JSON.stringify(value)

const filterValueByWhitelist = (
  value: JsonValue | undefined,
  whitelist: NestedWhitelistConfig
): JsonValue | undefined => {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (!isJsonObject(item)) return item
      return filterValueByWhitelist(item, whitelist) ?? {}
    })
  }

  if (!isJsonObject(value)) return undefined

  const reduced: JsonObject = {}
  Object.entries(whitelist).forEach(([key, rule]) => {
    const fieldValue = value[key]
    if (fieldValue === undefined) return
    if (rule === true) {
      reduced[key] = fieldValue
      return
    }
    const nestedValue = filterValueByWhitelist(fieldValue, rule)
    if (nestedValue !== undefined) reduced[key] = nestedValue
  })
  return reduced
}

const buildToolHistoryReturnValue = (result: HumanHistoryToolResult): JsonValue => {
  if (!isJsonObject(result.data)) {
    return result.data
  }

  const config = TOOL_HISTORY_WHITELIST_BY_NAME[result.toolName] || FALLBACK_TOOL_HISTORY_WHITELIST
  return filterValueByWhitelist(result.data, config) ?? {}
}

const buildBrainToolAttemptText = (input: {
  call: ToolCallParam | undefined
  result: HumanHistoryToolResult
}): string =>
  [
    `- 工具：\`${input.result.toolName}\``,
    `  参数：${renderJsonValue(input.call?.args)}`,
    `  返回：${renderJsonValue(buildToolHistoryReturnValue(input.result))}`,
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
    `- 类型：learning；学习：${renderQuotedNames(record.execution.learningOutcome.requestedSkillIds)}；学习成功：${renderQuotedNames(record.execution.learningOutcome.loadedSkillIds)}`,
    record.execution.learningOutcome.skippedUnknownSkillIds.length > 0
      ? `- 未识别：${renderQuotedNames(record.execution.learningOutcome.skippedUnknownSkillIds)}`
      : undefined
  ]
    .filter(Boolean)
    .join('\n')

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
