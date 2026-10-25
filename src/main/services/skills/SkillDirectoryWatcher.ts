import fs, { type FSWatcher } from 'node:fs'
import path from 'node:path'

/** Notifications are hints; all reads still use current files. Ignore app staging directories. */
export function watchSkillDirectory(root: string, onChange: () => void): () => void {
  let timer: NodeJS.Timeout | undefined
  let rootWatcher: FSWatcher | undefined
  let rootIdentity = ''
  let disposed = false
  const fingerprint = (): string => {
    const entries: string[] = []
    let count = 0
    const walk = (folder: string, relative = ''): void => {
      for (const name of fs.readdirSync(folder).sort()) {
        if (!relative && name.startsWith('.')) continue
        if (++count > 1000 * 1000) return
        const file = path.join(folder, name)
        const label = relative + name
        const stat = fs.lstatSync(file)
        entries.push([label, stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino, stat.mode].join(':'))
        if (stat.isDirectory() && !stat.isSymbolicLink()) walk(file, label + '/')
      }
    }
    try {
      if (!fs.lstatSync(root).isSymbolicLink()) walk(root)
    } catch {
      entries.push('unavailable')
    }
    return entries.join('\n')
  }
  let previous = fingerprint()
  const observeRoot = (): void => {
    let identity = ''
    try {
      const stat = fs.lstatSync(root)
      if (stat.isDirectory() && !stat.isSymbolicLink()) identity = `${stat.dev}:${stat.ino}`
    } catch {
      /* Root can temporarily disappear during an external replacement. */
    }
    if (identity === rootIdentity) return
    rootWatcher?.close()
    rootWatcher = undefined
    rootIdentity = identity
    if (identity) {
      rootWatcher = fs.watch(root, { recursive: true, persistent: false }, (_event, filename) => {
        if (!filename || !String(filename).split(path.sep)[0].startsWith('.')) schedule()
      })
      rootWatcher.on('error', () => {
        rootWatcher?.close()
        rootWatcher = undefined
        rootIdentity = ''
      })
      // Some native watchers start asynchronously; recheck once after each subscription.
      schedule()
    }
  }
  function schedule(): void {
    if (disposed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      observeRoot()
      const next = fingerprint()
      if (next === previous) return
      previous = next
      onChange()
    }, 250)
    timer.unref()
  }
  const parent = fs.watch(path.dirname(root), { persistent: false }, (_event, filename) => {
    if (!filename || String(filename) === path.basename(root)) schedule()
  })
  parent.on('error', () => parent.close())
  observeRoot()
  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
    rootWatcher?.close()
    parent.close()
  }
}
