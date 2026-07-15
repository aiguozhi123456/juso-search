// 归一化模型 + ProviderAdapter 契约（KTD1）。
// 把各家 provider 的异构响应隔离在各自适配器内，统一成下列模型。

export type ProviderId = 'tavily' | 'exa' | 'stepfun' | 'stepfun-plan';

export interface Citation {
  url: string;
  title?: string;
}

export interface NormalizedResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  score?: number;
  publishedDate?: string;
  favicon?: string;
}

export interface NormalizedAnswer {
  text: string;
  citations: Citation[];
}

export interface NormalizedSearchResponse {
  query: string;
  provider: ProviderId;
  /** 仅当 provider 支持综合答案且本次返回了答案时存在（R5 降级依据） */
  answer?: NormalizedAnswer;
  results: NormalizedResult[];
}

export interface SearchOptions {
  maxResults?: number;
  /** 可选取消信号；bridge deadline 使用，普通 UI 调用无需提供。 */
  signal?: AbortSignal;
}

export interface ProviderAdapter {
  id: ProviderId;
  /** provider 显示标签的 i18n 消息名（渲染处用 t() 解析）。 */
  label: string;
  /** Tavily/Exa 支持；Stepfun 两面均不支持 */
  supportsAnswer: boolean;
  search(query: string, opts: SearchOptions, apiKey: string): Promise<NormalizedSearchResponse>;
}

export type ProviderErrorKind = 'unauthorized' | 'rateLimit' | 'network' | 'parse' | 'provider';

/** 适配器统一抛出，供网关映射为面向用户的错误。 */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  constructor(kind: ProviderErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
  }
}

/** 传输层抽象：把 REST / MCP 统一成「给我 query/opts/key，还我原始响应，失败抛 ProviderError」。
 *  send() 必须在任何失败情形（network/auth/parse/provider）抛 ProviderError；normalize 永远拿不到错误。 */
export interface ProviderTransport<TRaw> {
  send(query: string, opts: SearchOptions, apiKey: string): Promise<TRaw>;
}
