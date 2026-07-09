import { ProviderError, type ProviderTransport, type SearchOptions } from './providers/types';
import { appendProviderErrorDetail, readProviderErrorDetail } from './providers/http';
import { t, MSG } from './i18n';

// 最小 MCP streamableHttp 客户端（KTD7）。
// Stepfun Step Plan 的 web_search 仅经 MCP 暴露。探查显示该端点无状态（无 Mcp-Session-Id），
// 但仍防御性地捕获并回传 session id，以兼容会话强制的服务端。
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

function headersFor(apiKey: string, sessionId?: string | null): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-06-18',
  };
  if (sessionId) h['Mcp-Session-Id'] = sessionId;
  return h;
}

/**
 * 解析 SSE：按空行切分事件；跳过 `event: ping`；取最后一个非 ping 事件的 data
 * （同一事件多行 data 按 SSE 规范以 `\n` 拼接）。
 */
function parseSseEvent<T>(raw: string): JsonRpcResponse<T> {
  const events = raw.split(/\n\s*\n/);
  let chosen: string | null = null;
  for (const ev of events) {
    const lines = ev.split('\n');
    let eventType = 'message';
    const dataParts: string[] = [];
    for (const ln of lines) {
      if (ln.startsWith('event:')) eventType = ln.slice(6).trim();
      else if (ln.startsWith('data:')) dataParts.push(ln.slice(5).replace(/^ /, ''));
    }
    if (dataParts.length && eventType !== 'ping') chosen = dataParts.join('\n');
  }
  if (!chosen) throw new Error('empty SSE');
  return JSON.parse(chosen) as JsonRpcResponse<T>;
}

async function rpc<T>(
  url: string,
  apiKey: string,
  payload: object,
  sessionId?: string | null,
): Promise<{ result: T; sessionId: string | null }> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: headersFor(apiKey, sessionId), body: JSON.stringify(payload) });
  } catch {
    throw new ProviderError('network', t(MSG.error_mcp_network));
  }
  if (!res.ok) {
    const detail = await readProviderErrorDetail(res);
    if (res.status === 401 || res.status === 403)
      throw new ProviderError('unauthorized', appendProviderErrorDetail(t(MSG.error_mcp_unauthorized), detail), res.status);
    if (res.status === 429)
      throw new ProviderError('rateLimit', appendProviderErrorDetail(t(MSG.error_mcp_rate_limit), detail), res.status);
    throw new ProviderError('provider', appendProviderErrorDetail(t(MSG.error_mcp_http, String(res.status)), detail), res.status);
  }

  const nextSessionId = res.headers.get('Mcp-Session-Id');
  const contentType = res.headers.get('content-type') ?? '';
  let envelope: JsonRpcResponse<T>;
  try {
    const raw = await res.text();
    envelope = contentType.includes('text/event-stream')
      ? parseSseEvent<T>(raw)
      : (JSON.parse(raw) as JsonRpcResponse<T>);
  } catch {
    throw new ProviderError('parse', t(MSG.error_mcp_parse));
  }
  if (envelope.error) throw new ProviderError('provider', t(MSG.error_mcp_upstream, envelope.error.message));
  if (!envelope.result) throw new ProviderError('provider', t(MSG.error_mcp_no_result));
  return { result: envelope.result, sessionId: nextSessionId };
}

/**
 * 调用 Stepfun Step Plan 的 MCP `web_search` 工具，返回 `content[0].text`
 * （一个 JSON 字符串：{ query, category, results:[{url,position,title,time,snippet,content}] }）。
 */
export async function mcpWebSearch(url: string, apiKey: string, query: string): Promise<string> {
  const init = await rpc(
    url,
    apiKey,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'juso-search', version: '0.1.0' },
      },
    },
  );

  const tool = await rpc<McpToolResult>(
    url,
    apiKey,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'web_search', arguments: { query } },
    },
    init.sessionId,
  );

  const text = tool.result.content?.[0]?.text;
  if (!text) throw new ProviderError('parse', t(MSG.error_mcp_no_text));
  return text;
}

/** MCP 传输配置。 */
export interface McpTransportConfig {
  endpoint: string;
}

/** 把 mcpWebSearch 包成一个 ProviderTransport<string>。返回的是工具调用文本（normalize 内自行 JSON.parse）。
 *  错误映射沿用 mcp-client 自有的 error_mcp_* 路径（不与 REST 的 mapStatus / error_http_* 混用）。 */
export function mcpTransport(cfg: McpTransportConfig): ProviderTransport<string> {
  return {
    async send(query, _opts: SearchOptions, apiKey) {
      return mcpWebSearch(cfg.endpoint, apiKey, query);
    },
  };
}
