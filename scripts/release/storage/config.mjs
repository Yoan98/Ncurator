import process from 'node:process'

export const DOMESTIC_DOWNLOAD_BASE_URL = 'https://download.guanzhangai.cn'
export const GLOBAL_DOWNLOAD_BASE_URL = 'https://download.ncurator.com'
export const LIVE_PUBLISH_CONFIRMATION = 'publish-to-production'

const required = (environment, name) => {
  const value = String(environment[name] || '').trim()
  if (!value) throw new Error(`missing environment variable: ${name}`)
  return value
}

const normalizedBucket = (value) => value.replace(/^\/+|\/+$/gu, '')
const normalizedBaseUrl = (value) => value.replace(/\/$/u, '')

export const resolveReleaseStorageConfig = (environment = process.env) => {
  const target = String(environment.RELEASE_STORAGE_TARGET || 'cos')
    .trim()
    .toLowerCase()
  if (target === 'cos') {
    const region = required(environment, 'COS_REGION')
    const publicBaseUrl = normalizedBaseUrl(required(environment, 'COS_PUBLIC_BASE_URL'))
    if (publicBaseUrl !== DOMESTIC_DOWNLOAD_BASE_URL) {
      throw new Error(`COS_PUBLIC_BASE_URL must be ${DOMESTIC_DOWNLOAD_BASE_URL}`)
    }
    return {
      target,
      label: 'Tencent COS',
      bucket: normalizedBucket(required(environment, 'COS_BUCKET')),
      region,
      endpoint: `https://cos.${region}.myqcloud.com`,
      publicBaseUrl,
      credentials: {
        AWS_ACCESS_KEY_ID: required(environment, 'TENCENT_SECRET_ID'),
        AWS_SECRET_ACCESS_KEY: required(environment, 'TENCENT_SECRET_KEY'),
        AWS_REQUEST_CHECKSUM_CALCULATION: 'WHEN_REQUIRED',
        AWS_RESPONSE_CHECKSUM_VALIDATION: 'WHEN_REQUIRED'
      }
    }
  }
  if (target === 'r2') {
    const publicBaseUrl = normalizedBaseUrl(required(environment, 'R2_PUBLIC_BASE_URL'))
    if (publicBaseUrl !== GLOBAL_DOWNLOAD_BASE_URL) {
      throw new Error(`R2_PUBLIC_BASE_URL must be ${GLOBAL_DOWNLOAD_BASE_URL}`)
    }
    return {
      target,
      label: 'Cloudflare R2',
      bucket: normalizedBucket(required(environment, 'R2_BUCKET_NAME')),
      region: 'auto',
      endpoint: `https://${required(environment, 'R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      publicBaseUrl,
      credentials: {
        AWS_ACCESS_KEY_ID: required(environment, 'R2_ACCESS_KEY_ID'),
        AWS_SECRET_ACCESS_KEY: required(environment, 'R2_SECRET_ACCESS_KEY')
      }
    }
  }
  throw new Error('RELEASE_STORAGE_TARGET must be cos or r2')
}

export const assertLivePublishAllowed = (environment = process.env) => {
  if (String(environment.NCURATOR_ALLOW_LIVE_PUBLISH || '').trim() !== LIVE_PUBLISH_CONFIRMATION) {
    throw new Error(
      `live publish is locked; set NCURATOR_ALLOW_LIVE_PUBLISH=${LIVE_PUBLISH_CONFIRMATION} only for an approved production release`
    )
  }
}
