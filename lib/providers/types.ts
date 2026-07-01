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
}

export interface ProviderAdapter {
  id: ProviderId;
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
