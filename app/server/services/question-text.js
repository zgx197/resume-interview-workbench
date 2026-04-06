function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function splitQuestionUnits(text) {
  const units = [];
  let current = "";

  for (const char of text) {
    current += char;
    if (/[?\uFF1F]/.test(char)) {
      units.push(current.trim());
      current = "";
    }
  }

  if (current.trim()) {
    units.push(current.trim());
  }

  return units.filter(Boolean);
}

function stripLeadingMarkers(text) {
  return String(text || "")
    .replace(/^[\s\-*#]+/, "")
    .replace(/^\d+[\.\)\u3001]\s*/, "")
    .trim();
}

// 面试题文案要保持单轮可答。
// 这里统一把模型题目、fallback 题目和本地兜底题目都收敛到最多两个连续问句。
export function normalizeInterviewQuestionText(text, { maxQuestions = 2, maxLength = 180 } = {}) {
  const collapsed = collapseWhitespace(text);
  if (!collapsed) {
    return "";
  }

  const units = splitQuestionUnits(collapsed);
  if (!units.length) {
    return collapsed.slice(0, maxLength).trim();
  }

  const selected = [];
  let explicitQuestionCount = 0;

  for (const unit of units) {
    const normalizedUnit = stripLeadingMarkers(unit);
    if (!normalizedUnit) {
      continue;
    }

    selected.push(normalizedUnit);
    if (/[?\uFF1F]$/.test(normalizedUnit)) {
      explicitQuestionCount += 1;
      if (explicitQuestionCount >= maxQuestions) {
        break;
      }
    } else if (selected.length >= maxQuestions && explicitQuestionCount === 0) {
      break;
    }
  }

  const joined = selected.join(" ").slice(0, maxLength).trim();
  return joined || collapsed.slice(0, maxLength).trim();
}
