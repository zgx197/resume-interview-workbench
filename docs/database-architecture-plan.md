# 数据库与知识检索架构落地方案

## 1. 文档目的

本文档用于为 `resume-interview-workbench` 设计一套可执行、可渐进落地、可长期演进的数据库与知识检索方案。

这套方案的目标不是把当前本地 JSON 文件简单迁移到数据库，而是建立一套能够支撑以下能力的统一数据底座：

- 模板资产化与版本管理
- 题库资产化、筛选、复用与淘汰
- 面试过程结构化存档与历史回放
- 差回答沉淀为可追踪的弱项对象
- 基于 embedding 的相似题、相似弱项、相似项目背景召回
- 异步任务的可恢复、可重试、可审计执行

后续落地原则：

- 先明确领域边界与持久化职责，再逐步迁移实现
- 先迁“知识资产域”，后迁“实时运行态”
- 所有阶段都必须支持回滚、灰度、双轨并存

---

## 2. 背景与当前问题

当前项目已经具备一套可以运行的本地面试工作台，但持久化层仍以文件存储为主。

当前与持久化直接相关的主要入口包括：

- [`app/server/services/session-store.js`](/d:/UGit/resume-interview-workbench/app/server/services/session-store.js)
- [`app/server/services/template-service.js`](/d:/UGit/resume-interview-workbench/app/server/services/template-service.js)
- [`app/server/lib/logger.js`](/d:/UGit/resume-interview-workbench/app/server/lib/logger.js)
- [`app/server/lib/log-sinks.js`](/d:/UGit/resume-interview-workbench/app/server/lib/log-sinks.js)

这种模式适合当前 MVP 阶段，但在以下目标下会迅速触顶：

- 面试模板要成为长期资产
- 题库需要支持分类、标签、来源、表现统计与检索
- 回答不佳的内容需要沉淀为复习对象
- 需要根据岗位、主题、弱项和语义相似度做题目召回与推荐
- 后台任务需要统一管理而不是分散挂靠在 session 状态上

### 2.1 当前主要问题

1. 业务对象没有成为一等公民  
   模板、题目、弱项、推荐、检索文档还没有独立建模，很多信息仍然附着在 session 或 JSON 快照里。

2. 文件存储不适合复杂查询  
   一旦需要按岗位、主题、难度、标签、历史表现、更新时间等维度筛选，文件存储会迅速变成瓶颈。

3. 向量检索缺乏承载层  
   embedding 不是孤立能力，它必须和结构化数据、任务系统、版本与重建策略一起设计。

4. 派生数据和真相数据尚未分层  
   embedding、推荐结果、聚类结果、本体数据还没有明确边界，后期会影响重建与演进。

5. 异步能力尚未数据库化  
   `plan_refresh`、`report`、`thread_summary` 等后台任务已经存在运行模型，但缺少统一任务主表和租约机制。

### 2.2 根本判断

当前最需要的不是“把 session 文件搬进库”，而是建立一套面向长期资产沉淀的数据模型。

系统需要从：

- `file-backed runtime state`

演进为：

- `database-backed knowledge platform`

---

## 3. 设计目标

### 3.1 核心目标

1. 建立统一业务主库  
   模板、题目、session、turn、assessment、review item、job、knowledge document 都应有清晰归属与一致性保障。

2. 建立知识资产底座  
   题目、模板、弱项、项目片段、报告证据要成为可检索、可复用、可优化的对象。

3. 支持混合检索  
   检索必须支持“结构化过滤 + 向量召回 + 规则重排”。

4. 支持渐进迁移  
   在不破坏当前可运行流程的前提下，逐步从文件存储切换到数据库存储。

5. 提升可靠性  
   数据写入需要具备事务、幂等、版本控制、重试与审计能力。

### 3.2 非目标

以下内容不作为本轮方案的直接目标：

- 多租户隔离
- 分布式数据库集群
- 独立搜索引擎集群
- 独立向量数据库
- 全量事件溯源系统
- 复杂权限模型

---

## 4. 技术选型结论

第一阶段推荐选型如下：

