import { spawn, spawnSync } from 'node:child_process'
import { createConnection, createServer } from 'node:net'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isPackageE2EInstallPath } from './package-e2e-isolation.mjs'

const CONFIG_ENV = 'NCURATOR_E2E_DESKTOP_LAUNCH_CONFIG'
const SCRIPT_PATH = fileURLToPath(import.meta.url)
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`
const powershellCommand = (script) => [
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-EncodedCommand',
  Buffer.from(script, 'utf16le').toString('base64')
]

export const resolveMacApplication = (executablePath) => {
  const application = path.dirname(path.dirname(path.dirname(executablePath)))
  if (!application.endsWith('.app') || path.basename(path.dirname(executablePath)) !== 'MacOS') {
    throw new Error(`Expected an installed macOS application: ${executablePath}`)
  }
  return application
}

export const findInstalledWindowsShortcut = (executablePath) => {
  // Read the installer's shortcuts. Do not construct a replacement with a
  // test-selected working directory.
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8
$target = [IO.Path]::GetFullPath($env:NCURATOR_E2E_SHORTCUT_TARGET)
$shell = New-Object -ComObject WScript.Shell
$roots = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory'),
  [Environment]::GetFolderPath('StartMenu'),
  [Environment]::GetFolderPath('CommonStartMenu')
)
foreach ($root in $roots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  foreach ($file in Get-ChildItem -LiteralPath $root -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue) {
    $link = $shell.CreateShortcut($file.FullName)
    if ([string]::Equals($link.TargetPath, $target, [StringComparison]::OrdinalIgnoreCase)) {
      [Console]::WriteLine($file.FullName)
      exit 0
    }
  }
}
throw 'The installer did not create a shortcut targeting the E2E installation'
`
  const result = spawnSync('powershell.exe', powershellCommand(script), {
    env: { ...process.env, NCURATOR_E2E_SHORTCUT_TARGET: executablePath },
    encoding: 'utf8',
    windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim())
  const shortcut = result.stdout.trim()
  if (!shortcut.endsWith('.lnk')) throw new Error('No installed application shortcut was found')
  return shortcut
}

export const terminateDesktopProcess = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    })
    return
  }
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' })
  const rows = String(result.stdout || '')
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/u).map(Number))
  const descendants = [pid]
  for (let index = 0; index < descendants.length; index++) {
    for (const [child, parent] of rows) {
      if (parent === descendants[index] && !descendants.includes(child)) descendants.push(child)
    }
  }
  for (const target of descendants.reverse()) {
    try {
      process.kill(target, 'SIGKILL')
    } catch {
      /* already exited */
    }
  }
}

export const prepareDesktopLaunch = async ({ executablePath, entryPath, env }) => {
  if (!isPackageE2EInstallPath(executablePath)) {
    throw new Error(`Refusing to launch a production installation in E2E: ${executablePath}`)
  }
  const launchEntry =
    entryPath || (process.platform === 'darwin' ? resolveMacApplication(executablePath) : '')
  if (!launchEntry) throw new Error('Missing installer-created desktop launch entry')
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-desktop-launch-'))
  const configPath = path.join(directory, 'launch.json')
  const statePath = path.join(directory, 'state.json')
  const disconnectPath = path.join(directory, 'disconnect-debugger')
  const launcherPath = path.join(directory, process.platform === 'win32' ? 'launch.cmd' : 'launch')
  const environment = { ...env }
  delete environment[CONFIG_ENV]
  delete environment.NODE_OPTIONS
  delete environment.ELECTRON_RUN_AS_NODE
  const config = {
    executablePath,
    entryPath: launchEntry,
    directory,
    statePath,
    disconnectPath,
    environment
  }
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 })
  const command =
    process.platform === 'win32'
      ? `@echo off\r\n"${process.execPath.replaceAll('%', '%%')}" "${SCRIPT_PATH.replaceAll('%', '%%')}" %*\r\n`
      : `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(SCRIPT_PATH)} "$@"\n`
  await writeFile(launcherPath, command, { mode: 0o700 })
  await chmod(launcherPath, 0o700)
  const readState = () => {
    try {
      return JSON.parse(readFileSync(statePath, 'utf8'))
    } catch {
      return null
    }
  }
  return {
    executablePath: launcherPath,
    env: { ...env, [CONFIG_ENV]: configPath },
    readState,
    // Release the observer connection after application shutdown has been
    // requested. The inspector must not keep an otherwise exiting app alive.
    releaseDebugger: () => writeFile(disconnectPath, ''),
    dispose: async () => {
      const state = readState()
      if (state?.pid && !state.exited) terminateDesktopProcess(state.pid)
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }
}

const reservePort = async () => {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to reserve debug port')
  await new Promise((resolve) => server.close(resolve))
  return address.port
}

