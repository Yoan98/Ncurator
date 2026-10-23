import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseDocument, isMap } from 'yaml'
import type { UserSkill } from '../../../shared/userSkills'
import { getUserDataPath } from '../../utils/userDataPath'
import type { UserSkillStore } from '../storage/domains/UserSkillStore'

export const MAX_SKILL_MARKDOWN_BYTES = 32 * 1024
const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024
const MAX_ENTRIES = 1000
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Keep original SKILL.md bytes on disk, including all unrecognized frontmatter. */
export const parseSkillMarkdown = (
  content: string
): { name: string; description: string; body: string } => {
  if (
    typeof content !== 'string' ||
    Buffer.byteLength(content, 'utf8') > MAX_SKILL_MARKDOWN_BYTES
  ) {
    throw new Error('SKILL.md must be at most 32 KiB')
  }
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

const readRegularFile = (filename: string, limit: number): Buffer => {
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

export class UserSkillService {
  private readonly root: string

  public constructor(
    private readonly store: UserSkillStore,
    root = path.join(getUserDataPath(), 'skills')
  ) {
    this.root = path.resolve(root)
  }

  private ensureRoot(): void {
    fs.mkdirSync(this.root, { recursive: true })
    if (fs.lstatSync(this.root).isSymbolicLink())
      throw new Error('Skills directory cannot be a symbolic link')
  }

  private directory(skill: UserSkill): string {
    if (!SKILL_NAME.test(skill.directoryName) || skill.directoryName !== skill.name) {
      throw new Error('Invalid stored skill directory')
    }
    const directory = path.join(this.root, skill.directoryName)
    if (fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory()) {
      throw new Error('Skill directory must be a real directory')
    }
    if (fs.realpathSync(directory) !== path.join(fs.realpathSync(this.root), skill.directoryName)) {
      throw new Error('Skill directory is outside managed storage')
    }
    return directory
  }

  public list(): UserSkill[] {
    return this.store.list()
  }

  public listEnabled(partnerId: string): UserSkill[] {
    return this.store.listEnabled(partnerId)
  }

  public setEnabled(partnerId: string, skillIds: string[]): void {
    if (
      typeof partnerId !== 'string' ||
      !partnerId ||
      !Array.isArray(skillIds) ||
      skillIds.length > 1000 ||
      skillIds.some((id) => typeof id !== 'string')
    ) {
      throw new Error('Invalid partner skill selection')
    }
    const alreadyEnabled = new Set(this.store.listEnabled(partnerId).map((skill) => skill.id))
    skillIds.forEach((id) => {
      const skill = this.store.get(id)
      if (!skill) throw new Error('Skill not found')
      if (!alreadyEnabled.has(id)) this.read(skill)
    })
    this.store.setEnabled(partnerId, skillIds)
  }

  private read(skill: UserSkill): { skill: UserSkill; body: string; resourceBase: string } {
    this.ensureRoot()
    const resourceBase = this.directory(skill)
    const content = readRegularFile(
      path.join(resourceBase, 'SKILL.md'),
      MAX_SKILL_MARKDOWN_BYTES
    ).toString('utf8')
    const parsed = parseSkillMarkdown(content)
    if (parsed.name !== skill.name || parsed.description !== skill.description) {
      throw new Error('Skill metadata changed; import the updated folder again')
    }
    return { skill, body: parsed.body, resourceBase }
  }

  public loadEnabled(
    partnerId: string,
    id: string
  ): { skill: UserSkill; body: string; resourceBase: string } {
    const skill = this.listEnabled(partnerId).find((item) => item.id === id)
    if (!skill) throw new Error('Skill is not enabled for this partner')
    return this.read(skill)
  }

  private publish(stage: string): UserSkill {
    const parsed = parseSkillMarkdown(
      readRegularFile(path.join(stage, 'SKILL.md'), MAX_SKILL_MARKDOWN_BYTES).toString('utf8')
    )
    const skill: UserSkill = {
      id: `user:${randomUUID()}`,
      name: parsed.name,
      description: parsed.description,
      directoryName: parsed.name,
      createdAt: Date.now()
    }
    const destination = path.join(this.root, skill.directoryName)
    if (this.store.list().some((item) => item.name === skill.name) || fs.existsSync(destination)) {
      throw new Error('A skill with this name already exists; no files were overwritten')
    }
    fs.renameSync(stage, destination)
    try {
      this.store.insert(skill)
    } catch (error) {
      fs.renameSync(destination, stage)
      throw error
    }
    return skill
  }

  public create(content: string): UserSkill {
    parseSkillMarkdown(content)
    this.ensureRoot()
    const stage = fs.mkdtempSync(path.join(this.root, '.import-'))
    try {
      fs.writeFileSync(path.join(stage, 'SKILL.md'), content, { flag: 'wx' })
      return this.publish(stage)
    } finally {
      fs.rmSync(stage, { recursive: true, force: true })
    }
  }

  /** Copies only the selected folder, never discovers accounts or scans the home directory. */
  public importFolder(source: string): UserSkill {
    if (typeof source !== 'string' || !path.isAbsolute(source))
      throw new Error('Choose an absolute skill folder path')
    const sourceRoot = path.resolve(source)
    if (fs.lstatSync(sourceRoot).isSymbolicLink() || !fs.statSync(sourceRoot).isDirectory()) {
      throw new Error('Select a real skill directory, not a symbolic link')
    }
    const canonicalSource = fs.realpathSync(sourceRoot)
    this.ensureRoot()
    const managedRoot = fs.realpathSync(this.root)
    if (managedRoot === canonicalSource || managedRoot.startsWith(canonicalSource + path.sep)) {
      throw new Error('Cannot import a folder containing managed skill storage')
    }
    const stage = fs.mkdtempSync(path.join(this.root, '.import-'))
    let count = 0
    let total = 0
    const copyDirectory = (from: string, to: string): void => {
      if (
        fs.lstatSync(from).isSymbolicLink() ||
        (!fs.realpathSync(from).startsWith(canonicalSource + path.sep) && from !== sourceRoot)
      ) {
        throw new Error('Symbolic links and paths outside the selected folder are not supported')
      }
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
          const bytes = readRegularFile(fromPath, MAX_FILE_BYTES)
          total += bytes.length
          if (total > MAX_DIRECTORY_BYTES)
            throw new Error('A skill folder may contain at most 64 MiB')
          fs.writeFileSync(toPath, bytes, { flag: 'wx' })
        } else {
          throw new Error('Skill folders may contain only regular files and directories')
        }
      }
    }
    try {
      copyDirectory(sourceRoot, stage)
      return this.publish(stage)
    } finally {
      fs.rmSync(stage, { recursive: true, force: true })
    }
  }

  public delete(id: string): void {
    const skill = this.store.get(id)
    if (!skill) throw new Error('Skill not found')
    this.ensureRoot()
    const directory = path.join(this.root, skill.directoryName)
    // A missing folder must not make a broken asset impossible to remove from the catalog.
    if (!fs.existsSync(directory)) {
      this.store.delete(id)
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
      // Preserve staged bytes if a failed database mutation could not be rolled back.
      if (!this.store.get(id) || !fs.existsSync(moved))
        fs.rmSync(discarded, { recursive: true, force: true })
    }
  }
}
