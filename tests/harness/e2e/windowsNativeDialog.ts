import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

type WindowsCommonDialogKind = 'directory' | 'file'

const WINDOWS_DIALOG_INTEROP = `
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NativeDialogWindow {
  private delegate bool WindowCallback(IntPtr handle, IntPtr state);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr handle, uint flags);
  [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, WindowCallback callback, IntPtr state);
  [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr handle);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr handle, StringBuilder name, int length);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", EntryPoint = "SendMessageW", CharSet = CharSet.Unicode)] public static extern IntPtr SetText(IntPtr handle, uint message, IntPtr wParam, string text);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);
  public static IntPtr FindConfirmButton(IntPtr parent) {
    IntPtr result = IntPtr.Zero;
    EnumChildWindows(parent, (handle, state) => {
      StringBuilder name = new StringBuilder(64);
      GetClassName(handle, name, name.Capacity);
      if (IsWindowVisible(handle) && GetDlgCtrlID(handle) == 1 && name.ToString() == "Button") {
        result = handle;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return result;
  }
}`

const WINDOWS_DIRECTORY_NAVIGATION = `
$addressCondition = [System.Windows.Automation.AndCondition]::new(
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'ToolbarWindow32'),
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1001')
)
$address = $dialogElement.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addressCondition)
if (-not $address) { throw 'failed to locate Windows directory address toolbar' }
$bounds = $address.Current.BoundingRectangle
$point = [IntPtr](([int]($bounds.Height / 2) -shl 16) -bor [int]($bounds.Width - 25))
$addressHandle = [IntPtr]$address.Current.NativeWindowHandle
[void][NativeDialogWindow]::SendMessage($addressHandle, 0x201, [IntPtr]1, $point)
[void][NativeDialogWindow]::SendMessage($addressHandle, 0x202, [IntPtr]0, $point)
$editCondition = [System.Windows.Automation.AndCondition]::new(
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Edit'),
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '41477')
)
$addressEdit = $null
for ($attempt = 0; $attempt -lt 20 -and -not $addressEdit; $attempt++) {
  $addressEdit = $dialogElement.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
  if (-not $addressEdit) { Start-Sleep -Milliseconds 100 }
}
if (-not $addressEdit) { throw 'failed to activate Windows directory address input' }
$editHandle = [IntPtr]$addressEdit.Current.NativeWindowHandle
[void][NativeDialogWindow]::SetText($editHandle, 0xC, [IntPtr]0, $targetPath)
[void][NativeDialogWindow]::PostMessage($editHandle, 0x100, [IntPtr]13, [IntPtr]0)
[void][NativeDialogWindow]::PostMessage($editHandle, 0x101, [IntPtr]13, [IntPtr]0)
$expectedPath = [System.IO.Path]::GetFullPath($targetPath).TrimEnd('\\')
$navigatedPath = $null
for ($attempt = 0; $attempt -lt 50 -and -not $navigatedPath; $attempt++) {
  try {
    $address = $dialogElement.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addressCondition)
    if ($address) {
      $name = $address.Current.Name
      $prefixEnd = $name.IndexOf(': ')
      if ($prefixEnd -ge 0) {
        $actualPath = [System.IO.Path]::GetFullPath($name.Substring($prefixEnd + 2)).TrimEnd('\\')
        if ([string]::Equals($actualPath, $expectedPath, [System.StringComparison]::OrdinalIgnoreCase)) {
          $navigatedPath = $actualPath
        }
      }
    }
  } catch {}
  if (-not $navigatedPath) { Start-Sleep -Milliseconds 100 }
}
if (-not $navigatedPath) { throw 'Windows directory dialog did not navigate to the requested path' }
$controls = $dialogElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $trueCondition)
`

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
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    'Add-Type -AssemblyName UIAutomationClient',
    `Add-Type -TypeDefinition '${WINDOWS_DIALOG_INTEROP}'`,
    `$targetPath = '${escapedPath}'`,
    `$mode = '${kind}'`,
    `$targetPid = ${String(electronProcessId || 0)}`,
    '$desktop = [System.Windows.Automation.AutomationElement]::RootElement',
    '$trueCondition = [System.Windows.Automation.Condition]::TrueCondition',
    '$buttonType = [System.Windows.Automation.ControlType]::Button',
    '$editType = [System.Windows.Automation.ControlType]::Edit',
    '$windowType = [System.Windows.Automation.ControlType]::Window',
    "$cancelNames = @('Cancel', '取消', '关闭', 'Close')",
    "$dialogCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, '#32770')",
    'if ($targetPid -gt 0) { $dialogCondition = [System.Windows.Automation.AndCondition]::new($dialogCondition, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $targetPid)) }',
    "function Get-DialogCandidate { $foregroundHandle = [NativeDialogWindow]::GetForegroundWindow(); $windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Descendants, $dialogCondition); $candidates = foreach ($window in @($windows)) { $current = $window.Current; $bounds = $current.BoundingRectangle; if ($current.ControlType -ne $windowType -or [string]$current.ClassName -ne '#32770' -or $bounds.Width -lt 300 -or $bounds.Height -lt 180) { continue }; $controls = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $trueCondition); $buttons = @($controls | Where-Object { $_.Current.ControlType -eq $buttonType -and $_.Current.BoundingRectangle.Width -gt 0 -and $_.Current.BoundingRectangle.Height -gt 0 }); if ($buttons.Count -lt 2) { continue }; $edits = @($controls | Where-Object { $_.Current.ControlType -eq $editType -and $_.Current.BoundingRectangle.Width -gt 0 -and $_.Current.BoundingRectangle.Height -gt 0 }); if ($mode -eq 'file' -and $edits.Count -eq 0) { continue }; [PSCustomObject]@{ Element = $window; Controls = $controls; IsForeground = ([IntPtr]$current.NativeWindowHandle -eq $foregroundHandle); Handle = [Int64]$current.NativeWindowHandle; Name = [string]$current.Name } }; return @($candidates | Sort-Object @{ Expression = { if ($_.IsForeground) { 0 } else { 1 } } }, @{ Expression = { $_.Handle }; Descending = $true } | Select-Object -First 1) }",
    '$dialog = $null; for ($attempt = 0; $attempt -lt 50 -and -not $dialog; $attempt++) { $dialog = Get-DialogCandidate; if (-not $dialog) { Start-Sleep -Milliseconds 200 } }',
    "if (-not $dialog) { $top = @($desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $trueCondition) | ForEach-Object { $current = $_.Current; $bounds = $current.BoundingRectangle; if ($bounds.Width -gt 0 -and $bounds.Height -gt 0) { ([string]$current.ClassName + '|' + [string]$current.Name + '|pid=' + [string]$current.ProcessId + '|' + [int]$bounds.Width + 'x' + [int]$bounds.Height) } } | Where-Object { $_ }) -join ' || '; throw ('failed to locate Windows common dialog; electronPid=' + $targetPid + '; windows=' + $top) }",
    '$dialogHandle = [NativeDialogWindow]::GetAncestor([IntPtr]$dialog.Handle, 2); $dialogElement = [System.Windows.Automation.AutomationElement]::FromHandle($dialogHandle); [void][NativeDialogWindow]::SetForegroundWindow($dialogHandle); try { $dialogElement.SetFocus() } catch {}',
    '$controls = $dialogElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $trueCondition)',
    `if ($mode -eq 'directory') { ${WINDOWS_DIRECTORY_NAVIGATION} } else { $fileNameControl = @($controls | Where-Object { $_.Current.ControlType -eq $editType -and [string]$_.Current.AutomationId -eq '1148' } | Select-Object -First 1); if (-not $fileNameControl) { $fileNameControl = @($controls | Where-Object { $bounds = $_.Current.BoundingRectangle; $_.Current.ControlType -eq $editType -and $bounds.Width -gt 220 -and $bounds.Height -ge 20 -and $bounds.Height -le 48 -and $bounds.Top -gt ($dialogElement.Current.BoundingRectangle.Bottom - 150) } | Sort-Object { $_.Current.BoundingRectangle.Top } | Select-Object -First 1) }; if (-not $fileNameControl) { throw ('failed to locate Windows file-name input; dialog=' + $dialog.Name + '; handle=' + $dialog.Handle) }; try { $valuePattern = [System.Windows.Automation.ValuePattern]$fileNameControl.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $valuePattern.SetValue($targetPath) } catch { throw ('failed to set Windows file-name input: ' + $_.Exception.Message) } }`,
    "$confirm = $null; for ($confirmationAttempt = 0; $confirmationAttempt -lt 40 -and -not $confirm; $confirmationAttempt++) { $freshDialog = Get-DialogCandidate; if ($freshDialog) { $dialogHandle = [NativeDialogWindow]::GetAncestor([IntPtr]$freshDialog.Handle, 2); $dialogElement = [System.Windows.Automation.AutomationElement]::FromHandle($dialogHandle); $controls = $dialogElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $trueCondition); $dialogBounds = $dialogElement.Current.BoundingRectangle; $bottomButtons = @($controls | Where-Object { $bounds = $_.Current.BoundingRectangle; $_.Current.ControlType -eq $buttonType -and $bounds.Width -ge 60 -and $bounds.Height -ge 20 -and $bounds.Top -gt ($dialogBounds.Bottom - 100) -and $bounds.Width -gt 0 } | Sort-Object { $_.Current.BoundingRectangle.Left } -Descending); $nativeConfirm = [NativeDialogWindow]::FindConfirmButton($dialogHandle); if ($nativeConfirm -ne [IntPtr]::Zero) { $confirm = [System.Windows.Automation.AutomationElement]::FromHandle($nativeConfirm) }; if (-not $confirm) { $confirm = @($controls | Where-Object { $_.Current.ControlType -eq $buttonType -and [string]$_.Current.AutomationId -eq '1' -and -not $_.Current.IsOffscreen } | Select-Object -First 1) }; if (-not $confirm) { $confirm = @($bottomButtons | Where-Object { $cancelNames -notcontains [string]$_.Current.Name } | Select-Object -First 1) }; if (-not $confirm -and $bottomButtons.Count -ge 2) { $confirm = $bottomButtons[1] } }; if (-not $confirm) { Start-Sleep -Milliseconds 200 } }; if (-not $confirm) { $details = @($controls | Where-Object { $_.Current.ControlType -eq $buttonType } | ForEach-Object { $c = $_.Current; $b = $c.BoundingRectangle; ([string]$c.Name + '/id=' + [string]$c.AutomationId + '/off=' + [string]$c.IsOffscreen + '/bounds=' + [string]$b) }) -join '|'; throw ('failed to locate Windows dialog confirmation button; dialog=' + $dialog.Name + '; buttons=' + $details) }",
    '$confirmName = [string]$confirm.Current.Name',
    "try { if ($nativeConfirm -ne [IntPtr]::Zero) { [void][NativeDialogWindow]::SendMessage($nativeConfirm, 245, [IntPtr]::Zero, [IntPtr]::Zero) } else { $invokePattern = [System.Windows.Automation.InvokePattern]$confirm.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); $invokePattern.Invoke() } } catch { throw ('failed to invoke Windows dialog confirmation button: ' + $_.Exception.Message) }",
    "$closed = $false; for ($attempt = 0; $attempt -lt 30; $attempt++) { Start-Sleep -Milliseconds 150; try { $current = [System.Windows.Automation.AutomationElement]::FromHandle($dialogHandle); if (-not $current -or $current.Current.IsOffscreen) { $closed = $true; break } } catch { $closed = $true; break } }; if (-not $closed) { throw ('Windows dialog did not close after confirmation; dialog=' + $dialog.Name + '; handle=' + $dialog.Handle) }",
    "Write-Output ('mode=' + $mode + '; dialog=' + $dialog.Name + '; handle=' + $dialog.Handle + '; confirm=' + $confirmName + '; navigatedPath=' + $navigatedPath)"
  ].join('; ')

  const output = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
    { timeout: 30_000, windowsHide: true }
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
