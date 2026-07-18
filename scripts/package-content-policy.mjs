import fs from 'node:fs'
import path from 'node:path'

const FORBIDDEN_EXTENSIONS = new Set([
  '.adoc',
  '.bat',
  '.map',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.tsbuildinfo',
  '.jsx',
  '.vue',
  '.svelte',
  '.py',
  '.pyc',
  '.pyo',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.fs',
  '.fsx',
  '.go',
  '.java',
  '.kt',
  '.kts',
  '.m',
  '.mm',
  '.php',
  '.rb',
  '.rs',
  '.scala',
  '.swift',
  '.vb',
  '.gyp',
  '.gypi',
  '.gradle',
  '.sln',
  '.vcxproj',
  '.sh',
  '.ps1',
  '.cmd',
  '.flow',
  '.jsdoc',
  '.patch',
  '.orig',
  '.md',
  '.markdown',
  '.rst',
  '.key',
  '.p12',
  '.pfx',
  '.pdb'
])

const FORBIDDEN_SEGMENTS = new Set([
  '.changeset',
  '.circleci',
  '.claude',
  '.codex',
  '.github',
  '.git',
  '.history',
  '.husky',
  '.idea',
  '.vscode',
  '__tests__',
  'docs',
  'doc',
  'coverage',
  'examples',
  'example',
  'patchright',
  'tests',
  'test',
  'scripts'
])

const FORBIDDEN_ROOT_SEGMENTS = new Set(['src', 'tests', 'scripts', 'doc'])

const FORBIDDEN_NAMES = new Set([
  '.ds_store',
  '.editorconfig',
  '.eslintignore',
  '.flowconfig',
  '.gitattributes',
  '.gitignore',
  '.gitkeep',
  '.keep',
  '.nojekyll',
  '.npmignore',
  '.nycrc',
  '.prettierignore',
  '.taprc',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package-lock.json',
  'yarn.lock',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json'
])

const SECRET_PATTERNS = [
  {
    label: 'private key',
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{80,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u
  },
  { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/u },
  {
    label: 'GitHub token',
    pattern: /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[opusr]_[A-Za-z0-9]{30,})\b/u
  },
  { label: 'Stripe live secret', pattern: /\bsk_live_[A-Za-z0-9]{20,}\b/u }
]

const normalizeRelativePath = (value) => value.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '')

const isLegalNotice = (name) =>
  /^(?:license|licence|notice|copying)(?:[._-].*)?$/u.test(name) ||
  /^(?:apache2?|bsd|mit)$/u.test(name)

export const assertSafePackagePaths = (paths) => {
  const violations = []
  const targetPrebuildDirectory = `${process.platform}-${process.arch}`
  for (const rawPath of paths) {
    const relativePath = normalizeRelativePath(rawPath)
    if (!relativePath) continue
    const segments = relativePath.split('/')
    const lowerSegments = segments.map((segment) => segment.toLowerCase())
    const name = lowerSegments.at(-1) || ''
    const extension = path.extname(name)
    const legalNotice = isLegalNotice(name)

    const prebuildsIndex = lowerSegments.indexOf('prebuilds')
    const prebuildDirectory = prebuildsIndex >= 0 ? lowerSegments[prebuildsIndex + 1] : undefined
    if (
      prebuildDirectory &&
      /^(?:darwin|linux|win32)-(?:arm64|ia32|x64)$/u.test(prebuildDirectory) &&
      prebuildDirectory !== targetPrebuildDirectory
    ) {
      violations.push(`${relativePath}: foreign native prebuild ${prebuildDirectory}`)
      continue
    }

    if (lowerSegments.some((segment) => segment.startsWith('chromium-'))) {
      violations.push(`${relativePath}: full Chromium is forbidden; only headless shell is allowed`)
      continue
    }

    if (FORBIDDEN_ROOT_SEGMENTS.has(lowerSegments[0])) {
      violations.push(`${relativePath}: forbidden project directory ${lowerSegments[0]}`)
      continue
    }

    if (lowerSegments.some((segment) => segment.startsWith('.env'))) {
      violations.push(`${relativePath}: environment file`)
      continue
    }
    const forbiddenSegment = lowerSegments.find((segment) => FORBIDDEN_SEGMENTS.has(segment))
    if (forbiddenSegment) {
      violations.push(`${relativePath}: forbidden directory ${forbiddenSegment}`)
      continue
    }
    if (
      FORBIDDEN_NAMES.has(name) ||
      name.startsWith('.eslintrc') ||
      name.startsWith('.prettierrc')
    ) {
      violations.push(`${relativePath}: forbidden build file`)
      continue
    }
    if (!legalNotice && FORBIDDEN_EXTENSIONS.has(extension)) {
      violations.push(`${relativePath}: forbidden extension ${extension}`)
      continue
    }
    if (/\.(?:spec|test)\.[^.]+$/u.test(name)) {
      violations.push(`${relativePath}: test file`)
      continue
    }
    if (name === 'trace.zip' || name.endsWith('.trace')) {
      violations.push(`${relativePath}: test trace`)
    }
  }
  if (violations.length > 0) {
    throw new Error(`package content policy failed:\n${violations.slice(0, 100).join('\n')}`)
  }
}

