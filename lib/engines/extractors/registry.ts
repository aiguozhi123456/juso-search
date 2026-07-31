import type { EngineId } from '../types';
import { baiduExtractor } from './baidu';
import { bilibiliExtractor } from './bilibili';
import { bingExtractor } from './bing';
import { douyinExtractor } from './douyin';
import { duckduckgoExtractor } from './duckduckgo';
import { googleExtractor } from './google';
import type { EngineExtractor } from './types';
import { xiaohongshuExtractor } from './xiaohongshu';
import { yandexExtractor } from './yandex';

const extractors: Record<EngineId, EngineExtractor> = {
  google: googleExtractor,
  bing: bingExtractor,
  baidu: baiduExtractor,
  douyin: douyinExtractor,
  xiaohongshu: xiaohongshuExtractor,
  bilibili: bilibiliExtractor,
  yandex: yandexExtractor,
  duckduckgo: duckduckgoExtractor,
};

export function getEngineExtractor(engine: EngineId): EngineExtractor {
  return extractors[engine];
}
