import { classifyCommandMode, classifyCommandRisk } from './terminalCommandPolicy'
import { collectTerminalArtifactCandidates } from './terminalArtifacts'
import type { TerminalCommandAnalysis } from './types'

export const analyzeTerminalCommand = (input: {
  command: string
  cwd?: string
}): TerminalCommandAnalysis => {
  const command = String(input.command || '').trim()
  const cwd = String(input.cwd || '').trim()

  return {
    riskLevel: classifyCommandRisk(command),
    commandMode: classifyCommandMode(command),
    resourceKey: cwd || 'workspace',
    artifactCandidates: collectTerminalArtifactCandidates(command)
  }
}
