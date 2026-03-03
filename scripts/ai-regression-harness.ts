/* eslint-disable @typescript-eslint/no-var-requires */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AIMessage } from '@langchain/core/messages'
import type { JsonObject } from '../src/shared/types'

type ModelScriptStep = (toolNames: string[]) => {
  name: string
  args: JsonObject
}
type MockExecutor = (_ctx: JsonObject, input: JsonObject) => Promise<JsonObject>

const installModelMock = (steps: ModelScriptStep[]) => {
  const queue = [...steps]
  const chatModel = require('../src/main/services/llm/chatModel')
  chatModel.createChatModel = () => ({
    bindTools: (tools: Array<{ name: string }>) => ({
      invoke: async () => {
        const next = queue.shift()
        if (!next) throw new Error('mock model script exhausted')
        const toolNames = tools.map((toolItem) => String(toolItem.name || ''))
        const step = next(toolNames)
        return new AIMessage({
          content: '',
          tool_calls: [
            {
              id: `call-${Math.random().toString(16).slice(2)}`,
              name: step.name,
              args: step.args,
              type: 'tool_call'
            }
          ]
        })
      }
    }),
    invoke: async () => new AIMessage({ content: 'finalized' })
  })
}

const createMockCtx = (input?: {
  workspace?: {
    workspaceId: string
    rootPath: string
    policyProfile?: string
  }
  planDecision?: JsonObject
  approvals?: Array<{ approved: boolean; reason?: string }>
}) => {
  const events: JsonObject[] = []
  const approvals = Array.isArray(input?.approvals) ? [...input.approvals] : []
  const approvalRequests: JsonObject[] = []

  return {
    events,
    approvalRequests,
    ctx: {
      runId: 'run-regression',
      sessionId: 'sess-regression',
      selectedDocumentIds: undefined,
      workspace: input?.workspace,
      checkCancelled: () => undefined,
      chatJson: async () => input?.planDecision || { mode: 'final_answer', answer: 'direct answer' },
      sendEvent: (event: JsonObject) => {
        events.push(event)
      },
      requestApproval: async (request: JsonObject) => {
        approvalRequests.push(request)
        if (approvals.length > 0) return approvals.shift()
        return { approved: true }
      },
      loadHistory: async () => ({ recentTurnsText: '', sessionSummaryText: '', localInstructions: [] }),
      getModelConfig: async () => ({
        id: 'mock',
        name: 'mock',
        base_url: 'http://localhost',
        model_name: 'mock',
        api_key: 'mock',
        is_active: true
      }),
      documentsStore: {
        hybridSearch: async () => [],
        vectorSearch: async () => [],
        ftsSearch: async () => [],
        listDocuments: async () => ({ items: [], total: 0 })
      },
      embeddingService: {
        embed: async () => ({ data: [] })
      }
    }
  }
}

const baseState = () => ({
  runId: 'run-regression',
  sessionId: 'sess-regression',
  status: 'running',
  input: 'user input',
  stage: 'human_execution',
  plan: [],
  activeTaskId: undefined,
  contextEnrichmentRounds: 0,
  contextEvidence: [],
  taskSlots: {},
  slotArtifacts: {},
  humanStepIndex: 0,
  outputText: undefined,
  error: undefined
})

const testDirectAnswer = async () => {
  const { createMainNode } = require('../src/main/services/ai/node/main/mainNode')
  const env = createMockCtx({
    planDecision: { mode: 'final_answer', answer: '直接答复' }
  })
  const mainNode = createMainNode({
    ctx: env.ctx,
    capabilityRegistry: new Map()
  })
  const state = {
    ...baseState(),
    stage: 'plan_execution'
  }
  const result = await mainNode(state)
  assert.equal(result.stage, 'finalization')
  assert.equal(result.outputText, '直接答复')
}

