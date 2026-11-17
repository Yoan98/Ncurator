import { describe, expect, it } from 'vitest'
import {
  formatWorkspacePathLabel,
  getWorkspacePathLabelParts
} from '../../../../src/shared/workbench/pathDisplay'
import type { WorkspaceSource } from '../../../../src/shared/types'

const workspace = (rootPath: string): WorkspaceSource => ({
  id: rootPath,
  root_path: rootPath,
  created_at: 0,
  updated_at: 0
})

const workspaceRoot = '/Users/huangyuan/work-space/ncurator-official'
const workspaces = [workspace(workspaceRoot)]

describe('workbench workspace path label', () => {
  it('shows the workspace name and inner directories for a file inside the root', () => {
    const display = getWorkspacePathLabelParts(
      `${workspaceRoot}/tmp/uireview/recharge-simple.html`,
      workspaces
    )
    expect(display).toEqual({
      label: 'ncurator-official/tmp/uireview/recharge-simple.html',
      prefix: 'ncurator-official > tmp > uireview > ',
      fileName: 'recharge-simple.html'
    })
  })

  it('does not borrow the selected workspace name for a file outside every workspace root', () => {
    const display = getWorkspacePathLabelParts('/tmp/uireview/recharge-simple.html', workspaces)
    expect(display).toEqual({
      label: '/tmp/uireview/recharge-simple.html',
      prefix: 'tmp > uireview > ',
      fileName: 'recharge-simple.html'
    })
    expect(formatWorkspacePathLabel('/tmp/uireview/recharge-simple.html', workspaces)).toBe(
      '/tmp/uireview/recharge-simple.html'
    )
  })

  it('supports the slash separator and Windows paths', () => {
    expect(getWorkspacePathLabelParts('/tmp/uireview/a.html', workspaces, '/').prefix).toBe(
      'tmp/uireview/'
    )
    expect(getWorkspacePathLabelParts('C:\\tmp\\a.html', workspaces)).toMatchObject({
      prefix: 'C: > tmp > ',
      fileName: 'a.html'
    })
  })

  it('uses the deepest matching workspace root when roots are nested', () => {
    const nested = [workspace('/Users/me'), workspace('/Users/me/project')]
    expect(getWorkspacePathLabelParts('/Users/me/project/src/a.ts', nested).prefix).toBe(
      'project > src > '
    )
  })

  it('keeps a bare file name and an empty path free of prefixes', () => {
    expect(getWorkspacePathLabelParts('a.html', workspaces)).toEqual({
      label: 'a.html',
      prefix: '',
      fileName: 'a.html'
    })
    expect(getWorkspacePathLabelParts(undefined, workspaces)).toEqual({
      label: '',
      prefix: '',
      fileName: ''
    })
  })
})
