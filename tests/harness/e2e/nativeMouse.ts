import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MACOS_MOUSE_SCRIPT_PATH = path.join(os.tmpdir(), 'ncurator-e2e-native-mouse.swift')
const MACOS_MOUSE_SCRIPT = `
import ApplicationServices
import Foundation

guard CommandLine.arguments.count >= 3,
      let x = Double(CommandLine.arguments[1]),
      let y = Double(CommandLine.arguments[2]) else {
  fatalError("usage: native-mouse.swift <x> <y>")
}

let point = CGPoint(x: x, y: y)
CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(50_000)
CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
`
const MACOS_ESCAPE_SCRIPT_PATH = path.join(os.tmpdir(), 'ncurator-e2e-native-escape.swift')
const MACOS_ESCAPE_SCRIPT = `
import ApplicationServices

let escapeKeyCode: CGKeyCode = 53
CGEvent(keyboardEventSource: nil, virtualKey: escapeKeyCode, keyDown: true)?.post(tap: .cghidEventTap)
CGEvent(keyboardEventSource: nil, virtualKey: escapeKeyCode, keyDown: false)?.post(tap: .cghidEventTap)
`

export const clickScreenPoint = async (x: number, y: number): Promise<void> => {
  const roundedX = Math.round(x)
  const roundedY = Math.round(y)
  if (process.platform === 'win32') {
    const script = [
      'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class NativeMouse { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo); }\'',
      '[void][NativeMouse]::SetProcessDpiAwarenessContext([IntPtr](-4))',
      `[void][NativeMouse]::SetCursorPos(${String(roundedX)}, ${String(roundedY)})`,
      'Start-Sleep -Milliseconds 50',
      '[NativeMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)',
      'Start-Sleep -Milliseconds 50',
      '[NativeMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)'
    ].join('; ')
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 30_000
    })
    return
  }
  if (process.platform === 'darwin') {
    await writeFile(MACOS_MOUSE_SCRIPT_PATH, MACOS_MOUSE_SCRIPT, 'utf8')
    await execFileAsync('/usr/bin/swift', [MACOS_MOUSE_SCRIPT_PATH, String(x), String(y)], {
      timeout: 30_000
    })
    return
  }
  throw new Error(`native mouse automation is unsupported on ${process.platform}`)
}

export const pressEscapeKey = async (): Promise<void> => {
  if (process.platform === 'win32') {
    const script = [
      'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class NativeKeyboard { [DllImport("user32.dll")] public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo); }\'',
      '[NativeKeyboard]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero)',
      '[NativeKeyboard]::keybd_event(0x1B, 0, 0x0002, [UIntPtr]::Zero)'
    ].join('; ')
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 30_000
    })
    return
  }
  if (process.platform === 'darwin') {
    await writeFile(MACOS_ESCAPE_SCRIPT_PATH, MACOS_ESCAPE_SCRIPT, 'utf8')
    await execFileAsync('/usr/bin/swift', [MACOS_ESCAPE_SCRIPT_PATH], { timeout: 30_000 })
    return
  }
  throw new Error(`native keyboard automation is unsupported on ${process.platform}`)
}
