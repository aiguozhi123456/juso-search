import type { EngineId } from '../types';

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