const testHumanMultiStep = async () => {
  installModelMock([
    () => ({
      name: 'use_local_kb_retrieval',
      args: {
        objective: 'collect context',
        produce: ['slot:ctx.raw'],
        expect: { requiredOutputs: ['slot:ctx.raw'] }
      }
    }),
    () => ({
      name: 'use_terminal_exec',
      args: {
        objective: 'run command',
        args: { command: 'echo ok' },
        consume: ['slot:ctx.raw'],
        produce: ['slot:exec.out'],
        expect: { requiredOutputs: ['slot:exec.out'] }
      }
    }),
    () => ({
      name: 'complete_task',
      args: {
        summary: 'task completed'
      }
    })
  ])

  const { createHumanNode } = require('../src/main/services/ai/node/human/humanNode')
  const env = createMockCtx({
    workspace: {
      workspaceId: 'ws-1',
      rootPath: process.cwd(),
      policyProfile: 'default'
    }
  })
  const capabilityRegistry = new Map<string, MockExecutor>([
    [
      'local_kb_retrieval',
      async (_ctx: JsonObject, input: JsonObject) => ({
        capability: 'local_kb_retrieval',
        success: true,
        code: 'ok',
        summary: 'retrieval ok',
        data: { objective: input.objective, evidence: 'ctx-ready' }
      } as JsonObject)
    ],
    [
      'terminal_exec',
      async (_ctx: JsonObject, input: JsonObject) => {
        const args = input.args as JsonObject | undefined
        if (!args || typeof args.command !== 'string') {
          return {
            capability: 'terminal_exec',
            success: false,
            code: 'invalid_input',
            summary: 'missing command'
          } as JsonObject
        }
        return {
          capability: 'terminal_exec',
          success: true,
          code: 'ok',
          summary: 'terminal ok',
          data: { command: args.command }
        } as JsonObject
      }
    ],
    [
      'docx',
      async () => ({
        capability: 'docx',
        success: false,
        code: 'failed',
        summary: 'unused'
      } as JsonObject)
    ]
  ])
  const capabilityMeta = [
    {
      kind: 'local_kb_retrieval',
      tags: ['retrieval'],
      requiresWorkspace: false,
      requiresApproval: false,
      consumes: [],
      produces: ['kb.evidence']
    },
    {
      kind: 'terminal_exec',
      tags: ['terminal'],
      requiresWorkspace: true,
      requiresApproval: true,
      consumes: [],
      produces: ['terminal.result']
    },
    {
      kind: 'docx',
      tags: ['docx'],
      requiresWorkspace: true,
      requiresApproval: true,
      consumes: [],
      produces: ['docx.result']
    }
  ]

  const humanNode = createHumanNode({
    ctx: env.ctx,
    capabilityRegistry,
    capabilityMeta
  })
  const state = {
    ...baseState(),
    stage: 'human_execution',
    plan: [
      {
        id: 'task-1',
        title: 'multi-step task',
        kind: 'terminal_exec',
        input: 'run and answer',
        toolInput: {
          kind: 'terminal_exec',
          objective: 'run and answer'
        },
        status: 'running',
        attempts: 0
      }
    ],
    activeTaskId: 'task-1'
  }

  const result = await humanNode(state)
  assert.equal(result.stage, 'plan_execution')
  assert.equal(result.activeTaskId, undefined)
  assert.equal(result.plan[0].status, 'completed')
  assert.equal(result.plan[0].resultCode, 'ok')
  assert.ok(result.taskSlots['task-1']['slot:ctx.raw'])
  assert.ok(result.taskSlots['task-1']['slot:exec.out'])

  const brokerEvents = env.events.filter((event) => event.type === 'broker_decision')
  const slotEvents = env.events.filter((event) => event.type === 'slot_commit')
  assert.ok(brokerEvents.length >= 2)
  assert.ok(slotEvents.length >= 2)
}

