# 面试引擎重构设计文档

## 1. 文档目的

本文档用于定义 `resume-interview-workbench` 下一阶段的后端与交互框架重构方案，目标是把当前以串行 LLM 编排为主的系统，演进为一套以策略驱动、证据约束、冷热路径分离为核心的面试引擎。

后续优化原则：

- 先按本文档确定边界和目标。
- 再按阶段逐步落地，不做一次性大爆炸重写。
- 每一阶段都要求可回归、可验证、可回退。

---

## 2. 背景与问题陈述

当前仓库已经具备一个可运行的本地 MVP：

- 可读取结构化简历与岗位/角色基座。
- 可生成面试计划、问题、评估与复盘报告。
- 可通过 SSE 将状态图实时投递到前端。
- 可通过 topic thread 展示追问链路。

但随着交互变复杂，当前架构已经暴露出明显瓶颈，尤其是响应速度和流程可预测性。

### 2.1 当前主要问题

1. 热路径上串行模型调用过多。

启动面试时通常会串行执行：

- `buildInterviewPlan`
- `deliberateInterviewAction`
- `generateInterviewQuestion`

用户回答之后通常会串行执行：

- `assessInterviewAnswer`
- `deliberateInterviewAction`
- `generateInterviewQuestion` 或 `generateInterviewReport`

这导致每一轮都要等待 2 到 3 次模型调用完成，用户体感延迟很高。

2. 流程控制权过度依赖模型。

当前系统中很多本可由程序稳定判断的行为依赖 LLM 决策，例如：

- 是否继续当前线程
- 是否切换主题
- 是否结束面试
- 是否触发联网搜索

这使得系统速度、稳定性和可预测性都受制于模型波动。

3. 实时路径和后台路径未分离。

当前正式计划、阶段策略、结构化报告等高成本任务直接阻塞主交互流程。

4. 可观察性建立在高频持久化之上。

当前 phase 级别状态变更会频繁触发 `persistSession()`，包括写盘和 SSE 广播，增加热路径开销。

5. Topic thread 和 coverage 已经存在，但尚未成为真正的流程核心。

当前 topic thread 更像调试信息，而不是驱动选题与切题的核心状态。

### 2.2 根本判断

当前问题不是某个 prompt 不够好，也不是某个接口太慢，而是系统框架默认将“流程编排”交给了模型。

需要把系统从：

- `LLM orchestration first`

演进为：

- `policy-driven interview engine`

---

## 3. 设计目标

### 3.1 核心目标

1. 降低首题延迟。

- 启动面试时，首题应尽可能在 1 次模型调用内产生。

2. 降低轮间延迟。

- 普通回合应控制在 1 到 2 次模型调用内完成。

3. 提升流程稳定性。

- 线程切换、覆盖率、结束条件、搜索开关应主要由程序控制。

4. 提升架构可演进性。

- 模型、策略、证据图、后台任务、前端调试视图之间应有清晰边界。

5. 保留现有可观察优势。

- 在不阻塞热路径的前提下继续保留状态图、线程信息和复盘能力。

### 3.2 非目标

以下内容不作为本轮设计的直接目标：

- 多用户并发能力
- 分布式部署
- 数据库替代本地文件存储
- 通用聊天产品化
- 复杂权限系统

这些内容可以在后续版本评估，但不纳入本次重构范围。

---

## 4. 设计原则

### 4.1 程序负责流程，模型负责表达

程序负责：

- 状态机推进
- 线程预算
- 覆盖率统计
- 停止条件
- 搜索许可
- 主题选择

模型负责：

- 题目自然语言生成
- 回答质量评估
- 复盘表达
- 长文本结构化整理

### 4.2 热路径极简，冷路径后台化

任何不是当前用户必须马上看到的结果，都应从实时路径中移走。

### 4.3 证据优先

所有问题都应尽量绑定到结构化证据，而不是由模型“自由发挥”。

### 4.4 可回退的渐进演进

每次改动都应保证：

- 有明确入口
- 有清晰 fallback
- 不要求一次性推翻现有前端协议

### 4.5 观测与产品分层

调试信息与用户主界面信息应分层，不再混为一体。

---

## 5. 目标架构概览

重构后的系统分为六层：

1. `Interaction Engine`
2. `Deterministic Policy Layer`
3. `LLM Skills Layer`
4. `Evidence Graph / Topic Graph`
5. `Background Jobs`
6. `Persistence and Event Layer`

