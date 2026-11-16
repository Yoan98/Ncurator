import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Page } from 'playwright'
import { expect, it } from 'vitest'
import {
  accountButton,
  accountPanel,
  labels,
  menuItem,
  newTestEmail,
  withAccountFixture,
  type ProfileEvidence
} from '../../../harness/e2e/account'
import { nodeOneMatrix, type NodeOneSendId } from '../../../harness/e2e/nodeOneAcceptance'
import { runE2ECase, type E2ETestRuntime } from '../../../harness/e2e/run-e2e-case'
import {
  addWorkspaceDirectoryThroughNativeDialog,
  createModelConfigThroughSettingsUi
} from '../../../harness/e2e/settings'
import {
  createPartnerThroughWorkbenchUi,
  navigateToWorkbench,
  selectWorkbenchModel,
  selectWorkbenchAttachmentThroughNativeDialog,
  setWorkbenchInput,
  submitWorkbenchCurrentDraft
} from '../../../harness/e2e/workbench'

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const money = (value: ProfileEvidence) =>
  JSON.stringify({
    calls: value.calls,
    wallets: value.wallets,
    recharge: value.recharge,
    adjustments: value.adjustments,
    refunds: value.refunds
  })
const check = (ok: boolean, code: string) => {
  if (!ok) throw new Error('node-one:' + code)
}

