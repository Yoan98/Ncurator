import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const selectDirectoryInWindowsDialog = async (
  directoryPath: string,
  electronProcessId?: number | null
): Promise<string> => {
  if (process.platform !== 'win32') {
    throw new Error('Windows native directory dialog automation requires win32')
  }

  const escapedPath = directoryPath.replace(/'/g, "''")
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName UIAutomationClient',
    'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class NativeDialogInput { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo); }\'',
    `$targetPath = '${escapedPath}'`,
    `$targetPid = ${String(electronProcessId || 0)}`,
    "$confirmNames = @('选择此目录', '选择文件夹', 'Select Folder', 'Choose Folder', 'Choose this folder')",
    "$dialogNames = @('选择工作空间目录', 'Select Workspace Directory')",
    '$currentForeground = [System.Windows.Automation.AutomationElement]::FromHandle([NativeDialogInput]::GetForegroundWindow())',
    '$currentElements = $currentForeground.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    '$activated = [bool](@($currentElements) | Where-Object { $confirmNames -contains [string]$_.Current.Name } | Select-Object -First 1)',
    '$desktop = [System.Windows.Automation.AutomationElement]::RootElement',
    '$targetWindow = $null',
    'for ($attempt = 0; $attempt -lt 20 -and -not $targetWindow; $attempt++) { $topWindows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition); $targetWindow = @($topWindows) | Where-Object { $dialogNames -contains [string]$_.Current.Name } | Select-Object -First 1; if (-not $targetWindow -and $targetPid -gt 0) { $targetWindow = @($topWindows) | Where-Object { $_.Current.ProcessId -eq $targetPid -and $_.Current.BoundingRectangle.Width -gt 400 } | Where-Object { $controls = $_.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition); [bool](@($controls) | Where-Object { $confirmNames -contains [string]$_.Current.Name } | Select-Object -First 1) } | Select-Object -First 1 }; if (-not $targetWindow) { Start-Sleep -Milliseconds 200 } }',
    "if (-not $targetWindow) { throw 'failed to locate workspace directory dialog' }",
    '$handle = [IntPtr]$targetWindow.Current.NativeWindowHandle; [void][NativeDialogInput]::ShowWindow($handle, 5); try { $targetWindow.SetFocus(); $activated = $true } catch {}; [void][NativeDialogInput]::SetForegroundWindow($handle)',
    'Start-Sleep -Milliseconds 300',
    '[System.Windows.Forms.Clipboard]::SetText($targetPath)',
    '[System.Windows.Forms.SendKeys]::SendWait("%d")',
    'Start-Sleep -Milliseconds 150',
    '[System.Windows.Forms.SendKeys]::SendWait("^a")',
    '[System.Windows.Forms.SendKeys]::SendWait("^v")',
    '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
    'Start-Sleep -Milliseconds 800',
    '$foreground = [System.Windows.Automation.AutomationElement]::FromHandle([NativeDialogInput]::GetForegroundWindow())',
    '$windowRect = $foreground.Current.BoundingRectangle',
    '$elements = $foreground.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    '$confirm = @($elements) | Where-Object { $confirmNames -contains [string]$_.Current.Name } | Select-Object -First 1',
    'if (-not $confirm) { $bottomActions = @($elements) | Where-Object { $rect = $_.Current.BoundingRectangle; $rect.Width -ge 60 -and $rect.Width -le 220 -and $rect.Height -ge 20 -and $rect.Top -gt ($windowRect.Bottom - 90) } | Sort-Object { $_.Current.BoundingRectangle.Left } -Descending; if ($bottomActions.Count -ge 2) { $confirm = $bottomActions[1] } }',
    "if (-not $confirm) { throw 'failed to locate native directory confirmation control' }",
    '$confirmRect = $confirm.Current.BoundingRectangle',
    '$clickX = [int]($confirmRect.Left + ($confirmRect.Width / 2))',
    '$clickY = [int]($confirmRect.Top + ($confirmRect.Height / 2))',
    '[void][NativeDialogInput]::SetCursorPos($clickX, $clickY)',
    '[NativeDialogInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)',
    '[NativeDialogInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)',
    'Start-Sleep -Milliseconds 300',
    'Write-Output ([string]$confirm.Current.Name + "@" + $clickX + "," + $clickY)'
  ].join('; ')

  const output = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
    { timeout: 30_000 }
  )
  return `${output.stdout}\n${output.stderr}`.trim()
}
