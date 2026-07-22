import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'node:net'
import Database from 'better-sqlite3'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'

const repoRoot = path.resolve('../../..')
const episodeDir = process.cwd()
const outputDir = path.join(episodeDir, 'assets', 'captured')
const rawDir = path.join(episodeDir, 'assets', 'raw')
const workspaceDir = path.join(rawDir, 'demo-workspace')
const userDataDir = path.join(rawDir, 'user-data')
const videoTempDir = path.join(rawDir, 'playwright-video')
const persistentDbCandidates = [
  path.join(process.env.HOME || '', 'Library', 'Application Support', 'ncurator', 'app.sqlite'),
  path.join(process.env.HOME || '', 'Library', 'Application Support', 'ncurator-desktop', 'app.sqlite')
]
const sourceName = '项目推进会-07月18日.md'
const workspaceName = '30份会议纪要'
const prompt =
  '请只根据这个工作空间里的会议纪要回答：登录页改版由谁负责，截止时间是哪一天？回答要简短，并附上原始会议纪要来源。'
const nativeBinding = path.join(
  repoRoot,
  'node_modules',
  '.native-cache',
  'better-sqlite3',
  `node-v${process.versions.modules}-${process.platform}-${process.arch}`,
  'better_sqlite3.node'
)

await rm(rawDir, { recursive: true, force: true })
await rm(outputDir, { recursive: true, force: true })
await mkdir(workspaceDir, { recursive: true })
await mkdir(outputDir, { recursive: true })
await mkdir(videoTempDir, { recursive: true })

const topics = [
  '版本规划',
  '测试安排',
  '客户反馈',
  '接口联调',
  '设计评审',
  '发布准备',
  '数据迁移',
  '权限梳理',
  '移动端适配',
  '性能优化'
]

for (let index = 1; index <= 30; index += 1) {
  const fileName = index === 18 ? sourceName : `会议纪要-${String(index).padStart(2, '0')}.md`
  const topic = topics[(index - 1) % topics.length]
  const content =
    index === 18
      ? [
          '# 项目推进会',
          '',
          '日期：7 月 18 日',
          '',
          '## 登录页改版',
          '',
          '登录页改版由张晨负责，计划在 7 月 25 日前完成并提交验收。',
          '',
          '设计稿已经确认，本周进入开发和联调。'
        ].join('\n')
      : [
          `# ${topic}会议纪要`,
          '',
          `日期：7 月 ${String(Math.min(index, 30)).padStart(2, '0')} 日`,
          '',
          `本次会议讨论了${topic}的进展、风险和后续协作事项。`,
          '',
          `下一次同步将在 ${String((index % 20) + 1).padStart(2, '0')} 日进行。`
        ].join('\n')
  await writeFile(path.join(workspaceDir, fileName), `${content}\n`, 'utf8')
}

const allocateFreePort = async () => {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('无法分配调试端口')
  const port = address.port
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return port
}

const launchApp = async ({ recordVideo = false } = {}) => {
  const port = await allocateFreePort()
  const launchedAt = Date.now()
  const app = await electron.launch({
    executablePath: electronPath,
    args: [repoRoot],
    cwd: repoRoot,
    recordVideo: recordVideo
      ? { dir: videoTempDir, size: { width: 1600, height: 1000 } }
      : undefined,
    env: {
      ...process.env,
      NCURATOR_E2E_OBSERVER: '1',
      NCURATOR_E2E_WINDOW_MODE: 'background',
      NCURATOR_USER_DATA_PATH: userDataDir,
      NCURATOR_EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT: String(port)
    }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window?.setBounds({ x: 24, y: 24, width: 1600, height: 1000 })
  })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.evaluate(() => {
    window.location.hash = '#/'
  })
  await page.locator('[data-testid="workbench-page"]').waitFor({ state: 'visible' })
  return { app, page, launchedAt }
}

const waitForFileJob = async (page, workspaceId) => {
  const deadline = Date.now() + 300_000
  let sawJob = false
  while (Date.now() < deadline) {
    const response = await page.evaluate(
      async (id) => await window.api.workspaceIndexJobGet({ workspaceId: id, sourceKind: 'file' }),
      workspaceId
    )
    if (!response.success) throw new Error(response.error || '读取索引任务失败')
    if (response.job) sawJob = true
    if (sawJob && !response.job) return
    await page.waitForTimeout(500)
  }
  throw new Error('建立本地资料索引超时')
}

