import { execFileSync } from 'node:child_process'

const EMBEDDING_RUNTIME_TITLE_PATTERN = /ncurator-emb-(\d+)/

export const countProcessThreads = (pid = process.pid) => {
  if (process.platform === 'darwin') {
    const out = execFileSync('ps', ['-M', '-p', String(pid)], { encoding: 'utf8' })
    return Math.max(0, out.trim().split('\n').length - 1)
  }
  if (process.platform === 'win32') {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).Threads.Count`],
      { encoding: 'utf8' }
    )
    const count = Number(out.trim())
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error(`invalid windows thread count: ${out}`)
    }
    return count
  }
  throw new Error(`unsupported platform: ${process.platform}`)
}

const parseProcessRows = (out, delimiter) =>
  out
    .trim()
    .split('\n')
    .map((line) => {
      if (delimiter === 'tab') {
        const parts = line.split('\t')
        if (parts.length < 3) return null
        const pid = Number(parts[0])
        const ppid = Number(parts[1])
        if (!Number.isInteger(pid) || !Number.isInteger(ppid)) return null
        return { pid, ppid, command: parts.slice(2).join('\t') }
      }
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)
      if (!match) return null
      return { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }
    })
    .filter(Boolean)

export const listProcesses = () => {
  if (process.platform === 'darwin') {
    return parseProcessRows(
      execFileSync('ps', ['-axww', '-o', 'pid=,ppid=,comm=,args='], { encoding: 'utf8' }),
      'space'
    )
  }
  if (process.platform === 'win32') {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_Process | ForEach-Object { '{0}\t{1}\t{2}' -f $_.ProcessId, $_.ParentProcessId, ($_.CommandLine) }"
      ],
      { encoding: 'utf8' }
    )
    return parseProcessRows(out, 'tab')
  }
  throw new Error(`unsupported platform: ${process.platform}`)
}

const childrenByParent = (processes) => {
  const grouped = new Map()
  for (const proc of processes) {
    const siblings = grouped.get(proc.ppid) || []
    siblings.push(proc)
    grouped.set(proc.ppid, siblings)
  }
  return grouped
}

const walkDescendants = (rootPid, processes, visit) => {
  const grouped = childrenByParent(processes)
  const stack = [rootPid]
  const seen = new Set()
  while (stack.length > 0) {
    const current = stack.pop()
    if (seen.has(current)) continue
    seen.add(current)
    for (const child of grouped.get(current) || []) {
      const found = visit(child)
      if (found) return found
      stack.push(child.pid)
    }
  }
  return null
}

export const findDescendantByCommand = (rootPid, needle) => {
  return walkDescendants(rootPid, listProcesses(), (child) =>
    child.command.includes(needle) ? child : null
  )
}

export const parseEmbeddingRuntimeBudgetFromCommand = (command) => {
  const match = String(command || '').match(EMBEDDING_RUNTIME_TITLE_PATTERN)
  if (!match) return null
  const intraOpNumThreads = Number(match[1])
  if (!Number.isInteger(intraOpNumThreads) || intraOpNumThreads <= 0) return null
  return { intraOpNumThreads }
}

export const findEmbeddingRuntimeProcess = (rootPid, excludePid) => {
  const processes = listProcesses()
  const titled = (proc) =>
    proc.pid !== excludePid && EMBEDDING_RUNTIME_TITLE_PATTERN.test(proc.command)
  return (
    walkDescendants(rootPid, processes, (child) => (titled(child) ? child : null)) ||
    processes.find(titled) ||
    null
  )
}

export const summarizeDirectChildren = (rootPid) =>
  listProcesses()
    .filter((proc) => proc.ppid === rootPid)
    .map((proc) => ({ pid: proc.pid, command: proc.command.slice(0, 180) }))
