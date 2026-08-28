import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DocxToolRuntime } from '../runtime'
import { buildDocxCommentsRevisionsTool } from './commentsRevisionsTool'
import { buildDocxContentEditTool } from './contentEditTool'
import { buildDocxFormatTool } from './formatTool'
import { buildDocxTableEditTool } from './tableEditTool'

export const buildDocxWriteTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => [
  buildDocxContentEditTool(runtime),
  buildDocxFormatTool(runtime),
  buildDocxTableEditTool(runtime),
  buildDocxCommentsRevisionsTool(runtime)
]