### 5.1 Interaction Engine

职责：

- 接收用户输入
- 获取当前会话工作态
- 调用策略层确定下一步
- 触发必要的模型能力
- 返回下一题、结束结果或快速反馈

该层是主交互入口，必须保持轻量与可预测。

### 5.2 Deterministic Policy Layer

职责：

- 线程是否继续
- 何时切换主题
- 何时允许搜索
- 何时结束面试
- 选择下一个候选主题

该层不依赖模型，应尽可能由代码规则驱动。

### 5.3 LLM Skills Layer

职责：

- 题目生成
- 回答评估
- 报告生成
- 长程计划生成

每个能力都应输入清晰、输出固定、便于替换。

### 5.4 Evidence Graph / Topic Graph

职责：

- 将结构化简历、岗位要求、历史轮次组织为可计算的证据图
- 为选题、追问、覆盖与报告提供结构化依据

### 5.5 Background Jobs

职责：

- 正式计划生成
- 长报告生成
- 搜索增强
- 线程摘要更新
- 会话压缩与归档

### 5.6 Persistence and Event Layer

职责：

- 维护 working state
- 在关键节点写入 checkpoint
- 通过 SSE 广播轻量事件

---

## 6. 逻辑模块设计

建议将服务端模块拆成如下结构：

```text
app/server/
├─ engine/
│  ├─ interview-engine.js
│  ├─ session-controller.js
│  ├─ turn-runner.js
│  └─ lifecycle.js
├─ policy/
│  ├─ session-policy.js
│  ├─ thread-policy.js
│  ├─ coverage-policy.js
│  ├─ search-policy.js
│  └─ stop-policy.js
├─ graph/
│  ├─ evidence-graph.js
│  ├─ topic-graph.js
│  ├─ coverage-state.js
│  └─ evidence-selector.js
├─ llm/
│  ├─ skills/
│  │  ├─ question-writer.js
│  │  ├─ answer-judge.js
│  │  ├─ planner.js
│  │  └─ report-writer.js
│  ├─ provider/
│  │  ├─ moonshot-client.js
│  │  └─ fallback-client.js
│  └─ strategy/
│     ├─ mode-config.js
│     └─ model-routing.js
├─ jobs/
│  ├─ plan-job.js
│  ├─ report-job.js
│  ├─ summary-job.js
│  └─ search-job.js
├─ store/
│  ├─ session-store.js
│  ├─ checkpoint-store.js
│  ├─ template-store.js
│  └─ event-bus.js
└─ api/
   └─ session-routes.js
```

说明：

- 当前 `services/interview-service.js` 将逐步拆到 `engine/`、`policy/`、`graph/` 和 `jobs/`。
- 当前 `services/llm-provider.js` 将逐步拆到 `llm/provider/`、`llm/skills/` 和 `llm/strategy/`。

---

## 7. 新的运行模式设计

系统提供两种模式：

### 7.1 Fast Interview

适用场景：

- 高频练习
- 本地快速模拟
- 追求低延迟

特点：

- 首题不等待正式 plan
- 默认关闭 thinking
- 默认禁止搜索，只有规则显式放行时才开启
- 普通回合目标 1 到 2 次模型调用
- 结束时先返回 quick summary，完整报告后台补算

### 7.2 Deep Interview

适用场景：

- 正式评估
- 深度复盘
- 对质量要求高于速度

特点：

- 可启用 thinking
- 可放宽搜索触发
- 可生成更完整的计划与报告
- 允许更重的后台分析

说明：

- Fast 与 Deep 不只是参数不同，而是两条不同的运行策略。
- 默认模式建议为 Fast。

---

## 8. 会话状态模型设计

### 8.1 会话对象拆分

建议将 session 分为两类状态：

1. `workingState`

实时交互所需的最小状态：

- 当前阶段
- 当前线程
- 下一题
- 最近若干轮
- coverage 摘要
- 当前执行状态

2. `checkpointState`

关键节点写盘所需状态：

- session 基本信息
- 全量轮次
- coverage 累积结果
- 当前线程集合
- report 结果
- 关键 debug 快照

### 8.2 新的 session 结构建议

