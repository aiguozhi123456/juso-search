import { getEngineExtractor } from './registry';
import { clampedMaxResults, uniqueResults } from './shared';
import type { EngineExtractionResult, ExtractEngineSearchOptions } from './types';

export type {
  EngineExtractionError,
  EngineExtractionErrorKind,
  EngineExtractionMessage,
  EngineExtractionResult,
  EngineResult,
  EngineSearchResponse,
  ExtractEngineSearchOptions,
} from './types';
export { getEngineExtractor } from './registry';
export { ENGINE_EXTRACTION_MESSAGE_TYPE } from './types';

export function extractEngineSearch(options: ExtractEngineSearchOptions): EngineExtractionResult {
  const extractor = getEngineExtractor(options.engine);
  // 合法 EngineId 必在 extractors 表内（| null 契约为原型链安全查找而设），此守卫实际不可达。
  if (!extractor) return { engine: options.engine, query: options.query, error: 'unsupported-layout' };
  const pageUrl = options.pageUrl ?? options.document.location.href;
  const state = extractor.pageState(options.document, pageUrl);
  if (state) return { engine: options.engine, query: options.query, error: state };
  if (!extractor.hasNaturalResultsArea(options.document)) {
    return { engine: options.engine, query: options.query, error: 'unsupported-layout' };
  }
  const results = uniqueResults(extractor.extract(options.document, pageUrl), clampedMaxResults(options.maxResults));
  return results.length > 0
    ? { engine: options.engine, query: options.query, results }
    : { engine: options.engine, query: options.query, error: 'no-results' };
}
