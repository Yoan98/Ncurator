import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const [appPath = '', outputPath = ''] = process.argv.slice(2)

if (!appPath || !outputPath) {
  throw new Error(
    'usage: node scripts/verify-mac-update-signature.mjs <Ncurator.app> <output-file>'
  )
}

await execFileAsync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
const { stdout, stderr } = await execFileAsync('/usr/bin/codesign', [
  '-d',
  '-r-',
  '--verbose=4',
  appPath
])
const signatureDetails = `${stdout}\n${stderr}`

if (/^Signature=adhoc$/mu.test(signatureDetails)) {
  throw new Error('macOS release must not use an ad-hoc signature')
}
if (/designated => .*cdhash\b/mu.test(signatureDetails)) {
  throw new Error('macOS designated requirement must remain stable across versions')
}
if (!/^Authority=.+$/mu.test(signatureDetails)) {
  throw new Error('macOS release does not contain a signing authority')
}
if (!/designated => .*identifier "com\.yoan\.ncurator"/mu.test(signatureDetails)) {
  throw new Error('macOS release has an unexpected designated requirement')
}

const identity = signatureDetails
  .split('\n')
  .filter((line) => /^(Authority=|designated =>)/u.test(line))
  .join('\n')
await writeFile(outputPath, `${identity}\n`, 'utf8')
process.stdout.write(`${identity}\n`)
