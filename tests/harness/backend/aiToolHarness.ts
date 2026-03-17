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
import { buildDocxCapabilityTools } from '../../../src/main/services/ai/tools/docx/docxTools'
import { releaseDocxRunSession } from '../../../src/main/services/ai/tools/docx/worker/docxWorkerClient'
import { buildRetrievalTools } from '../../../src/main/services/ai/tools/local_kb_retrieval/retrievalTools'
import { buildTerminalCapabilityTools } from '../../../src/main/services/ai/tools/terminal_exec/terminalTools'
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

export const writeWorkbenchSampleDocx = async (
  workspaceRoot: string,
  fileName: string
): Promise<string> => {
  const filePath = path.join(workspaceRoot, fileName)
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: 'NCurator Weekly Report',
            heading: HeadingLevel.HEADING_1
          }),
          new Paragraph('Hello team. Project status is on track.'),
          new Paragraph('Risk summary: monitor integration edge cases.'),
          new Table({
            width: {
              size: 100,
              type: WidthType.PERCENTAGE
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph('Topic')]
                  }),
                  new TableCell({
                    children: [new Paragraph('Owner')]
                  })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph('Risk')]
                  }),
                  new TableCell({
                    children: [new Paragraph('Alice')]
                  })
                ]
              })
            ]
          })
        ]
      }
    ]
  })

  const buffer = await Packer.toBuffer(document)
  await fs.writeFile(filePath, buffer)
  return filePath
}
