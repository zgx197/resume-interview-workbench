# 提交命名与 UTF-8 + LF 规范

本仓库后续所有提交统一使用“前缀 + 中文说明”格式：

```text
<type>(<scope>): <中文说明>
```

不需要 `scope` 时可以省略：

```text
<type>: <中文说明>
```

## 基本规则

- 提交说明统一使用中文，不再混用英文长句。
- 提交标题聚焦“这次改了什么”，不要写成过程描述。
- 标题尽量控制在一行内，避免过长。
- 一次提交只表达一个相对完整的变更意图。
- 如果是重构、修复、脚本、文档等不同性质的改动，尽量拆分提交。

## 推荐前缀

- `feat`: 新功能或新增能力
- `fix`: 缺陷修复或行为纠正
- `refactor`: 重构，不直接改变对外功能
- `docs`: 文档更新
- `chore`: 杂项维护、配置、规范、依赖、清理
- `style`: 纯样式或格式调整
- `test`: 测试补充或测试修复
- `perf`: 性能优化

## 推荐 scope

常用 `scope` 建议尽量贴近当前项目结构：

- `db`
- `runtime`
- `interview`
- `review`
- `knowledge`
- `obs`
- `dev`
- `ui`
- `docs`

## 提交示例

```text
feat(db): 初始化 PostgreSQL 运行时与迁移体系
feat(runtime): 持久化结构化会话读模型
fix(dev): 清理孤儿任务并在初始化后自动打开应用
refactor(interview): 重构面试后台任务流水线
docs: 更新数据库架构计划文档
chore: 统一仓库 UTF-8 与 LF 默认配置
```

## 不推荐示例

```text
fix bug
update files
some changes
feat: add runtime stuff
Refactor interview service and some db files
```

## 文件编码与换行符约定

本仓库所有文本文件统一使用 `UTF-8` 编码，并统一使用 `LF` 作为行结束符。

落地方式：

- Git 以 [.gitattributes](/d:/UGit/resume-interview-workbench/.gitattributes) 为准，统一按 `UTF-8 + LF` 管理文本文件。
- 编辑器以 [.editorconfig](/d:/UGit/resume-interview-workbench/.editorconfig) 为准，默认按 `utf-8` 与 `lf` 写入。

因此后续新增或修改文件时，都按 `UTF-8 + LF` 处理。

## 文档同步规则

- 只要改动影响产品默认行为、运行方式、发布形态、目录结构、脚本入口或数据来源，就要在同一轮提交里同步更新 `README` 与对应专题文档。
- 如果本轮变更同时涉及数据库、桌面化、运行脚本或工作台交互，提交前至少检查一次相关文档是否仍与代码一致。
- 不再接受“代码已变更、文档后补”的长期漂移状态；文档同步属于交付的一部分。

## 示例与占位内容约定

- 文档、UI 占位文案、默认模板、示例数据优先使用中性内容，只表达结构和用途，不指向真实公司、产品、人员或业务细节。
- 若无明确业务授权，不要在仓库默认内容中写入可识别的公司名、项目名、人员信息、地点、薪资或简历片段。
- 桌面发布包默认遵循“干净发布包”策略：不携带开发者个人简历数据，不内置公司模板目录。
