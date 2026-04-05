// 轻量 fetch 封装，把后端错误响应统一转成可抛出的异常对象。
export function request(url, options = {}) {
  return fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error?.message || "请求失败");
    }
    return payload;
  });
}
