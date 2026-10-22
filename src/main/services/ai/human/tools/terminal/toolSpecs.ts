import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { analyzeTerminalCommandPolicy, analyzeTerminalCommand } from './commandPolicy'
import { readStringArg } from '../utils/toolSpecUtils'
import type { AiRuntimePlatform } from '../../../types'
import { getAiRuntimePlatform } from '../../../utils/platform'
import {
  renderTerminalReadModelResult,
  renderTerminalRunModelResult
} from '../../shared/modelToolResultRenderers'
import { TERMINAL_READ_SCHEMA, TERMINAL_RUN_SCHEMA } from './toolSchemas'

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
  modelResult: { renderSuccess: renderTerminalRunModelResult }
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

export const TERMINAL_RUN_TOOL_SPEC = createTerminalRunToolSpec()
export const TERMINAL_TOOL_SPECS = [TERMINAL_RUN_TOOL_SPEC, TERMINAL_READ_TOOL_SPEC] as const
