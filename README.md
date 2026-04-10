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
- `MVP 0 / MVP 1 / MVP 2 / MVP 3` 已完成，当前默认按 clean portable 发布、用户本地导入简历、首包模板为空的口径继续演进

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

### 5. 桌面 MVP 2 / MVP 3 入口

当前桌面链路已经具备：

- `src-tauri/` 最小桌面壳骨架
- `beforeDevCommand = npm run desktop:dev:server`
- 开发态会先准备桌面运行目录，再拉起本地服务
- 桌面运行日志、导出与调试 session 默认落到 `LocalAppData/ResumeInterviewWorkbench`
- 数据库准备顺序为：优先复用现有 `DATABASE_URL`，其次尝试桌面托管 PostgreSQL，最后在开发环境允许时回退 Docker
- 托管 PostgreSQL runtime 约定放在 `src-tauri/resources/postgres/windows-x64`
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

如果只想单独验证桌面服务 bootstrap，而不启动 Tauri 窗口，可以运行：

```bash
npm run desktop:dev:server
```

桌面版从这一轮开始默认采用“干净发布包”策略：

- 打包产物不再携带开发者自己的 `resume-package/` 数据
- 打包产物默认也不携带任何公司模板，发布包内不再分发 `interview-kit/templates/`
- 桌面运行态默认关闭文件模板导入，用户看到的模板只来自他自己后续创建和保存的数据
- 首次启动后，运行时会在 `LocalAppData/ResumeInterviewWorkbench/workspace/resume-package/` 维护用户自己的简历工作区
- 工作台左侧候选人面板新增“导入简历”入口，可一次选择 `resume.json`、`resume.meta.json`、`resume.schema.json` 写入本地工作区
- 再次导入时会整体覆盖工作区中的旧简历文件，避免新旧简历混用

如果你已经有一份可用的 PostgreSQL 安装目录或解压目录，可以先把 runtime 导入桌面分发资源目录：

```bash
npm run desktop:postgres:vendor -- --source "C:\\path\\to\\PostgreSQL\\17"
```

导入后，`desktop:doctor` 会看到 `bundledPostgresRuntime`，桌面 bootstrap 也会优先尝试真正的本地托管模式。

如果你希望直接从官方 installer 自动准备完整 runtime（包含 `pgvector` 编译与 vendor），可以运行：

```bash
npm run desktop:postgres:prepare
```

这条脚本当前会：
- 下载 PostgreSQL Windows installer 到 `.desktop-cache/`
- 用 `--extract-only` 解出 runtime
- 拉取并编译 `pgvector`
- 把最终结果放到 `src-tauri/resources/postgres/windows-x64`

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
| `npm run desktop:doctor` | 检查 Tauri、桌面数据目录、数据库可达性与托管 PostgreSQL runtime 发现结果 |
| `npm run desktop:dev:server` | 仅启动桌面开发态 bootstrap，准备本地数据库与 Node 服务 |
| `npm run desktop:postgres:prepare` | 自动下载、提取并编译可用于桌面托管的 PostgreSQL + pgvector runtime |
| `npm run desktop:postgres:vendor -- --source <dir>` | 把 PostgreSQL runtime 导入到 `src-tauri/resources/postgres/windows-x64` |
| `npm run desktop:dev` | 启动 Tauri 桌面窗口，开发态加载新的桌面 bootstrap 服务链路 |
| `npm run desktop:build:release` | 生成干净的 portable 发布目录与 zip 压缩包，并校验不携带开发者本地简历数据 |
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

### Desktop

| 变量 | 说明 |
| --- | --- |
| `DESKTOP_DATA_DIR` | 桌面运行时数据根目录，默认指向 `%LocalAppData%/ResumeInterviewWorkbench` |
| `DESKTOP_DATABASE_MODE` | 桌面数据库模式：`auto` / `managed` / `external` |
| `DESKTOP_POSTGRES_BIN_DIR` | 托管 PostgreSQL 二进制目录，包含 `initdb`、`pg_ctl`、`pg_isready` |
| `DESKTOP_POSTGRES_PORT` | 托管 PostgreSQL 端口，默认 `55432` |
| `DESKTOP_ALLOW_DOCKER_FALLBACK` | 开发态是否允许在托管 runtime 缺失时回退 Docker |

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
│  └─ templates/               # 开发态模板输入样例，不进入默认桌面发布包
├─ desktop-seed/               # 桌面版初始化种子资源，不携带个人简历数据
├─ resume-package/             # 结构化简历输入包
├─ scripts/                    # Windows 启动与本地环境辅助脚本
├─ src-tauri/                  # Tauri 桌面壳工程
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

