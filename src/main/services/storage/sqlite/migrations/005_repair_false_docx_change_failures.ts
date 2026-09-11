import type { Migration } from './types'

export const repairFalseDocxChangeFailuresMigration: Migration = {
  version: 5,
  name: 'repair_false_docx_change_failures',
  sql: `
UPDATE ai_file_change
SET status = 'applied', last_error = NULL
WHERE status = 'failed'
  AND last_error = 'Run completed without an effective workspace change.'
  AND EXISTS (
    SELECT 1
    FROM docx_apply
    WHERE docx_apply.id = ai_file_change.id
      AND docx_apply.status = 'applied'
      AND COALESCE(docx_apply.before_checksum, '') <> COALESCE(docx_apply.after_checksum, '')
  );
`
}
