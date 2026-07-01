// 测试用 Response 替身：支持 status/headers.get/text/json（覆盖 REST 与 MCP 两种用法）。
export function res(status: number, body: unknown, contentType = 'application/json'): Response {
  return {
    ok: status < 400,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  } as unknown as Response;
}
