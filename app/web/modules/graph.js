import { Network } from "/vendor/vis-network.min.js";
import { PHASE_META } from "./constants.js";
import { elements } from "./dom.js";
import { findCurrentThread, renderAssessmentDetails, threadStatusLabel, topicLabel } from "./presenters.js";
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

// graph.js 负责调试态状态图。
// 它会把 currentRun、当前线程和待回答问题拼成一张轻量节点图。
function toDebugKey(phaseName) {
  return phaseName === "deliberate" ? "deliberation" : phaseName;
}

export function destroyGraphNetwork() {
  if (state.graphNetwork) {
    state.graphNetwork.destroy();
    state.graphNetwork = null;
  }
  state.graphShellReady = false;
}

// 每个 detail builder 都负责把一种运行时对象
// 转成图谱右侧的详情卡片。
function buildPhaseDetail(phase, run) {
  const meta = PHASE_META[phase.name] || {};
  const debug = run.debug?.[toDebugKey(phase.name)] || null;
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

  if (debug?.summary) {
    sections.push({
      title: "AI 当前思路",
      content: `<div class="markdown-block">${renderMarkdown(debug.summary)}</div>`
    });
  }

  if (debug?.question?.text) {
    sections.push({
      title: "问题草案",
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
    kicker: "State Node",
    title: meta.label || phase.name,
    subtitle: phase.status,
    summary: phase.summary || meta.description || "当前阶段暂无摘要。",
    badges: [
      phase.status,
      formatDuration(getLivePhaseDuration(phase, new Date())),
      (phase.strategyLabels || []).at(-1) || "no-model"
    ],
    metrics: [
      { label: "开始时间", value: formatDateTime(phase.startedAt) },
      { label: "结束时间", value: formatDateTime(phase.endedAt) },
      { label: "模型策略", value: (phase.strategyLabels || []).join(" · ") || "当前阶段没有模型调用" },
      { label: "阶段名称", value: phase.name }
    ],
    sections,
    raw: debug || phase
  };
}

function buildThreadDetail(thread) {
  const closure = thread.closureReason || (thread.status === "active" ? "进行中" : "已关闭");
  return {
    id: `thread:${thread.id}`,
    kicker: "Thread Node",
    title: thread.label || topicLabel(thread.category),
    subtitle: threadStatusLabel(thread.status),
    summary: closure,
    badges: [
      topicLabel(thread.category),
      `Q ${thread.questionCount}`,
      `F ${thread.followupCount}`,
      `S ${thread.searchCount}`
    ],
    metrics: [
      { label: "状态", value: threadStatusLabel(thread.status) },
      { label: "打开时间", value: formatDateTime(thread.openedAt) },
      { label: "关闭时间", value: formatDateTime(thread.closedAt) },
      { label: "证据源", value: thread.lastEvidenceSource || "暂无" }
    ],
    sections: [
      {
        title: "线程概述",
        content: `<div class="markdown-block subtle">${renderMarkdown(closure)}</div>`
      },
      {
        title: "最近问题",
        content: `<div class="markdown-block">${renderMarkdown(thread.lastQuestionText, { empty: "暂无问题记录" })}</div>`
      }
    ],
    raw: thread
  };
}

function buildQuestionDetail(question) {
  return {
    id: "question:current",
    kicker: "Question Node",
    title: "当前问题",
    subtitle: topicLabel(question.topicCategory),
    summary: truncateText(question.text, 120),
    badges: [
      question._providerMeta?.strategyLabel || "question",
      question.evidenceSource || "无证据来源"
    ],
    metrics: [
      { label: "主题", value: topicLabel(question.topicCategory) },
      { label: "证据源", value: question.evidenceSource || "暂无" },
      { label: "线程 ID", value: question.threadId || "暂无" }
    ],
    sections: [
      {
        title: "问题内容",
        content: `<div class="markdown-block">${renderMarkdown(question.text)}</div>`
      },
      {
        title: "出题意图",
        content: `<div class="markdown-block subtle">${renderMarkdown(question.rationale, { empty: "暂无" })}</div>`
      }
    ],
    raw: question
  };
}

// 节点布局刻意做成确定性，
// 避免运行过程中频繁重绘导致图谱不断跳动。
function buildGraphSpec(session) {
  const run = session.currentRun;
  const now = new Date();
  const details = new Map();
  const nodes = [];
  const edges = [];
  const orderedPhases = run.phaseStatus || [];
  const total = orderedPhases.length || 1;
  const phaseX = new Map();

  orderedPhases.forEach((phase, index) => {
    const meta = PHASE_META[phase.name] || {};
    const nodeId = `phase:${phase.name}`;
    const x = (index - (total - 1) / 2) * 320;
    phaseX.set(phase.name, x);

    nodes.push({
      id: nodeId,
      x,
      y: 0,
      physics: false,
      label: `${meta.label || phase.name}\n${phase.status}\n${formatDuration(getLivePhaseDuration(phase, now))}`,
      color: {
        background: phase.status === "running"
          ? "#e7f7f3"
          : phase.status === "completed"
            ? "#ecf8f0"
            : phase.status === "failed"
              ? "#f9ece8"
              : "#fbf4ec",
        border: phase.status === "running"
          ? "#0f766e"
          : phase.status === "completed"
            ? "#2f855a"
            : phase.status === "failed"
              ? "#c05621"
              : "#cebba5",
        highlight: {
          background: "#fff7ec",
          border: "#0f766e"
        }
      },
      borderWidth: run.phase === phase.name && run.status === "running" ? 3 : 1.6
    });
    details.set(nodeId, buildPhaseDetail(phase, run));

    if (index > 0) {
      edges.push({
        id: `edge:phase:${orderedPhases[index - 1].name}->${phase.name}`,
        from: `phase:${orderedPhases[index - 1].name}`,
        to: nodeId,
        arrows: "to",
        smooth: false,
        width: 2,
        color: { color: "#9eb7b7", highlight: "#0f766e" }
      });
    }
  });

  const currentThread = findCurrentThread(session);
  if (currentThread) {
    const threadId = `thread:${currentThread.id}`;
    const executeX = phaseX.get("execute") ?? phaseX.get(run.phase) ?? 0;
    const feedbackX = phaseX.get("feedback") ?? executeX + 320;
    const threadX = Math.round((executeX + feedbackX) / 2);

    nodes.push({
      id: threadId,
      x: threadX,
      y: 220,
      physics: false,
      label: `当前线程\n${truncateText(currentThread.label || topicLabel(currentThread.category), 22)}\n追问 ${currentThread.followupCount} · 搜索 ${currentThread.searchCount}`,
      color: {
        background: currentThread.status === "active" ? "#effaf7" : "#f8f2ea",
        border: currentThread.status === "active" ? "#0f766e" : "#b89f80",
        highlight: {
          background: "#fff7ec",
          border: "#0f766e"
        }
      },
      borderWidth: currentThread.status === "active" ? 2.4 : 1.6
    });
    details.set(threadId, buildThreadDetail(currentThread));
    edges.push({
      id: `edge:phase:execute->thread:${currentThread.id}`,
      from: "phase:execute",
      to: threadId,
      arrows: "to",
      smooth: { enabled: true, type: "cubicBezier", roundness: 0.16 },
      width: 2,
      dashes: currentThread.status !== "active",
      color: { color: "#b7b9ab", highlight: "#0f766e" }
    });

    if (session.nextQuestion) {
      nodes.push({
        id: "question:current",
        x: threadX,
        y: 430,
        physics: false,
        label: `当前问题\n${truncateText(session.nextQuestion.text, 30)}`,
        color: {
          background: "#f3faf8",
          border: "#4f8b86",
          highlight: {
            background: "#fff7ec",
            border: "#0f766e"
          }
        },
        borderWidth: 2
      });
      details.set("question:current", buildQuestionDetail(session.nextQuestion));
      edges.push({
        id: `edge:thread:${currentThread.id}->question:current`,
        from: threadId,
        to: "question:current",
        arrows: "to",
        smooth: { enabled: true, type: "cubicBezier", roundness: 0.08 },
        width: 2,
        color: { color: "#c2b49e", highlight: "#0f766e" }
      });
      edges.push({
        id: "edge:question:current->phase:feedback",
        from: "question:current",
        to: "phase:feedback",
        arrows: "to",
        smooth: { enabled: true, type: "cubicBezier", roundness: -0.16 },
        width: 2,
        dashes: true,
        color: { color: "#c6baa8", highlight: "#0f766e" }
      });
    } else {
      edges.push({
        id: `edge:thread:${currentThread.id}->phase:feedback`,
        from: threadId,
        to: "phase:feedback",
        arrows: "to",
        smooth: { enabled: true, type: "cubicBezier", roundness: -0.12 },
        width: 2,
        dashes: true,
        color: { color: "#c6baa8", highlight: "#0f766e" }
      });
    }
  }

  const activeNodeId = details.has(state.selectedGraphNodeId)
    ? state.selectedGraphNodeId
    : (details.has(`phase:${run.phase}`) ? `phase:${run.phase}` : details.keys().next().value || "");

  state.selectedGraphNodeId = activeNodeId;
  return { nodes, edges, details, activeNodeId };
}

function renderGraphDetail(detail) {
  if (!detail) {
    elements.graphDetail.className = "graph-detail empty-state";
    elements.graphDetail.textContent = "选择图中的节点后，这里会显示该节点的详细信息。";
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
        <span class="metric-label">当前回合</span>
        <strong id="run-kind-label">--</strong>
      </div>
      <div class="metric-tile">
        <span class="metric-label">阶段耗时</span>
        <strong id="run-phase-duration">--</strong>
      </div>
      <div class="metric-tile">
        <span class="metric-label">模型策略</span>
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
  const currentPositions = state.graphNetwork.getPositions();

  const nextNodes = spec.nodes.map((node) => {
    const current = currentPositions[node.id];
    return current ? { ...node, x: current.x, y: current.y } : node;
  });

  const nextNodeIds = new Set(nextNodes.map((node) => node.id));
  const currentNodeIds = nodesData.getIds();
  const removedNodeIds = currentNodeIds.filter((id) => !nextNodeIds.has(id));
  if (removedNodeIds.length) {
    nodesData.remove(removedNodeIds);
  }
  nodesData.update(nextNodes);

  const nextEdgeIds = new Set(spec.edges.map((edge) => edge.id || `${edge.from}->${edge.to}`));
  const currentEdges = edgesData.get();
  const removedEdgeIds = currentEdges
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
      borderRadius: 20,
      margin: {
        top: 16,
        right: 18,
        bottom: 16,
        left: 18
      },
      widthConstraint: {
        minimum: 180,
        maximum: 220
      },
      font: {
        face: "Microsoft YaHei",
        size: 16,
        color: "#1f1a16"
      },
      shadow: {
        enabled: false
      }
    },
    edges: {
      smooth: false,
      selectionWidth: 0,
      hoverWidth: 0,
      arrows: {
        to: {
          enabled: true,
          scaleFactor: 0.72
        }
      }
    }
  });

  state.graphNetwork.once("afterDrawing", () => {
    state.graphNetwork?.fit({
      animation: {
        duration: 300,
        easingFunction: "easeInOutQuad"
      },
      minZoomLevel: 0.72,
      maxZoomLevel: 1.05
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

export function renderRunState() {
  if (!state.session?.currentRun) {
    destroyGraphNetwork();
    elements.runStatus.textContent = "idle";
    elements.runGraph.className = "run-graph empty-state";
    elements.runGraph.textContent = "开始面试后，这里会显示当前回合的状态图。";
    elements.graphDetail.className = "graph-detail empty-state";
    elements.graphDetail.textContent = "选择图中的节点后，这里会显示该节点的详细信息。";
    return;
  }

  const run = state.session.currentRun;
  const currentPhaseMeta = PHASE_META[run.phase] || {};
  const activePhase = (run.phaseStatus || []).find((phase) => phase.name === run.phase) || null;
  const strategyPreview = activePhase?.strategyLabels?.at(-1)
    || state.session.nextQuestion?._providerMeta?.strategyLabel
    || "waiting strategy";
  const spec = buildGraphSpec(state.session);

  elements.runStatus.textContent = `${run.kind} · ${run.status}`;
  ensureRunGraphShell();
  elements.runGraph.querySelector("#run-phase-label").textContent = currentPhaseMeta.label || run.phase || "idle";
  elements.runGraph.querySelector("#run-kind-label").textContent = `${run.kind} · ${run.status}`;
  elements.runGraph.querySelector("#run-phase-duration").textContent = formatDuration(getLivePhaseDuration(activePhase, new Date()));
  elements.runGraph.querySelector("#run-strategy-label").textContent = strategyPreview;

  syncGraphView(spec);
  renderGraphDetail(spec.details.get(spec.activeNodeId));
}
