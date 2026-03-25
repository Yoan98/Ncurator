import fs from 'node:fs'
import path from 'node:path'
import type { AiFileArtifactOperation } from '../../../../../../shared/types'
import type { ArtifactCandidate, TerminalArtifactCandidate } from './types'
import { parseShellTokens, splitCommandSegments } from './commandParsing'
import { resolveWorkspacePath } from './terminalPaths'
import { emitFileArtifactEvent } from '../../../events/fileArtifacts'
import type { TerminalToolContext } from '../../../types'
import type { CapabilityActivityInput } from '../types'

const extractRedirectionPaths = (tokens: string[]): string[] => {
  const paths: string[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '>' || token === '>>' || token === '1>' || token === '1>>') {
      const next = tokens[index + 1]
      if (next && !next.startsWith('-')) paths.push(next)
      continue
    }
    const inline = token.match(/^(?:1?>>?)(.+)$/)
    if (inline?.[1]) {
      paths.push(inline[1])
    }
  }
  return paths
}

const pickNonOptionArgs = (tokens: string[]): string[] =>
  tokens.filter((token, index) => index > 0 && token && !token.startsWith('-'))

const detectSegmentArtifacts = (segment: string): TerminalArtifactCandidate[] => {
  const tokens = parseShellTokens(segment)
  if (tokens.length === 0) return []

  const first = String(tokens[0] || '').toLowerCase()
  const candidates: TerminalArtifactCandidate[] = extractRedirectionPaths(tokens).map(
    (rawPath) => ({
      rawPath
    })
  )
  const args = pickNonOptionArgs(tokens)

  if (first === 'touch' || first === 'mkdir') {
    for (const rawPath of args) candidates.push({ rawPath, operation: 'created' })
  } else if (first === 'cp' || first === 'mv') {
    const destination = args.at(-1)
    if (destination) {
      candidates.push({
        rawPath: destination,
        operation: first === 'mv' ? 'updated' : undefined
      })
    }
  } else if (first === 'tee') {
    const destination = args.find((token) => token !== '/dev/null')
    if (destination) candidates.push({ rawPath: destination })
  }

  return candidates
}

export const collectTerminalArtifactCandidates = (command: string): TerminalArtifactCandidate[] => {
  const unique = new Map<string, TerminalArtifactCandidate>()
  for (const segment of splitCommandSegments(command)) {
    for (const candidate of detectSegmentArtifacts(segment)) {
      const key = candidate.rawPath.trim()
      if (!key) continue
      const previous = unique.get(key)
      if (!previous) {
        unique.set(key, candidate)
      } else if (!previous.operation && candidate.operation) {
        unique.set(key, candidate)
      }
    }
  }
  return Array.from(unique.values())
}

export const mergeArtifactCandidates = (input: {
  commandCandidates: TerminalArtifactCandidate[]
  expectedArtifacts: Array<{ path: string; operation?: AiFileArtifactOperation; summary?: string }>
  cwd: string
  workspaceRootPath: string
}): ArtifactCandidate[] => {
  const merged = new Map<
    string,
    { requestedOperation?: AiFileArtifactOperation; summary?: string }
  >()

  const commandCandidates = input.commandCandidates.map((item) => ({
    path: item.rawPath,
    operation: item.operation,
    summary: undefined
  }))
  const explicitCandidates = input.expectedArtifacts.map((item) => ({
    path: item.path,
    operation: item.operation,
    summary: item.summary
  }))

  for (const item of [...commandCandidates, ...explicitCandidates]) {
    const resolved = resolveWorkspacePath({
      rawPath: item.path,
      cwd: input.cwd,
      rootPath: input.workspaceRootPath
    })
    if (!resolved) continue
    const previous = merged.get(resolved)
    if (!previous) {
      merged.set(resolved, {
        requestedOperation: item.operation,
        summary: item.summary
      })
      continue
    }
    merged.set(resolved, {
      requestedOperation: previous.requestedOperation || item.operation,
      summary: previous.summary || item.summary
    })
  }

  return Array.from(merged.entries()).map(([resolvedPath, meta]) => ({
    resolvedPath,
    summary:
      meta.summary || `terminal command produced/updated file: ${path.basename(resolvedPath)}`,
    requestedOperation: meta.requestedOperation,
    existedBefore: fs.existsSync(resolvedPath)
  }))
}

export const recordTerminalArtifacts = (input: {
  ctx: TerminalToolContext
  runId: string
  taskId: string
  stepId: string
  candidates: ArtifactCandidate[]
  emitActivity: (activity: CapabilityActivityInput) => void
}): Array<{ path: string; operation: AiFileArtifactOperation }> => {
  const artifacts: Array<{ path: string; operation: AiFileArtifactOperation }> = []
  for (const artifact of input.candidates) {
    if (!fs.existsSync(artifact.resolvedPath)) continue
    const operation =
      artifact.requestedOperation || (artifact.existedBefore ? 'updated' : 'created')
    const emitted = emitFileArtifactEvent({
      ctx: input.ctx,
      runId: input.runId,
      taskId: input.taskId,
      capability: 'terminal_exec',
      artifactPath: artifact.resolvedPath,
      operation,
      summary: artifact.summary,
      stepId: input.stepId,
      onNonFatalError: (reason) => {
        input.emitActivity({
          actionType: 'file_artifact',
          status: 'failed',
          summary: reason
        })
      }
    })
    if (emitted) {
      artifacts.push({
        path: artifact.resolvedPath,
        operation
      })
    }
  }
  return artifacts
}
