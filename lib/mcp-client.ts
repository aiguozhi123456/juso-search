import { ProviderError, type ProviderTransport, type SearchOptions } from './providers/types';
import { appendProviderErrorDetail, readProviderErrorDetail } from './providers/http';
import { t, MSG } from './i18n';

// 最小 MCP streamableHttp 客户端（KTD7）。
// Stepfun Step Plan 的 web_search 仅经 MCP 暴露。探查显示该端点无状态（无 Mcp-Session-Id），
// 但仍防御性地捕获并回传 session id，以兼容会话强制的服务端。
// 协议：initialize（握手）→ notifications/initialized（fire-and-forget，MCP spec 2025-06-18
// 生命周期要求；无状态端点对其响应被忽略）→ tools/call。响应可能是 JSON 或 SSE，均解析。

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface McpToolResult {
  /** MCP 用 isError=true 标记工具执行失败；错误文本仍在 content[0].text。 */
  isError?: boolean;
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
 * 解析 SSE：按空行切分事件；跳过 `event: ping`；只取 JSON-RPC 响应 `id` 与请求 id 匹配的
 * 事件（streamableHttp 服务器可能把通知帧——无 id 或 id 不符——与响应交错发送，盲取最后
 * 事件会错配）。同一事件多行 data 按 SSE 规范以 `\n` 拼接；无匹配事件则抛错（由 rpc
 * 归一为 parse 错误）。
 */
function parseSseEvent<T>(raw: string, expectedId: number): JsonRpcResponse<T> {
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
    if (!dataParts.length || eventType === 'ping') continue;
    const data = dataParts.join('\n');
    try {
      if ((JSON.parse(data) as { id?: unknown }).id === expectedId) chosen = data;
    } catch {
      // 非 JSON 帧：忽略；无匹配时最终抛 empty SSE。
    }
  }
  if (!chosen) throw new Error('empty SSE');
  return JSON.parse(chosen) as JsonRpcResponse<T>;
}

async function rpc<T>(
  url: string,
  apiKey: string,
  expectedId: number,
  payload: object,
  sessionId?: string | null,
  signal?: AbortSignal,
): Promise<{ result: T; sessionId: string | null }> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: headersFor(apiKey, sessionId), body: JSON.stringify(payload), signal });
  } catch (e) {
    // 取消是预期控制流，不归为 network（与 providers/http.ts 的 AbortError 语义一致）。
    if (signal?.aborted || (e instanceof Error && e.name === 'AbortError')) throw e;
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
      ? parseSseEvent<T>(raw, expectedId)
      : (JSON.parse(raw) as JsonRpcResponse<T>);
  } catch {
    throw new ProviderError('parse', t(MSG.error_mcp_parse));
  }
  // 响应 id 必须与请求 id 匹配：交错的通知帧（无 id）不能被当作本次调用的响应。
  if (envelope.id !== expectedId) throw new ProviderError('parse', t(MSG.error_mcp_parse));
  if (envelope.error) throw new ProviderError('provider', t(MSG.error_mcp_upstream, envelope.error.message));
  if (!envelope.result) throw new ProviderError('provider', t(MSG.error_mcp_no_result));
  return { result: envelope.result, sessionId: nextSessionId };
}

/**
 * 调用 Stepfun Step Plan 的 MCP `web_search` 工具，返回 `content[0].text`
 * （一个 JSON 字符串：{ query, category, results:[{url,position,title,time,snippet,content}] }）。
 */
export async function mcpWebSearch(url: string, apiKey: string, query: string, signal?: AbortSignal): Promise<string> {
  const init = await rpc(
    url,
    apiKey,
    1,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'juso-search', version: '1.0.0' },
      },
    },
    undefined,
    signal,
  );

  // MCP 生命周期（spec 2025-06-18）：initialize 响应后、首个请求前须发 notifications/initialized
  // 通知。fire-and-forget：会话强制的服务端需要它（本客户端防御性回传 session id，正应以完整
  // 生命周期配合）；无状态端点不要求，其响应（202 或错误）一律不读不判，仅防未处理 rejection。
  try {
    await fetch(url, {
      method: 'POST',
      headers: headersFor(apiKey, init.sessionId),
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      signal,
    });
  } catch {
    // best-effort：无状态端点不要求该通知，失败不阻断 tools/call。
  }

  const tool = await rpc<McpToolResult>(
    url,
    apiKey,
    2,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'web_search', arguments: { query } },
    },
    init.sessionId,
    signal,
  );

  const text = tool.result.content?.[0]?.text;
  // 工具执行失败（isError=true）时错误文本仍在 content[0].text——不能当成功透传给
  // normalize 的 JSON.parse，要把真实上游错误带出来。
  if (tool.result.isError) {
    throw new ProviderError('provider', appendProviderErrorDetail(t(MSG.error_mcp_upstream, 'web_search'), text));
  }
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
    async send(query, opts: SearchOptions, apiKey) {
      return mcpWebSearch(cfg.endpoint, apiKey, query, opts.signal);
    },
  };
}
