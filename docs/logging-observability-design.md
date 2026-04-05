# 日志与可观测性设计文档

## 1. 文档目的

本文档用于为 `resume-interview-workbench` 设计一套统一、可执行、可渐进落地的日志与可观测性方案。

这套方案的目标不是简单增加更多 `console.log`，而是建立一套能够回答以下问题的运行时观测体系：

- 一次面试交互到底慢在什么阶段
- 热路径上每个关键步骤分别耗时多少
- 后台任务为什么延迟，阻塞点在哪里
- 前端体感慢是因为服务端慢、SSE 更新慢，还是渲染慢
- 某次异常发生时，能否用统一链路快速还原上下文

后续实现原则：

- 先统一事件模型和埋点边界，再逐步扩展日志覆盖面
- 优先覆盖热路径和跨边界调用，不追求一次性记录所有函数
- 所有日志都必须可检索、可聚合、可脱敏
- 任何日志能力都不能明显拖慢现有交互路径

---

## 2. 背景与当前问题

当前仓库已经具备一套可运行的本地面试工作台，后端有明确的会话状态机，前端也有 SSE 驱动的实时调试视图。

现状中的可观察性基础包括：

- `session.currentRun` 已能表达当前 run、phase、phaseStatus
- `backgroundJobs` 已能表达 `plan_refresh`、`thread_summary`、`report` 等冷路径任务
- 前端已有图谱区、报告区、后台任务总览等调试面板
- 少量 `console.log` / `console.error` 已存在于启动、恢复会话、后台任务异常等位置

但这些信息仍然不构成一套完整日志系统，主要问题如下。

### 2.1 当前主要缺口

1. 缺少统一日志入口  
   目前日志分散在少量 `console.log` / `console.error` 中，没有统一字段，没有统一事件命名，也没有统一输出目标。

2. 缺少链路级关联 ID  
   一次请求涉及 `request -> session -> run -> phase -> backgroundJob -> SSE -> render` 多个环节，但当前缺少统一的 `requestId / runId / jobId` 关联能力。

3. 缺少耗时型埋点  
   现有状态机能表达“执行到了哪里”，但还不能直接回答“哪一段最慢”“哪一类模型调用最慢”“保存 session 是不是变成瓶颈”。

4. 缺少统一的事件语义  
   例如模型调用、后台任务、文件持久化、SSE 推送都属于跨边界事件，但当前并没有统一的事件分类和字段 schema。

5. 缺少脱敏与日志等级边界  
   如果后续直接记录完整 prompt、完整回答、完整模板，很容易造成日志泄露与噪声膨胀。

6. 缺少前后端统一分析视角  
   前端体感慢未必等于服务端慢，但当前无法把后端 phase 耗时和前端渲染耗时放在同一条链路上观察。

### 2.2 根本判断

当前系统真正缺的不是“更多输出”，而是“结构化观测”。

如果继续依赖零散 `console.log`：

- 日志量会快速失控
- 无法按 session / run / job 聚合分析
- 无法量化慢点，只能主观猜测
- 日志本身反而会成为额外性能负担

因此需要从“打印文本日志”升级为“结构化事件日志 + span 耗时 + 统一上下文”的方案。

---

## 3. 设计目标

### 3.1 核心目标

1. 可还原完整链路  
   任意一次面试请求，都应该能从日志中还原其请求进入、状态推进、模型调用、落盘、推送和前端消费过程。

2. 可量化性能瓶颈  
   所有热路径关键步骤都要具备明确耗时信息，支持识别最慢阶段、最慢调用、最慢后台任务。

3. 可按实体聚合  
   日志必须支持按 `sessionId`、`runId`、`threadId`、`jobId`、`requestId` 检索。

4. 可安全落盘  
   默认不记录完整敏感内容，支持摘要化、脱敏化和按级别开关控制。

5. 可逐步落地  
   第一阶段先覆盖后端热路径，后续再扩展到前端、调试面板、聚合分析。

### 3.2 非目标

以下内容不作为本轮设计的直接目标：

- 接入外部 APM 平台
- 多机分布式 trace 传播
- 引入数据库级日志分析系统
- 构建复杂权限体系
- 覆盖每一个纯函数 / 工具函数

---

## 4. 设计原则

### 4.1 事件优先，文本次之

日志的核心是结构化字段，而不是自然语言 message。

应该优先保证：

- 事件名稳定
- 字段语义固定
- 关联 ID 完整
- 耗时字段可比较

### 4.2 只记录关键边界与关键状态

不应记录所有方法调用，而应聚焦三类点位：

