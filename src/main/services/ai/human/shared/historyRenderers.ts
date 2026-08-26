import type { JsonObject, JsonValue } from '../../../../../shared/types'
import type { HumanHistoryToolResult } from '../types'

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

type NestedWhitelistConfig = {
  [key: string]: true | NestedWhitelistConfig
}

const DOCX_NODE_WHITELIST: NestedWhitelistConfig = {
  nodeId: true,
  visualId: true,
  type: true,
  nodeIndex: true,
  text: true,
  textPreview: true,
  styleId: true,
  story: true,
  kind: true,
  style: true,
  target: true,
  anchor: true,
  altText: true,
  tag: true,
  instruction: true,
  tableNodeId: true,
  visuals: {
    count: true,
    kinds: true
  },
  row: true,
  col: true,
  rows: true,
  columns: true,
  revisionKind: true
}
DOCX_NODE_WHITELIST.children = DOCX_NODE_WHITELIST
const DOCX_WRITE_RESULT_WHITELIST: NestedWhitelistConfig = {
  changes: {
    kind: true,
    nodeId: true,
    node: DOCX_NODE_WHITELIST
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
    type: true,
    sourcePath: true,
    content: true,
    startLine: true,
    endLine: true,
    totalLines: true,
    startOffset: true,
    endOffset: true,
    totalChars: true,
    error: true
  },
  text_file_search: {
    sourcePath: true,
    totalMatchCount: true,
    returnedMatchCount: true,
    matches: {
      line: true,
      charOffset: true,
      matchText: true,
      textContext: true,
      truncated: true
    },
    error: true
  },
  terminal_run: {
    terminalId: true,
    status: true,
    output: true,
    readEndPosition: true,
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
    status: true,
    output: true,
    readEndPosition: true,
    hasMoreOutput: true,
    exitCode: true,
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
    startPage: true,
    endPage: true,
    totalPages: true,
    segments: {
      story: true,
      fromNodeIndex: true,
      toNodeIndex: true,
      textMap: true
    }
  },
  docx_search: {
    totalMatchCount: true,
    matches: {
      nodeId: true,
      type: true,
      nodeIndex: true,
      story: true,
      matchText: true,
      textContext: true,
      tableNodeId: true,
      before: DOCX_NODE_WHITELIST,
      after: DOCX_NODE_WHITELIST
    }
  },
  docx_read_nodes: {
    sourcePath: true,
    currentRevisionRef: true,
    nodes: DOCX_NODE_WHITELIST
  },
  docx_read_visuals: VISUAL_READ_RESULT_WHITELIST,
  docx_content_edit: DOCX_WRITE_RESULT_WHITELIST,
  docx_format: DOCX_WRITE_RESULT_WHITELIST,
  docx_table_edit: DOCX_WRITE_RESULT_WHITELIST,
  docx_media_edit: DOCX_WRITE_RESULT_WHITELIST,
  docx_comments_revisions: DOCX_WRITE_RESULT_WHITELIST,
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
    error: true
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
    error: true
  },
  pdf_read_visuals: VISUAL_READ_RESULT_WHITELIST,
  web_search: {
    requestedUrl: true,
    finalUrl: true,
    title: true,
    markdown: true,
    publishedAt: true,
    error: true,
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
  },
  learn_skill: {
    message: true
  },
  update_plan: {
    message: true,
    plan: {
      title: true,
      status: true
    }
  }
}

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

export const buildToolHistoryReturnValue = (result: HumanHistoryToolResult): JsonObject => {
  if (result.ok) {
    const config =
      TOOL_HISTORY_WHITELIST_BY_NAME[result.toolName] || FALLBACK_TOOL_HISTORY_WHITELIST
    const filteredValue = filterValueByWhitelist(result.data, config)
    const filtered = isJsonObject(filteredValue) ? filteredValue : {}
    return { status: 'success', result: filtered }
  }

  const error =
    isJsonObject(result.data) && typeof result.data.error === 'string' && result.data.error.trim()
      ? result.data.error.trim()
      : 'tool call failed'
  return { status: 'fail', error }
}

export const buildToolResultMessageContent = (result: HumanHistoryToolResult): string =>
  JSON.stringify(buildToolHistoryReturnValue(result))
