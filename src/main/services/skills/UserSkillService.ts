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
import type { PartnerSkillStore } from '../storage/domains/PartnerSkillStore'
import { watchSkillDirectory } from './SkillDirectoryWatcher'

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
    // Node 22 on Windows may omit dev in path stats while fstat reports the volume ID.
    const changedDevice = before.dev !== 0 && stat.dev !== before.dev
    if (!stat.isFile() || stat.size > limit || changedDevice || stat.ino !== before.ino)
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

export type SkillStatus = { name: string; enabled: boolean }

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

export const getSkillRootDirectory = (): string => path.join(getUserDataPath(), 'skills')

export class UserSkillService {
  private readonly root: string
  private readonly imports = new Map<string, PendingImport>()
  private stopWatching?: () => void
  private notificationPending = false

  public constructor(
    private readonly store: PartnerSkillStore,
    root = getSkillRootDirectory(),
    private readonly onChanged: () => void = () => undefined
  ) {
    this.root = path.resolve(root)
  }

  private ensureRoot(): void {
    fs.mkdirSync(this.root, { recursive: true })
    if (fs.lstatSync(this.root).isSymbolicLink())
      throw new Error('Skills directory cannot be a symbolic link')
  }

  private assertName(name: string): void {
    if (
      typeof name !== 'string' ||
      !SKILL_NAME.test(name) ||
      name.length > 64 ||
      RESERVED_NAME.test(name)
    )
      throw new Error('Invalid skill name')
  }

  private directory(name: string): string {
    this.assertName(name)
    if (!fs.existsSync(this.root)) throw new Error('Skill not found')
    if (fs.lstatSync(this.root).isSymbolicLink())
      throw new Error('Skills directory cannot be a symbolic link')
    const directory = path.join(this.root, name)
    if (!fs.existsSync(directory)) throw new Error('Skill not found')
    if (fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory())
      throw new Error('Skill directory must be a real directory')
    if (fs.realpathSync(directory) !== path.join(fs.realpathSync(this.root), name))
      throw new Error('Skill directory is outside managed storage')
    return directory
  }

  private content(name: string): string {
    return readRegularFile(path.join(this.directory(name), 'SKILL.md')).toString('utf8')
  }

  public startWatching(): void {
    if (this.stopWatching) return
    this.ensureRoot()
    this.stopWatching = watchSkillDirectory(this.root, () => this.changed())
  }

  public dispose(): void {
    this.stopWatching?.()
    this.stopWatching = undefined
  }

  public getRootDirectory(): string {
    return this.root
  }

  public listOptions(): UserSkillOption[] {
    if (!fs.existsSync(this.root)) return []
    if (fs.lstatSync(this.root).isSymbolicLink())
      throw new Error('Skills directory cannot be a symbolic link')
    return fs
      .readdirSync(this.root, { withFileTypes: true })
      .filter(
        (entry) => !entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink())
      )
      .map((entry): UserSkillOption => {
        try {
          const document = this.getDocument(entry.name)
          return {
            name: document.name,
            description: document.description,
            bodyBytes: Buffer.byteLength(document.body, 'utf8')
          }
        } catch (error) {
          return {
            name: entry.name,
            description: '',
            bodyBytes: null,
            error: error instanceof Error ? error.message : String(error)
          }
        }
      })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  public list(): UserSkill[] {
    return this.listOptions()
      .filter((item) => item.bodyBytes !== null)
      .map(({ name, description }) => ({ name, description }))
  }

  public listEnabled(partnerId: string): UserSkill[] {
    const options = new Map(this.list().map((skill) => [skill.name, skill]))
    return this.store
      .listEnabled(partnerId)
      .map((name) => options.get(name) ?? { name, description: '' })
  }

  public getDocument(name: string): UserSkillDocument {
    const directory = this.directory(name)
    const parsed = this.inspectDirectory(directory)
    if (parsed.name !== name) throw new Error('Skill directory name must match SKILL.md name')
    return { ...parsed, resources: this.resources(directory) }
  }

  private changed(): void {
    if (this.notificationPending) return
    this.notificationPending = true
    queueMicrotask(() => {
      this.notificationPending = false
      try {
        this.onChanged()
      } catch (error) {
        console.error('[APP-ERROR] Skill change notification failed', error)
      }
    })
  }