- 跨边界调用
- 状态变更节点
- 高耗时节点

### 4.3 热路径最小侵入

日志系统本身不能成为新的性能瓶颈，因此：

- 默认同步逻辑尽量轻
- 落盘采用追加写入与批量刷新
- 大 payload 采用摘要而非全文
- 允许通过环境变量动态调整级别

### 4.4 默认脱敏

完整回答、完整 prompt、完整模板、完整简历都不应默认写入日志文件。

日志默认只保留：

- 长度
- hash
- 预览摘要
- 结构化引用计数

### 4.5 观测与产品分层

日志系统是调试能力，不是产品功能。  
前端调试视图可以消费日志摘要，但不应直接把内部说明暴露在面向用户的主界面里。

---

## 5. 目标架构概览

目标方案由六层组成：

1. `Logger Core`
2. `Execution Context`
3. `Span Instrumentation`
4. `Log Sinks`
5. `Aggregation View`
6. `Debug Surface`

### 5.1 Logger Core

统一负责：

- 生成标准日志 envelope
- 处理等级过滤
- 合并上下文字段
- 调用 sink 输出

建议新增模块：

- `app/server/lib/logger.js`

### 5.2 Execution Context

统一维护一条链路上的上下文信息，例如：

- `requestId`
- `sessionId`
- `runId`
- `threadId`
- `jobId`
- `turnIndex`
- `component`

建议通过显式上下文对象向下传递，不依赖隐式全局状态。

建议新增模块：

- `app/server/lib/log-context.js`

### 5.3 Span Instrumentation

统一表达耗时型操作。

典型用法：

- `startSpan("provider.chat_completion", context)`
- `span.end(meta)`
- `span.fail(error, meta)`

建议新增模块：

- `app/server/lib/span.js`

### 5.4 Log Sinks

日志输出建议支持双通道：

1. 控制台 pretty 输出  
   用于本地开发实时观察

2. JSONL 文件落盘  
   用于后续检索、回放、聚合分析

建议新增模块：

- `app/server/lib/log-sinks.js`

### 5.5 Aggregation View

后续可以在服务端维护轻量级统计：

- 最近 N 次最慢 span
- 某类 provider 调用平均耗时
- 某 session 最近事件时间线

第一版不要求完整实现，可先保留接口。

### 5.6 Debug Surface

前端调试区后续可增加：

- 最近链路时间线
- 当前 session 最近日志摘要
- 最慢阶段统计
- provider 调用统计

这部分属于后续阶段能力，不作为第一批落地阻塞项。

---

## 6. 日志数据模型

### 6.1 标准日志结构

所有日志都应统一为以下 envelope：

```json
{
  "ts": "2026-04-06T12:34:56.789Z",
  "level": "info",
  "component": "interview-service",
  "event": "run.phase.completed",
  "requestId": "req_123",
  "sessionId": "session_xxx",
  "runId": "answer_abc",
  "threadId": "thread_001",
  "jobId": "session_xxx:report:session",
  "turnIndex": 3,
  "durationMs": 182,
  "meta": {
    "phase": "observe",
    "status": "ok"
  },
  "error": null
}
```

### 6.2 顶层字段说明

| 字段 | 含义 | 是否必填 |
| --- | --- | --- |
| `ts` | ISO 时间戳 | 是 |
| `level` | `trace/debug/info/warn/error` | 是 |
| `component` | 组件名，例如 `server`、`interview-service` | 是 |
| `event` | 稳定事件名 | 是 |
| `requestId` | HTTP 请求链路 ID | 否 |
| `sessionId` | 会话 ID | 否 |
| `runId` | 单次 run ID | 否 |
| `threadId` | 主题线程 ID | 否 |
| `jobId` | 后台任务 ID | 否 |
| `turnIndex` | 当前轮次 | 否 |
| `durationMs` | 本次事件耗时，通常用于 span end | 否 |
| `meta` | 扩展字段对象 | 否 |
| `error` | 标准化错误对象 | 否 |

### 6.3 错误对象结构

建议统一为：

```json
{
  "name": "AbortError",
  "message": "Moonshot request timed out after 45000ms",
  "code": "TIMEOUT",
  "stack": "..."
}
```

默认策略：

- `stack` 只在 `debug/trace` 或开发模式输出
- 生产 /常规分析模式仅保留 `name/message/code`

### 6.4 摘要字段规范

对于大文本，不记录全文，统一记录摘要：

```json
{
  "inputChars": 1824,
  "inputHash": "sha1:xxxx",
  "inputPreview": "我在上一个项目里主要负责..."
}
```