- 主库：`PostgreSQL`
- 向量扩展：`pgvector`
- 全文检索：`PostgreSQL tsvector + GIN`
- 查询层：`Drizzle ORM`
- 迁移：SQL migration 或 Drizzle migration
- 原始日志：继续保留 JSONL

### 4.1 为什么选 PostgreSQL

- 核心数据天然是关系型，而不是纯文档
- 模板、题库、session、review item、job 之间存在大量关联关系
- 需要事务、约束、唯一键、统计聚合和版本控制
- `JSONB` 很适合承载还在演进的计划、topic graph 与快照结构
- `pgvector` 足以覆盖当前和下一阶段的 embedding 检索需求

### 4.2 为什么不选 SQLite

- SQLite 适合单机工具、轻量本地开发与早期验证
- SQLite 不适合作为本项目的长期业务主库

### 4.3 为什么不选 SQLite 作为长期主库

SQLite 不是不能用，而是不适合承担本项目后续规划中的“长期业务主库”角色。

如果目标只是：

- 单用户本地使用
- 小规模题库
- 几乎没有后台任务
- 没有稳定的语义检索需求

那么 SQLite 可以胜任。

但本项目规划中的目标已经明显超出这个范围。系统后续需要长期支撑：

- 模板资产化与版本管理
- 题库资产化与表现统计
- review item 沉淀与复习任务
- embedding 检索与重建
- 后台任务的租约、重试与恢复
- 发布到不同环境并保持一致行为

在这些目标下，SQLite 的主要问题有以下几个。

#### 4.3.1 并发写入能力不适合作为长期主库

项目后续会同时出现以下写路径：

- session 过程写入
- turn / assessment 写入
- review item 生成
- embedding rebuild 回写
- background job 状态更新

SQLite 在轻并发、单进程场景下表现良好，但它更偏向嵌入式数据库模型，不适合作为长期承载这些并发写入路径的主库。

#### 4.3.2 向量检索不是 SQLite 的强项

本项目的长期方案要求：

- 结构化过滤
- embedding 存储
- 语义召回
- 检索结果重排

SQLite 理论上可以承载部分相关能力，但生态成熟度、标准化程度和工程可维护性都不如 `PostgreSQL + pgvector`。

换句话说，SQLite 可以用来“试验”，但不适合作为语义检索架构的长期中心。

#### 4.3.3 后台任务与恢复机制实现成本更高

本项目后续会引入统一 `background_jobs` 机制，要求具备：

- 租约
- 重试
- 幂等
- 超时回收
- 失败审计

这些能力在 SQLite 上不是完全做不到，但实现的稳健性、扩展性和后续运维空间都不如 PostgreSQL。

#### 4.3.4 跨环境发布能力不如 PostgreSQL 标准化

本项目明确希望数据库不是绑定某一台机器的本地安装产物，而是一个独立环境资源。

这意味着我们真正要迁移和复现的是：

- 连接配置
- schema
- migration
- seed
- 容器与部署定义

SQLite 的单文件模型虽然便携，但更偏向“嵌入应用的本地数据文件”，而不是一个标准的独立数据库环境。对于后续开发、测试、预发、生产多环境一致化来说，PostgreSQL 更合适。

#### 4.3.5 现在用 SQLite，后面大概率还要再迁一次库

如果当前阶段以 SQLite 为主库，后续当以下需求真正落地时：

- pgvector 检索
- 更稳定的后台任务
- 更复杂的统计与筛选
- 更标准的发布环境

大概率仍然要迁移到 PostgreSQL。

这意味着：

- 现在先做一次 SQLite 适配
- 后面再做一次 PostgreSQL 迁移

总体成本会高于直接从一开始就围绕 PostgreSQL 建设。

#### 4.3.6 最终判断

SQLite 适合作为：

- 本地极轻量实验环境
- 某些测试场景的临时依赖
- 非主路径的开发便利方案

SQLite 不适合作为：

- 本项目的长期业务主库
- 本项目语义检索与任务系统的核心承载层
- 本项目多环境发布的一致性基础设施

因此，本方案仍然建议：

- 以 `PostgreSQL` 作为主库
- 以 `pgvector` 作为向量检索能力
- 以 Docker 化方式提供本地与部署环境的一致数据库运行方式

### 4.4 为什么不选 MongoDB 作为主库

