import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// Exercise the existing request protocol without contacting a search provider or
// starting a browser. Runtime hooks and all eager imports still have to succeed.
export const verifySidecarStartup = (executablePath) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ncurator-sidecar-verify-'))
  const expected = [
    { id: 'startup-搜索', ok: false, error: 'missing search query' },
    { id: 'startup-抓取', ok: false, error: 'missing crawl url' }
  ]
  try {
    const result = spawnSync(path.resolve(executablePath), [], {
      cwd: directory,
      env: {
        ...process.env,
        NLTK_DISABLE_IMPORT_SECURITY: '0',
        NCURATOR_WEB_CRAWLER_CDP_URL: 'ws://127.0.0.1:1/devtools/browser/startup',
        NCURATOR_WEB_CRAWLER_CDP_CONTEXT_MARKER_URL: 'about:blank#ncurator-web-crawler-startup'
      },
      input:
        ['search', 'crawl']
          .map((action, index) => JSON.stringify({ id: expected[index].id, action, input: {} }))
          .join('\n') + '\n',
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true
    })
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(
        `web crawler sidecar startup failed (code=${String(result.status)}): ${result.stderr.trim()}`
      )
    }
    const responses = result.stdout
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line))
    if (
      responses.length !== expected.length ||
      expected.some((item, index) =>
        Object.entries(item).some(([key, value]) => responses[index][key] !== value)
      )
    ) {
      throw new Error(`web crawler sidecar startup returned invalid responses: ${result.stdout}`)
    }
    process.stdout.write('[sidecar] frozen runtime startup and UTF-8 protocol verified\n')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}
