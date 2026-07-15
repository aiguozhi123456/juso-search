import type { EngineId } from '../types';
import { baiduExtractor } from './baidu';
import { bingExtractor } from './bing';
import { googleExtractor } from './google';
import type { EngineExtractor } from './types';

const extractors: Record<EngineId, EngineExtractor> = {
  google: googleExtractor,
  bing: bingExtractor,
  baidu: baiduExtractor,
};

export function getEngineExtractor(engine: EngineId): EngineExtractor {
  return extractors[engine];
}
