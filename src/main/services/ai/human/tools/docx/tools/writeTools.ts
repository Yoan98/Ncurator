import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type {
  DocxChangedBlock,
  DocxCreatedBlock,
  DocxDetailedBlock,
  DocxOp,
  DocxOutlineBlock,
  DocxParagraphSpec,
  DocxTableSpec,
  DocxTextStyle
} from '../types'
import type { DocxToolRuntime } from '../runtime'
import {
  DOCX_CREATE_TOOL_SPEC,
  DOCX_HEADING_EDIT_TOOL_SPEC,
  DOCX_PARAGRAPH_EDIT_TOOL_SPEC,
  DOCX_ROLLBACK_TOOL_SPEC,
  DOCX_TABLE_EDIT_TOOL_SPEC,
  DOCX_TEXT_EDIT_TOOL_SPEC,
  DOCX_TEXT_STYLE_EDIT_TOOL_SPEC
} from '../toolSpecs'
import {
  createDocxTool,
  finalizeDocxToolFailure,
  finalizeDocxToolSuccess
} from './workerTool'
import type { DocxToolFailure } from '../runtime'
import { DOCX_POSITIONED_LAYOUT_PROTECTION_MESSAGE } from '../constants'
import { createDocxFile } from '../utils/createDocxFile'

const paragraphSpecFromText = (text: string, style?: string): DocxParagraphSpec => ({
  kind: 'paragraph',
  style,
  runs: [{ text }]
})

const tableSpecFromRows = (rows: string[][]): DocxTableSpec => ({
  kind: 'table',
  rows: rows.map((row) =>
    row.map((cellText) => ({
      paragraphs: [paragraphSpecFromText(cellText)]
    }))
  )
})

const headingStyle = (level: number): string => `Heading${String(level)}`

const buildEditSummary = (input: {
  toolName: string
  actionLabel: string
  changedBlocks: DocxChangedBlock[]
  warnings: string[]
}): string => {
  const base = `${input.actionLabel} 完成`
  const changed = input.changedBlocks.length > 0 ? `，共 ${String(input.changedBlocks.length)} 处变更` : ''
  const warnings = input.warnings.length > 0 ? `，${String(input.warnings.length)} 条警告` : ''
  return `${base}${changed}${warnings}`
}

const fetchOutlineBlocks = async (
  runtime: DocxToolRuntime,
  docId: string
): Promise<DocxOutlineBlock[]> => {
  const response = await runtime.callWorker({
    action: 'outline',
    payload: {
      docId,
      maxBlocks: 5000,
      includeTables: true,
      includeCells: true
    }
  })
  if (!response.ok) {
    throw new Error(response.error)
  }
  if (response.payload.action !== 'outline') {
    throw new Error('worker protocol mismatch (outline)')
  }
  return response.payload.blocks
}

const fetchDetailedBlock = async (
  runtime: DocxToolRuntime,
  docId: string,
  blockId: string
): Promise<DocxDetailedBlock> => {
  const response = await runtime.callWorker({
    action: 'get_block',
    payload: {
      docId,
      blockId
    }
  })
  if (!response.ok) {
    throw new Error(response.error)
  }
  if (response.payload.action !== 'get_block') {
    throw new Error('worker protocol mismatch (get_block)')
  }
  return response.payload.block
}

const buildPositionedReadOnlyMessage = (): string => DOCX_POSITIONED_LAYOUT_PROTECTION_MESSAGE

const buildCreateSummary = (sourcePath: string): string => `已建立新的 docx 草稿会话：${sourcePath}`

const documentExists = async (sourcePath: string): Promise<boolean> => {
  try {
    await fs.access(sourcePath)
    return true
  } catch {
    return false
  }
}

const buildCreateTargetTempPaths = async (sourcePath: string): Promise<{
  baselinePath: string
  workingPath: string
}> => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-docx-create-'))
  const baseName = path.basename(sourcePath)
  return {
    baselinePath: path.join(tempDir, `baseline-${baseName}`),
    workingPath: path.join(tempDir, `working-${baseName}`)
  }
}

