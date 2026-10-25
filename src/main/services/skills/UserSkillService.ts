import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseDocument, isMap } from 'yaml'
import {
  MAX_USER_SKILL_BODY_BYTES,
  type UserSkill,
  type UserSkillOption,
  type UserSkillDraft,
  type UserSkillDocument,
  type UserSkillSelection,
  type UserSkillUpdateRequest,
  type UserSkillImportPreview,
  type UserSkillImportCommitRequest,
  type UserSkillSource,
  type UserSkillResourcePreview
} from '../../../shared/userSkills'
import { getUserDataPath } from '../../utils/userDataPath'
import type { UserSkillStore } from '../storage/domains/UserSkillStore'

const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024
const MAX_ENTRIES = 1000
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Keep original SKILL.md bytes on disk, including all unrecognized frontmatter. */
export const parseSkillMarkdown = (
  content: string
): { name: string; description: string; body: string } => {
  if (typeof content !== 'string') throw new Error('Invalid SKILL.md content')
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(content)
  if (!match) throw new Error('SKILL.md requires YAML frontmatter with name and description')
  const document = parseDocument(match[1], { uniqueKeys: true })
  if (document.errors.length || !isMap(document.contents))
    throw new Error('Invalid SKILL.md frontmatter')
  const name: unknown = document.contents.get('name')
  const description: unknown = document.contents.get('description')
  if (
    typeof name !== 'string' ||
    name.length > 64 ||
    !SKILL_NAME.test(name) ||
    RESERVED_NAME.test(name)
  ) {
    throw new Error(
      'Skill name must be 1–64 lowercase letters, digits or single hyphens, and not a reserved filename'
    )
  }
  if (typeof description !== 'string' || !description.trim() || description.length > 1024) {
    throw new Error('Skill description must be a nonempty string of at most 1024 characters')
  }
  if (!match[2].trim()) throw new Error('Skill instructions cannot be empty')
  return { name, description: description.trim(), body: match[2] }
}

const readRegularFile = (filename: string, limit = Infinity): Buffer => {
  const before = fs.lstatSync(filename)
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error('Skill files must be regular files, not symbolic links')
  // O_NOFOLLOW rejects a leaf symlink even if the source changes during import.
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
  try {
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.size > limit || stat.dev !== before.dev || stat.ino !== before.ino)
      throw new Error('Skill file is not a regular file or exceeds the size limit')
    const buffer = Buffer.alloc(stat.size + 1)
    let bytesRead = 0
    while (bytesRead < buffer.length) {
      const count = fs.readSync(descriptor, buffer, bytesRead, buffer.length - bytesRead, bytesRead)
      if (!count) break
      bytesRead += count
    }
    if (bytesRead > limit || bytesRead > stat.size)
      throw new Error('Skill file changed during import')
    return buffer.subarray(0, bytesRead)
  } finally {
    fs.closeSync(descriptor)
  }
}

type PendingImport = { stage: string; owner: number; expiresAt: number }

export type SkillDirectoryEdit = { id?: string; sourcePath?: string; enabled?: boolean }
export type SkillManagementRead =
  | { skills: Array<{ id: string; name: string; description: string; enabled: boolean }> }
  | { id: string; path: string; content: string; enabled: boolean }
type SkillBinding = { partnerId: string; skillIds: string[] }

const markdownParts = (content: string) => {
  const parsed = parseSkillMarkdown(content)
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)!
  return { ...parsed, document: parseDocument(match[1], { uniqueKeys: true }) }
}

const buildMarkdown = (draft: UserSkillDraft, original?: string): string => {
  if (
    !draft ||
    typeof draft.name !== 'string' ||
    typeof draft.description !== 'string' ||
    typeof draft.body !== 'string'
  )
    throw new Error('Invalid skill form')
  if (original) {
    const parsed = parseSkillMarkdown(original)
    if (
      draft.name.trim() === parsed.name &&
      draft.description.trim() === parsed.description &&
      draft.body === parsed.body
    )
      return original
  }
  const document = original ? markdownParts(original).document : parseDocument('{}')
  document.set('name', draft.name.trim())
  document.set('description', draft.description.trim())
  const content = `---\n${document.toString()}---\n${draft.body}`
  parseSkillMarkdown(content)
  return content
}