```json
{
  "id": "session_xxx",
  "mode": "fast",
  "status": "active",
  "createdAt": "...",
  "updatedAt": "...",
  "candidate": {
    "name": "...",
    "role": "...",
    "estimatedYears": 7.5
  },
  "job": {
    "id": "...",
    "title": "...",
    "questionAreas": ["game_framework", "system_design"]
  },
  "policy": {
    "targetLevel": "senior",
    "maxFollowupsPerThread": 3,
    "searchBudgetPerSession": 2,
    "mustCover": ["game_framework", "system_design"]
  },
  "graphState": {
    "topics": [],
    "coverage": {},
    "evidenceRefs": []
  },
  "threads": [],
  "currentThreadId": "thread_xxx",
  "nextQuestion": {},
  "turns": [],
  "quickSummary": null,
  "report": null,
  "runtime": {
    "currentRun": {},
    "backgroundJobs": []
  }
}
```

### 8.3 线程对象建议

```json
{
  "id": "thread_xxx",
  "category": "system_design",
  "label": "技能系统与工具链边界",
  "status": "active",
  "sourceEvidenceRefs": [
    {
      "sourceType": "experience",
      "sourceId": "exp_001"
    }
  ],
  "questionCount": 2,
  "answerCount": 1,
  "followupCount": 1,
  "searchCount": 0,
  "confidence": 0.62,
  "coverageDelta": 0.3,
  "lastAssessment": {
    "score": 4,
    "risks": ["边界描述不够具体"]
  }
}
```

---

## 9. 证据图与主题图设计

### 9.1 设计目标

将“问什么”从模型自由生成，改成程序从图中选择。

### 9.2 节点类型

建议最小支持以下节点：

- `experience`
- `project`
- `skill`
- `topic`
- `jobRequirement`
- `roleBias`

### 9.3 边类型

建议最小支持以下边：

- `supports`
- `related_to`
- `covers`
- `recent_to`
- `mentioned_in_turn`
- `validated_by_answer`

### 9.4 topic 节点建议字段

```json
{
  "id": "topic:system_design:skill-runtime-architecture",
  "category": "system_design",
  "label": "技能运行时架构",
  "evidenceCount": 4,
  "coverageScore": 0.35,
  "askedCount": 1,
  "validatedScore": 0.2,
  "priorityScore": 0.82
}
```

### 9.5 topic 选择策略

程序在选题时综合以下因子：

- 岗位要求匹配度
- 简历证据强度
- 近期经历优先级
- 当前 coverage 缺口
- 当前线程是否仍值得继续
- 最近是否已经问过同类主题

示例计算思路：

```text
priorityScore =
  roleMatchWeight * roleMatch
  + evidenceWeight * evidenceStrength
  + recencyWeight * recency
  + gapWeight * coverageGap
  - askedPenalty * recentAskedCount
```

---

## 10. 实时链路设计

### 10.1 启动链路

目标：

- 首题尽可能在 1 次模型调用内返回

建议流程：

1. 读取 resume、role、job、template。
2. 构建 `session policy`。
3. 构建初始 topic graph。
4. 用程序从 graph 中选择起始主题。
5. 调用一次 `question_writer` 生成首题。
6. 返回首题并进入 `active`。
7. 后台异步生成正式 `plan`。

说明：

- `buildInterviewPlan` 不再阻塞首题。
- `deliberateInterviewAction` 不应出现在启动热路径中。

### 10.2 回答链路

目标：

- 普通回合 1 到 2 次模型调用

建议流程：

1. 记录用户回答。
2. 调用一次 `answer_judge` 得到：
   - 评分
   - 风险
   - 证据缺口
   - 跟进建议
3. 程序基于 policy 和 graph 决定：
   - `continue_thread`
   - `switch_topic`
   - `end_interview`
   - `allow_search`
4. 若结束：
   - 生成 quick summary 或直接进入 completed
   - full report 后台生成
5. 若继续：
   - 调用一次 `question_writer`
   - 返回下一题

### 10.3 搜索链路

搜索只作为增强器，不能默认进入热路径。

搜索触发规则：

- 首题禁止搜索
- 普通技术追问默认不搜索
- 只有以下情况才允许：
  - 用户明确要求结合最新趋势/版本/行业现状
  - 当前问题依赖外部时效事实
  - 当前线程需要外部资料验证
- 同一线程最多 1 次
- 同一 session 总预算受 `searchBudgetPerSession` 约束

---

## 11. 后台链路设计

### 11.1 正式计划任务

触发时机：

- session 创建后立即异步触发

输出：

- `plan.summary`
- `plan.stages`
- `targetTurnCount`

要求：

- 不能阻塞首题生成

### 11.2 线程摘要任务

触发时机：

- 每轮完成后可按需异步执行

