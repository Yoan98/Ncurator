import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { verifyPackageMainObfuscation } from './package-main-obfuscation.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stageDirectory = path.resolve(process.argv[2] || path.join(root, 'release-stage', 'app'))
const reportPath = path.resolve(
  process.argv[3] || path.join(root, 'release-stage', 'main-obfuscation-report.json')
)

const report = verifyPackageMainObfuscation({ stageDirectory, reportPath })
process.stdout.write(
  `[package] main obfuscation verified: ${String(report.totals.files)} files, ` +
    `growth ${(report.totals.growthBytes / 1024 / 1024).toFixed(1)} MiB\n`
)