export class UserSkillService {
  private readonly root: string
  private readonly imports = new Map<string, PendingImport>()

  public constructor(
    private readonly store: UserSkillStore,
    root = path.join(getUserDataPath(), 'skills'),
    private readonly onChanged: () => void = () => undefined
  ) {
    this.root = path.resolve(root)
  }

  private ensureRoot(): void {
    fs.mkdirSync(this.root, { recursive: true })
    if (fs.lstatSync(this.root).isSymbolicLink())
      throw new Error('Skills directory cannot be a symbolic link')
  }

  private directory(skill: UserSkill): string {
    if (!SKILL_NAME.test(skill.directoryName) || skill.directoryName !== skill.name)
      throw new Error('Invalid stored skill directory')
    const directory = path.join(this.root, skill.directoryName)
    if (fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory())
      throw new Error('Skill directory must be a real directory')
    if (fs.realpathSync(directory) !== path.join(fs.realpathSync(this.root), skill.directoryName))
      throw new Error('Skill directory is outside managed storage')
    return directory
  }

  private content(skill: UserSkill): string {
    this.ensureRoot()
    return readRegularFile(path.join(this.directory(skill), 'SKILL.md')).toString('utf8')
  }

  public list(): UserSkill[] {
    return this.store.list()
  }
  public listOptions(): UserSkillOption[] {
    return this.list().map((skill) => {
      try {
        return { ...skill, bodyBytes: Buffer.byteLength(this.read(skill).body, 'utf8') }
      } catch {
        return { ...skill, bodyBytes: null }
      }
    })
  }

  public listEnabled(partnerId: string): UserSkill[] {
    return this.store.listEnabled(partnerId)
  }

  public getDocument(id: string): UserSkillDocument {
    const skill = this.store.get(id)
    if (!skill) throw new Error('Skill not found')
    const parsed = parseSkillMarkdown(this.content(skill))
    return { ...skill, ...parsed, resources: this.resources(this.directory(skill)) }
  }

  private changed(): void {
    // Renderer observers run after the enclosing synchronous database transaction.
    queueMicrotask(() => {
      try {
        this.onChanged()
      } catch (error) {
        console.error('[APP-ERROR] Skill change notification failed', error)
      }
    })
  }

  public readForPartner(partnerId: string, id?: string): SkillManagementRead {
    const enabled = new Set(this.listEnabled(partnerId).map((skill) => skill.id))
    if (!id) {
      return {
        skills: this.list().map(({ id, name, description }) => ({
          id,
          name,
          description,
          enabled: enabled.has(id)
        }))
      }
    }
    const skill = this.store.get(id)
    if (!skill) throw new Error('Skill not found')
    return {
      id,
      path: this.resourceDirectory({ id }),
      content: this.content(skill),
      enabled: enabled.has(id)
    }
  }

  public editForPartner(
    partnerId: string,
    input: SkillDirectoryEdit
  ): { id: string; name: string } {
    this.store.partnerName(partnerId)
    if (
      (!input.id && !input.sourcePath) ||
      (input.id && !input.sourcePath && input.enabled === undefined)
    )
      throw new Error(
        'Provide a sourcePath to create, or an id with sourcePath or enabled to update'
      )
    const existing = input.id ? this.store.get(input.id) : undefined
    if (input.id && !existing) throw new Error('Skill not found')
    if (!input.sourcePath && existing) {
      const selection = this.binding(partnerId, existing.id, input.enabled!)
      this.setEnabled(partnerId, selection.skillIds)
      return { id: existing.id, name: existing.name }
    }
    const stage = this.copyFolder(input.sourcePath!, true)
    try {
      const skill = this.publish(stage, existing, { partnerId, enabled: input.enabled })
      return { id: skill.id, name: skill.name }
    } finally {
      fs.rmSync(stage, { recursive: true, force: true })
    }
  }

