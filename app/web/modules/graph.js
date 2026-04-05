import { Network } from "/vendor/vis-network.min.js";
import { PHASE_META } from "./constants.js";
import { elements } from "./dom.js";
import {
  findCurrentThread,
  findCurrentTopicNode,
  renderAssessmentDetails,
  sessionStatusLabel,
  threadStatusLabel,
  topicLabel,
  topicNodeStatusLabel
} from "./presenters.js";
import { state } from "./state.js";
import {
  escapeHtml,
  formatDateTime,
  formatDuration,
  formatJsonPreview,
  getLivePhaseDuration,
  renderMarkdown,
  renderPill,
  truncateText
} from "./utils.js";

const CATEGORY_ORDER = [
  "game_framework",
  "system_design",
  "ai_agent_design",
  "game_algorithms",
  "language_fundamentals"
];

function topicSortValue(node) {
  return (
    Number(Boolean(node.currentQuestion || node.activeThreadId)) * 1000 +
    Number(Boolean(node.covered)) * 100 +
    (node.askCount || 0) * 10 +
    (node.plannedCount || 0)
  );
}

function compareTopicNodes(left, right) {
  return (
    topicSortValue(right) - topicSortValue(left) ||
    (right.sourceCount || 0) - (left.sourceCount || 0) ||
    (right.evidenceCount || 0) - (left.evidenceCount || 0) ||
    String(left.label || "").localeCompare(String(right.label || ""))
  );
}

function relationLabel(relation) {
  const labels = {
    shared_evidence: "共享证据",
    same_category: "同类主题",
    supported_by: "证据支撑"
  };
  return labels[relation] || relation || "关联";
}

function sourceRefLabel(ref) {
  if (!ref) {
    return "暂无来源";
  }
  return `${ref.sourceType} · ${ref.sourceId}`;
}

function buildChipWrap(items = [], empty = "暂无") {
  if (!items.length) {
    return `<span class="muted">${escapeHtml(empty)}</span>`;
  }
  return items.map((item) => `<span class="topic-tag compact">${escapeHtml(item)}</span>`).join("");
}

