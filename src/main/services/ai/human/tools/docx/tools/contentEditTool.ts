import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DocxToolRuntime } from '../runtime'
import { DOCX_CONTENT_EDIT_TOOL_SPEC } from '../toolSpecs'
import { compileDocxOperation, createDocxWriteTool } from './writeToolRuntime'

export const buildDocxContentEditTool = (runtime: DocxToolRuntime): StructuredToolInterface =>
  createDocxWriteTool({
    runtime,
    spec: DOCX_CONTENT_EDIT_TOOL_SPEC,
    compile: compileDocxOperation
  })
