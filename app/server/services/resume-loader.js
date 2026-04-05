import path from "node:path";
import { config } from "../config.js";
import { readJson } from "../lib/fs-utils.js";

// 简历归一化的目标是把偏展示层的 resume-package
// 转成运行时可稳定查询的证据结构。
function flattenText(values) {
  return values
    .flatMap((value) => (Array.isArray(value) ? flattenText(value) : [String(value)]))
    .filter(Boolean);
}

// resume-package 里的 project section 结构并不统一，
// 先打平成证据列表，再做 topic 提取会更稳定。
function pickProjectEvidence(project) {
  const sectionHighlights = [];
  for (const section of project.sections || []) {
    if (section.type === "highlights") {
      for (const item of section.items || []) {
        sectionHighlights.push(`${item.title}：${item.description}`);
      }
    }
    if (section.type === "bullets") {
      sectionHighlights.push(...(section.items || []));
    }
    if (section.type === "paragraph") {
      sectionHighlights.push(...(section.paragraphs || []));
    }
  }

  return flattenText([
    project.description,
    project.subtitle,
    project.tags,
    project.meta,
    sectionHighlights
  ]);
}

// 工作年限只是粗估值，只用于策略默认值，
// 不直接参与任何面向用户的评分表达。
function parsePeriodYears(period) {
  if (!period) {
    return null;
  }

  const matches = String(period).match(/(\d{4})\.(\d{2})/g) || [];
  if (!matches.length) {
    return null;
  }

  const [startRaw, endRaw] = [matches[0], matches[matches.length - 1]];
  const [startYear, startMonth] = startRaw.split(".").map(Number);
  let endYear;
  let endMonth;

  if (/至今/.test(period)) {
    const now = new Date();
    endYear = now.getUTCFullYear();
    endMonth = now.getUTCMonth() + 1;
  } else {
    [endYear, endMonth] = endRaw.split(".").map(Number);
  }

  const startValue = startYear * 12 + startMonth;
  const endValue = endYear * 12 + endMonth;
  return Math.max(0, (endValue - startValue) / 12);
}

