import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { assertReleaseFragment, resolveReleaseAssetPath } from './r2/fragment-contract.mjs'
import { parseReleaseTag } from './tag.mjs'

const SHA256_HEX = /^[a-f0-9]{64}$/u
const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/u
const STORAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

const hashFile = async (filePath, algorithm, encoding) =>
  createHash(algorithm)
    .update(await readFile(filePath))
    .digest(encoding)

const assertPlainFileName = (value, label) => {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== path.basename(value) ||
    value === '.' ||
    value === '..'
  ) {
    throw new Error(`${label} must be a plain file name`)
  }
}

export const assertReleaseBundle = (
  bundle,
  { tag: expectedTag, platform: expectedPlatform } = {}
) => {
  if (!bundle || typeof bundle !== 'object') throw new Error('release bundle is missing')
  if (bundle.schemaVersion !== 2) throw new Error('release bundle schemaVersion must be 2')
  try {
    parseReleaseTag(bundle.tag, bundle.platform)
  } catch {
    throw new Error('release bundle tag is invalid')
  }
  if (expectedTag && bundle.tag !== expectedTag) {
    throw new Error(`release bundle tag must be ${expectedTag}`)
  }
  if (expectedPlatform && bundle.platform !== expectedPlatform) {
    throw new Error(`release bundle platform must be ${expectedPlatform}`)
  }
  if (!/^[a-f0-9]{40}$/u.test(bundle.commit)) throw new Error('release bundle commit is invalid')
  if (Number.isNaN(Date.parse(bundle.createdAt))) {
    throw new Error('release bundle createdAt is invalid')
  }
  assertPlainFileName(bundle.fragment, 'release bundle fragment')
  if (!Array.isArray(bundle.files) || bundle.files.length === 0) {
    throw new Error('release bundle files are missing')
  }
  const names = new Set()
  const storageNames = new Set()
  for (const file of bundle.files) {
    assertPlainFileName(file?.name, 'release bundle asset')
    if (names.has(file.name)) throw new Error(`duplicate release bundle asset: ${file.name}`)
    names.add(file.name)
    assertPlainFileName(file?.storageName, 'release bundle storage asset')
    if (!STORAGE_NAME.test(file.storageName)) {
      throw new Error(`release bundle storage asset must be ASCII: ${file.name}`)
    }
    if (storageNames.has(file.storageName)) {
      throw new Error(`duplicate release bundle storage asset: ${file.storageName}`)
    }
    storageNames.add(file.storageName)
    if (!['installer', 'update'].includes(file.role)) {
      throw new Error(`invalid release bundle role: ${file.name}`)
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error(`invalid release bundle size: ${file.name}`)
    }
    if (!SHA256_HEX.test(file.sha256)) throw new Error(`invalid sha256: ${file.name}`)
    if (!SHA512_BASE64.test(file.sha512)) throw new Error(`invalid sha512: ${file.name}`)
  }
  if (bundle.files.filter((file) => file.role === 'installer').length !== 1) {
    throw new Error('release bundle must contain exactly one installer')
  }
  return bundle
}

export const createReleaseBundle = async ({ fragmentPath, outputPath, commit }) => {
  const fragment = JSON.parse(await readFile(fragmentPath, 'utf8'))
  assertReleaseFragment(fragment)
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error(`invalid release commit: ${commit}`)

  const directory = path.dirname(fragmentPath)
  const files = []
  for (const file of fragment.files) {
    const filePath = await resolveReleaseAssetPath(directory, file)
    const fileStat = await stat(filePath)
    const sha512 = await hashFile(filePath, 'sha512', 'base64')
    if (fileStat.size !== file.size || sha512 !== file.sha512) {
      throw new Error(`release fragment does not match local asset: ${file.name}`)
    }
    files.push({
      name: file.name,
      storageName: file.storageName,
      role: file.role,
      size: file.size,
      sha256: await hashFile(filePath, 'sha256', 'hex'),
      sha512
    })
  }

  const bundle = {
    schemaVersion: 2,
    tag: fragment.tag,
    commit,
    platform: fragment.platform,
    createdAt: new Date().toISOString(),
    fragment: path.basename(fragmentPath),
    files
  }
  assertReleaseBundle(bundle)
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8')
  return bundle
}

export const readReleaseBundle = async (bundlePath, expected = {}) => {
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8'))
  return assertReleaseBundle(bundle, expected)
}

export const verifyReleaseBundle = async (bundlePath, expected = {}) => {
  const bundle = await readReleaseBundle(bundlePath, expected)
  const directory = path.dirname(bundlePath)
  const fragmentPath = path.join(directory, bundle.fragment)
  const fragment = JSON.parse(await readFile(fragmentPath, 'utf8'))
  assertReleaseFragment(fragment, { tag: bundle.tag, platform: bundle.platform })

  for (const file of bundle.files) {
    const fragmentFile = fragment.files.find((candidate) => candidate.name === file.name)
    if (
      !fragmentFile ||
      fragmentFile.role !== file.role ||
      fragmentFile.storageName !== file.storageName ||
      fragmentFile.size !== file.size ||
      fragmentFile.sha512 !== file.sha512
    ) {
      throw new Error(`release bundle does not match fragment: ${file.name}`)
    }
    const filePath = await resolveReleaseAssetPath(directory, file)
    const fileStat = await stat(filePath)
    if (fileStat.size !== file.size) throw new Error(`release asset size changed: ${file.name}`)
    const [sha256, sha512] = await Promise.all([
      hashFile(filePath, 'sha256', 'hex'),
      hashFile(filePath, 'sha512', 'base64')
    ])
    if (sha256 !== file.sha256 || sha512 !== file.sha512) {
      throw new Error(`release asset hash changed: ${file.name}`)
    }
  }
  if (fragment.files.length !== bundle.files.length) {
    throw new Error('release bundle file set does not match fragment')
  }
  return { bundle, directory, fragment, fragmentPath }
}

export const resolveBundleInstaller = async (bundlePath, expected = {}) => {
  const verified = await verifyReleaseBundle(bundlePath, expected)
  const installer = verified.bundle.files.find((file) => file.role === 'installer')
  return {
    ...verified,
    installer,
    installerPath: path.join(verified.directory, installer.name)
  }
}
