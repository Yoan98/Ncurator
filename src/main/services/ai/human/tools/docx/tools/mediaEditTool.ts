import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DocxToolRuntime } from '../runtime'
import { DOCX_MEDIA_EDIT_TOOL_SPEC } from '../toolSpecs'
import { compileDocxOperations, createDocxWriteTool } from './writeToolRuntime'

export const buildDocxMediaEditTool = (runtime: DocxToolRuntime): StructuredToolInterface =>
  createDocxWriteTool({
    runtime,
    spec: DOCX_MEDIA_EDIT_TOOL_SPEC,
    compile: compileDocxOperations
  })
