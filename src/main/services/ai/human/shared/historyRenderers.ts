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

const DOCX_NODE_WHITELIST: NestedWhitelistConfig = {
  nodeId: true,
  visualId: true,
  blockId: true,
  type: true,
  blockIndex: true,
  text: true,
  kind: true,
  style: true,
  target: true,
  anchor: true,
  altText: true,
  tag: true,
  instruction: true,
  tableBlockId: true,
  visuals: {
    count: true,
    kinds: true
  },
  row: true,
  col: true
}
DOCX_NODE_WHITELIST.children = DOCX_NODE_WHITELIST
const DOCX_BLOCK_WHITELIST = DOCX_NODE_WHITELIST

const DOCX_WRITE_RESULT_WHITELIST: NestedWhitelistConfig = {
  sourcePath: true,
  postWriteReadback: {
    regions: {
      fromBlockId: true,
      fromBlockIndex: true,
      toBlockId: true,
      toBlockIndex: true,
      blocks: DOCX_BLOCK_WHITELIST
    }
  }
}

const PPT_SLIDE_WHITELIST: NestedWhitelistConfig = {
  slideId: true,
  slideIndex: true,
  title: true,
  text: true,
  notes: true,
  matchedText: true,
  source: true,
  elementCount: true,
  elements: {
    elementId: true,
    type: true,
    zIndex: true,
    bounds: true,
    text: true,
    latex: true,
    style: true,
    details: true
  }
}

const PPT_RESULT_WHITELIST: NestedWhitelistConfig = {
  ok: true,
  sourcePath: true,
  slideCount: true,
  changedSlideIds: true,
  slides: PPT_SLIDE_WHITELIST,
  matches: PPT_SLIDE_WHITELIST,
  totalMatchCount: true,
  returnedMatchCount: true,
  assetBucketId: true,
  images: {
    slideId: true,
    slideIndex: true,
    path: true,
    mimeType: true,
    width: true,
    height: true
  },
  postWriteReadback: {
    slides: PPT_SLIDE_WHITELIST,
    outlineWindow: PPT_SLIDE_WHITELIST
  },
  truncated: true,
  error: true
}

const EXCEL_CELL_WHITELIST: NestedWhitelistConfig = {
  sheetName: true,
  address: true,
  value: true,
  displayValue: true,
  formula: true,
  type: true,
  numberFormat: true
}

const FALLBACK_TOOL_HISTORY_WHITELIST: NestedWhitelistConfig = {
  message: true,
  error: true
}

const VISUAL_READ_RESULT_WHITELIST: NestedWhitelistConfig = {
  sourcePath: true,
  results: {
    visualId: true,
    index: true,
    text: true,
    error: true
  }
}

const TOOL_HISTORY_WHITELIST_BY_NAME: Record<string, NestedWhitelistConfig> = {
  image_generate: {
    outputPath: true,
    error: true
  },
  excel_read_outline: {
    sourcePath: true,
    sheetCount: true,
    sheets: {
      name: true,
      index: true,
      range: true,
      rowCount: true,
      columnCount: true,
      formulaCount: true,
      tables: true
    },
    error: true
  },
  excel_search: {
    sourcePath: true,
    query: true,
    matches: {
      ...EXCEL_CELL_WHITELIST,
      matchType: true,
      tableName: true,
      columnName: true
    },
    truncated: true,
    error: true
  },
  excel_read_cells: {
    sourcePath: true,
    cells: EXCEL_CELL_WHITELIST,
    error: true
  },
  excel_edit: {
    sourcePath: true,
    changed: true,
    changes: {
      sheetName: true,
      address: true,
      kind: true
    },
    postWriteReadback: EXCEL_CELL_WHITELIST,
    diffPath: true,
    record: {
      id: true,
      status: true,
      path: true,
      operation: true,
      changeCount: true,
      insertCount: true,
      deleteCount: true,
      previewPath: true
    },
    error: true
  },
  text_file_read: {
    sourcePath: true,
    content: true,
    startLine: true,
    endLine: true,
    totalLines: true,
    error: true,
    decisionHint: true,
    estimatedTokens: true,
    limit: true
  },
  terminal_run: {
    terminalId: true,
    terminalStatus: true,
    executionStatus: true,
    output: true,
    outputCursor: true,
    stdout: true,
    stderr: true,
    timedOut: true,
    exitCode: true,
    estimatedTokens: true,
    limit: true,
    error: true
  },
  terminal_read: {
    terminalId: true,
    terminalStatus: true,
    output: true,
    outputCursor: true,
    exitCode: true,
    error: true
  },
  terminal_stop: {
    terminalId: true,
    terminalStatus: true,
    stopped: true,
    error: true
  },
  kb_search: {
    items: {
      document_name: true,
      source_type: true,
      file_path: true,
      source_url: true,
      text: true
    }
  },
  kb_list_documents: {
    items: {
      id: true,
      name: true,
      source_type: true,
      file_path: true,
      source_url: true
    },
    total: true
  },
  docx_read_outline: {
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
    blocks: DOCX_BLOCK_WHITELIST
  },
  docx_read_visuals: VISUAL_READ_RESULT_WHITELIST,
  docx_edit: DOCX_WRITE_RESULT_WHITELIST,
  ppt_read_outline: PPT_RESULT_WHITELIST,
  ppt_read_slides: PPT_RESULT_WHITELIST,
  ppt_search: PPT_RESULT_WHITELIST,
  ppt_read_visuals: VISUAL_READ_RESULT_WHITELIST,
  ppt_edit: PPT_RESULT_WHITELIST,
  pdf_inspect: {
    sourcePath: true,
    pageCount: true,
    metadata: {
      title: true,
      author: true,
      subject: true,
      keywords: true,
      creator: true,
      producer: true,
      creationDate: true,
      modificationDate: true
    },
    outline: {
      title: true,
      pageNumber: true,
      depth: true
    },
    encrypted: true
  },
  pdf_search: {
    sourcePath: true,
    pageCount: true,
    query: true,
    mode: true,
    pageRange: {
      fromPage: true,
      toPage: true
    },
    totalMatchCount: true,
    returnedMatchCount: true,
    matches: {
      pageNumber: true,
      matchedText: true,
      snippet: true,
      start: true,
      end: true
    },
    pagesWithNoTextCount: true,
    pagesWithSuspiciousTextCount: true,
    error: true,
    decisionHint: true
  },
  pdf_read_pages: {
    sourcePath: true,
    pageCount: true,
    pages: {
      pageNumber: true,
      text: true,
      charCount: true,
      textStatus: true,
      imageCount: true,
      width: true,
      height: true,
      rotation: true
    },
    error: true,
    decisionHint: true
  },
  pdf_read_visuals: VISUAL_READ_RESULT_WHITELIST,
  web_search: {
    query: true,
    results: {
      rank: true,
      title: true,
      url: true,
      snippet: true
    },
    error: true,
    decisionHint: true,
    estimatedTokens: true,
    limit: true
  },
  web_crawl: {
    requestedUrl: true,
    finalUrl: true,
    title: true,
    markdown: true,
    publishedAt: true,
    error: true,
    decisionHint: true,
    estimatedTokens: true,
    limit: true,
    statusCode: true,
    url: true,
    links: {
      internal: {
        href: true,
        text: true,
        title: true,
        intrinsicScore: true,
        contextualScore: true,
        totalScore: true
      },
      external: {
        href: true,
        text: true,
        title: true,
        intrinsicScore: true,
        contextualScore: true,
        totalScore: true
      }
    }
  },
  browser_use: {
    action: true,
    page: {
      url: true,
      title: true
    },
    result: {
      extracted: true,
      actions: {
        description: true,
        method: true,
        arguments: true
      },
      success: true,
      message: true,
      actionDescription: true
    },
    error: true
  }
}