export const listDirectoryFiles = (rootDirectory) => {
  const files = []
  const symlinks = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name)
      const relativePath = normalizeRelativePath(path.relative(rootDirectory, absolutePath))
      if (entry.isSymbolicLink()) {
        symlinks.push({ absolutePath, relativePath, target: fs.readlinkSync(absolutePath) })
      } else if (entry.isDirectory()) {
        walk(absolutePath)
      } else if (entry.isFile()) {
        files.push({ absolutePath, relativePath, size: fs.statSync(absolutePath).size })
      }
    }
  }
  walk(rootDirectory)
  return { files, symlinks }
}

export const assertSafeSymlinks = (rootDirectory, symlinks) => {
  const root = path.resolve(rootDirectory)
  const violations = []
  for (const item of symlinks) {
    if (path.isAbsolute(item.target)) {
      violations.push(`${item.relativePath}: absolute symlink`)
      continue
    }
    const resolved = path.resolve(path.dirname(item.absolutePath), item.target)
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      violations.push(`${item.relativePath}: symlink escapes package root`)
    }
  }
  if (violations.length > 0) {
    throw new Error(`unsafe package symlinks:\n${violations.join('\n')}`)
  }
}

export const assertMinimalPackageJson = (packageJson, sourceLabel) => {
  const allowedKeys = new Set([
    'name',
    'version',
    'description',
    'main',
    'author',
    'homepage',
    'private',
    'dependencies'
  ])
  const extraKeys = Object.keys(packageJson).filter((key) => !allowedKeys.has(key))
  if (extraKeys.length > 0) {
    throw new Error(`${sourceLabel} contains development metadata: ${extraKeys.join(', ')}`)
  }
  if (packageJson.main !== './out/main/index.js') {
    throw new Error(`${sourceLabel} has an unexpected main entry`)
  }
  if (!packageJson.private || !packageJson.name || !packageJson.version) {
    throw new Error(`${sourceLabel} is missing required production metadata`)
  }
}

export const scanTextForSecrets = (source, sourceLabel) => {
  for (const item of SECRET_PATTERNS) {
    if (item.pattern.test(source)) {
      throw new Error(`${sourceLabel} contains a possible ${item.label}`)
    }
  }
  if (/(?:\/\/[#@]\s*sourceMappingURL\s*=|\/\*[#@]\s*sourceMappingURL\s*=)/u.test(source)) {
    throw new Error(`${sourceLabel} references a source map`)
  }
}

export const auditPackageDirectory = (rootDirectory, options = {}) => {
  const root = path.resolve(rootDirectory)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`package directory not found: ${root}`)
  }
  const { files, symlinks } = listDirectoryFiles(root)
  assertSafePackagePaths([
    ...files.map((item) => item.relativePath),
    ...symlinks.map((item) => item.relativePath)
  ])
  assertSafeSymlinks(root, symlinks)

  if (options.allowedTopLevel) {
    const allowed = new Set(options.allowedTopLevel)
    const unexpected = fs.readdirSync(root).filter((name) => !allowed.has(name))
    if (unexpected.length > 0) {
      throw new Error(`unexpected package root entries: ${unexpected.join(', ')}`)
    }
  }

  const packageJsonPath = path.join(root, 'package.json')
  if (options.requireMinimalPackageJson) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    assertMinimalPackageJson(packageJson, packageJsonPath)
  }

  for (const item of files) {
    if (
      item.size <= 5 * 1024 * 1024 &&
      /\.(?:c?js|mjs|json|html|css|ya?ml|toml|xml|pem|txt)$/u.test(item.relativePath)
    ) {
      scanTextForSecrets(fs.readFileSync(item.absolutePath, 'utf8'), item.relativePath)
    }
    if (!item.relativePath.startsWith('out/') || item.size > 25 * 1024 * 1024) continue
    if (!/\.(?:js|cjs|mjs|json|html|css)$/u.test(item.relativePath)) continue
    scanTextForSecrets(fs.readFileSync(item.absolutePath, 'utf8'), item.relativePath)
  }

  return { files, symlinks }
}
