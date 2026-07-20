import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditPackageDirectory } from './content-policy.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const stageDirectory = path.resolve(process.argv[2] || path.join(root, 'release-stage', 'app'))
const result = auditPackageDirectory(stageDirectory, {
  allowedTopLevel: ['node_modules', 'out', 'package.json', 'resources'],
  requireMinimalPackageJson: true
})

const bytes = result.files.reduce((sum, item) => sum + item.size, 0)
process.stdout.write(
  `[package] staging audit passed: ${result.files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB\n`
)
