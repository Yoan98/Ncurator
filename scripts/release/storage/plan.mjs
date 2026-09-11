import process from 'node:process'
import { DOMESTIC_DOWNLOAD_BASE_URL } from './config.mjs'

const plan = {
  mode: 'dry-run',
  storage: 'Tencent COS',
  bucket: String(process.env.COS_BUCKET || 'ncurator-1324873382'),
  region: String(process.env.COS_REGION || 'ap-guangzhou'),
  publicBaseUrl: String(process.env.COS_PUBLIC_BASE_URL || DOMESTIC_DOWNLOAD_BASE_URL),
  writes: [
    'artifacts/<platform>/<tag>/*',
    'release-status/<tag>/<platform>.json',
    'updates/latest/latest*.yml',
    'releases/latest/<platform>.json'
  ],
  networkRequests: 0,
  note: 'This command never uploads, deletes, tags, commits, or pushes.'
}

process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
