# NCurator-Desktop Canonical Source 说明

## 1. 默认入口与层级

- `doc/` 是默认工程入口
- `doc/architecture/*` 负责当前架构真相源
- `doc/conventions/*` 负责工程约定与全局规则展开
- `doc/testing/*` 负责测试架构、阶段计划与持续汇总
- `doc/reference/*` 负责阅读路径、canonical source 与变更清单
- `openspec/` 负责变更设计、规格与历史沉淀，不是默认阅读入口

## 2. 主题与真相源

| 主题 | 默认文档入口 | 代码真相源 | 说明 |
| :--- | :--- | :--- | :--- |
| 系统总览 | `doc/architecture/system-overview.md` | `src/main/**`、`src/renderer/**`、`src/shared/**` | 用于建立整体边界认知 |
| 目录规范 | `doc/architecture/project-structure.md` | `src/`、`tests/` 实际目录结构 | 目录与文件放置规则以当前代码树为准 |
| AI 架构 | `doc/architecture/ai/README.md` | `src/main/services/ai/*`、`src/shared/types.ts` | 文档不足时按 graph/node/state/tools 核对 |
| 数据库 / 存储 | `doc/architecture/database.md` | `src/main/services/storage/core/LanceDbCore.ts`、`src/main/services/storage/StorageService.ts`、`src/main/services/storage/domains/*.ts` | 文档未覆盖时以 storage code 为最终真相源 |
| 类型治理 | `doc/conventions/type-governance.md` | `src/shared/**`、`src/main/**/types.ts`、`src/renderer/src/**/types.ts` | 关注类型归属与边界收敛 |
| UI 样式 | `doc/conventions/ui-style.md` | `src/renderer/src/**` | 文档规范优先，具体实现以现有 design language 为准 |
| 测试体系 | `doc/testing/README.md` | `tests/**`、`tests/catalog/current-cases.json`、测试配置文件 | 当前 active case 以 catalog 为准；`tests/report/**` 只保存历史证据 |

## 3. 冲突处理

当文档与当前实现冲突时：

1. 先按本表定义的代码真相源核对
2. 在当前变更中同步修正文档
3. 若影响入口路径或 canonical 定义，同时更新 skill 与 [AGENTS.md](/Users/test/work-space/NCurator-Desktop/AGENTS.md)
