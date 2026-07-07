import type { NormalizedSearchResponse, ProviderId } from './providers/types';

export const SEARCH_CACHE_INDEX_KEY = 'searchCacheIndex';
export const SEARCH_CACHE_ENTRY_PREFIX = 'searchCacheEntry:';
export const SEARCH_CACHE_CAP = 50;

const MAX_CACHED_RESULTS = 10;
const MAX_CACHED_ANSWER_CHARS = 2000;
const MAX_CACHED_CITATIONS = 10;
const MAX_CACHED_SNIPPET_CHARS = 1000;
const MAX_SUMMARY_RESULTS = 3;
const MAX_ANSWER_PREVIEW_CHARS = 160;

export interface SearchCacheResultPreview {
  title: string;
  url: string;
}

export interface SearchCacheSummary {
  id: string;
  cacheKey: string;
  query: string;
  normalizedQuery: string;
  providerId: ProviderId;
  createdAt: number;
  lastAccessedAt: number;
  answerPreview?: string;
  resultPreviews: SearchCacheResultPreview[];
  resultCount: number;
}

export interface SearchCacheIndex {
  version: 1;
  order: string[];
  byKey: Record<string, string>;
  summaries: Record<string, SearchCacheSummary>;
}

export interface SearchCacheEntry {
  id: string;
  cacheKey: string;
  query: string;
  normalizedQuery: string;
  providerId: ProviderId;
  createdAt: number;
  lastAccessedAt: number;
  response: NormalizedSearchResponse;
}

export function emptySearchCacheIndex(): SearchCacheIndex {
  return { version: 1, order: [], byKey: {}, summaries: {} };
}

export function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

export function makeSearchCacheKey(providerId: ProviderId, query: string): string {
  return `${providerId}:${normalizeSearchQuery(query)}`;
}

export function searchCacheEntryKey(id: string): string {
  return `${SEARCH_CACHE_ENTRY_PREFIX}${id}`;
}

export function isSearchCacheIndex(value: unknown): value is SearchCacheIndex {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SearchCacheIndex>;
  return candidate.version === 1
    && Array.isArray(candidate.order)
    && isPlainRecord(candidate.byKey)
    && isPlainRecord(candidate.summaries);
}

export function buildSearchCacheEntry(response: NormalizedSearchResponse, now = Date.now()): SearchCacheEntry {
  const id = createCacheId();
  const normalizedQuery = normalizeSearchQuery(response.query);
  const cacheKey = makeSearchCacheKey(response.provider, normalizedQuery);
  return {
    id,
    cacheKey,
    query: response.query,
    normalizedQuery,
    providerId: response.provider,
    createdAt: now,
    lastAccessedAt: now,
    response: slimSearchResponse(response),
  };
}

export function buildSearchCacheSummary(entry: SearchCacheEntry): SearchCacheSummary {
  const answerPreview = entry.response.answer?.text ? truncate(entry.response.answer.text.replace(/\s+/g, ' '), MAX_ANSWER_PREVIEW_CHARS) : undefined;
  return {
    id: entry.id,
    cacheKey: entry.cacheKey,
    query: entry.query,
    normalizedQuery: entry.normalizedQuery,
    providerId: entry.providerId,
    createdAt: entry.createdAt,
    lastAccessedAt: entry.lastAccessedAt,
    answerPreview,
    resultPreviews: entry.response.results.slice(0, MAX_SUMMARY_RESULTS).map((result) => ({
      title: result.title,
      url: result.url,
    })),
    resultCount: entry.response.results.length,
  };
}

function slimSearchResponse(response: NormalizedSearchResponse): NormalizedSearchResponse {
  const answer = response.answer
    ? {
        text: truncate(response.answer.text, MAX_CACHED_ANSWER_CHARS),
        citations: response.answer.citations.slice(0, MAX_CACHED_CITATIONS).map((citation) => ({
          url: citation.url,
          title: citation.title,
        })),
      }
    : undefined;
  return {
    query: response.query,
    provider: response.provider,
    answer,
    results: response.results.slice(0, MAX_CACHED_RESULTS).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: truncate(result.snippet, MAX_CACHED_SNIPPET_CHARS),
      score: result.score,
      publishedDate: result.publishedDate,
      favicon: result.favicon,
    })),
  };
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars - 3)}...` : value;
}

function createCacheId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