// topic 提取是启发式的，
// 它只需要足够支撑 plan/question 的证据选取，不追求本体级精确。
function extractTopics(normalizedResume) {
  const topicMap = new Map();

  const upsert = (category, label, evidence, sourceType, sourceId) => {
    const key = `${category}:${label}`;
    if (!topicMap.has(key)) {
      topicMap.set(key, {
        id: key,
        category,
        label,
        evidence: [],
        sourceRefs: []
      });
    }

    const topic = topicMap.get(key);
    if (evidence && !topic.evidence.includes(evidence)) {
      topic.evidence.push(evidence);
    }

    if (sourceId && !topic.sourceRefs.some((ref) => ref.sourceId === sourceId)) {
      topic.sourceRefs.push({ sourceType, sourceId });
    }
  };

  const skillCategoryHints = [
    { match: /c#|c\+\+|python|shell/i, category: "language_fundamentals" },
    { match: /算法|数据结构|程序化生成|hex grid/i, category: "game_algorithms" },
    { match: /unity|gameframework|editor|framesync|runtime|dsl/i, category: "game_framework" },
    { match: /架构|系统|工具链|蓝图|导入导出/i, category: "system_design" },
    { match: /agent|ai|nlp|知识图谱|prompt/i, category: "ai_agent_design" }
  ];

  for (const group of normalizedResume.skillGroups) {
    for (const item of group.items) {
      const matched = skillCategoryHints.find((hint) => hint.match.test(item) || hint.match.test(group.title));
      const category = matched?.category || "system_design";
      upsert(category, item, `技能组 ${group.title}`, "skillGroup", group.title);
    }
  }

  for (const experience of normalizedResume.experiences) {
    const evidenceLines = flattenText([
      experience.summary,
      experience.bullets,
      experience.details?.refined,
      experience.details?.original
    ]);

    for (const line of evidenceLines) {
      const lowered = line.toLowerCase();
      if (/(c#|c\+\+|python|shell)/i.test(line)) {
        upsert("language_fundamentals", "语言基础", line, "experience", experience.id);
      }
      if (/(算法|hex grid|程序化|寻路|仿真|热力图|社会关系|背包)/i.test(lowered)) {
        upsert("game_algorithms", "游戏算法与数据结构", line, "experience", experience.id);
      }
      if (/(unity|gameframework|framesync|编辑器|技能|运行时|sceneblueprint|stagedesigner)/i.test(lowered)) {
        upsert("game_framework", "Unity 与游戏框架", line, "experience", experience.id);
      }
      if (/(架构|平台|dsl|导入导出|解释执行|模块|生命周期|能力调度|构建配置)/i.test(lowered)) {
        upsert("system_design", "系统设计与工程边界", line, "experience", experience.id);
      }
      if (/(ai agent|大模型|知识图谱|nlp|模型|termtree|term-linking|知识标注)/i.test(lowered)) {
        upsert("ai_agent_design", "AI Agent 与知识系统", line, "experience", experience.id);
      }
    }
  }

  for (const project of normalizedResume.projects) {
    for (const line of pickProjectEvidence(project)) {
      const lowered = line.toLowerCase();
      if (/(unity|signalr|editor|runtime|tools|datumcore|framesync)/i.test(lowered)) {
        upsert("game_framework", project.title, line, "project", project.slug);
      }
      if (/(agent|ai|tool functions|知识|nlp|prompt)/i.test(lowered)) {
        upsert("ai_agent_design", project.title, line, "project", project.slug);
      }
      if (/(算法|difficulty|最小二乘|calibration|评分|simulation|生成)/i.test(lowered)) {
        upsert("game_algorithms", project.title, line, "project", project.slug);
      }
      if (/(architecture|架构|平台|链路|dsl|工作台|服务层|分层)/i.test(lowered)) {
        upsert("system_design", project.title, line, "project", project.slug);
      }
    }
  }

  return Array.from(topicMap.values())
    .filter((topic) => topic.evidence.length > 0)
    .sort((left, right) => right.evidence.length - left.evidence.length);
}

function normalizeResume(rawPackage) {
  const root = rawPackage.resume;
  const resumeBlock = root.resume;

  const normalized = {
    packageVersion: rawPackage.packageVersion,
    exportedAt: rawPackage.exportedAt,
    profile: {
      name: root.profile.name,
      role: root.profile.role,
      bio: root.profile.bio,
      strengths: root.profile.strengths,
      contacts: root.profile.contacts,
      estimatedYearsExperience: Number(
        ((resumeBlock.experiences || [])
          .map((experience) => parsePeriodYears(experience.period))
          .filter((value) => Number.isFinite(value))
          .reduce((sum, value) => sum + value, 0)
        ).toFixed(1)
      )
    },
    narrative: {
      headline: resumeBlock.headline,
      summaryPoints: resumeBlock.summaryPoints,
      focusAreas: (resumeBlock.focusAreas || []).filter((area) => !/^方向\s+\d+$/.test(area.title)),
      profileFacts: resumeBlock.profileFacts
    },
    experiences: (resumeBlock.experiences || []).map((experience) => ({ ...experience })),
    projects: (root.projects || []).map((project) => ({ ...project })),
    skillGroups: (resumeBlock.skillGroups || [])
      .filter((group) => group.title !== "待整理技能")
      .map((group) => ({
        title: group.title,
        items: group.items.filter((item) => item !== "请根据原始简历补充技能分组")
      })),
    honors: resumeBlock.honors,
    education: resumeBlock.education
  };

  normalized.topicInventory = extractTopics(normalized);
  return normalized;
}

let cache = null;

// 进程生命周期内简历包基本不会变化，做一次缓存即可显著降低重复建会话成本。
export async function loadResumePackage() {
  if (cache) {
    return cache;
  }

  const resume = await readJson(path.join(config.resumePackageDir, "resume.json"));
  const meta = await readJson(path.join(config.resumePackageDir, "resume.meta.json"));
  const schema = await readJson(path.join(config.resumePackageDir, "resume.schema.json"));

  cache = {
    raw: resume,
    meta,
    schema,
    normalized: normalizeResume(resume)
  };

  return cache;
}
