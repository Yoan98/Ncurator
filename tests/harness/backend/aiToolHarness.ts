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
import { AiRunResourceManager } from '../../../src/main/services/ai/run/AiRunResourceManager'
import { buildKbCapabilityTools } from '../../../src/main/services/ai/human/tools/kb/retrievalTools'
import { buildTerminalCapabilityTools } from '../../../src/main/services/ai/human/tools/terminal/terminalTools'
import { TerminalSessionManager } from '../../../src/main/services/ai/human/tools/terminal/TerminalSessionManager'
import { buildTextFileCapabilityTools } from '../../../src/main/services/ai/human/tools/textFile'
import { buildImageGenerationCapabilityTools } from '../../../src/main/services/ai/human/tools/imageGeneration'
import { agentControlToolFamily } from '../../../src/main/services/ai/human/tools/agentControl'
import { scheduledTasksToolFamily } from '../../../src/main/services/ai/human/tools/scheduledTasks'
import { buildPdfCapabilityTools } from '../../../src/main/services/ai/human/tools/pdf'
import { buildPptCapabilityTools } from '../../../src/main/services/ai/human/tools/ppt'
import { buildExcelCapabilityTools } from '../../../src/main/services/ai/human/tools/excel'
import { releasePdfRunSession } from '../../../src/main/services/pdf/worker/pdfWorkerClient'
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

export const docxParagraphNode = (text: string): JsonObject => ({ text })

export const docxHeadingNode = (level: number, text: string): JsonObject => ({
  text,
  style: { styleName: `Heading${level}` }
})

export const docxTableNode = (rows: string[][]): JsonObject => ({ rows })

export type CapturedToolActivity = {
  actionType: string
  status: 'started' | 'completed' | 'failed'
  summary: string
}

type TerminalToolHarnessOptions = {
  yieldMs?: number
  retainedScrollbackChars?: number
  readMaxChars?: number
  maxConcurrentSessions?: number
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
        name === 'terminal_run' && !('commandExplanation' in args)
          ? {
              ...args,
              commandExplanation: '执行当前测试用例声明的终端命令。'
            }
          : args
      return (await tool.invoke(normalizedArgs)) as TResult
    }
  }
}

/** Keep AiRunContext.runId aligned with the harness/worker session key. */
const createAlignedAiRunContext = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {}
) =>
  runtime.createAiRunContext({
    ...contextInput,
    runId: contextInput.runId || runtime.runId
  })

export const createDocxToolHarness = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {}
) => {
  const ctx = createAlignedAiRunContext(runtime, contextInput)
  const cache = createHumanRuntimeCache()
  const activities: CapturedToolActivity[] = []
  const resourceManager = new AiRunResourceManager([
    { id: 'docx', releaseRun: releaseDocxRunSession }
  ])
  const built = buildDocxCapabilityTools({
    ctx,
    cache,
    runId: ctx.runId,
    partnerId: contextInput.partnerId || contextInput.sessionId || 'test-partner',
    taskId: runtime.taskId,
    workspaceRootPath: runtime.workspaceRoot,
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
      await resourceManager.releaseRun(ctx.runId)
    }
  }
}

export const createPptToolHarness = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {}
) => {
  const ctx = createAlignedAiRunContext(runtime, contextInput)
  const cache = createHumanRuntimeCache()
  const activities: CapturedToolActivity[] = []
  const built = buildPptCapabilityTools({
    ctx,
    cache,
    runId: runtime.runId,
    partnerId: contextInput.partnerId || contextInput.sessionId || 'test-partner',
    taskId: runtime.taskId,
    workspaceRootPath: runtime.workspaceRoot,
    emitActivity: (activity) => activities.push(activity)
  })
  return {
    ...createToolInvoker(built.tools as readonly ToolLike[]),
    ctx,
    runtime: built.runtime,
    activities
  }
}

export const createExcelToolHarness = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {}
) => {
  const ctx = createAlignedAiRunContext(runtime, contextInput)
  const cache = createHumanRuntimeCache()
  const activities: CapturedToolActivity[] = []
  const built = buildExcelCapabilityTools({
    ctx,
    cache,
    runId: runtime.runId,
    partnerId: contextInput.partnerId || contextInput.sessionId || 'test-partner',
    taskId: runtime.taskId,
    workspaceRootPath: runtime.workspaceRoot,
    emitActivity: (activity) => activities.push(activity)
  })
  return {
    ...createToolInvoker(built.tools as readonly ToolLike[]),
    ctx,
    runtime: built.runtime,
    activities
  }
}

