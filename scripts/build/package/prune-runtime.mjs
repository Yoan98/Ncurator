import fs from 'node:fs'
import path from 'node:path'

const normalizePath = (value) => String(value).replaceAll('\\', '/')

const collectPackageTracePaths = (runtimeTrace, packageName) => {
  const packageSegments = packageName.split('/')
  const result = new Set()
  for (const rawPath of runtimeTrace.trace?.files || []) {
    const segments = normalizePath(rawPath).split('/')
    for (let index = 0; index < segments.length; index += 1) {
      if (segments[index] !== 'node_modules') continue
      const packageStart = index + 1
      if (
        packageSegments.every(
          (segment, segmentIndex) => segments[packageStart + segmentIndex] === segment
        )
      ) {
        result.add(segments.slice(packageStart + packageSegments.length).join('/'))
      }
    }
  }
  return [...result].sort()
}

const assertTracedPackage = (runtimeTrace, packageName) => {
  if (!(runtimeTrace.packages || []).some((item) => item.name === packageName)) {
    throw new Error(`runtime pruning requires traced package ${packageName}`)
  }
  const paths = collectPackageTracePaths(runtimeTrace, packageName)
  if (paths.length === 0) {
    throw new Error(`runtime pruning has no traced files for ${packageName}`)
  }
  return paths
}

export const assertRuntimePruningTrace = (runtimeTrace, platform = process.platform) => {
  const mathJaxPaths = assertTracedPackage(runtimeTrace, 'mathjax-full')
  const unsafeMathJaxPath = mathJaxPaths.find(
    (relativePath) => relativePath !== 'package.json' && !relativePath.startsWith('js/')
  )
  if (unsafeMathJaxPath) {
    throw new Error(`mathjax-full trace reaches a removable path: ${unsafeMathJaxPath}`)
  }

  const pdfParsePaths = assertTracedPackage(runtimeTrace, 'pdf-parse')
  const unsafePdfVersion = pdfParsePaths.find((relativePath) => {
    const match = relativePath.match(/^lib\/pdf\.js\/(v[^/]+)(?:\/|$)/u)
    return match && match[1] !== 'v1.10.100'
  })
  if (unsafePdfVersion) {
    throw new Error(`pdf-parse trace reaches a removable PDF.js version: ${unsafePdfVersion}`)
  }

  const excelJsPaths = assertTracedPackage(runtimeTrace, 'exceljs')
  const unsafeExcelJsPath = excelJsPaths.find(
    (relativePath) => relativePath === 'dist' || relativePath.startsWith('dist/')
  )
  if (unsafeExcelJsPath) {
    throw new Error(`exceljs trace reaches removable browser dist: ${unsafeExcelJsPath}`)
  }

  if (platform !== 'win32') {
    const nodePtyPaths = assertTracedPackage(runtimeTrace, 'node-pty')
    const unsafeNodePtyPath = nodePtyPaths.find(
      (relativePath) => relativePath === 'third_party' || relativePath.startsWith('third_party/')
    )
    if (unsafeNodePtyPath) {
      throw new Error(`node-pty trace reaches removable Windows sources: ${unsafeNodePtyPath}`)
    }
  }
}

const directorySize = (targetPath) => {
  if (!fs.existsSync(targetPath)) return 0
  const stat = fs.lstatSync(targetPath)
  if (!stat.isDirectory()) return stat.size
  return fs
    .readdirSync(targetPath)
    .reduce((total, name) => total + directorySize(path.join(targetPath, name)), 0)
}

export const pruneRuntimePackages = ({
  nodeModulesDirectory,
  runtimeTrace,
  platform = process.platform
}) => {
  assertRuntimePruningTrace(runtimeTrace, platform)

  const targets = [
    ['mathjax-full/es5', path.join(nodeModulesDirectory, 'mathjax-full', 'es5')],
    ['mathjax-full/components', path.join(nodeModulesDirectory, 'mathjax-full', 'components')],
    ['mathjax-full/ts', path.join(nodeModulesDirectory, 'mathjax-full', 'ts')],
    [
      'pdf-parse PDF.js v1.9.426',
      path.join(nodeModulesDirectory, 'pdf-parse', 'lib', 'pdf.js', 'v1.9.426')
    ],
    [
      'pdf-parse PDF.js v1.10.88',
      path.join(nodeModulesDirectory, 'pdf-parse', 'lib', 'pdf.js', 'v1.10.88')
    ],
    [
      'pdf-parse PDF.js v2.0.550',
      path.join(nodeModulesDirectory, 'pdf-parse', 'lib', 'pdf.js', 'v2.0.550')
    ],
    ['exceljs/dist', path.join(nodeModulesDirectory, 'exceljs', 'dist')]
  ]
  if (platform !== 'win32') {
    targets.push([
      'node-pty Windows ConPTY',
      path.join(nodeModulesDirectory, 'node-pty', 'third_party')
    ])
  }

  const removed = targets.map(([label, targetPath]) => {
    const bytes = directorySize(targetPath)
    fs.rmSync(targetPath, { recursive: true, force: true })
    return { label, bytes }
  })
  return {
    removed,
    totalBytes: removed.reduce((total, item) => total + item.bytes, 0)
  }
}