const failIfPositionedBlock = async (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  currentRevisionRef: string
  docId: string
  blockId: string
}): Promise<DocxToolFailure | null> => {
  const block = await fetchDetailedBlock(input.runtime, input.docId, input.blockId)
  if (block.layoutMode !== 'positioned') {
    return null
  }
  return input.runtime.emitFailure({
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    code: 'invalid_input',
    error: buildPositionedReadOnlyMessage(),
    draftDocId: input.docId,
    resourceContext: input.runtime.buildResourceContext({
      sourcePath: input.sourcePath,
      effectKind: 'mutated',
      currentRevisionRef: input.currentRevisionRef
    })
  })
}

const resolveReplaceTextTargetBlockIds = async (input: {
  runtime: DocxToolRuntime
  docId: string
  query: string
  blockIds?: string[]
}): Promise<string[]> => {
  if (Array.isArray(input.blockIds) && input.blockIds.length > 0) {
    return [...new Set(input.blockIds)]
  }

  const searchResponse = await input.runtime.callWorker({
    action: 'search',
    payload: {
      docId: input.docId,
      query: input.query,
      mode: 'literal',
      scopeBlockIds: []
    }
  })
  if (!searchResponse.ok) {
    return []
  }
  if (searchResponse.payload.action !== 'search') {
    throw new Error('worker protocol mismatch (replace_text positioned search)')
  }
  return [...new Set(searchResponse.payload.matches.map((match) => match.blockId).filter(Boolean))]
}

const failIfAnyPositionedBlocks = async (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  currentRevisionRef: string
  docId: string
  blockIds: string[]
}): Promise<DocxToolFailure | null> => {
  for (const blockId of input.blockIds) {
    const failure = await failIfPositionedBlock({
      runtime: input.runtime,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      sourcePath: input.sourcePath,
      currentRevisionRef: input.currentRevisionRef,
      docId: input.docId,
      blockId
    })
    if (failure) {
      return failure
    }
  }
  return null
}

const resolveCreatedBlocksForOp = async (input: {
  runtime: DocxToolRuntime
  previousDocId: string
  nextDocId: string
  op: DocxOp
}): Promise<DocxCreatedBlock[]> => {
  if (input.op.type !== 'insert_before' && input.op.type !== 'insert_after') {
    return []
  }

  const beforeBlocks = await fetchOutlineBlocks(input.runtime, input.previousDocId)
  const afterBlocks = await fetchOutlineBlocks(input.runtime, input.nextDocId)
  const anchor = beforeBlocks.find((block) => block.blockId === input.op.anchorBlockId)
  if (!anchor) {
    return []
  }

  const insertedBodyCount = input.op.content.length
  if (insertedBodyCount <= 0) {
    return []
  }

  const startBodyIndex =
    input.op.type === 'insert_before' ? anchor.bodyIndex : anchor.bodyIndex + 1
  const endBodyIndex = startBodyIndex + insertedBodyCount - 1

  return afterBlocks
    .filter(
      (block) =>
        block.bodyIndex >= startBodyIndex && block.bodyIndex <= endBodyIndex
    )
    .map((block) => ({
      blockId: block.blockId,
      type: block.type
    }))
}

type ApplySingleEditResult =
  | {
      failure: DocxToolFailure
    }
  | {
      previousRevisionRef: string
      currentRevisionRef: string
      changedBlocks: DocxChangedBlock[]
      warnings: string[]
      nextDocId: string
      createdBlocks: DocxCreatedBlock[]
    }