- session 快照虽然适合文档存储，但题库、模板版本、review、统计与复杂过滤更适合关系建模

### 4.5 为什么第一阶段不上独立向量库

- 当前瓶颈不是向量性能，而是业务模型尚未沉淀
- 独立向量库会引入额外同步、幂等、运维与一致性成本

### 4.6 环境与部署策略

数据库不应作为“某一台开发机手工安装的本地组件”存在，而应作为一个可迁移、可复现、可独立部署的环境资源存在。

我们真正需要在仓库中沉淀的不是“某台机器上的安装状态”，而是：

- 数据库连接配置
- schema 定义
- migration
- seed 脚本
- Docker 环境定义

#### 4.6.1 本地开发环境

本地开发使用 Docker Compose 启动标准化数据库环境：

- `PostgreSQL`
- `pgvector`

这样做的好处是：

- 本地环境不绑定某台机器的系统安装状态
- 新机器拉代码后可以快速复现同样的数据库环境
- 开发环境与后续测试环境更接近

#### 4.6.2 测试、预发与生产环境

应用始终通过环境变量连接数据库，例如：

- `DATABASE_URL`
- `DATABASE_POOL_MAX`
- `DATABASE_SSL`

不同环境只替换连接配置，不改变应用代码和 schema 演进方式。

#### 4.6.3 仓库内应保存的内容

- `docker-compose.yml`
- 数据库初始化配置
- migration 文件
- schema 定义
- seed 脚本
- `.env.example`

#### 4.6.4 仓库内不应保存的内容

- 某台机器专属的数据库文件
- 本机路径绑定配置
- 依赖人工安装过程的隐式环境状态

#### 4.6.5 实施结论

后续数据库接入按以下策略执行：

- 数据库选型仍为 `PostgreSQL + pgvector`
- 本地开发环境通过 Docker Compose 提供
- 应用通过环境变量连接数据库
- migration 与 schema 作为仓库资产长期维护

---

## 5. 总体架构

目标方案采用三层持久化结构：

1. 业务真相层  
   使用 PostgreSQL 作为唯一业务真相源。

2. 向量检索层  
   仍放在 PostgreSQL 内，通过 `pgvector` 承载 embedding。

3. 原始事件与调试层  
   继续保留 JSONL，用于原始 provider payload、调试日志与历史排查。

### 5.1 各层职责

#### PostgreSQL

存储：

- 模板与模板版本
- 题库、标签、来源与统计
- session、turn、assessment、report
- review item 与复习结果
- knowledge document 与 embedding 元数据
- background jobs

#### pgvector

存储：

- 题目 embedding
- 模板说明块 embedding
- review item embedding
- 项目经历摘要 embedding
- topic 证据摘要 embedding

#### JSONL

继续存储：

- provider 原始响应
- 结构化日志
- 调试链路
- 高体积原始 payload

### 5.2 总体原则

- 真相数据和派生数据分离
- 派生数据必须允许重建
- 原始 payload 不强行全量入库
- 向量检索只负责召回，不负责最终决策
- embedding 单位必须是语义切片，而不是整场 session

---

## 6. 领域划分

建议把数据库域拆成 6 个部分。

### 6.1 Template 域

职责：

- 管理面试模板
- 跟踪模板版本
- 管理模板标签与适用范围

核心表：

- `interview_templates`
- `template_versions`
- `template_tags`
- `template_tag_links`

### 6.2 Question Bank 域

职责：

- 管理题目本体、变体、来源、标签与表现统计
- 支撑筛题、推荐、淘汰与回收

核心表：

- `question_items`
- `question_variants`
- `question_sources`
- `question_tags`
- `question_tag_links`
- `question_usage_stats`

### 6.3 Interview 域

职责：

- 存储面试 session、turn、assessment、report
- 支撑回放、统计、复盘与知识提炼

核心表：

- `interview_sessions`
- `interview_turns`
- `turn_assessments`
- `session_reports`

### 6.4 Review 域

职责：

- 把差回答沉淀为能力缺口对象
- 跟踪复习进度、尝试记录与掌握状态

核心表：

- `review_items`
- `review_item_attempts`
- `review_sets`
- `review_set_items`

### 6.5 Retrieval 域

职责：

