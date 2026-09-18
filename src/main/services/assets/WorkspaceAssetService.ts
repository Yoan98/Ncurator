import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getUserDataPath } from '../../utils/userDataPath'

const PARTNERS_DIR = 'partners'
const PARTNER_RUNTIME_DIR = 'runtime'
const PARTNER_ASSETS_DIR = 'assets'
const PARTNER_SCRIPTS_DIR = 'scripts'
const PARTNER_TOOL_RESULT_DIR = 'toolresult'
const PARTNER_OBJECTS_DIR = 'objects'

const normalizePartnerId = (partnerId: string): string => {
  const value = String(partnerId || '').trim()
  if (!value || path.basename(value) !== value) {
    throw new Error('partnerId 无效')
  }
  return value
}

export const getPartnerRootDir = (partnerId: string): string =>
  path.join(getUserDataPath(), PARTNERS_DIR, normalizePartnerId(partnerId))

export const getPartnerRuntimeDir = (partnerId: string): string =>
  path.join(getPartnerRootDir(partnerId), PARTNER_RUNTIME_DIR)

export const getPartnerAssetsRootDir = (partnerId: string): string =>
  path.join(getPartnerRuntimeDir(partnerId), PARTNER_ASSETS_DIR)

export const getPartnerScriptsRootDir = (partnerId: string): string =>
  path.join(getPartnerRuntimeDir(partnerId), PARTNER_SCRIPTS_DIR)

export const getPartnerToolResultDir = (partnerId: string): string =>
  path.join(getPartnerRuntimeDir(partnerId), PARTNER_TOOL_RESULT_DIR)

export const getPartnerObjectsDir = (partnerId: string): string =>
  path.join(getPartnerRootDir(partnerId), PARTNER_OBJECTS_DIR)

export const getPartnerAssetBucketDir = (partnerId: string, assetBucketId: string): string => {
  const normalizedBucketId = String(assetBucketId || '').trim()
  if (!normalizedBucketId || path.basename(normalizedBucketId) !== normalizedBucketId) {
    throw new Error('assetBucketId 无效')
  }
  return path.join(getPartnerAssetsRootDir(partnerId), normalizedBucketId)
}

export const deletePartnerRootDir = async (partnerId: string): Promise<void> => {
  await fs.rm(getPartnerRootDir(partnerId), { recursive: true, force: true })
}

export const ensurePartnerRuntimeDirs = async (partnerId: string): Promise<void> => {  const runtimeDir = getPartnerRuntimeDir(partnerId)
  await Promise.all([
    fs.mkdir(path.join(runtimeDir, PARTNER_ASSETS_DIR), { recursive: true }),
    fs.mkdir(getPartnerScriptsRootDir(partnerId), { recursive: true }),
    fs.mkdir(getPartnerToolResultDir(partnerId), { recursive: true }),
    fs.mkdir(getPartnerObjectsDir(partnerId), { recursive: true })
  ])
}

export const ensurePartnerAssetBucket = async (
  partnerId: string,
  assetBucketId: string
): Promise<string> => {
  await ensurePartnerRuntimeDirs(partnerId)
  const directoryPath = getPartnerAssetBucketDir(partnerId, assetBucketId)
  await fs.mkdir(directoryPath, { recursive: true })
  return directoryPath
}

export const createPartnerAssetBucket = async (
  partnerId: string
): Promise<{ assetBucketId: string; directoryPath: string }> => {
  const assetBucketId = randomUUID()
  return {
    assetBucketId,
    directoryPath: await ensurePartnerAssetBucket(partnerId, assetBucketId)
  }
}
