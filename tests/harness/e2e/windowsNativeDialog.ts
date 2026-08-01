import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

type WindowsCommonDialogKind = 'directory' | 'file'

const selectPathInWindowsCommonDialog = async (
  targetPath: string,
  kind: WindowsCommonDialogKind,
  electronProcessId?: number | null
): Promise<string> => {
  if (process.platform !== 'win32') {
    throw new Error('Windows native dialog automation requires win32')
  }

  const escapedPath = targetPath.replace(/'/g, "''")
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName UIAutomationClient',
    'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class NativeDialogWindow { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle); }\'',
    `$targetPath = '${escapedPath}'`,
    `$mode = '${kind}'`,
    `$targetPid = ${String(electronProcessId || 0)}`,
    '$desktop = [System.Windows.Automation.AutomationElement]::RootElement',
    '$trueCondition = [System.Windows.Automation.Condition]::TrueCondition',
    '$buttonType = [System.Windows.Automation.ControlType]::Button',
    '$editType = [System.Windows.Automation.ControlType]::Edit',
    '$windowType = [System.Windows.Automation.ControlType]::Window',
    '$cancelNames = @(\'Cancel\', \'取消\', \'关闭\', \'Close\')',
    'function Get-DialogCandidate { $foregroundHandle = [NativeDialogWindow]::GetForegroundWindow(); $windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $trueCondition); $candidates = foreach ($window in @($windows)) { $current = $window.Current; $bounds = $current.BoundingRectangle; if ($current.ControlType -ne $windowType -or [string]$current.ClassName -ne \'#32770\' -or $bounds.Width -lt 300 -or $bounds.Height -lt 180) { continue }; $controls = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $trueCondition); $buttons = @($controls | Where-Object { $_.Current.ControlType -eq $buttonType -and $_.Current.BoundingRectangle.Width -gt 0 -and $_.Current.BoundingRectangle.Height -gt 0 }); if ($buttons.Count -lt 2) { continue }; $edits = @($controls | Where-Object { $_.Current.ControlType -eq $editType -and $_.Current.BoundingRectangle.Width -gt 0 -and $_.Current.BoundingRectangle.Height -gt 0 }); if ($mode -eq \'file\' -and $edits.Count -eq 0) { continue }; [PSCustomObject]@{ Element = $window; Controls = $controls; IsForeground = ([IntPtr]$current.NativeWindowHandle -eq $foregroundHandle); Handle = [Int64]$current.NativeWindowHandle; Name = [string]$current.Name } }; return @($candidates | Sort-Object @{ Expression = { if ($_.IsForeground) { 0 } else { 1 } } }, @{ Expression = { $_.Handle }; Descending = $true } | Select-Object -First 1) }',
    '$dialog = $null; for ($attempt = 0; $attempt -lt 50 -and -not $dialog; $attempt++) { $dialog = Get-DialogCandidate; if (-not $dialog) { Start-Sleep -Milliseconds 200 } }',
    'if (-not $dialog) { $top = @($desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $trueCondition) | ForEach-Object { $current = $_.Current; $bounds = $current.BoundingRectangle; if ($bounds.Width -gt 0 -and $bounds.Height -gt 0) { ([string]$current.ClassName + \'|\' + [string]$current.Name + \'|pid=\' + [string]$current.ProcessId + \'|\' + [int]$bounds.Width + \'x\' + [int]$bounds.Height) } } | Where-Object { $_ }) -join \' || \'; throw (\'failed to locate Windows common dialog; electronPid=\' + $targetPid + \'; windows=\' + $top) }',
    '$dialogElement = $dialog.Element; $dialogHandle = [IntPtr]$dialog.Handle; [void][NativeDialogWindow]::SetForegroundWindow($dialogHandle); try { $dialogElement.SetFocus() } catch {}',
    '$controls = $dialog.Controls',
    'if ($mode -eq \'file\') { $fileNameControl = @($controls | Where-Object { $_.Current.ControlType -eq $editType -and [string]$_.Current.AutomationId -eq \'1148\' } | Select-Object -First 1); if (-not $fileNameControl) { $fileNameControl = @($controls | Where-Object { $bounds = $_.Current.BoundingRectangle; $_.Current.ControlType -eq $editType -and $bounds.Width -gt 220 -and $bounds.Height -ge 20 -and $bounds.Height -le 48 -and $bounds.Top -gt ($dialogElement.Current.BoundingRectangle.Bottom - 150) } | Sort-Object { $_.Current.BoundingRectangle.Top } | Select-Object -First 1) }; if (-not $fileNameControl) { throw (\'failed to locate Windows file-name input; dialog=\' + $dialog.Name + \'; handle=\' + $dialog.Handle) }; try { $valuePattern = [System.Windows.Automation.ValuePattern]$fileNameControl.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $valuePattern.SetValue($targetPath) } catch { throw (\'failed to set Windows file-name input: \' + $_.Exception.Message) } } else { [System.Windows.Forms.Clipboard]::SetText($targetPath); [System.Windows.Forms.SendKeys]::SendWait(\'%d\'); Start-Sleep -Milliseconds 150; [System.Windows.Forms.SendKeys]::SendWait(\'^a\'); [System.Windows.Forms.SendKeys]::SendWait(\'^v\'); [System.Windows.Forms.SendKeys]::SendWait(\'{ENTER}\'); Start-Sleep -Milliseconds 600; $controls = $dialogElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $trueCondition) }',
    '$dialogBounds = $dialogElement.Current.BoundingRectangle; $bottomButtons = @($controls | Where-Object { $bounds = $_.Current.BoundingRectangle; $_.Current.ControlType -eq $buttonType -and $bounds.Width -ge 60 -and $bounds.Height -ge 20 -and $bounds.Top -gt ($dialogBounds.Bottom - 100) -and $bounds.Width -gt 0 } | Sort-Object { $_.Current.BoundingRectangle.Left } -Descending); $confirm = @($bottomButtons | Where-Object { $cancelNames -notcontains [string]$_.Current.Name } | Select-Object -First 1); if (-not $confirm -and $bottomButtons.Count -ge 2) { $confirm = $bottomButtons[1] }; if (-not $confirm) { throw (\'failed to locate Windows dialog confirmation button; dialog=\' + $dialog.Name + \'; buttons=\' + (($bottomButtons | ForEach-Object { $_.Current.Name }) -join \'|\')) }',
    'try { $invokePattern = [System.Windows.Automation.InvokePattern]$confirm.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); $invokePattern.Invoke() } catch { throw (\'failed to invoke Windows dialog confirmation button: \' + $_.Exception.Message) }',
    '$closed = $false; for ($attempt = 0; $attempt -lt 30; $attempt++) { Start-Sleep -Milliseconds 150; try { $current = [System.Windows.Automation.AutomationElement]::FromHandle($dialogHandle); if (-not $current -or $current.Current.IsOffscreen) { $closed = $true; break } } catch { $closed = $true; break } }; if (-not $closed) { throw (\'Windows dialog did not close after confirmation; dialog=\' + $dialog.Name + \'; handle=\' + $dialog.Handle) }',
    'Write-Output (\'mode=\' + $mode + \'; dialog=\' + $dialog.Name + \'; handle=\' + $dialog.Handle + \'; confirm=\' + [string]$confirm.Current.Name)'
  ].join('; ')

  const output = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
    { timeout: 30_000 }
  )
  return `${output.stdout}\n${output.stderr}`.trim()
}

export const selectDirectoryInWindowsDialog = async (
  directoryPath: string,
  electronProcessId?: number | null
): Promise<string> =>
  await selectPathInWindowsCommonDialog(directoryPath, 'directory', electronProcessId)

export const selectFileInWindowsDialog = async (
  filePath: string,
  electronProcessId?: number | null
): Promise<string> => await selectPathInWindowsCommonDialog(filePath, 'file', electronProcessId)