- 承载可检索语义单元
- 承载 embedding 与语义召回

核心表：

- `knowledge_documents`
- `knowledge_embeddings`

### 6.6 Job 域

职责：

- 统一管理后台任务的排队、领取、重试、租约与结果

核心表：

- `background_jobs`

---

## 7. 数据建模原则

### 7.1 业务真相和派生数据分开

业务真相数据包括：

- 模板
- 题目
- session
- turn
- assessment
- review item
- background job

派生数据包括：

- embedding
- 统计摘要
- 推荐结果
- 聚类结果
- 优先级评分

派生数据必须允许完全重建。

### 7.2 题库不是单表，而是资产系统

题库未来会同时包含：

- 人工整理题
- 模板派生题
- 历史 session 提炼题
- review 补救题
- 某岗位或项目背景下的定制题

因此题目必须拆成“本体、变体、标签、来源、表现”，而不是把所有字段堆进一张表。

### 7.3 Review 不是坏回答日志

`review_item` 应表示“一个待补的能力缺口”，而不是简单的低分记录。

它必须支持：

- 绑定来源 session / turn
- 绑定 question / topic
- 描述 weakness type
- 保留证据摘要
- 绑定推荐补强题
- 管理状态与掌握程度

### 7.4 运行态复杂结构优先 JSONB

下列结构在第一阶段不要求完全范式化：

- plan
- topic graph
- coverage
- session summary
- provider meta

这些内容可以先放 JSONB，等稳定后再决定是否继续拆表。

---

## 8. 向量检索设计

向量检索不应该被设计成一个万能搜索框，而应该按场景拆分。

### 8.1 实时候选题召回

输入：

- 当前 stage
- 当前 topic
- 当前弱项线索
- 候选人项目背景摘要

召回源：

- `question_items`
- `question_variants`
- 高质量历史追问文档

流程：

1. 先按结构化条件过滤
2. 再做 embedding 相似度召回
3. 再按规则去重与重排

### 8.2 Review 补强题召回

输入：

- `review_item`
- `weakness_type`
- `evidence_summary`

召回源：

- 题库
- 历史高质量追问
- 模板推荐题

这是最适合最先落地的语义检索场景。

### 8.3 相似差回答召回

输入：

- 当前低分 assessment 摘要
- 当前回答摘要

召回源：

- 历史 `review_items`
- 历史低分 turn 摘要

作用：

- 复用已有补救题
- 复用失败模式分类
- 提升 review 归类一致性

### 8.4 模板推荐与背景匹配

输入：

- 岗位 JD
- 候选人主项目摘要

召回源：

- 模板说明块
- 题库主题文档
- 历史项目片段

### 8.5 embedding 粒度规范

适合做 embedding 的单位：

- 单道题
- 单个题目变体
- 单条 review item
- 单段项目经历摘要
- 单个 topic 的证据摘要
- 单个模板说明块
- 单条报告证据亮点

不适合直接做 embedding 的单位：

- 整场 session JSON
- 整个 report 全文
- 整个日志文件
- 全量 topic graph 快照

---

## 9. 第一版最小表集合

第一版建议先落地以下最小集合：

- `interview_templates`
- `template_versions`
- `question_items`
- `question_variants`
- `question_tags`
- `question_tag_links`
- `review_items`
- `background_jobs`
- `knowledge_documents`
- `knowledge_embeddings`

这套表已经足够支撑：

- 模板资产化
- 题库资产化
- 弱项对象化
- embedding 重建
- 检索与推荐
- 后台任务框架

面试主链路的 `session / turn / assessment / report` 建议第二批迁入。

---

## 10. Repository 抽象与代码重构方向

数据库接入的第一动作不是建表，而是先建立存储边界。

建议新增 Repository 层，并让 service 层只依赖接口。

### 10.1 推荐的 Repository 接口

- `TemplateRepository`
- `TemplateVersionRepository`
- `QuestionRepository`
- `SessionRepository`
- `TurnRepository`
- `AssessmentRepository`
- `ReviewRepository`
- `KnowledgeRepository`
- `BackgroundJobRepository`

### 10.2 推荐目录结构