  private binding(partnerId: string, id: string, enabled: boolean): SkillBinding {
    const ids = this.listEnabled(partnerId)
      .map((skill) => skill.id)
      .filter((value) => value !== id)
    return { partnerId, skillIds: enabled ? [...ids, id] : ids }
  }

  private resources(directory: string): string[] {
    const result: string[] = []
    let count = 0
    const walk = (folder: string, prefix: string): void => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (++count > MAX_ENTRIES)
          throw new Error('A skill folder may contain at most 1000 entries')
        const relative = prefix + entry.name
        const filename = path.join(folder, entry.name)
        if (entry.isSymbolicLink()) throw new Error('Skill folders cannot contain symbolic links')
        if (entry.isDirectory()) walk(filename, relative + '/')
        else if (entry.isFile()) {
          if (relative !== 'SKILL.md') result.push(relative)
        } else throw new Error('Skill folders may contain only regular files and directories')
      }
    }
    walk(directory, '')
    return result.sort()
  }

  private pendingImport(token: string, owner: number): PendingImport {
    const pending = this.imports.get(token)
    if (!pending || pending.owner !== owner || pending.expiresAt < Date.now())
      throw new Error('Skill import expired; select the folder again')
    this.ensureRoot()
    if (
      fs.lstatSync(pending.stage).isSymbolicLink() ||
      path.dirname(fs.realpathSync(pending.stage)) !== fs.realpathSync(this.root)
    )
      throw new Error('Skill directory is outside managed storage')
    return pending
  }

  public resourceDirectory(source: UserSkillSource, owner = 0): string {
    if ('token' in source) return this.pendingImport(source.token, owner).stage
    const skill = this.store.get(source.id)
    if (!skill) throw new Error('Skill not found')
    this.ensureRoot()
    return this.directory(skill)
  }

  public previewResource(
    source: UserSkillSource,
    relative: string,
    owner = 0
  ): UserSkillResourcePreview {
    const directory = this.resourceDirectory(source, owner)
    if (
      typeof relative !== 'string' ||
      !relative ||
      relative.includes('\\') ||
      relative.split('/').some((part) => !part || part === '.' || part === '..') ||
      path.isAbsolute(relative) ||
      path.win32.isAbsolute(relative)
    )
      throw new Error('Invalid skill resource path')
    let filename = directory
    for (const segment of relative.split('/')) {
      filename = path.join(filename, segment)
      if (fs.lstatSync(filename).isSymbolicLink())
        throw new Error('Skill folders cannot contain symbolic links')
    }
    if (!fs.realpathSync(filename).startsWith(fs.realpathSync(directory) + path.sep))
      throw new Error('Skill resource is outside managed storage')
    const content = readRegularFile(filename, MAX_FILE_BYTES)
    const mime = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    }[path.extname(filename).toLowerCase()]
    if (mime) return { image: `data:${mime};base64,${content.toString('base64')}` }
    if (content.length > 256 * 1024 || content.includes(0)) return null
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(content) }
    } catch {
      return null
    }
  }

  private read(skill: UserSkill): { skill: UserSkill; body: string; resourceBase: string } {
    const parsed = parseSkillMarkdown(this.content(skill))
    if (parsed.name !== skill.name || parsed.description !== skill.description)
      throw new Error('Skill metadata changed; edit the skill or import the updated folder again')
    return { skill, body: parsed.body, resourceBase: this.directory(skill) }
  }

  public loadEnabled(partnerId: string, id: string): ReturnType<UserSkillService['read']> {
    const skill = this.listEnabled(partnerId).find((item) => item.id === id)
    if (!skill) throw new Error('Skill is not enabled')
    return this.read(skill)
  }

  public getSelection(partnerId: string): UserSkillSelection {
    const skills = this.listEnabled(partnerId)
    let bodyBytes = 0
    const unavailableSkillNames: string[] = []
    for (const skill of skills) {
      try {
        bodyBytes += Buffer.byteLength(this.read(skill).body, 'utf8')
      } catch {
        unavailableSkillNames.push(skill.name)
      }
    }
    return {
      skillIds: skills.map((skill) => skill.id),
      bodyBytes,
      maxBodyBytes: MAX_USER_SKILL_BODY_BYTES,
      unavailableSkillNames
    }
  }

  public setEnabled(partnerId: string, skillIds: string[]): void {
    if (
      typeof partnerId !== 'string' ||
      !partnerId ||
      !Array.isArray(skillIds) ||
      skillIds.length > 1000 ||
      skillIds.some((id) => typeof id !== 'string')
    )
      throw new Error('Invalid partner skill selection')
    const ids = [...new Set(skillIds)]
    const previous = new Set(this.listEnabled(partnerId).map((skill) => skill.id))
    const skills = ids.map((id) => {
      const skill = this.store.get(id)
      if (!skill) throw new Error('Skill not found')
      return skill
    })
    // Removing bindings must remain possible even when retained files are broken.
    const removesOnly = ids.length < previous.size && ids.every((id) => previous.has(id))
    if (!removesOnly) {
      const bytes = skills.reduce(
        (sum, skill) => sum + Buffer.byteLength(this.read(skill).body, 'utf8'),
        0
      )
      if (bytes > MAX_USER_SKILL_BODY_BYTES)
        throw new Error(`Skill instructions exceed 64 KiB (${bytes} bytes)`)
    }
    this.store.setEnabled(partnerId, ids)
    this.changed()
  }

  private checkBoundBudgets(id: string, body: string, binding?: SkillBinding): void {
    const affected: string[] = []
    const partners = new Map(
      this.store.listBoundPartners(id).map((partner) => [partner.id, partner])
    )
    if (binding)
      partners.set(binding.partnerId, {
        id: binding.partnerId,
        name: this.store.partnerName(binding.partnerId)
      })
    for (const partner of partners.values()) {
      const ids =
        binding?.partnerId === partner.id
          ? binding.skillIds
          : this.listEnabled(partner.id).map((skill) => skill.id)
      if (!ids.includes(id)) continue
      const bytes = ids.reduce((sum, skillId) => {
        const skill = skillId === id ? undefined : this.store.get(skillId)
        if (skillId !== id && !skill) throw new Error('Skill not found')
        return sum + Buffer.byteLength(skillId === id ? body : this.read(skill!).body, 'utf8')
      }, 0)
      if (bytes > MAX_USER_SKILL_BODY_BYTES) affected.push(partner.name)
    }
    if (affected.length)
      throw new Error(`Skill instructions exceed 64 KiB for: ${affected.join('、')}`)
  }

  private assertNameAvailable(name: string, existing?: UserSkill): void {
    if (
      this.list().some((item) => item.name === name && item.id !== existing?.id) ||
      (fs.existsSync(path.join(this.root, name)) && name !== existing?.directoryName)
    )
      throw new Error('A skill with this name already exists; no files were overwritten')
  }

  private publish(
    stage: string,
    existing?: UserSkill,
    configure?: { partnerId: string; enabled?: boolean }
  ): UserSkill {
    const parsed = parseSkillMarkdown(
      readRegularFile(path.join(stage, 'SKILL.md')).toString('utf8')
    )
    this.assertNameAvailable(parsed.name, existing)
    const skill: UserSkill = {
      id: existing?.id ?? `user:${randomUUID()}`,
      name: parsed.name,
      description: parsed.description,
      directoryName: parsed.name,
      createdAt: existing?.createdAt ?? Date.now()
    }
    const selection =
      configure?.enabled !== undefined
        ? this.binding(configure.partnerId, skill.id, configure.enabled)
        : undefined
    this.checkBoundBudgets(skill.id, parsed.body, selection)
    const destination = path.join(this.root, skill.directoryName)
    const oldDirectory = existing ? this.directory(existing) : undefined
    const backup = existing ? fs.mkdtempSync(path.join(this.root, '.replace-')) : undefined
    const previous = backup ? path.join(backup, 'skill') : undefined
    let oldMoved = false
    let newMoved = false
    let committed = false
    try {
      if (oldDirectory && previous) {
        fs.renameSync(oldDirectory, previous)
        oldMoved = true
      }
      fs.renameSync(stage, destination)
      newMoved = true
      this.store.transaction(() => {
        if (existing) this.store.update(skill)
        else this.store.insert(skill)
        if (selection) this.store.setEnabled(selection.partnerId, selection.skillIds)
      })
      committed = true
    } catch (error) {
      if (newMoved) fs.renameSync(destination, stage)
      if (oldMoved && previous && oldDirectory) fs.renameSync(previous, oldDirectory)
      throw error
    } finally {
      // Keep the backup if rollback itself failed; never discard the last good copy.
      if (backup && (!previous || !fs.existsSync(previous) || committed))
        fs.rmSync(backup, { recursive: true, force: true })
    }
    this.changed()
    return skill
  }

  public create(draft: UserSkillDraft): UserSkill {
    const content = buildMarkdown(draft)
    this.ensureRoot()
    const stage = fs.mkdtempSync(path.join(this.root, '.import-'))
    try {
      fs.writeFileSync(path.join(stage, 'SKILL.md'), content, { flag: 'wx' })
      return this.publish(stage)
    } finally {
      fs.rmSync(stage, { recursive: true, force: true })
    }
  }

  public update(request: UserSkillUpdateRequest): UserSkill {
    const skill = this.store.get(request?.id)
    if (!skill) throw new Error('Skill not found')
    const content = buildMarkdown(request, this.content(skill))
    const parsed = parseSkillMarkdown(content)
    this.assertNameAvailable(parsed.name, skill)
    this.checkBoundBudgets(skill.id, parsed.body)
    const stage = this.copyFolder(this.directory(skill), false)
    try {
      const filename = path.join(stage, 'SKILL.md')
      const mode = fs.statSync(filename).mode & 0o777
      fs.unlinkSync(filename)
      fs.writeFileSync(filename, content, { flag: 'wx', mode })
      if (process.platform !== 'win32') fs.chmodSync(filename, mode)
      return this.publish(stage, skill)
    } finally {
      fs.rmSync(stage, { recursive: true, force: true })
    }
  }

  private copyFolder(source: string, externalOnly = true): string {
    if (typeof source !== 'string' || !path.isAbsolute(source))
      throw new Error('Choose an absolute skill folder path')
    const sourceRoot = path.resolve(source)
    if (fs.lstatSync(sourceRoot).isSymbolicLink() || !fs.statSync(sourceRoot).isDirectory())
      throw new Error('Select a real skill directory, not a symbolic link')
    const canonicalSource = fs.realpathSync(sourceRoot)
    this.ensureRoot()
    const managedRoot = fs.realpathSync(this.root)
    if (
      managedRoot === canonicalSource ||
      managedRoot.startsWith(canonicalSource + path.sep) ||
      (externalOnly && canonicalSource.startsWith(managedRoot + path.sep))
    )
      throw new Error('Cannot import a folder containing managed skill storage')
    const stage = fs.mkdtempSync(path.join(this.root, '.import-'))
    let count = 0
    let total = 0
    const copyDirectory = (from: string, to: string): void => {
      if (
        fs.lstatSync(from).isSymbolicLink() ||
        (!fs.realpathSync(from).startsWith(canonicalSource + path.sep) && from !== sourceRoot)
      )
        throw new Error('Symbolic links and paths outside the selected folder are not supported')
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (++count > MAX_ENTRIES)
          throw new Error('A skill folder may contain at most 1000 entries')
        const fromPath = path.join(from, entry.name)
        const toPath = path.join(to, entry.name)
        if (entry.isSymbolicLink()) throw new Error('Skill folders cannot contain symbolic links')
        if (entry.isDirectory()) {
          fs.mkdirSync(toPath)
          copyDirectory(fromPath, toPath)
        } else if (entry.isFile()) {
          const instructions = fromPath === path.join(sourceRoot, 'SKILL.md')
          const bytes = readRegularFile(fromPath, instructions ? undefined : MAX_FILE_BYTES)
          if (!instructions) total += bytes.length
          if (total > MAX_DIRECTORY_BYTES)
            throw new Error('A skill folder may contain at most 64 MiB')
          const mode = fs.lstatSync(fromPath).mode & 0o777
          fs.writeFileSync(toPath, bytes, { flag: 'wx', mode })
          if (process.platform !== 'win32') fs.chmodSync(toPath, mode)
        } else throw new Error('Skill folders may contain only regular files and directories')
      }
    }
    try {
      copyDirectory(sourceRoot, stage)
      return stage
    } catch (error) {
      fs.rmSync(stage, { recursive: true, force: true })
      throw error
    }
  }

  public prepareImport(source: string, owner = 0): UserSkillImportPreview {
    for (const [token, item] of this.imports)
      if (item.expiresAt < Date.now()) this.cancelImport(token, item.owner)
    const stage = this.copyFolder(source)
    try {
      const parsed = parseSkillMarkdown(
        readRegularFile(path.join(stage, 'SKILL.md')).toString('utf8')
      )
      const token = randomUUID()
      const resources = this.resources(stage)
      this.imports.set(token, {
        stage,
        owner,
        expiresAt: Date.now() + 15 * 60_000
      })
      return {
        token,
        name: parsed.name,
        description: parsed.description,
        body: parsed.body,
        resources
      }
    } catch (error) {
      fs.rmSync(stage, { recursive: true, force: true })
      throw error
    }
  }

  public commitImport(request: UserSkillImportCommitRequest, owner = 0): UserSkill {
    const pending = this.pendingImport(request?.token, owner)
    const existing = request.replaceId ? this.store.get(request.replaceId) : undefined
    if (request.replaceId && !existing)
      throw new Error('Skill changed during import; select the folder again')
    const filename = path.join(pending.stage, 'SKILL.md')
    const content = buildMarkdown(request, readRegularFile(filename).toString('utf8'))
    const parsed = parseSkillMarkdown(content)
    this.assertNameAvailable(parsed.name, existing)
    if (existing) this.checkBoundBudgets(existing.id, parsed.body)
    const mode = fs.statSync(filename).mode & 0o777
    fs.unlinkSync(filename)
    fs.writeFileSync(filename, content, { flag: 'wx', mode })
    if (process.platform !== 'win32') fs.chmodSync(filename, mode)
    const skill = this.publish(pending.stage, existing)
    this.cancelImport(request.token, owner)
    return skill
  }

  public cancelImport(token: string, owner = 0): void {
    const pending = this.imports.get(token)
    if (!pending || pending.owner !== owner) return
    fs.rmSync(pending.stage, { recursive: true, force: true })
    this.imports.delete(token)
  }

  public cancelImportsForOwner(owner: number): void {
    for (const [token, item] of this.imports)
      if (item.owner === owner) this.cancelImport(token, owner)
  }

  public delete(id: string): void {
    const skill = this.store.get(id)
    if (!skill) throw new Error('Skill not found')
    this.ensureRoot()
    const directory = path.join(this.root, skill.directoryName)
    if (!fs.existsSync(directory)) {
      this.store.delete(id)
      this.changed()
      return
    }
    this.directory(skill)
    const discarded = fs.mkdtempSync(path.join(this.root, '.delete-'))
    const moved = path.join(discarded, 'skill')
    try {
      fs.renameSync(directory, moved)
      try {
        this.store.delete(id)
      } catch (error) {
        fs.renameSync(moved, directory)
        throw error
      }
    } finally {
      if (!this.store.get(id) || !fs.existsSync(moved))
        fs.rmSync(discarded, { recursive: true, force: true })
    }
    this.changed()
  }
}
