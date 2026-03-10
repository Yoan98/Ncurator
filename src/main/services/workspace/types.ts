import type { WorkspaceNode, WorkspaceSource } from '../../../shared/types'

export type WorkspaceValidationResult = {
  normalizedRootPath: string
  displayName: string
}

export type WorkspaceScanResult = {
  workspace: WorkspaceSource
  nodes: WorkspaceNode[]
}

export type WorkspaceNodeDiff = {
  added: WorkspaceNode[]
  removed: WorkspaceNode[]
  changed: WorkspaceNode[]
  unchanged: WorkspaceNode[]
}
