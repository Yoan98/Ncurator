import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DocxToolRuntime } from '../runtime'
import { DOCX_FORMAT_TOOL_SPEC } from '../toolSpecs'
import { compileDocxOperations, createDocxWriteTool } from './writeToolRuntime'

export const buildDocxFormatTool = (runtime: DocxToolRuntime): StructuredToolInterface =>
  createDocxWriteTool({
    runtime,
    spec: DOCX_FORMAT_TOOL_SPEC,
    compile: compileDocxOperations
  })
