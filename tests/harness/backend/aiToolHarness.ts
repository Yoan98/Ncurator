import fs from 'node:fs/promises'
import path from 'node:path'
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableCell,
  TableRow,
  UnderlineType,
  WidthType
} from 'docx'
import { buildDocxCapabilityTools } from '../../../src/main/services/ai/human/tools/docx'
import { releaseDocxRunSession } from '../../../src/main/services/ai/human/tools/docx/worker/docxWorkerClient'
import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS } from '../../../src/main/services/ai/human/constants'
import { buildKbCapabilityTools } from '../../../src/main/services/ai/human/tools/kb/retrievalTools'
import { buildTerminalCapabilityTools } from '../../../src/main/services/ai/human/tools/terminal/terminalTools'
import { utilityToolFamily } from '../../../src/main/services/ai/human/tools/utility'
import { webToolFamily } from '../../../src/main/services/ai/human/tools/web'
import { createHumanRuntimeCache } from '../../../src/main/services/ai/human/node/utils/runtimeCache'
import type { JsonObject, JsonValue } from '../../../src/shared/types'
import type { BackendTestRuntime, CreateAiRunContextInput } from './test-types'

type ToolArgs = JsonObject
type ToolOutput = JsonValue
type ToolLike = {
  name: string
  invoke: (input: ToolArgs) => Promise<ToolOutput>
}

export type CapturedToolActivity = {
  actionType: string
  status: 'started' | 'completed' | 'failed'
  summary: string
}

type TerminalToolHarnessOptions = {
  timeoutMs?: number
  maxOutputChars?: number
  safePreviewChars?: number
}

const createToolInvoker = (tools: readonly ToolLike[]) => {
  const toolMap = new Map(tools.map((tool) => [tool.name, tool] as const))

  return {
    async invoke<TResult extends ToolOutput>(name: string, args: ToolArgs): Promise<TResult> {
      const tool = toolMap.get(name)
      if (!tool) {
        throw new Error(`tool not found: ${name}`)
      }
      const normalizedArgs =
        name === 'docx_outline' && !('ranges' in args)
          ? {
              ...args,
              ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: Number.MAX_SAFE_INTEGER }]
            }
          : args
      return (await tool.invoke(normalizedArgs)) as TResult
    }
  }
}

export const createDocxToolHarness = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {}
) => {
  const ctx = runtime.createAiRunContext(contextInput)
  const cache = createHumanRuntimeCache()
  const activities: CapturedToolActivity[] = []
  const built = buildDocxCapabilityTools({
    ctx,
    cache,
    runId: runtime.runId,
    taskId: runtime.taskId,
    workspaceRootPath: runtime.workspaceRoot,
    safePreviewChars: 1400,
    modelContextWindowTokens:
      ctx.humanRuntimeOverrides?.modelContextWindowTokens ||
      DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
    emitActivity: (activity) => {
      activities.push(activity)
    }
  })

  return {
    ...createToolInvoker(built.tools as readonly ToolLike[]),
    ctx,
    state: built.state,
    activities,
    async release(): Promise<void> {
      await releaseDocxRunSession(runtime.runId)
    }
  }
}

export const createTerminalToolHarness = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {},
  options: TerminalToolHarnessOptions = {}
) => {
  const ctx = runtime.createAiRunContext(contextInput)
  const cache = createHumanRuntimeCache()
  const activities: CapturedToolActivity[] = []
  const built = buildTerminalCapabilityTools({
    ctx,
    cache,
    runId: runtime.runId,
    taskId: runtime.taskId,
    workspaceRootPath: runtime.workspaceRoot,
    timeoutMs: Math.max(100, Number(options.timeoutMs || 3000)),
    maxOutputChars: Math.max(256, Number(options.maxOutputChars || 4000)),
    safePreviewChars: Math.max(64, Number(options.safePreviewChars || 400)),
    emitActivity: (activity) => {
      activities.push(activity)
    }
  })

  return {
    ...createToolInvoker(built.tools as readonly ToolLike[]),
    ctx,
    state: built.state,
    activities
  }
}

export const createRetrievalToolHarness = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {}
) => {
  const ctx = runtime.createAiRunContext(contextInput)

  return {
    ...createToolInvoker(
      buildKbCapabilityTools({
        ctx,
        runId: runtime.runId,
        taskId: runtime.taskId
      }) as readonly ToolLike[]
    ),
    ctx
  }
}

export const createWebToolHarness = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {}
) => {
  const ctx = runtime.createAiRunContext(contextInput)
  const cache = createHumanRuntimeCache()

  return {
    ...createToolInvoker(
      webToolFamily.buildTools({
        ctx,
        cache,
        runId: runtime.runId,
        sessionId: contextInput.sessionId || 'test-session',
        taskId: runtime.taskId
      }) as readonly ToolLike[]
    ),
    ctx
  }
}

