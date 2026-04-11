# UI Token Reference

## 1. 目标

这份文档用于固定 `app/web/styles.css` 中已经落地的 UI Token 与语义骨架，避免后续页面继续各写各的字号、间距、卡片样式和表单布局。

当前约定是：

- Token 负责“值”
- Semantic Skeleton 负责“结构”
- 页面模块只负责“组合”

---

## 2. Token 分层

### 2.1 Layout

- `--page-max-width`
- `--nav-width`
- `--rail-width`

用于定义应用壳、侧边导航、右侧辅助栏等整体布局边界。

### 2.2 Color / Surface

- `--bg`
- `--surface-strong`
- `--surface-soft`
- `--surface-card`
- `--surface-card-strong`
- `--border`
- `--border-strong`
- `--text`
- `--muted`
- `--accent`
- `--accent-strong`
- `--accent-soft`
- `--warm`
- `--success`
- `--success-soft`
- `--danger`

建议用法：

- 页面底色走 `--bg`
- 主面板优先使用 `--surface-strong` 或 `surface-panel`
- 普通资产卡片优先使用 `--surface-card`
- 二级说明区、浅层容器优先使用 `--surface-soft`

### 2.3 Radius / Shadow / Motion

- `--radius-xl`
- `--radius-lg`
- `--radius-md`
- `--radius-sm`
- `--shadow-lg`
- `--shadow-md`
- `--shadow-sm`
- `--motion-fast`
- `--motion-medium`
- `--motion-slow`

建议用法：

- 页面级 panel 用 `--radius-lg`
- 表单控件用 `--radius-sm`
- 默认卡片阴影优先 `--shadow-sm`
- 悬浮和强调态再升到 `--shadow-md`

### 2.4 Spacing

- `--space-1` 到 `--space-8`
- `--panel-padding`
- `--panel-padding-compact`

建议映射：

- 微型间距：`--space-1` / `--space-2`
- 常规模块内间距：`--space-3` / `--space-4`
- 面板之间的主间距：`--space-5` 以上
- 大块面板内边距：`--panel-padding`
- 卡片和表单分区：`--panel-padding-compact`

### 2.5 Typography

- `--display`
- `--sans`
- `--mono`
- `--font-size-display`
- `--font-size-title-1`
- `--font-size-title-2`
- `--font-size-title-3`
- `--font-size-body-lg`
- `--font-size-body`
- `--font-size-body-sm`
- `--font-size-caption`
- `--font-size-micro`
- `--line-height-tight`
- `--line-height-title`
- `--line-height-body`
- `--line-height-relaxed`
- `--letter-spacing-title`
- `--letter-spacing-caption`

推荐语义：

- `display`: 应用首页主标题、Hero 标题
- `title-1`: 页面区块标题、弹层主标题
- `title-2`: 面板标题、模块标题
- `title-3`: 卡片标题、表单分区标题
- `body`: 主正文、会话内容、说明文本
- `body-sm`: 摘要、说明、次级文本
- `caption`: eyebrow、标签、小标题
- `micro`: badge、状态字、meta 信息

### 2.6 Control

- `--control-height-sm`
- `--control-height-md`

用于统一按钮、输入框、选择器高度，避免页面之间控件尺寸漂移。

---

## 3. Typography Utility

当前统一 utility：

- `.type-display`
- `.type-title-1`
- `.type-title-2`
- `.type-title-3`
- `.type-body`
- `.type-body-sm`
- `.type-caption`
- `.type-micro`

使用原则：

- 不要在页面里反复写新的标题字号
- 标题先选层级，再决定是否需要额外颜色或权重
- 描述文本优先复用 `body` / `body-sm`

---

## 4. Surface Utility

当前统一 utility：

- `.surface-panel`
- `.surface-card`
- `.surface-soft-card`

使用原则：

- 外层主容器用 `surface-panel`
- 普通业务卡片用 `surface-card`
- 辅助说明区、弱化信息区用 `surface-soft-card`

---

## 5. Standard Skeleton

### 5.1 Panel

- `.ui-panel`
- `.ui-panel-header`
- `.ui-panel-body`
- `.ui-panel-footer`

适用场景：

- 页面内主工作区
- 右侧辅助栏
- 模块化独立面板

### 5.2 Card

- `.ui-card`
- `.ui-card-header`
- `.ui-card-body`

适用场景：

- 模板卡片
- 启动步骤卡片
- 设置卡片
- 报告卡片

### 5.3 Form

- `.ui-form`
- `.ui-form-grid`
- `.ui-form-section`

适用场景：

- 模板编辑页
- 设置页
- 导入与配置弹层

### 5.4 List

- `.ui-list`
- `.ui-list-item`

适用场景：

- 模板列表
- 启动路径列表
- 资产中心列表

### 5.5 Detail

- `.ui-detail`
- `.ui-detail-grid`
- `.ui-detail-group`

适用场景：

- 图谱详情
- 阶段计划详情
- 报告中的结构化说明块

---

## 6. 推荐组合

### 6.1 列表页

- 页面容器：`panel + ui-panel`
- 列表容器：`ui-list`
- 列表项：`ui-list-item`

### 6.2 编辑页

- 页面容器：`panel + ui-panel`
- 表单主体：`ui-form`
- 分区卡：`ui-card ui-form-section`
- 双列输入区：`ui-form-grid`

### 6.3 详情页 / 工作台

- 页面容器：`panel + ui-panel`
- 摘要卡：`ui-card`
- 详情区：`ui-detail`
- 详情块：`ui-detail-group`

---

## 7. 当前落地范围

这一轮已经优先接入以下区域：

- 模板中心的列表页与编辑页
- 启动页的路径卡与步骤卡
- 设置页的概览卡与配置卡
- 会话中的阶段计划详情

后续新增页面时，默认先选这套骨架，再考虑是否需要局部扩展。

---

## 8. 维护规则

- 不新增硬编码字号，优先映射到现有 typography token
- 不新增零散 padding / gap，优先映射到 spacing token
- 新卡片先判断是 `panel`、`card`、`list item` 还是 `detail group`
- 如果某个新样式在两个页面以上会复用，就应提升到 token 或 skeleton 层

关联文档：

- [UI 重构方案](./ui-rearchitecture-plan.md)
