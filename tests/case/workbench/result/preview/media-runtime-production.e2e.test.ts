import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { resolveRunArtifactsDir } from '../../../../harness/core/write-run-log'
import {
  setupWorkbenchWithTempWorkspace,
  workbenchSelectors,
  waitForWorkbenchAiRunCompletion,
  recordWorkbenchAiEvidence,
  waitForApplyEntryByFileName,
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'media-runtime-production',
  execute = promisify(execFile)
describe('production media runtime', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['preview'],
        description: '实际应用与正式包中的绘画、剪辑、来源及资源释放。',
        fixtures: [],
        knowledge: 'none',
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        extraEnv: process.platform === 'darwin' ? { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } : {},
        execute: async (runtime) => {
          const { page } = runtime,
            setup = await setupWorkbenchWithTempWorkspace(page, {
              caseId: CASE_ID,
              workspaceContents: 'empty'
            })
          const motion = path.join(setup.workspace.rootPath, 'motion.mp4'),
            final = path.join(setup.workspace.rootPath, 'final.mp4')
          const windowsBefore = await runtime.electronApp.evaluate(
            ({ BrowserWindow }) => BrowserWindow.getAllWindows().length
          )
          const applicationPid = await runtime.electronApp.evaluate(() => process.pid)
          let peakTreeRssBytes = 0,
            sampling = false
          const sample = async () => {
            if (sampling || process.platform === 'win32') return
            sampling = true
            try {
              const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,rss='], { timeout: 3000 })
              const rows = stdout
                  .trim()
                  .split('\n')
                  .map((line) => line.trim().split(/\s+/u).map(Number)),
                pids = new Set([applicationPid])
              for (let changed = true; changed; ) {
                changed = false
                for (const [pid, parent] of rows)
                  if (pids.has(parent) && !pids.has(pid)) {
                    pids.add(pid)
                    changed = true
                  }
              }
              peakTreeRssBytes = Math.max(
                peakTreeRssBytes,
                rows.reduce((sum, [pid, , rss]) => sum + (pids.has(pid) ? rss * 1024 : 0), 0)
              )
            } finally {
              sampling = false
            }
          }
          await sample()
          const timer = setInterval(() => void sample().catch(() => {}), 1000)
          const started = Date.now()
          try {
            const composer = page.getByTestId(workbenchSelectors.input)
            await composer.fill(
              `做两份视频：先做1秒、320×180、10帧每秒的小动画，卡通纸飞机沿弧线从左下飞到右上，留下逐渐消失的点状尾迹，白底、固定黑色标题“出发”，保存为 ${motion}；然后以这份动画为素材，只保留前0.8秒，加上底部中文字幕“完成”，正式成片保存为 ${final}。保留两份可编辑来源。这些就是全部要求，直接制作即可。`
            )
            await composer.press('Enter')
            const evidence = await waitForWorkbenchAiRunCompletion(
              runtime,
              started,
              setup.env.modelName,
              WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
              { page, blockerPolicy: 'auto_approve' }
            )
            recordWorkbenchAiEvidence(runtime, evidence, 1)
            const tools = evidence.events
              .filter((event) => event.type === 'tool_call_started')
              .map((event) => event.toolName)
            const sourceRoot = path.join(setup.workspace.rootPath, '.ncurator-media'),
              origins = []
            for (const entry of await fs.readdir(sourceRoot, { withFileTypes: true })) {
              if (entry.isDirectory())
                origins.push(
                  JSON.parse(
                    await fs.readFile(path.join(sourceRoot, entry.name, 'origin.json'), 'utf8')
                  ) as { outputPath: string; sourcePath?: string; editPath?: string }
                )
            }
            const sources =
              origins.some((item) => item.outputPath === motion && !!item.sourcePath) &&
              origins.some((item) => item.outputPath === final && !!item.editPath)
            const output = resolveRunArtifactsDir({
              scope: 'workbench/result/preview',
              caseId: CASE_ID,
              runId: runtime.runId
            })
            await fs.mkdir(path.join(output, 'media'), { recursive: true })
            await fs.copyFile(motion, path.join(output, 'media/motion.mp4'))
            await fs.copyFile(final, path.join(output, 'media/final.mp4'))
            await fs.cp(sourceRoot, path.join(output, 'media/sources'), { recursive: true })
            await (await waitForApplyEntryByFileName(page, 'final.mp4')).click()
            await page
              .getByTestId('workbench-video-preview')
              .locator('[data-video-state="ready"]')
              .waitFor({ timeout: 30000 })
            await page
              .getByTestId('workbench-video-preview')
              .getByRole('button', { name: '编辑', exact: true })
              .click()
            const editor = page.getByTestId('video-workbench')
            await editor
              .getByRole('textbox', { name: '画面文字意见', exact: true })
              .fill('检查这一帧。')
            await editor
              .locator('.nc-video-text-opinion')
              .getByRole('button', { name: '加入输入框', exact: true })
              .click()
            const token = page
              .getByTestId(workbenchSelectors.input)
              .locator('[data-role="video-feedback-token"]')
            await token.waitFor()
            const snapshotLabel = (await token.innerText()).includes('final.mp4')
            const snapshot = await page.evaluate(async (file) => {
              const preview = await window.api.previewVideoOpen({ source: file })
              await window.api.previewResourceRelease(preview.id)
              return { width: preview.width, height: preview.height, duration: preview.duration }
            }, final)
            const windowsAfter = await runtime.electronApp.evaluate(({ BrowserWindow, app }) => ({
              windows: BrowserWindow.getAllWindows().length,
              packaged: app.isPackaged
            }))
            const report = {
              tools,
              sources,
              snapshotLabel,
              applicationPid,
              snapshot,
              windowsBefore,
              windowsAfter,
              peakTreeRssBytes,
              samplingIntervalMs: 1000,
              durationMs: Date.now() - started
            }
            await fs.writeFile(
              path.join(output, 'media/runtime.json'),
              JSON.stringify(report, null, 2)
            )
            await runtime.captureArtifact({
              kind: 'other',
              relativePath: 'media/runtime.json',
              message: '真实应用进程树内存采样、来源与释放报告。'
            })
            await runtime.captureScreenshot({
              name: 'media-runtime-final',
              message: '实际安装运行时制作并打开成片。'
            })
            return report
          } finally {
            clearInterval(timer)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.sources &&
              result.snapshotLabel &&
              result.tools.includes('drawing') &&
              result.tools.some((name) => name.startsWith('video_')),
            {
              name: 'production-media-tools',
              message: '实际绘画与剪辑工具交付带长期来源的媒体。',
              data: result
            }
          )
          await runtime.assertThat(
            result.snapshot.width === 320 &&
              result.snapshot.height === 180 &&
              Math.abs((result.snapshot.duration || 0) - 0.8) < 0.15 &&
              result.windowsAfter.windows === result.windowsBefore,
            {
              name: 'production-media-lifecycle',
              message: '成片可解码、时长正确，绘图窗口已释放。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS + 180000
  )
})