建议摘要字段命名：

- `xxxChars`
- `xxxHash`
- `xxxPreview`
- `xxxCount`

---

## 7. 事件命名规范

统一使用点分层级命名：

- `<domain>.<action>`
- `<domain>.<subdomain>.<action>`

例如：

- `http.request.started`
- `http.request.completed`
- `session.created`
- `run.started`
- `run.phase.started`
- `run.phase.completed`
- `provider.chat.completed`
- `background_job.failed`

### 7.1 建议事件域

#### HTTP / 入口层

- `http.request.started`
- `http.request.completed`
- `http.request.failed`

#### Session / Run

- `session.created`
- `session.loaded`
- `session.saved`
- `run.started`
- `run.completed`
- `run.failed`
- `run.phase.started`
- `run.phase.completed`
- `run.phase.failed`

#### Policy / Decision

- `policy.decision.built`
- `policy.end_interview.triggered`
- `policy.thread_switch.triggered`

#### Provider / LLM

- `provider.chat.started`
- `provider.chat.completed`
- `provider.chat.failed`
- `provider.tool_call.started`
- `provider.tool_call.completed`
- `provider.fallback.used`

#### Background Job

- `background_job.queued`
- `background_job.started`
- `background_job.completed`
- `background_job.failed`

#### Persistence

- `storage.session.load.started`
- `storage.session.load.completed`
- `storage.session.save.started`
- `storage.session.save.completed`
- `storage.json.retry`

#### SSE / Events

- `sse.client.subscribed`
- `sse.client.closed`
- `sse.session.published`

#### Frontend

- `frontend.session.received`
- `frontend.render.session.completed`
- `frontend.graph.render.completed`
- `frontend.answer.submit.completed`

---

## 8. Span 设计

### 8.1 适合做 span 的节点

以下类型必须以 span 方式记录：

- 网络请求
- 模型调用
- 文件读写
- 后台任务执行
- 会话主流程 phase
- 前端渲染重计算

### 8.2 标准 span 生命周期

推荐输出两种日志：

1. `*.started`
2. `*.completed` / `*.failed`

示例：

```json
{
  "event": "provider.chat.started",
  "sessionId": "session_xxx",
  "runId": "answer_001",
  "meta": {
    "purpose": "question",
    "model": "kimi-k2.5"
  }
}
```

```json
{
  "event": "provider.chat.completed",
  "sessionId": "session_xxx",
  "runId": "answer_001",
  "durationMs": 3872,
  "meta": {
    "purpose": "question",
    "toolCallsCount": 0,
    "fallbackUsed": false
  }
}
```

### 8.3 慢调用标记

建议所有 span 在结束时自动判断：

- `durationMs >= LOG_SLOW_THRESHOLD_MS` 时标记 `meta.slow = true`

这会让后续聚合最慢节点变得简单直接。

---

## 9. 日志等级与采样策略

### 9.1 日志等级

建议定义：

- `trace`  
  高密度诊断日志，只用于短期排障

- `debug`  
  开发期详细调试日志

- `info`  
  默认运行日志，记录关键事件与关键 span

- `warn`  
  可恢复异常、重试、超时退化

- `error`  
  明确失败、异常中断

### 9.2 默认记录策略

默认 `info` 级别仅记录：

- 请求入口
- 会话主流程
- 模型调用
- 后台任务
- 文件读写
- SSE 发布

默认不记录：

- 纯函数调用
- 高频 helper
- 小粒度数组 / 字符串处理

### 9.3 采样策略

第一版建议不做复杂随机采样，只做边界控制：

- `trace/debug` 仅在环境变量开启时生效
- `info` 默认全量记录关键事件
- 前端 debug 日志默认只保留内存 ring buffer，不默认写盘

---

## 10. 脱敏与安全策略

### 10.1 默认禁止全文写入

以下内容默认不得写入 JSONL 文件：

- 完整候选人回答
- 完整 prompt
- 完整简历 JSON
- 完整模板正文
- API key / token / 密钥

### 10.2 允许记录的替代信息

推荐记录：

- 文本长度
- SHA-1 或其他轻量 hash
- 截断预览
- 引用源数量
- topic / stage / thread 标识

### 10.3 脱敏模式

建议增加环境变量：

- `LOG_PAYLOAD_MODE=none`
- `LOG_PAYLOAD_MODE=summary`
- `LOG_PAYLOAD_MODE=full`

默认值：

- 开发环境 `summary`
- 非开发环境 `none`

`full` 只用于短期本地排障，不应作为常规模式。

