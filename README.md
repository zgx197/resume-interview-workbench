# Resume Interview Workbench

<div align="center">

# Resume Interview Workbench

面向结构化简历输入、题库资产化、复习闭环与语义检索的本地 AI 面试工作台

Question Bank · Review Loop · PostgreSQL · pgvector · Runtime Read Model

![status](https://img.shields.io/badge/status-Phase%204%20completed-2ea44f)
![runtime](https://img.shields.io/badge/runtime-database__only-0969da)
![database](https://img.shields.io/badge/database-PostgreSQL%20%2B%20pgvector-336791)
![frontend](https://img.shields.io/badge/ui-Local%20Web%20Workbench-8250df)
![license](https://img.shields.io/badge/license-Apache--2.0-orange)

</div>

## 项目概览

| 维度 | 说明 |
| --- | --- |
| 核心定位 | 围绕“结构化简历 + 岗位要求 + 面试官角色”构建可观察、可追问、可复盘、可复习的本地 AI 面试工作台 |
| 当前状态 | 数据库架构 Phase 4 已完成，PostgreSQL 已成为默认业务真相源 |
| 核心能力 | 模板管理、题库资产系统、结构化运行态、后台任务、弱项复习域、向量检索 |
| 运行模式 | 默认 `database_only`，文件层仅保留 debug / export / backfill 职责 |
| 桌面化方向 | `Tauri` 主线，优先采用 Windows portable 形态，运行数据放 `LocalAppData`，数据清理由程序内功能负责 |
| 技术基座 | Node.js、PostgreSQL、pgvector、原生 SQL migration、SSE、本地 Web UI |
| 目标对象 | 需要基于真实简历与岗位背景做模拟面试、复盘和能力补强的个人开发者与团队 |

> 如果你第一次进入这个仓库，建议先看“快速导航”和“本地运行”两节。

## 快速导航

- [这是什么](#这是什么)
- [当前实现状态](#当前实现状态)
- [为什么这个项目不是普通聊天机器人](#为什么这个项目不是普通聊天机器人)
- [核心架构](#核心架构)
- [本地运行](#本地运行)
- [常用命令](#常用命令)
- [环境变量](#环境变量)
- [仓库结构](#仓库结构)
- [设计文档](#设计文档)
- [开发约定](#开发约定)

## 这是什么

Resume Interview Workbench 不是一个泛用聊天界面，而是一套围绕面试流程设计的本地 AI 工作台。

它的重点不是“聊得像”，而是：

- 根据结构化简历、岗位和角色配置做定向出题
- 在多轮追问中保留主题线程、证据和运行态上下文
- 将低分回答沉淀为 review item，并进入复习闭环
- 将模板、题目、知识片段、弱项条目沉淀为可持续复用的资产
- 通过结构化过滤、向量召回和重排提升出题与推荐质量

## 当前实现状态

当前主线已经完成数据库化收尾，计划文档与代码状态已重新对齐。

| Phase | 状态 | 说明 |
| --- | --- | --- |
| Phase 0 | 已完成 | PostgreSQL、pgvector、Docker Compose、迁移体系已落地 |
| Phase 1 | 已完成 | DB Client、Repository 边界与主仓储接口已形成 |
| Phase 2 | 已完成 | 模板、题库、review、knowledge、embedding、jobs 已接入数据库主路径 |
| Phase 3 | 已完成 | session / turn / assessment / report 已完成数据库主写与回填 |
| Phase 4 | 已完成 | 结构化 read model 已主导读路径，文件层已降级 |

当前已具备的核心工程能力：

- `question_items`、`question_variants`、`question_usage_stats` 组成的题库资产系统
- `review_items`、`review_item_attempts`、`review_sets`、`review_set_items` 组成的复习域骨架
- `knowledge_documents`、`knowledge_embeddings` 驱动的 embedding 写入与相似检索
- `background_jobs` 驱动的 lease、retry、timeout recovery 与汇总观测
- session 列表、摘要、恢复入口等结构化 read model 读路径

桌面化当前口径：

- 桌面主线选择 `Tauri`
- 第一阶段发布形态选择 Windows portable，而不是安装器
- 程序目录解压即用，运行时数据写入 `LocalAppData`
- 缓存、日志、设置与全部本地数据清理由程序内按钮负责
- `MVP 0` 已落地最小 `src-tauri/` 骨架与桌面开发脚本

## 为什么这个项目不是普通聊天机器人

这个项目的设计重点一直是“面试系统”，不是“对话壳子”。

它和普通聊天机器人的核心差异在于：

- 输入不是一段自由文本，而是结构化简历包与岗位配置
- 运行过程不是单轮问答，而是有 topic thread、plan、assessment、report 的完整状态机
- 结果不是聊天记录，而是题库资产、review 条目、报告与知识库沉淀
- 检索不是单次向量搜索，而是“结构化过滤 + 向量召回 + 重排”的策略链路

## 核心架构

当前项目可以把主系统看成四层：

| 层 | 职责 |
| --- | --- |
| Runtime Layer | 承载 session、turn、assessment、report、resumePendingSessions 等运行态 |
| Asset Layer | 承载 template、question bank、review、knowledge document 等长期资产 |
| Retrieval Layer | 统一做结构化过滤、向量召回、重排与降级 |
| Job Layer | 承载 plan refresh、report、embedding 等异步任务与恢复机制 |

当前数据库职责边界：

- PostgreSQL：业务真相源、结构化读模型、后台任务状态、题库与复习资产
- pgvector：题目、review、知识片段等语义单元的向量检索
- JSONL：日志、调试、排障与导出，不再作为主业务存储

## 本地运行

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，然后至少补齐模型与 embedding 配置。

最小示例：

```env
DATABASE_URL=postgresql://resume_interview_workbench:resume_interview_workbench@127.0.0.1:5432/resume_interview_workbench
AI_PROVIDER=moonshot
MOONSHOT_API_KEY=your_moonshot_key
EMBEDDING_PROVIDER=openai_compatible
EMBEDDING_API_KEY=your_embedding_key
```

默认运行模式已经是：

```env
INTERVIEW_RUNTIME_STORAGE_MODE=database_only
```

### 3. 一键准备本地环境

Windows 推荐直接运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-local.ps1
```

这条命令会依次执行：

1. 启动本地 PostgreSQL 容器
2. 执行数据库迁移
3. 运行 `npm run check`

如果只想单独检查：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-local.ps1 -Task check
```

### 4. 启动工作台

```bash
npm run dev
```

默认行为：

- 启动本地服务
- 等待健康检查通过
- 自动打开浏览器并访问 `http://127.0.0.1:3000`

Windows 也可以直接使用：

```powershell
.\scripts\dev.ps1
```

如果不希望自动打开浏览器：

```bash
npm run dev -- --no-open
```

### 5. 桌面 MVP 0 入口

桌面 MVP 0 当前包含：

- `src-tauri/` 最小桌面壳骨架
- `beforeDevCommand = npm run dev:no-open`
- 开发态桌面窗口直接加载本地 `http://127.0.0.1:3000`
- Windows 包装脚本：`scripts/desktop.ps1`、`scripts/desktop.cmd`

检查桌面前置环境：

```bash
npm run desktop:doctor
```

或在 Windows 下运行：

```powershell
.\scripts\desktop.ps1 -Doctor
```

如果已经准备好 Rust / Cargo 与 Tauri CLI，则可以启动桌面壳：

```bash
npm run desktop:dev
```

首次执行 `npm run desktop:dev` 时，Rust/Tauri 依赖编译可能会明显更慢，这是正常现象；后续增量编译通常会快很多。

或在 Windows 下运行：

```powershell
.\scripts\desktop.ps1
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run setup:local` | 一键启动数据库、执行迁移并跑基础检查 |
| `npm run check` | 校验简历包、配置与基础运行链路 |
| `npm run db:up` | 启动本地 PostgreSQL 容器 |
| `npm run db:migrate` | 执行数据库迁移 |
| `npm run db:doctor` | 检查数据库可达性与基本环境 |
| `npm run db:backfill:sessions` | 回填历史 session 到数据库 |
| `npm run dev` | 启动本地 Web 工作台 |
| `npm run desktop:doctor` | 检查 Tauri MVP 0 所需的 Rust/Cargo、CLI 依赖与桌面工程骨架 |
| `npm run desktop:dev` | 启动 Tauri MVP 0 桌面窗口，开发态加载本地服务 |
| `npm run test:kimi` | 测试 Moonshot / Kimi 模型接入 |
| `npm run test:kimi-search` | 测试 Kimi 搜索工具链路 |
| `npm run smoke:session` | 跑通一轮本地面试烟雾测试 |
| `npm run smoke:session-search` | 跑通启用搜索的面试烟雾测试 |

## 环境变量

README 只保留最常用变量，完整示例请查看 [`.env.example`](./.env.example)。

### 数据库

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `DATABASE_POOL_MAX` | 连接池大小 |
| `DATABASE_DOCKER_SERVICE` | Docker Compose 中数据库服务名 |

### 主模型

| 变量 | 说明 |
| --- | --- |
| `AI_PROVIDER` | 当前默认主模型提供方 |
| `MOONSHOT_API_KEY` | Moonshot API Key |
| `MOONSHOT_MODEL` | 默认主模型，当前默认 `kimi-k2.5` |
| `MOONSHOT_BASE_URL` | Moonshot 接口地址 |

### Embedding

| 变量 | 说明 |
| --- | --- |
| `EMBEDDING_PROVIDER` | embedding provider，当前默认 `openai_compatible` |
| `EMBEDDING_API_KEY` | embedding API Key |
| `EMBEDDING_MODEL` | embedding 模型，当前默认 `text-embedding-v4` |
| `EMBEDDING_BASE_URL` | embedding 接口地址 |
| `EMBEDDING_SYNC_ON_WRITE` | 是否在写入时同步生成向量 |

### 运行模式

| 变量 | 说明 |
| --- | --- |
| `INTERVIEW_RUNTIME_MODE` | 面试运行模式 |
| `INTERVIEW_RUNTIME_STORAGE_MODE` | 存储模式，默认 `database_only` |
| `SESSION_DIR` | 文件导出与回填目录，不再是主存储 |

## 仓库结构

```text
.
├─ app/
│  ├─ server/                  # Node.js 服务、仓储层、运行态、任务、provider 接入
│  └─ web/                     # 本地 Web 工作台
├─ docs/                       # 架构、数据库、观测、提交流程文档
├─ interview-kit/
│  ├─ jobs/                    # 岗位配置
│  ├─ roles/                   # 面试官角色配置
│  └─ templates/               # 模板输入样例
├─ resume-package/             # 结构化简历输入包
├─ scripts/                    # Windows 启动与本地环境辅助脚本
├─ src-tauri/                  # Tauri MVP 0 桌面壳骨架
├─ sessions/                   # debug/export/backfill 用的文件目录
├─ docker-compose.yml
├─ .env.example
└─ README.md
```

## 设计文档

- [Tauri 桌面化落地方案（portable 优先）](./docs/desktop-tauri-plan.md)
- [数据库与知识检索架构落地方案](./docs/database-architecture-plan.md)
- [面试引擎重构设计](./docs/interview-engine-redesign.md)
- [日志与可观测性设计](./docs/logging-observability-design.md)
- [提交命名与 UTF-8 + LF 规范](./docs/commit-convention.md)

## 开发约定

- 所有提交统一使用“前缀 + 中文说明”
- 仓库文本文件统一使用 `UTF-8 + LF`
- 默认运行模式为 `database_only`
- 文件层仅保留 debug / export / backfill 职责
- 不在仓库中提交真实 API Key，只保留 `.env.example`

## 后续维护原则

后续 README 应及时反映三类变化：

- 主运行模式是否变化
- 关键架构阶段是否完成
- 本地启动方式和环境变量是否变化

如果代码状态已经变化，但 README 还停留在旧阶段，应优先更新 README，而不是让新成员去猜当前主线状态。
