import { createServer, type ServerResponse } from 'node:http'
import { expect, it } from 'vitest'
import { importSelectors, vectorSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  createRealWorkspaceWithRoot,
  getSettingsLocator,
  navigateToSettingsSection,
  waitForFileIndexJobIdle
} from '../../../harness/e2e/settings'
import { createWorkspaceWithFiles } from '../workspace/files/realWorkspaceHelpers'

it('remote-vector-rebuild-recovery', async () => {
  await runE2ECase({
    caseId: 'remote-vector-rebuild-recovery',
    domain: 'settings',
    suite: 'vector',
    description: '通过真实设置界面复验远程文件索引失败、取消、重启和重建。',
    fixtures: [],
    serviceMode: 'real',
    execution: 'exclusive',
    windowMode: 'visible',
    runMode: 'single',
    execute: async (runtime) => {
      let mode: 'success' | 'unauthorized' | 'hold' = 'success'
      let held: { response: ServerResponse; embeddings: object[] } | undefined
      const calls: string[] = []
      const service = createServer(async (request, response) => {
        try {
          if (
            request.method !== 'POST' ||
            request.url !== '/v1/embeddings' ||
            request.headers.authorization !== 'Bearer isolated-embedding-key'
          ) {
            response.writeHead(403).end()
            return
          }
          const parts = []
          for await (const chunk of request) parts.push(chunk)
          const { model, input } = JSON.parse(Buffer.concat(parts).toString()) as {
            model: string
            input: string[]
          }
          if (
            !['remote-index-first', 'remote-index-next'].includes(model) ||
            !Array.isArray(input)
          ) {
            response.writeHead(400).end()
            return
          }
          calls.push(model)
          if (mode === 'unauthorized') {
            response
              .writeHead(401, { 'content-type': 'application/json' })
              .end(JSON.stringify({ error: { message: 'isolated remote credentials rejected' } }))
            return
          }
          const embeddings = input.map((_text, index) => ({
            index,
            object: 'embedding',
            embedding: [1, 0, 1, 0]
          }))
          if (mode === 'hold') {
            held = { response, embeddings }
            return
          }
          response
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify({ object: 'list', data: embeddings }))
        } catch {
          response.destroy()
        }
      })
      runtime.registerResource({
        name: 'isolated-remote-vector-service',
        phase: 'after-app-close',
        dispose: async () => {
          service.closeAllConnections()
          if (service.listening)
            await new Promise<void>((resolve) => service.close(() => resolve()))
        }
      })
      await new Promise<void>((resolve, reject) => {
        service.once('error', reject)
        service.listen(0, '127.0.0.1', resolve)
      })
      const address = service.address()
      if (!address || typeof address === 'string') throw new Error('Missing remote fixture port')

      let { page } = runtime
      const rootPath = await createWorkspaceWithFiles('remote-vector-rebuild-recovery', [
        { relativePath: 'index.txt', content: '保持原始内容的重新索引测试。' }
      ])
      const created = await createRealWorkspaceWithRoot(page, { name: '远程索引恢复', rootPath })
      const workspaceId = created.workspace!.id
      const readIndex = () => page.evaluate(() => window.api.embeddingModelsGet())
      const build = () => getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton)
      const waitForBuildButton = () =>
        expect.poll(() => build().textContent()).toMatch(/更新索引|重新建立索引/u)
      const makeAndSelectModel = async (name: string) => {
        await navigateToSettingsSection(page, 'vector')
        await getSettingsLocator(page, vectorSelectors.remoteAddButton).click()
        await getSettingsLocator(page, vectorSelectors.remoteNameInput).fill(name)
        await getSettingsLocator(page, vectorSelectors.remoteBaseUrlInput).fill(
          'http://127.0.0.1:' + address.port + '/v1'
        )
        await getSettingsLocator(page, vectorSelectors.remoteModelNameInput).fill(name)
        await getSettingsLocator(page, vectorSelectors.remoteApiKeyInput).fill(
          'isolated-embedding-key'
        )
        await getSettingsLocator(page, vectorSelectors.remoteSaveButton).click()
        await expect
          .poll(async () => (await readIndex()).remoteModels.some((model) => model.name === name))
          .toBe(true)
        const saved = (await readIndex()).remoteModels.find((model) => model.name === name)!
        await getSettingsLocator(page, vectorSelectors.selectButtonPrefix + '-' + saved.id).click()
        await expect.poll(async () => (await readIndex()).activeModelId).toBe(saved.id)
        return saved.id
      }
      const prepareWorkspace = async () => {
        await navigateToSettingsSection(page, 'workspace')
        await waitForBuildButton()
        await build().click()
      }
      const statuses = async () =>
        (await waitForFileIndexJobIdle(page, workspaceId)).tree.items
          .filter((item) => item.kind === 'file')
          .map((item) => item.index_status)
      await makeAndSelectModel('remote-index-first')
      await prepareWorkspace()
      await expect.poll(statuses, { timeout: 30_000 }).toEqual(['indexed'])
      expect(calls).toContain('remote-index-first')

      const next = await makeAndSelectModel('remote-index-next')
      expect((await readIndex()).index.staleFileCount).toBe(1)
      mode = 'unauthorized'
      const beforeFailure = calls.length
      await prepareWorkspace()
      await expect.poll(() => calls.length).toBeGreaterThan(beforeFailure)
      expect(await statuses()).toEqual(['failed'])
      expect((await readIndex()).index.staleFileCount).toBe(1)
      expect((await readIndex()).activeModelId).toBe(next)

      mode = 'hold'
      await waitForBuildButton()
      await build().click()
      await expect.poll(() => Boolean(held)).toBe(true)
      await build().click()
      await getSettingsLocator(page, importSelectors.workspaceIndexCancelConfirmButton).click()
      const cancelled = held
      if (cancelled) {
        cancelled.response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ object: 'list', data: cancelled.embeddings }))
      }
      held = undefined
      expect(await statuses()).toEqual(['failed'])
      expect((await readIndex()).index.staleFileCount).toBe(1)

      await waitForBuildButton()
      await build().click()
      await expect.poll(() => Boolean(held)).toBe(true)
      ;({ page } = await runtime.restartApp({ crash: true }))
      expect(await statuses()).toEqual(['failed'])
      expect((await readIndex()).activeModelId).toBe(next)
      expect((await readIndex()).index.staleFileCount).toBe(1)
      mode = 'success'
      await prepareWorkspace()
      await expect.poll(statuses, { timeout: 30_000 }).toEqual(['indexed'])
      return (await readIndex()).index.staleFileCount
    },
    assert: async (stale, runtime) =>
      runtime.assertThat(stale === 0, {
        name: 'remote-vector-rebuild-recovery',
        message: '远程模型保持选中，中断后重建仅在完整写入时清除失效状态。'
      })
  })
}, 180_000)
