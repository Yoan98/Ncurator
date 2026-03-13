# NCurator-Desktop 文档 / Skill 变更清单

每次新增、重命名或重构 canonical 文档时，至少检查以下项目：

## 1. 文档层

- 这份文档属于 `architecture / conventions / testing / reference` 中哪一层
- 是否改变了默认阅读入口
- 是否替换了现有 canonical 文档
- 是否需要同步 `doc/README.md`
- 是否需要同步 `doc/reference/source-of-truth.md`
- 若变更涉及测试治理或当前 case 读取入口，是否需要同步 `tests/catalog/**` 的说明与链接

## 2. Skill 层

- 哪个 `.codex/skills/*/SKILL.md` 会路由到这里
- skill 的 `description` 是否仍覆盖新场景
- skill 的首读入口和二级展开顺序是否仍正确
- 是否需要让相关 skill 额外联动 `Doc-Governance`

## 3. AGENTS 层

- 是否改变了全局硬规则
- 是否改变了默认文档路径
- 是否改变了任务触发时必须先读的入口

## 4. 规格与历史

- active `openspec/specs/*` 是否仍指向正确 canonical 文档
- 历史设计是否应继续留在 `openspec`，而不是迁回 `doc/`

## 5. 最终验收

- 旧路径不再作为默认入口
- `doc`、skill、AGENTS 三方表述一致
- 新增文档能在 `doc/README.md` 中被找到
- 若主题是测试体系，确认 AI 读取当前 case 时会先到 `tests/catalog/current-cases.json`，而不是 `tests/report/**`
