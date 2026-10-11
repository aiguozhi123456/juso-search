import type { EngineId } from '../types';

/**
 * worker（lib/engine-search.ts 构造）→ extractor content script（entrypoints/engine-extractor.content.ts
 * 守卫）的抽取消息信封。单源声明，两侧共用——字段增删/改名在两侧同时编译报错，替代手工镜像。
 */
export const ENGINE_EXTRACTION_MESSAGE_TYPE = 'juso:extract-engine-results';

export interface EngineExtractionMessage {
  type: typeof ENGINE_EXTRACTION_MESSAGE_TYPE;
  requestId: string;
  engineId: EngineId;
  query: string;
  maxResults?: number;
  matchQuery?: string;
}

export interface EngineResult {
  title: string;
  url: string;
  snippet: string;
  /**
   * snippet 语义标记（缺省 = 语义正文摘要）。'metadata' = 纯展示元数据拼接
   * （作者/点赞/播放等，无语义正文）——聚合重排把这类 snippet 剔除出重排文档
   * （buildRerankDocument，用户反馈修复：元数据稀释 cross-encoder 相关度）。
   */
  snippetKind?: 'metadata';
}

export interface EngineSearchResponse {
  engine: EngineId;
  query: string;
  results: EngineResult[];
}

export type EngineExtractionErrorKind =
  | 'challenge'
  | 'consent'
  | 'unsupported-layout'
  | 'no-results'
  /** Temporary SERP tab was closed before extraction finished. */
  | 'tab-closed'
  /** Tab load, content-script handshake, or extraction wait timed out. */
  | 'timeout'
  /** Request aborted (bridge deadline / cancellation). */
  | 'aborted'
  /** Tab create/message/orchestration failure not classifiable above. */
  | 'extract-failed';

export interface EngineExtractionError {
  engine: EngineId;
  query: string;
  error: EngineExtractionErrorKind;
}

export type EngineExtractionResult = EngineSearchResponse | EngineExtractionError;

export interface ExtractEngineSearchOptions {
  document: Document;
  engine: EngineId;
  query: string;
  maxResults?: number;
  pageUrl?: string;
}

export interface EngineExtractor {
  extract(document: Document, pageUrl: string): EngineResult[];
  pageState(document: Document, pageUrl: string): EngineExtractionErrorKind | null;
  hasNaturalResultsArea(document: Document): boolean;
}
