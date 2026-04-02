# resume-interview-workbench

本仓库用于构建一个本地运行的简历模拟面试工作台。

目标不是做一个通用聊天机器人，而是做一个能够读取结构化简历数据、在本地发起模拟面试、记录对话过程并支持后续分析的独立应用。

## 项目定位

- 本地运行，不依赖静态站点部署
- 以结构化简历数据为输入
- 以模拟面试、追问、复盘为核心场景
- 与个人简历站解耦，作为独立工具演进

## 数据来源

当前规划中，本项目会消费由 `zgx197.github.io` 仓库导出的简历数据包。

推荐读取顺序：

1. `README.md`
2. `resume.meta.json`
3. `resume.schema.json`
4. `resume.json`

这意味着本仓库不负责维护简历事实本身，而是负责消费外部导出的结构化简历数据。

## 当前状态

当前已经有一版最小可运行的本地 Web MVP：

- 默认从 `resume-package/` 读取结构化简历输入包
- 从 `interview-kit/roles/` 和 `interview-kit/jobs/` 读取面试官角色与岗位配置
- 后端使用原生 Node.js HTTP 服务
- 前端使用原生 HTML/CSS/JS
- 未配置 `OPENAI_API_KEY` 时，系统会自动使用本地 fallback 模式

启动方式：

1. 可选：复制 `.env.example` 为 `.env` 并填写 `MOONSHOT_API_KEY`
2. 运行 `node app/server/server.js`
3. 打开 `http://localhost:3000`

后续建议优先完成的内容：

1. 将 fallback 规则继续收紧成更稳定的提问与评分策略
2. 接入真实 LLM provider 的流式输出与更严格的结构化约束
3. 把面试记录、复盘报告和配置管理从 JSON 文件升级为更稳定的本地存储
4. 在当前会话模型基础上扩展更细的追问策略、知识点覆盖率和评估维度

## 方向建议

建议先从本地 Web App 开始，而不是一开始就做桌面壳：

- 前端：React + Vite
- 后端：Node.js
- 存储：本地 JSON 或 SQLite
- 配置：`.env`

这样开发速度更快，也更方便反复调整 prompt、会话状态和导入流程。

## 仓库原则

- 简历事实以外部导出包为准
- 本仓库只做读取、解释、面试流程和本地交互
- 不把外部 AI 使用方式预设回简历导出层
- 优先保证本地可调试、可复盘、可扩展
