import fs from 'node:fs'
import path from 'node:path'
import type { ResolvedCwd } from './types'
import { resolveWorkspacePath } from './terminalPaths'

export const resolveTerminalCwd = (input: {
  workspaceRootPath: string
  requestedCwd?: string
}): ResolvedCwd => {
  const root = path.resolve(input.workspaceRootPath)
  const requestedRaw = String(input.requestedCwd || '').trim()
  if (!requestedRaw) {
    return {
      ok: true,
      cwd: root
    }
  }

  const normalizedRequested = requestedRaw.replace(/[\\/]+$/g, '')
  const rootAlias = path.basename(root).replace(/[\\/]+$/g, '')
  const requested =
    normalizedRequested === rootAlias || normalizedRequested === path.join('.', rootAlias)
      ? '.'
      : requestedRaw

  const resolved = resolveWorkspacePath({
    rawPath: requested,
    cwd: root,
    rootPath: root
  })
  if (!resolved) {
    return {
      ok: false,
      code: 'workspace_required',
      error: 'cwd is out of workspace boundary'
    }
  }
  if (!fs.existsSync(resolved)) {
    return {
      ok: false,
      code: 'invalid_input',
      error: 'cwd does not exist inside workspace'
    }
  }
  if (!fs.statSync(resolved).isDirectory()) {
    return {
      ok: false,
      code: 'invalid_input',
      error: 'cwd is not a directory'
    }
  }

  return {
    ok: true,
    cwd: resolved
  }
}