const chooseRealModel = async (page) =>
  await page.evaluate(async () => {
    const configs = await window.api.llmConfigList()
    const ordered = [...configs].sort((a, b) => {
      const score = (item) => {
        if (item.name === 'test') return 0
        if (item.providerKind === 'deepseek' || /deep/iu.test(item.name)) return 1
        if (/豆包|doubao/iu.test(item.name)) return 3
        return 2
      }
      return score(a) - score(b)
    })
    for (const config of ordered) {
      const response = await Promise.race([
        window.api.llmConfigModelList(config.id),
        new Promise((resolve) => setTimeout(() => resolve({ success: false, items: [] }), 30_000))
      ])
      if (!response.success || !response.items?.length) continue
      const usable = response.items.filter(
        (item) =>
          !/embed|embedding|rerank|vision|image|tts|speech|audio/iu.test(item.id) &&
          /chat|deepseek|doubao|seed|pro|lite|gpt|qwen|kimi|glm/iu.test(item.id)
      )
      const preferred =
        usable.find((item) => item.id === 'deepseek-v4-flash') ||
        usable.find((item) => /deepseek-chat|chat/iu.test(item.id)) ||
        usable.find((item) => /doubao-seed-1-6|doubao.*pro/iu.test(item.id)) ||
        usable[0]
      if (preferred) {
        return { configId: config.id, configName: config.name, modelName: preferred.id }
      }
    }
    throw new Error('现有模型配置都无法提供可用的对话模型')
  })

const selectWorkspaceThroughUi = async (page) => {
  const workspaceSelect = page.locator('[data-testid="workbench-workspace-select"]')
  const selectedText = ((await workspaceSelect.textContent()) || '').trim()
  if (selectedText.includes(workspaceName)) return
  await workspaceSelect.click()
  const option = page
    .locator('.workbench-select-menu [role="option"], .workspace-quick-select-popup [role="option"]')
    .filter({ hasText: workspaceName })
    .first()
  await option.waitFor({ state: 'visible' })
  await option.click()
  await page.waitForFunction(
    ({ testId, expected }) => {
      const host = document.querySelector(`[data-testid="${testId}"]`)
      return host instanceof HTMLElement && host.textContent?.includes(expected)
    },
    { testId: 'workbench-workspace-select', expected: workspaceName }
  )
}

const selectModelThroughUi = async (page, modelName) => {
  const modelSelect = page.locator('[data-testid="workbench-model-select"]')
  const selectedText = ((await modelSelect.textContent()) || '').trim()
  if (selectedText.includes(modelName)) return
  await modelSelect.click()
  const rootMenu = page.locator('.workbench-select-menu.workbench-composer-menu').last()
  await rootMenu.getByRole('button', { name: /^主模型/u }).click()
  const modelMenu = page.locator('.workbench-select-menu.workbench-composer-menu').last()
  const search = modelMenu.locator('input[placeholder="搜索模型"]')
  await search.waitFor({ state: 'visible', timeout: 60_000 })
  await search.fill(modelName)
  const option = modelMenu.getByRole('option').filter({ hasText: modelName }).first()
  await option.waitFor({ state: 'visible', timeout: 60_000 })
  await option.click()
}

const bootstrap = await launchApp()
await bootstrap.app.close()

const persistentDbPath = persistentDbCandidates.find((candidate) => {
  try {
    const db = new Database(candidate, { readonly: true, nativeBinding })
    const count = Number(db.prepare('SELECT COUNT(*) AS count FROM llm_config').get().count)
    db.close()
    return count > 0
  } catch {
    return false
  }
})

if (!persistentDbPath) {
  throw new Error('没有找到本机已经配置好的真实模型，无法进行真实录制')
}

const tempDb = new Database(path.join(userDataDir, 'app.sqlite'), { nativeBinding })
tempDb.prepare('ATTACH DATABASE ? AS persistent').run(persistentDbPath)
tempDb.exec(`
  INSERT OR REPLACE INTO llm_config (id, name, providerKind, base_url, api_key)
  SELECT id, name, providerKind, base_url, api_key FROM persistent.llm_config;
`)
tempDb.exec(`
  INSERT OR REPLACE INTO llm_strategy_preference (
    config_id, model_name, preferred_transport, preferred_structured_output_mode, updated_at
  )
  SELECT config_id, model_name, preferred_transport, preferred_structured_output_mode, updated_at
  FROM persistent.llm_strategy_preference;
`)
tempDb.exec('DETACH DATABASE persistent')
tempDb.close()

const setup = await launchApp()
let model
let workspaceId
try {
  model = await chooseRealModel(setup.page)
  const seeded = await setup.page.evaluate(
    async ({ rootPath, modelInput, name }) => {
      const workspaceResponse = await window.api.workspaceCreate({ name })
      const nextWorkspaceId = workspaceResponse.workspace?.id
      if (!workspaceResponse.success || !nextWorkspaceId) {
        throw new Error(workspaceResponse.error || '创建演示工作空间失败')
      }
      const rootResponse = await window.api.workspaceSetRootPath({
        workspaceId: nextWorkspaceId,
        rootPath
      })
      if (!rootResponse.success) throw new Error(rootResponse.error || '绑定演示资料失败')
      window.localStorage.setItem('workbench.preference.workspace-id', nextWorkspaceId)
      window.localStorage.setItem('workbench.preference.ai-preference', 'local_sources_strict')
      window.localStorage.setItem(
        'workbench.preference.model',
        JSON.stringify({
          mainModel: { configId: modelInput.configId, modelName: modelInput.modelName },
          visionModel: null
        })
      )
      return { workspaceId: nextWorkspaceId }
    },
    { rootPath: workspaceDir, modelInput: model, name: workspaceName }
  )
  workspaceId = seeded.workspaceId
  const prepareResponse = await setup.page.evaluate(
    async (id) => await window.api.workspacePrepare({ workspaceId: id }),
    workspaceId
  )
  if (!prepareResponse.success) throw new Error(prepareResponse.error || '启动资料索引失败')
  await waitForFileJob(setup.page, workspaceId)
} finally {
  await setup.app.close()
}

