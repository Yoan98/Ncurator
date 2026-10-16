import type { SqliteCore } from '../sqlite/SqliteCore'
export class OpenWithPreferenceStore {
  constructor(private readonly sqlite: SqliteCore) {}
  get(extension: string): string | undefined {
    return (
      this.sqlite
        .prepare('SELECT application_id FROM open_with_preferences WHERE extension = ?')
        .get(extension) as { application_id: string } | undefined
    )?.application_id
  }
  set(extension: string, applicationId: string | null): void {
    if (applicationId === null)
      this.sqlite.prepare('DELETE FROM open_with_preferences WHERE extension = ?').run(extension)
    else
      this.sqlite
        .prepare(
          'INSERT INTO open_with_preferences (extension, application_id) VALUES (?, ?) ON CONFLICT(extension) DO UPDATE SET application_id = excluded.application_id'
        )
        .run(extension, applicationId)
  }
}
