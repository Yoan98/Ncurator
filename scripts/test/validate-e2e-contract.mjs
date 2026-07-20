import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const CASE_ROOT = path.join(ROOT, 'tests', 'case')

const walk = async (directory) => {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(entryPath)))
    else if (entry.isFile() && entry.name.endsWith('.e2e.test.ts')) files.push(entryPath)
  }
  return files
}

const files = await walk(CASE_ROOT)
const failures = []
let realCases = 0
let fixtureCases = 0

for (const filePath of files) {
  const source = await readFile(filePath, 'utf8')
  const relativePath = path.relative(ROOT, filePath)
  const caseCount = (source.match(/\brunE2ECase(?:<[^>]+>)?\s*\(/gu) || []).length
  const realCount = (source.match(/\bserviceMode\s*:\s*['"]real['"]/gu) || []).length
  const fixtureCount = (source.match(/\bserviceMode\s*:\s*['"]fixture['"]/gu) || []).length
  const reasonCount = (source.match(/\bfixtureReason\s*:\s*['"][^'"]+['"]/gu) || []).length

  if (source.includes('launchMode:')) failures.push(`${relativePath}: 不允许继续使用 launchMode`)
  if (caseCount === 0) failures.push(`${relativePath}: 未找到 caseId`)
  if (realCount + fixtureCount !== caseCount) {
    failures.push(
      `${relativePath}: 每个 caseId 必须对应一个显式 serviceMode，case=${caseCount} mode=${realCount + fixtureCount}`
    )
  }
  if (reasonCount !== fixtureCount) {
    failures.push(
      `${relativePath}: 每个 fixture 必须提供 fixtureReason，fixture=${fixtureCount} reason=${reasonCount}`
    )
  }
  realCases += realCount
  fixtureCases += fixtureCount
}

if (failures.length > 0) {
  throw new Error(`E2E 契约校验失败：\n${failures.map((item) => `- ${item}`).join('\n')}`)
}

process.stdout.write(
  `[e2e-contract] ${String(files.length)} files, ${String(realCases)} real, ${String(fixtureCases)} fixture\n`
)
