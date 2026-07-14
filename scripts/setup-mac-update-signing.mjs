import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { loadReleaseEnvironment } from './release-environment.mjs'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
await loadReleaseEnvironment(ROOT)

if (process.platform !== 'darwin') throw new Error('macOS signing setup must run on macOS')
const p12Path = String(process.env.CSC_LINK || '').trim()
const password = String(process.env.CSC_KEY_PASSWORD || '')
if (!p12Path || !password) {
  throw new Error('CSC_LINK and CSC_KEY_PASSWORD must be configured in .env')
}

const keychain = path.join(os.homedir(), 'Library', 'Keychains', 'login.keychain-db')
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-signing-'))
const certificatePath = path.join(temporaryDirectory, 'ncurator-update-signing.pem')

try {
  await execFileAsync('/usr/bin/security', [
    'import',
    p12Path,
    '-k',
    keychain,
    '-P',
    password,
    '-T',
    '/usr/bin/codesign',
    '-T',
    '/usr/bin/security'
  ]).catch((error) => {
    const stderr = String(error?.stderr || '')
    if (!stderr.includes('already exists')) {
      throw new Error(`failed to import macOS signing certificate: ${stderr.trim()}`)
    }
  })
  await execFileAsync(
    '/usr/bin/openssl',
    [
      'pkcs12',
      '-in',
      p12Path,
      '-clcerts',
      '-nokeys',
      '-out',
      certificatePath,
      '-passin',
      'env:CSC_KEY_PASSWORD'
    ],
    { env: process.env }
  )
  await execFileAsync('/usr/bin/security', [
    'add-trusted-cert',
    '-r',
    'trustRoot',
    '-p',
    'codeSign',
    '-k',
    keychain,
    certificatePath
  ])
  const { stdout } = await execFileAsync('/usr/bin/security', [
    'find-identity',
    '-v',
    '-p',
    'codesigning'
  ])
  if (!stdout.includes('Ncurator Update Signing')) {
    throw new Error('Ncurator Update Signing was imported but is not a valid code-signing identity')
  }
  process.stdout.write('[release] Ncurator Update Signing is installed and trusted\n')
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
