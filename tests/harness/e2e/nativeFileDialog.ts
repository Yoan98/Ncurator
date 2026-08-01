import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

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
    const escapedPath = filePath.replace(/'/g, "''")
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type -AssemblyName UIAutomationClient',
      'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class NativeFileDialogInput { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo); }\'',
      `$targetPath = '${escapedPath}'`,
      `$targetPid = ${String(electronProcessId || 0)}`,
      '$shell = New-Object -ComObject WScript.Shell',
      "$confirmNames = @('选择附件', '打开', '选择', 'Select Attachments', 'Open', 'Choose')",
      '$desktop = [System.Windows.Automation.AutomationElement]::RootElement',
      '$targetWindow = $null',
      'for ($attempt = 0; $attempt -lt 20 -and -not $targetWindow; $attempt++) { $topWindows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition); $targetWindow = @($topWindows) | Where-Object { [string]$_.Current.ClassName -eq "#32770" } | Where-Object { $controls = $_.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition); [bool](@($controls) | Where-Object { $confirmNames -contains [string]$_.Current.Name } | Select-Object -First 1) } | Select-Object -First 1; if (-not $targetWindow) { Start-Sleep -Milliseconds 200 } }',
      "if (-not $targetWindow) { throw 'failed to locate native file dialog' }",
      '$handle = [IntPtr]$targetWindow.Current.NativeWindowHandle',
      '[void][NativeFileDialogInput]::ShowWindow($handle, 5)',
      '[void][NativeFileDialogInput]::SetForegroundWindow($handle)',
      'Start-Sleep -Milliseconds 300',
      '$windowRect = $targetWindow.Current.BoundingRectangle',
      '$elements = $targetWindow.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
      '$fileNameControl = @($elements) | Where-Object { $rect = $_.Current.BoundingRectangle; $rect.Width -gt 220 -and $rect.Height -ge 20 -and $rect.Height -le 40 -and $rect.Top -gt ($windowRect.Bottom - 130) } | Sort-Object { $_.Current.BoundingRectangle.Top } | Select-Object -First 1',
      '$visibleDetails = @($elements) | ForEach-Object { $rect = $_.Current.BoundingRectangle; if ($rect.Width -gt 0 -and $rect.Height -gt 0) { ([string]$_.Current.ControlType.ProgrammaticName + ":" + [string]$_.Current.Name + "@" + [int]$rect.Left + "," + [int]$rect.Top + "," + [int]$rect.Width + "," + [int]$rect.Height) } } | Where-Object { $_ }',
      "if (-not $fileNameControl) { throw ('failed to locate native file name control; window=' + [int]$windowRect.Left + ',' + [int]$windowRect.Top + ',' + [int]$windowRect.Width + ',' + [int]$windowRect.Height + '; controls=' + ($visibleDetails -join '|')) }",
      '$fileNameRect = $fileNameControl.Current.BoundingRectangle',
      '$fileNameX = [int]($fileNameRect.Left + ($fileNameRect.Width / 2))',
      '$fileNameY = [int]($fileNameRect.Top + ($fileNameRect.Height / 2))',
      '[void][NativeFileDialogInput]::SetCursorPos($fileNameX, $fileNameY)',
      '[NativeFileDialogInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)',
      '[NativeFileDialogInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)',
      '[System.Windows.Forms.Clipboard]::SetText($targetPath)',
      '[System.Windows.Forms.SendKeys]::SendWait("^a")',
      '[System.Windows.Forms.SendKeys]::SendWait("^v")',
      'Start-Sleep -Milliseconds 150',
      '$confirm = @($elements) | Where-Object { $rect = $_.Current.BoundingRectangle; ($confirmNames -contains [string]$_.Current.Name) -and $rect.Top -gt ($windowRect.Bottom - 100) } | Select-Object -First 1',
      'if (-not $confirm) { $bottomActions = @($elements) | Where-Object { $rect = $_.Current.BoundingRectangle; $rect.Width -ge 60 -and $rect.Width -le 220 -and $rect.Height -ge 20 -and $rect.Top -gt ($windowRect.Bottom - 90) } | Sort-Object { $_.Current.BoundingRectangle.Left } -Descending; if ($bottomActions.Count -ge 2) { $confirm = $bottomActions[1] } }',
      "if (-not $confirm) { throw 'failed to locate native file confirmation control' }",
      '$confirmRect = $confirm.Current.BoundingRectangle',
      '$confirmX = [int]($confirmRect.Left + ($confirmRect.Width / 2))',
      '$confirmY = [int]($confirmRect.Top + ($confirmRect.Height / 2))',
      '[void][NativeFileDialogInput]::SetCursorPos($confirmX, $confirmY)',
      '[NativeFileDialogInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)',
      '[NativeFileDialogInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)',
      'Start-Sleep -Milliseconds 300',
      'Write-Output ([string]$fileNameControl.Current.Name + " -> " + [string]$confirm.Current.Name + " -> " + $targetPath)'
    ].join('; ')
    const output = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
      { timeout: 30_000 }
    )
    return `${output.stdout}\n${output.stderr}`.trim()
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