```text
app/server/
  repositories/
    interfaces/
      template-repository.js
      question-repository.js
      session-repository.js
      review-repository.js
      knowledge-repository.js
      background-job-repository.js
    file/
      file-template-repository.js
      file-session-repository.js
    db/
      db-template-repository.js
      db-question-repository.js
      db-session-repository.js
      db-review-repository.js
      db-knowledge-repository.js
      db-background-job-repository.js
  db/
    client.js
    schema/
    migrations/
```

### 10.3 当前代码的优先改造点

第一批应优先替换以下服务的存储依赖：

- [`app/server/services/template-service.js`](/d:/UGit/resume-interview-workbench/app/server/services/template-service.js)
- `question bank` 相关新增服务
- review item 相关新增服务
- 后台 job 相关服务

第二批再替换：

- [`app/server/services/session-store.js`](/d:/UGit/resume-interview-workbench/app/server/services/session-store.js)
- [`app/server/services/interview-service.js`](/d:/UGit/resume-interview-workbench/app/server/services/interview-service.js) 中对 session 持久化的直接依赖

---

## 11. 关键写入链路设计

### 11.1 面试主链路

流程：

1. 创建 `interview_session`
2. 绑定 `template_version`
3. 写入首题或首题快照
4. 每轮答题写入 `interview_turn`
5. 评估结果写入 `turn_assessments`
6. 命中规则时生成 `review_item`
7. 结束时生成 `session_report`

要求：

- turn 与 assessment 的关系必须清晰可追溯
- session 更新必须具备版本控制，避免后台任务覆盖前台状态

### 11.2 Review 沉淀链路

流程：

1. 从低分 assessment 抽取弱项摘要
2. 生成或合并 `review_item`
3. 建立对应 `knowledge_document`
4. 异步生成 embedding
5. 异步召回补强题
6. 回写推荐结果

### 11.3 Embedding 重建链路

流程：

1. 业务对象变更
2. 生成或更新 `knowledge_document`
3. 计算 `content_hash`
4. 若 hash 变化，则入队 `embedding_rebuild`
5. worker 消费任务并写回 `knowledge_embeddings`

---

## 12. 后台任务设计

建议统一建立数据库任务主表，而不是把任务状态散落在 session 中。

推荐任务种类：

- `plan_refresh`
- `report_generate`
- `thread_summary_generate`
- `review_item_generate`
- `embedding_rebuild`
- `review_recommendation_refresh`

### 12.1 任务状态

- `pending`
- `leased`
- `running`
- `completed`
- `failed`
- `cancelled`

### 12.2 任务能力要求

- 支持租约机制
- 支持超时回收
- 支持重试
- 支持幂等
- 支持按 target 去重
- 支持记录最后错误与结果摘要

---

## 13. 可靠性设计要求

数据库化后的数据层必须具备以下基础能力：

### 13.1 幂等写入

应为关键对象设计稳定业务键：

- `template_key`
- `question_key`
- `review_key`
- `document_key`
- `job_key`

### 13.2 乐观锁

对 `interview_sessions` 等高频更新对象增加 `version` 字段，避免后台任务覆盖新的运行态。

### 13.3 软删除与状态字段

模板、题目、review item 优先使用：

- `status`
- `archived_at`

避免直接物理删除。

### 13.4 审计字段

所有核心表至少具备：

- `created_at`
- `updated_at`

必要时增加：

- `finished_at`
- `resolved_at`
- `archived_at`

### 13.5 内容哈希

以下对象建议记录 `content_hash`：

- 模板版本
- knowledge document
- embedding 记录

用于判断是否需要重建派生数据。

---

## 14. 迁移策略

迁移必须分阶段进行，不能一次性替换全部存储。

### Phase 0：准备阶段

目标：

- 确认数据库选型
- 确认环境变量与连接方式
- 确认 migration 工具
- 确认 Docker Compose 作为本地数据库环境方案

交付：

- Postgres 本地开发实例
- `pgvector` 扩展开启
- `docker-compose.yml` 数据库服务定义
- 数据库连接配置草案

### Phase 1：建立边界

目标：

- 引入 Repository 层
- 保持 file store 可用
- 建立 db adapter 框架

交付：

- repository 接口
- `db/client.js`
- schema 目录
- 第一批 migration