---

## 11. 存储与保留策略

### 11.1 日志目录

建议新增配置目录：

- `storage/logs/`

仓库当前已有 `sessions/`，日志建议独立于 session 数据落盘，避免混杂。

推荐配置项：

- `LOG_DIR`
- 默认值：`<repoRoot>/storage/logs`

### 11.2 文件格式

推荐使用 JSONL：

- 单行一条事件
- 便于追加写入
- 便于 grep / 脚本处理
- 便于后续做聚合

示例：

- `app-2026-04-06.jsonl`
- `app-2026-04-07.jsonl`

### 11.3 轮转策略

第一版采用按天切分即可：

- 每日一个文件
- 启动时自动创建目录
- 不做复杂压缩轮转

后续如果日志量增长明显，再追加：

- 文件大小上限
- 历史天数保留策略
- 压缩归档

---

## 12. 针对当前仓库的埋点边界

本节明确后续实现时优先覆盖哪些文件与函数。

### 12.1 HTTP 与 SSE 入口

目标文件：

- `app/server/server.js`
- `app/server/lib/http.js`
- `app/server/services/session-events.js`

重点记录：

- 请求开始 / 结束 / 异常
- SSE 订阅建立 / 关闭
- SSE 发布次数、订阅数、耗时

### 12.2 Session / Run 状态机

目标文件：

- `app/server/services/interview-service.js`

重点记录：

- `createInterviewSession`
- `answerInterviewQuestion`
- `processStartRun`
- `processAnswerRun`
- `setRunPhase`
- `scheduleBackgroundJob`
- `runBackgroundJob`

目标是完整表达：

- 一次 run 从开始到结束的时间线
- 每个 phase 的耗时和结果
- 何时进入后台任务

### 12.3 Provider 与模型调用

目标文件：

- `app/server/services/llm-provider.js`

重点记录：

- provider 请求开始 / 结束 / 失败
- `purpose`
- `model`
- `thinkingType`
- `toolMode`
- `enableWebSearch`
- 请求字节数 / 响应字节数
- 是否 fallback
- 是否超时

### 12.4 持久化与文件系统

目标文件：

- `app/server/lib/fs-utils.js`
- `app/server/services/session-store.js`

重点记录：

- 读写开始 / 结束
- 文件大小
- 重试次数
- 原子写入临时文件行为

### 12.5 前端消费与渲染

目标文件：

- `app/web/modules/actions.js`
- `app/web/modules/renderers.js`
- `app/web/modules/graph.js`

重点记录：

- SSE message 接收时间
- session 渲染耗时
- 图谱重绘耗时
- 提交回答到收到更新的前端体感耗时

---

## 13. 调试视图设计

第一版日志系统可以先只写控制台和文件。  
但为了后续提高排障效率，建议预留统一调试视图。

### 13.1 后端聚合视图

建议后续先在服务端提供“可读摘要视图”，而不是直接把原始日志暴露给前端。

第一批聚合摘要应包括：

- 最近 N 个慢 span
- 最近 N 次 provider 调用摘要
- 当前 session 最近事件时间线
- 当前 session 最近后台任务摘要

建议后续提供只读 API：

- 最近 N 条日志
- 当前 session 最近事件时间线
- 最近 N 个慢 span
- 最近 N 次 provider 调用统计

建议后续提供只读 API：

- 最近 N 条日志
- 最近 N 个慢 span
- 最近 N 次 provider 调用摘要
- 当前 session 时间线摘要
- 当前 session 后台任务摘要

### 13.2 前端调试卡片

建议在现有调试区继续补充一张“链路耗时总览”卡片，展示：

- 当前 request / run 的 phase 耗时
- 最近一次 provider 调用耗时
- 当前 session 最近后台任务耗时
- 最近一次前端 render 耗时

这部分应保持简洁，不展示大段内部说明文字。

---

## 14. 配置项设计

建议新增环境变量：

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `LOG_LEVEL` | `info` | 控制日志等级 |
| `LOG_FORMAT` | `pretty` | 控制台输出格式 |
| `LOG_DIR` | `storage/logs` | 日志文件目录 |
| `LOG_PAYLOAD_MODE` | `summary` | payload 脱敏模式 |
| `LOG_SLOW_THRESHOLD_MS` | `800` | 慢 span 阈值 |
| `LOG_FRONTEND_DEBUG` | `false` | 是否启用前端调试日志 |
| `LOG_ENABLE_FILE` | `true` | 是否写 JSONL 文件 |

建议同步更新：

- `app/server/config.js`
- `.env.example`

---