const MAC_LAUNCH_SCRIPT = String.raw`
ObjC.import('AppKit');
ObjC.import('Foundation');
function run(argv) {
  const data = $.NSData.dataWithContentsOfFile(argv[0]);
  const config = JSON.parse($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js);
  const options = $.NSWorkspaceOpenConfiguration.configuration;
  options.arguments = $(config.arguments);
  options.environment = $(config.environment);
  options.createsNewApplicationInstance = true;
  options.activates = false;
  let completed = false;
  let result;
  $.NSWorkspace.sharedWorkspace.openApplicationAtURLConfigurationCompletionHandler(
    $.NSURL.fileURLWithPath(config.entryPath), options,
    function(application, error) {
      result = error ? {error: ObjC.unwrap(error.localizedDescription)} : {pid: Number(application.processIdentifier)};
      completed = true;
    }
  );
  const deadline = Date.now() + 30000;
  while (!completed && Date.now() < deadline)
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.05));
  if (!completed) throw new Error('Launch Services timed out');
  if (result.error) throw new Error(result.error);
  return JSON.stringify(result);
}
`

const WINDOWS_LAUNCH_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8
$config = Get-Content -LiteralPath $env:NCURATOR_E2E_DESKTOP_LAUNCH_CONFIG -Raw -Encoding UTF8 | ConvertFrom-Json
$shell = New-Object -ComObject WScript.Shell
$original = $shell.CreateShortcut($config.entryPath)
if (-not [string]::Equals($original.TargetPath, $config.executablePath, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Installed shortcut target does not match the E2E executable'
}
if ([string]::IsNullOrWhiteSpace($original.WorkingDirectory)) {
  throw 'Installed shortcut has no explicit working directory; a debug copy cannot preserve its launch context'
}
$copyPath = Join-Path $config.directory 'instrumented.lnk'
Copy-Item -LiteralPath $config.entryPath -Destination $copyPath
$copy = $shell.CreateShortcut($copyPath)
# Keep the installer target and WorkingDirectory. Add the observer debug args
# and declared desktop input profile only to a private shortcut copy.
$arguments = @($config.arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' '
$copy.Arguments = ($original.Arguments + ' ' + $arguments).Trim()
$copy.Save()
$process = Start-Process -FilePath $copyPath -PassThru
if ($null -eq $process) { throw 'Shell did not return the launched application process' }
# Open the process handle before exit so its exit code remains readable.
$null = $process.Handle
[Console]::WriteLine((@{pid=$process.Id; workingDirectory=$original.WorkingDirectory} | ConvertTo-Json -Compress))
$process.WaitForExit()
[Console]::WriteLine((@{event='exit'; exitCode=$process.ExitCode} | ConvertTo-Json -Compress))
`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const readEndpoint = async (port, route) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      signal: AbortSignal.timeout(500)
    })
    if (!response.ok) return null
    const body = await response.json()
    return Array.isArray(body) ? body[0]?.webSocketDebuggerUrl : body.webSocketDebuggerUrl
  } catch {
    return null
  }
}

const inspectIdentity = (endpoint) => {
  // Node's inspector can keep a WebSocket close handshake pending. A short-lived
  // observer guarantees this initial identity connection cannot hold the app open.
  const script = `
    const socket = new WebSocket(process.argv[1]);
    setTimeout(() => process.exit(1), 3000);
    socket.addEventListener('error', () => process.exit(1));
    socket.addEventListener('open', () => socket.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate', params: {
        expression: 'JSON.stringify({pid:process.pid,executablePath:process.execPath,userDataPath:process.env.NCURATOR_USER_DATA_PATH})',
        returnByValue: true
      }
    })));
    socket.addEventListener('message', message => {
      const response = JSON.parse(String(message.data));
      if (response.id !== 1) return;
      const value = response.result?.result?.value;
      if (!value || response.error) process.exit(1);
      process.stdout.write(value, () => process.exit(0));
    });
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, endpoint], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true
  })
  if (result.error || result.status !== 0) throw new Error('Inspector identity unavailable')
  return JSON.parse(result.stdout)
}

const isPortClosed = (port) =>
  new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(1000)
    socket.once('connect', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', (error) => resolve(error.code === 'ECONNREFUSED'))
  })