  public statusForPartner(partnerId: string): SkillStatus[] {
    this.store.partnerName(partnerId)
    const enabled = new Set(this.store.listEnabled(partnerId))
    return [...new Set([...this.listOptions().map((skill) => skill.name), ...enabled])]
      .sort()
      .map((name) => ({ name, enabled: enabled.has(name) }))
  }

  public configureForPartner(partnerId: string, skills: SkillStatus[]): void {
    if (skills.length === 0 || skills.length > 1000)
      throw new Error('Provide between 1 and 1000 Skill changes')
    const changedNames = new Set<string>()
    for (const skill of skills) {
      this.assertName(skill.name)
      if (changedNames.has(skill.name)) throw new Error(`Duplicate Skill name: ${skill.name}`)
      changedNames.add(skill.name)
    }
    this.store.transaction(() => {
      this.store.partnerName(partnerId)
      const names = new Set(this.store.listEnabled(partnerId))
      const available = new Set(this.listOptions().map((skill) => skill.name))
      for (const { name, enabled } of skills) {
        if (enabled) names.add(name)
        else {
          if (!names.has(name) && !available.has(name)) throw new Error(`Skill not found: ${name}`)
          names.delete(name)
        }
      }
      const selection = [...names]
      if (selection.length > 1000) throw new Error('Invalid partner skill selection')
      // Validate the final selection once; disabling broken assets must remain possible.
      if (skills.some((skill) => skill.enabled)) this.validateSelectionBudget(selection)
      this.store.setEnabled(partnerId, selection)
    })
    this.changed()
  }