export const createTerminalToolHarness = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {},
  options: TerminalToolHarnessOptions = {}
) => {
  const ctx = createAlignedAiRunContext(runtime, contextInput)
  const cache = createHumanRuntimeCache()
  const activities: CapturedToolActivity[] = []
  const sessionManager = new TerminalSessionManager({
    yieldMs: Math.max(50, Number(options.yieldMs || 3000)),
    retainedScrollbackChars: Math.max(1024, Number(options.retainedScrollbackChars || 120_000)),
    readMaxChars: options.readMaxChars,
    maxConcurrentSessions: options.maxConcurrentSessions
  })
  const built = buildTerminalCapabilityTools({
    ctx,
    cache,
    runId: runtime.runId,
    taskId: runtime.taskId,
    partnerId: contextInput.partnerId || contextInput.sessionId || 'test-partner',
    workspaceRootPath: runtime.workspaceRoot,
    workspaceId: ctx.workspace?.workspaceId || 'test-workspace',
    sessionManager,
    emitActivity: (activity) => {
      activities.push(activity)
    }
  })

  return {
    ...createToolInvoker(built.tools as readonly ToolLike[]),
    ctx,
    state: built.state,
    activities,
    sessionManager,
    async release(): Promise<void> {
      await sessionManager.dispose()
    }
  }
}

export const createTextFileToolHarness = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {}
) => {
  const ctx = createAlignedAiRunContext(runtime, contextInput)
  const cache = createHumanRuntimeCache()
  const activities: CapturedToolActivity[] = []
  const built = buildTextFileCapabilityTools({
    ctx,
    cache,
    runId: runtime.runId,
    partnerId: contextInput.partnerId || contextInput.sessionId || 'test-partner',
    taskId: runtime.taskId,
    workspaceRootPath: runtime.workspaceRoot,
    emitActivity: (activity) => {
      activities.push(activity)
    }
  })

  return {
    ...createToolInvoker(built.tools as readonly ToolLike[]),
    ctx,
    activities
  }
}

export const createPdfToolHarness = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {}
) => {
  const ctx = createAlignedAiRunContext(runtime, contextInput)
  const cache = createHumanRuntimeCache()
  const activities: CapturedToolActivity[] = []
  const resourceManager = new AiRunResourceManager([
    { id: 'pdf', releaseRun: releasePdfRunSession }
  ])
  const built = buildPdfCapabilityTools({
    ctx,
    cache,
    runId: runtime.runId,
    partnerId: contextInput.partnerId || contextInput.sessionId || 'test-partner',
    taskId: runtime.taskId,
    workspaceRootPath: runtime.workspaceRoot,
    emitActivity: (activity) => activities.push(activity)
  })

  return {
    ...createToolInvoker(built.tools as readonly ToolLike[]),
    ctx,
    activities,
    async release(): Promise<void> {
      await resourceManager.releaseRun(runtime.runId)
    }
  }
}

export const createRetrievalToolHarness = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {}
) => {
  const ctx = createAlignedAiRunContext(runtime, contextInput)

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
  const ctx = createAlignedAiRunContext(runtime, contextInput)
  const cache = createHumanRuntimeCache()

  return {
    ...createToolInvoker(
      webToolFamily.buildTools({
        ctx,
        cache,
        runId: runtime.runId,
        partnerId: contextInput.partnerId || contextInput.sessionId || 'test-partner',
        taskId: runtime.taskId
      }) as readonly ToolLike[]
    ),
    ctx
  }
}

export const createImageGenerationToolHarness = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {}
) => {
  const ctx = createAlignedAiRunContext(runtime, contextInput)
  const cache = createHumanRuntimeCache()
  const activities: CapturedToolActivity[] = []
  const built = buildImageGenerationCapabilityTools({
    ctx,
    cache,
    runId: runtime.runId,
    partnerId: contextInput.partnerId || contextInput.sessionId || 'test-partner',
    taskId: runtime.taskId,
    workspaceRootPath: runtime.workspaceRoot,
    emitActivity: (activity) => activities.push(activity)
  })

  return {
    ...createToolInvoker(built.tools as readonly ToolLike[]),
    ctx,
    activities
  }
}

export const createAgentControlToolHarness = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {}
) => {
  const ctx = createAlignedAiRunContext(runtime, contextInput)
  const cache = createHumanRuntimeCache()
  return {
    ...createToolInvoker(
      agentControlToolFamily.buildTools({
        ctx,
        cache,
        runId: runtime.runId,
        partnerId: contextInput.partnerId || contextInput.sessionId || 'test-partner',
        taskId: runtime.taskId
      }) as readonly ToolLike[]
    ),
    ctx
  }
}

export const createScheduledTaskToolHarness = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput
) => {
  const ctx = createAlignedAiRunContext(runtime, contextInput)
  const cache = createHumanRuntimeCache()
  return {
    ...createToolInvoker(
      scheduledTasksToolFamily.buildTools({
        ctx,
        cache,
        runId: runtime.runId,
        partnerId: contextInput.partnerId || contextInput.sessionId || 'test-partner',
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

const createParagraph = (paragraph: TestDocxParagraph, heading?: HeadingLevel): Paragraph =>
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
