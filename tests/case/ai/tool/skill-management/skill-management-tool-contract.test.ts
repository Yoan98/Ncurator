import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { UserSkillService } from '../../../../../src/main/services/skills/UserSkillService'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  createSkillManagementToolHarness,
  createTextFileToolHarness
} from '../../../../harness/backend/aiToolHarness'

describe('Skill synchronization real tools', () => {
  it(
    'skill-sync-and-current-partner-binding',
    async () =>
      runBackendCase({
        caseId: 'skill-sync-and-current-partner-binding',
        harnessMode: 'tool-real',
        domain: 'ai',
        suite: 'tool',
        groups: ['skill-management'],
        fixtures: [],
        runMode: 'single',
        description: '真实只读状态、原位同步、当前伙伴绑定、损坏停用和大清单文件续读。',
        execute: async (runtime) => {
          for (const id of ['a', 'b'])
            await runtime.partnerStore.savePartner({
              id,
              name: id,
              avatar_shape: 'circle',
              avatar_color: 'blue',
              created_at: 1,
              updated_at: 1,
              last_viewed_at: 1,
              pinned: false,
              pinned_at: null
            })
          const service = new UserSkillService(
            runtime.storageService.userSkill,
            path.join(runtime.workspaceRoot, 'skills')
          )
          const tools = createSkillManagementToolHarness(runtime, {
            partnerId: 'a',
            userSkillService: service
          })
          const reader = createTextFileToolHarness(runtime, { partnerId: 'a' })
          const directory = path.join(service.getRootDirectory(), 'report')
          await fs.mkdir(path.join(directory, 'scripts'), { recursive: true })
          const markdown = (body: string, description = 'Report') =>
            `---\nname: report\ndescription: ${description}\nlicense: MIT\n---\n${body}`
          await fs.writeFile(path.join(directory, 'SKILL.md'), markdown('Initial'))
          const script = path.join(directory, 'scripts/report.py')
          await fs.writeFile(script, 'raise Exception("must not execute on sync")', { mode: 0o751 })
          const beforeStatus = await tools.invoke('skill_sync', { action: 'status' })
          const noWrites = service.list().length === 0
          const created = await tools.invoke('skill_sync', {
            action: 'sync',
            name: 'report',
            enabled: true
          })
          const original = service.list()[0]
          const other = service.create({ name: 'other', description: 'Keep', body: 'Keep' })
          service.setEnabled('a', [other.id, original.id])
          service.setEnabled('b', [original.id])
          await fs.writeFile(
            path.join(directory, 'SKILL.md'),
            markdown('Updated', 'Updated description')
          )
          await tools.invoke('skill_sync', { action: 'sync', name: 'report' })
          const updated = service.list().find((item) => item.name === 'report')!
          const detail = await reader.invoke('text_file_read', {
            sourcePath: path.join(directory, 'SKILL.md')
          })
          const status = await tools.invoke('skill_sync', { action: 'status', name: 'report' })
          await fs.writeFile(path.join(directory, 'SKILL.md'), 'invalid')
          const error = await tools.invoke('skill_sync', { action: 'sync', name: 'report' }).then(
            () => '',
            (reason: Error) => reason.message
          )
          const disabled = await tools.invoke('skill_sync', {
            action: 'sync',
            name: 'report',
            enabled: false
          })
          const a = service.listEnabled('a').map((item) => item.id)
          const b = service.listEnabled('b').map((item) => item.id)
          service.setEnabled('b', [])
          await fs.writeFile(
            path.join(directory, 'SKILL.md'),
            markdown(
              Array.from({ length: 1000 }, (_, i) => `${i} ${'x'.repeat(75)}`).join('\n') +
                '\nTAIL-MARKER'
            )
          )
          await tools.invoke('skill_sync', { action: 'sync', name: 'report' })
          const tail = await reader.invoke('text_file_read', {
            sourcePath: path.join(directory, 'SKILL.md'),
            startLine: 990,
            lineCount: 20
          })
          for (let index = 0; index < 800; index++)
            service.create({
              name: `catalog-${String(index).padStart(4, '0')}-${'x'.repeat(48)}`,
              description: 'Keep',
              body: 'Read'
            })
          const list = await tools.invoke<{ filePath: string }>('skill_sync', { action: 'status' })
          const listed = await reader.invoke('text_file_read', {
            sourcePath: list.filePath,
            startLine: 790,
            lineCount: 20
          })
          return {
            beforeStatus,
            noWrites,
            created,
            original,
            updated,
            detail,
            status,
            error,
            disabled,
            a,
            b,
            other: other.id,
            tail,
            listed,
            mode: (await fs.stat(script)).mode & 0o777,
            events: runtime.eventCollector
              .snapshot()
              .filter((event) => event.type === 'tool_call_result')
          }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(
            JSON.stringify(result.beforeStatus) === '[]' &&
              result.noWrites &&
              result.original.id === result.updated.id &&
              result.updated.description === 'Updated description' &&
              JSON.stringify(result.detail).includes('license: MIT') &&
              JSON.stringify(result.status).includes('"enabled":true'),
            {
              name: 'read-only-status-and-directory-roundtrip',
              message: '查询无写入；原位同步保留身份与未知 YAML，文件由实际读取工具读取。'
            }
          )
          runtime.assertThat(
            result.a.join() === result.other &&
              result.b.join() === result.original.id &&
              result.error.includes('frontmatter') &&
              JSON.stringify(result.disabled).includes('not synced') &&
              (process.platform === 'win32' || result.mode === 0o751),
            {
              name: 'current-partner-and-broken-directory',
              message: '只停用当前伙伴单项，保留其他配置；目录错误明确反馈，权限不变且不执行脚本。'
            }
          )
          runtime.assertThat(
            JSON.stringify(result.tail).includes('TAIL-MARKER') &&
              JSON.stringify(result.listed).includes('catalog-0799') &&
              result.events.some(
                (event) => event.type === 'tool_call_result' && event.result?.ok === false
              ),
            {
              name: 'large-real-file-reads',
              message: '长正文和超长状态清单通过真实文本读取工具续读，失败事件与实际错误一致。'
            }
          )
        }
      }),
    120_000
  )
})