  private inspectDirectory(directory: string): ReturnType<typeof parseSkillMarkdown> {
    let entries = 0
    let resourceBytes = 0
    const walk = (folder: string): void => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (++entries > MAX_ENTRIES)
          throw new Error('A skill folder may contain at most 1000 entries')
        const filename = path.join(folder, entry.name)
        const stat = fs.lstatSync(filename)
        if (stat.isSymbolicLink()) throw new Error('Skill folders cannot contain symbolic links')
        if (stat.isDirectory()) walk(filename)
        else if (stat.isFile()) {
          if (process.platform !== 'win32' && stat.mode & 0o7000)
            throw new Error('Skill files cannot have special permission bits')
          if (filename !== path.join(directory, 'SKILL.md')) {
            if (stat.size > MAX_FILE_BYTES) throw new Error('Skill resource exceeds the size limit')
            resourceBytes += stat.size
            if (resourceBytes > MAX_DIRECTORY_BYTES)
              throw new Error('A skill folder may contain at most 64 MiB')
          }
        } else throw new Error('Skill folders may contain only regular files and directories')
      }
    }
    walk(directory)
    return parseSkillMarkdown(readRegularFile(path.join(directory, 'SKILL.md')).toString('utf8'))
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
    return this.directory(source.name)
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

  public loadEnabled(
    partnerId: string,
    name: string
  ): { skill: UserSkill; body: string; resourceBase: string } {
    if (!this.store.listEnabled(partnerId).includes(name)) throw new Error('Skill is not enabled')
    const document = this.getDocument(name)
    return {
      skill: { name, description: document.description },
      body: document.body,
      resourceBase: this.directory(name)
    }
  }

  public getSelection(partnerId: string): UserSkillSelection {
    const skillNames = this.store.listEnabled(partnerId)
    let bodyBytes = 0
    const unavailableSkillNames: string[] = []
    for (const name of skillNames) {
      try {
        bodyBytes += Buffer.byteLength(this.getDocument(name).body, 'utf8')
      } catch {
        unavailableSkillNames.push(name)
      }
    }
    return { skillNames, bodyBytes, maxBodyBytes: MAX_USER_SKILL_BODY_BYTES, unavailableSkillNames }
  }

  public setEnabled(partnerId: string, skillNames: string[]): void {
    if (!Array.isArray(skillNames) || skillNames.length > 1000)
      throw new Error('Invalid partner skill selection')
    const names = [...new Set(skillNames)]
    names.forEach((name) => this.assertName(name))
    this.store.partnerName(partnerId)
    const previous = new Set(this.store.listEnabled(partnerId))
    // Removing broken choices must not depend on any retained files being readable.
    const removesOnly = names.length < previous.size && names.every((name) => previous.has(name))
    if (!removesOnly) this.validateSelectionBudget(names)
    this.store.setEnabled(partnerId, names)
    this.changed()
  }

  private validateSelectionBudget(names: string[]): void {
    const bytes = names.reduce(
      (sum, name) => sum + Buffer.byteLength(this.getDocument(name).body, 'utf8'),
      0
    )
    if (bytes > MAX_USER_SKILL_BODY_BYTES)
      throw new Error(`Skill instructions exceed 64 KiB (${bytes} bytes)`)
  }

  private checkBoundBudgets(name: string, body: string, finalName = name): void {
    const affected: string[] = []
    const partners = new Map(
      [...this.store.listBoundPartners(name), ...this.store.listBoundPartners(finalName)].map(
        (partner) => [partner.id, partner]
      )
    )
    for (const partner of partners.values()) {
      const names = new Set(
        this.store.listEnabled(partner.id).map((item) => (item === name ? finalName : item))
      )
      const bytes = [...names].reduce(
        (sum, item) =>
          sum + Buffer.byteLength(item === finalName ? body : this.getDocument(item).body, 'utf8'),
        0
      )
      if (bytes > MAX_USER_SKILL_BODY_BYTES) affected.push(partner.name)
    }
    if (affected.length)
      throw new Error(`Skill instructions exceed 64 KiB for: ${affected.join('、')}`)
  }

  private assertNameAvailable(name: string, existingName?: string): void {
    if (name !== existingName && fs.existsSync(path.join(this.root, name)))
      throw new Error('A skill with this name already exists; no files were overwritten')
  }

  private publish(stage: string, existingName?: string): UserSkill {
    const parsed = this.inspectDirectory(stage)
    this.assertNameAvailable(parsed.name, existingName)
    this.checkBoundBudgets(existingName ?? parsed.name, parsed.body, parsed.name)
    const destination = path.join(this.root, parsed.name)
    const oldDirectory = existingName ? this.directory(existingName) : undefined
    const backup = existingName ? fs.mkdtempSync(path.join(this.root, '.replace-')) : undefined
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
      if (existingName) this.store.transaction(() => this.store.rename(existingName, parsed.name))
      committed = true
    } catch (error) {
      if (newMoved) fs.renameSync(destination, stage)
      if (oldMoved && previous && oldDirectory) fs.renameSync(previous, oldDirectory)
      throw error
    } finally {
      if (backup && (!previous || !fs.existsSync(previous) || committed))
        fs.rmSync(backup, { recursive: true, force: true })
    }
    this.changed()
    return { name: parsed.name, description: parsed.description }
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
    const name = request.originalName
    const content = buildMarkdown(request, this.content(name))
    const parsed = parseSkillMarkdown(content)
    this.assertNameAvailable(parsed.name, name)
    this.checkBoundBudgets(name, parsed.body, parsed.name)
    const stage = this.copyFolder(this.directory(name), false)
    try {
      const filename = path.join(stage, 'SKILL.md')
      const mode = fs.statSync(filename).mode & 0o777
      fs.unlinkSync(filename)
      fs.writeFileSync(filename, content, { flag: 'wx', mode })
      if (process.platform !== 'win32') fs.chmodSync(filename, mode)
      return this.publish(stage, name)
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
    const existing = request.replaceName ?? undefined
    if (existing) this.directory(existing)
    const filename = path.join(pending.stage, 'SKILL.md')
    const content = buildMarkdown(request, readRegularFile(filename).toString('utf8'))
    const parsed = parseSkillMarkdown(content)
    this.assertNameAvailable(parsed.name, existing)
    if (existing) this.checkBoundBudgets(existing, parsed.body, parsed.name)
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

  public delete(name: string): void {
    this.assertName(name)
    const directory = path.join(this.root, name)
    if (!fs.existsSync(directory)) {
      this.store.delete(name)
      this.changed()
      return
    }
    this.directory(name)
    const discarded = fs.mkdtempSync(path.join(this.root, '.delete-'))
    const moved = path.join(discarded, 'skill')
    let committed = false
    try {
      fs.renameSync(directory, moved)
      try {
        this.store.transaction(() => this.store.delete(name))
        committed = true
      } catch (error) {
        fs.renameSync(moved, directory)
        throw error
      }
    } finally {
      if (committed || !fs.existsSync(moved)) fs.rmSync(discarded, { recursive: true, force: true })
    }
    this.changed()
  }
}