async function localSnapshot(runtime: E2ETestRuntime, document: string, credential: string) {
  const data = await runtime.page.evaluate(async (expectedKey) => {
    const partners = await window.api.partnerList()
    const connections = await window.api.llmConfigList()
    const workspaces = await window.api.workspaceList()
    const messages = await Promise.all(
      partners.map(async (partner) => ({
        id: partner.id,
        messages: await window.api.partnerMessageList(partner.id)
      }))
    )
    return {
      partners: partners.map((p) => ({ id: p.id, name: p.name })),
      connections: connections.map((c) => ({
        id: c.id,
        name: c.name,
        baseUrl: c.base_url,
        keyMatches: c.api_key === expectedKey
      })),
      workspaces: workspaces.items,
      messages
    }
  }, credential)
  const db = new DatabaseSync(join(runtime.userDataDir, 'app.sqlite'), { readOnly: true })
  let selection: object[]
  try {
    selection = db
      .prepare('SELECT partner_id,state_json FROM partner_ui_state ORDER BY partner_id')
      .all()
      .map((row) => ({
        id: row.partner_id,
        selection: JSON.parse(String(row.state_json)).composer.modelSelection
      }))
  } finally {
    db.close()
  }
  return {
    partners: data.partners.sort((a, b) => a.id.localeCompare(b.id)),
    connections: data.connections.sort((a, b) => a.id.localeCompare(b.id)),
    selections: selection,
    workspaces: data.workspaces
      .map((w) => ({ id: w.id, path: w.root_path }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    messages: data.messages.map((p) => ({
      id: p.id,
      prefix: p.messages.map((m) => ({ id: m.id, hash: hash(JSON.stringify(m)) }))
    })),
    fileHash: hash(await readFile(document))
  }
}
type LocalSnapshot = Awaited<ReturnType<typeof localSnapshot>>
function assertRetained(before: LocalSnapshot, after: LocalSnapshot) {
  check(JSON.stringify(before.partners) === JSON.stringify(after.partners), 'local-partners')
  check(JSON.stringify(before.connections) === JSON.stringify(after.connections), 'local-config')
  check(JSON.stringify(before.selections) === JSON.stringify(after.selections), 'local-selection')
  check(JSON.stringify(before.workspaces) === JSON.stringify(after.workspaces), 'local-workspaces')
  check(before.fileHash === after.fileHash, 'local-file')
  check(
    before.messages.every((p) =>
      p.prefix.every((message, index) => {
        const found = after.messages.find((next) => next.id === p.id)?.prefix[index]
        return found?.id === message.id && found.hash === message.hash
      })
    ),
    'local-messages'
  )
}

// Only queries and compares results in memory; neither credentials nor response bodies are recorded.
async function formalBilling(page: Page) {
  return await page.evaluate(async () => {
    const output: { view: string; status: number; value: string }[] = []
    for (const view of ['usage', 'funds']) {
      const response = await fetch('https://api.guanzhangai.cn/api/account/billing?view=' + view, {
        credentials: 'include'
      })
      const value = response.ok ? JSON.stringify(await response.json()) : ''
      output.push({ view, status: response.status, value })
    }
    return output
  })
}

it('anonymous-existing-usage', async () => {
  const family = process.env.NCURATOR_ACCOUNT_E2E_FAMILY
  if (family && !['custom', 'free'].includes(family))
    throw new Error('node-one:unexpected-real-family')
  const customOnly = family === 'custom'
  const freeOnly = family === 'free'
  const expectedSends = family ? 8 : 16
  await withAccountFixture(
    async (setup, service) => {
      const acceptance = service.acceptance
      if (!acceptance) throw new Error('node-one:profile-required')
      const { proxy } = acceptance
      const root = await mkdtemp(join(tmpdir(), 'ncurator-node-one-documents-'))
      const document = join(root, '账号保持验收.txt')
      await writeFile(document, '节点一专用合成资料：登录、退出及撤销不得改变此 UTF-8 文件。\n')
      try {
        await runE2ECase({
          ...setup,
          caseId: 'anonymous-existing-usage',
          domain: 'account',
          suite: 'access',
          description: '真实免费及 gpt-6-luna 上游的八组账号变化与本地资料保持。',
          fixtures: [],
          serviceMode: 'real',
          execution: 'exclusive',
          windowMode: 'visible',
          runMode: 'single',
          nodeOneAcceptance: { revoke: () => proxy.budget.revoke('closed') },
          execute: async (runtime) => {
            proxy.budget.observe((data) =>
              runtime.signal({ name: 'node-one-send', message: 'Guard metadata', data })
            )
            const names = { F: '原有免费伙伴', C: '原有自定义伙伴' }
            const emailA = newTestEmail('retain-a'),
              emailB = newTestEmail('retain-b')
            let webA = await service.browserPage(),
              webB = await service.browserPage()
            const manager = await acceptance.manager()
            await manager.goto('https://www.guanzhangai.cn/account')
            await manager.getByRole('heading', { name: '账户概览', exact: true }).waitFor()
            await createModelConfigThroughSettingsUi(runtime.page, {
              name: '节点一个人连接',
              baseUrl: proxy.origin + '/custom',
              apiKey: acceptance.credential
            })
            await addWorkspaceDirectoryThroughNativeDialog(runtime.page, root)
            await navigateToWorkbench(runtime.page)
            for (const family of ['F', 'C'] as const) {
              await createPartnerThroughWorkbenchUi(runtime.page, names[family])
              if (family === 'F') {
                await runtime.page.getByTestId('workbench-model-select').click()
                const option = runtime.page.getByTestId(
                  'workbench-model-free-option-' + acceptance.freeId
                )
                await option.waitFor()
                await option.hover()
                await runtime.page
                  .getByTestId('workbench-inspector')
                  .getByText(acceptance.freeDescription)
                  .waitFor()
                await expect
                  .poll(() =>
                    option
                      .locator('img')
                      .evaluate(
                        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0
                      )
                  )
                  .toBe(true)
                check(
                  (await runtime.page.getByTestId('workbench-model-list-load-failure').count()) ===
                    0,
                  'local-setup'
                )
                await option.click()
              } else
                await selectWorkbenchModel(
                  runtime.page,
                  family === 'F' ? acceptance.freeId : acceptance.customModel,
                  { preferCustom: family === 'C' }
                )
              await selectWorkbenchAttachmentThroughNativeDialog(runtime.page, document)
            }
            const original = await localSnapshot(runtime, document, acceptance.credential)
            check(
              original.partners.length === 2 &&
                original.connections.length === 1 &&
                original.connections.every((c) => c.keyMatches) &&
                original.workspaces.length === 1,
              'local-setup'
            )
            const select = async (family: 'F' | 'C') => {
              await navigateToWorkbench(runtime.page)
              await runtime.page
                .locator('[data-testid^="workbench-partner-item-"]')
                .filter({ hasText: names[family] })
                .click()
            }
            const accountPage = async () => {
              await accountButton(runtime.page).click()
              await menuItem(runtime.page, labels.settings).click()
              await runtime.page.locator('a[href="#/settings/account"]').click()
            }
            const login = async (email: string, web: Page, signedIn?: true) => {
              await accountPage()
              await service.authorize(runtime, web, email, { signedIn })
              await accountPanel(runtime.page).getByRole('button', { name: labels.refresh }).click()
              const next = await service.continueInBrowser(web)
              await service.userNumber(next)
              return next
            }
            const observeInvalid = async () => {
              await accountPage()
              const refresh = accountPanel(runtime.page).getByRole('button', {
                name: labels.refresh
              })
              if (await refresh.count()) await refresh.click()
              await expect
                .poll(
                  async () =>
                    runtime.page.evaluate(
                      async () => (await window.api.desktopAccount('profile')).status
                    ),
                  { timeout: 10_000 }
                )
                .toBe('expired')
              await accountPanel(runtime.page).getByRole('button', { name: labels.login }).waitFor()
            }
            let userNoB = ''
            const query = async (stage: number) => {
              const values = []
              const managerBilling = await formalBilling(manager)
              check(
                managerBilling.every((value) => value.status === 200),
                'formal-billing-delta'
              )
              values.push(managerBilling)
              if (stage >= 3) {
                const a = await formalBilling(webA)
                check(
                  a.every((value) => value.status === 200),
                  'formal-billing-delta'
                )
                values.push(a)
              }
              if (stage >= 6) {
                const b = await formalBilling(webB)
                check(
                  b.every((value) => value.status === (stage === 8 ? 401 : 200)),
                  'formal-billing-delta'
                )
                values.push(b)
                const audited = await manager.evaluate(async (userNo) => {
                  const result = []
                  for (const view of ['calls', 'summary']) {
                    const response = await fetch(
                      'https://api.guanzhangai.cn/api/ops/users/' + userNo + '?view=' + view,
                      { credentials: 'include' }
                    )
                    result.push({
                      status: response.status,
                      value: response.ok ? await response.json() : null
                    })
                  }
                  return result
                }, userNoB)
                check(
                  audited.every((value) => value.status === 200),
                  'formal-billing-delta'
                )
                values.push(audited)
              }
              return JSON.stringify(values)
            }
            const send = async (id: NodeOneSendId, hold = false) => {
              await select(id[0] as 'F' | 'C')
              if (hold) proxy.hold(id)
              proxy.budget.grant(id)
              await setWorkbenchInput(
                runtime.page,
                `只回复一句简短文本，不使用工具。验收发送 ${id}。`
              )
              await submitWorkbenchCurrentDraft(runtime.page)
            }
            const completed = async (id: NodeOneSendId) => {
              const partnerId = original.partners.find(
                (p) => p.name === names[id[0] as 'F' | 'C']
              )!.id
              await expect
                .poll(
                  async () =>
                    runtime.page.evaluate(
                      async (value) => {
                        const state = await window.api.partnerSnapshotGet({ partnerId: value.id })
                        return (
                          !state.activeRuns.length &&
                          state.messages.some(
                            (m) => m.role === 'user' && m.content.includes(value.send)
                          ) &&
                          state.messages.filter(
                            (m) =>
                              m.role === 'assistant' && !m.error && !m.pending && m.content.trim()
                          ).length >= value.stage
                        )
                      },
                      { id: partnerId, send: id, stage: Number(id.slice(1)) }
                    ),
                  { timeout: 35_000 }
                )
                .toBe(true)
              runtime.signal({
                name: 'node-one-send',
                message: 'Node one completed',
                data: {
                  scenarioId: id,
                  status: 'completed',
                  invariant: true
                }
              })
            }
            let previous = original
            let lastBLoginAt = 0
            for (let stage = 1; stage <= nodeOneMatrix.length; stage++) {
              runtime.signal({
                name: 'node-one-phase',
                message: 'Starting phase',
                data: { stage, syntheticOnly: false }
              })
              // Account operations are outside each inference baseline, so normal authorization is not misattributed.
              if (stage === 2) await runtime.restartApp()
              if (stage === 3) webA = await login(emailA, webA)
              if (stage === 6) {
                webB = await login(emailB, webB)
                userNoB = await service.userNumber(webB)
                lastBLoginAt = Date.now()
              }
              if (stage === 7) {
                await webB.goto('https://www.guanzhangai.cn/account')
                await webB.getByRole('button', { name: '退出全部设备', exact: true }).click()
                await webB.getByRole('button', { name: '确认退出', exact: true }).click()
                await webB.waitForURL((url) => url.pathname === '/login')
                await observeInvalid()
                // Reopening only the web session permits formal billing queries while desktop stays expired.
                const cooldown = 61_000 - (Date.now() - lastBLoginAt)
                if (cooldown > 0) await new Promise((done) => setTimeout(done, cooldown))
                await service.signIn(webB, emailB, 'https://www.guanzhangai.cn/account')
              }
              if (stage === 8) {
                webB = await login(emailB, webB, true)
                await manager.goto('https://www.guanzhangai.cn/ops/users')
                await manager.getByRole('textbox', { name: '按邮箱或用户编号搜索' }).fill(emailB)
                await manager.getByRole('button', { name: /^查\s*询$/u }).click()
                await manager
                  .getByRole('row')
                  .filter({ hasText: emailB })
                  .getByRole('button', { name: /^封\s*禁$/u })
                  .click()
                const modal = manager.getByRole('dialog', { name: '封禁账户' })
                await modal
                  .getByRole('textbox', { name: '操作原因' })
                  .fill('节点一合成账号边界验收')
                await modal.getByRole('button', { name: /^确\s*认$/u }).click()
                await modal.waitFor({ state: 'hidden' })
                await observeInvalid()
              }
              const before = await acceptance.evidence(),
                beforeBilling = await query(stage)
              check(before.recharge > 0, 'nonempty-funds-baseline')
              const f = `F0${stage}` as NodeOneSendId,
                c = `C0${stage}` as NodeOneSendId
              if (!customOnly) await send(f, stage === 4)
              if (!customOnly && stage !== 4) {
                await completed(f)
                check(money(before) === money(await acceptance.evidence()), 'platform-delta')
              }
              if (!freeOnly) await send(c, stage === 4)
              if (stage === 4) {
                await expect.poll(() => proxy.budget.state.active).toBe(family ? 1 : 2)
                check(money(before) === money(await acceptance.evidence()), 'platform-delta')
                await accountButton(runtime.page).click()
                await menuItem(runtime.page, labels.signOut).click()
                await accountPage()
                await accountPanel(runtime.page)
                  .getByRole('button', { name: labels.login })
                  .waitFor()
                check(
                  (await formalBilling(webA)).every((v) => v.status === 200),
                  'independent-web-session'
                )
                proxy.release()
                if (!customOnly) await completed(f)
              }
              if (!freeOnly) await completed(c)
              const after = await acceptance.evidence(),
                afterBilling = await query(stage)
              const local = await localSnapshot(runtime, document, acceptance.credential)
              assertRetained(original, local)
              assertRetained(previous, local)
              const observed = await runtime.collectSignals()
              check(
                !observed.aiRunEventEntries.some(
                  (entry) => entry.event.type === 'tool_call_started'
                ),
                'tools-executed'
              )
              check(
                money(before) === money(after) &&
                  before.users.length === after.users.length &&
                  before.sessions === after.sessions,
                'platform-delta'
              )
              check(beforeBilling === afterBilling, 'formal-billing-delta')
              runtime.signal({
                name: 'node-one-phase',
                message: 'Node one phase',
                data: {
                  stage,
                  localPreserved: true,
                  zeroPlatformDelta: true,
                  formalQueriesUnchanged: true,
                  syntheticOnly: false
                }
              })
              previous = local
            }
            check(
              proxy.budget.state.sends === expectedSends && !proxy.budget.state.closed,
              'matrix-budget'
            )
            const upstream = (await acceptance.evidence()).freeSource
            if (!customOnly)
              check(
                upstream?.requests === 8 && upstream.completed === 8 && !upstream.closed,
                'matrix-budget'
              )
            return { sends: proxy.budget.state.sends }
          },
          assert: async (result, runtime) =>
            runtime.assertThat(result.sends === expectedSends, {
              name: 'node-one-matrix',
              message: family
                ? 'Eight real upstream requests completed for the explicitly selected family only.'
                : '16 real upstream requests completed with local data preserved and no platform charges.'
            })
        })
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
    { nodeOneAcceptance: true, realModels: true }
  )
}, 620_000)