export const createUtilityToolHarness = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {}
) => {
  const ctx = runtime.createAiRunContext(contextInput)
  const cache = createHumanRuntimeCache()

  return {
    ...createToolInvoker(
      utilityToolFamily.buildTools({
        ctx,
        cache,
        runId: runtime.runId,
        sessionId: contextInput.sessionId || 'test-session',
        taskId: runtime.taskId
      }) as readonly ToolLike[]
    ),
    ctx
  }
}

export type TestDocxHeadingLevel = 1 | 2 | 3

export type TestDocxRun = {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
}

export type TestDocxParagraph = {
  style?: string
  runs: TestDocxRun[]
}

export type TestDocxCell = {
  paragraphs: TestDocxParagraph[]
}

export type TestDocxBlock =
  | {
      type: 'heading'
      text: string
      level?: TestDocxHeadingLevel
    }
  | {
      type: 'paragraph'
      text: string
    }
  | {
      type: 'table'
      rows: string[][]
    }

const toHeadingLevel = (level: TestDocxHeadingLevel | undefined): HeadingLevel => {
  if (level === 2) return HeadingLevel.HEADING_2
  if (level === 3) return HeadingLevel.HEADING_3
  return HeadingLevel.HEADING_1
}

export type RichTestDocxBlock =
  | {
      type: 'heading'
      level?: TestDocxHeadingLevel
      paragraph: TestDocxParagraph
    }
  | {
      type: 'paragraph'
      paragraph: TestDocxParagraph
    }
  | {
      type: 'table'
      rows: TestDocxCell[][]
    }

const createTextRun = (run: TestDocxRun): TextRun =>
  new TextRun({
    text: run.text,
    bold: run.bold,
    italics: run.italic,
    underline: run.underline ? { type: UnderlineType.SINGLE } : undefined,
    color: run.color
  })

const createParagraph = (
  paragraph: TestDocxParagraph,
  heading?: HeadingLevel
): Paragraph =>
  new Paragraph({
    heading,
    style: paragraph.style,
    children: paragraph.runs.map((run) => createTextRun(run))
  })

const toRichParagraph = (text: string): TestDocxParagraph => ({
  runs: [{ text }]
})

const toRichBlock = (block: TestDocxBlock): RichTestDocxBlock => {
  if (block.type === 'heading') {
    return {
      type: 'heading',
      level: block.level,
      paragraph: toRichParagraph(block.text)
    }
  }

  if (block.type === 'paragraph') {
    return {
      type: 'paragraph',
      paragraph: toRichParagraph(block.text)
    }
  }

  return {
    type: 'table',
    rows: block.rows.map((row) =>
      row.map((cellText) => ({
        paragraphs: [toRichParagraph(cellText)]
      }))
    )
  }
}

export const writeRichTestDocxFile = async (
  workspaceRoot: string,
  relativePath: string,
  blocks: readonly RichTestDocxBlock[]
): Promise<string> => {
  const filePath = path.join(workspaceRoot, relativePath)
  const children = blocks.map((block) => {
    if (block.type === 'heading') {
      return createParagraph(block.paragraph, toHeadingLevel(block.level))
    }

    if (block.type === 'paragraph') {
      return createParagraph(block.paragraph)
    }

    return new Table({
      width: {
        size: 100,
        type: WidthType.PERCENTAGE
      },
      rows: block.rows.map((row) => {
        return new TableRow({
          children: row.map((cell) => {
            return new TableCell({
              children: cell.paragraphs.map((paragraph) => createParagraph(paragraph))
            })
          })
        })
      })
    })
  })

  const document = new Document({
    sections: [
      {
        children
      }
    ]
  })

  const buffer = await Packer.toBuffer(document)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, buffer)
  return filePath
}

export const writeTestDocxFile = async (
  workspaceRoot: string,
  relativePath: string,
  blocks: readonly TestDocxBlock[]
): Promise<string> => {
  return await writeRichTestDocxFile(
    workspaceRoot,
    relativePath,
    blocks.map((block) => toRichBlock(block))
  )
}

export const writeWorkbenchSampleDocx = async (
  workspaceRoot: string,
  fileName: string
): Promise<string> => {
  return await writeTestDocxFile(workspaceRoot, fileName, [
    {
      type: 'heading',
      text: 'NCurator Weekly Report',
      level: 1
    },
    {
      type: 'paragraph',
      text: 'Hello team. Project status is on track.'
    },
    {
      type: 'paragraph',
      text: 'Risk summary: monitor integration edge cases.'
    },
    {
      type: 'table',
      rows: [
        ['Topic', 'Owner'],
        ['Risk', 'Alice']
      ]
    }
  ])
}