输出：

- 当前线程摘要
- 当前线程证据缺口

用途：

- 缩短后续 prompt 体积
- 减少整段历史轮次重复传给模型

### 11.3 完整报告任务

触发时机：

- session 结束后

输出：

- full report

要求：

- 不阻塞用户看到“面试已结束”这一结果

---

## 12. LLM Skills 设计

### 12.1 question_writer

输入：

- 目标 topic
- 证据来源
- 当前线程摘要
- 用户历史回答摘要
- 面试官风格

输出：

```json
{
  "text": "...",
  "topicCategory": "system_design",
  "evidenceSource": "...",
  "rationale": "...",
  "expectedSignals": ["..."]
}
```

说明：

- 只负责写题
- 不负责决定要不要继续线程

### 12.2 answer_judge

输入：

- 当前问题
- 用户回答
- expectedSignals
- 当前线程摘要

输出：

```json
{
  "score": 4,
  "confidence": "medium",
  "strengths": ["..."],
  "risks": ["..."],
  "followupNeeded": true,
  "missingSignals": ["..."],
  "suggestedFollowupAngles": ["..."]
}
```

说明：

- 只负责评估回答质量
- 不负责决定线程切换

### 12.3 planner

输入：

- resume graph
- role
- job
- template notes

输出：

- 分阶段 long-term plan

要求：

- 仅后台运行

### 12.4 report_writer

输入：

- turns
- coverage
- thread summaries
- final topic graph

输出：

- structured full report

---

## 13. 策略层设计

### 13.1 session policy

由候选人年限、岗位等级、岗位方向共同决定。

示例：

```json
{
  "targetLevel": "senior",
  "maxFollowupsPerThread": 3,
  "targetTurnCountRange": [6, 9],
  "searchBudgetPerSession": 2,
  "mustCover": ["game_framework", "system_design", "ai_agent_design"]
}
```

### 13.2 thread policy

输入：

- 当前线程状态
- 最近评估结果
- followup budget

输出：

- `continue`
- `close`

基础规则：

- 如果 `followupCount >= maxFollowupsPerThread`，则关闭线程
- 如果连续两次回答已满足 expectedSignals，则优先关闭线程
- 如果评估显示关键证据缺口仍在，则允许继续

### 13.3 coverage policy

输入：

- job mustCover
- topic graph coverage
- asked count

输出：

- 当前缺口最大的 topic category

### 13.4 stop policy

满足以下条件时允许结束：

- 已达到最小轮次
- `mustCover` 均已达到最低 coverage
- 当前线程无明显追问价值

### 13.5 search policy

程序化判断：

- 是否涉及时效性事实
- 当前线程是否已搜索过
- session 搜索预算是否耗尽

---

## 14. 持久化与事件设计

### 14.1 持久化策略

只在以下关键节点写盘：

- session 创建完成
- 用户提交回答
- 下一题生成成功
- session 完成
- session 失败
- 后台任务完成并更新 checkpoint

### 14.2 SSE 事件层级

定义两种事件：

1. `session_view`

给前端主界面使用，字段尽量稳定、轻量。

2. `debug_run`

给调试视图使用，允许包含 phase、策略、raw payload。

说明：

- 不再要求每个 phase 都进行全量写盘。
- phase 可以继续广播，但应以内存态为主。

---

## 15. API 设计建议

### 15.1 用户态接口

#### `GET /api/bootstrap`

返回：

- candidate overview
- role list
- job list
- template list
- provider status

#### `POST /api/interviews`

创建 session。

建议扩展字段：

```json
{
  "templateId": "...",
  "mode": "fast",
  "enableWebSearch": false
}
```

#### `GET /api/interviews/:id`

返回用户态 session view。

#### `POST /api/interviews/:id/answer`

提交回答并触发下一轮。

#### `GET /api/interviews/:id/events`

返回 SSE 用户态事件流。

### 15.2 调试态接口

#### `GET /api/interviews/:id/debug`

返回完整 debug snapshot。

#### `GET /api/interviews/:id/debug/events`

返回细粒度 debug event stream。

说明：

- 用户界面与调试界面使用不同 view model。

---

## 16. 前端配套改造建议

本轮重构以后，前端应逐步从“展示所有内部状态”改为“双层视图”：

### 16.1 用户主视图

只展示：

- 当前题目
- 当前线程
- 面试进度
- 计划摘要
- 报告摘要

### 16.2 调试视图

展示：