const recording = await launchApp({ recordVideo: true })
const recordedVideo = recording.page.video()
const events = { launch: 0 }
let answerText = ''
let recordingError

try {
  const elapsed = () => (Date.now() - recording.launchedAt) / 1000
  await recording.page.reload()
  await recording.page.locator('[data-testid="workbench-page"]').waitFor({ state: 'visible' })
  const notice = recording.page.locator('[data-testid="workbench-llm-config-missing-notification"]')
  if (await notice.count()) {
    await notice.getByRole('button', { name: '稍后' }).click().catch(() => {})
  }
  await selectWorkspaceThroughUi(recording.page)
  await selectModelThroughUi(recording.page, model.modelName)

  const input = recording.page.locator('[data-testid="workbench-input"]')
  await input.waitFor({ state: 'visible' })
  await input.click()
  await recording.page.waitForTimeout(500)
  events.typingStart = elapsed()
  for (let offset = 0; offset < prompt.length; offset += 2) {
    await recording.page.keyboard.insertText(prompt.slice(offset, offset + 2))
    await recording.page.waitForTimeout(60)
  }
  await recording.page.waitForTimeout(700)

  const sendButton = recording.page.locator('[data-testid="workbench-send-button"]')
  await sendButton.waitFor({ state: 'visible' })
  if (await sendButton.isDisabled()) {
    throw new Error('真实模型或工作空间没有正确选中，发送按钮仍不可用')
  }
  events.submit = elapsed()
  await sendButton.click()

  const finalAnswer = recording.page
    .locator('[data-testid^="workbench-assistant-final-answer-"]')
    .last()
  const deadline = Date.now() + 600_000
  while (Date.now() < deadline) {
    const approve = recording.page.locator('[data-testid="chat-approval-batch-approve-button"]')
    if (await approve.count()) await approve.click().catch(() => {})
    if ((await finalAnswer.count()) > 0 && (await finalAnswer.textContent())?.trim()) break
    await recording.page.waitForTimeout(250)
  }
  if ((await finalAnswer.count()) === 0 || !(await finalAnswer.textContent())?.trim()) {
    throw new Error('真实 AI 查询没有在十分钟内完成')
  }

  events.answer = elapsed()
  await finalAnswer.scrollIntoViewIfNeeded()
  await recording.page.waitForTimeout(2200)
  answerText = ((await finalAnswer.textContent()) || '').replace(/\s+/g, ' ').trim()
  const compactAnswer = answerText.replace(/\s+/g, '')
  if (!compactAnswer.includes('张晨') || !compactAnswer.includes('7月25日')) {
    throw new Error(`真实回答没有命中预期答案：${answerText}`)
  }

  const sourceLink = finalAnswer.locator('.markdown-reference-link').first()
  await sourceLink.waitFor({ state: 'visible', timeout: 30_000 })
  events.sourceClick = elapsed()
  await sourceLink.click()
  await recording.page.locator('[data-testid="workbench-document-view"]').waitFor({
    state: 'visible'
  })
  events.sourceOpen = elapsed()
  await recording.page.waitForTimeout(2800)
  events.end = elapsed()
} catch (error) {
  recordingError = error
} finally {
  await recording.app.close()
}

if (!recordedVideo) throw new Error('Playwright 没有创建连续录屏')
const recordedPath = await recordedVideo.path()
const finalRecordingPath = path.join(outputDir, 'product-run.webm')
await rename(recordedPath, finalRecordingPath)

await writeFile(
  path.join(rawDir, 'capture-manifest.json'),
  `${JSON.stringify(
    {
      recording: finalRecordingPath,
      resolution: '1600x1000',
      continuousVideo: true,
      modelConfig: model.configName,
      modelName: model.modelName,
      workspaceId,
      prompt,
      sourceName,
      answerText,
      events
    },
    null,
    2
  )}\n`,
  'utf8'
)

if (recordingError) throw recordingError

console.log(`真实模型：${model.configName} / ${model.modelName}`)
console.log(`真实回答：${answerText}`)
console.log(`连续录屏：${finalRecordingPath}`)
