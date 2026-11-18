import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { analyzeTerminalCommandPolicy, analyzeTerminalCommand } from './commandPolicy'
import { readStringArg } from '../utils/toolSpecUtils'
import type { AiRuntimePlatform } from '../../../types'
import { getAiRuntimePlatform } from '../../../utils/platform'
import {
  renderTerminalReadModelResult,
  renderTerminalRunModelError,
  renderTerminalRunModelResult,
  renderTerminalStopModelResult
} from '../../shared/modelToolResultRenderers'
import { TERMINAL_READ_SCHEMA, TERMINAL_RUN_SCHEMA, TERMINAL_STOP_SCHEMA } from './toolSchemas'

type TerminalRunToolSpec = HumanToolSpec<
  z.infer<typeof TERMINAL_RUN_SCHEMA>,
  'terminal_run',
  'terminal'
>

type TerminalReadToolSpec = HumanToolSpec<
  z.infer<typeof TERMINAL_READ_SCHEMA>,
  'terminal_read',
  'terminal'
>

type TerminalStopToolSpec = HumanToolSpec<
  z.infer<typeof TERMINAL_STOP_SCHEMA>,
  'terminal_stop',
  'terminal'
>

export const createTerminalRunToolSpec = (
  platform: AiRuntimePlatform = getAiRuntimePlatform()
): TerminalRunToolSpec => ({
  name: 'terminal_run',
  familyId: 'terminal',
  toolsetIds: ['terminal'],
  inputSchema: TERMINAL_RUN_SCHEMA,
  promptSpec: {
    name: 'terminal_run',
    description: '在用户本机终端执行命令。默认工作目录为用户主目录。'
  },
  resolveExecutionMeta: (args) => {
    const command = readStringArg(args, 'command') || ''
    const analysis = analyzeTerminalCommand({ command, platform })
    const riskPolicy = analyzeTerminalCommandPolicy(command, platform)
    if (riskPolicy.executionPolicy === 'auto_allow' && analysis.artifactCandidates.length === 0) {
      return { mutability: 'read_only', resourceKey: analysis.resourceKey }
    }
    return { mutability: 'mutating', resourceKey: analysis.resourceKey }
  },
  modelResult: {
    renderSuccess: renderTerminalRunModelResult,
    renderError: renderTerminalRunModelError
  }
})

export const TERMINAL_READ_TOOL_SPEC: TerminalReadToolSpec = {
  name: 'terminal_read',
  familyId: 'terminal',
  toolsetIds: ['terminal'],
  inputSchema: TERMINAL_READ_SCHEMA,
  promptSpec: {
    name: 'terminal_read',
    description: '读取终端会话的增量输出与状态。'
  },
  resolveExecutionMeta: () => ({ mutability: 'read_only' }),
  modelResult: { renderSuccess: renderTerminalReadModelResult }
}

export const TERMINAL_STOP_TOOL_SPEC: TerminalStopToolSpec = {
  name: 'terminal_stop',
  familyId: 'terminal',
  toolsetIds: ['terminal'],
  inputSchema: TERMINAL_STOP_SCHEMA,
  promptSpec: {
    name: 'terminal_stop',
    description: '中断并关闭一个终端会话，不新建会话。'
  },
  resolveExecutionMeta: () => ({ mutability: 'mutating' }),
  modelResult: { renderSuccess: renderTerminalStopModelResult }
}

export const TERMINAL_RUN_TOOL_SPEC = createTerminalRunToolSpec()
export const TERMINAL_TOOL_SPECS = [
  TERMINAL_RUN_TOOL_SPEC,
  TERMINAL_READ_TOOL_SPEC,
  TERMINAL_STOP_TOOL_SPEC
] as const
