# Resume Interview Workbench

一个基于结构化简历输入的本地 AI 面试工作台。

这个项目的核心目标不是做通用聊天，而是围绕“候选人简历 + 岗位要求 + 面试官角色”构建一套可观察、可追问、可复盘的模拟面试系统。它支持根据简历内容动态出题，按主题线程持续深挖，并通过状态图帮助你理解 AI 面试官在每一轮中的思考和决策路径。

## 项目定位

- 以 `resume-package/` 作为默认输入包
- 以结构化简历数据驱动模拟面试流程
- 以“岗位模板 + 面试官角色 + 多轮追问 + 复盘报告”为主线
- 以本地 Web 工作台作为主要交互界面
- 以可观测状态机和线程图谱作为调试与理解辅助

## 当前能力

当前仓库已经包含一套可运行的本地 MVP，主要能力如下：

- 从 `resume-package/` 读取结构化简历输入
- 从 `interview-kit/roles/` 与 `interview-kit/jobs/` 读取角色和岗位基座
- 支持模板化面试配置
  - 公司名称
  - 公司介绍
  - 岗位方向
  - 岗位介绍
  - 其他上下文
  - 面试官角色
- 支持使用 Kimi / Moonshot 作为主模型
- 支持 fallback interviewer，在未配置模型时仍可本地跑通流程
- 支持联网搜索能力开关
- 支持按阶段输出状态信息
  - 观察
  - 思考
  - 决策
  - 执行
  - 反馈
- 支持面试线程视角
  - 当前 topic thread
  - 追问次数
  - 搜索次数
  - 关闭原因
- 支持 SSE 事件流更新
- 支持结构化复盘报告

## 界面设计原则

这个工作台的主交互对象始终是“AI 面试官”本身。

因此当前界面设计遵循下面的优先级：

1. 中心区域优先服务于面试对话
2. 状态图用于辅助理解当前回合的状态流转
3. 计划、报告等模块只保留为次级辅助信息

状态图不是主页面本身，而是帮助你观察 AI 面试官当前处于什么阶段、为什么继续追问、何时切题、何时收尾。

## 目录结构

```text
.
├─ app/
│  ├─ server/                  # Node.js 本地服务、面试流程、Provider 接入、SSE
│  └─ web/                     # 前端工作台页面
├─ interview-kit/
│  ├─ jobs/                    # 岗位配置基座
│  ├─ roles/                   # 面试官角色基座
│  └─ templates/               # 模板化输入示例
├─ resume-package/
│  ├─ resume.json              # 结构化简历正文
│  ├─ resume.schema.json       # 简历结构 schema
│  ├─ resume.meta.json         # 简历元信息
│  └─ README.md                # 简历输入包说明
├─ sessions/                   # 本地会话数据
└─ .env.example                # 环境变量示例
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，按需填写模型配置。

最小示例：

```env
AI_PROVIDER=moonshot
MOONSHOT_API_KEY=your_key_here
MOONSHOT_BASE_URL=https://api.moonshot.cn/v1
MOONSHOT_MODEL=kimi-k2.5
MOONSHOT_THINKING=enabled
```

如果不配置模型 Key，系统会自动回退到本地 fallback interviewer。

### 3. 启动服务

```bash
npm run dev
```

Dev mode automatically:

- starts the local server and waits for health check success
- reuses an already running service on port `3000`
- opens `http://127.0.0.1:3000` after the server is ready

或：

```bash
npm start
```

默认访问地址：

```text
http://127.0.0.1:3000
```

Windows one-click launcher:

```powershell
.\scripts\dev.ps1
```

Or double-click:

```text
scripts\dev.cmd
```

Useful variants:

- `npm run dev -- --no-open`: start the server without opening a browser
- `npm run dev:win`: start the server in a minimized PowerShell window

## 常用命令

```bash
npm run check
npm run test:kimi
npm run test:kimi-search
npm run smoke:session
npm run smoke:session-search
```

说明：

- `check`：校验输入包、配置和基础链路
- `test:kimi`：测试 Kimi 基础调用
- `test:kimi-search`：测试 Kimi 搜索工具调用
- `smoke:session`：跑通一次本地面试会话烟雾测试
- `smoke:session-search`：跑通启用搜索的面试会话烟雾测试

## 模型与工具策略

当前实现支持按阶段区分模型策略，目标是在保证关键阶段质量的同时降低时延：

- 高价值阶段可开启 thinking
- 普通评估和部分收尾阶段可降级策略
- 搜索与工具调用由 AI 在流程中按需判断

系统设计上已经开始围绕以下层次进行拆分：

- 思考层
- 决策层
- 执行层
- 反馈层

这使后续扩展更容易，例如：

- 更细粒度的搜索决策
- 多工具路由
- 不同角色下的策略差异
- 更稳定的终止条件判断

## 输入数据原则

本仓库默认消费外部整理好的结构化简历数据，而不是把简历编辑逻辑塞进项目本身。

推荐读取顺序：

1. `resume-package/README.md`
2. `resume-package/resume.meta.json`
3. `resume-package/resume.schema.json`
4. `resume-package/resume.json`

这样可以把“简历生产”与“面试消费”清晰解耦，便于后续将 `resume-package/` 作为整套系统的标准输入。

## 安全说明

- `.env` 已在 `.gitignore` 中忽略，不会默认进入版本库
- 仓库中应只保留 `.env.example`，不要提交真实 API Key
- 所有模型密钥都应通过本地环境变量注入
- 推送代码前建议再次检查暂存区，避免把任何明文 token 提交到远程

## 后续扩展方向

- 增强线程级闭环可视化与节点锁定机制
- 增强模板向导与模板版本管理
- 引入更稳定的模型分级策略与工具路由
- 把复盘报告进一步结构化，支持导出
- 增加更多岗位与面试官角色基座
- 支持更强的多轮追问和覆盖率控制

## 仓库原则

- 简历事实以结构化输入包为准
- 本仓库聚焦面试流程、状态管理和本地交互
- 优先保证可调试、可复盘、可扩展
- 所有功能演进都尽量围绕“后续可扩展”而不是一次性原型堆砌
