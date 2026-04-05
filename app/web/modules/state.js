// 单一可变客户端状态仓库。
// 这个项目规模不大，没必要再引入额外状态管理库。
export const state = {
  bootstrap: null,
  session: null,
  eventSource: null,
  streamSessionId: null,
  runClock: null,
  graphNetwork: null,
  graphShellReady: false,
  selectedGraphNodeId: "",
  currentTemplateId: "",
  loadedTemplateSnapshot: ""
};
