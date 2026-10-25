// 归一化模型 + ProviderAdapter 契约（KTD1）。
// 把各家 provider 的异构响应隔离在各自适配器内，统一成下列模型。

export type ProviderId = 'tavily' | 'exa' | 'brave' | 'stepfun' | 'stepfun-plan' | 'jina' | 'doubao' | 'doubao-global' | 'parallel' | 'deepseek' | 'anysearch';

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
  /**
   * snippet 语义标记（缺省 = 语义正文摘要；仅 engine 成员路径会携带）——'metadata' 表示
   * snippet 是纯展示元数据（作者/点赞/播放等），聚合重排据此剔除出重排文档
   * （buildRerankDocument；engine 成员结果经 gateway 直通赋值进聚合响应，字段随合并透传）。
   */
  snippetKind?: 'metadata';
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
  /** Provider-specific settings; gateway reads from storage and passes through. */
  providerSettings?: Record<string, unknown>;
}

export interface ProviderAdapter {
  id: ProviderId;
  /** provider 显示标签的 i18n 消息名（渲染处用 t() 解析）。 */
  label: string;
  /** Tavily/Exa 支持；Stepfun 两面均不支持 */
  supportsAnswer: boolean;
  /** provider 品牌图标：扩展内相对路径（与 engine favicon 同语义），渲染处用 resolveIconUrl 解析。 */
  favicon: string;
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

/** 传输层抽象：把 REST / MCP 统一成「给我 query/opts/key，还我原始响应」。
 *  send() 负责传输期失败（network/auth/HTTP 状态），失败一律抛 ProviderError；REST 路径在
 *  send() 内解析响应体，解析失败也映射为 'parse' 抛出。注意：MCP 传输只回原始工具文本，
 *  响应体解析与 'parse' 映射发生在 ProviderDefinition.normalize（见 base.ts，normalize 允许
 *  抛 ProviderError）——所以「normalize 拿到的 TRaw 不保证已解析」不能理解为「normalize
 *  永远拿不到错误」。 */
export interface ProviderTransport<TRaw> {
  send(query: string, opts: SearchOptions, apiKey: string): Promise<TRaw>;
}
