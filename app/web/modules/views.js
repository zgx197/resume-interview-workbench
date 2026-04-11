export const APP_VIEW_ORDER = [
  "dashboard",
  "start",
  "templates",
  "template-editor",
  "session",
  "review",
  "knowledge",
  "settings"
];

export const DEFAULT_APP_VIEW = "dashboard";

export const APP_VIEW_META = {
  dashboard: {
    eyebrow: "Overview",
    title: "工作台",
    description: "查看当前简历工作区、最近模板、面试进度与待处理事项。"
  },
  start: {
    eyebrow: "Start",
    title: "开始面试",
    description: "在独立启动页中完成模板确认、预检检查与启动配置，再进入正式会话。"
  },
  templates: {
    eyebrow: "Templates",
    title: "模板列表",
    description: "集中浏览、筛选和挑选模板资产，再进入专门的模板编辑工作台处理详细内容。"
  },
  "template-editor": {
    eyebrow: "Template Editor",
    title: "模板编辑",
    description: "在独立编辑页里维护模板字段、基础配置和启动面试前需要的完整工作台信息。"
  },
  session: {
    eyebrow: "Session",
    title: "面试会话",
    description: "聚焦当前会话过程，围绕对话、计划、图谱与复盘组织主工作区。"
  },
  review: {
    eyebrow: "Review",
    title: "复习中心",
    description: "后续将承载弱项条目、复习集、attempts 与 recommendations。"
  },
  knowledge: {
    eyebrow: "Knowledge",
    title: "知识库",
    description: "后续将统一承载题库、知识文档、检索结果与使用统计。"
  },
  settings: {
    eyebrow: "Settings",
    title: "设置",
    description: "管理运行时配置、数据目录、portable runtime 与开发者工具。"
  }
};

export function normalizeAppView(view) {
  return APP_VIEW_ORDER.includes(view) ? view : DEFAULT_APP_VIEW;
}

export function isNavViewActive(navView, currentView) {
  if (navView === "templates") {
    return currentView === "templates" || currentView === "template-editor";
  }
  return navView === currentView;
}

export function getAppViewFromLocationHash(hash = window.location.hash) {
  const raw = String(hash || "")
    .replace(/^#\/?/, "")
    .trim();
  return normalizeAppView(raw || DEFAULT_APP_VIEW);
}
