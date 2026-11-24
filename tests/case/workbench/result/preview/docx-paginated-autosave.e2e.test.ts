import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  setupWorkbenchWithTempWorkspace,
  openWorkbenchWorkspaceFile
} from '../../../../harness/e2e/workbench'
import { writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'

const CASE_ID = 'docx-paginated-autosave'
describe('Word editor', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['preview'],
        description: '分页编辑、自动保存和冲突恢复',
        fixtures: ['tests/fixtures/workspace'],
        knowledge: 'cached',
        serviceMode: 'real',
        windowMode: 'visible',
        execution: 'exclusive',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const name = 'sample-edit.docx',
            filePath = path.join(setup.workspace.rootPath, name)
          const real = process.env.DOCX_QA_SOURCE
          if (real) await fs.copyFile(real, filePath)
          else
            await writeTestDocxFile(
              setup.workspace.rootPath,
              name,
              Array.from({ length: 120 }, (_, i) => ({ type: 'paragraph', text: '分页编辑 ' + i }))
            )
          const before = await fs.readFile(filePath)
          const prematureLoad = await page.evaluate(() =>
            performance
              .getEntriesByType('resource')
              .some((e) => e.name.includes('/superdoc/editor.js'))
          )
          expect(prematureLoad).toBe(false)
          await page.context().setOffline(true)
          await openWorkbenchWorkspaceFile(runtime, name)
          await page.keyboard.press('Escape')
          const paragraph = page.locator('.superdoc-page [data-run-id]').first()
          await paragraph.waitFor({ state: 'visible' })
          await expect
            .poll(() => page.locator('.superdoc-page').count(), { timeout: 10000 })
            .toBeGreaterThan(1)
          await paragraph.click()
          await page.waitForTimeout(600)
          expect((await fs.readFile(filePath)).equals(before)).toBe(true)
          const readXml = async () =>
            await (await JSZip.loadAsync(await fs.readFile(filePath)))
              .file('word/document.xml')!
              .async('string')
          await page.keyboard.insertText('分页自动保存甲')
          await page.keyboard.insertText('乙')
          await expect.poll(readXml, { timeout: 10000 }).toContain('分页自动保存甲乙')
          if (real)
            await fs.copyFile(
              filePath,
              path.join(process.env.TMPDIR || '/tmp', 'ncurator-workbench-save.docx')
            )
          if (process.platform !== 'win32') {
            const originalMode = (await fs.stat(filePath)).mode
            const savedBytes = await fs.readFile(filePath)
            try {
              await fs.chmod(filePath, 0o444)
              await page.keyboard.insertText('写入重试')
              await page.getByRole('alert').getByRole('button', { name: '重试' }).waitFor()
              expect(await fs.readFile(filePath)).toEqual(savedBytes)
            } finally {
              await fs.chmod(filePath, originalMode)
            }
            await page.getByRole('button', { name: '重试' }).click()
            await expect.poll(readXml).toContain('写入重试')
            await paragraph.click()
          }
          await page.keyboard.insertText('未保存')
          await fs.writeFile(filePath, before)
          await page.getByRole('button', { name: '另存副本' }).waitFor()
          expect((await fs.readFile(filePath)).equals(before)).toBe(true)
          await page.getByRole('button', { name: '打开最新版本' }).click()
          await paragraph.waitFor({ state: 'visible' })
          expect((await page.locator('.superdoc-page').allTextContents()).join('')).not.toContain(
            '未保存'
          )
          const external = await JSZip.loadAsync(before)
          const externalXml = await external.file('word/document.xml')!.async('string')
          external.file('word/document.xml', externalXml.replace('</w:t>', '外部空闲修改</w:t>'))
          await fs.writeFile(filePath, await external.generateAsync({ type: 'nodebuffer' }))
          await page
            .locator('.superdoc-page [data-para-id]')
            .filter({ hasText: '外部空闲修改' })
            .first()
            .waitFor()
          return true
        },
        assert: async (passed, runtime) => {
          await runtime.assertThat(passed, {
            name: 'paginated-autosave-conflict',
            message: '实际按页显示、输入自动写盘、静态打开不写盘，冲突时保留磁盘内容并可恢复。'
          })
        }
      })
    },
    180000
  )
})