const applySingleEdit = async (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  currentDocId: string
  currentRevisionRef: string
  ops: DocxOp[]
  summary: string
  createdBlocks?: boolean
}): Promise<ApplySingleEditResult> => {
  const workerResponse = await input.runtime.callWorker({
    action: 'apply_ops',
    payload: {
      docId: input.currentDocId,
      ops: input.ops
    }
  })
  if (!workerResponse.ok) {
    return {
      failure: input.runtime.emitWorkerFailure({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        response: workerResponse,
        draftDocId: input.currentDocId
      })
    }
  }
  if (workerResponse.payload.action !== 'apply_ops') {
    return {
      failure: input.runtime.emitFailure({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        code: 'failed',
        error: 'worker protocol mismatch (apply_ops)',
        draftDocId: input.currentDocId
      })
    }
  }

  const createdBlocks = input.createdBlocks
    ? await resolveCreatedBlocksForOp({
        runtime: input.runtime,
        previousDocId: input.currentDocId,
        nextDocId: workerResponse.payload.newDocId,
        op: input.ops[0]
      })
    : []
  const reviewOps = await input.runtime.expandOpsForReview(input.currentDocId, input.ops)

  const revisionUpdate = await input.runtime.registerRevision({
    sourcePath: input.sourcePath,
    previousDocId: input.currentDocId,
    nextDocId: workerResponse.payload.newDocId,
    ops: reviewOps,
    createdBlocks,
    changedBlocks: workerResponse.payload.changedBlocks,
    summary: input.summary
  })
  input.runtime.input.ctx.trackDocxChanges({
    previousDocId: input.currentDocId,
    nextDocId: workerResponse.payload.newDocId,
    op: input.ops[0],
    changedBlocks: workerResponse.payload.changedBlocks,
    createdBlocks,
    replaySession: input.runtime.getReplaySession(input.sourcePath)
  })
  return {
    previousRevisionRef: revisionUpdate.previousRevisionRef,
    currentRevisionRef: revisionUpdate.currentRevisionRef,
    changedBlocks: workerResponse.payload.changedBlocks,
    warnings: workerResponse.payload.warnings,
    nextDocId: workerResponse.payload.newDocId,
    createdBlocks
  }
}

