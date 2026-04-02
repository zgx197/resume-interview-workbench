const sessionSubscribers = new Map();

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
      // Ignore subscriber failures so one dead connection does not break others.
    }
  }
}
