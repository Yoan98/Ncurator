import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import JSZip from 'jszip'
import { gte, valid } from 'semver'
import { z } from 'zod/v4'
import { app } from 'electron'
import { serviceApiUrl, getAppRuntime, usesLocalService } from '../app/AppRuntime'
import { buildDesktopAppGatewayHeaders } from '../officialApi/appClient'
import { getUserDataPath } from '../../utils/userDataPath'
import type { UserSkillService } from './UserSkillService'
import type {
  OfficialSkill,
  OfficialSkillCatalog,
  OfficialSkillDownload
} from '../../../shared/officialSkills'

const skillSchema = z.object({
  id: z.string().min(1),
  name: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
    .max(64),
  displayName: z.string().min(1),
  description: z.string(),
  iconUrl: z.string().url().nullable(),
  version: z.string(),
  minClientVersion: z.string(),
  releaseNotes: z.string(),
  downloadUrl: z.string().url(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u)
})
const catalogSchema = z.object({ items: z.array(skillSchema) })
const MAX_BYTES = 64 * 1024 * 1024
const compatible = (current: string, minimum: string): boolean =>
  !!valid(current) && !!valid(minimum) && gte(current, minimum)
type Pending = {
  owner: number
  stage: string
  skill: OfficialSkill
  expected: { name: string; fingerprint: string | null } | null
  expires: number
}

export class OfficialSkillService {
  private pending = new Map<string, Pending>()
  private items: OfficialSkill[] = []
  private cache = path.join(getUserDataPath(), 'official-skills', 'catalog.json')
  constructor(private readonly local: UserSkillService) {}

  async catalog(): Promise<OfficialSkillCatalog> {
    try {
      const url = serviceApiUrl(getAppRuntime().distribution, '/api/v1/skills')
      const response = await fetch(url, {
        headers: buildDesktopAppGatewayHeaders({ method: 'GET', url }),
        signal: AbortSignal.timeout(15000)
      })
      if (!response.ok) throw new Error('Official Skill catalog unavailable')
      this.items = catalogSchema.parse(await response.json()).items
      await fs.mkdir(path.dirname(this.cache), { recursive: true })
      const temporary = `${this.cache}.${randomUUID()}.tmp`
      await fs.writeFile(temporary, JSON.stringify({ items: this.items }))
      await fs.rename(temporary, this.cache)
      return { items: this.items }
    } catch {
      if (!this.items.length)
        this.items = await fs
          .readFile(this.cache, 'utf8')
          .then((text) => catalogSchema.parse(JSON.parse(text)).items)
          .catch(() => [])
      return { items: this.items, offline: true }
    }
  }