function buildList(items = [], empty = "暂无") {
  if (!items.length) {
    return `<ul class="supporting-list"><li class="muted">${escapeHtml(empty)}</li></ul>`;
  }
  return `<ul class="supporting-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function buildPhaseDetail(phase, run) {
  const meta = PHASE_META[phase.name] || {};
  const debug = run.debug?.[phase.name === "deliberate" ? "deliberation" : phase.name] || null;
  const sections = [
    {
      title: "阶段说明",
      content: `<div class="markdown-block subtle">${renderMarkdown(meta.description, { empty: "暂无说明" })}</div>`
    },
    {
      title: "阶段摘要",
      content: `<div class="markdown-block">${renderMarkdown(phase.summary, { empty: "当前阶段暂无摘要" })}</div>`
    }
  ];

  if (debug?.question?.text) {
    sections.push({
      title: "当前草稿",
      content: `<div class="markdown-block">${renderMarkdown(debug.question.text)}</div>`
    });
  }

  if (debug?.preliminaryAssessment) {
    sections.push({
      title: "预评估",
      content: renderAssessmentDetails(debug.preliminaryAssessment)
    });
  }

  return {
    id: `phase:${phase.name}`,
    kicker: "Phase",
    title: meta.label || phase.name,
    subtitle: phase.status,
    summary: phase.summary || meta.description || "暂无摘要",
    badges: [
      phase.status,
      formatDuration(getLivePhaseDuration(phase, new Date())),
      (phase.strategyLabels || []).at(-1) || "no-model"
    ],
    metrics: [
      { label: "开始时间", value: formatDateTime(phase.startedAt) },
      { label: "结束时间", value: formatDateTime(phase.endedAt) },
      { label: "模型策略", value: (phase.strategyLabels || []).join(" / ") || "暂无" },
      { label: "阶段名称", value: phase.name }
    ],
    sections,
    raw: debug || phase
  };
}

function buildTopicDetail(node, session, neighbors) {
  const currentThread = (session.topicThreads || []).find((thread) => thread.id === node.activeThreadId) || null;
  const currentQuestion = session.nextQuestion?.topicId === node.id ? session.nextQuestion : null;
  const statusSummary = currentQuestion
    ? "当前问题正聚焦在这个主题。"
    : currentThread
      ? `当前线程仍在围绕该主题追问，状态为${threadStatusLabel(currentThread.status)}。`
      : node.covered
        ? "该主题已经被问到，并已形成覆盖记录。"
        : node.plannedCount > 0
          ? "该主题已进入计划，但尚未被真正提问。"
          : "该主题目前只存在于简历图谱中，未进入本轮计划。";

  return {
    id: node.id,
    kicker: "Topic",
    title: node.label || "未命名主题",
    subtitle: topicLabel(node.category),
    summary: statusSummary,
    badges: [
      topicLabel(node.category),
      topicNodeStatusLabel(node.status),
      `问过 ${node.askCount || 0} 次`
    ],
    metrics: [
      { label: "状态", value: topicNodeStatusLabel(node.status) },
      { label: "计划次数", value: String(node.plannedCount || 0) },
      { label: "提问次数", value: String(node.askCount || 0) },
      { label: "平均分", value: node.averageScore ?? "暂无" },
      { label: "最近得分", value: node.lastScore ?? "暂无" },
      { label: "证据源数", value: String(node.sourceCount || 0) }
    ],
    sections: [
      {
        title: "计划归属",
        content: `<div class="chip-wrap">${buildChipWrap(node.stageTitles || [], "未进入面试计划")}</div>`
      },
      {
        title: "证据摘录",
        content: buildList(node.evidence || [], "暂无证据摘录")
      },
      {
        title: "来源引用",
        content: `<div class="chip-wrap">${buildChipWrap((node.sourceRefs || []).map(sourceRefLabel), "暂无来源")}</div>`
      },
      {
        title: "关联主题",
        content: buildList(
          (neighbors || []).map((item) => `${item.label} · ${relationLabel(item.relation)} · 权重 ${item.weight || 1}`),
          "暂无关联主题"
        )
      },
      {
        title: "运行态",
        content: `
          <div class="detail-split">
            <div>
              <p class="detail-label">当前线程</p>
              <div class="markdown-block subtle">${renderMarkdown(currentThread
                ? `${currentThread.label}\n${currentThread.lastEvidenceSource || "暂无证据来源"}`
                : "暂无活跃线程")}</div>
            </div>
            <div>
              <p class="detail-label">当前问题</p>
              <div class="markdown-block subtle">${renderMarkdown(currentQuestion?.text, { empty: "当前没有问题聚焦在该主题" })}</div>
            </div>
          </div>
        `
      }
    ],
    raw: {
      node,
      neighbors,
      currentThread,
      currentQuestion
    }
  };
}

function buildTopicColor(node) {
  if (node.currentQuestion || node.activeThreadId) {
    return {
      background: "#e7f7f3",
      border: "#0f766e"
    };
  }
  if (node.covered) {
    return {
      background: "#f1f8ee",
      border: "#4f7f52"
    };
  }
  if (node.plannedCount > 0) {
    return {
      background: "#fbf4ec",
      border: "#b89f80"
    };
  }
  return {
    background: "#f6f2ed",
    border: "#cfc1af"
  };
}

function buildTopicGraphSpec(session) {
  const topicGraph = session.topicGraph || { nodes: [], edges: [] };
  const details = new Map();
  const nodes = [];
  const edges = [];
  const categoryOrder = [
    ...CATEGORY_ORDER,
    ...Array.from(new Set((topicGraph.nodes || []).map((node) => node.category))).filter((category) => !CATEGORY_ORDER.includes(category))
  ];

  const groupedNodes = categoryOrder
    .map((category) => ({
      category,
      nodes: (topicGraph.nodes || [])
        .filter((node) => node.category === category)
        .sort(compareTopicNodes)
    }))
    .filter((group) => group.nodes.length > 0);

  const categorySpacing = 280;
  const rowSpacing = 112;
  const categoryOffset = (groupedNodes.length - 1) / 2;
  const nodeMap = new Map((topicGraph.nodes || []).map((node) => [node.id, node]));
  const neighborMap = new Map();

  for (const edge of topicGraph.edges || []) {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) {
      continue;
    }

    const neighborEntry = {
      id: edge.id,
      relation: edge.relation,
      weight: edge.weight,
      label: toNode.label
    };
    const reverseEntry = {
      id: edge.id,
      relation: edge.relation,
      weight: edge.weight,
      label: fromNode.label
    };

    neighborMap.set(edge.from, [...(neighborMap.get(edge.from) || []), neighborEntry]);
    neighborMap.set(edge.to, [...(neighborMap.get(edge.to) || []), reverseEntry]);
  }

  groupedNodes.forEach((group, categoryIndex) => {
    const x = (categoryIndex - categoryOffset) * categorySpacing;
    group.nodes.forEach((node, index) => {
      const y = index * rowSpacing;
      const color = buildTopicColor(node);

      nodes.push({
        id: node.id,
        x,
        y,
        physics: false,
        label: `${truncateText(node.label, 18)}\n${topicNodeStatusLabel(node.status)} · ${node.askCount || 0}`,
        color: {
          background: color.background,
          border: color.border,
          highlight: {
            background: "#fff7ec",
            border: "#0f766e"
          }
        },
        borderWidth: node.currentQuestion || node.activeThreadId ? 3 : 1.8
      });

      details.set(node.id, buildTopicDetail(
        node,
        session,
        (neighborMap.get(node.id) || []).sort((left, right) => (right.weight || 0) - (left.weight || 0)).slice(0, 6)
      ));
    });
  });

  const visibleEdgeIds = new Set();
  const prioritizedNodeIds = new Set(
    (topicGraph.nodes || [])
      .filter((node) => node.currentQuestion || node.activeThreadId || node.covered || node.plannedCount > 0)
      .map((node) => node.id)
  );

  for (const edge of [...(topicGraph.edges || [])].sort((left, right) => (right.weight || 0) - (left.weight || 0))) {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) {
      continue;
    }
    if (visibleEdgeIds.size >= 120) {
      break;
    }

    const isPriorityEdge = (
      edge.relation === "shared_evidence" ||
      prioritizedNodeIds.has(edge.from) ||
      prioritizedNodeIds.has(edge.to)
    );

    if (!isPriorityEdge) {
      continue;
    }

    visibleEdgeIds.add(edge.id);
    edges.push({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      arrows: "",
      smooth: false,
      width: edge.relation === "shared_evidence" ? 2.2 : 1.2,
      dashes: edge.relation !== "shared_evidence",
      color: {
        color: edge.relation === "shared_evidence" ? "#9fb6b1" : "#d0c3b4",
        highlight: "#0f766e"
      }
    });
  }

  const defaultNode = findCurrentTopicNode(session)
    || topicGraph.nodes?.find((node) => node.covered)
    || topicGraph.nodes?.find((node) => node.plannedCount > 0)
    || topicGraph.nodes?.[0]
    || null;

  const activeNodeId = details.has(state.selectedGraphNodeId)
    ? state.selectedGraphNodeId
    : defaultNode?.id || "";

  state.selectedGraphNodeId = activeNodeId;
  return { nodes, edges, details, activeNodeId };
}

function renderGraphDetail(detail) {
  if (!detail) {
    elements.graphDetail.className = "graph-detail empty-state";
    elements.graphDetail.textContent = "选择图中的主题后，这里会显示该节点的详细信息。";
    return;
  }

  elements.graphDetail.className = "graph-detail";
  elements.graphDetail.innerHTML = `
    <article class="graph-detail-card">
      <header class="graph-detail-header">
        <div>
          <p class="card-kicker">${escapeHtml(detail.kicker)}</p>
          <h3 class="card-title">${escapeHtml(detail.title)}</h3>
          <p class="summary-copy">${escapeHtml(detail.summary || detail.subtitle || "暂无摘要")}</p>
        </div>
        <div class="summary-badges">
          ${(detail.badges || []).map((badge) => renderPill(badge)).join("")}
        </div>
      </header>

      <div class="metric-grid compact">
        ${(detail.metrics || []).map((item) => `
          <div class="metric-tile">
            <span class="metric-label">${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
          </div>
        `).join("")}
      </div>

      <div class="graph-detail-sections">
        ${(detail.sections || []).map((section) => `
          <section class="graph-detail-section">
            <p class="detail-label">${escapeHtml(section.title)}</p>
            ${section.content}
          </section>
        `).join("")}
      </div>

      <details class="raw-json">
        <summary>查看结构化原始数据</summary>
        ${formatJsonPreview(detail.raw)}
      </details>
    </article>
  `;
}

function ensureRunGraphShell() {
  if (state.graphShellReady && elements.runGraph.querySelector("#graph-network")) {
    return;
  }

  elements.runGraph.className = "run-graph";
  elements.runGraph.innerHTML = `
    <div class="run-overview">
      <div class="metric-tile accent">
        <span class="metric-label">当前阶段</span>
        <strong id="run-phase-label">--</strong>
      </div>
      <div class="metric-tile">
        <span class="metric-label">当前主题</span>
        <strong id="run-kind-label">--</strong>
      </div>
      <div class="metric-tile">
        <span class="metric-label">覆盖进度</span>
        <strong id="run-phase-duration">--</strong>
      </div>
      <div class="metric-tile">
        <span class="metric-label">当前策略</span>
        <strong id="run-strategy-label">--</strong>
      </div>
    </div>
    <div class="graph-surface">
      <div id="graph-network" class="graph-network"></div>
    </div>
  `;
  state.graphShellReady = true;
}

function syncGraphView(spec) {
  if (!state.graphNetwork) {
    initializeGraphView(spec);
    return;
  }

  const nodesData = state.graphNetwork.body.data.nodes;
  const edgesData = state.graphNetwork.body.data.edges;

  const nextNodeIds = new Set(spec.nodes.map((node) => node.id));
  const removedNodeIds = nodesData.getIds().filter((id) => !nextNodeIds.has(id));
  if (removedNodeIds.length) {
    nodesData.remove(removedNodeIds);
  }
  nodesData.update(spec.nodes);

  const nextEdgeIds = new Set(spec.edges.map((edge) => edge.id || `${edge.from}->${edge.to}`));
  const removedEdgeIds = edgesData.get()
    .filter((edge) => !nextEdgeIds.has(edge.id || `${edge.from}->${edge.to}`))
    .map((edge) => edge.id);
  if (removedEdgeIds.length) {
    edgesData.remove(removedEdgeIds);
  }
  edgesData.update(spec.edges.map((edge) => ({
    id: edge.id || `${edge.from}->${edge.to}`,
    ...edge
  })));

  if (spec.activeNodeId) {
    state.graphNetwork.selectNodes([spec.activeNodeId]);
  } else {
    state.graphNetwork.unselectAll();
  }
}

function initializeGraphView(spec) {
  const container = document.querySelector("#graph-network");
  if (!container) {
    return;
  }

  destroyGraphNetwork();
  state.graphNetwork = new Network(container, {
    nodes: spec.nodes,
    edges: spec.edges
  }, {
    autoResize: true,
    layout: {
      improvedLayout: false
    },
    physics: false,
    interaction: {
      dragNodes: true,
      dragView: true,
      zoomView: true,
      hover: true,
      multiselect: false
    },
    nodes: {
      shape: "box",
      borderWidth: 1.5,
      borderRadius: 18,
      margin: {
        top: 14,
        right: 16,
        bottom: 14,
        left: 16
      },
      widthConstraint: {
        minimum: 160,
        maximum: 196
      },
      font: {
        face: "\"Microsoft YaHei\", sans-serif",
        size: 15,
        color: "#1f1a16"
      }
    },
    edges: {
      smooth: false,
      selectionWidth: 0,
      hoverWidth: 0
    }
  });

  state.graphNetwork.once("afterDrawing", () => {
    state.graphNetwork?.fit({
      animation: {
        duration: 280,
        easingFunction: "easeInOutQuad"
      },
      minZoomLevel: 0.42,
      maxZoomLevel: 1.1
    });
  });

  state.graphNetwork.on("click", (params) => {
    if (!params.nodes?.length) {
      return;
    }
    state.selectedGraphNodeId = params.nodes[0];
    renderGraphDetail(spec.details.get(state.selectedGraphNodeId));
  });

  if (spec.activeNodeId) {
    state.graphNetwork.selectNodes([spec.activeNodeId]);
  }
  state.graphShellReady = true;
}

export function destroyGraphNetwork() {
  if (state.graphNetwork) {
    state.graphNetwork.destroy();
    state.graphNetwork = null;
  }
  state.graphShellReady = false;
}

export function renderRunState() {
  if (!state.session?.topicGraph?.nodes?.length) {
    destroyGraphNetwork();
    elements.runStatus.textContent = "idle";
    elements.runGraph.className = "run-graph empty-state";
    elements.runGraph.textContent = "开始面试后，这里会显示当前主题图谱。";
    elements.graphDetail.className = "graph-detail empty-state";
    elements.graphDetail.textContent = "选择图中的主题后，这里会显示该节点的详细信息。";
    return;
  }

  const session = state.session;
  const run = session.currentRun || { phase: "idle", phaseStatus: [] };
  const activePhase = (run.phaseStatus || []).find((phase) => phase.name === run.phase) || null;
  const currentPhaseMeta = PHASE_META[run.phase] || null;
  const currentTopic = findCurrentTopicNode(session);
  const coveredTopics = (session.topicGraph.nodes || []).filter((node) => node.covered).length;
  const plannedTopics = (session.topicGraph.nodes || []).filter((node) => node.plannedCount > 0).length;
  const strategyPreview = activePhase?.strategyLabels?.at(-1)
    || session.nextQuestion?._providerMeta?.strategyLabel
    || "waiting strategy";
  const spec = buildTopicGraphSpec(session);

  elements.runStatus.textContent = `${sessionStatusLabel(session.status)} 路 ${coveredTopics}/${plannedTopics || session.topicGraph.nodes.length} 已覆盖`;
  ensureRunGraphShell();
  elements.runGraph.querySelector("#run-phase-label").textContent = currentPhaseMeta?.label || sessionStatusLabel(session.status);
  elements.runGraph.querySelector("#run-kind-label").textContent = currentTopic?.label || findCurrentThread(session)?.label || "暂无主题";
  elements.runGraph.querySelector("#run-phase-duration").textContent = `${coveredTopics} / ${plannedTopics || session.topicGraph.nodes.length} 主题`;
  elements.runGraph.querySelector("#run-strategy-label").textContent = strategyPreview;

  syncGraphView(spec);
  renderGraphDetail(spec.details.get(spec.activeNodeId) || buildPhaseDetail(activePhase || {
    name: run.phase || "idle",
    status: run.status || session.status,
    summary: "",
    startedAt: null,
    endedAt: null,
    durationMs: null,
    strategyLabels: []
  }, run));
}