const runDesktopLaunch = async () => {
  const configPath = process.env[CONFIG_ENV]
  if (!configPath) throw new Error('Missing desktop launch configuration')
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  const [nodePort, browserPort] = await Promise.all([reservePort(), reservePort()])
  config.arguments = process.argv.slice(2).map((argument) => {
    if (argument === '--inspect=0') return `--inspect=127.0.0.1:${nodePort}`
    if (argument === '--remote-debugging-port=0') return `--remote-debugging-port=${browserPort}`
    return argument
  })
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 })
  let state = {
    method: process.platform === 'darwin' ? 'launch-services' : 'installed-shortcut',
    entryPath: config.entryPath,
    executablePath: config.executablePath,
    pid: null,
    exitCode: null,
    exited: false
  }
  const saveState = () => writeFileSync(config.statePath, JSON.stringify(state), { mode: 0o600 })
  saveState()
  let launcher
  if (process.platform === 'darwin') {
    const scriptPath = path.join(config.directory, 'launch.js')
    await writeFile(scriptPath, MAC_LAUNCH_SCRIPT)
    launcher = spawn('/usr/bin/osascript', ['-l', 'JavaScript', scriptPath, configPath], {
      env: config.environment,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } else if (process.platform === 'win32') {
    launcher = spawn('powershell.exe', powershellCommand(WINDOWS_LAUNCH_SCRIPT), {
      env: { ...config.environment, [CONFIG_ENV]: configPath },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
  } else {
    throw new Error('Desktop package E2E requires macOS or Windows')
  }
  let launchError = ''
  let launcherStderr = ''
  let stdout = ''
  launcher.stderr.on('data', (data) => {
    launcherStderr += String(data)
    process.stderr.write(data)
  })
  launcher.stdout.on('data', (data) => {
    stdout += String(data)
    const lines = stdout.split(/\r?\n/u)
    stdout = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (event.pid) state = { ...state, ...event }
        if (event.event === 'exit') state.exitCode = event.exitCode
        saveState()
      } catch {
        process.stderr.write(`${line}\n`)
      }
    }
  })
  launcher.on('error', (error) => {
    launchError = error.message
  })
  launcher.on('close', (code) => {
    if (stdout.trim()) {
      try {
        const event = JSON.parse(stdout)
        if (event.pid) state = { ...state, ...event }
        saveState()
      } catch {
        process.stderr.write(`${stdout}\n`)
      }
    }
    if (code !== 0) {
      launchError ||= launcherStderr || `Desktop launcher exited with code ${String(code)}`
      process.exitCode = 1
    }
  })
  const cleanup = () => {
    terminateDesktopProcess(state.pid)
    launcher.kill()
  }
  process.once('SIGTERM', () => {
    cleanup()
    process.exit(1)
  })
  process.once('SIGINT', () => {
    cleanup()
    process.exit(1)
  })
  try {
    const deadline = Date.now() + 90_000
    let nodeReady = false
    let browserReady = false
    while (!state.pid || !nodeReady || !browserReady) {
      if (launchError) throw new Error(launchError)
      if (Date.now() > deadline) throw new Error('Desktop application debug connection timed out')
      if (!nodeReady) {
        const endpoint = await readEndpoint(nodePort, '/json/list')
        if (endpoint) {
          const identity = inspectIdentity(endpoint)
          if (
            path.resolve(identity.executablePath).toLowerCase() !==
              path.resolve(config.executablePath).toLowerCase() ||
            identity.userDataPath !== config.environment.NCURATOR_USER_DATA_PATH ||
            (state.pid && state.pid !== identity.pid)
          ) {
            throw new Error('Desktop launcher connected to an unexpected application process')
          }
          state.pid = identity.pid
          saveState()
          process.stderr.write(`Debugger listening on ${endpoint}\n`)
          nodeReady = true
        }
      }
      if (!browserReady) {
        const endpoint = await readEndpoint(browserPort, '/json/version')
        if (endpoint) {
          process.stderr.write(`DevTools listening on ${endpoint}\n`)
          browserReady = true
        }
      }
      await sleep(100)
    }
    // Playwright keeps its normal Electron API while connecting to the actual
    // desktop-launched app. This process only relays connection/lifecycle data.
    let disconnected = false
    while (true) {
      try {
        process.kill(state.pid, 0)
      } catch {
        break
      }
      // Launch Services owns the process. A terminated app may remain as a
      // zombie briefly; kill(pid, 0) alone still reports that PID as present.
      if (disconnected && process.platform === 'darwin') {
        const status = spawnSync('/bin/ps', ['-p', String(state.pid), '-o', 'stat='], {
          encoding: 'utf8'
        })
        if (status.status !== 0 || status.stdout.trim().startsWith('Z')) break
      }
      if (
        !disconnected &&
        (existsSync(config.disconnectPath) || (await isPortClosed(browserPort)))
      ) {
        process.stderr.write('Waiting for the debugger to disconnect...\n')
        disconnected = true
      }
      await sleep(250)
    }
    state.exited = true
    saveState()
    if (state.exitCode !== null && state.exitCode !== 0) process.exitCode = 1
  } catch (error) {
    cleanup()
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runDesktopLaunch().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