### Phase 2：迁移知识资产域

目标：

- 模板、题库、review、knowledge、job 优先数据库化

交付：

- 模板 DB 读写
- 题库 DB 读写
- review item DB 读写
- background jobs DB 化
- knowledge document 与 embedding 管理

收益：

- 建立知识底座
- 不影响当前 session 主链路

### Phase 3：迁移面试运行态

目标：

- session、turn、assessment、report 切换到数据库

交付：

- `interview_sessions`
- `interview_turns`
- `turn_assessments`
- `session_reports`
- 双写与灰度读切换

### Phase 4：收尾与下线

目标：

- 让数据库成为唯一业务真相源
- 文件层仅保留日志与导出职责

交付：

- 下线 session 文件作为主存储
- 保留 JSONL 日志
- 保留历史迁移脚本

---

## 15. 实施顺序建议

建议按以下顺序推进：

1. 引入 PostgreSQL 与 `pgvector`
2. 落 Docker Compose 本地数据库环境
3. 落 migration 框架
4. 抽 Repository 层
5. 先迁模板、题库、review、knowledge、jobs
6. 接通 embedding 写入与检索
7. 再迁 session / turn / assessment / report
8. 最后清理 file-backed truth source

---

## 16. 阶段验收标准

### Phase 1 验收

- repository 接口已落地
- DB migration 可执行
- file adapter 与 db adapter 可以并存

### Phase 2 验收

- 模板可从 DB 读写
- 题库可从 DB 读写
- review item 可创建、查询、更新
- knowledge document 可创建
- embedding job 可入队与执行

### Phase 3 验收

- 新 session 可写入 DB
- turn 与 assessment 可稳定关联
- report 可从 DB 查询
- 旧文件会话可迁移

### Phase 4 验收

- DB 成为唯一业务真相源
- JSONL 仅承担日志和调试职责
- 主链路不再依赖 session JSON 文件

---

## 17. 风险与注意事项

### 17.1 不要过早全量范式化

`plan`、`topicGraph`、`coverage` 等结构仍在演进，第一阶段优先使用 JSONB。

### 17.2 不要把向量检索做成万能入口

检索必须始终服从结构化过滤和规则重排。

### 17.3 不要把原始 provider payload 全量塞库

原始日志继续保留 JSONL，数据库只存可运营、可统计、可检索的摘要和结构化结果。

### 17.4 不要一次性迁完 session 主链路

先把知识资产域做实，再迁运行态，风险最小。

---

## 18. 最终结论

如果系统目标是长期沉淀模板、题目、弱项、复习任务与语义检索能力，那么最合理的第一阶段方案是：

- 以 `PostgreSQL` 作为业务主库
- 以 `pgvector` 作为向量检索能力
- 继续保留 JSONL 作为原始日志层
- 先抽 Repository 层，再分阶段迁移

核心思想不是“把 JSON 搬进数据库”，而是：

**把模板、题目、弱项、复习任务、知识文档都建模成一等公民对象。**

这会是后续题库系统、复习系统、推荐系统与知识检索系统能够稳定长出来的基础。

---

## 19. 实现对照表（已完成：Phase 0、Phase 1；Phase 2 已形成主体；Phase 3 已打通主链路）

下表用于持续跟踪本方案的真实实现进度。状态判断遵循以下原则：

- `已完成`：已经进入主路径或已形成稳定闭环
- `部分完成`：已有真实实现，但仍存在明显缺口
- `未开始`：文档中已有规划，但仓库内尚未形成可用实现

