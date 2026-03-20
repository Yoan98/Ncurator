import fs from 'node:fs/promises'
import path from 'node:path'
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  WidthType
} from 'docx'
import { buildDocxCapabilityTools } from '../../../src/main/services/ai/human/tools/docx/docxTools'
import { releaseDocxRunSession } from '../../../src/main/services/ai/human/tools/docx/worker/docxWorkerClient'
import { buildRetrievalTools } from '../../../src/main/services/ai/human/tools/local_kb_retrieval/retrievalTools'
import { buildTerminalCapabilityTools } from '../../../src/main/services/ai/human/tools/terminal_exec/terminalTools'
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
      return (await tool.invoke(args)) as TResult
    }
  }
}

export const createDocxToolHarness = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {}
) => {
  const ctx = runtime.createAiRunContext(contextInput)
  const activities: CapturedToolActivity[] = []
  const built = buildDocxCapabilityTools({
    ctx,
    runId: runtime.runId,
    taskId: runtime.taskId,
    workspaceRootPath: runtime.workspaceRoot,
    safePreviewChars: 1400,
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
  const activities: CapturedToolActivity[] = []
  const built = buildTerminalCapabilityTools({
    ctx,
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
      buildRetrievalTools({
        ctx,
        runId: runtime.runId,
        taskId: runtime.taskId
      }) as readonly ToolLike[]
    ),
    ctx
  }
}

export type TestDocxHeadingLevel = 1 | 2 | 3

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

export const writeTestDocxFile = async (
  workspaceRoot: string,
  relativePath: string,
  blocks: readonly TestDocxBlock[]
): Promise<string> => {
  const filePath = path.join(workspaceRoot, relativePath)
  const children = blocks.map((block) => {
    if (block.type === 'heading') {
      return new Paragraph({
        text: block.text,
        heading: toHeadingLevel(block.level)
      })
    }

    if (block.type === 'paragraph') {
      return new Paragraph(block.text)
    }

    return new Table({
      width: {
        size: 100,
        type: WidthType.PERCENTAGE
      },
      rows: block.rows.map((row) => {
        return new TableRow({
          children: row.map((cellText) => {
            return new TableCell({
              children: [new Paragraph(cellText)]
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
