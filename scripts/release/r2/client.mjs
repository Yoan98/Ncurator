// Compatibility entry point. Shared release metadata remains under r2/, while the
// storage client now supports Tencent COS (default) and Cloudflare R2.
export { createReleaseStorageClient as createR2Client } from '../storage/client.mjs'
