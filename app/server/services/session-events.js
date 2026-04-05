const sessionSubscribers = new Map();

// 订阅者按 session 维度分桶，保证浏览器只接收自己打开的会话流。
function getBucket(sessionId) {
  if (!sessionSubscribers.has(sessionId)) {
    sessionSubscribers.set(sessionId, new Set());
  }
  return sessionSubscribers.get(sessionId);
}

export function subscribeSession(sessionId, handler) {
  const bucket = getBucket(sessionId);
  bucket.add(handler);

  return () => {
    bucket.delete(handler);
    if (!bucket.size) {
      sessionSubscribers.delete(sessionId);
    }
  };
}

export function publishSession(sessionId, payload) {
  const bucket = sessionSubscribers.get(sessionId);
  if (!bucket?.size) {
    return;
  }

  for (const handler of bucket) {
    try {
      handler(payload);
    } catch {
      // 单个订阅者异常不能影响其他连接继续接收更新。
    }
  }
}
