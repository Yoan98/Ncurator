import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DocxToolRuntime } from '../runtime'
import { DOCX_COMMENTS_REVISIONS_TOOL_SPEC } from '../toolSpecs'
import { compileDocxOperation, createDocxWriteTool } from './writeToolRuntime'

export const buildDocxCommentsRevisionsTool = (runtime: DocxToolRuntime): StructuredToolInterface =>
  createDocxWriteTool({
    runtime,
    spec: DOCX_COMMENTS_REVISIONS_TOOL_SPEC,
    compile: compileDocxOperation
  })
