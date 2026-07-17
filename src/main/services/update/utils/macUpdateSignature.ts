import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { MAC_APP_IDENTIFIER, MAC_UPDATE_SIGNING_AUTHORITY } from '../constants'

const resolveMacAppBundlePath = (): string => {
  const executableMarker = `${path.sep}Contents${path.sep}MacOS${path.sep}`
  const markerIndex = process.execPath.lastIndexOf(executableMarker)
  return markerIndex < 0 ? process.execPath : process.execPath.slice(0, markerIndex)
}

export const isStableMacUpdateSignature = (status: number | null, output: string): boolean =>
  status === 0 &&
  !/^Signature=adhoc$/mu.test(output) &&
  new RegExp(`^Authority=${MAC_UPDATE_SIGNING_AUTHORITY}$`, 'mu').test(output) &&
  new RegExp(
    `designated => .*identifier "${MAC_APP_IDENTIFIER.replaceAll('.', '\\.')}"`,
    'mu'
  ).test(output) &&
  !/designated => .*cdhash\b/mu.test(output)

export const hasStableMacUpdateSignature = (): boolean => {
  const signature = spawnSync(
    '/usr/bin/codesign',
    ['-d', '-r-', '--verbose=4', resolveMacAppBundlePath()],
    { encoding: 'utf8' }
  )
  return isStableMacUpdateSignature(
    signature.status,
    `${signature.stdout || ''}\n${signature.stderr || ''}`
  )
}
