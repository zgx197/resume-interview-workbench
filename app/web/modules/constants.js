export const PHASE_META = {
  observe: { label: "观察", description: "读取候选人、当前上下文与上一轮结果。" },
  deliberate: { label: "思考", description: "判断当前轮次的策略、深挖方向与搜索价值。" },
  decide: { label: "决策", description: "确定追问、切题、收尾或结束面试。" },
  execute: { label: "执行", description: "生成问题、报告或调用外部能力。" },
  feedback: { label: "反馈", description: "回写状态、更新线程并等待下一步输入。" }
};

export const TOPIC_LABELS = {
  language_fundamentals: "语言基础",
  game_algorithms: "游戏算法",
  game_framework: "游戏框架",
  system_design: "系统设计",
  ai_agent_design: "AI Agent 设计"
};

export const SESSION_STATUS_LABELS = {
  idle: "空闲",
  processing: "处理中",
  active: "进行中",
  completed: "已完成",
  failed: "失败"
};

export const THREAD_STATUS_LABELS = {
  active: "进行中",
  closed: "已关闭"
};