- phase 运行细节
- 决策 trace
- provider strategy
- raw JSON
- graph internals

说明：

- 主视图用于用户体验
- 调试视图用于开发和分析

---

## 17. 性能目标与验收指标

### 17.1 性能目标

Fast 模式目标：

- 首题 P50 < 2.0s
- 首题 P95 < 4.0s
- 普通轮次 P50 < 3.0s
- 普通轮次 P95 < 6.0s

Deep 模式目标：

- 首题 P50 < 4.0s
- 普通轮次 P50 < 6.0s

### 17.2 工程指标

- 普通回合热路径模型调用数 <= 2
- 启动热路径模型调用数 <= 1
- 热路径持久化次数 <= 2
- 每线程搜索次数 <= 1
- 每 session 搜索总次数受 budget 约束

### 17.3 质量指标

- `mustCover` 主题覆盖率达到预期阈值
- 每个问题都能追溯至少一个结构化证据源
- 线程关闭理由可解释
- 结束条件可复现

---

## 18. 渐进式迁移计划

### Phase 1：收紧热路径

目标：

- 不改变前端协议
- 先把延迟降下来

工作项：

- 默认关闭 `deliberate/question/plan` 的 thinking
- 启动流程改为“先出首题，后补正式 plan”
- 减少 phase 级持久化频率

预期收益：

- 首题体感明显变快
- 风险低

### Phase 2：把流程决策从模型中抽离

工作项：

- 引入 `session policy`
- 引入 `thread policy`
- 引入 `coverage policy`
- 引入 `search policy`
- 删除或弱化 `deliberateInterviewAction`

预期收益：

- 系统行为更稳定
- 模型调用数进一步下降

### Phase 3：引入 evidence/topic graph

工作项：

- 从 `resume-loader` 输出更正式的 graph state
- 按图驱动 topic 选择
- 将 coverage 与验证结果正式挂到 graph 节点上

预期收益：

- 选题更可解释
- 问题与证据绑定更稳

### Phase 4：后台任务化

工作项：

- plan job
- report job
- thread summary job
- search job

预期收益：

- 热路径进一步收敛
- 长任务不阻塞交互

### Phase 5：分离用户态与调试态视图

工作项：

- 新建用户态 session view model
- 保留 debug view model
- 前端切换到双视图结构

预期收益：

- 产品界面更干净
- 调试能力不丢失

---

## 19. 风险与应对

### 风险 1：程序化策略过强，问题变机械

应对：

- 让程序选择主题，让模型负责题目表达
- 保留 question_writer 的风格自由度

### 风险 2：后台 plan 与实时题目不一致

应对：

- plan 只作为建议结构，不强制覆盖实时首题
- 后续 stage 可根据实时图状态动态修正

### 风险 3：图模型过早复杂化

应对：

- 先做最小版本 topic graph
- 节点与边从少到多演进

### 风险 4：调试能力下降

应对：

- 明确保留 debug event stream
- 只是不再让 debug 信息阻塞热路径

---

## 20. 对现有文件的迁移建议

### 20.1 直接保留

- `resume-loader.js`
- `catalog-loader.js`
- `session-store.js`
- `template-service.js`
- 前端当前的 session 基础结构

### 20.2 逐步拆分

- `interview-service.js`
- `llm-provider.js`
- `fallback-interviewer.js`

### 20.3 优先新增

- `policy/session-policy.js`
- `policy/thread-policy.js`
- `graph/topic-graph.js`
- `llm/skills/question-writer.js`
- `llm/skills/answer-judge.js`
- `jobs/plan-job.js`

---

## 21. 下一步实施顺序建议

建议严格按以下顺序开始：

1. 先做 `Fast mode` 热路径收紧
2. 再做 `policy layer`
3. 再做 `topic graph`
4. 再做后台任务
5. 最后再拆用户态 / 调试态视图

理由：

- 这样能最快拿到体感收益
- 风险最低
- 每个阶段都能独立验证

---

## 22. 结论

下一阶段的关键不是继续微调 prompt，而是把系统正式升级为一套：

- 由程序驱动流程
- 由图结构驱动选题
- 由模型负责高价值表达
- 由后台任务承载重计算

的面试引擎。

一句话总结：

**将系统从“多阶段串行 LLM 编排”重构为“策略驱动、证据约束、冷热分离的面试引擎”。**

后续所有优化都应围绕这个目标进行，而不是继续在当前串行编排上堆补丁。