| 计划项 | 已完成 | 部分完成 | 未开始 | 下一步建议 |
| --- | --- | --- | --- | --- |
| Phase 0：PostgreSQL + pgvector + Docker Compose 基础设施 | 已有 `docker-compose.yml`、数据库配置、`0000_enable_pgvector.sql`、migration runner，可在本地直接启动并执行迁移。 |  |  | 保持配置稳定，后续只补部署环境说明和运维脚本。 |
| Phase 1：Repository 边界与 DB 接入骨架 | 已有 `db/client.js`、接口层、DB repositories、migration 目录与脚本，数据库接入已经不是草图。 | file adapter 没有完全按文档目录对称实现，session 文件读写仍主要留在 `session-store.js`。 |  | 如后续还需要长期保留文件导出，可考虑再抽一层明确的 file runtime/export adapter。 |
| Template 域 | 模板已切到 DB 读写，支持导入文件模板、保存、归档、标记最近使用；`interview_templates` 与 `template_versions` 已落地。 | 目前没有 `template_tags` / `template_tag_links`；session 也还没有显式绑定模板版本。 |  | 给 session 增加 `template_version_id` 或 `template_version_no`，再决定是否真的需要模板标签域。 |
| Question Bank 域 | `question_items`、`question_variants`、`question_sources`、`question_tags`、`question_tag_links`、`question_usage_stats` 已落地；题库已进入主出题链路；usage stats 会增长。 | 检索、排序、召回规则仍主要写在 service 中，尚未抽象成统一 retrieval policy 层。 | `question_topics` 未单独建表。 | 保持当前最小资产模型，后续视检索复杂度决定是否拆出 topic 域。 |
| Review / Weakness 域 | `review_items` 已落地；低分回答已能沉淀 review item；状态更新和推荐题回填可用；review item 还能同步为 knowledge document。 | 当前 review 更像“弱项条目最小闭环”，还不是完整复习系统。 | `review_item_attempts`、`review_sets`、`review_set_items`、独立 `review_recommendations` 尚未实现。 | 下一步如果要把复习做成正式产品线，应先补 attempt / set 两组表。 |
| Knowledge / Retrieval 域 | `knowledge_documents`、`knowledge_embeddings` 已落地；支持 upsert、stale 检测、真实 embedding 写入、文本相似检索、document 相似检索。 | 检索能力可用，但还没有完全沉淀成统一“结构化过滤 + 向量召回 + 规则重排”框架。 |  | 优先把常用召回场景抽成统一策略层，而不是继续把规则散在多个 service 中。 |
| Embedding 子系统 | 已支持 provider 配置、真实远程 embedding、向量入库、stale 文档重建、按文本/文档相似检索。 | 当前失败重试主要依赖重新触发或手工同步，尚未形成完整 job worker 闭环。 |  | 让 embedding job 接入真正的 job lease / retry 流程。 |
| Background Job 域 | `background_jobs` 表已落地；plan/report/thread summary/embedding 都能写 DB 快照；启动恢复已可从 DB 恢复待处理 job。 | 当前更像“任务快照 + 恢复入口”，不是完整数据库驱动 worker 系统。 | `leaseNext()`、租约续期、超时回收、独立 worker 执行闭环尚未实现。 | 优先补 lease / retry / timeout recovery，把 job 域真正做成基础设施。 |
| Interview 运行态表 | `interview_sessions`、`interview_turns`、`turn_assessments`、`session_reports` 已落地并有真实写入。 | 运行态读取仍主要依赖 `interview_sessions.snapshot_json`，结构化表更多承担持久化与分析职责。 |  | 把 session read model 逐步切到结构化查询，减少对整份 snapshot 的依赖。 |
| Phase 3：运行态主链路数据库化 | 新 session、turn、assessment、report 已主写 DB；默认运行模式已切到 `database_only`；旧 session 已支持全量回填。 | 主链路虽然主写 DB，但读路径还没有完全摆脱快照模型；结构化读模型还不成熟。 |  | 下一步重点是“DB 结构化读”而不是继续补写入。 |
| 乐观锁与一致性 | `interview_sessions.version` 已接入；session 持久化已具备版本冲突保护。 | 当前乐观锁只覆盖 session 级快照，不是更细粒度的运行态更新模型。 |  | 等结构化读模型成熟后，再决定是否需要更细粒度并发控制。 |
| 历史 session 迁移 | 已有 `db:backfill:sessions` 脚本；已完成一轮全量回填；旧 session 可导入 DB 并同步部分后台 job 快照。 | 回填目前主要围绕 session 快照与运行态表，不是通用历史数据迁移框架。 |  | 后续如有更多资产域历史数据，再拆更通用的 backfill / import 工具。 |
| 文件层降级 | 默认模式已切到 `database_only`；文件层已从主存储降级为 debug / export / backfill 职责。 | 代码中仍保留 file fallback 和部分 file-era 心智，以便灰度、回退和导出。 |  | 保留 fallback 开关即可，不必急着删除；等结构化读模型稳定后再进一步瘦身。 |
| Phase 4：数据库成为唯一真相源 | DB 已是默认运行时主写与主读来源，历史数据也已回填。 | 主链路依然通过 session snapshot 组织运行态对象，因此“唯一真相源”还没有完全兑现到读模型层。 | JSONL 之外的 file-era 运行态心智尚未彻底下线。 | 完成结构化读模型后，再正式宣告进入 Phase 4 完成态。 |
| JSONL / 调试层 | 原始日志仍保留为 JSONL，符合文档设计初衷。 | 调试、导出、排障职责已经清晰，但 README / 补充文档还可以进一步说明。 |  | 后续只补文档，不建议再把原始 payload 回灌到业务主库。 |
| 计划文档与现实一致性 | 当前计划文档的大方向仍然正确，阶段划分也与实际演进路径基本一致。 | 具体落地上已经偏向“raw SQL + repository + JSONB snapshot”路线，而不是文档中提到的 Drizzle ORM。 |  | 文档可保留选型建议，但建议补充“当前实现状态”说明，避免后续阅读者误判。 |

