import type { EngineId } from '../types';

export interface EngineResult {
  title: string;
  url: string;
  snippet: string;
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
  | 'no-results';

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