## 15. 实施阶段规划

### Phase 1：建立日志内核

目标：

- 建立统一 logger API
- 支持结构化事件输出
- 支持 console + JSONL 双 sink

交付物：

- `logger.js`
- `span.js`
- `log-sinks.js`
- 基础配置项

验收标准：

- 可以在任意模块中统一调用 `logger.info()` / `logger.error()` / `startSpan()`
- 本地可看到 pretty 输出
- 磁盘可看到 JSONL 输出

### Phase 2：覆盖后端热路径

目标：

- 把核心慢点全部纳入可观测范围

覆盖范围：

- `server.js`
- `interview-service.js`
- `llm-provider.js`
- `session-store.js`
- `fs-utils.js`

验收标准：

- 一次回答链路至少可看到：
  - 请求入口
  - run 开始
  - phase 耗时
  - 模型调用耗时
  - session 保存耗时
  - SSE 发布耗时

### Phase 3：补充前端观测

目标：

- 建立“体感慢”与“后端慢”的区分能力

覆盖范围：

- `actions.js`
- `renderers.js`
- `graph.js`

验收标准：

- 能看到前端收到 session 更新的时间点
- 能看到图谱渲染耗时
- 能估算“提交回答 -> UI 可用”的前端侧耗时

### Phase 4：增加日志聚合视图

目标：

- 从“原始 JSONL 日志”提升到“可读摘要视图”
- 让开发阶段可以直接查看最近慢点、provider 摘要与 session 时间线，而不必手动翻日志文件

交付物：

- 最近慢 span 摘要
- 最近 provider 调用摘要
- 当前 session 时间线摘要
- 当前 session 后台任务摘要
- 服务端只读聚合接口或等价聚合模块

验收标准：

- 可以直接列出最近 20 个最慢 span，并按耗时排序
- 可以直接列出最近 20 次 provider 调用，并看到 `purpose / model / fallback / durationMs`
- 可以按 session 查看最近关键事件时间线，而不必手动 grep 原始日志
- 聚合结果默认面向“人可读”，而不是原始日志透传

### Phase 5：增加聚合分析能力

目标：

- 从“看原始日志”升级到“看统计结果”

交付物：

- 慢 span 统计
- provider 调用统计
- session 时间线聚合

验收标准：

- 可以快速列出最近 20 个最慢 span
- 可以按 session 直接查看关键时间线

### Phase 6：接入前端调试视图

目标：

- 在 UI 内统一观察关键链路，而不必反复翻日志文件

交付物：

- 链路耗时调试卡
- provider / background job / render 摘要

验收标准：

- 当前 session 的慢点可在一屏内看清
- 不增加主界面噪声

---

## 16. 成功指标

日志系统落地后，至少要能量化以下指标：

1. `/api/interviews/:id/answer` 平均耗时
2. `observe / deliberate / decide / execute / feedback` 各 phase 平均耗时
3. `question / assessment / report` 三类模型调用平均耗时
4. `session.save` 平均耗时与 P95
5. `background_job.report` 从排队到完成的总耗时
6. `frontend.render.session` 与 `frontend.graph.render` 平均耗时

当这些指标可稳定观测后，后续性能优化才会真正进入可验证状态。

---

## 17. 风险与回退策略

### 17.1 风险

1. 日志量过大  
   解决方式：默认只开 `info`，大 payload 只记录摘要。

2. 热路径被日志拖慢  
   解决方式：减少同步格式化与大文本序列化，文件写入采用轻量追加。

3. 日志字段失控  
   解决方式：统一事件 schema，不允许随意拼接无结构 message。

4. 调试视图噪声过多  
   解决方式：UI 只展示聚合结果与最近关键事件，不直接灌入原始日志流。

### 17.2 回退策略

如果某阶段日志实现带来明显副作用，应支持：

- 通过 `LOG_LEVEL=warn` 快速降低日志密度
- 通过 `LOG_ENABLE_FILE=false` 关闭文件落盘
- 保留原有业务流程，不让日志成为流程强依赖

---

## 18. 结论

本项目后续的性能优化，必须建立在统一日志与可观测性体系之上。

推荐实施方向不是“给每个方法打印日志”，而是：

- 用统一结构化日志记录关键业务事件
- 用 span 明确量化每个关键阶段耗时
- 用上下文 ID 串起一次完整链路
- 用脱敏策略确保日志可长期保留
- 用阶段化实施避免一次性重构过大

后续实现应严格按本文档 Phase 逐步推进。第一批工作建议从 `Logger Core + 后端热路径埋点` 开始。