### 19.1 当前结论

- `已完成` 的核心事项：Phase 0、Phase 1、运行态主写 DB、历史 session 回填、默认 `database_only`
- `部分完成` 的核心事项：Phase 2、Phase 3、Background Job 基础设施、Knowledge Retrieval 架构层
- `未开始` 的核心事项：Review 完整复习域、Job lease/worker 闭环、结构化 read model 主导的最终 Phase 4 收尾

### 19.2 建议作为后续跟踪的主线

1. 先补结构化 read model，让运行态读取不再主要依赖 `snapshot_json`
2. 再补 `background_jobs` 的 lease / retry / timeout / worker 闭环
3. 视产品优先级决定是否补全 review 复习系统的 attempts / sets
4. 最后再正式完成 Phase 4，下线 file-era 运行态心智，只保留 JSONL 与导出职责
### 19.3 里程碑变更说明（截至 `d2faadd`）

以下 3 个提交可以作为当前数据库化改造的里程碑切点，后续如需回看 Phase 推进轨迹，可直接按这组 commit 追踪：

| Commit | 主题 | 主要落地内容 | 对应 Phase 推进 |
| --- | --- | --- | --- |
| `e3dc528` | `feat(db): bootstrap postgres runtime and migrations` | 引入 `docker-compose.yml`、`.env.example` 数据库配置、`db/client.js`、migration runner、`0000` 到 `0006` 迁移骨架，并补充数据库架构计划文档。 | Phase 0 完成；Phase 1 的基础设施部分完成。 |
| `607ceb9` | `feat(db): add repositories and asset domain services` | 建立 repository 接口层与 DB 实现，接入 template/question/review/knowledge/background job 等核心资产域，形成数据库版业务边界。 | Phase 1 完成；Phase 2 进入主体完成态；Background Job 与 Knowledge Retrieval 进入“部分完成”。 |
| `d2faadd` | `feat(runtime): persist structured session read models` | 打通 session/turn/assessment/report 的 DB 主写与回填，新增运行态结构化 read model 子表与 hydration 逻辑，并补 observability 汇总。 | Phase 3 主链路完成；Phase 4 进入收尾阶段，但仍需继续削减对 `snapshot_json` 的读依赖。 |

**当前里程碑判断**

- Phase 0：已完成
- Phase 1：已完成
- Phase 2：主体完成，剩余 review 完整复习域与统一 retrieval policy 收尾
- Phase 3：主链路完成，仍需继续把摘要/列表等读路径从快照迁到结构化 read model
- Phase 4：未完成，当前处于“数据库已成默认真相源，但读模型仍在收口”的阶段

**建议把后续提交继续按下面 3 类打点**

- `feat(read-model): ...`
  用于继续推进 Phase 3/4 的结构化读模型收口。
- `feat(job-worker): ...`
  用于补齐 lease / retry / timeout / recovery 的 worker 闭环。
- `feat(review): ...`
  用于把 review 从“弱项条目沉淀”推进到“完整复习域”。