export const buildDocxWriteTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
  const docxCreateTool = createDocxTool({
    runtime,
    name: DOCX_CREATE_TOOL_SPEC.name,
    description: DOCX_CREATE_TOOL_SPEC.description,
    schema: DOCX_CREATE_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_CREATE_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const requestedSourcePath = runtime.resolveDocxPath({
        cwd: runtime.workspaceRootPath,
        rawPath: args.sourcePath
      })
      if (!requestedSourcePath) {
        return finalizeDocxToolFailure({
          runtime,
          failure: runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'invalid_input',
            error: 'sourcePath must be a workspace-bound .docx path'
          }),
          activity: {
            actionType: DOCX_CREATE_TOOL_SPEC.activityActionType!
          }
        })
      }

      if (runtime.getReplaySession(requestedSourcePath) || (await documentExists(requestedSourcePath))) {
        return finalizeDocxToolFailure({
          runtime,
          failure: runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'invalid_input',
            error: `docx_create will not overwrite an existing file: ${requestedSourcePath}`,
            resourceContext: runtime.buildResourceContext({
              sourcePath: requestedSourcePath,
              effectKind: 'mutated'
            })
          }),
          activity: {
            actionType: DOCX_CREATE_TOOL_SPEC.activityActionType!
          }
        })
      }

      const tempPaths = await buildCreateTargetTempPaths(requestedSourcePath)

      try {
        await createDocxFile({
          filePath: tempPaths.baselinePath,
          blocks: []
        })
        await createDocxFile({
          filePath: tempPaths.workingPath,
          blocks: args.blocks || []
        })

        const baselineOpen = await runtime.callWorker({
          action: 'open',
          payload: {
            sourcePath: tempPaths.baselinePath
          }
        })
        if (!baselineOpen.ok) {
          return finalizeDocxToolFailure({
            runtime,
            failure: runtime.emitWorkerFailure({
              toolName,
              toolCallId,
              response: baselineOpen,
              resourceContext: runtime.buildResourceContext({
                sourcePath: requestedSourcePath,
                effectKind: 'mutated'
              })
            }),
            activity: {
              actionType: DOCX_CREATE_TOOL_SPEC.activityActionType!
            }
          })
        }
        if (baselineOpen.payload.action !== 'open') {
          return finalizeDocxToolFailure({
            runtime,
            failure: runtime.emitFailure({
              toolName,
              toolCallId,
              code: 'failed',
              error: 'worker protocol mismatch (baseline open)',
              resourceContext: runtime.buildResourceContext({
                sourcePath: requestedSourcePath,
                effectKind: 'mutated'
              })
            }),
            activity: {
              actionType: DOCX_CREATE_TOOL_SPEC.activityActionType!
            }
          })
        }
        const baselineDocId = baselineOpen.payload.docId

        const workingOpen = await runtime.callWorker({
          action: 'open',
          payload: {
            sourcePath: tempPaths.workingPath
          }
        })
        if (!workingOpen.ok) {
          return finalizeDocxToolFailure({
            runtime,
            failure: runtime.emitWorkerFailure({
              toolName,
              toolCallId,
              response: workingOpen,
              resourceContext: runtime.buildResourceContext({
                sourcePath: requestedSourcePath,
                effectKind: 'mutated'
              })
            }),
            activity: {
              actionType: DOCX_CREATE_TOOL_SPEC.activityActionType!
            }
          })
        }
        if (workingOpen.payload.action !== 'open') {
          return finalizeDocxToolFailure({
            runtime,
            failure: runtime.emitFailure({
              toolName,
              toolCallId,
              code: 'failed',
              error: 'worker protocol mismatch (working open)',
              resourceContext: runtime.buildResourceContext({
                sourcePath: requestedSourcePath,
                effectKind: 'mutated'
              })
            }),
            activity: {
              actionType: DOCX_CREATE_TOOL_SPEC.activityActionType!
            }
          })
        }
        const workingDocId = workingOpen.payload.docId

        const registered = await runtime.registerCreatedDocument({
          sourcePath: requestedSourcePath,
          baselineDocId: baselineDocId,
          workingDocId,
          meta: workingOpen.payload.meta,
          stats: workingOpen.payload.stats,
          summary: 'create_document'
        })
        runtime.input.ctx.trackDocxOpen({
          docId: baselineDocId,
          sourcePath: requestedSourcePath,
          replaySession: registered.session
        })
        runtime.input.ctx.trackDocxChanges({
          previousDocId: baselineDocId,
          nextDocId: workingDocId,
          op: { type: 'create_document' },
          changedBlocks: registered.changedBlocks || [],
          createdBlocks: registered.createdBlocks || [],
          replaySession: registered.session
        })

        const result = {
          ok: true,
          code: 'ok' as const,
          summary: buildCreateSummary(registered.session.sourcePath),
          sourcePath: registered.session.sourcePath,
          currentRevisionRef: registered.currentRevisionRef,
          created: true,
          resourceContext: runtime.buildResourceContext({
            sourcePath: registered.session.sourcePath,
            effectKind: 'mutated',
            currentRevisionRef: registered.currentRevisionRef
          })
        }

        return finalizeDocxToolSuccess({
          runtime,
          toolName,
          toolCallId,
          result,
          outputPreview: {
            ok: true,
            code: 'ok',
            sourcePath: result.sourcePath,
            currentRevisionRef: result.currentRevisionRef,
            created: true
          },
          activity: {
            actionType: DOCX_CREATE_TOOL_SPEC.activityActionType!,
            startedSummary: `创建 docx: ${args.sourcePath}`,
            buildCompletedSummary: (output: typeof result) => output.summary
          }
        })
      } finally {
        await Promise.all(
          [tempPaths.baselinePath, tempPaths.workingPath, path.dirname(tempPaths.baselinePath)].map(
            async (targetPath) => {
              try {
                await fs.rm(targetPath, { recursive: true, force: true })
              } catch {
                return
              }
            }
          )
        )
      }
    }
  })

  const docxParagraphEditTool = createDocxTool({
    runtime,
    name: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.name,
    description: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.description,
    schema: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      let op: DocxOp
      switch (args.action) {
        case 'insert_before':
        case 'insert_after':
          {
            const failure = await failIfPositionedBlock({
              runtime,
              toolName,
              toolCallId,
              sourcePath: sessionResult.sourcePath,
              currentRevisionRef: sessionResult.currentRevisionRef,
              docId: sessionResult.docId,
              blockId: args.anchorBlockId!
            })
            if (failure) {
              return finalizeDocxToolFailure({
                runtime,
                failure,
                activity: {
                  actionType: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.activityActionType!
                }
              })
            }
          }
          op = {
            type: args.action,
            anchorBlockId: args.anchorBlockId!,
            content: [paragraphSpecFromText(args.text!)]
          }
          break
        case 'replace_text': {
          const failure = await failIfPositionedBlock({
            runtime,
            toolName,
            toolCallId,
            sourcePath: sessionResult.sourcePath,
            currentRevisionRef: sessionResult.currentRevisionRef,
            docId: sessionResult.docId,
            blockId: args.blockId!
          })
          if (failure) {
            return finalizeDocxToolFailure({
              runtime,
              failure,
              activity: {
                actionType: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.activityActionType!
              }
            })
          }
          const block = await fetchDetailedBlock(runtime, sessionResult.docId, args.blockId!)
          const style = block.type === 'paragraph' ? block.style : undefined
          op = {
            type: 'replace_block',
            blockId: args.blockId!,
            content: paragraphSpecFromText(args.text!, style)
          }
          break
        }
        case 'delete':
          {
            const failure = await failIfPositionedBlock({
              runtime,
              toolName,
              toolCallId,
              sourcePath: sessionResult.sourcePath,
              currentRevisionRef: sessionResult.currentRevisionRef,
              docId: sessionResult.docId,
              blockId: args.blockId!
            })
            if (failure) {
              return finalizeDocxToolFailure({
                runtime,
                failure,
                activity: {
                  actionType: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.activityActionType!
                }
              })
            }
          }
          op = {
            type: 'delete_block',
            blockId: args.blockId!
          }
          break
      }

      const applied = await applySingleEdit({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentDocId: sessionResult.docId,
        currentRevisionRef: sessionResult.currentRevisionRef,
        ops: [op],
        summary: `paragraph.${args.action}`,
        createdBlocks: args.action === 'insert_before' || args.action === 'insert_after'
      })
      if ('failure' in applied) {
        return finalizeDocxToolFailure({
          runtime,
          failure: applied.failure,
          activity: {
            actionType: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.activityActionType!
          }
        })
      }

      const result = {
        ok: true,
        code: 'ok' as const,
        summary: buildEditSummary({
          toolName,
          actionLabel: `段落${args.action}`,
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }),
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: applied.previousRevisionRef,
        currentRevisionRef: applied.currentRevisionRef,
        changedBlocks: applied.changedBlocks,
        createdBlocks: applied.createdBlocks,
        warnings: applied.warnings,
        resourceContext: runtime.buildResourceContext({
          sourcePath: sessionResult.sourcePath,
          effectKind: 'mutated',
          previousRevisionRef: applied.previousRevisionRef,
          currentRevisionRef: applied.currentRevisionRef
        })
      }
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        outputPreview: {
          ok: true,
          code: 'ok',
          sourcePath: result.sourcePath,
          previousRevisionRef: result.previousRevisionRef,
          currentRevisionRef: result.currentRevisionRef,
          changedCount: result.changedBlocks.length,
          createdBlocks: result.createdBlocks
        },
        draftDocId: applied.nextDocId,
        activity: {
          actionType: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.activityActionType!,
          startedSummary: `执行段落编辑: ${args.action}`,
          buildCompletedSummary: (output) => output.summary
        }
      })
    }
  })

  const docxHeadingEditTool = createDocxTool({
    runtime,
    name: DOCX_HEADING_EDIT_TOOL_SPEC.name,
    description: DOCX_HEADING_EDIT_TOOL_SPEC.description,
    schema: DOCX_HEADING_EDIT_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_HEADING_EDIT_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const spec = paragraphSpecFromText(args.text, headingStyle(args.level))
      let op: DocxOp
      if (args.action === 'replace_text') {
        const failure = await failIfPositionedBlock({
          runtime,
          toolName,
          toolCallId,
          sourcePath: sessionResult.sourcePath,
          currentRevisionRef: sessionResult.currentRevisionRef,
          docId: sessionResult.docId,
          blockId: args.blockId!
        })
        if (failure) {
          return finalizeDocxToolFailure({
            runtime,
            failure,
            activity: {
              actionType: DOCX_HEADING_EDIT_TOOL_SPEC.activityActionType!
            }
          })
        }
        op = {
          type: 'replace_block',
          blockId: args.blockId!,
          content: spec
        }
      } else {
        const failure = await failIfPositionedBlock({
          runtime,
          toolName,
          toolCallId,
          sourcePath: sessionResult.sourcePath,
          currentRevisionRef: sessionResult.currentRevisionRef,
          docId: sessionResult.docId,
          blockId: args.anchorBlockId!
        })
        if (failure) {
          return finalizeDocxToolFailure({
            runtime,
            failure,
            activity: {
              actionType: DOCX_HEADING_EDIT_TOOL_SPEC.activityActionType!
            }
          })
        }
        op = {
          type: args.action,
          anchorBlockId: args.anchorBlockId!,
          content: [spec]
        }
      }

      const applied = await applySingleEdit({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentDocId: sessionResult.docId,
        currentRevisionRef: sessionResult.currentRevisionRef,
        ops: [op],
        summary: `heading.${args.action}.level_${String(args.level)}`,
        createdBlocks: args.action !== 'replace_text'
      })
      if ('failure' in applied) {
        return finalizeDocxToolFailure({
          runtime,
          failure: applied.failure,
          activity: {
            actionType: DOCX_HEADING_EDIT_TOOL_SPEC.activityActionType!
          }
        })
      }

      const result = {
        ok: true,
        code: 'ok' as const,
        summary: buildEditSummary({
          toolName,
          actionLabel: `标题${args.action}`,
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }),
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: applied.previousRevisionRef,
        currentRevisionRef: applied.currentRevisionRef,
        changedBlocks: applied.changedBlocks,
        createdBlocks: applied.createdBlocks,
        warnings: applied.warnings,
        resourceContext: runtime.buildResourceContext({
          sourcePath: sessionResult.sourcePath,
          effectKind: 'mutated',
          previousRevisionRef: applied.previousRevisionRef,
          currentRevisionRef: applied.currentRevisionRef
        })
      }
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        outputPreview: {
          ok: true,
          code: 'ok',
          sourcePath: result.sourcePath,
          previousRevisionRef: result.previousRevisionRef,
          currentRevisionRef: result.currentRevisionRef,
          changedCount: result.changedBlocks.length,
          createdBlocks: result.createdBlocks
        },
        draftDocId: applied.nextDocId,
        activity: {
          actionType: DOCX_HEADING_EDIT_TOOL_SPEC.activityActionType!,
          startedSummary: `执行标题编辑: ${args.action}`,
          buildCompletedSummary: (output) => output.summary
        }
      })
    }
  })

  const docxTableEditTool = createDocxTool({
    runtime,
    name: DOCX_TABLE_EDIT_TOOL_SPEC.name,
    description: DOCX_TABLE_EDIT_TOOL_SPEC.description,
    schema: DOCX_TABLE_EDIT_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_TABLE_EDIT_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      let op: DocxOp
      if (args.action === 'update_cell') {
        const failure = await failIfPositionedBlock({
          runtime,
          toolName,
          toolCallId,
          sourcePath: sessionResult.sourcePath,
          currentRevisionRef: sessionResult.currentRevisionRef,
          docId: sessionResult.docId,
          blockId: args.cellBlockId!
        })
        if (failure) {
          return finalizeDocxToolFailure({
            runtime,
            failure,
            activity: {
              actionType: DOCX_TABLE_EDIT_TOOL_SPEC.activityActionType!
            }
          })
        }
        op = {
          type: 'update_table_cell',
          blockId: args.cellBlockId!,
          content: [paragraphSpecFromText(args.text!)]
        }
      } else {
        const failure = await failIfPositionedBlock({
          runtime,
          toolName,
          toolCallId,
          sourcePath: sessionResult.sourcePath,
          currentRevisionRef: sessionResult.currentRevisionRef,
          docId: sessionResult.docId,
          blockId: args.anchorBlockId!
        })
        if (failure) {
          return finalizeDocxToolFailure({
            runtime,
            failure,
            activity: {
              actionType: DOCX_TABLE_EDIT_TOOL_SPEC.activityActionType!
            }
          })
        }
        op = {
          type: args.action,
          anchorBlockId: args.anchorBlockId!,
          content: [tableSpecFromRows(args.rows!)]
        }
      }

      const applied = await applySingleEdit({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentDocId: sessionResult.docId,
        currentRevisionRef: sessionResult.currentRevisionRef,
        ops: [op],
        summary: `table.${args.action}`,
        createdBlocks: args.action !== 'update_cell'
      })
      if ('failure' in applied) {
        return finalizeDocxToolFailure({
          runtime,
          failure: applied.failure,
          activity: {
            actionType: DOCX_TABLE_EDIT_TOOL_SPEC.activityActionType!
          }
        })
      }

      const result = {
        ok: true,
        code: 'ok' as const,
        summary: buildEditSummary({
          toolName,
          actionLabel: `表格${args.action}`,
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }),
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: applied.previousRevisionRef,
        currentRevisionRef: applied.currentRevisionRef,
        changedBlocks: applied.changedBlocks,
        createdBlocks: applied.createdBlocks,
        warnings: applied.warnings,
        resourceContext: runtime.buildResourceContext({
          sourcePath: sessionResult.sourcePath,
          effectKind: 'mutated',
          previousRevisionRef: applied.previousRevisionRef,
          currentRevisionRef: applied.currentRevisionRef
        })
      }
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        outputPreview: {
          ok: true,
          code: 'ok',
          sourcePath: result.sourcePath,
          previousRevisionRef: result.previousRevisionRef,
          currentRevisionRef: result.currentRevisionRef,
          changedCount: result.changedBlocks.length,
          createdBlocks: result.createdBlocks
        },
        draftDocId: applied.nextDocId,
        activity: {
          actionType: DOCX_TABLE_EDIT_TOOL_SPEC.activityActionType!,
          startedSummary: `执行表格编辑: ${args.action}`,
          buildCompletedSummary: (output) => output.summary
        }
      })
    }
  })

  const docxTextEditTool = createDocxTool({
    runtime,
    name: DOCX_TEXT_EDIT_TOOL_SPEC.name,
    description: DOCX_TEXT_EDIT_TOOL_SPEC.description,
    schema: DOCX_TEXT_EDIT_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_TEXT_EDIT_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const targetBlockIds = await resolveReplaceTextTargetBlockIds({
        runtime,
        docId: sessionResult.docId,
        query: args.query,
        blockIds: args.blockIds
      })
      const failure = await failIfAnyPositionedBlocks({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentRevisionRef: sessionResult.currentRevisionRef,
        docId: sessionResult.docId,
        blockIds: targetBlockIds
      })
      if (failure) {
        return finalizeDocxToolFailure({
          runtime,
          failure,
          activity: {
            actionType: DOCX_TEXT_EDIT_TOOL_SPEC.activityActionType!
          }
        })
      }

      const applied = await applySingleEdit({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentDocId: sessionResult.docId,
        currentRevisionRef: sessionResult.currentRevisionRef,
        ops: [
          {
            type: 'replace_text',
            query: args.query,
            replace: args.replace,
            replaceAll: true,
            blockIds: args.blockIds
          }
        ],
        summary: `text.replace:${args.query}`
      })
      if ('failure' in applied) {
        return finalizeDocxToolFailure({
          runtime,
          failure: applied.failure,
          activity: {
            actionType: DOCX_TEXT_EDIT_TOOL_SPEC.activityActionType!
          }
        })
      }

      const result = {
        ok: true,
        code: 'ok' as const,
        summary: buildEditSummary({
          toolName,
          actionLabel: '文本替换',
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }),
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: applied.previousRevisionRef,
        currentRevisionRef: applied.currentRevisionRef,
        changedBlocks: applied.changedBlocks,
        warnings: applied.warnings,
        resourceContext: runtime.buildResourceContext({
          sourcePath: sessionResult.sourcePath,
          effectKind: 'mutated',
          previousRevisionRef: applied.previousRevisionRef,
          currentRevisionRef: applied.currentRevisionRef
        })
      }
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        outputPreview: {
          ok: true,
          code: 'ok',
          sourcePath: result.sourcePath,
          previousRevisionRef: result.previousRevisionRef,
          currentRevisionRef: result.currentRevisionRef,
          changedCount: result.changedBlocks.length
        },
        draftDocId: applied.nextDocId,
        activity: {
          actionType: DOCX_TEXT_EDIT_TOOL_SPEC.activityActionType!,
          startedSummary: `执行文本替换: ${args.query}`,
          buildCompletedSummary: (output) => output.summary
        }
      })
    }
  })

  const docxTextStyleEditTool = createDocxTool({
    runtime,
    name: DOCX_TEXT_STYLE_EDIT_TOOL_SPEC.name,
    description: DOCX_TEXT_STYLE_EDIT_TOOL_SPEC.description,
    schema: DOCX_TEXT_STYLE_EDIT_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_TEXT_STYLE_EDIT_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const failure = await failIfPositionedBlock({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentRevisionRef: sessionResult.currentRevisionRef,
        docId: sessionResult.docId,
        blockId: args.blockId
      })
      if (failure) {
        return finalizeDocxToolFailure({
          runtime,
          failure,
          activity: {
            actionType: DOCX_TEXT_STYLE_EDIT_TOOL_SPEC.activityActionType!
          }
        })
      }

      const applied = await applySingleEdit({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentDocId: sessionResult.docId,
        currentRevisionRef: sessionResult.currentRevisionRef,
        ops: [
          {
            type: 'style_text',
            blockId: args.blockId,
            query: args.query,
            style: args.style as DocxTextStyle
          }
        ],
        summary: `text_style:${args.query}`
      })
      if ('failure' in applied) {
        return finalizeDocxToolFailure({
          runtime,
          failure: applied.failure,
          activity: {
            actionType: DOCX_TEXT_STYLE_EDIT_TOOL_SPEC.activityActionType!
          }
        })
      }

      const result = {
        ok: true,
        code: 'ok' as const,
        summary: buildEditSummary({
          toolName,
          actionLabel: '文本样式编辑',
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }),
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: applied.previousRevisionRef,
        currentRevisionRef: applied.currentRevisionRef,
        changedBlocks: applied.changedBlocks,
        warnings: applied.warnings,
        resourceContext: runtime.buildResourceContext({
          sourcePath: sessionResult.sourcePath,
          effectKind: 'mutated',
          previousRevisionRef: applied.previousRevisionRef,
          currentRevisionRef: applied.currentRevisionRef
        })
      }
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        outputPreview: {
          ok: true,
          code: 'ok',
          sourcePath: result.sourcePath,
          previousRevisionRef: result.previousRevisionRef,
          currentRevisionRef: result.currentRevisionRef,
          changedCount: result.changedBlocks.length
        },
        draftDocId: applied.nextDocId,
        activity: {
          actionType: DOCX_TEXT_STYLE_EDIT_TOOL_SPEC.activityActionType!,
          startedSummary: `执行文本样式编辑: ${args.query}`,
          buildCompletedSummary: (output) => output.summary
        }
      })
    }
  })

  const docxRollbackTool = createDocxTool({
    runtime,
    name: DOCX_ROLLBACK_TOOL_SPEC.name,
    description: DOCX_ROLLBACK_TOOL_SPEC.description,
    schema: DOCX_ROLLBACK_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_ROLLBACK_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: `回退失败: ${message}`
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const resolved = runtime.resolveRevisionRollbackTarget(
        sessionResult.sourcePath,
        args.revisionRef,
        undefined
      )
      if (!resolved.ok) {
        return finalizeDocxToolFailure({
          runtime,
          failure: runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'invalid_input',
            error: resolved.error,
            resourceContext: runtime.buildResourceContext({
              sourcePath: sessionResult.sourcePath,
              effectKind: 'rolled_back',
              currentRevisionRef: sessionResult.currentRevisionRef
            })
          }),
          activity: {
            actionType: DOCX_ROLLBACK_TOOL_SPEC.activityActionType!
          }
        })
      }

      const revisionState = await runtime.activateRevision({
        sourcePath: sessionResult.sourcePath,
        targetDocId: resolved.targetDocId,
        targetRevisionRef: resolved.targetRevisionRef
      })
      const result = {
        ok: true,
        code: 'ok' as const,
        summary: `已切回修订 ${resolved.targetRevisionRef}`,
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: revisionState.previousRevisionRef,
        currentRevisionRef: revisionState.currentRevisionRef,
        resourceContext: runtime.buildResourceContext({
          sourcePath: sessionResult.sourcePath,
          effectKind: 'rolled_back',
          previousRevisionRef: revisionState.previousRevisionRef,
          currentRevisionRef: revisionState.currentRevisionRef
        })
      }
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        outputPreview: result,
        draftDocId: resolved.targetDocId,
        activity: {
          actionType: DOCX_ROLLBACK_TOOL_SPEC.activityActionType!,
          startedSummary: `准备回退到 ${args.revisionRef}`,
          buildCompletedSummary: (output) => output.summary
        }
      })
    }
  })

  return [
    docxCreateTool,
    docxParagraphEditTool,
    docxHeadingEditTool,
    docxTableEditTool,
    docxTextEditTool,
    docxTextStyleEditTool,
    docxRollbackTool
  ]
}
