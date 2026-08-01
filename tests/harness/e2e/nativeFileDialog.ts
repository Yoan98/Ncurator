import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { selectFileInWindowsDialog } from './windowsNativeDialog'

const execFileAsync = promisify(execFile)
const MACOS_FILE_SCRIPT_PATH = path.join(os.tmpdir(), 'ncurator-e2e-select-file.applescript')
const MACOS_FILE_SWIFT_SCRIPT_PATH = path.join(os.tmpdir(), 'ncurator-e2e-select-file.swift')
const MACOS_FILE_SCRIPT = `
on run argv
  set targetPath to item 1 of argv
  set targetPid to (item 2 of argv) as integer
  set beforeFrontmost to ""
  set afterFrontmost to ""
  set targetProcessName to ""
  set targetProcessCount to 0
  set keyStatus to "not-run"
  set clickedConfirmButton to false

  tell application "System Events"
    set beforeFrontmost to name of first application process whose frontmost is true
    repeat 12 times
      set targetProcesses to application processes whose unix id is targetPid
      set targetProcessCount to count of targetProcesses
      if targetProcessCount is greater than 0 then
        set targetProcess to item 1 of targetProcesses
        set targetProcessName to name of targetProcess
        set frontmost of targetProcess to true
        try
          perform action "AXRaise" of window 1 of targetProcess
        end try
        delay 0.05
        if (name of first application process whose frontmost is true) is targetProcessName then
          exit repeat
        end if
      end if
      delay 0.05
    end repeat
    delay 0.1
    set afterFrontmost to name of first application process whose frontmost is true
  end tell

  if targetProcessName is not "" and afterFrontmost is targetProcessName then
    tell application "System Events"
      key code 5 using {command down, shift down}
      delay 0.3
      set the clipboard to targetPath
      key code 9 using {command down}
      delay 0.15
      key code 36
      set keyStatus to "path-sent"
      delay 0.8

      set candidateButtons to {"选择附件", "打开", "选择", "Select Attachments", "Open", "Choose"}
      repeat with candidateButton in candidateButtons
        try
          click button (candidateButton as text) of sheet 1 of window 1 of targetProcess
          set keyStatus to "clicked-" & (candidateButton as text)
          set clickedConfirmButton to true
          exit repeat
        end try
        try
          click button (candidateButton as text) of window 1 of targetProcess
          set keyStatus to "clicked-" & (candidateButton as text)
          set clickedConfirmButton to true
          exit repeat
        end try
      end repeat
      if clickedConfirmButton is false then
        key code 36
        set keyStatus to "return-fallback"
      end if
    end tell
  else
    set keyStatus to "skipped-not-frontmost"
  end if

  return "frontmost-before=" & beforeFrontmost & "; frontmost-after=" & afterFrontmost & "; target-process-name=" & targetProcessName & "; target-process-count=" & targetProcessCount & "; key-status=" & keyStatus
end run
`
const MACOS_FILE_SWIFT_SCRIPT = `
import AppKit
import ApplicationServices
import Foundation

func postKey(_ keyCode: CGKeyCode, _ flags: CGEventFlags = []) {
  let source = CGEventSource(stateID: .hidSystemState)
  guard let keyDown = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
        let keyUp = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) else {
    return
  }
  keyDown.flags = flags
  keyUp.flags = flags
  keyDown.post(tap: .cghidEventTap)
  keyUp.post(tap: .cghidEventTap)
}

let targetPath = CommandLine.arguments[1]
let processId = pid_t(Int32(CommandLine.arguments[2]) ?? 0)
let beforeFrontmost = NSWorkspace.shared.frontmostApplication?.localizedName ?? ""
let targetApp = NSRunningApplication(processIdentifier: processId)
targetApp?.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
Thread.sleep(forTimeInterval: 0.4)

NSPasteboard.general.clearContents()
NSPasteboard.general.setString(targetPath, forType: .string)
postKey(5, [.maskCommand, .maskShift])
Thread.sleep(forTimeInterval: 0.4)
postKey(9, [.maskCommand])
Thread.sleep(forTimeInterval: 0.15)
postKey(36)
Thread.sleep(forTimeInterval: 0.8)
postKey(36)
Thread.sleep(forTimeInterval: 0.2)

let afterFrontmost = NSWorkspace.shared.frontmostApplication?.localizedName ?? ""
let targetName = targetApp?.localizedName ?? "none"
print("frontmost-before=" + beforeFrontmost + "; frontmost-after=" + afterFrontmost + "; target-app=" + targetName)
`

export const selectFileInNativeDialog = async (
  filePath: string,
  electronProcessId: number | null
): Promise<string> => {
  if (process.platform === 'win32') {
    return await selectFileInWindowsDialog(filePath, electronProcessId)
  }
  if (process.platform === 'darwin') {
    if (!electronProcessId) throw new Error('native file dialog requires Electron process id')
    await writeFile(MACOS_FILE_SCRIPT_PATH, MACOS_FILE_SCRIPT, 'utf8')
    const output = await execFileAsync(
      '/usr/bin/osascript',
      [MACOS_FILE_SCRIPT_PATH, filePath, String(electronProcessId)],
      { timeout: 30_000 }
    )
    const appleScriptOutput = `${output.stdout}\n${output.stderr}`.trim()
    if (!appleScriptOutput.includes('skipped-not-frontmost')) return appleScriptOutput

    await writeFile(MACOS_FILE_SWIFT_SCRIPT_PATH, MACOS_FILE_SWIFT_SCRIPT, 'utf8')
    const swiftOutput = await execFileAsync(
      '/usr/bin/swift',
      [MACOS_FILE_SWIFT_SCRIPT_PATH, filePath, String(electronProcessId)],
      { timeout: 30_000 }
    )
    return `${appleScriptOutput}\n${swiftOutput.stdout}\n${swiftOutput.stderr}`.trim()
  }
  throw new Error(`native file dialog automation is unsupported on ${process.platform}`)
}
