import type { Migration } from './types'

export const dropTerminalFileChangeRecordsMigration: Migration = {
  version: 11,
  name: 'drop_terminal_file_change_records',
  sql: `
DELETE FROM ai_file_change
WHERE source IN ('terminal_tool', 'workspace_scan')
   OR capability = 'terminal_exec';
`
}
