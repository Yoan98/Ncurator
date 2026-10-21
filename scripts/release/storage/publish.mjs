import { distributionStorage } from '../shared/distribution.mjs'
import path from 'node:path'
import process from 'node:process'
import { resolveReleaseStorageConfigs } from './config.mjs'
import { fetchWithRetry } from '../shared/http.mjs'
import {
  isReleaseChannelCurrent,
  verifyPublicReleaseFragment,
  verifyReleaseStorageFragment
} from '../shared/live-tag.mjs'

export const prepareReleaseStoragePublication = async (
  fragment,
  environment = process.env,
  fetchImpl = fetchWithRetry
) => {
  // Resolve both sets of credentials and reject newer public versions before
  // GitHub or either storage channel receives any writes.
  const configs = resolveReleaseStorageConfigs(environment).filter(
    (config) => config.target === distributionStorage(fragment.distribution)
  )
  return Promise.all(
    configs.map(async (config) => ({
      config,
      current: await isReleaseChannelCurrent(fragment, config.publicBaseUrl, fetchImpl)
    }))
  )
}

export const publishReleaseStorage = async (
  verified,
  channels,
  { root = process.cwd(), run, awsExecutable }
) => {
  const { fragment, directory, fragmentPath } = verified
  for (const { config, current } of channels) {
    if (config.target !== distributionStorage(fragment.distribution))
      throw new Error('release distribution cannot be published to this storage')
    const options = {
      cwd: root,
      env: { ...process.env, RELEASE_STORAGE_TARGET: config.target }
    }
    if (!current) {
      await run(
        process.execPath,
        [
          path.join(root, 'scripts', 'release', 'r2', 'upload-fragment.mjs'),
          directory,
          fragmentPath
        ],
        options
      )
      await run(
        process.execPath,
        [path.join(root, 'scripts', 'release', 'r2', 'finalize.mjs'), '--tag', fragment.tag],
        options
      )
    }
    await verifyPublicReleaseFragment(fragment, config.publicBaseUrl)
    await verifyReleaseStorageFragment(fragment, awsExecutable, config)
    if (!(await isReleaseChannelCurrent(fragment, config.publicBaseUrl))) {
      throw new Error(`public ${config.label} release channel does not match the candidate`)
    }
    process.stdout.write(`[release] ${fragment.tag} verified on ${config.label}\n`)
  }
}
