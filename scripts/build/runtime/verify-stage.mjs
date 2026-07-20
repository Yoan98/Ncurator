import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const assertInside = (parent, child, label) => {
  const relative = path.relative(parent, child)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} resolved outside the staged package: ${child}`)
  }
}

const loadStageExport = async (stageRequire, stageNodeModules, specifier, exportName) => {
  const resolved = stageRequire.resolve(specifier)
  assertInside(stageNodeModules, resolved, specifier)
  const loaded = await import(pathToFileURL(resolved).href)
  const value = loaded[exportName] || loaded.default?.[exportName]
  if (typeof value !== 'function') {
    throw new Error(`${specifier} does not export ${exportName}`)
  }
  return value
}

export const verifyStagedRuntime = async ({ stageDirectory, reportPath, rootDirectory }) => {
  const stageRoot = path.resolve(stageDirectory)
  const root = path.resolve(rootDirectory)
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  const stagePackagePath = path.join(stageRoot, 'package.json')
  const stageNodeModules = path.join(stageRoot, 'node_modules')
  const stageRequire = createRequire(stagePackagePath)

  if (report.target?.platform !== process.platform || report.target?.arch !== process.arch) {
    throw new Error(
      `runtime trace target ${report.target?.platform}-${report.target?.arch} does not match ${process.platform}-${process.arch}`
    )
  }

  for (const dependency of report.packages || []) {
    const manifestPath = path.join(
      stageNodeModules,
      ...String(dependency.name).split('/'),
      'package.json'
    )
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`traced runtime package is missing from stage: ${dependency.name}`)
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (String(manifest.version) !== String(dependency.version)) {
      throw new Error(
        `staged ${dependency.name} version ${manifest.version} does not match trace ${dependency.version}`
      )
    }
  }

  for (const required of report.requiredFiles || []) {
    const requiredPath = path.join(
      stageNodeModules,
      ...String(required.package).split('/'),
      ...String(required.path).split('/')
    )
    assertInside(stageNodeModules, requiredPath, required.id)
    if (!fs.existsSync(requiredPath) || !fs.statSync(requiredPath).isFile()) {
      throw new Error(`required staged runtime file is missing (${required.id}): ${requiredPath}`)
    }
  }

  const docxFixture = path.join(root, 'tests', 'fixtures', 'workspace', 'sample-edit.docx')
  const pdfFixture = path.join(root, 'tests', 'fixtures', 'workspace', '学习笔记', '深度学习.pdf')
  for (const fixture of [docxFixture, pdfFixture]) {
    if (!fs.existsSync(fixture)) throw new Error(`runtime loader fixture is missing: ${fixture}`)
  }

  const DocxLoader = await loadStageExport(
    stageRequire,
    stageNodeModules,
    '@langchain/community/document_loaders/fs/docx',
    'DocxLoader'
  )
  const PDFLoader = await loadStageExport(
    stageRequire,
    stageNodeModules,
    '@langchain/community/document_loaders/fs/pdf',
    'PDFLoader'
  )
  const docxDocuments = await new DocxLoader(docxFixture).load()
  const originalLog = console.log
  const originalWarn = console.warn
  let suppressedPdfWarnings = 0
  let pdfDocuments
  const filterPdfWarning =
    (fallback) =>
    (...values) => {
      if (values.some((value) => String(value).includes('font private use area'))) {
        suppressedPdfWarnings += 1
        return
      }
      fallback(...values)
    }
  try {
    console.log = filterPdfWarning(originalLog)
    console.warn = filterPdfWarning(originalWarn)
    pdfDocuments = await new PDFLoader(pdfFixture).load()
  } finally {
    console.log = originalLog
    console.warn = originalWarn
  }
  const assertDocuments = (documents, label) => {
    if (
      !Array.isArray(documents) ||
      documents.length === 0 ||
      !documents.some((document) => String(document?.pageContent || '').trim())
    ) {
      throw new Error(`${label} staged loader returned no text`)
    }
  }
  assertDocuments(docxDocuments, 'DOCX')
  assertDocuments(pdfDocuments, 'PDF')

  return {
    packages: report.packages.length,
    requiredFiles: report.requiredFiles.length,
    docxDocuments: docxDocuments.length,
    pdfDocuments: pdfDocuments.length,
    suppressedPdfWarnings
  }
}