const renderJsonValue = (value: JsonValue | JsonObject | undefined): string =>
  value === undefined ? 'none' : JSON.stringify(value)

const toJsonValue = (value: JsonValue | undefined): JsonValue =>
  value === undefined ? null : value

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
    if (fieldValue === null) {
      reduced[key] = null
      return
    }
    const nestedValue = filterValueByWhitelist(fieldValue, rule)
    if (nestedValue !== undefined) reduced[key] = nestedValue
  })
  return reduced
}

const buildToolHistoryReturnValue = (result: HumanHistoryToolResult): JsonValue => {
  if (!isJsonObject(result.data)) {
    return result.data === undefined ? null : result.data
  }

  const config = TOOL_HISTORY_WHITELIST_BY_NAME[result.toolName] || FALLBACK_TOOL_HISTORY_WHITELIST
  const filteredValue = filterValueByWhitelist(result.data, config)
  const filtered = isJsonObject(filteredValue) ? filteredValue : {}
  if (typeof result.data.error === 'string' && result.data.error.trim()) {
    filtered.error = result.data.error
  }
  return toJsonValue(filtered)
}

const buildBrainToolAttemptText = (input: {
  call: ToolCallParam | undefined
  result: HumanHistoryToolResult
}): string =>
  [
    `- 工具：\`${input.result.toolName}\``,
    `  参数：${renderJsonValue(input.call?.args)}`,
    `  返回：${renderJsonValue(buildToolHistoryReturnValue(input.result))}`
  ]
    .filter(Boolean)
    .join('\n')

const renderBrainRoundDecision = (record: HumanRoundRecord): string =>
  `- ${record.thought.next}`

const renderLearningExecution = (
  record: HumanRoundRecord & {
    execution: Extract<HumanRoundRecord['execution'], { kind: 'learning' }>
  }
): string =>
  [
    '- 类型：learning',
    `- 学习：${renderQuotedNames(record.execution.learningOutcome.requestedSkillIds)}`,
    `- 结果：${record.execution.result}`
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
          execution.artifactRefs.map((artifact) => `\`${artifact.fileName}\``),
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
    case 'learning':
      return renderLearningExecution(
        record as HumanRoundRecord & {
          execution: Extract<HumanRoundRecord['execution'], { kind: 'learning' }>
        }
      )
    case 'hand':
      return renderHandExecution(
        record as HumanRoundRecord & {
          execution: Extract<HumanRoundRecord['execution'], { kind: 'hand' }>
        }
      )
    case 'mouth':
      return ['- 类型：mouth', `- 结果：${record.execution.result}`].join('\n')
    case 'fault':
      return ['- 类型：fault', `- 结果：${record.execution.result}`].join('\n')
  }
}

const renderBrainRoundRecord = (record: HumanRoundRecord): string => {
  const lines = [
    `- 第 ${record.roundId} 轮`,
    '判断：',
    renderBrainRoundDecision(record)
  ]
  if (record.thought.progressOverview) {
    lines.push('进展：', record.thought.progressOverview)
  }
  lines.push('执行：', renderBrainRoundExecution(record))
  return lines.join('\n')
}

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
