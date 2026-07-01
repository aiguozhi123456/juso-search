import { ProviderError } from './providers/types';

// 最小 MCP streamableHttp 客户端（KTD7）。
// Stepfun Step Plan 的 web_search 仅经 MCP 暴露；服务端无状态（无 Mcp-Session-Id）。
// 协议：initialize（握手）→ tools/call。响应可能是 JSON 或 SSE，均解析。

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface McpToolResult {
  content?: Array<{ type?: string; text?: string }>;
}

const HEADERS = (apiKey: string): Record<string, string> => ({
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  'MCP-Protocol-Version': '2025-06-18',
});

/** 取最后一条 `data:` 行作为最终 JSON-RPC 结果（MCP 终止事件）。 */
function parseSseEvent<T>(raw: string): JsonRpcResponse<T> {
  const lines = raw.split('\n');
  let lastData = '';
  for (const line of lines) {
    if (line.startsWith('data:')) lastData = line.slice(5).trim();
  }
  if (!lastData) throw new Error('empty SSE');
  return JSON.parse(lastData) as JsonRpcResponse<T>;
}

async function rpc<T>(
  url: string,
  apiKey: string,
  payload: object,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: HEADERS(apiKey), body: JSON.stringify(payload) });
  } catch {
    throw new ProviderError('network', 'MCP：网络错误，无法连接服务');
  }
  if (res.status === 401 || res.status === 403)
    throw new ProviderError('unauthorized', 'MCP：无效或缺失 API key', res.status);
  if (res.status === 429) throw new ProviderError('rateLimit', 'MCP：请求过频', res.status);
  if (res.status >= 400) throw new ProviderError('provider', `MCP：HTTP ${res.status}`, res.status);

  const contentType = res.headers.get('content-type') ?? '';
  let envelope: JsonRpcResponse<T>;
  try {
    const raw = await res.text();
    envelope = contentType.includes('text/event-stream')
      ? parseSseEvent<T>(raw)
      : (JSON.parse(raw) as JsonRpcResponse<T>);
  } catch {
    throw new ProviderError('parse', 'MCP：响应解析失败');
  }
  if (envelope.error) throw new ProviderError('provider', `MCP：${envelope.error.message}`);
  if (!envelope.result) throw new ProviderError('provider', 'MCP：响应缺少 result');
  return envelope.result;
}

/**
 * 调用 Stepfun Step Plan 的 MCP `web_search` 工具，返回 `content[0].text`
 * （一个 JSON 字符串：{ query, category, results:[{url,position,title,time,snippet,content}] }）。
 */
export async function mcpWebSearch(url: string, apiKey: string, query: string): Promise<string> {
  await rpc(url, apiKey, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'ai-search-for-humans', version: '0.1.0' },
    },
  });

  const tool = await rpc<McpToolResult>(
    url,
    apiKey,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'web_search', arguments: { query } },
    },
  );

  const text = tool.content?.[0]?.text;
  if (!text) throw new ProviderError('parse', 'MCP：web_search 未返回文本');
  return text;
}