const testBlockTask = async () => {
  installModelMock([
    () => ({
      name: 'block_task',
      args: {
        reason: 'cannot proceed'
      }
    })
  ])

  const { createHumanNode } = require('../src/main/services/ai/node/human/humanNode')
  const env = createMockCtx({
    workspace: {
      workspaceId: 'ws-1',
      rootPath: process.cwd(),
      policyProfile: 'default'
    }
  })
  const capabilityRegistry = new Map<string, MockExecutor>([
    [
      'local_kb_retrieval',
      async () => ({
        capability: 'local_kb_retrieval',
        success: true,
        code: 'ok',
        summary: 'ok'
      } as JsonObject)
    ]
  ])
  const capabilityMeta = [
    {
      kind: 'local_kb_retrieval',
      tags: ['retrieval'],
      requiresWorkspace: false,
      requiresApproval: false,
      consumes: [],
      produces: ['kb.evidence']
    }
  ]
  const humanNode = createHumanNode({
    ctx: env.ctx,
    capabilityRegistry,
    capabilityMeta
  })
  const state = {
    ...baseState(),
    plan: [
      {
        id: 'task-block',
        title: 'blocked task',
        kind: 'local_kb_retrieval',
        input: 'block me',
        toolInput: {
          kind: 'local_kb_retrieval',
          objective: 'block me'
        },
        status: 'running',
        attempts: 0
      }
    ],
    activeTaskId: 'task-block'
  }
  const result = await humanNode(state)
  assert.equal(result.plan[0].status, 'failed')
  assert.equal(result.plan[0].resultCode, 'failed')
  assert.equal(result.error, 'cannot proceed')
}

const testWorkspaceAndApprovalGates = async () => {
  const { executeTerminalExecNode } = require('../src/main/services/ai/node/capability/terminal_exec/terminalExecNode')
  const { executeDocxNode } = require('../src/main/services/ai/node/capability/docx/docxNode')

  const noWorkspaceEnv = createMockCtx({ workspace: undefined })
  const terminalNoWorkspace = await executeTerminalExecNode(noWorkspaceEnv.ctx, {
    runId: 'run-regression',
    taskId: 'gate-1',
    taskTitle: 'gate',
    kind: 'terminal_exec',
    objective: 'run',
    args: { command: 'echo hello' },
    toolInput: {
      kind: 'terminal_exec',
      objective: 'run'
    }
  })
  assert.equal(terminalNoWorkspace.code, 'workspace_required')

  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-gate-'))
  const denyEnv = createMockCtx({
    workspace: {
      workspaceId: 'ws-gate',
      rootPath: workspaceRoot,
      policyProfile: 'default'
    },
    approvals: [
      { approved: false, reason: 'denied-by-test' },
      { approved: false, reason: 'denied-by-test' }
    ]
  })
  const terminalDenied = await executeTerminalExecNode(denyEnv.ctx, {
    runId: 'run-regression',
    taskId: 'gate-2',
    taskTitle: 'gate',
    kind: 'terminal_exec',
    objective: 'run',
    args: { command: 'touch denied.txt' },
    toolInput: {
      kind: 'terminal_exec',
      objective: 'run'
    }
  })
  assert.equal(terminalDenied.code, 'approval_denied')

  const existingPath = path.join(workspaceRoot, 'existing.docx')
  fs.writeFileSync(existingPath, 'seed', 'utf8')
  const docxDenied = await executeDocxNode(denyEnv.ctx, {
    runId: 'run-regression',
    taskId: 'gate-3',
    taskTitle: 'gate',
    kind: 'docx',
    objective: 'save',
    args: {
      mode: 'save_output',
      text: 'hello',
      outputPath: 'existing.docx',
      overwrite: true
    },
    toolInput: {
      kind: 'docx',
      objective: 'save',
      outputPath: 'existing.docx'
    }
  })
  assert.equal(docxDenied.code, 'approval_denied')
}

const run = async () => {
  await testDirectAnswer()
  await testHumanMultiStep()
  await testBlockTask()
  await testWorkspaceAndApprovalGates()
  console.log('REGRESSION_OK')
}

void run()