同时补充两条当前主线约定：

- 桌面发布包默认采用“干净发布包”策略，不携带开发者个人 `resume-package/` 数据，也不内置公司模板目录。
- 默认模板为空时，界面占位文案、示例模板和文档案例必须保持中性，不使用真实公司、产品、人员、地点或其他可识别信息。

## Desktop MVP 3 补充

当前打包态桌面链路已经补上这些能力：

- release 模式下先加载内置 launcher，再由 Rust 壳拉起本地 Node 服务
- 打包态 Node runtime 约定放在 `src-tauri/resources/node/windows-x64`
- 打包态 app runtime 约定放在 `src-tauri/resources/app-runtime`
- 打包态 app runtime 现在只携带 `desktop-seed/`，不再直接携带开发者本地 `resume-package/`
- 打包态 app runtime 只携带 `interview-kit/jobs` 与 `interview-kit/roles`，默认不分发公司模板目录
- 工作台内已新增 `portable runtime` 面板，可查看数据目录并清理 `cache / tmp / logs / exports / config`

准备 packaged portable 版本时，推荐顺序如下：

```bash
npm run desktop:postgres:prepare
npm run desktop:node:vendor
npm run desktop:app-runtime:vendor
npm run desktop:build:portable
```

如果希望直接产出可分发的“干净发布包”，推荐改用：

```bash
npm run desktop:build:release
```

这条命令会额外执行下面几步：

- 输出带时间戳的 portable 目录
- 校验发布包中不存在 `resources/app-runtime/resume-package`
- 校验发布包中不存在 `resources/app-runtime/interview-kit/templates`
- 校验 `desktop-seed/resume-package/README.md` 已正确带入
- 生成同名 `.zip`，便于直接分发测试

默认输出目录：

```text
.desktop-dist/ResumeInterviewWorkbench-portable-win-x64/
```
## Desktop MVP 3 收尾说明

这一轮收尾后，portable 桌面链路额外具备了下面几项工程化能力：

- 打包态启动页不再只是静态占位，而是会按“检查资源 -> 启动本地服务 -> 等待工作台就绪 -> 进入工作台”的步骤反馈状态
- 工作台内的 `portable runtime` 面板新增“删除全部本地数据”危险操作，但不会在运行中直接删除数据库目录，而是写入 reset marker，并在下次启动时执行完整清理
- 打包态桌面壳会把启动轨迹写入 `LocalAppData/ResumeInterviewWorkbench/logs/desktop-launcher.log`
- 打包态 Node backend 的 stdout / stderr 会分别落到 `desktop-backend.log` 与 `desktop-backend.error.log`
- `npm run desktop:build:portable` 在默认 portable 输出目录已存在且可能被占用时，会自动落到带时间戳的新目录，避免 Windows 文件锁打断连续打包
- `npm run desktop:build:release` 会固定执行“干净发布包”校验，并产出可直接分发的 zip 压缩包
- 用户自己的简历数据统一通过工作台导入到 `LocalAppData/ResumeInterviewWorkbench/workspace/resume-package/`，不再跟随发布包一起分发
- 公司模板默认留在开发态或后续导入链路中管理，不再作为桌面发布包的内置数据

当前推荐的 portable 验证顺序：

```bash
npm run desktop:build:release
```

然后检查控制台打印出的 `portableDir=` 与 `zipPath=`，直接运行该目录下的：

```text
resume-interview-workbench-desktop.exe
```

如果启动异常，优先查看：

```text
%LocalAppData%/ResumeInterviewWorkbench/logs/desktop-launcher.log
%LocalAppData%/ResumeInterviewWorkbench/logs/desktop-backend.log
%LocalAppData%/ResumeInterviewWorkbench/logs/desktop-backend.error.log
```