  async prepare(id: string, owner: number): Promise<OfficialSkillDownload> {
    await this.cleanupExpired()
    const catalog = await this.catalog(),
      skill = catalog.items.find((item) => item.id === id)
    if (!skill) throw new Error('Official Skill is unavailable')
    if (!compatible(app.getVersion(), skill.minClientVersion))
      throw new Error(`需要馆长 ${skill.minClientVersion} 或更新版本`)
    const prior = this.local.identityForOfficial(id)
    const expected = prior
      ? { name: prior.name, fingerprint: this.local.fingerprint(prior.name) }
      : null
    const collision = this.local
      .listOptions()
      .find((item) => item.name === skill.name && item.officialId !== id)
    if (collision) throw new Error('存在同名但身份不同的 Skill，请先重命名后再下载')
    const url = new URL(skill.downloadUrl)
    if (
      url.protocol !== 'https:' &&
      !(usesLocalService() && ['localhost', '127.0.0.1'].includes(url.hostname))
    )
      throw new Error('Invalid Skill download URL')
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
    if (!response.ok || !response.body) throw new Error('Skill download failed')
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of Readable.fromWeb(
      response.body as import('node:stream/web').ReadableStream<Uint8Array>
    )) {
      size += chunk.length
      if (size > MAX_BYTES) throw new Error('Skill package exceeds 64 MiB')
      chunks.push(chunk)
    }
    const bytes = Buffer.concat(chunks)
    if (createHash('sha256').update(bytes).digest('hex') !== skill.sha256)
      throw new Error('Skill package checksum mismatch')
    const stage = this.local.createStagingDirectory()
    try {
      await extractSkillZip(bytes, stage)
      const token = randomUUID()
      this.pending.set(token, { owner, stage, skill, expected, expires: Date.now() + 15 * 60000 })
      return {
        token,
        skill,
        replacing: expected?.fingerprint !== null && !!expected,
        locallyModified: !!prior?.baselineSha256 && prior.baselineSha256 !== expected?.fingerprint
      }
    } catch (error) {
      await fs.rm(stage, { recursive: true, force: true })
      throw error
    }
  }

  commit(token: string, owner: number): void {
    const pending = this.pending.get(token)
    if (!pending || pending.owner !== owner || pending.expires < Date.now())
      throw new Error('Skill download expired; download again')
    this.local.installOfficial(pending.stage, pending.skill, pending.expected)
    this.pending.delete(token)
  }
  async cancel(token: string, owner: number): Promise<void> {
    const pending = this.pending.get(token)
    if (!pending || pending.owner !== owner) return
    this.pending.delete(token)
    await fs.rm(pending.stage, { recursive: true, force: true })
  }
  async cancelOwner(owner: number): Promise<void> {
    for (const [token, pending] of this.pending)
      if (pending.owner === owner) await this.cancel(token, owner)
  }
  private async cleanupExpired(): Promise<void> {
    for (const [token, pending] of this.pending)
      if (pending.expires < Date.now()) await this.cancel(token, pending.owner)
  }
}

export const extractSkillZip = async (bytes: Buffer, directory: string): Promise<void> => {
  const zip = await JSZip.loadAsync(bytes, { createFolders: false })
  const entries = Object.values(zip.files)
  if (entries.length > 1000 || !zip.file('SKILL.md'))
    throw new Error('Invalid Skill package structure')
  let total = 0
  const names = new Set<string>()
  for (const entry of entries) {
    const name = entry.unsafeOriginalName || entry.name,
      parts = name.split('/')
    const permissions =
      typeof entry.unixPermissions === 'string'
        ? parseInt(entry.unixPermissions, 8)
        : entry.unixPermissions || 0
    if (
      name !== entry.name ||
      name.startsWith('/') ||
      /[\\:]/u.test(name) ||
      name.includes('\0') ||
      parts.some(
        (part) =>
          part === '..' ||
          part === '.' ||
          part.endsWith('.') ||
          part.endsWith(' ') ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)
      ) ||
      (permissions & 0xf000) === 0xa000 ||
      permissions & 0o7000 ||
      names.has(name.toLowerCase())
    )
      throw new Error('Unsafe Skill package entry')
    names.add(name.toLowerCase())
    const target = path.join(directory, name)
    if (entry.dir) {
      await fs.mkdir(target, { recursive: true })
      continue
    }
    await fs.mkdir(path.dirname(target), { recursive: true })
    const stream = new Readable().wrap(entry.nodeStream('nodebuffer'))
    let length = 0
    const handle = await fs.open(target, 'wx', permissions & 0o111 ? 0o755 : 0o644)
    try {
      for await (const chunk of stream) {
        length += chunk.length
        total += chunk.length
        if (length > (name === 'SKILL.md' ? MAX_BYTES : 16 * 1024 * 1024) || total > MAX_BYTES)
          throw new Error('Skill package resource exceeds limit')
        await handle.write(chunk)
      }
    } finally {
      stream.destroy()
      await handle.close()
    }
  }
  if (!fsSync.statSync(path.join(directory, 'SKILL.md')).isFile())
    throw new Error('Missing SKILL.md')
}
